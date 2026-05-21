"""Tests for Sprint 13.4.2 — services/listening_convert.py markdown parser.

Andy's authoring workflow switched from DOCX → Markdown 2026-05-21.
These tests pin the new parser against synthetic fixtures that mirror
Andy's canonical Pilot 01 format element-for-element. When Andy drops
the real ILR_LIS_001 fixtures into the repo, swap the synthetic
fixtures for them (the test surface is small enough that no rewrite is
required — just replace the string literals).

Schema invariant — the output of ``parse_from_text`` matches the
Sprint 13.4 ConvertResult shape so the convert/commit endpoint is
unchanged downstream.
"""

from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from services import listening_convert as lc


# ── Synthetic Pilot 01 fixtures ────────────────────────────────────────────


QUESTION_PAPER_MD = """\
# IELTS LISTENING — ILR-LIS-001

**Test title:** IELTS Listening Pilot Test 01
**Target band:** 5.5
**Time allowed:** approximately 30 minutes
**Total questions:** 40

---

## INSTRUCTIONS TO CANDIDATES
Read each question carefully before answering.

## INFORMATION FOR CANDIDATES
You will hear the recording once.

---

## SECTION 1

### Questions 1-6

> Complete the form below.
> Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.

#### RIVERSIDE COOKERY SCHOOL — ENROLMENT FORM

- Name: _Daniel Brennan (Example)_
- Street address: _27 Hartfield Road (Example)_
- City: **1** ___________
- Postcode: **2** ___________
- Mobile number: **3** ___________
- Course level: **4** ___________
- Class day: **5** ___________
- Cost (with early-bird discount): £ **6** ___________


### Questions 7-8

> Complete the table below.
> Write ONE WORD ONLY for each answer.

#### 8-WEEK BEGINNER COURSE CONTENT

| Week | Topic |
|---|---|
| Week 1 | Knife skills |
| Week 3 | 7 …………………………………… |
| Week 5 | 8 …………………………………… |


### Questions 9-10

> Answer the questions below.
> Write ONE WORD OR A NUMBER for each answer.

**9.** What is provided by the school free of charge? ___________

**10.** How many students are in each class at maximum? ___________


---

## SECTION 2

### Questions 11-15

> Choose the correct letter, A, B or C.

**11.** The community sports centre was expanded to include:
   - **A** more gym equipment.
   - **B** community programmes.
   - **C** a larger swimming pool.

**12.** What surprised most members about the new café?
   - **A** the pricing.
   - **B** the menu choice.
   - **C** the opening hours.

**13.** Members are encouraged to:
   - **A** book ahead.
   - **B** invite friends.
   - **C** wear new uniforms.

**14.** The crèche is open:
   - **A** weekdays only.
   - **B** weekends only.
   - **C** every day.

**15.** Lockers cost:
   - **A** £1 per visit.
   - **B** £2 per visit.
   - **C** £5 per month.


### Questions 16-20

> Label the plan below.
> Write the correct letter, A-H, next to questions 16-20.

> **Map description:** Floor plan with entrance at south. Reception (F) in centre front. Café (C) to the left of reception; lockers (A) behind the café; changing rooms (D) east of reception; pool (G) to the north; crèche (B) at the north-east corner; gym (E) at the north-west; staff room (H) behind reception.

**Label the locations on the map:**
**16.** Café ___________
**17.** Changing rooms ___________
**18.** Gym ___________
**19.** Pool ___________
**20.** Crèche ___________


---

## SECTION 3

### Questions 21-26

> Choose the correct letter, A, B or C.

**21.** The group's project deadline is:
   - **A** Friday.
   - **B** next Monday.
   - **C** in two weeks.

**22.** Sarah will lead the:
   - **A** survey design.
   - **B** literature review.
   - **C** data analysis.

**23.** The team agreed to meet:
   - **A** twice a week.
   - **B** once a week.
   - **C** as needed.

**24.** Tom is concerned about:
   - **A** the budget.
   - **B** the schedule.
   - **C** the sample size.

**25.** The supervisor recommended:
   - **A** narrowing the scope.
   - **B** adding a control group.
   - **C** changing the topic.

**26.** Results will be presented in:
   - **A** a poster.
   - **B** a video.
   - **C** a seminar.


### Questions 27-30

> Complete the sentences below.
> Write NO MORE THAN TWO WORDS for each answer.

**27.** The interviews will be conducted in **27** ___________.
**28.** Each interview should last **28** ___________ minutes.
**29.** Participants will receive **29** ___________ as compensation.
**30.** The pilot survey starts on **30** ___________.


---

## SECTION 4

### Questions 31-34

> Complete the notes below.
> Write ONE WORD ONLY for each answer.

#### LECTURE — HISTORY OF PUBLIC LIGHTING

- First gas lights installed in **31** ___________.
- Whale oil was used in the early **32** ___________.
- Electric arc lamps appeared in **33** ___________.
- LED street lights became common after **34** ___________.


### Questions 35-37

> Complete the sentences below.
> Write NO MORE THAN TWO WORDS for each answer.

**35.** A major drawback of arc lamps was their **35** ___________.
**36.** Modern street lights reduce energy use by **36** ___________.
**37.** Light pollution most affects **37** ___________.


### Questions 38-40

> Complete the summary below.
> Write ONE WORD ONLY for each answer.

Public lighting evolved from oil to gas to electricity. Today, smart
**38** ___________ allow dimming on demand, while sensors detect
**39** ___________ in real time. Cities increasingly favour systems
that minimise environmental **40** ___________.
"""


SCRIPT_ANSWERKEY_MD = """\
# IELTS LISTENING — ILR-LIS-001 — Script & Answer Key

**Test title:** IELTS Listening Pilot Test 01
**Target band:** 5.5
**Accent profile:** BrE, AusE
**Total words:** 2763

## Topic Distribution

| Section | Topic |
|---|---|
| S1 | Cookery class enrolment |
| S2 | Community sports centre orientation |
| S3 | Group project task allocation discussion |
| S4 | Lecture on the history of public lighting systems |

---

## PART A — AUDIO TRANSCRIPT

### SECTION 1 (S1)

**Context:** Phone enquiry about cookery class enrolment
**Register:** polite-transactional
**Word count:** 708

**Speakers:**
- `S1_F1` — Helen (Course coordinator); voice: `[F-BrE-30s-professional]`
- `S1_M1` — Daniel (Customer); voice: `[M-AusE-30s]`

**Audio intro (narrator):**

> You will hear a phone conversation between a man enquiring about cookery classes and the centre coordinator. First, you have some time to look at questions 1 to 6. [pause:30s] Now listen carefully and answer questions 1 to 6.

**Transcript:**

**[F-BrE-30s-professional]**
[emotion:polite] Good afternoon, Riverside Cookery School. Helen speaking.

**[M-AusE-30s]**
[emotion:casual] Oh hi, um, my name's Daniel and I'd like to ask about enrolling. (Q1) I live in Brighton.


### SECTION 2 (S2)

**Context:** Community sports centre orientation talk
**Register:** semi-formal
**Word count:** 680

**Speakers:**
- `S2_M1` — Steve (Centre manager); voice: `[M-BrE-40s-friendly]`

**Audio intro (narrator):**

> You will hear a talk by the manager of a community sports centre.

**Transcript:**

**[M-BrE-40s-friendly]**
Welcome everyone to the centre. (Q11) We've recently added community programmes to our offering.


### SECTION 3 (S3)

**Context:** Three students discussing a project
**Register:** academic-casual
**Word count:** 750

**Speakers:**
- `S3_F1` — Sarah (Student lead); voice: `[F-BrE-20s]`
- `S3_M1` — Tom (Student); voice: `[M-BrE-20s]`

**Audio intro (narrator):**

> You will hear three students discussing a research project.

**Transcript:**

**[F-BrE-20s]**
So the deadline is (Q21) Friday — let's allocate tasks.


### SECTION 4 (S4)

**Context:** University lecture on public lighting history
**Register:** academic
**Word count:** 625

**Speakers:**
- `S4_M1` — Professor Adams; voice: `[M-BrE-50s-academic]`

**Audio intro (narrator):**

> You will hear part of a lecture on the history of public lighting systems.

**Transcript:**

**[M-BrE-50s-academic]**
Public lighting began in (Q31) London in the early gas era.

---

## PART B — ANSWER KEY & MARKING GUIDE

**Marking guide:**
- UK and US spellings both accepted
- Hyphenated words count as one word
- Contractions NOT accepted

### SECTION 1 — Answer Key

| Q# | Answer | Notes | Trap mechanisms |
|---|---|---|---|
| 1 | **Brighton** | City name | paraphrase_t0 |
| 2 | **BN1 6QR** | Self-correction trap; first heard 6QP | self_correction |
| 3 | **07700 900345** | Number sequence | number_sequence |
| 4 | **beginner** | Course level | distractor_synonym |
| 5 | **Tuesday** | Day of week | day_confusion |
| 6 | **95** | Price after discount | math_inference |
| 7 | **sauces** | Week 3 topic | paraphrase_t0 |
| 8 | **pasta** | Week 5 topic | paraphrase_t0 |
| 9 | **apron** | Free items | item_recall |
| 10 | **12** | Class size | number_recall |

### SECTION 2 — Answer Key

| Q# | Answer | Notes | Trap mechanisms |
|---|---|---|---|
| 11 | **B** | community programmes | distractor_in_A |
| 12 | **B** | menu choice | paraphrase_t0 |
| 13 | **A** | book ahead | distractor_synonym |
| 14 | **C** | every day | day_confusion |
| 15 | **A** | £1 per visit | price_distractor |
| 16 | **C** | Café | spatial_relation |
| 17 | **D** | Changing rooms | spatial_relation |
| 18 | **E** | Gym | spatial_relation |
| 19 | **G** | Pool | spatial_relation |
| 20 | **B** | Crèche | spatial_relation |

### SECTION 3 — Answer Key

| Q# | Answer | Notes | Trap mechanisms |
|---|---|---|---|
| 21 | **A** | Friday | day_confusion |
| 22 | **B** | literature review | task_assignment |
| 23 | **B** | once a week | frequency_distractor |
| 24 | **C** | sample size | concern_attribution |
| 25 | **A** | narrow scope | advice_synonym |
| 26 | **C** | seminar | medium_distractor |
| 27 | **library** | Place | place_distractor |
| 28 | **30 / thirty** | Duration | number_alternative |
| 29 | **vouchers** | Compensation | item_recall |
| 30 | **Monday** | Date | day_confusion |

### SECTION 4 — Answer Key

| Q# | Answer | Notes | Trap mechanisms |
|---|---|---|---|
| 31 | **London** | First gas lights | paraphrase_t0 |
| 32 | **1800s** | Whale oil era | date_distractor |
| 33 | **1870s** | Electric arc lamps | date_distractor |
| 34 | **2010** | LED adoption | date_distractor |
| 35 | **brightness** | Arc lamp drawback | attribute_recall |
| 36 | **40 percent** | Energy reduction | number_alternative |
| 37 | **wildlife** | Light pollution impact | category_recall |
| 38 | **sensors** | Smart systems | concept_distractor |
| 39 | **motion** | Sensor target | concept_distractor |
| 40 | **impact** | Environmental concern | category_recall |

### Trap mechanism distribution

| Mechanism | Count |
|---|---|
| paraphrase_t0 | 4 |
| day_confusion | 3 |
"""


# ── Marker stripping ───────────────────────────────────────────────────────


def test_strip_bold_speaker_tag_removed():
    raw = "**[F-BrE-30s-professional]**\n[emotion:polite] Hello there."
    clean = lc.strip_markers(raw)
    assert "[F-" not in clean
    assert "Hello there." in clean
    assert "[emotion:" not in clean


def test_strip_delivery_cues_and_flags():
    raw = "Welcome [pace:slow] to [pause:2s] [hesitate] the centre [breath]."
    clean = lc.strip_markers(raw)
    for marker in ("[pace", "[pause", "[hesitate", "[breath"):
        assert marker not in clean


def test_strip_question_markers():
    raw = "I live in Brighton (Q1) and the postcode is BN1 (Q2)."
    clean = lc.strip_markers(raw)
    assert "(Q1)" not in clean
    assert "(Q2)" not in clean
    assert "Brighton" in clean


# ── Test metadata ──────────────────────────────────────────────────────────


def test_parse_test_metadata_from_h1_and_bold_prefix():
    meta = lc.parse_test_metadata(QUESTION_PAPER_MD, SCRIPT_ANSWERKEY_MD)
    assert meta["test_id"]   == "ILR-LIS-001"
    assert meta["title"]     == "IELTS Listening Pilot Test 01"
    assert meta["band_target"] == 5.5
    assert meta["total_questions"] == 40
    assert meta["total_words"] == 2763
    assert meta["accent_profile"] == ["BrE", "AusE"]
    assert meta["source_format"] == "cambridge_ielts_markdown"


def test_parse_topic_distribution_table():
    themes = lc.parse_topic_distribution(SCRIPT_ANSWERKEY_MD)
    assert themes["s1"].startswith("Cookery")
    assert themes["s2"].startswith("Community")
    assert themes["s4"].startswith("Lecture")


# ── Section splitters ──────────────────────────────────────────────────────


def test_split_qp_sections_returns_4_blocks():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    assert set(sections.keys()) == {1, 2, 3, 4}
    assert "RIVERSIDE COOKERY" in sections[1]
    assert "Label the plan" in sections[2]


def test_split_script_sections_excludes_part_b():
    sections = lc.split_script_sections(SCRIPT_ANSWERKEY_MD)
    assert set(sections.keys()) == {1, 2, 3, 4}
    # PART B answer-key tables must NOT bleed into section 4 transcript.
    assert "Answer Key" not in sections[4]
    assert "London" in sections[4]


# ── Speakers + section metadata + narrator ────────────────────────────────


def test_parse_section_speakers_with_backtick_ids():
    sections = lc.split_script_sections(SCRIPT_ANSWERKEY_MD)
    speakers = lc.parse_section_speakers(sections[1])
    assert len(speakers) == 2
    helen = next(s for s in speakers if s["name"] == "Helen")
    daniel = next(s for s in speakers if s["name"] == "Daniel")
    assert helen["id"] == "S1_F1"
    assert helen["role"] == "Course coordinator"
    assert helen["voice_tag"] == "[F-BrE-30s-professional]"
    assert helen["gender"] == "F"
    assert helen["accent"] == "BrE"
    assert daniel["accent"] == "AusE"


def test_parse_section_metadata_extracts_context_register_word_count():
    sections = lc.split_script_sections(SCRIPT_ANSWERKEY_MD)
    meta = lc.parse_section_metadata(sections[1])
    assert meta["context"] == "Phone enquiry about cookery class enrolment"
    assert meta["register"] == "polite-transactional"
    assert meta["word_count"] == 708


def test_parse_narrator_intro_extracts_blockquote():
    sections = lc.split_script_sections(SCRIPT_ANSWERKEY_MD)
    intro = lc.parse_narrator_intro(sections[1])
    assert intro.startswith("You will hear a phone conversation")
    assert "[pause:30s]" in intro              # raw preserved at intro layer


def test_extract_transcript_preserves_markers():
    sections = lc.split_script_sections(SCRIPT_ANSWERKEY_MD)
    raw = lc.extract_transcript(sections[1])
    assert "**[F-BrE-30s-professional]**" in raw
    assert "(Q1)" in raw
    # Cleaned via strip_markers — clean version has none of those.
    clean = lc.strip_markers(raw)
    assert "[F-BrE" not in clean
    assert "(Q1)" not in clean
    assert "Brighton" in clean


# ── Question Paper question blocks ────────────────────────────────────────


def test_parse_question_blocks_section_1_three_blocks():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    assert [b["q_range"] for b in blocks] == [(1, 6), (7, 8), (9, 10)]
    assert blocks[0]["q_type"] == "dictation_gap_fill"
    assert blocks[2]["q_type"] == "dictation_short_answer"


def test_form_bullet_skips_example_and_captures_six_questions():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    form = blocks[0]["questions"]
    q_nums = [q["q_num"] for q in form]
    assert q_nums == [1, 2, 3, 4, 5, 6]
    # The example rows (Daniel Brennan, 27 Hartfield Road) must NOT appear.
    prompts = [q["prompt"] for q in form]
    assert all("Daniel Brennan" not in p for p in prompts)
    assert "City" in prompts[0]
    assert "Mobile number" in prompts[2]


def test_table_cell_gap_captures_q7_q8():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    table = blocks[1]["questions"]
    assert [q["q_num"] for q in table] == [7, 8]
    assert all(q["variant"] == "table_cell" for q in table)


def test_short_answer_q9_q10_captured():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    short = blocks[2]["questions"]
    assert [q["q_num"] for q in short] == [9, 10]
    assert "free of charge" in short[0]["prompt"]


def test_mcq_section_2_captures_5_questions_with_3_options_each():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[2])
    mcq_block = next(b for b in blocks if b["q_range"] == (11, 15))
    assert mcq_block["q_type"] == "mcq_3option"
    q11 = mcq_block["questions"][0]
    assert q11["q_num"] == 11
    assert [opt["letter"] for opt in q11["options"]] == ["A", "B", "C"]
    assert q11["options"][1]["text"].startswith("community programmes")


def test_plan_label_section_2_carries_map_description_and_letter_options():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[2])
    plan = next(b for b in blocks if b["q_range"] == (16, 20))
    assert plan["q_type"] == "mcq_letter_label"
    assert plan["metadata"]["letter_options"] == list("ABCDEFGH")
    assert "Floor plan" in plan["metadata"]["map_description"]
    q_nums = [q["q_num"] for q in plan["questions"]]
    assert q_nums == [16, 17, 18, 19, 20]


def test_summary_completion_section_4_captures_3_gaps():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[4])
    summary = next(b for b in blocks if b["q_range"] == (38, 40))
    assert summary["q_type"] == "dictation_gap_fill"
    q_nums = [q["q_num"] for q in summary["questions"]]
    assert q_nums == [38, 39, 40]


# ── Answer key parse ──────────────────────────────────────────────────────


def test_parse_answer_keys_all_sections_returns_40_total():
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    counts = {n: len(keys[n]) for n in (1, 2, 3, 4)}
    assert counts == {1: 10, 2: 10, 3: 10, 4: 10}


def test_answer_key_strips_bold_wrappers_and_captures_traps():
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    a1 = next(a for a in keys[1] if a["q_num"] == 1)
    assert a1["answer"] == "Brighton"
    assert "paraphrase_t0" in a1["trap_mechanisms"]
    a2 = next(a for a in keys[1] if a["q_num"] == 2)
    assert a2["answer"] == "BN1 6QR"
    assert "self_correction" in a2["trap_mechanisms"]


def test_answer_key_surfaces_alternatives_split_by_slash():
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    a28 = next(a for a in keys[3] if a["q_num"] == 28)
    assert "30" in a28["alternatives"]
    assert "thirty" in a28["alternatives"]


# ── Exercise grouping ─────────────────────────────────────────────────────


def test_build_exercises_one_per_question_block():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    exercises = lc.build_exercises(blocks, keys[1], section_num=1)
    assert len(exercises) == 3                  # 3 H3 blocks in S1
    assert [e["exercise_type"] for e in exercises] == ["dictation", "dictation", "dictation"]
    assert [e["order_num"] for e in exercises] == [1, 2, 3]
    # Block 1 contains Q1-6 answers.
    block_one_answers = exercises[0]["payload"]["answers"]
    assert {a["q_num"] for a in block_one_answers} == {1, 2, 3, 4, 5, 6}


def test_build_exercises_mcq_block_uses_mcq_type():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[2])
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    exercises = lc.build_exercises(blocks, keys[2], section_num=2)
    types = [e["exercise_type"] for e in exercises]
    variants = [e["variant"] for e in exercises]
    assert types == ["mcq", "mcq"]
    assert variants == ["mcq_3option", "mcq_letter_label"]


# ── Accent + CEFR inference ──────────────────────────────────────────────


def test_infer_accent_mono_vs_mixed():
    assert lc.infer_accent_tag([{"accent": "BrE"}]) == "uk_rp"
    assert lc.infer_accent_tag([{"accent": "BrE"}, {"accent": "AusE"}]) == "other"


def test_infer_cefr_levels():
    assert lc.infer_cefr_level(5.5) == "B2"
    assert lc.infer_cefr_level(7.0) == "C1"
    assert lc.infer_cefr_level(None) is None


# ── parse_from_text full round-trip ──────────────────────────────────────


def test_parse_from_text_pilot_01_end_to_end():
    result = lc.parse_from_text(QUESTION_PAPER_MD, SCRIPT_ANSWERKEY_MD)
    assert result["errors"] == []
    assert result["test_metadata"]["test_id"] == "ILR-LIS-001"
    assert len(result["sections"]) == 4

    # 10 questions per section (40 total).
    total_q = sum(len(s["questions"]) for s in result["sections"])
    assert total_q == 40
    # 10 answers per section.
    total_a = sum(len(s["answers"]) for s in result["sections"])
    assert total_a == 40
    # Speakers populated for each section.
    for s in result["sections"]:
        assert s["speakers"], f"section {s['section_num']} missing speakers"
    # Markers stripped from clean transcript; preserved in raw.
    s1 = result["sections"][0]
    assert "[F-BrE" not in s1["transcript_clean"]
    assert "[F-BrE" in s1["transcript_raw"]
    # Themes flow through to titles.
    assert "Cookery" in s1["title"]


def test_parse_from_text_carries_warnings_for_missing_section():
    bad_qp = QUESTION_PAPER_MD.replace("## SECTION 4", "## SECTON 4")  # typo
    result = lc.parse_from_text(bad_qp, SCRIPT_ANSWERKEY_MD)
    assert any("3 sections" in w for w in result["warnings"]) \
        or any("không có question" in w for w in result["warnings"])


def test_parse_from_text_missing_test_id_returns_error():
    bad_qp = QUESTION_PAPER_MD.replace("# IELTS LISTENING — ILR-LIS-001", "# Some other title")
    bad_sa = SCRIPT_ANSWERKEY_MD.replace("ILR-LIS-001", "OTHER")
    bad_sa = bad_sa.replace("# IELTS LISTENING", "# Other")
    result = lc.parse_from_text(bad_qp, bad_sa)
    assert any("Test ID" in e for e in result["errors"])


# ── parse_listening_test bytes entry point ───────────────────────────────


def test_parse_listening_test_decodes_utf8_bytes():
    qp_bytes = QUESTION_PAPER_MD.encode("utf-8")
    sa_bytes = SCRIPT_ANSWERKEY_MD.encode("utf-8")
    result = lc.parse_listening_test(qp_bytes, sa_bytes)
    assert result["test_metadata"]["test_id"] == "ILR-LIS-001"
    assert len(result["sections"]) == 4


# ── section_to_content_payload schema ────────────────────────────────────


def test_section_to_content_payload_placeholder_shape():
    result = lc.parse_from_text(QUESTION_PAPER_MD, SCRIPT_ANSWERKEY_MD)
    s1 = result["sections"][0]
    payload = lc.section_to_content_payload(
        s1, test_id_uuid="test-uuid-abc", test_metadata=result["test_metadata"],
    )
    assert payload["source_type"] == "test_section"
    assert payload["test_id"] == "test-uuid-abc"
    assert payload["section_num"] == 1
    assert payload["audio_storage_path"] is None
    assert payload["audio_duration_seconds"] == 0
    assert payload["audio_size_bytes"] == 0
    assert payload["status"] == "draft"
    assert "ILR-LIS-001" in payload["title"]
    assert payload["transcript"] == s1["transcript_clean"]
    assert "raw_transcript" in payload["metadata"]
    assert "narrator_intro" in payload["metadata"]
    assert "context" in payload["metadata"]
    assert payload["metadata"]["source_format"] == "cambridge_ielts_markdown"


# ── Convert endpoint round-trip (router-level) ───────────────────────────


from routers import listening as listening_router
from tests.test_listening_router import (
    _FakeAdminClient, _patch_admin_auth, _patch_admin_client, _run,
)


def _build_dry_run_envelope() -> dict:
    return lc.parse_from_text(QUESTION_PAPER_MD, SCRIPT_ANSWERKEY_MD)


def test_convert_commit_inserts_test_4_sections_and_exercises(monkeypatch):
    fake = _FakeAdminClient(canned={"listening_tests": []})
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    envelope = _build_dry_run_envelope()
    body = listening_router.ConvertCommitRequest(
        test_metadata=envelope["test_metadata"],
        sections=envelope["sections"],
    )
    out = _run(listening_router.admin_convert_listening_commit(
        body=body, authorization=authz,
    ))

    tables_inserted = [t for t, _ in fake.inserts]
    assert tables_inserted.count("listening_tests") == 1
    assert tables_inserted.count("listening_content") == 4
    # Per Sprint 13.4.2: one exercise row per Question-Paper block.
    # Pilot 01 has 3+2+2+3 = 10 blocks total.
    assert tables_inserted.count("listening_exercises") == 10

    assert out["test_id_external"] == "ILR-LIS-001"
    assert len(out["content_ids"]) == 4
    assert out["exercises_created"] == 10
    assert out["failed_sections"] == []


def test_convert_commit_rejects_duplicate_test_id(monkeypatch):
    fake = _FakeAdminClient(canned={
        "listening_tests": [{"id": "existing-uuid", "test_id": "ILR-LIS-001"}],
    })
    _patch_admin_client(monkeypatch, fake)
    authz = _patch_admin_auth(monkeypatch)

    envelope = _build_dry_run_envelope()
    body = listening_router.ConvertCommitRequest(
        test_metadata=envelope["test_metadata"],
        sections=envelope["sections"],
    )
    with pytest.raises(HTTPException) as excinfo:
        _run(listening_router.admin_convert_listening_commit(
            body=body, authorization=authz,
        ))
    assert excinfo.value.status_code == 422
    assert "đã tồn tại" in str(excinfo.value.detail)


# ── Sprint 13.5.2 — structural context preservation ───────────────────────


def _qp_blocks_for_range(section_text: str, lo: int, hi: int) -> dict:
    return next(
        b for b in lc.parse_question_blocks(section_text)
        if b["q_range"] == (lo, hi)
    )


def test_classify_instruction_returns_tuple_qtype_and_template_kind():
    """Sprint 13.5.2 — _classify_instruction now returns a (q_type,
    template_kind) tuple so the renderer can pick a fine-grained
    layout while grading keeps the coarse q_type semantics.
    """
    assert lc._classify_instruction("Complete the form below.") == (
        "dictation_gap_fill", "form_completion",
    )
    assert lc._classify_instruction("Complete the table below.") == (
        "dictation_gap_fill", "table_completion",
    )
    assert lc._classify_instruction("Complete the notes below.") == (
        "dictation_gap_fill", "notes_completion",
    )
    assert lc._classify_instruction("Complete the sentences below.") == (
        "dictation_gap_fill", "sentence_completion",
    )
    assert lc._classify_instruction("Complete the summary below.") == (
        "dictation_gap_fill", "summary_completion",
    )
    assert lc._classify_instruction("Choose the correct letter, A, B or C.") == (
        "mcq_3option", "mcq_3option",
    )
    assert lc._classify_instruction("Label the plan below.") == (
        "mcq_letter_label", "plan_label",
    )
    assert lc._classify_instruction("Answer the questions.") == (
        "dictation_short_answer", "short_answer",
    )
    assert lc._classify_instruction("Anything random.") == ("unknown", "unknown")


def test_form_template_preserves_labels_examples_and_numbered_gaps():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[1], 1, 6)
    assert block["template_kind"] == "form_completion"
    tmpl = block["template"]
    assert tmpl["heading"] == "RIVERSIDE COOKERY SCHOOL — ENROLMENT FORM"
    rows = tmpl["rows"]
    # Two example rows + six numbered rows = 8 total.
    labels = [r["label"] for r in rows]
    assert "Name" in labels
    assert "City" in labels
    assert "Cost (with early-bird discount)" in labels
    examples = [r for r in rows if "example" in r]
    assert any("Daniel Brennan" in r["example"] for r in examples)
    gaps = {r["q_num"] for r in rows if "q_num" in r}
    assert gaps == {1, 2, 3, 4, 5, 6}
    # The £-prefix row preserves the prefix so the renderer can echo it.
    cost_row = next(r for r in rows if r["label"].startswith("Cost"))
    assert cost_row.get("prefix") in ("£", "")


def test_table_template_extracts_headers_and_gap_cells():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[1], 7, 8)
    assert block["template_kind"] == "table_completion"
    tmpl = block["template"]
    assert tmpl["heading"] == "8-WEEK BEGINNER COURSE CONTENT"
    assert tmpl["headers"] == ["Week", "Topic"]
    rows = tmpl["rows"]
    # Knife skills row, then two rows with gap cells.
    assert ["Week 1", "Knife skills"] in rows
    gap_q_nums = []
    for r in rows:
        for c in r:
            if isinstance(c, dict) and "q_num" in c:
                gap_q_nums.append(c["q_num"])
    assert sorted(gap_q_nums) == [7, 8]


def test_table_template_separator_row_skipped():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[1], 7, 8)
    rows = block["template"]["rows"]
    # The `|---|---|` separator must NOT appear as a data row.
    assert all("---" not in c for r in rows for c in r if isinstance(c, str))


def test_short_answer_template_is_empty_questions_carry_prompts():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[1], 9, 10)
    assert block["template_kind"] == "short_answer"
    assert block["template"] == {}
    prompts = {q["q_num"]: q["prompt"] for q in block["questions"]}
    assert "free of charge" in prompts[9]
    assert "maximum" in prompts[10]


def test_mcq_template_is_empty_options_live_on_questions():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[2], 11, 15)
    assert block["template_kind"] == "mcq_3option"
    assert block["template"] == {}
    q11 = next(q for q in block["questions"] if q["q_num"] == 11)
    assert [o["letter"] for o in q11["options"]] == ["A", "B", "C"]


def test_plan_label_template_is_empty_metadata_carries_context():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[2], 16, 20)
    assert block["template_kind"] == "plan_label"
    assert block["template"] == {}
    assert block["metadata"]["letter_options"] == list("ABCDEFGH")
    assert "Floor plan" in block["metadata"]["map_description"]


def test_sentence_template_captures_prefix_inline_gap_and_suffix():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[3], 27, 30)
    assert block["template_kind"] == "sentence_completion"
    sentences = block["template"]["sentences"]
    by_q = {s["q_num"]: s for s in sentences}
    assert set(by_q) == {27, 28, 29, 30}
    assert "interviews will be conducted in" in by_q[27]["prefix"]
    # Q28 suffix should mention "minutes".
    assert "minutes" in by_q[28]["suffix"]


def test_notes_template_collects_bullet_items_with_gap_metadata():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[4], 31, 34)
    assert block["template_kind"] == "notes_completion"
    tmpl = block["template"]
    assert tmpl["heading"] == "LECTURE — HISTORY OF PUBLIC LIGHTING"
    items = tmpl["groups"][0]["items"]
    by_q = {it["q_num"]: it for it in items if isinstance(it, dict) and "q_num" in it}
    assert set(by_q) == {31, 32, 33, 34}
    assert "First gas lights installed" in by_q[31]["prefix"]
    assert "Whale oil was used" in by_q[32]["prefix"]


def test_summary_template_tokenises_inline_gaps_into_qn_placeholders():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[4], 38, 40)
    assert block["template_kind"] == "summary_completion"
    paragraph = block["template"]["paragraph"]
    assert "{{Q38}}" in paragraph
    assert "{{Q39}}" in paragraph
    assert "{{Q40}}" in paragraph
    # The replacement leaves no stray `**38**` or trailing `____` runs.
    assert "**38**" not in paragraph
    assert "____" not in paragraph
    # The surrounding prose survives.
    assert "smart" in paragraph
    assert "sensors detect" in paragraph


def test_build_exercises_payload_carries_template_kind_and_template():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[1])
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    exercises = lc.build_exercises(blocks, keys[1], section_num=1)
    # Block 1: form, Block 2: table, Block 3: short_answer.
    kinds = [e["payload"]["template_kind"] for e in exercises]
    assert kinds == ["form_completion", "table_completion", "short_answer"]
    form = exercises[0]["payload"]
    assert form["template"]["heading"].startswith("RIVERSIDE COOKERY SCHOOL")
    table = exercises[1]["payload"]
    assert table["template"]["headers"] == ["Week", "Topic"]
    # Short-answer has an empty template — payload should NOT carry a
    # `template` key (build_exercises only writes it when non-empty).
    assert "template" not in exercises[2]["payload"]


def test_build_exercises_section_4_template_kinds_match_layouts():
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    blocks = lc.parse_question_blocks(sections[4])
    keys = lc.parse_answer_keys(SCRIPT_ANSWERKEY_MD)
    exercises = lc.build_exercises(blocks, keys[4], section_num=4)
    kinds = [e["payload"]["template_kind"] for e in exercises]
    assert kinds == [
        "notes_completion",
        "sentence_completion",
        "summary_completion",
    ]


def test_template_kind_unknown_when_instruction_unrecognised():
    fake_section_text = (
        "## SECTION 1\n\n"
        "### Questions 1-2\n\n"
        "> Random instruction that does not match any hint.\n\n"
        "**1.** Foo? ___________\n"
        "**2.** Bar? ___________\n"
    )
    blocks = lc.parse_question_blocks(fake_section_text)
    assert blocks[0]["q_type"] == "unknown"
    assert blocks[0]["template_kind"] == "unknown"
    assert blocks[0]["template"] == {}


def test_form_template_skips_example_rows_from_gap_set():
    """Example rows must NEVER appear in the gap set even if their
    bullets sit between two numbered rows. Sprint 13.5.2 regression
    guard against the "_Daniel Brennan (Example)_" leaking as Q-number.
    """
    sections = lc.split_qp_sections(QUESTION_PAPER_MD)
    block = _qp_blocks_for_range(sections[1], 1, 6)
    rows = block["template"]["rows"]
    examples = [r for r in rows if "example" in r]
    assert len(examples) == 2
    for ex in examples:
        assert "q_num" not in ex


def test_table_template_empty_when_no_table_present():
    """When a `complete the table` instruction is paired with no
    markdown table (parser tolerance), the template returns empty
    headers/rows rather than crashing.
    """
    fake_section_text = (
        "## SECTION 1\n\n"
        "### Questions 7-8\n\n"
        "> Complete the table below.\n\n"
        "(table missing)\n"
    )
    blocks = lc.parse_question_blocks(fake_section_text)
    block = next(b for b in blocks if b["q_range"] == (7, 8))
    assert block["template_kind"] == "table_completion"
    assert block["template"] == {"heading": "", "headers": [], "rows": []}
