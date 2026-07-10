#!/usr/bin/env python3
"""gen_reading_solutions.py — DRAFT generator for reading solutions (audit #6).

Pipeline the user chose (gate máy + adversarial LLM + spot-check người):

  1. DRAFT   — Gemini writes solution_steps + distractor_analysis for each
               question, grounded in the passage + the known correct answer.
  2. VERIFY  — a second, adversarial Gemini pass checks every step/why_wrong
               against the passage ("is this evidence really there? is each
               distractor rebuttal correct?") and returns problems.
  3. GATE    — services.reading_solution_depth runs on the draft (machine bar:
               ≥2 steps, distractor coverage).

Output is written to a DRAFT file only — it NEVER edits live content. A human
spot-checks the drafts (esp. any the verify pass flagged) and merges the good
ones into the test markdown.

    export GEMINI_API_KEY=...
    python -m scripts.gen_reading_solutions content/reading/l3-academic-reading-test-1.md \
        --out drafts/l3-t1-solutions.yaml [--limit 5] [--all]

Requires GEMINI_API_KEY. Costs money (2 LLM calls per question). Run offline
first with --dry-run to see which questions would be generated.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.reading_solution_depth import validate_solution_depth, wrong_options  # noqa: E402


# ── prompts ───────────────────────────────────────────────────────────────────

_DRAFT_PROMPT = """\
Bạn là giáo viên IELTS Reading. Viết LỜI GIẢI CHI TIẾT (tiếng Việt) cho MỘT câu hỏi,
CHỈ dựa trên đoạn văn cho sẵn — không bịa thông tin ngoài đoạn.

ĐOẠN VĂN:
{passage}

CÂU HỎI ({qtype}): {prompt}
{options}
ĐÁP ÁN ĐÚNG: {answer}

Trả về JSON đúng schema sau (không thêm chữ nào ngoài JSON):
{{
  "solution_steps": [
    {{"action": "<locate|decode_vocab|parse_syntax|eliminate|infer|confirm>",
      "instruction_vi": "<một bước suy luận ngắn, trích dẫn cụm từ THẬT trong đoạn>"}}
  ],
  "distractor_analysis": [
    {{"option": "<nhãn phương án SAI>", "why_wrong_vi": "<vì sao phương án này sai, bám đoạn văn>"}}
  ]
}}
Yêu cầu: ≥2 solution_steps; distractor_analysis phải có MỘT mục cho MỖI phương án sai: {wrongs}.
Nếu câu điền từ (không có phương án), để distractor_analysis = [].
"""

_VERIFY_PROMPT = """\
Bạn là người phản biện gắt gao. Dưới đây là đoạn văn, một câu hỏi, đáp án đúng, và một
LỜI GIẢI đề xuất. Kiểm tra nghiêm khắc:
- Mỗi bước có trích dẫn/căn cứ THẬT xuất hiện trong đoạn không? (không bịa)
- Mỗi 'why_wrong_vi' có đúng và bám đoạn không?
Trả JSON: {{"ok": true|false, "problems": ["...", ...]}}. ok=false nếu có BẤT KỲ vấn đề nào.

ĐOẠN VĂN:
{passage}

CÂU HỎI: {prompt}
ĐÁP ÁN ĐÚNG: {answer}

LỜI GIẢI ĐỀ XUẤT:
{draft}
"""


def _fmt_options(q: dict) -> str:
    opts = q.get("options") or []
    if not opts:
        return "(câu điền từ — không có phương án)"
    return "PHƯƠNG ÁN:\n" + "\n".join(
        f"  {o.get('label')}: {o.get('text','')}" for o in opts if isinstance(o, dict)
    )


def _extract_json(text: str) -> dict | None:
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        return json.loads(text[a : b + 1])
    except json.JSONDecodeError:
        return None


# ── main ──────────────────────────────────────────────────────────────────────

def _frontmatter(md_path: Path) -> dict:
    parts = md_path.read_text(encoding="utf-8").split("---", 2)
    return yaml.safe_load(parts[1]) or {}


def _iter_questions(fm: dict):
    for p in fm.get("passages") or []:
        body = p.get("body_markdown", "")
        for q in p.get("questions") or []:
            if isinstance(q, dict):
                yield body, q


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--all", action="store_true", help="regenerate even questions that already pass the gate")
    ap.add_argument("--dry-run", action="store_true", help="list target questions, no LLM calls")
    args = ap.parse_args(argv)

    fm = _frontmatter(Path(args.file))
    targets = [
        (body, q) for body, q in _iter_questions(fm)
        if args.all or validate_solution_depth(q, "q")
    ]
    if args.limit:
        targets = targets[: args.limit]
    print(f"{len(targets)} câu cần sinh lời giải trong {args.file}")
    if args.dry_run:
        for _, q in targets:
            print(f"  Q{q.get('q_num')} ({q.get('question_type')})")
        return 0

    import google.generativeai as genai
    from config import settings
    if not settings.GEMINI_API_KEY:
        print("GEMINI_API_KEY chưa đặt — export rồi chạy lại."); return 1
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(settings.GEMINI_PRO_MODEL)

    drafts = []
    for body, q in targets:
        qn = q.get("q_num")
        wrongs = wrong_options(q)
        draft_raw = model.generate_content(_DRAFT_PROMPT.format(
            passage=body, qtype=q.get("question_type"), prompt=q.get("prompt", ""),
            options=_fmt_options(q), answer=q.get("answer"),
            wrongs=wrongs if wrongs else "(không có)",
        )).text or ""
        draft = _extract_json(draft_raw)
        if not draft:
            drafts.append({"q_num": qn, "error": "draft JSON parse failed", "raw": draft_raw[:400]})
            continue

        verdict_raw = model.generate_content(_VERIFY_PROMPT.format(
            passage=body, prompt=q.get("prompt", ""), answer=q.get("answer"),
            draft=json.dumps(draft, ensure_ascii=False, indent=2),
        )).text or ""
        verdict = _extract_json(verdict_raw) or {"ok": None, "problems": ["verify parse failed"]}

        gate = validate_solution_depth({**q, "solution": draft}, f"Q{qn}")
        drafts.append({
            "q_num": qn,
            "solution": draft,
            "adversarial_ok": verdict.get("ok"),
            "adversarial_problems": verdict.get("problems", []),
            "gate_pass": not gate,
            "gate_errors": gate,
        })
        flag = "✓" if (not gate and verdict.get("ok")) else "⚠ REVIEW"
        print(f"  Q{qn}: {flag}  (gate_pass={not gate}, adversarial_ok={verdict.get('ok')})")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(yaml.safe_dump(drafts, allow_unicode=True, sort_keys=False), encoding="utf-8")
    n_clean = sum(1 for d in drafts if d.get("gate_pass") and d.get("adversarial_ok"))
    print(f"\nĐã ghi {len(drafts)} draft → {args.out} ({n_clean} sạch cả gate + adversarial; "
          f"còn lại cần người spot-check).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
