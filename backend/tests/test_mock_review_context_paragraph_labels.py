"""PC-J123: matching_information review lists the frozen passage's paragraphs.

C14R4-04 / C15R1-05 / C13R2-06 / C21R1-04: the staging payload carried no
`options` and no `paragraph_labels`, so the review card showed bare letters.
The letters now come from the submission snapshot's passage (FR-014/015),
never from current content, and without changing keys or scores.
"""
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from routers import reading_student
from services.mock_review_context import question_context, snapshot_paragraph_previews

# Shape of ILR-RDG-CAM-B14-T4 passage 2 on staging: italic subtitle, then
# blank-line separated paragraphs that open with their letter.
B14_T4_BODY = (
    "*Scientist David Hone makes the case for zoos*\n\n"
    "A In my view, it is perfectly possible for many species of animals living in zoos or "
    "wildlife parks to have a quality of life as high as, or higher than, in the wild.\n\n"
    "B Firstly, zoos aid conservation. Colossal numbers of species are becoming extinct.\n\n"
    "C Zoos also provide education.\n\n"
    "D In addition to this, there is also the education that can take place in zoos.\n\n"
    "E Zoos also play a key role in research.\n\n"
    "F In conclusion, considering the many ongoing global threats to the environment.\n\n"
    "G A final paragraph, so the run is A–G as in the CM brief."
)


def snapshot(body=B14_T4_BODY, marks=None):
    return {"skill": "reading", "attempt_id": "a1", "paper_id": "t1", "paper_revision": 2,
            "policy_revision": 1, "paper_row": {"test_id": "ILR-RDG-CAM-B14-T4", "title": "B14 T4"},
            "source_rows": [{"id": "p2", "slug": "p2", "title": "Zoos", "passage_order": 2,
                             "body_markdown": body, "metadata": {}}],
            "marking_rows": marks if marks is not None else [matching(14), matching(15)],
            "scoring_override_rows": [], "passage_order_by_id": {"p2": 2}}


def matching(q_num, **payload):
    return {"id": f"q{q_num}", "q_num": q_num, "passage_id": "p2",
            "question_type": "matching_information",
            "prompt": "an example of how zoos protect species", "payload": {"metadata": {}, **payload}}


def test_snapshot_without_options_derives_paragraph_labels_a_to_g():
    context = question_context(matching(14), snapshot())
    assert context["paragraph_labels"] == list("ABCDEFG")
    assert context["options"] is None
    previews = context["paragraph_previews"]
    assert [row["label"] for row in previews] == list("ABCDEFG")
    assert previews[1]["text"].startswith("Firstly, zoos aid conservation.")
    # A short opening, never the whole paragraph.
    assert previews[0]["text"].endswith("…") and len(previews[0]["text"]) <= 91
    assert context["context_provenance"]["paragraph_labels"] == "submission_snapshot"
    assert context["context_provenance"]["paragraph_previews"] == "submission_snapshot"


def test_label_formats_seen_on_staging_are_recognised():
    for body in ("A. First.\n\nB. Second.\n\nC. Third.",
                 "**A**  First.\n\n**B**  Second.\n\n**C**  Third.",
                 "### A\nFirst.\n\n### B\nSecond.\n\n### C\nThird."):
        assert question_context(matching(14), snapshot(body))["paragraph_labels"] == ["A", "B", "C"]


def test_authored_options_keep_previous_behaviour():
    options = [{"label": "A", "text": "authored A"}, {"label": "B", "text": "authored B"}]
    context = question_context(matching(14, options=options), snapshot())
    assert context["options"] == options
    assert context["paragraph_labels"] is None
    assert context["context_provenance"]["paragraph_labels"] == "unavailable"


def test_authored_paragraph_labels_are_kept_including_template_scoped_labels():
    flat = question_context(matching(14, paragraph_labels=["A", "B", "C"]), snapshot())
    assert flat["paragraph_labels"] == ["A", "B", "C"]
    scoped = question_context(matching(14, template={"paragraph_labels": ["B", "C", "D"]}), snapshot())
    assert scoped["paragraph_labels"] == ["B", "C", "D"]
    # Excerpts are still offered so the card can name the chosen paragraph.
    assert scoped["paragraph_previews"][3]["label"] == "D"


@pytest.mark.parametrize("question", [
    pytest.param({**matching(14), "paragraph_labels": []}, id="question"),
    pytest.param(matching(14, paragraph_labels=[]), id="payload"),
    pytest.param(matching(14, template={"paragraph_labels": []}), id="template"),
])
def test_explicitly_empty_frozen_paragraph_labels_are_preserved(question):
    frozen = snapshot(marks=[question])
    before = deepcopy(frozen)
    context = question_context(frozen["marking_rows"][0], frozen)
    assert context["paragraph_labels"] == []
    assert context["context_provenance"]["paragraph_labels"] == "submission_snapshot"
    assert [row["label"] for row in context["paragraph_previews"]] == list("ABCDEFG")
    assert frozen == before


def test_other_question_types_are_untouched():
    row = {**matching(14), "question_type": "matching_features"}
    context = question_context(row, snapshot())
    assert context["paragraph_labels"] is None and "paragraph_previews" not in context


def test_no_snapshot_never_reads_current_content():
    context = question_context(matching(14), None)
    assert context["paragraph_labels"] is None and "paragraph_previews" not in context


def test_old_snapshot_without_letters_or_with_an_ambiguous_run_does_not_fail():
    for body in ("Plain prose.\n\nMore prose without letters.",
                 # "A psychologist" is an article, and C/E/F alone are not a run.
                 "A psychologist explains.\n\nC Tasks.\n\nE Health.\n\nF Ways.",
                 "A First.\n\nB Second.\n\nB Repeated.",
                 None):
        context = question_context(matching(14), snapshot(body))
        assert context["paragraph_labels"] is None and "paragraph_previews" not in context
    missing_passage = {**matching(14), "passage_id": "elsewhere"}
    assert snapshot_paragraph_previews(missing_passage, snapshot()) is None


class DB:
    def __init__(self, tables): self.tables = deepcopy(tables); self.calls = []
    def table(self, name): self.calls.append(name); return Query(self.tables.get(name, []))


class Query:
    def __init__(self, rows): self.rows = rows
    def select(self, *_): return self
    def eq(self, *_): return self
    def in_(self, *_): return self
    def order(self, *_): return self
    def limit(self, *_): return self
    def execute(self): return SimpleNamespace(data=deepcopy(self.rows))


def test_reading_review_route_carries_labels_without_changing_key_or_score():
    attempt = {"id": "a1", "test_id": "t1", "paper_revision": 2, "status": "submitted",
               "score": 1, "band_estimate": 5.0, "grading_details": [
                   {"q_num": 14, "user_answer": "E", "expected": "B", "correct": False, "passage_order": 2},
                   {"q_num": 15, "user_answer": "E", "expected": "E", "correct": True, "passage_order": 2}]}
    before = deepcopy(attempt)
    db = DB({"mock_paper_attempt_snapshots": [snapshot()],
             # Current content differs; it must not be read.
             "reading_passages": [{"id": "p2", "body_markdown": "A Changed.\n\nB Changed."}]})
    with patch.object(reading_student, "supabase_admin", db), \
         patch("services.mock_correction_service.attach_web_explanations", return_value={"available": False}):
        result = reading_student._assemble_reading_review(attempt, "a1")
    assert db.calls == ["mock_paper_attempt_snapshots"]
    first, second = result["review"]
    assert first["question_context"]["paragraph_labels"] == list("ABCDEFG")
    assert first["expected"] == "B" and first["correct"] is False
    assert second["expected"] == "E" and second["correct"] is True
    assert result["score"] == 1 and attempt == before
