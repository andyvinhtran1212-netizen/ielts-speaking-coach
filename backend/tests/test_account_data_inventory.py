"""ACCOUNTDATA-0100 FR-006: every user-pointing column is classified."""

from __future__ import annotations

from scripts import account_data_inventory_scan as scan_mod
from services import account_data_inventory as inv


def _scanned() -> set[tuple[str, str]]:
    return {(c.table, c.column) for c in scan_mod.scan()}


def test_every_user_pointing_column_is_classified():
    missing = sorted(_scanned() - {(e.table, e.column) for e in inv.INVENTORY})
    assert not missing, (
        "user-pointing columns without an ACCOUNTDATA-0100 classification "
        f"(add them to services/account_data_inventory.py): {missing}"
    )


def test_no_inventory_entry_for_a_column_that_is_gone():
    known = _scanned() | set(inv.PRE_MIGRATION)
    stale = sorted((e.table, e.column) for e in inv.INVENTORY if (e.table, e.column) not in known)
    assert not stale, f"inventory names columns no migration declares: {stale}"


def test_upcoming_entries_are_not_in_migrations_yet():
    landed = sorted((e.table, e.column) for e in inv.UPCOMING if (e.table, e.column) in _scanned())
    assert not landed, f"move these from UPCOMING into the inventory: {landed}"


def test_entries_are_unique_and_actions_valid():
    keys = [(e.table, e.column) for e in inv.INVENTORY]
    assert len(keys) == len(set(keys))
    assert {e.action for e in inv.INVENTORY + inv.UPCOMING} <= inv.ACTIONS
    assert all(e.storage in inv.BUCKETS for e in inv.INVENTORY if e.storage)


def test_pre_migration_columns_are_classified():
    for table, column in inv.PRE_MIGRATION:
        assert inv.action_for(table, column) is not None


def test_spec_minimum_list_0055_c2():
    expect = {
        ("learner_email_outbox", "user_id"): "delete",
        ("credit_cluster_members", "user_id"): "delete",
        ("users", "id"): "anonymize",
        ("enrollment_orders", "user_id"): "keep",
        ("entitlements", "user_id"): "keep",
        ("credit_ledger", "user_id"): "keep",
        ("credit_reservations", "user_id"): "keep",
        ("credit_covered_requests", "user_id"): "keep",  # open question 6: keep
        ("students", "user_id"): "anonymize",  # open question 5
        ("access_codes", "used_by"): "keep",  # immutable redemption truth
        ("user_code_assignments", "user_id"): "keep",
    }
    for (table, column), action in expect.items():
        assert inv.action_for(table, column) == action, (table, column)
    notes = [e for e in inv.INVENTORY if e.table == "learner_care_notes"]
    assert notes and all(e.action == "delete" and not e.export for e in notes)  # Q7


def test_mock_invitations_are_removed_and_settlement_evidence_is_retained():
    for column in ("student_id", "user_id"):
        entry = inv.entry_for("mock_exam_audiences", column)
        assert entry.action == "delete" and not entry.export
    settlement = inv.entry_for("credit_attempt_outcomes", "user_id")
    assert settlement.action == "keep" and not settlement.export


def test_storage_is_only_audio_and_exports():
    assert inv.BUCKETS == {"audio-responses", "account-exports"}
    assert inv.entry_for("sessions", "user_id").storage == "audio-responses"


# ── scanner behaviour (negative cases) ──────────────────────────────────


def _cols(sql_by_name):
    return {(c.table, c.column) for c in scan_mod.scan_text(sql_by_name)}


def test_scanner_finds_each_rule():
    got = _cols({
        "900_x.sql": """
            CREATE TABLE IF NOT EXISTS public.new_attempts (
              id uuid PRIMARY KEY,
              user_id uuid NOT NULL,
              owner uuid REFERENCES auth.users(id),
              coach uuid REFERENCES public.students (id) ON DELETE CASCADE,
              reviewer_user_id uuid,
              learner_id uuid, student_id uuid, used_by uuid,
              p_user_id_note text,
              CONSTRAINT fk_x FOREIGN KEY (other) REFERENCES users(id)
            );
            ALTER TABLE new_attempts ADD COLUMN IF NOT EXISTS late_user_id uuid,
              ADD COLUMN plain text;
        """,
    })
    assert got == {
        ("new_attempts", c)
        for c in ("user_id", "owner", "coach", "reviewer_user_id", "learner_id",
                  "student_id", "used_by", "other", "late_user_id")
    }


def test_scanner_ignores_comments_strings_params_and_other_schemas():
    got = _cols({
        "900_x.sql": """
            -- CREATE TABLE ghost (user_id uuid);
            /* CREATE TABLE ghost2 (user_id uuid); */
            CREATE TABLE auth.sidecar (user_id uuid);
            CREATE OR REPLACE FUNCTION f(p_user_id uuid) RETURNS void AS $$
              BEGIN PERFORM 'CREATE TABLE ghost3 (user_id uuid)'; END $$ LANGUAGE plpgsql;
        """,
    })
    assert got == set()


def test_scanner_replays_drops_and_renames():
    got = _cols({
        "900_a.sql": "CREATE TABLE a (user_id uuid, b_user_id uuid); CREATE TABLE gone (user_id uuid);",
        "901_b.sql": "ALTER TABLE a DROP COLUMN IF EXISTS b_user_id; DROP TABLE IF EXISTS gone;"
                     "ALTER TABLE a RENAME COLUMN user_id TO learner_id;",
    })
    assert got == {("a", "learner_id")}


def test_unclassified_new_column_would_fail(monkeypatch):
    real = scan_mod.scan()
    extra = scan_mod.UserColumn("brand_new_attempts", "student_id", "999_x.sql", "name")
    monkeypatch.setattr(scan_mod, "scan", lambda *a, **k: real + [extra])
    try:
        test_every_user_pointing_column_is_classified()
    except AssertionError as exc:
        assert "brand_new_attempts" in str(exc)
    else:  # pragma: no cover
        raise AssertionError("an unclassified column must fail FR-006")


def _migration_text() -> str:
    return "\n".join(p.read_text(encoding="utf-8") for p in scan_mod.migration_files())


def test_child_tables_hang_off_deleted_parents_and_exist():
    """T001 gate 2: every child is a real table under a ``delete`` parent."""
    text = _migration_text()
    delete_tables = {e.table for e in inv.INVENTORY if e.action == "delete"}
    for child, parent in inv.CHILD_TABLES.items():
        assert parent in delete_tables, (child, parent)
        assert f"public.{child}" in text or f"TABLE {child}" in text or f"EXISTS {child}" in text, child
        own = [e for e in inv.INVENTORY if e.table == child and e.action not in ("staff_actor", "staff_only")]
        assert not own, f"{child} has its own learner column: {own}"


def test_text_columns_and_json_paths_are_valid():
    text = _migration_text()
    for col in inv.TEXT_COLUMNS:
        assert col.action in inv.ACTIONS and col.column in text, col
    keys = [(c.table, c.column) for c in inv.TEXT_COLUMNS]
    assert len(keys) == len(set(keys))
    assert inv.TEXT_COLUMNS[0] == inv.TextColumn(
        "enrollment_orders", "learner_note", "anonymize", inv.TEXT_COLUMNS[0].note)
    for path in inv.JSON_PATHS:
        assert path.action in inv.ACTIONS, path
