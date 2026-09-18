"""Giao bài tập theo BUỔI cho lớp.

Bài giao này là cửa DUY NHẤT mở một bank giáo trình (bank ấy không xuất bản và
không nằm trong danh sách tự chọn). Nên mọi điều kiện phải kiểm ở lệnh giao —
không có lớp bảo vệ nào phía sau.
"""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from routers import admin_class_assignments as adm
from services.class_assignment_service import assignment_timer_state


class _Resp:
    def __init__(self, data, count=None): self.data = data; self.count = count


class _Table:
    def __init__(self, rows): self._rows = list(rows)
    def select(self, *_a, **k): self._count = "count" in k; return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def in_(self, f, vals):
        self._rows = [r for r in self._rows if r.get(f) in vals]
        return self
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self
    def range(self, s, e): self._rows = self._rows[s:e + 1]; return self
    def execute(self): return _Resp(self._rows, count=len(self._rows))


def _db(**tables):
    db = type("DB", (), {})()
    db.table = lambda n: _Table(tables.get(n, []))
    return db


_COHORT = {"id": "co-1", "name": "Lớp A", "course_id": "c-1"}
_BANK = {"id": "bank-1", "code": "C1-B01", "title": "Buổi 1", "skill_area": "course",
         "course_id": "c-1", "lesson_no": 1, "words_count": 100}
_PRON_SENTENCES = [
    {"id": f"s{number}", "order": number, "text": f"Sentence {number}."}
    for number in range(1, 13)
]
_PRON_REQUIREMENT = {
    "sentence_count": 12,
    "locale": "en-GB",
    "voice_engine": "kokoro",
    "voice": "bf_emma",
    "content_hash": adm.pronunciation_content_hash(
        sentences=[sentence["text"] for sentence in _PRON_SENTENCES],
        locale="en-GB", voice_engine="kokoro", voice="bf_emma"),
}
_PRON_SET = {
    "id": "pron-1", "bank_id": "bank-1", "is_active": True,
    "sentences": _PRON_SENTENCES,
    "locale": "en-GB", "voice_engine": "kokoro", "voice": "bf_emma",
    "content_hash": _PRON_REQUIREMENT["content_hash"],
}


def _body(**over):
    kw = {"skill": "course", "title": "Bài tập buổi 1", "content_id": "bank-1"}
    kw.update(over)
    return adm.AssignmentCreate(**kw)


def _resolve(db, body=None, revisions=("rev-1", "rev-1")):
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "_course_bank_assignment_revision",
                      side_effect=revisions):
        return adm._resolve_course_bank("co-1", body or _body())


def _full(**over):
    t = {"cohorts": [_COHORT], "quiz_banks": [_BANK],
         "quiz_questions": [{"id": "q1", "bank_id": "bank-1"}],
         "class_assignments": []}
    t.update(over)
    return _db(**t)


# ── Nhận ─────────────────────────────────────────────────────────────────────

def test_a_valid_bank_freezes_weight_shape_without_copying_questions():
    """Không chụp nội dung đề, nhưng phải chụp luật tính điểm lúc giao."""
    bank_id, cfg = _resolve(_full())
    assert bank_id == "bank-1"
    assert cfg == {
        "test_title": "Buổi 1", "lesson_no": 1, "bank_code": "C1-B01",
        "weight_policy": "hybrid_question_count_v1",
        "section_counts": {"quiz": 1},
        "section_weights": {"quiz": 100.0},
        "bank_revision": "rev-1",
    }
    assert "questions" not in cfg and "question_ids" not in cfg


def test_advanced_vocabulary_freezes_runtime_and_ignores_grade_controls():
    runtime = {"kind": "advanced_vocab", "lesson_id": "ADV-T01", "score_policy": "none"}
    bank = {**_BANK, "is_published": True, "meta": {"runtime": runtime}}
    _, cfg = _resolve(
        _full(quiz_banks=[bank]),
        _body(pass_pct=75, retake_size=20),
    )
    assert cfg["runtime"] == runtime
    assert "pass_pct" not in cfg
    assert "retake_size" not in cfg


def test_advanced_vocabulary_syllable_segments_do_not_break_audio_readiness():
    runtime = {"kind": "advanced_vocab", "lesson_id": "ADV-T01"}
    bank = {**_BANK, "lesson_no": None, "is_published": True,
            "meta": {"runtime": runtime}}
    question = {
        "id": "syllable-1", "bank_id": "bank-1", "type": "syllable",
        "segments": ["re", "sil", "ience"], "audio_url": None,
    }

    bank_id, cfg = _resolve(_full(quiz_banks=[bank], quiz_questions=[question]))

    assert bank_id == "bank-1"
    assert cfg["runtime"] == runtime


def test_advanced_vocabulary_must_be_published_before_assignment():
    runtime = {"kind": "advanced_vocab", "lesson_id": "ADV-T01"}
    bank = {**_BANK, "is_published": False, "meta": {"runtime": runtime}}

    with pytest.raises(HTTPException) as exc:
        _resolve(_full(quiz_banks=[bank]))

    assert exc.value.status_code == 409
    assert "xuất bản" in exc.value.detail


def test_advanced_vocabulary_tally_uses_six_part_evidence_not_generic_quiz(monkeypatch):
    from services import advanced_vocab_service

    monkeypatch.setattr(advanced_vocab_service, "assignment_results", lambda **_kwargs: {
        "students": [{
            "item": {
                "student_id": "student-1", "opened_at": "2026-09-15T01:00:00Z",
                "submitted_at": None, "passed_at": None,
                "artifact_kind": None, "artifact_id": None,
            },
            "student": {
                "user_id": "user-1", "full_name": "Học viên A", "student_code": "HV01",
            },
            "stages": [{"stage": "vocabulary", "status": "completed"}],
            "sections": [],
            "practice_attempts": [],
        }],
    })

    out = adm._advanced_vocab_assignment_tally({
        "id": "assignment-1", "skill": "course", "title": "Advanced T01",
        "due_at": None,
    })

    learner = out["students"][0]
    assert out["advanced_vocab"] is True and out["score_policy"] == "none"
    assert learner["course_state"] == "in_progress"
    assert (learner["sections_done"], learner["sections_total"]) == (1, 6)
    assert {row["key"] for row in learner["missing_sections"]} == {
        "practice_1", "practice_2", "reading", "controlled_rewrite", "listening",
    }
    assert all(row["key"] != "quiz" for row in learner["missing_sections"])


def test_advanced_vocabulary_tally_keeps_no_account_separate_from_untouched(monkeypatch):
    from services import advanced_vocab_service

    monkeypatch.setattr(advanced_vocab_service, "assignment_results", lambda **_kwargs: {
        "students": [{
            "item": {
                "student_id": "student-1", "opened_at": None,
                "submitted_at": None, "passed_at": None,
                "artifact_kind": None, "artifact_id": None,
            },
            "student": {
                "user_id": None, "full_name": "Chưa kích hoạt", "student_code": "HV02",
            },
            "stages": [], "sections": [], "practice_attempts": [],
        }],
    })

    out = adm._advanced_vocab_assignment_tally({
        "id": "assignment-1", "skill": "course", "title": "Advanced T01",
        "due_at": None,
    })

    assert out["students"][0]["status"] == "no-account"
    assert out["students"][0]["course_state"] == "no_account"
    assert out["counts"]["no_account"] == 1
    assert out["counts"]["untouched"] == 0


def test_advanced_vocabulary_tally_reports_neutral_completion_not_pass(monkeypatch):
    from services import advanced_vocab_service

    monkeypatch.setattr(advanced_vocab_service, "assignment_results", lambda **_kwargs: {
        "students": [{
            "item": {
                "student_id": "student-1", "opened_at": "2026-09-15T01:00:00Z",
                "submitted_at": "2026-09-15T02:00:00Z",
                "passed_at": "2026-09-15T02:00:00Z",
                "artifact_kind": "advanced_vocab_progress", "artifact_id": "item-1",
            },
            "student": {
                "user_id": "user-1", "full_name": "Học viên A", "student_code": "HV01",
            },
            "stages": [
                {"stage": stage, "status": "completed"}
                for stage in ("vocabulary", "practice_1", "practice_2", "controlled_rewrite")
            ],
            "sections": [{"section": "reading"}, {"section": "listening"}],
            "practice_attempts": [],
        }],
    })

    out = adm._advanced_vocab_assignment_tally({
        "id": "assignment-1", "skill": "course", "title": "Advanced T01",
        "due_at": None,
    })

    assert out["students"][0]["course_state"] == "completed"
    assert out["counts"]["completed"] == 1
    assert "passed" not in out["counts"]
    assert out["students"][0]["score"] is None


def test_a_timed_course_assignment_freezes_the_limit_in_its_snapshot():
    _bank_id, cfg = _resolve(_full(), _body(time_limit_minutes=135))
    assert cfg["time_limit_minutes"] == 135


def test_assignment_preflight_rejects_a_bank_changed_during_shape_read():
    with pytest.raises(HTTPException) as exc:
        _resolve(_full(), revisions=("rev-before", "rev-after"))
    assert exc.value.status_code == 409
    assert "vừa được cập nhật" in exc.value.detail


def test_time_limit_is_course_only_and_bounded():
    with pytest.raises(ValueError):
        adm.AssignmentCreate(
            skill="speaking", title="Speaking", content_id="topic-1",
            time_limit_minutes=30,
        )
    with pytest.raises(ValueError):
        _body(time_limit_minutes=721)


def test_time_limit_is_rejected_for_a_hybrid_course_bank():
    with pytest.raises(HTTPException) as exc:
        _resolve(_full(quiz_questions=[
            {"id": "q1", "bank_id": "bank-1", "type": "mcq"},
            {"id": "w1", "bank_id": "bank-1", "type": "writing"},
        ]), _body(time_limit_minutes=30))
    assert "trắc nghiệm thuần" in exc.value.detail


def test_timer_is_derived_from_the_canonical_opened_at():
    state = assignment_timer_state(
        {"opened_at": "2026-09-15T01:00:00+00:00"},
        {"content_config": {"time_limit_minutes": 30}},
        now=datetime(2026, 9, 15, 1, 29, 1, tzinfo=timezone.utc),
    )
    assert state["time_remaining_seconds"] == 59
    assert state["expires_at"] == "2026-09-15T01:30:00+00:00"
    assert state["sampled_at"] == "2026-09-15T01:29:01+00:00"
    assert state["is_expired"] is False

    expired = assignment_timer_state(
        {"opened_at": "2026-09-15T01:00:00+00:00"},
        {"content_config": {"time_limit_minutes": 30}},
        now=datetime(2026, 9, 15, 1, 30, tzinfo=timezone.utc),
    )
    assert expired["time_remaining_seconds"] == 0
    assert expired["is_expired"] is True


def test_timer_uses_the_earlier_class_deadline_as_its_cutoff():
    state = assignment_timer_state(
        {"opened_at": "2026-09-15T01:00:00+00:00"},
        {
            "due_at": "2026-09-15T01:10:00+00:00",
            "content_config": {"time_limit_minutes": 60},
        },
        now=datetime(2026, 9, 15, 1, 9, 30, tzinfo=timezone.utc),
    )
    assert state["expires_at"] == "2026-09-15T01:10:00+00:00"
    assert state["time_remaining_seconds"] == 30
    assert state["is_expired"] is False

    expired = assignment_timer_state(
        {"opened_at": "2026-09-15T01:00:00+00:00"},
        {
            "due_at": "2026-09-15T01:10:00+00:00",
            "content_config": {"time_limit_minutes": 60},
        },
        now=datetime(2026, 9, 15, 1, 10, tzinfo=timezone.utc),
    )
    assert expired["is_expired"] is True


def test_started_timer_prefers_the_immutable_item_snapshot_over_live_config():
    state = assignment_timer_state(
        {
            "opened_at": "2026-09-15T01:00:00+00:00",
            "timed_limit_minutes": 60,
            "timed_expires_at": "2026-09-15T02:00:00+00:00",
        },
        {
            "due_at": "2026-09-15T01:10:00+00:00",
            "content_config": {"time_limit_minutes": 5},
        },
        now=datetime(2026, 9, 15, 1, 30, tzinfo=timezone.utc),
    )
    assert state["time_limit_minutes"] == 60
    assert state["expires_at"] == "2026-09-15T02:00:00+00:00"
    assert state["time_remaining_seconds"] == 1800
    assert state["is_expired"] is False


# ── Từ chối ──────────────────────────────────────────────────────────────────

def test_a_bank_from_ANOTHER_course_is_refused():
    """Giao bộ của khoá khác là giao nội dung lớp này chưa học — và id đến từ
    trình duyệt, nên phải kiểm lại ở đây."""
    db = _full(quiz_banks=[{**_BANK, "course_id": "c-KHAC"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 400
    assert "khoá khác" in exc.value.detail


def test_a_NON_course_bank_is_refused():
    """Bank từ vựng/ngữ pháp là nội dung tự chọn; giao qua đường này sẽ mở một
    trang không dựng cho chúng."""
    db = _full(quiz_banks=[{**_BANK, "skill_area": "vocab"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "không phải bài tập theo buổi" in exc.value.detail


def test_an_EMPTY_bank_is_refused():
    """Bank rỗng vẫn "tồn tại". Giao nó nghĩa là học viên mở ra trang trắng."""
    db = _full(quiz_questions=[])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "chưa có câu hỏi" in exc.value.detail


def test_a_bank_with_missing_required_question_audio_is_refused():
    db = _full(quiz_questions=[{
        "id": "q1", "bank_id": "bank-1", "type": "mcq",
        "segments": {"question_audio_text": "Read this sentence."},
        "audio_url": None,
    }])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "1 câu tiếng Anh chưa có audio" in exc.value.detail


def test_a_bank_with_required_pronunciation_needs_an_active_set():
    required_bank = {**_BANK, "meta": {
        "pronunciation_requirement": _PRON_REQUIREMENT}}
    with pytest.raises(HTTPException) as exc:
        _resolve(_full(quiz_banks=[required_bank]))
    assert "không khớp nội dung bắt buộc" in exc.value.detail

    bank_id, config = _resolve(_full(
        quiz_banks=[required_bank],
        course_pronunciation_sets=[_PRON_SET],
    ))
    assert bank_id == "bank-1"
    assert config["section_counts"]["pronunciation"] == 12


def test_a_stale_active_pronunciation_set_is_refused():
    required_bank = {**_BANK, "meta": {
        "pronunciation_requirement": _PRON_REQUIREMENT}}
    stale = {**_PRON_SET, "sentences": [
        *_PRON_SENTENCES[:-1],
        {**_PRON_SENTENCES[-1], "text": "A revised final sentence."},
    ]}
    with pytest.raises(HTTPException) as exc:
        _resolve(_full(
            quiz_banks=[required_bank], course_pronunciation_sets=[stale]))
    assert "không khớp nội dung bắt buộc" in exc.value.detail


def test_an_unknown_bank_is_404():
    db = _full(quiz_banks=[])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 404


def test_giving_the_same_lesson_twice_is_refused():
    db = _full(class_assignments=[{"id": "a1", "cohort_id": "co-1", "skill": "course",
                                   "content_id": "bank-1", "title": "Bài cũ"}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert exc.value.status_code == 409
    assert "Bài cũ" in exc.value.detail


def test_a_cohort_with_no_course_says_SO():
    """Danh sách rỗng đọc như "khoá chưa ai soạn đề", còn sự thật là lớp chưa
    được gắn khoá — hai việc khác nhau, và chỉ một sửa được ngay."""
    db = _full(cohorts=[{**_COHORT, "course_id": None}])
    with pytest.raises(HTTPException) as exc:
        _resolve(db)
    assert "chưa được gắn vào khoá" in exc.value.detail


def test_the_payload_requires_a_bank():
    with pytest.raises(ValueError):
        _body(content_id="")


def test_a_course_give_does_not_need_mode_or_part():
    """Bộ đề của buổi quyết định tất cả — đòi thêm mode/part là đòi một thông tin
    không tồn tại."""
    b = _body()
    assert b.skill == "course"


# ── Kho phía admin ───────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_library_separates_ALREADY_GIVEN_from_NOT_YET_LOADED():
    """Hai lý do khác nhau ⇒ hai việc khác nhau: một cái đã xong, một cái là nạp
    tệp JSONL của buổi ấy."""
    db = _db(
        cohorts=[_COHORT],
        quiz_banks=[_BANK,
                    {**_BANK, "id": "bank-2", "lesson_no": 2, "title": "Buổi 2"},
                    {**_BANK, "id": "bank-3", "lesson_no": 3, "title": "Buổi 3"}],
        quiz_questions=[{"id": "q1", "bank_id": "bank-1"},
                        {"id": "q2", "bank_id": "bank-2"}],
        class_assignments=[{"cohort_id": "co-1", "skill": "course", "content_id": "bank-2"}],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")
    by = {b["lesson_no"]: b for b in out["items"]}
    assert by[1]["ready"] is True and by[1]["already_given"] is False
    assert by[2]["already_given"] is True
    assert by[3]["ready"] is False and by[3]["question_count"] == 0


@pytest.mark.asyncio
async def test_the_library_exposes_the_advanced_vocabulary_runtime():
    bank = {**_BANK, "meta": {"runtime": {"kind": "advanced_vocab"}}}
    db = _db(
        cohorts=[_COHORT], quiz_banks=[bank],
        quiz_questions=[{"id": "q1", "bank_id": "bank-1",
                         "segments": ["ad", "vanced"]}],
        class_assignments=[],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")
    assert out["items"][0]["runtime"] == "advanced_vocab"


@pytest.mark.asyncio
async def test_supplementary_advanced_banks_are_stably_ordered_after_numbered_lessons():
    def advanced(number):
        lesson_id = f"ADV-T{number:02d}"
        return {
            **_BANK, "id": f"advanced-{number}", "code": f"C4-{lesson_id}",
            "lesson_no": None, "title": lesson_id,
            "meta": {"runtime": {"kind": "advanced_vocab", "lesson_id": lesson_id}},
        }

    banks = [advanced(10), advanced(2), _BANK, advanced(1)]
    db = _db(
        cohorts=[_COHORT], quiz_banks=banks,
        quiz_questions=[{"id": f"q-{bank['id']}", "bank_id": bank["id"]}
                        for bank in banks],
        class_assignments=[],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")

    assert [row["id"] for row in out["items"]] == [
        "bank-1", "advanced-1", "advanced-2", "advanced-10",
    ]


@pytest.mark.asyncio
async def test_the_library_exposes_audio_and_pronunciation_readiness():
    required_bank = {**_BANK, "meta": {
        "pronunciation_requirement": _PRON_REQUIREMENT}}
    db = _db(
        cohorts=[_COHORT],
        quiz_banks=[required_bank],
        quiz_questions=[{
            "id": "q1", "bank_id": "bank-1",
            "segments": {"question_audio_text": "Read this sentence."},
            "audio_url": None,
        }],
        course_pronunciation_sets=[],
        class_assignments=[],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")
    bank = out["items"][0]
    assert bank["question_audio_count"] == 1
    assert bank["missing_audio"] == 1
    assert bank["pronunciation_required"] is True
    assert bank["pronunciation_ready"] is False
    assert bank["ready"] is False


@pytest.mark.asyncio
async def test_the_library_rejects_a_stale_active_pronunciation_set():
    required_bank = {**_BANK, "meta": {
        "pronunciation_requirement": _PRON_REQUIREMENT}}
    stale = {**_PRON_SET, "content_hash": "stale"}
    db = _db(
        cohorts=[_COHORT], quiz_banks=[required_bank],
        quiz_questions=[{"id": "q1", "bank_id": "bank-1"}],
        course_pronunciation_sets=[stale], class_assignments=[],
    )
    with patch.object(adm, "supabase_admin", db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        out = await adm.list_course_banks("co-1", authorization="Bearer x")
    assert out["items"][0]["pronunciation_ready"] is False
    assert out["items"][0]["ready"] is False

    matching_db = _db(
        cohorts=[_COHORT], quiz_banks=[required_bank],
        quiz_questions=[{"id": "q1", "bank_id": "bank-1"}],
        course_pronunciation_sets=[_PRON_SET], class_assignments=[],
    )
    with patch.object(adm, "supabase_admin", matching_db), \
         patch.object(adm, "require_admin", new=lambda *_a, **_k: _async({"id": "ad"})):
        matching = await adm.list_course_banks("co-1", authorization="Bearer x")
    assert matching["items"][0]["pronunciation_ready"] is True
    assert matching["items"][0]["ready"] is True


def _async(v):
    async def _f(): return v
    return _f()
