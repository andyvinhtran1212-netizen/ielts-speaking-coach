"""
jobs/retention_sweep.py — Sprint 16.4 retention sweep (Direction A part 2).

Runs daily via a Railway cron service: `python -m jobs.retention_sweep`.
Decoupled v2 thresholds (Sprint 16.2.1): audio purged at 15 days, content at 60.

  AUDIO sweep   (15d): delete Supabase Storage recordings + NULL the audio columns
                       on responses, then stamp sessions.audio_purged_at.
  CONTENT sweep (60d): NULL the heavy text/JSONB columns on responses (transcript,
                       feedback, pronunciation_payload), then stamp
                       sessions.content_purged_at.

Aggregate / component scores are NEVER touched (sessions.band_* and
responses.overall_band / final_overall_band / final_band_p / pronunciation_score
survive forever — Andy "lưu lại điểm thành phần"). Sessions rows are NEVER
DELETEd (FK RESTRICT from grammar_recommendations — Pattern #41; scrub-in-place).

Safety:
  - DRY_RUN defaults TRUE — no writes until RETENTION_SWEEP_DRY_RUN=false is set.
  - Eligibility reuses services.retention.compute_expiry (the SAME logic the UI
    uses) so the sweep can never purge a session the UI still shows as safe.
  - Per-session errors are isolated (Pattern #29) — one failure never aborts the run.
  - Idempotent + storage-first ordering (see _purge_audio) → re-runnable, no orphans.

NOTE (Pattern #42): Andy's spec (s) was "SQL scrub first, then Storage remove".
We do the reverse (capture paths → Storage remove → scrub DB → stamp) because
SQL-first nulls audio_storage_path before the file is gone, and a partial failure
then ORPHANS the storage object — defeating the storage-cost goal. Storage-first
is orphan-safe + idempotent; the only cost is a sub-second window where audio_url
404s on a session whose audio is expiring anyway.
"""

import logging
import os
import sys
from datetime import datetime, timedelta, timezone

from database import supabase_admin
from services.retention import (
    RETENTION_AUDIO_DAYS,
    RETENTION_CONTENT_DAYS,
    compute_expiry,
)

logger = logging.getLogger("retention_sweep")

_AUDIO_BUCKET = "audio-responses"
_STORAGE_BATCH = 100   # chunk Storage.remove() to stay under payload / rate limits

# Read at call time via the module global so tests can flip it.
DRY_RUN = os.getenv("RETENTION_SWEEP_DRY_RUN", "true").lower() != "false"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _cutoff_iso(days: int) -> str:
    """ISO-Z cutoff; a session can only be eligible if started_at < this (the
    anchor max(started_at, last_accessed_at) is ≥ started_at)."""
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── Eligibility (DB pre-filter narrows; compute_expiry is authoritative) ───────

def _eligible(purged_col: str, days: int, expiry_key: str) -> list[dict]:
    cutoff = _cutoff_iso(days)
    rows = (
        supabase_admin.table("sessions")
        .select("id, user_id, started_at, last_accessed_at, audio_purged_at, content_purged_at")
        .is_(purged_col, "null")
        .lt("started_at", cutoff)
        .execute()
        .data
    ) or []
    # Confirm with the SAME policy the UI uses — never purge what the UI shows safe.
    return [r for r in rows if compute_expiry(r)[expiry_key]]


def _audio_paths(session_id: str) -> list[str]:
    """Bucket-relative keys for a session's recordings (non-null only)."""
    rows = (
        supabase_admin.table("responses")
        .select("audio_storage_path")
        .eq("session_id", session_id)
        .execute()
        .data
    ) or []
    return [r["audio_storage_path"] for r in rows if r.get("audio_storage_path")]


def _storage_remove(paths: list[str]) -> None:
    for i in range(0, len(paths), _STORAGE_BATCH):
        supabase_admin.storage.from_(_AUDIO_BUCKET).remove(paths[i:i + _STORAGE_BATCH])


# ── Per-session purges ─────────────────────────────────────────────────────────

def _purge_audio(session: dict) -> int:
    """Storage-first (orphan-safe): capture paths → remove files → scrub audio
    columns → stamp audio_purged_at. Returns the number of objects removed."""
    sid = session["id"]
    paths = _audio_paths(sid)              # capture BEFORE scrubbing audio_storage_path
    if DRY_RUN:
        return len(paths)
    if paths:
        _storage_remove(paths)             # 1. delete files first
    supabase_admin.table("responses").update(
        {"audio_url": None, "audio_storage_path": None}
    ).eq("session_id", sid).execute()      # 2. scrub audio columns
    supabase_admin.table("sessions").update(
        {"audio_purged_at": _now_iso()}
    ).eq("id", sid).execute()              # 3. stamp completion
    return len(paths)


def _purge_content(session: dict) -> None:
    """NULL the heavy text/JSONB columns (keeps every score column), then stamp
    content_purged_at. Aggregate/component scores are NOT in the update set."""
    sid = session["id"]
    if DRY_RUN:
        return
    supabase_admin.table("responses").update({
        "transcript":            None,
        "raw_transcript_text":   None,
        "feedback":              None,
        "pronunciation_payload": None,
    }).eq("session_id", sid).execute()
    supabase_admin.table("sessions").update(
        {"content_purged_at": _now_iso()}
    ).eq("id", sid).execute()


# ── Sweep operations (per-session error isolation) ─────────────────────────────

def sweep_audio() -> dict:
    eligible = _eligible("audio_purged_at", RETENTION_AUDIO_DAYS, "is_audio_purged")
    purged, objects, errors = 0, 0, []
    for s in eligible:
        try:
            objects += _purge_audio(s)
            purged += 1
        except Exception as exc:  # noqa: BLE001 — isolate; retry next run (#29)
            errors.append({"session_id": s["id"], "error": str(exc)})
            logger.warning("[sweep] audio purge failed session=%s: %s", s["id"], exc)
    return {"op": "audio", "eligible": len(eligible), "purged": purged,
            "objects": objects, "errors": errors}


def sweep_content() -> dict:
    eligible = _eligible("content_purged_at", RETENTION_CONTENT_DAYS, "is_content_purged")
    purged, errors = 0, []
    for s in eligible:
        try:
            _purge_content(s)
            purged += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"session_id": s["id"], "error": str(exc)})
            logger.warning("[sweep] content purge failed session=%s: %s", s["id"], exc)
    return {"op": "content", "eligible": len(eligible), "purged": purged, "errors": errors}


def main() -> dict:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logger.info("[sweep] start dry_run=%s audio=%dd content=%dd",
                DRY_RUN, RETENTION_AUDIO_DAYS, RETENTION_CONTENT_DAYS)
    audio = sweep_audio()
    content = sweep_content()
    summary = {"dry_run": DRY_RUN, "audio": audio, "content": content}
    logger.info(
        "[sweep] done dry_run=%s | audio eligible=%d purged=%d objects=%d errors=%d "
        "| content eligible=%d purged=%d errors=%d",
        DRY_RUN, audio["eligible"], audio["purged"], audio["objects"], len(audio["errors"]),
        content["eligible"], content["purged"], len(content["errors"]),
    )
    return summary


if __name__ == "__main__":
    result = main()
    # Non-zero exit if any session errored, so Railway surfaces a failed run.
    sys.exit(1 if (result["audio"]["errors"] or result["content"]["errors"]) else 0)
