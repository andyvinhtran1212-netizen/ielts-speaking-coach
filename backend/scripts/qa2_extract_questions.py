#!/usr/bin/env python3
"""QA-2 extractor — chuẩn hoá câu hỏi grammar quiz cho adversarial answer-check.

Đọc bank .md, xuất JSON mỗi câu với **đáp án đã resolve ra chữ** (không để index),
để agent reviewer đối chiếu mà không đọc nhầm index. Đây là đầu vào cho reviewer
(xem docs/QA2_REVIEWER_PROMPT.md). KHÔNG gọi LLM, KHÔNG đụng DB.

Dùng:
    cd backend
    python scripts/qa2_extract_questions.py --bank G-tenses-past-simple   # 1 bank → stdout JSON
    python scripts/qa2_extract_questions.py --only tenses                  # lọc theo chuỗi
    python scripts/qa2_extract_questions.py --all --outdir /tmp/qa2        # ghi 1 file JSON/bank

Mỗi record: {bank, qid, type, input, skill, subtype, prompt, options,
resolved_answer, accept, explain, grammar_article_slug}.
`resolved_answer`:
  - choice → chữ của option đúng (theo index)  (kèm '(index N)')
  - text   → 'ACCEPT: [...]'
  - boolean→ 'TRUE'/'FALSE'
"""
from __future__ import annotations

import argparse
import glob
import json
import re
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.qa_grammar_banks import is_bank_file, _norm_prompt  # noqa: E402,F401 (reuse)

BANK_DIR = Path(__file__).resolve().parents[2] / "docs" / "grammar-quiz-banks"


def _docs(text: str) -> list[dict]:
    out = []
    for chunk in re.split(r"^---\s*$", text, flags=re.M):
        if not chunk.strip() or chunk.strip().startswith("#"):
            continue
        try:
            d = yaml.safe_load(chunk)
        except yaml.YAMLError:
            continue
        if isinstance(d, dict):
            out.append(d)
    return out


def _resolve_answer(q: dict) -> str:
    inp = q.get("input")
    if inp == "choice":
        opts = q.get("options") or []
        idx = q.get("answer")
        if isinstance(idx, int) and 0 <= idx < len(opts):
            return f"{opts[idx]!r} (index {idx})"
        return f"⚠ index không hợp lệ: {idx}"
    if inp == "text":
        return "ACCEPT: " + json.dumps(q.get("accept") or [], ensure_ascii=False)
    if inp == "boolean":
        return "TRUE" if q.get("answer") is True else "FALSE"
    return str(q.get("answer"))


def extract_bank(path: Path) -> dict:
    docs = _docs(path.read_text(encoding="utf-8"))
    meta = next((d for d in docs if str(d.get("kind", "")).lower() == "quiz"), {})
    qs = []
    for d in docs:
        if not d.get("type"):
            continue
        qs.append({
            "qid": d.get("id"),
            "type": d.get("type"),
            "input": d.get("input"),
            "skill": d.get("skill"),
            "subtype": d.get("subtype"),
            "prompt": d.get("prompt"),
            "options": d.get("options"),
            "resolved_answer": _resolve_answer(d),
            "accept": d.get("accept"),
            "explain": d.get("explain"),
            "grammar_article_slug": d.get("grammar_article_slug"),
        })
    return {"bank": meta.get("code") or path.stem, "file": str(path), "questions": qs}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bank", help="1 bank code/tên file (không .md)")
    ap.add_argument("--only", help="lọc theo chuỗi trong tên file")
    ap.add_argument("--all", action="store_true")
    ap.add_argument("--outdir", help="ghi 1 file JSON/bank vào đây (thay vì stdout)")
    args = ap.parse_args()

    files = sorted(p for p in glob.glob(str(BANK_DIR / "G-*.md")) if is_bank_file(Path(p)))
    files = [Path(p) for p in files]
    if args.bank:
        files = [p for p in files if p.stem == args.bank or args.bank in p.stem]
    elif args.only:
        files = [p for p in files if args.only in p.name]

    if not files:
        print("Không tìm thấy bank.", file=sys.stderr)
        return 1

    if args.outdir:
        out = Path(args.outdir)
        out.mkdir(parents=True, exist_ok=True)
        for p in files:
            data = extract_bank(p)
            (out / (p.stem + ".json")).write_text(
                json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"Đã ghi {len(files)} file JSON vào {out}")
    else:
        payload = [extract_bank(p) for p in files]
        print(json.dumps(payload if len(payload) > 1 else payload[0],
                         ensure_ascii=False, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
