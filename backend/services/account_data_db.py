"""ACCOUNTDATA-0100: the direct Postgres engine for account-data work.

Deletion requests, export jobs and the erasure steps need real transactions
(``FOR UPDATE``, conditional updates, many deletes in one commit), which the
PostgREST client cannot give. Everything goes through one SQLAlchemy
``AsyncEngine`` on ``DATABASE_URL`` (the ``postgres`` role, like
``services.staff_security``), created on first use. Tests inject their own
engine with :func:`set_engine`.
"""

from __future__ import annotations

from typing import Optional

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncEngine

from config import settings
from services.async_pg_engine import create_asyncpg_engine

_engine: Optional[AsyncEngine] = None


def set_engine(engine: Optional[AsyncEngine]) -> None:
    global _engine
    _engine = engine


def get_engine() -> Optional[AsyncEngine]:
    global _engine
    if _engine is None and settings.ASYNC_DATABASE_URL:
        _engine = create_asyncpg_engine(settings.ASYNC_DATABASE_URL, pool_size=2, max_overflow=2,
                                        pool_pre_ping=True)
    return _engine


def require_engine() -> AsyncEngine:
    engine = get_engine()
    if engine is None:
        raise HTTPException(503, detail={"error_code": "account_data_unavailable",
                                         "message": "Chưa xử lý được yêu cầu. Bạn thử lại sau ít phút nhé."})
    return engine
