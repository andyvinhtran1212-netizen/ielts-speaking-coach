#!/usr/bin/env python3
"""Chấm lại những lượt nộp tự luận mà bộ chấm đã hỏng hoàn toàn.

Lượt nộp tự luận chỉ có MỘT. Khi bộ chấm hỏng, dòng vẫn được ghi với mọi câu
"chưa chấm được" — bài còn nguyên nhưng lượt đã tiêu. Ngày 06/08 model
`gemini-2.5-flash-lite` bị ngừng cấp và NĂM học viên mất lượt duy nhất.

Chấm lại từ chính CÂU ĐÃ LƯU, không nhận nội dung mới.

    cd backend && venv/bin/python scripts/regrade_failed_course_writing.py
    cd backend && venv/bin/python scripts/regrade_failed_course_writing.py --commit
"""
import argparse
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import main                                        # noqa: E402,F401  (cấu hình SDK)
from database import supabase_admin as db          # noqa: E402
from services import quiz_service as qs            # noqa: E402


async def run(commit: bool) -> int:
    plan = await qs.regrade_failed_course_writing(db, commit=commit)
    names = {s["user_id"]: s.get("full_name") for s in
             (db.table("students").select("user_id, full_name").execute().data) or []}
    print(f"{'đã chấm lại' if commit else 'CHẠY THỬ — sẽ chấm lại'} {len(plan)} lượt nộp\n")
    for p in plan:
        who = names.get(p["user_id"]) or p["user_id"]
        state = "chấm được" if p["fixed"] else "VẪN HỎNG"
        print(f"  {who[:26]:26} {p['clean']:2}/{p['total']} câu sạch · {p['model']} · {state}")
    if not commit and plan:
        print("\nChưa ghi gì. Thêm --commit để ghi thật.")
    return 0


def main_() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="ghi thật (mặc định: chạy thử)")
    return asyncio.run(run(ap.parse_args().commit))


if __name__ == "__main__":
    raise SystemExit(main_())
