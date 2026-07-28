#!/usr/bin/env python3
"""Sửa band Writing đã duyệt cho một danh sách bài cụ thể (rà soát tay).

Dùng sau khi giám khảo rà lại nội dung và chốt điểm khác với bản nháp AI. Band
nằm ở BA chỗ và phải đi cùng nhau, nếu không hai nguồn sẽ chọi nhau:

  1. cột `writing_feedback.band_*` / `overall_band_score`  (dùng để truy vấn)
  2. `feedback_json.criteriaFeedback.*.bandScore` + `.overallBandScore` (màn hình đọc)
  3. `feedback_json.bandTrajectoryAnalysis.current_band`  (khối "tiến độ")

Chỉ sửa bản `composed` (bản của giám khảo). Bản AI giữ nguyên bất biến để còn
đối chiếu về sau.

Sau khi ghi, gọi sync_writing_band_for_essay() để bản nháp Duyệt bài thi
(ai_draft.writing) được tính lại theo đúng công thức (T1 + 2×T2)/3 — cùng hàm
mà luồng duyệt thật dùng, không tự chép lại công thức.

    venv/bin/python -m scripts.adjust_writing_bands              # xem thử
    venv/bin/python -m scripts.adjust_writing_bands --commit     # ghi thật
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin                                   # noqa: E402
from services.mock_review_workflow import (                           # noqa: E402
    ielts_round, sync_writing_band_for_essay,
)

EXAM = "C2-FINAL-20260726"

# (mã học viên, task) → band mới cho từng tiêu chí + lý do.
# main = Task Achievement (T1) / Task Response (T2).
ADJUSTMENTS: dict[tuple[str, str], dict] = {
    ("3043d578", "Task 1"): {
        "lr": 5, "gra": 5,
        "why": "Cùng lỗi đọc '%' thay cho số lượng phim như 158e3126 (được 5.5), "
               "cộng phần tổng quan tự mâu thuẫn ('five countries showed an upward "
               "trend, excepted the USA, India and Japan'). LR/GRA 6 không đứng "
               "vững khi bài tương đương chỉ được 5.",
    },
    ("3043d578", "Task 2"): {
        "lr": 4, "gra": 4,
        "why": "245 từ. Nhiều đoạn không truyền đạt được nghĩa ('want to do "
               "housework by their parents', 'help you by heart'); đoạn nhược điểm "
               "lập luận ngược câu chủ đề của chính nó.",
    },
    ("53e10a5b", "Task 2"): {
        "main": 4, "gra": 4,
        "why": "205 từ, có ký tự hỏng giữa bài. Ý nhược điểm lạc đề hoàn toàn "
               "('lack deep cultural knowledge in the other city'). Lỗi ngữ pháp "
               "CẢN TRỞ nghĩa chứ không chỉ gây khó chịu.",
    },
    ("a1942b42", "Task 1"): {
        "cc": 6,
        "why": "NÂNG. Có tổng quan hợp lệ đủ hai đặc điểm, số liệu đúng, chia đoạn "
               "theo năm với từ nối rõ ràng — trong khi hai bài tổ chức lỏng hơn "
               "(53e10a5b, 158e3126) đều được CC 6.",
    },
    ("7afe922d", "Task 2"): {
        "gra": 5,
        "why": "Vài câu không có mệnh đề chính ('Without a high cost of living…, "
               "enabling young adults to save money'). CHỈ hạ GRA — ý tưởng triển "
               "khai tốt nên TR/CC 7 giữ nguyên. Trung bình 6.25 vẫn làm tròn 6.5, "
               "nên band tổng KHÔNG đổi.",
    },
}

_COLS = {"main": "band_main_criterion", "cc": "band_coherence_cohesion",
         "lr": "band_lexical_resource", "gra": "band_grammatical_range"}
_JSON_KEYS = {"main": "mainCriterion", "cc": "coherenceCohesion",
              "lr": "lexicalResource", "gra": "grammaticalRange"}


def _targets() -> list[dict]:
    ex = supabase_admin.table("mock_exams").select("id").eq("code", EXAM).execute()
    if not ex.data:
        raise SystemExit(f"không thấy kỳ thi {EXAM}")
    sit = (supabase_admin.table("mock_exam_sittings")
           .select("user_id,essay_task1_id,essay_task2_id")
           .eq("mock_exam_id", ex.data[0]["id"]).execute().data or [])
    out = []
    for s in sit:
        for label, key in (("Task 1", "essay_task1_id"), ("Task 2", "essay_task2_id")):
            k = (s["user_id"][:8], label)
            if k in ADJUSTMENTS and s.get(key):
                out.append({"user": k[0], "task": label,
                            "essay_id": s[key], **ADJUSTMENTS[k]})
    missing = set(ADJUSTMENTS) - {(o["user"], o["task"]) for o in out}
    if missing:
        raise SystemExit(f"không khớp được bài nào cho: {sorted(missing)}")
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--commit", action="store_true", help="ghi thật (mặc định xem thử)")
    args = ap.parse_args()

    plan = []
    for t in _targets():
        r = (supabase_admin.table("writing_feedback")
             .select("id,version,overall_band_score,band_main_criterion,"
                     "band_coherence_cohesion,band_lexical_resource,"
                     "band_grammatical_range,feedback_json")
             .eq("essay_id", t["essay_id"]).eq("source", "composed")
             .limit(1).execute()).data
        if not r:
            raise SystemExit(f"{t['user']} {t['task']}: không có bản composed — "
                             f"giám khảo chưa duyệt bài này, dừng lại")
        row = r[0]
        now = {k: row[c] for k, c in _COLS.items()}
        new = dict(now) | {k: v for k, v in t.items() if k in _COLS}
        old_overall = float(row["overall_band_score"])
        new_overall = ielts_round(sum(float(v) for v in new.values()) / 4.0)
        plan.append({**t, "row": row, "now": now, "new": new,
                     "old_overall": old_overall, "new_overall": new_overall})

    for p in plan:
        ch = [f"{k.upper()} {p['now'][k]}→{p['new'][k]}"
              for k in _COLS if p["now"][k] != p["new"][k]]
        arrow = (f"{p['old_overall']} → {p['new_overall']}"
                 if p["old_overall"] != p["new_overall"] else
                 f"{p['old_overall']} (không đổi)")
        print(f"\n{p['user']} · {p['task']}   overall {arrow}")
        print(f"   {', '.join(ch)}")
        print(f"   lý do: {p['why']}")
        # Văn bản nhận xét có nêu số band cũ thì KHÔNG tự sửa — đó là lời của
        # giám khảo gửi học viên, sửa máy móc dễ thành câu vô nghĩa.
        prose = json.dumps({k: v for k, v in p["row"]["feedback_json"].items()
                            if k not in ("criteriaFeedback",)}, ensure_ascii=False)
        old_s = f"{p['old_overall']:.1f}"
        if p["old_overall"] != p["new_overall"] and re.search(
                rf"(?<![\d.]){re.escape(old_s)}(?![\d])", prose):
            print(f"   ⚠ lời nhận xét có nhắc số {old_s} — cần anh sửa tay câu chữ")

    if not args.commit:
        print("\n(chỉ xem thử — thêm --commit để ghi)")
        return 0

    for p in plan:
        fj = dict(p["row"]["feedback_json"])
        crit = dict(fj.get("criteriaFeedback") or {})
        for k, jk in _JSON_KEYS.items():
            if jk in crit and p["now"][k] != p["new"][k]:
                crit[jk] = dict(crit[jk]) | {"bandScore": p["new"][k]}
        fj["criteriaFeedback"] = crit
        fj["overallBandScore"] = p["new_overall"]
        if isinstance(fj.get("bandTrajectoryAnalysis"), dict):
            fj["bandTrajectoryAnalysis"] = dict(fj["bandTrajectoryAnalysis"]) | {
                "current_band": p["new_overall"]}
        (supabase_admin.table("writing_feedback")
         .update({**{_COLS[k]: p["new"][k] for k in _COLS},
                  "overall_band_score": p["new_overall"],
                  "feedback_json": fj})
         .eq("id", p["row"]["id"]).execute())
        sync_writing_band_for_essay(p["essay_id"])
        print(f"đã ghi {p['user']} {p['task']}: {p['old_overall']} → {p['new_overall']}"
              f" + đồng bộ nháp duyệt bài")
    print(f"\nxong: {len(plan)} bài.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
