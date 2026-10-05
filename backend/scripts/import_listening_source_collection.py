#!/usr/bin/env python3
"""Dry-run-first immutable 80-day source release import; no paid provider calls."""
from __future__ import annotations
import argparse
import json
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services.listening_source_package_import import build_source_import_plan, commit_source_import_plan
from services.listening_package_import import PackageValidationError, set_package_status


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release-root', required=True)
    parser.add_argument('--actor')
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--commit', action='store_true')
    mode.add_argument('--publish', action='store_true')
    mode.add_argument('--archive', action='store_true')
    args = parser.parse_args()
    plan = build_source_import_plan(Path(args.release_root), imported_by=args.actor)
    print(json.dumps(plan.report, ensure_ascii=False, sort_keys=True))
    if not (args.commit or args.publish or args.archive):
        print('DRY RUN PASS — no database or Storage writes')
        return 0
    from database import supabase_admin
    from config import settings
    if args.commit:
        result = commit_source_import_plan(plan, supabase_admin, bucket_name=settings.LISTENING_AUDIO_BUCKET)
    else:
        result = set_package_status(supabase_admin, package_id=plan.package['package_id'],
            manifest_sha256=plan.package['manifest_sha256'], action='publish' if args.publish else 'archive',
            actor=args.actor, bucket_name=settings.LISTENING_AUDIO_BUCKET)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except PackageValidationError as error:
        print(f'FAIL CLOSED — {error}', file=sys.stderr)
        raise SystemExit(2)
