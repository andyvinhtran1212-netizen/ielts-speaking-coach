"""Pure validation for an Advanced Vocabulary self-paced package.

The importer must fail before touching the database.  This module deliberately
has no FastAPI, Supabase or filesystem mutation: the CLI supplies a package
directory, and callers receive a complete error/warning report.

The first-release contract is documented in
``specs/0002-advanced-vocabulary-self-paced/spec.md``.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Iterable


CORE_LESSON_IDS = tuple(f"ADV-T{i:02d}" for i in range(1, 31))
CORE_LESSON_SET = frozenset(CORE_LESSON_IDS)
CORE_REVIEW_IDS = tuple(f"R{i:02d}" for i in range(1, 7))
CORE_REVIEW_SET = frozenset(CORE_REVIEW_IDS)
ALLOWED_INPUTS = frozenset({"choice", "text", "boolean", "syllable", "match"})
ALLOWED_ACTIVITY_POLICIES = {
    "interaction_policy": frozenset({
        "auto_graded", "practice_recording", "read_only", "self_check",
    }),
    "grading_policy": frozenset({"automatic", "none", "self_check"}),
    "completion_policy": frozenset({"required", "optional", "reference_only"}),
    "reveal_policy": frozenset({
        "admin_only", "after_attempt", "after_guided_retry", "always",
    }),
}
NON_READY_AUDIO = frozenset({
    "missing", "pending_render", "rendered_review_required", "uploaded",
    "qc_failed", "source_script_missing",
})
WRITING_ACTIVITY_TYPE = "writing_reference"
SPEAKING_ACTIVITY_TYPE = "speaking_practice"
LISTENING_ACTIVITY_TYPE = "listening_lab"
READING_ACTIVITY_TYPE = "reading_lab"
CONTROLLED_REWRITE_ACTIVITY_TYPE = "controlled_rewrite"
READING_AUTHORED_CONTENT_FIELDS = frozenset({
    "module", "passages", "question_material", "questions", "solutions",
    "solutions_visibility", "target_band", "test_id", "title",
})
READING_LEARNER_PASSAGE_FIELDS = frozenset({
    "paragraph", "passage_number", "text", "title",
})
READING_LEARNER_QUESTION_FIELDS = frozenset({
    "options", "question_number", "question_type", "source_question_number", "stem",
})
READING_PRIVATE_QUESTION_FIELDS = frozenset({
    "accepted_variants", "answer", "answer_code", "answer_label", "correction",
    "correction_reason", "distractor_analysis", "evidence",
    "evidence_correction_reason", "evidence_kind", "explanation", "solution",
    "source_answer", "source_evidence", "source_stem", "trap_analysis",
})
LISTENING_LEARNER_QUESTION_FIELDS = frozenset({
    "question_number", "question_type", "stem", "options",
})
LISTENING_LEARNER_OPTION_FIELDS = frozenset({"key", "letter", "text"})
LISTENING_LEARNER_SECTION_FIELDS = frozenset({
    "audio_intro", "context", "figure", "figure_checksum", "question_blocks",
    "register", "section_id", "section_number", "speakers",
})
LISTENING_LEARNER_BLOCK_FIELDS = frozenset({
    "block_id", "question_range", "questions", "render", "rubric",
})
LISTENING_PRIVATE_CONTAINER_FIELDS = frozenset({
    "accepted_variants", "answer", "answer_key", "answers", "correction",
    "evidence", "explanation", "solution", "solutions", "transcript",
})
QUIZ_AUTHORED_ITEM_FIELDS = frozenset({
    "accept", "answer", "answer_index", "case_sensitive",
    "counts_toward_mastery", "explain", "headword", "hint", "input",
    "item_id", "legacy_id", "lexeme_id", "mask", "note", "options",
    "pair", "pairs", "points", "prompt", "question_type", "segments",
    "skill", "subtype", "type", "why_wrong",
})
QUIZ_OPTION_FIELDS = frozenset({"key", "letter", "text"})
SHA256_RE = re.compile(r"[0-9a-f]{64}", re.IGNORECASE)
SOURCE_MANIFEST_NAME = "source-inputs-manifest.json"
SOURCE_MANIFEST_ROOTS = frozenset({
    "source", "common_error_overrides", "vocab_audio_bundle",
})
APPROVED_AUTHORED_INPUT_MAP_SHA256 = (
    "498a80407e6580c6f04fef6a4a0d34471a3a90eb2bd3ed38d06906e4aa8983b2"
)
FIRST_RELEASE_LOCKED_REVISIONS = {
    "authored_input_map_sha256": APPROVED_AUTHORED_INPUT_MAP_SHA256,
    "kokoro_bundle_sha256": (
        "c0495ddac3a1c865d6f07963f11534693f024ba9042eea0ab4b737511fb4c166"
    ),
    "generated_package_sha256": (
        "d1acfdf50fe1741d9156c9e62cbd4084bbd44b57a524909c45d6301503f7fd7b"
    ),
}

_ALL_CORE_LESSONS = tuple(CORE_LESSON_IDS)
_COMMON_ERROR_LESSONS = (
    "ADV-T02", "ADV-T03", "ADV-T04", "ADV-T05", "ADV-T08",
    "ADV-T10", "ADV-T11", "ADV-T14", "ADV-T20",
)


def _topic_lesson_id(relative: str) -> str | None:
    match = re.search(r"(?:^|[/_-])(T(?:0[1-9]|[12]\d|30))(?:[/_.-]|$)", relative)
    return f"ADV-{match.group(1)}" if match else None


def _expected_input_metadata(
    root_name: str,
    relative: str,
) -> tuple[str, tuple[str, ...] | None] | None:
    """Return the deterministic first-release role and lesson ownership."""
    if root_name == "common_error_overrides":
        if relative == "advanced_vocab_common_error_overrides.json":
            return "common_error_overrides", _COMMON_ERROR_LESSONS
        return None
    if root_name == "vocab_audio_bundle":
        if relative == "manifest.json":
            return "vocab_audio_manifest", _ALL_CORE_LESSONS
        if re.fullmatch(r"clips/[0-9a-f]{64}\.mp3", relative):
            return "vocab_audio_clip", None
        return None
    if root_name != "source":
        return None

    if relative in {
        "Advanced/03_Writing/WT1_Question_Bank_Advanced.docx",
        "Advanced/03_Writing/WT2_Question_Bank_Advanced.docx",
    }:
        return "writing_question_bank", _ALL_CORE_LESSONS
    if relative == "Advanced/03_Writing/WT2_Idea_Bank_Advanced.docx":
        return "writing_task_2_idea_bank", _ALL_CORE_LESSONS

    review_match = re.fullmatch(
        r"Vocab_Quiz/Advanced_banks/review/R(0[1-6])_InterleavedReview_"
        r"T(\d{2})-T(\d{2})\.md",
        relative,
    )
    if review_match:
        review_number = int(review_match.group(1))
        expected_start = (review_number - 1) * 5 + 1
        expected_end = review_number * 5
        if (int(review_match.group(2)), int(review_match.group(3))) != (
            expected_start, expected_end,
        ):
            return None
        return "checkpoint_review", tuple(
            f"ADV-T{number:02d}" for number in range(1, review_number * 5 + 1)
        )

    lesson_id = _topic_lesson_id(relative)
    if lesson_id is None:
        return None
    lesson_scope = (lesson_id,)
    if (relative.startswith("_CORRECTED/Advanced/01_Topics_Upgraded/Cluster_C")
            and relative.endswith("_Advanced_Upgraded.docx")):
        return "topic_docx", lesson_scope
    if (relative.startswith("Advanced/05_Assessments/")
            and relative.endswith("_Assessment_Rewrite_Advanced.docx")):
        return "controlled_rewrite_assessment", lesson_scope
    if (relative.startswith("Advanced/06_WT1_Illustrations/")
            and Path(relative).suffix.lower() in {".png", ".svg"}):
        return "writing_task_1_illustration", lesson_scope
    if (relative.startswith("Vocab_Quiz/Advanced_Markdown_Upload/")
            and re.search(r"_Group[A-C]\.md$", relative)):
        return "vocabulary_cards", lesson_scope
    if (relative.startswith("Vocab_Quiz/Advanced_banks/")
            and relative.endswith("_QuickCheck.md")):
        return "lesson_quickcheck", lesson_scope
    if ("/Reading_Lessons_Web/Source_JSON/" in relative
            and relative.endswith(".json")):
        return "reading_source", lesson_scope
    if ("/Listening_Lessons_Web/Source_JSON/" in relative
            and relative.endswith(".json")):
        return "listening_source", lesson_scope
    if "/Listening_Lessons_Web/Figures/" in relative:
        return "listening_figure", lesson_scope
    if "/Listening_Lessons_Web/audio_output/" in relative:
        if relative.endswith("/full_test.mp3"):
            return "listening_audio", lesson_scope
        if relative.endswith("/manifest.json"):
            return "listening_audio_manifest", lesson_scope
        if relative.endswith("/timings.json"):
            return "listening_audio_timings", lesson_scope
    return None


def _option_identity(option: object, index: int) -> object:
    """Mirror the learner's nullish letter/key/index option precedence."""
    if not isinstance(option, dict):
        return index
    if option.get("letter") is not None:
        return option.get("letter")
    if option.get("key") is not None:
        return option.get("key")
    return index


def _grading_identity(value: object) -> str:
    text = unicodedata.normalize(
        "NFKC", str(value if value is not None else "")
    ).casefold().strip()
    return re.sub(r"[^\w+]+", " ", text, flags=re.UNICODE).strip()


def _practice_choice(item: dict[str, Any]) -> bool:
    return item.get("input") in {"choice", "boolean", "syllable"}


def _pick_practice_candidate(
    candidates: list[dict[str, Any]], seed: str,
) -> dict[str, Any] | None:
    if not candidates:
        return None
    return min(
        candidates,
        key=lambda row: hashlib.sha256(
            f"{seed}:{row.get('item_id')}".encode("utf-8")
        ).hexdigest(),
    )


@dataclass(frozen=True)
class ValidationIssue:
    severity: str
    code: str
    path: str
    message: str


@dataclass
class ValidationReport:
    package_path: str
    errors: list[ValidationIssue] = field(default_factory=list)
    warnings: list[ValidationIssue] = field(default_factory=list)
    checked_lessons: int = 0

    @property
    def schema_valid(self) -> bool:
        return not self.errors

    @property
    def publish_ready(self) -> bool:
        return self.schema_valid and not self.warnings

    def add(self, severity: str, code: str, path: Path | str, message: str) -> None:
        issue = ValidationIssue(severity, code, str(path), message)
        (self.errors if severity == "error" else self.warnings).append(issue)

    def to_dict(self) -> dict[str, Any]:
        return {
            "package_path": self.package_path,
            "schema_valid": self.schema_valid,
            "publish_ready": self.publish_ready,
            "checked_lessons": self.checked_lessons,
            "summary": {"errors": len(self.errors), "warnings": len(self.warnings)},
            "errors": [asdict(i) for i in self.errors],
            "warnings": [asdict(i) for i in self.warnings],
        }


def _read_json(path: Path, report: ValidationReport) -> dict[str, Any] | None:
    if not path.is_file():
        report.add("error", "FILE_MISSING", path, "Required JSON file is missing.")
        return None
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        report.add("error", "JSON_INVALID", path, f"Cannot parse JSON: {exc}")
        return None
    if not isinstance(value, dict):
        report.add("error", "JSON_ROOT_TYPE", path, "JSON root must be an object.")
        return None
    return value


def _canonical_checksum(value: dict[str, Any]) -> str:
    payload = json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_manifest_revision(manifest: dict[str, Any]) -> str:
    """Return the canonical manifest identity without trusting its embedded digest."""
    clone = json.loads(json.dumps(manifest, ensure_ascii=False))
    clone.pop("source_revision", None)
    return _canonical_checksum(clone)


def authored_input_map_revision(manifest: dict[str, Any]) -> str:
    """Bind the authored lock to the original path-to-checksum source map.

    The owner-approved ``498a…`` revision predates the richer manifest rows and is
    the canonical digest of the 394 lesson-embedded authored paths plus the
    repository-owned common-error overlay.  Checkpoint review sources, roles, and
    lesson mappings remain integrity-bound by the enclosing ``source_revision`` and
    review provenance; they are deliberately not part of this original content lock.
    """
    inputs: dict[str, str] = {}
    for raw in manifest.get("inputs") or []:
        if not isinstance(raw, dict) or raw.get("root") == "vocab_audio_bundle":
            continue
        root_name = str(raw.get("root") or "")
        relative = Path(
            str(raw.get("path") or "").replace("\\", "/")
        ).as_posix()
        if (root_name == "source"
                and relative.startswith("Vocab_Quiz/Advanced_banks/review/")):
            continue
        if root_name == "source":
            canonical_path = relative
        elif root_name == "common_error_overrides":
            canonical_path = f"repo://backend/data/{relative}"
        else:
            canonical_path = f"{root_name}://{relative}"
        inputs[canonical_path] = str(raw.get("sha256") or "").lower()
    return _canonical_checksum(inputs)


def generated_package_revision(manifest: dict[str, Any]) -> str:
    """Hash generated identity without the source-lock dependency cycle."""
    clone = json.loads(json.dumps(manifest, ensure_ascii=False))
    clone.pop("package_checksum", None)
    clone.pop("source_revision", None)
    return _canonical_checksum(clone)


def validate_source_inputs_manifest(
    manifest_path: str | Path,
    *,
    roots: dict[str, str | Path] | None = None,
) -> ValidationReport:
    """Validate source identity and, when roots are supplied, every release input."""
    path = Path(manifest_path).expanduser().resolve()
    report = ValidationReport(package_path=str(path))
    manifest = _read_json(path, report)
    if manifest is None:
        return report

    if manifest.get("schema_version") != "1.0.0":
        report.add("error", "SOURCE_MANIFEST_SCHEMA", path,
                   "schema_version must be '1.0.0'.")
    for field_name in ("source_id", "origin", "rights"):
        if not str(manifest.get(field_name) or "").strip():
            report.add("error", "SOURCE_MANIFEST_METADATA", path,
                       f"{field_name} must be a non-empty string.")
    revision = str(manifest.get("source_revision") or "")
    if not SHA256_RE.fullmatch(revision):
        report.add("error", "SOURCE_REVISION_INVALID", path,
                   "source_revision must be a SHA-256 hex digest.")
    elif revision != source_manifest_revision(manifest):
        report.add("error", "SOURCE_REVISION_MISMATCH", path,
                   "Manifest content no longer matches source_revision.")

    locked = manifest.get("locked_revisions")
    for key, expected in FIRST_RELEASE_LOCKED_REVISIONS.items():
        value = locked.get(key) if isinstance(locked, dict) else None
        if not SHA256_RE.fullmatch(str(value or "")):
            report.add("error", "LOCKED_REVISION_INVALID", path,
                       f"locked_revisions.{key} must be SHA-256.")
        elif value != expected:
            report.add("error", "LOCKED_REVISION_MISMATCH", path,
                       f"locked_revisions.{key} does not match AVOC-0002.")

    patterns = manifest.get("release_patterns")
    if not isinstance(patterns, dict):
        report.add("error", "SOURCE_PATTERNS_INVALID", path,
                   "release_patterns must map roots to glob arrays.")
        patterns = {}
    inputs = manifest.get("inputs")
    if not isinstance(inputs, list) or not inputs:
        report.add("error", "SOURCE_INPUTS_INVALID", path,
                   "inputs must be a non-empty array.")
        inputs = []

    strict_metadata = (
        isinstance(locked, dict)
        and locked.get("authored_input_map_sha256")
        == APPROVED_AUTHORED_INPUT_MAP_SHA256
    )

    declared: dict[tuple[str, str], str] = {}
    for index, row in enumerate(inputs):
        if not isinstance(row, dict):
            report.add("error", "SOURCE_INPUT_INVALID", path,
                       f"inputs[{index}] must be an object.")
            continue
        root_name = str(row.get("root") or "")
        relative = str(row.get("path") or "").replace("\\", "/")
        relative_path = Path(relative)
        if root_name not in SOURCE_MANIFEST_ROOTS:
            report.add("error", "SOURCE_ROOT_INVALID", path,
                       f"inputs[{index}].root is unsupported: {root_name!r}.")
        if (not relative or relative_path.is_absolute()
                or ".." in relative_path.parts):
            report.add("error", "SOURCE_PATH_UNSAFE", path,
                       f"inputs[{index}].path must be a safe relative path.")
            continue
        key = (root_name, relative_path.as_posix())
        if key in declared:
            report.add("error", "SOURCE_INPUT_DUPLICATE", path,
                       f"Duplicate source input {root_name}:{relative}.")
        checksum = str(row.get("sha256") or "")
        if not SHA256_RE.fullmatch(checksum):
            report.add("error", "SOURCE_INPUT_CHECKSUM_INVALID", path,
                       f"Invalid SHA-256 for {root_name}:{relative}.")
        role = str(row.get("role") or "").strip()
        if not role:
            report.add("error", "SOURCE_INPUT_ROLE_MISSING", path,
                       f"Missing role for {root_name}:{relative}.")
        lesson_ids = row.get("lesson_ids")
        if (not isinstance(lesson_ids, list)
                or any(str(item) not in CORE_LESSON_SET for item in lesson_ids)):
            report.add("error", "SOURCE_INPUT_LESSONS_INVALID", path,
                       f"lesson_ids for {root_name}:{relative} must use ADV-T01..ADV-T30.")
        if strict_metadata:
            expected_metadata = _expected_input_metadata(root_name, relative)
            if expected_metadata is None:
                report.add(
                    "error", "SOURCE_INPUT_METADATA_UNSUPPORTED", path,
                    f"No first-release metadata mapping exists for {root_name}:{relative}.",
                )
            else:
                expected_role, expected_lessons = expected_metadata
                if role != expected_role:
                    report.add(
                        "error", "SOURCE_INPUT_ROLE_MISMATCH", path,
                        f"{root_name}:{relative} role must be {expected_role!r}.",
                    )
                normalized_lessons = (
                    tuple(sorted(str(item) for item in lesson_ids))
                    if isinstance(lesson_ids, list) else ()
                )
                if (len(normalized_lessons) != len(set(normalized_lessons))
                        or (expected_lessons is None and not normalized_lessons)):
                    report.add(
                        "error", "SOURCE_INPUT_LESSONS_MISMATCH", path,
                        f"{root_name}:{relative} needs unique non-empty lesson ownership.",
                    )
                elif (expected_lessons is not None
                        and normalized_lessons != expected_lessons):
                    report.add(
                        "error", "SOURCE_INPUT_LESSONS_MISMATCH", path,
                        f"{root_name}:{relative} lesson_ids do not match its canonical scope.",
                    )
        declared[key] = checksum

    authored_lock = (
        str(locked.get("authored_input_map_sha256") or "")
        if isinstance(locked, dict) else ""
    )
    if authored_lock and authored_lock != authored_input_map_revision(manifest):
        report.add(
            "error", "AUTHORED_INPUT_MAP_REVISION_MISMATCH", path,
            "The authored-input-map lock does not match the declared authored inputs.",
        )

    for root_name, root_patterns in patterns.items():
        if root_name not in SOURCE_MANIFEST_ROOTS or not isinstance(root_patterns, list):
            report.add("error", "SOURCE_PATTERNS_INVALID", path,
                       f"Invalid release_patterns entry for {root_name!r}.")
            continue
        for pattern in root_patterns:
            pattern_text = str(pattern or "")
            if (not pattern_text or Path(pattern_text).is_absolute()
                    or ".." in Path(pattern_text).parts):
                report.add("error", "SOURCE_PATTERN_UNSAFE", path,
                           f"Unsafe release pattern {root_name}:{pattern_text!r}.")

    if roots is None:
        return report
    resolved_roots = {
        name: Path(value).expanduser().resolve() for name, value in roots.items()
    }
    if strict_metadata:
        audio_root = resolved_roots.get("vocab_audio_bundle")
        audio_manifest_path = audio_root / "manifest.json" if audio_root else None
        if audio_manifest_path is not None and audio_manifest_path.is_file():
            audio_manifest = _read_json(audio_manifest_path, report) or {}
            expected_clip_lessons: dict[str, set[str]] = {}
            cards = audio_manifest.get("cards")
            if not isinstance(cards, dict):
                report.add(
                    "error", "VOCAB_AUDIO_CARDS_INVALID", audio_manifest_path,
                    "Kokoro manifest cards must be an object keyed by lesson_lexeme_id.",
                )
                cards = {}
            for card_id, card in cards.items():
                if not isinstance(card, dict):
                    continue
                lesson_id = str(card_id).split("__", 1)[0]
                for clip in (card.get("headword"), card.get("example")):
                    if not isinstance(clip, dict):
                        continue
                    clip_id = str(clip.get("clip_id") or "")
                    if clip_id:
                        expected_clip_lessons.setdefault(
                            f"clips/{clip_id}.mp3", set()
                        ).add(lesson_id)
            for row in inputs:
                if (not isinstance(row, dict)
                        or row.get("root") != "vocab_audio_bundle"
                        or not str(row.get("path") or "").startswith("clips/")):
                    continue
                relative = str(row.get("path") or "")
                actual_lessons = sorted(str(item) for item in row.get("lesson_ids") or [])
                expected_lessons = sorted(expected_clip_lessons.get(relative, set()))
                if actual_lessons != expected_lessons:
                    report.add(
                        "error", "SOURCE_INPUT_LESSONS_MISMATCH", path,
                        f"vocab_audio_bundle:{relative} lesson_ids do not match "
                        "the locked Kokoro card map.",
                    )
    actual: set[tuple[str, str]] = set()
    for root_name, root_patterns in patterns.items():
        root = resolved_roots.get(root_name)
        if root is None or not root.is_dir():
            report.add("error", "SOURCE_ROOT_MISSING", path,
                       f"Missing source root for {root_name!r}.")
            continue
        for pattern in root_patterns if isinstance(root_patterns, list) else []:
            for matched in root.glob(str(pattern)):
                if matched.is_file():
                    actual.add((root_name, matched.relative_to(root).as_posix()))

    for key, checksum in declared.items():
        root = resolved_roots.get(key[0])
        candidate = root / key[1] if root is not None else None
        if candidate is None or not candidate.is_file():
            report.add("error", "SOURCE_INPUT_MISSING", path,
                       f"Declared source input is missing: {key[0]}:{key[1]}.")
        elif SHA256_RE.fullmatch(checksum) and _sha256_file(candidate) != checksum:
            report.add("error", "SOURCE_INPUT_CHECKSUM_MISMATCH", candidate,
                       f"Source input differs from manifest: {key[0]}:{key[1]}.")
    for key in sorted(actual - set(declared)):
        report.add("error", "SOURCE_INPUT_UNDECLARED", path,
                   f"Release input is not declared: {key[0]}:{key[1]}.")
    for key in sorted(set(declared) - actual):
        report.add("error", "SOURCE_INPUT_OUTSIDE_RELEASE_SET", path,
                   f"Declared input is not selected by release_patterns: {key[0]}:{key[1]}.")
    return report


def _checksum_without(value: dict[str, Any], *field_path: str) -> str:
    clone = json.loads(json.dumps(value, ensure_ascii=False))
    parent: Any = clone
    for key in field_path[:-1]:
        parent = parent.get(key) if isinstance(parent, dict) else None
    if isinstance(parent, dict):
        parent.pop(field_path[-1], None)
    return _canonical_checksum(clone)


def lesson_content_checksum(lesson: dict[str, Any]) -> str:
    """Return the canonical lesson checksum without trusting embedded provenance."""
    return _checksum_without(lesson, "provenance", "content_checksum")


def _manifest_lesson_ids(manifest: dict[str, Any]) -> list[str]:
    rows = manifest.get("lessons") or []
    if not isinstance(rows, list):
        return []
    return [str(row.get("lesson_id") or "") for row in rows if isinstance(row, dict)]


def _manifest_review_ids(manifest: dict[str, Any]) -> list[str]:
    rows = manifest.get("reviews") or []
    if not isinstance(rows, list):
        return []
    return [str(row.get("review_id") or "") for row in rows if isinstance(row, dict)]


def _object_field(parent: dict[str, Any], key: str, path: Path,
                  report: ValidationReport, *, required: bool = True) -> dict[str, Any]:
    value = parent.get(key)
    if isinstance(value, dict):
        return value
    if value is not None or required:
        report.add("error", "OBJECT_FIELD_INVALID", path,
                   f"{key} must be an object.")
    return {}


def _walk(value: Any) -> Iterable[dict[str, Any]]:
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from _walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from _walk(child)


def _activities(lesson: dict[str, Any]) -> list[dict[str, Any]]:
    direct = lesson.get("activities")
    if isinstance(direct, list):
        return [a for a in direct if isinstance(a, dict)]
    flow = lesson.get("learning_flow")
    if isinstance(flow, dict) and isinstance(flow.get("activities"), list):
        return [a for a in flow["activities"] if isinstance(a, dict)]
    return []


def _validate_manifest(root: Path, manifest: dict[str, Any], report: ValidationReport) -> None:
    if not isinstance(manifest.get("lessons"), list):
        report.add("error", "MANIFEST_LESSONS_TYPE", root / "course-manifest.json",
                   "Manifest lessons must be an array.")
    ids = _manifest_lesson_ids(manifest)
    duplicates = sorted(k for k, n in Counter(ids).items() if k and n > 1)
    if duplicates:
        report.add("error", "DUPLICATE_LESSON_ID", root / "course-manifest.json",
                   f"Duplicate lesson IDs: {', '.join(duplicates)}")

    actual = set(ids)
    missing = sorted(CORE_LESSON_SET - actual)
    extras = sorted(actual - CORE_LESSON_SET)
    if missing:
        report.add("error", "CORE_LESSONS_MISSING", root / "course-manifest.json",
                   f"Missing first-release core lessons: {', '.join(missing)}")
    if extras:
        report.add("error", "NON_CORE_LESSONS_IN_RELEASE", root / "course-manifest.json",
                   f"First release must contain only T01-T30; remove: {', '.join(extras)}")
    if len(ids) != 30:
        report.add("error", "CORE_LESSON_COUNT", root / "course-manifest.json",
                   f"Expected 30 manifest lessons, found {len(ids)}.")

    audience = manifest.get("audience")
    if audience != "assigned_only":
        report.add("error", "AUDIENCE_POLICY", root / "course-manifest.json",
                   "Release 1 manifest must declare audience='assigned_only'.")

    review_ids = _manifest_review_ids(manifest)
    if set(review_ids) != CORE_REVIEW_SET or len(review_ids) != 6:
        report.add("error", "CORE_REVIEW_SET", root / "course-manifest.json",
                   "Release 1 manifest must contain exactly R01-R06 once each.")

    package_checksum = str(manifest.get("package_checksum") or "")
    if not SHA256_RE.fullmatch(package_checksum):
        report.add("error", "PACKAGE_CHECKSUM_INVALID", root / "course-manifest.json",
                   "Manifest package_checksum must be a SHA-256 hex digest.")
    elif package_checksum != _checksum_without(manifest, "package_checksum"):
        report.add("error", "PACKAGE_CHECKSUM_MISMATCH", root / "course-manifest.json",
                   "Manifest content no longer matches package_checksum.")


def _validate_mcq_options(lesson: dict[str, Any], path: Path,
                          report: ValidationReport) -> None:
    for node in _walk(lesson):
        q_type = str(node.get("question_type") or node.get("type") or "").lower()
        options = node.get("options")
        if q_type not in {"mcq", "choice"} or not isinstance(options, list):
            continue
        qid = node.get("item_id") or node.get("question_number") or node.get("id") or "?"
        if len(options) < 2:
            report.add("error", "MCQ_OPTION_COUNT", path,
                       f"Question {qid} needs at least two options; found {len(options)}.")
        keys = [str(_option_identity(option, index))
                for index, option in enumerate(options)]
        normalized_keys = [_grading_identity(key) for key in keys]
        duplicate_keys = sorted(
            key for key, n in Counter(normalized_keys).items() if n > 1
        )
        if duplicate_keys:
            report.add("error", "MCQ_DUPLICATE_OPTION_KEY", path,
                       f"Question {qid} repeats option keys: {', '.join(duplicate_keys)}")
        if "answer_index" in node:
            answer_index = node["answer_index"]
            if (not isinstance(answer_index, int) or isinstance(answer_index, bool)
                    or not 0 <= answer_index < len(options)):
                report.add("error", "MCQ_ANSWER_INVALID", path,
                           f"Question {qid} has invalid answer_index={answer_index!r}.")
        elif "answer" in node:
            answer = node["answer"]
            if isinstance(answer, int) and not isinstance(answer, bool):
                valid_answer = 0 <= answer < len(options)
            else:
                valid_answer = _grading_identity(answer) in normalized_keys
            if not valid_answer:
                report.add("error", "MCQ_ANSWER_INVALID", path,
                           f"Question {qid} answer={answer!r} does not identify an option.")


def _validate_activity_policies(lesson: dict[str, Any], path: Path,
                                report: ValidationReport) -> None:
    direct_activities = lesson.get("activities")
    learning_flow = lesson.get("learning_flow")
    raw_activities = (
        direct_activities
        if isinstance(direct_activities, list)
        else learning_flow.get("activities")
        if isinstance(learning_flow, dict)
        else None
    )
    if isinstance(raw_activities, list) and any(
        not isinstance(activity, dict) for activity in raw_activities
    ):
        report.add(
            "error", "ACTIVITY_ITEM_TYPE", path,
            "Every entry in the activities array must be an object.",
        )
    activities = _activities(lesson)
    if not activities:
        report.add("error", "ACTIVITIES_MISSING", path,
                   "Lesson has editorial blocks but no normalized activities contract.")

    seen_ids: set[str] = set()
    writing = []
    speaking = []
    listening = []
    reading = []
    controlled_rewrite = []
    for activity in activities:
        aid = str(activity.get("activity_id") or "")
        if not aid:
            report.add("error", "ACTIVITY_ID_MISSING", path, "Every activity needs activity_id.")
        elif aid in seen_ids:
            report.add("error", "ACTIVITY_ID_DUPLICATE", path, f"Duplicate activity_id: {aid}")
        else:
            seen_ids.add(aid)

        for key in ("interaction_policy", "grading_policy", "completion_policy",
                    "reveal_policy"):
            if key not in activity:
                report.add("error", "ACTIVITY_POLICY_MISSING", path,
                           f"Activity {aid or '?'} is missing {key}.")
            elif activity[key] not in ALLOWED_ACTIVITY_POLICIES[key]:
                report.add("error", "ACTIVITY_POLICY_INVALID", path,
                           f"Activity {aid or '?'} has invalid {key}={activity[key]!r}.")
        if activity.get("activity_type") == WRITING_ACTIVITY_TYPE:
            writing.append(activity)
        if activity.get("activity_type") == SPEAKING_ACTIVITY_TYPE:
            speaking.append(activity)
        if activity.get("activity_type") == LISTENING_ACTIVITY_TYPE:
            listening.append(activity)
        if activity.get("activity_type") == READING_ACTIVITY_TYPE:
            reading.append(activity)
        if activity.get("activity_type") == CONTROLLED_REWRITE_ACTIVITY_TYPE:
            controlled_rewrite.append(activity)

    is_core_lesson = str(lesson.get("lesson_id") or "") in CORE_LESSON_SET
    if is_core_lesson and len(writing) != 1:
        report.add("error", "WRITING_ACTIVITY_COUNT", path,
                   "Each core lesson needs exactly one Writing Insight reference; "
                   f"found {len(writing)}.")
    for activity in writing:
        valid = (
            activity.get("interaction_policy") == "read_only"
            and activity.get("submittable") is False
            and activity.get("grading_policy") == "none"
            and activity.get("completion_policy") == "reference_only"
            and activity.get("reveal_policy") == "always"
            and activity.get("teacher_assignment_required_for_grading") is True
        )
        if not valid:
            report.add("error", "WRITING_BOUNDARY_VIOLATION", path,
                       "Writing Insight must be non-submittable, ungraded, reference-only, "
                       "and require a teacher assignment for grading.")
        if is_core_lesson:
            content = activity.get("content") or {}
            tasks = content.get("tasks") if isinstance(content, dict) else None
            task_1 = tasks.get("task_1") if isinstance(tasks, dict) else None
            task_2 = tasks.get("task_2") if isinstance(tasks, dict) else None
            if not isinstance(task_1, dict) or not isinstance(task_2, dict):
                report.add("error", "WRITING_REFERENCE_TASKS_MISSING", path,
                           "Writing Insight must contain Task 1 and Task 2 references.")
                continue
            for task_name, task in (("Task 1", task_1), ("Task 2", task_2)):
                models = task.get("model_answers")
                bands = {
                    str(model.get("band") or "")
                    for model in models if isinstance(model, dict)
                } if isinstance(models, list) else set()
                if bands != {"7.0", "8.0"}:
                    report.add("error", "WRITING_MODEL_REFERENCES_INCOMPLETE", path,
                               f"{task_name} needs authored Band 7.0 and Band 8.0 references.")
            illustration_refs = [
                str(ref) for ref in task_1.get("illustrations") or []
            ]
            illustration_exts = {
                Path(ref).suffix.lower() for ref in illustration_refs
            }
            if not {".svg", ".png"} <= illustration_exts:
                report.add("error", "WRITING_TASK1_ARTWORK_INCOMPLETE", path,
                           "Task 1 needs both SVG and PNG illustration references.")
            media_refs = [
                str(ref) for ref in (
                    (lesson.get("media") or {}).get("wt1_illustrations") or []
                )
            ]
            if illustration_refs != media_refs:
                report.add("error", "WRITING_TASK1_ARTWORK_MEDIA_MISMATCH", path,
                           "Task 1 illustration refs must match media.wt1_illustrations.")
            source_checksums = (
                (lesson.get("provenance") or {}).get("source_checksums") or {}
            )
            for ref in illustration_refs:
                asset = (path.parent / ref).resolve()
                try:
                    asset.relative_to(path.parent.resolve())
                except ValueError:
                    report.add("error", "WRITING_TASK1_ARTWORK_PATH_UNSAFE", path, ref)
                    continue
                if not asset.is_file():
                    report.add("error", "WRITING_TASK1_ARTWORK_MISSING", asset,
                               f"Writing illustration referenced by {path.name} is missing.")
                    continue
                source_matches = [
                    str(checksum)
                    for source_name, checksum in (
                        source_checksums.items()
                        if isinstance(source_checksums, dict) else []
                    )
                    if Path(str(source_name)).name == Path(ref).name
                ]
                asset_checksum = _sha256_file(asset)
                if source_matches != [asset_checksum]:
                    report.add(
                        "error", "WRITING_TASK1_ARTWORK_SOURCE_MISMATCH", asset,
                        "Writing illustration bytes must match exactly one source input.",
                    )
            idea_sections = task_2.get("idea_sections")
            if not isinstance(idea_sections, list) or len(idea_sections) < 12:
                report.add("error", "WRITING_TASK2_IDEAS_INCOMPLETE", path,
                           "Task 2 needs all 12 authored idea-bank sections.")

    if is_core_lesson and len(controlled_rewrite) != 1:
        report.add(
            "error", "CONTROLLED_REWRITE_ACTIVITY_COUNT", path,
            "Each core lesson needs exactly one controlled rewrite activity; "
            f"found {len(controlled_rewrite)}.",
        )
    for activity in controlled_rewrite:
        valid_policy = (
            activity.get("interaction_policy") == "self_check"
            and activity.get("grading_policy") == "self_check"
            and activity.get("completion_policy") == "required"
            and activity.get("reveal_policy") == "after_attempt"
            and activity.get("submittable") is False
        )
        if not valid_policy:
            report.add(
                "error", "CONTROLLED_REWRITE_POLICY_INVALID", path,
                "Controlled rewrite must be required, self-check, revealed after "
                "attempt, and non-submittable.",
            )
        content = activity.get("content")
        prompts = content.get("prompts") if isinstance(content, dict) else None
        solutions = content.get("solutions") if isinstance(content, dict) else None
        if (
            not isinstance(prompts, list)
            or not isinstance(solutions, list)
            or not prompts
            or not solutions
            or any(
                not isinstance(block, dict)
                or not str(block.get("text") or "").strip()
                for block in (*prompts, *solutions)
            )
        ):
            report.add(
                "error", "CONTROLLED_REWRITE_CONTENT_INVALID", path,
                "Controlled rewrite needs separate authored prompt and solution lists.",
            )
            continue
        prompt_count = sum(
            bool(re.match(r"^\d+\.\s+", str(block.get("text") or "").strip()))
            for block in prompts
        )
        if prompt_count != 20:
            report.add(
                "error", "CONTROLLED_REWRITE_PROMPTS_INVALID", path,
                "Controlled rewrite needs exactly 20 public numbered prompts; "
                f"found {prompt_count} prompts.",
            )

    if is_core_lesson and len(speaking) != 1:
        report.add("error", "SPEAKING_ACTIVITY_COUNT", path,
                   f"Each core lesson needs exactly one Speaking practice; found {len(speaking)}.")
    for activity in speaking:
        valid = (
            activity.get("interaction_policy") == "practice_recording"
            and activity.get("grading_policy") == "none"
            and activity.get("completion_policy") == "optional"
            and activity.get("graded_by_default") is False
        )
        if not valid:
            report.add("error", "SPEAKING_DEFAULT_GRADING", path,
                       "Speaking practice must be optional practice recording and "
                       "ungraded by default.")

    if is_core_lesson:
        if len(reading) != 1:
            report.add("error", "READING_ACTIVITY_COUNT", path,
                       f"Each core lesson needs exactly one Reading Lab; found {len(reading)}.")
        for activity in reading:
            content = activity.get("content") or {}
            if isinstance(content, dict):
                unexpected_content = sorted(
                    set(content) - READING_AUTHORED_CONTENT_FIELDS
                )
                if unexpected_content:
                    report.add(
                        "error", "READING_CONTENT_FIELD_UNEXPECTED", path,
                        "Reading content exposes non-contract fields: "
                        + ", ".join(unexpected_content),
                    )
            passages = content.get("passages") if isinstance(content, dict) else None
            question_material = (
                content.get("question_material") if isinstance(content, dict) else None
            )
            questions = content.get("questions") if isinstance(content, dict) else None
            solutions = content.get("solutions") if isinstance(content, dict) else None
            passage_count = len(passages) if isinstance(passages, list) else 0
            question_count = len(questions) if isinstance(questions, list) else 0
            if passage_count == 0:
                report.add("error", "READING_PASSAGE_MISSING", path,
                           "Reading Lab must contain at least one passage paragraph.")
            if not isinstance(question_material, list) or any(
                not isinstance(row, str) for row in question_material
            ):
                report.add(
                    "error", "READING_QUESTION_MATERIAL_INVALID", path,
                    "Reading question_material must be an array of public strings.",
                )
            passage_rows = passages if isinstance(passages, list) else []
            if any(not isinstance(passage, dict) for passage in passage_rows):
                report.add("error", "READING_PASSAGE_ITEM_TYPE", path,
                           "Every Reading passage must be an object.")
            passage_unexpected = sorted({
                key
                for passage in passage_rows if isinstance(passage, dict)
                for key in set(passage) - READING_LEARNER_PASSAGE_FIELDS
            })
            if passage_unexpected:
                report.add(
                    "error", "READING_PASSAGE_FIELD_UNEXPECTED", path,
                    "Reading passages expose non-public fields: "
                    + ", ".join(passage_unexpected),
                )
            if question_count not in {13, 14}:
                report.add("error", "READING_QUESTION_COUNT", path,
                           f"Reading Lab must contain 13 or 14 questions; found {question_count}.")
            reading_question_rows = (
                questions if isinstance(questions, list) else []
            )
            if any(not isinstance(question, dict) for question in reading_question_rows):
                report.add("error", "READING_QUESTION_ITEM_TYPE", path,
                           "Every Reading question must be an object.")
            question_id_rows = [
                str(question.get("question_number") or "")
                for question in reading_question_rows if isinstance(question, dict)
            ]
            if "" in question_id_rows:
                report.add("error", "READING_QUESTION_ID_MISSING", path,
                           "Every Reading question needs a non-empty question_number.")
            duplicate_ids = sorted(
                question_id for question_id, occurrences in Counter(question_id_rows).items()
                if question_id and occurrences > 1
            )
            if duplicate_ids:
                report.add("error", "READING_QUESTION_ID_DUPLICATE", path,
                           "Reading question IDs must be unique; duplicates: "
                           + ", ".join(duplicate_ids))
            question_ids = set(question_id_rows)
            solution_ids = set(solutions) if isinstance(solutions, dict) else set()
            if question_ids != solution_ids:
                report.add("error", "READING_SOLUTION_COUNT", path,
                           "Reading solutions must map one-to-one to learner question IDs.")
            for qnum, solution in solutions.items() if isinstance(solutions, dict) else []:
                if not isinstance(solution, dict) or not str(solution.get("answer") or "").strip():
                    report.add("error", "READING_SOLUTION_INVALID", path,
                               f"Reading question {qnum or '?'} needs a private answer.")
            for question in reading_question_rows:
                if not isinstance(question, dict):
                    continue
                qnum = str(question.get("question_number") or "")
                unexpected_question = sorted(
                    set(question) - READING_LEARNER_QUESTION_FIELDS
                )
                if unexpected_question:
                    report.add(
                        "error", "READING_QUESTION_FIELD_UNEXPECTED", path,
                        "Reading learner question exposes non-public fields: "
                        + ", ".join(unexpected_question),
                    )
                leaked = READING_PRIVATE_QUESTION_FIELDS & set(question)
                if leaked:
                    report.add(
                        "error", "READING_ANSWER_LEAK", path,
                        "Reading learner question exposes private fields: "
                        + ", ".join(sorted(leaked)),
                    )
                options = question.get("options") or []
                if not isinstance(options, list) or any(
                    not isinstance(option, dict) for option in options
                ):
                    report.add(
                        "error", "READING_OPTION_ITEM_TYPE", path,
                        "Every Reading option must be an object.",
                    )
                    continue
                option_unexpected = sorted({
                    key
                    for option in options
                    for key in set(option) - LISTENING_LEARNER_OPTION_FIELDS
                })
                if option_unexpected:
                    report.add(
                        "error", "READING_OPTION_FIELD_UNEXPECTED", path,
                        "Reading options expose non-public fields: "
                        + ", ".join(option_unexpected),
                    )
                q_type = str(question.get("question_type") or "").strip().casefold()
                solution = solutions.get(qnum) if isinstance(solutions, dict) else None
                expected = str(
                    solution.get("answer") if isinstance(solution, dict) else ""
                ).strip()
                fixed_answers = None
                if re.search(r"\bt\s*/\s*f\s*/\s*ng\b", q_type):
                    fixed_answers = {"true", "false", "not given"}
                elif re.search(r"\by\s*/\s*n\s*/\s*ng\b", q_type):
                    fixed_answers = {"yes", "no", "not given"}
                if (fixed_answers is not None
                        and _grading_identity(expected) not in fixed_answers):
                    report.add(
                        "error", "READING_FIXED_CHOICE_ANSWER_INVALID", path,
                        f"Reading question {qnum or '?'} answer is not supported "
                        f"by {question.get('question_type') or 'fixed-choice'}.",
                    )
                if q_type not in {"mcq", "choice"}:
                    continue
                option_keys = [
                    str(_option_identity(option, index)).strip()
                    for index, option in enumerate(options)
                ]
                if not option_keys or any(not key for key in option_keys):
                    report.add(
                        "error", "READING_MCQ_OPTION_KEY_INVALID", path,
                        f"Reading MCQ {qnum or '?'} needs a non-empty key for every option.",
                    )
                normalized_option_keys = [
                    _grading_identity(key) for key in option_keys
                ]
                duplicate_keys = sorted(
                    key for key, occurrences in Counter(normalized_option_keys).items()
                    if key and occurrences > 1
                )
                if duplicate_keys:
                    report.add(
                        "error", "READING_MCQ_OPTION_KEY_DUPLICATE", path,
                        f"Reading MCQ {qnum or '?'} repeats option keys: "
                        + ", ".join(duplicate_keys),
                    )
                normalized_keys = {
                    _grading_identity(key) for key in option_keys if key
                }
                if _grading_identity(expected) not in normalized_keys:
                    report.add(
                        "error", "READING_MCQ_ANSWER_INVALID", path,
                        f"Reading MCQ {qnum or '?'} answer does not identify an option key.",
                    )

        if len(listening) != 1:
            report.add("error", "LISTENING_ACTIVITY_COUNT", path,
                       f"Each core lesson needs exactly one Listening Lab; found {len(listening)}.")
        for activity in listening:
            content = activity.get("content") or {}
            questions = content.get("questions") if isinstance(content, dict) else None
            solutions = content.get("solutions") if isinstance(content, dict) else None
            count = len(questions) if isinstance(questions, list) else 0
            if count != 6:
                report.add("error", "LISTENING_QUESTION_COUNT", path,
                           f"Listening Lab must contain exactly six questions; found {count}.")
            listening_question_rows = (
                questions if isinstance(questions, list) else []
            )
            for section in (
                content.get("sections") or [] if isinstance(content, dict) else []
            ):
                if not isinstance(section, dict) or not section.get("figure"):
                    continue
                figure = str(section.get("figure") or "").strip()
                figure_checksum = str(section.get("figure_checksum") or "")
                if not SHA256_RE.fullmatch(figure_checksum):
                    report.add(
                        "error", "LISTENING_FIGURE_CHECKSUM_INVALID", path,
                        f"Listening figure {figure} needs a SHA-256 checksum.",
                    )
                figure_path = (path.parent / figure).resolve()
                try:
                    figure_path.relative_to(path.parent.resolve())
                except ValueError:
                    report.add("error", "LISTENING_FIGURE_PATH_UNSAFE", path, figure)
                    continue
                if not figure_path.is_file():
                    report.add("error", "LISTENING_FIGURE_MISSING", figure_path,
                               f"Listening figure referenced by {path.name} is missing.")
                elif (SHA256_RE.fullmatch(figure_checksum)
                      and _sha256_file(figure_path) != figure_checksum):
                    report.add("error", "LISTENING_FIGURE_CHECKSUM_MISMATCH",
                               figure_path,
                               "Listening figure bytes do not match lesson metadata.")
                source_checksums = (
                    (lesson.get("provenance") or {}).get("source_checksums") or {}
                )
                source_matches = [
                    str(checksum)
                    for source_name, checksum in (
                        source_checksums.items()
                        if isinstance(source_checksums, dict) else []
                    )
                    if Path(str(source_name)).name == Path(figure).name
                ]
                if source_matches != [figure_checksum]:
                    report.add(
                        "error", "LISTENING_FIGURE_SOURCE_MISMATCH", path,
                        f"Listening figure {figure} must match exactly one source input.",
                    )
            if any(not isinstance(question, dict) for question in listening_question_rows):
                report.add("error", "LISTENING_QUESTION_ITEM_TYPE", path,
                           "Every Listening question must be an object.")
            question_rows = [
                question for question in listening_question_rows
                if isinstance(question, dict)
            ]
            nested_question_lists = [
                block.get("questions") or []
                for section in content.get("sections") or []
                if isinstance(section, dict)
                for block in section.get("question_blocks") or []
                if isinstance(block, dict)
            ] if isinstance(content, dict) else []
            if any(
                not isinstance(question, dict)
                for nested_questions in nested_question_lists
                for question in nested_questions
            ):
                report.add("error", "LISTENING_NESTED_QUESTION_ITEM_TYPE", path,
                           "Every nested Listening question must be an object.")
            nested_question_rows = [
                question
                for nested_questions in nested_question_lists
                for question in nested_questions
                if isinstance(question, dict)
            ]
            for section in (
                content.get("sections") or [] if isinstance(content, dict) else []
            ):
                if not isinstance(section, dict):
                    report.add(
                        "error", "LISTENING_SECTION_ITEM_TYPE", path,
                        "Every Listening section must be an object.",
                    )
                    continue
                section_unexpected = set(section) - LISTENING_LEARNER_SECTION_FIELDS
                if section_unexpected:
                    report.add(
                        "error", "LISTENING_ANSWER_LEAK", path,
                        "Listening learner section exposes non-public fields: "
                        + ", ".join(sorted(section_unexpected)),
                    )
                blocks = section.get("question_blocks") or []
                if not isinstance(blocks, list):
                    report.add(
                        "error", "LISTENING_BLOCK_LIST_TYPE", path,
                        "Listening question_blocks must be an array.",
                    )
                    continue
                for block in blocks:
                    if not isinstance(block, dict):
                        report.add(
                            "error", "LISTENING_BLOCK_ITEM_TYPE", path,
                            "Every Listening question block must be an object.",
                        )
                        continue
                    block_unexpected = set(block) - LISTENING_LEARNER_BLOCK_FIELDS
                    if block_unexpected:
                        report.add(
                            "error", "LISTENING_ANSWER_LEAK", path,
                            "Listening learner question block exposes non-public fields: "
                            + ", ".join(sorted(block_unexpected)),
                        )
            for question in [*question_rows, *nested_question_rows]:
                unexpected = set(question) - LISTENING_LEARNER_QUESTION_FIELDS
                authored_options = question.get("options") or []
                options = authored_options if isinstance(authored_options, list) else []
                if not isinstance(authored_options, list) or any(
                    not isinstance(option, dict) for option in authored_options
                ):
                    report.add(
                        "error", "LISTENING_OPTION_ITEM_TYPE", path,
                        "Every Listening option must be an object.",
                    )
                option_unexpected = {
                    key
                    for option in options if isinstance(option, dict)
                    for key in set(option) - LISTENING_LEARNER_OPTION_FIELDS
                }
                if unexpected or option_unexpected:
                    leaked = sorted(unexpected | option_unexpected)
                    report.add(
                        "error", "LISTENING_ANSWER_LEAK", path,
                        "Listening learner question exposes non-public fields: "
                        + ", ".join(leaked),
                    )
            question_id_rows = [
                str(question.get("question_number") or "") for question in question_rows
            ]
            if "" in question_id_rows:
                report.add("error", "LISTENING_QUESTION_ID_MISSING", path,
                           "Every Listening question needs a non-empty question_number.")
            duplicate_ids = sorted(
                question_id for question_id, occurrences in Counter(question_id_rows).items()
                if question_id and occurrences > 1
            )
            if duplicate_ids:
                report.add("error", "LISTENING_QUESTION_ID_DUPLICATE", path,
                           "Listening question IDs must be unique; duplicates: "
                           + ", ".join(duplicate_ids))
            question_ids = set(question_id_rows)
            solution_ids = {
                str(question_id) for question_id in solutions
            } if isinstance(solutions, dict) else set()
            if question_ids != solution_ids:
                report.add("error", "LISTENING_SOLUTION_COUNT", path,
                           "Listening solutions must map one-to-one to learner question IDs.")
            for question in question_rows:
                question_id = str(question.get("question_number") or "")
                solution = solutions.get(question_id) if isinstance(solutions, dict) else None
                if not isinstance(solution, dict):
                    continue
                if not str(solution.get("answer") or "").strip():
                    report.add("error", "LISTENING_SOLUTION_ANSWER_INVALID", path,
                               f"Listening question {question_id or '?'} needs a private answer.")
                if not str(solution.get("evidence") or "").strip():
                    report.add("error", "LISTENING_SOLUTION_EVIDENCE_INVALID", path,
                               f"Listening question {question_id or '?'} needs "
                               "evidence replay text.")
                timing = solution.get("timing")
                answer_span = timing.get("answer_span") if isinstance(timing, dict) else None
                start = answer_span.get("start") if isinstance(answer_span, dict) else None
                end = answer_span.get("end") if isinstance(answer_span, dict) else None
                valid_span = (
                    isinstance(start, (int, float)) and not isinstance(start, bool)
                    and isinstance(end, (int, float)) and not isinstance(end, bool)
                    and 0 <= start < end
                )
                if not valid_span:
                    report.add("error", "LISTENING_SOLUTION_SPAN_INVALID", path,
                               f"Listening question {question_id or '?'} needs "
                               "a usable answer span.")
                if str(question.get("question_type") or "").lower() == "mcq":
                    authored_options = question.get("options") or []
                    options = authored_options if isinstance(authored_options, list) else []
                    option_keys = [
                        str(_option_identity(option, index)).strip()
                        for index, option in enumerate(options)
                        if isinstance(option, dict)
                    ]
                    if not option_keys or any(not key for key in option_keys):
                        report.add(
                            "error", "LISTENING_MCQ_OPTION_KEY_INVALID", path,
                            f"Listening question {question_id or '?'} needs a "
                            "non-empty learner option identifier.",
                        )
                    normalized_keys = {
                        _grading_identity(key) for key in option_keys if key
                    }
                    if _grading_identity(solution.get("answer")) not in normalized_keys:
                        report.add("error", "LISTENING_MCQ_ANSWER_INVALID", path,
                                   f"Listening question {question_id or '?'} answer "
                                   "must match an option key.")
            release_status = str(activity.get("media_release_status") or "missing")
            if release_status != "approved":
                report.add("warning", "LISTENING_MEDIA_NOT_APPROVED", path,
                           f"Listening Lab media is {release_status}; learner playback is blocked.")


def _validate_unique_ids(rows: Any, keys: tuple[str, ...], path: Path,
                         report: ValidationReport, scope: str) -> list[dict[str, Any]]:
    if not isinstance(rows, list):
        report.add("error", f"{scope}_TYPE", path, f"{scope} must be an array.")
        return []
    objects: list[dict[str, Any]] = []
    seen = {key: set() for key in keys}
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            report.add("error", f"{scope}_ITEM_TYPE", path,
                       f"{scope}[{index}] must be an object.")
            continue
        objects.append(row)
        for key in keys:
            value = str(row.get(key) or "")
            if not value:
                report.add("error", f"{scope}_ID_MISSING", path,
                           f"{scope}[{index}] is missing {key}.")
            elif value in seen[key]:
                report.add("error", f"{scope}_ID_DUPLICATE", path,
                           f"Duplicate {key}={value!r} in {scope}.")
            else:
                seen[key].add(value)
    return objects


def _validate_provenance(lesson: dict[str, Any], path: Path,
                         report: ValidationReport) -> None:
    provenance = lesson.get("provenance")
    if not isinstance(provenance, dict):
        report.add("error", "PROVENANCE_MISSING", path,
                   "Lesson needs converter_version, content_checksum and source_checksums.")
        return
    if not str(provenance.get("converter_version") or "").strip():
        report.add("error", "CONVERTER_VERSION_MISSING", path,
                   "provenance.converter_version is required.")
    content_checksum = str(provenance.get("content_checksum") or "")
    if not SHA256_RE.fullmatch(content_checksum):
        report.add("error", "CONTENT_CHECKSUM_INVALID", path,
                   "provenance.content_checksum must be a SHA-256 hex digest.")
    elif content_checksum != lesson_content_checksum(lesson):
        report.add("error", "CONTENT_CHECKSUM_MISMATCH", path,
                   "Lesson content no longer matches provenance.content_checksum.")
    source_checksums = provenance.get("source_checksums")
    if not isinstance(source_checksums, dict) or not source_checksums:
        report.add("error", "SOURCE_CHECKSUMS_MISSING", path,
                   "provenance.source_checksums must map source paths to SHA-256 digests.")
        return
    for source_name, checksum in source_checksums.items():
        if not str(source_name).strip() or not SHA256_RE.fullmatch(str(checksum)):
            report.add("error", "SOURCE_CHECKSUM_INVALID", path,
                       f"Invalid source checksum entry for {source_name!r}.")


def _source_input_map(manifest: dict[str, Any]) -> dict[tuple[str, str], str]:
    rows = manifest.get("inputs") if isinstance(manifest, dict) else None
    if not isinstance(rows, list):
        return {}
    return {
        (str(row.get("root") or ""), str(row.get("path") or "")): str(
            row.get("sha256") or ""
        )
        for row in rows if isinstance(row, dict)
    }


def _validate_package_source_provenance(
    root: Path,
    package_manifest: dict[str, Any],
    source_manifest: dict[str, Any],
    lessons: list[tuple[Path, dict[str, Any]]],
    reviews: list[tuple[Path, dict[str, Any]]],
    report: ValidationReport,
) -> None:
    source_revision = str(source_manifest.get("source_revision") or "")
    if package_manifest.get("source_revision") != source_revision:
        report.add("error", "PACKAGE_SOURCE_REVISION_MISMATCH",
                   root / "course-manifest.json",
                   "Package source_revision must match source-inputs-manifest.json.")
    declared = _source_input_map(source_manifest)
    source_rows = {
        (str(row.get("root") or ""), str(row.get("path") or "")): row
        for row in source_manifest.get("inputs") or [] if isinstance(row, dict)
    }
    used_vocab_clip_lessons: dict[str, set[str]] = {}
    supplements = package_manifest.get("content_supplements")
    supplements = supplements if isinstance(supplements, dict) else {}
    common_errors = supplements.get("common_errors")
    vocabulary_audio = supplements.get("vocabulary_audio")
    for lesson_path, lesson in lessons:
        checksums = (lesson.get("provenance") or {}).get("source_checksums") or {}
        if not isinstance(checksums, dict):
            continue
        for relative, checksum in checksums.items():
            if declared.get(("source", str(relative))) != str(checksum):
                report.add("error", "LESSON_SOURCE_NOT_IN_MANIFEST", lesson_path,
                           f"Source provenance is absent or mismatched: {relative}.")
        lesson_supplements = (
            (lesson.get("provenance") or {}).get("content_supplements") or {}
        )
        lesson_common_errors = (
            lesson_supplements.get("common_errors")
            if isinstance(lesson_supplements, dict) else None
        )
        if lesson_common_errors != common_errors:
            report.add("error", "LESSON_COMMON_ERROR_REVISION_MISMATCH", lesson_path,
                       "Lesson common-error provenance must match the package supplement.")
        listening_rows = [
            row for row in ((lesson.get("media") or {}).get("audio") or [])
            if isinstance(row, dict) and row.get("role") == "listening_full_test"
        ]
        for audio in listening_rows:
            source_path = str(audio.get("source_path") or "")
            checksum = str(audio.get("checksum") or "")
            if (not source_path or checksums.get(source_path) != checksum
                    or declared.get(("source", source_path)) != checksum):
                report.add(
                    "error", "LISTENING_AUDIO_SOURCE_MISMATCH", lesson_path,
                    "Listening media checksum must match its declared authored input.",
                )
        for vocab in lesson.get("vocabulary") or []:
            if not isinstance(vocab, dict):
                continue
            audio_provenance = vocab.get("audio_provenance")
            audio_provenance = (
                audio_provenance if isinstance(audio_provenance, dict) else {}
            )
            if isinstance(vocabulary_audio, dict):
                for field in ("engine", "model_tag", "voice"):
                    if audio_provenance.get(field) != vocabulary_audio.get(field):
                        report.add(
                            "error", "VOCAB_AUDIO_PROVENANCE_MISMATCH", lesson_path,
                            f"{vocab.get('lesson_lexeme_id')} {field} does not match "
                            "the package audio supplement.",
                        )
            for ref_field, checksum_field in (
                ("audio_headword", "headword_checksum"),
                ("audio_example", "example_checksum"),
            ):
                relative = str(vocab.get(ref_field) or "")
                clip_name = Path(relative).name
                checksum = str(audio_provenance.get(checksum_field) or "")
                declared_checksum = declared.get((
                    "vocab_audio_bundle", f"clips/{clip_name}",
                ))
                if not clip_name or declared_checksum != checksum:
                    report.add(
                        "error", "VOCAB_AUDIO_SOURCE_NOT_IN_MANIFEST", lesson_path,
                        f"{vocab.get('lesson_lexeme_id')} {ref_field} is absent or "
                        "mismatched in the Kokoro input manifest.",
                    )
                elif lesson.get("lesson_id") in CORE_LESSON_SET:
                    used_vocab_clip_lessons.setdefault(
                        f"clips/{clip_name}", set()
                    ).add(str(lesson["lesson_id"]))
    locked = source_manifest.get("locked_revisions") or {}
    if (isinstance(locked, dict)
            and locked.get("authored_input_map_sha256")
            == APPROVED_AUTHORED_INPUT_MAP_SHA256):
        declared_clips = {
            relative: row
            for (root_name, relative), row in source_rows.items()
            if root_name == "vocab_audio_bundle" and relative.startswith("clips/")
        }
        for relative, row in declared_clips.items():
            actual_lessons = sorted(str(item) for item in row.get("lesson_ids") or [])
            expected_lessons = sorted(used_vocab_clip_lessons.get(relative, set()))
            if actual_lessons != expected_lessons:
                report.add(
                    "error", "VOCAB_AUDIO_INPUT_LESSONS_MISMATCH",
                    root / SOURCE_MANIFEST_NAME,
                    f"vocab_audio_bundle:{relative} lesson_ids do not match "
                    "the lessons that reference the clip.",
                )
    for review_path, review in reviews:
        provenance = review.get("provenance") or {}
        relative = str(provenance.get("source_path") or "")
        checksum = str(provenance.get("source_checksum") or "")
        if not relative or not SHA256_RE.fullmatch(checksum):
            report.add("error", "REVIEW_SOURCE_PROVENANCE_MISSING", review_path,
                       "Review needs source_path and source_checksum provenance.")
        elif declared.get(("source", relative)) != checksum:
            report.add("error", "REVIEW_SOURCE_NOT_IN_MANIFEST", review_path,
                       f"Source provenance is absent or mismatched: {relative}.")

    if not isinstance(common_errors, dict):
        report.add("error", "COMMON_ERROR_SUPPLEMENT_MISSING",
                   root / "course-manifest.json",
                   "The first release must declare the 88-item common-error supplement.")
    else:
        checksum = str(common_errors.get("checksum") or "")
        if common_errors.get("item_count") != 88:
            report.add("error", "COMMON_ERROR_SUPPLEMENT_COUNT",
                       root / "course-manifest.json",
                       "The common-error supplement must contain exactly 88 items.")
        declared_checksums = {
            digest for (root_name, _relative), digest in declared.items()
            if root_name == "common_error_overrides"
        }
        if not SHA256_RE.fullmatch(checksum) or checksum not in declared_checksums:
            report.add("error", "COMMON_ERROR_SOURCE_NOT_IN_MANIFEST",
                       root / "course-manifest.json",
                       "The common-error checksum must match a declared override input.")

    if not isinstance(vocabulary_audio, dict):
        report.add("error", "VOCAB_AUDIO_SUPPLEMENT_MISSING",
                   root / "course-manifest.json",
                   "The first release must declare the Kokoro vocabulary-audio bundle.")
    else:
        if vocabulary_audio.get("engine") != "kokoro":
            report.add("error", "VOCAB_AUDIO_ENGINE",
                       root / "course-manifest.json",
                       "Vocabulary audio must use Kokoro.")
        for field in ("model_tag", "voice"):
            if not str(vocabulary_audio.get(field) or "").strip():
                report.add("error", "VOCAB_AUDIO_METADATA_MISSING",
                           root / "course-manifest.json",
                           f"Vocabulary audio must declare {field}.")
        if vocabulary_audio.get("card_count") != 720:
            report.add("error", "VOCAB_AUDIO_CARD_COUNT",
                       root / "course-manifest.json",
                       "Vocabulary audio must cover all 720 cards.")
        locked = source_manifest.get("locked_revisions") or {}
        if vocabulary_audio.get("bundle_checksum") != locked.get(
            "kokoro_bundle_sha256"
        ):
            report.add("error", "VOCAB_AUDIO_BUNDLE_REVISION_MISMATCH",
                       root / "course-manifest.json",
                       "Vocabulary audio must match the locked Kokoro bundle revision.")
        if ("vocab_audio_bundle", "manifest.json") not in declared:
            report.add("error", "VOCAB_AUDIO_SOURCE_NOT_IN_MANIFEST",
                       root / "course-manifest.json",
                       "The Kokoro bundle manifest must be declared as a source input.")


def _validate_lesson(
    lesson: dict[str, Any],
    path: Path,
    report: ValidationReport,
    *,
    vocab_audio_required: bool = False,
) -> None:
    lesson_id = str(lesson.get("lesson_id") or "")
    expected = path.parent.name
    if lesson_id != expected:
        report.add("error", "LESSON_PATH_ID_MISMATCH", path,
                   f"lesson_id={lesson_id!r} does not match folder {expected!r}.")

    vocabulary = _validate_unique_ids(
        lesson.get("vocabulary"), ("lexeme_id", "lesson_lexeme_id"), path, report,
        "VOCABULARY",
    )
    if len(vocabulary) != 24:
        count = len(vocabulary)
        report.add("error", "VOCABULARY_COUNT", path,
                   f"Expected exactly 24 vocabulary objects, found {count}.")

    runtime = _object_field(lesson, "runtime_contract", path, report)
    if runtime.get("completion_requires_submission") is not False:
        report.add("error", "LESSON_SUBMISSION_GATE", path,
                   "Lesson completion must not require a Writing/Speaking submission.")
    if runtime.get("completion_requires_revision_after_feedback") is not False:
        report.add("error", "LESSON_REVISION_GATE", path,
                   "Lesson completion must not require revision of an unassigned production task.")

    legacy_content = _object_field(lesson, "content", path, report, required=False)
    if isinstance(legacy_content, dict) and legacy_content.get("sections"):
        if legacy_content.get("visibility") != "admin_only":
            report.add("error", "EDITORIAL_CONTENT_VISIBILITY", path,
                       "Legacy editorial sections may contain answer keys and must be admin_only.")

    quiz = _object_field(lesson, "adaptive_quiz", path, report)
    items = quiz.get("items") or []
    items = _validate_unique_ids(items, ("item_id",), path, report, "QUIZ")
    for item in items:
        unexpected = sorted(set(item) - QUIZ_AUTHORED_ITEM_FIELDS)
        if unexpected:
            report.add(
                "error", "QUIZ_ITEM_FIELD_UNEXPECTED", path,
                f"Item {item.get('item_id') or '?'} has non-contract fields: "
                + ", ".join(unexpected),
            )
        option_unexpected = sorted({
            key
            for option in item.get("options") or []
            if isinstance(option, dict)
            for key in set(option) - QUIZ_OPTION_FIELDS
        })
        if option_unexpected:
            report.add(
                "error", "QUIZ_OPTION_FIELD_UNEXPECTED", path,
                f"Item {item.get('item_id') or '?'} has non-contract option fields: "
                + ", ".join(option_unexpected),
            )
        input_type = str(item.get("input") or "")
        if input_type not in ALLOWED_INPUTS:
            report.add("error", "QUIZ_INPUT_UNSUPPORTED", path,
                       f"Item {item.get('item_id') or '?'} has unsupported input={input_type!r}.")
        if input_type == "match" and item.get("lexeme_id"):
            report.add(
                "error", "QUIZ_SELECTABLE_MATCH_UNSUPPORTED", path,
                f"Item {item.get('item_id') or '?'} is a selectable match question, "
                "which the first-release learner does not support.",
            )
        if item.get("lexeme_id") and input_type != "match":
            prompt = item.get("prompt")
            if not isinstance(prompt, str) or not prompt.strip():
                report.add(
                    "error", "QUIZ_PROMPT_INVALID", path,
                    f"Item {item.get('item_id') or '?'} needs a non-empty text prompt.",
                )
            if input_type != "choice" and item.get("options"):
                report.add(
                    "error", "QUIZ_NON_CHOICE_OPTIONS_INVALID", path,
                    f"Item {item.get('item_id') or '?'} cannot expose options "
                    f"for {input_type or 'non-choice'} input.",
                )
            has_expected = "answer" in item or "answer_index" in item
            expected = (
                item.get("answer") if "answer" in item
                else item.get("answer_index")
            )
            grading_valid = True
            if input_type == "choice":
                options = item.get("options")
                if not has_expected or not isinstance(options, list) or len(options) < 2:
                    grading_valid = False
                else:
                    option_keys = [
                        str(_option_identity(option, index)).strip()
                        for index, option in enumerate(options)
                    ]
                    if any(not key for key in option_keys):
                        report.add(
                            "error", "QUIZ_OPTION_ID_INVALID", path,
                            f"Item {item.get('item_id') or '?'} needs a non-empty "
                            "learner option identifier.",
                        )
                        grading_valid = False
                    elif isinstance(expected, int) and not isinstance(expected, bool):
                        grading_valid = 0 <= expected < len(options)
                    else:
                        grading_valid = _grading_identity(expected) in {
                            _grading_identity(key) for key in option_keys
                        }
            elif input_type == "boolean":
                grading_valid = has_expected and isinstance(expected, bool)
            elif input_type == "syllable":
                segments = item.get("segments")
                grading_valid = (
                    has_expected
                    and isinstance(expected, int)
                    and not isinstance(expected, bool)
                    and isinstance(segments, list)
                    and 0 <= expected < len(segments)
                )
            elif input_type == "text":
                accepted = item.get("accept")
                if isinstance(accepted, list):
                    grading_valid = bool(accepted) and all(
                        isinstance(value, str) and bool(value.strip())
                        for value in accepted
                    )
                elif isinstance(expected, list):
                    grading_valid = bool(expected) and all(
                        isinstance(value, str) and bool(value.strip())
                        for value in expected
                    )
                else:
                    grading_valid = (
                        has_expected
                        and isinstance(expected, str)
                        and bool(expected.strip())
                    )
            if not grading_valid:
                report.add(
                    "error", "QUIZ_GRADING_CONTRACT_INVALID", path,
                    f"Item {item.get('item_id') or '?'} has no usable "
                    f"{input_type or 'selectable'} answer contract.",
                )
        if "segments" in item:
            segments = item.get("segments")
            if input_type != "syllable":
                report.add(
                    "error", "QUIZ_SEGMENTS_INPUT_INVALID", path,
                    f"Item {item.get('item_id') or '?'} may expose segments only for syllable input.",
                )
            if (not isinstance(segments, list) or not segments
                    or any(not isinstance(segment, str) or not segment.strip()
                           for segment in segments)):
                report.add(
                    "error", "QUIZ_SEGMENTS_INVALID", path,
                    f"Item {item.get('item_id') or '?'} segments must be non-empty public strings.",
                )
        q_type = str(item.get("question_type") or item.get("type") or "").lower()
        if q_type in {"choice", "mcq"} and not ({"answer", "answer_index"} & item.keys()):
            report.add("error", "MCQ_ANSWER_MISSING", path,
                       f"Item {item.get('item_id') or '?'} needs one valid answer.")

    selectable_by_lexeme = {
        str(vocab.get("lexeme_id")): [
            item for item in items
            if str(item.get("lexeme_id") or "") == str(vocab.get("lexeme_id") or "")
            and item.get("input") != "match"
        ]
        for vocab in vocabulary if vocab.get("lexeme_id")
    }
    incomplete_lexemes = []
    selected_item_ids: list[str] = []
    for lexeme_id, scoped_items in selectable_by_lexeme.items():
        recognition = _pick_practice_candidate(
            [item for item in scoped_items if _practice_choice(item)],
            f"{lesson_id}:{lexeme_id}:r",
        )
        production = _pick_practice_candidate(
            [item for item in scoped_items if item.get("input") == "text"],
            f"{lesson_id}:{lexeme_id}:p",
        )
        if recognition is None or production is None:
            incomplete_lexemes.append(lexeme_id)
            continue
        selected_item_ids.extend([
            str(recognition.get("item_id") or ""),
            str(production.get("item_id") or ""),
        ])
    if incomplete_lexemes:
        report.add(
            "error", "QUIZ_SELECTABLE_INVENTORY_INCOMPLETE", path,
            "Each vocabulary lexeme needs one selectable recognition and one "
            "selectable production candidate; incomplete: "
            + ", ".join(incomplete_lexemes),
        )
    if (not incomplete_lexemes
            and (len(selected_item_ids) != 48
                 or len(set(selected_item_ids)) != 48)):
        report.add(
            "error", "PRACTICE_SELECTION_COUNT", path,
            "Deterministic practice selection must contain exactly 48 unique "
            "questions (one recognition and one production per lexeme).",
        )

    _validate_activity_policies(lesson, path, report)
    _validate_mcq_options(lesson, path, report)
    _validate_provenance(lesson, path, report)

    media = _object_field(lesson, "media", path, report)
    audio_rows = media.get("audio") or []
    if not isinstance(audio_rows, list):
        report.add("error", "MEDIA_AUDIO_TYPE", path, "media.audio must be an array.")
        audio_rows = []
    listening_rows = [
        audio for audio in audio_rows
        if isinstance(audio, dict) and audio.get("role") == "listening_full_test"
    ]
    if len(listening_rows) != 1:
        report.add("error", "LISTENING_MEDIA_COUNT", path,
                   "Lesson needs exactly one listening_full_test media row.")
    for audio in audio_rows:
        if not isinstance(audio, dict):
            report.add("error", "MEDIA_AUDIO_ROW_TYPE", path,
                       "Every media.audio row must be an object.")
            continue
        status = str(audio.get("status") or "missing")
        if status in NON_READY_AUDIO:
            report.add("warning", "AUDIO_NOT_APPROVED", path,
                       f"Audio {audio.get('audio_id') or '?'} is {status}; learner "
                       "playback is blocked.")
        if status == "approved":
            source_status = str(audio.get("source_release_status") or "").upper()
            approval = audio.get("approval")
            if source_status and source_status != "APPROVED" and not isinstance(approval, dict):
                report.add(
                    "error", "MEDIA_APPROVAL_MISSING", path,
                    "Approved media with a non-approved source status needs an auditable "
                    "content-owner approval record.",
                )
            expected_path = str(audio.get("expected_audio_path") or "").strip()
            checksum = str(audio.get("checksum") or "").strip()
            if audio.get("role") == "listening_full_test" and not expected_path:
                report.add("error", "MEDIA_PATH_MISSING", path,
                           "Approved Listening media needs expected_audio_path.")
            elif expected_path:
                asset = (path.parent / expected_path).resolve()
                try:
                    asset.relative_to(path.parent.resolve())
                except ValueError:
                    report.add("error", "MEDIA_PATH_UNSAFE", path, expected_path)
                else:
                    if not asset.is_file():
                        report.add("error", "MEDIA_FILE_MISSING", asset,
                                   "Approved Listening media is not packaged.")
                    if not SHA256_RE.fullmatch(checksum):
                        report.add("error", "MEDIA_CHECKSUM_INVALID", path,
                                   "Approved Listening media needs a SHA-256 checksum.")
                    elif asset.is_file() and _sha256_file(asset) != checksum:
                        report.add("error", "MEDIA_CHECKSUM_MISMATCH", asset,
                                   "Listening media bytes do not match lesson metadata.")

    for vocab in vocabulary if isinstance(vocabulary, list) else []:
        if not str(vocab.get("common_error") or "").strip():
            report.add("warning", "COMMON_ERROR_MISSING", path,
                       "Lexeme "
                       f"{vocab.get('lexeme_id') or vocab.get('headword') or '?'} "
                       "lacks common_error.")
        if vocab_audio_required:
            for field, checksum_field in (
                ("audio_headword", "headword_checksum"),
                ("audio_example", "example_checksum"),
            ):
                relative = str(vocab.get(field) or "").strip()
                provenance = vocab.get("audio_provenance")
                checksum = (
                    str(provenance.get(checksum_field) or "")
                    if isinstance(provenance, dict) else ""
                )
                if not relative:
                    report.add("error", "VOCAB_AUDIO_MISSING", path,
                               f"{vocab.get('lesson_lexeme_id')} lacks {field}.")
                    continue
                asset = (path.parents[2] / relative).resolve()
                try:
                    asset.relative_to(path.parents[2].resolve())
                except ValueError:
                    report.add("error", "VOCAB_AUDIO_PATH_UNSAFE", path, relative)
                    continue
                if not asset.is_file():
                    report.add("error", "VOCAB_AUDIO_FILE_MISSING", asset,
                               f"Referenced by {vocab.get('lesson_lexeme_id')}.")
                elif not SHA256_RE.fullmatch(checksum):
                    report.add("error", "VOCAB_AUDIO_CHECKSUM_INVALID", path,
                               f"{vocab.get('lesson_lexeme_id')} lacks {checksum_field}.")
                elif _sha256_file(asset) != checksum:
                    report.add("error", "VOCAB_AUDIO_CHECKSUM_MISMATCH", asset,
                               f"Referenced by {vocab.get('lesson_lexeme_id')}.")


def validate_package(package_path: str | Path) -> ValidationReport:
    root = Path(package_path).expanduser().resolve()
    report = ValidationReport(package_path=str(root))
    manifest = _read_json(root / "course-manifest.json", report)
    if manifest is None:
        return report
    _validate_manifest(root, manifest, report)

    # AVOC-0002 FR-003 requires both checksum-bound clips on every core card;
    # omitting supplement metadata must not disable the per-card validation.
    vocab_audio_required = True

    source_manifest_path = root / SOURCE_MANIFEST_NAME
    source_report = validate_source_inputs_manifest(source_manifest_path)
    report.errors.extend(source_report.errors)
    report.warnings.extend(source_report.warnings)
    source_manifest = _read_json(source_manifest_path, ValidationReport(str(root))) or {}
    locked = source_manifest.get("locked_revisions")
    generated_lock = (
        str(locked.get("generated_package_sha256") or "")
        if isinstance(locked, dict) else ""
    )
    if generated_lock and generated_lock != generated_package_revision(manifest):
        report.add(
            "error", "GENERATED_PACKAGE_REVISION_MISMATCH",
            root / "course-manifest.json",
            "The generated-package lock does not match the package manifest identity.",
        )

    ids = _manifest_lesson_ids(manifest)
    manifest_lessons = manifest.get("lessons") or []
    lesson_rows = manifest_lessons if isinstance(manifest_lessons, list) else []
    loaded_lessons: list[tuple[Path, dict[str, Any]]] = []
    loaded_reviews: list[tuple[Path, dict[str, Any]]] = []
    for lesson_id in ids:
        if not re.fullmatch(r"ADV-T\d{2}", lesson_id):
            report.add("error", "LESSON_ID_FORMAT", root / "course-manifest.json",
                       f"Invalid lesson ID format: {lesson_id!r}.")
            continue
        path = root / "lessons" / lesson_id / "lesson.json"
        lesson = _read_json(path, report)
        if lesson is None:
            continue
        loaded_lessons.append((path, lesson))
        report.checked_lessons += 1
        _validate_lesson(
            lesson, path, report, vocab_audio_required=vocab_audio_required
        )
        manifest_row = next(
            (row for row in lesson_rows if isinstance(row, dict)
             and row.get("lesson_id") == lesson_id),
            {},
        )
        lesson_provenance = lesson.get("provenance")
        lesson_checksum = (
            lesson_provenance.get("content_checksum")
            if isinstance(lesson_provenance, dict) else None
        )
        if manifest_row.get("content_checksum") != lesson_checksum:
            report.add("error", "MANIFEST_LESSON_CHECKSUM_MISMATCH", path,
                       "Manifest lesson checksum does not match the lesson file.")

    manifest_reviews = manifest.get("reviews") or []
    review_rows = manifest_reviews if isinstance(manifest_reviews, list) else []
    for review_id in _manifest_review_ids(manifest):
        if not re.fullmatch(r"R\d{2}", review_id):
            report.add("error", "REVIEW_ID_FORMAT", root / "course-manifest.json",
                       f"Invalid review ID format: {review_id!r}.")
            continue
        path = root / "reviews" / f"{review_id}.json"
        review = _read_json(path, report)
        if review is None:
            continue
        loaded_reviews.append((path, review))
        if str(review.get("review_id") or "") != review_id:
            report.add("error", "REVIEW_PATH_ID_MISMATCH", path,
                       f"review_id does not match manifest ID {review_id}.")
        items = _validate_unique_ids(
            review.get("items"), ("item_id",), path, report, "REVIEW_ITEM",
        )
        if not items:
            report.add("error", "REVIEW_ITEMS_MISSING", path,
                       f"{review_id} must contain at least one review item.")
        _validate_mcq_options({"items": items}, path, report)
        expected_lessons = [f"T{i:02d}" for i in range(1, int(review_id[1:]) * 5 + 1)]
        if review.get("review_of_lessons") != expected_lessons:
            report.add("error", "REVIEW_LESSON_SCOPE", path,
                       f"{review_id} must have cumulative scope through "
                       f"T{len(expected_lessons):02d}.")
        provenance_value = review.get("provenance")
        provenance = provenance_value if isinstance(provenance_value, dict) else {}
        review_checksum = str(provenance.get("content_checksum") or "")
        if not SHA256_RE.fullmatch(review_checksum):
            report.add("error", "REVIEW_CHECKSUM_INVALID", path,
                       "Review provenance.content_checksum must be SHA-256.")
        elif review_checksum != _checksum_without(review, "provenance", "content_checksum"):
            report.add("error", "REVIEW_CHECKSUM_MISMATCH", path,
                       "Review content no longer matches provenance.content_checksum.")

        manifest_row = next(
            (row for row in review_rows if isinstance(row, dict)
             and row.get("review_id") == review_id),
            {},
        )
        if manifest_row.get("content_checksum") != review_checksum:
            report.add("error", "MANIFEST_REVIEW_CHECKSUM_MISMATCH", path,
                       "Manifest review checksum does not match the review file.")

    generated_dirs = {p.name for p in (root / "lessons").glob("ADV-T*") if p.is_dir()}
    unreferenced = sorted(generated_dirs - set(ids))
    if unreferenced:
        report.add("warning", "UNREFERENCED_LESSON_DIR", root / "lessons",
                   f"Directories not referenced by manifest: {', '.join(unreferenced)}")
    if source_manifest:
        _validate_package_source_provenance(
            root, manifest, source_manifest, loaded_lessons, loaded_reviews, report,
        )
    return report


def validate_listening_source_directory(
    source_path: str | Path,
    report: ValidationReport | None = None,
) -> ValidationReport:
    """Add pre-converter checks for the 30 canonical Listening JSON files."""
    root = Path(source_path).expanduser().resolve()
    if report is None:
        report = ValidationReport(package_path=str(root))
    files = sorted(root.glob("VOC-ADV-LIS-LSN-T??.json"))
    if len(files) != 30:
        report.add("error", "LISTENING_SOURCE_COUNT", root,
                   f"Expected 30 core Listening source files, found {len(files)}.")

    for path in files:
        source = _read_json(path, report)
        if source is None:
            continue
        _validate_mcq_options(source, path, report)
        questions: list[dict[str, Any]] = []
        answers: list[dict[str, Any]] = []
        for section in source.get("sections") or []:
            if not isinstance(section, dict):
                continue
            for block in section.get("question_blocks") or []:
                if not isinstance(block, dict):
                    continue
                questions.extend(q for q in block.get("questions") or [] if isinstance(q, dict))
                answers.extend(a for a in block.get("answers") or [] if isinstance(a, dict))
        if len(questions) != 6:
            report.add("error", "LISTENING_SOURCE_QUESTION_COUNT", path,
                       f"Expected six questions, found {len(questions)}.")
        answer_numbers = [
            str(a.get("qnum") or a.get("question_number") or "") for a in answers
        ]
        duplicate_answers = sorted(
            key for key, count in Counter(answer_numbers).items() if key and count > 1
        )
        if duplicate_answers:
            report.add("error", "LISTENING_SOURCE_ANSWER_DUPLICATE", path,
                       "Duplicate answer records for questions: "
                       f"{', '.join(duplicate_answers)}.")
        answer_by_q = {
            str(a.get("qnum") or a.get("question_number") or ""): a
            for a in answers
        }
        for question in questions:
            qnum = str(question.get("question_number") or question.get("qnum") or "")
            answer = answer_by_q.get(qnum)
            if not answer:
                report.add("error", "LISTENING_SOURCE_ANSWER_MISSING", path,
                           f"Question {qnum or '?'} has no answer record.")
                continue
            if not str(answer.get("evidence") or "").strip():
                report.add("error", "LISTENING_SOURCE_EVIDENCE_MISSING", path,
                           f"Question {qnum or '?'} has no evidence text.")
            if str(question.get("question_type") or "").lower() == "mcq":
                options = question.get("options") or []
                option_keys = {
                    _grading_identity(option.get("letter") or option.get("key"))
                    for option in options if isinstance(option, dict)
                }
                if _grading_identity(answer.get("answer")) not in option_keys:
                    report.add("error", "LISTENING_SOURCE_ANSWER_INVALID", path,
                               f"Question {qnum or '?'} answer does not identify an option.")
    return report
