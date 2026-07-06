"""Backfill the Task 1 verified answer key for existing prompts.

Runs the one-time vision extraction (services.writing_prompt_analysis) for every
task1_academic prompt that has an image but no up-to-date analysis, so admins
have facts to review instead of starting from scratch. See
docs/WRITING_TASK1_ANALYSIS_SPEC.md.

Precondition: migration 136 must be applied (the analysis columns must exist).

Each result lands status='ready', reviewed=FALSE — an admin still approves each
one in prompts.html before it can anchor grading (the safety gate is unchanged).

Usage
-----
    cd backend
    python -m scripts.backfill_prompt_analysis            # dry run (list only)
    python -m scripts.backfill_prompt_analysis --execute  # extract + store
"""

from __future__ import annotations

import argparse
import asyncio
import sys


def _enumerate_targets(supabase_admin) -> list[dict]:
    """task1_academic prompts with an image whose analysis is missing/stale."""
    from services.writing_prompt_analysis import image_needs_analysis

    rows = (
        supabase_admin.table("writing_prompts")
        .select("id, title, task_type, prompt_image_url, prompt_image_public_id, "
                "prompt_image_analysis_public_id, prompt_image_analysis_status")
        .eq("task_type", "task1_academic")
        .not_.is_("prompt_image_url", "null")
        .eq("is_active", True)
        .execute()
    ).data or []
    return [r for r in rows if image_needs_analysis(r)]


async def run(execute: bool) -> int:
    from database import supabase_admin
    from services.writing_prompt_analysis import run_and_store_analysis

    targets = _enumerate_targets(supabase_admin)
    print(f"task1_academic prompts needing analysis: {len(targets)}")
    print(f"Mode: {'EXECUTE' if execute else 'DRY RUN'}\n")

    ok = failed = 0
    for t in targets:
        title = (t.get("title") or "(no title)")[:50]
        if not execute:
            print(f"  WOULD ANALYZE  {t['id']}  {title}")
            continue
        await run_and_store_analysis(t["id"])
        # run_and_store_analysis never raises; read back the status.
        row = (
            supabase_admin.table("writing_prompts")
            .select("prompt_image_analysis_status, prompt_image_analysis_error")
            .eq("id", t["id"]).limit(1).execute()
        ).data
        status = (row[0].get("prompt_image_analysis_status") if row else None)
        if status == "ready":
            ok += 1
            print(f"  READY   {t['id']}  {title}")
        else:
            failed += 1
            err = (row[0].get("prompt_image_analysis_error") if row else "") or ""
            print(f"  FAILED  {t['id']}  {title}  ({err[:80]})")

    print("\n── Summary ─────────────────────────────")
    if execute:
        print(f"  ready : {ok}\n  failed: {failed}")
        print("\n  All results are UNREVIEWED — approve each in prompts.html before it grades.")
    else:
        print(f"  would analyze: {len(targets)}")
        print("\n  Dry run only — re-run with --execute to extract.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--execute", action="store_true",
                    help="Run the extraction + store (default: dry run).")
    args = ap.parse_args()
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    return asyncio.run(run(execute=args.execute))


if __name__ == "__main__":
    sys.exit(main())
