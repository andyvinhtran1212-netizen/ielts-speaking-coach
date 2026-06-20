"""PR-1 regrade-resilience — a failed REGRADE restores the pre-regrade status
instead of stranding the essay in 'failed' (which matches no queue → "mất bài").

A first-grade failure still goes to 'failed' (no prior good state). The prior
version + current_version pointer are untouched (GV-1b owns those; the pointer
only advances on success). regrade_count is NOT un-bumped (D1 metric).
"""

from __future__ import annotations

from services import essay_service


# ── recording fake: capture the writing_essays failure-update payload ──


class _Res:
    def __init__(self, data): self.data = data


class _Q:
    def __init__(self, name, store):
        self.name, self.store = name, store
        self.op, self.payload = "select", None

    def update(self, p): self.op = "update"; self.payload = p; return self
    def eq(self, *a, **k): return self

    def execute(self):
        if self.op == "update":
            self.store.setdefault(self.name, []).append(dict(self.payload))
        return _Res([{"id": "e"}])


class _FakeSB:
    def __init__(self): self.store = {}
    def table(self, name): return _Q(name, self.store)


def _run_mark_failed(restore_status):
    fake = _FakeSB()
    import unittest.mock as m
    with m.patch.object(essay_service, "supabase_admin", fake):
        essay_service._mark_failed("e", "j", RuntimeError("boom"),
                                   kind="InvalidJSONError", restore_status=restore_status)
    essay_updates = fake.store.get("writing_essays", [])
    job_updates = fake.store.get("writing_jobs", [])
    return essay_updates[0], job_updates[0]


# ── regrade-fail restores a prior good state ──────────────────────────


def test_regrade_fail_restores_delivered():
    essay_u, job_u = _run_mark_failed("delivered")
    assert essay_u["status"] == "delivered"          # restored, NOT 'failed' → no strand
    assert essay_u["error_message"]                   # diagnosis kept
    assert job_u["status"] == "failed"                # the job still records the failure


def test_regrade_fail_restores_reviewed_and_graded():
    assert _run_mark_failed("reviewed")[0]["status"] == "reviewed"
    assert _run_mark_failed("graded")[0]["status"] == "graded"


# ── first-grade fail (None) stays 'failed' ────────────────────────────


def test_first_grade_fail_stays_failed():
    essay_u, _ = _run_mark_failed(None)
    assert essay_u["status"] == "failed"


# ── unsafe captured status never restored ─────────────────────────────


def test_unsafe_status_defaults_to_failed():
    # a malformed/in-flight capture must NOT park the essay in 'grading'/'failed'/'pending'
    for bad in ("grading", "failed", "pending", "garbage"):
        assert _run_mark_failed(bad)[0]["status"] == "failed", bad


# ── restorable set is exactly the prior good states ───────────────────


def test_restorable_status_set():
    assert essay_service._RESTORABLE_STATUSES == {"graded", "reviewed", "delivered"}


# ── signature carries the new kwarg (call-site contract) ──────────────


def test_bg_grade_essay_accepts_restore_kwarg():
    import inspect
    sig = inspect.signature(essay_service._bg_grade_essay)
    assert "restore_status_on_fail" in sig.parameters
    assert sig.parameters["restore_status_on_fail"].default is None   # first-grade default
