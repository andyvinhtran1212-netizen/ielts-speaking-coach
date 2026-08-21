"""routers/class_student — trang lớp phía học viên (GĐ 3).

`GET /api/class/me` feeds one page, so its failure behaviour is the thing worth
pinning:

  * **Not being in a class is an ordinary answer**, not a 404. Most learners join
    on a mass code and belong to no class; the page explains that and the home
    card hides itself.

  * **One block failing must not take the others down.** A class page that 500s
    because the lessons query hiccuped hides the homework too — and the homework
    is the part the student came for. Each block degrades on its own and names
    itself in `degraded`.

  * **Counts come from the rendered list.** `progress` is computed from the same
    assignments the page shows, so the summary can never disagree with the rows
    underneath it — and it is `None`, never zeros, when that list failed to load.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest

from routers import class_student as mod


NOW = datetime(2026, 8, 3, 12, 0, tzinfo=timezone.utc)      # 19:00 giờ VN


def _assignment(*, submitted=False, late=False, missing=False, due_offset_h=2):
    due = (NOW + timedelta(hours=due_offset_h)).isoformat()
    return {
        "item_id": "i", "state": "submitted" if submitted else "assigned",
        "submitted_at": NOW.isoformat() if submitted else None,
        "score": 6.5 if submitted else None,
        "is_late": late, "is_missing": missing,
        "assignment": {"id": "a", "title": "t", "skill": "speaking",
                       "instructions": None, "due_at": due, "content_config": {}},
    }


# ── tiến độ tính từ chính danh sách hiển thị ────────────────────────────


def test_progress_counts_match_the_rendered_list():
    rows = [
        _assignment(submitted=True),
        _assignment(submitted=True, late=True),
        _assignment(),                       # chưa tới hạn
        _assignment(missing=True),           # quá hạn, chưa nộp
    ]
    p = mod._progress_summary(rows)
    assert p["total"] == 4
    assert p["submitted"] == 2
    assert p["late"] == 1
    assert p["missing"] == 1
    assert p["todo"] == 1, "todo must exclude both submitted and overdue work"


def test_on_time_percentage_is_over_hand_ins_not_over_everything():
    """Dividing by `total` would drag punctuality down for work that is not even
    due yet — a student who has submitted everything on time so far would see
    less than 100% simply for having homework left."""
    rows = [_assignment(submitted=True), _assignment(submitted=True),
            _assignment(), _assignment(), _assignment()]
    assert mod._progress_summary(rows)["on_time_pct"] == 100


def test_one_late_hand_in_out_of_four():
    rows = [_assignment(submitted=True) for _ in range(3)]
    rows.append(_assignment(submitted=True, late=True))
    assert mod._progress_summary(rows)["on_time_pct"] == 75


def test_no_hand_ins_yet_reports_unknown_not_zero():
    """0% would read as "always late"; the student simply has not submitted
    anything yet."""
    assert mod._progress_summary([_assignment()])["on_time_pct"] is None


def test_empty_list_is_all_zeros_and_no_percentage():
    p = mod._progress_summary([])
    assert (p["total"], p["submitted"], p["missing"], p["todo"]) == (0, 0, 0, 0)
    assert p["on_time_pct"] is None


# ── không thuộc lớp nào là câu trả lời bình thường ──────────────────────


@pytest.mark.asyncio
async def test_no_student_row_is_not_an_error():
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=None):
        out = await mod.my_class(None)
    assert out == {"has_class": False}


@pytest.mark.asyncio
async def test_student_with_no_cohort_is_not_an_error():
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value={"id": "s1", "cohort_id": None}), \
         patch.object(mod, "active_cohort_ids_for_student", return_value=[]):
        out = await mod.my_class(None)
    assert out == {"has_class": False}


# ── một khối hỏng không kéo cả trang xuống ──────────────────────────────


class _Resp:
    def __init__(self, data):
        self.data = data


class _Table:
    def __init__(self, rows, raises):
        self._rows, self._raises = rows, raises

    def select(self, *_a, **_k): return self
    def eq(self, *_a): return self
    def order(self, *_a, **_k): return self
    def range(self, *_a): return self
    def limit(self, *_a): return self
    def in_(self, *_a): return self
    def is_(self, *_a): return self

    @property
    def not_(self): return self

    def execute(self):
        if self._raises:
            raise RuntimeError("boom")
        return _Resp(self._rows)


def _db(fail: set[str]):
    tables = {
        "cohorts": [{"id": "c1", "name": "C2-K12", "course_id": None}],
        "courses": [],
        "class_lessons": [{"id": "l1", "title": "Buổi 1", "lesson_no": 1,
                           "lesson_date": None, "created_at": "x"}],
        "class_assignment_items": [],
        "class_assignments": [],
        "student_cohort_memberships": [
            {"id": "m1", "student_id": "s1", "cohort_id": "c1", "is_active": True},
        ],
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []), name in fail)
    return db


async def _call(fail: set[str]):
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _db(fail)):
        return await mod.my_class(None)


@pytest.mark.asyncio
async def test_a_broken_lessons_query_still_returns_the_homework():
    out = await _call({"class_lessons"})
    assert out["has_class"] is True
    assert "lessons" in out["degraded"]
    assert "assignments" not in out["degraded"], "the part the student came for must survive"
    assert out["progress"] is not None


@pytest.mark.asyncio
async def test_a_broken_assignments_query_leaves_progress_unknown():
    """Zeros here would tell the student they owe nothing — the one thing this
    page must never say wrongly."""
    out = await _call({"class_assignment_items"})
    assert "assignments" in out["degraded"]
    assert out["progress"] is None
    assert out["assignments"] == []


@pytest.mark.asyncio
async def test_a_broken_class_query_still_lists_work():
    out = await _call({"cohorts"})
    assert "class" in out["degraded"]
    assert out["has_class"] is True


@pytest.mark.asyncio
async def test_nothing_broken_means_no_degraded_key_at_all():
    out = await _call(set())
    assert "degraded" not in out
    assert out["class"]["name"] == "C2-K12"
    assert [l["title"] for l in out["lessons"]] == ["Buổi 1"]


# ── URL tài liệu: khoá ở NGUỒN SỰ THẬT, không chỉ ở giao diện ───────────


def test_attachment_urls_must_be_web_links():
    """The student page puts these straight into an anchor. Escaping stops
    attribute injection but says nothing about the SCHEME — a `javascript:` href
    still executes on click, in another user's browser, from admin-authored
    content. Rejected at the backend because that is the source of truth."""
    from routers.admin_class_lessons import Attachment

    for good in ("https://averlearning.com/a.pdf", "http://example.com/x"):
        assert Attachment(label="Tài liệu", url=good).url == good

    for bad in ("javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,x",
                "vbscript:x", "/relative/path", "file:///etc/passwd"):
        with pytest.raises(Exception):
            Attachment(label="Tài liệu", url=bad)


def test_a_lesson_with_an_unsafe_attachment_is_rejected_whole():
    """The validator runs through LessonCreate too — a bad link cannot ride in
    on an otherwise-valid lesson."""
    from routers.admin_class_lessons import LessonCreate

    with pytest.raises(Exception):
        LessonCreate(title="Buổi 1",
                     attachments=[{"label": "x", "url": "javascript:alert(1)"}])

    ok = LessonCreate(title="Buổi 1",
                      attachments=[{"label": "x", "url": "https://ok.com/a.pdf"}])
    assert len(ok.attachments) == 1


# ── bản gọn cho thẻ trang chủ (Codex vòng 4) ────────────────────────────


@pytest.mark.asyncio
async def test_summary_mode_skips_the_unbounded_lesson_payload():
    """The home strip reads a class name and two numbers. The full payload
    carries every published lesson including unbounded body_md, so every visit to
    the home page got heavier as the teacher wrote more."""
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _db(set())):
        out = await mod.my_class(summary=True, authorization=None)

    assert out["has_class"] is True
    assert out["class"]["name"] == "C2-K12"
    assert out["progress"] is not None
    for heavy in ("lessons", "assignments", "student"):
        assert heavy not in out, f"{heavy} must not ride along in summary mode"


@pytest.mark.asyncio
async def test_summary_mode_does_not_even_query_the_lessons_table():
    """Trimming the response but still reading the rows would keep the database
    cost — the point is that the query does not run."""
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    # class_lessons raises if touched, so a read turns into a hard failure.
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _db({"class_lessons"})):
        out = await mod.my_class(summary=True, authorization=None)

    assert "degraded" not in out, "the lessons query must not have run at all"


@pytest.mark.asyncio
async def test_the_full_page_still_gets_everything():
    out = await _call(set())
    for key in ("lessons", "assignments", "student", "progress", "class"):
        assert key in out


# ── GĐ 5 — mở đề Reading/Listening ──────────────────────────────────────
#
# Reading and Listening key on DIFFERENT columns, and only one of them matches
# what the ledger stores. Reading: the reader page resolves ?test_id= against
# `reading_tests.test_id` (the public code, mig 086), while the attempt row —
# and therefore the ledger's content_id — holds the row UUID. Listening uses the
# row id at both ends. Getting this wrong opens the paper to a 404 while the
# class is still counted as owing it.


class _StartTable:
    def __init__(self, rows, store):
        self._rows, self._store = list(rows), store

    def select(self, *_a, **_k): return self
    def eq(self, f, v):
        self._rows = [r for r in self._rows if str(r.get(f)) == str(v)]
        return self
    def limit(self, *_a): return self
    def update(self, patch): self._store.append(patch); return self

    def execute(self): return _Resp(self._rows)


def _start_db(*, skill, content_id, tables=None):
    store = []
    base = {
        "class_assignment_items": [
            {"id": "item-1", "student_id": "s1", "assignment_id": "a1",
             "state": "assigned"},
        ],
        "class_assignments": [
            {"id": "a1", "cohort_id": "c1", "skill": skill, "status": "published",
             "content_id": content_id, "content_config": {}, "due_at": None},
        ],
        "student_cohort_memberships": [
            {"id": "m1", "student_id": "s1", "cohort_id": "c1", "is_active": True},
        ],
        "reading_tests": [{"id": "uuid-abc", "test_id": "CAM19-T3",
                           "status": "published", "exam_only": False}],
        "listening_tests": [{"id": "uuid-xyz", "status": "published",
                             "exam_only": False,
                             "assembled_audio_storage_path": "a/b.mp3",
                             "full_audio_storage_path": None}],
    }
    base.update(tables or {})
    db = type("DB", (), {})()
    db.table = lambda name: _StartTable(base.get(name, []), store)
    return db


async def _start(db):
    student = {"id": "s1", "cohort_id": "c1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "is_assignment_open", return_value=True), \
         patch.object(mod, "supabase_admin", db):
        return await mod.start_assignment("item-1", None)


@pytest.mark.asyncio
async def test_a_reading_task_opens_by_the_public_test_code_not_the_uuid():
    out = await _start(_start_db(skill="reading", content_id="uuid-abc"))
    assert "test_id=CAM19-T3" in out["open_url"]
    assert "uuid-abc" not in out["open_url"], (
        "the reader resolves ?test_id= against reading_tests.test_id; handing it "
        "the row UUID 404s every Reading assignment"
    )


@pytest.mark.asyncio
async def test_a_listening_task_opens_by_the_row_id():
    """Listening keys on the row id at both ends — one identifier throughout."""
    out = await _start(_start_db(skill="listening", content_id="uuid-xyz"))
    assert out["open_url"].startswith("/pages/listening-test.html?id=uuid-xyz")


@pytest.mark.asyncio
@pytest.mark.parametrize("skill,content", [("reading", "uuid-abc"),
                                           ("listening", "uuid-xyz")])
async def test_the_link_carries_the_item_id(skill, content):
    """This is what stops the ledger having to GUESS which homework an attempt
    belongs to. The page passes it back when it creates the attempt; without it
    the same paper given twice, or practised freely on the side, is
    indistinguishable from the assigned work."""
    out = await _start(_start_db(skill=skill, content_id=content))
    assert "class_item=item-1" in out["open_url"]


@pytest.mark.asyncio
async def test_a_reading_paper_that_vanished_says_so_instead_of_a_dead_link():
    db = _start_db(skill="reading", content_id="uuid-gone", tables={"reading_tests": []})
    with pytest.raises(Exception) as exc:
        await _start(db)
    assert getattr(exc.value, "status_code", None) == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("patch_row,why", [
    ({"status": "draft"}, "unpublished after it was given"),
    ({"exam_only": True}, "reserved for a mock sitting after it was given"),
])
async def test_a_reading_paper_that_closed_after_being_given_says_so(patch_row, why):
    """The paper was checked at give time — days ago. Sending the student to a
    page that 404s while the ledger keeps counting the task as owed is the worst
    of both."""
    tables = {"reading_tests": [dict({"id": "uuid-abc", "test_id": "CAM19-T3",
                                      "status": "published", "exam_only": False},
                                     **patch_row)]}
    with pytest.raises(Exception) as exc:
        await _start(_start_db(skill="reading", content_id="uuid-abc", tables=tables))
    assert getattr(exc.value, "status_code", None) == 409, why


@pytest.mark.asyncio
async def test_a_listening_paper_that_lost_its_audio_says_so():
    """Replacing section audio clears the assembled path; the row stays
    published while the player answers 422."""
    tables = {"listening_tests": [{"id": "uuid-xyz", "status": "published",
                                   "exam_only": False,
                                   "assembled_audio_storage_path": None,
                                   "full_audio_storage_path": None}]}
    with pytest.raises(Exception) as exc:
        await _start(_start_db(skill="listening", content_id="uuid-xyz", tables=tables))
    assert getattr(exc.value, "status_code", None) == 409
    assert "audio" in str(getattr(exc.value, "detail", "")).lower()


@pytest.mark.asyncio
async def test_a_listening_paper_reserved_for_a_sitting_is_refused():
    tables = {"listening_tests": [{"id": "uuid-xyz", "status": "published",
                                   "exam_only": True,
                                   "assembled_audio_storage_path": "a/b.mp3",
                                   "full_audio_storage_path": None}]}
    with pytest.raises(Exception) as exc:
        await _start(_start_db(skill="listening", content_id="uuid-xyz", tables=tables))
    assert getattr(exc.value, "status_code", None) == 409


@pytest.mark.asyncio
async def test_a_listening_paper_unpublished_after_being_given_says_so():
    tables = {"listening_tests": [{"id": "uuid-xyz", "status": "draft",
                                   "exam_only": False,
                                   "assembled_audio_storage_path": "a/b.mp3",
                                   "full_audio_storage_path": None}]}
    with pytest.raises(Exception) as exc:
        await _start(_start_db(skill="listening", content_id="uuid-xyz", tables=tables))
    assert getattr(exc.value, "status_code", None) == 409


@pytest.mark.asyncio
async def test_a_listening_paper_that_was_deleted_says_so():
    """A missing row must not fall through to a link — the deep link would look
    valid and land on "not found"."""
    with pytest.raises(Exception) as exc:
        await _start(_start_db(skill="listening", content_id="uuid-gone",
                               tables={"listening_tests": []}))
    assert getattr(exc.value, "status_code", None) == 409


# ── vá sổ hỏng: nói ra, đừng trình bày số cũ như số chính thức ───────────
#
# Serving the list when the repair fails is right — a broken repair must not
# blank the page. Serving it WITHOUT SAYING SO is not: the single thing that can
# go wrong here is a finished task still listed as owed, and a student who
# trusts that list retakes work they have already handed in.


def _stale_db():
    """A DB where the assignments read works but the attempt repair blows up."""
    tables = {
        "cohorts": [{"id": "c1", "name": "C2-K12", "course_id": None}],
        "class_lessons": [],
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "a1", "student_id": "s1",
             "submitted_at": None, "state": "assigned"},
        ],
        "class_assignments": [
            {"id": "a1", "cohort_id": "c1", "skill": "reading", "status": "published",
             "content_id": "t1", "content_config": {}, "due_at": None,
             "title": "Đề đọc 1"},
        ],
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []), name == "reading_test_attempts")
    return db


async def _call_stale(summary=False):
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _stale_db()):
        return await mod.my_class(summary=summary, authorization=None)


@pytest.mark.asyncio
async def test_a_failed_repair_is_named_on_the_class_page():
    out = await _call_stale()
    assert "homework_stale" in out.get("degraded", []), (
        "the list is served, so it must say it may be behind"
    )
    assert out["assignments"], "and the list itself must still be there"


@pytest.mark.asyncio
async def test_a_clean_read_names_nothing_on_the_class_page():
    out = await _call(set())
    assert "homework_stale" not in out.get("degraded", [])


@pytest.mark.asyncio
async def test_my_assignments_says_so_too():
    """The home strip reads this endpoint, not /me. Warning on one screen and
    staying quiet on the other is how the two disagree about the same fact."""
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _stale_db()):
        out = await mod.my_assignments(None)
    assert out["homework_stale"] is True
    assert out["assignments"]


@pytest.mark.asyncio
async def test_my_assignments_is_quiet_when_the_repair_worked():
    student = {"id": "s1", "cohort_id": "c1", "full_name": "A", "student_code": "S1"}
    with patch.object(mod, "get_supabase_user", AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _db(set())):
        out = await mod.my_assignments(None)
    assert "homework_stale" not in out


def _course_homework_db():
    tables = {
        "class_assignment_items": [
            {"id": "item-1", "assignment_id": "a1", "student_id": "s1",
             "submitted_at": None, "state": "assigned", "score": None},
        ],
        "class_assignments": [
            {"id": "a1", "cohort_id": "c1", "skill": "course",
             "status": "published", "content_id": "bank-1",
             "content_config": {}, "due_at": None, "title": "Grammar 2"},
        ],
    }
    db = type("DB", (), {})()
    db.table = lambda name: _Table(tables.get(name, []), False)
    return db


async def _course_homework_with_shape(shape):
    student = {"id": "s1", "cohort_id": "c1"}
    reread = [{"id": "item-1", "assignment_id": "a1", "student_id": "s1",
               "submitted_at": None, "state": "assigned", "score": None}]
    with patch.object(mod, "get_supabase_user",
                      AsyncMock(return_value={"id": "u1"})), \
         patch.object(mod, "_student_for_user", return_value=student), \
         patch.object(mod, "supabase_admin", _course_homework_db()), \
         patch.object(mod, "reconcile_test_attempts", return_value=0), \
         patch.object(mod, "reconcile_course_items", return_value=0), \
         patch.object(mod, "_reread_items", return_value=reread), \
         patch.object(mod, "bank_has_writing", return_value=shape):
        return await mod.my_assignments(None)


@pytest.mark.asyncio
async def test_an_unknown_writing_shape_marks_learner_homework_stale():
    out = await _course_homework_with_shape(None)
    assert out["assignments"][0]["writing_expected"] is None
    assert out["homework_stale"] is True


@pytest.mark.asyncio
async def test_a_real_zero_writing_shape_does_not_mark_homework_stale():
    out = await _course_homework_with_shape(False)
    assert out["assignments"][0]["writing_expected"] is False
    assert "homework_stale" not in out
