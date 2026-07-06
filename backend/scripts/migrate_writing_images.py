"""Re-home Task 1 writing images off the legacy Supabase project.

Context
-------
`docs/SUPABASE_REGION_MIGRATION.md` moved the database to a new Singapore
project, but the writing Task 1 image URLs were never rewritten: every
`writing_prompts.prompt_image_url` and `writing_essays.prompt_image_url` still
points at the OLD project's public storage (host `nqhrtqspznepmveyurzm`). That
project is still serving most images today, but it is decommissioned debt — the
day it is deleted, every Task 1 chart 404s (see the essay `24aca131` incident,
where a single legacy object was already lost).

This script copies each legacy image onto the CURRENT project's `writing-images`
bucket and rewrites the DB URLs to the current host. Downloads use the old
project's PUBLIC URL, so NO old-project credentials are required; uploads use the
current project's service-role client via
`services.writing_prompt_image.upload_prompt_image`.

Safety
------
- DRY RUN by default: enumerates + probes every legacy URL and prints a plan,
  writing nothing. Pass `--execute` to perform uploads + DB updates.
- Idempotent: URLs already on the current host are skipped, so a re-run after a
  partial pass only finishes the remainder.
- Broken source objects (HTTP != 200) are reported and left untouched — they
  need an admin re-upload, not a copy.
- Distinct source URLs are copied ONCE (deduped); many essays share one prompt
  image, so the upload count is the number of distinct charts, not essays.

Usage
-----
    cd backend
    python -m scripts.migrate_writing_images             # dry run
    python -m scripts.migrate_writing_images --execute   # do it
"""

from __future__ import annotations

import argparse
import sys
from typing import Optional
from urllib.parse import urlparse


def host_of(url: Optional[str]) -> Optional[str]:
    """netloc of a URL, or None for empty/unparseable input."""
    if not url:
        return None
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None


def is_legacy(url: Optional[str], current_host: str) -> bool:
    """True when `url` is a non-empty image URL NOT already on the current
    project host — i.e. it still needs re-homing. Covers the old Supabase
    project AND any other external host (e.g. a stray Cloudinary URL)."""
    h = host_of(url)
    return bool(h) and h != current_host


def current_project_host() -> str:
    from config import settings
    h = host_of(settings.SUPABASE_URL)
    if not h:
        raise SystemExit("SUPABASE_URL is unset/invalid — cannot determine current host.")
    return h


def _enumerate(supabase_admin) -> tuple[list[dict], list[dict]]:
    """All prompts + essays that carry an image URL. Essays are paginated past
    the PostgREST 1000-row cap (see the vocab_cards incident)."""
    prompts = (
        supabase_admin.table("writing_prompts")
        .select("id, prompt_image_url, prompt_image_public_id")
        .not_.is_("prompt_image_url", "null")
        .execute()
    ).data or []

    essays: list[dict] = []
    page, size = 0, 1000
    while True:
        chunk = (
            supabase_admin.table("writing_essays")
            .select("id, task_type, prompt_image_url")
            .not_.is_("prompt_image_url", "null")
            .range(page * size, page * size + size - 1)
            .execute()
        ).data or []
        essays.extend(chunk)
        if len(chunk) < size:
            break
        page += 1
    return prompts, essays


def run(execute: bool) -> int:
    import httpx

    from database import supabase_admin
    from services.writing_prompt_image import detect_format, upload_prompt_image

    current_host = current_project_host()
    prompts, essays = _enumerate(supabase_admin)

    # Distinct legacy source URLs across both tables.
    legacy_urls = sorted({
        r["prompt_image_url"]
        for r in (prompts + essays)
        if is_legacy(r.get("prompt_image_url"), current_host)
    })

    print(f"Current project host : {current_host}")
    print(f"Prompts with image   : {len(prompts)}  | essays with image: {len(essays)}")
    print(f"Distinct LEGACY URLs : {len(legacy_urls)}")
    print(f"Mode                 : {'EXECUTE' if execute else 'DRY RUN'}\n")

    remap: dict[str, tuple[str, str]] = {}   # old_url -> (new_url, new_public_id)
    broken: list[str] = []

    for url in legacy_urls:
        try:
            resp = httpx.get(url, timeout=20)
        except Exception as exc:  # noqa: BLE001
            print(f"  BROKEN  {url}  (fetch error: {exc})")
            broken.append(url)
            continue
        if resp.status_code != 200 or not resp.content:
            print(f"  BROKEN  {url}  (HTTP {resp.status_code})")
            broken.append(url)
            continue
        if detect_format(resp.content) is None:
            print(f"  BROKEN  {url}  (not a PNG/JPG/WebP payload)")
            broken.append(url)
            continue

        if not execute:
            print(f"  WOULD COPY  {url}  ({len(resp.content)} bytes)")
            continue

        up = upload_prompt_image(resp.content)
        remap[url] = (up["url"], up["public_id"])
        print(f"  COPIED  {url}\n       -> {up['url']}")

    # Rewrite DB rows (execute only).
    prompt_writes = essay_writes = 0
    if execute and remap:
        for p in prompts:
            new = remap.get(p.get("prompt_image_url"))
            if not new:
                continue
            supabase_admin.table("writing_prompts").update({
                "prompt_image_url":       new[0],
                "prompt_image_public_id": new[1],
            }).eq("id", p["id"]).execute()
            prompt_writes += 1
        for e in essays:
            new = remap.get(e.get("prompt_image_url"))
            if not new:
                continue
            supabase_admin.table("writing_essays").update({
                "prompt_image_url": new[0],
            }).eq("id", e["id"]).execute()
            essay_writes += 1

    # Summary
    would_or_did = "copied" if execute else "to copy"
    n_ok = len(remap) if execute else (len(legacy_urls) - len(broken))
    print("\n── Summary ─────────────────────────────")
    print(f"  Legacy URLs {would_or_did:>9}: {n_ok}")
    print(f"  Broken (need re-upload): {len(broken)}")
    if execute:
        print(f"  Prompt rows rewritten  : {prompt_writes}")
        print(f"  Essay  rows rewritten  : {essay_writes}")
    if broken:
        print("\n  Broken sources (admin must re-upload the chart):")
        for u in broken:
            print(f"    - {u}")
    if not execute:
        print("\n  Dry run only — re-run with --execute to apply.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--execute", action="store_true",
                    help="Perform uploads + DB rewrites (default: dry run).")
    args = ap.parse_args()
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    return run(execute=args.execute)


if __name__ == "__main__":
    sys.exit(main())
