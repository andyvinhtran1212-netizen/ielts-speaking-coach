"""COURSEACCESS-0055 G04-T17 — "khoá đã mở đăng ký" letter (FR-050, plan 5.11).

Step 5 of the enrollment sweep calls G05-T22's ``fn_course_open_alerts_enqueue``
(faked here: the function and its table are G05's migration), and the learner
dispatcher sends ``course_open_alert`` rows to their ``to_email``. Resend is
faked with ``httpx.MockTransport`` through ``send_via_resend``'s ``client``.

Before every attempt the dispatcher asks G05's
``fn_course_open_alert_send_check`` (migration 394, faked here; its SQL is
tested in test_migration_394_course_open_alerts.py) and sends only on ``send``.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from postgrest.exceptions import APIError

from scripts import enrollment_sweep as sweep
from services import enrollment_orders as eo
from services import learner_email as le
from tests._commerce_fake_db import FakeDB

NOW = datetime(2026, 11, 16, 14, 14, tzinfo=timezone.utc)
GUEST = "khach.hoc@example.com"
ALERT_ID = "5b0d7a3e-2f4c-4e1a-9a55-0c7f4b8d2e11"
PAYLOAD = {"alert_id": ALERT_ID, "product_slug": "reading-online", "product_title": "IELTS Reading Online",
           "unsubscribe_token": "tok_9QxZ-12"}
# tasks.md G04-T17: never these words in the rendered letter (word boundaries,
# so "xem" or "thêm" do not count).
FORBIDDEN = re.compile(r"\b(mua|bán|giá|đơn hàng|thầy|giảng viên|em)\b", re.IGNORECASE)


@pytest.fixture(autouse=True)
def config(monkeypatch):
    s = le.settings
    for name, value in (("LEARNER_EMAIL_FROM", "hocvien@averlearning.com"), ("LEARNER_EMAIL_REPLY_TO", ""),
                        ("PUBLIC_SITE_URL", "https://www.averlearning.com/")):
        monkeypatch.setattr(s, name, value)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")


# ── Sweep step 5 ─────────────────────────────────────────────────────────────


@pytest.fixture
def sweep_world(monkeypatch):
    db = FakeDB(handlers={
        "fn_enrollment_orders_expire": lambda p: {"expired": 0},
        "fn_enrollment_order_pay_reminders": lambda p: {"queued": 0},
        "fn_credit_expire_reservations": lambda p: {"expired": 0},
        "fn_credit_expire_entitlements": lambda p: {"closed": 0, "carried": 0, "carry_expired": 0},
        "fn_course_open_alerts_enqueue": lambda p: 3,
    })
    monkeypatch.setattr(eo, "supabase_admin", db)
    mail = []

    async def dispatch(limit=50, **kw):
        mail.append(limit)
        return le.DispatchSummary()

    monkeypatch.setattr(le, "dispatch_due", dispatch)
    return {"db": db, "mail": mail}


def test_step_5_queues_with_limit_200_before_the_dispatch(sweep_world, caplog):
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 0
    name, params = sweep_world["db"].rpcs[4]
    assert (name, params) == ("fn_course_open_alerts_enqueue", {"p_limit": 200})
    assert "[enroll] open_alerts queued=3" in caplog.text
    assert sweep_world["mail"] == [50]


@pytest.mark.parametrize("raw", [[3], {"fn_course_open_alerts_enqueue": 3}])
def test_step_5_reads_the_count_in_the_shapes_postgrest_returns(sweep_world, caplog, raw):
    sweep_world["db"].handlers["fn_course_open_alerts_enqueue"] = lambda p: raw
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 0
    assert "[enroll] open_alerts queued=3" in caplog.text


def test_until_g05_creates_the_function_step_5_is_skipped_and_mail_still_goes(sweep_world, caplog):
    sweep_world["db"].handlers["fn_course_open_alerts_enqueue"] = \
        lambda p: APIError({"code": "PGRST202", "message": "Could not find the function"})
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 0
    assert "[enroll] open_alerts skipped=no_function" in caplog.text
    assert sweep_world["mail"] == [50]


def test_another_error_fails_the_step_but_not_the_run(sweep_world, caplog):
    sweep_world["db"].handlers["fn_course_open_alerts_enqueue"] = \
        lambda p: APIError({"code": "57014", "message": "canceling statement due to statement timeout"})
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 1
    assert "sweep step=open_alerts failed" in caplog.text
    assert sweep_world["mail"] == [50]


def test_an_unexpected_answer_is_a_failure_not_a_count(sweep_world):
    sweep_world["db"].handlers["fn_course_open_alerts_enqueue"] = lambda p: {"queued": 3, "skipped": 1}
    assert sweep.run() == 1


# ── Rendering ────────────────────────────────────────────────────────────────


def test_the_letter_names_the_course_links_it_and_offers_unsubscribe():
    email = le.render("course_open_alert", PAYLOAD, {"email": GUEST})
    assert email.subject == "Khoá IELTS Reading Online đã mở đăng ký"
    assert email.text.startswith("Chào bạn,\n")
    assert "Bạn đã đăng ký nhận báo khi khoá IELTS Reading Online mở. Khoá đang mở đăng ký." in email.text
    assert "Trang khoá: https://www.averlearning.com/courses/reading-online\n" in email.text
    # The token rides in the hash (GOI-05 5.7), so it never reaches a server log.
    assert "Bỏ nhận: https://www.averlearning.com/courses/reading-online#bo-nhan=tok_9QxZ-12" in email.text
    assert "Bạn chỉ nhận một thư này" in email.text
    text = email.subject + "\n" + email.text
    assert "{" not in text and "}" not in text
    assert FORBIDDEN.search(text) is None, FORBIDDEN.search(text)
    assert not re.search(r"\d[\d.]*\s?đ\b", text)  # no tuition
    assert email.html is None  # G05-T14 adds the .html


def test_link_parts_are_url_encoded():
    email = le.render("course_open_alert", {**PAYLOAD, "product_slug": "a b", "unsubscribe_token": "x/y#z"},
                      {"email": GUEST})
    assert "/courses/a%20b#bo-nhan=x%2Fy%23z" in email.text


def test_without_a_site_url_the_letter_still_renders_with_no_link_lines(monkeypatch):
    monkeypatch.setattr(le.settings, "PUBLIC_SITE_URL", "")
    email = le.render("course_open_alert", PAYLOAD, {"email": GUEST})
    assert "http" not in email.text and "Bỏ nhận" not in email.text
    assert "Khoá đang mở đăng ký." in email.text


# ── Dispatch ─────────────────────────────────────────────────────────────────


def _row(rid, payload=None, **over):
    return {"id": rid, "user_id": None, "to_email": GUEST, "template": "course_open_alert",
            "dedupe_key": f"open_alert:{rid}", "payload": PAYLOAD if payload is None else payload,
            "status": "pending", "attempts": 0, "next_attempt_at": (NOW - timedelta(minutes=1)).isoformat(),
            "sent_at": None, "last_error_code": None, **over}


@pytest.fixture
def world(monkeypatch):
    verdicts: dict = {}
    db = FakeDB(tables={"learner_email_outbox": [], "users": []}, handlers={
        "fn_course_open_alert_send_check": lambda p: verdicts.get(p["p_alert_id"], "send")})
    monkeypatch.setattr(le, "supabase_admin", db)
    sent = []

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append({"headers": dict(request.headers), "body": json.loads(request.content)})
        return httpx.Response(200, json={"id": "re_1"})

    def dispatch():
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def go():
            try:
                return await le.dispatch_due(50, client=client, now=NOW)
            finally:
                await client.aclose()
        return asyncio.run(go())

    return {"db": db, "sent": sent, "dispatch": dispatch, "outbox": db.tables["learner_email_outbox"],
            "verdicts": verdicts}


def test_a_to_email_row_goes_to_that_address_from_the_learner_sender(world):
    world["outbox"].append(_row("a1"))
    summary = world["dispatch"]()
    assert (summary.sent, summary.skipped, summary.failed) == (1, 0, 0)
    (req,) = world["sent"]
    assert req["body"]["to"] == [GUEST]
    assert req["body"]["from"] == "Aver Learning <hocvien@averlearning.com>"
    assert req["headers"]["idempotency-key"] == "a1"
    assert req["body"]["subject"] == "Khoá IELTS Reading Online đã mở đăng ký"
    assert req["body"]["text"].startswith("Chào bạn,")
    assert ("users", "select") not in world["db"].calls  # no account lookup, no notification switch
    assert world["db"].rpcs == [("fn_course_open_alert_send_check", {"p_alert_id": ALERT_ID, "p_to_email": GUEST})]
    assert world["outbox"][0]["status"] == "sent"


@pytest.mark.parametrize("verdict", sorted(le.OPEN_ALERT_SKIPS))
def test_a_send_check_refusal_skips_with_its_reason_and_never_sends(world, verdict):
    world["verdicts"][ALERT_ID] = verdict
    world["outbox"].append(_row("a2"))
    summary = world["dispatch"]()
    assert (summary.sent, summary.skipped) == (0, 1) and world["sent"] == []
    assert (world["outbox"][0]["status"], world["outbox"][0]["last_error_code"]) == ("skipped", verdict)


def test_a_retry_checks_again_before_sending(world):
    # First attempt: Resend fails; the learner unsubscribes; the retry is skipped.
    world["outbox"].append(_row("a3"))
    calls = []

    def failing(request):
        calls.append(1)
        return httpx.Response(500, json={"message": "down"})

    async def go(transport):
        client = httpx.AsyncClient(transport=transport)
        try:
            return await le.dispatch_due(50, client=client, now=NOW)
        finally:
            await client.aclose()

    first = asyncio.run(go(httpx.MockTransport(failing)))
    assert first.retry == 1 and calls == [1]
    row = world["outbox"][0]
    assert row["status"] == "pending"
    row["next_attempt_at"] = (NOW - timedelta(minutes=1)).isoformat()
    world["verdicts"][ALERT_ID] = "skipped_unsubscribed"
    second = world["dispatch"]()
    assert (second.sent, second.skipped) == (0, 1) and world["sent"] == []
    assert (row["status"], row["last_error_code"]) == ("skipped", "skipped_unsubscribed")
    assert [name for name, _ in world["db"].rpcs].count("fn_course_open_alert_send_check") == 2


def test_without_the_send_check_function_the_row_is_skipped(world):
    world["db"].handlers["fn_course_open_alert_send_check"] = \
        lambda p: APIError({"code": "PGRST202", "message": "Could not find the function"})
    world["outbox"].append(_row("a6"))
    summary = world["dispatch"]()
    assert summary.skipped == 1 and world["sent"] == []
    assert world["outbox"][0]["last_error_code"] == "send_check_missing"


@pytest.mark.parametrize("answer", [
    APIError({"code": "57014", "message": "canceling statement due to statement timeout"}),
    "maybe", None, ["send"]])
def test_a_send_check_error_or_odd_answer_retries_and_never_sends(world, answer):
    world["db"].handlers["fn_course_open_alert_send_check"] = lambda p: answer
    world["outbox"].append(_row("a7"))
    summary = world["dispatch"]()
    assert summary.retry == 1 and world["sent"] == []
    assert world["outbox"][0]["status"] == "pending"


@pytest.mark.parametrize("payload", [{"alert_id": ALERT_ID, "product_title": "IELTS Reading Online"},
                                     {"product_slug": "reading-online"}, {**PAYLOAD, "alert_id": "nope"}])
def test_a_payload_without_the_slug_or_alert_id_fails_as_payload_invalid(world, payload):
    world["outbox"].append(_row("a4", payload=payload))
    world["outbox"].append(_row("a5"))
    summary = world["dispatch"]()
    assert (summary.failed, summary.sent) == (1, 1)
    bad = next(r for r in world["outbox"] if r["id"] == "a4")
    assert (bad["status"], bad["last_error_code"]) == ("failed", "payload_invalid")
    assert [r["body"]["to"] for r in world["sent"]] == [[GUEST]]
