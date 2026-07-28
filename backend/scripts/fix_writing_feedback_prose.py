#!/usr/bin/env python3
"""Viết lại lời nhận xét cho các bài Writing vừa đổi band (C2-FINAL-20260726).

Đi kèm scripts/adjust_writing_bands.py. Script kia sửa CON SỐ; script này sửa
CÂU CHỮ — tách làm hai vì con số thì máy đổi được, còn lời gửi học viên thì
phải viết tay, sửa máy móc dễ thành câu vô nghĩa.

Hai thứ phải sửa:

  1. Câu nêu band cũ ("đạt band 5.0", "tăng ... lên 6.0") → nay sai số.
  2. Câu đổ lỗi cho ĐỘ DÀI trong khi nội dung tự nó đã dưới mức trần. Bốn học
     viên đã nhận câu "điểm bị giới hạn ở mức 5.0 vì bài dưới 250 từ" cho những
     bài vốn không tới 5.0 — nói vậy là chỉ sai chỗ cần sửa cho các em.

KHÔNG đụng bài 7afe922d: band tổng không đổi và lời nhận xét đã nêu sẵn "lỗi
viết câu chưa hoàn chỉnh" — đúng lý do GRA bị hạ.

    venv/bin/python -m scripts.fix_writing_feedback_prose            # xem thử
    venv/bin/python -m scripts.fix_writing_feedback_prose --commit   # ghi thật
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from database import supabase_admin  # noqa: E402

EXAM = "C2-FINAL-20260726"

# (mã học viên, task) → các trường cần thay. `summary` = overallBandScoreSummary;
# `trend_explanation` nằm trong bandTrajectoryAnalysis.
PROSE: dict[tuple[str, str], dict] = {
    ("53e10a5b", "Task 2"): {
        "summary": (
            "Bài viết của em có bố cục hai mặt rõ ràng, nhưng điểm còn thấp vì hai "
            "lý do tách biệt nhau. Thứ nhất, bài chỉ dài 205 từ, chưa đạt mức tối "
            "thiểu 250 từ. Thứ hai — và đây mới là điều quan trọng hơn — phần nhược "
            "điểm chưa bám vào câu hỏi: ý \"thiếu hiểu biết văn hoá ở thành phố "
            "khác\" không liên quan đến việc sống cùng bố mẹ, nên đề bài mới chỉ "
            "được trả lời một phần. Bên cạnh đó, nhiều lỗi ngữ pháp khiến người đọc "
            "hiểu sai ý em chứ không chỉ gây khó chịu (\"adults was received "
            "immediately supporting by their family\"). Việc cần làm trước tiên là "
            "chọn ý bám sát câu hỏi, và viết câu đơn cho thật chắc."
        ),
    },
    ("3043d578", "Task 1"): {
        "summary": (
            "Bài viết của em có bố cục tốt và dùng được một số từ vựng mô tả xu "
            "hướng phù hợp. Tuy nhiên có hai điểm kéo band xuống. Một là đọc sai "
            "đơn vị của biểu đồ — em dùng % trong khi trục là SỐ LƯỢNG phim — và "
            "lỗi này lặp lại ở gần như mọi số liệu. Hai là phần tổng quan tự mâu "
            "thuẫn: em viết năm nước đều tăng rồi lại trừ ra ba nước. Từ vựng và "
            "cấu trúc câu cũng còn nhiều lỗi lặp lại (\"excepted\", thiếu dấu cách "
            "sau dấu chấm). Em cần dành một phút đọc kỹ trục và chú thích biểu đồ "
            "trước khi viết."
        ),
        "trend_explanation": (
            "Em có tiến bộ so với mức trung bình 5.3, đạt 5.5 ở bài này. Mức tăng "
            "chưa nhiều vì lỗi đọc sai đơn vị biểu đồ và các lỗi từ vựng, ngữ pháp "
            "vẫn còn dày."
        ),
    },
    ("3043d578", "Task 2"): {
        "summary": (
            "Bài của em dài 245 từ, chưa đạt mức tối thiểu 250 từ — nhưng đó không "
            "phải lý do chính khiến band ở mức 4.5. Điều đáng lo hơn là nhiều đoạn "
            "chưa truyền đạt được nghĩa (\"some people want to do housework by their "
            "parents\", \"their parents will help you by heart\"), và đoạn nhược "
            "điểm lại lập luận ngược với chính câu chủ đề của nó. Khi người đọc "
            "thường xuyên không hiểu ý, các tiêu chí còn lại cũng bị kéo theo. Em "
            "hãy viết câu ngắn và đúng trước đã, rồi mới nối ý dài."
        ),
        "trend_explanation": (
            "Bài này đạt 4.5, thấp hơn mức trung bình gần đây là 5.3. Nguyên nhân "
            "chủ yếu nằm ở việc diễn đạt chưa rõ nghĩa, chứ không phải ở ý tưởng — "
            "nền tảng chung của em vẫn đang cải thiện."
        ),
    },
    ("a1942b42", "Task 1"): {
        "summary": (
            "Bài viết của em có tổng quan hợp lệ với đủ hai đặc điểm chính, và bố "
            "cục theo từng năm rất rõ ràng nhờ các từ nối mạch lạc — đây là điểm "
            "mạnh thật sự, và là lý do tiêu chí Coherence and Cohesion được nâng "
            "lên 6.0. Band chung 5.5 còn bị giữ lại bởi lỗi cấu trúc câu, đặc biệt "
            "là các câu phân mảnh bắt đầu bằng \"While\", cùng một chỗ liệt kê bốn "
            "nước nhưng chỉ nêu ba số liệu (thiếu số của Ấn Độ). Em khắc phục lỗi "
            "câu phân mảnh trước, rồi hãy viết câu phức dài hơn."
        ),
        "trend_explanation": (
            "Điểm của em ở bài này là 5.5, thấp hơn mức trung bình gần đây 6.2. "
            "Phần tổ chức bài vẫn tốt; chỗ cần bù lại là lỗi câu phân mảnh và việc "
            "kiểm tra số liệu trước khi nộp."
        ),
    },
}


def _current_version(essay_id: str) -> int:
    r = (supabase_admin.table("writing_essays").select("current_version")
         .eq("id", essay_id).limit(1).execute()).data
    if not r or not r[0].get("current_version"):
        raise SystemExit(f"essay {essay_id}: không đọc được current_version")
    return r[0]["current_version"]


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
            if k in PROSE and s.get(key):
                out.append({"user": k[0], "task": label, "essay_id": s[key], **PROSE[k]})
    keys = [(o["user"], o["task"]) for o in out]
    dup = {k for k in keys if keys.count(k) > 1}
    if dup:
        raise SystemExit(f"tiền tố user khớp NHIỀU lượt thi (retake/void/va chạm): {sorted(dup)} — dừng, không đoán")
    missing = set(PROSE) - {(o["user"], o["task"]) for o in out}
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
             .select("id,overall_band_score,feedback_json")
             .eq("essay_id", t["essay_id"]).eq("source", "composed")
             .eq("version", _current_version(t["essay_id"]))
             .limit(1).execute()).data
        if not r:
            raise SystemExit(f"{t['user']} {t['task']}: không có bản composed")
        plan.append({**t, "row": r[0]})

    for p in plan:
        fj = p["row"]["feedback_json"]
        band = p["row"]["overall_band_score"]
        print(f"\n{'='*74}\n{p['user']} · {p['task']} · band {band}")
        print("── overallBandScoreSummary:\n   CŨ: "
              + (fj.get("overallBandScoreSummary") or "—")[:160] + "…")
        print("   MỚI: " + p["summary"][:160] + "…")
        if "trend_explanation" in p:
            bt = fj.get("bandTrajectoryAnalysis") or {}
            print("── trend_explanation:\n   CŨ: " + (bt.get("trend_explanation") or "—")[:160] + "…")
            print("   MỚI: " + p["trend_explanation"][:160] + "…")

    if not args.commit:
        print("\n(chỉ xem thử — thêm --commit để ghi)")
        return 0

    for p in plan:
        fj = dict(p["row"]["feedback_json"])
        fj["overallBandScoreSummary"] = p["summary"]
        if "trend_explanation" in p and isinstance(fj.get("bandTrajectoryAnalysis"), dict):
            fj["bandTrajectoryAnalysis"] = dict(fj["bandTrajectoryAnalysis"]) | {
                "trend_explanation": p["trend_explanation"]}
        (supabase_admin.table("writing_feedback")
         .update({"feedback_json": fj}).eq("id", p["row"]["id"]).execute())
        print(f"đã ghi {p['user']} {p['task']}")
    print(f"\nxong: {len(plan)} bài.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
