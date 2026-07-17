"""One-off (ĐÃ CHẠY 2026-07-17): fix 2 answer key reading bị flag + resolve
đúng 9 user_feedback thuộc đợt audit 2026-07-17. Idempotent — chạy lại vô hại.

Run:  cd backend && venv/bin/python scripts/oneoff_fix_flagged_content_and_resolve_feedback.py
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = str(Path(__file__).resolve().parents[1])
os.chdir(BACKEND)  # config.py đọc .env theo cwd
sys.path.insert(0, BACKEND)

from database import supabase_admin  # noqa: E402

ADMIN = "8837217b-740f-4220-b4f5-697afdea198d"  # andyvinhtran1212@gmail.com
now = datetime.now(timezone.utc).isoformat()

# 9 feedback CỤ THỂ của đợt audit 2026-07-17 — không đụng feedback đến sau.
AUDITED_FEEDBACK_IDS = [
    "600b245a-a52a-48c4-acec-a513b26e1532",  # rating listening ILR-X
    "31c0766d-f3b8-4886-823f-e1736c45f65e",  # rating listening FND-LESSON-L01
    "21e626ac-1e34-4729-be5c-8e761edc04c5",  # flag reading L01 q2
    "e28b3378-b103-4f7d-a136-550d0940af61",  # flag reading L09 q11
    "c2f26dbe-4c6f-413c-a6e1-8ddbe0bb0fb6",  # report reading L09 q11
    "e404a861-4f6c-4023-94c3-a3859f2fa83a",  # rating drill FORM-L1-T1
    "408dd6bb-c1e8-4438-88df-32d5b2e4f632",  # rating drill FORM-L1-T1
    "56580495-280a-4456-97df-5709f92aeb9d",  # rating drill NOTE-L1-T1
    "d7c92b5d-86c3-4d0d-87dd-45141ef0e79a",  # rating drill FORM-L1-T1
]

# ---- Fix 1: ILR-RDG-LSN-L01 q2 — answer key "(small) workshops" -> "workshops" ----
r1 = supabase_admin.table("reading_questions").update({
    "answer": {"answer": "workshops", "alternatives": ["small workshops"]},
    "updated_at": now,
}).eq("id", "6b4d7782-8a9d-433f-8000-491eefcc9027").execute().data
print("fix L01 q2:", json.dumps(r1[0]["answer"], ensure_ascii=False) if r1 else "FAILED")

# ---- Fix 2: ILR-RDG-LSN-L09 q11 — reword to ONE type so answer fits 3-word limit ----
sol = {
    "band": 5.0,
    "steps": "(1) Quét \"Singapore / require\" ở đoạn D. (2) Keyword: \"Singapore now requires green roofs or vertical gardens\". (3) Đề chỉ yêu cầu MỘT loại — chọn \"green roofs\" hoặc \"vertical gardens\". (4) Chốt.",
    "vocab": [
        "`structure` = cấu trúc (n)",
        "`commercial building` = tòa nhà thương mại",
        "`require` = yêu cầu (v).",
    ],
    "paraphrase": "stem \"one type of structure Singapore now requires\" ↔ passage \"Singapore now requires green roofs or vertical gardens\" (ghi một trong hai đều được chấp nhận).",
    "skill_code": "SCAN",
    "skill_name": "Định vị thông tin",
    "trap_analysis": "Đoạn văn nêu HAI loại (green roofs, vertical gardens) nhưng đề chỉ yêu cầu MỘT. Ghi cả hai (\"green roofs, vertical gardens\" = 4 từ) sẽ vượt giới hạn NO MORE THAN THREE WORDS — chỉ cần một cụm 2 từ là đủ.",
    "source_excerpt": "\"Singapore now requires green roofs or vertical gardens on most new commercial buildings above a certain height.\"",
}
r2 = supabase_admin.table("reading_questions").update({
    "prompt": "Name ONE type of structure that Singapore now requires on most tall commercial buildings.",
    "answer": {"answer": "green roofs", "alternatives": [
        "vertical gardens", "green roof", "a green roof", "vertical garden", "a vertical garden"
    ]},
    "payload": {"solution": sol},
    "updated_at": now,
}).eq("id", "df33372d-ab58-4e67-9590-dc59f49698fb").execute().data
print("fix L09 q11:", json.dumps({"prompt": r2[0]["prompt"], "answer": r2[0]["answer"]}, ensure_ascii=False) if r2 else "FAILED")

# ---- Resolve all pending feedback ----
r3 = supabase_admin.table("user_feedback").update({
    "status": "resolved", "resolved_at": now, "resolved_by": ADMIN,
}).in_("id", AUDITED_FEEDBACK_IDS).eq("status", "new").execute().data
print("resolved feedback:", len(r3))
