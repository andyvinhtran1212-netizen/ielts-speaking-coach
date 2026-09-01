from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parents[1] / "migrations"


def test_completion_token_is_a_new_forward_migration_after_213():
    """An environment that already recorded 213 must still receive the column."""
    applied_213 = (MIGRATIONS / "213_mock_collection_flush_ack.sql").read_text(
        encoding="utf-8"
    )
    pending_214 = (
        MIGRATIONS / "214_mock_collection_sweep_completion.sql"
    ).read_text(encoding="utf-8")

    assert "collection_sweep_completed_section" not in applied_213
    assert "ADD COLUMN IF NOT EXISTS collection_sweep_completed_section" in pending_214
    assert "mock_exams_collection_sweep_completed_section_check" in pending_214
