"""ACCOUNTDATA-0100 sweep: account erasure (T005) and data exports (T006).

Runs as one step of ``scripts/enrollment_sweep.py`` (every 5 minutes), or by
hand:

    python -m jobs.account_data_sweep            # erasure dry-run, exports run
    python -m jobs.account_data_sweep --erase    # erasure for real, only when
                                                 # ACCOUNT_ERASURE_ENABLED=true

Erasure stays a dry-run (FR-004: due requests and row counts, no change)
until ``ACCOUNT_ERASURE_ENABLED`` is true, which needs Andy's typed approval
per environment. Exports run whenever migration 500 is applied. Logs carry
ids and counts only: no e-mail or name.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import socket
import sys
import uuid
from typing import Any, Optional

from config import settings
from services import account_erasure as er
from services import account_export as ex
from services.account_data_db import get_engine

logger = logging.getLogger("account_data_sweep")

ERASE_BATCH = 20
EXPORT_BATCH = 5


def worker_id() -> str:
    return f"{socket.gethostname()[:60]}:{uuid.uuid4().hex[:12]}"


async def _tables_present(engine: Any) -> bool:
    from sqlalchemy import text
    async with engine.connect() as conn:
        return (await conn.execute(text("SELECT to_regclass('public.account_deletion_requests') IS NOT NULL "
                                        "AND to_regprocedure('public.fn_account_erase_learner(uuid,text,jsonb)') "
                                        "IS NOT NULL"))).scalar() is True


async def run_async(*, erase: bool, engine: Any = None, storage: Any = None, auth: Any = None,
                    send: Any = None) -> dict:
    engine = engine or get_engine()
    if engine is None:
        logger.warning("[account_data] skipped=no_database_url")
        return {"skipped": True}
    if not await _tables_present(engine):
        logger.info("[account_data] skipped=migrations_500_504_not_applied")
        return {"skipped": True}
    owner = worker_id()
    storage = storage or ex.StorageAdapter()
    summary: dict[str, Any] = {"erasure": [], "exports": [], "cleanup": None}
    if erase and settings.ACCOUNT_ERASURE_ENABLED:
        auth = auth or er.AuthAdapter()
        for request_id in await er.due_request_ids(engine, ERASE_BATCH):
            outcome = await er.erase_one(engine, request_id, owner=owner,
                                         lease_seconds=settings.ACCOUNT_ERASURE_LEASE_SECONDS,
                                         max_attempts=settings.ACCOUNT_ERASURE_MAX_ATTEMPTS,
                                         storage=storage, auth=auth, send=send)
            logger.info("[account_data] erasure request=%s outcome=%s", request_id, outcome)
            summary["erasure"].append(outcome)
    else:
        for item in await er.dry_run(engine):
            logger.info("[account_data] erasure dry_run request=%s tables=%d rows=%d", item["request_id"],
                        len(item["rows"]), sum(item["rows"].values()))
            summary["erasure"].append({"dry_run": item})
    for _ in range(EXPORT_BATCH):
        outcome = await ex.run_one(engine, owner=owner, storage=storage,
                                   lease_seconds=settings.ACCOUNT_ERASURE_LEASE_SECONDS,
                                   max_bytes=settings.ACCOUNT_EXPORT_MAX_BYTES,
                                   link_days=settings.ACCOUNT_EXPORT_LINK_DAYS, send=send)
        if outcome is None:
            break
        logger.info("[account_data] export outcome=%s", outcome)
        summary["exports"].append(outcome)
    summary["cleanup"] = await ex.cleanup(engine, storage)
    logger.info("[account_data] export cleanup expired=%d removed=%d", summary["cleanup"]["expired"],
                summary["cleanup"]["removed"])
    return summary


def run(*, erase: Optional[bool] = None) -> None:
    """The enrollment-sweep step. Erasure runs for real only when the flag is
    on; otherwise the step logs the dry-run."""
    asyncio.run(run_async(erase=settings.ACCOUNT_ERASURE_ENABLED if erase is None else erase))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--erase", action="store_true",
                        help="erase for real (still needs ACCOUNT_ERASURE_ENABLED=true)")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    try:
        run(erase=args.erase)
    except Exception as exc:
        logger.error("[account_data] sweep failed: %s", type(exc).__name__)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
