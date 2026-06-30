# Solomon AI Decision Stabilizer v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: 최근 3~5개 `RuleDecision`(객체 또는 Supabase row dict)을 묶어 좌석별 **안정화된 AI 후보**(`StabilizedDecision`)를 만든다.
> **후보일 뿐 실제 학생 상태가 아니다** — 상태 변경/출결/벌점/알림/보호자 연락/ai_rule_decisions 수정·삭제·영상저장은 **절대 안 함.**
> 다수결 + 최신/신뢰 가중 + 오래된 것 제외 + 충돌/보수 처리. **합성 데이터로 14 테스트 PASS, 회귀 없음.**

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── config/
│   ├── roi/mediapipe/yolo/rules.yaml                  # (기존)
│   └── stabilizer.yaml                                # ★신규 window/thresholds/weights/rules
│
├── seat_facts.py / fusion_result.py / facts_fusion_engine.py     # (기존) Fusion
├── activity_labels.py / rule_decision.py / rule_engine.py        # (기존) Rule Engine
├── decision_serializer.py / supabase_client.py
├── ai_decision_repository.py / ai_decision_storage_pipeline.py   # (기존) Storage
│
├── stabilized_decision.py            # ★신규 StabilizedDecision (안정화 후보, 순수 데이터)
├── decision_stabilizer.py            # ★신규 DecisionStabilizer (묶음→후보)
├── ai_decision_stabilizer_repository.py  # ★신규 조회 보조(SELECT only, repo 재사용)
├── stabilizer_demo.py                # ★신규 CLI 데모 (--phone/--studying/--absent/--sleeping/--conflict/--insufficient)
├── test_decision_stabilizer.py       # ★신규 테스트 (14개)
│
├── *_demo.py / test_*.py / manage.py / main.py        # (기존)
└── README.md                         # ✎수정 AI Decision Stabilizer v0.1 절 추가
```

★ = 신규, ✎ = 수정. (Supabase migration/프론트엔드 무관 — 순수 파이썬 단계. ai_rule_decisions 는 읽기만.)

---

## 2. 신규 파일 전체 코드

### 2-1. `stabilized_decision.py`

```python
"""
StabilizedDecision
==================

최근 여러 개의 RuleDecision 을 묶어 계산한 **좌석별 "안정화된 AI 상태 후보"**.

⚠️ 매우 중요:
  - StabilizedDecision 은 **실제 학생 상태가 아니다.** "안정화된 AI 후보" 일 뿐이다.
  - 학생 상태 변경 / 출결 / 벌점 / 알림은 절대 하지 않는다(관리자 참고용 후보).

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

# 안정화 상태
STAB_STABLE = "STABLE"                 # 한 activity 가 충분히 우세
STAB_UNSTABLE = "UNSTABLE"             # 신호가 섞여 우세하지 않음
STAB_INSUFFICIENT = "INSUFFICIENT_DATA"  # 판정 개수 부족
STAB_LOW_CONFIDENCE = "LOW_CONFIDENCE"   # 평균 신뢰도/품질 부족
STAB_CONFLICTED = "CONFLICTED"         # 상위 두 activity 가 충돌


@dataclass
class StabilizedDecision:
    stabilized_uuid: str
    seat_id: str
    activity: str                      # STUDYING/PHONE/SLEEPING/ABSENT/UNKNOWN
    confidence: float                  # 0.0~1.0
    status: str                        # STABLE/UNSTABLE/INSUFFICIENT_DATA/LOW_CONFIDENCE/CONFLICTED
    severity: str                      # INFO/WATCH/WARNING/CRITICAL

    window_size: int                   # 설정상 윈도우 용량(max_decisions)
    decision_count: int                # 실제로 사용한 판정 수
    decided_from: Optional[str]        # 윈도우 내 가장 이른 decided_at(ISO)
    decided_to: Optional[str]          # 윈도우 내 가장 늦은 decided_at(ISO)
    generated_at: datetime

    activity_counts: Dict[str, int] = field(default_factory=dict)
    confidence_by_activity: Dict[str, float] = field(default_factory=dict)
    source_decision_uuids: List[str] = field(default_factory=list)
    reasons: List[str] = field(default_factory=list)
    evidence: Dict[str, Any] = field(default_factory=dict)
    metadata: Dict[str, Any] = field(default_factory=dict)

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        return {
            "stabilized_uuid": self.stabilized_uuid,
            "seat_id": self.seat_id,
            "activity": self.activity,
            "confidence": self.confidence,
            "status": self.status,
            "severity": self.severity,
            "decision_count": self.decision_count,
            "activity_counts": dict(self.activity_counts),
            "reasons": list(self.reasons),
            "source_decision_uuids": list(self.source_decision_uuids),
        }
```

### 2-2. `config/stabilizer.yaml`

```yaml
# =========================================================================
# AI Decision Stabilizer v0.1 설정
# =========================================================================
# 최근 여러 개의 RuleDecision 을 묶어 좌석별 "안정화된 AI 후보" 를 만든다.
# ⚠️ 안정화 후보일 뿐 실제 학생 상태가 아니다. 임계값은 코드 하드코딩 없이 여기서 읽는다.
# =========================================================================

window:
  max_decisions: 5          # 안정화에 쓰는 최근 판정 최대 개수
  min_decisions: 3          # 이 미만이면 INSUFFICIENT_DATA
  max_age_minutes: 15       # 이보다 오래된 판정은 제외

thresholds:
  stable_ratio: 0.6             # 우세 activity 비율이 이 이상이면 STABLE 후보
  min_average_confidence: 0.55  # 후보 평균 신뢰도 최소
  phone_min_count: 2            # 윈도우 내 PHONE 최소 횟수
  absent_min_count: 2
  sleeping_min_count: 2
  studying_min_count: 2
  conflict_margin: 0.15         # 상위 두 activity 비율 차가 이보다 작으면 CONFLICTED

weights:
  latest_weight: 1.2            # 가장 최근 판정 가중치
  normal_weight: 1.0            # 그 외 판정 가중치
  low_confidence_penalty: 0.5   # LOW_CONFIDENCE/FAILED/SKIPPED 판정 가중치 배수

rules:
  enable_majority_vote: true
  enable_consecutive_check: true
  enable_conflict_detection: true
```

### 2-3. `decision_stabilizer.py`

```python
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
                "version": ENGINE_VERSION, "window": dict(getattr(self, "window", {}))}

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
            seat_id=seat, activity=activity, confidence=confidence,
            status=status, severity=severity,
            window_size=int(self.window.get("max_decisions", 5)),
            decision_count=len(window), decided_from=decided_from, decided_to=decided_to,
            generated_at=generated_at,
            activity_counts=dict(counts or {}), confidence_by_activity=dict(conf_by or {}),
            source_decision_uuids=[n.uuid for n in window],
            reasons=reasons, evidence=evidence,
            metadata={"engine": self.name, "version": ENGINE_VERSION,
                      "thresholds": dict(getattr(self, "thresholds", {})),
                      "window": dict(getattr(self, "window", {}))})

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
            return _Norm(seat_id=d.get("seat_id", ""), activity=str(activity).upper(),
                         confidence=_num(d.get("confidence")), status=str(d.get("status") or "").upper(),
                         decided_at=_parse_dt(d.get("decided_at")),
                         du=d.get("decision_uuid") or d.get("id") or "")
        # RuleDecision 객체(덕타이핑)
        activity = getattr(d, "activity", None)
        if not activity:
            return None
        return _Norm(seat_id=getattr(d, "seat_id", "") or "", activity=str(activity).upper(),
                     confidence=_num(getattr(d, "confidence", None)),
                     status=str(getattr(d, "status", "") or "").upper(),
                     decided_at=_parse_dt(getattr(d, "decided_at", None)),
                     du=getattr(d, "decision_uuid", "") or "")


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
```

### 2-4. `ai_decision_stabilizer_repository.py`

```python
"""
AI Decision Stabilizer Repository (조회 보조)
============================================

ai_rule_decisions 에서 **최근 판정을 조회**해 DecisionStabilizer 에 넘기는 보조 함수.

⚠️ SELECT 만 한다. insert/update/delete 없음(기존 AIDecisionRepository 재사용).
   안정화는 "후보" 를 만들 뿐 학생 상태/출결/벌점/알림을 바꾸지 않는다.
"""

from __future__ import annotations

from typing import Any, Dict, List


def get_recent_decisions_for_stabilization(repository: Any, seat_id: str,
                                           limit: int = 5) -> List[Dict[str, Any]]:
    """한 좌석의 최근 판정 row dict 목록(최신순). repository 는 get_recent_by_seat 제공."""
    return list(repository.get_recent_by_seat(seat_id, limit=limit) or [])


def get_recent_decisions_for_all_seats(repository: Any, seat_ids: List[str],
                                       limit_per_seat: int = 5) -> Dict[str, List[Dict[str, Any]]]:
    """여러 좌석의 최근 판정을 좌석별 dict 로. stabilize_by_seat 입력 형태."""
    return {
        seat: list(repository.get_recent_by_seat(seat, limit=limit_per_seat) or [])
        for seat in (seat_ids or [])
    }
```

### 2-5. `stabilizer_demo.py` / `test_decision_stabilizer.py`
- `stabilizer_demo.py`: `--phone/--studying/--absent/--sleeping/--conflict/--insufficient` 시나리오로
  fake RuleDecision 목록을 만들어 `DecisionStabilizer.stabilize()` 결과를 출력.
- `test_decision_stabilizer.py`(14): 아래 §8 참고. RuleDecision 객체 + Supabase row dict 입력,
  오래된 판정 제외, 최신/신뢰 가중, 충돌/보수 처리, source/evidence 기록, 부수효과 없음(소스 스캔), 기존 모듈 미파손.

---

## 3. 수정된 파일 (변경 부분)

### `rtsp-poc/README.md`
- 헤더 모듈 목록에 **AI Decision Stabilizer v0.1** 추가, 범위 경고에 "시계열 안정화 후보까지만" 명시.
- **"## AI Decision Stabilizer v0.1"** 절 신규: 필요성/입력(객체·row dict)/흐름/status 표/보수 처리/evidence·reasons/실행/테스트/다음 단계.

> 기존 엔진/Storage/프론트 코드는 **무수정**. Stabilizer 는 RuleDecision/row dict 를 **읽기만** 한다.

---

## 4. AI Decision Stabilizer 구조도

```
   RuleEngine ──► RuleDecision 객체 ┐
                                    ├─► [입력 목록] ──► DecisionStabilizer.stabilize()
   ai_rule_decisions ─(SELECT)─► row dict ┘            (repository helper 는 조회만)
                                                          │
        ┌─────────────────────────────────────────────────┼──────────────────────┐
        │ 1) _normalize: 객체/dict → 공통(_Norm)                                   │
        │ 2) 오래된 제외: decided_at < ref-max_age  (ref=now 또는 최신 판정)        │
        │ 3) 최신순 정렬 + max_decisions 윈도우                                     │
        │ 4) len<min_decisions → INSUFFICIENT_DATA                                  │
        │ 5) 가중치 집계: 최신=latest_weight, 그외=normal, 약한status×penalty        │
        │ 6) 실제 activity 중 가중치 최대 = 후보                                     │
        │ 7) 충돌(상위 두 비율차<conflict_margin) → CONFLICTED                       │
        │ 8) 후보 최소횟수 미달 → UNSTABLE                                          │
        │ 9) 평균 신뢰도<min_avg → LOW_CONFIDENCE                                   │
        │ 10) 우세 비율<stable_ratio → UNSTABLE                                     │
        │ 11) 그 외 → STABLE(activity 확정)                                         │
        └─────────────────────────────────────────────────┬──────────────────────┘
                                                           ▼
                                          ┌─────────────────────────────┐
                                          │      StabilizedDecision     │  안정화 "후보"
                                          │ activity/confidence/status/ │  (실제 상태 아님)
                                          │ severity/counts/reasons/    │
                                          │ evidence/source_uuids       │
                                          └──────────────┬──────────────┘
                                                         ▼
                       (다음 단계) 관리자 대시보드에 "안정화된 추정" 표시 — 자동 변경 없음
```

**핵심 설계 원칙**
- **후보일 뿐**: 어떤 결과도 학생 상태/출결/벌점/알림으로 이어지지 않음(소스 스캔 테스트로 강제).
- **입력 이중 호환**: RuleDecision 객체 ↔ Supabase row dict 둘 다 정규화.
- **보수성**: 다수결 + 최소횟수 + 평균신뢰 + 우세비율 + 충돌 검사. ABSENT/SLEEPING 특히 보수적.
- **config 주도**: window/thresholds/weights/rules 전부 `config/stabilizer.yaml`.

---

## 5. StabilizedDecision 설명

| 필드 | 의미 |
|------|------|
| `stabilized_uuid` | 안정화 1건 고유 id |
| `seat_id` | 좌석(입력에서 유추 또는 stabilize_by_seat 키) |
| `activity` | STABLE 일 때만 실제 활동, 그 외 UNKNOWN |
| `confidence` | 후보 activity 의 평균 신뢰도(없으면 0) |
| `status` | STABLE / UNSTABLE / INSUFFICIENT_DATA / LOW_CONFIDENCE / CONFLICTED |
| `severity` | INFO/WATCH/WARNING/CRITICAL (STABLE 아니면 INFO, SLEEPING 은 WATCH 이하) |
| `window_size` | 설정 윈도우 용량(max_decisions) |
| `decision_count` | 실제 사용한 판정 수 |
| `decided_from` / `decided_to` | 윈도우 내 최이른/최늦은 decided_at(ISO) |
| `activity_counts` | activity 별 횟수 |
| `confidence_by_activity` | activity 별 평균 신뢰도 |
| `source_decision_uuids` | 사용한 RuleDecision uuid 목록 |
| `reasons` / `evidence` / `metadata` | 사람용 이유 / 집계 근거 / trace |

> **후보 ≠ 상태**: STABLE 이어도 "AI 추정 후보" 다. 실제 학생 상태로 만드는 것은 다음 단계의 사람·정책.

---

## 6. 안정화 규칙 설명

**우선순위(stabilize 내부)**: INSUFFICIENT_DATA → (실제 신호 없음 LOW_CONFIDENCE) → CONFLICTED → 최소횟수 UNSTABLE → 평균신뢰 LOW_CONFIDENCE → 우세비율 UNSTABLE → STABLE.

- **가중치**: 최신 판정 `latest_weight`(1.2), 그 외 `normal_weight`(1.0). `LOW_CONFIDENCE/FAILED/SKIPPED` 는 `× low_confidence_penalty`(0.5) → 불확실 판정의 영향 축소.
- **PHONE**: 윈도우 내 PHONE ≥ `phone_min_count`(2) + 평균신뢰 ≥ 0.55 + 우세비율 ≥ 0.6 → STABLE PHONE(severity WARNING).
- **STUDYING**: STUDYING 다수 + PHONE/ABSENT 약함 → STABLE STUDYING(INFO).
- **ABSENT**: ABSENT ≥ 2 이지만 UNKNOWN/LOW_CONFIDENCE 가 섞여 우세비율이 낮으면 **UNSTABLE**(보수). 천장 카메라 오탐 위험 때문.
- **SLEEPING**: SLEEPING 다수면 STABLE 가능하나 motion score 부재 → severity **WATCH 이하** 강제.
- **UNKNOWN**: 입력 부족/품질 낮음/충돌/신호 섞임/신뢰 부족 시 결과 activity 는 UNKNOWN.
- **충돌**: 상위 두 실제 activity 의 (가중치차/총가중치) < `conflict_margin`(0.15) → CONFLICTED UNKNOWN.

---

## 7. Evidence / reasons 설명

**evidence**(집계 근거):
`total_decisions / valid_decisions / ignored_decisions / aged_out / activity_counts / activity_ratios /
average_confidence / latest_activity / consecutive_activity{activity,count} / conflict_detected / source_decision_uuids`

**reasons**(사람이 읽는 이유) 예:
- "최근 5개 판정 중 PHONE 3회"
- "PHONE 평균 신뢰도 0.8"
- "최근 판정 2회 연속 PHONE"
- "우세 비율 0.62 ≥ 0.6 → 안정"
- "PHONE과 STUDYING 신호가 충돌하여 UNKNOWN 처리 (PHONE 2회 vs STUDYING 2회)"
- "ABSENT 2회 < 최소 2회 → 보수적 UNKNOWN" / "우세 비율 0.59 < 0.6 → 신호 섞임"

---

## 8. 테스트 결과

`python test_decision_stabilizer.py`:

```
PASS phone_stable: PHONE 3/5 → STABLE PHONE
PASS studying_stable: STUDYING 4/5 → STABLE STUDYING
PASS absent_conservative: ABSENT 2/5 → UNSTABLE(보수)
PASS sleeping_watch: SLEEPING STABLE → severity WATCH 이하
PASS empty: 입력 0개 → INSUFFICIENT_DATA
PASS too_few: 입력 2개 < 최소 3 → INSUFFICIENT_DATA
PASS conflict: PHONE/STUDYING 충돌 → CONFLICTED UNKNOWN
PASS low_conf: 평균 신뢰도 낮음 → LOW_CONFIDENCE UNKNOWN
PASS old_excluded: 오래된 판정 제외(aged_out=2)
PASS latest_weight: 최신+신뢰가중으로 동률을 깨고 STABLE PHONE
PASS row_dict: Supabase row dict 입력 처리
PASS by_seat: stabilize_by_seat + evidence/source 기록
PASS no_side_effects: 학생상태/알림/벌점/출결/쓰기 코드 없음
PASS intact: RuleEngine / Storage 동작 유지

ALL PASS: phone / studying / absent / sleeping / empty / too_few / conflict / low_conf /
          old_excluded / latest_weight / row_dict / by_seat / no_side_effects / intact
```

**데모**(요약): phone→STABLE PHONE(WARNING), studying→STABLE STUDYING(INFO), absent→UNSTABLE(UNKNOWN),
sleeping→STABLE SLEEPING(WATCH), conflict→CONFLICTED(UNKNOWN), insufficient→INSUFFICIENT_DATA(UNKNOWN).

**회귀**: `test_rule_engine.py` / `test_ai_decision_storage.py` / `test_facts_fusion_engine.py` PASS 유지.
신규 모듈 import 시 cv2/mediapipe/ultralytics/supabase 미로드.

---

## 9. 남은 기술부채

1. **시간대(tz)**: row dict 의 timestamptz(예 `+00:00`)를 naive 로 떼어 비교(근사). UTC↔KST 표준화 필요.
2. **기준 시각**: `now` 미지정 시 "가장 최근 판정 시각" 기준으로 max_age 적용 → 실제 현재시각과 다를 수 있음(실시간 운영 시 now 주입 권장).
3. **좌석 혼입**: `stabilize` 에 여러 좌석이 섞이면 _dominant_seat 로 라벨만 정함(Fusion 처럼 엄격 검증은 안 함). `stabilize_by_seat` 사용 권장.
4. **연속성(consecutive) 미반영**: front-run 을 evidence/reasons 에만 쓰고 status 가중엔 직접 반영 안 함.
5. **가중치 단순**: 선형 가중. 시간 감쇠(최근일수록 지수 가중)·신뢰도 직접 가중은 미적용.
6. **실데이터 미보정**: 임계값/가중치는 휴리스틱. 측면 카메라 실데이터로 재튜닝 필요(특히 ABSENT/SLEEPING).
7. **저장/표시 미연동**: StabilizedDecision 을 저장하거나 대시보드에 표시하는 연결은 다음 단계.

---

## 10. v0.2 개선계획

1. **tz 표준화**: 모든 decided_at 을 UTC aware 로 통일, 표시에서 KST 변환.
2. **now 주입 + Orchestrator 연동**: 실제 현재시각 기준 윈도우, 주기적으로 좌석별 안정화 실행.
3. **시간 감쇠 가중**: 최근일수록 지수 가중 + 신뢰도 곱 가중으로 더 부드러운 안정화.
4. **연속성 보너스**: N회 연속 동일 activity 면 STABLE 문턱 완화(또는 confidence 보정).
5. **StabilizedDecision 저장(선택)**: 별도 테이블/캐시에 후보를 남겨 추세 분석(여전히 상태 변경 X).
6. **관리자 대시보드 표시(다음 단계)**: 좌석 카드에 "안정화된 추정" 배지 추가 — 단발 판정과 구분해 표시.
7. **실데이터 보정**: 측면 카메라 수집 후 임계/가중 재튜닝, 활동별 정밀도 측정.

> v0.1 범위 재확인: **안정화된 AI 후보 생성까지만.**
> 학생 상태 변경 / 출결 / 벌점 / 알림 / 보호자 연락 / 관리자 승인 버튼 / RuleDecision 수정·삭제 / 영상·이미지 저장 / 학생 앱 공개는 절대 미구현.
