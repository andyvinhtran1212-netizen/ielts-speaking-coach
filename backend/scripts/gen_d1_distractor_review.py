#!/usr/bin/env python3
"""gen_d1_distractor_review.py — semantic distractor review for D1 (audit #7 vocab).

The form gate + d1_quality catch structural defects; they can't tell whether a
distractor is SEMANTICALLY good — same part of speech, clearly wrong in context
(not a second right answer), and not trivially easy. This is the adversarial
LLM-judge pass, mirroring gen_reading_solutions / gen_quiz_why_wrong.

Per exercise: run the pure d1_quality gate, then ask Gemini to judge each
distractor. Writes a REVIEW report (never edits live rows); a human spot-checks
the flagged items and fixes/retires them in the admin tool.

    export GEMINI_API_KEY=...
    python -m scripts.gen_d1_distractor_review --source db --status draft --out drafts/d1-review.yaml
    python -m scripts.gen_d1_distractor_review --file exercises.json --out r.yaml   # offline set
    python -m scripts.gen_d1_distractor_review --file exercises.json --dry-run      # gate only, no LLM

Costs 1 LLM call per exercise. --dry-run runs only the structural gate (free).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.d1_quality import validate_d1_quality  # noqa: E402


_JUDGE_PROMPT = """\
Bạn là người phản biện gắt gao cho bài tập điền từ (fill-in-the-blank) tiếng Anh.
Cho một câu có chỗ trống '___', đáp án đúng, và các phương án nhiễu (distractor).
Đánh giá TỪNG distractor theo 3 tiêu chí:
  1. same_pos: cùng từ loại với đáp án?
  2. clearly_wrong: rõ ràng SAI trong ngữ cảnh (KHÔNG phải một đáp án đúng thứ hai)?
  3. not_trivial: không quá dễ (không phải từ loại hiển nhiên khác → đoán ngay)?

CÂU: {sentence}
ĐÁP ÁN ĐÚNG: {answer}
DISTRACTORS: {distractors}

Trả JSON: {{"ok": true|false, "verdicts": [{{"distractor": "...", "same_pos": bool,
"clearly_wrong": bool, "not_trivial": bool, "note": "..."}}]}}.
ok=false nếu BẤT KỲ distractor nào không đạt cả 3 (đặc biệt: cũng điền được vào chỗ
trống = mơ hồ, hoặc khác từ loại hiển nhiên = quá dễ).
"""


def _extract_json(text: str):
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        return json.loads(text[a:b + 1])
    except json.JSONDecodeError:
        return None


def _load_exercises(args) -> list[dict]:
    if args.file:
        rows = json.loads(Path(args.file).read_text(encoding="utf-8"))
        return [{"id": r.get("id", f"f{i}"), **_payload(r)} for i, r in enumerate(rows)]
    # DB: vocabulary_exercises where exercise_type='D1'
    from database import supabase_admin
    q = supabase_admin.table("vocabulary_exercises").select("id, content_payload, status").eq("exercise_type", "D1")
    if args.status:
        q = q.eq("status", args.status)
    resp = q.limit(args.limit or 1000).execute()
    return [{"id": str(r["id"]), **_payload(r.get("content_payload") or {})} for r in (resp.data or [])]


def _payload(r: dict) -> dict:
    return {
        "word": r.get("word") or r.get("answer"),
        "answer": r.get("answer") or r.get("word"),
        "sentence": r.get("sentence", ""),
        "distractors": r.get("distractors") or [],
    }


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", choices=["db", "file"], default="db")
    ap.add_argument("--file", default=None, help="JSON list of D1 payloads (implies --source file)")
    ap.add_argument("--status", default="draft", help="DB: which exercise status to review")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--dry-run", action="store_true", help="structural gate only, no LLM calls")
    args = ap.parse_args(argv)
    if args.file:
        args.source = "file"

    exercises = _load_exercises(args)
    print(f"{len(exercises)} bài D1 để review")

    model = None
    if not args.dry_run:
        import google.generativeai as genai
        from config import settings
        if not settings.GEMINI_API_KEY:
            print("GEMINI_API_KEY chưa đặt (hoặc dùng --dry-run)."); return 1
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel(settings.D1_GENERATION_MODEL or "gemini-2.5-flash")

    reviews = []
    for ex in exercises:
        gate = validate_d1_quality(ex, label=str(ex["id"]))
        row = {"id": ex["id"], "word": ex["answer"], "gate_pass": not gate, "gate_errors": gate}
        if model is not None:
            raw = model.generate_content(_JUDGE_PROMPT.format(
                sentence=ex["sentence"], answer=ex["answer"], distractors=ex["distractors"],
            )).text or ""
            verdict = _extract_json(raw) or {"ok": None, "verdicts": [{"note": "judge parse failed"}]}
            row["semantic_ok"] = verdict.get("ok")
            row["semantic_verdicts"] = verdict.get("verdicts", [])
            flag = "✓" if (not gate and verdict.get("ok")) else "⚠ REVIEW"
        else:
            flag = "✓" if not gate else "⚠ gate"
        reviews.append(row)
        print(f"  {ex['id']} ({ex['answer']}): {flag}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(yaml.safe_dump(reviews, allow_unicode=True, sort_keys=False), encoding="utf-8")
    clean = sum(1 for r in reviews if r.get("gate_pass") and r.get("semantic_ok") is not False)
    print(f"\nĐã ghi {len(reviews)} review → {args.out} ({clean} chưa bị gắn cờ).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
