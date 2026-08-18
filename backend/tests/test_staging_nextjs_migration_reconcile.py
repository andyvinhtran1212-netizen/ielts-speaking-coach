"""Contracts for the fail-closed staging 215-221 ledger reconciliation."""

import importlib.util
from pathlib import Path
import subprocess

import pytest


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPT_PATH = BACKEND_ROOT / "scripts" / "reconcile_staging_nextjs_migrations.py"
VERIFY_PATH = BACKEND_ROOT / "scripts" / "verify_staging_nextjs_reconcile.sql"

_SPEC = importlib.util.spec_from_file_location("staging_nextjs_reconcile", SCRIPT_PATH)
assert _SPEC and _SPEC.loader
RECONCILE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(RECONCILE)


def _staging_url() -> str:
    return (
        "postgresql://postgres."
        f"{RECONCILE.STAGING_PROJECT_REF}:secret@"
        f"{next(iter(RECONCILE.STAGING_POOLER_HOSTS))}/postgres"
    )


def test_manifest_is_fixed_and_covers_only_the_audited_gap():
    assert RECONCILE.AUDITED_HISTORY == (
        "215_speaking_session_renderer_affinity.sql",
        "216_version_session_renderer_affinity_create.sql",
        "217_backfill_renderer_affinity_migration_gap.sql",
        "218_reading_attempt_renderer_affinity.sql",
        "220_dictation_attempt_affinity.sql",
        "221_writing_assignment_renderer_affinity.sql",
    )
    assert RECONCILE.REQUIRED_EXISTING[-1] == (
        "219_listening_attempt_renderer_affinity.sql"
    )
    assert len(RECONCILE.REQUIRED_EXISTING) == 11
    assert len(RECONCILE.RECONCILED_SCOPE) == 7
    source = SCRIPT_PATH.read_text(encoding="utf-8")
    assert "glob(" not in source
    assert "iterdir(" not in source
    assert "--baseline" not in source


def test_reconciler_refuses_every_non_staging_target(monkeypatch):
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: pytest.fail("must refuse before database access"),
    )
    with pytest.raises(RECONCILE.ReconciliationError, match="pinned staging"):
        RECONCILE.reconcile(
            "postgresql://postgres:secret@production.example/postgres",
            dry_run=False,
        )


def test_staging_ref_in_password_cannot_bypass_target_pin(monkeypatch):
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: pytest.fail("must refuse before database access"),
    )
    spoofed = (
        "postgresql://postgres:password-"
        f"{RECONCILE.STAGING_PROJECT_REF}@production.example/postgres"
    )
    with pytest.raises(RECONCILE.ReconciliationError, match="pinned staging"):
        RECONCILE.reconcile(spoofed, dry_run=True)


def test_staging_pooler_username_on_arbitrary_host_is_rejected(monkeypatch):
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: pytest.fail("must refuse before database access"),
    )
    spoofed = (
        "postgresql://postgres."
        f"{RECONCILE.STAGING_PROJECT_REF}:secret@production.example/postgres"
    )
    with pytest.raises(RECONCILE.ReconciliationError, match="pinned staging"):
        RECONCILE.reconcile(spoofed, dry_run=True)


def test_direct_and_pooler_staging_url_shapes_are_accepted():
    RECONCILE._assert_staging_target(_staging_url())
    RECONCILE._assert_staging_target(
        "postgresql://postgres:secret@db."
        f"{RECONCILE.STAGING_PROJECT_REF}.supabase.co/postgres"
    )


def test_required_existing_ledger_rows_fail_closed(monkeypatch):
    monkeypatch.setattr(RECONCILE, "_read_ledger", lambda _url: set())
    monkeypatch.setattr(
        RECONCILE,
        "_verify_and_record_locked",
        lambda *_args, **_kwargs: pytest.fail("must not reconcile wrong target state"),
    )
    with pytest.raises(RECONCILE.ReconciliationError, match="required existing"):
        RECONCILE.reconcile(_staging_url(), dry_run=False)


def test_dry_run_executes_read_only_verifier_and_never_writes(monkeypatch, capsys):
    events = []
    monkeypatch.setattr(
        RECONCILE,
        "_read_ledger",
        lambda _url: set(RECONCILE.REQUIRED_EXISTING),
    )
    monkeypatch.setattr(
        RECONCILE,
        "_verify_read_only",
        lambda _url, *, require_gap_closed: events.append(
            ("verify", require_gap_closed)
        ),
    )
    monkeypatch.setattr(
        RECONCILE,
        "_verify_and_record_locked",
        lambda *_args, **_kwargs: pytest.fail("dry-run must not write"),
    )

    RECONCILE.reconcile(_staging_url(), dry_run=True)

    assert events == [("verify", True)]
    output = capsys.readouterr().out
    for migration in RECONCILE.AUDITED_HISTORY:
        assert migration in output


def test_locked_reconciliation_verifies_then_records_under_shared_lock(monkeypatch):
    calls = []

    def capture(url, *arguments, capture_output=False):
        calls.append((url, arguments, capture_output))

    monkeypatch.setattr(RECONCILE, "_psql", capture)
    rows = RECONCILE.AUDITED_HISTORY[:2]
    RECONCILE._verify_and_record_locked(
        _staging_url(),
        filenames=rows,
        require_gap_closed=True,
    )

    assert len(calls) == 1
    arguments = calls[0][1]
    lock = "SELECT pg_advisory_lock(173204, 1)"
    unlock = "SELECT pg_advisory_unlock(173204, 1)"
    verify_index = arguments.index(str(VERIFY_PATH))
    ledger_index = next(
        index
        for index, value in enumerate(arguments)
        if isinstance(value, str)
        and value.startswith("INSERT INTO public._schema_migrations")
    )
    assert (
        arguments.index(lock)
        < verify_index
        < ledger_index
        < arguments.index(unlock)
    )
    assert "REQUIRE_GAP_CLOSED=1" in arguments
    assert all(row in arguments[ledger_index] for row in rows)


def test_gap_backfill_check_is_disabled_after_217_is_recorded(monkeypatch):
    ledger = set(RECONCILE.REQUIRED_EXISTING) | set(RECONCILE.AUDITED_HISTORY)
    events = []
    monkeypatch.setattr(RECONCILE, "_read_ledger", lambda _url: ledger)
    monkeypatch.setattr(
        RECONCILE,
        "_verify_read_only",
        lambda _url, *, require_gap_closed: events.append(require_gap_closed),
    )
    monkeypatch.setattr(
        RECONCILE,
        "_standard_forward_dry_run",
        lambda _url: "----\nwould apply: 222_future.sql\n",
    )

    RECONCILE.reconcile(_staging_url(), dry_run=False)

    assert events == [False]


def test_post_reconcile_dry_run_rejects_any_215_221_replay():
    with pytest.raises(RECONCILE.ReconciliationError, match="would replay"):
        RECONCILE._assert_no_reconciled_replay(
            "would apply: 217_backfill_renderer_affinity_migration_gap.sql\n"
        )


def test_full_reconcile_closes_ledger_and_checks_forward_runner(monkeypatch, capsys):
    before = set(RECONCILE.REQUIRED_EXISTING)
    after = before | set(RECONCILE.AUDITED_HISTORY)
    ledger_reads = iter((before, after))
    events = []
    monkeypatch.setattr(RECONCILE, "_read_ledger", lambda _url: next(ledger_reads))

    def locked(_url, *, filenames, require_gap_closed):
        events.append((tuple(filenames), require_gap_closed))

    monkeypatch.setattr(RECONCILE, "_verify_and_record_locked", locked)
    monkeypatch.setattr(
        RECONCILE,
        "_standard_forward_dry_run",
        lambda _url: "----\nwould apply: 222_future.sql\n",
    )

    RECONCILE.reconcile(_staging_url(), dry_run=False)

    assert events == [(RECONCILE.AUDITED_HISTORY, True)]
    assert "reconciled: 6 ledger entries recorded" in capsys.readouterr().out


def test_main_never_logs_database_url_from_failed_subprocess(monkeypatch, capsys):
    sentinel = "never-print-this-password"
    database_url = (
        f"postgresql://postgres.{RECONCILE.STAGING_PROJECT_REF}:{sentinel}"
        "@pooler.example/postgres"
    )

    def fail(_url, *, dry_run):
        assert dry_run is False
        raise subprocess.CalledProcessError(
            17,
            ["psql", database_url, "-c", "SELECT 1"],
        )

    monkeypatch.delenv("DRY_RUN", raising=False)
    monkeypatch.setattr(RECONCILE, "reconcile", fail)

    assert RECONCILE.main(["reconcile_staging_nextjs_migrations.py", database_url]) == 1
    stderr = capsys.readouterr().err
    assert sentinel not in stderr
    assert database_url not in stderr
    assert "database command exited with status 17" in stderr


def test_verifier_pins_all_security_and_schema_contracts():
    source = VERIFY_PATH.read_text(encoding="utf-8")
    for anchor in (
        "'column-contract:' || expected_column.table_name",
        "'constraint-contract:' || expected_constraint.constraint_name",
        "fn_create_session_daily_capped_v3",
        "'function-contract:' || expected_function.function_name",
        "table-column-fingerprint:",
        "table-constraint-fingerprint:",
        "policy-contract:",
        "trigger-contract:",
        "data:speaking-gap-null",
        "has_function_privilege('service_role'",
        "aclexplode(",
        "convalidated",
        "indisvalid",
        "indisready",
        "relrowsecurity",
    ):
        assert anchor in source
    for body_hash in (
        "2f5b6519d526254965c8bfb529b213f7",
        "e46027336e1600d9c5d047a43c925745",
        "b4a4c894e90bcb2a32fd7bb259163ee3",
        "2842017df386c84b2e5238f775b69974",
        "85bb3019c78d7bfbacc654fb318417f2",
        "896b94c98cc824f176d62b10698c4a90",
        "3fd91fe4608ed893d6ce91137ba3c663",
        "ec67178c7a6ad9ec03d87270585ba61d",
    ):
        assert body_hash in source
