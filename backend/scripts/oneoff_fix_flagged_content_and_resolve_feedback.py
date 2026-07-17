"""One-off: fix 2 flagged reading answer keys + resolve all 9 pending user_feedback.

Run:  cd /Users/trantrongvinh/code/ielts-speaking-coach/backend && \
      venv/bin/python "/private/tmp/claude-501/-Users-trantrongvinh-code-ielts-speaking-coach/b230275e-e451-46a8-b4e8-ee435008ca68/scratchpad/fix_flagged_content_and_resolve_feedback.py"
"""
import os, sys, json
from datetime import datetime, timezone

BACKEND = "/Users/trantrongvinh/code/ielts-speaking-coach/backend"
os.chdir(BACKEND)
sys.path.insert(0, BACKEND)

from database import supabase_admin  # noqa: E402

ADMIN = "8837217b-740f-4220-b4f5-697afdea198d"  # andyvinhtran1212@gmail.com
now = datetime.now(timezone.utc).isoformat()

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
}).eq("status", "new").execute().data
print("resolved feedback:", len(r3))
