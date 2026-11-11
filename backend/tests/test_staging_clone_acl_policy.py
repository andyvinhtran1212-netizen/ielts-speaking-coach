"""Offline operational-script ACL guard; local-PG behavior lives in its own suite."""

from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys

import pytest


REPO = Path(__file__).resolve().parents[2]
SCRIPTS = REPO / "backend/scripts"
CLONE = SCRIPTS / "staging_clone_schema_from_prod.sh"
POSTCONDITIONS = SCRIPTS / "sql/staging_clone_postconditions.sql"
MIGRATIONS = REPO / "backend/migrations"
# Operational scripts only; backend/migrations/** keeps deliberate historical
# grants (see _assert_scripts_safe).
SCAN_ROOTS = ("backend/scripts", "scripts")
SCAN_SUFFIXES = {".sh", ".sql", ".py"}
APP_ROLES = {"public", "anon", "authenticated", "service_role"}
GRANT_ALL = re.compile(
    r"\bGRANT\s+ALL(?:\s+PRIVILEGES)?\s+ON\s+(?:ALL\s+)?"
    r"(?:TABLES|SEQUENCES|FUNCTIONS)\b[^;]*?\bTO\s+([^;]+);",
    re.IGNORECASE,
)
OBJECT_GRANT = re.compile(r"\bGRANT\s+([^;]+?)\s+ON\s+([^;]+?)\s+TO\s+([^;]+);", re.I)


def _grantees(text: str) -> set[str]:
    text = re.sub(r"\s+(?:WITH\s+(?:GRANT|ADMIN)\s+OPTION|GRANTED\s+BY)\b.*$", "", text, flags=re.I)
    return {role.strip().strip('"').lower() for role in text.split(",")}


def _assert_no_blanket_app_grants(source: str) -> None:
    # Scan SQL files and SQL embedded in shell heredocs, ignoring comments.
    source = re.sub(r"/\*.*?\*/|--[^\n]*|(?m:^\s*#[^\n]*)", " ", source, flags=re.DOTALL)
    for match in GRANT_ALL.finditer(source):
        grantees = _grantees(match[1])
        assert not grantees & APP_ROLES, f"blanket application-role grant: {match[0]}"
    for match in OBJECT_GRANT.finditer(source):
        privileges = set(re.findall(r"\b[A-Z_]+\b", match[1].upper()))
        target = match[2].lower()
        grantees = _grantees(match[3])
        clients = grantees & {"public", "anon", "authenticated"}
        writes = privileges & {"ALL", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                               "REFERENCES", "TRIGGER", "MAINTAIN"}
        if not target.startswith("schema "):
            assert not (clients and writes), f"unsafe application-role grant: {match[0]}"
        if "all functions" in target and clients and "EXECUTE" in privileges:
            raise AssertionError(f"blanket application-role grant: {match[0]}")
        if "class_action_log" in target and "service_role" in grantees:
            assert not privileges & {"ALL", "UPDATE", "DELETE", "TRUNCATE", "MAINTAIN"}, (
                f"unsafe append-only log grant: {match[0]}"
            )
    for match in re.finditer(r"\bGRANT\s+([^;]+?)\s+TO\s+([^;]+);", source, re.I):
        if re.search(r"\bON\b", match[1], re.I):
            continue
        grantees = _grantees(match[2])
        assert not grantees & APP_ROLES, f"application-role membership grant: {match[0]}"


def _assert_scripts_safe(directory: Path) -> None:
    # Option (i) preserves the dump's ACLs, so no re-apply exception is needed.
    # TODO(#2041 / PC-J336): reconcile with the migration guard when it lands.
    # It is absent from origin/staging at 672cd02b1; migrations have deliberate
    # historical grants and cannot use this operational-script policy verbatim.
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.suffix in SCAN_SUFFIXES:
            try:
                _assert_no_blanket_app_grants(path.read_text(encoding="utf-8"))
            except AssertionError as exc:
                raise AssertionError(f"{path.relative_to(directory)}: {exc}") from exc


def _assert_repo_scripts_safe(root: Path) -> None:
    for scan_root in SCAN_ROOTS:
        try:
            _assert_scripts_safe(root / scan_root)
        except AssertionError as exc:
            raise AssertionError(f"{scan_root}/{exc}") from exc


def test_scripts_do_not_replace_migration_acls_with_blanket_grants():
    assert all((REPO / scan_root).is_dir() for scan_root in SCAN_ROOTS)
    _assert_repo_scripts_safe(REPO)


def test_clone_dumps_schema_and_acls_and_restores_the_same_dump():
    source = CLONE.read_text(encoding="utf-8")
    dump_command, = (
        shlex.split(line) for line in source.splitlines() if line.startswith("pg_dump ")
    )
    assert dump_command == [
        "pg_dump", "$PROD_URL", "--schema-only", "--schema=public", "--no-owner",
        "--restrict-key=$RESTRICT_KEY", "-f", "$DUMP",
    ]
    restore = source[source.index('psql "$STAGING_URL" -X -1'):source.index('echo "== baselining')]
    assert '-v ON_ERROR_STOP=1 -q' in restore
    assert ('-f "$ROOT/backend/scripts/sql/staging_clone_reset.sql" \\\n'
            '  -f <(printf \'\\\\restrict %s\\n\' "$RESTORE_RESTRICT_KEY") -f "$DUMP"') in restore
    assert '-f "$ROOT/backend/scripts/sql/staging_clone_postconditions.sql"' in restore
    preflight = source.index('python3 "$ROOT/backend/scripts/staging_clone_preflight.py" "$DUMP"')
    assert preflight < source.index(restore)
    assert 'BEGIN READ ONLY;' in source
    assert 'FROM pg_default_acl WHERE defaclnamespace = 0' in source
    before_preflight = re.sub(r"(?m)^\s*#.*$", "", source[:preflight])
    assert re.search(r"\bDROP\s+SCHEMA\b", before_preflight, re.I) is None


def test_dump_filter_preserves_object_acls_and_migration_owner_defaults():
    source = CLONE.read_text(encoding="utf-8")
    match = re.search(r"^grep -v (?:[^\n]*\\\n)*[^\n]*", source, re.MULTILINE)
    assert match
    command = shlex.split(match[0].replace("\\\n", " "))
    assert command[-3:] == ["$DUMP", ">", "$DUMP.tmp"]
    assert source.index(match[0]) < source.index('echo "== preflighting dump roles')
    kept = (
        "CREATE TABLE public.class_action_log (id uuid);\n"
        "REVOKE ALL ON TABLE public.class_action_log FROM service_role;\n"
        "GRANT SELECT, INSERT ON TABLE public.class_action_log TO service_role;\n"
        "GRANT SELECT ON TABLE public.users TO authenticated;\n"
        "REVOKE ALL ON FUNCTION public.sensitive_rpc() FROM PUBLIC;\n"
        "GRANT EXECUTE ON FUNCTION public.sensitive_rpc() TO service_role;\n"
        "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public "
        "GRANT SELECT ON TABLES TO authenticated;\n"
    )
    # Exercise only the dump's grep filter against fake SQL, never the script.
    result = subprocess.run(
        command[:-3], input=(
            "CREATE SCHEMA public;\n" + kept +
            "ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public "
            "GRANT ALL ON TABLES TO anon, authenticated;\n"
        ), capture_output=True, text=True, check=True,
    )
    assert result.stdout == kept


@pytest.mark.parametrize("suffix", [".sh", ".sql"])
def test_guard_rejects_restoring_the_original_clone_grant(tmp_path, suffix):
    # Mutation of the real source at the original position; no shell/DB runs.
    source = CLONE.read_text(encoding="utf-8")
    original_grant = (
        "GRANT ALL ON ALL TABLES IN SCHEMA public "
        "TO anon, authenticated, service_role;\n"
    )
    mutated = source.replace(
        'echo "== baselining migration ledger',
        original_grant + 'echo "== baselining migration ledger',
        1,
    )
    assert mutated != source
    (tmp_path / f"clone{suffix}").write_text(mutated, encoding="utf-8")
    with pytest.raises(AssertionError, match="clone.*blanket application-role grant"):
        _assert_scripts_safe(tmp_path)


@pytest.mark.parametrize("grant", [
    'grant all privileges on all tables in schema public to "authenticated";',
    "GRANT ALL\nON ALL TABLES IN SCHEMA public\nTO postgres, anon WITH GRANT OPTION;",
    "GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;",
    "GRANT/* ACL reset */ALL ON ALL TABLES IN SCHEMA public TO anon;",
    "GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO PUBLIC;",
    "GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;",
    "ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO service_role;",
    "ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO anon;",
])
def test_guard_covers_multiline_role_and_default_acl_variants(grant):
    with pytest.raises(AssertionError, match="blanket application-role grant"):
        _assert_no_blanket_app_grants(grant)


def test_guard_allows_narrow_grants_and_comments():
    _assert_no_blanket_app_grants('''
        # GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
        -- GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
        /* GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; */
        GRANT ALL ON SCHEMA public TO postgres;
        GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres;
        GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon, authenticated;
        GRANT SELECT, INSERT ON TABLE public.class_action_log TO service_role;
    ''')


@pytest.mark.parametrize("grant", [
    "GRANT INSERT, UPDATE, DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public TO anon, authenticated;",
    "GRANT ALL ON TABLE public.class_action_log TO service_role;",
    "GRANT TRUNCATE, MAINTAIN ON public.class_action_log TO service_role;",
    "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT INSERT, UPDATE, DELETE ON TABLES TO anon;",
    "GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;",
    "GRANT anon TO authenticated;",
    "GRANT anon TO authenticated WITH ADMIN OPTION;",
    "GRANT UPDATE ON ALL TABLES IN SCHEMA public TO anon WITH GRANT OPTION;",
])
def test_guard_rejects_sa_reported_acl_and_membership_gaps(grant):
    with pytest.raises(AssertionError, match="grant"):
        _assert_no_blanket_app_grants(grant)


# ── PC-J498 (J497 part C): blanket grants anywhere in operational scripts ───
# Verbatim copy of the pre-#2055 clone step (origin/staging 6c787bb8a,
# staging_clone_schema_from_prod.sh:56-64) that silently undid 320's revokes.
OLD_CLONE_BLANKET_GRANTS = """\
echo "== granting Supabase role access on cloned objects"
psql "$STAGING_URL" -v ON_ERROR_STOP=1 <<'SQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
SQL
"""


@pytest.mark.parametrize("line", OLD_CLONE_BLANKET_GRANTS.splitlines()[2:8])
def test_guard_rejects_each_old_clone_blanket_grant(tmp_path, line):
    # Each of the six old lines alone, in a copy under a tmp repo; no shell runs.
    clone = tmp_path / "backend/scripts/staging_clone_schema_from_prod.sh"
    clone.parent.mkdir(parents=True)
    (tmp_path / "scripts").mkdir()
    clone.write_text(CLONE.read_text(encoding="utf-8") + "psql \"$STAGING_URL\" <<'SQL'\n"
                     + line + "\nSQL\n", encoding="utf-8")
    with pytest.raises(AssertionError, match=r"backend/scripts/staging_clone_schema_from_prod\.sh: "
                                             r"blanket application-role grant"):
        _assert_repo_scripts_safe(tmp_path)


def test_guard_rejects_old_clone_block_in_scripts_tree(tmp_path):
    for relative in ("backend/scripts", "scripts/backup"):
        (tmp_path / relative).mkdir(parents=True, exist_ok=True)
    (tmp_path / "scripts/backup/restore.sh").write_text(OLD_CLONE_BLANKET_GRANTS, encoding="utf-8")
    with pytest.raises(AssertionError, match=r"scripts/backup/restore\.sh: blanket application-role grant"):
        _assert_repo_scripts_safe(tmp_path)


@pytest.mark.parametrize("sql", [
    "ALTER DEFAULT PRIVILEGES GRANT ALL PRIVILEGES ON FUNCTIONS TO PUBLIC;",
    "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public\n"
    "  GRANT ALL PRIVILEGES ON FUNCTIONS TO PUBLIC;",
    "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL\n"
    "  -- every client role\n  ON TABLES TO \"anon\";",
    "GRANT ALL PRIVILEGES /* reset */ ON ALL TABLES IN SCHEMA app_private TO\n  postgres,\n  service_role;",
])
def test_guard_rejects_default_acl_and_multiline_variants(sql):
    with pytest.raises(AssertionError, match="blanket application-role grant"):
        _assert_no_blanket_app_grants(sql)


@pytest.mark.parametrize("suffix", [".sql", ".sh", ".py"])
def test_guard_scans_every_script_type_under_scripts(tmp_path, suffix):
    (tmp_path / "backend/scripts").mkdir(parents=True)
    fake = tmp_path / f"scripts/ci/reset_acl{suffix}"
    fake.parent.mkdir(parents=True)
    fake.write_text({
        ".sql": "GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;\n",
        ".sh": "psql \"$DB\" -c 'GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;'\n",
        ".py": 'cur.execute("ALTER DEFAULT PRIVILEGES GRANT ALL ON FUNCTIONS TO service_role;")\n',
    }[suffix], encoding="utf-8")
    with pytest.raises(AssertionError, match=rf"scripts/ci/reset_acl\{suffix}: blanket application-role grant"):
        _assert_repo_scripts_safe(tmp_path)


def test_guard_allows_postgres_only_backup_seed_grants():
    # scripts/backup/tests/seed_platform.sql grants auth/storage tables to postgres only.
    seed = REPO / "scripts/backup/tests/seed_platform.sql"
    source = seed.read_text(encoding="utf-8")
    assert re.search(r"GRANT ALL ON ALL TABLES IN SCHEMA auth TO postgres;", source)
    assert re.search(r"GRANT ALL ON ALL TABLES IN SCHEMA storage TO postgres;", source)
    _assert_no_blanket_app_grants(source)


# ── PC-J498 (J497 part C): every prod-active ACL migration has a postcondition
# --baseline records prod-active migrations without running them, so a REVOKE
# they made on an application role must be re-checked after the clone. Values
# name RAISE EXCEPTION checks of staging_clone_postconditions.sql; INVARIANT is
# the migration ACL invariant table, whose rows carry the migration's number.
INVARIANT = "migration_acl_invariant_violated"
ACL_MIGRATION_COVERAGE = {
    "376_blackeye_admission.sql": (INVARIANT,),
    "108_security_hardening.sql": (INVARIANT,),
    "161_fn_upsert_listening_answer.sql": (INVARIANT,),
    "163_fn_merge_sitting_integrity.sql": (INVARIANT,),
    "168_fn_void_sitting.sql": (INVARIANT,),
    "169_fn_set_exam_mode.sql": (INVARIANT,),
    "172_fn_set_exam_content_cohorts.sql": (INVARIANT,),
    "174_fn_insert_listening_answer_once.sql": (INVARIANT,),
    "179_fn_class_assignment_atomic.sql": (INVARIANT,),
    "180_fn_class_assignment_locks.sql": (INVARIANT,),
    "181_test_attempts_class_link.sql": (INVARIANT,),
    "184_fn_create_assignment_kind.sql": (INVARIANT,),
    "186_quiz_why_wrong_and_lesson.sql": (INVARIANT,),
    "193_assignment_subgroup_and_backfill.sql": (INVARIANT,),
    "194_course_writing_drafts.sql": (INVARIANT,),
    "196_delete_rpc_course_evidence.sql": (INVARIANT,),
    "204_reconcile_course_and_gate_e_schema.sql": (INVARIANT, "service_role_can_maintain_or_truncate_class_action_log"),
    "205_writing_regrade_atomic_transitions.sql": (INVARIANT,),
    "206_writing_assignment_idempotency.sql": (INVARIANT,),
    "211_d1_attempt_session_reliability.sql": (INVARIANT,),
    "212_flashcard_review_idempotency.sql": (INVARIANT,),
    "215_speaking_session_renderer_affinity.sql": (INVARIANT,),
    "216_version_session_renderer_affinity_create.sql": (INVARIANT,),
    "218_reading_attempt_renderer_affinity.sql": (INVARIANT,),
    "219_listening_attempt_renderer_affinity.sql": (INVARIANT,),
    "220_dictation_attempt_affinity.sql": (INVARIANT,),
    "221_writing_assignment_renderer_affinity.sql": (INVARIANT,),
    "223_course_pronunciation_service_role_grants.sql": (INVARIANT,),
    "224_active_player_resume_ttl.sql": (INVARIANT,),
    "225_allow_admitted_speaking_grade_after_submit.sql": (INVARIANT,),
    "226_course_multisection_results.sql": (INVARIANT,),
    "227_student_cohort_memberships.sql": (INVARIANT,),
    "228_writing_idempotency_optional_cohort.sql": (INVARIANT,),
    "245_cambridge_mock_correction_foundation.sql": (INVARIANT,),
    "257_mock_correction_event_persistence.sql": (INVARIANT,),
    "259_atomic_exam_scope_assignment.sql": (INVARIANT,),
    "260_approve_web_explanation_paper.sql": (INVARIANT,),
    "261_atomic_public_explanation_policy.sql": (INVARIANT,),
    "263_atomic_timed_course_quiz_start.sql": (INVARIANT,),
    "264_lock_timed_course_start_authorization.sql": (INVARIANT,),
    "265_timed_course_session_and_progress_boundary.sql": (INVARIANT,),
    "266_allow_timed_course_retry_start.sql": (INVARIANT,),
    "267_atomic_course_assessment_bank_replace.sql": (INVARIANT,),
    "268_guard_assigned_assessment_replacement.sql": (INVARIANT,),
    "269_serialize_course_assignment_bank_revision.sql": (INVARIANT,),
    "270_atomic_timed_course_session_creation.sql": (INVARIANT,),
    "271_atomic_course_assessment_bank_create.sql": (INVARIANT,),
    "273_atomic_timed_course_timeout_close.sql": (INVARIANT,),
    "274_bound_timed_course_final_batch.sql": (INVARIANT,),
    "275_verify_terminal_timed_final_batch.sql": (INVARIANT,),
    "276_reject_late_timed_course_answers.sql": (INVARIANT,),
    "277_close_unstarted_expired_course_retry.sql": (INVARIANT,),
    "278_protect_started_assignment_deletion.sql": (INVARIANT,),
    "279_reject_superseded_timed_course_progress.sql": (INVARIANT,),
    "281_advanced_vocab_stage_progress.sql": (INVARIANT,),
    "282_advanced_vocab_persistence_gate.sql": (INVARIANT,),
    "283_master30_grammar_diagnostic.sql": (INVARIANT,),
    "284_single_attempt_course_assignments.sql": (INVARIANT,),
    "285_lock_single_attempt_guard_functions.sql": (INVARIANT,),
    "288_advanced_vocab_rewrite_feedback.sql": (INVARIANT,),
    "289_fix_advanced_vocab_rewrite_claim_count.sql": (INVARIANT,),
    "290_align_advanced_vocab_rewrite_evidence.sql": (INVARIANT,),
    "292_advanced_vocab_practice_rollout_compatibility.sql": (INVARIANT,),
    "293_atomic_advanced_vocab_bank_release.sql": (INVARIANT,),
    "294_atomic_quiz_import_publish_state.sql": (INVARIANT,),
    "295_listening_content_programmes.sql": (INVARIANT,),
    "296_listening_programme_feedback_reveals.sql": (INVARIANT,),
    "297_admin_writing_queue_page.sql": (INVARIANT,),
    "298_admin_mock_review_eligibility.sql": (INVARIANT,),
    "299_admin_exam_content_page.sql": (INVARIANT,),
    "300_admin_writing_queue_page_snapshot.sql": (INVARIANT,),
    "301_admin_exam_content_page_snapshot.sql": (INVARIANT,),
    "302_admin_mock_review_list_snapshot.sql": (INVARIANT,),
    "303_listening_v1_start_drain_gate.sql": (INVARIANT,),
    "304_listening_80_days_source_collection.sql": (INVARIANT,),
    "305_dictation_frozen_grading_policy.sql": (INVARIANT,),
    "306_mock_paper_policy_and_admission.sql": (INVARIANT,),
    "307_mock_attempt_review_flags.sql": (INVARIANT,),
    "309_grammar_quiz_revision_cutover.sql": (INVARIANT,),
    "312_assigned_master30_grammar_lessons.sql": (INVARIANT,),
    "313_master30_original_full_banks.sql": (INVARIANT,),
    "314_grammar_audit_reviewed_publication.sql": (INVARIANT,),
    "315_mock_exam_private_draft_copies.sql": (INVARIANT,),
    "316_mock_draft_shared_resume_and_package_guard.sql": (INVARIANT,),
    "319_explanation_version_unavailable_reason.sql": (INVARIANT,),
    "320_client_write_privilege_lockdown.sql": (INVARIANT, "client_write_privilege_lockdown_incomplete",
        "server_owned_column_still_client_writable",
        "client_sequence_update_survives",
        "client_default_write_privilege_survives",
        "client_executable_privileged_function"),
    "322_ai_model_overrides_and_failures.sql": (INVARIANT,),
    "326_student_archive.sql": (INVARIANT,),
    "331_writing_assignment_archived_student_guard.sql": (INVARIANT,),
    "332_staff_security_audit.sql": (INVARIANT,),
    "334_activate_attempt_rate_limit.sql": (INVARIANT,),
    "335_learner_jwt_writes_require_active_account.sql": (INVARIANT,),
    "336_suspended_account_role_guard.sql": (INVARIANT,),
    "339_grammar_quiz_followup_codes.sql": (INVARIANT,),
}
_SQL_COMMENT = re.compile(r"/\*.*?\*/|--[^\n]*", re.DOTALL)
INVARIANT_HEAD = "WITH invariant(kind, object, roles, privileges, migrations, exempt) AS (VALUES"
_REVOKE = re.compile(r"\bREVOKE\b(?P<privileges>[^;]*?)\bON\b(?P<target>[^;]*?)\bFROM\b(?P<roles>[^;]*)",
                     re.IGNORECASE)
_INVARIANT_ROW = re.compile(
    r"^\s+\('(?P<kind>relation|function|function_name|function_like|schema)', '(?P<object>[^']+)', "
    r"'(?P<roles>[a-z_ ]+)', '(?P<privileges>[A-Z ]+)', '(?P<migrations>[0-9a-z ]+)', "
    r"(?:NULL|'(?P<exempt>[^']+)')\),?$",
    re.MULTILINE,
)


def _migration_number(filename: str) -> str:
    return filename.split("_", 1)[0]


def _policy_states() -> dict[str, str]:
    lines = (MIGRATIONS / "forward-policy.tsv").read_text(encoding="utf-8").splitlines()
    return {fields[0]: fields[1] for fields in (line.split("\t") for line in lines)
            if fields[0] and not fields[0].startswith("#")}


def _app_role_revokes(sql: str):
    for match in _REVOKE.finditer(_SQL_COMMENT.sub(" ", sql)):
        if {role.strip("'\"").lower() for role in re.split(r"[,\s]+", match["roles"])} & APP_ROLES:
            yield match


def acl_migrations() -> dict[str, list[re.Match]]:
    """Prod-active migrations (not retired/pending_feature) revoking an app-role privilege."""
    states = _policy_states()
    found = {}
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if path.name.endswith("_rollback.sql") or states.get(path.name, "active") != "active":
            continue
        revokes = list(_app_role_revokes(path.read_text(encoding="utf-8")))
        if revokes:
            found[path.name] = revokes
    return found


def migration_306_column_grant() -> tuple[str, list[str], list[str]]:
    """306's GRANT SELECT(<columns>) ... TO authenticated: (statement, tables, columns)."""
    sql = (MIGRATIONS / "306_mock_paper_policy_and_admission.sql").read_text(encoding="utf-8")
    grants = list(re.finditer(r"(?m)^GRANT SELECT\((?P<columns>[^)]+)\)\s+ON (?P<tables>\S+) TO authenticated;", sql))
    assert len(grants) == 1, "306 must keep exactly one authenticated column GRANT"
    return (grants[0][0], grants[0]["tables"].split(","),
            [column for column in re.split(r"[,\s]+", grants[0]["columns"]) if column])


def clone_acl_invariants() -> list[dict[str, str]]:
    """Rows of the migration ACL invariant table in staging_clone_postconditions.sql."""
    source = POSTCONDITIONS.read_text(encoding="utf-8")
    table = source[source.index(INVARIANT_HEAD):]
    table = table[:table.index("\n    ), target AS (")]
    rows = [m.groupdict() for m in _INVARIANT_ROW.finditer(table)]
    assert len(rows) == table.count("\n        ('"), "unparsed invariant row"
    return rows


def _revoke_targets(match: re.Match):
    """(kind, name) per object, or None for a dynamic/schema-wide/default-ACL target."""
    target = re.sub(r"\s+", " ", match["target"]).strip()
    if "%" in target or "'" in target or "'" in match["roles"]:
        return None
    if re.match(r"(?:ALL \w+ IN SCHEMA|(?:TABLES|SEQUENCES|FUNCTIONS|ROUTINES|TYPES)$)", target, re.I):
        return None
    kind, target = (("function", target.split(" ", 1)[1]) if re.match(r"(?:FUNCTION|ROUTINE|PROCEDURE) ", target, re.I)
                    else ("schema", target.split(" ", 1)[1]) if re.match(r"SCHEMA ", target, re.I)
                    else ("relation", re.sub(r"^TABLE ", "", target, flags=re.I)))
    names = []
    for item in re.split(r",(?![^(]*\))", target):
        name = re.sub(r"\s*\(.*", "", item).strip().strip('"').lower()
        names.append((kind, name if kind == "schema" or "." in name else f"public.{name}"))
    return names


def _row_covers(row: dict[str, str], kind: str, name: str) -> bool:
    if kind == "relation" or kind == "schema":
        return row["kind"] == kind and row["object"] == name
    if row["kind"] == "function":
        return row["object"].split("(", 1)[0] == name
    if row["kind"] == "function_name":
        return f"public.{row['object']}" == name
    if row["kind"] == "function_like":
        pattern = row["object"].replace("%", ".*").replace("_", ".")
        return re.fullmatch(rf"public\.{pattern}", name) is not None
    return False


def test_clone_postconditions_cover_acl_migrations():
    migrations = acl_migrations()
    rows = clone_acl_invariants()
    source = _SQL_COMMENT.sub(" ", POSTCONDITIONS.read_text(encoding="utf-8"))
    checks = set(re.findall(r"RAISE\s+EXCEPTION\s+'(\w+)", source))
    assert len(migrations) >= 90 and len(rows) >= 190
    numbers = [_migration_number(name) for name in migrations]
    assert len(set(numbers)) == len(numbers), "migration numbers must identify one file"

    # A new prod-active ACL migration (341/344/356/357 ...) stays red until it
    # names its postcondition here; a stale entry is red as well.
    assert sorted(set(migrations) - set(ACL_MIGRATION_COVERAGE)) == [], "ACL migration without a postcondition"
    assert sorted(set(ACL_MIGRATION_COVERAGE) - set(migrations)) == [], "stale coverage entry"
    tagged = {number for row in rows for number in row["migrations"].split()}
    covered = {_migration_number(name) for name, named in ACL_MIGRATION_COVERAGE.items() if INVARIANT in named}
    assert tagged == covered, "invariant rows must carry exactly the INVARIANT-covered migrations"

    gaps = []
    for name, revokes in migrations.items():
        named = ACL_MIGRATION_COVERAGE[name]
        assert named and set(named) <= checks, f"{name}: unknown check {set(named) - checks}"
        own = [row for row in rows if _migration_number(name) in row["migrations"].split()]
        for revoke in revokes:
            targets = _revoke_targets(revoke)
            if targets is None:
                # Dynamic targets: a name-pattern row or a named catalog check.
                if not (set(named) - {INVARIANT} or any(r["kind"] in {"function_name", "function_like"} for r in own)):
                    gaps.append(f"{name}: {re.sub(chr(10), ' ', revoke[0])[:120]}")
                continue
            if INVARIANT not in named:
                gaps.append(f"{name}: static REVOKE needs invariant rows")
                continue
            gaps += [f"{name}: {kind} {obj}" for kind, obj in targets
                     if not any(_row_covers(row, kind, obj) for row in own)]
    assert gaps == [], "REVOKE without a covering postcondition:\n" + "\n".join(gaps)


def test_invariant_rows_are_well_formed():
    for row in clone_acl_invariants():
        roles = row["roles"].split()
        assert roles and set(roles) <= APP_ROLES and len(set(roles)) == len(roles), row
        privileges = set(row["privileges"].split())
        allowed = {"relation": {"ALL", "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER",
                                "MAINTAIN"},
                   "schema": {"USAGE", "CREATE"}}.get(row["kind"], {"EXECUTE"})
        assert privileges and privileges <= allowed and ("ALL" not in privileges or privileges == {"ALL"}), row
        if row["kind"] == "function":
            # Built-in type names only: the dump empties search_path.
            assert re.fullmatch(r"[a-z_]+\.[a-z0-9_]+\(([a-z0-9_]+(\[\])?(,[a-z0-9_]+(\[\])?)*)?\)", row["object"]), row
        if row["exempt"] is not None and row["kind"] == "relation":
            # Exempt column names: only a column-level privilege of a non-PUBLIC role.
            assert privileges <= {"SELECT", "INSERT", "UPDATE", "REFERENCES"} and "public" not in roles, row
            assert all(re.fullmatch(r"[a-z_][a-z0-9_]*", column) for column in row["exempt"].split()), row
        else:
            assert (row["exempt"] is None) or row["kind"] == "function_like", row


def test_column_exemptions_are_exactly_306s_column_grant():
    # 306 seals expected answers: authenticated may SELECT only these columns.
    _, tables, columns = migration_306_column_grant()
    exempt = {(row["object"], row["roles"], row["privileges"], row["migrations"], row["exempt"])
              for row in clone_acl_invariants() if row["kind"] == "relation" and row["exempt"]}
    assert exempt == {(table, "authenticated", "SELECT", "306", " ".join(columns)) for table in tables}
    for table in tables:
        rows = [row for row in clone_acl_invariants() if row["object"] == table]
        forbidden = {(role, privilege) for row in rows for role in row["roles"].split()
                     for privilege in (["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES",
                                        "TRIGGER", "MAINTAIN"] if row["privileges"] == "ALL"
                                       else row["privileges"].split())}
        # Every app-client privilege is still pinned; SELECT only outside 306's columns.
        assert forbidden == {(role, privilege) for role in ("public", "anon", "authenticated")
                             for privilege in ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
                                               "REFERENCES", "TRIGGER", "MAINTAIN")}, table


def test_invariant_rows_must_name_a_listed_migration(monkeypatch, tmp_path):
    # A new row is parsed, and a row for a migration not listed above is red.
    copy = tmp_path / "postconditions.sql"
    source = POSTCONDITIONS.read_text(encoding="utf-8")
    head = INVARIANT_HEAD + "\n"
    row = "        ('relation', 'public.t', 'anon', 'SELECT', '999', NULL),\n"
    copy.write_text(source.replace(head, head + row), encoding="utf-8")
    monkeypatch.setitem(globals(), "POSTCONDITIONS", copy)
    assert {"kind": "relation", "object": "public.t", "roles": "anon", "privileges": "SELECT",
            "migrations": "999", "exempt": None} in clone_acl_invariants()
    with pytest.raises(AssertionError, match="invariant rows must carry"):
        test_clone_postconditions_cover_acl_migrations()


def test_coverage_turns_red_for_an_unlisted_acl_migration(monkeypatch, tmp_path):
    # 341/344/356/357 shape: a new prod-active file revoking a client privilege.
    copy = tmp_path / "migrations"
    shutil.copytree(MIGRATIONS, copy)
    (copy / "999_new_client_revoke.sql").write_text(
        "REVOKE ALL ON TABLE public.listening_tests FROM PUBLIC, anon, authenticated;\n", encoding="utf-8")
    monkeypatch.setitem(globals(), "MIGRATIONS", copy)
    with pytest.raises(AssertionError, match="ACL migration without a postcondition"):
        test_clone_postconditions_cover_acl_migrations()
    # Retired or pending_feature files are not baselined as applied, so they stay out.
    with (copy / "forward-policy.tsv").open("a", encoding="utf-8") as policy:
        policy.write("999_new_client_revoke.sql\tpending_feature\tnew_group\tfixture\n")
    test_clone_postconditions_cover_acl_migrations()


def test_coverage_turns_red_for_a_revoke_without_a_row(monkeypatch, tmp_path):
    copy = tmp_path / "postconditions.sql"
    source = POSTCONDITIONS.read_text(encoding="utf-8")
    # 334 keeps its function row, so only the per-object check can catch this.
    rows = re.findall(r"(?m)^        \('relation', 'public\.activation_attempts', .*\n", source)
    assert len(rows) == 2
    copy.write_text(re.sub(r"(?m)^        \('relation', 'public\.activation_attempts', .*\n", "", source),
                    encoding="utf-8")
    monkeypatch.setitem(globals(), "POSTCONDITIONS", copy)
    with pytest.raises(AssertionError, match="relation public.activation_attempts"):
        test_clone_postconditions_cover_acl_migrations()


def test_postconditions_fail_closed_on_invariant_violation_and_missing_object():
    source = _SQL_COMMENT.sub(" ", POSTCONDITIONS.read_text(encoding="utf-8"))
    block = source[source.index(INVARIANT_HEAD):]
    assert re.search(r"IF missing IS NOT NULL THEN\s+RAISE EXCEPTION "
                     r"'migration_acl_invariant_object_missing: %', missing;", block)
    assert re.search(r"IF leaks IS NOT NULL THEN\s+RAISE EXCEPTION "
                     r"'migration_acl_invariant_violated: %', leaks;", block)
    assert "RAISE WARNING" not in block
    # One DDL-free statement: the same block runs as a read-only pre-check.
    statements = re.sub(r"'[^']*'", "''", block)
    assert not re.search(r"\b(?:CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|GRANT|REVOKE)\b", statements)


# ── PC-J498 (J497 part C): staging-first ACL groups are reported, not applied
def _pending_acl():
    sys.path.insert(0, str(SCRIPTS))
    try:
        import staging_clone_pending_acl
    finally:
        sys.path.remove(str(SCRIPTS))
    return staging_clone_pending_acl


def test_clone_reports_pending_feature_acl_groups_it_does_not_apply():
    module = _pending_acl()
    groups = module.pending_acl_groups(MIGRATIONS, {"curated_vocab"})
    assert groups["listening_tests_revoke"] == ["347_listening_tests_client_revoke.sql"]
    assert "curated_vocab" not in groups
    # Groups that only grant on objects they create do not change prod ACLs.
    assert "ai_budget" not in groups and "class_archive" not in groups
    text = module.warning(groups)
    assert "WARNING: staging-first ACL migrations NOT re-applied" in text
    assert 'MIGRATION_FEATURES=listening_tests_revoke backend/scripts/apply_migrations.sh "$STAGING_URL"' in text
    for group in groups:
        assert f"MIGRATION_FEATURES={group} " in text


def test_clone_prints_pending_acl_groups_after_curated_vocab_only():
    source = CLONE.read_text(encoding="utf-8")
    report = source.index('python3 "$ROOT/backend/scripts/staging_clone_pending_acl.py" '
                          '"$ROOT/backend/migrations" curated_vocab ||')
    assert source.index('echo "== verifying Curated Vocabulary ledger and schema"') < report
    assert report < source.index('echo "== verify: table count in staging public schema"')
    # The clone itself re-applies only curated_vocab.
    assert re.findall(r"MIGRATION_FEATURES=(\w+)", source) == ["curated_vocab"]
