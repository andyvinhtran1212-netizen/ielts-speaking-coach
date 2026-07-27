#!/usr/bin/env python3
"""Chấm lại các bài nghe đã nộp bằng bộ chấm hiện tại.

Vì sao cần: đáp án câu "Choose TWO" của bộ đề Cambridge lưu CẢ CẶP vào từng
dòng ("A, D" ở cả Q17 lẫn Q18), trong khi trình làm bài lưu MỘT chữ cái mỗi
câu. Bộ chấm cũ so "a" với "a, d" nên không bao giờ khớp: mọi học viên chọn
đúng hai chữ cái vẫn bị tính sai cả hai câu. Trên C2-FINAL-20260726 là 0/14
học viên ở cả bốn câu Q17-20.

Bộ chấm đã được vá (services/listening_test_grader._expected_letters). Script
này chấm lại các bài ĐÃ NỘP để điểm đã lưu khớp với luật mới — không sửa dữ
liệu đề, không đổi status hay submitted_at.

    # xem thử, KHÔNG ghi (mặc định)
    venv/bin/python -m scripts.regrade_listening_attempts --exam C2-FINAL-20260726

    # ghi thật
    venv/bin/python -m scripts.regrade_listening_attempts --exam C2-FINAL-20260726 --commit

    # hoặc chỉ định thẳng attempt
    venv/bin/python -m scripts.regrade_listening_attempts --attempt <uuid> [--commit]

In ra bảng cũ→mới và CHỈ ghi những bài thật sự đổi điểm.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin            # noqa: E402
from services import listening_test_grader as grader  # noqa: E402
from services.mock_review_workflow import _merge_review_ai_draft  # noqa: E402

_ATTEMPT_COLS = "id,user_id,test_id,status,score,band_estimate,answers,sitting_id"


def _answer_key(test_id: str) -> list[dict]:
    """Rebuild the key exactly the way the submit route does — same tables,
    same order — so a regrade cannot diverge from a fresh submission."""
    sec = (supabase_admin.table("listening_content")
           .select("id").eq("test_id", test_id).execute())
    section_ids = [r["id"] for r in (sec.data or [])]
    if not section_ids:
        raise SystemExit(f"đề {test_id} thiếu section rows — dừng, không đoán")
    ex = (supabase_admin.table("listening_exercises")
          .select("payload").in_("content_id", section_ids).execute())
    return grader.collect_answer_key(ex.data or [])


def _attempts_for_exam(code: str) -> list[dict]:
    ex = (supabase_admin.table("mock_exams")
          .select("id,code").eq("code", code).limit(1).execute())
    if not ex.data:
        raise SystemExit(f"không thấy kỳ thi {code!r}")
    exam_id = ex.data[0]["id"]
    sit = (supabase_admin.table("mock_exam_sittings")
           .select("id").eq("mock_exam_id", exam_id).execute())
    sitting_ids = [r["id"] for r in (sit.data or [])]
    if not sitting_ids:
        return []
    at = (supabase_admin.table("listening_test_attempts")
          .select(_ATTEMPT_COLS).in_("sitting_id", sitting_ids)
          .eq("status", "submitted").execute())
    return at.data or []


def _attempts_for_test(code: str) -> list[dict]:
    """Every submitted attempt on one paper — including sittings of OTHER
    exams. Scoping by exam alone missed Lucas's retake, which sat the same
    paper under C2-FINAL-20260726-RETAKE-LUCAS and was mis-scored the same
    way (15 → 19, band 4.5 → 5.5)."""
    t = (supabase_admin.table("listening_tests")
         .select("id,test_id").eq("test_id", code).limit(1).execute())
    if not t.data:
        raise SystemExit(f"không thấy đề {code!r}")
    at = (supabase_admin.table("listening_test_attempts")
          .select(_ATTEMPT_COLS).eq("test_id", t.data[0]["id"])
          .eq("status", "submitted").execute())
    return at.data or []


def main() -> int:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--exam", help="mã kỳ thi, ví dụ C2-FINAL-20260726")
    g.add_argument("--test", help="mã đề, ví dụ ILR-LIS-CAM-B15-T4 — "
                                  "chấm MỌI bài trên đề đó, kể cả bài thi lại "
                                  "thuộc kỳ thi khác")
    g.add_argument("--attempt", help="một attempt_id cụ thể")
    ap.add_argument("--commit", action="store_true",
                    help="ghi thật (mặc định chỉ xem thử)")
    args = ap.parse_args()

    if args.attempt:
        r = (supabase_admin.table("listening_test_attempts")
             .select(_ATTEMPT_COLS).eq("id", args.attempt).limit(1).execute())
        attempts = r.data or []
    elif args.test:
        attempts = _attempts_for_test(args.test)
    else:
        attempts = _attempts_for_exam(args.exam)

    if not attempts:
        print("không có bài nào đã nộp — không làm gì.")
        return 0

    keys: dict[str, list[dict]] = {}
    changed, same, rows = [], 0, []

    for a in attempts:
        tid = a["test_id"]
        if tid not in keys:
            keys[tid] = _answer_key(tid)
        res = grader.grade_attempt(a.get("answers") or [], keys[tid])
        old_s, new_s = a.get("score"), res["score"]
        old_b, new_b = a.get("band_estimate"), res["band_estimate"]
        rows.append((a["id"], a["user_id"], old_s, new_s, old_b, new_b))
        if old_s == new_s and old_b == new_b:
            same += 1
        else:
            changed.append((a, res))

    print(f"{'attempt':10} {'học viên':10} {'điểm':>12}   {'band':>12}")
    for aid, uid, os_, ns, ob, nb in sorted(rows, key=lambda r: -( (r[3] or 0) - (r[2] or 0))):
        mark = "  ←" if (os_ != ns or ob != nb) else ""
        print(f"{aid[:8]:10} {uid[:8]:10} {str(os_):>5} → {str(ns):<5}  "
              f"{str(ob):>5} → {str(nb):<5}{mark}")
    print(f"\nđổi điểm: {len(changed)} · giữ nguyên: {same} · tổng: {len(rows)}")

    if not changed:
        return 0

    # Nói trước cái sẽ bị chạm tới, kể cả ở chế độ xem thử.
    fb_locked = []
    for a, _ in changed:
        if not a.get("sitting_id"):
            continue
        r = (supabase_admin.table("mock_exam_reviews")
             .select("final_bands").eq("sitting_id", a["sitting_id"])
             .limit(1).execute())
        if r.data and (r.data[0].get("final_bands") or {}).get("listening") is not None:
            fb_locked.append(a["id"][:8])
    print("\nsẽ ghi: điểm bài làm + làm mới ai_draft.listening của bản duyệt "
          "(final_bands do giám khảo nhập KHÔNG bị đụng)")
    if fb_locked:
        print(f"  ⚠ {len(fb_locked)} bản đã có final_bands.listening — "
              f"nháp được làm mới nhưng con số đã ký vẫn giữ: {', '.join(fb_locked)}")

    if not args.commit:
        print("\n(chỉ xem thử — thêm --commit để ghi)")
        return 0

    for a, res in changed:
        # status + submitted_at giữ nguyên: đây là chấm lại, không phải nộp lại.
        (supabase_admin.table("listening_test_attempts")
         .update({"score": res["score"],
                  "grading_details": res["per_question"],
                  "trap_analytics": res["trap_analytics"],
                  "band_estimate": res["band_estimate"]})
         .eq("id", a["id"]).execute())
        note = ""
        # KHÔNG bỏ bước này. mock_exam_reviews.ai_draft là bản CHỤP, ghi một lần
        # lúc tạo review và create_review() idempotent nên không bao giờ ghi lại.
        # Màn "Duyệt bài thi" điền sẵn từ ai_draft khi chưa có final_bands, nên
        # nếu chỉ sửa attempt thì giám khảo vẫn nhìn thấy — và ký — điểm cũ.
        # Chỉ vá khoá `listening`: reading/writing trong nháp có thể đã được
        # cập nhật bởi luồng khác, ghi đè cả cụm là phá việc của người khác.
        if a.get("sitting_id"):
            _merge_review_ai_draft(a["sitting_id"], {
                "listening": {"raw": res["score"], "band": res["band_estimate"]},
            })
            note = " + đã làm mới nháp duyệt bài"
        print(f"đã ghi {a['id'][:8]}  {a.get('score')} → {res['score']}{note}")
    print(f"\nxong: đã cập nhật {len(changed)} bài.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
