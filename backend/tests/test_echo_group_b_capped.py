"""PC-J226 — group-B 4xx messages clip request-derived values.

Each capped site gets a long value (500+ characters, a random marker, line
breaks and control characters): the status code is unchanged, the value in the
message is at most 64 characters plus "…", on one line, and the tail of the
marker is gone. Negative controls: a short value is still shown verbatim and
the valid path still answers 2xx. Also covers the two admin-only mock-review
reprs folded from #2011/#2073, the deadline 422 `msg` (F4) and one kept
uuid-typed site (non-UUID text is refused with 422 before the message).
"""
from __future__ import annotations

import io
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

import main

MARKER = "pcj226-" + uuid.uuid4().hex  # random, not a real secret
TAIL = "end-" + uuid.uuid4().hex  # the tail of the long value; must never be shown
LONG = MARKER + "\n\r\x00\x1b" + "q" * 500 + TAIL  # TAIL only appears past char 64
LONG_URL = MARKER + "%0A%0D" + "q" * 500 + TAIL     # same, as a path segment
AUTH = {"Authorization": "Bearer x"}


def _clipped(text: str) -> None:
    """The value inside `text` was cut to 64 + "…" and kept on one line."""
    assert "…" in text, text
    assert "q" * 65 not in text
    assert TAIL not in text
    for ch in "\n\r\x00\x1b":
        assert ch not in text


def _client() -> TestClient:
    return TestClient(main.app)


# ── grammar.py / vocabulary.py (public) ──────────────────────────────────────


def test_grammar_unknown_slugs_are_clipped():
    client = _client()
    for path in (f"/api/grammar/category/{LONG_URL}",
                 f"/api/grammar/article/{LONG_URL}/{LONG_URL}",
                 f"/api/grammar/roadmap/{LONG_URL}",
                 f"/api/grammar/compare/{LONG_URL}"):
        r = client.get(path)
        assert r.status_code == 404, path
        detail = r.json()["detail"]
        _clipped(detail)
        assert detail.endswith("…' not found")


def test_grammar_short_slug_and_valid_category_unchanged():
    client = _client()
    r = client.get("/api/grammar/category/no-such-category")
    assert r.status_code == 404
    assert r.json()["detail"] == "Category 'no-such-category' not found"
    r = client.get("/api/grammar/article/tenses/no-such-article")
    assert r.json()["detail"] == "Article 'tenses/no-such-article' not found"
    category = client.get("/api/grammar/categories").json()[0]["slug"]
    assert client.get(f"/api/grammar/category/{category}").status_code == 200


def test_vocabulary_unknown_category_and_list_are_clipped():
    client = _client()
    for path in (f"/api/vocabulary/categories/{LONG_URL}/cards",
                 f"/api/vocabulary/exam/{LONG_URL}/cards",
                 f"/api/vocabulary/articles/{LONG_URL}/{LONG_URL}"):
        r = client.get(path)
        assert r.status_code == 404, path
        _clipped(r.json()["detail"])


def test_vocabulary_short_category_and_valid_category_unchanged():
    from services.vocab_content import vocab_service
    client = _client()
    r = client.get("/api/vocabulary/categories/__nope__/cards")
    assert r.status_code == 404
    assert r.json()["detail"] == "Category '__nope__' not found"
    category = next(iter(vocab_service.articles_by_category))
    assert client.get(f"/api/vocabulary/categories/{category}/cards").status_code == 200


# ── sessions.py (learner) ─────────────────────────────────────────────────────


def _no_rows_db():
    db = MagicMock()
    db.table.return_value.select.return_value.in_.return_value.eq.return_value \
        .execute.return_value.data = []
    return db


def test_finalize_full_test_missing_ids_are_clipped():
    from routers import sessions
    user = AsyncMock(return_value={"id": str(uuid.uuid4())})
    body = {"p1_id": LONG + "1", "p2_id": LONG + "2", "p3_id": LONG + "3"}
    with patch.object(sessions, "get_supabase_user", new=user), \
         patch.object(sessions, "supabase_admin", _no_rows_db()):
        r = _client().post("/sessions/finalize-full-test", json=body, headers=AUTH)
    assert r.status_code == 404
    detail = r.json()["detail"]
    assert detail.startswith("Session(s) không tồn tại hoặc không có quyền: [")
    _clipped(detail)
    assert detail.count("…") == 3


def test_finalize_full_test_short_missing_ids_unchanged():
    from routers import sessions
    user = AsyncMock(return_value={"id": str(uuid.uuid4())})
    body = {"p1_id": "s1", "p2_id": "s2", "p3_id": "s3"}
    with patch.object(sessions, "get_supabase_user", new=user), \
         patch.object(sessions, "supabase_admin", _no_rows_db()):
        r = _client().post("/sessions/finalize-full-test", json=body, headers=AUTH)
    assert r.status_code == 404
    assert r.json()["detail"] == "Session(s) không tồn tại hoặc không có quyền: ['s1', 's2', 's3']"


# ── course_pronunciation.py (learner) ─────────────────────────────────────────


def _submit_pronunciation(sentence_id: str):
    from routers import course_pronunciation as route
    form = {"bank_id": str(uuid.uuid4()), "client_id": str(uuid.uuid4()),
            "sentence_ids": f'["{sentence_id}"]'}
    files = [("recordings", ("a.webm", io.BytesIO(b""), "audio/webm"))]
    with patch.object(route, "get_supabase_user", new=AsyncMock(return_value={"id": "u"})):
        return _client().post("/api/quiz/course/pronunciation/submit",
                              data=form, files=files, headers=AUTH)


def test_pronunciation_empty_recording_id_is_clipped():
    r = _submit_pronunciation(MARKER + "\\n\\u001b" + "q" * 500 + TAIL)
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail.startswith("Bản ghi ") and detail.endswith("… đang trống")
    _clipped(detail)


def test_pronunciation_short_recording_id_unchanged():
    r = _submit_pronunciation("s-01")
    assert r.status_code == 422
    assert r.json()["detail"] == "Bản ghi s-01 đang trống"


# ── admin.py / admin_reading.py / admin_writing_prompts.py / admin_courses.py ──


def test_admin_grammar_preview_slug_is_clipped_and_valid_slug_previews():
    from routers import admin
    from services.grammar_content import grammar_service
    with patch.object(admin, "require_admin", new=AsyncMock(return_value={"id": "a"})):
        bad = _client().get(f"/admin/grammar/articles/{LONG_URL}/preview", headers=AUTH)
        short = _client().get("/admin/grammar/articles/no-such/preview", headers=AUTH)
        slug = next(iter(grammar_service.articles_by_slug))
        good = _client().get(f"/admin/grammar/articles/{slug}/preview", headers=AUTH)
    assert bad.status_code == 404
    _clipped(bad.json()["detail"])
    assert short.status_code == 404
    assert short.json()["detail"] == "Article 'no-such' not found"
    assert good.status_code == 200, good.text


def test_admin_code_type_and_lemma_override_are_clipped():
    from routers import admin
    with pytest.raises(HTTPException) as bad:
        admin._validate_code_type_combo(LONG, None)
    assert bad.value.status_code == 422
    _clipped(bad.value.detail)
    with pytest.raises(HTTPException) as short:
        admin._validate_code_type_combo("bogus", None)
    assert short.value.detail.endswith("got 'bogus'")
    admin._validate_code_type_combo("mass", None)  # control: valid combo passes


def _missing_row_db():
    db = MagicMock()
    db.table.return_value.select.return_value.eq.return_value.limit.return_value \
        .execute.return_value.data = []
    return db


def test_admin_reading_unknown_test_and_question_are_clipped():
    from routers import admin_reading
    with patch.object(admin_reading, "supabase_admin", _missing_row_db()):
        with pytest.raises(HTTPException) as test:
            admin_reading._fetch_admin_test_or_404(LONG)
        with pytest.raises(HTTPException) as question:
            admin_reading._fetch_question_or_404(LONG)
        with pytest.raises(HTTPException) as short:
            admin_reading._fetch_admin_test_or_404("T-1")
    assert test.value.status_code == question.value.status_code == 404
    _clipped(test.value.detail)
    _clipped(question.value.detail)
    assert short.value.detail == "Reading test 'T-1' not found."


def test_admin_writing_prompt_upload_content_type_is_clipped():
    from routers import admin_writing_prompts
    long_type = "text/" + MARKER + "q" * 500 + TAIL
    with patch.object(admin_writing_prompts, "require_admin", new=AsyncMock(return_value={"id": "a"})):
        bad = _client().post("/admin/writing/prompts/upload-image", headers=AUTH,
                             files={"file": ("a.txt", b"x", long_type)})
        short = _client().post("/admin/writing/prompts/upload-image", headers=AUTH,
                               files={"file": ("a.txt", b"x", "text/plain")})
    # PC-J133R FR-004 (#2107): a non-image is a structured 415 that names no
    # request value at all, which is stricter than the 64-char clip it replaced.
    for response in (bad, short):
        assert response.status_code == 415
        assert response.json()["detail"]["error_code"] == "unsupported_media_type"
    assert MARKER not in bad.text and TAIL not in bad.text


def test_admin_course_duplicate_code_is_clipped():
    from routers import admin_courses
    db = MagicMock()
    db.table.return_value.update.return_value.eq.return_value.execute.side_effect = \
        Exception("duplicate key value violates unique constraint")
    with patch.object(admin_courses, "require_admin", new=AsyncMock(return_value={"id": "a"})), \
         patch.object(admin_courses, "supabase_admin", db):
        # CoursePatch.code is max_length=32, so here the clip only drops the
        # control characters a str field still accepts.
        bad = _client().patch(f"/admin/courses/{uuid.uuid4()}", headers=AUTH,
                              json={"code": "C1\nX\x1b[31m"})
        short = _client().patch(f"/admin/courses/{uuid.uuid4()}", headers=AUTH,
                                json={"code": "C1"})
    assert bad.status_code == 409
    assert bad.json()["detail"] == "Mã khoá 'C1X[31m' đã tồn tại."
    assert short.status_code == 409
    assert short.json()["detail"] == "Mã khoá 'C1' đã tồn tại."


# ── listening.py ──────────────────────────────────────────────────────────────


def _tf(first_answer: str) -> dict:
    return {"statements": [{"idx": i, "text": f"Statement {i}.", "answer": a}
                           for i, a in enumerate((first_answer, "F", "NG"))]}


def test_listening_true_false_answer_is_clipped():
    from routers import listening
    with pytest.raises(HTTPException) as bad:
        listening._validate_true_false_payload(_tf(LONG))
    assert bad.value.status_code == 422
    _clipped(bad.value.detail)
    with pytest.raises(HTTPException) as short:
        listening._validate_true_false_payload(_tf("maybe"))
    assert short.value.detail == "Statement 0 answer must be T / F / NG (got 'maybe')."
    # Control: a valid payload still validates.
    listening._validate_true_false_payload(_tf("TRUE"))


# ── services: essay_service / topic_service / mock_review_workflow ────────────


def test_essay_list_invalid_status_is_clipped():
    from services import essay_service
    for fn in (essay_service.list_essays, essay_service.list_essays_page):
        with pytest.raises(HTTPException) as bad:
            fn(status=LONG)
        assert bad.value.status_code == 400
        _clipped(bad.value.detail)
        with pytest.raises(HTTPException) as short:
            fn(status="bogus")
        assert short.value.detail == "Invalid status: 'bogus'"


def test_topic_invalid_skill_area_and_duplicate_slug_are_clipped():
    from services import topic_service
    with pytest.raises(HTTPException) as bad:
        topic_service.create_topic(title="T", skill_area=LONG)
    assert bad.value.status_code == 422
    _clipped(bad.value.detail)
    skill = sorted(topic_service.VALID_SKILL_AREAS)[0]
    db = MagicMock()
    db.table.return_value.insert.return_value.execute.side_effect = Exception("duplicate key 23505")
    with patch.object(topic_service, "supabase_admin", db):
        with pytest.raises(HTTPException) as dup:
            topic_service.create_topic(title="T", skill_area=skill, slug=LONG)
        with pytest.raises(HTTPException) as short:
            topic_service.create_topic(title="T", skill_area=skill, slug="my-topic")
    assert dup.value.status_code == 409
    _clipped(dup.value.detail)
    assert short.value.detail == f"Topic đã tồn tại: {skill}/my-topic"


def test_mock_review_band_and_channel_are_clipped():
    # Folds the two admin-only reprs left by #2011/#2073.
    from services import mock_review_workflow as wf
    with pytest.raises(wf.ValidationError) as band:
        wf._coerce_band(LONG)
    _clipped(str(band.value))
    with pytest.raises(wf.ValidationError) as channel:
        wf.release_results(uuid.uuid4(), uuid.uuid4(), channel=LONG)
    _clipped(str(channel.value))
    # Controls: short values read as before; a real band still coerces.
    with pytest.raises(wf.ValidationError) as short:
        wf._coerce_band("abc")
    assert str(short.value) == "band 'abc' is not a number"
    with pytest.raises(wf.ValidationError) as none:
        wf._coerce_band(None)
    assert str(none.value) == "band None is not a number"   # repr kept for non-str
    with pytest.raises(wf.ValidationError) as short_channel:
        wf.release_results(uuid.uuid4(), uuid.uuid4(), channel="sms")
    assert str(short_channel.value) == "unknown release channel 'sms'"
    assert wf._coerce_band("6.5") == 6.5


def test_admin_mock_review_release_channel_is_clipped_status_unchanged():
    # _raise_for maps wf.ValidationError to 400 (unchanged by this patch).
    from routers import admin_mock_reviews
    admin = AsyncMock(return_value={"id": str(uuid.uuid4())})
    with patch.object(admin_mock_reviews, "require_admin", new=admin):
        r = _client().post(f"/admin/mock-reviews/{uuid.uuid4()}/release", headers=AUTH,
                           json={"channel": LONG})
        short = _client().post(f"/admin/mock-reviews/{uuid.uuid4()}/release", headers=AUTH,
                               json={"channel": "sms"})
    assert r.status_code == 400
    _clipped(r.json()["detail"])
    assert short.status_code == 400
    assert short.json()["detail"] == "unknown release channel 'sms'"


# ── F4: deadline 422 msg ─────────────────────────────────────────────────────


def test_normalize_deadline_message_is_constant():
    from services.cohort_assignment_service import normalize_deadline
    with pytest.raises(ValueError) as bad:
        normalize_deadline(LONG)
    assert str(bad.value) == "Hạn nộp phải là ngày/giờ ISO"
    assert bad.value.__cause__ is None and bad.value.__suppress_context__


def _assign(deadline):
    from routers import instructor
    me = AsyncMock(return_value=str(uuid.uuid4()))
    replay = {"id": str(uuid.uuid4()), "replayed": True}
    with patch.object(instructor, "_me", new=me), \
         patch.object(instructor.instructor_give_service, "replay_give", return_value=replay):
        return _client().post("/instructor/assignments", headers=AUTH, json={
            "request_id": str(uuid.uuid4()), "prompt_id": str(uuid.uuid4()),
            "student_id": str(uuid.uuid4()), "deadline": deadline})


def test_deadline_422_does_not_reflect_the_value():
    r = _assign(LONG)
    assert r.status_code == 422
    assert MARKER not in r.text and "q" * 20 not in r.text
    assert "Hạn nộp phải là ngày/giờ ISO" in r.text


def test_valid_deadline_still_passes_validation():
    r = _assign("2026-11-05T21:00:00+07:00")
    assert r.status_code == 201, r.text
    r = _assign("2026-11-05")
    assert r.status_code == 201, r.text


# ── kept uuid-typed site: non-UUID text never reaches the message ────────────


def test_grade_rating_non_uuid_essay_is_rejected_before_the_handler():
    from routers import admin_writing
    guard = AsyncMock(return_value={"id": "a"})
    with patch.object(admin_writing, "require_admin", new=guard), \
         patch.object(admin_writing.essay_service, "upsert_grade_rating") as rate:
        r = _client().post(f"/admin/writing/essays/{MARKER}/grade-rating", headers=AUTH,
                           json={"rating": 4, "note": ""})
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"] == ["path", "essay_id"]
    assert MARKER not in r.text
    assert not rate.called and not guard.called
