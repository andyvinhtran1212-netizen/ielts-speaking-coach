"""Calibration / cost harness for the multi-model writing-grading plan (P0).

Dual-grades a set of essays with two models (a BASELINE, e.g. gemini-2.5-pro,
and a CANDIDATE, e.g. gemini-3.5-flash) at the same level/tier, then reports:

  - band agreement   — |overallBandScore_baseline - candidate| (target ±0.5)
  - per-criterion band deltas (TR/CC/LR/GRA)
  - section coverage — required sections each model actually produced
  - cost              — cost_usd per model + candidate/baseline ratio + savings
  - latency           — grading_duration_ms per model

This is the EVIDENCE that decides whether a cheaper/newer model can replace the
baseline for grading (see docs/research/MULTI_MODEL_WRITING_GRADING.md §6/§7).
**It is a measurement tool, not production code** — it calls the real Gemini
API and is run on demand, never in CI.

The pure comparison/aggregation/report functions take already-computed
`GradingResult`s and have NO IO, so they are unit-tested without the API
(tests/test_calibration_harness.py). Only `run_harness()` / `main()` touch the
network.

Usage:
    cd backend
    GEMINI_API_KEY=... python -m scripts.calibration_harness \
        --essays scripts/calibration_fixtures.example.json \
        --baseline gemini-2.5-pro \
        --candidate gemini-3.5-flash \
        --level 3 \
        --out /tmp/calibration_report.json

Or measure on REAL production essays instead of the fixtures file:
    GEMINI_API_KEY=... python -m scripts.calibration_harness \
        --from-db 30 --candidate gemini-3.5-flash --level 3 --out /tmp/report.json

The essays file is a JSON list of objects:
    [{"id": "e1", "task_type": "task2", "prompt_text": "...", "essay_text": "..."}]
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Optional

from models.writing_feedback import GraderConfig, GradingResult, validate_level_coverage

_CRITERIA = ("mainCriterion", "coherenceCohesion", "lexicalResource", "grammaticalRange")
BAND_AGREEMENT_THRESHOLD = 0.5


# ── Pure comparison (no IO — unit-tested) ─────────────────────────────


@dataclass
class EssayComparison:
    essay_id: str
    band_baseline: float
    band_candidate: float
    band_delta: float            # absolute
    within_threshold: bool       # band_delta <= BAND_AGREEMENT_THRESHOLD
    criteria_delta: dict         # {criterion: abs int delta}
    missing_baseline: list       # required sections the baseline dropped
    missing_candidate: list
    cost_baseline: Optional[float]
    cost_candidate: Optional[float]
    cost_ratio: Optional[float]  # candidate / baseline (None if baseline cost 0/None)
    latency_ms_baseline: int
    latency_ms_candidate: int


def _criterion_band(feedback, name: str) -> Optional[int]:
    bundle = getattr(feedback, "criteriaFeedback", None)
    crit = getattr(bundle, name, None) if bundle else None
    return getattr(crit, "bandScore", None) if crit else None


def compare_gradings(
    essay_id: str,
    baseline: GradingResult,
    candidate: GradingResult,
    *,
    level: int,
    task_type: Optional[str] = None,
) -> EssayComparison:
    """Compare one essay's baseline vs candidate grading. Pure — no IO."""
    b_band = float(baseline.feedback.overallBandScore)
    c_band = float(candidate.feedback.overallBandScore)
    delta = round(abs(b_band - c_band), 2)

    criteria_delta: dict = {}
    for name in _CRITERIA:
        b = _criterion_band(baseline.feedback, name)
        c = _criterion_band(candidate.feedback, name)
        if b is not None and c is not None:
            criteria_delta[name] = abs(b - c)

    cost_ratio = None
    if baseline.cost_usd and candidate.cost_usd is not None and baseline.cost_usd > 0:
        cost_ratio = round(candidate.cost_usd / baseline.cost_usd, 3)

    return EssayComparison(
        essay_id=essay_id,
        band_baseline=b_band,
        band_candidate=c_band,
        band_delta=delta,
        within_threshold=delta <= BAND_AGREEMENT_THRESHOLD,
        criteria_delta=criteria_delta,
        missing_baseline=validate_level_coverage(baseline.feedback, level, task_type),
        missing_candidate=validate_level_coverage(candidate.feedback, level, task_type),
        cost_baseline=baseline.cost_usd,
        cost_candidate=candidate.cost_usd,
        cost_ratio=cost_ratio,
        latency_ms_baseline=baseline.grading_duration_ms,
        latency_ms_candidate=candidate.grading_duration_ms,
    )


def aggregate(comparisons: list[EssayComparison]) -> dict:
    """Roll up per-essay comparisons into the go/no-go summary. Pure."""
    n = len(comparisons)
    if n == 0:
        return {"n": 0}

    within = sum(c.within_threshold for c in comparisons)
    deltas = [c.band_delta for c in comparisons]
    costs_b = [c.cost_baseline for c in comparisons if c.cost_baseline is not None]
    costs_c = [c.cost_candidate for c in comparisons if c.cost_candidate is not None]
    lat_b = [c.latency_ms_baseline for c in comparisons]
    lat_c = [c.latency_ms_candidate for c in comparisons]

    sum_b = sum(costs_b) if costs_b else None
    sum_c = sum(costs_c) if costs_c else None
    cost_savings_pct = None
    if sum_b and sum_c is not None and sum_b > 0:
        cost_savings_pct = round((1 - sum_c / sum_b) * 100, 1)

    return {
        "n": n,
        "pct_within_half_band": round(within / n * 100, 1),
        "n_within_half_band": within,
        "mean_abs_band_delta": round(sum(deltas) / n, 3),
        "max_abs_band_delta": max(deltas),
        "mean_cost_baseline": round(sum_b / len(costs_b), 5) if costs_b else None,
        "mean_cost_candidate": round(sum_c / len(costs_c), 5) if costs_c else None,
        "cost_savings_pct": cost_savings_pct,
        "mean_latency_ms_baseline": round(sum(lat_b) / n) if lat_b else None,
        "mean_latency_ms_candidate": round(sum(lat_c) / n) if lat_c else None,
        "n_coverage_gaps_candidate": sum(1 for c in comparisons if c.missing_candidate),
    }


def format_report(comparisons: list[EssayComparison], summary: dict,
                  baseline_model: str, candidate_model: str) -> str:
    """Render a human-readable markdown report. Pure."""
    if summary.get("n", 0) == 0:
        return "No comparisons (0 essays graded)."

    lines = [
        f"# Calibration report — {candidate_model} vs {baseline_model}",
        "",
        f"- Essays compared: **{summary['n']}**",
        f"- Band agreement (±{BAND_AGREEMENT_THRESHOLD}): "
        f"**{summary['pct_within_half_band']}%** "
        f"({summary['n_within_half_band']}/{summary['n']}) "
        f"— gate target ≥95%",
        f"- Mean |band Δ|: {summary['mean_abs_band_delta']} · max: {summary['max_abs_band_delta']}",
        f"- Mean cost: baseline ${summary['mean_cost_baseline']} → "
        f"candidate ${summary['mean_cost_candidate']} "
        f"(**savings {summary['cost_savings_pct']}%**)",
        f"- Mean latency: baseline {summary['mean_latency_ms_baseline']}ms → "
        f"candidate {summary['mean_latency_ms_candidate']}ms",
        f"- Candidate coverage gaps: {summary['n_coverage_gaps_candidate']}",
        "",
        "| essay | band (B→C) | Δ | ±0.5 | cost B | cost C | ratio | gaps(C) |",
        "|---|---|---|---|---|---|---|---|",
    ]
    for c in comparisons:
        lines.append(
            f"| {c.essay_id} | {c.band_baseline}→{c.band_candidate} | {c.band_delta} | "
            f"{'✅' if c.within_threshold else '❌'} | "
            f"{c.cost_baseline} | {c.cost_candidate} | {c.cost_ratio} | "
            f"{','.join(c.missing_candidate) or '—'} |"
        )
    return "\n".join(lines)


# ── Essay sources + runner (real IO — not unit-tested) ────────────────


def _query_essays(task_types: Optional[list[str]], limit: int) -> list[dict]:
    """Most-recent essays (with text), optionally restricted to task_types."""
    from database import supabase_admin
    q = (
        supabase_admin.table("writing_essays")
        .select("id, task_type, prompt_text, essay_text")
        .not_.is_("essay_text", "null")
        .not_.is_("prompt_text", "null")
    )
    if task_types:
        q = q.in_("task_type", task_types)
    rows = q.order("created_at", desc=True).limit(limit).execute().data or []
    return [
        {
            "id": str(e["id"]),
            "task_type": e["task_type"],
            "prompt_text": e["prompt_text"],
            "essay_text": e["essay_text"],
        }
        for e in rows
        if e.get("essay_text") and e.get("prompt_text")
    ]


def fetch_essays_from_db(n: int, *, balance_task_type: bool = False) -> list[dict]:
    """Pull the N most recent real essays (with text) from writing_essays so
    the harness measures on production data, not synthetic fixtures. Returns
    the same shape as the fixtures file. Real grading happens fresh at the
    harness's level (the stored grade is ignored — this is a model A/B).

    `balance_task_type=True` splits the quota ~half Task 2 / half Task 1
    (academic + general) so the run covers both task families even when recent
    submissions skew to one — falls back to topping up from the other family
    if one side is short."""
    if not balance_task_type:
        return _query_essays(None, n)

    half = n // 2
    t2 = _query_essays(["task2"], n - half)
    t1 = _query_essays(["task1_academic", "task1_general"], half)
    combined = t2 + t1
    if len(combined) < n:  # one family short — top up from anything recent
        seen = {e["id"] for e in combined}
        for e in _query_essays(None, n * 2):
            if e["id"] not in seen:
                combined.append(e)
                if len(combined) >= n:
                    break
    return combined[:n]


async def _grade_one(essay: dict, model: str, level: int):
    from services.gemini_writing_grader import get_grader
    config = GraderConfig(
        task_type=essay["task_type"],
        prompt_text=essay["prompt_text"],
        essay_text=essay["essay_text"],
        analysis_level=level,
        selected_model=model,
    )
    return await get_grader().grade_essay(config)


async def run_harness(essays: list[dict], *, baseline_model: str,
                      candidate_model: str, level: int) -> list[EssayComparison]:
    """Grade each essay with both models and compare. Skips an essay (logs to
    stderr) if either grading raises — a single bad essay must not sink the run."""
    comparisons: list[EssayComparison] = []
    for essay in essays:
        eid = essay.get("id", "?")
        try:
            base, cand = await asyncio.gather(
                _grade_one(essay, baseline_model, level),
                _grade_one(essay, candidate_model, level),
            )
        except Exception as exc:  # noqa: BLE001 — measurement tool, keep going
            print(f"[harness] essay {eid} skipped — grading failed: {exc}", file=sys.stderr)
            continue
        comparisons.append(
            compare_gradings(eid, base, cand, level=level,
                             task_type=essay.get("task_type"))
        )
    return comparisons


def main(argv: Optional[list[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Dual-grade essays and compare models.")
    ap.add_argument("--essays", help="JSON file: list of {id,task_type,prompt_text,essay_text}")
    ap.add_argument("--from-db", type=int, metavar="N", dest="from_db",
                    help="instead of --essays, grade the N most recent real essays (with text) from writing_essays")
    ap.add_argument("--baseline", default="gemini-2.5-pro")
    ap.add_argument("--candidate", default="gemini-3.5-flash")
    ap.add_argument("--level", type=int, default=3, help="single level (used if --levels absent)")
    ap.add_argument("--levels", default=None,
                    help="comma list, e.g. 3,4 — run + report at each level on the same essays")
    ap.add_argument("--balance-task-type", action="store_true", dest="balance",
                    help="with --from-db: split the quota ~half Task 2 / half Task 1")
    ap.add_argument("--out", default=None, help="optional path to write the JSON report")
    args = ap.parse_args(argv)

    if args.from_db:
        essays = fetch_essays_from_db(args.from_db, balance_task_type=args.balance)
        mix = {}
        for e in essays:
            mix[e["task_type"]] = mix.get(e["task_type"], 0) + 1
        print(f"[harness] loaded {len(essays)} essay(s) from writing_essays — task mix: {mix}",
              file=sys.stderr)
    elif args.essays:
        essays = json.loads(Path(args.essays).read_text(encoding="utf-8"))
    else:
        ap.error("provide --essays <file> or --from-db <N>")

    levels = [int(x) for x in args.levels.split(",")] if args.levels else [args.level]

    per_level: dict = {}
    for lvl in levels:
        comparisons = asyncio.run(run_harness(
            essays, baseline_model=args.baseline,
            candidate_model=args.candidate, level=lvl,
        ))
        summary = aggregate(comparisons)
        print(f"\n## Level {lvl}\n")
        print(format_report(comparisons, summary, args.baseline, args.candidate))
        per_level[lvl] = {"summary": summary, "comparisons": [asdict(c) for c in comparisons]}

    if args.out:
        Path(args.out).write_text(json.dumps({
            "baseline": args.baseline, "candidate": args.candidate,
            "levels": levels, "by_level": per_level,
        }, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n[harness] wrote {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
