"""Re-home AUDIO URLs off the legacy Supabase project so it can be deleted.

Context
-------
`docs/SUPABASE_REGION_MIGRATION.md` moved the database to the current Singapore
project (`huwsmtubwulikhlmcirx`). Storage objects WERE copied during that
migration, but a set of DB columns still carry the OLD project's public-storage
host (`nqhrtqspznepmveyurzm`):

    responses.audio_url          5002   (bucket: audio-responses)
    vocab_cards.audio_headword    286   (bucket: vocab-audio)
    vocab_cards.audio_example     286   (bucket: vocab-audio)
    quiz_questions.audio_url      261   (bucket: vocab-audio)
    ────────────────────────────────
                                 5835

`scripts/migrate_writing_images.py` fixed the *image* half of this debt and its
doc concluded the old project could then be decommissioned — that conclusion was
incomplete: it never covered audio. Deleting the legacy project today would
silently break audio replay for ~81% of all graded Speaking responses plus vocab
and quiz pronunciation.

What makes this cheap: every one of those objects is ALREADY on the current
project at the IDENTICAL storage path (dry run 2026-07-26: 5570/5570 distinct
target URLs serve 200). So the fix is a pure host swap in the DB, not a 5.7GB
re-upload, and no audio is at risk.

The copy leg below therefore expects to do nothing — it exists as a safety net
for objects the migration's storage copy could have missed. It downloads from
the legacy project's PUBLIC URL, so NO old-project credentials are required.

Note on trailing '?': 28 prod rows end in a bare '?' (an older supabase-py
get_public_url quirk). `storage_path_of` strips it — an ad-hoc SQL join that
does not will wrongly report those objects as missing.

Safety
------
- DRY RUN by default: enumerates, probes and prints a plan, writing nothing.
  Pass `--execute` to copy the missing objects + rewrite the DB.
- Idempotent: only rows still on the legacy host are selected, so a re-run after
  a partial pass finishes the remainder and a re-run after a full pass is a
  no-op.
- Path-preserving: an object is copied to the SAME bucket + SAME path, so the
  URL rewrite is a pure host substitution.
- Never deletes anything, on either project.
- Paginates past the PostgREST 1000-row cap (this repo has been bitten by that
  cap repeatedly — see the vocab_cards incident).
- Unrecoverable objects (gone from BOTH projects) are reported explicitly. They
  are still rewritten, because a legacy URL is guaranteed dead once the project
  is deleted — rewriting loses nothing and lets verification reach a clean 0.
  Use `--skip-unrecoverable` to leave those rows untouched instead.

Usage
-----
    cd backend
    python -m scripts.migrate_legacy_audio_urls                 # dry run (read-only)
    python -m scripts.migrate_legacy_audio_urls --limit 20      # small canary plan
    python -m scripts.migrate_legacy_audio_urls --execute       # apply
    python -m scripts.migrate_legacy_audio_urls                 # verify → expect 0

Requires the CURRENT project's SUPABASE_URL + SUPABASE_SERVICE_KEY (already in
`backend/.env`).
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from urllib.parse import urlparse

LEGACY_HOST = "nqhrtqspznepmveyurzm.supabase.co"

# (table, column, bucket) — every DB site that stores a public storage URL.
TARGETS: list[tuple[str, str, str]] = [
    ("responses",      "audio_url",      "audio-responses"),
    ("vocab_cards",    "audio_headword", "vocab-audio"),
    ("vocab_cards",    "audio_example",  "vocab-audio"),
    ("quiz_questions", "audio_url",      "vocab-audio"),
]

_PUBLIC_PREFIX = "/storage/v1/object/public/"

_CONTENT_TYPES = {
    ".webm": "audio/webm",
    ".mp3":  "audio/mpeg",
    ".m4a":  "audio/mp4",
    ".mp4":  "audio/mp4",
    ".wav":  "audio/wav",
    ".ogg":  "audio/ogg",
    ".oga":  "audio/ogg",
    ".flac": "audio/flac",
}


def host_of(url: Optional[str]) -> Optional[str]:
    """netloc of a URL, or None for empty/unparseable input."""
    if not url:
        return None
    try:
        return urlparse(url).netloc or None
    except Exception:
        return None


def current_project_host() -> str:
    from config import settings
    h = host_of(settings.SUPABASE_URL)
    if not h:
        raise SystemExit("SUPABASE_URL is unset/invalid — cannot determine current host.")
    if h == LEGACY_HOST:
        raise SystemExit(
            f"SUPABASE_URL points at the LEGACY project ({h}). Refusing to run — "
            "point it at the current project first."
        )
    return h


def storage_path_of(url: str, bucket: str) -> Optional[str]:
    """Object path inside `bucket` for a public storage URL, or None if the URL
    isn't a public-object URL for that bucket."""
    marker = f"{_PUBLIC_PREFIX}{bucket}/"
    idx = url.find(marker)
    if idx == -1:
        return None
    path = url[idx + len(marker):]
    # Strip any query string / fragment (get_public_url has historically
    # appended a bare "?" in some supabase-py versions).
    for sep in ("?", "#"):
        if sep in path:
            path = path.split(sep, 1)[0]
    return path or None


def content_type_for(path: str, fallback: Optional[str]) -> str:
    dot = path.rfind(".")
    if dot != -1:
        ext = path[dot:].lower()
        if ext in _CONTENT_TYPES:
            return _CONTENT_TYPES[ext]
    if fallback and fallback.split("/", 1)[0] == "audio":
        return fallback
    return "application/octet-stream"


def to_current(url: str, current_host: str) -> str:
    """Pure host swap — preserves bucket + path, so it resolves to the object
    already copied to the current project."""
    return url.replace(LEGACY_HOST, current_host)


def _enumerate(supabase_admin, table: str, column: str) -> list[dict]:
    """Every row whose `column` still points at the legacy host, paginated past
    the PostgREST 1000-row cap."""
    out: list[dict] = []
    page, size = 0, 1000
    while True:
        chunk = (
            supabase_admin.table(table)
            .select(f"id, {column}")
            .like(column, f"%{LEGACY_HOST}%")
            .order("id")
            .range(page * size, page * size + size - 1)
            .execute()
        ).data or []
        out.extend(chunk)
        if len(chunk) < size:
            break
        page += 1
    return out


def _probe_many(client, urls: list[str], workers: int,
                attempts: int = 3) -> dict[str, bool]:
    """HEAD each URL concurrently → {url: serves}. httpx clients are safe to
    share across threads (unlike the PostgREST singleton, which we never thread).

    Retries before declaring an object missing. A false "missing" is the one
    genuinely harmful outcome here: it would make the script re-upload the
    legacy copy over a perfectly good current object. Under 16-way concurrency
    a plain single-shot probe reproducibly flakes on a handful of URLs, so a
    negative is only trusted after `attempts` tries with backoff.
    """
    def probe_once(u: str) -> bool:
        r = client.head(u, timeout=30, follow_redirects=True)
        if r.status_code == 200:
            return True
        # Some storage/CDN edges don't answer HEAD — fall back to a ranged GET.
        r = client.get(u, timeout=30, follow_redirects=True,
                       headers={"Range": "bytes=0-0"})
        return r.status_code in (200, 206)

    def probe(u: str) -> tuple[str, bool]:
        for i in range(attempts):
            try:
                if probe_once(u):
                    return u, True
            except Exception:  # noqa: BLE001 - transport flake; retry below
                pass
            if i < attempts - 1:
                time.sleep(0.4 * (i + 1))
        return u, False

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return dict(pool.map(probe, urls))


def run(execute: bool, limit: Optional[int], workers: int,
        skip_unrecoverable: bool) -> int:
    import httpx

    from database import supabase_admin

    current_host = current_project_host()
    print(f"Legacy host  : {LEGACY_HOST}")
    print(f"Current host : {current_host}")
    print(f"Mode         : {'EXECUTE' if execute else 'DRY RUN'}"
          + (f"   (limit {limit})" if limit else "") + "\n")

    # ── Enumerate every legacy-pointing row ──────────────────────────────────
    work: list[dict] = []   # {table, column, bucket, id, old, path, new}
    unparseable: list[tuple[str, str, str]] = []

    for table, column, bucket in TARGETS:
        rows = _enumerate(supabase_admin, table, column)
        print(f"  {table}.{column:<15} legacy rows: {len(rows)}")
        for r in rows:
            old = r.get(column)
            path = storage_path_of(old, bucket) if old else None
            if not path:
                unparseable.append((table, str(r.get("id")), old or ""))
                continue
            work.append({
                "table": table, "column": column, "bucket": bucket,
                "id": r["id"], "old": old, "path": path,
                "new": to_current(old, current_host),
            })

    print(f"\nTotal legacy rows: {len(work) + len(unparseable)}"
          f"  (parseable: {len(work)}, unparseable: {len(unparseable)})")

    if limit:
        work = work[:limit]
        print(f"Limited to first {len(work)} rows for this run.")

    if not work and not unparseable:
        print("\n✅ Nothing to do — no DB row references the legacy project.")
        print("   The legacy project is safe to delete (re-verify storage/auth separately).")
        return 0

    # ── Which target objects are already on the current project? ─────────────
    distinct_new = sorted({w["new"] for w in work})
    print(f"\nProbing {len(distinct_new)} distinct target URLs on the current "
          f"project ({workers} workers)…")
    with httpx.Client(follow_redirects=True) as client:
        present = _probe_many(client, distinct_new, workers)

        missing_new = [u for u, ok in present.items() if not ok]
        print(f"  already present : {len(distinct_new) - len(missing_new)}")
        print(f"  MISSING         : {len(missing_new)}")

        # ── Copy the missing objects (legacy public URL → current bucket) ────
        # Map target-URL -> (bucket, path) for the missing set.
        need_copy: dict[str, dict] = {}
        for w in work:
            if w["new"] in missing_new and w["new"] not in need_copy:
                need_copy[w["new"]] = w

        copied, unrecoverable_urls = 0, set()
        if need_copy:
            print(f"\n{'Copying' if execute else 'WOULD COPY'} "
                  f"{len(need_copy)} object(s) legacy → current:")
        for new_url, w in need_copy.items():
            src = w["old"]
            try:
                resp = client.get(src, timeout=60)
            except Exception as exc:  # noqa: BLE001
                print(f"  UNRECOVERABLE  {w['bucket']}/{w['path']}  (fetch error: {exc})")
                unrecoverable_urls.add(new_url)
                continue
            if resp.status_code != 200 or not resp.content:
                print(f"  UNRECOVERABLE  {w['bucket']}/{w['path']}  "
                      f"(legacy HTTP {resp.status_code})")
                unrecoverable_urls.add(new_url)
                continue

            ctype = content_type_for(w["path"], resp.headers.get("content-type"))
            if not execute:
                print(f"  WOULD COPY  {w['bucket']}/{w['path']}  "
                      f"({len(resp.content)} bytes, {ctype})")
                continue
            try:
                supabase_admin.storage.from_(w["bucket"]).upload(
                    path=w["path"],
                    file=resp.content,
                    file_options={"content-type": ctype, "upsert": "true"},
                )
                copied += 1
                print(f"  COPIED  {w['bucket']}/{w['path']}  ({len(resp.content)} bytes)")
            except Exception as exc:  # noqa: BLE001
                print(f"  UPLOAD FAILED  {w['bucket']}/{w['path']}: {exc}")
                unrecoverable_urls.add(new_url)

    # ── Rewrite the DB ───────────────────────────────────────────────────────
    if skip_unrecoverable and unrecoverable_urls:
        before = len(work)
        work = [w for w in work if w["new"] not in unrecoverable_urls]
        print(f"\n--skip-unrecoverable: holding back {before - len(work)} row(s).")

    written = 0
    if execute:
        print(f"\nRewriting {len(work)} DB row(s)…")
        for i, w in enumerate(work, 1):
            try:
                (supabase_admin.table(w["table"])
                 .update({w["column"]: w["new"]})
                 .eq("id", w["id"]).execute())
                written += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  WRITE FAILED  {w['table']}.{w['column']} id={w['id']}: {exc}")
            if i % 250 == 0:
                print(f"    … {i}/{len(work)}")
    else:
        by_col: dict[str, int] = {}
        for w in work:
            by_col[f"{w['table']}.{w['column']}"] = by_col.get(
                f"{w['table']}.{w['column']}", 0) + 1
        print("\nWOULD REWRITE:")
        for k, v in sorted(by_col.items()):
            print(f"  {k:<32} {v}")
        if work:
            s = work[0]
            print(f"\n  example:\n    {s['old']}\n -> {s['new']}")

    # ── Summary ──────────────────────────────────────────────────────────────
    print("\n── Summary ─────────────────────────────")
    print(f"  Objects {'copied' if execute else 'to copy'}      : "
          f"{copied if execute else len(need_copy) - len(unrecoverable_urls)}")
    print(f"  Rows {'rewritten' if execute else 'to rewrite'}      : "
          f"{written if execute else len(work)}")
    print(f"  Unrecoverable objects : {len(unrecoverable_urls)}")
    print(f"  Unparseable URLs      : {len(unparseable)}")

    if unrecoverable_urls:
        print("\n  ⚠ Gone from BOTH projects — these recordings have no audio either way:")
        for u in sorted(unrecoverable_urls):
            print(f"    - {u}")
    if unparseable:
        print("\n  ⚠ Legacy URLs that are not public-object URLs (left untouched):")
        for t, rid, u in unparseable[:20]:
            print(f"    - {t} id={rid}  {u[:110]}")
        if len(unparseable) > 20:
            print(f"    … and {len(unparseable) - 20} more")

    if not execute:
        print("\n  Dry run only — re-run with --execute to apply.")
    else:
        print("\n  Done. Re-run WITHOUT --execute to verify it reports 0 legacy rows.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(
        description="Rewrite legacy-project audio URLs onto the current Supabase project.")
    ap.add_argument("--execute", action="store_true",
                    help="Copy missing objects + rewrite DB (default: dry run).")
    ap.add_argument("--limit", type=int, default=None,
                    help="Only process the first N rows (canary run).")
    ap.add_argument("--workers", type=int, default=16,
                    help="Concurrent HEAD probes (default 16).")
    ap.add_argument("--skip-unrecoverable", action="store_true",
                    help="Leave rows whose object is gone from both projects untouched.")
    args = ap.parse_args()
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except Exception:
        pass
    return run(execute=args.execute, limit=args.limit, workers=args.workers,
               skip_unrecoverable=args.skip_unrecoverable)


if __name__ == "__main__":
    sys.exit(main())
