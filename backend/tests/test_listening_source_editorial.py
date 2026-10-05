"""An editorial refresh must not change keys or escape protected delivery."""
import copy
import asyncio
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


def test_every_unresolved_source_item_keeps_a_useful_next_action_in_study_api(monkeypatch):
    """FR-007 applies to all 43 excluded positions, including mixed blocks."""
    import httpx
    from fastapi import FastAPI
    from routers import listening_source_collection as router

    rows = json.loads((Path(__file__).parent / "fixtures/listening_source_editorial_unresolved.json").read_text())
    assert len(rows) == 43
    lessons = {}
    for row in rows:
        lesson = lessons.setdefault(row["day"], {"sequence_num": row["day"], "metadata": {
            "source_book": {"source_contract": "source_book_v1", "blocks": [], "source_only_positions": []},
            "source_study": {},
        }})
        meta = lesson["metadata"]["source_book"]
        meta["source_only_positions"].append({"item_id": row["item_id"]})
        study = lesson["metadata"]["source_study"]
        if row["block_id"] not in study:
            meta["blocks"].append({"block_id": row["block_id"], "part_id": row["part_id"],
                "kind": "source_reference", "instruction": {}, "item_ids": [],
                "source_question_numbers": [], "study_available": True, "display_kind": "practice"})
            study[row["block_id"]] = {"items": [], "transcript": []}
        block = next(b for b in meta["blocks"] if b["block_id"] == row["block_id"])
        block["item_ids"].append(row["item_id"])
        study[row["block_id"]]["items"].append({"item_id": row["item_id"],
            "source_display_number": row["source_display_number"], "review_status": "UNRESOLVED",
            "answer_provenance": "source_study", "explanation": row["explanation"]})

    async def allowed(_):
        return {"id": "source-study-learner"}

    monkeypatch.setattr(router, "get_supabase_user", allowed)
    monkeypatch.setattr(router, "_context", lambda day: ({}, [lessons[day]]))
    app = FastAPI()
    app.include_router(router.router)

    async def run():
        received = {}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            for day, lesson in lessons.items():
                response = await client.post(f"/api/listening/source-collections/80-days/days/{day}/study",
                    json={"block_ids": list(lesson["metadata"]["source_study"])})
                assert response.status_code == 200, response.text
                for block in response.json()["blocks"]:
                    assert block["transcript"] == []
                    received.update({item["item_id"]: item for item in block["items"]})
        assert set(received) == {row["item_id"] for row in rows}
        for row in rows:
            item = received[row["item_id"]]
            after = item["explanation"]
            assert item["review_status"] == "UNRESOLVED"
            assert after["next_action_vi"] and after["next_action_vi"].strip(), row["item_id"]
            assert after["next_action_vi"] != row["explanation"]["next_action_vi"], row["item_id"]
            for field in ("answer", "printed_key", "evidence", "source_answer_warning_vi"):
                assert after[field] == row["explanation"][field], (row["item_id"], field)

    asyncio.run(run())
