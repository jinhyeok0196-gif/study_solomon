# Solomon Rule Engine v0.1 — 리뷰 / 복붙용 문서

> **한 줄 요약**: `SeatFacts` 를 받아 학생 상태를 **1차 판정**해 `RuleDecision` 을 만든다.
> **이 단계에서 처음으로 `activity` 가 UNKNOWN 이 아닌 값**(STUDYING/PHONE/SLEEPING/ABSENT)이 나온다.
> **AI 분석기가 아니라 규칙 판정기**(AIEngine 비상속). 임계값은 `config/rules.yaml` 에서 읽는다.
> **판정 결과 생성까지만** — Supabase/Dashboard/학생 상태 변경/알림은 절대 하지 않는다.
> 합성 SeatFacts 로 **11개 테스트 전부 통과**.

---

## 1. 전체 프로젝트 트리

```
rtsp-poc/
├── config/
│   ├── roi.yaml / mediapipe.yaml / yolo.yaml      # (기존) 엔진별 설정
│   └── rules.yaml                                 # ★신규 Rule 임계값/가중치/토글
├── plugins/ dummy_engine.py / opencv_engine.py / mediapipe_engine.py / yolo_engine.py  # (기존)
│
├── ai_engine.py / ai_manager.py / analysis_result.py / burst_package.py / engine_registry.py  # (기존)
├── vision_result.py / vision_utils.py                                  # (기존) OpenCV
├── mediapipe_result.py / mediapipe_backend.py                          # (기존) MediaPipe
├── object_detection_result.py / object_label_mapper.py / yolo_backend.py  # (기존) YOLO
├── seat_facts.py / fusion_result.py / facts_fusion_engine.py           # (기존) Fusion
│
├── activity_labels.py           # ★신규 표준 activity/status/severity 라벨
├── rule_decision.py             # ★신규 RuleDecision (1차 판정 결과, 순수 데이터)
├── rule_engine.py               # ★신규 RuleEngine (SeatFacts → RuleDecision)
├── rule_demo.py                 # ★신규 CLI 데모 (--studying/--phone/--absent/--sleeping/--unknown)
├── test_rule_engine.py          # ★신규 Rule 엔진 테스트 (11개)
│
├── *_demo.py / manage.py / main.py                                     # (기존) 실행/데모
├── test_*.py (camera/scheduler/orchestrator/ai/vision/mediapipe/yolo/facts_fusion)
│
├── cameras.yaml / schedule.yaml / .gitignore
└── README.md                    # ✎수정 Rule Engine v0.1 절 추가
```

★ = 신규, ✎ = 수정. (engine_registry/.gitignore 무수정 — Rule Engine 은 AIEngine 도 모델도 아님.)

---

## 2. 신규 파일 전체 코드

### 2-1. `activity_labels.py`

```python
"""
Activity Labels
===============

Rule Engine 이 판정하는 **표준 activity** 와 판정 **status / severity** 라벨 정의.

표준 activity:
  STUDYING / PHONE / SLEEPING / ABSENT / UNKNOWN

판정 status:
  SUCCESS / SKIPPED / FAILED / LOW_CONFIDENCE

severity:
  INFO / WATCH / WARNING / CRITICAL

⚠️ 매우 중요: **파워냅(power nap)은 AI activity 가 아니다.**
파워냅은 학생이 직접 누르는 **수동 상태**로 유지한다. Rule Engine 은 파워냅을 판정하지 않는다.
(SLEEPING 은 "수면으로 보이는 관측" 일 뿐, 파워냅이라는 권리/상태와 다르다.)

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 상수).
"""

from __future__ import annotations

# ----- 표준 activity -----
STUDYING = "STUDYING"
PHONE = "PHONE"
SLEEPING = "SLEEPING"
ABSENT = "ABSENT"
UNKNOWN = "UNKNOWN"

ACTIVITIES = [STUDYING, PHONE, SLEEPING, ABSENT, UNKNOWN]

# ----- 판정 status -----
STATUS_SUCCESS = "SUCCESS"            # 정상 판정(활동이 UNKNOWN 이어도 평가는 성공)
STATUS_SKIPPED = "SKIPPED"            # 입력 없음(seat_facts None)
STATUS_FAILED = "FAILED"             # 판정 중 예외
STATUS_LOW_CONFIDENCE = "LOW_CONFIDENCE"  # 품질 부족/근거 부족으로 신뢰 불가

# ----- severity -----
SEVERITY_INFO = "INFO"
SEVERITY_WATCH = "WATCH"
SEVERITY_WARNING = "WARNING"
SEVERITY_CRITICAL = "CRITICAL"

# activity → severity 기본 매핑(v0.1, 보수적)
ACTIVITY_SEVERITY = {
    STUDYING: SEVERITY_INFO,
    PHONE: SEVERITY_WARNING,
    SLEEPING: SEVERITY_WATCH,
    ABSENT: SEVERITY_WARNING,
    UNKNOWN: SEVERITY_INFO,
}
```

### 2-2. `rule_decision.py`

```python
"""
RuleDecision
============

Rule Engine 이 SeatFacts 를 보고 내린 **1차 판정 결과**.

이번 단계(v0.1)에서 처음으로 activity 가 UNKNOWN 이 아닌 값이 나올 수 있다.
단, 이것은 **판정 결과 데이터일 뿐** — 저장/표시/학생 상태 변경/알림은 하지 않는다.

이 모듈은 외부 라이브러리에 의존하지 않는다(순수 데이터).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional


@dataclass
class RuleDecision:
    decision_uuid: str
    facts_uuid: Optional[str]
    burst_uuid: Optional[str]
    seat_id: Optional[str]
    period_id: Optional[str]
    period_name: Optional[str]
    decided_at: datetime

    activity: str                    # STUDYING / PHONE / SLEEPING / ABSENT / UNKNOWN
    confidence: float                # 0.0 ~ 1.0
    status: str                      # SUCCESS / SKIPPED / FAILED / LOW_CONFIDENCE
    severity: str                    # INFO / WATCH / WARNING / CRITICAL

    reasons: List[str] = field(default_factory=list)     # 사람이 읽는 판정 이유
    evidence: Dict[str, Any] = field(default_factory=dict)  # 판정에 쓴 주요 SeatFacts 값
    rule_hits: List[Dict[str, Any]] = field(default_factory=list)  # 발동/평가된 규칙
    quality: Dict[str, Any] = field(default_factory=dict)   # SeatFacts.quality 복사

    metadata: Dict[str, Any] = field(default_factory=dict)  # trace, engine version, thresholds

    # ------------------------------------------------------------------ helpers
    def summary(self) -> Dict[str, Any]:
        return {
            "decision_uuid": self.decision_uuid,
            "facts_uuid": self.facts_uuid,
            "seat_id": self.seat_id,
            "activity": self.activity,
            "confidence": self.confidence,
            "status": self.status,
            "severity": self.severity,
            "reasons": list(self.reasons),
            "rule_hits": list(self.rule_hits),
        }
```

### 2-3. `config/rules.yaml`

```yaml
# =========================================================================
# Rule Engine v0.1 설정
# =========================================================================
# SeatFacts → RuleDecision 판정에 쓰는 임계값/가중치/규칙 토글.
# 임계값은 코드에 하드코딩하지 않고 여기서 읽는다.
#
# ⚠️ v0.1 은 보수적으로 판정한다. 천장 카메라에서는 사람/얼굴 검출이 실패할 수 있어
#    confidence 를 무리하게 높이지 않는다. 측면 카메라 실데이터 확보 전까지 보수 운영.
# =========================================================================

thresholds:
  min_overall_quality: 0.3        # 이 미만이면 UNKNOWN(LOW_CONFIDENCE)
  phone_confidence: 0.65          # PHONE 확정 최소 confidence
  studying_confidence: 0.6        # STUDYING 확정 최소 confidence
  absent_confidence: 0.7          # ABSENT 확정 최소 confidence
  sleeping_confidence: 0.6        # SLEEPING 확정 최소 confidence
  conflict_margin: 0.15           # 상위 두 후보 confidence 차가 이보다 작으면 충돌→UNKNOWN
  sleeping_confidence_cap: 0.75   # 수면은 motion score 없음 → 신뢰도 상한(보수)

# PHONE 가중치(합 = 1.0). phone_detected 일 때만 적용.
weights:
  phone_object: 0.45              # 휴대폰 객체 검출 자체
  hands_visible: 0.20             # 손이 함께 보이면(× hands_visible_ratio)
  no_book: 0.15                   # 책이 없으면(공부 도구 아님)
  no_laptop: 0.10                 # 노트북이 없으면
  person_present: 0.10            # 사람/자세가 보이면

rules:
  enable_phone_rule: true
  enable_studying_rule: true
  enable_absent_rule: true
  enable_sleeping_rule: true
```

### 2-4. `rule_engine.py`

```python
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
        """공부: 학습 도구 + 사람/손/자세 + 휴대폰 약함. 책 보였다고 무조건 확정 안 함."""
        study = _b(objects, "book_detected") or _b(objects, "laptop_detected") \
            or _b(objects, "tablet_detected")
        if not study:
            return (False, 0.0, [])
        hands = _b(human, "hands_detected")
        pose = _b(human, "pose_detected")
        person = _b(objects, "person_detected")
        phone = _b(objects, "phone_detected")

        conf = 0.45
        reasons = ["책 또는 학습 도구가 검출됨"]
        if hands:
            conf += 0.20; reasons.append("손 특징이 함께 검출됨")
        if pose or person:
            conf += 0.20; reasons.append("사람/자세 특징이 함께 검출됨")
        if not phone:
            conf += 0.15; reasons.append("휴대폰 객체 신호가 약함")
        conf = round(min(1.0, conf), 4)
        return (conf >= self.thresholds["studying_confidence"], conf, reasons)

    # ----------------------------------------------------------- helpers
    @staticmethod
    def _build_evidence(quality, human, objects) -> Dict[str, Any]:
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
```

### 2-5. `rule_demo.py`

```python
"""
Solomon Rule Engine v0.1 - CLI 데모
===================================

Fake SeatFacts 를 만들어 RuleEngine.decide() 결과(RuleDecision)를 출력한다.
**저장/표시/학생 상태 변경/알림은 하지 않는다** — 판정 결과 생성까지만.

실행 예시:
  python rule_demo.py --studying
  python rule_demo.py --phone
  python rule_demo.py --absent
  python rule_demo.py --sleeping
  python rule_demo.py --unknown
"""

from __future__ import annotations

import argparse
import logging
import sys
import uuid
from datetime import datetime

from seat_facts import SeatFacts
from rule_engine import RuleEngine


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def _facts(human, objects, quality, vision=None, seat="Seat1") -> SeatFacts:
    now = datetime.now()
    return SeatFacts(
        facts_uuid=uuid.uuid4().hex, burst_uuid="demo-burst", seat_id=seat,
        period_id="P0", period_name="0교시", captured_at=now, generated_at=now,
        vision=vision or {"valid_frames": 5, "resolution": "320x240"},
        human=human, objects=objects, quality=quality,
        source_results=["o", "m", "y"], metadata={},
    )


def studying_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.8, "hands_detected": True,
               "hands_visible_ratio": 0.7, "pose_detected": True, "pose_visible_ratio": 0.9},
        objects={"phone_detected": False, "book_detected": True, "book_detection_count": 3,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.9, "object_quality": 0.7,
                 "overall_quality": 0.8667, "usable_for_rule_engine": True})


def phone_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.6, "hands_detected": True,
               "hands_visible_ratio": 0.8, "pose_detected": True, "pose_visible_ratio": 0.8},
        objects={"phone_detected": True, "phone_detection_count": 3, "book_detected": False,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.8, "object_quality": 0.85,
                 "overall_quality": 0.8833, "usable_for_rule_engine": True})


def absent_facts():
    return _facts(
        human={"face_detected": False, "face_visible_ratio": 0.0, "hands_detected": False,
               "hands_visible_ratio": 0.0, "pose_detected": False, "pose_visible_ratio": 0.0},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": False, "max_person_count": 0},
        quality={"vision_quality": 1.0, "human_quality": 0.0, "object_quality": 0.0,
                 "overall_quality": 0.3333, "usable_for_rule_engine": True},
        vision={"valid_frames": 5, "resolution": "320x240"})


def sleeping_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.1, "hands_detected": False,
               "hands_visible_ratio": 0.05, "pose_detected": True, "pose_visible_ratio": 0.7},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.6, "object_quality": 0.2,
                 "overall_quality": 0.6, "usable_for_rule_engine": True})


def unknown_facts():
    return _facts(
        human={"face_detected": False, "hands_detected": False, "pose_detected": False},
        objects={"phone_detected": False, "person_detected": False},
        quality={"vision_quality": 0.0, "human_quality": 0.1, "object_quality": 0.1,
                 "overall_quality": 0.0667, "usable_for_rule_engine": False})


def parse_args():
    p = argparse.ArgumentParser(description="Solomon Rule Engine v0.1 데모")
    m = p.add_mutually_exclusive_group()
    m.add_argument("--studying", action="store_true")
    m.add_argument("--phone", action="store_true")
    m.add_argument("--absent", action="store_true")
    m.add_argument("--sleeping", action="store_true")
    m.add_argument("--unknown", action="store_true")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging()

    if args.phone:
        sf = phone_facts()
    elif args.absent:
        sf = absent_facts()
    elif args.sleeping:
        sf = sleeping_facts()
    elif args.unknown:
        sf = unknown_facts()
    else:  # --studying (기본)
        sf = studying_facts()

    eng = RuleEngine()
    eng.initialize()
    d = eng.decide(sf)

    print("===== RuleDecision =====")
    print(f"  seat={d.seat_id} activity={d.activity} confidence={d.confidence} "
          f"status={d.status} severity={d.severity}")
    print(f"  reasons={d.reasons}")
    print(f"  rule_hits={d.rule_hits}")
    print(f"  evidence={d.evidence}")
    eng.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

### 2-6. `test_rule_engine.py`

```python
"""
Rule Engine v0.1 테스트.

SeatFacts(합성) → RuleEngine.decide() → RuleDecision 검증.

검증:
  - 공부 후보 → STUDYING
  - 휴대폰 후보 → PHONE
  - 자리비움 후보 → ABSENT
  - 수면 후보 → SLEEPING (보수 정책)
  - 품질 낮음 → UNKNOWN / LOW_CONFIDENCE
  - seat_facts None → SKIPPED
  - 충돌 신호 → UNKNOWN
  - RuleDecision 필드 생성
  - evidence / reasons / rule_hits 기록
  - 파워냅 activity 가 표준 activity 에 없음
  - config 임계값 사용(임계 낮추면 판정 바뀜)
  - 기존 FactsFusionEngine 테스트가 깨지지 않음
"""
import uuid
from datetime import datetime

import activity_labels as A
from seat_facts import SeatFacts
from rule_decision import RuleDecision
from rule_engine import RuleEngine


# ---- 합성 SeatFacts 빌더 --------------------------------------------------
def _facts(human, objects, quality, vision=None, seat="Seat1"):
    now = datetime.now()
    return SeatFacts(
        facts_uuid=uuid.uuid4().hex, burst_uuid="b1", seat_id=seat,
        period_id="P0", period_name="0교시", captured_at=now, generated_at=now,
        vision=vision or {"valid_frames": 5, "resolution": "320x240"},
        human=human, objects=objects, quality=quality,
        source_results=["o", "m", "y"], metadata={})


def studying_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.8, "hands_detected": True,
               "hands_visible_ratio": 0.7, "pose_detected": True, "pose_visible_ratio": 0.9},
        objects={"phone_detected": False, "book_detected": True, "book_detection_count": 3,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.9, "object_quality": 0.7,
                 "overall_quality": 0.8667, "usable_for_rule_engine": True})


def phone_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.6, "hands_detected": True,
               "hands_visible_ratio": 0.8, "pose_detected": True, "pose_visible_ratio": 0.8},
        objects={"phone_detected": True, "phone_detection_count": 3, "book_detected": False,
                 "laptop_detected": False, "tablet_detected": False,
                 "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.8, "object_quality": 0.85,
                 "overall_quality": 0.8833, "usable_for_rule_engine": True})


def absent_facts():
    return _facts(
        human={"face_detected": False, "face_visible_ratio": 0.0, "hands_detected": False,
               "hands_visible_ratio": 0.0, "pose_detected": False, "pose_visible_ratio": 0.0},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": False, "max_person_count": 0},
        quality={"vision_quality": 1.0, "human_quality": 0.0, "object_quality": 0.0,
                 "overall_quality": 0.3333, "usable_for_rule_engine": True},
        vision={"valid_frames": 5})


def sleeping_facts():
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.1, "hands_detected": False,
               "hands_visible_ratio": 0.05, "pose_detected": True, "pose_visible_ratio": 0.7},
        objects={"phone_detected": False, "book_detected": False, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.6, "object_quality": 0.2,
                 "overall_quality": 0.6, "usable_for_rule_engine": True})


def low_quality_facts():
    return _facts(
        human={"face_detected": False, "hands_detected": False, "pose_detected": False},
        objects={"phone_detected": False, "person_detected": False},
        quality={"vision_quality": 0.0, "human_quality": 0.1, "object_quality": 0.1,
                 "overall_quality": 0.0667, "usable_for_rule_engine": False})


def conflict_facts():
    # phone 과 studying 이 둘 다 강하게 발동(confidence 가 매우 가까움) → 충돌
    return _facts(
        human={"face_detected": True, "face_visible_ratio": 0.6, "hands_detected": True,
               "hands_visible_ratio": 0.9, "pose_detected": True, "pose_visible_ratio": 0.8},
        objects={"phone_detected": True, "book_detected": True, "laptop_detected": False,
                 "tablet_detected": False, "person_detected": True, "max_person_count": 1},
        quality={"vision_quality": 1.0, "human_quality": 0.8, "object_quality": 0.8,
                 "overall_quality": 0.8667, "usable_for_rule_engine": True})


def make_engine(config=None):
    eng = RuleEngine(config=config)
    eng.initialize()
    return eng


# ---- 테스트 ---------------------------------------------------------------
def test_studying():
    d = make_engine().decide(studying_facts())
    assert d.activity == A.STUDYING, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert d.confidence >= 0.6
    assert any("학습 도구" in r or "책" in r for r in d.reasons)
    assert d.severity == A.SEVERITY_INFO
    print("PASS studying: 학습도구+사람/손 → STUDYING")


def test_phone():
    d = make_engine().decide(phone_facts())
    assert d.activity == A.PHONE, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert d.confidence >= 0.65
    assert any("휴대폰" in r for r in d.reasons)
    assert d.severity == A.SEVERITY_WARNING
    print("PASS phone: 휴대폰+손+책없음 → PHONE")


def test_absent():
    d = make_engine().decide(absent_facts())
    assert d.activity == A.ABSENT, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert any("검출되지 않음" in r for r in d.reasons)
    print("PASS absent: 사람/얼굴/자세/손 모두 미검출 → ABSENT")


def test_sleeping():
    d = make_engine().decide(sleeping_facts())
    # v0.1 보수 정책: SLEEPING 또는 (애매하면)UNKNOWN 허용
    assert d.activity in (A.SLEEPING, A.UNKNOWN), d.activity
    if d.activity == A.SLEEPING:
        assert d.confidence <= 0.75, "수면 confidence 상한(보수)"
    print(f"PASS sleeping: 자세O/손·얼굴 가시성 낮음 → {d.activity}(보수)")


def test_low_quality_unknown():
    d = make_engine().decide(low_quality_facts())
    assert d.activity == A.UNKNOWN
    assert d.status == A.STATUS_LOW_CONFIDENCE
    assert d.confidence == 0.0
    print("PASS low_quality: 품질 낮음 → UNKNOWN/LOW_CONFIDENCE")


def test_none_skipped():
    d = make_engine().decide(None)
    assert d.activity == A.UNKNOWN
    assert d.status == A.STATUS_SKIPPED
    assert isinstance(d, RuleDecision)
    print("PASS none: seat_facts None → SKIPPED")


def test_conflict_unknown():
    d = make_engine().decide(conflict_facts())
    assert d.activity == A.UNKNOWN, d.activity
    assert d.status == A.STATUS_SUCCESS
    assert any("충돌" in r for r in d.reasons)
    print("PASS conflict: phone vs studying 충돌 → UNKNOWN")


def test_decision_fields_and_records():
    d = make_engine().decide(studying_facts())
    # 필드 존재
    assert d.decision_uuid and d.facts_uuid and d.seat_id == "Seat1"
    assert d.period_id == "P0" and d.decided_at is not None
    # evidence 필수 키
    for k in ("overall_quality", "face_detected", "phone_detected",
              "hands_visible_ratio", "max_person_count"):
        assert k in d.evidence, k
    # reasons / rule_hits / quality 기록
    assert d.reasons and isinstance(d.rule_hits, list) and d.rule_hits
    assert d.quality.get("overall_quality") == 0.8667
    assert any(h["rule"] == "studying_rule" and h["fired"] for h in d.rule_hits)
    print("PASS fields: decision 필드 + evidence/reasons/rule_hits/quality 기록")


def test_no_powernap_activity():
    # 파워냅은 AI activity 가 아니다(수동 상태). 표준 activity 에 없어야 한다.
    for forbidden in ("POWERNAP", "POWER_NAP", "NAP", "파워냅"):
        assert forbidden not in A.ACTIVITIES
    assert set(A.ACTIVITIES) == {A.STUDYING, A.PHONE, A.SLEEPING, A.ABSENT, A.UNKNOWN}
    print("PASS no_powernap: 파워냅 activity 없음(수동 상태로 유지)")


def test_config_thresholds_used():
    # 임계값을 도달 불가(>1.0)로 높이면 STUDYING 후보도 확정 안 됨 → UNKNOWN
    cfg = {"thresholds": {"min_overall_quality": 0.3, "studying_confidence": 1.01,
                          "phone_confidence": 1.01, "absent_confidence": 1.01,
                          "sleeping_confidence": 1.01, "conflict_margin": 0.15,
                          "sleeping_confidence_cap": 0.75}}
    d = make_engine(config=cfg).decide(studying_facts())
    assert d.activity == A.UNKNOWN, d.activity
    # rule 은 평가됐지만(fired=False) 확정 안 됨
    assert any(h["rule"] == "studying_rule" for h in d.rule_hits)
    print("PASS config: 임계값을 config 에서 읽어 판정에 반영")


def test_fusion_engine_intact():
    # 기존 FactsFusionEngine 테스트가 깨지지 않는지(임포트/기본 동작) 확인
    from facts_fusion_engine import FactsFusionEngine
    from fusion_result import FUSION_SKIPPED
    fe = FactsFusionEngine(); fe.initialize()
    fr = fe.fuse([])
    assert fr.status == FUSION_SKIPPED
    print("PASS intact: FactsFusionEngine 동작 유지")


def main():
    test_studying()
    test_phone()
    test_absent()
    test_sleeping()
    test_low_quality_unknown()
    test_none_skipped()
    test_conflict_unknown()
    test_decision_fields_and_records()
    test_no_powernap_activity()
    test_config_thresholds_used()
    test_fusion_engine_intact()
    print("\nALL PASS: studying / phone / absent / sleeping / low_quality / none / "
          "conflict / fields / no_powernap / config / intact")


if __name__ == "__main__":
    main()
```

---

## 3. 수정된 파일 전체 코드 (변경 부분)

### 3-1. `README.md` — 추가/변경 요약
- 헤더 모듈 목록에 **Rule Engine v0.1** 줄 추가, 범위 경고를 "RuleDecision 은 데이터일 뿐 저장·표시 안 함" 으로 갱신.
- 파일 구조 표에 `activity_labels.py / rule_decision.py / config/rules.yaml / rule_engine.py /
  rule_demo.py / test_rule_engine.py` 6행 추가.
- **"## Rule Engine v0.1"** 절 신규: 흐름 / activity·severity / 판정 우선순위 / 보수성(천장 카메라 한계) /
  설정 / 실행 / 테스트 / 다음 단계 연결.

> 코드 파일은 이번 단계에서 **변경 없음**(Rule Engine 은 AIEngine 도 모델도 아니라 registry/.gitignore 무수정).
> SeatFacts 의 `vision/human/objects/quality` 스키마를 **읽기만** 한다(Fusion/엔진 역방향 의존 없음).

---

## 4. Rule Engine 구조도

```
                        ┌──────────────────────────────┐
                        │   SeatFacts (Fusion 산출물)    │
                        │  vision / human / objects /   │
                        │  quality / source_results     │
                        └───────────────┬───────────────┘
                                        ▼
                          RuleEngine.decide()
                                        │
        ┌───────────────────────────────┼───────────────────────────────┐
        │  1) None → SKIPPED                                             │
        │  2) usable_for_rule_engine False / overall<min → LOW_CONFIDENCE│
        │  3) human·objects 둘 다 비면 → LOW_CONFIDENCE                  │
        └───────────────────────────────┬───────────────────────────────┘
                                        ▼ (품질 통과)
        ┌───────────────────────────────────────────────────────────────┐
        │   규칙 평가(enabled 만, 각각 fired/confidence/reasons 산출)    │
        │   ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌────────────┐      │
        │   │absent(1) │ │phone(2)  │ │sleeping(3)│ │studying(4) │      │
        │   │전부 미검출│ │가중치 합 │ │보수+상한  │ │도구+사람   │      │
        │   └──────────┘ └──────────┘ └───────────┘ └────────────┘      │
        └───────────────────────────────┬───────────────────────────────┘
                                        ▼
            5) 상위 두 후보 confidence 차 < conflict_margin → UNKNOWN(충돌)
            6) 발동 규칙 중 priority(작은 값) 우선 선택
            7) 아무 것도 발동 안 함 → UNKNOWN(애매)
                                        ▼
                        ┌──────────────────────────────┐
                        │         RuleDecision         │
                        │ activity / confidence /      │
                        │ status / severity / reasons /│
                        │ evidence / rule_hits / quality│
                        └──────────────┬───────────────┘
                                        ▼
            (다음 단계) 저장/표시 파이프라인 → (그 이후) 상태변경/알림 검토
```

**핵심 설계 원칙**
- **규칙 판정기(AI 아님)**: SeatFacts dict 만 읽어 결정론적으로 판정. cv2/AI 의존 0.
- **config 주도**: 모든 임계값/가중치/토글을 `config/rules.yaml` 에서 읽음(하드코딩 금지).
- **보수성**: 단일 신호로 확정 금지(휴대폰 객체 ≠ PHONE 확정), 천장 카메라 한계 반영, 수면 상한.
- **설명가능성**: 모든 판정에 `reasons`(사람이 읽음) + `rule_hits`(어떤 규칙이 발동/평가) + `evidence`.

---

## 5. RuleDecision 설명

| 필드 | 의미 |
|------|------|
| `decision_uuid` | 판정 1건 고유 id |
| `facts_uuid` / `burst_uuid` / `seat_id` / `period_id` / `period_name` | 입력 SeatFacts 식별자 복사 |
| `decided_at` | 판정 시각 |
| `activity` | STUDYING / PHONE / SLEEPING / ABSENT / UNKNOWN |
| `confidence` | 0~1, 선택된 규칙의 가중치 합산 점수 |
| `status` | SUCCESS / SKIPPED(입력 None) / FAILED(예외) / LOW_CONFIDENCE(품질·근거 부족) |
| `severity` | INFO / WATCH / WARNING / CRITICAL (신뢰 못하면 INFO) |
| `reasons` | 사람이 읽는 판정 이유 리스트 |
| `evidence` | 판정에 쓴 주요 SeatFacts 값(품질/검출 플래그/가시 비율 등) |
| `rule_hits` | 각 규칙의 `{rule, fired, confidence}` 기록 |
| `quality` | SeatFacts.quality 복사 |
| `metadata` | engine/version/thresholds(trace) |

> RuleDecision 은 **아직 화면에 보이지 않는 데이터**다. 저장/표시/상태 변경/알림은 다음 단계 이후.

---

## 6. Activity Label 설명

| activity | 정의(관측 기반, v0.1 보수) | severity |
|----------|---------------------------|----------|
| `STUDYING` | 책/노트북/태블릿 + 사람/손/자세, 휴대폰 약함 | INFO |
| `PHONE` | 휴대폰 객체 + (손/사람) + 책·노트북 없음(가중치 합산) | WARNING |
| `SLEEPING` | 자세는 있으나 손·얼굴 가시성 매우 낮음(상한 0.75) | WATCH |
| `ABSENT` | 사람/얼굴/자세/손 전부 미검출 + 유효 프레임 존재 | WARNING |
| `UNKNOWN` | 품질 부족/근거 부족/신호 충돌/애매 | INFO |

판정 status: `SUCCESS / SKIPPED / FAILED / LOW_CONFIDENCE`.

> ⚠️ **파워냅은 AI activity 가 아니다.** 학생이 직접 누르는 **수동 상태**로 유지하며 Rule Engine 은
> 파워냅을 판정하지 않는다. `ACTIVITIES` 에 파워냅이 없음을 테스트로 강제(`test_no_powernap_activity`).

---

## 7. 판정 규칙 설명

**우선순위**: 품질게이트 → ABSENT(1) → PHONE(2) → SLEEPING(3) → STUDYING(4) → 충돌/애매 UNKNOWN.

- **ABSENT** — person/face/pose/hands 가 **모두 False** 이고 `valid_frames>0`. 천장 카메라 한계로
  confidence 를 `absent_confidence`(0.7) 근처로만(무리하게 안 올림).
- **PHONE** — `phone_detected` 필수. 그 위에 가중치 합산:
  `phone_object(.45) + hands_visible(.20×hands_ratio) + no_book(.15) + no_laptop(.10) + person_present(.10)`,
  객체 품질로 소폭 감쇠(`×(0.85+0.15·object_quality)`). `phone_confidence`(0.65) 이상이면 확정.
  → 휴대폰만 보였다고 확정하지 않음(책/손/사람을 함께 봄).
- **SLEEPING** — `pose_detected` 필수(motion score 없으면 자세 없이는 판정 안 함). 손·얼굴 가시성
  매우 낮고(<0.2, <0.3) 학습/휴대폰 신호 없을 때만. confidence 는 `sleeping_confidence_cap`(0.75) 상한.
- **STUDYING** — 책/노트북/태블릿 중 하나 필수. `+ hands(.20) + pose|person(.20) + no_phone(.15)`,
  base 0.45. `studying_confidence`(0.6) 이상이면 확정. → 책만 보였다고 확정하지 않음.
- **충돌** — 발동 후보가 둘 이상이고 상위 둘의 confidence 차가 `conflict_margin`(0.15) 미만이면 UNKNOWN.

**예시 결과(데모)**
```
--studying → STUDYING (conf 1.0,    INFO)
--phone    → PHONE    (conf 0.9384, WARNING)
--absent   → ABSENT   (conf 0.7,    WARNING)
--sleeping → SLEEPING (conf 0.75,   WATCH)
--unknown  → UNKNOWN  (conf 0.0,    LOW_CONFIDENCE)
```

---

## 8. 테스트 결과

`python test_rule_engine.py` (cv2/mediapipe/ultralytics **없이** 실행):

```
PASS studying: 학습도구+사람/손 → STUDYING
PASS phone: 휴대폰+손+책없음 → PHONE
PASS absent: 사람/얼굴/자세/손 모두 미검출 → ABSENT
PASS sleeping: 자세O/손·얼굴 가시성 낮음 → SLEEPING(보수)
PASS low_quality: 품질 낮음 → UNKNOWN/LOW_CONFIDENCE
PASS none: seat_facts None → SKIPPED
PASS conflict: phone vs studying 충돌 → UNKNOWN
PASS fields: decision 필드 + evidence/reasons/rule_hits/quality 기록
PASS no_powernap: 파워냅 activity 없음(수동 상태로 유지)
PASS config: 임계값을 config 에서 읽어 판정에 반영
PASS intact: FactsFusionEngine 동작 유지

ALL PASS: studying / phone / absent / sleeping / low_quality / none / conflict /
          fields / no_powernap / config / intact
```

**회귀 확인**
- 새 모듈 import 시 `cv2`/`mediapipe`/`ultralytics` 미로드.
- `test_facts_fusion_engine.py` / `test_mediapipe_engine.py` / `test_yolo_engine.py` PASS 유지.
- `engine_registry.available_engines()` → `['dummy', 'mediapipe', 'opencv', 'yolo']`(Rule 은 비등록, 변동 없음).

---

## 9. 남은 기술부채

1. **phone_score 미전파**: Fusion 의 objects 섹션이 라벨별 `phone_score` 를 안 넘겨 PHONE 규칙이
   `object_quality`(YOLO 전체 품질)를 대용으로 쓴다. 라벨별 신뢰도 전파가 더 정확.
2. **천장 카메라 한계**: 사람/얼굴 검출 실패가 잦아 ABSENT/SLEEPING 신뢰가 낮다. **측면 카메라 실데이터**로 재보정 필요.
3. **motion score 부재**: 수면을 영상 시계열 움직임 없이 단일 스냅샷으로만 본다 → 보수적일 수밖에 없음.
4. **우선순위 vs confidence**: 충돌이 아니면 confidence 가 더 높아도 **우선순위**가 이긴다(PHONE>STUDYING).
   상황에 따라 과도하게 PHONE 으로 기울 수 있음(정책 재검토 여지).
5. **시계열/맥락 미반영**: 한 Burst 단일 판정. "교시 내 지속" 같은 누적 판단 없음.
6. **severity 고정 매핑**: activity→severity 가 코드 상수. 교시/지속/반복에 따른 동적 severity 없음.
7. **규칙 단순화**: 가중치/임계 휴리스틱이라 실데이터 기반 학습/튜닝 전. 좌석·조명·자세 다양성 미검증.

---

## 10. v0.2 개선계획

1. **Fusion 보강 연동**: objects 에 라벨별 score(phone_score 등) 전파 → PHONE 규칙 정밀화.
2. **측면 카메라 실데이터 보정**: 실제 좌석 영상으로 임계값/가중치 재튜닝, ABSENT/SLEEPING 신뢰도 상향 검토.
3. **시계열 규칙**: 연속 Burst/교시 단위 누적(지속·반복)으로 1회성 오탐 완화, 동적 severity.
4. **motion/표정 특징 추가**: MediaPipe 시계열 움직임·눈 개폐(EAR) 등 원시 특징을 Fusion→Rule 로 전달해 수면 정밀화.
5. **충돌/우선순위 정책 개선**: confidence 우위 + 우선순위 하이브리드, 충돌 시 후보 동시 보고.
6. **판정 영속화 파이프라인 설계 착수**: RuleDecision 저장/조회(아직 Dashboard·상태변경·알림은 제외) — 화면에 "보이게" 하는 첫 단계.
7. **룰 설명/감사 강화**: rule_hits 에 각 규칙 입력값까지 기록해 오탐 디버깅·튜닝 근거 확보.

> v0.1 범위 재확인: **판정 결과 생성(RuleDecision)까지만.**
> Supabase 저장 / Dashboard / 학생 상태 변경 / 알림 / 벌점·출결·이용권은 다음 단계 이후.
