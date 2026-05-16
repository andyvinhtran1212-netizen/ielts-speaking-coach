"""Sprint 10.7 — pin the vocab archive → user_d1_questions cascade.

Every site that flips `user_vocabulary.is_archived` MUST also flip the
matching `user_d1_questions.is_active`. The session endpoint also
filters defensively (test_d1_session covers that), but the cascade is
the canonical write — it's what keeps the two tables in sync for
admin queries, analytics, and any future direct-SQL consumers.

Sites under test (4 in this sprint):

  1. DELETE /{vocab_id}          (archive_vocab)
  2. POST   /pending/{id}/drop   (drop_pending)
  3. POST   /{id}/report-fp      (report_false_positive)
  4. POST   /{vocab_id}/restore  (restore_vocab — REVERSE cascade)

Plus the negative-contract pin:
  - Failure in the cascade write must NOT break the primary archive
    response (best-effort, errors logged at WARN).

The mock builder uses the same predicate-recording pattern as
test_vocab_pending.py (Sprint 10.4) so per-table updates can be
verified independently — checking that BOTH user_vocabulary AND
user_d1_questions saw the right UPDATE.
"""

from __future__ import annotations

import asyncio

import pytest

from routers import vocabulary_bank as vb


def _run(coro):
    return asyncio.run(coro)


# ── Mock builder (reuses the Sprint 10.4 pattern) ────────────────────


class _Builder:
    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple[str, str, object]] = []

    def select(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self

    def eq(self, col, val):
        self._filters.append(("eq", col, val))
        return self

    def neq(self, col, val):
        self._filters.append(("neq", col, val))
        return self

    def update(self, row_patch):
        outer = self
        parent = self._parent
        table = self._table

        class _Updater:
            def __init__(self_inner):
                self_inner._filters: list[tuple] = list(outer._filters)
                self_inner._patch = row_patch

            def eq(self_inner, col, val):
                self_inner._filters.append(("eq", col, val))
                return self_inner

            def execute(self_inner):
                rows = parent.canned.get(table, [])
                matched = _apply(rows, self_inner._filters)
                for row in matched:
                    row.update(self_inner._patch)
                parent.updates.append((table, dict(self_inner._patch), list(self_inner._filters)))

                class _R: data = matched; count = None
                return _R()

        return _Updater()

    def execute(self):
        rows = _apply(self._parent.canned.get(self._table, []), self._filters)

        class _R:
            pass
        r = _R()
        r.data = [dict(row) for row in rows]
        r.count = None
        return r


def _apply(rows: list[dict], filters: list[tuple]) -> list[dict]:
    out = rows
    for op, col, val in filters:
        if op == "eq":
            out = [r for r in out if r.get(col) == val]
        elif op == "neq":
            out = [r for r in out if r.get(col) != val]
    return out


class _Client:
    def __init__(self, canned: dict, *, fail_d1_update: bool = False):
        self.canned = {k: [dict(r) for r in v] for k, v in canned.items()}
        self.updates: list[tuple] = []
        self._fail_d1_update = fail_d1_update

    def table(self, name=None, *_a, **_k):
        if self._fail_d1_update and name == "user_d1_questions":
            return _FailingBuilder(self, name)
        return _Builder(self, name)


class _FailingBuilder(_Builder):
    """Used by the failure-isolation test — every .update().execute()
    raises so we can confirm the cascade failure doesn't propagate."""
    def update(self, row_patch):
        class _FailUpdater:
            def eq(self_inner, *_a, **_k): return self_inner
            def execute(self_inner):
                raise RuntimeError("simulated d1_questions update outage")
        return _FailUpdater()


def _patch(monkeypatch, canned: dict, *, user_id: str = "user-A",
           fail_d1_update: bool = False):
    client = _Client(canned, fail_d1_update=fail_d1_update)

    async def _fake_auth(_authz):
        return {"id": user_id}

    monkeypatch.setattr(vb, "_require_auth", _fake_auth)
    monkeypatch.setattr(vb, "_vocab_bank_enabled", lambda _uid: True)
    monkeypatch.setattr(vb, "_user_sb", lambda _token: client)
    monkeypatch.setattr(vb, "_fire_event", lambda *_a, **_k: None)
    return client, "Bearer fake-jwt"


def _bank_row(vocab_id: str = "v1", *, is_archived: bool = False,
              is_pending: bool = False) -> dict:
    return {
        "id":         vocab_id,
        "user_id":    "user-A",
        "headword":   f"word-{vocab_id}",
        "is_archived": is_archived,
        "is_pending":  is_pending,
        "is_skipped":  False,
        "source_type": "manual",
        "pending_created_at": None,
        "created_at": "2026-05-01T00:00:00+00:00",
    }


def _d1_q(vocab_id: str, q_id: str = "pq-1", is_active: bool = True) -> dict:
    return {
        "id":            q_id,
        "user_id":       "user-A",
        "vocabulary_id": vocab_id,
        "is_active":     is_active,
    }


# ── DELETE /{id} cascade ─────────────────────────────────────────────


def test_archive_cascades_to_user_d1_questions(monkeypatch):
    """DELETE /{vocab_id} flips user_vocabulary.is_archived=true and
    cascades to user_d1_questions.is_active=false for every D1 row
    bound to that vocab."""
    canned = {
        "user_vocabulary": [_bank_row("v1")],
        "user_d1_questions": [_d1_q("v1"), _d1_q("v1", q_id="pq-2")],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(vb.archive_vocab(vocab_id="v1", authorization=authz))

    # The primary archive write happened.
    bank_updates = [u for u in client.updates if u[0] == "user_vocabulary"]
    assert len(bank_updates) == 1
    _, patch, _ = bank_updates[0]
    assert patch == {"is_archived": True}

    # AND the cascade fired.
    d1_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert len(d1_updates) == 1, (
        f"expected exactly one user_d1_questions cascade UPDATE; got: {client.updates}"
    )
    _, d1_patch, d1_filters = d1_updates[0]
    assert d1_patch == {"is_active": False}
    # The cascade scopes by vocabulary_id only — RLS handles user
    # scoping at the DB layer.
    assert ("eq", "vocabulary_id", "v1") in d1_filters


def test_archive_404_does_not_cascade(monkeypatch):
    """DELETE /{vocab_id} on a non-existent vocab raises 404 BEFORE the
    archive write. The cascade must not fire — otherwise we'd be
    flipping unrelated rows (and there's nothing to cascade against
    anyway)."""
    from fastapi import HTTPException

    canned = {
        "user_vocabulary": [],
        "user_d1_questions": [_d1_q("v1")],
    }
    client, authz = _patch(monkeypatch, canned)
    with pytest.raises(HTTPException) as exc:
        _run(vb.archive_vocab(vocab_id="v1", authorization=authz))
    assert exc.value.status_code == 404
    assert client.updates == [], (
        "404 path must not touch user_vocabulary OR user_d1_questions"
    )


# ── POST /pending/{id}/drop cascade ──────────────────────────────────


def test_drop_pending_cascades_to_user_d1_questions(monkeypatch):
    """Pending drop is a soft-delete via is_archived=true; cascade
    applies even though pending rows shouldn't have D1 questions in
    practice (Phase 1 generation runs on /confirm). The cascade is
    cheap + idempotent — running it unconditionally guards against
    out-of-order writes."""
    canned = {
        "user_vocabulary": [_bank_row("v1", is_pending=True)],
        "user_d1_questions": [_d1_q("v1")],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(vb.drop_pending(vocab_id="v1", authorization=authz))

    d1_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert len(d1_updates) == 1
    _, d1_patch, _ = d1_updates[0]
    assert d1_patch == {"is_active": False}


# ── POST /{id}/report-fp cascade ─────────────────────────────────────


def test_report_false_positive_cascades_to_user_d1_questions(monkeypatch):
    canned = {
        "user_vocabulary": [_bank_row("v1")],
        "user_d1_questions": [_d1_q("v1")],
    }
    client, authz = _patch(monkeypatch, canned)
    body = vb.VocabFPReportRequest(reason="not real word")
    _run(vb.report_false_positive(vocab_id="v1", body=body, authorization=authz))

    d1_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert len(d1_updates) == 1
    _, d1_patch, _ = d1_updates[0]
    assert d1_patch == {"is_active": False}


# ── POST /{id}/restore — REVERSE cascade ─────────────────────────────


def test_restore_reactivates_user_d1_questions(monkeypatch):
    """Restore is the inverse of archive — flips user_vocabulary.
    is_archived=false AND reactivates the associated D1 questions so
    the user can practise them again."""
    canned = {
        "user_vocabulary": [_bank_row("v1", is_archived=True)],
        "user_d1_questions": [_d1_q("v1", is_active=False)],
    }
    client, authz = _patch(monkeypatch, canned)
    _run(vb.restore_vocab(vocab_id="v1", authorization=authz))

    bank_updates = [u for u in client.updates if u[0] == "user_vocabulary"]
    _, patch, _ = bank_updates[0]
    assert patch == {"is_archived": False}

    d1_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert len(d1_updates) == 1
    _, d1_patch, _ = d1_updates[0]
    assert d1_patch == {"is_active": True}, (
        "restore must REACTIVATE D1 questions; got patch {d1_patch}"
    )


def test_restore_already_alive_short_circuits_no_cascade(monkeypatch):
    """Restoring a row that's already alive is a documented no-op.
    No bank write → no cascade either (saves a redundant DB write)."""
    canned = {
        "user_vocabulary": [_bank_row("v1", is_archived=False)],
        "user_d1_questions": [_d1_q("v1", is_active=True)],
    }
    client, authz = _patch(monkeypatch, canned)
    resp = _run(vb.restore_vocab(vocab_id="v1", authorization=authz))
    assert resp.get("already_alive") is True
    assert client.updates == [], (
        "already-alive restore must be a true no-op; saw: {client.updates}"
    )


# ── Failure isolation — cascade error MUST NOT break the response ────


def test_cascade_failure_does_not_break_archive_response(monkeypatch):
    """Sprint 10.7 negative-contract pin — the cascade is best-effort.
    If the D1 questions UPDATE fails (transient outage, RLS edge case),
    the archive response stays 200 — the primary write already
    succeeded and that's what the caller cares about. A future fix-up
    sweep can reconcile orphan D1 questions; the user-visible archive
    must not regress."""
    canned = {
        "user_vocabulary": [_bank_row("v1")],
        "user_d1_questions": [_d1_q("v1")],
    }
    client, authz = _patch(monkeypatch, canned, fail_d1_update=True)
    resp = _run(vb.archive_vocab(vocab_id="v1", authorization=authz))
    assert resp == {"ok": True}, (
        "cascade failure must not break the archive response shape"
    )
    # Primary write still happened.
    bank_updates = [u for u in client.updates if u[0] == "user_vocabulary"]
    assert len(bank_updates) == 1
    # D1 update was attempted but raised → not in the recorded list.
    d1_updates = [u for u in client.updates if u[0] == "user_d1_questions"]
    assert d1_updates == []
