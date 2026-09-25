"""Read-only v1.0 → editorial revision invariant comparison for Listening."""

from __future__ import annotations

from typing import Any


class RevisionMismatch(ValueError):
    """A proposed revision changes more than approved editorial presentation."""


def _same(label: str, source: Any, revision: Any) -> None:
    if source != revision:
        raise RevisionMismatch(f"{label} changed")


def _by_id(rows: list[dict[str, Any]], key: str, label: str) -> dict[str, dict[str, Any]]:
    indexed = {str(row[key]): row for row in rows}
    if len(indexed) != len(rows):
        raise RevisionMismatch(f"{label} has duplicate IDs")
    return indexed


def _without(row: dict[str, Any], *keys: str) -> dict[str, Any]:
    return {key: value for key, value in row.items() if key not in keys}


def compare_editorial_revision(
    source_plan: Any,
    revision_plan: Any,
    *,
    expected_source_manifest_sha256: str,
) -> dict[str, Any]:
    """Prove the new import plan preserves the old learning/scoring source.

    Allowed differences are package-specific IDs/storage paths, lesson/form
    title and instructions/outcomes, version strings, and validated
    ``editorial_translation`` display data. The importer separately validates
    each package's artifact hashes and the translation's exact source text.
    """
    source_id = source_plan.location.package_id
    revision_id = revision_plan.location.package_id
    if source_id == revision_id:
        raise RevisionMismatch("Revision must use a new package ID")
    _same("source manifest lock", expected_source_manifest_sha256, source_plan.location.manifest_sha256)
    if revision_plan.location.manifest_sha256 == source_plan.location.manifest_sha256:
        raise RevisionMismatch("Revision must use a new manifest hash")
    _same("programme ID", source_plan.location.programme_id, revision_plan.location.programme_id)
    _same("programme title", source_plan.package["title"], revision_plan.package["title"])
    for key in ("lessons", "forms", "items", "stimuli", "audio", "timing", "timing_segments"):
        _same(f"source count {key}", source_plan.package["source_counts"][key], revision_plan.package["source_counts"][key])

    source_lessons = _by_id(source_plan.lessons, "source_lesson_id", "source lessons")
    revision_lessons = _by_id(revision_plan.lessons, "source_lesson_id", "revision lessons")
    _same("lesson IDs", set(source_lessons), set(revision_lessons))
    for lesson_id, source in source_lessons.items():
        revision = revision_lessons[lesson_id]
        _same(f"lesson {lesson_id} sequence", source["sequence_num"], revision["sequence_num"])
        _same(
            f"lesson {lesson_id} source metadata",
            _without(source["metadata"], "version"),
            _without(revision["metadata"], "version"),
        )

    source_stimuli = _by_id(source_plan.stimuli, "source_stimulus_id", "source stimuli")
    revision_stimuli = _by_id(revision_plan.stimuli, "source_stimulus_id", "revision stimuli")
    _same("stimulus IDs", set(source_stimuli), set(revision_stimuli))
    for stimulus_id, source in source_stimuli.items():
        revision = revision_stimuli[stimulus_id]
        _same(
            f"stimulus {stimulus_id} source bytes/timing/transcript",
            _without(source, "metadata"),
            _without(revision, "metadata"),
        )
        _same(
            f"stimulus {stimulus_id} source metadata/visual",
            _without(source["metadata"], "visual_storage_path"),
            _without(revision["metadata"], "visual_storage_path"),
        )

    source_forms = _by_id(source_plan.forms, "source_form_id", "source forms")
    revision_forms = _by_id(revision_plan.forms, "source_form_id", "revision forms")
    _same("form IDs", set(source_forms), set(revision_forms))
    if {form["test_id"] for form in source_forms.values()} & {form["test_id"] for form in revision_forms.values()}:
        raise RevisionMismatch("Revision reuses a v1.0 test ID")
    for form_id, source in source_forms.items():
        revision = revision_forms[form_id]
        _same(
            f"form {form_id} structure/audio",
            _without(source, "test_id", "title", "description", "version", "audio_storage_path", "exercise_payload"),
            _without(revision, "test_id", "title", "description", "version", "audio_storage_path", "exercise_payload"),
        )
        source_payload = source["exercise_payload"]
        revision_payload = revision["exercise_payload"]
        _same(
            f"form {form_id} keys/feedback/windows/transcripts",
            _without(source_payload, "questions"),
            _without(revision_payload, "questions"),
        )
        source_questions = source_payload["questions"]
        revision_questions = revision_payload["questions"]
        _same(f"form {form_id} question count", len(source_questions), len(revision_questions))
        for source_question, revision_question in zip(source_questions, revision_questions, strict=True):
            question_id = source_question["source_item_id"]
            if source_question.get("visual_accessibility") != revision_question.get("visual_accessibility"):
                translation = revision_question.get("editorial_translation") or {}
                if (not source_question.get("visual_storage_path")
                        or translation.get("source_language") != "vi"
                        or translation.get("target_language") != "en"
                        or revision_question.get("visual_storage_path") == source_question.get("visual_storage_path")
                        or not isinstance(revision_question.get("visual_accessibility"), str)
                        or not revision_question["visual_accessibility"].strip()):
                    raise RevisionMismatch(f"question {question_id} source visual accessibility changed")
            _same(
                f"question {question_id} source response/option mapping",
                _without(source_question, "editorial_translation", "visual_storage_path", "visual_accessibility"),
                _without(revision_question, "editorial_translation", "visual_storage_path", "visual_accessibility"),
            )

    source_visuals = {asset["source_path"]: asset["sha256"] for asset in source_plan.visual_assets}
    revision_visuals = {asset["source_path"]: asset["sha256"] for asset in revision_plan.visual_assets}
    for path, sha in source_visuals.items():
        _same(f"source visual {path}", sha, revision_visuals.get(path))

    return {
        "source_package_id": source_id,
        "source_manifest_sha256": expected_source_manifest_sha256,
        "revision_package_id": revision_id,
        "revision_manifest_sha256": revision_plan.location.manifest_sha256,
        "lessons_compared": len(source_lessons),
        "forms_compared": len(source_forms),
        "items_compared": source_plan.package["source_counts"]["items"],
        "stimuli_compared": len(source_stimuli),
        "source_visuals_compared": len(source_visuals),
        "protected_and_media_invariants": "pass",
    }
