#!/usr/bin/env python3
"""Validate an Advanced Vocabulary package without importing or mutating it."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parent.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

from services.advanced_vocab_package_validator import (  # noqa: E402
    validate_listening_source_directory,
    validate_package,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", help="Path containing course-manifest.json")
    parser.add_argument("--pretty", action="store_true", help="Pretty-print JSON")
    parser.add_argument(
        "--listening-source-dir",
        help="Optional canonical Source_JSON directory to validate before conversion.",
    )
    args = parser.parse_args()

    report = validate_package(args.package)
    if args.listening_source_dir:
        validate_listening_source_directory(args.listening_source_dir, report)
    print(json.dumps(report.to_dict(), ensure_ascii=False, indent=2 if args.pretty else None))
    return 0 if report.publish_ready else 1


if __name__ == "__main__":
    raise SystemExit(main())
