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
import re
import sys
from datetime import datetime, timedelta, timezone

from database import supabase_admin
from services.speaking_submission import submission_id
from services import retention_policy
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

_PAGE = 1000  # PostgREST's default max-rows; every page is read until a short one.


def _candidate_pages(purged_col: str, cutoff: str):
    """Every pre-filtered session, one page at a time in a stable order (id).
    A single capped read would let sessions the sweep keeps fill the first
    page on every run, so later candidates were never reached. The reads all
    finish before any purge (the caller collects the list first)."""
    offset = 0
    while True:
        page = (
            supabase_admin.table("sessions")
            .select(
                "id, user_id, status, started_at, resume_expires_at, "
                "last_accessed_at, audio_purged_at, content_purged_at"
            )
            .is_(purged_col, "null")
            .lt("started_at", cutoff)
            .order("id")
            .range(offset, offset + _PAGE - 1)
            .execute()
            .data
        ) or []
        if page:
            yield page
        if len(page) < _PAGE:
            return
        offset += _PAGE


def _eligible(purged_col: str, days: int, expiry_key: str, *, per_user: bool = False) -> list[dict]:
    """``per_user`` (content only, plan 5.14): after the default pre-filter,
    each row's owner window comes from ``retention_policy.content_windows``.
    Only owners on today's rule (``default``) are purged; ``open`` and
    ``until`` owners are never purged by this sweep yet, and an owner whose
    window could not be read is skipped. Audio never uses it (FR-029)."""
    cutoff = _cutoff_iso(days)
    out, skipped, deferred = [], 0, 0
    for rows in _candidate_pages(purged_col, cutoff):
        # Confirm with the SAME policy the UI uses — never purge what the UI shows safe.
        if not per_user:
            out.extend(r for r in rows if compute_expiry(r)[expiry_key])
            continue
        windows = retention_policy.content_windows((r.get("user_id") for r in rows), db=supabase_admin)
        for r in rows:
            window = windows.get(str(r.get("user_id")))
            if window is None:
                skipped += 1
                continue
            if window.mode != "default":
                # open: nothing to purge. until: hidden at read time only; the real
                # purge by course access comes with an RPC that checks and purges
                # under the user's credit lock (follow-up, Andy 23/11 option 1).
                deferred += 1
                continue
            if compute_expiry(r)[expiry_key]:
                out.append(r)
    if skipped:
        logger.warning("[sweep] content skipped=%d sessions (retention window unknown)", skipped)
    if deferred:
        logger.info("[sweep] content deferred=%d sessions (course-access window, purge not enabled)", deferred)
    return out


def _audio_paths(session_id: str, user_id: str | None = None) -> list[str]:
    """Bucket-relative keys for a session's recordings (non-null only)."""
    rows = (
        supabase_admin.table("responses")
        .select("audio_storage_path")
        .eq("session_id", session_id)
        .execute()
        .data
    ) or []
    paths = [r["audio_storage_path"] for r in rows if r.get("audio_storage_path")]
    # Immutable take paths may outlive the single canonical row (retakes or a
    # losing concurrent upload). Keep their existing 15-day retention deadline.
    if user_id:
        if not all(re.fullmatch(r"[A-Za-z0-9_-]+", value) for value in (user_id, session_id)):
            raise ValueError("invalid recording owner prefix")
        prefix = f"{user_id}/{session_id}"
        offset = 0
        while True:
            objects = supabase_admin.storage.from_(_AUDIO_BUCKET).list(
                prefix, {"limit": 1000, "offset": offset, "sortBy": {"column": "name", "order": "asc"}},
            )
            for item in objects:
                name = item.get("name")
                if not isinstance(name, str) or "/" in name or "\\" in name:
                    continue
                path = f"{prefix}/{name}"
                if submission_id({"audio_storage_path": path}):
                    paths.append(path)
            if len(objects) < 1000:
                break
            offset += 1000
    return list(dict.fromkeys(paths))


def _storage_remove(paths: list[str]) -> None:
    for i in range(0, len(paths), _STORAGE_BATCH):
        supabase_admin.storage.from_(_AUDIO_BUCKET).remove(paths[i:i + _STORAGE_BATCH])


# ── Per-session purges ─────────────────────────────────────────────────────────

def _retire_expired_open_session(session: dict) -> None:
    """Make an ancient open row terminal before response-retention writes.

    Migration 224 deliberately rejects response mutations on an expired
    ``in_progress`` Speaking player. Retention is not learner activity, but it
    still updates the same child rows. A 15/60-day session is far beyond the
    24-hour hard player TTL, so the truthful parent transition is ``abandoned``
    before scrubbing. Missing/malformed/future expiry fails closed instead of
    weakening the database guard.
    """
    if session.get("status") != "in_progress":
        return
    raw_expiry = session.get("resume_expires_at")
    try:
        expiry = datetime.fromisoformat(str(raw_expiry).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise RuntimeError("open retention candidate has invalid resume_expires_at")
    if expiry.tzinfo is None or expiry.utcoffset() is None:
        raise RuntimeError("open retention candidate has naive resume_expires_at")
    if expiry > datetime.now(timezone.utc):
        raise RuntimeError("open retention candidate is still resumable")

    supabase_admin.table("sessions").update({
        "status": "abandoned",
    }).eq("id", session["id"]).eq("status", "in_progress").execute()
    session["status"] = "abandoned"

def _purge_audio(session: dict) -> int:
    """Storage-first (orphan-safe): capture paths → remove files → scrub audio
    columns → stamp audio_purged_at. Returns the number of objects removed."""
    sid = session["id"]
    paths = _audio_paths(sid, session.get("user_id"))              # capture BEFORE scrubbing audio_storage_path
    if DRY_RUN:
        return len(paths)
    if paths:
        _storage_remove(paths)             # 1. delete files first
    _retire_expired_open_session(session)  # 2. make TTL-expired player terminal
    supabase_admin.table("responses").update(
        {"audio_url": None, "audio_storage_path": None}
    ).eq("session_id", sid).execute()      # 3. scrub audio columns
    supabase_admin.table("sessions").update(
        {"audio_purged_at": _now_iso()}
    ).eq("id", sid).execute()              # 4. stamp completion
    return len(paths)


def _purge_content(session: dict) -> None:
    """NULL the heavy text/JSONB columns (keeps every score column), then stamp
    content_purged_at. Aggregate/component scores are NOT in the update set."""
    sid = session["id"]
    if DRY_RUN:
        return
    _retire_expired_open_session(session)
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


def _still_purgeable(session: dict) -> bool:
    """Guard at the purge itself (FR-048): the batch decision in ``_eligible``
    may be stale once a course is granted or renewed while the run goes on.
    Re-read this session and its owner's window now, through the same client
    and rule, and purge only if both still say so. Unreadable → keep."""
    sid = session["id"]
    fresh = (
        supabase_admin.table("sessions")
        .select(
            "id, user_id, status, started_at, resume_expires_at, "
            "last_accessed_at, audio_purged_at, content_purged_at"
        )
        .eq("id", sid)
        .execute()
        .data
    ) or []
    if not fresh or fresh[0].get("content_purged_at"):
        return False
    row = fresh[0]
    window = retention_policy.content_windows([row.get("user_id")], db=supabase_admin).get(
        str(row.get("user_id")))
    if window is None or window.mode != "default":
        return False
    return bool(compute_expiry(row)["is_content_purged"])


def sweep_content() -> dict:
    eligible = _eligible("content_purged_at", RETENTION_CONTENT_DAYS, "is_content_purged", per_user=True)
    purged, kept, errors = 0, 0, []
    for s in eligible:
        try:
            if not _still_purgeable(s):
                kept += 1
                continue
            _purge_content(s)
            purged += 1
        except Exception as exc:  # noqa: BLE001
            errors.append({"session_id": s["id"], "error": str(exc)})
            logger.warning("[sweep] content purge failed session=%s: %s", s["id"], exc)
    if kept:
        logger.warning("[sweep] content kept=%d sessions (window changed or unreadable at purge time)", kept)
    return {"op": "content", "eligible": len(eligible), "purged": purged, "kept": kept, "errors": errors}


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
