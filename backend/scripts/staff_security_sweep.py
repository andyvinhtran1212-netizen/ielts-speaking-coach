"""Staff security sweep (ADMINAAL2-0032 FR-010/FR-011, task T007).

Runs every 5 minutes as its own Railway cron service
(``backend/railway.staff-security-sweep.json``, owner decision Q10):

    python -m scripts.staff_security_sweep                  # one sweep run
    python -m scripts.staff_security_sweep --test-alert     # rollout.md P3
    python -m scripts.staff_security_sweep --requeue <audit_id>
    python -m scripts.staff_security_sweep --backfill [--commit]   # first run only

One run does three independent steps; a failure in one is logged and does not
skip the others, and any failure makes the exit code non-zero. So do due alerts
that cannot be sent because ``RESEND_API_KEY`` or ``OWNER_ALERT_EMAILS`` is
missing: the run logs the missing names and exits non-zero (PC-J73 F3).

1. **Auth audit-log factor events** (the event source). Reads
   ``auth.audit_log_entries`` after the durable cursor in
   ``staff_security_sweep_cursor`` and, for each factor event of an account
   whose role was admin when the event happened (the role history in
   ``staff_security_audit``, so a later demotion or promotion does not change
   the answer), writes one ``staff_security_audit`` row keyed by the
   log entry id (``detail.auth_log_entry_id``, unique since migration 332), so
   a re-run cannot duplicate it. The rows, their owner alerts and the cursor
   advance commit in one transaction per batch: a failure rolls all of them
   back and the next run starts from the same entry. A factor enrolled,
   verified and deleted between two runs gives three log entries, hence one
   row each. Mapping (research.md §9.4): ``factor_in_progress`` → enrolled;
   the first ``verification_attempted`` of a factor → verified (later ones are
   step-up sign-ins); ``factor_unenrolled`` / ``factor_deleted`` → deleted,
   where the user of ``factor_deleted`` is ``traits.user_id`` and its actor is
   unknown (Auth admin API). Entries younger than ``LOG_LAG_SECONDS`` wait for
   the next run, so an Auth transaction still committing is not passed over.
2. **Factor snapshot backstop.** Lists each admin's factors from the Auth admin
   API and diffs them with ``staff_mfa_factor_snapshot``. A difference with no
   matching entry anywhere in the Auth log means the log missed an event: it
   writes an audit row with ``detail.detected_by = 'snapshot'`` and logs
   ``staff_security_sweep_log_missed_event`` at error level. A vanished
   unverified factor is ignored (GoTrue removes those on verify without a log
   entry). The first successful pass only records the snapshot.
3. **Owner alert dispatch** (``services.owner_alerts``): every due outbox row,
   including the ones written by steps 1 and 2 and by the users trigger.

Then, ``FOLLOW_UP_SECONDS`` after the run started, steps 1 and 3 run once more
(PC-J66 F04). Railway cron runs must be at least 5 minutes apart, and an entry
younger than ``LOG_LAG_SECONDS`` at the first pass would otherwise wait a whole
period: written 5 s before a run, audited 305 s later. With a second pass at
offset F, the longest wait from an event to its audit row is
``max(F, PERIOD - F) + LOG_LAG_SECONDS`` plus step time: 160 s for F = 150 s,
which leaves 140 s of the 5-minute FR-010 bound for Railway start delay and
the steps. The run stays well under the period, so Railway never skips the
next one for overlap.

On the very first run the log cursor starts at the newest entry, so history
from before the sweep existed is not replayed into audit rows and e-mails.
``--backfill`` closes that gap once, before the cron service is created
(rollout.md "First run and backfill", PC-J139): it audits the factor events
from migration 332's ``applied_at`` (read from ``_schema_migrations``) up to
the existing cursor, or, with no cursor yet, up to the newest settled entry,
where ``--commit`` then creates the cursor in the last batch's transaction.
It uses the same mapping, role-at-event rule and ``auth_log_entry_id`` key as
step 1, marks each row ``detail.backfill = true`` with a ``backfill_run_id``,
and never writes an owner alert, sends an e-mail or touches the snapshot:
these are old events. Entries before 332 are only counted, because the role
history ``role_at`` needs starts with 332. Without ``--commit`` it is a dry
run that writes nothing, and both modes log one
``staff_security_sweep_backfill_summary`` line of counts.

The sweep reads ``auth.*`` over the backend's direct ``DATABASE_URL``
connection (the ``postgres`` role; ``service_role`` cannot read it) and never
writes to the ``auth`` schema. It prints no e-mail address, token or secret.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import re
import sys
import time
import uuid
from collections import Counter
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import owner_alerts  # noqa: E402

logger = logging.getLogger("staff_security_sweep")

LOG_CURSOR = "auth_audit_log_factors"
SNAPSHOT_MARKER = "mfa_factor_snapshot"
LOG_LAG_SECONDS = 10
CRON_PERIOD_SECONDS = 300   # railway.staff-security-sweep.json, Railway's minimum
FOLLOW_UP_SECONDS = CRON_PERIOD_SECONDS // 2
LOG_BATCH = 500
ZERO_UUID = "00000000-0000-0000-0000-000000000000"

ENROLL_ACTIONS = ("factor_in_progress",)
VERIFY_ACTIONS = ("verification_attempted",)
DELETE_ACTIONS = ("factor_unenrolled", "factor_deleted")
FACTOR_ACTIONS = ENROLL_ACTIONS + VERIFY_ACTIONS + DELETE_ACTIONS
MIGRATION_332 = "332_staff_security_audit.sql"
ALERT_EVENTS = frozenset({"mfa_factor_verified", "mfa_factor_deleted"})   # FR-011

FactorLister = Callable[[str], Awaitable[list[dict[str, Any]]]]


def _ident(name: str) -> str:
    if not re.fullmatch(r"[a-z_][a-z0-9_]*", name):
        raise ValueError("invalid schema name")
    return name


def _uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


@dataclass
class LogSummary:
    initialized: bool = False
    entries: int = 0
    rows: int = 0
    skipped: int = 0


@dataclass
class BackfillSummary:
    run_id: str
    commit: bool
    migration_332_applied_at: Any = None
    log_oldest_at: Any = None
    end_at: Any = None
    end_bound: str = ""            # "cursor" or "newest_entry"
    cursor_created: bool = False
    entry_min_at: Any = None
    entry_max_at: Any = None
    entries_by_action: Counter = field(default_factory=Counter)
    written_by_event: Counter = field(default_factory=Counter)   # would write, in a dry run
    skipped_by_reason: Counter = field(default_factory=Counter)
    users: set = field(default_factory=set)

    @property
    def start_at(self) -> Any:
        """The later of the oldest log entry and 332: the first writable moment."""
        if self.log_oldest_at is None:
            return self.migration_332_applied_at
        return max(self.log_oldest_at, self.migration_332_applied_at)

    def line(self) -> str:
        def at(value: Any) -> str:
            return value.astimezone(owner_alerts.VIETNAM_TIME).isoformat(timespec="seconds") \
                if value is not None else "none"

        def counts(counter: Counter) -> str:
            return ",".join(f"{k}:{v}" for k, v in sorted(counter.items())) or "none"

        fields = {
            "mode": "commit" if self.commit else "dry_run", "run_id": self.run_id,
            "migration_332_applied_at": at(self.migration_332_applied_at),
            "log_oldest_at": at(self.log_oldest_at), "start_at": at(self.start_at),
            "end_at": at(self.end_at), "end_bound": self.end_bound,
            "entry_min_at": at(self.entry_min_at), "entry_max_at": at(self.entry_max_at),
            "entries": sum(self.entries_by_action.values()),
            "entries_by_action": counts(self.entries_by_action),
            ("written" if self.commit else "would_write"): sum(self.written_by_event.values()),
            ("written_by_event" if self.commit else "would_write_by_event"):
                counts(self.written_by_event),
            "skipped": sum(self.skipped_by_reason.values()),
            "skipped_by_reason": counts(self.skipped_by_reason),
            "users": len(self.users), "cursor_created": self.cursor_created,
        }
        return " ".join(f"{k}={v}" for k, v in fields.items())


class BackfillCursorRace(RuntimeError):
    """A sweep created the cursor while the backfill ran; re-run the backfill."""


@dataclass
class SnapshotSummary:
    seeding: bool = False
    admins: int = 0
    factor_diffs: int = 0
    errors: int = 0


class SweepDb:
    """SQL for steps 1 and 2. Schema names are parameters only for the tests."""

    def __init__(self, conn: Any, *, schema: str = "public", auth_schema: str = "auth") -> None:
        self.conn = conn
        s, a = _ident(schema), _ident(auth_schema)
        self.audit = f"{s}.staff_security_audit"
        self.outbox = f"{s}.owner_alert_outbox"
        self.snapshot = f"{s}.staff_mfa_factor_snapshot"
        self.cursor = f"{s}.staff_security_sweep_cursor"
        self.users = f"{s}.users"
        self.migrations = f"{s}._schema_migrations"
        self.log = f"{a}.audit_log_entries"

    # ── cursor ──
    async def lock_cursor(self, name: str) -> dict[str, Any] | None:
        row = await self.conn.fetchrow(
            f"SELECT last_created_at, last_entry_id FROM {self.cursor} WHERE name = $1 FOR UPDATE",
            name)
        return dict(row) if row else None

    async def read_cursor(self, name: str) -> dict[str, Any] | None:
        row = await self.conn.fetchrow(
            f"SELECT last_created_at, last_entry_id FROM {self.cursor} WHERE name = $1", name)
        return dict(row) if row else None

    async def init_log_cursor(self, lag_seconds: int) -> bool:
        """Start at the newest settled entry. False when another run got there first."""
        inserted = await self.conn.fetchval(
            f"""INSERT INTO {self.cursor} (name, last_created_at, last_entry_id)
                SELECT $1, COALESCE(newest.created_at, now() - make_interval(secs => $2)),
                       COALESCE(newest.id, $3::uuid)
                  FROM (SELECT 1) one
                  LEFT JOIN LATERAL (
                        SELECT created_at, id FROM {self.log}
                         WHERE created_at IS NOT NULL
                           AND created_at <= now() - make_interval(secs => $2)
                         ORDER BY created_at DESC, id DESC LIMIT 1) newest ON true
                ON CONFLICT (name) DO NOTHING
                RETURNING name""",
            LOG_CURSOR, lag_seconds, ZERO_UUID)
        return inserted is not None

    async def advance_cursor(self, name: str, created_at: Any, entry_id: Any) -> None:
        await self.conn.execute(
            f"""UPDATE {self.cursor} SET last_created_at = $2, last_entry_id = $3::uuid,
                       updated_at = now() WHERE name = $1""",
            name, created_at, str(entry_id))

    async def create_log_cursor(self, created_at: Any, entry_id: Any) -> bool:
        """The backfill's cursor. False when a sweep created one first."""
        inserted = await self.conn.fetchval(
            f"""INSERT INTO {self.cursor} (name, last_created_at, last_entry_id)
                VALUES ($1, $2, $3::uuid) ON CONFLICT (name) DO NOTHING RETURNING name""",
            LOG_CURSOR, created_at, str(entry_id))
        return inserted is not None

    async def has_marker(self, name: str) -> bool:
        return bool(await self.conn.fetchval(
            f"SELECT EXISTS (SELECT 1 FROM {self.cursor} WHERE name = $1)", name))

    async def set_marker(self, name: str) -> None:
        await self.conn.execute(
            f"""INSERT INTO {self.cursor} (name, last_created_at) VALUES ($1, now())
                ON CONFLICT (name) DO UPDATE SET last_created_at = now(), updated_at = now()""",
            name)

    # ── Auth log ──
    async def factor_entries(self, after: dict[str, Any], *, lag_seconds: int, limit: int,
                             until: tuple[Any, Any] | None = None) -> list[dict[str, Any]]:
        """Factor entries after ``after``, optionally through ``until`` (inclusive)."""
        args: list[Any] = [after["last_created_at"], str(after["last_entry_id"] or ZERO_UUID),
                           lag_seconds, list(FACTOR_ACTIONS), limit]
        bound = ""
        if until is not None:   # the backfill's end, inclusive
            n = len(args) + 1
            bound = f"AND (created_at, id) <= (${n}::timestamptz, ${n + 1}::uuid)"
            args += [until[0], str(until[1])]
        rows = await self.conn.fetch(
            f"""SELECT id, created_at,
                       payload::jsonb ->> 'action'                 AS action,
                       payload::jsonb ->> 'actor_id'               AS actor_id,
                       payload::jsonb -> 'traits' ->> 'user_id'       AS trait_user_id,
                       payload::jsonb -> 'traits' ->> 'factor_id'     AS factor_id,
                       payload::jsonb -> 'traits' ->> 'factor_status' AS factor_status,
                       payload::jsonb -> 'traits' ->> 'factor_type'   AS factor_type
                  FROM {self.log}
                 WHERE created_at IS NOT NULL
                   AND created_at <= now() - make_interval(secs => $3)
                   AND (created_at, id) > (COALESCE($1, '-infinity'::timestamptz), $2::uuid)
                   AND payload::jsonb ->> 'action' = ANY($4::text[])
                   {bound}
                 ORDER BY created_at, id
                 LIMIT $5""",
            *args)
        return [dict(r) for r in rows]

    async def oldest_entry_at(self) -> Any:
        return await self.conn.fetchval(f"SELECT min(created_at) FROM {self.log}")

    async def newest_settled_entry(self, lag_seconds: int) -> tuple[Any, Any]:
        """(created_at, id) of the entry ``init_log_cursor`` would start at."""
        row = await self.conn.fetchrow(
            f"""SELECT newest.created_at, newest.id, now() - make_interval(secs => $1) AS cut_off
                  FROM (SELECT 1) one
                  LEFT JOIN LATERAL (
                        SELECT created_at, id FROM {self.log}
                         WHERE created_at IS NOT NULL
                           AND created_at <= now() - make_interval(secs => $1)
                         ORDER BY created_at DESC, id DESC LIMIT 1) newest ON true""",
            lag_seconds)
        if row["id"] is None:
            return row["cut_off"], ZERO_UUID
        return row["created_at"], row["id"]

    async def migration_applied_at(self, filename: str) -> Any:
        return await self.conn.fetchval(
            f"SELECT applied_at FROM {self.migrations} WHERE filename = $1", filename)

    async def log_has(self, factor_id: str, actions: tuple[str, ...], *,
                      before: tuple[Any, Any] | None = None) -> bool:
        """Any log entry for ``factor_id`` with one of ``actions`` (before a position)."""
        sql = (f"""SELECT EXISTS (SELECT 1 FROM {self.log}
                    WHERE payload::jsonb ->> 'action' = ANY($2::text[])
                      AND payload::jsonb -> 'traits' ->> 'factor_id' = $1""")
        args: list[Any] = [factor_id, list(actions)]
        if before is not None:
            sql += " AND (created_at, id) < ($3, $4::uuid)"
            args += [before[0], str(before[1])]
        return bool(await self.conn.fetchval(sql + ")", *args))

    # ── users, audit, outbox ──
    async def load_users(self, ids: list[str]) -> dict[str, dict[str, Any]]:
        rows = await self.conn.fetch(
            f"SELECT id, role, email FROM {self.users} WHERE id = ANY($1::uuid[])", ids)
        return {str(r["id"]): dict(r) for r in rows}

    async def role_at(self, user_id: str, at: Any, current: str | None) -> str | None:
        """The account's role at ``at``: the ``before`` of its first role change
        after that moment (migration 332 audits every one), else the current role."""
        row = await self.conn.fetchrow(
            f"""SELECT before ->> 'role' AS role FROM {self.audit}
                 WHERE target_user_id = $1::uuid AND occurred_at > $2
                   AND event IN ('role_changed', 'staff_row_inserted', 'bootstrap_recovery')
                 ORDER BY occurred_at, id LIMIT 1""",
            user_id, at)
        return row["role"] if row else current

    async def admins(self) -> list[dict[str, Any]]:
        rows = await self.conn.fetch(
            f"SELECT id, email FROM {self.users} WHERE role = 'admin' ORDER BY id")
        return [{"id": str(r["id"]), "email": r["email"]} for r in rows]

    async def audited_entry(self, entry_id: Any) -> bool:
        return bool(await self.conn.fetchval(
            f"""SELECT EXISTS (SELECT 1 FROM {self.audit}
                 WHERE detail ->> 'auth_log_entry_id' = $1)""", str(entry_id)))

    async def audited_verification(self, factor_id: str) -> bool:
        return bool(await self.conn.fetchval(
            f"""SELECT EXISTS (SELECT 1 FROM {self.audit}
                 WHERE event = 'mfa_factor_verified' AND detail ->> 'factor_id' = $1)""",
            factor_id))

    async def snapshot_verified_before(self, factor_id: str, created_at: Any) -> bool:
        return bool(await self.conn.fetchval(
            f"""SELECT EXISTS (SELECT 1 FROM {self.snapshot}
                 WHERE factor_id = $1::uuid AND status = 'verified' AND seen_at < $2)""",
            factor_id, created_at))

    async def snapshot_status(self, factor_id: str) -> str | None:
        return await self.conn.fetchval(
            f"SELECT status FROM {self.snapshot} WHERE factor_id = $1::uuid", factor_id)

    async def insert_audit(self, *, event: str, target: str, actor: str | None,
                           occurred_at: Any, detail: dict[str, Any]) -> tuple[str, Any] | None:
        """One `auth`-sourced row as (id, stored occurred_at); None when this log
        entry is already audited."""
        conflict = ("ON CONFLICT ((detail ->> 'auth_log_entry_id')) "
                    "WHERE detail ->> 'auth_log_entry_id' IS NOT NULL DO NOTHING"
                    if "auth_log_entry_id" in detail else "")
        row = await self.conn.fetchrow(
            f"""INSERT INTO {self.audit}
                    (event, target_user_id, actor_user_id, source, occurred_at, detail)
                VALUES ($1, $2::uuid, $3::uuid, 'auth', COALESCE($4, clock_timestamp()), $5::jsonb)
                {conflict}
                RETURNING id, occurred_at""",
            event, target, actor, occurred_at, json.dumps(detail))
        return (str(row["id"]), row["occurred_at"]) if row else None

    async def enqueue_alert(self, *, audit_id: str, event: str, target: dict[str, Any],
                            actor_id: str | None, actor_email: str | None, occurred_at: Any,
                            detail: dict[str, Any]) -> None:
        # Same email-safe shape as fn_staff_security_record (migration 332).
        payload = {
            "audit_id": audit_id, "event": event,
            "occurred_at": occurred_at.isoformat() if occurred_at else None,
            "source": "auth", "target_user_id": target["id"], "target_email": target.get("email"),
            "actor_user_id": actor_id, "actor_email": actor_email,
            "before": None, "after": None, "operator": None,
            "factor_id": detail.get("factor_id"), "factor_status": detail.get("factor_status"),
        }
        await self.conn.execute(
            f"INSERT INTO {self.outbox} (audit_id, event, payload) VALUES ($1::uuid, $2, $3::jsonb)",
            audit_id, event, json.dumps(payload))

    # ── snapshot ──
    async def lock_snapshot(self, user_id: str) -> dict[str, dict[str, Any]]:
        rows = await self.conn.fetch(
            f"""SELECT factor_id, factor_type, status, seen_at FROM {self.snapshot}
                 WHERE user_id = $1::uuid FOR UPDATE""", user_id)
        return {str(r["factor_id"]): dict(r) for r in rows}

    async def save_snapshot(self, user_id: str, factors: list[dict[str, Any]]) -> None:
        ids = [f["id"] for f in factors]
        await self.conn.execute(
            f"DELETE FROM {self.snapshot} WHERE user_id = $1::uuid AND factor_id <> ALL($2::uuid[])",
            user_id, ids)
        for factor in factors:
            # seen_at = when this status was first observed, so a later
            # verification entry can be told apart from a step-up.
            await self.conn.execute(
                f"""INSERT INTO {self.snapshot} AS s (user_id, factor_id, factor_type, status)
                    VALUES ($1::uuid, $2::uuid, $3, $4)
                    ON CONFLICT (user_id, factor_id) DO UPDATE
                       SET factor_type = EXCLUDED.factor_type, status = EXCLUDED.status,
                           seen_at = CASE WHEN s.status IS DISTINCT FROM EXCLUDED.status
                                          THEN now() ELSE s.seen_at END""",
                user_id, factor["id"], factor["factor_type"], factor["status"])

    async def drop_snapshot_except(self, user_ids: list[str]) -> None:
        await self.conn.execute(
            f"DELETE FROM {self.snapshot} WHERE user_id <> ALL($1::uuid[])", user_ids)


# ── Step 1: Auth audit log ───────────────────────────────────────────────────

async def _record(db: SweepDb, *, event: str, target: dict[str, Any], actor_email: str | None,
                  actor_id: str | None, occurred_at: Any, detail: dict[str, Any]) -> bool:
    inserted = await db.insert_audit(event=event, target=target["id"], actor=actor_id,
                                     occurred_at=occurred_at, detail=detail)
    if inserted is None:
        return False
    # The snapshot backstop has no event time: the alert reuses the detection
    # time the audit row was given, so the email never says "không rõ".
    audit_id, occurred_at = inserted
    if event in ALERT_EVENTS:
        await db.enqueue_alert(audit_id=audit_id, event=event, target=target, actor_id=actor_id,
                               actor_email=actor_email, occurred_at=occurred_at, detail=detail)
    return True


async def _log_event(db: SweepDb, entry: dict[str, Any]) -> tuple[str, str | None, dict] | None:
    """(event, actor id, detail) for one entry, or None when it is not an audit event."""
    action, factor_id = entry["action"], _uuid(entry.get("factor_id"))
    position = (entry["created_at"], entry["id"])
    detail: dict[str, Any] = {
        "auth_log_entry_id": str(entry["id"]), "auth_action": action,
        "factor_id": factor_id, "detected_by": "auth_log",
    }
    if entry.get("factor_type"):
        detail["factor_type"] = str(entry["factor_type"])[:20]
    user = _uuid(entry.get("actor_id"))
    if action in ENROLL_ACTIONS:
        return "mfa_factor_enrolled", user, detail
    if action in VERIFY_ACTIONS:
        if (await db.log_has(factor_id, VERIFY_ACTIONS, before=position)
                or await db.audited_verification(factor_id)
                or await db.snapshot_verified_before(factor_id, entry["created_at"])):
            return None   # a step-up sign-in on an already verified factor
        detail["factor_status"] = "verified"
        return "mfa_factor_verified", user, detail
    status = entry.get("factor_status")
    if action == "factor_deleted":
        # Auth admin API: actor_id is the TARGET, the operator is unknown.
        detail["deleted_via"] = "auth_admin_api"
        if status is None:
            status = await db.snapshot_status(factor_id)
        if status is None and await db.log_has(factor_id, VERIFY_ACTIONS, before=position):
            status = "verified"
        user = None
    if status in ("verified", "unverified"):
        detail["factor_status"] = status
    return "mfa_factor_deleted", user, detail


def _entry_user(entry: dict[str, Any]) -> str | None:
    key = "trait_user_id" if entry["action"] == "factor_deleted" else "actor_id"
    return _uuid(entry.get(key))


async def sweep_auth_log(db: SweepDb, *, lag_seconds: int = LOG_LAG_SECONDS,
                         batch: int = LOG_BATCH) -> LogSummary:
    summary = LogSummary()
    while True:
        async with db.conn.transaction():
            cursor = await db.lock_cursor(LOG_CURSOR)
            if cursor is None:
                if await db.init_log_cursor(lag_seconds):
                    summary.initialized = True
                    logger.warning("staff_security_sweep_cursor_initialized cursor=%s", LOG_CURSOR)
                    return summary
                continue
            entries = await db.factor_entries(cursor, lag_seconds=lag_seconds, limit=batch)
            if not entries:
                return summary
            users = await db.load_users([u for u in {_entry_user(e) for e in entries} if u])
            for entry in entries:
                summary.entries += 1
                user_id = _entry_user(entry)
                if user_id is None or _uuid(entry.get("factor_id")) is None:
                    summary.skipped += 1
                    logger.error("staff_security_sweep_unparseable_entry entry_id=%s action=%s",
                                 entry["id"], entry["action"])
                    continue
                target = users.get(user_id)
                # FR-010 applies to the role held at the event, not the role now:
                # an admin demoted before this run still gets the row and alert.
                if not target or await db.role_at(user_id, entry["created_at"],
                                                  target.get("role")) != "admin":
                    continue
                mapped = await _log_event(db, entry)
                if mapped is None:
                    continue
                event, actor_id, detail = mapped
                if await _record(db, event=event, target={**target, "id": user_id},
                                 actor_email=target.get("email") if actor_id else None,
                                 actor_id=actor_id, occurred_at=entry["created_at"],
                                 detail=detail):
                    summary.rows += 1
            last = entries[-1]
            await db.advance_cursor(LOG_CURSOR, last["created_at"], last["id"])
        if len(entries) < batch:
            return summary


# ── Backfill: the first run's history, without alerts ──────────────────────

async def backfill_auth_log(db: SweepDb, *, commit: bool, run_id: str | None = None,
                            lag_seconds: int = LOG_LAG_SECONDS,
                            batch: int = LOG_BATCH) -> BackfillSummary:
    """Audit the factor events step 1 never saw (module docstring). A dry run
    reads in one read-only transaction; ``commit`` writes the rows, and the
    cursor when there is none, one transaction per batch. It never enqueues an
    owner alert."""
    summary = BackfillSummary(run_id=run_id or str(uuid.uuid4()), commit=commit)
    if commit:
        await _backfill(db, summary, lag_seconds=lag_seconds, batch=batch)
    else:
        async with db.conn.transaction(isolation="repeatable_read", readonly=True):
            await _backfill(db, summary, lag_seconds=lag_seconds, batch=batch)
    return summary


async def _backfill(db: SweepDb, summary: BackfillSummary, *, lag_seconds: int,
                    batch: int) -> None:
    commit = summary.commit
    applied = await db.migration_applied_at(MIGRATION_332)
    if applied is None:
        raise RuntimeError(f"{MIGRATION_332} is not recorded in _schema_migrations")
    summary.migration_332_applied_at = applied
    summary.log_oldest_at = await db.oldest_entry_at()
    cursor = await db.read_cursor(LOG_CURSOR)
    if cursor is not None and cursor["last_created_at"] is not None:
        # Step 1 already owns everything after the cursor; leave it unchanged.
        end = (cursor["last_created_at"], cursor["last_entry_id"] or ZERO_UUID)
        summary.end_bound = "cursor"
    elif cursor is not None:
        raise RuntimeError("the log cursor has no position; repair it before a backfill")
    else:
        end = await db.newest_settled_entry(lag_seconds)
        summary.end_bound = "newest_entry"
    summary.end_at = end[0]
    after: dict[str, Any] = {"last_created_at": None, "last_entry_id": None}
    while True:
        async with (db.conn.transaction() if commit else nullcontext()):
            entries = await db.factor_entries(after, lag_seconds=lag_seconds, limit=batch,
                                              until=end)
            users = await db.load_users([u for u in {_entry_user(e) for e in entries} if u])
            for entry in entries:
                await _backfill_entry(db, entry, users, summary)
            final = len(entries) < batch
            if final and commit and cursor is None:
                if not await db.create_log_cursor(*end):
                    raise BackfillCursorRace("the log cursor appeared during the backfill")
                summary.cursor_created = True
        if final:
            return
        after = {"last_created_at": entries[-1]["created_at"], "last_entry_id": entries[-1]["id"]}


async def _backfill_entry(db: SweepDb, entry: dict[str, Any], users: dict[str, dict[str, Any]],
                          summary: BackfillSummary) -> None:
    summary.entries_by_action[entry["action"]] += 1
    at = entry["created_at"]
    summary.entry_min_at = at if summary.entry_min_at is None else min(summary.entry_min_at, at)
    summary.entry_max_at = at if summary.entry_max_at is None else max(summary.entry_max_at, at)
    skipped = summary.skipped_by_reason
    user_id = _entry_user(entry)
    if user_id is None or _uuid(entry.get("factor_id")) is None:
        skipped["unparseable"] += 1
        return
    if at < summary.migration_332_applied_at:
        skipped["before_332"] += 1   # no role history to decide eligibility
        return
    target = users.get(user_id)
    if not target:
        skipped["unknown_user"] += 1
        return
    if await db.role_at(user_id, at, target.get("role")) != "admin":
        skipped["not_admin"] += 1
        return
    if await db.audited_entry(entry["id"]):
        skipped["duplicate"] += 1
        return
    mapped = await _log_event(db, entry)
    if mapped is None:
        skipped["step_up"] += 1
        return
    event, actor_id, detail = mapped
    detail.update(backfill=True, backfill_run_id=summary.run_id)
    if summary.commit and await db.insert_audit(event=event, target=user_id, actor=actor_id,
                                                occurred_at=at, detail=detail) is None:
        skipped["duplicate"] += 1   # a concurrent sweep wrote it first
        return
    summary.written_by_event[event] += 1
    summary.users.add(user_id)


# ── Step 2: snapshot backstop ────────────────────────────────────────────────

def _clean_factors(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        raise ValueError("factor list is not an array")
    factors = []
    for item in raw:
        factor_id = _uuid(item.get("id")) if isinstance(item, dict) else None
        if factor_id is None:
            raise ValueError("factor without an id")
        factors.append({"id": factor_id,
                        "factor_type": str(item.get("factor_type") or "unknown")[:20],
                        "status": str(item.get("status") or "unknown")[:20]})
    return factors


async def _missed(db: SweepDb, admin: dict[str, Any], event: str, factor: dict[str, Any]) -> None:
    detail = {"factor_id": factor["id"], "factor_type": factor["factor_type"],
              "factor_status": factor["status"], "detected_by": "snapshot"}
    logger.error("staff_security_sweep_log_missed_event event=%s user_id=%s factor_id=%s",
                 event, admin["id"], factor["id"])
    await _record(db, event=event, target=admin, actor_email=None, actor_id=None,
                  occurred_at=None, detail=detail)


async def _reconcile_admin(db: SweepDb, admin: dict[str, Any], factors: list[dict[str, Any]],
                           *, seeding: bool) -> int:
    diffs = 0
    async with db.conn.transaction():
        before = await db.lock_snapshot(admin["id"])
        if not seeding:
            now = {f["id"]: f for f in factors}
            for factor in factors:
                old = before.get(factor["id"])
                if old is None and not await db.log_has(factor["id"], ENROLL_ACTIONS):
                    await _missed(db, admin, "mfa_factor_enrolled", factor)
                    diffs += 1
                if (factor["status"] == "verified" and (old is None or old["status"] != "verified")
                        and not await db.log_has(factor["id"], VERIFY_ACTIONS)):
                    await _missed(db, admin, "mfa_factor_verified", factor)
                    diffs += 1
            for factor_id, old in before.items():
                # GoTrue drops unverified factors on verify without a log entry.
                if (factor_id not in now and old["status"] == "verified"
                        and not await db.log_has(factor_id, DELETE_ACTIONS)):
                    await _missed(db, admin, "mfa_factor_deleted",
                                  {"id": factor_id, "factor_type": old["factor_type"],
                                   "status": old["status"]})
                    diffs += 1
        await db.save_snapshot(admin["id"], factors)
    return diffs


async def reconcile_snapshot(db: SweepDb, list_factors: FactorLister) -> SnapshotSummary:
    summary = SnapshotSummary(seeding=not await db.has_marker(SNAPSHOT_MARKER))
    admins = await db.admins()
    summary.admins = len(admins)
    for admin in admins:
        try:
            factors = _clean_factors(await list_factors(admin["id"]))
        except Exception as exc:   # one admin's lookup must not hide the others
            summary.errors += 1
            logger.error("staff_security_sweep_factor_list_failed user_id=%s error=%s",
                         admin["id"], type(exc).__name__)
            continue
        summary.factor_diffs += await _reconcile_admin(db, admin, factors,
                                                       seeding=summary.seeding)
    await db.drop_snapshot_except([a["id"] for a in admins])
    if summary.seeding and not summary.errors:
        await db.set_marker(SNAPSHOT_MARKER)
    return summary


def auth_admin_factor_lister(supabase_url: str, service_key: str, client: Any) -> FactorLister:
    """GET /auth/v1/admin/users/{id}/factors with the service key (research.md §9.3)."""
    base = supabase_url.rstrip("/")
    headers = {"apikey": service_key, "Authorization": f"Bearer {service_key}"}

    async def list_factors(user_id: str) -> list[dict[str, Any]]:
        response = await client.get(f"{base}/auth/v1/admin/users/{user_id}/factors",
                                    headers=headers)
        response.raise_for_status()
        return response.json()

    return list_factors


# ── Entry point ──────────────────────────────────────────────────────────────

def _dsn() -> str:
    raw = (os.environ.get("DATABASE_URL") or "").strip()
    return raw.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _connect():
    import asyncpg
    dsn = _dsn()
    if not dsn:
        raise RuntimeError("DATABASE_URL is not set")
    # statement_cache_size=0 keeps the sweep safe behind a transaction pooler.
    return await asyncpg.connect(dsn, statement_cache_size=0)


def _error(exc: BaseException) -> str:
    sqlstate = getattr(exc, "sqlstate", None)
    return f"{type(exc).__name__}" + (f"[{sqlstate}]" if sqlstate else "")


async def _run_steps(steps: tuple[tuple[str, Callable[[], Awaitable[Any]]], ...],
                     fields: dict[str, Any], prefix: str = "") -> tuple[bool, set[str]]:
    """Run each step, recording its summary as fields. Returns (ok, steps that ran)."""
    ok, done = True, set()
    for name, step in steps:
        key = prefix + name
        try:
            result = await step()
        except Exception as exc:
            ok = False
            fields[f"{key}_error"] = _error(exc)
            logger.error("staff_security_sweep_step_failed step=%s error=%s", key, _error(exc))
            continue
        done.add(name)
        fields.update({f"{key}_{k}": v for k, v in asdict(result).items()})
        if name == "snapshot" and result.errors:
            ok = False
        if name == "dispatch" and result.unconfigured:
            # Due alerts that cannot go out must not look like a green run.
            ok = False
            logger.error("staff_security_sweep_alerts_unsent step=%s missing=%s due=%d",
                         key, result.missing, result.due)
    return ok, done


async def run_sweep(conn: Any, list_factors: FactorLister, *, schema: str = "public",
                    auth_schema: str = "auth", config: owner_alerts.TransportConfig | None = None,
                    send: owner_alerts.Sender = owner_alerts.send_via_resend,
                    lag_seconds: int = LOG_LAG_SECONDS, follow_up_seconds: float | None = None,
                    sleep: Callable[[float], Awaitable[Any]] = asyncio.sleep,
                    clock: Callable[[], float] = time.monotonic) -> tuple[dict[str, Any], bool]:
    """One run of the three steps, then (with ``follow_up_seconds``) steps 1 and
    3 again that long after the start. Returns (summary fields, ok)."""
    started = clock()
    db = SweepDb(conn, schema=schema, auth_schema=auth_schema)
    fields: dict[str, Any] = {}
    log = ("log", lambda: sweep_auth_log(db, lag_seconds=lag_seconds))
    dispatch = ("dispatch", lambda: owner_alerts.dispatch_due(
        owner_alerts.PgOutboxStore(conn, schema), config=config, send=send))
    ok, done = await _run_steps((log, ("snapshot", lambda: reconcile_snapshot(db, list_factors)),
                                 dispatch), fields)
    if follow_up_seconds is None:
        return fields, ok
    # A step that failed already fails the run; the next run retries it from
    # the same cursor.
    again = tuple(step for step in (log, dispatch) if step[0] in done)
    if not again:
        return fields, ok
    wait = started + follow_up_seconds - clock()
    if wait > 0:
        await sleep(wait)
    follow_ok, _ = await _run_steps(again, fields, prefix="follow_up_")
    return fields, ok and follow_ok


async def _main(args: argparse.Namespace) -> int:
    if args.test_alert:
        result = await owner_alerts.send_test_alert()
        logger.info("staff_security_sweep_test_alert ok=%s error=%s", result.ok, result.error)
        return 0 if result.ok else 1
    conn = await _connect()
    try:
        if args.requeue:
            audit_id = _uuid(args.requeue)
            if audit_id is None:
                logger.error("staff_security_sweep_requeue_invalid_id")
                return 2
            done = await owner_alerts.PgOutboxStore(conn).requeue(audit_id)
            logger.info("staff_security_sweep_requeue audit_id=%s requeued=%s", audit_id, done)
            return 0 if done else 1
        if args.backfill:
            summary = await backfill_auth_log(SweepDb(conn), commit=args.commit,
                                              lag_seconds=LOG_LAG_SECONDS)
            logger.info("staff_security_sweep_backfill_summary %s", summary.line())
            return 0
        import httpx
        from config import settings
        async with httpx.AsyncClient(timeout=15.0) as client:
            lister = auth_admin_factor_lister(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY,
                                              client)
            fields, ok = await run_sweep(conn, lister, follow_up_seconds=FOLLOW_UP_SECONDS)
        logger.info("staff_security_sweep_summary %s",
                    " ".join(f"{k}={v}" for k, v in fields.items()))
        return 0 if ok else 1
    finally:
        await conn.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--test-alert", action="store_true",
                       help="send the fixed test message to OWNER_ALERT_EMAILS and exit")
    group.add_argument("--requeue", metavar="AUDIT_ID",
                       help="give a failed alert a fresh set of attempts")
    group.add_argument("--backfill", action="store_true",
                       help="audit the factor events before the first cron run, without "
                            "alerts (dry run unless --commit)")
    parser.add_argument("--commit", action="store_true",
                        help="with --backfill: write the audit rows and the cursor")
    args = parser.parse_args(argv)
    if args.commit and not args.backfill:
        parser.error("--commit requires --backfill")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    from scripts._script_env import load_env
    load_env("DATABASE_URL")
    try:
        return asyncio.run(_main(args))
    except Exception as exc:
        logger.error("staff_security_sweep_failed error=%s", _error(exc))
        return 1


if __name__ == "__main__":
    sys.exit(main())
