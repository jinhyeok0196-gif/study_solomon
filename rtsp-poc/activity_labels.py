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
