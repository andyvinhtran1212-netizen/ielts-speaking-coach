"""Load backend/.env for one-off CLI scripts.

`database.py` builds the Supabase client at IMPORT time, so a script that
imports it without the environment already loaded dies with a bare
"supabase_url is required" — before printing anything of its own.

Two things make that easy to hit:
  • a git worktree has no `.env` of its own (it is gitignored), so scripts run
    from a worktree see nothing even though the main checkout has one;
  • exported shell variables do not survive between separate command
    invocations, so `source .env` in an earlier command is already gone.

An operator should not have to reconstruct the environment by hand to run a
script, least of all one that writes to prod. Import this BEFORE `database`.
"""
from __future__ import annotations

import os
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent


def load_env(required: str = "SUPABASE_URL") -> None:
    """No-op when the environment is already set (CI, Railway, a sourced shell)."""
    if os.getenv(required):
        return
    try:
        from dotenv import load_dotenv
    except ImportError:                                     # pragma: no cover
        return
    for candidate in _env_candidates():
        if candidate.exists():
            load_dotenv(candidate)
            if os.getenv(required):
                return


def _env_candidates() -> list[Path]:
    """backend/.env first, then the main checkout's when run from a worktree.

    A worktree lives at <repo>/.claude/worktrees/<name>/backend, so the main
    checkout's backend is four levels up from ours.
    """
    return [
        _BACKEND_ROOT / ".env",
        _BACKEND_ROOT.parent.parent.parent.parent / "backend" / ".env",
    ]
