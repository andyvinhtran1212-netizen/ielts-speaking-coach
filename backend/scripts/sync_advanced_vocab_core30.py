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
    lesson_content_checksum,
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


def _copy(source: Path, target: Path, *, write: bool,
          checksum: str | None = None) -> None:
    _require_file(source)
    source_checksum = _sha256(source)
    if checksum and source_checksum != checksum:
        raise SystemExit(f"Sai checksum source asset: {source}")
    if write:
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
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
    *, write: bool,
) -> Path:
    source_asset = _listening_figure_source(
        source, course_source, lesson_id, figure,
    )
    target = _PUBLIC / lesson_id / "listening" / Path(figure).name
    _copy(source_asset, target, write=write)
    return target


def _sync_lesson(source_lesson: Path, lesson_id: str, checksum: str, *,
                 write: bool) -> None:
    target = _CONTENT / f"{lesson_id}.json"
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
        )
    _copy(source_lesson, target, write=write)
    _copy(
        source_lesson,
        _CONTENT / "versions" / lesson_id / f"{checksum}.json",
        write=write,
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

    report = {"schema_version": 1, "source_package_version": "v5-writing-reference",
              "lesson_count": 30, "lessons": []}
    copied_assets = 0
    for lesson_id in lesson_ids:
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
        _sync_lesson(source_lesson, lesson_id, actual_checksum, write=write)

        expected_assets: set[str] = set()
        for word in vocabulary:
            provenance = word.get("audio_provenance") or {}
            for field in ("audio_headword", "audio_example"):
                ref = str(word.get(field) or "")
                source_asset = source / ref
                target = _PUBLIC / lesson_id / "vocab" / Path(ref).name
                checksum_field = ("headword_checksum" if field == "audio_headword"
                                  else "example_checksum")
                _copy(source_asset, target, write=write,
                      checksum=provenance.get(checksum_field))
                expected_assets.add(str(target.relative_to(_REPO)))
        listening = source / "lessons" / lesson_id / "assets" / "audio" / "full_test.mp3"
        listening_target = _PUBLIC / lesson_id / "listening" / "full_test.mp3"
        listening_meta = next(
            (row for row in (lesson.get("media") or {}).get("audio") or []
             if row.get("role") == "listening_full_test"), {}
        )
        _copy(listening, listening_target, write=write,
              checksum=listening_meta.get("checksum"))
        expected_assets.add(str(listening_target.relative_to(_REPO)))
        listening_content = next(
            (row.get("content") or {} for row in lesson.get("activities") or []
             if row.get("activity_type") == "listening_lab"),
            {},
        )
        for section in listening_content.get("sections") or []:
            figure = str(section.get("figure") or "")
            if not figure:
                continue
            figure_target = _sync_listening_figure(
                source, course_source, lesson_id, figure, write=write,
            )
            expected_assets.add(str(figure_target.relative_to(_REPO)))
        for ref in (lesson.get("media") or {}).get("wt1_illustrations") or []:
            source_asset = source / "lessons" / lesson_id / ref
            target = _PUBLIC / lesson_id / "writing" / Path(ref).name
            _copy(source_asset, target, write=write)
            expected_assets.add(str(target.relative_to(_REPO)))
        actual_assets = {
            str(path.relative_to(_REPO))
            for path in (_PUBLIC / lesson_id).rglob("*") if path.is_file()
        }
        if actual_assets != expected_assets:
            missing = sorted(expected_assets - actual_assets)
            unexpected = sorted(actual_assets - expected_assets)
            raise SystemExit(
                f"{lesson_id}: snapshot asset không chính xác; "
                f"thiếu={missing}, thừa={unexpected}"
            )
        copied_assets += len(expected_assets)
        activities = {row["activity_type"]: row for row in lesson.get("activities") or []}
        report["lessons"].append({
            "lesson_id": lesson_id,
            "title": lesson.get("title"),
            "content_checksum": actual_checksum,
            "vocabulary_count": len(vocabulary),
            "common_error_count": sum(bool(word.get("common_error")) for word in vocabulary),
            "reading_question_count": len(activities["reading_lab"]["content"]["questions"]),
            "listening_question_count": len(activities["listening_lab"]["content"]["questions"]),
            "asset_count": len(expected_assets),
        })
    expected_content = {f"{lesson_id}.json" for lesson_id in _EXPECTED_IDS}
    actual_content = {
        path.name for path in _CONTENT.glob("*.json")
        if path.name != "core30-manifest.json"
    }
    if actual_content != expected_content:
        raise SystemExit(
            "Snapshot content phải chứa đúng ADV-T01…ADV-T30; "
            f"thiếu={sorted(expected_content - actual_content)}, "
            f"thừa={sorted(actual_content - expected_content)}"
        )
    if write:
        (_CONTENT / "core30-manifest.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    print(
        f"OK: {report['lesson_count']} lesson, "
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
