"""Synthetic pre-295 dependencies plus the real affected migration history.

This is deliberately PARTIAL history: unrelated application schemas and the
pre-295 catalog are dependency fixtures, not a replay of migrations 001-294.
No deployed schema or data is used. Every file in HISTORY runs verbatim.
"""
import ast
import json
from pathlib import Path
import re

from namespace_pg17 import MIG, bootstrap, migration

HISTORY = (
    "208_listening_exercise_block_identity.sql",
    "295_listening_content_programmes.sql",
    "296_listening_programme_feedback_reveals.sql",
    "299_admin_exam_content_page.sql",
    "301_admin_exam_content_page_snapshot.sql",
    "303_listening_v1_start_drain_gate.sql",
    "304_listening_80_days_source_collection.sql",
    "305_dictation_frozen_grading_policy.sql",
    "306_mock_paper_policy_and_admission.sql",
    "307_mock_attempt_review_flags.sql",
    "310_mock_attempt_submitted_finalization.sql",
    "311_mock_submitted_parent_lifecycle.sql",
    "315_mock_exam_private_draft_copies.sql",
    "316_mock_draft_shared_resume_and_package_guard.sql",
    "319_explanation_version_unavailable_reason.sql",
    "338_reading_listening_paper_updated_at.sql",
    "353_listening_package_status_revision.sql",
    "376_blackeye_admission.sql",
    "379_listening_import_source_skip.sql",
    "380_listening_skill_drill_homework.sql",
)


def history_bootstrap(*, active=False):
    # Retain the original dependency definitions, excluding the minimal package
    # tables: real 295 must create their complete constraints, ACLs and guards.
    base = bootstrap().split(migration("306_mock_paper_policy_and_admission.sql"), 1)[0]
    base = base.replace("CREATE TABLE public.listening_content_packages(id uuid PRIMARY KEY,programme_id text,status text);", "")
    base = base.replace("CREATE TABLE public.listening_lessons(id uuid PRIMARY KEY,programme_id text);", "")
    base = base.replace("ADD COLUMN programme_id text DEFAULT 'ielts', ", "")
    base = base.replace(", ADD COLUMN content_package_id uuid", "")
    # The common assertion helpers live after 306/299/301 in the focused fixture.
    assertions = bootstrap().split("CREATE FUNCTION pg_temp.assert_true", 1)[1]
    base += """
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
    'SELECT current_setting(''request.jwt.claim.role'',true)';
ALTER TABLE public.listening_tests ADD COLUMN version text DEFAULT '1.0',
    ADD COLUMN full_audio_size_bytes integer;
ALTER TABLE public.listening_tests ADD CONSTRAINT listening_tests_test_id_key UNIQUE(test_id);
ALTER TABLE public.listening_test_attempts ADD COLUMN band_estimate numeric,
    ADD COLUMN submitted_at timestamptz, ADD COLUMN trap_analytics jsonb,
    ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.listening_content ADD COLUMN source_type text DEFAULT 'test_section',
    ADD COLUMN audio_storage_path text, ADD COLUMN audio_duration_seconds integer DEFAULT 1,
    ADD COLUMN audio_size_bytes integer DEFAULT 1, ADD COLUMN accent_tag text DEFAULT 'british',
    ADD COLUMN topic_tags text[] DEFAULT '{}', ADD COLUMN transcript_segments jsonb DEFAULT '[]',
    ADD COLUMN description text, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.listening_exercises ADD COLUMN status text DEFAULT 'draft',
    ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.reading_passages ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.reading_questions ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.web_explanation_objects ADD COLUMN skill text;
ALTER TABLE public.dictation_attempts ADD COLUMN units_snapshot jsonb;
ALTER TABLE public.dictation_sessions ADD COLUMN attempt_id uuid REFERENCES public.dictation_attempts(id) ON DELETE SET NULL,
    ADD COLUMN section_num integer, ADD COLUMN completed_at timestamptz DEFAULT now();
CREATE TABLE public.dictation_attempt_answers(attempt_id uuid, sentence_idx integer, user_transcript text,
    diff jsonb, score numeric, correct_words integer, total_words integer);
"""
    # Exact 033 helper body, with the 108 search_path setting; replaying all of
    # 033/108 would require unrelated Writing/Auth/RLS application dependencies.
    source = next(MIG.glob("033_*.sql")).read_text()
    base += re.search(r"CREATE OR REPLACE FUNCTION update_updated_at_column\(\).*?LANGUAGE plpgsql;", source, re.S).group(0)
    base += "\nALTER FUNCTION public.update_updated_at_column() SET search_path=public,pg_temp;\n"
    base += "CREATE FUNCTION pg_temp.assert_true" + assertions
    for name in HISTORY:
        base += "\n" + migration(name)
    if active:
        # Synthetic marker only, never evidence of a deployed backend.
        base += "\nSET mock_paper.deployed_backend_sha='0000000000000000000000000000000000000000';\n"
        base += migration("308_activate_mock_paper_admission.sql")
    base += "\nGRANT SELECT ON ALL TABLES IN SCHEMA public TO service_role;\n"
    base += "GRANT INSERT,UPDATE,DELETE ON public.listening_tests,public.listening_content,public.listening_test_attempts,public.dictation_sessions TO service_role;\n"
    return base


def package_import_sql(*, blackeye=False):
    """Established 295 synthetic package, with an explicit 376 binding variant."""
    source = Path(__file__).with_name("test_migration_295_listening_content_programmes_postgres.py").read_text()
    tree = ast.parse(source)
    values = {}
    for name in ("package", "lessons", "stimuli", "forms"):
        node = next(n for n in ast.walk(tree) if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)
                    and isinstance(n.value, (ast.Dict, ast.List)))
        values[name] = eval(compile(ast.Expression(node.value), "295 synthetic input", "eval"), {"__builtins__": {}})
    if blackeye:
        values["package"].update(package_id="fixture-blackeye-v1", programme_id="blackeye-v5-upper-listening")
        binding = dict(programme_id="blackeye-v5-upper-listening", collection_id="blackeye-v5-upper",
                       source_contract="blackeye_u1_v1", unit_id="U1", activity_id="U1-A01",
                       content_revision="fixture-c1", policy_revision="fixture-p1",
                       answer_set_revision="30000000-0000-0000-0000-000000000001")
        values["forms"][0].update(test_id="fixture-blackeye-form", metadata={
            "blackeye": dict(binding=binding, readiness="ready", selectable=True, response_cell_count=1,
                             items=[dict(q_num=1, source_item_id="synthetic-cell-1", interaction="text")]),
            "blackeye_db_revisions": dict(paper_revision=0, policy_revision=1),
            "blackeye_context": dict(kind="standalone", class_assignment_item_id=None, assignment_id=None, cohort_id=None),
        }, exercise_payload={"blackeye_review": dict(binding=binding,
            items=[dict(q_num=1, source_item_id="synthetic-cell-1", scoring_mode="SELF-CHECK")], transcript=[])})
    args = ",".join("'" + json.dumps(values[k]).replace("'", "''") + "'::jsonb"
                    for k in ("package", "lessons", "stimuli", "forms"))
    return "SELECT action FROM public.import_listening_content_package_atomic(" + args + ");\n"
