#!/usr/bin/env python3
"""A-06 repair preparation. DRY RUN by default; staging ONLY.

Data is NOT changed by the PR. Staging --apply needs lead approval; production
correction needs Vinh's approval and a separate tool (this one refuses prod).
First review a06_deadline_inventory.sql with QA: clock patterns cannot prove a
bad deadline. Include late-joiner copies via --group-ids and --prompt-id.

Example (no writes):
  STAGING_SUPABASE_SERVICE_KEY=... python scripts/a06_backfill_deadlines.py \
    --group-ids GROUP_UUID --prompt-id PROMPT_UUID \
    --expected-old 2026-10-27T23:00:00Z

--expected-old is mandatory for dry runs AND apply. Only exact original instants
match. Repeating the same command after apply refuses instead of shifting twice.
Run separately for each distinct old value/column. No class-ledger repair is
supported: compose_due_at already wrote correct Vietnam instants.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import os
from urllib.parse import urlsplit
from uuid import UUID

STAGING_REF = 'zjphffoujxkpltixsbzj'
PRODUCTION_REF = 'huwsmtubwulikhlmcirx'
STAGING_URL = f'https://{STAGING_REF}.supabase.co'


class RepairGuardError(ValueError):
    """Safe, credential-free refusal message for the operator."""


def staging_url(value: str) -> str:
    """Exact allowlist; never instantiate a client for any other URL."""
    parsed = urlsplit(value)
    if (PRODUCTION_REF in value.lower() or parsed.scheme != 'https'
            or parsed.netloc != f'{STAGING_REF}.supabase.co'
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise RepairGuardError('Refusing non-staging Supabase URL')
    return STAGING_URL


def aware(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (AttributeError, ValueError) as exc:
        raise RepairGuardError('Expected a valid original ISO timestamp') from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise RepairGuardError('Expected an offset-aware original timestamp')
    return parsed.astimezone(timezone.utc)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('--url', default=os.getenv('STAGING_SUPABASE_URL', STAGING_URL))
    p.add_argument('--column', choices=['deadline', 'due_at'], default='deadline')
    selectors = p.add_mutually_exclusive_group(required=True)
    selectors.add_argument('--ids', nargs='+', type=UUID)
    selectors.add_argument('--group-ids', nargs='+', type=UUID)
    p.add_argument('--prompt-id', type=UUID, help='Narrow a group to one prompt; late joiners inherit both')
    p.add_argument('--expected-old', required=True, help='Exact original instant; refuses mismatch/double shift')
    p.add_argument('--apply', action='store_true', help='WRITES staging; requires separate lead approval')
    return p


def selected_rows(db, args) -> list[dict]:
    field = 'id' if args.ids else 'assignment_group_id'
    ids = [str(value) for value in (args.ids or args.group_ids)]
    rows = []
    # Bound URL size and paginate to include every late-joiner copy.
    for offset in range(0, len(ids), 100):
        start = 0
        while True:
            query = (db.table('writing_assignments')
                     .select(f'id,assignment_group_id,prompt_id,{args.column}')
                     .in_(field, ids[offset:offset + 100]))
            if args.prompt_id:
                query = query.eq('prompt_id', str(args.prompt_id))
            page = query.order('id').range(start, start + 999).execute().data or []
            rows.extend(page)
            if len(page) < 1000:
                break
            start += 1000
    # Duplicate CLI selectors must never result in duplicate shifts.
    unique = {row['id']: row for row in rows}
    rows = list(unique.values())
    found = {row[field] for row in rows}
    if set(ids) - found:
        raise RepairGuardError('One or more selectors matched no rows; refusing partial selection')
    return rows


def run(db, args) -> int:
    staging_url(args.url)
    expected = aware(args.expected_old)
    rows = selected_rows(db, args)
    # Validate the ENTIRE selection before any optional write. A stale original
    # means QA must review the inventory again; never silently skip it.
    if any(not row.get(args.column) or aware(row[args.column]) != expected for row in rows):
        raise RepairGuardError('OLD VALUE MISMATCH: possible prior repair/double shift. Nothing changed.')
    new = (expected - timedelta(hours=7)).isoformat()
    groups = defaultdict(list)
    for row in rows:
        groups[(row.get('assignment_group_id'), row.get('prompt_id'))].append(row)
    print(f'{"APPLY" if args.apply else "DRY RUN (no writes)"}: writing_assignments.{args.column}')
    print('WARNING: subtracting 7 hours twice corrupts deadlines; never replace --expected-old just to retry.')
    for (group, prompt), members in groups.items():
        print(f'group={group} prompt={prompt} count={len(members)}')
        for row in members:
            print(f'  id={row["id"]}: {row[args.column]} -> {new}')
    print(f'Total: {len(rows)} rows in {len(groups)} group/prompt pairs')
    if args.apply:
        for row in rows:
            # Compare-and-set: a concurrently edited/already repaired row cannot
            # be shifted again. Partial success is possible; rerun inventory.
            result = (db.table('writing_assignments').update({args.column: new})
                      .eq('id', row['id']).eq(args.column, row[args.column]).execute())
            if len(result.data or []) != 1:
                raise RuntimeError('Concurrent change: stopped. Earlier rows may have changed; re-inventory.')
    return len(rows)


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        url = staging_url(args.url)
        aware(args.expected_old)
        key = os.getenv('STAGING_SUPABASE_SERVICE_KEY')
        if not key:
            raise RepairGuardError('STAGING_SUPABASE_SERVICE_KEY is required')
        from supabase import create_client
        run(create_client(url, key), args)
    except RepairGuardError as exc:
        print(f'REFUSED: {exc}')
        return 1
    except Exception as exc:
        # SDK exceptions can include request details. Never echo credentials.
        print(f'Refused/failed ({type(exc).__name__}); check selectors, original value and staging configuration.')
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
