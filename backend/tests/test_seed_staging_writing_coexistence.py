"""Static safety contract for the staging-only Writing Gate E fixture."""

from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "seed_staging_writing_coexistence.py"
).read_text()


def test_seed_is_pinned_to_staging_and_rejects_production() -> None:
    assert 'STAGING_REF = "zjphffoujxkpltixsbzj"' in SOURCE
    assert 'PRODUCTION_REF = "huwsmtubwulikhlmcirx"' in SOURCE
    assert "hostname != expected" in SOURCE
    assert "REFUSED: .env.staging points at production" in SOURCE
    assert 'os.environ.get("STAGING_ENV_FILE"' in SOURCE


def test_seed_uses_only_the_synthetic_smoke_student_and_deterministic_ids() -> None:
    assert 'STUDENT_EMAIL = "e2e-student-smoke@staging-e2e.averlearning.com"' in SOURCE
    assert 'STUDENT_ID = "ee800001-0000-4000-8000-000000000001"' in SOURCE
    assert 'STUDENT_CODE = "GATE-E-WRITING"' in SOURCE
    assert 'PROMPT_ID = "ee700001-0000-4000-8000-000000000001"' in SOURCE
    assert 'ASSIGNMENT_ID = "ee600001-0000-4000-8000-000000000001"' in SOURCE
    assert 'sb.table("students").insert(' in SOURCE
    assert "expected exactly one" in SOURCE


def test_seed_is_idempotent_without_resetting_assignment_state_or_affinity() -> None:
    assert 'on_conflict="id"' in SOURCE
    assert 'sb.table("writing_assignments").insert(' in SOURCE
    assert 'sb.table("writing_assignments").upsert(' not in SOURCE
    assert "preserved" in SOURCE
    assert '"renderer_affinity": None' not in SOURCE
    assert '"status": "pending"' in SOURCE
    assert 'row.get("status") not in ("pending", "in_progress")' in SOURCE


def test_seed_refuses_natural_key_and_uuid_collisions() -> None:
    assert "synthetic user belongs to another student profile" in SOURCE
    assert "fixture student code belongs to another profile" in SOURCE
    assert "fixture student UUID belongs to unrelated state" in SOURCE
    assert "fixture title belongs to another prompt" in SOURCE
    assert "prompt UUID belongs to unrelated content" in SOURCE
    assert "anchor name belongs to another assignment" in SOURCE
    assert "assignment UUID belongs to unrelated state" in SOURCE
