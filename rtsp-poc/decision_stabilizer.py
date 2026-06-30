"""
DecisionStabilizer (Solomon AI Decision Stabilizer v0.1)
========================================================

최근 3~5개의 RuleDecision 을 묶어 좌석별 **안정화된 AI 후보**(StabilizedDecision)를 만든다.

  [RuleDecision ...] 또는 [ai_rule_decisions row dict ...]
        → stabilize() → StabilizedDecision

⚠️ 매우 중요(이번 단계 범위):
  - 결과는 **안정화된 AI 후보일 뿐, 실제 학생 상태가 아니다.**
  - 학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락은 절대 하지 않는다.
  - ai_rule_decisions 를 수정/삭제하지 않는다(읽기만).
  - 임계값은 코드 하드코딩 없이 config/stabilizer.yaml 에서 읽는다.

입력은 **RuleDecision 객체** 와 **Supabase row dict** 둘 다 허용한다(백엔드/프론트 데이터 호환).

이 모듈은 외부 AI/cv2 라이브러리에 의존하지 않는다.
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import activity_labels as A
from stabilized_decision import (
    StabilizedDecision,
    STAB_STABLE, STAB_UNSTABLE, STAB_INSUFFICIENT, STAB_LOW_CONFIDENCE, STAB_CONFLICTED,
)

log = logging.getLogger("decision_stabilizer")

ENGINE_VERSION = "decision-stabilizer-v0.1"

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_CONFIG = os.path.join(_HERE, "config", "stabilizer.yaml")

# 실제 activity 후보(UNKNOWN 은 후보가 아니라 fallback)
REAL_ACTIVITIES = [A.STUDYING, A.PHONE, A.SLEEPING, A.ABSENT]

_DEFAULT_WINDOW = {"max_decisions": 5, "min_decisions": 3, "max_age_minutes": 15}
_DEFAULT_THRESHOLDS = {
    "stable_ratio": 0.6, "min_average_confidence": 0.55,
    "phone_min_count": 2, "absent_min_count": 2,
    "sleeping_min_count": 2, "studying_min_count": 2, "conflict_margin": 0.15,
}
_DEFAULT_WEIGHTS = {"latest_weight": 1.2, "normal_weight": 1.0, "low_confidence_penalty": 0.5}
_DEFAULT_RULES = {
    "enable_majority_vote": True, "enable_consecutive_check": True,
    "enable_conflict_detection": True,
}

# 가중치를 낮추는(불확실) status
_WEAK_STATUS = {"LOW_CONFIDENCE", "FAILED", "SKIPPED"}

_MIN_COUNT_KEY = {
    A.PHONE: "phone_min_count", A.ABSENT: "absent_min_count",
    A.SLEEPING: "sleeping_min_count", A.STUDYING: "studying_min_count",
}


class _Norm:
    """RuleDecision/ row dict 를 통일한 내부 표현."""
    __slots__ = ("seat_id", "activity", "confidence", "status", "decided_at", "uuid")

    def __init__(self, seat_id, activity, confidence, status, decided_at, du):
        self.seat_id = seat_id
        self.activity = activity
        self.confidence = confidence
        self.status = status
        self.decided_at = decided_at      # datetime(naive)
        self.uuid = du


class DecisionStabilizer:
    name = "decision_stabilizer"

    def __init__(self, config_path: Optional[str] = None,
                 config: Optional[Dict[str, Any]] = None, **kwargs) -> None:
        self.config_path = config_path or _DEFAULT_CONFIG
        self._config = dict(config) if config else None
        self._ready = False
        self._count = 0

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        if self._config is None:
            self._config = self._load_config(self.config_path)
        self.window = {**_DEFAULT_WINDOW, **(self._config.get("window", {}) or {})}
        self.thresholds = {**_DEFAULT_THRESHOLDS, **(self._config.get("thresholds", {}) or {})}
        self.weights = {**_DEFAULT_WEIGHTS, **(self._config.get("weights", {}) or {})}
        self.rules = {**_DEFAULT_RULES, **(self._config.get("rules", {}) or {})}
        self._ready = True
        log.info("DecisionStabilizer 초기화 - window=%s thresholds=%s", self.window, self.thresholds)

    @staticmethod
    def _load_config(path: str) -> Dict[str, Any]:
        if not os.path.exists(path):
            log.warning("stabilizer 설정 없음(%s) - 기본값 사용", path)
            return {}
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "stabilized": self._count,
                "version": ENGINE_VERSION,
                "window": dict(getattr(self, "window", {}))}

    # ----------------------------------------------------------- public
    def stabilize_by_seat(self, decisions_by_seat: Dict[str, List[Any]],
                          now: Optional[datetime] = None) -> Dict[str, StabilizedDecision]:
        return {seat: self.stabilize(items, now=now, seat_id=seat)
                for seat, items in (decisions_by_seat or {}).items()}

    def stabilize(self, decisions: List[Any], now: Optional[datetime] = None,
                  seat_id: Optional[str] = None) -> StabilizedDecision:
        generated_at = datetime.now()
        norms = [n for n in (self._normalize(d) for d in (decisions or [])) if n is not None]
        seat = seat_id or _dominant_seat(norms)
        total = len(norms)

        # 1) 입력 없음 → INSUFFICIENT_DATA
        if total == 0:
            return self._build(seat, A.UNKNOWN, 0.0, STAB_INSUFFICIENT, generated_at,
                               window=[], total=0, reasons=["입력 판정이 없음"], evidence={})

        # 2) 기준 시각: now 없으면 가장 최근 판정 시각
        ref = now or max(n.decided_at for n in norms)
        max_age = float(self.window.get("max_age_minutes", 15))
        cutoff = ref - timedelta(minutes=max_age)
        fresh = [n for n in norms if n.decided_at >= cutoff]
        aged_out = total - len(fresh)

        # 3) 최신순 정렬 + 윈도우 상한
        fresh.sort(key=lambda n: n.decided_at, reverse=True)
        cap = int(self.window.get("max_decisions", 5))
        window = fresh[:cap]

        # 4) 최소 개수 미만 → INSUFFICIENT_DATA
        min_dec = int(self.window.get("min_decisions", 3))
        if len(window) < min_dec:
            ev = self._evidence(window, total, aged_out, None, {}, {}, {}, False)
            return self._build(seat, A.UNKNOWN, 0.0, STAB_INSUFFICIENT, generated_at,
                               window=window, total=total,
                               reasons=[f"유효 판정 {len(window)}개 < 최소 {min_dec}개"], evidence=ev)

        # 5) 가중치/카운트/신뢰도 집계
        counts, conf_by, weighted, avg_conf_window = self._aggregate(window)
        latest_activity = window[0].activity
        consecutive_activity, consecutive_count = _front_run(window)

        # 6) 우세 후보(실제 activity 중 가중치 최대)
        real_scores = {a: weighted.get(a, 0.0) for a in REAL_ACTIVITIES if counts.get(a, 0) > 0}
        total_weight = sum(weighted.values()) or 1.0

        conflict_detected = False
        if not real_scores:
            ev = self._evidence(window, total, aged_out, latest_activity, counts, conf_by,
                                _ratios(counts, len(window)), False,
                                consecutive_activity, consecutive_count, avg_conf_window)
            return self._build(seat, A.UNKNOWN, 0.0, STAB_LOW_CONFIDENCE, generated_at,
                               window=window, total=total,
                               reasons=["실제 활동 신호 없음(모두 UNKNOWN)"], evidence=ev,
                               counts=counts, conf_by=conf_by)

        ranked = sorted(real_scores.items(), key=lambda kv: kv[1], reverse=True)
        candidate, cand_weight = ranked[0]
        cand_ratio = cand_weight / total_weight
        cand_count = counts.get(candidate, 0)
        cand_conf = conf_by.get(candidate, 0.0)

        # 7) 충돌 검사: 상위 두 실제 activity 비율 차가 작으면 CONFLICTED
        if self.rules.get("enable_conflict_detection", True) and len(ranked) >= 2:
            second, second_w = ranked[1]
            if (cand_weight - second_w) / total_weight < self.thresholds["conflict_margin"]:
                conflict_detected = True
                ev = self._evidence(window, total, aged_out, latest_activity, counts, conf_by,
                                    _ratios(counts, len(window)), True,
                                    consecutive_activity, consecutive_count, avg_conf_window)
                return self._build(
                    seat, A.UNKNOWN, round(cand_conf, 4), STAB_CONFLICTED, generated_at,
                    window=window, total=total,
                    reasons=[f"{candidate}과 {second} 신호가 충돌하여 UNKNOWN 처리 "
                             f"({candidate} {counts.get(candidate,0)}회 vs {second} {counts.get(second,0)}회)"],
                    evidence=ev, counts=counts, conf_by=conf_by)

        reasons: List[str] = [
            f"최근 {len(window)}개 판정 중 {candidate} {cand_count}회",
            f"{candidate} 평균 신뢰도 {round(cand_conf, 2)}",
        ]
        if self.rules.get("enable_consecutive_check", True) and \
                consecutive_activity == candidate and consecutive_count >= 2:
            reasons.append(f"최근 판정 {consecutive_count}회 연속 {candidate}")

        ev = self._evidence(window, total, aged_out, latest_activity, counts, conf_by,
                            _ratios(counts, len(window)), conflict_detected,
                            consecutive_activity, consecutive_count, avg_conf_window)

        # 8) 활동별 최소 횟수 미달 → UNSTABLE
        min_count = int(self.thresholds.get(_MIN_COUNT_KEY.get(candidate, ""), 2)) \
            if candidate in _MIN_COUNT_KEY else 2
        if cand_count < min_count:
            return self._build(seat, A.UNKNOWN, round(cand_conf, 4), STAB_UNSTABLE, generated_at,
                               window=window, total=total,
                               reasons=reasons + [f"{candidate} {cand_count}회 < 최소 {min_count}회 → 보수적 UNKNOWN"],
                               evidence=ev, counts=counts, conf_by=conf_by)

        # 9) 평균 신뢰도 부족 → LOW_CONFIDENCE
        if cand_conf < self.thresholds["min_average_confidence"]:
            return self._build(seat, A.UNKNOWN, round(cand_conf, 4), STAB_LOW_CONFIDENCE, generated_at,
                               window=window, total=total,
                               reasons=reasons + [f"평균 신뢰도 {round(cand_conf,2)} < "
                                                  f"{self.thresholds['min_average_confidence']}"],
                               evidence=ev, counts=counts, conf_by=conf_by)

        # 10) 우세 비율 부족 → UNSTABLE
        if cand_ratio < self.thresholds["stable_ratio"]:
            return self._build(seat, A.UNKNOWN, round(cand_conf, 4), STAB_UNSTABLE, generated_at,
                               window=window, total=total,
                               reasons=reasons + [f"우세 비율 {round(cand_ratio,2)} < "
                                                  f"{self.thresholds['stable_ratio']} → 신호 섞임"],
                               evidence=ev, counts=counts, conf_by=conf_by)

        # 11) STABLE
        reasons.append(f"우세 비율 {round(cand_ratio,2)} ≥ {self.thresholds['stable_ratio']} → 안정")
        return self._build(seat, candidate, round(cand_conf, 4), STAB_STABLE, generated_at,
                           window=window, total=total, reasons=reasons, evidence=ev,
                           counts=counts, conf_by=conf_by)

    # ----------------------------------------------------------- aggregate
    def _aggregate(self, window: List[_Norm]):
        counts: Dict[str, int] = {}
        conf_sum: Dict[str, float] = {}
        weighted: Dict[str, float] = {}
        all_conf: List[float] = []
        latest_w = float(self.weights["latest_weight"])
        normal_w = float(self.weights["normal_weight"])
        penalty = float(self.weights["low_confidence_penalty"])

        for idx, n in enumerate(window):
            w = latest_w if idx == 0 else normal_w
            if n.status in _WEAK_STATUS:
                w *= penalty
            counts[n.activity] = counts.get(n.activity, 0) + 1
            conf_sum[n.activity] = conf_sum.get(n.activity, 0.0) + n.confidence
            weighted[n.activity] = weighted.get(n.activity, 0.0) + w
            all_conf.append(n.confidence)

        conf_by = {a: round(conf_sum[a] / counts[a], 4) for a in counts}
        avg_conf_window = round(sum(all_conf) / len(all_conf), 4) if all_conf else 0.0
        return counts, conf_by, weighted, avg_conf_window

    # ----------------------------------------------------------- evidence
    @staticmethod
    def _evidence(window, total, aged_out, latest_activity, counts, conf_by, ratios,
                  conflict, consecutive_activity=None, consecutive_count=0,
                  avg_conf=0.0) -> Dict[str, Any]:
        valid = len(window)
        return {
            "total_decisions": total,
            "valid_decisions": valid,
            "ignored_decisions": total - valid,
            "aged_out": aged_out,
            "activity_counts": dict(counts),
            "activity_ratios": ratios,
            "average_confidence": avg_conf,
            "latest_activity": latest_activity,
            "consecutive_activity": {"activity": consecutive_activity, "count": consecutive_count},
            "conflict_detected": conflict,
            "source_decision_uuids": [n.uuid for n in window],
        }

    # ----------------------------------------------------------- build
    def _build(self, seat, activity, confidence, status, generated_at, window, total,
               reasons, evidence, counts=None, conf_by=None) -> StabilizedDecision:
        self._count += 1
        severity = self._severity(activity, status)
        decided_from = window[-1].decided_at.isoformat() if window else None
        decided_to = window[0].decided_at.isoformat() if window else None
        return StabilizedDecision(
            stabilized_uuid=uuid.uuid4().hex,
            seat_id=seat,
            activity=activity,
            confidence=confidence,
            status=status,
            severity=severity,
            window_size=int(self.window.get("max_decisions", 5)),
            decision_count=len(window),
            decided_from=decided_from,
            decided_to=decided_to,
            generated_at=generated_at,
            activity_counts=dict(counts or {}),
            confidence_by_activity=dict(conf_by or {}),
            source_decision_uuids=[n.uuid for n in window],
            reasons=reasons,
            evidence=evidence,
            metadata={"engine": self.name, "version": ENGINE_VERSION,
                      "thresholds": dict(getattr(self, "thresholds", {})),
                      "window": dict(getattr(self, "window", {}))},
        )

    @staticmethod
    def _severity(activity: str, status: str) -> str:
        if status != STAB_STABLE:
            return A.SEVERITY_INFO            # 안정 아닌 후보는 INFO
        sev = A.ACTIVITY_SEVERITY.get(activity, A.SEVERITY_INFO)
        # 수면은 motion score 없음 → WATCH 이하로 제한
        if activity == A.SLEEPING and sev not in (A.SEVERITY_INFO, A.SEVERITY_WATCH):
            return A.SEVERITY_WATCH
        return sev

    # ----------------------------------------------------------- normalize
    @staticmethod
    def _normalize(d: Any) -> Optional[_Norm]:
        if d is None:
            return None
        if isinstance(d, dict):
            activity = d.get("activity")
            if not activity:
                return None
            return _Norm(
                seat_id=d.get("seat_id", ""),
                activity=str(activity).upper(),
                confidence=_num(d.get("confidence")),
                status=str(d.get("status") or "").upper(),
                decided_at=_parse_dt(d.get("decided_at")),
                du=d.get("decision_uuid") or d.get("id") or "",
            )
        # RuleDecision 객체(덕타이핑)
        activity = getattr(d, "activity", None)
        if not activity:
            return None
        return _Norm(
            seat_id=getattr(d, "seat_id", "") or "",
            activity=str(activity).upper(),
            confidence=_num(getattr(d, "confidence", None)),
            status=str(getattr(d, "status", "") or "").upper(),
            decided_at=_parse_dt(getattr(d, "decided_at", None)),
            du=getattr(d, "decision_uuid", "") or "",
        )


# ---------------------------------------------------------------- helpers
def _num(v: Any) -> float:
    try:
        if isinstance(v, bool):
            return 0.0
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _parse_dt(v: Any) -> datetime:
    """datetime/ISO 문자열 → naive datetime(tz 는 떼어 비교 단순화)."""
    if isinstance(v, datetime):
        return v.replace(tzinfo=None) if v.tzinfo else v
    if isinstance(v, str) and v:
        s = v.strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
            return dt.replace(tzinfo=None) if dt.tzinfo else dt
        except ValueError:
            pass
    return datetime.min


def _dominant_seat(norms: List[_Norm]) -> str:
    counts: Dict[str, int] = {}
    for n in norms:
        if n.seat_id:
            counts[n.seat_id] = counts.get(n.seat_id, 0) + 1
    return max(counts, key=counts.get) if counts else ""


def _front_run(window: List[_Norm]) -> Tuple[Optional[str], int]:
    """최신부터 같은 activity 가 몇 개 연속인지."""
    if not window:
        return None, 0
    a = window[0].activity
    c = 0
    for n in window:
        if n.activity == a:
            c += 1
        else:
            break
    return a, c


def _ratios(counts: Dict[str, int], total: int) -> Dict[str, float]:
    if total <= 0:
        return {}
    return {a: round(c / total, 3) for a, c in counts.items()}
