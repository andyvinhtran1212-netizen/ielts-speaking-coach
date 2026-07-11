#!/usr/bin/env python3
"""backfill_quiz_why_wrong.py — batch backfiller for per-distractor why_wrong
across ALL grammar quiz banks (audit #7a).

Concurrent generate (draft → adversarial LLM verify → gate) with backoff, then
inject the CLEAN ones (gate + adversarial pass) in-place after each question's
`explain:` line. Flagged (real content objection or transient failure) → written
to a review log, NOT injected.

RESUMABLE: skips any question that already has `why_wrong`, so re-running after a
stop (e.g. the Gemini monthly spend cap — see docs/TECH_DEBT_content_backfill.md)
continues cleanly from where it left off.

    export GEMINI_API_KEY=...
    python -m scripts.backfill_quiz_why_wrong --out drafts/quiz-flagged.yaml --workers 6

Costs money (2 LLM calls per question). Keep --workers modest (~6): 12 blew past
the per-minute quota. Uses D1_GENERATION_MODEL (flash).
"""

from __future__ import annotations

import argparse
import glob
import json
import re
import sys
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import yaml

_REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "backend"))
from services.quiz_why_wrong import validate_why_wrong, wrong_option_indices  # noqa: E402
from scripts.gen_quiz_why_wrong import (  # noqa: E402
    _DRAFT_PROMPT, _VERIFY_PROMPT, _extract_json, _fmt_options, _iter_questions,
)

_BANK_DIR = _REPO / "docs" / "grammar-quiz-banks"


def _model():
    import google.generativeai as genai
    from config import settings
    genai.configure(api_key=settings.GEMINI_API_KEY)
    name = settings.D1_GENERATION_MODEL or "gemini-2.5-flash"
    return genai, name


def _call(genai, name, prompt, tries=6):
    last, delay = None, 2
    for _ in range(tries):
        try:
            return genai.GenerativeModel(name).generate_content(prompt).text or ""
        except Exception as e:  # noqa: BLE001 — back off so rate-limit windows recover
            last = e
            time.sleep(delay)
            delay = min(delay * 2, 30)
    raise last


def _gen_one(genai, name, q):
    wrongs = wrong_option_indices(q)
    options = q.get("options") or []
    try:
        draft_raw = _call(genai, name, _DRAFT_PROMPT.format(
            prompt=q.get("prompt", ""), options=_fmt_options(q), answer=q.get("answer"),
            answer_text=options[q["answer"]] if isinstance(q.get("answer"), int) else "",
            explain=q.get("explain", ""), wrongs=wrongs,
        ))
    except Exception as e:  # noqa: BLE001
        return None, False, [f"draft call failed: {type(e).__name__}"]
    ww = _extract_json(draft_raw)
    if not isinstance(ww, dict):
        return None, False, ["draft parse failed"]
    ww = {str(k): v for k, v in ww.items()}
    try:
        verdict_raw = _call(genai, name, _VERIFY_PROMPT.format(
            prompt=q.get("prompt", ""), options=options, answer=q.get("answer"),
            draft=json.dumps(ww, ensure_ascii=False),
        ))
    except Exception as e:  # noqa: BLE001
        return ww, False, [f"verify call failed: {type(e).__name__}"]
    verdict = _extract_json(verdict_raw) or {"ok": None, "problems": ["verify parse failed"]}
    gate = validate_why_wrong({**q, "why_wrong": ww}, str(q.get("id")), required=True)
    clean = (not gate) and (verdict.get("ok") is True)
    return ww, clean, (gate + (verdict.get("problems") or [] if not verdict.get("ok") else []))


def _ww_block(ww):
    dumped = yaml.safe_dump({"why_wrong": ww}, allow_unicode=True, sort_keys=True,
                            default_flow_style=False, width=4096)
    return dumped.rstrip("\n").split("\n")


def _inject_bank(path, clean_by_id):
    out, cur_id = [], None
    for ln in Path(path).read_text().split("\n"):
        out.append(ln)
        m = re.match(r'^id:\s*"?([^"\s]+)"?\s*$', ln)
        if m:
            cur_id = m.group(1)
        elif re.match(r"^explain:", ln) and cur_id in clean_by_id:
            out.extend(_ww_block(clean_by_id[cur_id]))
    Path(path).write_text("\n".join(out))


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", required=True, help="review log for flagged questions")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--dry-run", action="store_true", help="count targets, no LLM calls")
    args = ap.parse_args(argv)

    banks = sorted(glob.glob(f"{_BANK_DIR}/G-*.md"))
    targets = [
        (b, q) for b in banks for q in _iter_questions(Path(b))
        if wrong_option_indices(q) is not None and not q.get("why_wrong")
    ]
    print(f"{len(targets)} questions to generate across {len(banks)} banks")
    if args.dry_run:
        return 0

    genai, name = _model()
    clean_by_bank, flagged, done = defaultdict(dict), [], 0

    def work(t):
        b, q = t
        ww, clean, probs = _gen_one(genai, name, q)
        return b, str(q.get("id")), ww, clean, probs

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        for fut in as_completed([ex.submit(work, t) for t in targets]):
            b, qid, ww, clean, probs = fut.result()
            (clean_by_bank[b].__setitem__(qid, ww) if clean
             else flagged.append({"bank": b.split("/")[-1], "id": qid, "why_wrong": ww, "problems": probs}))
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(targets)} ({sum(len(v) for v in clean_by_bank.values())} clean)", flush=True)

    tot = 0
    for b, cmap in clean_by_bank.items():
        _inject_bank(b, cmap)
        tot += len(cmap)
    yaml.safe_dump(flagged, open(args.out, "w"), allow_unicode=True, sort_keys=False)
    print(f"\nDONE: {tot} injected across {len(clean_by_bank)} banks, {len(flagged)} flagged → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
