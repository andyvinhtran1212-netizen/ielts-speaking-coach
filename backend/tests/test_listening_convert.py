"""Tests for Sprint 13.4 — services/listening_convert.py parser.

Most tests exercise the pure-text + table parsing surface
(``parse_from_text``) so we never depend on real DOCX bytes. A handful
of router-level tests round-trip the convert dry-run + commit flow
against a fake Supabase client.

Marker grammar coverage:
  * speaker tags         [F-BrE-30s-professional]
  * delivery cues        [pace:slow] [pause:2s] [emphasis:word]
  * self-closing flags   [hesitate] [breath] [sigh] [chuckle]
  * question pointers    (Q1) (Q11) ( Q 33 )
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import listening_convert as lc


# ── Marker stripping ────────────────────────────────────────────────────────


def test_strip_speaker_tags_removed():
    raw = "[F-BrE-30s-professional] Hello there [M-AusE-40s-casual] hi."
    clean = lc.strip_markers(raw)
    assert "[F-" not in clean
    assert "[M-" not in clean
    assert "Hello there" in clean
    assert "hi." in clean


def test_strip_delivery_cues_removed():
    raw = "Welcome [pace:slow] to [pause:2s] the [emphasis:exhibition] exhibition."
    clean = lc.strip_markers(raw)
    for marker in ("[pace", "[pause", "[emphasis"):
        assert marker not in clean
    assert "exhibition" in clean


def test_strip_self_closing_flags_removed():
    raw = "Right, [hesitate] um, [breath] let me [sigh] check [chuckle:soft]."
    clean = lc.strip_markers(raw)
    for marker in ("[hesitate", "[breath", "[sigh", "[chuckle"):
        assert marker not in clean


def test_strip_question_markers_removed():
    raw = "The class starts on (Q1) Saturday and costs (Q2) thirty pounds."
    clean = lc.strip_markers(raw)
    assert "(Q1)" not in clean
    assert "(Q2)" not in clean
    assert "Saturday" in clean
    assert "thirty pounds." in clean


def test_strip_preserves_paragraph_breaks():
    raw = "Para one.\n\n[F-BrE-30s] Para two.\n\nPara three."
    clean = lc.strip_markers(raw)
    assert clean.count("\n\n") >= 2          # two blank-line breaks kept


# ── Speakers ───────────────────────────────────────────────────────────────


def test_parse_speakers_dedup_and_struct():
    raw = (
        "[F-BrE-30s-professional] Welcome. "
        "[M-AusE-40s-casual] Yeah, mate. "
        "[F-BrE-30s-professional] Sit down."     # duplicate → de-dup
    )
    speakers = lc.parse_speakers(raw)
    assert len(speakers) == 2
    f = next(s for s in speakers if s["gender"] == "F")
    m = next(s for s in speakers if s["gender"] == "M")
    assert f["accent"] == "BrE"
    assert f["age"] == "30s"
    assert f["register"] == "professional"
    assert m["accent"] == "AusE"
    assert m["register"] == "casual"


def test_parse_speakers_handles_short_tags():
    raw = "[N-BrE] narration only here"
    speakers = lc.parse_speakers(raw)
    assert len(speakers) == 1
    assert speakers[0]["gender"] == "N"
    assert speakers[0]["age"] is None
    assert speakers[0]["register"] is None


# ── Metadata table ─────────────────────────────────────────────────────────


def _metadata_table():
    return [[
        ["Field",          "Value"],
        ["Test ID",        "ILR-LIS-001"],
        ["Version",        "1.0"],
        ["Band Target",    "5.5"],
        ["Themes",         "Section 1: Cookery class enrolment; Section 2: New library tour; "
                           "Section 3: University research project; Section 4: Marine biology lecture"],
        ["Accent Profile", "BrE, AusE"],
        ["Total Words",    "2,150"],
        ["Source",         "cambridge_ielts_docx"],
    ]]


def test_parse_metadata_table_extracts_all_fields():
    meta = lc.parse_metadata_table(_metadata_table())
    assert meta["test_id"] == "ILR-LIS-001"
    assert meta["version"] == "1.0"
    assert meta["band_target"] == 5.5
    assert meta["themes"]["s1"].startswith("Cookery")
    assert meta["themes"]["s4"].startswith("Marine biology")
    assert meta["accent_profile"] == ["BrE", "AusE"]
    assert meta["total_words"] == 2150


def test_parse_metadata_table_resilient_to_extra_tables():
    junk = [["x", "y"], ["1", "2"]]              # decoy
    meta = lc.parse_metadata_table([junk, *_metadata_table()])
    assert meta["test_id"] == "ILR-LIS-001"


# ── Section split ──────────────────────────────────────────────────────────


def _four_sections_text() -> str:
    return (
        "SECTION 1 — Transcript\n"
        "[F-BrE-30s] Welcome to (Q1) the cookery class.\n"
        "\n"
        "SECTION 2 — Transcript\n"
        "[M-BrE-40s] Today's tour starts at (Q11) the library.\n"
        "\n"
        "SECTION 3 — Transcript\n"
        "[F-BrE-20s] Our research focuses on (Q21) coral reefs.\n"
        "\n"
        "SECTION 4 — Transcript\n"
        "[M-BrE-50s-academic] Marine biology (Q31) introduction.\n"
    )


def test_split_sections_returns_four_blocks():
    by_num = lc.split_sections(_four_sections_text())
    assert set(by_num.keys()) == {1, 2, 3, 4}
    assert "cookery class" in by_num[1].lower()
    assert "library" in by_num[2].lower()
    assert "coral reefs" in by_num[3].lower()


# ── Question Paper parse ───────────────────────────────────────────────────


def test_parse_question_paper_dictation_gap_fill():
    qp = (
        "Section 1\n"
        "Complete the form below.\n"
        "Write NO MORE THAN TWO WORDS for each answer.\n"
        "Daniel Brennan (Example)\n"
        "1 ………………… Saturday\n"
        "2 ………………… thirty pounds\n"
    )
    by_section = lc.parse_question_paper(qp)
    assert len(by_section[1]) == 2
    assert by_section[1][0]["q_num"] == 1
    assert by_section[1][0]["q_type"] == "dictation_gap_fill"


def test_parse_question_paper_mcq_options_captured():
    qp = (
        "Section 2\n"
        "Choose the correct letter, A, B or C.\n"
        "11 What time does the tour start?\n"
        "A. 9:00\n"
        "B. 10:00\n"
        "C. 11:00\n"
    )
    by_section = lc.parse_question_paper(qp)
    assert by_section[2][0]["q_type"] == "mcq_3option"
    assert [opt["letter"] for opt in by_section[2][0]["options"]] == ["A", "B", "C"]


def test_parse_question_paper_plan_label_8_options():
    qp = (
        "Section 2\n"
        "Label the plan, A-H.\n"
        "16 entrance\n"
        "17 lifts\n"
        "A. north wing\n"
        "B. south wing\n"
        "C. east wing\n"
        "D. west wing\n"
        "E. café\n"
        "F. cloakroom\n"
        "G. main hall\n"
        "H. exit\n"
    )
    by_section = lc.parse_question_paper(qp)
    assert by_section[2][0]["q_type"] == "mcq_letter_label"
    # Plan-label exercises share the same option set across questions —
    # in the parsed structure the options attach to whichever question
    # they followed (admin can fan out in the UI). Pin >=4 options.
    last = by_section[2][-1]
    assert len(last.get("options", [])) >= 4
    letters = {opt["letter"] for opt in last["options"]}
    assert {"A", "B", "C", "D"} <= letters


def test_parse_question_paper_skips_example_lines():
    qp = (
        "Section 1\n"
        "Complete the notes below.\n"
        "Name: Daniel Brennan (Example)\n"
        "1 …… Saturday\n"
    )
    by_section = lc.parse_question_paper(qp)
    assert all(q["q_num"] != 0 for q in by_section[1])
    # Only Q1 should have been parsed; the (Example) line is dropped.
    assert [q["q_num"] for q in by_section[1]] == [1]


# ── Answer key parse ───────────────────────────────────────────────────────


def _answer_key_tables():
    s1 = [
        ["Question", "Answer", "Trap mechanism"],
        ["1",        "Saturday",        "day confusion"],
        ["2",        "thirty pounds",   "price misread; currency"],
        ["3",        "library",         ""],
    ]
    s2 = [
        ["Q#",       "Answer", "Trap mechanism(s)"],
        ["11",       "B",      "distractor in option A"],
        ["12",       "C",      ""],
    ]
    decoy = [["x", "y"], ["1", "2"]]
    return [decoy, s1, s2]


def test_parse_answer_key_groups_by_section():
    answers = lc.parse_answer_key(_answer_key_tables())
    assert len(answers[1]) == 3
    assert answers[1][0]["q_num"] == 1
    assert answers[1][0]["answer"] == "Saturday"
    assert answers[1][1]["trap_mechanisms"] == ["price misread", "currency"]
    assert answers[2][0]["answer"] == "B"


def test_parse_answer_key_skips_example_rows():
    tables = [[
        ["Question", "Answer",        "Trap"],
        ["",         "Daniel Brennan (Example)", ""],
        ["1",        "Saturday",      ""],
    ]]
    answers = lc.parse_answer_key(tables)
    # The Example row has empty q_cell — skipped. Q1 captured.
    assert [a["q_num"] for a in answers[1]] == [1]


# ── Exercise grouping ─────────────────────────────────────────────────────


def test_build_exercises_groups_consecutive_same_type():
    questions = [
        {"q_num": 1, "prompt": "p1", "q_type": "dictation_gap_fill"},
        {"q_num": 2, "prompt": "p2", "q_type": "dictation_gap_fill"},
        {"q_num": 3, "prompt": "p3", "q_type": "mcq_3option"},
        {"q_num": 4, "prompt": "p4", "q_type": "mcq_3option"},
        {"q_num": 5, "prompt": "p5", "q_type": "dictation_gap_fill"},
    ]
    answers = [{"q_num": i, "answer": str(i), "trap_mechanisms": []} for i in range(1, 6)]
    exercises = lc.build_exercises(questions, answers, section_num=2)
    assert len(exercises) == 3                  # gap-fill / mcq / gap-fill
    assert exercises[0]["exercise_type"] == "dictation"
    assert exercises[1]["exercise_type"] == "mcq"
    assert exercises[2]["exercise_type"] == "dictation"
    # Order numbers run 1..N
    assert [e["order_num"] for e in exercises] == [1, 2, 3]
    # Answers carried into the payload, joined by q_num.
    assert exercises[0]["payload"]["answers"][0]["answer"] == "1"


def test_build_exercises_empty_returns_empty():
    assert lc.build_exercises([], [], section_num=1) == []


# ── Accent + CEFR inference ──────────────────────────────────────────────


def test_infer_accent_mono_maps_to_tag():
    speakers = [{"accent": "BrE"}, {"accent": "BrE"}]
    assert lc.infer_accent_tag(speakers) == "uk_rp"

    speakers = [{"accent": "AmE"}]
    assert lc.infer_accent_tag(speakers) == "us_general"


def test_infer_accent_mixed_defaults_to_other():
    speakers = [{"accent": "BrE"}, {"accent": "AusE"}]
    assert lc.infer_accent_tag(speakers) == "other"


def test_infer_cefr_from_band():
    assert lc.infer_cefr_level(5.5) == "B2"
    assert lc.infer_cefr_level(5.0) == "B1"
    assert lc.infer_cefr_level(7.0) == "C1"
    assert lc.infer_cefr_level(None) is None


# ── parse_from_text happy path ────────────────────────────────────────────


def test_parse_from_text_returns_4_sections():
    sa_tables = _metadata_table() + _answer_key_tables()
    qp = (
        "Section 1\nComplete the form.\n1 ………… Saturday\n2 ………… thirty pounds\n3 ………… library\n"
        "Section 2\nChoose the correct letter, A, B or C.\n"
        "11 What time?\nA. 9\nB. 10\nC. 11\n"
        "12 What price?\nA. 5\nB. 10\nC. 20\n"
    )
    result = lc.parse_from_text(qp, _four_sections_text(), sa_tables)
    assert result["test_metadata"]["test_id"] == "ILR-LIS-001"
    assert len(result["sections"]) == 4
    s1 = result["sections"][0]
    assert s1["section_num"] == 1
    # Markers stripped from user-facing transcript.
    assert "[F-BrE" not in s1["transcript_clean"]
    # Raw transcript preserves markers.
    assert "[F-BrE" in s1["transcript_raw"]
    # Exercise rows present.
    assert s1["exercises"]
    assert s1["exercises"][0]["exercise_type"] == "dictation"


def test_parse_from_text_records_word_count_drift_warning():
    sa_tables = _metadata_table() + _answer_key_tables()
    # Force a tiny transcript so the parser counts ~few words vs declared 2150
    tiny_script = (
        "SECTION 1 — Transcript\n hello\n"
        "SECTION 2 — Transcript\n hi\n"
        "SECTION 3 — Transcript\n yo\n"
        "SECTION 4 — Transcript\n hey\n"
    )
    result = lc.parse_from_text("Section 1\nComplete the form.", tiny_script, sa_tables)
    assert any("Word count drift" in w for w in result["warnings"])


# ── section_to_content_payload ────────────────────────────────────────────


def test_section_to_content_payload_placeholder_shape():
    sa_tables = _metadata_table() + _answer_key_tables()
    qp = (
        "Section 1\nComplete the form.\n1 ………… Saturday\n"
    )
    result = lc.parse_from_text(qp, _four_sections_text(), sa_tables)
    section = result["sections"][0]
    payload = lc.section_to_content_payload(
        section, test_id_uuid="test-uuid-abc", test_metadata=result["test_metadata"],
    )
    assert payload["source_type"] == "test_section"
    assert payload["test_id"] == "test-uuid-abc"
    assert payload["section_num"] == 1
    assert payload["audio_storage_path"] is None
    assert payload["audio_duration_seconds"] == 0
    assert payload["audio_size_bytes"] == 0
    assert payload["status"] == "draft"
    assert "ILR-LIS-001" in payload["title"]
    assert payload["transcript"] == section["transcript_clean"]
    assert "raw_transcript" in payload["metadata"]
    assert payload["metadata"]["raw_transcript"] == section["transcript_raw"]
    assert "ILR-LIS-001" in payload["topic_tags"]
    assert "section-1" in payload["topic_tags"]


# ── Convert endpoint round-trip (router-level) ────────────────────────────


from routers import listening as listening_router
from tests.test_listening_router import (
    _FakeAdminClient, _patch_admin_auth, _patch_admin_client, _run,
)


def _build_dry_run_envelope() -> dict:
    """Construct a synthetic envelope mimicking parse_from_text output —
    avoids needing real DOCX bytes in the commit test."""
    return {
        "test_metadata": {
            "test_id":           "ILR-LIS-001",
            "version":           "1.0",
            "band_target":       5.5,
            "themes":            {"s1": "Cookery class", "s2": "Library tour",
                                  "s3": "Research project", "s4": "Marine biology"},
            "accent_profile":    ["BrE"],
            "total_words":       2000,
            "source_format":     "cambridge_ielts_docx",
            "created_at_source": "2026-05-20",
        },
        "sections": [
            {
                "section_num": n,
                "title":       f"Section {n}",
                "theme":       f"Section {n}",
                "transcript_raw":   f"[F-BrE-30s] Section {n} body. (Q{n})",
                "transcript_clean": f"Section {n} body.",
                "speakers":         [{"tag": "[F-BrE-30s]", "gender": "F",
                                      "accent": "BrE", "age": "30s", "register": None}],
                "word_count":       50,
                "accent_tag":       "uk_rp",
                "cefr_level":       "B2",
                "ielts_section":    n,
                "questions":        [{"q_num": (n - 1) * 10 + 1, "prompt": "p",
                                      "q_type": "dictation_gap_fill"}],
                "answers":          [{"q_num": (n - 1) * 10 + 1, "answer": "x",
                                      "trap_mechanisms": []}],
                "exercises":        [{
                    "exercise_type": "dictation",
                    "variant":       "dictation_gap_fill",
                    "section_num":   n,
                    "order_num":     1,
                    "payload":       {"variant": "dictation_gap_fill", "questions": [],
                                      "answers": []},
                }],
            }
            for n in range(1, 5)
        ],
    }


def test_convert_commit_inserts_test_4_sections_and_exercises(monkeypatch):
    fake = _FakeAdminClient(canned={"listening_tests": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    envelope = _build_dry_run_envelope()
    body = listening_router.ConvertCommitRequest(**envelope)

    out = _run(listening_router.admin_convert_listening_commit(
        body=body, authorization=authz,
    ))

    # 1 listening_tests + 4 listening_content + 4 listening_exercises = 9 inserts
    tables_inserted = [t for t, _ in fake.inserts]
    assert tables_inserted.count("listening_tests") == 1
    assert tables_inserted.count("listening_content") == 4
    assert tables_inserted.count("listening_exercises") == 4

    assert out["test_id_external"] == "ILR-LIS-001"
    assert len(out["content_ids"]) == 4
    assert out["exercises_created"] == 4
    assert out["failed_sections"] == []


def test_convert_commit_rejects_duplicate_test_id(monkeypatch):
    # Pre-seed an existing test row with the same external test_id.
    fake = _FakeAdminClient(canned={
        "listening_tests": [{"id": "existing-uuid", "test_id": "ILR-LIS-001"}],
    })
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    body = listening_router.ConvertCommitRequest(**_build_dry_run_envelope())
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_convert_listening_commit(
            body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422
    assert "đã tồn tại" in str(excinfo.value.detail)


def test_convert_commit_missing_test_id_returns_422(monkeypatch):
    fake = _FakeAdminClient()
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    envelope = _build_dry_run_envelope()
    envelope["test_metadata"]["test_id"] = ""    # blank → 422
    body = listening_router.ConvertCommitRequest(**envelope)

    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_convert_listening_commit(
            body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422
