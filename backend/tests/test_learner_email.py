"""COURSEACCESS-0055 G04-T04 — services/learner_email.py (plan 5.11).

Rendering of the four order letters, and the outbox dispatcher against a fake
Resend (``httpx.MockTransport`` through ``send_via_resend``'s ``client``)."""

from __future__ import annotations

import asyncio
import json
import logging
import re
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from services import enrollment_orders as eo
from services import learner_email as le
from tests._commerce_fake_db import FakeDB

NOW = datetime(2026, 11, 16, 14, 14, tzinfo=timezone.utc)  # 21:14 in Vietnam
USER = {"id": "u1", "email": "minhanh@example.com", "display_name": "Minh Anh"}
ORDER_ID = "0b7f0000-0000-0000-0000-000000000001"
BASE = {"order_id": ORDER_ID, "order_code": "AVER-7K2QXM", "product_title": "Khoá Writing for IELTS",
        "tuition_vnd": 1990000, "pay_by": (NOW + timedelta(hours=48)).isoformat()}
PAYLOADS = {
    "order_created": BASE,
    "order_pay_reminder": BASE,
    "order_needs_info": {**BASE, "info_kind": "underpaid", "received_vnd": 1500000,
                         "admin_message": "Bạn chuyển thiếu 490.000 đ, chuyển thêm giúp nhé.\nCảm ơn bạn.",
                         "supplement_by": (NOW + timedelta(hours=72)).isoformat()},
    "order_confirmed": {**BASE, "starts_at": NOW.isoformat(), "expires_at": (NOW + timedelta(days=180)).isoformat(),
                        "ai_credits": 40},
}
# Words the letters must never use (tasks.md G04-T04), with word boundaries so
# "xem", "giá trị" or "thêm" do not count.
FORBIDDEN = re.compile(r"\b(mua|bán|giá|đơn hàng|thầy|giảng viên|em)\b", re.IGNORECASE)
FORBIDDEN_EXCEPTIONS = ("giá trị",)


@pytest.fixture(autouse=True)
def config(monkeypatch):
    s = le.settings
    for name, value in (("LEARNER_EMAIL_FROM", "hocvien@averlearning.com"), ("LEARNER_EMAIL_REPLY_TO", ""),
                        ("PUBLIC_SITE_URL", "https://www.averlearning.com/"), ("ENROLLMENT_PAY_HOURS", 48),
                        ("ENROLL_BANK_BIN", "970436"), ("ENROLL_BANK_NAME", "Vietcombank"),
                        ("ENROLL_BANK_ACCOUNT_NO", "0123456789"), ("ENROLL_BANK_ACCOUNT_NAME", "CONG TY AVER")):
        monkeypatch.setattr(s, name, value)
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")


# ── Rendering ────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("template", list(PAYLOADS))
def test_every_order_letter_renders_clean_vietnamese(template):
    email = le.render(template, PAYLOADS[template], USER)
    text = email.subject + "\n" + email.text
    assert "AVER-7K2QXM" in email.subject
    assert email.text.startswith("Chào Minh Anh,")
    assert "https://www.averlearning.com/enroll/AVER-7K2QXM" in email.text
    assert "XXX" not in text and "{" not in text and "}" not in text
    assert "thư bắt buộc, không tắt được" in email.text
    assert email.html is None  # no .html yet (G05-T14)
    stripped = text
    for allowed in FORBIDDEN_EXCEPTIONS:
        stripped = stripped.replace(allowed, "")
    assert FORBIDDEN.search(stripped) is None, FORBIDDEN.search(stripped)
    assert "token" not in text.lower() and "đăng nhập tại" not in text  # no sign-in link


def test_created_letter_has_the_transfer_details_in_vietnam_time():
    text = le.render("order_created", BASE, USER).text
    assert "Học phí: 1.990.000 đ" in text
    assert "Ngân hàng: Vietcombank" in text and "Số tài khoản: 0123456789" in text
    assert "Chủ tài khoản: CONG TY AVER" in text
    assert "Nội dung chuyển khoản: AVER-7K2QXM" in text
    assert "Chuyển trước: 21:14, 18/11/2026" in text


def test_needs_info_keeps_the_admin_message_verbatim_and_the_deadline():
    text = le.render("order_needs_info", PAYLOADS["order_needs_info"], USER).text
    assert "Bạn chuyển thiếu 490.000 đ, chuyển thêm giúp nhé.\nCảm ơn bạn." in text
    assert "Hạn bổ sung: 21:14, 19/11/2026" in text
    assert "Đơn cần: 1.990.000 đ" in text and "Đã nhận: 1.500.000 đ" in text and "Còn thiếu: 490.000 đ" in text
    not_found = le.render("order_needs_info", {**PAYLOADS["order_needs_info"], "info_kind": "not_found",
                                               "received_vnd": None, "admin_message": ""}, USER).text
    assert "Bạn không cần chuyển lại" in not_found and "Lời nhắn" not in not_found


def test_confirmed_letter_and_greeting_without_a_name():
    email = le.render("order_confirmed", PAYLOADS["order_confirmed"], {"email": "a@example.com"})
    assert email.text.startswith("Chào bạn,")
    assert "hết ngày 15/05/2027" in email.text and "đã cộng 40 lượt" in email.text


def test_no_site_url_drops_the_link_line_but_still_renders(monkeypatch):
    monkeypatch.setattr(le.settings, "PUBLIC_SITE_URL", "")
    text = le.render("order_created", BASE, USER).text
    assert "/enroll/" not in text and "\n\n\n" not in text


def test_missing_template_raises():
    with pytest.raises(le.TemplateMissing):
        le.render("staff_notice", {}, USER)
    with pytest.raises(le.TemplateMissing):
        le.render("../secrets", {}, USER)


# ── Dispatch ─────────────────────────────────────────────────────────────────


def _row(rid, template="order_created", payload=None, attempts=0, user_id="u1", to_email=None):
    return {"id": rid, "user_id": user_id, "to_email": to_email, "template": template,
            "dedupe_key": f"k:{rid}", "payload": payload or BASE, "status": "pending", "attempts": attempts,
            "next_attempt_at": (NOW - timedelta(minutes=1)).isoformat(), "sent_at": None, "last_error_code": None}


@pytest.fixture
def world(monkeypatch):
    db = FakeDB(tables={
        "learner_email_outbox": [],
        "users": [dict(USER)],
        "enrollment_orders": [{"id": ORDER_ID, "status": "awaiting_transfer",
                               "pay_by": (NOW + timedelta(hours=10)).isoformat()}],
        "course_products": [],
    })
    monkeypatch.setattr(le, "supabase_admin", db)
    sent = []
    state = {"status": 200}

    def handler(request: httpx.Request) -> httpx.Response:
        sent.append({"headers": dict(request.headers), "body": json.loads(request.content)})
        return httpx.Response(state["status"], json={"id": "re_1"} if state["status"] == 200 else {"name": "boom"})

    def dispatch(**kw):
        client = httpx.AsyncClient(transport=httpx.MockTransport(handler))

        async def go():
            try:
                return await le.dispatch_due(50, client=client, now=NOW, **kw)
            finally:
                await client.aclose()
        return asyncio.run(go())

    return {"db": db, "sent": sent, "state": state, "dispatch": dispatch,
            "outbox": db.tables["learner_email_outbox"]}


def test_sends_one_letter_to_the_learner_with_the_row_id_as_idempotency_key(world):
    world["outbox"].append(_row("r1"))
    summary = world["dispatch"]()
    assert (summary.sent, summary.failed) == (1, 0)
    (req,) = world["sent"]
    assert req["body"]["from"] == "Aver Learning <hocvien@averlearning.com>"
    assert req["body"]["to"] == ["minhanh@example.com"]
    assert req["headers"]["idempotency-key"] == "r1"
    assert "html" not in req["body"] and "reply_to" not in req["body"]
    row = world["outbox"][0]
    assert (row["status"], row["attempts"]) == ("sent", 1) and row["sent_at"]


def test_reply_to_is_set_when_configured(world, monkeypatch):
    monkeypatch.setattr(le.settings, "LEARNER_EMAIL_REPLY_TO", "hotro@averlearning.com")
    world["outbox"].append(_row("r1"))
    world["dispatch"]()
    assert world["sent"][0]["body"]["reply_to"] == "hotro@averlearning.com"


def test_changed_email_between_queue_and_send_goes_to_the_new_address(world):
    world["outbox"].append(_row("r1"))
    world["db"].tables["users"][0]["email"] = "moi@example.com"
    world["dispatch"]()
    assert world["sent"][0]["body"]["to"] == ["moi@example.com"]


def test_resend_500_keeps_the_row_pending_with_a_300s_backoff(world):
    world["outbox"].append(_row("r1"))
    world["state"]["status"] = 500
    summary = world["dispatch"]()
    row = world["outbox"][0]
    assert summary.retry == 1
    assert (row["status"], row["attempts"], row["last_error_code"]) == ("pending", 1, "http_500:boom")
    assert datetime.fromisoformat(row["next_attempt_at"]) == NOW + timedelta(seconds=300)


def test_fifth_failed_attempt_fails_the_row(world):
    world["outbox"].append(_row("r1", attempts=4))
    world["state"]["status"] = 500
    world["dispatch"]()
    row = world["outbox"][0]
    assert (row["status"], row["attempts"]) == ("failed", 5)


def test_missing_template_fails_that_row_and_the_others_still_go(world):
    world["outbox"].extend([_row("r1", template="staff_notice"), _row("r2")])
    summary = world["dispatch"]()
    by_id = {r["id"]: r for r in world["outbox"]}
    assert (by_id["r1"]["status"], by_id["r1"]["last_error_code"]) == ("failed", "template_missing")
    assert by_id["r2"]["status"] == "sent" and summary.sent == 1 and len(world["sent"]) == 1


def test_reminder_is_skipped_once_the_order_moved_on(world):
    world["outbox"].append(_row("r1", template="order_pay_reminder"))
    world["db"].tables["enrollment_orders"][0]["status"] = "transfer_reported"
    world["dispatch"]()
    assert world["outbox"][0]["status"] == "skipped" and world["sent"] == []


def test_reminder_is_skipped_after_pay_by(world):
    world["outbox"].append(_row("r1", template="order_pay_reminder"))
    world["db"].tables["enrollment_orders"][0]["pay_by"] = (NOW - timedelta(minutes=5)).isoformat()
    world["dispatch"]()
    assert world["outbox"][0]["status"] == "skipped"


def test_reminder_still_due_is_sent(world):
    world["outbox"].append(_row("r1", template="order_pay_reminder"))
    world["dispatch"]()
    assert world["outbox"][0]["status"] == "sent"


def test_no_sender_address_skips_rows(world, monkeypatch):
    monkeypatch.setattr(le.settings, "LEARNER_EMAIL_FROM", "")
    world["outbox"].append(_row("r1"))
    summary = world["dispatch"]()
    assert summary.skipped == 1 and world["outbox"][0]["status"] == "skipped" and world["sent"] == []


def test_missing_api_key_leaves_rows_pending_and_names_the_variable(world, monkeypatch, caplog):
    monkeypatch.delenv("RESEND_API_KEY")
    world["outbox"].append(_row("r1"))
    with caplog.at_level(logging.WARNING, logger="services.learner_email"):
        summary = world["dispatch"]()
    assert not summary.ok and summary.unconfigured == ("RESEND_API_KEY",)
    assert world["outbox"][0]["status"] == "pending" and world["outbox"][0]["attempts"] == 0
    assert "learner_email_transport_unconfigured missing=RESEND_API_KEY" in caplog.text
    assert "re_test_key" not in caplog.text


def test_a_row_claimed_by_another_run_is_not_sent(world, monkeypatch):
    world["outbox"].append(_row("r1"))
    real_claim = le.claim

    def racing(row, now):
        world["outbox"][0]["attempts"] = 1  # the other sweep claimed it first
        return real_claim(row, now)

    monkeypatch.setattr(le, "claim", racing)
    summary = world["dispatch"]()
    assert summary.lost == 1 and world["sent"] == []


def test_a_row_already_at_five_attempts_fails_without_a_sixth_and_the_batch_still_sends(world):
    # Migration 383: CHECK (attempts BETWEEN 0 AND 5). A row left pending at 5
    # (crash after its last claim, or a read failure on it) is closed as
    # failed without a new attempt; the next row of the batch still goes out.
    world["outbox"].extend([_row("r5", attempts=le.MAX_ATTEMPTS), _row("r1")])
    summary = world["dispatch"]()
    assert (summary.failed, summary.sent) == (1, 1)
    exhausted, ok = world["outbox"]
    assert (exhausted["status"], exhausted["attempts"], exhausted["last_error_code"]) == \
        ("failed", le.MAX_ATTEMPTS, "attempts_exhausted")
    assert ok["status"] == "sent" and [r["body"]["to"] for r in world["sent"]] == [["minhanh@example.com"]]


def test_a_failing_claim_write_does_not_stop_the_batch(world, monkeypatch):
    world["outbox"].extend([_row("r1"), _row("r2")])
    real_claim = le.claim

    def flaky(row, now):
        if row["id"] == "r1":
            raise RuntimeError("PostgREST 500")
        return real_claim(row, now)

    monkeypatch.setattr(le, "claim", flaky)
    summary = world["dispatch"]()
    assert (summary.retry, summary.sent) == (1, 1)
    assert [r["status"] for r in world["outbox"]] == ["pending", "sent"]


def test_no_sender_address_does_not_spend_an_attempt(world, monkeypatch):
    monkeypatch.setattr(le.settings, "LEARNER_EMAIL_FROM", "")
    world["outbox"].append(_row("r5", attempts=le.MAX_ATTEMPTS))
    assert world["dispatch"]().skipped == 1
    assert (world["outbox"][0]["status"], world["outbox"][0]["attempts"]) == ("skipped", le.MAX_ATTEMPTS)


def test_not_due_rows_wait(world):
    row = _row("r1")
    row["next_attempt_at"] = (NOW + timedelta(minutes=5)).isoformat()
    world["outbox"].append(row)
    assert world["dispatch"]().due == 0


def test_send_direct_uses_the_same_transport_and_one_recipient(monkeypatch):
    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await le.send_direct("order_created", "khach@example.com", BASE, client=client,
                                        idempotency_key="direct-1")

    assert asyncio.run(go()).ok
    assert seen[0]["to"] == ["khach@example.com"] and seen[0]["from"].endswith("<hocvien@averlearning.com>")


def test_owner_alert_request_is_unchanged_by_the_new_parameters():
    """The owner alerts keep their sender, recipients and no html key."""
    from services import owner_alerts

    seen = []

    def handler(request):
        seen.append(json.loads(request.content))
        return httpx.Response(200, json={})

    config = owner_alerts.TransportConfig(recipients=("owner@example.com",), api_key="k", missing=())

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await owner_alerts.send_via_resend(owner_alerts.Email("s", "t"), config=config,
                                                      idempotency_key="x", client=client)

    assert asyncio.run(go()).ok
    assert seen[0] == {"from": "alerts@averlearning.com", "to": ["owner@example.com"], "subject": "s", "text": "t"}


def test_enrollment_config_reports_what_is_missing(monkeypatch):
    monkeypatch.setattr(eo.settings, "ENROLLMENT_PAY_HOURS", 0)
    monkeypatch.setattr(eo.settings, "ENROLL_BANK_ACCOUNT_NO", "")
    cfg = eo.enrollment_config()
    assert not cfg.ready and set(cfg.missing) == {"ENROLLMENT_PAY_HOURS", "ENROLL_BANK_ACCOUNT_NO"}
