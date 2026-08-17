"""Static safety contract for the staging-only Reading Gate E fixture."""

from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "seed_staging_reading_coexistence.py"
).read_text()


def test_seed_is_pinned_to_staging_and_rejects_production() -> None:
    assert 'STAGING_REF = "zjphffoujxkpltixsbzj"' in SOURCE
    assert 'PRODUCTION_REF = "huwsmtubwulikhlmcirx"' in SOURCE
    assert "hostname != expected" in SOURCE
    assert "REFUSED: .env.staging points at production" in SOURCE
    assert 'os.environ.get("STAGING_ENV_FILE"' in SOURCE


def test_seed_is_idempotent_and_has_three_distinct_published_tests() -> None:
    assert SOURCE.count('"test_id": "GATE-E-READING-COEXISTENCE-') == 3
    assert SOURCE.count('"test_uuid":') == 3
    assert 'on_conflict="id"' in SOURCE
    assert '"status": "published"' in SOURCE
    assert '"test_type": "full"' in SOURCE
    assert '"exam_only": False' in SOURCE


def test_seed_refuses_to_take_over_colliding_fixture_identity() -> None:
    assert "def _assert_identity" in SOURCE
    assert "fixture identity collision" in SOURCE
    assert "fixture UUID collision" in SOURCE
    assert '.eq("id", expected_id)' in SOURCE
