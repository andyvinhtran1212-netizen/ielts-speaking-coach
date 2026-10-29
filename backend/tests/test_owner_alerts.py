"""Owner alert dispatch (ADMINAAL2-0032 FR-011, T007/T008).

Unit half: recipients come only from the environment, the e-mail and the
Resend request carry no token, secret or reason, sends retry with backoff up
to five times and then stay `failed`, a row claimed by one dispatcher is not
sent by another, and a missing key or recipient sends nothing and spends no
attempt.

PostgreSQL half: ``PgOutboxStore`` against migration 332's real outbox (the
compare-and-set claim, retry to five, requeue). Set TEST_PG_URL to a LOCAL
disposable cluster and REQUIRE_PG=1 to forbid skips.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from uuid import uuid4

import pytest

from services import owner_alerts as oa

KEY = "re_test_" + "k" * 24
OWNER = "owner@example.com"
SECRETS = ("eyJhbGciOiJIUzI1NiJ9.secret-token", "JBSWY3DPEHPK3PXP", "otpauth://totp/x",
           "attacker@evil.example", "private reason text")


def _config(**env) -> oa.TransportConfig:
    return oa.transport_config({"OWNER_ALERT_EMAILS": OWNER, "RESEND_API_KEY": KEY, **env})


def _payload(**over) -> dict:
    payload = {
        "audit_id": str(uuid4()), "event": "role_changed", "occurred_at": "2026-10-28T15:50:00+00:00",
        "source": "out_of_band", "target_user_id": str(uuid4()), "target_email": "target@example.com",
        "actor_user_id": None, "actor_email": None,
        "before": {"role": "instructor", "is_active": True, "suspended_at": None},
        "after": {"role": "admin", "is_active": True, "suspended_at": None},
        "operator": None,
    }
    payload.update(over)
    return payload


def _hostile_payload() -> dict:
    return _payload(token=SECRETS[0], factor_secret=SECRETS[1], totp_uri=SECRETS[2],
                    to=SECRETS[3], recipients=[SECRETS[3]], reason=SECRETS[4],
                    detail={"secret": SECRETS[1]}, actor_email=SECRETS[3] + "\nBcc: x@y.z")


class FakeStore:
    """In-memory outbox with the same compare-and-set rules as PgOutboxStore."""

    def __init__(self, *payloads: dict) -> None:
        self.now = 0.0
        self.rows = {str(uuid4()): {"payload": p, "audit_id": p.get("audit_id"), "status": "pending",
                                    "attempts": 0, "next": 0.0, "last_error": None}
                     for p in payloads}

    async def due(self, *, max_attempts, limit):
        await asyncio.sleep(0)
        return [{"id": rid, "audit_id": r["audit_id"], "payload": r["payload"],
                 "attempts": r["attempts"]}
                for rid, r in self.rows.items()
                if r["status"] != "sent" and r["attempts"] < max_attempts
                and r["next"] <= self.now][:limit]

    async def claim(self, row_id, attempts, lease_seconds):
        await asyncio.sleep(0)
        row = self.rows[row_id]
        if row["attempts"] != attempts or row["status"] == "sent":
            return False
        row["attempts"] += 1
        row["next"] = self.now + lease_seconds
        return True

    async def mark_sent(self, row_id, attempts):
        row = self.rows[row_id]
        if row["attempts"] == attempts:
            row.update(status="sent", last_error=None)

    async def mark_failed(self, row_id, attempts, error, retry_seconds):
        row = self.rows[row_id]
        if row["attempts"] == attempts and row["status"] != "sent":
            row.update(status="failed", last_error=error, next=self.now + retry_seconds)


class FakeSender:
    def __init__(self, *results: oa.SendResult) -> None:
        self.results = list(results)
        self.calls: list[dict] = []

    async def __call__(self, email, *, config, idempotency_key):
        await asyncio.sleep(0)
        self.calls.append({"email": email, "to": config.recipients, "key": idempotency_key})
        return self.results.pop(0) if self.results else oa.SendResult(True)


def run(coro):
    return asyncio.run(coro)


# ── Configuration: recipients only from env ─────────────────────────────────

def test_recipients_come_only_from_owner_alert_emails():
    config = oa.transport_config({"OWNER_ALERT_EMAILS": f" {OWNER}, not-an-email, OWNER@example.com,,"
                                                        " second@example.org",
                                  "RESEND_API_KEY": KEY})
    assert config.recipients == (OWNER, "second@example.org")
    assert config.ready

    store, send = FakeStore(_hostile_payload()), FakeSender()
    run(oa.dispatch_due(store, config=_config(), send=send))
    assert [c["to"] for c in send.calls] == [(OWNER,)]


def test_transport_config_reads_the_process_environment(monkeypatch):
    monkeypatch.setenv("OWNER_ALERT_EMAILS", OWNER)
    monkeypatch.setenv("RESEND_API_KEY", KEY)
    assert oa.transport_config().recipients == (OWNER,)
    monkeypatch.delenv("RESEND_API_KEY")
    assert oa.transport_config().missing == ("RESEND_API_KEY",)


@pytest.mark.parametrize("env, missing", [
    ({"OWNER_ALERT_EMAILS": OWNER}, ("RESEND_API_KEY",)),
    ({"RESEND_API_KEY": KEY}, ("OWNER_ALERT_EMAILS",)),
    ({"RESEND_API_KEY": KEY, "OWNER_ALERT_EMAILS": "nobody"}, ("OWNER_ALERT_EMAILS",)),
    ({}, ("RESEND_API_KEY", "OWNER_ALERT_EMAILS")),
])
def test_missing_transport_sends_nothing_spends_no_attempt_and_says_why(env, missing, caplog):
    store, send = FakeStore(_payload()), FakeSender()
    with caplog.at_level(logging.WARNING, logger="owner_alerts"):
        summary = run(oa.dispatch_due(store, config=oa.transport_config(env), send=send))
    assert summary.unconfigured and summary.due == 1 and summary.sent == 0
    assert send.calls == []
    assert [r["attempts"] for r in store.rows.values()] == [0]
    assert [r["status"] for r in store.rows.values()] == ["pending"]
    assert f"owner_alert_transport_unconfigured missing={','.join(missing)}" in caplog.text
    assert KEY not in caplog.text and OWNER not in caplog.text


# ── Rendering: email-safe fields only ───────────────────────────────────────

def test_email_never_contains_a_token_secret_reason_or_injected_recipient():
    email = oa.render(_hostile_payload())
    for value in SECRETS:
        assert value not in email.subject and value not in email.text
    assert "Bcc" not in email.text
    assert "Người thực hiện: không rõ (ngoài ứng dụng)" in email.text


@pytest.mark.parametrize("over, title", [
    ({}, "Tài khoản được CẤP quyền admin"),
    ({"before": {"role": "admin", "is_active": True}, "after": {"role": "student", "is_active": True}},
     "Tài khoản bị GỠ quyền admin"),
    ({"event": "active_changed", "before": {"role": "admin", "is_active": True, "suspended_at": None},
      "after": {"role": "admin", "is_active": False, "suspended_at": "2026-10-28T15:00:00+00:00"}},
     "Admin bị TẠM KHÓA"),
    ({"event": "active_changed",
      "before": {"role": "admin", "is_active": False, "suspended_at": "2026-10-28T15:00:00+00:00"},
      "after": {"role": "admin", "is_active": True, "suspended_at": None}},
     "Admin được MỞ KHÓA"),
    ({"event": "mfa_factor_verified", "source": "auth", "before": None, "after": None},
     "Admin xác minh yếu tố xác thực 2 bước"),
    ({"event": "mfa_factor_deleted", "source": "auth", "before": None, "after": None},
     "Admin bị xoá yếu tố xác thực 2 bước"),
    ({"event": "sessions_revoke_failed"}, "Thu hồi phiên đăng nhập của staff THẤT BẠI"),
    ({"event": "bootstrap_recovery"}, "Khôi phục admin khẩn cấp (bootstrap)"),
    ({"event": "<script>"}, "Sự kiện bảo mật không rõ"),
])
def test_email_names_the_event(over, title):
    email = oa.render(_payload(**over))
    assert email.subject == f"[Aver] {title}: target@example.com"
    assert email.text.splitlines()[0] == title


def test_email_has_target_actor_vietnam_time_source_and_factor():
    factor = str(uuid4())
    email = oa.render(_payload(event="mfa_factor_deleted", source="auth", actor_email="vinh@example.com",
                               factor_id=factor, factor_status="verified", before=None, after=None))
    assert "Tài khoản: target@example.com" in email.text
    assert "Người thực hiện: vinh@example.com" in email.text
    assert "Thời điểm: 28/10/2026 22:50:00 (giờ Việt Nam)" in email.text
    assert "Nguồn: Supabase Auth" in email.text
    assert f"Yếu tố 2 bước: {factor} (đã xác minh)" in email.text
    email = oa.render(_payload())
    assert "Nguồn: ngoài ứng dụng (SQL editor / runner)" in email.text
    assert "Trước: vai trò instructor, đang hoạt động" in email.text
    assert "Sau: vai trò admin, đang hoạt động" in email.text


# ── Resend transport ────────────────────────────────────────────────────────

class FakeResponse:
    def __init__(self, status: int, body=None) -> None:
        self.status_code, self._body = status, body

    def json(self):
        if self._body is None:
            raise ValueError("no json")
        return self._body


class FakeHttp:
    def __init__(self, response=None, exc=None) -> None:
        self.response, self.exc, self.calls = response, exc, []

    async def post(self, url, *, json, headers):
        self.calls.append({"url": url, "json": json, "headers": headers})
        if self.exc:
            raise self.exc
        return self.response


def test_resend_request_uses_the_fixed_sender_env_recipients_and_key_only_in_the_header():
    http = FakeHttp(FakeResponse(200, {"id": "x"}))
    email = oa.render(_hostile_payload())
    result = run(oa.send_via_resend(email, config=_config(), idempotency_key="owner-alert-1",
                                    client=http))
    assert result == oa.SendResult(True)
    [call] = http.calls
    assert call["url"] == "https://api.resend.com/emails"
    assert call["json"] == {"from": "alerts@averlearning.com", "to": [OWNER],
                            "subject": email.subject, "text": email.text}
    assert call["headers"] == {"Authorization": f"Bearer {KEY}", "Idempotency-Key": "owner-alert-1"}
    body = json.dumps(call["json"], ensure_ascii=False)
    for value in (KEY, *SECRETS):
        assert value not in body


@pytest.mark.parametrize("http, error", [
    (FakeHttp(FakeResponse(403, {"name": "validation_error",
                                 "message": "The averlearning.com domain is not verified"})),
     "http_403:validation_error"),
    (FakeHttp(FakeResponse(500)), "http_500"),
    (FakeHttp(FakeResponse(401, {"name": f"bad key {KEY}"})), "http_401"),
])
def test_resend_failure_is_a_short_code_without_body_or_key(http, error):
    result = run(oa.send_via_resend(oa.TEST_ALERT, config=_config(), idempotency_key="k",
                                    client=http))
    assert result == oa.SendResult(False, error)


def test_resend_timeout_and_transport_errors_do_not_raise():
    import httpx
    timeout = FakeHttp(exc=httpx.ReadTimeout("slow"))
    assert run(oa.send_via_resend(oa.TEST_ALERT, config=_config(), idempotency_key="k",
                                  client=timeout)) == oa.SendResult(False, "timeout")
    broken = FakeHttp(exc=httpx.ConnectError(f"refused {KEY}"))
    assert run(oa.send_via_resend(oa.TEST_ALERT, config=_config(), idempotency_key="k",
                                  client=broken)) == oa.SendResult(False, "transport_ConnectError")


# ── Dispatch: retry, backoff, claim ─────────────────────────────────────────

def test_failure_retries_with_backoff_up_to_five_sends_then_stays_failed(caplog):
    store = FakeStore(_payload())
    [(row_id, row)] = store.rows.items()
    send = FakeSender(*[oa.SendResult(False, "http_403:validation_error")] * 9)
    with caplog.at_level(logging.WARNING, logger="owner_alerts"):
        for attempt in range(1, 6):
            summary = run(oa.dispatch_due(store, config=_config(), send=send))
            assert len(send.calls) == attempt
            assert row["attempts"] == attempt and row["status"] == "failed"
            assert row["last_error"] == "http_403:validation_error"
            # Not due again until its backoff has passed.
            assert run(oa.dispatch_due(store, config=_config(), send=send)).due == 0
            if attempt < 5:
                assert summary.failed == 1 and summary.exhausted == 0
                assert row["next"] - store.now == oa.BACKOFF_SECONDS[attempt - 1]
            store.now = row["next"]
    assert summary.exhausted == 1
    assert run(oa.dispatch_due(store, config=_config(), send=send)).due == 0
    store.now += 10 ** 6
    assert run(oa.dispatch_due(store, config=_config(), send=send)).due == 0
    assert len(send.calls) == 5
    assert caplog.text.count("owner_alert_failed") == 1
    assert [r.levelname for r in caplog.records if "owner_alert_failed" in r.message] == ["ERROR"]
    assert len({c["key"] for c in send.calls}) == 1, "one idempotency key per outbox row"
    assert send.calls[0]["key"] == f"owner-alert-{row_id}"


def test_a_failed_send_followed_by_success_is_sent_once():
    store = FakeStore(_payload())
    send = FakeSender(oa.SendResult(False, "timeout"), oa.SendResult(True))
    run(oa.dispatch_due(store, config=_config(), send=send))
    store.now += oa.BACKOFF_SECONDS[0]
    summary = run(oa.dispatch_due(store, config=_config(), send=send))
    assert summary.sent == 1
    [row] = store.rows.values()
    assert row["status"] == "sent" and row["attempts"] == 2 and row["last_error"] is None
    store.now += 10 ** 6
    assert run(oa.dispatch_due(store, config=_config(), send=send)).due == 0


def test_two_concurrent_dispatchers_send_each_row_once():
    store = FakeStore(_payload(), _payload(event="mfa_factor_verified"))
    send = FakeSender()

    async def both():
        return await asyncio.gather(oa.dispatch_due(store, config=_config(), send=send),
                                    oa.dispatch_due(store, config=_config(), send=send))

    first, second = run(both())
    assert first.due == second.due == 2, "both saw both rows before either claimed"
    assert len(send.calls) == 2
    assert first.sent + second.sent == 2
    assert first.skipped_claimed + second.skipped_claimed == 2
    assert {r["status"] for r in store.rows.values()} == {"sent"}


def test_test_alert_is_the_fixed_message_and_needs_the_transport():
    send = FakeSender()
    assert run(oa.send_test_alert(config=_config(), send=send)) == oa.SendResult(True)
    [call] = send.calls
    assert call["email"] == oa.TEST_ALERT and "kiểm tra kênh cảnh báo" in call["email"].text
    assert call["to"] == (OWNER,)
    assert run(oa.send_test_alert(config=oa.transport_config({}), send=send)) == oa.SendResult(
        False, "unconfigured")
    assert len(send.calls) == 1


# ── PostgreSQL: PgOutboxStore on migration 332 ──────────────────────────────

import test_migration_332_staff_security_audit as m332  # noqa: E402
from test_migration_240_core_attempt_evidence import psql  # noqa: E402


@pytest.fixture
def pg():
    m332._require_pg()
    schema = "owner_alerts_" + uuid4().hex
    try:
        m332._build(schema)
        m332._apply(schema)
        yield schema
    finally:
        psql(f"DROP SCHEMA IF EXISTS {schema} CASCADE")


async def _owner_conn():
    import asyncpg
    conn = await asyncpg.connect(os.environ["TEST_PG_URL"], statement_cache_size=0)
    await conn.execute(f"SET ROLE {m332.OWNER}")
    return conn


def _admin_alert(s: str) -> str:
    """One trigger-written outbox row: an out-of-band grant of admin."""
    uid = m332._user(s, "instructor", True)
    psql(f"UPDATE {s}.users SET role = 'admin' WHERE id = '{uid}'")
    [row] = m332._outbox(s, uid)
    return row["audit_id"]


def _row(s: str, audit_id: str) -> dict:
    return json.loads(psql(
        f"""SELECT row_to_json(o) FROM (SELECT status, attempts, last_error, sent_at IS NOT NULL AS sent,
                   next_attempt_at > now() AS deferred
              FROM {s}.owner_alert_outbox WHERE audit_id = '{audit_id}') o"""))


def test_pg_store_sends_a_trigger_row_once_and_marks_it_sent(pg):
    audit_id = _admin_alert(pg)
    send = FakeSender()

    async def go():
        conn = await _owner_conn()
        try:
            store = oa.PgOutboxStore(conn, pg)
            first = await oa.dispatch_due(store, config=_config(), send=send)
            again = await oa.dispatch_due(store, config=_config(), send=send)
            return first, again
        finally:
            await conn.close()

    first, again = run(go())
    assert (first.due, first.sent, again.due) == (1, 1, 0)
    assert _row(pg, audit_id) == {"status": "sent", "attempts": 1, "last_error": None, "sent": True,
                                  "deferred": True}
    [call] = send.calls
    assert "Tài khoản được CẤP quyền admin" in call["email"].subject


def test_pg_claim_is_a_compare_and_set_on_attempts(pg):
    audit_id = _admin_alert(pg)

    async def go():
        conn = await _owner_conn()
        try:
            store = oa.PgOutboxStore(conn, pg)
            [row] = await store.due(max_attempts=5, limit=10)
            assert row["payload"]["audit_id"] == audit_id and row["attempts"] == 0
            return (await store.claim(row["id"], 0, 300), await store.claim(row["id"], 0, 300),
                    await store.due(max_attempts=5, limit=10))
        finally:
            await conn.close()

    won, lost, due = run(go())
    assert (won, lost, due) == (True, False, [])
    assert _row(pg, audit_id)["attempts"] == 1


def test_pg_retry_to_five_then_failed_and_requeue(pg):
    audit_id = _admin_alert(pg)
    send = FakeSender(*[oa.SendResult(False, "http_403:validation_error")] * 5)

    async def go():
        conn = await _owner_conn()
        try:
            store = oa.PgOutboxStore(conn, pg)
            for _ in range(6):
                await oa.dispatch_due(store, config=_config(), send=send)
                await conn.execute(f"UPDATE {pg}.owner_alert_outbox SET next_attempt_at = now() "
                                   f"WHERE audit_id = $1::uuid", audit_id)
            exhausted = _row(pg, audit_id)
            requeued = await store.requeue(audit_id)
            again = await store.requeue(audit_id)
            return exhausted, requeued, again
        finally:
            await conn.close()

    exhausted, requeued, again = run(go())
    assert len(send.calls) == 5
    assert exhausted == {"status": "failed", "attempts": 5, "last_error": "http_403:validation_error",
                         "sent": False, "deferred": False}
    assert (requeued, again) == (True, False), "requeue touches only a failed row"
    assert _row(pg, audit_id)["status"] == "pending" and _row(pg, audit_id)["attempts"] == 0


def test_pg_store_rejects_a_bad_schema_name():
    with pytest.raises(ValueError):
        oa.PgOutboxStore(object(), "public; DROP TABLE x")


def test_now_is_not_used_for_rendering_time():
    # A payload without occurred_at must not silently show the dispatch time.
    email = oa.render(_payload(occurred_at=None))
    assert "Thời điểm: không rõ" in email.text
