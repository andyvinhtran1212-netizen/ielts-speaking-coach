"""Sprint 11.3 — pin segmented dictation contracts (DEBT-LISTENING-
MODULE 3/5).

Three layers exercised:

  1. _validate_dictation_segments — pure-Python validator. Tests cover
     contiguous idx, monotonic times, non-overlap, transcript present,
     duration bound.
  2. POST /admin/listening/exercises — admin upsert (create + update),
     validates segments inline, 404 on missing content, 422 on bad
     segments.
  3. GET /admin/listening/exercises + GET /api/listening/exercises —
     list endpoints (admin sees drafts, user sees published only).
  4. DELETE /admin/listening/exercises/{id} — soft delete via
     status='archived'.
  5. POST /api/listening/attempts with segment_idx — grades against
     the right segment, first-attempt rule per (user, exercise,
     segment), out-of-range 422, segment_idx-without-exercise 422.
"""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from routers import listening as listening_router

EXERCISE_ONE = "00000000-0000-0000-0000-000000000101"
EXERCISE_TWO = "00000000-0000-0000-0000-000000000102"
EXERCISE_MISSING = "00000000-0000-0000-0000-000000000199"


# ── _validate_dictation_segments unit tests ──────────────────────────


def test_validate_segments_happy_path():
    segs = [
        {"idx": 0, "start_sec": 0.0,  "end_sec": 3.5, "transcript": "Hello."},
        {"idx": 1, "start_sec": 3.5,  "end_sec": 7.0, "transcript": "World."},
    ]
    out = listening_router._validate_dictation_segments(
        segs, audio_duration_seconds=15,
    )
    assert len(out) == 2
    assert out[0]["idx"] == 0
    assert out[1]["transcript"] == "World."


def test_validate_segments_rejects_non_contiguous_idx():
    segs = [
        {"idx": 0, "start_sec": 0.0, "end_sec": 3.0, "transcript": "a"},
        {"idx": 2, "start_sec": 3.0, "end_sec": 6.0, "transcript": "b"},
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=10)
    assert exc.value.status_code == 422
    assert "contiguous" in str(exc.value.detail).lower()


def test_validate_segments_rejects_end_before_start():
    segs = [
        {"idx": 0, "start_sec": 5.0, "end_sec": 3.0, "transcript": "a"},
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=10)
    assert exc.value.status_code == 422
    assert "end_sec" in str(exc.value.detail) or "start_sec" in str(exc.value.detail)


def test_validate_segments_rejects_overlap():
    segs = [
        {"idx": 0, "start_sec": 0.0, "end_sec": 5.0, "transcript": "a"},
        {"idx": 1, "start_sec": 3.0, "end_sec": 7.0, "transcript": "b"},
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=10)
    assert exc.value.status_code == 422
    assert "overlap" in str(exc.value.detail).lower()


def test_validate_segments_rejects_out_of_duration():
    segs = [
        {"idx": 0, "start_sec": 0.0, "end_sec": 5.0, "transcript": "a"},
        {"idx": 1, "start_sec": 5.0, "end_sec": 20.0, "transcript": "b"},
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=15)
    assert exc.value.status_code == 422
    assert "exceeds content duration" in str(exc.value.detail).lower()


def test_validate_segments_rejects_empty_transcript():
    segs = [
        {"idx": 0, "start_sec": 0.0, "end_sec": 3.0, "transcript": "   "},
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=10)
    assert exc.value.status_code == 422
    assert "empty" in str(exc.value.detail).lower()


def test_validate_segments_rejects_empty_list():
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments([], audio_duration_seconds=10)
    assert exc.value.status_code == 422


def test_validate_segments_rejects_more_than_editor_limit():
    segments = [
        {"idx": i, "start_sec": i, "end_sec": i + 1, "transcript": f"Segment {i}"}
        for i in range(listening_router.MAX_LISTENING_SEGMENTS + 1)
    ]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(
            segments,
            audio_duration_seconds=len(segments) + 1,
        )
    assert exc.value.status_code == 422
    assert str(listening_router.MAX_LISTENING_SEGMENTS) in str(exc.value.detail)


def test_timestamp_comparison_accepts_equivalent_postgres_serializations():
    assert listening_router._same_timestamp(
        "2026-08-14T00:00:00.100000+00:00",
        "2026-08-14T00:00:00.1Z",
    )
    assert not listening_router._same_timestamp(
        "2026-08-14T00:00:00.1+00:00",
        "2026-08-14T00:00:01.1+00:00",
    )


def test_validate_segments_rejects_bad_field_types():
    segs = [{"idx": "zero", "start_sec": 0, "end_sec": 3, "transcript": "a"}]
    with pytest.raises(HTTPException) as exc:
        listening_router._validate_dictation_segments(segs, audio_duration_seconds=10)
    assert exc.value.status_code == 422


def test_validate_segments_tolerates_half_second_slack():
    """The renderer's duration estimate is coarse — accept 0.5s slack."""
    segs = [
        {"idx": 0, "start_sec": 0.0, "end_sec": 15.4, "transcript": "a"},
    ]
    out = listening_router._validate_dictation_segments(
        segs, audio_duration_seconds=15,
    )
    assert out[0]["end_sec"] == 15.4


# ── Fake admin client (reused from test_listening_attempts.py) ───────


class _FakeRes:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class _StructuredUniqueViolation(Exception):
    code = "23505"


class _FakeTableQuery:
    """Extended Sprint 11.3 — supports .update() in addition to .insert()."""

    def __init__(self, parent, table_name: str):
        self._parent = parent
        self._table = table_name
        self._filters: list[tuple[str, object]] = []
        self._insert: dict | None = None
        self._update: dict | None = None
        self._count_mode: str | None = None
        self._range: tuple[int, int] | None = None
        self._order: tuple[str, bool] | None = None

    def select(self, *_a, count=None, **_k):
        self._count_mode = count
        self._parent.selects.append((self._table, _a[0] if _a else None))
        return self

    def limit(self, *_a, **_k): return self

    def order(self, col, desc=False):
        self._order = (col, desc)
        return self

    def range(self, lo, hi):
        self._range = (lo, hi)
        return self

    def eq(self, col, val):
        self._filters.append((col, val))
        return self

    def insert(self, payload):
        self._insert = payload
        self._parent.inserts.append((self._table, payload))
        return self

    def update(self, payload):
        self._update = payload
        self._parent.updates.append((self._table, list(self._filters), payload))
        return self

    def execute(self):
        if self._insert is not None:
            if self._parent.concurrent_insert_row is not None:
                winner = self._parent.concurrent_insert_row
                self._parent.concurrent_insert_row = None
                self._parent.canned.setdefault(self._table, []).append(winner)
                raise _StructuredUniqueViolation("conflict")
            if self._parent.unique_violation_on_insert == "structured":
                raise _StructuredUniqueViolation("conflict")
            if self._parent.unique_violation_on_insert:
                raise RuntimeError("23505 duplicate key unique constraint")
            if self._parent.drop_inserts:
                return _FakeRes([])
            self._parent.canned.setdefault(self._table, []).append(self._insert)
            return _FakeRes([self._insert])
        if self._update is not None:
            # Apply update to matching rows so subsequent reads see the change.
            rows = list(self._parent.canned.get(self._table, []))
            matched = [r for r in rows if all(r.get(c) == v for c, v in self._filters)]
            if self._parent.drop_updates:
                return _FakeRes([])
            for r in matched:
                r.update(self._update)
            return _FakeRes(matched)
        rows = list(self._parent.canned.get(self._table, []))
        for col, val in self._filters:
            rows = [
                r for r in rows
                if (
                    listening_router._same_timestamp(r.get(col), val)
                    if col == "updated_at"
                    else r.get(col) == val
                )
            ]
        if self._order is not None:
            col, desc = self._order
            rows.sort(key=lambda row: row.get(col), reverse=desc)
        total = len(rows)
        if self._range is not None:
            lo, hi = self._range
            rows = rows[lo:hi + 1]
        return _FakeRes(rows, count=total if self._count_mode == "exact" else None)


class _FakeStorageBucket:
    def __init__(self, parent, bucket):
        self._parent = parent
        self._bucket = bucket

    def create_signed_url(self, path, ttl):
        return {"signedURL": f"https://test/{self._bucket}/{path}?ttl={ttl}"}


class _FakeStorage:
    def __init__(self, parent):
        self._parent = parent

    def from_(self, bucket):
        return _FakeStorageBucket(self._parent, bucket)


class _FakeAdminClient:
    def __init__(self, canned=None):
        self.canned = canned or {}
        self.inserts: list[tuple] = []
        self.updates: list[tuple] = []
        self.selects: list[tuple[str, str | None]] = []
        self.drop_updates = False
        self.drop_inserts = False
        self.unique_violation_on_insert = False
        self.concurrent_insert_row: dict | None = None
        self.storage = _FakeStorage(self)

    def table(self, name):
        return _FakeTableQuery(self, name)


def _patch_user_auth(monkeypatch, user_id="user-1"):
    async def _f(_a): return {"id": user_id}
    monkeypatch.setattr(listening_router, "get_supabase_user", _f)
    return "Bearer fake-user-jwt"


def _patch_admin_auth(monkeypatch, user_id="admin-1"):
    async def _f(_a): return {"id": user_id, "email": "a@b.c"}
    monkeypatch.setattr(listening_router, "require_admin", _f)
    return "Bearer fake-admin-jwt"


def _patch_admin_client(monkeypatch, fake):
    monkeypatch.setattr(listening_router, "supabase_admin", fake)


def _run(coro): return asyncio.run(coro)


# ── POST /admin/listening/exercises ──────────────────────────────────


def _content_row(content_id="c1", duration=15):
    return {
        "id": content_id,
        "status": "published",
        "audio_duration_seconds": duration,
        "transcript": "Hello world.",
        "audio_storage_path": f"ai/{content_id}.mp3",
        "updated_at": "2026-08-14T00:00:00+00:00",
    }


def _good_segments():
    return [
        {"idx": 0, "start_sec": 0.0, "end_sec": 4.0, "transcript": "Hello."},
        {"idx": 1, "start_sec": 4.0, "end_sec": 8.0, "transcript": "World."},
    ]


def test_admin_exercise_upsert_creates_new(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()],
                             "listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation",
        segments=_good_segments(), status="published",
    )
    out = _run(listening_router.admin_upsert_listening_exercise(
        body=body, authorization=authz,
    ))
    assert out["ok"] is True
    assert out["created"] is True
    assert out["exercise_id"]

    inserts = [p for t, p in fake.inserts if t == "listening_exercises"]
    assert len(inserts) == 1
    assert inserts[0]["exercise_type"] == "dictation"
    assert len(inserts[0]["segments"]) == 2


def test_admin_exercise_dictation_save_requires_explicit_segments(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", status="published",
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 422
    assert fake.inserts == []


def test_admin_exercise_upsert_updates_existing(monkeypatch):
    fake = _FakeAdminClient({
        "listening_content": [_content_row()],
        "listening_exercises": [{
            "id": "ex-existing",
            "content_id": "c1",
            "exercise_type": "dictation",
            "order_num": 1,
            "status": "draft",
            "segments": [],
            "updated_at": "2026-08-14T00:00:00+00:00",
        }],
    })
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation",
        segments=_good_segments(), status="published",
    )
    out = _run(listening_router.admin_upsert_listening_exercise(
        body=body, authorization=authz,
    ))
    assert out["created"] is False
    assert out["exercise_id"] == "ex-existing"
    # No INSERT — only UPDATE.
    assert [t for t, _ in fake.inserts if t == "listening_exercises"] == []
    updates = [u for u in fake.updates if u[0] == "listening_exercises"]
    assert len(updates) == 1


def test_lazy_dictation_create_adopts_concurrent_order_one_winner(monkeypatch):
    fake = _FakeAdminClient({"listening_exercises": []})
    fake.concurrent_insert_row = {
        "id": EXERCISE_ONE,
        "content_id": "c1",
        "exercise_type": "dictation",
        "order_num": 1,
        "status": "published",
    }
    _patch_admin_client(monkeypatch, fake)

    assert listening_router._ensure_dictation_exercise("c1") == EXERCISE_ONE
    assert len([payload for table, payload in fake.inserts if table == "listening_exercises"]) == 1


def test_lazy_dictation_create_adopts_existing_authored_block_at_another_order(monkeypatch):
    fake = _FakeAdminClient({"listening_exercises": [{
        "id": EXERCISE_TWO,
        "content_id": "c1",
        "exercise_type": "dictation",
        "order_num": 2,
        "status": "published",
    }]})
    _patch_admin_client(monkeypatch, fake)

    assert listening_router._ensure_dictation_exercise("c1") == EXERCISE_TWO
    assert [payload for table, payload in fake.inserts if table == "listening_exercises"] == []


def test_lazy_dictation_create_uses_lowest_authored_order(monkeypatch):
    fake = _FakeAdminClient({"listening_exercises": [
        {
            "id": EXERCISE_TWO,
            "content_id": "c1",
            "exercise_type": "dictation",
            "order_num": 2,
            "status": "published",
        },
        {
            "id": EXERCISE_ONE,
            "content_id": "c1",
            "exercise_type": "dictation",
            "order_num": 1,
            "status": "published",
        },
    ]})
    _patch_admin_client(monkeypatch, fake)

    assert listening_router._ensure_dictation_exercise("c1") == EXERCISE_ONE
    assert fake.inserts == []


def test_lazy_dictation_create_persists_explicit_empty_segments(monkeypatch):
    fake = _FakeAdminClient({"listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)

    listening_router._ensure_dictation_exercise("c1")
    insert = [payload for table, payload in fake.inserts if table == "listening_exercises"][0]
    assert insert["segments"] == []


def test_admin_exercise_versioned_update_targets_exact_block(monkeypatch):
    first = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    second = {
        "id": EXERCISE_TWO, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 2, "status": "published", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [first, second]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_TWO, exercise_type="dictation",
        order_num=2, segments=_good_segments(), status="draft",
        expected_updated_at=second["updated_at"],
    )
    out = _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))

    assert out["exercise_id"] == EXERCISE_TWO
    assert first["status"] == "draft"
    assert first["updated_at"] == "2026-08-14T00:00:00+00:00"
    assert second["status"] == "draft"
    assert second["updated_at"] != "2026-08-14T00:00:00+00:00"


def test_admin_exercise_versioned_update_rejects_stale_block(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(), expected_updated_at="stale",
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409
    assert fake.updates == []


def test_admin_exercise_expected_absent_rejects_existing_order_block(monkeypatch):
    row = {
        "id": "ex-1", "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=1,
        segments=_good_segments(), expected_absent=True,
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409
    assert fake.inserts == []


def test_admin_exercise_atomic_version_race_is_conflict(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    fake.drop_updates = True
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(), expected_updated_at=row["updated_at"],
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409


def test_admin_exercise_exact_update_requires_version(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(),
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 422
    assert fake.updates == []


def test_admin_exercise_exact_update_rejects_non_uuid_identity(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id="not-a-uuid", exercise_type="dictation",
        order_num=1, segments=_good_segments(),
        expected_updated_at="2026-08-14T00:00:00+00:00",
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 422
    assert fake.updates == []


def test_admin_exercise_exact_missing_never_falls_through_to_create(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_MISSING, exercise_type="dictation",
        order_num=1, segments=_good_segments(),
        expected_updated_at="2026-08-14T00:00:00+00:00",
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409
    assert fake.inserts == []


def test_admin_exercise_exact_identity_mismatch_is_conflict(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "other", "exercise_type": "dictation",
        "order_num": 2, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(), expected_updated_at=row["updated_at"],
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409
    assert fake.updates == []


def test_admin_exercise_segments_only_update_preserves_existing_payload(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "payload": {"instructions": "Keep me", "tolerance": 0.8},
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(), expected_updated_at=row["updated_at"],
    )

    _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert row["payload"] == {"instructions": "Keep me", "tolerance": 0.8}
    assert fake.updates[-1][2]["payload"] == row["payload"]


def test_admin_exercise_archived_status_round_trips(monkeypatch):
    row = {
        "id": EXERCISE_ONE, "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "published", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_id=EXERCISE_ONE, exercise_type="dictation",
        order_num=1, segments=_good_segments(), status="archived",
        expected_updated_at=row["updated_at"],
    )

    out = _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    listed = _run(listening_router.admin_list_listening_exercises(
        content_id="c1", exercise_type="dictation", authorization=authz,
    ))
    assert out["exercise_id"] == EXERCISE_ONE
    assert listed["exercises"][0]["status"] == "archived"


def test_admin_exercise_legacy_upsert_is_order_scoped(monkeypatch):
    first = {
        "id": "legacy-1", "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    second = {
        "id": "legacy-2", "content_id": "c1", "exercise_type": "dictation",
        "order_num": 2, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [first, second]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=2,
        segments=_good_segments(), status="published",
    )

    out = _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert out["exercise_id"] == "legacy-2"
    assert first["status"] == "draft"
    assert second["status"] == "published"


def test_admin_exercise_legacy_implicit_order_updates_imported_block(monkeypatch):
    imported = {
        "id": "legacy-gist-3", "content_id": "c1", "exercise_type": "gist",
        "order_num": 3, "status": "draft",
        "payload": {"prompt_text": "Old prompt", "model_answer": "Old answer"},
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({
        "listening_content": [_content_row()],
        "listening_exercises": [imported],
    })
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1",
        exercise_type="gist",
        payload={"prompt_text": "New prompt", "model_answer": "New answer"},
        status="published",
    )

    out = _run(listening_router.admin_upsert_listening_exercise(
        body=body,
        authorization=authz,
    ))
    assert out["created"] is False
    assert out["exercise_id"] == "legacy-gist-3"
    assert imported["order_num"] == 3
    assert imported["payload"]["prompt_text"] == "New prompt"
    assert fake.inserts == []


def test_admin_exercise_expected_absent_requires_explicit_order(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1",
        exercise_type="dictation",
        segments=_good_segments(),
        expected_absent=True,
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(
            body=body,
            authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert fake.inserts == []


def test_admin_exercise_unconfirmed_legacy_update_never_returns_success(monkeypatch):
    row = {
        "id": "legacy-1", "content_id": "c1", "exercise_type": "dictation",
        "order_num": 1, "status": "draft", "segments": _good_segments(),
        "updated_at": "2026-08-14T00:00:00+00:00",
    }
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": [row]})
    fake.drop_updates = True
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=1,
        segments=_good_segments(),
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 500


def test_admin_exercise_concurrent_create_unique_violation_is_conflict(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    fake.unique_violation_on_insert = True
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=1,
        segments=_good_segments(), expected_absent=True,
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409


def test_admin_exercise_unconfirmed_insert_never_returns_success(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    fake.drop_inserts = True
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=1,
        segments=_good_segments(), expected_absent=True,
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 500
    assert fake.canned["listening_exercises"] == []


def test_admin_exercise_structured_unique_violation_is_conflict_for_legacy_caller(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()], "listening_exercises": []})
    fake.unique_violation_on_insert = "structured"
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)
    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation", order_num=1,
        segments=_good_segments(),
    )

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(body=body, authorization=authz))
    assert exc.value.status_code == 409


def test_admin_exercise_upsert_rejects_bad_segments(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="dictation",
        segments=[{"idx": 0, "start_sec": 5, "end_sec": 3, "transcript": "x"}],
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert fake.inserts == []


def test_admin_exercise_upsert_404_when_content_missing(monkeypatch):
    fake = _FakeAdminClient({"listening_content": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="missing", exercise_type="dictation",
        segments=_good_segments(),
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 404


def test_admin_exercise_upsert_rejects_unknown_type(monkeypatch):
    fake = _FakeAdminClient({"listening_content": [_content_row()]})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ListeningExerciseUpsertRequest(
        content_id="c1", exercise_type="banana",
        segments=_good_segments(),
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_upsert_listening_exercise(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422


# ── GET admin + user exercises ───────────────────────────────────────


def test_admin_list_exercises_sees_drafts(monkeypatch):
    canned = {"listening_exercises": [
        {"id": "ex-1", "content_id": "c1", "exercise_type": "dictation",
         "status": "draft", "order_num": 1, "segments": _good_segments(),
         "updated_at": "2026-08-14T00:00:00+00:00"},
        {"id": "ex-2", "content_id": "c1", "exercise_type": "dictation",
         "status": "published", "order_num": 2, "segments": _good_segments(),
         "updated_at": "2026-08-14T00:00:00+00:00"},
    ]}
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_list_listening_exercises(
        content_id="c1", exercise_type="dictation", authorization=authz,
    ))
    assert len(out["exercises"]) == 2
    required = {"id", "content_id", "exercise_type", "order_num", "status", "updated_at", "segments"}
    assert required.issubset(out["exercises"][0])
    assert ("listening_exercises", "*") in fake.selects


def test_user_list_exercises_published_only(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [
            {"id": "ex-1", "content_id": "c1", "exercise_type": "dictation",
             "status": "draft",     "order_num": 1},
            {"id": "ex-2", "content_id": "c1", "exercise_type": "dictation",
             "status": "published", "order_num": 2,
             "segments": _good_segments()},
        ],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    out = _run(listening_router.get_listening_exercises(
        content_id="c1", exercise_type="dictation", authorization=authz,
    ))
    assert len(out["exercises"]) == 1
    assert out["exercises"][0]["id"] == "ex-2"


def test_user_list_exercises_404_when_content_unpublished(monkeypatch):
    canned = {"listening_content": [{
        **_content_row(),
        "status": "draft",
    }]}
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    with pytest.raises(HTTPException) as exc:
        _run(listening_router.get_listening_exercises(
            content_id="c1", exercise_type="dictation", authorization=authz,
        ))
    assert exc.value.status_code == 404


# ── DELETE admin exercise ────────────────────────────────────────────


def test_admin_delete_exercise_soft_archives(monkeypatch):
    canned = {"listening_exercises": [{
        "id": "ex-1", "content_id": "c1", "exercise_type": "dictation",
        "status": "published",
    }]}
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    out = _run(listening_router.admin_delete_listening_exercise(
        exercise_id="ex-1", authorization=authz,
    ))
    assert out["status"] == "archived"
    # Soft-delete = UPDATE with status='archived', NOT a DELETE.
    updates = [u for u in fake.updates if u[0] == "listening_exercises"]
    assert any(u[2].get("status") == "archived" for u in updates)


def test_admin_delete_exercise_404_when_missing(monkeypatch):
    _patch_admin_client(monkeypatch, _FakeAdminClient({"listening_exercises": []}))
    authz = _patch_admin_auth(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.admin_delete_listening_exercise(
            exercise_id="nope", authorization=authz,
        ))
    assert exc.value.status_code == 404


# ── Segmented attempts ───────────────────────────────────────────────


def _published_exercise_with_segments():
    return {
        "id": "ex-1",
        "content_id": "c1",
        "exercise_type": "dictation",
        "status": "published",
        "segments": _good_segments(),
    }


def test_attempt_segment_grades_against_segment_transcript(monkeypatch):
    """Sprint 11.3 — passing segment_idx grades against
    exercise.segments[idx].transcript, NOT content.transcript."""
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [_published_exercise_with_segments()],
        "listening_attempts": [],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1",
        mode="dictation",
        segment_idx=1,                 # second segment → "World."
        user_transcript="World.",
        listen_count=1,
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["score"] == 1.0       # perfect against "World."
    assert out["segment_idx"] == 1
    assert out["is_first_attempt"] is True

    attempt_inserts = [p for t, p in fake.inserts if t == "listening_attempts"]
    assert attempt_inserts[0]["segment_idx"] == 1


def test_attempt_segment_idx_out_of_range_422(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [_published_exercise_with_segments()],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation", segment_idx=99,
        user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "out of range" in str(exc.value.detail).lower()


def test_attempt_segment_idx_without_segmented_exercise_422(monkeypatch):
    canned = {
        "listening_content": [_content_row()],
        # No published dictation exercise.
        "listening_exercises": [],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation", segment_idx=0,
        user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422
    assert "segmented" in str(exc.value.detail).lower()


def test_attempt_segment_first_attempt_rule_per_segment(monkeypatch):
    """A second submission for the SAME segment marks not-first, but a
    FIRST submission for a DIFFERENT segment by the same user stays
    first-attempt."""
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [_published_exercise_with_segments()],
        # Prior attempt on segment 0 only.
        "listening_attempts": [{
            "id": "prev-1",
            "user_id": "user-1",
            "exercise_id": "ex-1",
            "segment_idx": 0,
            "score": 0.5,
        }],
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    # Same user submits segment 0 again → not first.
    body0 = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation", segment_idx=0,
        user_transcript="Hello.",
    )
    out0 = _run(listening_router.post_listening_attempt(
        body=body0, authorization=authz,
    ))
    assert out0["is_first_attempt"] is False

    # Same user submits segment 1 for the first time → first.
    body1 = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation", segment_idx=1,
        user_transcript="World.",
    )
    out1 = _run(listening_router.post_listening_attempt(
        body=body1, authorization=authz,
    ))
    assert out1["is_first_attempt"] is True


def test_attempt_falls_back_to_whole_content_when_no_segment_idx(monkeypatch):
    """Sprint 11.2 callers (no segment_idx) still work — falls back to
    the whole-content transcript."""
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [],   # no segmented exercise yet
    }
    fake = _FakeAdminClient(canned)
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        content_id="c1", mode="dictation",
        user_transcript="Hello world.",
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["segment_idx"] is None
    assert out["score"] == 1.0
    # Lazy-upsert created the legacy exercise row.
    assert any(t == "listening_exercises" for t, _ in fake.inserts)


def test_attempt_requires_content_or_exercise(monkeypatch):
    """422 when both content_id and exercise_id are omitted."""
    _patch_admin_client(monkeypatch, _FakeAdminClient())
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        mode="dictation", user_transcript="x",
    )
    with pytest.raises(HTTPException) as exc:
        _run(listening_router.post_listening_attempt(
            body=body, authorization=authz,
        ))
    assert exc.value.status_code == 422


def test_attempt_resolves_exercise_by_id(monkeypatch):
    """Passing exercise_id directly works (skips content lookup chain)."""
    canned = {
        "listening_content": [_content_row()],
        "listening_exercises": [_published_exercise_with_segments()],
        "listening_attempts": [],
    }
    _patch_admin_client(monkeypatch, _FakeAdminClient(canned))
    authz = _patch_user_auth(monkeypatch)

    body = listening_router.ListeningAttemptRequest(
        exercise_id="ex-1", mode="dictation", segment_idx=0,
        user_transcript="Hello.",
    )
    out = _run(listening_router.post_listening_attempt(
        body=body, authorization=authz,
    ))
    assert out["score"] == 1.0
    assert out["segment_idx"] == 0
