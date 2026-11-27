"""ACCOUNTDATA-0100 T005: the erasure steps (FR-004, FR-005, FR-007…FR-009)
and migration 504 on a real PostgreSQL.

The database holds a small slice of the real schema: tables of each kind
(delete, keep, anonymize, child with a RESTRICT foreign key) and stand-ins
for the guards migration 504 patches. Each stand-in refuses every UPDATE or
DELETE, like the strictest real guard; after 504 the erasure function gets
through for the erased learner only. Runs on TEST_PG_URL (see
tests/account_data_pg.py); test_a_forged_context_never_opens_the_pass covers
trg_account_deletion_requests_xact_guard.
"""

from __future__ import annotations

import asyncio
import json
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from services import account_erasure as er, account_export as ex
from services import recording_audio
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
    session_id uuid REFERENCES public.sessions(id) ON DELETE CASCADE, audio_storage_path text, audio_url text);
INSERT INTO public.responses (session_id, audio_storage_path) VALUES
  ('{SESS1}', '{U1}/{SESS1}/a.webm'), ('{SESS1}', 'legacy/an-old.webm'), ('{SESS2}', '{U2}/{SESS2}/b.webm');
ALTER TABLE storage.objects ADD COLUMN owner_id text, ADD COLUMN archived_at timestamptz;
INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES ('audio-responses', 'legacy/an-old.webm', '{U1}');
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
CREATE TABLE public.credit_reservations (id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id));
INSERT INTO public.credit_reservations VALUES ('{ENT1}', '{U1}');
CREATE TABLE public.credit_attempt_outcomes (
    user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
    reservation_id uuid NOT NULL REFERENCES public.credit_reservations(id) ON DELETE RESTRICT);
INSERT INTO public.credit_attempt_outcomes VALUES ('{U1}', '{ENT1}');
CREATE TABLE public.mock_exam_audiences (
    student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.users(id) ON DELETE SET NULL);
INSERT INTO public.mock_exam_audiences VALUES ('{S1}', NULL), ('{S1}', '{U1}'), ('{S2}', '{U2}');

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
-- Like the real quiz and advanced-vocab guards: fires on INSERT too.
CREATE TABLE public.quiz_word_stats (id bigserial PRIMARY KEY, user_id uuid NOT NULL, hits int NOT NULL DEFAULT 0);
INSERT INTO public.quiz_word_stats (user_id) VALUES ('{U1}'), ('{U2}');
CREATE FUNCTION public.grammar_quiz_guard_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'quiz progress is append-only';
END;
$$;
CREATE TRIGGER trg_qws BEFORE INSERT OR UPDATE OR DELETE ON public.quiz_word_stats
    FOR EACH ROW EXECUTE FUNCTION public.grammar_quiz_guard_progress();
-- A real non-superuser service_role (SA-3 on #2600): explicit table grants,
-- no default privileges, so a missing function grant shows up.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
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

    alerts = []

    async def alert(request_id, code, attempts):
        alerts.append((request_id, code, attempts))
        return True

    try:
        yield SimpleNamespace(engine=engine, run=run, storage=storage, auth=FakeAuth(), letters=letters,
                              send=send, revoked=revoked, alerts=alerts, alert=alert, url=url)
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
                send=env.send, revoke_sessions=_revoker(env), alert=env.alert)
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
    assert one("SELECT student_id, user_id FROM public.mock_exam_audiences") == f"{S2}|{U2}"
    assert one("SELECT o.user_id, o.reservation_id FROM public.credit_attempt_outcomes o "
               "JOIN public.credit_reservations r ON r.id = o.reservation_id AND r.user_id = o.user_id") == f"{U1}|{ENT1}"

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


def test_erasure_removes_only_verified_legacy_recordings_before_deleting_responses(env):
    origin = str(recording_audio.settings.SUPABASE_URL).rstrip("/")
    run = env.run
    run(f"""
        INSERT INTO public.responses (session_id, audio_storage_path, audio_url) VALUES
          ('{SESS1}', NULL, '{origin}/storage/v1/object/public/audio-responses/legacy/owned-url.webm'),
          ('{SESS1}', 'legacy/other-owner.webm', NULL),
          ('{SESS1}', 'legacy/no-owner.webm', NULL),
          ('{SESS1}', 'legacy/missing-metadata.webm', NULL),
          ('{SESS1}', NULL, 'https://other.example.test/legacy/foreign.webm'),
          ('{SESS2}', 'legacy/other-response.webm', NULL);
        INSERT INTO storage.objects (bucket_id, name, owner_id) VALUES
          ('audio-responses', 'legacy/owned-url.webm', '{U1}'),
          ('audio-responses', 'legacy/other-owner.webm', '{U2}'),
          ('audio-responses', 'legacy/no-owner.webm', NULL),
          ('audio-responses', 'legacy/other-response.webm', '{U1}');
        INSERT INTO storage.objects (bucket_id, name, owner_id, archived_at)
        VALUES ('audio-responses', 'legacy/other-owner.webm', '{U1}', now());
    """)
    for key in ("owned-url", "other-owner", "no-owner", "missing-metadata", "other-response"):
        env.storage.objects[("audio-responses", f"legacy/{key}.webm")] = b"recording"
    requested = []
    remove = env.storage.remove

    def track_remove(bucket, paths):
        if bucket == "audio-responses":
            requested.extend(paths)
        remove(bucket, paths)

    env.storage.remove = track_remove
    req = _request(env)
    before = set(env.storage.objects)
    assert asyncio.run(er.dry_run(env.engine))[0]["request_id"] == req
    assert set(env.storage.objects) == before and not requested

    soft_delete = env.auth.soft_delete

    def auth_unavailable(_user_id):
        raise RuntimeError("synthetic auth outage after the database step")

    env.auth.soft_delete = auth_unavailable
    assert _erase(env, req) == "error:auth:RuntimeError"
    assert run(f"SELECT count(*) FROM public.responses WHERE session_id = '{SESS1}'") == "0"
    assert run(f"SELECT count(*) FROM public.responses WHERE session_id = '{SESS2}'") == "2"
    removed = {f"{U1}/{SESS1}/a.webm", "legacy/an-old.webm", "legacy/owned-url.webm"}
    assert sorted(requested) == sorted(removed)
    assert env.storage.list_prefix("audio-responses", "") == sorted(
        path for bucket, path in before if bucket == "audio-responses" and path not in removed)

    run(f"UPDATE public.account_deletion_requests SET lease_until = now() - interval '1 minute' WHERE id = '{req}'")
    env.auth.soft_delete = soft_delete
    assert _erase(env, req) == "erased"
    assert sorted(requested) == sorted(removed)


@pytest.mark.parametrize("hardened", [False, True])
def test_erasure_anonymizes_suspended_learner_with_staff_guards_installed(env, hardened):
    run = env.run
    suspension = (MIG / "332_staff_security_audit.sql").read_text(encoding="utf-8")
    columns_start = suspension.index("ALTER TABLE public.users\n    ADD COLUMN")
    guard_start = suspension.index("-- SECURITY INVOKER: it reads only OLD/NEW")
    run(suspension[columns_start:guard_start])
    run(f"UPDATE public.users SET is_active = false, suspended_at = now(), "
        f"suspended_by = '{U2}', suspension_reason = 'synthetic reason'")
    run(suspension[guard_start:suspension.index("-- 3. Admin MFA factor snapshot")])
    run(suspension[suspension.index("CREATE OR REPLACE FUNCTION public.fn_staff_security_record("):
                   suspension.index("-- 5. The privilege RPC")])
    if hardened:
        guards = (MIG / "341_staff_guc_and_ai_override_hardening.sql").read_text(encoding="utf-8")
        run(guards[guards.index("CREATE TABLE IF NOT EXISTS public.staff_privilege_evidence"):
                   guards.index("-- 332 section 5.")])
    run(SQL_504)

    with pytest.raises(AssertionError, match="account_suspended_marker_protected"):
        run(f"BEGIN; SET LOCAL aver.account_erasure_user = '{U1}'; "
            "SET LOCAL aver.account_erasure_owner = 'w1'; "
            f"UPDATE public.users SET email = 'erased-{U1}@erased.invalid', suspended_at = NULL, "
            f"suspended_by = NULL, suspension_reason = NULL WHERE id = '{U1}'; COMMIT;")
    assert _erase(env, _request(env)) == "erased"
    assert run(f"SELECT email, role, is_active, suspended_at IS NULL, suspended_by IS NULL, "
               f"suspension_reason IS NULL FROM public.users WHERE id = '{U1}'") == (
                   f"erased-{U1}@erased.invalid|student|f|t|t|t")
    assert run(f"SELECT suspended_at IS NOT NULL, suspended_by, suspension_reason "
               f"FROM public.users WHERE id = '{U2}'") == f"t|{U2}|synthetic reason"
    assert run(f"SELECT event, before ->> 'is_active', after ->> 'is_active' "
               f"FROM public.staff_security_audit WHERE target_user_id = '{U1}'") == "active_changed|false|false"


def test_sweep_and_erasure_with_exercise_book_restrict_links(env):
    from jobs import account_data_sweep

    run = env.run
    run(f"""
        CREATE TABLE public.class_assignment_activities (id uuid PRIMARY KEY);
        CREATE TABLE public.listening_test_attempts (id uuid PRIMARY KEY, user_id uuid NOT NULL);
        CREATE TABLE public.exercise_book_registry (programme_id text PRIMARY KEY);
        CREATE TABLE public.mock_paper_attempt_snapshots (attempt_id uuid, skill text, paper_row jsonb);
        INSERT INTO public.listening_test_attempts VALUES ('{SESS1}', '{U1}'), ('{SESS2}', '{U2}');
        INSERT INTO public.class_assignment_activities VALUES ('{ENT1}');
    """)
    migration = (MIG / "378_exercise_book_assignments.sql").read_text(encoding="utf-8")
    link_table = migration.index("CREATE TABLE public.exercise_book_attempt_links")
    run(migration[link_table:migration.index("CREATE INDEX exercise_book_link_cell", link_table)])
    run(f"INSERT INTO public.exercise_book_attempt_links (attempt_id, activity_id, item_id) "
        f"VALUES ('{SESS1}', '{ENT1}', '{ITEM1}'), ('{SESS2}', '{ENT1}', '{ITEM2}')")
    link_guard = migration.index("CREATE FUNCTION public.fn_eb_link_guard()")
    attempt_guard = migration.index("CREATE FUNCTION public.fn_eb_attempt_immutable()")
    run(migration[link_guard:migration.index("CREATE OR REPLACE FUNCTION public.fn_guard_blackeye_admission", link_guard)])
    run(migration[attempt_guard:migration.index("-- Q-16", attempt_guard)])
    run(SQL_504)

    with pytest.raises(AssertionError, match="exercise_book_append_only"):
        run(f"DELETE FROM public.exercise_book_attempt_links WHERE attempt_id = '{SESS1}'")
    with pytest.raises(AssertionError, match="attempt_changed"):
        run(f"DELETE FROM public.listening_test_attempts WHERE id = '{SESS1}'")

    req = _request(env)
    run(f"UPDATE public.sessions SET status = 'in_progress' WHERE user_id = '{U2}'; "
        f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U2}')")
    summary = asyncio.run(account_data_sweep.run_async(erase=False, engine=env.engine,
                                                      storage=env.storage, send=env.send))
    assert summary["erasure"][0]["dry_run"]["request_id"] == req
    assert summary["exports"] == ["ready"]
    assert run("SELECT count(*) FROM public.exercise_book_attempt_links") == "2"
    assert _erase(env, req) == "erased"
    assert run("SELECT attempt_id, item_id FROM public.exercise_book_attempt_links") == f"{SESS2}|{ITEM2}"
    assert run("SELECT user_id FROM public.listening_test_attempts") == U2
    assert run("SELECT id FROM public.class_assignment_items") == ITEM2
    run(DOWN_504)
    with pytest.raises(AssertionError, match="exercise_book_append_only"):
        run(f"DELETE FROM public.exercise_book_attempt_links WHERE attempt_id = '{SESS2}'")


@pytest.mark.parametrize("verified", [True, False])
def test_course_alerts_follow_account_and_verified_guest_ownership(env, verified):
    run = env.run
    # Create the commerce tables used by the real migration 394.
    run("""
        CREATE TABLE public.course_products (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), slug text, title text,
            status text, is_public boolean, archived_at timestamptz);
        ALTER TABLE public.entitlements ADD COLUMN product_id uuid,
            ADD COLUMN starts_at timestamptz, ADD COLUMN expires_at timestamptz;
        CREATE TABLE public.learner_email_outbox (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid,
            to_email text, template text CONSTRAINT learner_email_outbox_template_check
                CHECK (template IN ('course_open_alert', 'staff_notice')),
            dedupe_key text UNIQUE, payload jsonb, status text);
    """)
    run((MIG / "394_course_open_alerts.sql").read_text(encoding="utf-8"))
    confirmed_at = "now()" if verified else "NULL"
    run(f"""
        INSERT INTO auth.users (id, email, email_confirmed_at)
        VALUES ('{U1}', 'verified@example.test', {confirmed_at});
        INSERT INTO public.course_products (slug)
        VALUES ('owned'), ('guest'), ('other-owner'), ('profile-email');
        INSERT INTO public.course_open_alerts (
            product_id, email, user_id, unsubscribe_token, unsubscribed_at)
        SELECT id, CASE slug WHEN 'owned' THEN 'previous@example.test'
                            WHEN 'profile-email' THEN 'an@example.test'
                            ELSE 'Verified@EXAMPLE.test' END,
               CASE slug WHEN 'owned' THEN '{U1}'::uuid WHEN 'other-owner' THEN '{U2}'::uuid END,
               replace(id::text, '-', '') || replace(id::text, '-', ''),
               CASE slug WHEN 'guest' THEN now() END
          FROM public.course_products;
        INSERT INTO public.learner_email_outbox (to_email, template, dedupe_key, payload, status)
        SELECT a.email, 'course_open_alert',
               CASE p.slug WHEN 'guest' THEN 'legacy:guest' ELSE 'open_alert:' || a.id::text END,
               CASE p.slug WHEN 'owned' THEN '{{}}'::jsonb ELSE jsonb_build_object('alert_id', a.id) END,
               'pending'
          FROM public.course_open_alerts a JOIN public.course_products p ON p.id = a.product_id;
        INSERT INTO public.learner_email_outbox (to_email, template, dedupe_key, payload, status)
        SELECT a.email, 'course_open_alert', 'sent:owned', jsonb_build_object('alert_id', a.id), 'sent'
          FROM public.course_open_alerts a JOIN public.course_products p ON p.id = a.product_id
         WHERE p.slug = 'owned';
        INSERT INTO public.course_open_alert_attempts (rate_key, action) VALUES
            ('user:{U1}', 'subscribe'), ('user:{U1}', 'unsubscribe'),
            ('user:{U1}:suffix', 'subscribe'), ('user:{U2}', 'subscribe'), ('ip:hashed-ip', 'subscribe');
    """)

    exported, _ = asyncio.run(ex.collect_rows(env.engine, U1))
    expected = [{"course_slug": "owned", "status": "subscribed"}]
    if verified:
        expected.insert(0, {"course_slug": "guest", "status": "unsubscribed"})
    assert exported["course_open_alerts"] == expected
    assert "course_open_alerts.user_id" not in exported

    removed_mail = run("""
        SELECT o.dedupe_key FROM public.learner_email_outbox o
        JOIN public.course_open_alerts a ON o.dedupe_key = 'open_alert:' || a.id::text
        JOIN public.course_products p ON p.id = a.product_id WHERE p.slug = 'owned'
    """)
    assert _erase(env, _request(env)) == "erased"
    remaining = ["other-owner", "profile-email"]
    if not verified:
        remaining.insert(0, "guest")
    assert run("""
        SELECT p.slug FROM public.course_open_alerts a
        JOIN public.course_products p ON p.id = a.product_id ORDER BY p.slug
    """).splitlines() == remaining
    assert run(f"SELECT count(*) FROM public.learner_email_outbox WHERE dedupe_key = '{removed_mail}'") == "0"
    assert run("SELECT count(*) FROM public.learner_email_outbox WHERE status = 'pending'") == str(len(remaining))
    assert run("SELECT count(*) FROM public.learner_email_outbox WHERE dedupe_key = 'legacy:guest'") == str(int(not verified))
    assert run("SELECT status FROM public.learner_email_outbox WHERE dedupe_key = 'sent:owned'") == "sent"
    assert set(run("SELECT rate_key FROM public.course_open_alert_attempts").splitlines()) == {
        f"user:{U1}:suffix", f"user:{U2}", "ip:hashed-ip",
    }


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
        assert env.alerts == []
        assert env.run(f"SELECT status, attempts, last_error_code, lease_until <= now() "
                       f"FROM public.account_deletion_requests WHERE id = '{req}'") == \
            f"erasing|{attempt}|storage:RuntimeError|t"
    assert env.run("SELECT count(*) FROM public.sessions") == "2"  # nothing deleted yet
    assert _erase(env, req).startswith("error:")
    assert env.run(f"SELECT status FROM public.account_deletion_requests WHERE id = '{req}'") == "failed"
    assert env.alerts == [(req, "storage:RuntimeError", 3)]  # FR-009: one owner alert, at the transition
    assert _erase(env, req) == "skipped"
    assert len(env.alerts) == 1


def test_owner_alert_names_the_request_only_and_never_raises():
    from services import owner_alerts

    req = "00000000-0000-0000-0000-00000000aaaa"
    mail = er.failed_alert_email(req, "storage:RuntimeError", 5)
    assert req in mail.subject and "storage:RuntimeError" in mail.text and "Bước lỗi: storage" in mail.text
    assert "@" not in mail.text
    sent = []

    async def ok_sender(email, *, config, idempotency_key):
        sent.append((email.subject, config.recipients, idempotency_key))
        return owner_alerts.SendResult(True)

    async def refused(email, *, config, idempotency_key):
        return owner_alerts.SendResult(False, "http_403")

    async def boom(email, *, config, idempotency_key):
        raise RuntimeError("x")

    ready = owner_alerts.transport_config({"RESEND_API_KEY": "k", "OWNER_ALERT_EMAILS": "owner@example.test"})
    assert asyncio.run(er.send_owner_alert(req, "storage:X", 5, config=ready, sender=ok_sender)) is True
    assert sent == [(mail.subject, ("owner@example.test",), f"account-erasure-failed-{req}")]
    assert asyncio.run(er.send_owner_alert(req, "storage:X", 5, config=ready, sender=refused)) is False
    assert asyncio.run(er.send_owner_alert(req, "storage:X", 5, config=ready, sender=boom)) is False
    unconfigured = owner_alerts.transport_config({})
    assert asyncio.run(er.send_owner_alert(req, "storage:X", 5, config=unconfigured, sender=ok_sender)) is False
    assert len(sent) == 1


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


class _HeldUpload:
    """Export worker in its own thread whose upload blocks until released."""

    def __init__(self, env, lease_seconds):
        self.env, self.lease = env, lease_seconds
        self.started, self.release = threading.Event(), threading.Event()
        self.result = None
        real_upload = env.storage.upload

        def held(bucket, path, data, content_type):
            self.path = path
            self.started.set()
            assert self.release.wait(30)
            real_upload(bucket, path, data, content_type)

        self.upload = held

    def _work(self):
        from services import account_export as ex

        storage = SimpleNamespace(list_prefix=self.env.storage.list_prefix, download=self.env.storage.download,
                                  remove=self.env.storage.remove, upload=self.upload)

        async def pdf(_sid):
            return b"%PDF-"

        async def go():
            engine = make_engine(self.env.url)
            try:
                return await ex.run_one(engine, owner="exporter", storage=storage, lease_seconds=self.lease,
                                        max_bytes=10_000_000, link_days=7, send=self.env.send, render_pdf=pdf)
            finally:
                await engine.dispose()

        self.result = asyncio.run(go())

    def start(self):
        self.thread = threading.Thread(target=self._work)
        self.thread.start()
        assert self.started.wait(30), "the export worker never reached its upload"


def _exports(env):
    return env.storage.list_prefix("account-exports", U1)


def test_export_lease_fences_the_database_step_with_two_real_workers(env):
    """FR-014 (c), CR @ccff5d6e: the erasure must not delete the export rows,
    which are the only fence, while an export worker still holds a lease.
    Nothing is stubbed: a real export worker is held inside its upload."""
    env.run(f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}')")
    worker = _HeldUpload(env, lease_seconds=300)
    worker.start()
    req = _request(env)
    # Step 0 cancels the export, but its lease is live: no DB change yet.
    assert _erase(env, req) == "waiting_export"
    assert env.run(f"SELECT status, last_error_code, attempts, step_done IS NULL "
                   f"FROM public.account_deletion_requests WHERE id = '{req}'") == "erasing|export_lease_active|0|t"
    assert env.run(f"SELECT status, lease_until > now() FROM public.account_data_exports "
                   f"WHERE user_id = '{U1}'") == "cancelled|t"
    assert env.run(f"SELECT count(*) FROM public.sessions WHERE user_id = '{U1}'") == "1"
    # The worker finishes its upload, loses the conditional complete and
    # removes only its own path.
    worker.release.set()
    worker.thread.join(30)
    assert worker.result == "lost"
    assert worker.path not in _exports(env)
    # Its lease is still live, so the erasure keeps waiting...
    assert _erase(env, req) == "waiting_export"
    # ...until the lease runs out (time passing, not a stub).
    env.run(f"UPDATE public.account_data_exports SET lease_until = now() - interval '1 second' "
            f"WHERE user_id = '{U1}'")
    assert _erase(env, req) == "erased"
    assert _exports(env) == []
    assert env.run(f"SELECT count(*) FROM public.account_data_exports WHERE user_id = '{U1}'") == "0"
    assert len(env.letters) == 1  # the notice is not sent twice


def test_timed_out_upload_keeps_its_lease_and_the_erasure_waits(env):
    """An upload that outlives its timeout may still land: the export fails
    but keeps its lease, so the erasure waits it out and sweeps after."""
    env.run(f"INSERT INTO public.account_data_exports (user_id) VALUES ('{U1}')")
    worker = _HeldUpload(env, lease_seconds=6)  # upload timeout: 3 s
    worker.start()
    deadline = time.monotonic() + 20
    while env.run(f"SELECT status FROM public.account_data_exports WHERE user_id = '{U1}'") != "failed":
        assert time.monotonic() < deadline
        time.sleep(0.2)
    assert env.run(f"SELECT last_error_code, lease_until IS NOT NULL FROM public.account_data_exports "
                   f"WHERE user_id = '{U1}'") == "build_failed:TimeoutError|t"
    req = _request(env)
    assert _erase(env, req) == "waiting_export"
    assert env.run(f"SELECT count(*) FROM public.sessions WHERE user_id = '{U1}'") == "1"
    # The stray upload lands late; once the lease is over the erasure sweeps it.
    worker.release.set()
    worker.thread.join(30)
    assert worker.path in _exports(env)
    env.run(f"UPDATE public.account_data_exports SET lease_until = now() - interval '1 second' "
            f"WHERE user_id = '{U1}'")
    assert _erase(env, req) == "erased"
    assert _exports(env) == []


def test_erase_function_refuses_while_an_export_lease_is_live(env):
    """The function checks again under a row lock, so a caller that skips the
    Python check still changes nothing."""
    req = _request(env)
    env.run(f"UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = 'w1', "
            f"lease_until = now() + interval '5 minutes' WHERE id = '{req}'")
    env.run(f"INSERT INTO public.account_data_exports (user_id, status, export_owner, claim_token, lease_until) "
            f"VALUES ('{U1}', 'cancelled', 'x', gen_random_uuid(), now() + interval '5 minutes')")
    plan = asyncio.run(er.build_plan(env.engine))
    out = asyncio.run(er.erase_database(env.engine, req, "w1", plan))
    assert out == {"waiting_export": True}
    assert env.run(f"SELECT count(*) FROM public.sessions WHERE user_id = '{U1}'") == "1"
    assert env.run(f"SELECT step_done IS NULL FROM public.account_deletion_requests WHERE id = '{req}'") == "t"


def _as_service_role(env, *statements, setup=""):
    """Run statements as the non-superuser service_role in one transaction;
    returns the error message of the first failing one, or 'ok'."""
    body = " ".join(statements)
    return env.run(
        "SET ROLE service_role; BEGIN; " + setup +
        f" DO $t$ BEGIN {body} PERFORM set_config('t.msg', 'ok', true); "
        "EXCEPTION WHEN OTHERS THEN PERFORM set_config('t.msg', SQLERRM, true); END $t$; "
        "SELECT current_setting('t.msg'); COMMIT;")


def test_the_session_is_not_superuser_for_these_checks(env):
    assert env.run("SET ROLE service_role; SELECT rolsuper FROM pg_roles WHERE rolname = current_user") == "f"
    assert env.run("SELECT count(*) FROM pg_default_acl") == "0"


def test_ordinary_writes_as_service_role_never_need_the_check_functions(env):
    """SA-1: outside an erasure every write on a guarded table gets the
    guard's own answer, never 'permission denied for function'."""
    assert _as_service_role(env, f"INSERT INTO public.quiz_word_stats (user_id) VALUES ('{U2}');") == "ok"
    assert _as_service_role(env, f"UPDATE public.quiz_word_stats SET hits = 1 WHERE user_id = '{U2}';") == \
        "quiz progress is append-only"
    assert _as_service_role(env, f"DELETE FROM public.learner_goal_events WHERE user_id = '{U2}';") == \
        "learner_goal_events is append-only"
    assert _as_service_role(env, f"UPDATE public.class_action_log SET action = 'x' WHERE student_id = '{S2}';") == \
        "class_action_log chỉ THÊM"
    assert _as_service_role(env, f"DELETE FROM public.class_assignment_items WHERE id = '{ITEM2}';") == \
        "cannot delete assignment item with advanced vocabulary evidence"


def test_service_role_runs_the_erasure_function(env):
    """SA-3 (b): the function itself works for the non-superuser caller."""
    req = _request(env)
    env.run(f"UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = 'w1', "
            f"lease_until = now() + interval '5 minutes' WHERE id = '{req}'")
    plan = json.dumps(asyncio.run(er.build_plan(env.engine))).replace("'", "''")
    assert _as_service_role(env, f"PERFORM public.fn_account_erase_learner('{req}', 'w1', '{plan}'::jsonb);") == "ok"
    assert env.run(f"SELECT count(*) FROM public.learner_goal_events WHERE user_id = '{U1}'") == "0"
    assert env.run(f"SELECT count(*) FROM public.quiz_word_stats WHERE user_id = '{U1}'") == "0"
    assert env.run(f"SELECT count(*) FROM public.quiz_word_stats WHERE user_id = '{U2}'") == "1"
    assert env.run(f"SELECT student_name IS NULL FROM public.class_action_log WHERE student_id = '{S1}'") == "t"


def test_a_forged_context_never_opens_the_pass(env):
    """SA-2: another session that sets both GUCs while the request is
    'erasing' (and knows the owner token) is still refused, and cannot stamp
    its own transaction into erasing_xact either."""
    req = _request(env)
    env.run(f"UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = 'host:abc', "
            f"lease_until = now() + interval '5 minutes' WHERE id = '{req}'")
    forged = (f"PERFORM set_config('aver.account_erasure_user', '{U1}', true); "
              f"PERFORM set_config('aver.account_erasure_owner', 'host:abc', true);")
    assert _as_service_role(env, forged, f"DELETE FROM public.learner_goal_events WHERE user_id = '{U1}';") == \
        "learner_goal_events is append-only"
    assert _as_service_role(env, forged, f"UPDATE public.class_action_log SET student_name = NULL "
                                         f"WHERE student_id = '{S1}';") == "class_action_log chỉ THÊM"
    assert _as_service_role(env, f"UPDATE public.account_deletion_requests SET erasing_xact = pg_current_xact_id() "
                                 f"WHERE id = '{req}';") == "erasing_xact is written by fn_account_erase_learner only"
    assert env.run(f"SELECT count(*) FROM public.learner_goal_events WHERE user_id = '{U1}'") == "1"


def test_plan_key_columns_must_be_the_learners_own(env):
    """SA-4: a plan keyed by someone else's column is refused before any
    change."""
    req = _request(env)
    env.run(f"UPDATE public.account_deletion_requests SET status = 'erasing', erasing_owner = 'w1', "
            f"lease_until = now() + interval '5 minutes' WHERE id = '{req}'")
    good = asyncio.run(er.build_plan(env.engine))
    # A real FK that points at a parent column other than id (CR nit, confkey).
    env.run("ALTER TABLE public.sessions ADD COLUMN code text UNIQUE; "
            "CREATE TABLE public.odd_child (session_code text REFERENCES public.sessions(code));")
    bad_plans = [
        {**good, "delete": [{"table": "odd_child", "column": "session_code", "parent": "sessions",
                             "parent_column": "user_id", "subject": "user"}]},
        {**good, "anonymize": [{"table": "users", "match": "invited_by", "subject": "user"}]},
        {**good, "delete": [{"table": "class_assignment_items", "column": "assigned_by", "subject": "user"}]},
        {**good, "delete": [{"table": "sessions", "column": "user_id", "subject": "student"}]},
        {**good, "delete": [{"table": "listening_drill_playback", "column": "id", "parent": "class_assignment_items",
                             "parent_column": "student_id", "subject": "student"}]},
    ]
    for plan in bad_plans:
        with pytest.raises(Exception, match="account_erasure_bad_key"):
            asyncio.run(er.erase_database(env.engine, req, "w1", plan))
    assert env.run(f"SELECT count(*) FROM public.sessions WHERE user_id = '{U1}'") == "1"


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
    assert env.run("SELECT count(*) FROM pg_attribute WHERE attrelid = 'public.account_deletion_requests'::regclass "
                   "AND attname = 'erasing_xact' AND NOT attisdropped") == "0"
    # The guards work again exactly as before 504.
    assert env.run(f"DO $t$ BEGIN DELETE FROM public.learner_goal_events WHERE user_id = '{U1}'; "
                   f"EXCEPTION WHEN OTHERS THEN PERFORM set_config('t.msg', SQLERRM, false); END $t$; "
                   f"SELECT current_setting('t.msg')") == "learner_goal_events is append-only"
    env.run(SQL_504)
    env.run(SQL_504)  # re-runnable, the pass is never added twice
    assert env.run("SELECT sum((length(prosrc) - length(replace(prosrc, 'erasure pass', ''))) / 12) "
                   "FROM pg_proc WHERE prosrc LIKE '%erasure pass%'") == "4"
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
