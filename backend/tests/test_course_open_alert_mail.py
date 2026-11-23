"""COURSEACCESS-0055 G04-T17 — "khoá đã mở đăng ký" letter (FR-050, plan 5.11).

Step 5 of the enrollment sweep calls G05-T22's ``fn_course_open_alerts_enqueue``
(faked here: the function and its table are G05's migration), and the learner
dispatcher sends ``course_open_alert`` rows to their ``to_email``. Resend is
faked with ``httpx.MockTransport`` through ``send_via_resend``'s ``client``.

Waiting on G05-T22: the end-to-end case "two sweeps over the real function
send one letter" needs that migration; the UNIQUE ``dedupe_key`` and the
function's ``notified_at`` stamp are G05's, so it is not run here.
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
PAYLOAD = {"product_slug": "reading-online", "product_title": "IELTS Reading Online",
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


def _product(status="open", is_public=True, archived_at=None):
    return {"slug": "reading-online", "status": status, "is_public": is_public, "archived_at": archived_at}


@pytest.fixture
def world(monkeypatch):
    db = FakeDB(tables={"learner_email_outbox": [], "users": [], "course_products": [_product()]})
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

    return {"db": db, "sent": sent, "dispatch": dispatch, "outbox": db.tables["learner_email_outbox"]}


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
    assert world["outbox"][0]["status"] == "sent"


@pytest.mark.parametrize("product", [_product(status="closed"), _product(is_public=False),
                                     _product(status="closed", is_public=False, archived_at=NOW.isoformat())])
def test_a_course_no_longer_open_when_sending_is_skipped(world, product):
    world["db"].tables["course_products"] = [product]
    world["outbox"].append(_row("a2"))
    summary = world["dispatch"]()
    assert (summary.sent, summary.skipped) == (0, 1) and world["sent"] == []
    assert (world["outbox"][0]["status"], world["outbox"][0]["last_error_code"]) == ("skipped", "no_longer_applies")


def test_an_unknown_course_is_skipped(world):
    world["outbox"].append(_row("a3", payload={**PAYLOAD, "product_slug": "gone"}))
    assert world["dispatch"]().skipped == 1 and world["sent"] == []


def test_a_payload_without_the_slug_fails_as_payload_invalid(world):
    world["outbox"].append(_row("a4", payload={"product_title": "IELTS Reading Online"}))
    world["outbox"].append(_row("a5"))
    summary = world["dispatch"]()
    assert (summary.failed, summary.sent) == (1, 1)
    bad = next(r for r in world["outbox"] if r["id"] == "a4")
    assert (bad["status"], bad["last_error_code"]) == ("failed", "payload_invalid")
    assert [r["body"]["to"] for r in world["sent"]] == [[GUEST]]
