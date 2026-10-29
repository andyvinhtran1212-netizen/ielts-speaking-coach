"""Staff security sweep (ADMINAAL2-0032 FR-010/FR-011, T007/T008).

Runs the real sweep SQL against migration 332 in a disposable schema, with a
stand-in ``auth.audit_log_entries`` shaped like GoTrue's (``payload`` is
``json``) and the event shapes observed on staging (research.md §9.4). The
connection uses the NOSUPERUSER schema owner, like the hosted ``postgres``
role. Supabase Auth's factor list and Resend are fakes.

Proves: a factor enrolled, verified and deleted between two runs gives its own
rows; re-runs and a rewound cursor never duplicate; a failure rolls back the
batch and the cursor so nothing is skipped; step-up sign-ins are not new
verifications; eligibility is the role held when the event happened; the
snapshot backstop fires only when the log misses an event, and its alert carries
the stored detection time; audit rows and alert payloads carry no secret; due
alerts with no e-mail transport fail the run (PC-J73 F3); an event just before
a cron tick is audited within 5 minutes (PC-J66 F04). ``--backfill`` (PC-J139)
writes nothing in a dry run, audits old events from 332 on without any alert,
never duplicates, and hands over to the cron at the cursor with no gap.

Set TEST_PG_URL to a LOCAL disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from pathlib import Path
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest

import test_migration_332_staff_security_audit as m332
from scripts import staff_security_sweep as sweep
from services import owner_alerts as oa
from test_migration_240_core_attempt_evidence import psql

BACKEND = Path(__file__).resolve().parents[1]
CONFIG = oa.transport_config({"OWNER_ALERT_EMAILS": "owner@example.com",
                              "RESEND_API_KEY": "re_test_key_0123456789"})
TOTP_SECRET = "JBSWY3DPEHPK3PXP"


def run(coro):
    return asyncio.run(coro)


# ── Static: cron definition and entry point ─────────────────────────────────

def test_railway_cron_definition_runs_the_sweep_every_five_minutes():
    path = BACKEND / "railway.staff-security-sweep.json"
    spec = json.loads(path.read_text(encoding="utf-8"))
    assert spec["deploy"] == {"startCommand": "python -m scripts.staff_security_sweep",
                              "cronSchedule": "*/5 * * * *", "restartPolicyType": "NEVER"}
    # A file named railway.json/railway.toml would be picked up by the existing
    # backend service and turn the API itself into a cron job.
    assert not (BACKEND / "railway.json").exists() and not (BACKEND / "railway.toml").exists()


def test_test_alert_without_transport_exits_non_zero_without_a_database(monkeypatch, caplog):
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("OWNER_ALERT_EMAILS", raising=False)

    async def no_connect():
        raise AssertionError("--test-alert must not need the database")

    monkeypatch.setattr(sweep, "_connect", no_connect)
    with caplog.at_level(logging.WARNING):
        assert sweep.main(["--test-alert"]) == 1
    assert "owner_alert_transport_unconfigured missing=RESEND_API_KEY,OWNER_ALERT_EMAILS" in caplog.text


def test_factor_entries_with_until_and_user_id_keeps_placeholders_and_args_aligned():
    conn = AsyncMock()
    conn.fetch.return_value = []
    after = {"last_created_at": "2026-10-28T00:00:00Z", "last_entry_id": uuid4()}
    until = ("2026-10-29T00:00:00Z", uuid4())
    user_id = str(uuid4())

    assert run(sweep.SweepDb(conn).factor_entries(
        after, lag_seconds=15, limit=20, until=until, user_id=user_id)) == []

    conn.fetch.assert_awaited_once()
    sql, *args = conn.fetch.call_args.args
    assert "<= ($6::timestamptz, $7::uuid)" in sql
    assert "ELSE payload::jsonb ->> 'actor_id' END = $8" in sql
    assert args == [after["last_created_at"], str(after["last_entry_id"]),
                    15, list(sweep.FACTOR_ACTIONS), 20, until[0], str(until[1]), user_id]


# ── PostgreSQL harness ──────────────────────────────────────────────────────

@pytest.fixture
def pg():
    m332._require_pg()
    schema = "sweep_" + uuid4().hex
    auth = schema + "_auth"
    try:
        m332._build(schema)
        m332._apply(schema)
        psql(f"""CREATE SCHEMA {auth};
                 CREATE TABLE {auth}.audit_log_entries (
                     instance_id uuid, id uuid PRIMARY KEY, payload json,
                     created_at timestamptz, ip_address varchar(64) NOT NULL DEFAULT '');
                 GRANT USAGE ON SCHEMA {auth} TO {m332.OWNER};
                 GRANT SELECT ON {auth}.audit_log_entries TO {m332.OWNER};""")
        yield schema, auth
    finally:
        psql(f"DROP SCHEMA IF EXISTS {auth} CASCADE; DROP SCHEMA IF EXISTS {schema} CASCADE")


def _log(auth: str, action: str, user: str, factor: str, *, status: str | None = None,
         trait_user: str | None = None, extra: dict | None = None) -> str:
    entry = str(uuid4())
    traits = {"factor_id": factor, **(extra or {})}
    if status:
        traits["factor_status"] = status
    if trait_user:
        traits["user_id"] = trait_user
    if action == "verification_attempted":
        traits.update(challenge_id=str(uuid4()), factor_type="totp")
    payload = {"action": action, "log_type": "factor", "actor_id": user,
               "actor_username": f"{user}@q332.test", "traits": traits}
    psql(f"""INSERT INTO {auth}.audit_log_entries (id, payload, created_at)
             VALUES ('{entry}', '{json.dumps(payload)}'::json, clock_timestamp())""")
    return entry


def _lifecycle(auth: str, user: str, factor: str) -> list[str]:
    return [_log(auth, "factor_in_progress", user, factor),
            _log(auth, "challenge_created", user, factor, status="unverified"),
            _log(auth, "verification_attempted", user, factor),
            _log(auth, "token_revoked", user, factor),
            _log(auth, "factor_unenrolled", user, factor, status="verified")]


class Factors:
    """Fake Auth admin API factor list."""

    def __init__(self) -> None:
        self.by_user: dict[str, list[dict]] = {}
        self.failing: set[str] = set()
        self.calls: list[str] = []

    def set(self, user: str, *factors: tuple[str, str]) -> None:
        self.by_user[user] = [{"id": f, "status": status, "factor_type": "totp",
                               "friendly_name": "phone", "secret": TOTP_SECRET}
                              for f, status in factors]

    async def __call__(self, user: str) -> list[dict]:
        self.calls.append(user)
        if user in self.failing:
            raise RuntimeError("auth admin api down")
        return self.by_user.get(user, [])


class Sender:
    def __init__(self) -> None:
        self.calls: list[oa.Email] = []

    async def __call__(self, email, *, config, idempotency_key):
        self.calls.append(email)
        return oa.SendResult(True)


async def _conn():
    import asyncpg
    conn = await asyncpg.connect(os.environ["TEST_PG_URL"], statement_cache_size=0)
    await conn.execute(f"SET ROLE {m332.OWNER}")
    return conn


def _sweep(pg, factors: Factors, *, sender: Sender | None = None, lag: int = 0,
           config=CONFIG) -> tuple[dict, bool]:
    schema, auth = pg

    async def go():
        conn = await _conn()
        try:
            return await sweep.run_sweep(conn, factors, schema=schema, auth_schema=auth,
                                         config=config, send=sender or Sender(), lag_seconds=lag)
        finally:
            await conn.close()

    return run(go())


def _rows(schema: str, user: str) -> list[dict]:
    return [r for r in m332._audit(schema, user) if r["event"].startswith("mfa_")]


def _alerts(schema: str, user: str) -> list[dict]:
    return [o for o in m332._outbox(schema, user) if o["event"].startswith("mfa_")]


def _cursor(schema: str) -> str:
    return psql(f"SELECT last_entry_id FROM {schema}.staff_security_sweep_cursor "
                f"WHERE name = '{sweep.LOG_CURSOR}'")


def _ready(pg, factors: Factors | None = None) -> None:
    """First run: starts the cursor at the newest entry and seeds the snapshot."""
    fields, ok = _sweep(pg, factors or Factors())
    assert ok and fields["log_initialized"] and fields["snapshot_seeding"]


# ── First run ───────────────────────────────────────────────────────────────

def test_first_run_starts_at_the_newest_entry_and_only_seeds_the_snapshot(pg, caplog):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    old = str(uuid4())
    _lifecycle(auth, admin, str(uuid4()))
    _log(auth, "factor_in_progress", admin, old)
    newest = _log(auth, "token_refreshed", admin, old)
    factors = Factors()
    factors.set(admin, (old, "verified"))
    with caplog.at_level(logging.WARNING, logger="staff_security_sweep"):
        fields, ok = _sweep(pg, factors)
    assert ok and fields["log_initialized"] and fields["snapshot_seeding"]
    assert fields["snapshot_factor_diffs"] == 0
    assert "staff_security_sweep_cursor_initialized" in caplog.text
    assert _rows(schema, admin) == [] and _alerts(schema, admin) == []
    assert _cursor(schema) == newest
    assert psql(f"SELECT status FROM {schema}.staff_mfa_factor_snapshot WHERE user_id = '{admin}'") \
        == "verified"
    fields, ok = _sweep(pg, factors)
    assert ok and not fields["log_initialized"] and not fields["snapshot_seeding"]
    assert fields["log_entries"] == 0 and _rows(schema, admin) == []


# ── FR-010: every factor event, from the log ────────────────────────────────

def test_factor_enrolled_verified_and_deleted_between_two_runs_gives_a_row_each(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    factor = str(uuid4())
    entries = _lifecycle(auth, admin, factor)
    sender = Sender()
    fields, ok = _sweep(pg, Factors(), sender=sender)   # the factor is already gone
    assert ok and fields["log_rows"] == 3 and fields["snapshot_factor_diffs"] == 0
    rows = _rows(schema, admin)
    assert [r["event"] for r in rows] == ["mfa_factor_enrolled", "mfa_factor_verified",
                                          "mfa_factor_deleted"]
    assert [r["detail"]["auth_log_entry_id"] for r in rows] == [entries[0], entries[2], entries[4]]
    assert {r["source"] for r in rows} == {"auth"}
    assert {r["actor"] for r in rows} == {admin}
    assert {r["detail"]["factor_id"] for r in rows} == {factor}
    assert {r["detail"]["detected_by"] for r in rows} == {"auth_log"}
    assert rows[2]["detail"]["factor_status"] == "verified"
    # FR-011: verified and deleted are e-mailed, enrollment is audit only.
    outbox = _alerts(schema, admin)
    assert [o["event"] for o in outbox] == ["mfa_factor_verified", "mfa_factor_deleted"]
    assert [o["status"] for o in outbox] == ["sent", "sent"]
    assert [e.text.splitlines()[0] for e in sender.calls] == [
        "Admin xác minh yếu tố xác thực 2 bước", "Admin bị xoá yếu tố xác thực 2 bước"]
    assert all(f"Yếu tố 2 bước: {factor}" in e.text for e in sender.calls)
    assert _cursor(schema) == entries[4]


def test_rerun_and_a_rewound_cursor_never_duplicate_a_row_or_an_alert(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    _lifecycle(auth, admin, str(uuid4()))
    sender = Sender()
    _sweep(pg, Factors(), sender=sender)
    before = (_rows(schema, admin), _alerts(schema, admin))
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["log_entries"] == 0 and fields["log_rows"] == 0
    psql(f"UPDATE {schema}.staff_security_sweep_cursor SET last_created_at = NULL, "
         f"last_entry_id = NULL WHERE name = '{sweep.LOG_CURSOR}'")
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["log_entries"] == 3 and fields["log_rows"] == 0
    assert (_rows(schema, admin), _alerts(schema, admin)) == before
    assert len(sender.calls) == 2


def test_a_failure_rolls_back_the_batch_and_the_cursor_so_nothing_is_skipped(pg, monkeypatch):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    start = _cursor(schema)
    _lifecycle(auth, admin, str(uuid4()))
    real = sweep.SweepDb.enqueue_alert
    calls = {"n": 0}

    async def fail_second(self, **kwargs):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("outbox insert failed")
        return await real(self, **kwargs)

    monkeypatch.setattr(sweep.SweepDb, "enqueue_alert", fail_second)
    fields, ok = _sweep(pg, Factors())
    assert not ok and fields["log_error"] == "RuntimeError"
    assert _rows(schema, admin) == [] and _alerts(schema, admin) == []
    assert _cursor(schema) == start
    monkeypatch.setattr(sweep.SweepDb, "enqueue_alert", real)
    fields, ok = _sweep(pg, Factors())
    assert ok and fields["log_rows"] == 3
    assert len(_alerts(schema, admin)) == 2


def test_entries_younger_than_the_lag_wait_for_the_next_run(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    factor = str(uuid4())
    _log(auth, "factor_in_progress", admin, factor)
    fields, ok = _sweep(pg, Factors(), lag=60)
    assert ok and fields["log_entries"] == 0 and _rows(schema, admin) == []
    fields, ok = _sweep(pg, Factors(), lag=0)
    assert ok and fields["log_rows"] == 1


def test_step_up_sign_ins_are_not_new_verifications(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    seeded = str(uuid4())
    _log(auth, "factor_in_progress", admin, seeded)
    _log(auth, "verification_attempted", admin, seeded)
    factors = Factors()
    factors.set(admin, (seeded, "verified"))
    _ready(pg, factors)
    fresh = str(uuid4())
    _log(auth, "factor_in_progress", admin, fresh)
    _log(auth, "verification_attempted", admin, fresh)
    _log(auth, "verification_attempted", admin, fresh)       # step-up in the same batch
    _log(auth, "verification_attempted", admin, seeded)      # step-up on a pre-sweep factor
    factors.set(admin, (seeded, "verified"), (fresh, "verified"))
    fields, ok = _sweep(pg, factors)
    assert ok and fields["snapshot_factor_diffs"] == 0
    assert [(r["event"], r["detail"]["factor_id"]) for r in _rows(schema, admin)] == [
        ("mfa_factor_enrolled", fresh), ("mfa_factor_verified", fresh)]
    _log(auth, "verification_attempted", admin, fresh)       # step-up in a later run
    fields, ok = _sweep(pg, factors)
    assert ok and fields["log_entries"] == 1 and fields["log_rows"] == 0


def test_a_verification_seen_by_the_snapshot_first_is_still_recorded_from_the_log(pg):
    """Run k's snapshot sees the verified factor while its log entry is inside the lag."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    factor = str(uuid4())
    _log(auth, "factor_in_progress", admin, factor)
    _log(auth, "verification_attempted", admin, factor)
    factors = Factors()
    factors.set(admin, (factor, "verified"))
    fields, ok = _sweep(pg, factors, lag=60)
    assert ok and fields["log_entries"] == 0 and fields["snapshot_factor_diffs"] == 0
    fields, ok = _sweep(pg, factors, lag=0)
    assert ok and fields["log_rows"] == 2
    assert [r["event"] for r in _rows(schema, admin)] == ["mfa_factor_enrolled",
                                                          "mfa_factor_verified"]


def test_admin_api_delete_targets_traits_user_with_an_unknown_actor(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    factor = str(uuid4())
    factors = Factors()
    factors.set(admin, (factor, "verified"))
    _ready(pg, factors)
    # GoTrue writes the TARGET as actor_id for an admin-API delete (research.md §9.4).
    entry = _log(auth, "factor_deleted", admin, factor, trait_user=admin)
    sender = Sender()
    factors.set(admin)
    fields, ok = _sweep(pg, factors, sender=sender)
    assert ok and fields["log_rows"] == 1 and fields["snapshot_factor_diffs"] == 0
    [row] = _rows(schema, admin)
    assert row["event"] == "mfa_factor_deleted" and row["actor"] is None
    assert row["detail"] == {"auth_log_entry_id": entry, "auth_action": "factor_deleted",
                             "factor_id": factor, "detected_by": "auth_log",
                             "deleted_via": "auth_admin_api", "factor_status": "verified"}
    [email] = sender.calls
    assert "Người thực hiện: không rõ (ngoài ứng dụng)" in email.text
    assert f"{admin}@q332.test" in email.subject


def test_only_admin_accounts_are_audited_and_the_cursor_moves_past_the_rest(pg, caplog):
    schema, auth = pg
    student = m332._user(schema, "student", True)
    instructor = m332._user(schema, "instructor", True)
    _ready(pg)
    _lifecycle(auth, student, str(uuid4()))
    _lifecycle(auth, instructor, str(uuid4()))
    bad = _log(auth, "factor_in_progress", "not-a-uuid", str(uuid4()))
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        fields, ok = _sweep(pg, Factors())
    assert ok and fields["log_entries"] == 7 and fields["log_rows"] == 0 and fields["log_skipped"] == 1
    assert f"staff_security_sweep_unparseable_entry entry_id={bad}" in caplog.text
    assert _rows(schema, student) == [] and _rows(schema, instructor) == []
    assert _cursor(schema) == bad


def test_eligibility_is_the_role_held_when_the_factor_event_happened(pg):
    """Codex #1884: a demotion between the event and the sweep must not drop it."""
    schema, auth = pg
    demoted = m332._user(schema, "admin", True)
    promoted = m332._user(schema, "student", True)
    _ready(pg)
    deleted, learner_factor = str(uuid4()), str(uuid4())
    _log(auth, "factor_in_progress", demoted, deleted)
    _log(auth, "verification_attempted", demoted, deleted)
    entry = _log(auth, "factor_unenrolled", demoted, deleted, status="verified")
    _lifecycle(auth, promoted, learner_factor)
    # Remediation runs before the next sweep: the admin is demoted, and the
    # learner gains admin after their own factor events.
    psql(f"UPDATE {schema}.users SET role = 'student' WHERE id = '{demoted}'")
    psql(f"UPDATE {schema}.users SET role = 'admin' WHERE id = '{promoted}'")
    sender = Sender()
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["log_rows"] == 3
    rows = _rows(schema, demoted)
    assert [r["event"] for r in rows] == ["mfa_factor_enrolled", "mfa_factor_verified",
                                          "mfa_factor_deleted"]
    assert rows[2]["detail"]["auth_log_entry_id"] == entry
    assert [o["event"] for o in _alerts(schema, demoted)] == ["mfa_factor_verified",
                                                             "mfa_factor_deleted"]
    assert sum(f"{demoted}@q332.test" in e.subject and "yếu tố" in e.text.splitlines()[0]
               for e in sender.calls) == 2
    assert _rows(schema, promoted) == [] and _alerts(schema, promoted) == []


def test_audit_rows_and_alerts_carry_no_secret(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    factor = str(uuid4())
    _log(auth, "factor_in_progress", admin, factor,
         extra={"secret": TOTP_SECRET, "qr_code": "otpauth://totp/x?secret=" + TOTP_SECRET})
    _log(auth, "verification_attempted", admin, factor, extra={"code": "123456"})
    sender = Sender()
    factors = Factors()
    factors.set(admin, (factor, "verified"))
    _sweep(pg, factors, sender=sender)
    stored = psql(f"SELECT json_agg(a) FROM {schema}.staff_security_audit a "
                  f"WHERE target_user_id = '{admin}'") + psql(
        f"SELECT json_agg(o) FROM {schema}.owner_alert_outbox o") + psql(
        f"SELECT json_agg(s) FROM {schema}.staff_mfa_factor_snapshot s")
    for value in (TOTP_SECRET, "otpauth", "123456", "phone"):
        assert value not in stored
        assert all(value not in e.text and value not in e.subject for e in sender.calls)


# ── Snapshot backstop ───────────────────────────────────────────────────────

def test_snapshot_backstop_fires_only_when_the_log_missed_the_event(pg, caplog):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    logged, missed, gone, unverified = (str(uuid4()) for _ in range(4))
    factors = Factors()
    factors.set(admin, (gone, "verified"), (unverified, "unverified"))
    _ready(pg, factors)
    _log(auth, "factor_in_progress", admin, logged)
    _log(auth, "verification_attempted", admin, logged)
    # `missed` appears and `gone` vanishes with no log entry; GoTrue silently
    # drops `unverified` on verify, which must not count as a miss.
    factors.set(admin, (logged, "verified"), (missed, "verified"))
    sender = Sender()
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        fields, ok = _sweep(pg, factors, sender=sender)
    assert ok and fields["log_rows"] == 2 and fields["snapshot_factor_diffs"] == 3
    backstop = [r for r in _rows(schema, admin) if r["detail"]["detected_by"] == "snapshot"]
    assert [(r["event"], r["detail"]["factor_id"]) for r in backstop] == [
        ("mfa_factor_enrolled", missed), ("mfa_factor_verified", missed), ("mfa_factor_deleted", gone)]
    assert {r["source"] for r in backstop} == {"auth"} and {r["actor"] for r in backstop} == {None}
    assert "auth_log_entry_id" not in json.dumps(backstop)
    assert caplog.text.count("staff_security_sweep_log_missed_event") == 3
    assert [o["event"] for o in _alerts(schema, admin)] == [
        "mfa_factor_verified", "mfa_factor_verified", "mfa_factor_deleted"]
    assert len(sender.calls) == 3
    # FR-011: the e-mail carries the detection time stored on the audit row.
    stored = psql(f"""SELECT string_agg(to_char(occurred_at AT TIME ZONE 'Asia/Ho_Chi_Minh',
                                                 'DD/MM/YYYY HH24:MI:SS'), ',' ORDER BY occurred_at, id)
                        FROM {schema}.staff_security_audit
                       WHERE target_user_id = '{admin}' AND detail ->> 'detected_by' = 'snapshot'
                         AND event <> 'mfa_factor_enrolled'""").split(",")
    assert all(o["payload"]["occurred_at"] for o in _alerts(schema, admin))
    assert sorted(line for e in sender.calls[-2:] for line in e.text.splitlines()
                  if line.startswith("Thời điểm:")) == sorted(
        f"Thời điểm: {t} (giờ Việt Nam)" for t in stored)
    assert all("không rõ" not in line for e in sender.calls for line in e.text.splitlines()
               if line.startswith("Thời điểm:"))
    # The snapshot now matches, so a re-run finds nothing.
    fields, ok = _sweep(pg, factors, sender=sender)
    assert ok and fields["snapshot_factor_diffs"] == 0 and len(sender.calls) == 3


def test_a_failed_factor_list_keeps_that_snapshot_and_fails_the_run(pg, caplog):
    schema, auth = pg
    first, second = m332._user(schema, "admin", True), m332._user(schema, "admin", True)
    kept, new = str(uuid4()), str(uuid4())
    factors = Factors()
    factors.set(first, (kept, "verified"))
    _ready(pg, factors)
    factors.failing.add(first)
    factors.set(second, (new, "unverified"))
    _log(auth, "factor_in_progress", second, new)
    with caplog.at_level(logging.ERROR, logger="staff_security_sweep"):
        fields, ok = _sweep(pg, factors)
    assert not ok and fields["snapshot_errors"] == 1
    assert f"staff_security_sweep_factor_list_failed user_id={first} error=RuntimeError" in caplog.text
    assert psql(f"SELECT factor_id FROM {schema}.staff_mfa_factor_snapshot "
                f"WHERE user_id = '{first}'") == kept
    assert psql(f"SELECT factor_id FROM {schema}.staff_mfa_factor_snapshot "
                f"WHERE user_id = '{second}'") == new
    assert fields["dispatch_due"] == 0 and fields["log_rows"] == 1


def test_a_seeding_run_with_a_failed_list_seeds_again_next_time(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    factors = Factors()
    factors.set(admin, (str(uuid4()), "verified"))
    factors.failing.add(admin)
    fields, ok = _sweep(pg, factors)
    assert not ok and fields["snapshot_seeding"]
    factors.failing.clear()
    fields, ok = _sweep(pg, factors)
    assert ok and fields["snapshot_seeding"] and fields["snapshot_factor_diffs"] == 0
    assert _rows(schema, admin) == []
    fields, ok = _sweep(pg, factors)
    assert ok and not fields["snapshot_seeding"]


def test_snapshot_rows_of_accounts_that_are_no_longer_admin_are_dropped(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    keeper = m332._user(schema, "admin", True)
    factors = Factors()
    factors.set(admin, (str(uuid4()), "verified"))
    _ready(pg, factors)
    psql(f"UPDATE {schema}.users SET role = 'student' WHERE id = '{admin}'")
    fields, ok = _sweep(pg, factors)
    assert ok and fields["snapshot_admins"] == 1
    assert factors.calls.count(keeper) == 2
    assert psql(f"SELECT count(*) FROM {schema}.staff_mfa_factor_snapshot") == "0"
    assert factors.calls.count(admin) == 1


# ── Dispatch inside the sweep ───────────────────────────────────────────────

def test_the_sweep_sends_trigger_alerts_once_and_leaves_them_pending_without_transport(pg, caplog):
    schema, _ = pg
    target = m332._user(schema, "instructor", True)
    _ready(pg)
    psql(f"UPDATE {schema}.users SET role = 'admin' WHERE id = '{target}'")   # out of band
    unconfigured = oa.transport_config({})
    with caplog.at_level(logging.WARNING):
        fields, ok = _sweep(pg, Factors(), config=unconfigured)
    # PC-J73 F3: a due alert that cannot be sent fails the run (cron not green).
    assert not ok and fields["dispatch_unconfigured"] and fields["dispatch_due"] == 1
    assert fields["dispatch_missing"] == "RESEND_API_KEY,OWNER_ALERT_EMAILS"
    assert "owner_alert_transport_unconfigured" in caplog.text
    assert ("staff_security_sweep_alerts_unsent step=dispatch "
            "missing=RESEND_API_KEY,OWNER_ALERT_EMAILS due=1") in caplog.text
    assert [(o["status"], o["attempts"]) for o in m332._outbox(schema, target)] == [("pending", 0)]
    sender = Sender()
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["dispatch_sent"] == 1
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["dispatch_due"] == 0
    [email] = sender.calls
    assert email.subject == f"[Aver] Tài khoản được CẤP quyền admin: {target}@q332.test"
    assert "Nguồn: ngoài ứng dụng (SQL editor / runner)" in email.text


def test_without_transport_a_run_with_nothing_due_stays_green(pg):
    _ready(pg)
    fields, ok = _sweep(pg, Factors(), config=oa.transport_config({}))
    assert ok and fields["dispatch_due"] == 0 and not fields["dispatch_unconfigured"]


def test_a_follow_up_pass_audits_an_entry_too_young_for_the_first_pass(pg):
    """The real SQL of PC-J66 F04's second pass, on a short scale: an entry
    younger than the lag at the first pass is audited by the follow-up."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _ready(pg)
    _log(auth, "factor_in_progress", admin, str(uuid4()))
    slept: list[float] = []

    async def go():
        conn = await _conn()

        async def sleep(seconds):
            slept.append(seconds)
            await asyncio.sleep(seconds)

        try:
            return await sweep.run_sweep(conn, Factors(), schema=schema, auth_schema=auth,
                                         config=CONFIG, send=Sender(), lag_seconds=2,
                                         follow_up_seconds=3, sleep=sleep)
        finally:
            await conn.close()

    fields, ok = run(go())
    assert ok and fields["log_rows"] == 0 and fields["follow_up_log_rows"] == 1
    assert fields["follow_up_dispatch_due"] == 0, "enrollment is audit only"
    assert len(slept) == 1 and 0 < slept[0] <= 3
    assert [r["event"] for r in _rows(schema, admin)] == ["mfa_factor_enrolled"]


# ── --backfill (PC-J139): old events, no alerts ─────────────────────────────

def _record_332(schema: str) -> None:
    """The locked runner's ledger row for 332, stamped now."""
    psql(f"""CREATE TABLE IF NOT EXISTS {schema}._schema_migrations (
                 filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
             GRANT SELECT ON {schema}._schema_migrations TO {m332.OWNER};
             INSERT INTO {schema}._schema_migrations (filename, applied_at)
             VALUES ('{sweep.MIGRATION_332}', clock_timestamp())""")


def _backfill(pg, *, commit: bool, batch: int = sweep.LOG_BATCH,
              run_id: str | None = None) -> sweep.BackfillSummary:
    schema, auth = pg

    async def go():
        conn = await _conn()
        try:
            return await sweep.backfill_auth_log(
                sweep.SweepDb(conn, schema=schema, auth_schema=auth), commit=commit,
                run_id=run_id, lag_seconds=0, batch=batch)
        finally:
            await conn.close()

    return run(go())


def _state_of(schema: str) -> dict:
    """Everything a dry run must leave as it was."""
    return {table: psql(f"SELECT count(*) FROM {schema}.{table}")
            for table in ("staff_security_audit", "owner_alert_outbox",
                          "staff_mfa_factor_snapshot", "staff_security_sweep_cursor")}


def _mfa_alerts(schema: str) -> str:
    return psql(f"SELECT count(*) FROM {schema}.owner_alert_outbox WHERE event LIKE 'mfa_%'")


def _history(pg) -> dict:
    """Old history: one pre-332 admin event, then 332, then a mix of events."""
    schema, auth = pg
    admin, student = m332._user(schema, "admin", True), m332._user(schema, "student", True)
    early = _log(auth, "factor_in_progress", admin, str(uuid4()))
    _record_332(schema)
    factor = str(uuid4())
    life = _lifecycle(auth, admin, factor)             # enrolled, verified, deleted
    step_up = _log(auth, "verification_attempted", admin, factor)
    _lifecycle(auth, student, str(uuid4()))
    bad = _log(auth, "factor_in_progress", "not-a-uuid", str(uuid4()))
    last = _log(auth, "token_refreshed", admin, factor)   # newest entry, not a factor event
    return {"admin": admin, "student": student, "factor": factor, "early": early,
            "life": life, "step_up": step_up, "bad": bad, "last": last}


def test_commit_without_backfill_and_backfill_with_another_mode_are_refused(capsys):
    for argv in (["--commit"], ["--backfill", "--requeue", str(uuid4())],
                 ["--backfill", "--test-alert", "--commit"]):
        with pytest.raises(SystemExit) as exc:
            sweep.main(argv)
        assert exc.value.code == 2
    assert "--commit requires --backfill" in capsys.readouterr().err


def test_backfill_dry_run_writes_nothing_and_counts_every_entry(pg):
    schema, _ = pg
    h = _history(pg)
    before = _state_of(schema)
    summary = _backfill(pg, commit=False)
    assert _state_of(schema) == before
    assert psql(f"SELECT count(*) FROM {schema}.staff_security_sweep_cursor") == "0"
    assert summary.end_bound == "newest_entry" and not summary.cursor_created
    assert dict(summary.entries_by_action) == {"factor_in_progress": 4,
                                               "verification_attempted": 3,
                                               "factor_unenrolled": 2}
    assert dict(summary.written_by_event) == {"mfa_factor_enrolled": 1, "mfa_factor_verified": 1,
                                              "mfa_factor_deleted": 1}
    assert dict(summary.skipped_by_reason) == {"before_332": 1, "not_admin": 3, "step_up": 1,
                                               "unparseable": 1}
    assert summary.users == {h["admin"]}
    assert summary.log_oldest_at < summary.migration_332_applied_at == summary.start_at
    assert summary.entry_min_at == summary.log_oldest_at <= summary.entry_max_at <= summary.end_at
    line = summary.line()
    assert "mode=dry_run" in line and "would_write=3" in line and "users=1" in line
    assert ("would_write_by_event=mfa_factor_deleted:1,mfa_factor_enrolled:1,"
            "mfa_factor_verified:1") in line
    assert "skipped_by_reason=before_332:1,not_admin:3,step_up:1,unparseable:1" in line
    assert "+07:00" in line and "@" not in line and h["admin"] not in line


def test_backfill_commit_audits_old_events_without_any_alert_and_starts_the_cursor(pg):
    schema, auth = pg
    h = _history(pg)
    run_id = str(uuid4())
    outbox = psql(f"SELECT json_agg(o ORDER BY id) FROM {schema}.owner_alert_outbox o")
    summary = _backfill(pg, commit=True, run_id=run_id)
    assert summary.cursor_created and sum(summary.written_by_event.values()) == 3
    rows = _rows(schema, h["admin"])
    assert [r["event"] for r in rows] == ["mfa_factor_enrolled", "mfa_factor_verified",
                                          "mfa_factor_deleted"]
    assert [r["detail"]["auth_log_entry_id"] for r in rows] == [h["life"][0], h["life"][2],
                                                                h["life"][4]]
    assert {r["source"] for r in rows} == {"auth"} and {r["actor"] for r in rows} == {h["admin"]}
    assert all(r["detail"]["backfill"] is True and r["detail"]["backfill_run_id"] == run_id
               and r["detail"]["detected_by"] == "auth_log" for r in rows)
    assert h["early"] not in json.dumps(rows), "before 332: counted, never written"
    assert _rows(schema, h["student"]) == []
    # No alert for an old event: the outbox is exactly as before (only the
    # users trigger's "Tạo tài khoản admin" row for the fixture), so the cron has no
    # factor e-mail to send.
    assert psql(f"SELECT json_agg(o ORDER BY id) FROM {schema}.owner_alert_outbox o") == outbox
    assert _mfa_alerts(schema) == "0"
    assert psql(f"SELECT count(*) FROM {schema}.staff_mfa_factor_snapshot") == "0"
    assert _cursor(schema) == h["last"]
    # The cron's first run continues from that cursor: no re-initialisation,
    # no replay and no factor e-mail.
    sender = Sender()
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and not fields["log_initialized"] and fields["log_entries"] == 0
    assert [e.text.splitlines()[0] for e in sender.calls] == ["Tạo tài khoản admin"]
    # FR-011 is unchanged for a new event after the backfill.
    new = _lifecycle(auth, h["admin"], str(uuid4()))
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["log_rows"] == 3 and fields["dispatch_sent"] == 2
    live = [r for r in _rows(schema, h["admin"]) if r["detail"]["auth_log_entry_id"] in new]
    assert [("backfill" in r["detail"]) for r in live] == [False, False, False]
    assert [o["event"] for o in _alerts(schema, h["admin"])] == ["mfa_factor_verified",
                                                                "mfa_factor_deleted"]
    assert len(sender.calls) == 3


def test_backfill_commit_twice_never_duplicates(pg):
    schema, _ = pg
    h = _history(pg)
    first = _backfill(pg, commit=True)
    rows = _rows(schema, h["admin"])
    second = _backfill(pg, commit=True)
    assert second.end_bound == "cursor" and not second.cursor_created
    assert sum(second.written_by_event.values()) == 0
    assert second.skipped_by_reason["duplicate"] == 3
    assert _rows(schema, h["admin"]) == rows and _cursor(schema) == h["last"]
    assert {r["detail"]["backfill_run_id"] for r in rows} == {first.run_id}
    # A dry run after the commit reports the same entries as duplicates.
    dry = _backfill(pg, commit=False)
    assert sum(dry.written_by_event.values()) == 0 and dry.skipped_by_reason["duplicate"] == 3


def test_backfill_with_an_existing_cursor_stops_there_and_leaves_it_unchanged(pg):
    """The cron ran first: its cursor started at the newest entry and it owns
    everything after it. The backfill fills only the gap before."""
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _record_332(schema)
    old = _lifecycle(auth, admin, str(uuid4()))
    _ready(pg)
    start = _cursor(schema)
    after = _lifecycle(auth, admin, str(uuid4()))
    summary = _backfill(pg, commit=True)
    assert summary.end_bound == "cursor" and not summary.cursor_created
    assert summary.entries_by_action == {"factor_in_progress": 1, "verification_attempted": 1,
                                         "factor_unenrolled": 1}
    rows = _rows(schema, admin)
    assert [r["detail"]["auth_log_entry_id"] for r in rows] == [old[0], old[2], old[4]]
    assert _cursor(schema) == start
    assert _mfa_alerts(schema) == "0"
    sender = Sender()
    fields, ok = _sweep(pg, Factors(), sender=sender)
    assert ok and fields["log_rows"] == 3 and _mfa_alerts(schema) == "2"
    assert [r["detail"]["auth_log_entry_id"] for r in _rows(schema, admin)][3:] == [
        after[0], after[2], after[4]]


def test_backfill_creates_the_cursor_in_the_last_batch_transaction(pg, monkeypatch):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _record_332(schema)
    entries = _lifecycle(auth, admin, str(uuid4()))   # 3 factor events: batches of 2 + 1
    real = sweep.SweepDb.create_log_cursor

    async def fail(self, *args):
        raise RuntimeError("cursor insert failed")

    monkeypatch.setattr(sweep.SweepDb, "create_log_cursor", fail)
    with pytest.raises(RuntimeError):
        _backfill(pg, commit=True, batch=2)
    # The first batch committed; the last one rolled back with the cursor.
    assert [r["detail"]["auth_log_entry_id"] for r in _rows(schema, admin)] == [entries[0],
                                                                               entries[2]]
    assert psql(f"SELECT count(*) FROM {schema}.staff_security_sweep_cursor") == "0"

    async def lost_race(self, *args):
        await real(self, *args)    # a sweep's cursor appeared meanwhile
        return False

    monkeypatch.setattr(sweep.SweepDb, "create_log_cursor", lost_race)
    with pytest.raises(sweep.BackfillCursorRace):
        _backfill(pg, commit=True, batch=2)
    assert len(_rows(schema, admin)) == 2
    assert psql(f"SELECT count(*) FROM {schema}.staff_security_sweep_cursor") == "0"
    monkeypatch.setattr(sweep.SweepDb, "create_log_cursor", real)
    summary = _backfill(pg, commit=True, batch=2)
    assert summary.cursor_created and summary.skipped_by_reason["duplicate"] == 2
    assert [r["detail"]["auth_log_entry_id"] for r in _rows(schema, admin)] == entries[0::2]
    assert _cursor(schema) == entries[-1]


def test_backfill_uses_the_role_held_at_the_event(pg):
    schema, auth = pg
    demoted, promoted = m332._user(schema, "admin", True), m332._user(schema, "student", True)
    _record_332(schema)
    _log(auth, "factor_in_progress", demoted, str(uuid4()))
    _log(auth, "factor_in_progress", promoted, str(uuid4()))
    psql(f"UPDATE {schema}.users SET role = 'student' WHERE id = '{demoted}'")
    psql(f"UPDATE {schema}.users SET role = 'admin' WHERE id = '{promoted}'")
    summary = _backfill(pg, commit=True)
    assert summary.users == {demoted} and summary.skipped_by_reason == {"not_admin": 1}
    assert [r["event"] for r in _rows(schema, demoted)] == ["mfa_factor_enrolled"]
    assert _rows(schema, promoted) == []


def test_backfill_refuses_to_run_without_the_332_ledger_row(pg):
    schema, auth = pg
    admin = m332._user(schema, "admin", True)
    _log(auth, "factor_in_progress", admin, str(uuid4()))
    psql(f"CREATE TABLE {schema}._schema_migrations (filename text PRIMARY KEY, "
         f"applied_at timestamptz NOT NULL DEFAULT now()); "
         f"GRANT SELECT ON {schema}._schema_migrations TO {m332.OWNER}")
    before = _state_of(schema)
    with pytest.raises(RuntimeError, match="332_staff_security_audit.sql is not recorded"):
        _backfill(pg, commit=True)
    assert _state_of(schema) == before


def test_backfill_entry_point_logs_one_summary_line_without_emails(pg, monkeypatch, caplog):
    schema, auth = pg
    h = _history(pg)
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    monkeypatch.setattr(sweep, "_connect", _conn)
    monkeypatch.setattr(sweep, "LOG_LAG_SECONDS", 0)
    real = sweep.SweepDb

    def scoped(conn):
        return real(conn, schema=schema, auth_schema=auth)

    monkeypatch.setattr(sweep, "SweepDb", scoped)
    before = _state_of(schema)
    with caplog.at_level(logging.DEBUG):
        assert sweep.main(["--backfill"]) == 0
    assert _state_of(schema) == before
    lines = [r.getMessage() for r in caplog.records if r.name == "staff_security_sweep"]
    assert len(lines) == 1 and lines[0].startswith("staff_security_sweep_backfill_summary mode=dry_run")
    assert "would_write=3" in lines[0]
    assert "@" not in caplog.text and h["admin"] not in caplog.text
    caplog.clear()
    with caplog.at_level(logging.DEBUG):
        assert sweep.main(["--backfill", "--commit"]) == 0
    [line] = [r.getMessage() for r in caplog.records if r.name == "staff_security_sweep"]
    assert "mode=commit" in line and "written=3" in line and "cursor_created=True" in line
    assert "@" not in caplog.text
    assert _mfa_alerts(schema) == "0"


# ── Without a database: exit code and the 5-minute bound ────────────────────

class _Conn:
    async def close(self):
        pass


class _DueStore:
    def __init__(self, rows: int) -> None:
        self.rows = [{"id": str(uuid4()), "audit_id": str(uuid4()), "payload": {}, "attempts": 0}
                     for _ in range(rows)]

    async def due(self, *, max_attempts, limit):
        return self.rows


def _offline_main(monkeypatch, *, due_rows: int) -> int:
    """``main()`` with no database: steps 1-2 are no-ops, the outbox has rows."""
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("OWNER_ALERT_EMAILS", raising=False)

    async def connect():
        return _Conn()

    async def no_log(db, **_):
        return sweep.LogSummary()

    async def no_snapshot(db, _lister):
        return sweep.SnapshotSummary()

    monkeypatch.setattr(sweep, "_connect", connect)
    monkeypatch.setattr(sweep, "sweep_auth_log", no_log)
    monkeypatch.setattr(sweep, "reconcile_snapshot", no_snapshot)
    monkeypatch.setattr(sweep, "FOLLOW_UP_SECONDS", 0)
    monkeypatch.setattr(oa, "PgOutboxStore", lambda conn, schema="public": _DueStore(due_rows))
    return sweep.main([])


def test_due_alerts_without_transport_exit_non_zero_and_name_the_missing_settings(monkeypatch,
                                                                                   caplog):
    with caplog.at_level(logging.INFO):
        assert _offline_main(monkeypatch, due_rows=2) == 1
    assert ("staff_security_sweep_alerts_unsent step=dispatch "
            "missing=RESEND_API_KEY,OWNER_ALERT_EMAILS due=2") in caplog.text
    assert "follow_up_dispatch_unconfigured=True" in caplog.text


def test_nothing_due_without_transport_exits_zero(monkeypatch, caplog):
    with caplog.at_level(logging.INFO):
        assert _offline_main(monkeypatch, due_rows=0) == 0
    assert "staff_security_sweep_alerts_unsent" not in caplog.text


def test_the_cron_entry_point_runs_the_follow_up_pass(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://nobody@127.0.0.1:1/none")
    seen = {}

    async def connect():
        return _Conn()

    async def fake_run_sweep(conn, lister, **kwargs):
        seen.update(kwargs)
        return {}, True

    monkeypatch.setattr(sweep, "_connect", connect)
    monkeypatch.setattr(sweep, "run_sweep", fake_run_sweep)
    assert sweep.main([]) == 0
    assert seen == {"follow_up_seconds": sweep.FOLLOW_UP_SECONDS}


def _cron_period_seconds() -> int:
    spec = json.loads((BACKEND / "railway.staff-security-sweep.json").read_text(encoding="utf-8"))
    minute, *rest = spec["deploy"]["cronSchedule"].split()
    assert rest == ["*"] * 4 and minute.startswith("*/")
    return int(minute[2:]) * 60


class _VirtualTime:
    """A clock for the cron, the sweep's sleep and the log's lag filter."""

    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


def _audit_delays(monkeypatch, events: list[float], runs: list[float], *,
                  follow_up: float | None) -> list[float]:
    """Seconds from each event to its audit row when the cron starts at ``runs``.

    Step 1 is a stand-in with the real cut-off rule (entries at least
    ``LOG_LAG_SECONDS`` old, after the cursor); the rest is ``run_sweep``."""
    clock, recorded = _VirtualTime(), {}

    async def log_step(db, *, lag_seconds):
        cut_off = clock.now - lag_seconds
        new = [e for e in events if e not in recorded and e <= cut_off]
        for event in new:
            recorded[event] = clock.now
        return sweep.LogSummary(entries=len(new), rows=len(new))

    async def no_snapshot(db, _lister):
        return sweep.SnapshotSummary()

    async def nothing_due(store, **_):
        return oa.DispatchSummary()

    monkeypatch.setattr(sweep, "sweep_auth_log", log_step)
    monkeypatch.setattr(sweep, "reconcile_snapshot", no_snapshot)
    monkeypatch.setattr(oa, "dispatch_due", nothing_due)
    for start in runs:
        assert clock.now <= start, "a run must end before the next one starts"
        clock.now = start
        _, ok = run(sweep.run_sweep(_Conn(), Factors(), config=CONFIG, follow_up_seconds=follow_up,
                                    sleep=clock.sleep, clock=clock))
        assert ok
    return [recorded[e] - e for e in events]


def test_an_event_5s_before_a_cron_tick_is_audited_within_five_minutes(monkeypatch):
    period = _cron_period_seconds()
    assert period == sweep.CRON_PERIOD_SECONDS == 300, "Railway's minimum cron period"
    tick = 10 * period
    runs = [tick - period, tick, tick + period, tick + 2 * period]
    [delay] = _audit_delays(monkeypatch, [tick - 5], runs, follow_up=sweep.FOLLOW_UP_SECONDS)
    # Missed by the run at the tick (5 s < 10 s lag), audited by its follow-up.
    assert delay == sweep.FOLLOW_UP_SECONDS + 5 == 155
    assert delay <= 300
    # PC-J66 F04, the old single pass: the same event waited a whole period.
    [old] = _audit_delays(monkeypatch, [tick - 5], runs, follow_up=None)
    assert old == 305 > 300


def test_every_event_offset_in_a_period_is_audited_well_within_five_minutes(monkeypatch):
    period, lag, follow_up = sweep.CRON_PERIOD_SECONDS, sweep.LOG_LAG_SECONDS, sweep.FOLLOW_UP_SECONDS
    tick = 10 * period
    runs = [tick + k * period for k in range(-1, 4)]
    events = [tick + offset for offset in range(period)]
    delays = _audit_delays(monkeypatch, events, runs, follow_up=follow_up)
    worst = max(follow_up, period - follow_up) + lag   # sup over continuous offsets
    assert worst == 160 and worst - 1 <= max(delays) <= worst
    # Margin left in the 5-minute bound for Railway's start delay and step time.
    assert 300 - worst >= 120
