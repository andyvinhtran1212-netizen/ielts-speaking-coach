#!/usr/bin/env python3
"""Run the read-only production postcondition audit for migrations 213-224.

The forward migration runner remains the only writer. This wrapper pins the
configured Supabase production target, invokes psql with a read-only SQL file
and redacts the database URL from failure output.

Usage:
    python backend/scripts/verify_prod_nextjs_migrations.py "$DATABASE_URL"
"""

from __future__ import annotations

from pathlib import Path
import subprocess
import sys
from urllib.parse import urlsplit


BACKEND_ROOT = Path(__file__).resolve().parents[1]
VERIFY_SQL = BACKEND_ROOT / "scripts" / "verify_prod_nextjs_migrations_213_224.sql"
PRODUCTION_PROJECT_REF = "huwsmtubwulikhlmcirx"
PRODUCTION_POOLER_HOSTS = frozenset({
    "aws-1-ap-southeast-1.pooler.supabase.com",
})


class VerificationError(RuntimeError):
    """The requested target is not the pinned production database."""


def _assert_production_target(database_url: str) -> None:
    parsed = urlsplit(database_url)
    hostname = (parsed.hostname or "").lower()
    username = parsed.username or ""
    direct_host = hostname == f"db.{PRODUCTION_PROJECT_REF}.supabase.co"
    pinned_pooler = (
        hostname in PRODUCTION_POOLER_HOSTS
        and username == f"postgres.{PRODUCTION_PROJECT_REF}"
    )
    if not (direct_host or pinned_pooler):
        raise VerificationError(
            "target is not the pinned production Supabase project"
        )


def verify(database_url: str) -> None:
    _assert_production_target(database_url)
    subprocess.run(
        [
            "psql",
            database_url,
            "-X",
            "-v",
            "ON_ERROR_STOP=1",
            "-q",
            "-f",
            str(VERIFY_SQL),
        ],
        check=True,
        text=True,
    )


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(
            "usage: verify_prod_nextjs_migrations.py <DATABASE_URL>",
            file=sys.stderr,
        )
        return 2
    try:
        verify(argv[1])
    except VerificationError as exc:
        print(f"REFUSED: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        # Never render CalledProcessError: argv contains DATABASE_URL.
        print(
            f"REFUSED: production verification exited with status {exc.returncode}",
            file=sys.stderr,
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
