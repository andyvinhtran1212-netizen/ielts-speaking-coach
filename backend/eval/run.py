"""backend/eval/run.py — run a grader over the gold set and report agreement.

    python -m eval.run --module writing  --source fixture           # offline smoke
    python -m eval.run --module speaking --source db --out rep.json  # real run

Makes real, paid LLM calls unless --no-grade (which reports only the gold-set
composition + inter-rater human ceiling). Never runs in the request path or CI.

Report per criterion: MAE, bias, ±0.5 rate, quadratic-weighted kappa, and 6/7
boundary confusion (see eval/metrics.py). Also emits the inter-rater agreement
computed from the two human raters — the human ceiling the grader is measured
against, not just an absolute bar.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys

from eval import metrics
from eval.gold_loader import load_speaking_gold, load_writing_gold

# criterion → (predicted-key extractor, reference-key)
_SPEAKING_CRITERIA = ["fc", "lr", "gra", "overall"]   # P needs Azure+audio (#2), not here
_WRITING_CRITERIA = ["tr", "cc", "lr", "gra", "overall"]


# ── grader adapters — normalize each grader's output to {criterion: band} ─────

async def _grade_speaking(item) -> dict | None:
    from services.claude_grader import grade_response
    g = await grade_response(
        question=item.question, transcript=item.transcript,
        part=item.part, mode="test",
    )
    return {
        "fc": g.get("band_fc"), "lr": g.get("band_lr"),
        "gra": g.get("band_gra"), "overall": g.get("overall_band"),
    }


async def _grade_writing(item) -> dict | None:
    from models.writing_feedback import GraderConfig
    from services.gemini_writing_grader import GeminiWritingGrader
    cfg = GraderConfig(
        task_type=item.task_type, prompt_text=item.prompt_text,
        essay_text=item.essay_text, analysis_level=(item.analysis_level or 3),
        # forward the Task 1 chart so the harness exercises the SAME multimodal
        # path production uses — without it, task1_academic items grade text-only
        # (with the missing-image caveat), measuring a different grader (Codex F3).
        prompt_image_url=item.prompt_image_url,
    )
    res = await GeminiWritingGrader().grade_essay(cfg)
    fb = res.feedback
    cf = fb.criteriaFeedback
    return {
        "tr": cf.mainCriterion.bandScore,
        "cc": cf.coherenceCohesion.bandScore,
        "lr": cf.lexicalResource.bandScore,
        "gra": cf.grammaticalRange.bandScore,
        "overall": fb.overallBandScore,
    }


_MODULES = {
    "speaking": (load_speaking_gold, _grade_speaking, _SPEAKING_CRITERIA),
    "writing":  (load_writing_gold,  _grade_writing,  _WRITING_CRITERIA),
}


# ── inter-rater (human ceiling) ───────────────────────────────────────────────

def _inter_rater(items, criteria) -> dict:
    """Agreement between the first two raters, per criterion — the human ceiling.
    Items with fewer than 2 raters are skipped."""
    out = {}
    for crit in criteria:
        pairs = []
        for it in items:
            rb = it.rater_bands
            if len(rb) >= 2 and rb[0].get(crit) is not None and rb[1].get(crit) is not None:
                pairs.append((rb[0][crit], rb[1][crit]))
        out[crit] = metrics.summarize(pairs)
    return out


# ── main ──────────────────────────────────────────────────────────────────────

async def _run(args) -> dict:
    load, grade, criteria = _MODULES[args.module]
    items = load(source=args.source, fixture=args.fixture)
    if args.limit:
        items = items[: args.limit]
    if not items:
        raise SystemExit(f"No gold items for module={args.module} source={args.source}")

    report = {
        "module": args.module,
        "source": args.source,
        "n_items": len(items),
        "buckets": _bucket_counts(items),
        "inter_rater": _inter_rater(items, criteria),
    }

    if args.no_grade:
        report["grader"] = "skipped (--no-grade)"
        return report

    # run the grader per item; a failure drops that item, not the run
    preds, skipped = [], []
    for it in items:
        try:
            preds.append((it, await grade(it)))
        except Exception as exc:  # noqa: BLE001 — record + continue
            skipped.append({"id": it.id, "error": f"{type(exc).__name__}: {exc}"})

    grader_metrics = {}
    for crit in criteria:
        pairs = [
            (pred.get(crit), it.ref.get(crit))
            for it, pred in preds
            if pred and pred.get(crit) is not None and it.ref.get(crit) is not None
        ]
        grader_metrics[crit] = metrics.summarize(pairs)

    report["grader_vs_reference"] = grader_metrics
    report["n_graded"] = len(preds)
    report["skipped"] = skipped
    return report


def _bucket_counts(items) -> dict:
    counts: dict = {}
    for it in items:
        counts[it.band_bucket or "unbucketed"] = counts.get(it.band_bucket or "unbucketed", 0) + 1
    return counts


def _fmt(x, nd=3):
    return "—" if x is None else f"{x:.{nd}f}"


def _print_report(rep: dict) -> None:
    print(f"\n=== eval: {rep['module']} (source={rep['source']}, n={rep['n_items']}) ===")
    print(f"buckets: {rep['buckets']}")
    gvr = rep.get("grader_vs_reference")
    ir = rep.get("inter_rater", {})
    print(f"\n{'criterion':<10} {'n':>4} {'MAE':>7} {'bias':>7} {'±0.5':>7} {'QWK':>7} {'6/7-cross':>10}  | human-QWK")
    for crit in (gvr or ir):
        g = (gvr or {}).get(crit, {})
        h = ir.get(crit, {})
        b = g.get("boundary", {}) if g else {}
        print(
            f"{crit:<10} {g.get('n', 0):>4} "
            f"{_fmt(g.get('mae')):>7} {_fmt(g.get('bias')):>7} "
            f"{_fmt(g.get('within_half_band')):>7} {_fmt(g.get('qwk')):>7} "
            f"{_fmt(b.get('false_cross_rate')):>10}  | {_fmt(h.get('qwk'))}"
        )
    if rep.get("skipped"):
        print(f"\nskipped {len(rep['skipped'])} item(s): {rep['skipped']}")
    print()


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Grading-quality regression harness")
    p.add_argument("--module", required=True, choices=list(_MODULES))
    p.add_argument("--source", default="db", choices=["db", "fixture"])
    p.add_argument("--fixture", default=None, help="path to a gold JSON fixture (source=fixture)")
    p.add_argument("--limit", type=int, default=None)
    p.add_argument("--no-grade", action="store_true", help="report gold composition + inter-rater only (no LLM calls)")
    p.add_argument("--out", default=None, help="write the full JSON report to this path")
    args = p.parse_args(argv)

    report = asyncio.run(_run(args))
    _print_report(report)
    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"wrote {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
