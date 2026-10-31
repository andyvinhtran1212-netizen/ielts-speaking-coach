"""PC-J225 guard — no NEW client-facing raise that echoes raw input/exception text.

Same AST sweep as the PC-J225 audit (`PC-J225-echo-sweep-scan.py`, group A):
`raise HTTPException(4xx, …)` anywhere in backend/ (except scripts/tests) and
`raise ValueError/TypeError(…)` outside services/, whose message interpolates
`e`/`exc`/`err`, `str(…)`/`repr(…)`, or `body.`/`payload`/`filename`/`request.`/
`data.get(`. Values passed through `clip_user_value(s)`,
`summarize_validation_error` or `describe_parse_error` are treated as safe.

Every remaining site is listed below with the reason it is kept. A new site
fails this test: clip the value (services/errors.py), drop it, or add it here
with a reason a reviewer can check. A removed site fails too, so the list
cannot go stale.
"""
from __future__ import annotations

import ast
import re
from collections import Counter
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
J213 = "SkillNotInSittingError / wf.ValidationError keys and band/channel values: clipping is PC-J213's (PR #2011) mock_review_workflow change, to be rebased onto clip_user_value(s)"

ALLOWED: dict[tuple[str, str, str], tuple[int, str]] = {
    # path, enclosing function, interpolated expression → (count, reason)
    ("routers/admin.py", "generate_access_codes", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin.py", "generate_and_assign_code", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin.py", "patch_access_code", "str(e)"): (1, "validate_permissions_or_raise: refused values via clip_user_values"),
    ("routers/admin_ai.py", "patch_ai_model_override", "str(exc)"): (1, "OverrideValidationError names allowlisted values only (ai_model_overrides.validate)"),
    ("routers/admin_class_assignments.py", "_pick_chosen_questions", "body.part; want; len(ids)"): (1, TYPED_INT),
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
    ("routers/admin_mock_exams.py", "collect_section", "str(e)"): (2, "section / from_section are regex-validated query params"),
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
    ("routers/admin_writing.py", "extract_essay_file", "str(exc)"): (1, "FileExtractError messages are constants (docx failure names only the exception class)"),
    ("routers/admin_writing_assignments.py", "fan_out_to_cohort", "body.expected_student_count; len(student_ids)"): (1, TYPED_INT),
    ("routers/admin_writing_prompts.py", "update_prompt", "str(e)"): (1, "assert_can_unreserve names DB exam codes only"),
    ("routers/admin_writing_prompts.py", "upload_image", "str(exc)"): (1, "upload_prompt_image: sizes and constants only"),
    ("routers/export.py", "export_session_pdf", "str(exc)"): (1, "session id was already matched by the owner query above (uuid column)"),
    ("routers/instructor.py", "claim_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/instructor.py", "deliver_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/instructor.py", "release_review", "str(e)"): (1, UUID_LOOKUP),
    ("routers/listening.py", "_change_listening_package_status", "str(exc)"): (1, "PackageValidationError from set_package_status: constants"),
    ("routers/listening.py", "_grade_and_save_dictation", "body.segment_idx; len(segments) - 1"): (1, TYPED_INT),
    ("routers/listening.py", "_resolve_attempt_target", "body.mode"): (1, VALIDATED + " (only caller checks body.mode against the 4 modes first)"),
    ("routers/listening.py", "_resolve_attempt_target", "body.mode; exercise_row['exercise_type']"): (1, VALIDATED + " (only caller checks body.mode against the 4 modes first; exercise_type is DB data)"),
    ("routers/listening.py", "admin_edit_exercise_question", "s; e"): (1, TYPED_INT + " (`s`/`e` are float() of the window)"),
    ("routers/listening.py", "admin_upsert_listening_exercise", "str(exc)"): (1, "ResponsePolicyError messages are constants"),
    ("routers/listening.py", "check_listening_practice_answer", "body.q_num"): (1, TYPED_INT),
    ("routers/listening.py", "grade_listening_test_dictation", "body.sentence_idx; len(units)"): (1, TYPED_INT),
    ("routers/listening.py", "start_listening_test_attempt", "str(exc)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/mock_exams.py", "_raise_for", "str(e)"): (4, "MockExamError family: section/code clipped at source, ids after uuid lookup; any other exception gets a generic message"),
    ("routers/reading_student.py", "start_reading_test_attempt", "str(exc)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/sessions.py", "_bind_session_to_mock_if_requested", "exc"): (1, "bind_session_to_sitting errors: constants, DB status, sitting id after uuid lookup"),
    ("routers/sessions.py", "_complete_session_internal", "session_id; e"): (1, "background finalizer only; never reaches a response"),
    ("routers/sessions.py", "_resolve_full_test_attempt_id", "body.part - 1"): (1, TYPED_INT),
    ("routers/sessions.py", "_resolve_full_test_attempt_id", "body.part; body.part - 1"): (1, TYPED_INT),
    ("routers/sessions.py", "create_session", "str(e)"): (2, "class-item gate errors are constants or name server-side task fields"),
    ("routers/vocab_units.py", "admin_set_vocab_pilot_cohort", "str(exc)"): (1, "constant message"),
    ("routers/vocab_units.py", "open_my_vocab_recommendation", "str(exc)"): (1, "constant message"),
    ("routers/vocab_units.py", "resolve_my_vocab_context_links", "str(exc)"): (1, "constant message (limit constant)"),
    ("routers/writing_student.py", "extract_essay_text", "str(exc)"): (1, "FileExtractError messages are constants (docx failure names only the exception class)"),
}


def _interpolated(js: ast.JoinedStr) -> list[str]:
    names = []
    for value in js.values:
        if not isinstance(value, ast.FormattedValue):
            continue
        if isinstance(value.value, ast.Call) and \
                ast.unparse(value.value.func).split(".")[-1] in SAFE_CALLS:
            continue
        text = ast.unparse(value.value)
        if re.fullmatch(r"[A-Z_][A-Z0-9_]*", text) or text.startswith(("sorted(_", "sorted(VALID")):
            continue
        names.append(text)
    return names


def _status(call: ast.Call):
    keywords = {k.arg: k.value for k in call.keywords}
    node = keywords.get("status_code", call.args[0] if call.args else None)
    return node.value if isinstance(node, ast.Constant) else None


def scan() -> Counter:
    found: Counter = Counter()
    for path in sorted(BACKEND.rglob("*.py")):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", "scripts/")) or "/tests/" in rel or "venv/" in rel:
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"))
        parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
        for node in ast.walk(tree):
            if not isinstance(node, ast.Raise) or not isinstance(node.exc, ast.Call):
                continue
            func = ast.unparse(node.exc.func)
            if func.endswith("HTTPException"):
                status = _status(node.exc)
                if not (isinstance(status, int) and 400 <= status < 500):
                    continue
            elif func in ("ValueError", "TypeError", "PydanticCustomError"):
                if rel.startswith("services/"):
                    continue  # internal; reaches a client only via a router str() site
            else:
                continue
            names: list[str] = []
            for arg in list(node.exc.args) + [k.value for k in node.exc.keywords]:
                for sub in ast.walk(arg):
                    if isinstance(sub, ast.JoinedStr):
                        names += _interpolated(sub)
                    elif isinstance(sub, ast.Call) and ast.unparse(sub.func) in ("str", "repr") and sub.args:
                        names.append(ast.unparse(sub))
            expr = "; ".join(dict.fromkeys(names))
            if not names or not A_PATTERN.search(expr):
                continue
            owner = node
            while owner in parents and not isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)):
                owner = parents[owner]
            name = owner.name if isinstance(owner, (ast.FunctionDef, ast.AsyncFunctionDef)) else "<module>"
            found[(rel, name, expr)] += 1
    return found


def test_no_unreviewed_raw_input_echo():
    found = scan()
    unexpected = {
        key: count for key, count in found.items()
        if count > ALLOWED.get(key, (0, ""))[0]
    }
    assert not unexpected, (
        "New 4xx/ValueError message echoes raw input or exception text. Use "
        "services.errors.clip_user_value(s) / summarize_validation_error / "
        f"describe_parse_error, or allowlist it with a reason: {unexpected}"
    )


def test_allowlist_has_no_stale_entries():
    found = scan()
    stale = {key: count for key, (count, _) in ALLOWED.items() if found.get(key, 0) != count}
    assert not stale, f"Allowlist out of date (site removed or count changed): {stale}"
    assert all(reason.strip() for _, reason in ALLOWED.values())


def test_scan_catches_a_raw_echo_and_accepts_a_clipped_one(tmp_path):
    # Control for the scanner itself.
    routers = tmp_path / "routers"
    routers.mkdir()
    (routers / "probe.py").write_text(
        "def bad(body):\n"
        "    raise HTTPException(422, f'nope {body.name!r}')\n"
        "def parse(exc):\n"
        "    raise HTTPException(400, str(exc))\n"
        "def ok(body):\n"
        "    raise HTTPException(422, f'nope {clip_user_value(body.name)!r}')\n"
        "def server():\n"
        "    raise HTTPException(500, f'x {exc}')\n",
        encoding="utf-8",
    )
    globals()["BACKEND"] = tmp_path
    try:
        found = scan()
    finally:
        globals()["BACKEND"] = Path(__file__).resolve().parents[1]
    assert found == Counter({
        ("routers/probe.py", "bad", "body.name"): 1,
        ("routers/probe.py", "parse", "str(exc)"): 1,
    })
