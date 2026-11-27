"""COURSEACCESS-0055 plan 5.11 — e-mail to learners.

Same Resend transport as the owner alerts (``owner_alerts.send_via_resend``,
its timeouts, error codes, ``MAX_ATTEMPTS`` and backoff), with the learner
sender and exactly one recipient. Rows come from ``learner_email_outbox``,
which the order RPCs fill in the same transaction as the state change; the
enrollment sweep calls :func:`dispatch_due`.

Rules (plan 5.11):
* ``Idempotency-Key`` is the outbox row id, so a resend after an error never
  duplicates at Resend.
* ``LEARNER_EMAIL_FROM`` empty → the row is ``skipped``. ``RESEND_API_KEY``
  missing → rows stay ``pending`` and one warning names the variable.
* A row with ``user_id`` goes to the user's CURRENT ``users.email`` and
  display name, read at send time. Order letters are mandatory: the
  ``notification_email`` switch is not read.
* ``order_pay_reminder`` re-reads the order and is skipped once it is no
  longer awaiting transfer or its ``pay_by`` has passed (FR-039).
* ``course_open_alert`` (FR-050, G04-T17) goes to the row's ``to_email``
  with "Chào bạn," and no ``users`` read. Before every attempt, retries
  included, G05's ``fn_course_open_alert_send_check(alert_id, to_email)``
  (migration 394, ENROLL-0060 FR-060) says ``send`` or why not
  (unsubscribed, address changed, already has the course, course closed,
  row gone); anything but ``send`` → ``skipped`` with that reason, never
  retried. Without the function (394 rolled back) → ``skipped`` /
  ``send_check_missing``; any other read error retries. A payload without
  ``product_slug`` or ``alert_id`` → ``failed`` / ``payload_invalid``.
* A template without a file → ``failed`` / ``template_missing``; the other
  rows still go.
"""

from __future__ import annotations

import asyncio
import html as html_lib
import logging
import os
import re
import string
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

from config import settings
from database import supabase_admin
from services import enrollment_orders as orders
from services import entitlements as ent
from services.owner_alerts import (
    MAX_ATTEMPTS,
    VIETNAM_TIME,
    Email,
    SendResult,
    TransportConfig,
    backoff_seconds,
    send_via_resend,
)

logger = logging.getLogger(__name__)

TEMPLATE_DIR = Path(__file__).resolve().parent.parent / "templates" / "email"
SENDER_NAME = "Aver Learning"
_SUBJECT_PREFIX = "Subject:"
_ROW_COLUMNS = "id, user_id, to_email, template, dedupe_key, payload, status, attempts, next_attempt_at"


class TemplateMissing(Exception):
    pass


class TemplateBroken(Exception):
    pass


# ── Transport ────────────────────────────────────────────────────────────────


def transport(env: Optional[dict] = None) -> TransportConfig:
    """``owner_alerts.transport_config`` treats missing OWNER_ALERT_EMAILS as
    unconfigured, so learner mail builds its own: no fixed recipients."""
    env = os.environ if env is None else env
    api_key = (env.get("RESEND_API_KEY") or "").strip()
    missing = []
    if not api_key:
        missing.append("RESEND_API_KEY")
    if not sender_address():
        missing.append("LEARNER_EMAIL_FROM")
    return TransportConfig(recipients=(), api_key=api_key, missing=tuple(missing))


def sender_address() -> str:
    return (settings.LEARNER_EMAIL_FROM or "").strip()


def _sender() -> str:
    address = sender_address()
    return address if "<" in address else f"{SENDER_NAME} <{address}>"


def _reply_to() -> Optional[str]:
    return (settings.LEARNER_EMAIL_REPLY_TO or "").strip() or None


# ── Rendering ────────────────────────────────────────────────────────────────


def vn_time(value) -> Optional[str]:
    """``21:14, 16/11/2026`` in Vietnam time."""
    parsed = value if isinstance(value, datetime) else ent.parse_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(VIETNAM_TIME).strftime("%H:%M, %d/%m/%Y")


def vn_date(value) -> Optional[str]:
    parsed = value if isinstance(value, datetime) else ent.parse_ts(value)
    if parsed is None:
        return None
    return parsed.astimezone(VIETNAM_TIME).strftime("%d/%m/%Y")


def vnd(amount) -> str:
    try:
        return f"{int(amount):,}".replace(",", ".") + " đ"
    except (TypeError, ValueError):
        return ""


def _order_link(order_code: Optional[str]) -> str:
    base = (settings.PUBLIC_SITE_URL or "").strip().rstrip("/")
    if not base or not order_code:
        return ""
    return f"\nMở trang đơn đăng ký: {base}/enroll/{order_code}\n"


def _account_link() -> str:
    """ACCOUNTDATA-0100 FR-012: letters link to the account page only, never
    to a Storage URL."""
    base = (settings.PUBLIC_SITE_URL or "").strip().rstrip("/")
    return f"\nMở trang Tài khoản: {base}/account\n" if base else ""


def _bank_lines() -> str:
    cfg = orders.enrollment_config()
    lines = []
    if cfg.bank_name:
        lines.append(f"Ngân hàng: {cfg.bank_name}")
    if cfg.account_no:
        lines.append(f"Số tài khoản: {cfg.account_no}")
    if cfg.account_name:
        lines.append(f"Chủ tài khoản: {cfg.account_name}")
    return "\n".join(lines)


def _needs_info_fields(payload: dict) -> dict:
    code = payload.get("order_code") or ""
    title = payload.get("product_title") or ""
    kind = payload.get("info_kind")
    tuition, received = payload.get("tuition_vnd"), payload.get("received_vnd")
    if kind == "underpaid":
        info = (f"Chúng tôi chưa mở được {title} cho đơn đăng ký {code}: khoản chuyển của bạn còn thiếu tiền. "
                "Bạn không mất khoản đã chuyển.")
        todo = (f"Bạn cần làm gì: chuyển thêm phần còn thiếu với cùng nội dung {code}; khoá mở khi đủ. "
                "Không muốn chuyển thêm: trả lời thư này để được hoàn khoản đã chuyển.")
    elif kind == "not_found":
        info = f"Chúng tôi chưa tìm thấy khoản chuyển khớp mã đơn đăng ký {code} cho {title}."
        todo = (f"Có thể nội dung bị thiếu hoặc ghi khác {code}. Bạn không cần chuyển lại. Gửi mã đơn, số tiền, "
                "giờ chuyển và ảnh biên lai bằng cách trả lời thư này.")
    else:
        info = f"Chúng tôi cần bạn bổ sung thông tin cho đơn đăng ký {code} trước khi mở {title}."
        todo = "Bạn cần làm gì: đọc lời nhắn dưới đây và trả lời thư này."
    lines = []
    if tuition is not None:
        lines.append(f"Đơn cần: {vnd(tuition)}")
    if received is not None:
        lines.append(f"Đã nhận: {vnd(received)}")
        if tuition is not None and int(tuition) > int(received):
            lines.append(f"Còn thiếu: {vnd(int(tuition) - int(received))}")
    message = (payload.get("admin_message") or "").strip()
    return {
        "info_sentence": info,
        "todo_sentence": todo,
        "amount_lines": "\n".join(lines),
        "supplement_by": vn_time(payload.get("supplement_by")) or "",
        # Verbatim (FR-037): the admin's words, untouched.
        "admin_message_block": f"\nLời nhắn của admin:\n{message}\n" if message else "",
    }


def _site_base() -> str:
    return (settings.PUBLIC_SITE_URL or "").strip().rstrip("/")


def _open_alert_fields(payload: dict) -> dict:
    """Course link and unsubscribe link (GOI-05 5.7: the token rides in the
    hash, so it never reaches a server log). No base URL → no link lines."""
    base, slug = _site_base(), str(payload.get("product_slug") or "")
    token = str(payload.get("unsubscribe_token") or "")
    if not base or not slug:
        return {"course_link_line": "", "unsubscribe_line": ""}
    page = f"{base}/courses/{quote(slug, safe='')}"
    unsubscribe = f"\nBỏ nhận: {page}#bo-nhan={quote(token, safe='')}" if token else ""
    return {"course_link_line": f"\nTrang khoá: {page}\n", "unsubscribe_line": unsubscribe}


def template_fields(template: str, payload: dict, user: dict) -> dict:
    name = (user.get("display_name") or "").strip()
    fields = {
        "greeting": f"Chào {name}," if name else "Chào bạn,",
        "email": user.get("email") or "",
        "order_code": payload.get("order_code") or "",
        "product_title": payload.get("product_title") or "",
        "tuition": vnd(payload.get("tuition_vnd")),
        "pay_by": vn_time(payload.get("pay_by")) or "",
        "order_link_line": _order_link(payload.get("order_code")),
    }
    if template == "order_created":
        fields["bank_lines"] = _bank_lines()
    elif template == "order_needs_info":
        fields.update(_needs_info_fields(payload))
    elif template.startswith("account_"):
        fields["erase_on"] = vn_date(payload.get("erase_after")) or ""
        fields["export_expires_on"] = vn_date(payload.get("expires_at")) or ""
        fields["account_link_line"] = _account_link()
    elif template == "order_confirmed":
        credits = int(payload.get("ai_credits") or 0)
        fields["expires_on"] = vn_date(payload.get("expires_at")) or ""
        fields["credits_line"] = f"đã cộng {credits} lượt" if credits else "khoá này không kèm lượt chấm AI"
    elif template == "course_open_alert":
        fields.update(_open_alert_fields(payload))
    return fields


def _fill(text: str, fields: dict, *, escape: bool) -> str:
    values = {k: html_lib.escape(v) if escape else v for k, v in fields.items()}
    names = {name for _, name, _, _ in string.Formatter().parse(text) if name}
    unknown = names - set(values)
    if unknown:
        raise TemplateBroken(",".join(sorted(unknown)))
    return text.format_map(values)


def _tidy(text: str) -> str:
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"


def render(template: str, payload: dict, user: dict) -> Email:
    """``Email(subject, text, html)``; ``html`` is None without a ``.html`` file."""
    txt = TEMPLATE_DIR / f"{template}.txt"
    if not re.fullmatch(r"[a-z_]{1,40}", template) or not txt.is_file():
        raise TemplateMissing(template)
    fields = template_fields(template, payload or {}, user or {})
    raw = txt.read_text(encoding="utf-8")
    first, _, body = raw.partition("\n")
    if not first.startswith(_SUBJECT_PREFIX):
        raise TemplateBroken("subject")
    subject = " ".join(_fill(first[len(_SUBJECT_PREFIX):], fields, escape=False).split())
    text = _tidy(_fill(body, fields, escape=False))
    html_path = TEMPLATE_DIR / f"{template}.html"
    html = _fill(html_path.read_text(encoding="utf-8"), fields, escape=True) if html_path.is_file() else None
    return Email(subject=subject, text=text, html=html)


# ── Direct send (no outbox) ──────────────────────────────────────────────────


async def send_direct(template: str, to: str, payload: dict, *, client: Any = None,
                      idempotency_key: Optional[str] = None) -> SendResult:
    """One letter that is not tied to an account row (plan 5.11: class
    invites, later). Same transport; nothing is written."""
    config = transport()
    if config.missing:
        logger.warning("learner_email_transport_unconfigured missing=%s", ",".join(config.missing))
        return SendResult(False, "unconfigured")
    try:
        email = render(template, payload, {"email": to, "display_name": payload.get("display_name")})
    except TemplateMissing:
        return SendResult(False, "template_missing")
    except TemplateBroken:
        return SendResult(False, "template_broken")
    return await send_via_resend(email, config=config, idempotency_key=idempotency_key or str(uuid.uuid4()),
                                 client=client, sender=_sender(), reply_to=_reply_to(), recipients=(to,))


# ── Outbox store (supabase_admin) ────────────────────────────────────────────


def _now() -> datetime:
    return datetime.now(timezone.utc)


def fetch_due(limit: int, now: datetime) -> list[dict]:
    res = (
        supabase_admin.table("learner_email_outbox").select(_ROW_COLUMNS)
        .eq("status", "pending").lte("next_attempt_at", now.isoformat())
        .order("next_attempt_at").limit(limit).execute()
    )
    return list(res.data or [])


def claim(row: dict, now: datetime) -> bool:
    """Take the row by bumping ``attempts`` from the value we read, with the
    retry time already set: a second sweep that read the same row loses, and
    a crash after the claim retries after the backoff."""
    attempts = int(row.get("attempts") or 0) + 1
    res = (
        supabase_admin.table("learner_email_outbox")
        .update({"attempts": attempts,
                 "next_attempt_at": (now + timedelta(seconds=backoff_seconds(attempts))).isoformat()})
        .eq("id", row["id"]).eq("status", "pending").eq("attempts", int(row.get("attempts") or 0))
        .execute()
    )
    if res.data:
        row["attempts"] = attempts
        return True
    return False


def settle_unclaimed(row: dict, status: str, error: str) -> bool:
    """Close a row WITHOUT a new attempt, under the same read-value condition
    as ``claim``. Used for a row already at MAX_ATTEMPTS (a crash after its
    last claim, or a read failure on it): claiming it again would write
    attempts = MAX_ATTEMPTS + 1, which migration 383's CHECK (0..5) rejects."""
    res = (
        supabase_admin.table("learner_email_outbox")
        .update({"status": status, "last_error_code": error})
        .eq("id", row["id"]).eq("status", "pending").eq("attempts", int(row.get("attempts") or 0))
        .execute()
    )
    return bool(res.data)


def finish(row: dict, status: str, error: Optional[str] = None, now: Optional[datetime] = None) -> None:
    values: dict[str, Any] = {"status": status, "last_error_code": error}
    if status == "sent":
        values["sent_at"] = (now or _now()).isoformat()
    supabase_admin.table("learner_email_outbox").update(values) \
        .eq("id", row["id"]).eq("attempts", row["attempts"]).execute()


def note_error(row: dict, error: str) -> None:
    supabase_admin.table("learner_email_outbox").update({"last_error_code": error[:80]}) \
        .eq("id", row["id"]).eq("attempts", row["attempts"]).execute()


def fetch_user(user_id: str) -> Optional[dict]:
    res = supabase_admin.table("users").select("id, display_name, email").eq("id", user_id).limit(1).execute()
    rows = list(res.data or [])
    return rows[0] if rows else None


def fetch_order_state(order_id: str) -> Optional[dict]:
    res = (
        supabase_admin.table("enrollment_orders").select("status, pay_by")
        .eq("id", order_id).limit(1).execute()
    )
    rows = list(res.data or [])
    return rows[0] if rows else None


OPEN_ALERT_SKIPS = frozenset({"skipped_unsubscribed", "skipped_email_changed", "skipped_has_course",
                              "skipped_closed", "skipped_missing"})


def open_alert_verdict(row: dict) -> str:
    """``send`` or the reason not to, from ``fn_course_open_alert_send_check``.
    A missing function is a skip (``send_check_missing``); any other error or
    an unknown answer raises, so the claim's backoff retries the row."""
    payload = row.get("payload") or {}
    try:
        verdict = supabase_admin.rpc("fn_course_open_alert_send_check", {
            "p_alert_id": str(payload["alert_id"]), "p_to_email": row.get("to_email")}).execute().data
    except Exception as exc:
        if orders.is_missing_function(exc):
            return "send_check_missing"
        raise
    if verdict == "send" or verdict in OPEN_ALERT_SKIPS:
        return verdict
    raise ValueError("unexpected fn_course_open_alert_send_check answer")


def payload_invalid(row: dict) -> bool:
    """G05 owns the ``course_open_alert`` payload; a row without the slug or
    the alert id cannot be checked or linked, so it fails instead of being
    guessed."""
    if row.get("template") != "course_open_alert":
        return False
    payload = row.get("payload") or {}
    try:
        uuid.UUID(str(payload.get("alert_id") or ""))
    except ValueError:
        return True
    return not str(payload.get("product_slug") or "").strip()


def still_wanted(row: dict, now: datetime) -> bool:
    payload = row.get("payload") or {}
    if row.get("template") == "order_pay_reminder":
        state = fetch_order_state(str(payload.get("order_id") or ""))
        pay_by = ent.parse_ts((state or {}).get("pay_by"))
        return bool(state) and state.get("status") == "awaiting_transfer" and pay_by is not None and pay_by > now
    return True


# ── Dispatch ─────────────────────────────────────────────────────────────────


@dataclass
class DispatchSummary:
    due: int = 0
    sent: int = 0
    retry: int = 0
    failed: int = 0
    skipped: int = 0
    lost: int = 0                 # claimed by another run
    unconfigured: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return not self.unconfigured


async def _send_row(row: dict, config: TransportConfig, now: datetime, client: Any) -> str:
    run = asyncio.to_thread
    if int(row.get("attempts") or 0) >= MAX_ATTEMPTS:
        return "failed" if await run(settle_unclaimed, row, "failed", "attempts_exhausted") else "lost"
    if not await run(claim, row, now):
        return "lost"
    try:
        if payload_invalid(row):
            await run(finish, row, "failed", "payload_invalid")
            return "failed"
        if row.get("template") == "course_open_alert":
            verdict = await run(open_alert_verdict, row)
            if verdict != "send":
                await run(finish, row, "skipped", verdict)
                return "skipped"
        elif not await run(still_wanted, row, now):
            await run(finish, row, "skipped", "no_longer_applies")
            return "skipped"
        if row.get("user_id"):
            user = await run(fetch_user, str(row["user_id"]))
            address = (user or {}).get("email")
        else:
            user, address = {"email": row.get("to_email")}, row.get("to_email")
        if not address:
            await run(finish, row, "skipped", "no_recipient")
            return "skipped"
        try:
            email = render(row["template"], row.get("payload") or {}, user or {})
        except TemplateMissing:
            await run(finish, row, "failed", "template_missing")
            return "failed"
        except TemplateBroken:
            await run(finish, row, "failed", "template_broken")
            return "failed"
        result = await send_via_resend(email, config=config, idempotency_key=str(row["id"]), client=client,
                                       sender=_sender(), reply_to=_reply_to(), recipients=(address,))
    except Exception as exc:  # a read failed: the claim's backoff retries it
        logger.warning("[mail] row=%s read failed: %s", row.get("id"), type(exc).__name__)
        return "retry"
    if result.ok:
        await run(finish, row, "sent", None, now)
        return "sent"
    if row["attempts"] >= MAX_ATTEMPTS:
        await run(finish, row, "failed", result.error)
        return "failed"
    await run(note_error, row, result.error or "send_failed")
    return "retry"


async def dispatch_due(limit: int = 50, *, client: Any = None, now: Optional[datetime] = None) -> DispatchSummary:
    now = now or _now()
    summary = DispatchSummary()
    config = transport()
    rows = await asyncio.to_thread(fetch_due, limit, now)
    summary.due = len(rows)
    if not rows:
        return summary
    if not sender_address():
        # No sender address: nothing may go out; the rows are not retried.
        for row in rows:
            try:
                if await asyncio.to_thread(settle_unclaimed, row, "skipped", "sender_unconfigured"):
                    summary.skipped += 1
            except Exception as exc:  # one row never stops the batch
                logger.warning("[mail] row=%s skip failed: %s", row.get("id"), type(exc).__name__)
        return summary
    if config.missing:
        logger.warning("learner_email_transport_unconfigured missing=%s", ",".join(config.missing))
        summary.unconfigured = config.missing
        return summary
    for row in rows:
        try:
            outcome = await _send_row(row, config, now, client)
        except Exception as exc:  # e.g. the claim write failed: retried next run, the batch goes on
            logger.warning("[mail] row=%s dispatch failed: %s", row.get("id"), type(exc).__name__)
            outcome = "retry"
        setattr(summary, outcome, getattr(summary, outcome) + 1)
    logger.info("[mail] due=%d sent=%d retry=%d failed=%d skipped=%d lost=%d", summary.due, summary.sent,
                summary.retry, summary.failed, summary.skipped, summary.lost)
    return summary
