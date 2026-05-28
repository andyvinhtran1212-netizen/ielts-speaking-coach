"""Sprint 20.6.5 — Validation regression for reading_content_format_v2.md worked examples.

Locks the spec's accuracy by asserting that every worked example file shipped in
`docs/clusters/20_x/content_examples/` parses + validates clean against the live
importer pipeline. If the importer's accepted shape drifts in a future sprint,
this test catches it — and the spec (which authors and the content-production
agent read) needs to update in lockstep.

We also assert the build step produces the *correct nested DB shape* for at
least one representative question per file. This is the gap the existing seed
tests miss (they stop at parse + validate). The two failure modes documented in
spec §11 — silently-dropped `payload.options:` and double-nested `answer:` —
would both regress here.
"""

from __future__ import annotations

from pathlib import Path

from services.content_import_service import (
    build_reading_question_payloads,
    build_reading_test_payloads,
    parse_reading_passage,
    parse_reading_test,
    validate_reading_passage,
    validate_reading_test,
)


_EXAMPLES_DIR = (
    Path(__file__).parent.parent.parent
    / "docs"
    / "clusters"
    / "20_x"
    / "content_examples"
)


def _read(name: str) -> str:
    path = _EXAMPLES_DIR / name
    assert path.exists(), (
        f"Worked example {name!r} missing from {_EXAMPLES_DIR}. "
        f"reading_content_format_v2.md §7 lists this file as authoritative — "
        f"do not delete it without updating the spec."
    )
    return path.read_text(encoding="utf-8")


# ── L1 worked example ─────────────────────────────────────────────────


def test_l1_example_parses_and_validates_clean():
    p = parse_reading_passage(_read("l1-the-paper-trail-of-money.md"))
    errors = validate_reading_passage(p)
    assert errors == [], f"L1 example has validation errors: {errors}"
    assert p.library == "l1_vocab"
    assert p.questions, "L1 example should ship light comprehension Qs"
    assert p.glossary, "L1 example should ship glossary entries"


def test_l1_example_builds_to_correct_db_shape():
    """The author's flat YAML must round-trip into the nested DB shape the
    grader (`reading_test_grader.collect_answer_key`) consumes. Regression for
    spec §11/F1: dropped `payload.options` and double-nested `answer`."""
    p = parse_reading_passage(_read("l1-the-paper-trail-of-money.md"))
    rows = build_reading_question_payloads(p.questions, "fake-passage-id")

    # Q1 is an mcq_single — payload.options must be populated, answer.answer
    # must be a string (not a nested dict).
    q1 = next(r for r in rows if r["q_num"] == 1)
    assert q1["question_type"] == "mcq_single"
    assert q1["payload"].get("options"), (
        f"Q1 payload.options dropped (spec §11/F1 regression). "
        f"Author probably nested options under payload: in YAML. payload={q1['payload']}"
    )
    assert isinstance(q1["answer"]["answer"], str), (
        f"Q1 answer.answer is not a string (spec §11/F1 regression). "
        f"Author probably wrote answer: as a nested dict. answer={q1['answer']}"
    )


# ── L2 worked example ─────────────────────────────────────────────────


def test_l2_example_parses_and_validates_clean():
    p = parse_reading_passage(_read("l2-scanning-public-transport.md"))
    errors = validate_reading_passage(p)
    assert errors == [], f"L2 example has validation errors: {errors}"
    assert p.library == "l2_skill"
    assert p.skill_focus, "L2 example must declare skill_focus (spec §5)"
    assert p.questions, "L2 example should ship skill-tagged Qs"


def test_l2_example_matching_headings_round_trips():
    """matching_headings is the L2-typical type; verify its options + answer
    survive the parse → build round-trip (same regression class as L1)."""
    p = parse_reading_passage(_read("l2-scanning-public-transport.md"))
    rows = build_reading_question_payloads(p.questions, "fake-passage-id")
    mh = next(r for r in rows if r["question_type"] == "matching_headings")
    assert mh["payload"].get("options"), (
        f"matching_headings payload.options dropped (spec §11/F1 regression)."
    )
    assert isinstance(mh["answer"]["answer"], str), (
        f"matching_headings answer.answer is not a string (spec §11/F1 regression)."
    )


# ── L3 worked example ─────────────────────────────────────────────────


def test_l3_example_parses_and_validates_clean():
    p = parse_reading_test(_read("l3-academic-reading-test-2.md"))
    errors = validate_reading_test(p)
    assert errors == [], f"L3 example has validation errors: {errors}"
    assert p.library == "l3_test"
    assert p.passage_count == 3
    total_qs = sum(len(pas.get("questions") or []) for pas in p.passages)
    assert total_qs == p.total_questions == 40, (
        f"L3 example must ship exactly 40 Qs across 3 passages "
        f"(got total={total_qs}, total_questions={p.total_questions})."
    )


def test_l3_example_qnums_are_unique_and_contiguous_1_to_40():
    """Spec §6.5: q_num must be unique across the whole test. Cambridge
    convention (and the Sprint 20.6 exam UI) expects 1..40 contiguous."""
    p = parse_reading_test(_read("l3-academic-reading-test-2.md"))
    all_qnums: list[int] = []
    for pas in p.passages:
        for q in pas.get("questions") or []:
            all_qnums.append(q["q_num"])
    assert sorted(all_qnums) == list(range(1, 41)), (
        f"L3 example q_nums must be 1..40 contiguous; got {sorted(all_qnums)}"
    )


def test_l3_example_builds_to_correct_db_shape_for_every_passage():
    """Every question in every passage must round-trip cleanly through the
    builder. This is the gap that exists in the Sprint 20.5 seed regression
    (it only tests parse + validate, missing the build step — see spec §11/F1)."""
    p = parse_reading_test(_read("l3-academic-reading-test-2.md"))
    plan = build_reading_test_payloads(p)

    assert plan["test_row"]["test_id"], "test_row must carry test_id"
    assert len(plan["passage_rows"]) == 3
    assert all(pr["library"] == "l3_test" for pr in plan["passage_rows"])

    # Every question must have answer.answer as a string (not a nested dict
    # produced by the v1-spec nested format), and every options-carrying type
    # must have payload.options populated.
    options_types = {"mcq_single", "matching_headings"}
    for slug, q_rows in plan["passage_questions"]:
        for q in q_rows:
            assert isinstance(q["answer"]["answer"], str), (
                f"Passage {slug!r} Q{q['q_num']}: answer.answer is "
                f"{type(q['answer']['answer']).__name__}, expected str "
                f"(spec §11/F1: nested answer-dict regression). "
                f"answer={q['answer']}"
            )
            if q["question_type"] in options_types:
                assert q["payload"].get("options"), (
                    f"Passage {slug!r} Q{q['q_num']} ({q['question_type']}): "
                    f"payload.options is empty (spec §11/F1: dropped-options regression)."
                )
