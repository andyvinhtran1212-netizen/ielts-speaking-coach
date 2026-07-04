"""B4 (audit) — per-user rate limit on /auth/activate."""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from routers import auth


def test_allows_up_to_max_then_429(monkeypatch):
    monkeypatch.setattr(auth, "_activate_attempts", {})
    uid = "u1"
    for _ in range(auth._ACTIVATE_MAX_ATTEMPTS):
        auth._rate_limit_activate(uid)  # must not raise
    with pytest.raises(HTTPException) as ei:
        auth._rate_limit_activate(uid)
    assert ei.value.status_code == 429


def test_limit_is_per_user(monkeypatch):
    monkeypatch.setattr(auth, "_activate_attempts", {})
    for _ in range(auth._ACTIVATE_MAX_ATTEMPTS):
        auth._rate_limit_activate("u1")
    auth._rate_limit_activate("u2")  # different user unaffected — must not raise


def test_expired_attempts_are_pruned(monkeypatch):
    # Seed the window with only-stale timestamps → they prune → fresh budget.
    from time import perf_counter
    old = perf_counter() - auth._ACTIVATE_WINDOW_SECONDS - 1
    monkeypatch.setattr(auth, "_activate_attempts", {"u1": [old] * auth._ACTIVATE_MAX_ATTEMPTS})
    auth._rate_limit_activate("u1")  # stale entries pruned → must not raise
