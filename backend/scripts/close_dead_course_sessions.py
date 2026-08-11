#!/usr/bin/env python3
"""Đóng sổ những phiên bài-tập-theo-buổi đã chết.

Một phiên bỏ giữa chừng có `ended_at` NULL, nên nó không phải bản ghi mà cũng
chẳng ai đang làm — nó không hiện ở đâu cả. Học viên đọc chuyện ấy thành "web
không ghi lại việc em đã làm lại mấy chặng".

CHẠY THỬ trước (mặc định), đọc xem nó định làm gì:

    cd backend && venv/bin/python scripts/close_dead_course_sessions.py

Rồi mới cho ghi:

    cd backend && venv/bin/python scripts/close_dead_course_sessions.py --commit

Chỉ đóng phiên đủ CẢ HAI điều kiện: lặng ≥ 120 phút tính từ lượt làm CUỐI, VÀ
đã có phiên khác của cùng mục bắt đầu sau nó. Phiên em ấy có thể vẫn đang làm
thì không đụng tới.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from database import supabase_admin as db          # noqa: E402
from services import quiz_service as qs            # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="ghi thật (mặc định: chạy thử)")
    ap.add_argument("--idle-minutes", type=int, default=120)
    a = ap.parse_args()

    plan = qs.close_dead_course_sessions(db, idle_minutes=a.idle_minutes,
                                         commit=a.commit)
    names = {s["user_id"]: s.get("full_name") for s in
             (db.table("students").select("user_id, full_name").execute().data) or []}
    verb = "đã đóng sổ" if a.commit else "CHẠY THỬ — sẽ đóng sổ"
    print(f"{verb} {len(plan)} phiên\n")
    per: dict[str, list[int]] = {}
    for r in plan:
        who = names.get(r["user_id"]) or r["user_id"]
        acc = per.setdefault(who, [0, 0])
        acc[0] += 1
        acc[1] += r["total_questions"]
    for who, (n, q) in sorted(per.items(), key=lambda x: -x[1][1]):
        print(f"  {who[:28]:28} {n:3} phiên · {q:4} câu được ghi lại")
    print(f"\ntổng câu: {sum(r['total_questions'] for r in plan)}")
    if not a.commit and plan:
        print("\nChưa ghi gì. Thêm --commit để ghi thật.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
