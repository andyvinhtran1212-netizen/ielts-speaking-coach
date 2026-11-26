"""COURSEACCESS-0055 G04-T04 — scripts/enrollment_sweep.py (plan 5.11)."""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from postgrest.exceptions import APIError

from scripts import enrollment_sweep as sweep
from services import enrollment_orders as eo
from services import learner_email
from tests._commerce_fake_db import FakeDB

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def world(monkeypatch):
    db = FakeDB(handlers={
        "fn_enrollment_orders_expire": lambda p: {"expired": 2},
        "fn_enrollment_order_pay_reminders": lambda p: {"queued": 1},
        "fn_credit_expire_reservations": lambda p: {"expired": 3},
        "fn_credit_expire_entitlements": lambda p: {"closed": 1, "carried": 0, "carry_expired": 0},
        "fn_course_open_alerts_enqueue": lambda p: 0,  # step 5, G04-T17
    })
    monkeypatch.setattr(eo, "supabase_admin", db)
    mail = []

    async def dispatch(limit=50, **kw):
        mail.append(limit)
        return learner_email.DispatchSummary()

    monkeypatch.setattr(learner_email, "dispatch_due", dispatch)
    monkeypatch.setattr(eo.settings, "ENROLL_PAY_REMINDER_HOURS_BEFORE", 24)
    monkeypatch.setattr(eo.settings, "ENROLL_PAY_REMINDER_MIN_AGE_HOURS", 6)
    return {"db": db, "mail": mail}


def test_steps_run_in_order_with_config_values(world, caplog):
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 0
    names = [n for n, _ in world["db"].rpcs]
    assert names == ["fn_enrollment_orders_expire", "fn_enrollment_order_pay_reminders",
                     "fn_credit_expire_reservations", "fn_credit_expire_entitlements",
                     "fn_course_open_alerts_enqueue"]
    reminders = world["db"].rpcs[1][1]
    assert (reminders["p_hours_before"], reminders["p_min_age_hours"]) == (24, 6)
    lifecycle = world["db"].rpcs[3][1]
    assert lifecycle["p_user_id"] is None
    assert lifecycle["p_carry_percent"] == eo.settings.CREDIT_CARRY_PERCENT
    assert lifecycle["p_carry_valid_days"] == eo.settings.CREDIT_CARRY_VALID_DAYS
    assert world["mail"] == [50]
    assert "[enroll] expired count=2" in caplog.text and "[enroll] pay_reminder queued=1" in caplog.text


def test_a_failing_step_does_not_stop_the_others(world):
    world["db"].handlers["fn_enrollment_orders_expire"] = lambda p: RuntimeError("down")
    assert sweep.run() == 1
    assert len(world["db"].rpcs) == 5 and world["mail"] == [50]


def test_missing_lifecycle_function_is_skipped_not_failed(world, caplog):
    world["db"].handlers["fn_credit_expire_entitlements"] = \
        lambda p: APIError({"code": "PGRST202", "message": "Could not find the function"})
    with caplog.at_level(logging.INFO):
        assert sweep.run() == 0
    assert "[credits] lifecycle skipped=no_function" in caplog.text


def test_no_mail_skips_the_dispatch(world):
    assert sweep.run(no_mail=True) == 0
    assert world["mail"] == []


def test_unconfigured_mail_fails_the_run(world, monkeypatch):
    async def dispatch(limit=50, **kw):
        return learner_email.DispatchSummary(unconfigured=("RESEND_API_KEY",))

    monkeypatch.setattr(learner_email, "dispatch_due", dispatch)
    assert sweep.run() == 1


def test_railway_cron_file():
    config = json.loads((ROOT / "railway.enrollment-sweep.json").read_text())
    assert config["deploy"]["startCommand"] == "python -m scripts.enrollment_sweep"
    assert config["deploy"]["cronSchedule"] == "*/5 * * * *"
    assert config["deploy"]["restartPolicyType"] == "NEVER"
