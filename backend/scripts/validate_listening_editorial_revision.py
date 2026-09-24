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
    SOURCE_MANIFEST_LOCKS,
    build_approved_translation_projection,
    source_catalog_from_plans,
)
from services.listening_package_import import (  # noqa: E402
    PackageValidationError,
    build_import_plan,
    discover_packages,
)


# Owner-approved v1.0 source lock recorded in LISTENING-0007/REVIEW.md.
SOURCE_RELEASE_INDEX_SHA256 = "05ade5ea7981a3dd4c1e5b34e6a1a8ad309aaa347ba6907a85df6b46f6de8d71"


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
        catalog = source_catalog_from_plans(plans)
        projection, report = build_approved_translation_projection(
            catalog, batches,
            expected_manifest_sha256=SOURCE_MANIFEST_LOCKS,
            actual_manifest_sha256=actual_sha,
            require_all_approved=args.require_all_approved,
        )
        if report["missing_items"]:
            raise EditorialValidationError(f"Thiếu {report['missing_items']} item draft")
        report["projectable_approved_items"] = len(projection)
        report["projectable_complete_forms_without_visual"] = sum(
            all((plan.location.package_id, question["source_item_id"]) in projection
                and not question.get("visual_storage_path")
                for question in form["exercise_payload"]["questions"])
            for plan in plans for form in plan.forms
        )
    except (EditorialValidationError, PackageValidationError, OSError, ValueError) as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
