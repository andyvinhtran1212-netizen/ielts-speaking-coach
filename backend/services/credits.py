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
from datetime import datetime, timezone
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
    if assignment is not None:
        # Every writing assignment is class work, also one given to a single
        # learner without a cohort_id (Andy, 2026-11-23 11:52Z on #2593:
        # "bài giao riêng không có cohort_id tính là bài trong lớp"). With no
        # cohort there is no class course, so it is not metered
        # (legacy_class, logged class_work_unmapped) unless the feature is
        # never free.
        cohort_id = assignment.get("cohort_id")
        return True, str(cohort_id) if cohort_id else None
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
    # The request key this hold was reserved (or covered) under; the key of
    # the attempt for fn_credit_settle_attempt (migration 503).
    request_key: Optional[str] = None

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


_SETTLE_STATUSES = ("committed", "already_committed", "released", "pending", "not_open")


async def settle_attempt(hold: Optional[CreditHold], outcome: str, reason: Optional[str] = None) -> Optional[str]:
    """Settle one grading attempt of a hold (G04-T07, FR-015, migration 503).

    ``graded`` commits the hold if it is still open. ``failed`` records the
    attempt and releases the hold only when every answer it covers has failed
    (a Speaking cluster keeps its credit held while another answer may still
    be saved). Works for a ``covered`` hold too: the attempt is the covered
    request key. Returns the RPC status; raises CreditUnavailable on a
    transport error or an unexpected status."""
    if hold is None or hold.reservation_id is None or hold.request_key is None or hold.settled:
        return None
    if outcome not in ("graded", "failed"):
        raise ValueError(f"unknown attempt outcome {outcome!r}")
    if outcome == "failed" and reason not in _RELEASE_REASONS:
        raise ValueError(f"unknown release reason {reason!r}")
    result = await _rpc("fn_credit_settle_attempt", {
        "p_reservation_id": hold.reservation_id, "p_request_key": hold.request_key,
        "p_outcome": outcome, "p_reason": reason if outcome == "failed" else None,
    })
    status = result["status"]
    if status not in _SETTLE_STATUSES:
        raise CreditUnavailable(f"settle_{status}")
    hold.settled = outcome
    return status


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
                          balance_after=result.get("balance_after"), request_key=request_key)
    if status == "covered":
        return CreditHold(reservation_id=result.get("reservation_id"), covered=True, request_key=request_key)
    if status == "replay":
        raise CreditReplay("grading_in_progress", result.get("reservation_id"))
    if status == "already_committed":
        raise CreditReplay("already_graded", result.get("reservation_id"))
    if status == "insufficient_credits":
        raise CreditRefused("insufficient_credits", source, balance=int(result.get("balance") or 0))
    if status in ("no_entitlement", "request_key_conflict", "not_owner"):
        raise CreditRefused(status, source)
    raise CreditUnavailable(f"reserve_{status}")


# ── Extra credits (plan 5.15, G04-T12) ───────────────────────────────────────

CREDIT_STEP_UP_THRESHOLD = 50  # Q13: a constant, not an env value
_CLASS_KINDS = ("class", "repractice")


class GrantExtraRefused(Exception):
    """A request the admin must change: 404 ``cohort_not_found`` /
    ``entitlement_not_found`` or 422 ``not_in_cohort``."""

    def __init__(self, status_code: int, error_code: str):
        super().__init__(error_code)
        self.status_code = status_code
        self.error_code = error_code


@dataclass
class GrantExtraResult:
    granted: list[dict]
    skipped: list[dict]


def _cohort_user_ids(cohort_id: str) -> list[str]:
    from services import class_membership_service as cms
    rows = cms.active_students_for_cohort(supabase_admin, cohort_id, columns="id, user_id")
    return sorted({str(r["user_id"]) for r in rows if isinstance(r, dict) and r.get("user_id")})


_IN_FILTER_LOT = 100


def _class_entitlements(user_ids: list[str], course_id: str) -> dict[str, str]:
    """Per learner, the class or re-practice entitlement of the course that can
    still take credits; several → the one that ends last (no end = last)."""
    rows: list[dict] = []
    # Lots of 100: 500 UUIDs in one in.() filter make a URL of about 18 KB.
    for start in range(0, len(user_ids), _IN_FILTER_LOT):
        res = (
            supabase_admin.table("entitlements").select(ent._ENTITLEMENT_COLUMNS)
            .in_("user_id", user_ids[start:start + _IN_FILTER_LOT])
            .eq("course_id", course_id).eq("status", "active").execute()
        )
        rows.extend(res.data or [])
    if not rows:
        return {}
    products = ent.fetch_products(r.get("product_id") for r in rows)
    now = datetime.now(timezone.utc)
    best: dict[str, tuple] = {}
    for row in rows:
        if products.get(str(row.get("product_id")), {}).get("kind") not in _CLASS_KINDS:
            continue
        if not ent._credit_usable(row, now):
            continue
        ends = ent.parse_ts(row.get("expires_at"))
        key = (ends is None, ends or now, str(row["id"]))
        user = str(row["user_id"])
        if user not in best or key > best[user][0]:
            best[user] = (key, str(row["id"]))
    return {user: value[1] for user, value in best.items()}


def _grant_one(admin_id: str, entitlement_id: str, credits: int, reason: str, request_key: str) -> dict:
    raw = supabase_admin.rpc("fn_credit_grant_extra", {
        "p_actor_id": admin_id, "p_actor_kind": "admin", "p_entitlement_id": entitlement_id,
        "p_credits": credits, "p_reason": reason, "p_request_key": request_key,
    }).execute().data
    return _unwrap(raw)


def grant_extra_for(*, admin_id: str, credits: int, reason: str, request_key: str,
                    cohort_id: Optional[str] = None, user_ids: Optional[list[str]] = None,
                    entitlement_id: Optional[str] = None) -> GrantExtraResult:
    """``POST /admin/credits/grant-extra``. One RPC per learner with the same
    request key, so calling the whole batch again adds nothing. Sync (run it in
    a thread); a transport or PostgREST failure raises as is."""
    targets: list[tuple[str, str]] = []
    skipped: list[dict] = []
    if cohort_id:
        cohort = _first(supabase_admin.table("cohorts").select("id, course_id")
                        .eq("id", cohort_id).limit(1).execute())
        if cohort is None:
            raise GrantExtraRefused(404, "cohort_not_found")
        members = _cohort_user_ids(cohort_id)
        if user_ids is not None:
            if not user_ids:
                raise GrantExtraRefused(422, "empty_selection")
            wanted = sorted({str(u) for u in user_ids})
            if set(wanted) - set(members):
                raise GrantExtraRefused(422, "not_in_cohort")
            members = wanted
        course_id = str(cohort["course_id"]) if cohort.get("course_id") else None
        chosen = _class_entitlements(members, course_id) if course_id else {}
        for user in members:
            if user in chosen:
                targets.append((user, chosen[user]))
            else:
                skipped.append({"user_id": user, "reason": "no_class_entitlement"})
    else:
        user = str(user_ids[0])
        row = _first(supabase_admin.table("entitlements").select("id, user_id")
                     .eq("id", entitlement_id).limit(1).execute())
        if row is None or str(row.get("user_id")) != user:
            raise GrantExtraRefused(404, "entitlement_not_found")
        targets.append((user, str(entitlement_id)))
    granted: list[dict] = []
    for user, entitlement in targets:
        result = _grant_one(admin_id, entitlement, credits, reason, request_key)
        if result["status"] in ("granted", "replay"):
            # A replay names the entitlement the first call credited, which may
            # not be the one chosen now (the key is per learner, not per entitlement).
            granted.append({"user_id": user, "entitlement_id": str(result.get("entitlement_id") or entitlement),
                            "balance": int(result.get("balance") or 0)})
        elif result["status"] == "request_key_conflict":
            raise GrantExtraRefused(409, "request_key_conflict")
        elif result["status"] in ("not_usable", "not_found"):
            skipped.append({"user_id": user, "reason": "not_usable"})
        else:
            raise CreditUnavailable(f"grant_extra_{result['status']}")
    logger.info("[credits] lifecycle=grant_extra count=%s skipped=%s", len(granted), len(skipped))
    return GrantExtraResult(granted=granted, skipped=skipped)


# ── Convert a legacy-code class to credit metering (plan 5.18, G04-T15) ─────
#
# The reads below classify members with the same rules as 387's
# fn_credit_convert_class, so the preview and the pending list say what the
# RPC will do; the RPC re-checks everything under its locks.

_CONVERT_PAGE = 1000


class ConvertClassRefused(Exception):
    """404 ``cohort_not_found``; 409 ``cohort_archived``, ``cohort_has_no_course``,
    ``no_class_product``, ``product_ambiguous``; 422 ``product_invalid``."""

    def __init__(self, status_code: int, error_code: str):
        super().__init__(error_code)
        self.status_code = status_code
        self.error_code = error_code


def _paged_rows(build) -> list[dict]:
    rows: list[dict] = []
    start = 0
    while True:
        page = build().range(start, start + _CONVERT_PAGE - 1).execute().data or []
        rows.extend(page)
        if len(page) < _CONVERT_PAGE:
            return rows
        start += _CONVERT_PAGE


def _rows_in(table: str, columns: str, column: str, values, **eq) -> list[dict]:
    values = sorted({str(v) for v in values if v})
    rows: list[dict] = []
    for start in range(0, len(values), _IN_FILTER_LOT):
        lot = values[start:start + _IN_FILTER_LOT]

        def build(lot=lot):
            query = supabase_admin.table(table).select(columns).in_(column, lot)
            for key, value in eq.items():
                query = query.eq(key, value)
            return query.order("id")
        rows.extend(_paged_rows(build))
    return rows


def _convert_cohort(cohort_id: str) -> dict:
    cohort = _first(supabase_admin.table("cohorts").select("id, name, course_id, archived_at")
                    .eq("id", cohort_id).limit(1).execute())
    if cohort is None:
        raise ConvertClassRefused(404, "cohort_not_found")
    if cohort.get("archived_at"):
        raise ConvertClassRefused(409, "cohort_archived")
    if not cohort.get("course_id"):
        raise ConvertClassRefused(409, "cohort_has_no_course")
    return cohort


def _class_products(course_id: str) -> list[dict]:
    return _paged_rows(lambda: supabase_admin.table("course_products").select("id, title")
                       .eq("course_id", course_id).eq("kind", "class").is_("archived_at", "null").order("id"))


def _course_codes(course_ids) -> dict[str, str]:
    return {str(r["id"]): r.get("code") for r in _rows_in("courses", "id, code", "id", course_ids)}


def _cohort_members(cohort_ids) -> list[dict]:
    """Active memberships joined to students: {cohort_id, student_id, user_id}
    (the 387 loop; no legacy ``students.cohort_id`` fallback, like the RPC)."""
    memberships = _rows_in("student_cohort_memberships", "id, student_id, cohort_id", "cohort_id", cohort_ids,
                           is_active=True)
    students = {str(s["id"]): s for s in _rows_in("students", "id, user_id, full_name", "id",
                                                   (m.get("student_id") for m in memberships))}
    out = []
    for m in memberships:
        student = students.get(str(m.get("student_id"))) or {}
        out.append({"cohort_id": str(m["cohort_id"]), "student_id": str(m.get("student_id")),
                    "user_id": str(student["user_id"]) if student.get("user_id") else None,
                    "full_name": student.get("full_name")})
    return out


def _held_code_expiry(cohort_id: str, user_ids: list[str], now: datetime) -> dict[str, Optional[str]]:
    """Per member, the expiry the 387 RPC gives: the live legacy codes of this
    class the member holds (an active assignment, or ``used_by`` with no
    assignment row at all, as ``access_code_permissions._active_code_rows``).
    No code, or one without expiry → None (no expiry)."""
    from services.access_code_permissions import _code_is_live

    codes = _paged_rows(lambda: supabase_admin.table("access_codes")
                        .select("id, used_by, is_revoked, is_active, expires_at")
                        .eq("cohort_id", cohort_id).is_("product_id", "null").order("id"))
    by_id = {str(c["id"]): c for c in codes}
    assignments = _rows_in("user_code_assignments", "id, user_id, code_id, is_active", "code_id", by_id)
    assigned: set[tuple[str, str]] = set()
    active: set[tuple[str, str]] = set()
    for a in assignments:
        pair = (str(a.get("user_id")), str(a.get("code_id")))
        assigned.add(pair)
        if a.get("is_active"):
            active.add(pair)
    out: dict[str, Optional[str]] = {}
    for user in user_ids:
        held = [c for cid, c in by_id.items() if _code_is_live(c, now)
                and ((user, cid) in active or (str(c.get("used_by")) == user and (user, cid) not in assigned))]
        ends = [ent.parse_ts(c.get("expires_at")) for c in held]
        out[user] = None if not held or any(e is None for e in ends) else max(ends).isoformat()
    return out


def _converted_users(cohort_ids) -> set[tuple[str, str]]:
    """(cohort_id, user_id) already converted once in that class, in any state."""
    rows = _rows_in("entitlements", "id, user_id, source_ref", "source_ref", cohort_ids, source="class_conversion")
    return {(str(r["source_ref"]), str(r["user_id"])) for r in rows}


def _classify(cohort: dict, members: list[dict], converted: set[tuple[str, str]], now: datetime) -> list[dict]:
    cohort_id, course_id = str(cohort["id"]), str(cohort["course_id"])
    users = sorted({m["user_id"] for m in members if m["user_id"]})
    metered = set(_class_entitlements(users, course_id)) if users else set()
    pending = [u for u in users if u not in metered and (cohort_id, u) not in converted]
    expiry = _held_code_expiry(cohort_id, pending, now) if pending else {}
    out, seen = [], set()
    for m in sorted(members, key=lambda m: (m["user_id"] is None, m["user_id"] or "", m["student_id"])):
        user = m["user_id"]
        if user is None:
            out.append({"user_id": None, "student_id": m["student_id"], "full_name": m.get("full_name"),
                        "state": "no_account", "expires_at": None})
            continue
        state = "to_convert" if user in expiry and user not in seen else "already_metered"
        seen.add(user)
        out.append({"user_id": user, "student_id": m["student_id"], "full_name": m.get("full_name"),
                    "state": state, "expires_at": expiry.get(user) if state == "to_convert" else None})
    return out


def _counts(members: list[dict]) -> dict:
    return {state: sum(1 for m in members if m["state"] == state)
            for state in ("to_convert", "already_metered", "no_account")}


def convert_class_preview(cohort_id: str) -> dict:
    """``GET /admin/credits/convert-class/preview`` (plan 5.9), read only."""
    now = datetime.now(timezone.utc)
    cohort = _convert_cohort(cohort_id)
    course_id = str(cohort["course_id"])
    products = [{"id": str(p["id"]), "title": p.get("title")} for p in _class_products(course_id)]
    members = _classify(cohort, _cohort_members([cohort_id]), _converted_users([cohort_id]), now)
    names = {str(u["id"]): u.get("display_name") for u in
             _rows_in("users", "id, display_name", "id", (m["user_id"] for m in members))}
    return {
        "cohort": {"id": str(cohort["id"]), "name": cohort.get("name"),
                   "course_code": _course_codes([course_id]).get(course_id)},
        "product": products[0] if len(products) == 1 else None,
        "products": products,
        "suggested_credits": settings.LEGACY_CLASS_INITIAL_CREDITS,
        "members": [{"user_id": m["user_id"],
                     "display_name": names.get(m["user_id"] or "") or m.get("full_name"),
                     "state": m["state"], "expires_at": m["expires_at"]} for m in members],
        "counts": _counts(members),
    }


def list_classes_pending_conversion() -> list[dict]:
    """``GET /admin/credits/convert-class/pending``: classes not archived, tied to
    a course, with at least one member the RPC would convert."""
    now = datetime.now(timezone.utc)
    cohorts = [c for c in _paged_rows(lambda: supabase_admin.table("cohorts")
                                      .select("id, name, course_id, archived_at")
                                      .is_("archived_at", "null").order("id"))
               if c.get("course_id")]
    if not cohorts:
        return []
    ids = [str(c["id"]) for c in cohorts]
    members = _cohort_members(ids)
    converted = _converted_users(ids)
    codes = _course_codes(c["course_id"] for c in cohorts)
    out = []
    for cohort in cohorts:
        mine = [m for m in members if m["cohort_id"] == str(cohort["id"])]
        if not any(m["user_id"] for m in mine):
            continue
        classified = _classify(cohort, mine, converted, now)
        pending = _counts(classified)["to_convert"]
        if pending:
            out.append({"cohort_id": str(cohort["id"]), "cohort_name": cohort.get("name"),
                        "course_code": codes.get(str(cohort["course_id"])), "members": len(classified),
                        "pending_members": pending})
    return out


def convert_class(*, admin_id: str, cohort_id: str, credits_per_member: int, request_key: str,
                  product_id: Optional[str] = None) -> dict:
    """``POST /admin/credits/convert-class``: pick the product, then one 387 RPC
    (one transaction, so a failure leaves nothing half done). Sync.

    A request_key that already converted is sent straight to the RPC with the
    product it recorded: the class or its products may have changed since
    (a second product, an archive), and a retry after a lost response must
    still replay the first result. The RPC compares the other arguments and
    answers request_key_conflict when they differ."""
    prior = (supabase_admin.table("credit_class_conversions").select("product_id")
             .eq("request_key", request_key).limit(1).execute().data or [])
    if prior:
        product_id = product_id or str(prior[0]["product_id"])
    else:
        cohort = _convert_cohort(cohort_id)
        products = _class_products(str(cohort["course_id"]))
        if not products:
            raise ConvertClassRefused(409, "no_class_product")
        if product_id is None:
            if len(products) > 1:
                raise ConvertClassRefused(409, "product_ambiguous")
            product_id = str(products[0]["id"])
    result = _unwrap(supabase_admin.rpc("fn_credit_convert_class", {
        "p_admin_id": admin_id, "p_cohort_id": cohort_id, "p_product_id": product_id,
        "p_credits_per_member": credits_per_member, "p_request_key": request_key,
    }).execute().data)
    status = result["status"]
    if status in ("converted", "replay"):
        logger.info("[credits] convert_class status=%s converted=%s skipped=%s", status,
                    len(result.get("converted") or []), len(result.get("skipped") or []))
        return {"status": status, "converted": list(result.get("converted") or []),
                "skipped": list(result.get("skipped") or [])}
    if status == "cohort_not_found":
        raise ConvertClassRefused(404, status)
    if status in ("cohort_archived", "cohort_has_no_course", "request_key_conflict"):
        raise ConvertClassRefused(409, status)
    if status == "product_invalid":
        raise ConvertClassRefused(422, status)
    raise CreditUnavailable(f"convert_class_{status}")


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
