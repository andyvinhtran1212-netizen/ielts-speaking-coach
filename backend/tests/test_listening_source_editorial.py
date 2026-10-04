"""An editorial refresh must not change keys or escape protected delivery."""
import copy
import json
from pathlib import Path

from services.listening_source_collection import source_explanation
from services.listening_programme_feedback import build_guided_feedback


ITEM = "80-days:day-03:main:q-23"


def original():
    return json.loads((Path(__file__).parent / "fixtures/listening_source_editorial_day03_q23.json").read_text())


def test_reviewed_text_preserves_ambiguous_two_word_answer_and_source_key():
    before = original()
    after = source_explanation(before, item_id=ITEM)
    assert after["paraphrase_vi"] == ""
    assert "leaves class" in after["why_vi"].lower() and "leaves quickly" in after["why_vi"].lower()
    for field in ("answer", "printed_key", "evidence", "source_answer_warning_vi"):
        assert after[field] == before[field]
    assert before["paraphrase_vi"]  # Delivery did not mutate the stored object.


def test_marking_and_other_source_revisions_keep_their_original_text():
    before = original()
    assert source_explanation(before) == before
    assert source_explanation(before, item_id="80-days:day-03:main:q-other") == before
    changed_key = copy.deepcopy(before)
    changed_key["answer"] = "different key"
    assert source_explanation(changed_key, item_id=ITEM) == changed_key
    changed_quote = copy.deepcopy(before)
    changed_quote["evidence"][0]["quote"] = "different edition"
    assert source_explanation(changed_quote, item_id=ITEM) == changed_quote


def test_guided_feedback_refreshes_only_the_revealed_source_item():
    rows = [{"payload": {
        "variant": "programme_form_v1", "source_contract": "source_book_v1",
        "questions": [{"q_num": 1, "source_item_id": ITEM, "response_type": "short_answer",
                       "evaluation_mode": "self_review"}],
        "self_review": {"1": {
            "reference_answers": ["leaves class"], "rationale": "Keep the action.",
            "explanation": original(), "review_status": "AMBIGUOUS",
            "review_accepted": True, "reviewer": "independent-source-reviewer",
        }},
        "controlled_transcripts": {"hidden": [{"text": "UNREVEALED_TRANSCRIPT"}]},
    }}]
    feedback = build_guided_feedback(1, "leaves quickly", rows, "allowed", source_required=True)
    assert feedback["correct"] is None
    assert feedback["explanation"]["paraphrase_vi"] == ""
    assert "leaves quickly" in feedback["explanation"]["why_vi"].lower()
    assert "UNREVEALED_TRANSCRIPT" not in str(feedback)
