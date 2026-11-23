"""ACCOUNTDATA-0100 T005: the erasure steps (FR-004, FR-005, FR-007…FR-009)
and migration 504 on a real PostgreSQL.

The database holds a small slice of the real schema: tables of each kind
(delete, keep, anonymize, child with a RESTRICT foreign key) and stand-ins
for the guards migration 504 patches. Each stand-in refuses every UPDATE or
DELETE, like the strictest real guard; after 504 the erasure function gets
through for the erased learner only.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import account_erasure as er
from tests.account_data_pg import make_engine, pg_database
from tests.test_account_data_export_job import FakeStorage

MIG = Path(__file__).resolve().parents[1] / "migrations"
SQL_504 = (MIG / "504_account_erasure.sql").read_text(encoding="utf-8")
DOWN_504 = (MIG / "rollback" / "504_account_erasure.sql").read_text(encoding="utf-8")

U1 = "00000000-0000-0000-0000-0000000040a1"
U2 = "00000000-0000-0000-0000-0000000040a2"
S1 = "00000000-0000-0000-0000-0000000040b1"
S2 = "00000000-0000-0000-0000-0000000040b2"
SESS1 = "00000000-0000-0000-0000-0000000040c1"
SESS2 = "00000000-0000-0000-0000-0000000040c2"
ITEM1 = "00000000-0000-0000-0000-0000000040d1"
ITEM2 = "00000000-0000-0000-0000-0000000040d2"
ENT1 = "00000000-0000-0000-0000-0000000040e1"

SCHEMA = f"""
INSERT INTO public.users (id, email, display_name, role) VALUES
  ('{U1}', 'an@example.test', 'An', 'student'), ('{U2}', 'b@example.test', 'B', 'student');
ALTER TABLE public.users ADD COLUMN target_band numeric, ADD COLUMN permissions jsonb NOT NULL DEFAULT '{{}}';
UPDATE public.users SET target_band = 7, permissions = '{{"x": true}}';
CREATE TABLE public.students (id uuid PRIMARY KEY, student_code text NOT NULL, full_name text NOT NULL,
    persona_notes text, user_id uuid REFERENCES public.users(id), created_at timestamptz DEFAULT now());
INSERT INTO public.students VALUES ('{S1}', 'HV1', 'Nguyễn An', 'thích nói', '{U1}', now()),
                                   ('{S2}', 'HV2', 'Bình', NULL, '{U2}', now());
CREATE TABLE public.sessions (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id), status text);
INSERT INTO public.sessions VALUES ('{SESS1}', '{U1}', 'completed'), ('{SESS2}', '{U2}', 'completed');
CREATE TABLE public.responses (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE, audio_storage_path text);
INSERT INTO public.responses (session_id, audio_storage_path) VALUES
  ('{SESS1}', '{U1}/{SESS1}/a.webm'), ('{SESS1}', 'legacy/an-old.webm'), ('{SESS2}', '{U2}/{SESS2}/b.webm');
CREATE TABLE public.grammar_recommendations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES public.users(id), response_id uuid REFERENCES public.responses(id));
INSERT INTO public.grammar_recommendations (user_id, response_id) SELECT s.user_id, r.id
  FROM public.responses r JOIN public.sessions s ON s.id = r.session_id;
CREATE TABLE public.class_assignment_items (id uuid PRIMARY KEY, student_id uuid REFERENCES public.students(id) ON DELETE CASCADE);
INSERT INTO public.class_assignment_items VALUES ('{ITEM1}', '{S1}'), ('{ITEM2}', '{S2}');
CREATE TABLE public.listening_drill_playback (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    class_assignment_item_id uuid NOT NULL REFERENCES public.class_assignment_items(id) ON DELETE RESTRICT);
INSERT INTO public.listening_drill_playback (class_assignment_item_id) VALUES ('{ITEM1}'), ('{ITEM2}');
CREATE TABLE public.learner_goal_events (id bigserial PRIMARY KEY, student_id uuid NOT NULL, user_id uuid NOT NULL);
INSERT INTO public.learner_goal_events (student_id, user_id) VALUES ('{S1}', '{U1}'), ('{S2}', '{U2}');
CREATE TABLE public.class_action_log (id bigserial PRIMARY KEY, student_id uuid, student_name text, action text);
INSERT INTO public.class_action_log (student_id, student_name, action) VALUES
  ('{S1}', 'Nguyễn An', 'extend'), ('{S2}', 'Bình', 'extend');
CREATE TABLE public.enrollment_orders (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, learner_note text);
INSERT INTO public.enrollment_orders (user_id, learner_note) VALUES ('{U1}', 'số điện thoại 09…'), ('{U2}', 'hi');
CREATE TABLE public.entitlements (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    status text NOT NULL, revoked_at timestamptz, revoke_reason text);
INSERT INTO public.entitlements VALUES ('{ENT1}', '{U1}', 'active', NULL, NULL);
CREATE TABLE public.entitlement_events (id bigserial PRIMARY KEY, entitlement_id uuid NOT NULL REFERENCES public.entitlements(id),
    action text, actor_kind text, before jsonb, after jsonb, reason text);
CREATE TABLE public.credit_ledger (id bigserial PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT, delta int);
INSERT INTO public.credit_ledger (user_id, delta) VALUES ('{U1}', 5);
CREATE TABLE public.user_code_assignments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL,
    is_active boolean NOT NULL DEFAULT true, revoked_at timestamptz);
INSERT INTO public.user_code_assignments (user_id) VALUES ('{U1}'), ('{U2}');
CREATE TABLE public.access_code_audit (id bigserial PRIMARY KEY, after jsonb);
INSERT INTO public.access_code_audit (after) VALUES
  ('{{"reason": "email_mismatch", "intended_email": "AN@example.test"}}'), ('{{"intended_email": "b@example.test"}}');

-- Stand-ins for the guards 504 patches: refuse every UPDATE or DELETE.
CREATE FUNCTION public.fn_learner_goal_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'learner_goal_events is append-only';
END;
$$;
CREATE TRIGGER trg_lge BEFORE UPDATE OR DELETE ON public.learner_goal_events
    FOR EACH ROW EXECUTE FUNCTION public.fn_learner_goal_events_append_only();
CREATE FUNCTION public.protect_advanced_vocab_item_evidence() RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp AS $f$
DECLARE
    -- begin: a comment the injected pass must not match
    x int;
BEGIN
    RAISE EXCEPTION 'cannot delete assignment item with advanced vocabulary evidence';
END;
$f$;
CREATE TRIGGER trg_item BEFORE DELETE ON public.class_assignment_items
    FOR EACH ROW EXECUTE FUNCTION public.protect_advanced_vocab_item_evidence();
CREATE FUNCTION public.fn_class_action_log_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'class_action_log chỉ THÊM';
END;
$$;
CREATE TRIGGER trg_cal BEFORE UPDATE OR DELETE ON public.class_action_log
    FOR EACH ROW EXECUTE FUNCTION public.fn_class_action_log_append_only();
"""


class FakeAuth(er.AuthAdapter):
    def __init__(self):
        super().__init__(client=object())
        self.deleted: list[str] = []

    def email(self, user_id):
        return None if user_id in self.deleted else {U1: "an@example.test", U2: "b@example.test"}[user_id]

    def soft_delete(self, user_id):
        self.deleted.append(user_id)


@pytest.fixture
def env():
    gen = pg_database(SCHEMA)
    url, run = next(gen)
    run(SQL_504)
    engine = make_engine(url)
    storage = FakeStorage()
    for path in (f"{U1}/{SESS1}/a.webm", "legacy/an-old.webm", f"{U2}/{SESS2}/b.webm"):
        storage.objects[("audio-responses", path)] = b"x"
    storage.objects[("account-exports", f"{U1}/e/old.zip")] = b"zip"
    letters = []

    async def send(template, to, payload, *, idempotency_key=None):
        letters.append((template, to, idempotency_key))
        return SimpleNamespace(ok=True, error=None)

    revoked = []

    async def revoke(_engine, uid):
        revoked.append(uid)
        return 1

    try:
        yield SimpleNamespace(engine=engine, run=run, storage=storage, auth=FakeAuth(), letters=letters,
                              send=send, revoked=revoked)
    finally:
        try:
            next(gen)
        except StopIteration:
            pass


def _request(env, user=U1, due=True):
    when = "now() - interval '1 minute'" if due else "now() + interval '30 days'"
    return env.run(f"INSERT INTO public.account_deletion_requests (user_id, requested_at, erase_after) "
                   f"VALUES ('{user}', now() - interval '31 days', {when}) RETURNING id")


def _erase(env, req, owner="w1", **kw):
    args = dict(owner=owner, lease_seconds=300, max_attempts=3, storage=env.storage, auth=env.auth,
                send=env.send, revoke_sessions=_revoker(env))
    args.update(kw)
    return asyncio.run(er.erase_one(env.engine, req, **args))


def _revoker(env):
    async def revoke(_engine, uid):
        env.revoked.append(uid)
    return revoke


def test_guards_still_refuse_outside_erasure(env):
    for sql in (f"DELETE FROM public.learner_goal_events WHERE user_id = '{U1}'",
                f"DELETE FROM public.class_assignment_items WHERE id = '{ITEM2}'",
                "UPDATE public.class_action_log SET student_name = NULL"):
        with pytest.raises(AssertionError):
            env.run(sql)
    # Even with the context set by hand, a request that is not 'erasing'
    # under that owner opens nothing.
    _request(env, due=False)
    with pytest.raises(AssertionError):
        env.run(f"BEGIN; SELECT set_config('aver.account_erasure_user', '{U1}', true); "
                f"SELECT set_config('aver.account_erasure_owner', 'w1', true); "
                f"DELETE FROM public.learner_goal_events WHERE user_id = '{U1}'; COMMIT;")


def test_full_erasure_of_one_learner(env):
    req = _request(env)
    _request(env, U2, due=False)
    assert _erase(env, req) == "erased"
    one = env.run
    assert one(f"SELECT status, erased_at IS NOT NULL, erased_notice_sent_at IS NOT NULL, erasing_owner IS NULL "
               f"FROM public.account_deletion_requests WHERE id = '{req}'") == "erased|t|t|t"
    # delete tables: only U1's rows are gone (cascades, RESTRICT child first).
    assert one("SELECT count(*) FROM public.sessions") == "1"
    assert one("SELECT count(*) FROM public.responses") == "1"
    assert one("SELECT count(*) FROM public.grammar_recommendations") == "1"
    assert one("SELECT string_agg(student_id::text, ',') FROM public.class_assignment_items") == S2
    assert one("SELECT count(*) FROM public.listening_drill_playback") == "1"
    assert one("SELECT string_agg(user_id::text, ',') FROM public.learner_goal_events") == U2
    # keep tables stay, pointing at the anonymised id.
    assert one(f"SELECT count(*) FROM public.credit_ledger WHERE user_id = '{U1}'") == "1"
    assert one(f"SELECT learner_note IS NULL FROM public.enrollment_orders WHERE user_id = '{U1}'") == "t"
    assert one(f"SELECT learner_note FROM public.enrollment_orders WHERE user_id = '{U2}'") == "hi"
    assert one(f"SELECT student_name IS NULL, action FROM public.class_action_log WHERE student_id = '{S1}'") == "t|extend"
    assert one(f"SELECT student_name FROM public.class_action_log WHERE student_id = '{S2}'") == "Bình"
    assert one("SELECT count(*) FROM public.access_code_audit WHERE after ? 'intended_email'") == "1"
    assert one("SELECT after ->> 'reason' FROM public.access_code_audit WHERE id = 1") == "email_mismatch"
    # anonymised rows.
    assert one(f"SELECT email, display_name IS NULL, role, is_active, target_band IS NULL, permissions "
               f"FROM public.users WHERE id = '{U1}'") == f"erased-{U1}@erased.invalid|t|student|f|t|{{}}"
    assert one(f"SELECT display_name, target_band FROM public.users WHERE id = '{U2}'") == "B|7"
    assert one(f"SELECT student_code, full_name, persona_notes IS NULL, user_id FROM public.students "
               f"WHERE id = '{S1}'") == f"HV1|Học viên đã xoá|t|{U1}"
    # FR-007.
    assert one(f"SELECT status, revoke_reason FROM public.entitlements WHERE id = '{ENT1}'") == "revoked|account_erased"
    assert one("SELECT action || ':' || actor_kind || ':' || reason FROM public.entitlement_events") == \
        "revoke:system:account_erased"
    assert one(f"SELECT is_active FROM public.user_code_assignments WHERE user_id = '{U1}'") == "f"
    assert one(f"SELECT is_active FROM public.user_code_assignments WHERE user_id = '{U2}'") == "t"
    # Storage, sessions, Auth, letter.
    assert sorted(p for _, p in env.storage.objects) == [f"{U2}/{SESS2}/b.webm"]
    assert env.revoked == [U1] and env.auth.deleted == [U1]
    assert env.letters == [("account_erased", "an@example.test", f"account-erased-{req}")]
    # Re-running after erasure claims nothing.
    assert _erase(env, req) == "skipped"


def test_not_due_and_cancelled_are_never_claimed(env):
    req = _request(env, due=False)
    assert _erase(env, req) == "skipped"
    env.run(f"UPDATE public.account_deletion_requests SET erase_after = now() - interval '1 minute', "
            f"status = 'cancelled', cancelled_at = now() WHERE id = '{req}'")
    assert _erase(env, req) == "skipped"
    assert env.run("SELECT count(*) FROM public.sessions") == "2"


def test_failure_releases_retries_and_marks_failed(env):
    req = _request(env)

    def broken_remove(bucket, paths):
        raise RuntimeError("storage down")

    env.storage.remove = broken_remove
    for attempt in (1, 2):
        assert _erase(env, req).startswith("error:storage:")
        assert env.run(f"SELECT status, attempts, last_error_code, lease_until <= now() "
                       f"FROM public.account_deletion_requests WHERE id = '{req}'") == \
            f"erasing|{attempt}|storage:RuntimeError|t"
    assert env.run("SELECT count(*) FROM public.sessions") == "2"  # nothing deleted yet
    assert _erase(env, req).startswith("error:")
    assert env.run(f"SELECT status FROM public.account_deletion_requests WHERE id = '{req}'") == "failed"
    assert _erase(env, req) == "skipped"


def test_lost_lease_stops_before_the_database_step(env):
    req = _request(env)

    async def stolen(_engine, uid):
        env.run(f"UPDATE public.account_deletion_requests SET erasing_owner = 'w2' WHERE id = '{req}'")

    assert _erase(env, req, revoke_sessions=stolen) == "lost"
    assert env.run("SELECT count(*) FROM public.sessions") == "2"
    # The function itself refuses a caller that is not the owner.
    with pytest.raises(AssertionError) as exc:
        env.run(f"SELECT public.fn_account_erase_learner('{req}', 'w1', '{{}}'::jsonb)")
    assert "account_erasure_not_owner" in str(exc.value)


def test_running_export_lease_defers_the_final_step(env):
    req = _request(env)
    env.run(f"INSERT INTO public.account_data_exports (user_id, status, export_owner, claim_token, lease_until) "
            f"VALUES ('{U1}', 'building', 'x', gen_random_uuid(), now() + interval '5 minutes')")
    # Step 0 cancels it but its lease is still live; step 5 deletes the row,
    # so put a second live one back to model a worker that has not noticed.
    real = er.export_lease_active
    calls = []

    async def live(engine, uid):
        calls.append(uid)
        return len(calls) == 1

    er.export_lease_active = live
    try:
        assert _erase(env, req) == "waiting_export"
        assert env.run(f"SELECT status, last_error_code, attempts FROM public.account_deletion_requests "
                       f"WHERE id = '{req}'") == "erasing|export_lease_active|0"
        assert _erase(env, req) == "erased"
    finally:
        er.export_lease_active = real
    assert len(env.letters) == 1  # the notice is not sent twice


def test_dry_run_counts_without_changing(env):
    _request(env)
    out = asyncio.run(er.dry_run(env.engine))
    assert len(out) == 1
    rows = out[0]["rows"]
    assert rows["sessions.user_id"] == 1 and rows["learner_goal_events.student_id"] == 1
    assert env.run("SELECT count(*) FROM public.sessions") == "2"


def test_rollback_removes_the_pass(env):
    env.run(DOWN_504)
    assert env.run("SELECT count(*) FROM pg_proc WHERE prosrc LIKE '%ACCOUNTDATA-0100 erasure pass%'") == "0"
    assert env.run("SELECT count(*) FROM pg_proc WHERE proname LIKE 'fn_account_eras%'") == "0"
    env.run(SQL_504)
    env.run(SQL_504)  # re-runnable, the pass is never added twice
    assert env.run("SELECT sum((length(prosrc) - length(replace(prosrc, 'erasure pass', ''))) / 12) "
                   "FROM pg_proc WHERE prosrc LIKE '%erasure pass%'") == "3"
    assert env.run("SELECT has_function_privilege('authenticated', "
                   "'public.fn_account_erase_learner(uuid,text,jsonb)', 'EXECUTE')") == "f"


def test_sweep_is_dry_run_until_the_flag_is_on(env, monkeypatch):
    from jobs import account_data_sweep as sweep
    req = _request(env)
    monkeypatch.setattr(er, "AuthAdapter", lambda: env.auth)
    monkeypatch.setattr(sweep.settings, "ACCOUNT_ERASURE_ENABLED", False)
    out = asyncio.run(sweep.run_async(erase=True, engine=env.engine, storage=env.storage, auth=env.auth,
                                      send=env.send))
    assert out["erasure"][0]["dry_run"]["request_id"] == req
    assert env.run(f"SELECT status FROM public.account_deletion_requests WHERE id = '{req}'") == "pending"
    monkeypatch.setattr(sweep.settings, "ACCOUNT_ERASURE_ENABLED", True)

    async def no_revoke(_engine, _uid):
        return 0

    monkeypatch.setattr("services.staff_security.delete_auth_sessions", no_revoke)
    out = asyncio.run(sweep.run_async(erase=True, engine=env.engine, storage=env.storage, auth=env.auth,
                                      send=env.send))
    assert out["erasure"] == ["erased"]
    assert out["cleanup"] == {"expired": 0, "removed": 0}
