"""PC-J225/PC-J226 guard — no NEW client-facing 4xx message that echoes request text.

Same AST sweep as the PC-J225 audit (`PC-J225-echo-sweep-scan.py`):
`raise HTTPException(4xx, …)` and `JSONResponse(status_code=4xx, …)` anywhere
in backend/ (except scripts/tests) and `raise ValueError/TypeError(…)` outside
services/. A status that is not a literal (`exc.status_code`) counts as 4xx;
`status.HTTP_NNN_…` resolves. The message is every f-string, `str()`/`repr()`,
`"…".format(…)` and `"…" % …` in the arguments, including a local the message
was built into first (PC-J226 F5).

Group A: the message interpolates a name bound by an enclosing
`except … as <name>`, `e`/`exc`/`err`, `str(…)`/`repr(…)`, or `body.`/`payload`/
`filename`/`request.`/`data.get(`. Group B (PC-J226): any other interpolated
value. Values passed through `clip_user_value(s)`, `summarize_validation_error`
or `describe_parse_error`, UPPER_CASE constants and `len(…)` counts are safe.

Every remaining site is listed below (ALLOWED = A, ALLOWED_B = B) with the
reason it is kept. A new site fails this test: clip the value
(services/errors.py), drop it, or add it here with a reason a reviewer can
check. A removed site fails too, so the lists cannot go stale.
"""
from __future__ import annotations

import ast
import re
from collections import Counter, deque
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

SAFE_CALLS = {"clip_user_value", "clip_user_values", "summarize_validation_error",
              "describe_parse_error"}
A_PATTERN = re.compile(
    r"\b(e|exc|err)\b|\bbody\.|\bpayload\b|filename|\brequest\.|\bdata\.get\("
)

# Reasons (kept sites). "App-authored" = the exception's messages are written
# in the service and interpolate only constants or server-side data (DB ids,
# statuses, codes); where a client value could reach them it is clipped at
# the source with clip_user_value (PC-J225).
APP_AUTHORED = "str() of an app-authored service exception (constants / server data; client values clipped at source)"
UUID_LOOKUP = "message names ids only after a uuid-typed path/lookup (non-UUID text is rejected first)"
TYPED_INT = "interpolates int-typed (pydantic) fields, counts or parsed floats only"
VALIDATED = "value was checked against an allowlist / regex pattern before this raise"
FILTER_CONFIG = "_normalize_filter_config ValueError: key clipped with clip_user_value, refused categories reported as a count"
J213 = "SkillNotInSittingError keys clipped by _clip_skill_key (PC-J213, PR #2011); wf.ValidationError band/channel values clipped with clip_user_value (PC-J226)"

ALLOWED: dict[tuple[str, str, str], tuple[int, str]] = {
    # path, enclosing function, interpolated expression → (count, reason)
    ("routers/admin.py", "generate_access_codes", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin.py", "generate_and_assign_code", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin.py", "patch_access_code", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin_ai.py", "patch_ai_model_override", "str(exc)"): (1, "OverrideValidationError names allowlisted values only (ai_model_overrides.validate)"),
    ("routers/admin_class_assignments.py", "_pick_chosen_questions", "body.part; want"): (1, TYPED_INT),
    ("routers/admin_class_assignments.py", "_resolve_course_bank", "str(exc)"): (1, APP_AUTHORED),
    ("routers/admin_class_assignments.py", "backfill_assignment", "str(exc)"): (2, APP_AUTHORED),
    ("routers/admin_class_assignments.py", "create_assignment", "str(exc)"): (4, APP_AUTHORED),
    ("routers/admin_class_assignments.py", "return_student_work", "str(exc)"): (1, APP_AUTHORED),
    ("routers/admin_class_assignments.py", "update_assignment_due", "str(exc)"): (1, "parse_due_time clips the refused value"),
    ("routers/admin_exam_content.py", "list_exam_content", "str(e)"): (2, "UnknownKindError clips kind; other ValueErrors are constants"),
    ("routers/admin_exam_content.py", "list_exam_content_page", "str(e)"): (1, "UnknownKindError clips kind; other ValueErrors are constants"),
    ("routers/admin_exam_content.py", "set_cohorts", "str(e)"): (2, "UnknownKindError / LookupError clip kind and content_id"),
    ("routers/admin_exam_content.py", "set_course_level", "str(e)"): (2, "UnknownKindError / LookupError clip kind and content_id"),
    ("routers/admin_exam_content.py", "set_public_visibility", "str(e)"): (2, "UnknownKindError / LookupError clip kind and content_id"),
    ("routers/admin_exam_content.py", "set_status", "str(e)"): (6, "UnknownKindError / LookupError clip kind and content_id; readiness/lifecycle messages are app-authored"),
    ("routers/admin_instructor_queue.py", "claim_review", "str(e)"): (2, UUID_LOOKUP),
    ("routers/admin_instructor_queue.py", "deliver_review", "str(e)"): (2, UUID_LOOKUP),
    ("routers/admin_instructor_queue.py", "release_review", "str(e)"): (2, UUID_LOOKUP),
    ("routers/admin_mock_exams.py", "admin_record_speaking", "str(e)"): (2, APP_AUTHORED),
    ("routers/admin_mock_exams.py", "advance_section", "str(e)"): (2, "from_section is regex-validated; ids reach messages only after a uuid lookup"),
    ("routers/admin_mock_exams.py", "_collect", "str(e)"): (2, "section / from_section are regex-validated query params"),
    ("routers/admin_mock_exams.py", "create_assignments", "str(e)"): (1, "InvalidWindowError / UnservableSkillError clip the client value and list"),
    ("routers/admin_mock_exams.py", "create_exam", "str(e)"): (2, APP_AUTHORED),
    ("routers/admin_mock_exams.py", "delete_assignment", "str(e)"): (1, "RevocationError: constant text + count"),
    ("routers/admin_mock_exams.py", "live_monitor", "str(e)"): (1, UUID_LOOKUP),
    ("routers/admin_mock_exams.py", "section_progress", "str(e)"): (1, UUID_LOOKUP),
    ("routers/admin_mock_exams.py", "set_open", "str(e)"): (2, APP_AUTHORED),
    ("routers/admin_mock_exams.py", "set_sitting_retest", "str(e)"): (1, UUID_LOOKUP),
    ("routers/admin_mock_exams.py", "set_sitting_retest_flags", "str(e)"): (3, J213),
    ("routers/admin_mock_exams.py", "sitting_pacing", "str(e)"): (1, UUID_LOOKUP),
    ("routers/admin_mock_exams.py", "skip_writing_grading", "str(e)"): (2, APP_AUTHORED),
    ("routers/admin_mock_exams.py", "update_exam", "str(e)"): (2, APP_AUTHORED),
    ("routers/admin_mock_exams.py", "void_sitting", "str(e)"): (2, APP_AUTHORED),
    # 6 since the staging merge: staging added the SkillNotInSittingError
    # site, input clipped at mock_review_workflow.py:86-97.
    ("routers/admin_mock_reviews.py", "_raise_for", "str(e)"): (6, J213 + "; any other exception type gets a generic message"),
    ("routers/admin_reading.py", "admin_upload_diagram_image", "str(exc)"): (1, "InvalidImageError (reading_image.upload_diagram_image): constants and byte counts only; dynamic status = its http_status (PC-J226 F5)"),
    ("routers/admin_writing.py", "extract_essay_file", "str(exc)"): (1, "FileExtractError messages are constants (docx failure names only the exception class)"),
    ("routers/admin_writing_assignments.py", "_fan_out_to_cohort_sync", "body.expected_student_count"): (1, TYPED_INT),
    ("routers/admin_writing_prompts.py", "_update_prompt_sync", "str(e)"): (1, "assert_can_unreserve names DB exam codes only"),
    ("routers/admin_writing_prompts.py", "upload_image", "str(exc)"): (1, "upload_prompt_image: sizes and constants only"),
    ("routers/export.py", "export_session_pdf", "str(exc)"): (1, "session id was already matched by the owner query above (uuid column)"),
    # PC-J226 F5: names bound by `except … as ve` are group A too.
    ("routers/flashcards.py", "create_stack", "str(ve)"): (1, FILTER_CONFIG),
    ("routers/flashcards.py", "preview_stack", "str(ve)"): (1, FILTER_CONFIG),
    ("routers/flashcards.py", "submit_review", "str(ve)"): (1, "update_srs ValueError: constant text naming the rating domain"),
    ("routers/instructor.py", "claim_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/instructor.py", "deliver_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/instructor.py", "release_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/listening.py", "_change_listening_package_status", "str(exc)"): (1, "PackageValidationError from set_package_status: constants"),
    ("routers/listening.py", "_grade_and_save_dictation", "body.segment_idx"): (1, TYPED_INT),
    ("routers/listening.py", "_resolve_attempt_target", "body.mode"): (1, VALIDATED + " (only caller checks body.mode against the 4 modes first)"),
    ("routers/listening.py", "_resolve_attempt_target", "body.mode; exercise_row['exercise_type']"): (1, VALIDATED + " (only caller checks body.mode against the 4 modes first; exercise_type is DB data)"),
    ("routers/listening.py", "admin_edit_exercise_question", "s; e"): (1, TYPED_INT + " (`s`/`e` are float() of the window)"),
    ("routers/listening.py", "admin_upsert_listening_exercise", "str(exc)"): (1, "ResponsePolicyError messages are constants"),
    ("routers/listening.py", "check_listening_practice_answer", "body.q_num"): (1, TYPED_INT),
    ("routers/listening.py", "grade_listening_test_dictation", "body.sentence_idx"): (1, TYPED_INT),
    ("routers/listening.py", "start_listening_test_attempt", "str(exc)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/mock_exams.py", "_raise_for", "str(e)"): (4, "MockExamError family: section/code clipped at source, ids after uuid lookup; any other exception gets a generic message"),
    ("routers/reading_student.py", "_start_reading_test_attempt_sync", "str(exc)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/sessions.py", "_bind_session_to_mock_if_requested", "exc"): (1, "bind_session_to_sitting errors: constants, DB status, sitting id after uuid lookup"),
    ("routers/sessions.py", "_complete_session_internal", "session_id; e"): (1, "background finalizer only; never reaches a response"),
    ("routers/sessions.py", "_resolve_full_test_attempt_id", "body.part - 1"): (1, TYPED_INT),
    ("routers/sessions.py", "_resolve_full_test_attempt_id", "body.part; body.part - 1"): (1, TYPED_INT),
    ("routers/sessions.py", "create_session", "str(e)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/vocab_units.py", "admin_set_vocab_pilot_cohort", "str(exc)"): (1, "constant message"),
    # Both sites now sit in the threaded load_for_learner closures of
    # open_my_vocab_recommendation and resolve_my_vocab_context_links.
    ("routers/vocab_units.py", "load_for_learner", "str(exc)"): (2, "constant messages (one names a limit constant)"),
    ("routers/writing_student.py", "extract_essay_text", "str(exc)"): (1, "FileExtractError messages are constants (docx failure names only the exception class)"),
}


# ── Group B (PC-J226) ────────────────────────────────────────────────────
# Any other interpolated value. A request-derived value is clipped with
# clip_user_value(s); every site kept as is is listed with its reason.
DB_VALUE = "value read from the DB (status, title, source_type, question_type, row id): server data, not request text"
SERVER_NUMBER = "server-side count, limit, retry delay, size or config number"
CONSTANT_B = "constant or server-built text (literal loop, allowlist join, constant matrix)"
LITERAL_ARG = "internal parameter: every caller passes a literal"
POSITION = "enumerate() position, or a value already checked to be an int/float just above"
TYPED_PATH = "int- or uuid-typed path/body value (FastAPI rejects other text with 422 first)"

ALLOWED_B: dict[tuple[str, str, str], tuple[int, str]] = {
    ("main.py", "permission_error_handler", "str(_uuid.uuid4())"): (1, "server-generated request id"),
    ("routers/admin.py", "_run_regrade_response", "response_id"): (2, DB_VALUE),
    ("routers/admin.py", "_validate_code_type_combo", "code_type"): (1, VALIDATED + " (in _VALID_CODE_TYPES; the refusing branch clips)"),
    ("routers/admin.py", "delete_access_code", "active_count"): (1, SERVER_NUMBER),
    ("routers/admin.py", "hard_delete_access_code", "active_count"): (1, SERVER_NUMBER),
    ("routers/admin_class_assignments.py", "_resolve_course_bank", "bank['title']; dup[0].get('title')"): (1, DB_VALUE),
    ("routers/admin_class_assignments.py", "_resolve_speaking_lesson_set", "missing"): (1, SERVER_NUMBER),
    ("routers/admin_class_assignments.py", "_resolve_speaking_lesson_set", "st['title']; dup[0].get('title')"): (1, DB_VALUE),
    ("routers/admin_class_assignments.py", "_resolve_speaking_topic", "topic['title']; dup[0].get('title')"): (1, DB_VALUE),
    ("routers/admin_reading.py", "_fetch_question_or_404", "', '.join(_DIAGRAM_FLOW_TYPES); row.get('question_type')"): (1, DB_VALUE + " + constant list"),
    ("routers/admin_reading.py", "admin_delete_reading_test", "names"): (1, DB_VALUE),
    ("routers/admin_students.py", "update_student", "required_field"): (1, CONSTANT_B),
    ("routers/admin_writing.py", "mark_delivered", "outcome['status']"): (1, DB_VALUE),
    ("routers/admin_writing.py", "revoke_delivery", "outcome['status']"): (1, DB_VALUE),
    ("routers/admin_writing.py", "start_grading", "row.data[0]['status']"): (2, DB_VALUE),
    ("routers/admin_writing.py", "trigger_regrade", "essay['status']"): (1, DB_VALUE),
    ("routers/admin_writing.py", "trigger_regrade", "essay_service.MAX_VERSIONS"): (1, SERVER_NUMBER),
    ("routers/admin_writing.py", "update_feedback", "current_status"): (1, DB_VALUE),
    ("routers/admin_writing.py", "update_instructor_note", "current_status"): (1, DB_VALUE),
    ("routers/admin_writing_assignments.py", "_validate_status_transition", "current; target; allowed_str"): (1, "current = DB status; target matched AssignmentUpdate.status pattern; allowed_str from the constant matrix"),
    ("routers/admin_writing_prompts.py", "_update_prompt_sync", "', '.join(invalid_nulls)"): (1, "keys of PromptUpdate.model_dump(): model field names only"),
    ("routers/admin_writing_regrade.py", "_action_regrade_request_sync", "result.get('status')"): (1, DB_VALUE),
    ("routers/auth.py", "_rate_limit_activate", "str(retry_after_s)"): (1, SERVER_NUMBER),
    ("routers/auth.py", "_rate_limit_activate", "verdict"): (1, "RPC result; the ValueError is caught into a generic 503 (safe_error)"),
    ("routers/auth.py", "update_profile", "', '.join(valid_levels)"): (1, CONSTANT_B),
    ("routers/feedback.py", "_check_rating", "name"): (1, LITERAL_ARG),
    ("routers/grading.py", "grade_response_endpoint", "duration_sec; max_dur"): (1, SERVER_NUMBER + " (STT duration, config limit)"),
    ("routers/grading.py", "grade_response_endpoint", "file_size / (1024 * 1024)"): (1, SERVER_NUMBER + " (len of the upload)"),
    ("routers/instructor.py", "regrade_essay", "essay.get('status')"): (1, DB_VALUE),
    ("routers/instructor.py", "regrade_essay", "essay_service.MAX_VERSIONS"): (1, SERVER_NUMBER),
    ("routers/instructor.py", "revoke_delivery", "cur.get('status')"): (1, DB_VALUE),
    ("routers/instructor.py", "update_instructor_note", "cur.get('status')"): (1, DB_VALUE),
    ("routers/listening.py", "_enforce_gist_rate_limit", "daily"): (1, SERVER_NUMBER),
    ("routers/listening.py", "_enforce_gist_rate_limit", "str(retry_after)"): (1, SERVER_NUMBER),
    ("routers/listening.py", "_read_json_upload", "label"): (4, LITERAL_ARG),
    ("routers/listening.py", "_read_markdown_upload", "label"): (3, LITERAL_ARG),
    ("routers/listening.py", "_read_text_upload", "label"): (2, LITERAL_ARG),
    ("routers/listening.py", "_read_text_upload", "label; ' / '.join(exts)"): (1, LITERAL_ARG),
    ("routers/listening.py", "_validate_dictation_segments", "i"): (4, POSITION),
    ("routers/listening.py", "_validate_dictation_segments", "i; end_v; audio_duration_seconds"): (1, POSITION + " (float(); duration from the DB)"),
    ("routers/listening.py", "_validate_dictation_segments", "i; end_v; start_v"): (1, POSITION + " (float())"),
    ("routers/listening.py", "_validate_dictation_segments", "i; start_v; prev_end"): (1, POSITION + " (float())"),
    ("routers/listening.py", "_validate_dictation_segments", "idx_v; i"): (1, POSITION + " (int())"),
    ("routers/listening.py", "_validate_gist_payload", "index"): (4, POSITION),
    ("routers/listening.py", "_validate_mcq_payload", "i"): (7, POSITION),
    ("routers/listening.py", "_validate_mcq_payload", "i; answer_idx"): (1, POSITION + " (answer_idx isinstance int)"),
    ("routers/listening.py", "_validate_mcq_payload", "i; j"): (3, POSITION),
    ("routers/listening.py", "_validate_mcq_payload", "i; len(opts_raw) if isinstance(opts_raw, list) else 'non-list'"): (1, POSITION + " + count / literal"),
    ("routers/listening.py", "_validate_mcq_payload", "idx_v; i"): (1, POSITION + " (idx_v isinstance int)"),
    ("routers/listening.py", "_validate_true_false_payload", "i"): (7, POSITION),
    ("routers/listening.py", "_validate_true_false_payload", "idx_v; i"): (1, POSITION + " (idx_v isinstance int)"),
    ("routers/listening.py", "admin_assemble_test_audio", "missing"): (1, "section numbers from the literal (1, 2, 3, 4)"),
    ("routers/listening.py", "admin_delete_listening_test", "names"): (1, DB_VALUE),
    ("routers/listening.py", "admin_edit_exercise_question", "q_num"): (2, TYPED_PATH),
    ("routers/listening.py", "admin_hard_delete_listening_test", "names"): (1, DB_VALUE),
    ("routers/listening.py", "admin_import_drill_commit", "dup.data[0].get('status')"): (1, DB_VALUE),
    ("routers/listening.py", "admin_import_fulltest_commit", "dup.data[0].get('status')"): (1, DB_VALUE),
    ("routers/listening.py", "admin_patch_listening_test_status", "names"): (1, DB_VALUE),
    ("routers/listening.py", "admin_upload_test_section_audio", "section_num"): (1, TYPED_PATH),
    ("routers/listening.py", "grade_and_save_dictation_attempt_sentence", "sentence_idx"): (1, TYPED_PATH),
    ("routers/questions.py", "generate_questions", "part"): (1, DB_VALUE),
    ("routers/questions.py", "save_custom_questions", "part"): (1, DB_VALUE),
    ("routers/reading_student.py", "_throttle_share_start", "str(retry_after)"): (1, SERVER_NUMBER),
    ("routers/sessions.py", "_complete_session_internal", "session_id"): (1, "background finalizer only; never reaches a response"),
    ("routers/sessions.py", "_require_permission", "required"): (1, CONSTANT_B + " (_MODE_SCOPE)"),
    ("routers/sessions.py", "_validate_full_test_chain", "sid; expected_part"): (1, "sid equals the id of a session row the owner query returned; part = position"),
    ("routers/sessions.py", "create_session", "quota['limit']"): (1, SERVER_NUMBER),
    ("routers/sessions.py", "create_session", "settings.MAX_SESSIONS_PER_USER_PER_DAY"): (1, SERVER_NUMBER),
    ("routers/sessions.py", "finalize_full_test", "status"): (1, DB_VALUE),
    ("routers/tts.py", "_enforce_daily_quota", "daily_limit"): (1, SERVER_NUMBER),
    ("routers/tts.py", "_throttle_ip", "str(retry_after)"): (1, SERVER_NUMBER),
    ("routers/vocabulary_bank.py", "accept_suggestion", "current_source"): (1, DB_VALUE),
    ("routers/vocabulary_bank.py", "mark_vocab_fixed", "current_source"): (1, DB_VALUE),
    ("routers/writing_student.py", "_persist_flagged_submission", "cur"): (1, DB_VALUE),
    ("routers/writing_student.py", "_replay_committed_submission", "assignment.get('status', 'unknown')"): (1, DB_VALUE),
    ("routers/writing_student.py", "claim_writing_assignment_renderer_affinity", "assignment['status']"): (1, DB_VALUE),
    ("routers/writing_student.py", "log_paste", "a_resp.data[0]['status']"): (1, DB_VALUE),
    ("routers/writing_student.py", "start_assignment", "row['status']"): (1, DB_VALUE),
    ("routers/writing_student.py", "submit_my_assignment", "cur"): (1, DB_VALUE),
    ("routers/writing_student.py", "upsert_my_draft", "assignment['status']"): (1, DB_VALUE),
    ("services/advanced_vocab_service.py", "_require_section", "section"): (1, LITERAL_ARG),
    ("services/advanced_vocab_service.py", "_require_stage", "stage"): (1, LITERAL_ARG + " (or a stage checked against _PRACTICE_COUNTS)"),
    ("services/advanced_vocab_service.py", "_submit_section", "section"): (2, LITERAL_ARG),
    ("services/essay_service.py", "_ensure_student_exists", "student_id"): (1, TYPED_PATH + " (CreateEssayRequest.student_id: UUID)"),
    ("services/essay_service.py", "compose_version", "crit; src_v"): (1, "criterion names constant; versions int-typed (ComposeBody)"),
    ("services/essay_service.py", "upsert_grade_rating", "essay_id"): (1, TYPED_PATH),
    ("services/quiz_service.py", "_review_course_section_result", "section"): (1, LITERAL_ARG),
    ("services/quiz_service.py", "_save_course_section_result", "qid"): (1, "qid from the stored answer key"),
    ("services/quiz_service.py", "_save_course_section_result", "section"): (4, LITERAL_ARG),
    ("services/quiz_service.py", "course_verdict", "expected_graded"): (1, SERVER_NUMBER),
    ("services/quiz_service.py", "course_verdict", "missing"): (1, SERVER_NUMBER),
    ("services/quiz_service.py", "submit_course_writing", "str(answers.get(q['qid']) or '')"): (2, "lists stored qids; str() only feeds the emptiness/length filter"),
    ("services/rate_limit.py", "enforce_exercise_rate_limit", "daily_limit; exercise_type"): (1, SERVER_NUMBER + "; exercise_type is a literal at every caller"),
    ("services/rate_limit.py", "enforce_flashcard_rate_limit", "daily_limit"): (1, SERVER_NUMBER),
    ("services/rate_limit.py", "enforce_grading_rate_limit", "daily_limit"): (1, SERVER_NUMBER),
    ("services/student_service.py", "bulk_import_students", "sorted(missing)"): (1, "subset of the constant _CSV_REQUIRED_COLS"),
    ("services/topic_service.py", "create_topic", "skill_area"): (1, VALIDATED + " (in VALID_SKILL_AREAS; the refusing branch clips)"),
    ("services/topic_service.py", "delete_topic", "n_cards; n_banks"): (1, SERVER_NUMBER),
}

def _is_count(node: ast.AST) -> bool:
    """`len(x)` or arithmetic on it with numeric constants: an int, never text."""
    if isinstance(node, ast.Call):
        return isinstance(node.func, ast.Name) and node.func.id == "len"
    if isinstance(node, ast.Constant):
        return isinstance(node.value, (int, float)) and not isinstance(node.value, bool)
    if isinstance(node, ast.BinOp):
        return _is_count(node.left) and _is_count(node.right)
    return False


def _keep(node: ast.AST) -> str | None:
    """The interpolated expression as text, or None when it is safe by shape."""
    if isinstance(node, ast.Call) and ast.unparse(node.func).split(".")[-1] in SAFE_CALLS:
        return None
    if _is_count(node):
        return None
    text = ast.unparse(node)
    if re.fullmatch(r"[A-Z_][A-Z0-9_]*", text) or text.startswith(("sorted(_", "sorted(VALID")):
        return None
    return text


def _interpolated(js: ast.JoinedStr) -> list[str]:
    names = []
    for value in js.values:
        if isinstance(value, ast.FormattedValue):
            text = _keep(value.value)
            if text is not None:
                names.append(text)
    return names


def _walk_unsafe(node: ast.AST):
    """`ast.walk`, without descending into a SAFE_CALLS call."""
    todo = deque([node])
    while todo:
        current = todo.popleft()
        if isinstance(current, ast.Call) and \
                ast.unparse(current.func).split(".")[-1] in SAFE_CALLS:
            continue
        yield current
        todo.extend(ast.iter_child_nodes(current))


def _message_names(arg: ast.AST) -> list[str]:
    """Client-visible values interpolated anywhere in one argument: f-strings,
    ``str()``/``repr()``, ``"…".format(…)`` and ``"…" % …``."""
    names: list[str] = []
    for sub in _walk_unsafe(arg):
        if isinstance(sub, ast.JoinedStr):
            names += _interpolated(sub)
        elif isinstance(sub, ast.Call) and ast.unparse(sub.func) in ("str", "repr") and sub.args:
            names.append(ast.unparse(sub))
        elif (isinstance(sub, ast.Call) and isinstance(sub.func, ast.Attribute)
              and sub.func.attr == "format" and isinstance(sub.func.value, ast.Constant)
              and isinstance(sub.func.value.value, str)):
            for value in list(sub.args) + [k.value for k in sub.keywords]:
                text = _keep(value)
                if text is not None:
                    names.append(text)
        elif (isinstance(sub, ast.BinOp) and isinstance(sub.op, ast.Mod)
              and isinstance(sub.left, ast.Constant) and isinstance(sub.left.value, str)):
            values = sub.right.elts if isinstance(sub.right, ast.Tuple) else [sub.right]
            for value in values:
                text = _keep(value)
                if text is not None:
                    names.append(text)
    return names


def _status(node: ast.AST | None):
    """An int status, or "dynamic" when it is not a literal (``exc.status_code``)
    — a dynamic status is scanned as a 4xx. ``status.HTTP_422_…`` resolves."""
    if node is None:
        return "dynamic"
    if isinstance(node, ast.Constant):
        return node.value
    match = re.search(r"HTTP_(\d{3})", ast.unparse(node))
    return int(match.group(1)) if match else "dynamic"


def _is_4xx(status) -> bool:
    return status == "dynamic" or (isinstance(status, int) and 400 <= status < 500)


def _message_args(call: ast.Call, owner: ast.AST | None) -> list[ast.AST]:
    """The call's arguments plus, one level deep, the value of any local name
    passed as an argument (``msg = f"…"; raise HTTPException(422, msg)``)."""
    args = list(call.args) + [k.value for k in call.keywords]
    direct = list(args)
    for arg in args:
        if isinstance(arg, ast.Dict):
            direct += [v for v in arg.values if v is not None]
    local = {a.id for a in direct if isinstance(a, ast.Name)}
    if local and owner is not None:
        for node in ast.walk(owner):
            if isinstance(node, ast.Assign) and any(
                    isinstance(t, ast.Name) and t.id in local for t in node.targets):
                args.append(node.value)
    return args


def _sites():
    """Every client-facing 4xx message that interpolates a value:
    (group, path, enclosing function, expression). Group A = exception text or
    a raw request object; group B = any other interpolated value."""
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "scripts/")) or "/tests/" in rel or "venv/" in rel:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        for node in ast.walk(tree):
            if isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call):
                call = node.exc
                func = ast.unparse(call.func)
                if func.endswith("HTTPException"):
                    keywords = {k.arg: k.value for k in call.keywords}
                    if not _is_4xx(_status(keywords.get("status_code", call.args[0] if call.args else None))):
                        continue
                elif func in ("ValueError", "TypeError", "PydanticCustomError"):
                    if rel.startswith("services/"):
                        continue  # internal; reaches a client only via a router str() site
                else:
                    continue
            elif isinstance(node, ast.Call) and ast.unparse(node.func).endswith("JSONResponse"):
                call = node
                keywords = {k.arg: k.value for k in call.keywords}
                status_node = keywords.get("status_code", call.args[1] if len(call.args) > 1 else None)
                if status_node is None or not _is_4xx(_status(status_node)):
                    continue  # default 200
            else:
                continue
            owner = node
            bound: set[str] = set()
            while owner in parents and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parents[owner]
                if isinstance(owner, ast.ExceptHandler) and owner.name:
                    bound.add(owner.name)
            func_node = owner if isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)) else None
            names: list[str] = []
            for arg in _message_args(call, func_node):
                names += _message_names(arg)
            if not names:
                continue
            expr = "; ".join(dict.fromkeys(names))
            exc_bound = any(re.search(rf"\b{re.escape(name)}\b", expr) for name in bound)
            group = "A" if A_PATTERN.search(expr) or exc_bound else "B"
            yield group, rel, func_node.name if func_node else "<module>", expr


def scan() -> Counter:
    return Counter(tuple(key) for group, *key in _sites() if group == "A")


def scan_b() -> Counter:
    return Counter(tuple(key) for group, *key in _sites() if group == "B")


def _unexpected(found: Counter, allowed: dict) -> dict:
    return {key: count for key, count in found.items()
            if count > allowed.get(key, (0, ""))[0]}


def test_no_unreviewed_raw_input_echo():
    unexpected = _unexpected(scan(), ALLOWED)
    assert not unexpected, (
        "New 4xx/ValueError message echoes raw input or exception text. Use "
        "services.errors.clip_user_value(s) / summarize_validation_error / "
        f"describe_parse_error, or allowlist it with a reason: {unexpected}"
    )


def test_no_unreviewed_group_b_value_in_messages():
    unexpected = _unexpected(scan_b(), ALLOWED_B)
    assert not unexpected, (
        "New 4xx/ValueError message interpolates a value. If it can come from "
        "the request, wrap it in services.errors.clip_user_value(s); otherwise "
        f"add it to ALLOWED_B with the reason it is not request text: {unexpected}"
    )


def test_allowlist_has_no_stale_entries():
    for found, allowed in ((scan(), ALLOWED), (scan_b(), ALLOWED_B)):
        stale = {key: count for key, (count, _) in allowed.items() if found.get(key, 0) != count}
        assert not stale, f"Allowlist out of date (site removed or count changed): {stale}"
        assert all(reason.strip() for _, reason in allowed.values())


def _scan_probe(tmp_path, source: str) -> tuple[Counter, Counter]:
    routers = tmp_path / "routers"
    routers.mkdir(exist_ok=True)
    (routers / "probe.py").write_text(source, encoding="utf-8")
    globals()["BACKEND"] = tmp_path
    try:
        return scan(), scan_b()
    finally:
        globals()["BACKEND"] = Path(__file__).resolve().parents[1]


def test_scan_catches_a_raw_echo_and_accepts_a_clipped_one(tmp_path):
    # Control for the scanner itself.
    found, _ = _scan_probe(tmp_path,
        "def bad(body):\n"
        "    raise HTTPException(422, f'nope {body.name!r}')\n"
        "def parse(exc):\n"
        "    raise HTTPException(400, str(exc))\n"
        "def ok(body):\n"
        "    raise HTTPException(422, f'nope {clip_user_value(body.name)!r}')\n"
        "def server():\n"
        "    raise HTTPException(500, f'x {exc}')\n",
    )
    assert found == Counter({
        ("routers/probe.py", "bad", "body.name"): 1,
        ("routers/probe.py", "parse", "str(exc)"): 1,
    })


def test_scan_closes_the_f5_holes(tmp_path):
    # PC-J226 F5: any `except … as <name>` name is group A, a non-literal or
    # `status.HTTP_4xx` status counts as 4xx, JSONResponse(4xx) and messages
    # built into a local, with .format or % are scanned.
    found, found_b = _scan_probe(tmp_path,
        "def ve_raw(body):\n"
        "    try:\n"
        "        parse(body)\n"
        "    except ValueError as ve:\n"
        "        raise HTTPException(422, str(ve))\n"
        "def ve_clipped(body):\n"
        "    try:\n"
        "        parse(body)\n"
        "    except ValueError as ve:\n"
        "        raise HTTPException(422, clip_user_value(str(ve)))\n"
        "def ve_summary(body):\n"
        "    try:\n"
        "        parse(body)\n"
        "    except ValidationError as ve:\n"
        "        raise HTTPException(422, summarize_validation_error(ve))\n"
        "def dynamic(slug):\n"
        "    try:\n"
        "        load(slug)\n"
        "    except LoadError as problem:\n"
        "        raise HTTPException(problem.status_code, f'{problem}')\n"
        "def named_5xx(slug):\n"
        "    raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f'{slug}')\n"
        "def json_4xx(x):\n"
        "    return JSONResponse(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, content={'detail': f'{x}'})\n"
        "def json_200(x):\n"
        "    return JSONResponse(content={'detail': f'{x}'})\n"
        "def prebuilt(slug):\n"
        "    msg = f'no {slug}'\n"
        "    raise HTTPException(404, msg)\n"
        "def formatted(slug):\n"
        "    raise HTTPException(404, 'no {}'.format(slug))\n"
        "def percent(slug, kind):\n"
        "    raise HTTPException(404, 'no %s/%s' % (kind, slug))\n"
        "def counted(items):\n"
        "    raise HTTPException(422, f'{len(items)} items, max {len(items) // 2}')\n",
    )
    assert found == Counter({
        ("routers/probe.py", "ve_raw", "str(ve)"): 1,
        ("routers/probe.py", "dynamic", "problem"): 1,
    })
    assert found_b == Counter({
        ("routers/probe.py", "json_4xx", "x"): 1,
        ("routers/probe.py", "prebuilt", "slug"): 1,
        ("routers/probe.py", "formatted", "slug"): 1,
        ("routers/probe.py", "percent", "kind; slug"): 1,
    })
    assert _unexpected(found, {}) and _unexpected(found_b, {})


def test_group_b_guard_fails_raw_passes_clipped_and_allowlisted(tmp_path):
    # PC-J226: a new group-B site fails; clip_user_value(s) or an allowlist
    # entry (path + function + expression, no line number) makes it pass.
    _, raw = _scan_probe(tmp_path,
        "def get_article(slug: str):\n"
        "    raise HTTPException(404, f'Article {slug!r} not found')\n"
        "def finalize(ids):\n"
        "    raise HTTPException(404, f'missing: {ids}')\n",
    )
    assert _unexpected(raw, ALLOWED_B) == {
        ("routers/probe.py", "get_article", "slug"): 1,
        ("routers/probe.py", "finalize", "ids"): 1,
    }
    _, clipped = _scan_probe(tmp_path,
        "def get_article(slug: str):\n"
        "    raise HTTPException(404, f'Article {clip_user_value(slug)!r} not found')\n"
        "def finalize(ids):\n"
        "    raise HTTPException(404, f'missing: {clip_user_values(ids)}')\n",
    )
    assert clipped == Counter()
    allowed = {("routers/probe.py", "get_article", "slug"): (1, "probe"),
               ("routers/probe.py", "finalize", "ids"): (1, "probe")}
    assert _unexpected(raw, allowed) == {}
