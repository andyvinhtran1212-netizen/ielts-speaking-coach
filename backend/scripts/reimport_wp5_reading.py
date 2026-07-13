"""One-off: re-import the 4 WP5 reading files so their new micro-checks land in
`reading_questions.solution` in prod. Reuses the SAME commit paths as the admin
import endpoints (L3 → _import_l3_full_test with its reconciliation; L1 → the
passage upsert + question replace). All 4 files already exist in prod, so this is
an UPDATE (created_by/admin id is never needed).

    cd backend && venv/bin/python -m scripts.reimport_wp5_reading            # DRY-RUN
    cd backend && venv/bin/python -m scripts.reimport_wp5_reading --commit   # write
"""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import yaml  # noqa: E402

from database import supabase_admin  # noqa: E402
from routers.admin_reading import _import_l3_full_test  # noqa: E402
from services.content_import_service import (  # noqa: E402
    build_reading_passage_payload,
    build_reading_question_payloads,
    parse_reading_passage,
    validate_reading_passage,
)

FILES = [
    "content/reading/l1-a-short-history-of-tea.md",
    "content/reading/l1-return-of-the-wolves.md",
    "content/reading/l3-academic-reading-test-1.md",
    "content/reading/l3-academic-reading-test-2.md",
]
ADMIN = {"id": None}  # only read on INSERT; all 4 exist → UPDATE path


def _commit_l1(text: str, dry_run: bool) -> dict:
    parsed = parse_reading_passage(text)
    errs = validate_reading_passage(parsed)
    if dry_run or errs:
        return {"action": "dry-run" if not errs else "errors",
                "validation_errors": errs, "slug": parsed.slug,
                "question_count": len(parsed.questions)}
    existing = (supabase_admin.table("reading_passages").select("id")
                .eq("slug", parsed.slug).limit(1).execute())
    if not existing.data:
        return {"action": "SKIPPED (slug not found — refusing to insert)", "slug": parsed.slug}
    payload = build_reading_passage_payload(parsed, parsed.slug)
    supabase_admin.table("reading_passages").update(payload).eq("slug", parsed.slug).execute()
    pid = existing.data[0]["id"]
    supabase_admin.table("reading_questions").delete().eq("passage_id", pid).execute()
    if parsed.questions:
        supabase_admin.table("reading_questions").insert(
            build_reading_question_payloads(parsed.questions, pid)).execute()
    return {"action": "updated", "slug": parsed.slug, "question_count": len(parsed.questions)}


async def main() -> None:
    dry_run = "--commit" not in sys.argv
    print(f"Mode: {'DRY-RUN' if dry_run else 'COMMIT'}  |  {len(FILES)} reading file(s)")
    for rel in FILES:
        text = Path(rel).read_text(encoding="utf-8")
        fm = yaml.safe_load(text.split("---", 2)[1]) or {}
        if fm.get("content_type") == "reading_full_test":
            res = await _import_l3_full_test(text, dry_run, ADMIN)
        else:
            res = _commit_l1(text, dry_run)
        mc = text.count("microcheck:")
        errs = res.get("validation_errors") or []
        tag = "OK" if not errs else "FAIL"
        print(f"  {tag}  {rel.split('/')[-1]} — action={res.get('action')} "
              f"microchecks={mc}" + (f"  errs={errs}" if errs else ""))
    if dry_run:
        print("→ dry-run only. Re-run with --commit to write.")


if __name__ == "__main__":
    asyncio.run(main())
