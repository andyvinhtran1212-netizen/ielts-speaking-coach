from __future__ import annotations

import hashlib
import io
import json
import sys
import wave
from pathlib import Path

import pytest

from services import listening_package_import as importer
from services import listening_test_grader as grader
from services.listening_editorial_validation import SOURCE_MANIFEST_LOCKS
from scripts import import_listening_content_package as import_command


def _wav(path: Path, *, seconds: float, rate: int = 24_000) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = int(seconds * rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(rate)
        handle.writeframes(b"\x01\x00" * frames)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")),
        encoding="utf-8",
    )


def _rebind_manifest(release_root: Path) -> None:
    package_root = release_root / "general" / "fixture"
    manifest_path = package_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    for relative in list(manifest["artifact_hashes"]):
        manifest["artifact_hashes"][relative] = hashlib.sha256(
            (package_root / relative).read_bytes()
        ).hexdigest()
    _write_json(manifest_path, manifest)
    manifest_sha = hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    release_index_path = release_root / "release-index.json"
    release_index = json.loads(release_index_path.read_text(encoding="utf-8"))
    release_index["programmes"][0]["packages"][0]["manifest_sha256"] = manifest_sha
    _write_json(release_index_path, release_index)


def _minimal_publish_ready_package(tmp_path: Path) -> Path:
    release_root = tmp_path / "02_PUBLISH_READY"
    package_root = release_root / "general" / "fixture"
    lesson_path = package_root / "learner" / "content" / "lessons" / "lesson-1.json"
    audio_path = package_root / "learner" / "audio" / "stimulus-1.wav"
    timing_path = package_root / "controlled-access" / "timing" / "stimulus-1.json"
    transcript_path = (
        package_root / "controlled-access" / "transcripts" / "stimulus-1.json"
    )
    protected_path = package_root / "protected" / "source-lessons" / "lesson-1.json"

    _write_json(package_root / "learner" / "index.json", {
        "title": "Fixture programme",
        "lesson_ids": ["lesson-1"],
    })
    _write_json(lesson_path, {
        "id": "lesson-1",
        "source_id": "lesson-1",
        "programme_id": "general-listening-practice",
        "title": "Lesson 1",
        "version": "1.0",
        "instructions": "Listen and choose.",
        "claim_policy": "report_only_no_band_cefr_mastery_or_full_progression_claim",
        "stimuli": [{
            "id": "stimulus-1",
            "audio": "learner/audio/stimulus-1.wav",
            "timing": "controlled-access/timing/stimulus-1.json",
            "controlled_transcript": "controlled-access/transcripts/stimulus-1.json",
            "kind": "dialogue",
            "purpose": "practice",
        }],
        "items": [{
            "id": "item-1",
            "response_type": "single_choice",
            "stimulus_id": "stimulus-1",
            "prompt": "Choose the answer.",
            "options": {"A": "One", "B": "Two"},
            "max_score": 1,
        }],
        "forms": [{
            "id": "form-1",
            "scoring_policy": "report_only",
            "item_ids": ["item-1"],
            "item_count": 1,
            "purpose": "practice",
            "replay_policy": "allowed",
            "support_policy": "available",
            "max_score": 1,
        }],
    })
    _wav(audio_path, seconds=1.0)
    _write_json(timing_path, {
        "stimulus_id": "stimulus-1",
        "segments": [{"id": "turn-1", "start": 0.0, "end": 0.5}],
    })
    _write_json(transcript_path, {
        "stimulus_id": "stimulus-1",
        "segments": [{"id": "turn-1", "start": 0.0, "end": 0.5, "text": "One"}],
    })
    _write_json(protected_path, {
        "forms": [{"id": "form-1", "stimulus_ids": ["stimulus-1"]}],
        "items": [{
            "id": "item-1",
            "evidence_turn_ids": ["turn-1"],
            "key": {"answers": ["A"], "rationale": "The speaker says one."},
        }],
    })

    artifact_paths = [
        "learner/index.json",
        "learner/content/lessons/lesson-1.json",
        "learner/audio/stimulus-1.wav",
        "controlled-access/timing/stimulus-1.json",
        "controlled-access/transcripts/stimulus-1.json",
        "protected/source-lessons/lesson-1.json",
    ]
    _write_json(package_root / "manifest.json", {
        "package_id": "fixture-general-v1",
        "programme_id": "general-listening-practice",
        "learner_ready": True,
        "date": "2026-09-21",
        "payload_boundaries": {
            "public": "learner/",
            "conditional_accessibility": "controlled-access/",
            "server_or_audit_only": "protected/",
        },
        "counts": {
            "lessons": 1,
            "forms": 1,
            "items": 1,
            "stimuli": 1,
            "audio": 1,
            "timing": 1,
            "visuals": 0,
        },
        "artifact_hashes": {
            relative: hashlib.sha256((package_root / relative).read_bytes()).hexdigest()
            for relative in artifact_paths
        },
    })
    manifest_sha = hashlib.sha256((package_root / "manifest.json").read_bytes()).hexdigest()
    _write_json(release_root / "release-index.json", {
        "learner_ready_packages": 1,
        "programmes": [{
            "id": "general-listening-practice",
            "path": "general",
            "packages": [{
                "package_id": "fixture-general-v1",
                "path": "fixture",
                "learner_ready": True,
                "manifest_sha256": manifest_sha,
            }],
        }],
    })
    return release_root


def _tree_hashes(root: Path) -> dict[str, str]:
    return {
        path.relative_to(root).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in root.rglob("*")
        if path.is_file()
    }


def _add_editorial_batch(release_root: Path, *, status: str = "approved_by_owner_not_published") -> None:
    package_root = release_root / "general" / "fixture"
    relative = "protected/editorial/translation-batch-01.json"
    _write_json(package_root / relative, {
        "batch_id": "LISTENING-0007-B01",
        "status": status,
        "source_package_id": "general-listening-practice-v1.0.0",
        "source_language": "en",
        "target_language": "vi",
        "items": [{
            "id": "item-1",
            "source_prompt": "Choose the answer.",
            "source_options": {"A": "One", "B": "Two"},
            "prompt_vi": "Chọn đáp án.",
            "options_vi": {"A": "Một", "B": "Hai"},
        }],
    })
    manifest_path = package_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["editorial_batches"] = [relative]
    manifest["editorial_source_package_id"] = "general-listening-practice-v1.0.0"
    manifest["editorial_source_manifest_sha256"] = SOURCE_MANIFEST_LOCKS["general-listening-practice-v1.0.0"]
    manifest["artifact_hashes"][relative] = "0" * 64
    _write_json(manifest_path, manifest)
    _rebind_manifest(release_root)


def test_new_revision_projects_only_manifest_bound_approved_text(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    _add_editorial_batch(release_root)
    before = _tree_hashes(release_root)
    plan = importer.build_import_plan(importer.discover_packages(release_root)[0])
    question = plan.forms[0]["exercise_payload"]["questions"][0]
    assert question["prompt"] == "Choose the answer."
    assert question["options"] == {"A": "One", "B": "Two"}
    assert question["editorial_translation"] == {
        "status": "approved",
        "source_item_id": "item-1",
        "source_language": "en",
        "target_language": "vi",
        "source_prompt": "Choose the answer.",
        "source_options": {"A": "One", "B": "Two"},
        "prompt": "Chọn đáp án.",
        "options": {"A": "Một", "B": "Hai"},
    }
    assert "answer" not in question["editorial_translation"]
    assert plan.forms[0]["exercise_payload"]["answers"][0]["answer"] == "A"
    assert plan.report["editorial_approved_items"] == 1
    assert _tree_hashes(release_root) == before


@pytest.mark.parametrize(("mutation", "message"), [
    ("pending", "chưa được duyệt"),
    ("source_prompt", "Source prompt mismatch"),
    ("option_key", "Target option keys"),
    ("source_hash", "source identity/hash"),
    ("in_place_source_package", "source identity/hash"),
    ("unlisted_path", "protected inventory"),
])
def test_new_revision_editorial_fail_closed(tmp_path: Path, mutation: str, message: str):
    release_root = _minimal_publish_ready_package(tmp_path)
    _add_editorial_batch(release_root, status=(
        "draft_pending_owner_review" if mutation == "pending" else "approved_by_owner_not_published"
    ))
    package_root = release_root / "general" / "fixture"
    batch_path = package_root / "protected/editorial/translation-batch-01.json"
    manifest_path = package_root / "manifest.json"
    if mutation in {"source_prompt", "option_key"}:
        batch = json.loads(batch_path.read_text(encoding="utf-8"))
        if mutation == "source_prompt":
            batch["items"][0]["source_prompt"] = "Changed."
        else:
            batch["items"][0]["options_vi"] = {"B": "Hai"}
        _write_json(batch_path, batch)
    elif mutation in {"source_hash", "in_place_source_package", "unlisted_path"}:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if mutation == "source_hash":
            manifest["editorial_source_manifest_sha256"] = "f" * 64
        elif mutation == "in_place_source_package":
            manifest["package_id"] = "general-listening-practice-v1.0.0"
            index_path = release_root / "release-index.json"
            index = json.loads(index_path.read_text(encoding="utf-8"))
            index["programmes"][0]["packages"][0]["package_id"] = manifest["package_id"]
            _write_json(index_path, index)
        else:
            manifest["editorial_batches"] = ["protected/source-lessons/lesson-1.json"]
        _write_json(manifest_path, manifest)
    _rebind_manifest(release_root)
    with pytest.raises(importer.PackageValidationError, match=message):
        importer.build_import_plan(importer.discover_packages(release_root)[0])


def test_publish_ready_package_passes_all_fr001_gates_and_dry_run_is_pure(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str],
):
    release_root = _minimal_publish_ready_package(tmp_path)
    unlisted = release_root / "general" / "not-in-release-index"
    unlisted.mkdir()
    (unlisted / "manifest.json").write_text("{}", encoding="utf-8")
    before = _tree_hashes(release_root)

    locations = importer.discover_packages(release_root)
    assert [location.package_id for location in locations] == ["fixture-general-v1"]
    plan = importer.build_import_plan(locations[0])

    assert plan.package["validation_summary"] == {
        "manifest_bound": True,
        "inventory_verified": True,
        "hashes_verified": 6,
        "learner_protected_boundary_verified": True,
    }
    assert plan.report["counts"] == {
        "lessons": 1,
        "forms": 1,
        "items": 1,
        "stimuli": 1,
        "audio": 1,
        "timing": 1,
        "visuals": 0,
        "timing_segments": 1,
    }
    assert plan.report["dry_run_mutations"] == 0
    assert _tree_hashes(release_root) == before

    monkeypatch.setattr(
        import_command, "_admin",
        lambda: pytest.fail("dry run must not initialize database or Storage"),
    )
    monkeypatch.setattr(
        sys, "argv",
        ["import-listening", "--release-root", str(release_root)],
    )
    assert import_command.main() == 0
    assert "DRY RUN PASS" in capsys.readouterr().out
    assert _tree_hashes(release_root) == before


@pytest.mark.parametrize(
    ("gate", "message"),
    [
        ("manifest_binding", "Manifest SHA-256"),
        ("inventory", "Inventory"),
        ("artifact_hash", "Artifact SHA-256"),
        ("boundary", "payload_boundaries"),
        ("protected_leak", "protected keys"),
        ("media_format", "PCM16 mono 24kHz"),
        ("timing_bounds", "Timing bounds"),
        ("declared_counts", "Manifest counts mismatch"),
    ],
)
def test_publish_ready_package_fails_closed_for_every_fr001_gate(
    tmp_path: Path, gate: str, message: str,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    manifest_path = package_root / "manifest.json"

    if gate == "manifest_binding":
        index_path = release_root / "release-index.json"
        index = json.loads(index_path.read_text(encoding="utf-8"))
        index["programmes"][0]["packages"][0]["manifest_sha256"] = "f" * 64
        _write_json(index_path, index)
    elif gate == "inventory":
        (package_root / "learner" / "undeclared.txt").write_text("undeclared")
    elif gate == "artifact_hash":
        transcript_path = package_root / "controlled-access" / "transcripts" / "stimulus-1.json"
        transcript_path.write_text("{}", encoding="utf-8")
    elif gate == "boundary":
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["payload_boundaries"]["public"] = "protected/"
        _write_json(manifest_path, manifest)
        _rebind_manifest(release_root)
    elif gate == "protected_leak":
        lesson_path = package_root / "learner" / "content" / "lessons" / "lesson-1.json"
        lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
        lesson["script"] = "must never be public"
        _write_json(lesson_path, lesson)
        _rebind_manifest(release_root)
    elif gate == "media_format":
        _wav(package_root / "learner" / "audio" / "stimulus-1.wav", seconds=1, rate=16_000)
        _rebind_manifest(release_root)
    elif gate == "timing_bounds":
        timing_path = package_root / "controlled-access" / "timing" / "stimulus-1.json"
        timing = json.loads(timing_path.read_text(encoding="utf-8"))
        timing["segments"][0]["end"] = 2.0
        _write_json(timing_path, timing)
        _rebind_manifest(release_root)
    elif gate == "declared_counts":
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["counts"]["forms"] = 2
        _write_json(manifest_path, manifest)
        _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match=message):
        importer.build_import_plan(location)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("beyond_audio", "Transcript bounds"),
        ("mismatched_id", "Transcript/timing segment mismatch"),
        ("mismatched_bounds", "Transcript/timing bounds mismatch"),
    ],
)
def test_controlled_transcript_must_match_canonical_timing(
    tmp_path: Path, mutation: str, message: str,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    transcript_path = (
        release_root / "general" / "fixture" / "controlled-access"
        / "transcripts" / "stimulus-1.json"
    )
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    if mutation == "beyond_audio":
        transcript["segments"][0]["end"] = 2.0
    elif mutation == "mismatched_id":
        transcript["segments"][0]["id"] = "turn-other"
    else:
        transcript["segments"][0]["start"] = 0.1
    _write_json(transcript_path, transcript)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match=message):
        importer.build_import_plan(location)


def test_timing_and_transcript_cannot_exceed_wav_by_sub_50ms(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    for relative in (
        "controlled-access/timing/stimulus-1.json",
        "controlled-access/transcripts/stimulus-1.json",
    ):
        path = package_root / relative
        document = json.loads(path.read_text(encoding="utf-8"))
        document["segments"][0]["end"] = 1.04
        _write_json(path, document)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="Timing bounds"):
        importer.build_import_plan(location)


def test_truncated_pcm_cannot_trust_the_header_declared_duration(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    audio_path = package_root / "learner" / "audio" / "stimulus-1.wav"
    audio_path.write_bytes(audio_path.read_bytes()[:-24_000])
    for relative in (
        "controlled-access/timing/stimulus-1.json",
        "controlled-access/transcripts/stimulus-1.json",
    ):
        path = package_root / relative
        document = json.loads(path.read_text(encoding="utf-8"))
        document["segments"][0]["end"] = 0.75
        _write_json(path, document)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="PCM data bị cắt cụt"):
        importer.build_import_plan(location)


def test_replay_window_rejects_unknown_declared_evidence_turn(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    protected_path = (
        release_root / "general" / "fixture" / "protected"
        / "source-lessons" / "lesson-1.json"
    )
    protected = json.loads(protected_path.read_text(encoding="utf-8"))
    protected["items"][0]["evidence_turn_ids"] = ["turn-missing"]
    _write_json(protected_path, protected)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="Evidence turn không tồn tại"):
        importer.build_import_plan(location)


def test_protected_index_rejects_duplicate_item_within_one_file(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    protected_path = (
        release_root / "general" / "fixture" / "protected"
        / "source-lessons" / "lesson-1.json"
    )
    protected = json.loads(protected_path.read_text(encoding="utf-8"))
    protected["items"].append(dict(protected["items"][0]))
    _write_json(protected_path, protected)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="Trùng protected item id"):
        importer.build_import_plan(location)


def test_protected_index_rejects_duplicate_item_across_files(tmp_path: Path):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    duplicate_path = package_root / "protected" / "source-lessons" / "lesson-2.json"
    _write_json(duplicate_path, {
        "forms": [],
        "items": [{
            "id": "item-1",
            "key": {"answers": ["B"]},
        }],
    })
    manifest_path = package_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["artifact_hashes"]["protected/source-lessons/lesson-2.json"] = "0" * 64
    _write_json(manifest_path, manifest)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="Trùng protected item id"):
        importer.build_import_plan(location)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        ("missing_expected_option", "Objective key không selectable"),
        ("invalid_option_shape", "Objective options không hợp lệ"),
        ("invalid_multiple_cardinality", "Multiple-choice cardinality"),
    ],
)
def test_objective_key_must_be_selectable_with_valid_cardinality(
    tmp_path: Path, mutation: str, message: str,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    lesson_path = package_root / "learner" / "content" / "lessons" / "lesson-1.json"
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    if mutation == "missing_expected_option":
        lesson["items"][0]["options"] = {"B": "Two", "C": "Three"}
    elif mutation == "invalid_option_shape":
        lesson["items"][0]["options"] = ["One", "Two"]
    else:
        lesson["items"][0]["response_type"] = "multiple_choice"
    _write_json(lesson_path, lesson)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match=message):
        importer.build_import_plan(location)


def test_single_choice_option_ids_must_be_unique_after_grading_normalization(
    tmp_path: Path,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    lesson_path = (
        release_root / "general" / "fixture" / "learner" / "content"
        / "lessons" / "lesson-1.json"
    )
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    lesson["items"][0]["options"] = {"A": "One", "a": "Two"}
    _write_json(lesson_path, lesson)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="trùng sau chuẩn hoá"):
        importer.build_import_plan(location)


def test_multiple_choice_key_must_be_unique_after_grading_normalization(
    tmp_path: Path,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    lesson_path = package_root / "learner" / "content" / "lessons" / "lesson-1.json"
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    lesson["items"][0]["response_type"] = "multiple_choice"
    _write_json(lesson_path, lesson)
    protected_path = package_root / "protected" / "source-lessons" / "lesson-1.json"
    protected = json.loads(protected_path.read_text(encoding="utf-8"))
    protected["items"][0]["key"]["answers"] = ["A", "a"]
    _write_json(protected_path, protected)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="Objective key không selectable"):
        importer.build_import_plan(location)


@pytest.mark.parametrize("delimiter", [",", ";", "|"])
def test_multiple_choice_option_ids_reject_wire_delimiters(
    tmp_path: Path, delimiter: str,
):
    release_root = _minimal_publish_ready_package(tmp_path)
    package_root = release_root / "general" / "fixture"
    composite = f"A{delimiter}B"
    lesson_path = package_root / "learner" / "content" / "lessons" / "lesson-1.json"
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    lesson["items"][0]["response_type"] = "multiple_choice"
    lesson["items"][0]["options"] = {composite: "Composite", "C": "Other"}
    _write_json(lesson_path, lesson)
    protected_path = package_root / "protected" / "source-lessons" / "lesson-1.json"
    protected = json.loads(protected_path.read_text(encoding="utf-8"))
    protected["items"][0]["key"]["answers"] = [composite, "C"]
    _write_json(protected_path, protected)
    _rebind_manifest(release_root)

    location = importer.discover_packages(release_root)[0]
    with pytest.raises(importer.PackageValidationError, match="chứa delimiter"):
        importer.build_import_plan(location)


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
    assert "listening_attempts_playback_claim_check" in sql
    assert "playback_started_at" in sql
    assert "playback_claim_id" in sql
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
