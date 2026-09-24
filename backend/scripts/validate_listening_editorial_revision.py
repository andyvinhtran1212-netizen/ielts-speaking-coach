#!/usr/bin/env python3
"""Read-only validation of LISTENING-0007 drafts against locked v1.0 packages."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.listening_editorial_validation import (  # noqa: E402
    EditorialValidationError,
    validate_question_batches,
)
from services.listening_package_import import (  # noqa: E402
    PackageValidationError,
    build_import_plan,
    discover_packages,
)


# Owner-approved v1.0 source lock recorded in LISTENING-0007/REVIEW.md.
SOURCE_RELEASE_INDEX_SHA256 = "05ade5ea7981a3dd4c1e5b34e6a1a8ad309aaa347ba6907a85df6b46f6de8d71"
SOURCE_MANIFEST_LOCKS = {
    "general-listening-practice-v1.0.0": "c8686083b2843f8e1ddabd27cb1b351c6d3940e6c67ca297d5869e869b87506c",
    "ielts-listening-practice-v1.0.0": "209cb7e3eedd4f4935e264a57b4904aaa5f7c6ed841b238b4cbe40e5d0f6a7b5",
}


def source_catalog_from_plans(plans):
    catalog = {}
    for plan in plans:
        package_id = plan.location.package_id
        if package_id in catalog:
            raise EditorialValidationError(f"Trùng source package: {package_id}")
        questions = {}
        for form in plan.forms:
            for question in form["exercise_payload"]["questions"]:
                item_id = question["source_item_id"]
                if item_id in questions:
                    raise EditorialValidationError(f"Item xuất hiện ở nhiều form: {item_id}")
                questions[item_id] = {
                    "prompt": question["prompt"],
                    "options": question["options"],
                }
        if len(questions) != plan.package["source_counts"]["items"]:
            raise EditorialValidationError(f"Source item/form coverage mismatch: {package_id}")
        catalog[package_id] = questions
    return catalog


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True)
    parser.add_argument("--draft-dir", type=Path, required=True)
    parser.add_argument(
        "--require-all-approved", action="store_true",
        help="Fail if any source item is pending owner editorial approval.",
    )
    args = parser.parse_args(argv)
    try:
        release_index_sha = hashlib.sha256(
            (args.release_root / "release-index.json").read_bytes()
        ).hexdigest()
        if release_index_sha != SOURCE_RELEASE_INDEX_SHA256:
            raise EditorialValidationError("Release index bytes không khớp source lock")
        locations = discover_packages(args.release_root)
        actual_sha = {location.package_id: location.manifest_sha256 for location in locations}
        if actual_sha != SOURCE_MANIFEST_LOCKS:
            raise EditorialValidationError("Release index không khớp source manifest lock")
        plans = [build_import_plan(location) for location in locations]
        paths = sorted(args.draft_dir.glob("translation-batch-*-draft.json"))
        if not paths:
            raise EditorialValidationError("Không tìm thấy translation batches")
        batches = [json.loads(path.read_text(encoding="utf-8")) for path in paths]
        report = validate_question_batches(
            source_catalog_from_plans(plans), batches,
            expected_manifest_sha256=SOURCE_MANIFEST_LOCKS,
            actual_manifest_sha256=actual_sha,
            require_all_drafted=True,
            require_all_approved=args.require_all_approved,
        )
    except (EditorialValidationError, PackageValidationError, OSError, ValueError) as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
