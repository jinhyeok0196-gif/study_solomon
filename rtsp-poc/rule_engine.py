"""
RuleEngine (Solomon Rule Engine v0.1)
=====================================

FactsFusionEngine 이 만든 **SeatFacts** 를 입력받아 학생 상태를 **1차 판정**한다.

  SeatFacts → decide() → RuleDecision(activity, confidence, severity, reasons, ...)

이번 단계에서 처음으로 activity 가 UNKNOWN 이 아닌 값이 나올 수 있다.
단, **판정 결과 생성까지만** 한다. Supabase 저장 / Dashboard / 학생 상태 변경 / 알림은 절대 안 한다.

  - RuleEngine 은 **AI 분석기가 아니라 규칙 판정기**다(AIEngine 을 상속하지 않는다).
  - 임계값은 코드에 하드코딩하지 않고 config/rules.yaml 에서 읽는다.
  - v0.1 은 **보수적**으로 판정한다(천장 카메라 한계 → 무리한 confidence 금지).
  - ⚠️ 파워냅은 AI activity 가 아니다. Rule Engine 은 파워냅을 판정하지 않는다.

판정 우선순위(v0.1):
  1) 입력 불가/품질 낮음 → UNKNOWN
  2) ABSENT(자리비움) 후보
  3) PHONE(휴대폰) 후보
  4) SLEEPING(수면) 후보
  5) STUDYING(공부) 후보
  6) 애매/충돌 → UNKNOWN

이 모듈은 외부 AI/cv2 라이브러리에 의존하지 않는다(SeatFacts dict 만 읽는다).
"""

from __future__ import annotations

import logging
import os
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

import activity_labels as A
from rule_decision import RuleDecision

log = logging.getLogger("rule_engine")

ENGINE_VERSION = "rule-engine-v0.1"

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_CONFIG = os.path.join(_HERE, "config", "rules.yaml")

_DEFAULT_THRESHOLDS = {
    "min_overall_quality": 0.3,
    "phone_confidence": 0.65,
    "studying_confidence": 0.6,
    "absent_confidence": 0.7,
    "sleeping_confidence": 0.6,
    "conflict_margin": 0.15,
    "sleeping_confidence_cap": 0.75,
}
_DEFAULT_WEIGHTS = {
    "phone_object": 0.45, "hands_visible": 0.20, "no_book": 0.15,
    "no_laptop": 0.10, "person_present": 0.10,
}
_DEFAULT_RULES = {
    "enable_phone_rule": True, "enable_studying_rule": True,
    "enable_absent_rule": True, "enable_sleeping_rule": True,
}


class RuleEngine:
    name = "rule_engine"

    def __init__(self, config_path: Optional[str] = None,
                 config: Optional[Dict[str, Any]] = None, **kwargs) -> None:
        self.config_path = config_path or _DEFAULT_CONFIG
        self._config = dict(config) if config else None
        self._ready = False
        self._decided = 0

    # ----------------------------------------------------------- lifecycle
    def initialize(self) -> None:
        if self._config is None:
            self._config = self._load_config(self.config_path)
        self.thresholds = {**_DEFAULT_THRESHOLDS, **(self._config.get("thresholds", {}) or {})}
        self.weights = {**_DEFAULT_WEIGHTS, **(self._config.get("weights", {}) or {})}
        self.rules = {**_DEFAULT_RULES, **(self._config.get("rules", {}) or {})}
        self._ready = True
        log.info("RuleEngine 초기화 - thresholds=%s rules=%s", self.thresholds, self.rules)

    @staticmethod
    def _load_config(path: str) -> Dict[str, Any]:
        if not os.path.exists(path):
            log.warning("rules 설정 없음(%s) - 기본값 사용", path)
            return {}
        import yaml
        with open(path, "r", encoding="utf-8") as f:
            return yaml.safe_load(f) or {}

    def shutdown(self) -> None:
        self._ready = False

    def health(self) -> dict:
        return {"name": self.name, "ready": self._ready, "decided": self._decided,
                "version": ENGINE_VERSION,
                "enabled_rules": [k for k, v in getattr(self, "rules", {}).items() if v]}

    # ----------------------------------------------------------- decide
    def decide(self, seat_facts: Any) -> RuleDecision:
        decided_at = datetime.now()
        try:
            return self._decide(seat_facts, decided_at)
        except Exception as exc:                  # 판정 자체가 깨지면 FAILED
            log.exception("RuleEngine.decide 예외")
            return self._build(seat_facts, decided_at, A.UNKNOWN, 0.0,
                               A.STATUS_FAILED, reasons=[f"{type(exc).__name__}: {exc}"],
                               evidence={}, rule_hits=[], quality={})

    def _decide(self, sf: Any, decided_at: datetime) -> RuleDecision:
        # 1) 입력 없음 → SKIPPED
        if sf is None:
            return self._build(None, decided_at, A.UNKNOWN, 0.0, A.STATUS_SKIPPED,
                               reasons=["seat_facts 가 None"], evidence={},
                               rule_hits=[], quality={})

        quality = dict(getattr(sf, "quality", {}) or {})
        human = getattr(sf, "human", {}) or {}
        objects = getattr(sf, "objects", {}) or {}
        vision = getattr(sf, "vision", {}) or {}
        evidence = self._build_evidence(quality, human, objects)

        # 2) 품질 게이트 → UNKNOWN(LOW_CONFIDENCE)
        overall = _f(quality, "overall_quality")
        usable = quality.get("usable_for_rule_engine")
        min_q = self.thresholds["min_overall_quality"]
        if usable is False or overall < min_q:
            return self._build(sf, decided_at, A.UNKNOWN, 0.0, A.STATUS_LOW_CONFIDENCE,
                               reasons=[f"판정 재료 품질 부족(overall_quality={overall} < {min_q} "
                                        f"또는 usable_for_rule_engine=False)"],
                               evidence=evidence, rule_hits=[], quality=quality)

        # 3) 섹션이 너무 부족 → UNKNOWN(LOW_CONFIDENCE)
        if not human and not objects:
            return self._build(sf, decided_at, A.UNKNOWN, 0.0, A.STATUS_LOW_CONFIDENCE,
                               reasons=["human/objects 사실이 모두 비어 판정 불가"],
                               evidence=evidence, rule_hits=[], quality=quality)

        # 3.5) object-only guard (v0.4): 사람 신호는 없는데 유의미한 객체(phone/book/laptop/tablet)만
        #      검출되면 ABSENT 로 확정하지 않는다. person 이 프레임에서 일시적으로 미검출된 경우
        #      책상 위 물건만 보고 "자리비움"으로 오판하는 위험 케이스를 차단한다.
        #      → ABSENT 룰보다 먼저 적용되며 UNKNOWN(보류)으로 둔다.
        person_present = (_b(objects, "person_detected") or _b(human, "face_detected")
                          or _b(human, "pose_detected") or _b(human, "hands_detected"))
        meaningful_object = any(_b(objects, f"{k}_detected")
                                for k in ("phone", "book", "laptop", "tablet"))
        if not person_present and meaningful_object:
            labels = [k for k in ("phone", "book", "laptop", "tablet")
                      if _b(objects, f"{k}_detected")]
            rule_hits = [{"rule": "object_only_guard", "fired": True, "confidence": 0.0}]
            return self._build(sf, decided_at, A.UNKNOWN, 0.0, A.STATUS_SUCCESS,
                               reasons=[f"객체 감지됨({', '.join(labels)}) · 사람 미검출 "
                                        f"→ 자리비움 확정 보류(object-only, 사람 일시 미검출 가능)"],
                               evidence=evidence, rule_hits=rule_hits, quality=quality)

        # 4) 각 규칙 평가(enabled 만)
        candidates: List[Tuple[int, str, float, List[str]]] = []  # (priority, activity, conf, reasons)
        rule_hits: List[Dict[str, Any]] = []

        def _record(name: str, priority: int, activity: str,
                    res: Tuple[bool, float, List[str]]):
            fired, conf, reasons = res
            rule_hits.append({"rule": name, "fired": fired, "confidence": round(conf, 4)})
            if fired:
                candidates.append((priority, activity, conf, reasons))

        if self.rules.get("enable_absent_rule", True):
            _record("absent_rule", 1, A.ABSENT,
                    self._rule_absent(vision, human, objects, overall))
        if self.rules.get("enable_phone_rule", True):
            _record("phone_rule", 2, A.PHONE,
                    self._rule_phone(human, objects, quality))
        if self.rules.get("enable_sleeping_rule", True):
            _record("sleeping_rule", 3, A.SLEEPING,
                    self._rule_sleeping(human, objects))
        if self.rules.get("enable_studying_rule", True):
            _record("studying_rule", 4, A.STUDYING,
                    self._rule_studying(human, objects))

        # 5) 충돌 검사: 상위 두 후보 confidence 가 너무 가까우면 UNKNOWN
        if len(candidates) >= 2:
            by_conf = sorted(candidates, key=lambda c: c[2], reverse=True)
            if (by_conf[0][2] - by_conf[1][2]) < self.thresholds["conflict_margin"]:
                return self._build(sf, decided_at, A.UNKNOWN,
                                   round(by_conf[0][2], 4), A.STATUS_SUCCESS,
                                   reasons=[f"충돌 신호: {by_conf[0][1]}({round(by_conf[0][2],2)})"
                                            f" vs {by_conf[1][1]}({round(by_conf[1][2],2)})"],
                                   evidence=evidence, rule_hits=rule_hits, quality=quality)

        # 6) 발동 규칙이 있으면 우선순위(priority 작은 것) 선택
        if candidates:
            candidates.sort(key=lambda c: c[0])
            _, activity, conf, reasons = candidates[0]
            return self._build(sf, decided_at, activity, round(conf, 4),
                               A.STATUS_SUCCESS, reasons=reasons,
                               evidence=evidence, rule_hits=rule_hits, quality=quality)

        # 7) 아무 규칙도 발동 안 함 → 애매 → UNKNOWN(평가는 성공)
        return self._build(sf, decided_at, A.UNKNOWN, 0.0, A.STATUS_SUCCESS,
                           reasons=["뚜렷한 활동 신호 없음"],
                           evidence=evidence, rule_hits=rule_hits, quality=quality)

    # ----------------------------------------------------------- rules
    def _rule_absent(self, vision, human, objects, overall) -> Tuple[bool, float, List[str]]:
        """자리비움: 사람/얼굴/자세/손이 전부 안 보이고 프레임은 유효. 보수적."""
        person = _b(objects, "person_detected")
        face = _b(human, "face_detected")
        pose = _b(human, "pose_detected")
        hands = _b(human, "hands_detected")
        valid = _f(vision, "valid_frames")
        if person or face or pose or hands:
            return (False, 0.0, [])
        if valid <= 0:
            return (False, 0.0, [])
        # 천장 카메라 한계 고려 → confidence 를 임계 근처로만(무리하게 안 올림)
        conf = self.thresholds["absent_confidence"]
        reasons = ["사람/얼굴/자세/손이 모두 검출되지 않음",
                   f"유효 프레임 존재(valid_frames={int(valid)})",
                   "천장 카메라 한계로 보수적으로 판정"]
        return (conf >= self.thresholds["absent_confidence"], conf, reasons)

    def _rule_phone(self, human, objects, quality) -> Tuple[bool, float, List[str]]:
        """휴대폰: phone_detected + 손/책없음/사람 등 가중치. 단순 검출만으로 확정 안 함."""
        if not _b(objects, "phone_detected"):
            return (False, 0.0, [])
        w = self.weights
        hands_ratio = _f(human, "hands_visible_ratio")
        book = _b(objects, "book_detected")
        laptop = _b(objects, "laptop_detected")
        person = _b(objects, "person_detected") or _b(human, "pose_detected")
        object_q = _f(quality, "object_quality")

        conf = w["phone_object"]
        reasons = ["휴대폰 객체가 검출됨"]
        conf += w["hands_visible"] * max(0.0, min(1.0, hands_ratio))
        if hands_ratio > 0:
            reasons.append(f"손이 함께 검출됨(hands_visible_ratio={round(hands_ratio,2)})")
        if not book:
            conf += w["no_book"]; reasons.append("책 객체가 검출되지 않음")
        if not laptop:
            conf += w["no_laptop"]; reasons.append("노트북 객체가 검출되지 않음")
        if person:
            conf += w["person_present"]; reasons.append("사람/자세가 함께 검출됨")
        # 객체 검출 품질이 약하면 신뢰도 소폭 감쇠(보수)
        conf *= (0.85 + 0.15 * max(0.0, min(1.0, object_q)))
        conf = round(min(1.0, conf), 4)
        return (conf >= self.thresholds["phone_confidence"], conf, reasons)

    def _rule_sleeping(self, human, objects) -> Tuple[bool, float, List[str]]:
        """수면: 자세는 있으나 손/얼굴 가시성 매우 낮고 학습/휴대폰 신호 약함. 매우 보수적."""
        pose = _b(human, "pose_detected")
        person = _b(objects, "person_detected")
        if not pose:                              # motion score 없음 → 자세 없으면 판정 안 함
            return (False, 0.0, [])
        hands_ratio = _f(human, "hands_visible_ratio")
        face_ratio = _f(human, "face_visible_ratio")
        study = _b(objects, "book_detected") or _b(objects, "laptop_detected") \
            or _b(objects, "tablet_detected")
        phone = _b(objects, "phone_detected")
        if hands_ratio >= 0.2 or face_ratio >= 0.3 or study or phone:
            return (False, 0.0, [])

        conf = 0.3
        reasons = ["자세는 검출되나 손/얼굴 가시성이 매우 낮음"]
        if person:
            conf += 0.1; reasons.append("사람 객체가 함께 검출됨")
        conf += 0.3 if hands_ratio < 0.2 else 0.0
        conf += 0.2 if face_ratio < 0.3 else 0.0
        if not study:
            conf += 0.1; reasons.append("학습 도구 신호 없음")
        if not phone:
            reasons.append("휴대폰 신호 없음")
        reasons.append("motion score 부재 → 보수적으로 판정")
        # 수면은 강하게 판정하지 않는다 → 상한 적용
        conf = round(min(self.thresholds["sleeping_confidence_cap"], conf), 4)
        return (conf >= self.thresholds["sleeping_confidence"], conf, reasons)

    def _rule_studying(self, human, objects) -> Tuple[bool, float, List[str]]:
        """공부: 학습 도구 + **사람 존재** + **휴대폰 없음**. 오탐 방지를 우선(보수적).

        v0.4 정책(확정 조건):
          - person 존재(person_detected 또는 자세/얼굴)          → 없으면 STUDYING 아님
          - phone 미검출(phone_detected=False)                   → 있으면 STUDYING 확정 보류(PHONE 우선)
          - book / laptop / tablet 중 하나 이상 검출
        (person 있고 unknown_object 만 있는 경우는 study 도구가 없어 여기서 발동하지 않음 → UNKNOWN)
        """
        study = _b(objects, "book_detected") or _b(objects, "laptop_detected") \
            or _b(objects, "tablet_detected")
        if not study:
            return (False, 0.0, [])
        person = _b(objects, "person_detected") or _b(human, "pose_detected") \
            or _b(human, "face_detected")
        if not person:
            return (False, 0.0, [])            # 사람 없으면 STUDYING 아님(object-only)
        if _b(objects, "phone_detected"):
            return (False, 0.0, [])            # 휴대폰 있으면 STUDYING 확정 보류(오탐 방지)

        hands = _b(human, "hands_detected")
        pose = _b(human, "pose_detected")
        conf = 0.45
        reasons = ["책 또는 학습 도구가 검출됨", "사람이 함께 검출됨", "휴대폰 객체 없음"]
        if hands:
            conf += 0.20; reasons.append("손 특징이 함께 검출됨")
        if pose:
            conf += 0.20; reasons.append("자세 특징이 함께 검출됨")
        else:
            conf += 0.20                       # 사람 존재(위 person 게이트 통과) 보정
        conf = round(min(1.0, conf), 4)
        return (conf >= self.thresholds["studying_confidence"], conf, reasons)

    # ----------------------------------------------------------- helpers
    @staticmethod
    def _build_evidence(quality, human, objects) -> Dict[str, Any]:
        # 검출된 표준 라벨(정규화) — object_counts 에서 count>0 만
        object_counts = objects.get("object_counts", {}) or {}
        detected_labels = sorted(
            k for k, v in object_counts.items()
            if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0)
        return {
            "overall_quality": quality.get("overall_quality"),
            "vision_quality": quality.get("vision_quality"),
            "human_quality": quality.get("human_quality"),
            "object_quality": quality.get("object_quality"),
            "face_detected": human.get("face_detected"),
            "hands_detected": human.get("hands_detected"),
            "pose_detected": human.get("pose_detected"),
            "person_detected": objects.get("person_detected"),
            "phone_detected": objects.get("phone_detected"),
            "book_detected": objects.get("book_detected"),
            "laptop_detected": objects.get("laptop_detected"),
            "tablet_detected": objects.get("tablet_detected"),
            "max_person_count": objects.get("max_person_count"),
            "face_visible_ratio": human.get("face_visible_ratio"),
            "hands_visible_ratio": human.get("hands_visible_ratio"),
            "pose_visible_ratio": human.get("pose_visible_ratio"),
            # v0.4: object 세부(저장 payload/대시보드가 안정적으로 참조) — 수치/텍스트만
            "detected_labels": detected_labels,
            "normalized_labels": detected_labels,
            "person_count": objects.get("max_person_count"),
            "phone_count": objects.get("phone_detection_count"),
            "book_count": objects.get("book_detection_count"),
            "laptop_count": objects.get("laptop_detection_count"),
            "tablet_count": objects.get("tablet_detection_count"),
            "top_object_confidence": objects.get("max_detection_confidence"),
        }

    def _build(self, sf, decided_at, activity, confidence, status, reasons,
               evidence, rule_hits, quality) -> RuleDecision:
        self._decided += 1
        severity = A.ACTIVITY_SEVERITY.get(activity, A.SEVERITY_INFO)
        if status in (A.STATUS_SKIPPED, A.STATUS_FAILED, A.STATUS_LOW_CONFIDENCE):
            severity = A.SEVERITY_INFO            # 신뢰 못하는 판정은 INFO 로
        return RuleDecision(
            decision_uuid=uuid.uuid4().hex,
            facts_uuid=getattr(sf, "facts_uuid", None),
            burst_uuid=getattr(sf, "burst_uuid", None),
            seat_id=getattr(sf, "seat_id", None),
            period_id=getattr(sf, "period_id", None),
            period_name=getattr(sf, "period_name", None),
            decided_at=decided_at,
            activity=activity,
            confidence=confidence,
            status=status,
            severity=severity,
            reasons=reasons,
            evidence=evidence,
            rule_hits=rule_hits,
            quality=quality,
            metadata={
                "engine": self.name,
                "version": ENGINE_VERSION,
                "thresholds": dict(getattr(self, "thresholds", {})),
            },
        )


# ---------------------------------------------------------------- dict helpers
def _b(d: Dict[str, Any], k: str) -> bool:
    return bool(d.get(k)) if d else False


def _f(d: Dict[str, Any], k: str, default: float = 0.0) -> float:
    v = d.get(k) if d else None
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else default
