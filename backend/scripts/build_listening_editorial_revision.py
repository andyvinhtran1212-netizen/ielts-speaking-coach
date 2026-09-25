#!/usr/bin/env python3
"""Build new, unpublished Listening packages from fully approved editorial text.

The v1.0 release root is read-only. Output must be a new directory; on any
validation failure the temporary output is discarded before it is exposed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from datetime import date
from pathlib import Path, PurePosixPath
from typing import Any

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from scripts.validate_listening_editorial_revision import SOURCE_RELEASE_INDEX_SHA256  # noqa: E402
from services.listening_editorial_validation import (  # noqa: E402
    APPROVED_STATUSES,
    EditorialValidationError,
    SOURCE_MANIFEST_LOCKS,
    build_approved_translation_projection,
    source_catalog_from_plans,
)
from services.listening_package_import import (  # noqa: E402
    PackageValidationError,
    _validate_svg,
    build_import_plan,
    discover_packages,
    select_package,
)
from services.listening_revision_compare import RevisionMismatch, compare_editorial_revision  # noqa: E402

EXPECTED_METADATA_COUNTS = {"instructions": 65, "titles": 9, "outcomes": 5}
REVISION_STATUS = "EDITORIAL_REVISION_VALIDATED_NOT_PUBLISHED"


def _read_json(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise PackageValidationError(f"JSON object required: {path}")
    return value


def _write_json(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _reviewed_metadata(path: Path, lesson_ids: set[str]) -> dict[str, dict[str, Any]]:
    metadata = _read_json(path)
    if metadata.get("status") not in APPROVED_STATUSES:
        raise PackageValidationError("Lesson metadata chưa được duyệt")
    if (not isinstance(metadata.get("source_package_ids"), list)
            or not all(isinstance(package_id, str) for package_id in metadata["source_package_ids"])
            or set(metadata["source_package_ids"]) != set(SOURCE_MANIFEST_LOCKS)
            or len(metadata["source_package_ids"]) != len(SOURCE_MANIFEST_LOCKS)):
        raise PackageValidationError("Lesson metadata không khớp source package IDs")
    result: dict[str, dict[str, Any]] = {}
    for field, count in EXPECTED_METADATA_COUNTS.items():
        values = metadata.get(field)
        if (not isinstance(values, dict) or len(values) != count
                or not set(values) <= lesson_ids):
            raise PackageValidationError(f"Metadata {field} count/lesson IDs không hợp lệ")
        for lesson_id, value in values.items():
            if field == "outcomes":
                valid = isinstance(value, list) and bool(value) and all(
                    isinstance(line, str) and line.strip() for line in value
                )
            else:
                valid = isinstance(value, str) and bool(value.strip())
            if not valid:
                raise PackageValidationError(f"Metadata {field} rỗng: {lesson_id}")
        result[field] = values
    return result


def _patch_lessons(package_root: Path, metadata: dict[str, dict[str, Any]]) -> None:
    seen = {field: set() for field in EXPECTED_METADATA_COUNTS}
    for path in sorted((package_root / "learner/content/lessons").glob("*.json")):
        lesson = _read_json(path)
        lesson_id = lesson.get("id")
        changed = False
        for field, replacements in metadata.items():
            if lesson_id not in replacements:
                continue
            lesson_field = "title" if field == "titles" else field
            if field == "outcomes" and lesson.get(lesson_field):
                raise PackageValidationError(f"Outcome source không rỗng: {lesson_id}")
            if field != "outcomes" and lesson.get(lesson_field) == replacements[lesson_id]:
                raise PackageValidationError(f"Metadata không đổi source: {field}:{lesson_id}")
            lesson[lesson_field] = replacements[lesson_id]
            seen[field].add(lesson_id)
            changed = True
        if changed:
            _write_json(path, lesson)
    if any(seen[field] != set(replacements) for field, replacements in metadata.items()):
        raise PackageValidationError("Metadata không khớp lesson files")


def _reviewed_visuals(draft_dir: Path, source_plans: dict[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """Bind approved SVG wording to immutable source bytes and unchanged geometry."""
    expected = {
        (package_id, asset["source_path"]): asset
        for package_id, plan in source_plans.items() for asset in plan.visual_assets
    }
    result: dict[str, list[dict[str, Any]]] = {package_id: [] for package_id in source_plans}
    review_path = draft_dir / "visual-batch-01-draft.json"
    if not expected:
        if review_path.exists():
            raise PackageValidationError("Visual review không thuộc source packages")
        return result
    if not review_path.is_file() or review_path.is_symlink():
        raise PackageValidationError("Thiếu visual review đã duyệt")
    review = _read_json(review_path)
    if review.get("status") not in APPROVED_STATUSES:
        raise PackageValidationError("Visual review chưa được duyệt")
    package_id = review.get("source_package_id")
    rows = review.get("visuals")
    if (not isinstance(package_id, str) or package_id not in source_plans
            or not isinstance(rows, list) or len(rows) != len(expected)):
        raise PackageValidationError("Visual review coverage không khớp source")
    seen: set[tuple[str, str]] = set()
    for row in rows:
        if not isinstance(row, dict):
            raise PackageValidationError("Visual review entry không hợp lệ")
        source_path = row.get("source_path")
        if not isinstance(source_path, str):
            raise PackageValidationError("Visual review source ID không hợp lệ")
        identity = (package_id, source_path)
        if identity not in expected or identity in seen:
            raise PackageValidationError("Visual review source ID trùng hoặc lạ")
        seen.add(identity)
        source = Path(expected[identity]["local_path"])
        if _sha(source) != row.get("source_sha256"):
            raise PackageValidationError(f"Visual source hash mismatch: {source_path}")
        raw_draft_path = row.get("draft_variant_path")
        if (not isinstance(raw_draft_path, str) or "\\" in raw_draft_path
                or not raw_draft_path.startswith("visuals-draft/")):
            raise PackageValidationError("Visual draft path không hợp lệ")
        relative = PurePosixPath(raw_draft_path)
        if relative.is_absolute() or any(part in {"", ".", ".."} for part in raw_draft_path.split("/")):
            raise PackageValidationError("Visual draft path traversal bị từ chối")
        draft = draft_dir.joinpath(*relative.parts)
        if (draft.is_symlink() or not draft.is_file()
                or not draft.resolve(strict=True).is_relative_to(draft_dir.resolve(strict=True))):
            raise PackageValidationError("Visual draft nằm ngoài review directory")
        _validate_svg(source)
        _validate_svg(draft)
        if _sha(draft) != row.get("draft_variant_sha256"):
            raise PackageValidationError(f"Visual draft hash mismatch: {source_path}")
        source_elements = list(ET.parse(source).getroot().iter())
        draft_elements = list(ET.parse(draft).getroot().iter())
        if (len(source_elements) != len(draft_elements)
                or any(a.tag != b.tag or a.attrib != b.attrib for a, b in zip(source_elements, draft_elements, strict=True))):
            raise PackageValidationError(f"Visual geometry changed: {source_path}")
        changes = [((a.text or "").strip(), (b.text or "").strip())
                   for a, b in zip(source_elements, draft_elements, strict=True)
                   if (a.text or "").strip() != (b.text or "").strip()]
        visible = row.get("visible_text")
        if not isinstance(visible, list) or not all(isinstance(pair, dict) for pair in visible):
            raise PackageValidationError("Visual wording review thiếu")
        reviewed_changes = [(row.get("title_en"), row.get("title_vi")),
                            (row.get("description_en"), row.get("description_vi"))]
        reviewed_changes.extend((pair.get("en"), pair.get("vi")) for pair in visible)
        if changes != reviewed_changes:
            raise PackageValidationError(f"Visual wording không khớp review: {source_path}")
        symbols = row.get("unchanged_symbols")
        source_text = [(element.text or "").strip() for element in source_elements]
        draft_text = [(element.text or "").strip() for element in draft_elements]
        choice_anchors = {text for text in source_text if re.fullmatch(r"[A-Z]", text)}
        if (not isinstance(symbols, list) or not all(isinstance(symbol, str) for symbol in symbols)
                or set(symbols) != choice_anchors
                or any(source_text.count(symbol) == 0
                       or source_text.count(symbol) != draft_text.count(symbol) for symbol in symbols)):
            raise PackageValidationError(f"Visual choice anchors changed: {source_path}")
        alt = row.get("image_alt_vi")
        if not isinstance(alt, str) or not alt.strip():
            raise PackageValidationError(f"Visual accessibility thiếu: {source_path}")
        if not source_path.endswith(".v1.svg"):
            raise PackageValidationError(f"Visual source path bất ngờ: {source_path}")
        target_path = source_path.removesuffix(".v1.svg") + ".vi.v1.svg"
        result[package_id].append({
            "source_path": source_path,
            "source_sha256": row["source_sha256"],
            "target_path": target_path,
            "target_sha256": row["draft_variant_sha256"],
            "visual_accessibility": alt,
            "draft_path": draft,
        })
    if seen != set(expected):
        raise PackageValidationError("Visual review source coverage thiếu")
    return result


def build_revision(
    source_root: Path,
    draft_dir: Path,
    output_root: Path,
    *,
    revision_date: str,
) -> dict[str, Any]:
    """Validate all approvals, copy v1 bytes and atomically expose a new root."""
    source_root = source_root.resolve(strict=True)
    if output_root.is_symlink():
        raise PackageValidationError("Output không được là symlink")
    output_root = output_root.resolve(strict=False)
    if output_root == source_root or source_root in output_root.parents:
        raise PackageValidationError("Output không được nằm trong source v1.0")
    if output_root.exists() or not output_root.parent.is_dir():
        raise PackageValidationError("Output phải là thư mục mới trong parent đã tồn tại")
    date.fromisoformat(revision_date)
    if _sha(source_root / "release-index.json") != SOURCE_RELEASE_INDEX_SHA256:
        raise PackageValidationError("Source release index không khớp owner lock")
    source_locations = discover_packages(source_root)
    source_shas = {location.package_id: location.manifest_sha256 for location in source_locations}
    if source_shas != SOURCE_MANIFEST_LOCKS:
        raise PackageValidationError("Source manifests không khớp owner lock")
    source_plans = {location.package_id: build_import_plan(location) for location in source_locations}
    lesson_ids = {
        lesson["metadata"]["learner_lesson_id"]
        for plan in source_plans.values() for lesson in plan.lessons
    }
    if len(lesson_ids) != sum(len(plan.lessons) for plan in source_plans.values()):
        raise PackageValidationError("Source lesson IDs trùng giữa các package")
    metadata = _reviewed_metadata(draft_dir / "lesson-metadata-draft.json", lesson_ids)
    batch_paths = sorted(draft_dir.glob("translation-batch-*-draft.json"))
    if not batch_paths:
        raise PackageValidationError("Thiếu translation batches")
    batches = [_read_json(path) for path in batch_paths]
    _, coverage = build_approved_translation_projection(
        source_catalog_from_plans(source_plans.values()), batches,
        expected_manifest_sha256=SOURCE_MANIFEST_LOCKS,
        actual_manifest_sha256=source_shas,
        require_all_approved=True,
    )
    reviewed_visuals = _reviewed_visuals(draft_dir, source_plans)
    batches_by_source: dict[str, list[tuple[Path, dict[str, Any]]]] = {
        package_id: [] for package_id in source_plans
    }
    for path, batch in zip(batch_paths, batches, strict=True):
        batches_by_source[batch["source_package_id"]].append((path, batch))

    index = deepcopy(_read_json(source_root / "release-index.json"))
    with tempfile.TemporaryDirectory(prefix="listening-revision-", dir=output_root.parent) as temporary:
        candidate = Path(temporary) / "release"
        candidate.mkdir()
        comparisons = []
        for programme in index["programmes"]:
            for entry in programme["packages"]:
                source_id = entry["package_id"]
                source = source_plans[source_id]
                revision_id = source_id.replace("-v1.0.0", "-v1.1.0")
                if revision_id == source_id:
                    raise PackageValidationError(f"Unexpected source package ID: {source_id}")
                entry["package_id"] = revision_id
                entry["path"] = f"packages/{revision_id}"
                entry["status"] = REVISION_STATUS
                destination = candidate / programme["path"] / entry["path"]
                shutil.copytree(source.location.package_root, destination)
                subset = {
                    field: {key: value for key, value in values.items() if key in {
                        lesson["metadata"]["learner_lesson_id"] for lesson in source.lessons
                    }}
                    for field, values in metadata.items()
                }
                _patch_lessons(destination, subset)
                manifest = _read_json(destination / "manifest.json")
                manifest["package_id"] = revision_id
                manifest["date"] = revision_date
                manifest["status"] = REVISION_STATUS
                manifest["editorial_source_package_id"] = source_id
                manifest["editorial_source_manifest_sha256"] = source.location.manifest_sha256
                if reviewed_visuals[source_id]:
                    manifest["editorial_visuals"] = []
                    for visual in reviewed_visuals[source_id]:
                        target = destination / visual["target_path"]
                        if target.exists():
                            raise PackageValidationError(f"Visual target đã tồn tại: {visual['target_path']}")
                        shutil.copy2(visual["draft_path"], target)
                        manifest["editorial_visuals"].append({
                            "status": "approved",
                            "source_path": visual["source_path"],
                            "source_sha256": visual["source_sha256"],
                            "target_path": visual["target_path"],
                            "target_sha256": visual["target_sha256"],
                            "target_language": "vi",
                            "visual_accessibility": visual["visual_accessibility"],
                        })
                    manifest["counts"]["visuals"] += len(reviewed_visuals[source_id])
                editorial_dir = destination / "protected/editorial"
                editorial_dir.mkdir()
                if reviewed_visuals[source_id]:
                    visual_review_path = "protected/editorial/visual-batch-01.json"
                    _write_json(destination / visual_review_path, _read_json(draft_dir / "visual-batch-01-draft.json"))
                    manifest["editorial_visual_review"] = visual_review_path
                manifest["editorial_batches"] = []
                for batch_path, batch in batches_by_source[source_id]:
                    relative = f"protected/editorial/{batch_path.name.removesuffix('-draft.json')}.json"
                    _write_json(destination / relative, batch)
                    manifest["editorial_batches"].append(relative)
                manifest["artifact_hashes"] = {
                    path.relative_to(destination).as_posix(): _sha(path)
                    for path in sorted(destination.rglob("*"))
                    if path.is_file() and path.name != "manifest.json"
                }
                _write_json(destination / "manifest.json", manifest)
                entry["manifest_sha256"] = _sha(destination / "manifest.json")
        index["date"] = revision_date
        index["status"] = REVISION_STATUS
        _write_json(candidate / "release-index.json", index)
        for source_id, source in source_plans.items():
            revision_id = source_id.replace("-v1.0.0", "-v1.1.0")
            revision = build_import_plan(select_package(candidate, revision_id))
            comparisons.append(compare_editorial_revision(
                source, revision,
                expected_source_manifest_sha256=SOURCE_MANIFEST_LOCKS[source_id],
            ))
        if output_root.exists() or output_root.is_symlink():
            raise PackageValidationError("Output đã xuất hiện trong lúc build")
        candidate.rename(output_root)
    return {"output_root": str(output_root), "coverage": coverage, "comparisons": comparisons}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-release-root", type=Path, required=True)
    parser.add_argument("--draft-dir", type=Path, required=True)
    parser.add_argument("--output-root", type=Path, required=True)
    parser.add_argument("--revision-date", required=True, help="YYYY-MM-DD")
    args = parser.parse_args()
    report = build_revision(
        args.source_release_root, args.draft_dir, args.output_root,
        revision_date=args.revision_date,
    )
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (EditorialValidationError, PackageValidationError, RevisionMismatch, ValueError, OSError) as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
