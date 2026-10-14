"""Behavioral contracts: bounded content, private answers and canonical grading."""
from copy import deepcopy
from types import SimpleNamespace
from uuid import uuid4
import pytest
from fastapi import HTTPException
from models.vocabulary_sets import SetSave, StudyAnswer, TestSubmit as Submission
from services import vocabulary_sets as svc
from routers import vocabulary_sets as routes

CARD = {"id": str(uuid4()), "slug": "acquire", "category": "study", "headword": "acquire",
        "gloss_vi": "tiếp thu", "definition_en": "", "example": "We acquire new skills.",
        "pronunciation": "/əˈkwaɪə/", "part_of_speech": "v", "level": "B2", "audio_headword": "", "audio_example": ""}


def session(mode="learn"):
    return {"id": str(uuid4()), "set_id": str(uuid4()), "title": "Class set", "revision": 1,
            "mode": mode, "items": svc.study_items([CARD], mode), "answers": [], "completed": False}


@pytest.mark.parametrize("mode", ["flashcards", "learn", "cloze", "test"])
def test_modes_never_add_cards_outside_selected_set(mode):
    assert {i["card_id"] for i in svc.study_items([CARD], mode)} == {CARD["id"]}


def test_cloze_is_exact_case_insensitive_not_substring_or_missing_context():
    assert svc.study_items([CARD], "cloze")[0]["prompt"] == "We ____ new skills."
    assert svc.study_items([{**CARD, "example": "They acquired skills."}], "cloze") == []
    assert svc.study_items([{**CARD, "example": ""}], "cloze") == []
    assert svc.study_items([{**CARD, "example": "We ACQUIRE skills."}], "cloze")[0]["prompt"] == "We ____ skills."


def test_recall_modes_do_not_leak_answer_in_prompt():
    assert svc.study_items([{**CARD, "gloss_vi": "acquire means tiếp thu"}], "test") == []
    assert svc.study_items([{**CARD, "gloss_vi": "", "definition_en": ""}], "learn") == []


@pytest.mark.parametrize("mode", ["learn", "cloze", "test"])
def test_unanswered_recall_hides_all_expected_and_card_content(mode):
    row = session(mode)
    wire = svc.session_out(row).model_dump()
    assert wire["items"][0]["card"] is None
    assert "expected" not in wire["items"][0]
    assert CARD["headword"] not in str(wire)
    row["answers"] = [{"index": 0, "answer": "acquire", "expected": "acquire", "correct": True, "rating": None}]
    row["completed"] = True
    assert svc.session_out(row).correct == 1
    assert svc.session_out(row).items[0].card.headword == "acquire"


def test_canonical_snapshot_survives_live_card_change():
    row = deepcopy(session("test"))
    changed = {**CARD, "headword": "changed"}
    assert row["items"][0]["expected"] == "acquire"
    assert changed["headword"] != row["items"][0]["expected"]


def test_course_and_cohort_visibility_never_uses_cefr_or_legacy_pointer():
    source = {"library": False, "course_ids": ["course2"], "cohort_ids": []}
    assert svc.visible(source, [{"id": "course2"}], [])
    assert not svc.visible(source, [{"id": "B2"}], [])
    assert not svc.visible(source, [], [{"id": "course2"}])
    assert svc.visible({**source, "cohort_ids": ["class2"]}, [], [{"id": "class2"}])
    assert svc.visible({**source, "library": True}, [], [])


def test_duplicate_cards_rejected_before_persistence():
    id = uuid4()
    with pytest.raises(ValueError):
        SetSave(expected_version=0, title="Test", card_ids=[id, id])


def test_server_grading_srs_cas_and_selfmark_evidence_are_distinct(monkeypatch):
    row = session()
    old = {"card_id": CARD["id"], "version": 2, "familiar": False, "recall_attempts": 1, "recall_correct": 0,
           "interval_days": 0, "ease_factor": 2.5, "lapse_count": 1, "review_count": 1}
    calls = []
    monkeypatch.setattr(svc, "progress_rows", lambda *_: [old])
    def rpc(db, name, args):
        calls.append(deepcopy(args))
        if len(calls) == 1:
            old["version"] = 3
            raise HTTPException(409, "progress_conflict")
        return {**row, "answers": args["p_answers"], "completed": True}
    monkeypatch.setattr(svc, "rpc", rpc)
    client = uuid4()
    result = svc.answer_session(None, row, "learner", client, {"answer": " ACQUIRE "}, [(0, " ACQUIRE ", None)])
    assert result.correct == 1
    assert calls[0]["p_client"] == calls[1]["p_client"] == str(client)
    p = calls[1]["p_progress"][0]
    assert p["expected_version"] == 3
    assert not p["familiar"]
    assert p["recall_correct"] == 1 and p["recall_attempts"] == 2
    assert p["review_count"] == 2


def test_flashcard_mark_does_not_create_demonstrated_recall(monkeypatch):
    row, captured = session("flashcards"), {}
    monkeypatch.setattr(svc, "progress_rows", lambda *_: [])
    def rpc(db, name, args):
        captured.update(args)
        return {**row, "answers": args["p_answers"], "completed": True}
    monkeypatch.setattr(svc, "rpc", rpc)
    result = svc.answer_session(None, row, "learner", uuid4(), {}, [(0, "", "good")])
    assert result.correct is None
    p = captured["p_progress"][0]
    assert p["familiar"] and p["recall_attempts"] == p["recall_correct"] == 0


@pytest.mark.asyncio
async def test_test_cannot_receive_incremental_answers_and_foreign_sessions_are_owner_filtered(monkeypatch):
    monkeypatch.setattr(routes, "get_supabase_user", lambda _: authenticated())
    monkeypatch.setattr(svc, "get_session", lambda db, id, user: session("test"))
    with pytest.raises(HTTPException) as e:
        await routes.answer(uuid4(), StudyAnswer(client_id=uuid4(), index=0, answer="acquire"), "token")
    assert e.value.status_code == 422
    row = session("learn")
    monkeypatch.setattr(svc, "get_session", lambda db, id, user: row)
    with pytest.raises(HTTPException) as e:
        await routes.submit(uuid4(), Submission(client_id=uuid4(), answers=["acquire"]), "token")
    assert e.value.status_code == 422


async def authenticated():
    return {"id": "learner"}


def test_http_auth_owner_filter_private_headers_and_answer_projection(monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    row = session("test")
    class Table:
        def __init__(self): self.filters = {}
        def select(self, *_): return self
        def eq(self, key, value): self.filters[key] = value; return self
        def limit(self, *_): return self
        def execute(self):
            return SimpleNamespace(data=[row] if self.filters == {"id": row["id"], "user_id": "owner"} else [])
    monkeypatch.setattr(routes, "db", SimpleNamespace(table=lambda _: Table()))
    async def auth(header):
        if not header: raise HTTPException(401, "Missing token")
        return {"id": header.removeprefix("Bearer ")}
    async def admin(header):
        raise HTTPException(403, "Admin only")
    monkeypatch.setattr(routes, "get_supabase_user", auth)
    monkeypatch.setattr(routes, "require_admin", admin)
    app = FastAPI(); app.include_router(routes.router); app.include_router(routes.admin_router)
    client = TestClient(app)
    url = f"/api/vocabulary-sets/sessions/{row['id']}"
    assert client.get(url).status_code == 401
    assert client.get(url, headers={"Authorization": "Bearer other"}).status_code == 404
    result = client.get(url, headers={"Authorization": "Bearer owner"})
    assert result.status_code == 200
    assert result.headers["cache-control"] == "private, no-store"
    assert result.headers["vary"] == "Authorization"
    assert result.json()["items"][0]["card"] is None
    assert "expected" not in result.json()["items"][0]
    assert client.post("/admin/vocabulary-sets/cards", headers={"Authorization": "Bearer owner"},
                       json={"headword":"new","category":"study","gloss_vi":"mới"}).status_code == 403


def test_catalog_reads_current_revisions_in_batches_and_progress_without_an_id_column(monkeypatch):
    rows = [{"id": str(uuid4()), "published_revision": i+1} for i in range(51)]
    seen = []
    class Table:
        def select(self, *_): return self
        def or_(self, filters): seen.append(filters); return self
        def execute(self): return SimpleNamespace(data=[])
    assert svc.published_rows(SimpleNamespace(table=lambda _: Table()), rows) == {}
    assert len(seen) == 2
    assert all(f"set_id.eq.{r['id']},revision.eq.{r['published_revision']}" in seen[0] for r in rows[:50])
    class Progress(Table):
        def eq(self, key, value): assert (key,value) == ("user_id","owner"); return self
        def order(self, key): assert key == "card_id"; return self
        def range(self, *_): return self
    assert svc.paged(SimpleNamespace(table=lambda _: Progress()), "vocabulary_shared_progress", order_by="card_id", user_id="owner") == []
