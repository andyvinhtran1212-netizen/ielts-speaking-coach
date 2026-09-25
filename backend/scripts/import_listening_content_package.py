#!/usr/bin/env python3
"""Validate, import, publish, or archive immutable Listening packages.

Dry-run is the default and performs no database or Storage mutation.  Import,
publish, and archive are deliberately separate operator actions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.listening_package_import import (  # noqa: E402
    PackageValidationError,
    build_import_plan,
    commit_import_plan,
    discover_packages,
    select_package,
    set_package_status,
)
from services.listening_editorial_validation import SOURCE_MANIFEST_LOCKS  # noqa: E402
from services.listening_revision_compare import RevisionMismatch, compare_editorial_revision  # noqa: E402


def _admin():
    from database import supabase_admin

    return supabase_admin


def _release_root(raw: str | None) -> Path:
    value = raw or os.getenv("LISTENING_CONTENT_RELEASE_ROOT")
    return Path(value) if value else Path.home() / "Downloads" / "Listening-Content" / "02_PUBLISH_READY"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", help="Thư mục 02_PUBLISH_READY")
    parser.add_argument(
        "--source-release-root",
        help="Release root v1.0 để so sánh revision biên tập; bắt buộc khi package là revision.",
    )
    parser.add_argument(
        "--package", action="append", dest="packages",
        help="Package ID; có thể lặp lại. Mặc định kiểm tra/import toàn bộ release-index.",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--commit", action="store_true", help="Upload asset và import nháp")
    mode.add_argument("--publish", action="store_true", help="Publish package đã import")
    mode.add_argument("--archive", action="store_true", help="Archive package đã import")
    parser.add_argument("--actor", help="UUID người thực hiện để ghi audit")
    args = parser.parse_args()

    root = _release_root(args.release_root).resolve()
    selected = discover_packages(root)
    if args.packages:
        wanted = set(args.packages)
        selected = [location for location in selected if location.package_id in wanted]
        missing = wanted - {location.package_id for location in selected}
        if missing:
            parser.error(f"Package không có trong release-index: {sorted(missing)}")
    if (args.publish or args.archive) and len(selected) != 1:
        parser.error("--publish/--archive yêu cầu đúng một --package")

    plans = [build_import_plan(location, imported_by=args.actor) for location in selected]
    for plan in plans:
        source_package_id = plan.report.get("editorial_source_package_id")
        if not source_package_id:
            continue
        if not args.source_release_root:
            parser.error("--source-release-root là bắt buộc cho editorial revision")
        source_root = Path(args.source_release_root).resolve()
        source_plan = build_import_plan(select_package(source_root, source_package_id))
        try:
            comparison = compare_editorial_revision(
                source_plan, plan,
                expected_source_manifest_sha256=SOURCE_MANIFEST_LOCKS[source_package_id],
            )
        except RevisionMismatch as exc:
            raise PackageValidationError(f"Revision invariant mismatch: {exc}") from exc
        plan.package["validation_summary"]["revision_source_invariants_verified"] = True
        plan.report["revision_comparison"] = comparison
    for plan in plans:
        print(json.dumps(plan.report, ensure_ascii=False, sort_keys=True))

    if not (args.commit or args.publish or args.archive):
        print(f"DRY RUN PASS — {len(plans)} package; không ghi DB/Storage.")
        return 0

    db = _admin()
    if args.commit:
        from config import settings

        for plan in plans:
            result = commit_import_plan(
                plan, db, bucket_name=settings.LISTENING_AUDIO_BUCKET,
            )
            print(json.dumps({"package_id": plan.location.package_id, **result}, ensure_ascii=False))
        return 0

    action = "publish" if args.publish else "archive"
    plan = plans[0]
    from config import settings

    result = set_package_status(
        db,
        package_id=plan.location.package_id,
        manifest_sha256=plan.location.manifest_sha256,
        action=action,
        actor=args.actor,
        bucket_name=settings.LISTENING_AUDIO_BUCKET,
    )
    print(json.dumps({"package_id": plan.location.package_id, **result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PackageValidationError as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        raise SystemExit(2) from exc
