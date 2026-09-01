"""Static safety contract for the staging-only Listening Gate E fixture."""

from pathlib import Path


SOURCE = (
    Path(__file__).resolve().parents[1]
    / "scripts"
    / "seed_staging_listening_coexistence.py"
).read_text()


def test_seed_is_pinned_to_staging_and_rejects_production() -> None:
    assert 'STAGING_REF = "zjphffoujxkpltixsbzj"' in SOURCE
    assert 'PRODUCTION_REF = "huwsmtubwulikhlmcirx"' in SOURCE
    assert "hostname != expected" in SOURCE
    assert "REFUSED: .env.staging points at production" in SOURCE
    assert 'os.environ.get("STAGING_ENV_FILE"' in SOURCE


def test_seed_is_idempotent_and_has_four_distinct_published_tests() -> None:
    assert SOURCE.count('"test_id": "GATE-E-LISTENING-COEXISTENCE-') == 4
    assert SOURCE.count('"test_uuid":') == 4
    assert SOURCE.count('"content_uuid":') == 4
    assert SOURCE.count('"exercise_uuid":') == 4
    assert '"x-upsert": "true"' in SOURCE
    assert 'on_conflict="id"' in SOURCE
    assert '"status": "published"' in SOURCE
    assert '"test_type": "full"' in SOURCE
    assert '"exam_only": False' in SOURCE


def test_seed_refuses_to_take_over_colliding_fixture_identity() -> None:
    assert "def _assert_identity" in SOURCE
    assert "fixture identity collision" in SOURCE
    assert "fixture UUID collision" in SOURCE
    assert '.eq("id", expected_id)' in SOURCE


def test_seed_uploads_browser_loadable_audio_and_player_payload() -> None:
    assert 'AUDIO_BUCKET = "listening-audio"' in SOURCE
    assert '"content-type": "audio/wav"' in SOURCE
    assert "def _silent_wav" in SOURCE
    assert '"template_kind": "form_completion"' in SOURCE
    assert '"questions": [{"q_num": 1' in SOURCE
    assert '"answers": [{"q_num": 1' in SOURCE
