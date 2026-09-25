#!/usr/bin/env python3
"""Dry-run compare a proposed Listening revision against locked v1.0."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.listening_editorial_validation import SOURCE_MANIFEST_LOCKS  # noqa: E402
from services.listening_package_import import (  # noqa: E402
    PackageValidationError,
    build_import_plan,
    select_package,
)
from services.listening_revision_compare import RevisionMismatch, compare_editorial_revision  # noqa: E402


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-root", type=Path, required=True, help="Revision release root")
    parser.add_argument(
        "--source-release-root", type=Path,
        help="Locked v1.0 release root; defaults to --release-root.",
    )
    parser.add_argument("--source-package", choices=sorted(SOURCE_MANIFEST_LOCKS), required=True)
    parser.add_argument("--revision-package", required=True)
    args = parser.parse_args(argv)
    try:
        source = build_import_plan(select_package(
            args.source_release_root or args.release_root, args.source_package,
        ))
        revision = build_import_plan(select_package(args.release_root, args.revision_package))
        report = compare_editorial_revision(
            source, revision,
            expected_source_manifest_sha256=SOURCE_MANIFEST_LOCKS[args.source_package],
        )
    except (PackageValidationError, RevisionMismatch, OSError, ValueError) as exc:
        print(f"FAIL CLOSED — {exc}", file=sys.stderr)
        return 2
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
