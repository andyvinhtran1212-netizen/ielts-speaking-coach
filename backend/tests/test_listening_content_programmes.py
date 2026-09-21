from __future__ import annotations

import hashlib
import io
import wave
from pathlib import Path

import pytest

from services import listening_package_import as importer
from services import listening_test_grader as grader


def _wav(path: Path, *, seconds: float, rate: int = 24_000) -> None:
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x01\x00" * frames)


@pytest.mark.parametrize("stimulus_count", [1, 3, 4, 10, 15])
def test_deterministic_assembly_preserves_order_and_gap(
    tmp_path: Path, stimulus_count: int,
):
    paths = []
    for index in range(stimulus_count):
        path = tmp_path / f"{index}.wav"
        _wav(path, seconds=1.0)
        paths.append(path)
    one, offsets_one = importer.assemble_form_audio(paths)
    two, offsets_two = importer.assemble_form_audio(paths)
    assert one == two
    assert hashlib.sha256(one).hexdigest() == hashlib.sha256(two).hexdigest()
    assert offsets_one == offsets_two
    assert offsets_one[0] == {"start": 0.0, "end": 1.0}
    assert offsets_one[-1] == {
        "start": (stimulus_count - 1) * 1.5,
        "end": (stimulus_count - 1) * 1.5 + 1.0,
    }
    with wave.open(io.BytesIO(one), "rb") as result:
        assert (result.getnchannels(), result.getsampwidth(), result.getframerate()) == (1, 2, 24_000)
        expected_seconds = stimulus_count + max(0, stimulus_count - 1) * 0.5
        assert result.getnframes() == int(expected_seconds * 24_000)


def test_assembly_rejects_noncanonical_audio(tmp_path: Path):
    invalid = tmp_path / "invalid.wav"
    _wav(invalid, seconds=1.0, rate=16_000)
    with pytest.raises(importer.PackageValidationError, match="PCM16 mono 24kHz"):
        importer.assemble_form_audio([invalid])


def test_generated_test_id_is_idempotent_within_package_and_namespaced_across_revisions():
    first = importer._stable_test_id("general-listening-v1", "lesson-1-form-a")
    retry = importer._stable_test_id("general-listening-v1", "lesson-1-form-a")
    revision = importer._stable_test_id("general-listening-v2", "lesson-1-form-a")

    assert first == retry
    assert first != revision
    assert len(first) <= 53


@pytest.mark.parametrize("raw", ["../secret.json", "/absolute.json", "a\\b.json", "./a.json"])
def test_declared_paths_fail_closed_on_traversal(raw: str):
    with pytest.raises(importer.PackageValidationError):
        importer._safe_relative_path(raw, label="test")


def test_svg_validation_accepts_static_and_rejects_active_content(tmp_path: Path):
    safe = tmp_path / "safe.svg"
    safe.write_text('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>')
    importer._validate_svg(safe)

    active = tmp_path / "active.svg"
    active.write_text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    with pytest.raises(importer.PackageValidationError, match="active content"):
        importer._validate_svg(active)

    remote = tmp_path / "remote.svg"
    remote.write_text('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.test/x"/></svg>')
    with pytest.raises(importer.PackageValidationError, match="external reference"):
        importer._validate_svg(remote)


def test_report_only_grading_separates_checked_unscored_and_blank():
    exercise_rows = [{"payload": {
        "variant": "programme_form_v1",
        "questions": [
            {"q_num": 1, "source_item_id": "a", "response_type": "single_choice"},
            {"q_num": 2, "source_item_id": "b", "response_type": "multiple_choice"},
            {"q_num": 3, "source_item_id": "c", "response_type": "short_answer"},
            {"q_num": 4, "source_item_id": "d", "response_type": "written"},
        ],
        "answers": [
            {"q_num": 1, "answers": ["B"]},
            {"q_num": 2, "answers": ["B", "C"]},
        ],
        "self_review": {"3": {"reference_answers": ["sample"]}},
        "audio_windows": {"1": {"start": 0, "end": 2}},
        "controlled_transcripts": {"s1": [{"text": "protected"}]},
    }}]
    result = grader.grade_report_only_attempt([
        {"q_num": 1, "user_answer": "b"},
        {"q_num": 2, "user_answer": "C, B"},
        {"q_num": 3, "user_answer": "my response"},
        {"q_num": 4, "user_answer": ""},
    ], exercise_rows)
    assert result["checked_count"] == 2
    assert result["correct_count"] == 2
    assert result["unscored_count"] == 1
    assert result["blank_count"] == 1
    assert result["technical_error_count"] == 0
    assert result["completion_count"] == 3
    assert [item["state"] for item in result["per_question"]] == [
        "checked", "checked", "unscored", "blank",
    ]
    assert "score" not in result and "band_estimate" not in result


def test_report_only_grading_marks_missing_objective_key_as_technical_error():
    result = grader.grade_report_only_attempt(
        [{"q_num": 1, "user_answer": "A"}],
        [{"payload": {
            "variant": "programme_form_v1",
            "questions": [{"q_num": 1, "response_type": "single_choice"}],
            "answers": [],
        }}],
    )
    assert result["checked_count"] == 0
    assert result["technical_error_count"] == 1
    assert result["per_question"][0]["state"] == "technical_error"


def test_report_only_multiple_choice_requires_exact_set():
    rows = [{"payload": {
        "variant": "programme_form_v1",
        "questions": [{"q_num": 1, "response_type": "multiple_choice"}],
        "answers": [{"q_num": 1, "answers": ["A", "C"]}],
    }}]
    subset = grader.grade_report_only_attempt(
        [{"q_num": 1, "user_answer": "A"}], rows,
    )
    exact = grader.grade_report_only_attempt(
        [{"q_num": 1, "user_answer": "c, a"}], rows,
    )
    assert subset["per_question"][0]["correct"] is False
    assert exact["per_question"][0]["correct"] is True


def test_student_payload_strips_all_programme_review_material():
    rows = [{"payload": {
        "variant": "programme_form_v1",
        "questions": [{"q_num": 1, "prompt": "Safe"}],
        "answers": [{"q_num": 1, "answers": ["B"]}],
        "solutions": {"1": {"expected": ["B"]}},
        "self_review": {"1": {"reference_answers": ["secret"]}},
        "audio_windows": {"1": {"start": 1, "end": 2}},
        "controlled_transcripts": {"s": [{"text": "secret"}]},
    }}]
    payload = grader.strip_answer_keys(rows)[0]["payload"]
    assert payload["questions"] == [{"q_num": 1, "prompt": "Safe"}]
    for key in ("answers", "solutions", "self_review", "audio_windows", "controlled_transcripts"):
        assert key not in payload


def test_migration_pins_atomic_and_report_only_invariants():
    sql = (Path(__file__).parents[1] / "migrations" / "295_listening_content_programmes.sql").read_text()
    assert "import_listening_content_package_atomic" in sql
    assert "pg_advisory_xact_lock" in sql
    assert "listening_attempts_report_only_result_check" in sql
    assert "score IS NULL AND band_estimate IS NULL" in sql
    assert "ENABLE ROW LEVEL SECURITY" in sql
    assert "FROM PUBLIC, anon, authenticated" in sql
    assert "uq_listening_content_packages_published_programme" in sql
    assert "listening_package_reconciliation_required" in sql
    assert "REVOKE ALL ON TABLE public.listening_exercises" in sql


class _Rows:
    def __init__(self, data):
        self.data = data

    def execute(self):
        return self


class _StorageQuery:
    def __init__(self, rows):
        self.rows = list(rows)
        self.filters = []

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def limit(self, _value):
        return self

    def execute(self):
        return _Rows([
            dict(row) for row in self.rows
            if all(row.get(key) == value for key, value in self.filters)
        ])


class _AssetBucket:
    def __init__(self, objects):
        self.objects = objects

    def download(self, path):
        if path not in self.objects:
            raise FileNotFoundError(path)
        return self.objects[path]


class _AssetStorage:
    def __init__(self, objects):
        self.objects = objects

    def from_(self, _bucket_name):
        return _AssetBucket(self.objects)


class _PublishDb:
    def __init__(self, tables, objects):
        self.tables = tables
        self.storage = _AssetStorage(objects)
        self.rpc_calls = []

    def table(self, name):
        return _StorageQuery(self.tables.get(name, []))

    def rpc(self, name, params):
        self.rpc_calls.append((name, params))
        status = "published" if params["p_action"] == "publish" else "archived"
        return _Rows([{"package_uuid": "package-uuid", "status": status, "forms_changed": 1}])


def _publish_db(*, include_audio=True, corrupt_audio=False):
    audio = b"canonical programme audio"
    visual = b"<svg/>"
    manifest = "a" * 64
    audio_path = f"packages/pkg/{manifest}/forms/form-1/audio.wav"
    visual_path = f"packages/pkg/{manifest}/visuals/map.svg"
    objects = {visual_path: visual}
    if include_audio:
        objects[audio_path] = b"corrupt" if corrupt_audio else audio
    tables = {
        "listening_content_packages": [{
            "id": "package-uuid", "package_id": "pkg",
            "manifest_sha256": manifest,
        }],
        "listening_tests": [{
            "content_package_id": "package-uuid",
            "full_audio_storage_path": audio_path,
            "full_audio_size_bytes": len(audio),
            "metadata": {"derived_audio_sha256": hashlib.sha256(audio).hexdigest()},
        }],
        "listening_package_stimuli": [{
            "package_id": "package-uuid",
            "metadata": {
                "visual_source_path": "visuals/map.svg",
                "visual_storage_path": visual_path,
                "visual_sha256": hashlib.sha256(visual).hexdigest(),
            },
        }],
    }
    return _PublishDb(tables, objects), manifest


def test_publish_verifies_every_storage_asset_before_status_rpc():
    db, manifest = _publish_db()
    result = importer.set_package_status(
        db,
        package_id="pkg",
        manifest_sha256=manifest,
        action="publish",
        actor=None,
        bucket_name="listening-audio",
    )
    assert result["status"] == "published"
    assert [name for name, _params in db.rpc_calls] == [
        "set_listening_content_package_status",
    ]


@pytest.mark.parametrize("missing,corrupt", [(True, False), (False, True)])
def test_publish_fails_closed_before_rpc_when_form_audio_is_missing_or_corrupt(
    missing: bool, corrupt: bool,
):
    db, manifest = _publish_db(include_audio=not missing, corrupt_audio=corrupt)
    with pytest.raises(importer.PackageValidationError, match="Storage object"):
        importer.set_package_status(
            db,
            package_id="pkg",
            manifest_sha256=manifest,
            action="publish",
            actor=None,
            bucket_name="listening-audio",
        )
    assert db.rpc_calls == []
