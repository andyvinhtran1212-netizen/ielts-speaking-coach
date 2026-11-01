"""Owner security alerts (ADMINAAL2-0032 FR-011, task T007).

Rows of ``public.owner_alert_outbox`` (migration 332) are e-mailed to the owner
through Resend, FROM ``alerts@averlearning.com`` (owner decision (a),
2026-10-28 09:35). There is no other transport and no other sender: a Resend
rejection (for example while the domain's DNS is unverified) leaves the row
unsent and retried with backoff, up to ``MAX_ATTEMPTS`` sends.

Configuration comes from the process environment only, read on every call:

- ``OWNER_ALERT_EMAILS``: comma-separated recipients (the single owner address
  decided under Q2). Nothing in a row's payload can add a recipient.
- ``RESEND_API_KEY``: the provider key. It is sent only in the Authorization
  header and never logged or stored.

These two settings live here rather than in ``config.py`` so this module stays
importable and testable on its own; AIBUDGET-0033 reuses the same names. When
either is missing, nothing is sent, no attempt is spent, and one
``owner_alert_transport_unconfigured`` warning names the missing variable.

The e-mail is rendered from an allow-list of payload fields (event, target and
actor e-mail, time in Vietnam time, source, role/active before and after,
factor id). Any other key in the payload, such as a reason, token or secret,
is never copied into the message.

A row is claimed by a compare-and-set on ``attempts`` before it is sent, so the
cron and an inline dispatch cannot both send the same attempt. The claim also
pushes ``next_attempt_at`` out by the backoff, so a process that dies after
claiming retries later instead of never. Resend's ``Idempotency-Key`` is the
outbox id, so a retry after a send whose result was lost does not mail twice.

The claim sets the row back to ``pending``: ``pending`` means "no outcome
recorded for the current attempt", ``failed`` means the latest attempt was
refused. So a row at ``MAX_ATTEMPTS`` that is still ``pending`` once its lease
has run out is a last attempt cut off before its result was saved (before the
send, or after it). Dispatch finishes that attempt instead of leaving it
orphaned (PC-J66 F03): it re-takes the expired lease with a compare-and-set on
``next_attempt_at`` and sends again under the same ``Idempotency-Key``, which
Resend answers from its record of the first request if that one got through
(keys are kept for 24 hours; the last lease is 2 hours). ``attempts`` stays at
``MAX_ATTEMPTS`` and the row ends ``sent``, or ``failed`` for ``--requeue``.
"""

from __future__ import annotations

import json
import logging
import os
import re
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Protocol

logger = logging.getLogger("owner_alerts")

SENDER = "alerts@averlearning.com"
RESEND_URL = "https://api.resend.com/emails"
MAX_ATTEMPTS = 5
# Delay after attempt n (1-based) before attempt n + 1 may run. The cron runs
# every 5 minutes, so the first retry is on the next run.
BACKOFF_SECONDS = (300, 900, 2700, 7200)
SEND_TIMEOUT_SECONDS = 15.0
# Lease taken to finish an interrupted last attempt. Longer than a send, so
# two dispatchers cannot both hold it.
RESUME_LEASE_SECONDS = BACKOFF_SECONDS[0]

VIETNAM_TIME = timezone(timedelta(hours=7))   # no DST
_EMAIL_RE = re.compile(r"^[^@\s,;<>\"']+@[^@\s,;<>\"']+\.[^@\s,;<>\"']+$")
_UNKNOWN_ACTOR = "không rõ (ngoài ứng dụng)"

_EVENT_TITLES = {
    "staff_row_inserted": "Tạo tài khoản admin",
    "sessions_revoked": "Đã thu hồi phiên đăng nhập",
    "sessions_revoke_failed": "Thu hồi phiên đăng nhập của staff THẤT BẠI",
    "mfa_factor_enrolled": "Admin thêm yếu tố xác thực 2 bước",
    "mfa_factor_verified": "Admin xác minh yếu tố xác thực 2 bước",
    "mfa_factor_deleted": "Admin bị xoá yếu tố xác thực 2 bước",
    "bootstrap_recovery": "Khôi phục admin khẩn cấp (bootstrap)",
}
_SOURCE_LABELS = {
    "admin_api": "trang admin",
    "service": "dịch vụ backend (service_role)",
    "out_of_band": "ngoài ứng dụng (SQL editor / runner)",
    "auth": "Supabase Auth",
}
_ROLE_LABELS = {"admin", "instructor", "student", "user"}


# ── Configuration ────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class TransportConfig:
    recipients: tuple[str, ...]
    api_key: str
    missing: tuple[str, ...]

    @property
    def ready(self) -> bool:
        return not self.missing


def parse_recipients(raw: str | None) -> tuple[str, ...]:
    """Valid, de-duplicated addresses from ``OWNER_ALERT_EMAILS``."""
    seen: list[str] = []
    for part in (raw or "").split(","):
        address = part.strip()
        if not address:
            continue
        if not _EMAIL_RE.match(address):
            logger.warning("owner_alert_recipient_invalid index=%d", len(seen))
            continue
        if address.lower() not in (s.lower() for s in seen):
            seen.append(address)
    return tuple(seen)


def transport_config(env: dict[str, str] | None = None) -> TransportConfig:
    env = os.environ if env is None else env
    recipients = parse_recipients(env.get("OWNER_ALERT_EMAILS"))
    api_key = (env.get("RESEND_API_KEY") or "").strip()
    missing = tuple(name for name, value in (("RESEND_API_KEY", api_key),
                                             ("OWNER_ALERT_EMAILS", recipients)) if not value)
    return TransportConfig(recipients=recipients, api_key=api_key, missing=missing)


# ── Rendering ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Email:
    subject: str
    text: str


def _uuid(value: Any) -> str | None:
    try:
        return str(uuid.UUID(str(value)))
    except (TypeError, ValueError, AttributeError):
        return None


def _address(value: Any) -> str | None:
    text = str(value or "").strip()
    return text if _EMAIL_RE.match(text) else None


def _role(state: Any) -> str | None:
    role = state.get("role") if isinstance(state, dict) else None
    return role if role in _ROLE_LABELS else None


def _active(state: Any) -> bool | None:
    value = state.get("is_active") if isinstance(state, dict) else None
    return value if isinstance(value, bool) else None


def _suspended(state: Any) -> bool:
    return isinstance(state, dict) and bool(state.get("suspended_at"))


def _vietnam_time(value: Any) -> str:
    if isinstance(value, datetime):
        moment = value
    else:
        try:
            moment = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return "không rõ"
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(VIETNAM_TIME).strftime("%d/%m/%Y %H:%M:%S") + " (giờ Việt Nam)"


def _title(event: str, before: Any, after: Any) -> str:
    if event == "role_changed":
        old, new = _role(before), _role(after)
        if new == "admin" and old != "admin":
            return "Tài khoản được CẤP quyền admin"
        if old == "admin" and new != "admin":
            return "Tài khoản bị GỠ quyền admin"
        return "Đổi vai trò tài khoản staff"
    if event == "active_changed":
        if _active(after) is False:
            return "Admin bị TẠM KHÓA" if _suspended(after) else "Admin bị tắt kích hoạt"
        if _active(after) is True:
            return "Admin được MỞ KHÓA" if _suspended(before) else "Admin được kích hoạt"
        return "Đổi trạng thái kích hoạt của admin"
    if event in _EVENT_TITLES:
        return _EVENT_TITLES[event]
    return "Sự kiện bảo mật " + (event if re.fullmatch(r"[a-z_]{1,40}", event) else "không rõ")


def _state_line(label: str, state: Any) -> str | None:
    role, active = _role(state), _active(state)
    if role is None and active is None:
        return None
    parts = []
    if role is not None:
        parts.append(f"vai trò {role}")
    if active is not None:
        parts.append("đang hoạt động" if active else "không hoạt động")
    if _suspended(state):
        parts.append("bị tạm khóa")
    return f"{label}: " + ", ".join(parts)


def render(payload: dict[str, Any]) -> Email:
    """The e-mail for one outbox payload, from allow-listed fields only."""
    payload = payload if isinstance(payload, dict) else {}
    event = str(payload.get("event") or "")
    before, after = payload.get("before"), payload.get("after")
    title = _title(event, before, after)
    target = _address(payload.get("target_email")) or "không rõ"
    actor = _address(payload.get("actor_email")) or _UNKNOWN_ACTOR
    source = _SOURCE_LABELS.get(str(payload.get("source") or ""), "không rõ")
    lines = [
        title,
        "",
        f"Tài khoản: {target}",
        f"Người thực hiện: {actor}",
        f"Thời điểm: {_vietnam_time(payload.get('occurred_at'))}",
        f"Nguồn: {source}",
    ]
    for line in (_state_line("Trước", before), _state_line("Sau", after)):
        if line:
            lines.append(line)
    factor = _uuid(payload.get("factor_id"))
    if factor:
        status = payload.get("factor_status")
        suffix = {"verified": " (đã xác minh)", "unverified": " (chưa xác minh)"}.get(status, "")
        lines.append(f"Yếu tố 2 bước: {factor}{suffix}")
    audit = _uuid(payload.get("audit_id"))
    if audit:
        lines.append(f"Mã nhật ký: {audit}")
    lines += [
        "",
        "Nếu anh không nhận ra thay đổi này, hãy xem \"Lịch sử quyền\" trong trang "
        "admin và tạm khóa tài khoản liên quan.",
    ]
    return Email(subject=f"[Aver] {title}: {target}", text="\n".join(lines))


TEST_ALERT = Email(
    subject="[Aver] Kiểm tra kênh cảnh báo",
    text="kiểm tra kênh cảnh báo\n\nĐây là thư thử của kênh cảnh báo bảo mật. "
         "Không cần làm gì.",
)


# ── Transport ────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class SendResult:
    ok: bool
    error: str | None = None   # short code, never a response body or the key


Sender = Callable[..., Awaitable[SendResult]]


async def send_via_resend(email: Email, *, config: TransportConfig, idempotency_key: str,
                          client: Any = None) -> SendResult:
    """POST one e-mail to Resend. Never raises; never returns the key or a body."""
    import httpx

    request = {
        "from": SENDER,
        "to": list(config.recipients),
        "subject": email.subject,
        "text": email.text,
    }
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Idempotency-Key": idempotency_key,
    }
    owned = client is None
    client = client or httpx.AsyncClient(timeout=SEND_TIMEOUT_SECONDS)
    try:
        response = await client.post(RESEND_URL, json=request, headers=headers)
    except httpx.TimeoutException:
        return SendResult(False, "timeout")
    except httpx.HTTPError as exc:
        return SendResult(False, "transport_" + type(exc).__name__)
    finally:
        if owned:
            await client.aclose()
    if 200 <= response.status_code < 300:
        return SendResult(True)
    name = ""
    try:
        body = response.json()
        name = str(body.get("name") or "") if isinstance(body, dict) else ""
    except ValueError:
        pass
    name = name if re.fullmatch(r"[a-z_]{1,60}", name) else ""
    return SendResult(False, f"http_{response.status_code}" + (f":{name}" if name else ""))


# ── Outbox dispatch ──────────────────────────────────────────────────────────

class OutboxStore(Protocol):
    async def due(self, *, max_attempts: int, limit: int) -> list[dict[str, Any]]: ...
    async def claim(self, row_id: str, attempts: int, lease_seconds: int) -> bool: ...
    async def reclaim_final(self, row_id: str, attempts: int, lease_seconds: int) -> bool: ...
    async def mark_sent(self, row_id: str, attempts: int) -> None: ...
    async def mark_failed(self, row_id: str, attempts: int, error: str,
                          retry_seconds: int) -> None: ...


def backoff_seconds(attempts: int) -> int:
    """Delay after the ``attempts``-th send before the next one may run."""
    return BACKOFF_SECONDS[min(max(attempts, 1), len(BACKOFF_SECONDS)) - 1]


@dataclass
class DispatchSummary:
    due: int = 0
    sent: int = 0
    failed: int = 0          # failed this run, will retry
    exhausted: int = 0       # reached MAX_ATTEMPTS, stays `failed`
    resumed: int = 0         # interrupted last attempts finished this run
    skipped_claimed: int = 0
    unconfigured: bool = False
    missing: str = ""        # names of the missing settings, never their values
    disabled: bool = False


async def dispatch_due(store: OutboxStore, *, config: TransportConfig | None = None,
                       send: Sender = send_via_resend, limit: int = 50,
                       disabled: bool = False) -> DispatchSummary:
    """Send due rows once, or only read them when disabled. Never raises for a send failure."""
    config = config or transport_config()
    rows = await store.due(max_attempts=MAX_ATTEMPTS, limit=limit)
    summary = DispatchSummary(due=len(rows), disabled=disabled)
    if disabled or not rows:
        return summary
    if not config.ready:
        summary.unconfigured = True
        summary.missing = ",".join(config.missing)
        logger.warning("owner_alert_transport_unconfigured missing=%s due=%d",
                       summary.missing, len(rows))
        return summary
    for row in rows:
        row_id, seen = str(row["id"]), int(row["attempts"])
        # A due row at MAX_ATTEMPTS is a last attempt that was claimed but never
        # recorded: finish that attempt, do not start a sixth.
        resume = seen >= MAX_ATTEMPTS
        attempt = seen if resume else seen + 1
        claimed = (await store.reclaim_final(row_id, seen, RESUME_LEASE_SECONDS) if resume
                   else await store.claim(row_id, seen, backoff_seconds(attempt)))
        if not claimed:
            summary.skipped_claimed += 1
            continue
        if resume:
            summary.resumed += 1
            logger.warning("owner_alert_resume_interrupted audit_id=%s attempts=%d",
                           row.get("audit_id"), attempt)
        result = await send(render(row.get("payload") or {}), config=config,
                            idempotency_key=f"owner-alert-{row_id}")
        if result.ok:
            await store.mark_sent(row_id, attempt)
            summary.sent += 1
            continue
        error = result.error or "unknown"
        await store.mark_failed(row_id, attempt, error, backoff_seconds(attempt))
        if attempt >= MAX_ATTEMPTS:
            summary.exhausted += 1
            logger.error("owner_alert_failed audit_id=%s attempts=%d error=%s",
                         row.get("audit_id"), attempt, error)
        else:
            summary.failed += 1
            logger.warning("owner_alert_retry audit_id=%s attempts=%d error=%s",
                           row.get("audit_id"), attempt, error)
    return summary


async def send_test_alert(*, config: TransportConfig | None = None,
                          send: Sender = send_via_resend) -> SendResult:
    """rollout.md P3: one fixed message, outside the outbox."""
    config = config or transport_config()
    if not config.ready:
        logger.warning("owner_alert_transport_unconfigured missing=%s", ",".join(config.missing))
        return SendResult(False, "unconfigured")
    return await send(TEST_ALERT, config=config,
                      idempotency_key=f"owner-alert-test-{uuid.uuid4()}")


class PgOutboxStore:
    """``OutboxStore`` over an asyncpg connection (the sweep's direct connection).

    Each statement runs on its own (autocommit), so a claim is visible to every
    other dispatcher before the e-mail is sent.
    """

    def __init__(self, conn: Any, schema: str = "public") -> None:
        if not re.fullmatch(r"[a-z_][a-z0-9_]*", schema):
            raise ValueError("invalid schema name")
        self._conn = conn
        self._table = f"{schema}.owner_alert_outbox"

    async def due(self, *, max_attempts: int, limit: int) -> list[dict[str, Any]]:
        """Rows with attempts left, and last attempts whose lease ran out unrecorded."""
        rows = await self._conn.fetch(
            f"""SELECT id, audit_id, event, payload::text AS payload, attempts
                  FROM {self._table}
                 WHERE status <> 'sent' AND next_attempt_at <= now()
                   AND (attempts < $1 OR status = 'pending')
                 ORDER BY next_attempt_at, created_at
                 LIMIT $2""",
            max_attempts, limit)
        return [{**dict(r), "id": str(r["id"]), "audit_id": str(r["audit_id"]),
                 "payload": json.loads(r["payload"])} for r in rows]

    async def claim(self, row_id: str, attempts: int, lease_seconds: int) -> bool:
        claimed = await self._conn.fetchval(
            f"""UPDATE {self._table}
                   SET attempts = attempts + 1, status = 'pending',
                       next_attempt_at = now() + make_interval(secs => $3)
                 WHERE id = $1::uuid AND attempts = $2 AND status <> 'sent'
                RETURNING id""",
            row_id, attempts, lease_seconds)
        return claimed is not None

    async def reclaim_final(self, row_id: str, attempts: int, lease_seconds: int) -> bool:
        """Take over an interrupted last attempt whose lease has expired.

        The compare-and-set is on the expired lease: a concurrent dispatcher's
        UPDATE re-reads the row after this one commits, sees the new lease and
        matches nothing."""
        claimed = await self._conn.fetchval(
            f"""UPDATE {self._table}
                   SET next_attempt_at = now() + make_interval(secs => $3)
                 WHERE id = $1::uuid AND attempts = $2 AND status = 'pending'
                   AND next_attempt_at <= now()
                RETURNING id""",
            row_id, attempts, lease_seconds)
        return claimed is not None

    async def mark_sent(self, row_id: str, attempts: int) -> None:
        await self._conn.execute(
            f"""UPDATE {self._table}
                   SET status = 'sent', sent_at = now(), last_error = NULL
                 WHERE id = $1::uuid AND attempts = $2""",
            row_id, attempts)

    async def mark_failed(self, row_id: str, attempts: int, error: str,
                          retry_seconds: int) -> None:
        await self._conn.execute(
            f"""UPDATE {self._table}
                   SET status = 'failed', last_error = left($3, 200),
                       next_attempt_at = now() + make_interval(secs => $4)
                 WHERE id = $1::uuid AND attempts = $2 AND status <> 'sent'""",
            row_id, attempts, error, retry_seconds)

    async def requeue(self, audit_id: str) -> bool:
        """rollout.md Repair: a `failed` row, or a last attempt left `pending`
        past its lease, gets a fresh set of attempts. A send still in flight
        (lease running) is left alone."""
        row = await self._conn.fetchval(
            f"""UPDATE {self._table}
                   SET status = 'pending', attempts = 0, next_attempt_at = now()
                 WHERE audit_id = $1::uuid
                   AND (status = 'failed'
                        OR (status = 'pending' AND attempts >= $2 AND next_attempt_at <= now()))
                RETURNING id""",
            audit_id, MAX_ATTEMPTS)
        return row is not None

