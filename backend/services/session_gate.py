"""One active session per learner account (COURSEACCESS-0055 T009, plan 5.13).

Only while runtime flag ``single_session_learners`` is on (default off), and
only for ``users.role`` ``user`` / ``student``: instructors and admins never
pass through here. Self-built on purpose: Supabase's own "single session per
user" also signs out admins and never asks first.

A learner session is in one of three states:
  * current      — its ``session_id`` claim is the one stored in
                   ``learner_active_sessions`` (mig 388): every API works;
  * not claimed  — the account already has another current session: learner
                   routes answer 409 ``session_not_current``; only the three
                   ``/api/account/session*`` routes and exempt/public routes
                   work, so "Huỷ" on screen 8a is real;
  * displaced    — another device pressed "Tiếp tục ở đây"; GoTrue rejects
                   its token, and ``routers.auth.get_supabase_user`` answers
                   401 ``session_displaced`` instead of the generic 401.

A claim never runs at sign-in: other sessions are deleted only when the
learner presses "Tiếp tục ở đây" AND the server confirms there is no timed
work (``services.timed_work``). An unknown timed-work answer refuses the claim.
Every revoke decision (claim, revoke-all, a pending revoke) is made inside one
direct-connection transaction holding the account's advisory lock, which every
timed-work start also takes (mig 388 triggers): a racing start is either seen
or refused, never missed.

Failure posture: this gate stops account sharing, it does not protect paid AI,
so a lookup error in :func:`ensure_current` lets the request through (logged);
one DB blip must never throw a learner out of an exam. The write paths (claim,
revoke-all) fail closed with 503 and change nothing.

Cost: flag off → no query beyond the cached runtime flag. Flag on → one query
per request (``users.role`` with the embedded session row), remembered for the
request in the activation-gate memo.
"""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy import text

from database import supabase_admin
from services import activation_gate, login_events, runtime_flags, staff_security, timed_work, token_claims

logger = logging.getLogger(__name__)

FLAG = "single_session_learners"
LEARNER_ROLES = frozenset({"user", "student"})
DEVICE_LABEL_MAX = 120

_MEMO_KEY = "session_gate_ok"
_SESSION_COLUMNS = "session_id, device_label, claimed_at, revoke_pending_at"


# ── Small helpers ────────────────────────────────────────────────────────────

def _error(status: int, code: str, **extra: Any) -> HTTPException:
    return HTTPException(status_code=status, detail={"error_code": code, **extra})


def _uuid_or_none(value: Any) -> Optional[str]:
    if not isinstance(value, str):
        return None
    try:
        return str(uuid.UUID(value))
    except ValueError:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def session_id_of(authorization: Optional[str], user_id: str) -> Optional[str]:
    """The ``session_id`` claim of an ALREADY ACCEPTED token of ``user_id``."""
    return _uuid_or_none(token_claims.accepted_token_claims(authorization, user_id).get("session_id"))


async def flag_on() -> bool:
    # on_error=False: an unreadable flag switches the gate off (fail-open, see
    # module docstring), never on.
    try:
        return bool(await asyncio.to_thread(runtime_flags.is_enabled, FLAG, False, on_error=False))
    except Exception as exc:
        logger.warning("[session] flag_lookup_failed: %r", exc)
        return False


_BROWSERS = (  # order matters: Edge and Opera also say "Chrome", Chrome says "Safari"
    (re.compile(r"\bEdg(?:e|A|iOS)?/"), "Edge"),
    (re.compile(r"\b(?:OPR|Opera)/"), "Opera"),
    (re.compile(r"\bSamsungBrowser/"), "Samsung Internet"),
    (re.compile(r"\b(?:Chrome|CriOS)/"), "Chrome"),
    (re.compile(r"\b(?:Firefox|FxiOS)/"), "Firefox"),
    (re.compile(r"\bSafari/"), "Safari"),
)
_SYSTEMS = (
    (re.compile(r"\biPad\b"), "iPad"),
    (re.compile(r"\biPhone\b"), "iPhone"),
    (re.compile(r"\bAndroid\b"), "Android"),
    (re.compile(r"\bCrOS\b"), "ChromeOS"),
    (re.compile(r"\bWindows\b"), "Windows"),
    (re.compile(r"\bMac OS X\b|\bMacintosh\b"), "macOS"),
    (re.compile(r"\bLinux\b"), "Linux"),
)


def device_label_from(user_agent: Optional[str]) -> Optional[str]:
    """"Chrome trên Windows" from a User-Agent, or None when neither part is
    recognised. Pure; reused by G04-T16 (learner_login_events)."""
    if not user_agent or not isinstance(user_agent, str):
        return None
    ua = user_agent[:512]
    browser = next((name for pattern, name in _BROWSERS if pattern.search(ua)), None)
    system = next((name for pattern, name in _SYSTEMS if pattern.search(ua)), None)
    if browser and system:
        label = f"{browser} trên {system}"
    else:
        label = browser or system
    return label[:DEVICE_LABEL_MAX] if label else None


# ── Reads and writes (seams for tests) ───────────────────────────────────────

def _load(user_id: str) -> tuple[Optional[str], Optional[dict]]:
    """``(users.role, learner_active_sessions row or None)`` in one query."""
    rows = (supabase_admin.table("users")
            .select(f"role, learner_active_sessions({_SESSION_COLUMNS})")
            .eq("id", str(user_id)).limit(1).execute().data or [])
    if not rows:
        return None, None
    embedded = rows[0].get("learner_active_sessions")
    if isinstance(embedded, list):  # PostgREST may render a 1:1 embed as a list
        embedded = embedded[0] if embedded else None
    return rows[0].get("role"), (embedded or None)


def _insert_first(user_id: str, session_id: str, device_label: Optional[str]) -> Optional[dict]:
    """Record the first current session of an account. None when another
    request won the race (the caller re-reads)."""
    rows = (supabase_admin.table("learner_active_sessions")
            .upsert({"user_id": str(user_id), "session_id": session_id, "device_label": device_label},
                    on_conflict="user_id", ignore_duplicates=True, default_to_null=False)
            .execute().data or [])
    return rows[0] if rows else None


def _read_row(user_id: str) -> Optional[dict]:
    rows = (supabase_admin.table("learner_active_sessions").select(_SESSION_COLUMNS)
            .eq("user_id", str(user_id)).limit(1).execute().data or [])
    return rows[0] if rows else None


def _displaced_row(user_id: str, session_id: str) -> Optional[dict]:
    rows = (supabase_admin.table("learner_active_sessions").select("displaced_at")
            .eq("user_id", user_id).eq("previous_session_id", session_id)
            .limit(1).execute().data or [])
    return rows[0] if rows else None


def _engine() -> Any:
    from routers import admin as admin_module  # local — heavy router module
    return admin_module._db_engine


async def _timed(user_id: str) -> Optional[timed_work.TimedWork]:
    return await asyncio.to_thread(timed_work.active_timed_work, user_id)


async def _current_row(user_id: str, session_id: str, user_agent: Optional[str]) -> tuple[dict, bool]:
    """The stored row, creating it for this session when the account has none
    (no session is deleted); the flag says whether this call created it."""
    row = await asyncio.to_thread(_insert_first, user_id, session_id, device_label_from(user_agent))
    if row is not None:
        return row, True
    row = await asyncio.to_thread(_read_row, user_id)
    if row is None:
        raise RuntimeError("learner_active_sessions row missing after insert")
    return row, False


async def _record(user_id: str, session_id: Optional[str], outcome: str, authorization: Optional[str],
                  user_agent: Optional[str] = None, **fields: Any) -> None:
    """One "Lần đăng nhập gần đây" event (G04-T16). Only called on flag-on,
    learner paths; never raises and never changes the caller's answer."""
    try:
        if "method" not in fields:
            fields["method"] = login_events.method_from_amr(
                token_claims.accepted_token_claims(authorization, user_id))
        await asyncio.to_thread(login_events.record, user_id, session_id, outcome,
                                user_agent=user_agent, **fields)
    except Exception as exc:  # record() never raises; this guards the thread hop
        logger.warning("[session] login_event_failed outcome=%s user=%s: %r", outcome, user_id, exc)


async def _lock_account(conn: Any, user_id: str) -> None:
    """The per-account lock every timed-work start also takes (mig 388
    triggers). Revoke decisions look for timed work only while holding it, so
    a racing start is either seen or refused; never missed (FR-040/041)."""
    await conn.execute(text("SET LOCAL lock_timeout = '5s'"))
    await conn.execute(text("SELECT public.learner_session_lock(CAST(:uid AS uuid))"), {"uid": user_id})


async def _session_alive(conn: Any, user_id: str, session_id: str) -> bool:
    """Whether ``session_id`` still exists in ``auth.sessions``. Read under the
    account lock: a claim that lost a race to another claim must not delete
    the winner's session."""
    found = (await conn.execute(text(
        "SELECT 1 FROM auth.sessions WHERE id = CAST(:sid AS uuid) AND user_id = CAST(:uid AS uuid)"),
        {"uid": user_id, "sid": session_id})).scalar()
    return found is not None


# ── Gate ─────────────────────────────────────────────────────────────────────

def _memo() -> Optional[dict]:
    return activation_gate._memo.get()


async def ensure_current(user_id: str, authorization: Optional[str], user_agent: Optional[str] = None) -> None:
    """Called by ``activation_gate.require_active_learner`` after the
    activation check. Raises 409 ``session_not_current`` for a learner session
    that is not the current one; everything else passes."""
    if not await flag_on():
        return
    memo = _memo()
    if memo is not None and memo.get(_MEMO_KEY) == str(user_id):
        return
    session_id = session_id_of(authorization, user_id)
    if session_id is None:
        logger.warning("[session] gate_no_session_id user=%s", user_id)
        return
    try:
        role, row = await asyncio.to_thread(_load, user_id)
        if role not in LEARNER_ROLES:
            row = None
        elif row is None:
            row, created = await _current_row(user_id, session_id, user_agent)
            if created:
                await _record(user_id, session_id, "signed_in", authorization, user_agent)
    except Exception as exc:
        logger.warning("[session] gate_lookup_failed user=%s: %r", user_id, exc)
        return
    if role not in LEARNER_ROLES:
        if memo is not None:
            memo[_MEMO_KEY] = str(user_id)
        return
    if str(row.get("session_id")) != session_id:
        raise _error(409, "session_not_current")
    if row.get("revoke_pending_at"):
        await _finish_pending_revoke(user_id, session_id)
    if memo is not None:
        memo[_MEMO_KEY] = str(user_id)


async def _finish_pending_revoke(user_id: str, session_id: str) -> None:
    """"Sign out everywhere" kept this session for its timed work; once that
    work is over, sign it out. Decided under the account lock, so a timed
    start racing it is seen. Unknown timed state or a failed delete → pass."""
    engine = _engine()
    if engine is None:
        logger.error("[session] pending_revoke_unavailable (no DATABASE_URL) user=%s", user_id)
        return
    try:
        async with engine.begin() as conn:
            await _lock_account(conn, user_id)
            pending = (await conn.execute(text(
                "SELECT session_id::text FROM public.learner_active_sessions "
                "WHERE user_id = CAST(:uid AS uuid) AND revoke_pending_at IS NOT NULL FOR UPDATE"),
                {"uid": user_id})).scalar()
            if pending != session_id:
                return
            try:
                if await _timed(user_id) is not None:
                    return
            except Exception as exc:
                logger.warning("[session] pending_revoke_timed_lookup_failed user=%s: %r", user_id, exc)
                return
            await conn.execute(text(
                "DELETE FROM auth.sessions WHERE user_id = CAST(:uid AS uuid) AND id = CAST(:sid AS uuid)"),
                {"uid": user_id, "sid": session_id})
            await conn.execute(text(
                "DELETE FROM public.learner_active_sessions WHERE user_id = CAST(:uid AS uuid)"),
                {"uid": user_id})
    except Exception as exc:
        logger.error("[session] pending_revoke_failed user=%s: %r", user_id, exc)
        return
    logger.info("[session] pending_revoke_done user=%s", user_id)
    raise _error(401, "session_revoked")


# ── /api/account/session* ────────────────────────────────────────────────────

def _disabled_status() -> dict:
    return {"enabled": False, "state": "current", "other_session": None, "timed_activity": None}


async def status(user_id: str, authorization: Optional[str], user_agent: Optional[str] = None) -> dict:
    """``GET /api/account/session/status``."""
    if not await flag_on():
        return _disabled_status()
    session_id = session_id_of(authorization, user_id)
    try:
        role, row = await asyncio.to_thread(_load, user_id)
        if role not in LEARNER_ROLES:
            return _disabled_status()
        if session_id is None:
            logger.warning("[session] status_no_session_id user=%s", user_id)
            return {**_disabled_status(), "enabled": True}
        if row is None:
            row, created = await _current_row(user_id, session_id, user_agent)
            if created:
                await _record(user_id, session_id, "signed_in", authorization, user_agent)
        if str(row.get("session_id")) == session_id:
            return {**_disabled_status(), "enabled": True}
        work = await _timed(user_id)
    except Exception as exc:
        logger.warning("[session] status_failed user=%s: %r", user_id, exc)
        raise _error(503, "session_status_unavailable")
    # Once per session and outcome (UNIQUE + ON CONFLICT DO NOTHING), however
    # often the browser polls.
    await _record(user_id, session_id, "claim_refused_timed" if work else "pending", authorization, user_agent)
    device_label = row.get("device_label")
    return {
        "enabled": True,
        "state": "other_device_timed" if work else "other_device",
        "other_session": {"device_label": device_label, "since": row.get("claimed_at"), "approx_location": None},
        "timed_activity": work.as_dict(device_label) if work else None,
    }


_UPSERT_CLAIM = text("""
INSERT INTO public.learner_active_sessions AS s
    (user_id, session_id, device_label, claimed_at, previous_session_id, displaced_at, revoke_pending_at)
VALUES (CAST(:uid AS uuid), CAST(:sid AS uuid), :label, now(), CAST(:prev AS uuid),
        CASE WHEN CAST(:prev AS uuid) IS NULL THEN NULL ELSE now() END, NULL)
ON CONFLICT (user_id) DO UPDATE SET
    session_id = EXCLUDED.session_id,
    device_label = EXCLUDED.device_label,
    claimed_at = EXCLUDED.claimed_at,
    previous_session_id = EXCLUDED.previous_session_id,
    displaced_at = EXCLUDED.displaced_at,
    revoke_pending_at = NULL
""")


async def claim(user_id: str, authorization: Optional[str], user_agent: Optional[str] = None) -> dict:
    """``POST /api/account/session/claim`` ("Tiếp tục ở đây")."""
    if not await flag_on():
        return {"enabled": False, "state": "current", "revoked": 0}
    session_id = session_id_of(authorization, user_id)
    try:
        role, row = await asyncio.to_thread(_load, user_id)
    except Exception as exc:
        logger.warning("[session] claim_lookup_failed user=%s: %r", user_id, exc)
        raise _error(503, "session_claim_unavailable")
    if role not in LEARNER_ROLES:
        return {"enabled": False, "state": "current", "revoked": 0}
    if session_id is None:
        logger.warning("[session] claim_no_session_id user=%s", user_id)
        raise _error(503, "session_claim_unavailable")
    if row is not None and str(row.get("session_id")) == session_id:
        return {"enabled": True, "state": "current", "revoked": 0}
    engine = _engine()
    if engine is None:
        logger.error("[session] claim_unavailable (no DATABASE_URL) user=%s", user_id)
        raise _error(503, "session_claim_unavailable")
    try:
        async with engine.begin() as conn:
            # Lock first, then decide: a timed start holding the lock commits
            # before we look; one arriving later waits and is refused.
            await _lock_account(conn, user_id)
            if not await _session_alive(conn, user_id, session_id):
                # A concurrent claim (or revoke-all) already signed this
                # session out; it must not take the account back.
                raise _error(401, "session_displaced", displaced_at=None)
            try:
                work = await _timed(user_id)
            except Exception as exc:
                logger.warning("[session] claim_timed_lookup_failed user=%s: %r", user_id, exc)
                raise _error(503, "session_claim_unavailable")
            if work is not None:
                raise _error(409, "timed_activity_in_progress",
                             timed_activity=work.as_dict((row or {}).get("device_label")))
            current = (await conn.execute(text(
                "SELECT session_id::text FROM public.learner_active_sessions "
                "WHERE user_id = CAST(:uid AS uuid) FOR UPDATE"), {"uid": user_id})).scalar()
            if current != session_id:
                await conn.execute(_UPSERT_CLAIM, {
                    "uid": user_id, "sid": session_id,
                    "label": device_label_from(user_agent), "prev": current,
                })
            revoked = await staff_security.delete_other_auth_sessions(engine, user_id, session_id, conn=conn)
    except HTTPException as refused:
        if (refused.detail or {}).get("error_code") == "timed_activity_in_progress":
            # Recorded after the transaction rolled back (the lock is free).
            await _record(user_id, session_id, "claim_refused_timed", authorization, user_agent)
        raise
    except Exception as exc:
        logger.error("[session] claim_failed user=%s: %r", user_id, exc)
        raise _error(503, "session_claim_unavailable")
    logger.info("[session] claimed user=%s revoked=%s", user_id, revoked)
    if current and current != session_id:
        # The displaced device sends no more requests: its label is the one
        # stored before the upsert, its method and kind those of its own
        # last sign-in event. Written before "claimed", so the new device is
        # the newest row (spec E19 order).
        old_label = row.get("device_label") if row and str(row.get("session_id")) == current else None
        previous = await asyncio.to_thread(login_events.last_session_fields, user_id, current)
        await _record(user_id, current, "displaced", authorization, device_label=old_label, **previous)
    await _record(user_id, session_id, "claimed", authorization, user_agent)
    return {"enabled": True, "state": "current", "revoked": revoked}


async def revoke_all(user_id: str, authorization: Optional[str], user_agent: Optional[str] = None) -> dict:
    """``POST /api/account/sessions/revoke-all`` ("Đăng xuất khỏi mọi thiết bị").
    A session in timed work is kept until that work ends (FR-041)."""
    if not await flag_on():
        raise _error(404, "single_session_disabled")
    try:
        role, _row = await asyncio.to_thread(_load, user_id)
    except Exception as exc:
        logger.warning("[session] revoke_all_lookup_failed user=%s: %r", user_id, exc)
        raise _error(503, "session_revoke_unavailable")
    if role not in LEARNER_ROLES:
        raise _error(404, "single_session_disabled")
    engine = _engine()
    if engine is None:
        logger.error("[session] revoke_all_unavailable (no DATABASE_URL) user=%s", user_id)
        raise _error(503, "session_revoke_unavailable")
    deferred = None
    try:
        async with engine.begin() as conn:
            await _lock_account(conn, user_id)
            try:
                work = await _timed(user_id)
            except Exception as exc:
                logger.warning("[session] revoke_all_lookup_failed user=%s: %r", user_id, exc)
                raise _error(503, "session_revoke_unavailable")
            current = (await conn.execute(text(
                "SELECT session_id::text FROM public.learner_active_sessions "
                "WHERE user_id = CAST(:uid AS uuid) FOR UPDATE"), {"uid": user_id})).scalar()
            if work is None:
                revoked = await staff_security.delete_auth_sessions(engine, user_id, conn=conn)
                await conn.execute(text(
                    "DELETE FROM public.learner_active_sessions WHERE user_id = CAST(:uid AS uuid)"),
                    {"uid": user_id})
            elif current is None:
                # No known current session: the timed work could be on any
                # device, so none is signed out (logged; FR-040 wins).
                logger.warning("[session] revoke_all_deferred_without_current user=%s", user_id)
                revoked = 0
                deferred = work
            else:
                revoked = await staff_security.delete_other_auth_sessions(engine, user_id, current, conn=conn)
                await conn.execute(text(
                    "UPDATE public.learner_active_sessions SET revoke_pending_at = now() "
                    "WHERE user_id = CAST(:uid AS uuid)"), {"uid": user_id})
                deferred = work
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("[session] revoke_all_failed user=%s: %r", user_id, exc)
        raise _error(503, "session_revoke_unavailable")
    device_label = (_row or {}).get("device_label")
    logger.info("[session] revoke_all user=%s revoked=%s deferred=%s", user_id, revoked, deferred is not None)
    await _record(user_id, session_id_of(authorization, user_id), "signed_out_all", authorization, user_agent)
    return {"revoked": revoked, "deferred_timed": deferred.as_dict(device_label) if deferred else None,
            "at": _now_iso()}


# ── 401 session_displaced ────────────────────────────────────────────────────

async def displaced_detail(authorization: Optional[str]) -> Optional[dict]:
    """For a token GoTrue just REJECTED: the ``session_displaced`` detail when
    its (unverified) ``session_id`` is the one the account's last claim
    replaced, else None. Only chooses an error code; grants nothing. Never
    raises."""
    try:
        payload = token_claims.token_payload(authorization)
        user_id = _uuid_or_none(payload.get("sub"))
        session_id = _uuid_or_none(payload.get("session_id"))
        if user_id is None or session_id is None or not await flag_on():
            return None
        row = await asyncio.to_thread(_displaced_row, user_id, session_id)
    except Exception as exc:
        logger.warning("[session] displaced_lookup_failed: %r", exc)
        return None
    if row is None:
        return None
    return {"error_code": "session_displaced", "displaced_at": row.get("displaced_at")}


# ── GET /api/account/login-events (G04-T16) ──────────────────────────────────

async def login_events_view(user_id: str, authorization: Optional[str], limit: int = 3) -> dict:
    """"Lần đăng nhập gần đây": only the CURRENT session may read it (a
    stranger who just signed in on screen 8a gets 409 ``session_not_current``).
    Flag off or a staff role → ``{"enabled": false, "items": []}``."""
    if not await flag_on():
        return {"enabled": False, "items": []}
    session_id = session_id_of(authorization, user_id)
    try:
        role, row = await asyncio.to_thread(_load, user_id)
    except Exception as exc:
        logger.warning("[session] login_events_lookup_failed user=%s: %r", user_id, exc)
        raise _error(503, "login_events_unavailable")
    if role not in LEARNER_ROLES:
        return {"enabled": False, "items": []}
    if row is not None and session_id is not None and str(row.get("session_id")) != session_id:
        raise _error(409, "session_not_current")
    current = str(row.get("session_id")) if row else None
    try:
        items = await asyncio.to_thread(login_events.recent, user_id, current, limit)
    except Exception as exc:
        logger.warning("[session] login_events_read_failed user=%s: %r", user_id, exc)
        raise _error(503, "login_events_unavailable")
    return {"enabled": True, "items": items}
