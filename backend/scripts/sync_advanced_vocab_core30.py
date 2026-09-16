#!/usr/bin/env python3
"""Validate and copy the authored Advanced Vocabulary core-30 package.

The script copies only runtime-required files into deterministic deploy paths.
It does not modify the source package. Dry-run is the default; add ``--write``
to update the repository snapshot.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
_REPO = _BACKEND.parent
_CONTENT = _BACKEND / "content" / "advanced_vocab"
_PUBLIC = _REPO / "frontend" / "public" / "assets" / "advanced-vocab"
_EXPECTED_IDS = tuple(f"ADV-T{number:02d}" for number in range(1, 31))
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.advanced_vocab_package_validator import (  # noqa: E402
    CORE_REVIEW_IDS,
    SOURCE_MANIFEST_NAME,
    lesson_content_checksum,
    review_content_checksum,
    validate_package,
)


def _read(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Không đọc được JSON: {path}") from exc


def _require_file(path: Path) -> Path:
    if not path.is_file() or path.stat().st_size == 0:
        raise SystemExit(f"Thiếu asset: {path}")
    return path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_source_asset(path: Path, checksum: str | None = None) -> None:
    _require_file(path)
    if checksum and _sha256(path) != checksum:
        raise SystemExit(f"Sai checksum source asset: {path}")


def _copy(source: Path, target: Path, *, write: bool,
          checksum: str | None = None, immutable: bool = False) -> None:
    _verify_source_asset(source, checksum)
    source_checksum = _sha256(source)
    if immutable and target.is_file() and _sha256(target) != source_checksum:
        raise SystemExit(f"Không được ghi đè snapshot bất biến: {target}")
    if write:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    elif not target.is_file():
        return
    _require_file(target)
    if _sha256(target) != source_checksum:
        raise SystemExit(f"Snapshot deploy không khớp source: {target}")


def _listening_figure_source(
    source: Path, course_source: Path | None, lesson_id: str, figure: str,
) -> Path:
    packaged = source / "lessons" / lesson_id / figure
    if packaged.is_file():
        return packaged
    if course_source is None:
        raise SystemExit(
            f"{lesson_id}: source package thiếu {figure}; cần --course-source."
        )
    matches = [
        path for path in course_source.rglob(Path(figure).name) if path.is_file()
    ]
    if len(matches) != 1:
        raise SystemExit(
            f"{lesson_id}: cần đúng một source figure {Path(figure).name}, "
            f"tìm thấy {len(matches)}."
        )
    return matches[0]


def _sync_listening_figure(
    source: Path, course_source: Path | None, lesson_id: str, figure: str,
    *, write: bool, content_checksum: str | None = None,
    checksum: str | None = None,
) -> Path:
    source_asset = _listening_figure_source(
        source, course_source, lesson_id, figure,
    )
    target = _PUBLIC / lesson_id / "listening" / Path(figure).name
    if content_checksum:
        _copy(
            source_asset,
            _PUBLIC / "versions" / lesson_id / content_checksum
            / "listening" / Path(figure).name,
            write=write, checksum=checksum,
            immutable=True,
        )
    _copy(source_asset, target, write=write, checksum=checksum)
    return target


def _sync_lesson(source_lesson: Path, lesson_id: str, checksum: str, *,
                 write: bool) -> str | None:
    target = _CONTENT / f"{lesson_id}.json"
    previous_checksum = None
    if target.is_file():
        previous = _read(target)
        previous_checksum = str(
            (previous.get("provenance") or {}).get("content_checksum") or ""
        )
        if (not previous_checksum
                or lesson_content_checksum(previous) != previous_checksum):
            raise SystemExit(f"{lesson_id}: snapshot hiện tại có checksum sai.")
        _copy(
            target,
            _CONTENT / "versions" / lesson_id / f"{previous_checksum}.json",
            write=write,
            immutable=True,
        )
    _copy(source_lesson, target, write=write)
    _copy(
        source_lesson,
        _CONTENT / "versions" / lesson_id / f"{checksum}.json",
        write=write,
        immutable=True,
    )
    return previous_checksum


def _sync_review(source_review: Path, review_id: str, checksum: str, *,
                 write: bool) -> str | None:
    target = _CONTENT / "reviews" / f"{review_id}.json"
    previous_checksum = None
    if target.is_file():
        previous = _read(target)
        previous_checksum = str(
            (previous.get("provenance") or {}).get("content_checksum") or ""
        )
        if (not previous_checksum
                or review_content_checksum(previous) != previous_checksum):
            raise SystemExit(f"{review_id}: snapshot review hiện tại có checksum sai.")
        _copy(
            target,
            _CONTENT / "versions" / "reviews" / review_id
            / f"{previous_checksum}.json",
            write=write,
            immutable=True,
        )
    _copy(source_review, target, write=write)
    _copy(
        source_review,
        _CONTENT / "versions" / "reviews" / review_id / f"{checksum}.json",
        write=write,
        immutable=True,
    )
    return previous_checksum


def _archive_asset_snapshot(lesson_id: str, checksum: str | None, *,
                            write: bool) -> None:
    """Seed the immutable media snapshot before replacing canonical assets."""
    canonical_root = _PUBLIC / lesson_id
    if not checksum or not canonical_root.is_dir():
        return
    version_root = _PUBLIC / "versions" / lesson_id / checksum
    for source_asset in canonical_root.rglob("*"):
        if source_asset.is_file():
            _copy(
                source_asset,
                version_root / source_asset.relative_to(canonical_root),
                write=write,
                immutable=True,
            )


def _sync_asset(source: Path, canonical_target: Path, lesson_id: str,
                content_checksum: str, *, write: bool,
                checksum: str | None = None) -> Path:
    relative = canonical_target.relative_to(_PUBLIC / lesson_id)
    versioned_target = (
        _PUBLIC / "versions" / lesson_id / content_checksum / relative
    )
    _copy(
        source, versioned_target, write=write, checksum=checksum, immutable=True,
    )
    _copy(source, canonical_target, write=write, checksum=checksum)
    return canonical_target


def _writing_asset_checksum(lesson: dict, ref: str) -> str:
    """Bind a packaged Writing illustration to its authored source checksum."""
    source_checksums = (lesson.get("provenance") or {}).get("source_checksums") or {}
    asset_name = Path(ref).name
    matches = []
    for source_name, checksum in (
        source_checksums.items() if isinstance(source_checksums, dict) else []
    ):
        normalized_name = str(source_name).replace("\\", "/")
        if ("06_WT1_Illustrations" in normalized_name
                and Path(normalized_name).name == asset_name):
            matches.append(str(checksum))
    if len(matches) != 1:
        raise SystemExit(
            f"{lesson.get('lesson_id') or '?'}: cần đúng một checksum source "
            f"cho Writing asset {asset_name}; tìm thấy {len(matches)}."
        )
    return matches[0]


def _sync_writing_asset(source: Path, lesson: dict, lesson_id: str, ref: str,
                        content_checksum: str, *, write: bool) -> Path:
    source_asset = source / "lessons" / lesson_id / ref
    target = _PUBLIC / lesson_id / "writing" / Path(ref).name
    return _sync_asset(
        source_asset, target, lesson_id, content_checksum, write=write,
        checksum=_writing_asset_checksum(lesson, ref),
    )


def _prepare_lesson(source: Path, course_source: Path | None,
                    lesson_id: str) -> dict:
    """Validate lesson identity and every deploy asset without mutating targets."""
    source_lesson = source / "lessons" / lesson_id / "lesson.json"
    lesson = _read(source_lesson)
    if lesson.get("lesson_id") != lesson_id:
        raise SystemExit(f"Sai lesson_id trong {source_lesson}")
    declared_checksum = str(
        (lesson.get("provenance") or {}).get("content_checksum") or ""
    )
    actual_checksum = lesson_content_checksum(lesson)
    if declared_checksum != actual_checksum:
        raise SystemExit(f"{lesson_id}: nội dung không khớp content_checksum.")
    vocabulary = lesson.get("vocabulary") or []
    if len(vocabulary) != 24 or not all(
            str(word.get("common_error") or "").strip() for word in vocabulary):
        raise SystemExit(f"{lesson_id}: cần 24 từ và common_error cho mọi từ.")

    asset_plan: list[tuple[Path, Path, str | None]] = []
    for word in vocabulary:
        provenance = word.get("audio_provenance") or {}
        for field in ("audio_headword", "audio_example"):
            ref = str(word.get(field) or "")
            checksum_field = ("headword_checksum" if field == "audio_headword"
                              else "example_checksum")
            source_asset = source / ref
            checksum = provenance.get(checksum_field)
            _verify_source_asset(source_asset, checksum)
            asset_plan.append((
                source_asset,
                _PUBLIC / lesson_id / "vocab" / Path(ref).name,
                checksum,
            ))
    audio_rows = (lesson.get("media") or {}).get("audio") or []
    listening_rows = [
        row for row in audio_rows
        if isinstance(row, dict) and row.get("role") == "listening_full_test"
    ]
    if len(listening_rows) != 1:
        raise SystemExit(
            f"{lesson_id}: cần đúng một media row listening_full_test."
        )
    listening_meta = listening_rows[0]
    expected_audio_path = str(
        listening_meta.get("expected_audio_path") or ""
    ).strip()
    listening_checksum = str(listening_meta.get("checksum") or "").strip()
    if expected_audio_path != "assets/audio/full_test.mp3":
        raise SystemExit(
            f"{lesson_id}: listening_full_test thiếu expected_audio_path chuẩn."
        )
    if not re.fullmatch(r"[0-9a-f]{64}", listening_checksum, re.IGNORECASE):
        raise SystemExit(
            f"{lesson_id}: listening_full_test thiếu SHA-256 hợp lệ."
        )
    listening = source / "lessons" / lesson_id / expected_audio_path
    _verify_source_asset(listening, listening_checksum)
    asset_plan.append((
        listening,
        _PUBLIC / lesson_id / "listening" / "full_test.mp3",
        listening_meta.get("checksum"),
    ))
    listening_content = next(
        (row.get("content") or {} for row in lesson.get("activities") or []
         if row.get("activity_type") == "listening_lab"),
        {},
    )
    for section in listening_content.get("sections") or []:
        figure = str(section.get("figure") or "")
        if figure:
            figure_source = _listening_figure_source(
                source, course_source, lesson_id, figure,
            )
            figure_checksum = section.get("figure_checksum")
            _verify_source_asset(figure_source, figure_checksum)
            asset_plan.append((
                figure_source,
                _PUBLIC / lesson_id / "listening" / Path(figure).name,
                figure_checksum,
            ))
    writing_refs = [
        str(ref) for ref in (lesson.get("media") or {}).get("wt1_illustrations") or []
    ]
    writing = next(
        (row for row in lesson.get("activities") or []
         if isinstance(row, dict) and row.get("activity_type") == "writing_reference"),
        {},
    )
    tasks = (writing.get("content") or {}).get("tasks") or {}
    task_1_refs = [
        str(ref) for ref in (tasks.get("task_1") or {}).get("illustrations") or []
    ]
    if task_1_refs != writing_refs:
        raise SystemExit(
            f"{lesson_id}: Task 1 illustrations không khớp media deploy inventory."
        )
    if {Path(ref).suffix.lower() for ref in writing_refs} != {".svg", ".png"}:
        raise SystemExit(
            f"{lesson_id}: cần đúng cặp SVG/PNG cho Writing Task 1."
        )
    for ref in writing_refs:
        source_asset = source / "lessons" / lesson_id / ref
        checksum = _writing_asset_checksum(lesson, ref)
        _verify_source_asset(source_asset, checksum)
        asset_plan.append((
            source_asset,
            _PUBLIC / lesson_id / "writing" / Path(ref).name,
            checksum,
        ))
    return {
        "lesson_id": lesson_id,
        "source_lesson": source_lesson,
        "lesson": lesson,
        "actual_checksum": actual_checksum,
        "vocabulary": vocabulary,
        "listening": listening,
        "listening_meta": listening_meta,
        "listening_content": listening_content,
        "writing_refs": writing_refs,
        "asset_plan": asset_plan,
    }


def _prepare_reviews(source: Path, manifest: dict,
                     prepared_lessons: list[dict]) -> list[dict]:
    review_rows = manifest.get("reviews") or []
    review_ids = tuple(
        str(row.get("review_id") or "")
        for row in review_rows if isinstance(row, dict)
    )
    if review_ids != CORE_REVIEW_IDS:
        raise SystemExit("Manifest phải chứa đúng R01…R06 theo thứ tự.")

    prepared_reviews = []
    checksums: dict[str, str] = {}
    for row in review_rows:
        review_id = str(row["review_id"])
        source_review = source / "reviews" / f"{review_id}.json"
        review = _read(source_review)
        if review.get("review_id") != review_id:
            raise SystemExit(f"Sai review_id trong {source_review}")
        declared_checksum = str(
            (review.get("provenance") or {}).get("content_checksum") or ""
        )
        actual_checksum = review_content_checksum(review)
        if declared_checksum != actual_checksum:
            raise SystemExit(f"{review_id}: nội dung không khớp content_checksum.")
        if str(row.get("content_checksum") or "") != actual_checksum:
            raise SystemExit(f"{review_id}: manifest không khớp content_checksum.")
        checksums[review_id] = actual_checksum
        prepared_reviews.append({
            "review_id": review_id,
            "source_review": source_review,
            "review": review,
            "actual_checksum": actual_checksum,
        })

    for prepared in prepared_lessons:
        lesson = prepared["lesson"]
        lesson_id = prepared["lesson_id"]
        review_id = str(
            ((lesson.get("review") or {}).get("checkpoint_review_id")) or ""
        )
        expected_review_id = f"R{((int(lesson_id[-2:]) - 1) // 5) + 1:02d}"
        if review_id != expected_review_id or review_id not in checksums:
            raise SystemExit(
                f"{lesson_id}: checkpoint_review_id phải là {expected_review_id}."
            )
        prepared["checkpoint_review_id"] = review_id
        prepared["checkpoint_review_checksum"] = checksums[review_id]
    return prepared_reviews


def _preflight_destinations(prepared_lessons: list[dict],
                            prepared_reviews: list[dict]) -> None:
    """Reject stale/colliding deploy state before the first target mutation."""
    expected_content = {f"{row['lesson_id']}.json" for row in prepared_lessons}
    actual_content = {
        path.name for path in _CONTENT.glob("*.json")
        if path.name not in {"core30-manifest.json", SOURCE_MANIFEST_NAME}
    }
    expected_reviews = {
        f"{row['review_id']}.json" for row in prepared_reviews
    }
    review_root = _CONTENT / "reviews"
    actual_reviews = {
        path.name for path in review_root.glob("*.json") if path.is_file()
    }
    deployment_exists = bool(
        actual_content
        or actual_reviews
        or (_CONTENT / "core30-manifest.json").is_file()
        or (_CONTENT / SOURCE_MANIFEST_NAME).is_file()
        or any(path.is_file() for path in _PUBLIC.rglob("*"))
    )
    if deployment_exists and actual_content != expected_content:
        raise SystemExit(
            "Snapshot content không đầy đủ trước khi sync: "
            f"thiếu={sorted(expected_content - actual_content)}, "
            f"thừa={sorted(actual_content - expected_content)}"
        )
    if deployment_exists and actual_reviews != expected_reviews:
        raise SystemExit(
            "Snapshot review không đầy đủ trước khi sync: "
            f"thiếu={sorted(expected_reviews - actual_reviews)}, "
            f"thừa={sorted(actual_reviews - expected_reviews)}"
        )

    for prepared in prepared_reviews:
        review_id = prepared["review_id"]
        source_review = prepared["source_review"]
        new_checksum = prepared["actual_checksum"]
        canonical_review = review_root / f"{review_id}.json"
        if canonical_review.is_file():
            previous = _read(canonical_review)
            previous_checksum = str(
                (previous.get("provenance") or {}).get("content_checksum") or ""
            )
            if (not previous_checksum
                    or review_content_checksum(previous) != previous_checksum):
                raise SystemExit(
                    f"{review_id}: snapshot review hiện tại có checksum sai."
                )
            previous_version = (
                _CONTENT / "versions" / "reviews" / review_id
                / f"{previous_checksum}.json"
            )
            if (previous_version.is_file()
                    and _sha256(previous_version) != _sha256(canonical_review)):
                raise SystemExit(
                    f"Không được ghi đè snapshot bất biến: {previous_version}"
                )
        next_version = (
            _CONTENT / "versions" / "reviews" / review_id
            / f"{new_checksum}.json"
        )
        if (next_version.is_file()
                and _sha256(next_version) != _sha256(source_review)):
            raise SystemExit(f"Không được ghi đè snapshot bất biến: {next_version}")

    for prepared in prepared_lessons:
        lesson_id = prepared["lesson_id"]
        source_lesson = prepared["source_lesson"]
        new_checksum = prepared["actual_checksum"]
        canonical_lesson = _CONTENT / f"{lesson_id}.json"
        previous_checksum: str | None = None
        if canonical_lesson.is_file():
            previous = _read(canonical_lesson)
            previous_checksum = str(
                (previous.get("provenance") or {}).get("content_checksum") or ""
            )
            if (not previous_checksum
                    or lesson_content_checksum(previous) != previous_checksum):
                raise SystemExit(f"{lesson_id}: snapshot hiện tại có checksum sai.")
            previous_version = (
                _CONTENT / "versions" / lesson_id / f"{previous_checksum}.json"
            )
            if (previous_version.is_file()
                    and _sha256(previous_version) != _sha256(canonical_lesson)):
                raise SystemExit(
                    f"Không được ghi đè snapshot bất biến: {previous_version}"
                )
        next_version = _CONTENT / "versions" / lesson_id / f"{new_checksum}.json"
        if next_version.is_file() and _sha256(next_version) != _sha256(source_lesson):
            raise SystemExit(f"Không được ghi đè snapshot bất biến: {next_version}")

        canonical_root = _PUBLIC / lesson_id
        expected_targets = {target for _source, target, _checksum in prepared["asset_plan"]}
        actual_targets = {
            path for path in canonical_root.rglob("*") if path.is_file()
        }
        if deployment_exists and actual_targets != expected_targets:
            raise SystemExit(
                f"{lesson_id}: snapshot asset không đầy đủ trước khi sync; "
                "thiếu="
                f"{sorted(str(path.relative_to(_REPO)) for path in expected_targets - actual_targets)}, "
                "thừa="
                f"{sorted(str(path.relative_to(_REPO)) for path in actual_targets - expected_targets)}"
            )

        next_version_root = _PUBLIC / "versions" / lesson_id / new_checksum
        expected_relative = {
            target.relative_to(canonical_root) for target in expected_targets
        }
        actual_versioned = {
            path.relative_to(next_version_root)
            for path in next_version_root.rglob("*") if path.is_file()
        }
        unexpected_versioned = sorted(
            str(path) for path in actual_versioned - expected_relative
        )
        if unexpected_versioned:
            raise SystemExit(
                f"{lesson_id}: snapshot asset versioned có file thừa trước khi sync: "
                f"{unexpected_versioned}"
            )

        for source_asset, canonical_target, _checksum in prepared["asset_plan"]:
            relative = canonical_target.relative_to(canonical_root)
            next_target = next_version_root / relative
            if next_target.is_file() and _sha256(next_target) != _sha256(source_asset):
                raise SystemExit(f"Không được ghi đè snapshot bất biến: {next_target}")
            if previous_checksum and canonical_target.is_file():
                previous_target = (
                    _PUBLIC / "versions" / lesson_id / previous_checksum / relative
                )
                if (previous_target.is_file()
                        and _sha256(previous_target) != _sha256(canonical_target)):
                    raise SystemExit(
                        f"Không được ghi đè snapshot bất biến: {previous_target}"
                    )


def sync(source: Path, *, write: bool, course_source: Path | None = None) -> dict:
    manifest = _read(source / "course-manifest.json")
    qa = _read(source / "QA_REPORT.json")
    current_report = validate_package(source)
    if not current_report.publish_ready:
        summary = current_report.to_dict()["summary"]
        raise SystemExit(
            "Source package hiện tại không đạt publish-ready: "
            f"{summary['errors']} error, {summary['warnings']} warning."
        )
    lesson_ids = tuple(row.get("lesson_id") for row in manifest.get("lessons") or [])
    if lesson_ids != _EXPECTED_IDS:
        raise SystemExit("Manifest phải chứa đúng ADV-T01…ADV-T30 theo thứ tự.")
    if qa.get("publish_ready") is not True or (qa.get("summary") or {}).get("errors") != 0:
        raise SystemExit("QA_REPORT của source package chưa đạt publish-ready.")

    # Preflight the complete package before the first filesystem mutation.
    prepared_lessons = [
        _prepare_lesson(source, course_source, lesson_id)
        for lesson_id in lesson_ids
    ]
    prepared_reviews = _prepare_reviews(source, manifest, prepared_lessons)
    _preflight_destinations(prepared_lessons, prepared_reviews)
    report = {"schema_version": 2, "source_package_version": "v6-t11-map-locked",
              "source_revision": manifest.get("source_revision"),
              "lesson_count": len(lesson_ids), "lessons": [],
              "review_count": len(prepared_reviews), "reviews": []}
    for prepared in prepared_reviews:
        review_id = prepared["review_id"]
        checksum = prepared["actual_checksum"]
        review = prepared["review"]
        _sync_review(
            prepared["source_review"], review_id, checksum, write=write,
        )
        report["reviews"].append({
            "review_id": review_id,
            "content_checksum": checksum,
            "review_of_lessons": review.get("review_of_lessons") or [],
            "item_count": len(review.get("items") or []),
            "canonical_path": str(
                (_CONTENT / "reviews" / f"{review_id}.json").relative_to(_REPO)
            ),
            "versioned_path": str((
                _CONTENT / "versions" / "reviews" / review_id
                / f"{checksum}.json"
            ).relative_to(_REPO)),
        })
    copied_assets = 0
    for prepared in prepared_lessons:
        lesson_id = prepared["lesson_id"]
        source_lesson = prepared["source_lesson"]
        lesson = prepared["lesson"]
        actual_checksum = prepared["actual_checksum"]
        vocabulary = prepared["vocabulary"]
        listening = prepared["listening"]
        listening_meta = prepared["listening_meta"]
        listening_content = prepared["listening_content"]
        writing_refs = prepared["writing_refs"]

        previous_checksum = _sync_lesson(
            source_lesson, lesson_id, actual_checksum, write=write,
        )
        _archive_asset_snapshot(lesson_id, previous_checksum, write=write)

        expected_assets: set[str] = set()
        for word in vocabulary:
            provenance = word.get("audio_provenance") or {}
            for field in ("audio_headword", "audio_example"):
                ref = str(word.get(field) or "")
                source_asset = source / ref
                target = _PUBLIC / lesson_id / "vocab" / Path(ref).name
                checksum_field = ("headword_checksum" if field == "audio_headword"
                                  else "example_checksum")
                _sync_asset(
                    source_asset, target, lesson_id, actual_checksum, write=write,
                    checksum=provenance.get(checksum_field),
                )
                expected_assets.add(str(target.relative_to(_REPO)))
        listening_target = _PUBLIC / lesson_id / "listening" / "full_test.mp3"
        _sync_asset(
            listening, listening_target, lesson_id, actual_checksum, write=write,
            checksum=listening_meta.get("checksum"),
        )
        expected_assets.add(str(listening_target.relative_to(_REPO)))
        for section in listening_content.get("sections") or []:
            figure = str(section.get("figure") or "")
            if not figure:
                continue
            figure_target = _sync_listening_figure(
                source, course_source, lesson_id, figure, write=write,
                content_checksum=actual_checksum,
                checksum=section.get("figure_checksum"),
            )
            expected_assets.add(str(figure_target.relative_to(_REPO)))
        for ref in writing_refs:
            target = _sync_writing_asset(
                source, lesson, lesson_id, str(ref), actual_checksum, write=write,
            )
            expected_assets.add(str(target.relative_to(_REPO)))
        canonical_asset_root = _PUBLIC / lesson_id
        actual_assets = {
            str(path.relative_to(_REPO))
            for path in canonical_asset_root.rglob("*") if path.is_file()
        }
        if (write or actual_assets) and actual_assets != expected_assets:
            missing = sorted(expected_assets - actual_assets)
            unexpected = sorted(actual_assets - expected_assets)
            raise SystemExit(
                f"{lesson_id}: snapshot asset không chính xác; "
                f"thiếu={missing}, thừa={unexpected}"
            )
        version_root = _PUBLIC / "versions" / lesson_id / actual_checksum
        versioned_assets = {
            str(path.relative_to(version_root))
            for path in version_root.rglob("*") if path.is_file()
        }
        expected_relative = {
            str((_REPO / path).relative_to(_PUBLIC / lesson_id))
            for path in expected_assets
        }
        if (write or versioned_assets) and versioned_assets != expected_relative:
            raise SystemExit(
                f"{lesson_id}: snapshot asset versioned không chính xác; "
                f"thiếu={sorted(expected_relative - versioned_assets)}, "
                f"thừa={sorted(versioned_assets - expected_relative)}"
            )
        copied_assets += len(expected_assets)
        activities = {row["activity_type"]: row for row in lesson.get("activities") or []}
        report["lessons"].append({
            "lesson_id": lesson_id,
            "title": lesson.get("title"),
            "content_checksum": actual_checksum,
            "checkpoint_review_id": prepared["checkpoint_review_id"],
            "checkpoint_review_checksum": prepared["checkpoint_review_checksum"],
            "vocabulary_count": len(vocabulary),
            "common_error_count": sum(bool(word.get("common_error")) for word in vocabulary),
            "reading_question_count": len(activities["reading_lab"]["content"]["questions"]),
            "listening_question_count": len(activities["listening_lab"]["content"]["questions"]),
            "asset_count": len(expected_assets),
        })
    expected_content = {f"{lesson_id}.json" for lesson_id in _EXPECTED_IDS}
    actual_content = {
        path.name for path in _CONTENT.glob("*.json")
        if path.name not in {"core30-manifest.json", SOURCE_MANIFEST_NAME}
    }
    if (write or actual_content) and actual_content != expected_content:
        raise SystemExit(
            "Snapshot content phải chứa đúng ADV-T01…ADV-T30; "
            f"thiếu={sorted(expected_content - actual_content)}, "
            f"thừa={sorted(actual_content - expected_content)}"
        )
    expected_reviews = {f"{review_id}.json" for review_id in CORE_REVIEW_IDS}
    actual_reviews = {
        path.name for path in (_CONTENT / "reviews").glob("*.json")
        if path.is_file()
    }
    if (write or actual_reviews) and actual_reviews != expected_reviews:
        raise SystemExit(
            "Snapshot review phải chứa đúng R01…R06; "
            f"thiếu={sorted(expected_reviews - actual_reviews)}, "
            f"thừa={sorted(actual_reviews - expected_reviews)}"
        )
    if write:
        _copy(
            source / SOURCE_MANIFEST_NAME,
            _CONTENT / SOURCE_MANIFEST_NAME,
            write=True,
        )
        (_CONTENT / "core30-manifest.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(
        f"OK: {report['lesson_count']} lesson, "
        f"{report['review_count']} review, "
        f"{sum(row['vocabulary_count'] for row in report['lessons'])} từ, "
        f"{copied_assets} asset runtime{' đã copy' if write else ' đã xác thực'}."
    )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument(
        "--course-source", type=Path,
        help="Khóa gốc dùng để resolve figure nếu package đã build không chứa asset.",
    )
    parser.add_argument("--write", action="store_true")
    args = parser.parse_args()
    sync(
        args.source.resolve(), write=args.write,
        course_source=args.course_source.resolve() if args.course_source else None,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
