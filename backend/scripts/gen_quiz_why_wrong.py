#!/usr/bin/env python3
"""gen_quiz_why_wrong.py — DRAFT generator for per-distractor why_wrong (audit #7a).

Same pipeline as gen_reading_solutions: DRAFT → adversarial VERIFY → machine GATE
→ DRAFT file only (never edits live banks). A human spot-checks flagged drafts
and pastes the approved `why_wrong` blocks into the bank.

    export GEMINI_API_KEY=...
    python -m scripts.gen_quiz_why_wrong docs/grammar-quiz-banks/G-affect-vs-effect.md \
        --out drafts/why_wrong-affect.yaml [--limit 10]

Costs money (2 LLM calls per question). --dry-run lists targets for free. Pick
banks with scripts/check_quiz_why_wrong.py --rank (biggest gap first).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.quiz_why_wrong import validate_why_wrong, wrong_option_indices  # noqa: E402


_DRAFT_PROMPT = """\
Bạn là giáo viên ngữ pháp tiếng Anh. Cho một câu trắc nghiệm, hãy giải thích NGẮN GỌN
(tiếng Việt) VÌ SAO MỖI PHƯƠNG ÁN NHIỄU (sai) là sai — không giải thích đáp án đúng.

CÂU HỎI: {prompt}
CÁC PHƯƠNG ÁN (theo chỉ số):
{options}
ĐÁP ÁN ĐÚNG: index {answer} = "{answer_text}"
QUY TẮC (explain sẵn có): {explain}

Trả JSON: một dict ánh xạ chỉ-số-phương-án-SAI → lý do (tiếng Việt, 1 câu, bám lỗi cụ thể).
Chỉ gồm các chỉ số nhiễu: {wrongs}. Ví dụ: {{"1": "...", "2": "..."}}. Không thêm chữ nào ngoài JSON.
"""

_VERIFY_PROMPT = """\
Phản biện gắt gao. Cho câu hỏi, đáp án đúng, và các giải thích "vì sao phương án sai".
Kiểm tra: mỗi lý do có ĐÚNG về mặt ngữ pháp và thực sự giải thích lỗi của phương án đó không?
Trả JSON {{"ok": true|false, "problems": [...]}}. ok=false nếu có bất kỳ lý do nào sai/mơ hồ.

CÂU HỎI: {prompt}
PHƯƠNG ÁN: {options}
ĐÁP ÁN ĐÚNG: index {answer}
GIẢI THÍCH ĐỀ XUẤT: {draft}
"""


def _extract_json(text: str):
    a, b = text.find("{"), text.rfind("}")
    if a == -1 or b == -1:
        return None
    try:
        return json.loads(text[a : b + 1])
    except json.JSONDecodeError:
        return None


def _iter_questions(md_path: Path):
    text = md_path.read_text(encoding="utf-8")
    for chunk in re.split(r"^---\s*$", text, flags=re.M):
        chunk = chunk.strip()
        if not chunk:
            continue
        try:
            d = yaml.safe_load(chunk)
        except yaml.YAMLError:
            continue
        if isinstance(d, dict) and d.get("type") and "answer" in d:
            yield d


def _fmt_options(q: dict) -> str:
    return "\n".join(f"  {i}: {o}" for i, o in enumerate(q.get("options") or []))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file")
    ap.add_argument("--out", required=True)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)

    targets = [
        q for q in _iter_questions(Path(args.file))
        if wrong_option_indices(q) is not None and not q.get("why_wrong")
    ]
    if args.limit:
        targets = targets[: args.limit]
    print(f"{len(targets)} câu cần sinh why_wrong trong {args.file}")
    if args.dry_run:
        for q in targets:
            print(f"  {q.get('id')} ({q.get('type')})")
        return 0

    import google.generativeai as genai
    from config import settings
    if not settings.GEMINI_API_KEY:
        print("GEMINI_API_KEY chưa đặt."); return 1
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel(settings.GEMINI_PRO_MODEL)

    drafts = []
    for q in targets:
        qid = q.get("id")
        wrongs = wrong_option_indices(q)
        options = q.get("options") or []
        draft_raw = model.generate_content(_DRAFT_PROMPT.format(
            prompt=q.get("prompt", ""), options=_fmt_options(q),
            answer=q.get("answer"), answer_text=options[q["answer"]] if isinstance(q.get("answer"), int) else "",
            explain=q.get("explain", ""), wrongs=wrongs,
        )).text or ""
        ww = _extract_json(draft_raw)
        if not isinstance(ww, dict):
            drafts.append({"id": qid, "error": "draft parse failed", "raw": draft_raw[:300]})
            continue
        ww = {str(k): v for k, v in ww.items()}

        verdict_raw = model.generate_content(_VERIFY_PROMPT.format(
            prompt=q.get("prompt", ""), options=options, answer=q.get("answer"),
            draft=json.dumps(ww, ensure_ascii=False),
        )).text or ""
        verdict = _extract_json(verdict_raw) or {"ok": None, "problems": ["verify parse failed"]}

        gate = validate_why_wrong({**q, "why_wrong": ww}, str(qid), required=True)
        drafts.append({
            "id": qid, "why_wrong": ww,
            "adversarial_ok": verdict.get("ok"),
            "adversarial_problems": verdict.get("problems", []),
            "gate_pass": not gate, "gate_errors": gate,
        })
        flag = "✓" if (not gate and verdict.get("ok")) else "⚠ REVIEW"
        print(f"  {qid}: {flag}")

    Path(args.out).parent.mkdir(parents=True, exist_ok=True)
    Path(args.out).write_text(yaml.safe_dump(drafts, allow_unicode=True, sort_keys=False), encoding="utf-8")
    n_clean = sum(1 for d in drafts if d.get("gate_pass") and d.get("adversarial_ok"))
    print(f"\nĐã ghi {len(drafts)} draft → {args.out} ({n_clean} sạch gate+adversarial).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
