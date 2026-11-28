"""Enrollment sweep (COURSEACCESS-0055 plan 5.11, G04-T04).

Runs every 5 minutes as its own Railway cron service
(``backend/railway.enrollment-sweep.json``; creating the service is Andy's step):

    python -m scripts.enrollment_sweep             # one run
    python -m scripts.enrollment_sweep --no-mail   # staging: skip step 7

Steps run in order and independently: a failing step is logged and the next
one still runs; any failure makes the exit code non-zero.

1. ``fn_enrollment_orders_expire``: awaiting_transfer orders past ``pay_by``.
2. ``fn_enrollment_order_pay_reminders``: queue the one reminder per order.
3. ``fn_credit_expire_reservations``: open holds past their TTL.
4. ``fn_credit_expire_entitlements``: close lapsed credit books, carry and
   lapse carried credits (migration 385, G04-T12). Until 385 exists the
   function is missing and the step is skipped with a log line.
5. ``fn_course_open_alerts_enqueue``: queue one ``course_open_alert`` per
   "Báo cho tôi khi mở" sign-up of a course that is now open (G04-T17,
   FR-050). The function and its table belong to G05-T22; until that
   migration exists the step is skipped with a log line.
7. Learner outbox dispatch (``services.learner_email.dispatch_due``).
8. Account data (ACCOUNTDATA-0100, ``jobs.account_data_sweep``): erasure
   (dry-run until ``ACCOUNT_ERASURE_ENABLED``), export packages, export
   cleanup. Skipped with a log line until migrations 500 and 504 exist.
   With the flag on, this step erases for real: the cron needs no
   ``--erase``, which only the manual ``python -m jobs.account_data_sweep``
   takes.

Step 6 (login-event retention, G04-T16) is added by that task. Logs carry
counts only: no e-mail, name, amount or order code.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from typing import Callable

from config import settings
from services import enrollment_orders as eo
from services import learner_email

logger = logging.getLogger("enrollment_sweep")

BATCH = 500
OPEN_ALERT_BATCH = 200   # plan 5.11: fn_course_open_alerts_enqueue(200)
MAIL_BATCH = 50


def _rpc(name: str, params: dict) -> dict:
    return eo.rpc(name, params)


def expire_orders() -> None:
    result = _rpc("fn_enrollment_orders_expire", {"p_limit": BATCH})
    logger.info("[enroll] expired count=%s", int(result.get("expired") or 0))


def queue_reminders() -> None:
    cfg = eo.enrollment_config()
    result = _rpc("fn_enrollment_order_pay_reminders", {
        "p_hours_before": cfg.reminder_hours_before, "p_min_age_hours": cfg.reminder_min_age_hours,
        "p_limit": BATCH,
    })
    logger.info("[enroll] pay_reminder queued=%s", int(result.get("queued") or 0))


def expire_reservations() -> None:
    result = _rpc("fn_credit_expire_reservations", {"p_limit": BATCH})
    logger.info("[credits] lifecycle=reservations_expired count=%s", int(result.get("expired") or 0))


def expire_entitlements() -> None:
    try:
        result = _rpc("fn_credit_expire_entitlements", {
            "p_user_id": None, "p_limit": BATCH,
            "p_carry_percent": settings.CREDIT_CARRY_PERCENT,
            "p_carry_valid_days": settings.CREDIT_CARRY_VALID_DAYS,
        })
    except eo.OrdersUnavailable as exc:
        if eo.is_missing_function(exc):
            logger.info("[credits] lifecycle skipped=no_function")
            return
        raise
    for key, label in (("closed", "expired"), ("carried", "carried"), ("carry_expired", "carry_expired")):
        logger.info("[credits] lifecycle=%s count=%s", label, int(result.get(key) or 0))


def enqueue_open_alerts() -> None:
    try:
        queued = eo.rpc_count("fn_course_open_alerts_enqueue", {"p_limit": OPEN_ALERT_BATCH})
    except eo.OrdersUnavailable as exc:
        if eo.is_missing_function(exc):
            logger.info("[enroll] open_alerts skipped=no_function")
            return
        raise
    logger.info("[enroll] open_alerts queued=%s", queued)


def dispatch_mail() -> None:
    summary = asyncio.run(learner_email.dispatch_due(MAIL_BATCH))
    if not summary.ok:
        raise RuntimeError("learner mail transport unconfigured: " + ",".join(summary.unconfigured))


def account_data() -> None:
    from jobs import account_data_sweep
    account_data_sweep.run()


def run(*, no_mail: bool = False) -> int:
    steps: list[tuple[str, Callable[[], None]]] = [
        ("expire_orders", expire_orders),
        ("pay_reminders", queue_reminders),
        ("expire_reservations", expire_reservations),
        ("expire_entitlements", expire_entitlements),
        ("open_alerts", enqueue_open_alerts),
    ]
    if not no_mail:
        steps.append(("dispatch_mail", dispatch_mail))
    steps.append(("account_data", account_data))
    failed = 0
    for name, step in steps:
        try:
            step()
        except Exception as exc:
            failed += 1
            logger.error("[enroll] sweep step=%s failed: %s", name, type(exc).__name__)
    return 1 if failed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--no-mail", action="store_true", help="staging: do not send the learner outbox")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    return run(no_mail=args.no_mail)


if __name__ == "__main__":
    sys.exit(main())
