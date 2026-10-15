"""Attach already uploaded Kokoro clips after migration 318; never calls TTS.

Run with the target Supabase service configuration explicitly loaded:
    python -m scripts.backfill_personal_vocabulary_audio --project-ref PROJECT
    python -m scripts.backfill_personal_vocabulary_audio --project-ref PROJECT --apply

Dry-run is the default. Every active row's expected recording must exist and
pass signal validation before any row is changed. Missing clips must first be
rendered with local Kokoro and uploaded to the existing vocab-audio bucket.
Only counts are printed; learner words and IDs stay private.
"""
from __future__ import annotations

import argparse
import json
from urllib.parse import urlparse
from uuid import UUID

import httpx

from config import settings
from database import supabase_admin
from services.tts_audio import audio_path, KOKORO_DEFAULT_VOICE, validate_vocab_audio


def backfill(db, base: str, *, apply: bool = False, expect_count: int | None = None, user_id: str | None = None, read_audio=None) -> dict:
    rows = []
    for start in range(0, 1000000, 500):
        query = (db.table("user_vocabulary").select("id,headword,audio_headword")
                 .eq("is_archived", False).eq("is_skipped", False).eq("is_pending", False))
        if user_id:
            query = query.eq("user_id", user_id)
        batch = query.order("id").range(start, start + 499).execute().data or []
        rows.extend(batch)
        if len(batch) < 500:
            break
    else:
        raise RuntimeError("Personal vocabulary pagination did not finish.")
    if expect_count is not None and len(rows) != expect_count:
        raise ValueError("Active vocabulary count changed; reconcile before applying.")
    if read_audio is None:
        def read_audio(url):
            response = httpx.get(url, timeout=30)
            response.raise_for_status()
            return response.content
    prepared = []
    checked = set()
    for row in rows:
        text = (row["headword"] or "").strip()
        if not text:
            raise ValueError("An active vocabulary row has no headword.")
        target = base.rstrip("/") + "/storage/v1/object/public/vocab-audio/" + audio_path(text, KOKORO_DEFAULT_VOICE, "kokoro")
        if row["audio_headword"] not in ("", target):
            raise ValueError("Existing pronunciation differs; reconcile before applying.")
        if target not in checked:
            validate_vocab_audio(read_audio(target))
            checked.add(target)
        prepared.append((row, target))
    updated = 0
    for row, target in prepared:
        if not apply or row["audio_headword"] == target:
            continue
        result = (db.table("user_vocabulary").update({"audio_headword": target})
                  .eq("id", row["id"]).eq("headword", row["headword"])
                  .eq("audio_headword", row["audio_headword"])
                  .eq("is_archived", False).eq("is_skipped", False).eq("is_pending", False)
                  .execute().data or [])
        if len(result) != 1 or result[0].get("audio_headword") != target:
            raise RuntimeError("Vocabulary changed during repair; rerun to reconcile safely.")
        updated += 1
    return {"active_rows": len(rows), "verified_clips": len(checked), "updated": updated, "applied": apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-ref", required=True)
    parser.add_argument("--expect-count", type=int)
    parser.add_argument("--user-id", type=UUID, help="Optional owner scope for a synthetic staging acceptance account.")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if urlparse(settings.SUPABASE_URL).hostname != args.project_ref + ".supabase.co":
        parser.error("Configured Supabase target does not match --project-ref.")
    print(json.dumps(backfill(supabase_admin, settings.SUPABASE_URL, apply=args.apply, expect_count=args.expect_count, user_id=str(args.user_id) if args.user_id else None)))


if __name__ == "__main__":
    main()
