"""
Solomon AI Decision Storage v0.1 - CLI 데모
===========================================

Fake SeatFacts → RuleEngine → RuleDecision → (선택)Supabase 저장.

**기본은 --save-disabled** 로 안전하게 동작한다(직렬화 결과만 출력).
실제 저장은 사용자가 **--save** 를 명시했을 때만 시도한다(SUPABASE_URL/SERVICE_ROLE_KEY 필요).

⚠️ 저장까지만 한다. Dashboard/알림/학생 상태 변경은 하지 않는다.

실행 예시:
  python decision_storage_demo.py --fake --save-disabled   # 저장 없이 직렬화만(기본)
  python decision_storage_demo.py --fake --save            # 실제 Supabase 저장 시도
"""

from __future__ import annotations

import argparse
import json
import logging
import sys

from rule_engine import RuleEngine
from decision_serializer import serialize_decision
from ai_decision_repository import AIDecisionRepository
from ai_decision_storage_pipeline import AIDecisionStoragePipeline
from rule_demo import studying_facts, phone_facts, absent_facts


def setup_logging():
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        datefmt="%H:%M:%S")


def parse_args():
    p = argparse.ArgumentParser(description="Solomon AI Decision Storage v0.1 데모")
    p.add_argument("--fake", action="store_true", default=True,
                   help="Fake SeatFacts 사용(기본)")
    save = p.add_mutually_exclusive_group()
    save.add_argument("--save", action="store_true", help="실제 Supabase 저장 시도")
    save.add_argument("--save-disabled", action="store_true",
                      help="저장 없이 직렬화 결과만 출력(기본)")
    p.add_argument("--activity", choices=["studying", "phone", "absent"],
                   default="studying", help="데모용 fake SeatFacts 종류")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    setup_logging()
    do_save = bool(args.save)               # 기본 False(=save-disabled)

    sf = {"studying": studying_facts, "phone": phone_facts,
          "absent": absent_facts}[args.activity]()

    # 판정 + 직렬화 미리보기(저장 여부와 무관하게 항상 표시)
    eng = RuleEngine(); eng.initialize()
    decision = eng.decide(sf)
    payload = serialize_decision(decision)
    print("===== RuleDecision (직렬화 미리보기) =====")
    print(json.dumps(payload, ensure_ascii=False, indent=2))

    # 저장 단계
    repo = AIDecisionRepository() if do_save else None
    pipeline = AIDecisionStoragePipeline(rule_engine=eng, repository=repo,
                                         save_enabled=do_save)
    if do_save:
        try:
            pipeline.initialize()
        except Exception as exc:
            print(f"\n[!] Supabase 초기화 실패(환경변수/패키지 확인): {exc}")
            return 1
    result = pipeline.process(sf)

    print("\n===== Pipeline 결과 =====")
    print(f"  success={result['success']} saved={result['saved']} "
          f"activity={result['activity']} error={result['error']}")
    if not do_save:
        print("  (--save-disabled) Supabase 저장 생략 — 위 직렬화 결과만 표시")
    return 0


if __name__ == "__main__":
    sys.exit(main())
