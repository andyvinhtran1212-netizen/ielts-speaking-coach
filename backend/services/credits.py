"""COURSEACCESS-0055 plan 5.4 — whether a grading is metered, and the hold.

``charge_plan`` decides, in a fixed order, whether a grading spends AI
credits. When metering is on, every read it needs is fail-closed: an error is
``CreditUnavailable`` (503 ``credits_unavailable``), never "not metered".

``reserve`` wraps ``fn_credit_reserve`` (migration 384). No result other than
``reserved`` or ``covered`` lets the caller run the AI: a replay, a committed
request, a key conflict, a foreign resource, no entitlement or too few
credits each raise, before any grading, ledger row, commit or release.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

from config import settings
from database import supabase_admin
from services import entitlements as ent
from services import runtime_flags

logger = logging.getLogger(__name__)

FEATURES = ("speaking_grading", "writing_grading", "short_writing_feedback")
METERING_FLAG = "credit_metering"
RPC_TIMEOUT_SECONDS = 2.0
_RELEASE_REASONS = ("grader_failed", "stt_failed", "request_failed", "budget_refused")

# Set once the flag has been read as on in this process, so a later "off" is
# visibly logged as a deliberate stop (plan 5.4 step 1).
_metering_seen_on = False
# The last value read successfully in this process. A later lookup error
# reuses it, so a runtime_flags outage does not turn every grading request
# into a 503 while the flag is off; only a process that has never read the
# flag answers 503 (CreditUnavailable), and a read error is never "off".
_metering_last: Optional[bool] = None


class CreditUnavailable(Exception):
    """503 ``credits_unavailable``: the metering decision or the hold could
    not be made. Never grade on it."""

    error_code = "credits_unavailable"
    status_code = 503


class CreditRefused(Exception):
    """``insufficient_credits`` (402), ``no_entitlement`` (403),
    ``request_key_conflict`` (409) or ``not_owner`` (404)."""

    STATUS = {"insufficient_credits": 402, "no_entitlement": 403, "request_key_conflict": 409, "not_owner": 404}

    def __init__(self, code: str, credit_source: str = "online", balance: Optional[int] = None):
        super().__init__(code)
        self.code = code
        self.credit_source = credit_source
        self.balance = balance
        self.status_code = self.STATUS.get(code, 409)


class CreditReplay(Exception):
    """409 ``grading_in_progress`` (same key still open) or
    ``already_graded`` (same key committed). Do not grade again."""

    status_code = 409

    def __init__(self, code: str, reservation_id: Optional[str] = None):
        super().__init__(code)
        self.code = code
        self.reservation_id = reservation_id


@dataclass(frozen=True)
class ChargePlan:
    metered: bool
    reason: str
    course_ids: Optional[list] = None
    kinds: Optional[list] = None

    @property
    def credit_source(self) -> str:
        return "class" if self.reason == "class" else "online"


# ── Reads (raise on failure; charge_plan maps them to CreditUnavailable) ──


def _metering_on() -> bool:
    global _metering_seen_on, _metering_last
    try:
        on = runtime_flags.is_enabled_strict(METERING_FLAG, default=False)
    except runtime_flags.FlagLookupError as exc:
        if _metering_last is None:
            raise CreditUnavailable(METERING_FLAG) from exc
        logger.warning("[credits] flag lookup failed, using last value=%s", _metering_last)
        return _metering_last
    _metering_last = on
    if on:
        _metering_seen_on = True
    return on


def _first(res) -> Optional[dict]:
    rows = res.data or []
    return rows[0] if rows else None


def fetch_cohort_course(cohort_id: str) -> Optional[str]:
    row = _first(supabase_admin.table("cohorts").select("id, course_id").eq("id", cohort_id).limit(1).execute())
    return str(row["course_id"]) if row and row.get("course_id") else None


def fetch_class_item_cohort(item_id: str) -> Optional[str]:
    item = _first(supabase_admin.table("class_assignment_items").select("assignment_id")
                  .eq("id", item_id).limit(1).execute())
    if not item or not item.get("assignment_id"):
        return None
    assignment = _first(supabase_admin.table("class_assignments").select("cohort_id")
                        .eq("id", item["assignment_id"]).limit(1).execute())
    return str(assignment["cohort_id"]) if assignment and assignment.get("cohort_id") else None


def fetch_ever_had_class_entitlement(user_id: str, course_id: str) -> bool:
    rows = [r for r in ent.fetch_entitlement_rows(user_id) if str(r.get("course_id")) == course_id]
    products = ent.fetch_products(r.get("product_id") for r in rows)
    return any(p.get("kind") in ("class", "repractice") for p in products.values())


def fetch_cohort_converted(cohort_id: str) -> bool:
    """Plan 5.18: a class conversion writes entitlements with
    ``source='class_conversion'`` and ``source_ref = cohort_id``."""
    res = (
        supabase_admin.table("entitlements").select("id")
        .eq("source", "class_conversion").eq("source_ref", cohort_id).limit(1).execute()
    )
    return bool(res.data)


def fetch_legacy_code_features(user_id: str) -> tuple[str, ...]:
    from services import access_code_permissions as acp
    return ent.legacy_code_features(acp._permission_union(ent.fetch_legacy_code_rows(user_id)))


def _class_cohort(session: Optional[dict], assignment: Optional[dict]) -> tuple[bool, Optional[str]]:
    """(is class work, cohort_id or None)."""
    if session and session.get("class_assignment_item_id"):
        return True, fetch_class_item_cohort(str(session["class_assignment_item_id"]))
    if assignment and assignment.get("cohort_id"):
        return True, str(assignment["cohort_id"])
    return False, None


_SKILL = {"speaking_grading": "speaking", "writing_grading": "writing", "short_writing_feedback": "writing"}


# ── charge_plan ───────────────────────────────────────────────────────────


def charge_plan(user_id: UUID | str, feature: str, *, session: Optional[dict] = None,
                assignment: Optional[dict] = None, trial: bool = False,
                new_feature: bool = False) -> ChargePlan:
    """Plan 5.4, in order: flag_off, trial, mock, class / legacy_class,
    legacy_code, entitlement. A new feature (``short_writing_feedback`` or
    ``new_feature=True``) is never free: flag off → ``CreditUnavailable``;
    legacy_class / legacy_code fall through to step 6."""
    if feature not in FEATURES:
        raise ValueError(f"unknown credit feature {feature!r}")
    uid = str(user_id)
    never_free = new_feature or feature == "short_writing_feedback"

    # 1. The flag. A read error is not "off".
    if not _metering_on():
        if never_free:
            raise CreditUnavailable("flag_off_new_feature")
        if _metering_seen_on:
            logger.warning("[credits] flag_off user=%s feature=%s", uid, feature)
        return ChargePlan(False, "flag_off")
    # 2. Free trial grading (0047 / GOI-11).
    if trial:
        return ChargePlan(False, "trial")
    # 3. Mock tests and admin exams.
    if session and session.get("sitting_id"):
        return ChargePlan(False, "mock")
    try:
        # 4. Class work.
        is_class, cohort_id = _class_cohort(session, assignment)
        if is_class:
            course_id = fetch_cohort_course(cohort_id) if cohort_id else None
            if course_id and (fetch_ever_had_class_entitlement(uid, course_id)
                              or fetch_cohort_converted(cohort_id)):
                return ChargePlan(True, "class", [course_id], ["class", "repractice"])
            if not cohort_id or not course_id:
                # CR nit on 37de4c62: make the free fallback visible.
                logger.info("[credits] class_work_unmapped user=%s feature=%s cohort=%s", uid, feature,
                            cohort_id or "none")
            if not never_free:
                return ChargePlan(False, "legacy_class")
        # 5. A legacy access code for this skill.
        elif not never_free and _SKILL[feature] in fetch_legacy_code_features(uid):
            return ChargePlan(False, "legacy_code")
    except CreditUnavailable:
        raise
    except Exception as exc:
        logger.warning("[credits] charge_plan read failed user=%s feature=%s: %s", uid, feature, exc)
        raise CreditUnavailable("charge_plan_read") from exc
    # 6. Everything else spends credits from any usable entitlement.
    return ChargePlan(True, "entitlement")


async def acharge_plan(user_id: UUID | str, feature: str, **kwargs) -> ChargePlan:
    return await asyncio.to_thread(charge_plan, user_id, feature, **kwargs)


# ── The hold ──────────────────────────────────────────────────────────────


def _cost(feature: str) -> int:
    return {
        "speaking_grading": settings.CREDIT_COST_SPEAKING_UNIT,
        "writing_grading": settings.CREDIT_COST_WRITING_ESSAY,
        "short_writing_feedback": settings.CREDIT_COST_SHORT_WRITING,
    }[feature]


def _unwrap(raw) -> dict:
    result = raw[0] if isinstance(raw, list) and len(raw) == 1 else raw
    if not isinstance(result, dict) or not isinstance(result.get("status"), str):
        raise CreditUnavailable("unexpected_rpc_shape")
    return result


async def _rpc(name: str, params: dict) -> dict:
    try:
        raw = await asyncio.wait_for(
            asyncio.to_thread(lambda: supabase_admin.rpc(name, params).execute().data),
            timeout=RPC_TIMEOUT_SECONDS,
        )
    except CreditUnavailable:
        raise
    except Exception as exc:  # timeout, transport, PostgREST error
        logger.warning("[credits] rpc=%s failed: %s", name, exc)
        raise CreditUnavailable(name) from exc
    return _unwrap(raw)


@dataclass
class CreditHold:
    reservation_id: Optional[str]
    covered: bool = False
    entitlement_id: Optional[str] = None
    balance_after: Optional[int] = None
    settled: Optional[str] = None

    async def commit(self) -> None:
        if self.covered or self.reservation_id is None or self.settled:
            return
        result = await _rpc("fn_credit_commit", {"p_reservation_id": self.reservation_id})
        if result["status"] not in ("committed", "already_committed"):
            raise CreditUnavailable(f"commit_{result['status']}")
        self.settled = "committed"

    async def release(self, reason: str) -> None:
        if reason not in _RELEASE_REASONS:
            raise ValueError(f"unknown release reason {reason!r}")
        if self.covered or self.reservation_id is None or self.settled:
            return
        result = await _rpc("fn_credit_release", {"p_reservation_id": self.reservation_id, "p_reason": reason})
        if result["status"] not in ("released", "already_released", "not_open"):
            raise CreditUnavailable(f"release_{result['status']}")
        self.settled = "released"


async def release_if_open(hold: Optional[CreditHold], reason: str) -> None:
    """Never raises: a failed release is logged; the expiry sweep returns the
    credit later."""
    if hold is None:
        return
    try:
        await hold.release(reason)
    except Exception as exc:
        logger.warning("[credits] decision=release_failed reservation=%s reason=%s: %s",
                       hold.reservation_id, reason, exc)


def fetch_reservation(reservation_id: str) -> Optional[dict]:
    return _first(
        supabase_admin.table("credit_reservations").select("user_id, resource_type, resource_id, status")
        .eq("id", reservation_id).limit(1).execute()
    )


async def _paid_regrade_replay(user_id: str, resource_id: str, reservation_id: str) -> Optional[str]:
    """A retry of a paid cluster re-grade (Codex P2 / CR B2 on 37de4c62).

    The first call reserved under ``speaking_response:<s>:<q>:r<n>`` with the
    caller's request key, so the identical retry, sent as ``speaking_cluster``,
    meets that reservation and the RPC answers ``request_key_conflict``. When
    the reservation is this user's paid re-grade of the same question, answer
    like the RPC's own replay: ``grading_in_progress`` while open,
    ``already_graded`` once committed. Anything else stays a conflict."""
    try:
        row = await asyncio.wait_for(asyncio.to_thread(fetch_reservation, reservation_id),
                                     timeout=RPC_TIMEOUT_SECONDS)
    except Exception as exc:
        logger.warning("[credits] rpc=fn_credit_reserve replay lookup failed: %s", exc)
        raise CreditUnavailable("reserve_replay_lookup") from exc
    if not row or str(row.get("user_id")) != str(user_id) or row.get("resource_type") != "speaking_response":
        return None
    session_id, _part, question = resource_id.split(":", 2)
    if not str(row.get("resource_id") or "").startswith(f"{session_id}:{question[1:]}:r"):
        return None
    return {"open": "grading_in_progress", "committed": "already_graded"}.get(row.get("status"))


def _regrade_resource(resource_id: str, regrade_count) -> str:
    """'<session>:p<n>:q<question>' → '<session>:<question>:r<count>'
    (plan 5.6: a re-grade past the free limit is charged as its own answer)."""
    session_id, _part, question = resource_id.split(":", 2)
    return f"{session_id}:{question[1:]}:r{int(regrade_count or 0)}"


async def reserve(user_id: UUID | str, feature: str, *, request_key: str, resource_type: str,
                  resource_id: str, ttl_seconds: int, course_ids: Optional[list] = None,
                  kinds: Optional[list] = None, credit_source: Optional[str] = None) -> CreditHold:
    """Hold credits before grading. ``credit_source`` is the plan's
    (``ChargePlan.credit_source``); without it, class kinds mean 'class'."""
    if feature not in FEATURES:
        raise ValueError(f"unknown credit feature {feature!r}")
    source = credit_source or ("class" if kinds and set(kinds) <= {"class", "repractice"} else "online")
    params = {
        "p_user_id": str(user_id), "p_feature": feature, "p_cost": _cost(feature),
        "p_request_key": request_key, "p_resource_type": resource_type, "p_resource_id": resource_id,
        "p_ttl_seconds": int(ttl_seconds),
        "p_course_ids": [str(c) for c in course_ids] if course_ids else None,
        "p_kinds": list(kinds) if kinds else None,
        "p_cluster_size": settings.CREDIT_SPEAKING_CLUSTER_SIZE,
    }
    result = await _rpc("fn_credit_reserve", params)
    if result["status"] == "regrade_limit" and resource_type == "speaking_cluster":
        params = {**params, "p_resource_type": "speaking_response",
                  "p_resource_id": _regrade_resource(resource_id, result.get("regrade_count"))}
        result = await _rpc("fn_credit_reserve", params)
    status = result["status"]
    if status == "request_key_conflict" and resource_type == "speaking_cluster" and result.get("reservation_id"):
        replay = await _paid_regrade_replay(str(user_id), resource_id, str(result["reservation_id"]))
        if replay is not None:
            raise CreditReplay(replay, result.get("reservation_id"))
    if status == "reserved":
        return CreditHold(reservation_id=result.get("reservation_id"), entitlement_id=result.get("entitlement_id"),
                          balance_after=result.get("balance_after"))
    if status == "covered":
        return CreditHold(reservation_id=result.get("reservation_id"), covered=True)
    if status == "replay":
        raise CreditReplay("grading_in_progress", result.get("reservation_id"))
    if status == "already_committed":
        raise CreditReplay("already_graded", result.get("reservation_id"))
    if status == "insufficient_credits":
        raise CreditRefused("insufficient_credits", source, balance=int(result.get("balance") or 0))
    if status in ("no_entitlement", "request_key_conflict", "not_owner"):
        raise CreditRefused(status, source)
    raise CreditUnavailable(f"reserve_{status}")


# ── Settling by resource (Writing BG grader, plan 5.6) ───────────────────


def _metering_on_or_unknown() -> bool:
    """Flag off → False (FR-018: no credit RPC). A flag read error → True:
    settling a resource that holds nothing is a no-op, so trying is safe."""
    try:
        return _metering_on()
    except CreditUnavailable:
        return True


def _settle_for_resource(rpc_name: str, params: dict) -> Optional[str]:
    """Sync and never raises: the Writing grader runs in a BackgroundTask and
    a credit error must not fail a grade. A failed settle is logged and the
    hold is left to the expiry sweep."""
    if not _metering_on_or_unknown():
        return None
    try:
        return _unwrap(supabase_admin.rpc(rpc_name, params).execute().data)["status"]
    except Exception as exc:
        logger.warning("[credits] rpc=%s resource=%s:%s failed: %s", rpc_name,
                       params.get("p_resource_type"), params.get("p_resource_id"), exc)
        return None


def commit_for_resource(resource_type: str, resource_id: str) -> Optional[str]:
    """Commit the open hold on a resource (``none`` when there is none)."""
    return _settle_for_resource("fn_credit_commit_for_resource",
                                {"p_resource_type": resource_type, "p_resource_id": str(resource_id)})


def release_for_resource(resource_type: str, resource_id: str, reason: str) -> Optional[str]:
    """Release the open hold on a resource (``none`` when there is none)."""
    if reason not in _RELEASE_REASONS:
        raise ValueError(f"unknown release reason {reason!r}")
    return _settle_for_resource("fn_credit_release_for_resource",
                                {"p_resource_type": resource_type, "p_resource_id": str(resource_id),
                                 "p_reason": reason})


def deliver_writing_essay_instant(essay_id: str) -> Optional[str]:
    """``fn_deliver_writing_essay_instant``: graded + ``ai_instant`` →
    delivered. Never raises."""
    try:
        return _unwrap(supabase_admin.rpc("fn_deliver_writing_essay_instant",
                                          {"p_essay_id": str(essay_id)}).execute().data)["status"]
    except Exception as exc:
        logger.warning("[credits] rpc=fn_deliver_writing_essay_instant essay=%s failed: %s", essay_id, exc)
        return None
