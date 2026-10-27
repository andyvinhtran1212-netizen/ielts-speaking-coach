"""Convert stored Task 1 image URLs to private-bucket object paths.

Context
-------
`writing-images` is private. Readers sign object paths per authorized request
(`services/writing_image_access.py`) and already resolve a legacy public URL on
this project's Storage origin, so old rows keep rendering before and after
this backfill. The backfill makes the stored data canonical: every
`writing_prompts.prompt_image_url` / `writing_essays.prompt_image_url` that is
a URL into this project's `writing-images` bucket becomes the bare object path.

What it does NOT touch
----------------------
- Rows already holding a path (idempotent re-run).
- URLs on another host (legacy project, external): those objects are not in
  this bucket. `scripts/migrate_writing_images.py` re-homes them.
- A prompt whose URL path disagrees with `prompt_image_public_id` (reported
  as MISMATCH for manual review; the reader still renders the URL's object).
- No object is copied, moved or deleted.

Safety
------
- DRY RUN by default: prints the plan and probes every target object by
  signing it (a missing object is reported, it is still converted because
  the stored URL is equally broken).
- `--execute` writes with compare-and-set on the old value, so a row edited
  concurrently is skipped, not clobbered.
- `--execute` requires `--project-ref` equal to the ref in SUPABASE_URL and
  refuses the production project unless `--allow-production` is also given
  (see the production runbook in docs/WRITING_IMAGE_PRIVATE_BUCKET.md).

Usage
-----
    cd backend
    python -m scripts.backfill_writing_image_paths                     # dry run
    python -m scripts.backfill_writing_image_paths --execute --project-ref <ref>
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional
from urllib.parse import urlsplit

PRODUCTION_PROJECT_REF = "huwsmtubwulikhlmcirx"


def project_ref(supabase_url: str) -> Optional[str]:
    host = urlsplit(supabase_url or "").netloc
    if not host.endswith(".supabase.co"):
        return None
    return host[: -len(".supabase.co")] or None


def classify(ref: Optional[str], public_id: Optional[str] = None) -> tuple[str, Optional[str]]:
    """(state, new_value) for one stored ref.

    state ∈ path | convert | external | mismatch | invalid
    """
    from services.writing_image_access import _external_url, image_path

    if not ref:
        return "path", None
    if "://" not in ref:
        return ("path", None) if image_path(ref) else ("invalid", None)
    path = image_path(ref)
    if path:
        if public_id is not None and public_id != path:
            return "mismatch", None
        return "convert", path
    return ("external", None) if _external_url(ref) else ("invalid", None)


def _enumerate(client, table: str, columns: str) -> list[dict]:
    rows: list[dict] = []
    page, size = 0, 1000
    while True:
        chunk = (
            client.table(table)
            .select(columns)
            .not_.is_("prompt_image_url", "null")
            .order("id")
            .range(page * size, page * size + size - 1)
            .execute()
        ).data or []
        rows.extend(chunk)
        if len(chunk) < size:
            return rows
        page += 1


def build_plan(prompts: list[dict], essays: list[dict]) -> dict[str, list[tuple]]:
    plan: dict[str, list[tuple]] = {
        k: [] for k in ("convert", "path", "external", "mismatch", "invalid")
    }
    for table, rows in (("writing_prompts", prompts), ("writing_essays", essays)):
        for row in rows:
            public_id = row.get("prompt_image_public_id") if table == "writing_prompts" else None
            state, new = classify(row.get("prompt_image_url"), public_id)
            plan[state].append((table, row["id"], row.get("prompt_image_url"), new))
    return plan


def _host(url: Optional[str]) -> str:
    try:
        return urlsplit(url or "").netloc or "-"
    except ValueError:
        return "-"


def run(args: argparse.Namespace) -> int:
    from config import settings
    from database import supabase_admin
    from services.writing_image_access import FETCH_TTL, sign_image_paths

    ref = project_ref(settings.SUPABASE_URL)
    print(f"Project ref : {ref or '(unrecognised SUPABASE_URL)'}")
    print(f"Bucket      : {settings.WRITING_IMAGES_BUCKET}")
    print(f"Mode        : {'EXECUTE' if args.execute else 'DRY RUN'}")
    if args.execute:
        if not ref or args.project_ref != ref:
            print("Refusing to execute: --project-ref must equal the SUPABASE_URL project ref.")
            return 2
        if ref == PRODUCTION_PROJECT_REF and not args.allow_production:
            print("Refusing to execute on production without --allow-production.")
            return 2

    prompts = _enumerate(supabase_admin, "writing_prompts",
                         "id, prompt_image_url, prompt_image_public_id")
    essays = _enumerate(supabase_admin, "writing_essays", "id, prompt_image_url")
    plan = build_plan(prompts, essays)
    print(f"Rows with an image ref: prompts={len(prompts)} essays={len(essays)}\n")

    targets = sorted({new for _t, _i, _o, new in plan["convert"]})
    signed = sign_image_paths(targets, FETCH_TTL) if targets else {}
    missing = [p for p in targets if p not in signed]

    for table, row_id, old, new in plan["convert"]:
        flag = "" if new in signed else "  [object not signable/missing]"
        print(f"  CONVERT   {table} {row_id}: {_host(old)} → {new}{flag}")
    for state in ("mismatch", "invalid"):
        for table, row_id, old, _new in plan[state]:
            print(f"  {state.upper():<9} {table} {row_id}: host={_host(old)}")
    externals: dict[str, int] = {}
    for _t, _i, old, _n in plan["external"]:
        externals[_host(old)] = externals.get(_host(old), 0) + 1

    written = skipped = 0
    if args.execute:
        for table, row_id, old, new in plan["convert"]:
            res = (
                supabase_admin.table(table)
                .update({"prompt_image_url": new})
                .eq("id", row_id)
                .eq("prompt_image_url", old)   # compare-and-set
                .execute()
            )
            if res.data:
                written += 1
            else:
                skipped += 1
                print(f"  SKIPPED   {table} {row_id}: changed since enumeration")

    by_table = lambda state, t: sum(1 for r in plan[state] if r[0] == t)  # noqa: E731
    print("\n── Summary ─────────────────────────────")
    for state in ("convert", "path", "external", "mismatch", "invalid"):
        print(f"  {state:<9} prompts={by_table(state, 'writing_prompts'):<4} "
              f"essays={by_table(state, 'writing_essays')}")
    print(f"  distinct target objects={len(targets)} missing={len(missing)}")
    if externals:
        print("  external hosts (left unchanged): "
              + ", ".join(f"{h}×{n}" for h, n in sorted(externals.items())))
    if args.execute:
        print(f"  written={written} skipped(concurrent change)={skipped}")
    else:
        print("\n  DRY RUN — nothing written. Re-run with --execute --project-ref <ref>.")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--execute", action="store_true", help="write the conversions")
    parser.add_argument("--project-ref", help="required with --execute; must match SUPABASE_URL")
    parser.add_argument("--allow-production", action="store_true",
                        help="permit --execute on the production project (runbook only)")
    return run(parser.parse_args(argv))


if __name__ == "__main__":
    sys.exit(main())
