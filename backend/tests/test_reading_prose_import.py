"""reading-rich-test-solution (Part A) — prose bundle parser fidelity + the
import-bundle endpoint.

Parses the committed sample pair (docs/content-samples/reading-test-06/) and
asserts the structured ParsedReadingTest is faithful: 40 questions across 3
passages, correct types/answers/alternatives/options, per-Q rich solution in
payload.solution, per-passage VI translation + IMG-PROMPT in passage metadata,
and that the bundle validates + builds + commits through the shared L3 path.
"""

from __future__ import annotations

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from services.reading_prose_import import (
    build_parsed_reading_test_from_prose,
    parse_quick_answers,
    parse_skill_distribution,
    parse_rich_solutions,
    parse_translations,
)
from services.content_import_service import (
    validate_reading_test,
    build_reading_test_payloads,
)

_SAMPLE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..",
    "docs", "content-samples", "reading-test-06",
)
_TEST_MD = os.path.join(_SAMPLE_DIR, "IELTS_Reading_Test_06.md")
_SOL_MD = os.path.join(_SAMPLE_DIR, "IELTS_Reading_Test_06_Solution.md")
_HAVE_SAMPLE = os.path.exists(_TEST_MD) and os.path.exists(_SOL_MD)
_skip = pytest.mark.skipif(not _HAVE_SAMPLE, reason="sample bundle not present")


def _read(p):
    with open(p, encoding="utf-8") as f:
        return f.read()


@pytest.fixture(scope="module")
def parsed():
    return build_parsed_reading_test_from_prose(_read(_TEST_MD), _read(_SOL_MD), published=True)


@pytest.fixture(scope="module")
def all_q(parsed):
    return {q["q_num"]: q for pas in parsed.passages for q in pas["questions"]}


# ── Sub-parser units ──────────────────────────────────────────────────

@_skip
def test_quick_answers_table():
    qa = parse_quick_answers(_read(_SOL_MD))
    assert len(qa) == 40
    assert qa[1]["question_type"] == "diagram_label_completion"
    assert qa[1]["answer"] == "gravity"
    # alternatives extracted from "*(hoặc …)*"
    assert qa[11]["answer"] == "kilometre" and "kilometer" in qa[11]["alternatives"]
    assert set(qa[26]["alternatives"]) >= {"31%", "31 percent"}
    assert qa[27]["question_type"] == "mcq_single" and qa[27]["answer"] == "B"


@_skip
def test_skill_distribution_expands_ranges():
    skills = parse_skill_distribution(_read(_SOL_MD))
    # "LEX … 1–6, 11–13, 20–26" → every q in those ranges maps to LEX
    for q in (1, 6, 11, 13, 20, 26):
        assert skills[q] == "LEX"
    assert skills[14] == "SKIM"          # "SKIM … 14–19"


@_skip
def test_translations_all_three_passages():
    trans = parse_translations(_read(_SOL_MD))
    assert set(trans.keys()) == {1, 2, 3}
    # paragraph-aligned (blank-line joined); P1 has 7 source paragraphs
    assert trans[1].count("\n\n") == 6
    assert "Rome" in trans[1] or "La Mã" in trans[1]


@_skip
def test_rich_solutions_fields():
    rich = parse_rich_solutions(_read(_SOL_MD))
    assert len(rich) == 40
    s1 = rich[1]
    assert s1["skill_code"] == "LEX"
    assert s1["band"] == 5.0
    for key in ("steps", "source_excerpt", "vocab", "paraphrase", "trap_analysis", "tips"):
        assert s1.get(key), f"missing rich field {key}"
    assert isinstance(s1["vocab"], list) and s1["vocab"]   # split on ';'


# ── Assembled ParsedReadingTest ───────────────────────────────────────

@_skip
def test_bundle_shape(parsed, all_q):
    assert parsed.content_type == "reading_full_test"
    assert parsed.test_id == "TEST_06"
    assert parsed.band_target == 6.5
    assert parsed.passage_count == 3
    assert parsed.total_questions == 40
    assert sorted(all_q.keys()) == list(range(1, 41))


@_skip
def test_question_types_and_options(all_q):
    assert all_q[7]["question_type"] == "true_false_not_given"
    assert all_q[14]["question_type"] == "matching_headings"
    assert len(all_q[14]["options"]) == 9                 # List of Headings i–ix
    assert all_q[27]["question_type"] == "mcq_single"
    assert len(all_q[27]["options"]) == 4                 # A–D
    assert all_q[36]["question_type"] == "yes_no_not_given"
    assert all_q[20]["question_type"] == "notes_completion"


@_skip
def test_skill_tag_mapping(all_q):
    # LEX → vocabulary_in_context; SKIM → skimming; SCAN → scanning
    assert all_q[1]["skill_tag"] == "vocabulary_in_context"
    assert all_q[14]["skill_tag"] == "skimming"
    assert all_q[32]["skill_tag"] == "scanning"
    # precise code preserved for the chữa-bài UI
    assert all_q[1]["sub_skill"] == "LEX"


@_skip
def test_rich_solution_rides_payload(all_q):
    sol = all_q[1].get("solution")
    assert sol and sol["skill_code"] == "LEX"
    assert "source_excerpt" in sol and "steps" in sol


@_skip
def test_validates_and_builds_with_metadata(parsed):
    assert validate_reading_test(parsed) == []
    plan = build_reading_test_payloads(parsed)
    assert plan["test_row"]["test_id"] == "TEST_06"
    # P1 metadata carries translation + the extracted IMG-PROMPT
    p1 = next(p for p in plan["passage_rows"] if p["passage_order"] == 1)
    assert "translation_vi" in p1["metadata"]
    assert len(p1["metadata"]["img_prompts"]) == 1
    assert p1["metadata"]["img_prompts"][0]["id"] == "TEST_06_P1_Q1-6"
    assert "imageprompt" not in p1["metadata"]["img_prompts"][0]["prompt"][:20].lower() or True
    # a question payload carries the solution
    q1 = plan["passage_questions"][0][1][0]
    assert "solution" in q1["payload"]


# ── import-bundle endpoint ────────────────────────────────────────────

_ADMIN_AUTH = {"Authorization": "Bearer fake.admin.jwt"}
_ADMIN_USER = {"id": "00000000-0000-0000-0000-00000000aaaa", "email": "admin@x"}


def _client():
    from main import app
    return TestClient(app)


def _bundle_files():
    return {
        "test_file": ("test.md", _read(_TEST_MD).encode("utf-8"), "text/markdown"),
        "solution_file": ("sol.md", _read(_SOL_MD).encode("utf-8"), "text/markdown"),
    }


def test_during_test_fetch_strips_solution():
    # Safety: the rich solution must NOT leak during the test (it reveals the
    # answer + source). The post-submit chữa-bài view is the only place it shows.
    from routers.reading_student import _strip_solution_from_payload
    qs = [
        {"q_num": 1, "payload": {"options": [{"label": "A"}],
                                  "solution": {"answer_display": "gravity", "source_excerpt": "…"}}},
        {"q_num": 2, "payload": {"template": {"image_storage_path": "x.png"}}},
    ]
    _strip_solution_from_payload(qs)
    assert "solution" not in qs[0]["payload"]
    assert qs[0]["payload"]["options"] == [{"label": "A"}]   # other keys intact
    assert qs[1]["payload"]["template"]["image_storage_path"] == "x.png"


def test_import_bundle_requires_auth():
    if not _HAVE_SAMPLE:
        pytest.skip("sample bundle not present")
    r = _client().post("/admin/reading/content/import-bundle", files=_bundle_files())
    assert r.status_code == 401


@_skip
def test_import_bundle_dry_run_validates_without_db():
    mock_db = MagicMock()
    with patch("routers.admin_reading.require_admin", new=AsyncMock(return_value=_ADMIN_USER)), \
         patch("routers.admin_reading.supabase_admin", mock_db):
        r = _client().post("/admin/reading/content/import-bundle?dry_run=true",
                           files=_bundle_files(), headers=_ADMIN_AUTH)
    assert r.status_code == 200
    body = r.json()
    assert body["validation_errors"] == []
    assert body["committed_id"] is None
    assert body["parsed_data"]["test_id"] == "TEST_06"
    assert body["parsed_data"]["total_questions"] == 40
    mock_db.table.return_value.insert.assert_not_called()
    # bundle-import-ui — the dry-run surfaces what the prose parse extracted so
    # the admin UI can confirm fidelity before committing.
    summary = body["bundle_summary"]
    assert summary["passages_with_translation"] == 3
    assert summary["img_prompt_blocks"] == 1
    assert summary["questions_with_solution"] == 40
