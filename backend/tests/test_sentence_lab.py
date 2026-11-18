"""Kho luyện viết câu 45 buổi (Course 5): importer, bộ chấm GPT và lượt viết lại.

Không gọi mạng: lượt gọi model được thay bằng hàm giả. Gói nội dung thật không
nằm trong repo (khóa chấm là dữ liệu private) nên importer được kiểm trên một
gói tổng hợp đúng hình dạng.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import zipfile
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from scripts import import_sentence_lab_course5 as imp
from services import quiz_service as qs
from services import sentence_lab_grader as g


@pytest.fixture(autouse=True)
def _no_call_cap(request, monkeypatch):
    """Trần lượt gọi/ngày đọc DB; các test khác không quan tâm thì tắt nó."""
    if "call_cap" not in request.node.name:
        monkeypatch.setattr(g, "enforce_daily_call_cap", lambda _u: None)


# ── Phản hồi mẫu ─────────────────────────────────────────────────────────────
def _fb(**over):
    base = {
        "item_id": "S01-Q01", "mode": "coach", "status": "revise",
        "scores": {"meaning": 3, "grammar": 2, "task": 2, "lexis": 1, "mechanics": 1},
        "total": 9, "strength_vi": "Giữ đúng ý.",
        "errors": [{"code": "SENT", "dimension": "grammar", "offending_text": "",
                    "reason_vi": "Thiếu động từ be.",
                    "hint_vi": "Thêm dạng be phù hợp trước affordable."}],
        "has_more_issues": False, "minimal_correction": None,
        "optional_alternative": None, "next_action_vi": "Thêm động từ.",
        "needs_review_reason_vi": None,
    }
    base.update(over)
    return base


RESP = "Public transport affordable for many low-income workers."
REF = "Public transport is affordable for many low-income workers."


def _check(fb, *, mode="coach", response=RESP, item_id="S01-Q01"):
    return g.validate_feedback(fb, item_id=item_id, mode=mode, response=response,
                               reference_answer=REF)


def test_valid_coach_revise_passes():
    assert _check(_fb()) == []


def test_valid_review_revise_needs_minimal_correction():
    assert _check(_fb(mode="review"), mode="review") != []
    assert _check(_fb(mode="review", minimal_correction=REF), mode="review") == []


def test_accepted_requires_full_scores_and_no_errors():
    ok = _fb(status="accepted", errors=[], total=10,
             scores={"meaning": 3, "grammar": 3, "task": 2, "lexis": 1, "mechanics": 1})
    assert _check(ok, response=REF) == []
    assert _check({**ok, "total": 9}, response=REF) != []
    assert _check({**ok, "errors": _fb()["errors"]}, response=REF) != []


def test_total_must_equal_components_and_deductions_must_be_explained():
    assert any("Total" in p for p in _check(_fb(total=8)))
    fb = _fb(scores={"meaning": 2, "grammar": 2, "task": 2, "lexis": 1, "mechanics": 1},
             total=8)
    assert any("Unexplained deduction in meaning" in p for p in _check(fb))


def test_error_dimension_must_carry_a_deduction():
    fb = _fb(scores={"meaning": 3, "grammar": 3, "task": 1, "lexis": 1, "mechanics": 1},
             total=9, has_more_issues=True)
    assert any("needs a deduction" in p for p in _check(fb))


def test_evidence_must_be_quoted_from_the_learner_sentence():
    fb = _fb(errors=[{**_fb()["errors"][0], "offending_text": "buses"}])
    assert any("not found" in p for p in _check(fb))


def test_empty_response_only_no_attempt():
    assert any("no_attempt" in p for p in _check(_fb(), response="   "))
    na = _fb(status="no_attempt", errors=[], total=0, strength_vi="",
             scores={"meaning": 0, "grammar": 0, "task": 0, "lexis": 0, "mechanics": 0})
    assert _check(na, response="") == []


def test_needs_review_has_null_scores_and_no_speculative_fix():
    nr = _fb(status="needs_review", scores=None, total=None, errors=[],
             needs_review_reason_vi="Khóa chấm mâu thuẫn với đề.")
    assert _check(nr) == []
    assert _check({**nr, "minimal_correction": REF}, mode="review") != []
    assert _check({**nr, "needs_review_reason_vi": ""}) != []


def test_coach_must_not_reveal_the_reference_answer_anywhere():
    leak = _fb(next_action_vi=f"Viết: {REF}")
    assert any("reveals" in p for p in _check(leak))
    leak2 = _fb(errors=[{**_fb()["errors"][0],
                         "hint_vi": "public transport IS affordable for many low-income workers"}])
    assert any("reveals" in p for p in _check(leak2))
    assert any("Coach mode" in p for p in _check(_fb(minimal_correction=REF)))


def test_mode_and_item_must_match_and_two_errors_max():
    assert any("Mode" in p for p in _check(_fb(mode="review"), mode="coach"))
    assert any("Item ID" in p for p in _check(_fb(item_id="S01-Q02")))
    three = _fb(errors=_fb()["errors"] * 3, has_more_issues=True)
    assert any("at most two" in p for p in _check(three))


def test_pack_feedback_examples_shape():
    """Năm ví dụ hợp lệ của gói có cùng hình dạng — dựng lại hai nhánh còn lại."""
    review_accept = _fb(mode="review", status="accepted", errors=[], total=10,
                        scores={"meaning": 3, "grammar": 3, "task": 2, "lexis": 1,
                                "mechanics": 1},
                        optional_alternative="Public transport remains affordable "
                                             "for many low-income workers.")
    assert _check(review_accept, mode="review", response=REF) == []


# ── Gói câu và gọi lại ───────────────────────────────────────────────────────
def _entries(n=12):
    return [{"qid": f"S01-Q{i:02d}", "prompt": "p", "explain": "e",
             "item": {"id": f"S01-Q{i:02d}"}, "key": {"answer": REF},
             "response": RESP} for i in range(1, n + 1)]


def _good(qid, mode="coach"):
    return _fb(item_id=qid, mode=mode,
               **({"minimal_correction": REF} if mode == "review" else {}))


def test_twelve_items_are_two_calls_of_six():
    calls = []

    async def fake(batch, mode, **_k):
        calls.append([e["qid"] for e in batch])
        return {e["qid"]: _good(e["qid"]) for e in batch}

    with patch.object(g, "_call_model", fake):
        rows, _ = asyncio.run(g.grade(_entries(), mode="coach"))
    assert [len(c) for c in calls] == [6, 6]
    assert [r["qid"] for r in rows] == [e["qid"] for e in _entries()]
    assert all(r["ok"] is False and r["status"] == "revise" and r["score"] == 9
               for r in rows)
    assert rows[0]["feedback"]["errors"][0]["code"] == "SENT"


def test_invalid_items_get_exactly_one_retry_call():
    calls = []

    async def fake(batch, mode, **_k):
        calls.append(len(batch))
        out = {e["qid"]: _good(e["qid"]) for e in batch}
        if len(calls) == 1:
            out["S01-Q02"] = _fb(item_id="S01-Q02", total=3)   # sai tổng
            out.pop("S01-Q03")                                # bỏ sót
        return out

    with patch.object(g, "_call_model", fake):
        rows, _ = asyncio.run(g.grade(_entries(), mode="coach"))
    assert sorted(calls) == [2, 6, 6]
    assert all(r["ok"] is not None for r in rows)


def test_still_invalid_after_retry_is_ok_none_not_fake_praise():
    async def fake(batch, mode, **_k):
        return {e["qid"]: _fb(item_id=e["qid"], total=1) for e in batch}

    with patch.object(g, "_call_model", fake):
        rows, _ = asyncio.run(g.grade(_entries(3), mode="coach"))
    assert all(r["ok"] is None and r["feedback"] is None for r in rows)


def test_provider_error_marks_batch_ungraded():
    async def boom(batch, mode, **_k):
        raise RuntimeError("down")

    with patch.object(g, "_call_model", boom):
        rows, _ = asyncio.run(g.grade(_entries(6), mode="coach"))
    assert all(r["ok"] is None for r in rows)


def test_empty_answer_is_no_attempt_without_a_model_call():
    async def never(*_a, **_k):
        raise AssertionError("must not call the model")

    entries = _entries(1)
    entries[0]["response"] = "  "
    with patch.object(g, "_call_model", never):
        rows, _ = asyncio.run(g.grade(entries, mode="coach"))
    assert rows[0]["status"] == "no_attempt" and rows[0]["ok"] is False


def test_model_payload_carries_public_item_key_and_previous_response():
    e = {**_entries(1)[0], "previous_response": "old", "attempt": 2}
    p = g._payload(e, "review")
    assert p["item_id"] == "S01-Q01" and p["mode"] == "review"
    assert p["key"]["answer"] == REF and p["previous_response"] == "old"


def test_system_prompt_is_the_pack_prompt_plus_catalog():
    text = g._system_prompt()
    assert "COACH, lần nộp đầu" in text and "WORDORDER" in text
    assert "STYLE:" not in text


# ── Importer ─────────────────────────────────────────────────────────────────
def _package(tmp_path, mutate=None):
    sessions, items, keys = [], [], []
    for s in range(1, 46):
        sid = f"S{s:02d}"
        s_items = []
        for q in range(1, 13):
            iid = f"{sid}-Q{q:02d}"
            pub = {"session_id": sid, "group_id": "G1", "id": iid, "stage": "A",
                   "operation": "sua_loi", "task": "task2", "source": "src",
                   "instruction": "ins", "required": ["req"], "review_of": []}
            items.append(pub)
            s_items.append({k: v for k, v in pub.items()
                            if k not in ("session_id", "group_id")})
            keys.append({"item_id": iid, "answer": "An answer.", "meaning": ["m"],
                         "required": ["req"], "variants": "v", "explanation": "x",
                         "error_tags": ["SENT"]})
        sessions.append({"id": sid, "group": "G1", "title": f"T{s}", "items": s_items,
                         "checkpoint": s in (1, 45),
                         "show_guidance_after_first_submission": s in (1, 45),
                         "worked": {"instruction": "i", "source": "s", "answer": "a",
                                    "explanation": "e"}})
    course = {"content_version": "cv1", "groups": [{"id": "G1", "title": "Nhóm 1"}],
              "sessions": sessions}
    if mutate:
        mutate(course, items, keys)
    files = {
        "public/course_public.json": json.dumps(course).encode(),
        "public/items_public.jsonl": "\n".join(json.dumps(i) for i in items).encode(),
        "private/grading_keys.private.jsonl": "\n".join(json.dumps(k) for k in keys).encode(),
        "public/error_codes.json": b"{}",
        "private/ai_grader_prompt.md": b"# prompt",
    }
    manifest = {"schema_version": "1.0", "content_version": "cv1", "files": [
        {"path": p, "sha256": hashlib.sha256(b).hexdigest()} for p, b in files.items()]}
    zpath = tmp_path / "pack.zip"
    with zipfile.ZipFile(zpath, "w") as zf:
        zf.writestr("manifest.json", json.dumps(manifest))
        for p, b in files.items():
            zf.writestr(p, b)
    return zpath


def test_importer_builds_45_banks_with_keys_server_side(tmp_path):
    plan = imp.build_plan(imp.read_package(_package(tmp_path)))
    banks = plan["banks"]
    assert len(banks) == 45 and banks[0]["code"] == "C5-SL-S01"
    assert banks[44]["code"] == "C5-SL-S45"
    row = banks[0]["rows"][0]
    assert row["type"] == "writing" and row["counts_toward_mastery"] is False
    assert row["segments"]["sentence_lab"]["key"]["answer"] == "An answer."
    assert row["accept"] is None and row["answer"] is None
    lab = banks[0]["meta"]["sentence_lab"]
    assert lab["kind"] == g.KIND and lab["show_guidance_after_first_submission"] is True
    assert g.is_sentence_lab_bank({"meta": banks[0]["meta"]})


def test_importer_dry_run_never_touches_the_database(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "commit_plan", lambda *_a, **_k: pytest.fail("wrote"))
    assert imp.main(["--package", str(_package(tmp_path))]) == 0


@pytest.mark.parametrize("mutate, needle", [
    (lambda c, i, k: k.pop(), "không có khóa chấm"),
    (lambda c, i, k: k[0].update(required=["khác"]), "required"),
    (lambda c, i, k: c["sessions"].pop(), "45 buổi"),
    (lambda c, i, k: i[0].update(answer="leak"), "trường khóa"),
    (lambda c, i, k: c["sessions"][0]["items"][0].update(source="changed"),
     "khác nhau"),
])
def test_importer_rejects_inconsistent_packages(tmp_path, mutate, needle):
    with pytest.raises(SystemExit) as e:
        imp.build_plan(imp.read_package(_package(tmp_path, mutate)))
    assert needle in str(e.value)


def test_importer_rejects_tampered_file(tmp_path):
    z = _package(tmp_path)
    files = imp.read_package(z)
    files["private/grading_keys.private.jsonl"] += b"\n"
    with pytest.raises(SystemExit) as e:
        imp.build_plan(files)
    assert "SHA-256" in str(e.value)


# ── quiz_service: nộp, trạng thái, viết lại ─────────────────────────────────
ITEM = "it-1"
LAB_BANK = {"id": "b1", "meta": {"sentence_lab": {
    "kind": g.KIND, "session_id": "S01", "title": "T",
    "show_guidance_after_first_submission": True,
    "guide": {"objective": "o", "worked": {"answer": "WORKED"}}}}}


def _seg(qid):
    return {"sentence_lab": {"item": {"id": qid, "source": "src"},
                             "key": {"answer": REF}}}


class _Q:
    def __init__(self, rows):
        self._rows = list(rows)

    def eq(self, c, v): return _Q([r for r in self._rows if r.get(c) == v])
    def order(self, *_a, **_k): return self
    def limit(self, *_a): return self

    def execute(self):
        class R: pass
        r = R(); r.data = [dict(x) for x in self._rows]; return r


class _DB:
    def __init__(self, tables):
        self.t, self.inserts, self.updates = tables, [], []

    def table(self, name):
        rows = self.t.get(name, [])
        db = self

        class T:
            def select(self, *_a, **_k): return _Q(rows)

            def insert(self, row):
                class _I:
                    def execute(self):
                        db.inserts.append(row)
                        class R: data = [{**row, "id": "new", "graded_at": "now"}]
                        return R()
                return _I()

            def update(self, patch):
                class _U:
                    filters = []
                    def eq(self, c, v): self.filters = self.filters + [(c, v)]; return self
                    def is_(self, c, v): self.filters = self.filters + [(c, v)]; return self
                    def execute(_s):
                        db.updates.append({"table": name, "filters": _s.filters, **patch})
                        class R: data = [{"id": "sub"}]
                        return R()
                return _U()
        return T()


def _questions():
    return [{"bank_id": "b1", "qid": q, "type": "writing", "prompt": "đề",
             "explain": "**Đáp án tham khảo:** " + REF, "order": n,
             "segments": _seg(q), "subtype": "Sửa lỗi · Task 2"}
            for n, q in enumerate(("S01-Q01", "S01-Q02"))]


def test_submit_routes_lab_bank_to_the_gpt_grader_in_coach_mode():
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": []})
    seen = {}

    async def fake_lab(entries, *, mode, **_k):
        seen["mode"] = mode
        seen["keys"] = [e["key"]["answer"] for e in entries]
        return ([{"qid": e["qid"], "prompt": e["prompt"], "explain": e["explain"],
                  "answer": e["response"], "ok": True, "status": "accepted",
                  "score": 10, "feedback": {}, "corrected": None, "issues": []}
                 for e in entries], "gpt-test")

    async def never(*_a, **_k):
        raise AssertionError("Course 1 grader must not run for a lab bank")

    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: LAB_BANK), \
            patch.object(qs, "_assignment_item_for", lambda *_a, **_k: {"id": ITEM}), \
            patch.object(qs, "refresh_course_completion", lambda **_k: None), \
            patch.object(qs.sentence_lab_grader, "grade", fake_lab), \
            patch.object(qs.course_writing_grader, "grade", never):
        out = asyncio.run(qs.submit_course_writing(
            user_id="u1", bank_id="b1", answers={"S01-Q01": "a", "S01-Q02": "b"}))
    assert seen == {"mode": "coach", "keys": [REF, REF]}
    assert db.inserts[0]["clean"] == 2 and db.inserts[0]["model"] == "gpt-test"
    # Đáp án tham khảo được lưu vào bản chụp nhưng chưa trả cho học viên.
    assert all(i["explain"] for i in db.inserts[0]["items"])
    assert all("explain" not in i for i in out["items"])


def _state(sub_items, open_=True):
    subs = ([{"id": "sub", "class_assignment_item_id": ITEM, "attempt_no": 1,
              "items": sub_items, "total": 2, "clean": 1, "graded_at": "t"}]
            if sub_items is not None else [])
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": subs,
              "course_writing_drafts": []})
    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_for_review_or_404", lambda *_a, **_k: LAB_BANK), \
            patch.object(qs, "_assignment_item_for_review",
                         lambda *_a, **_k: {"id": ITEM}), \
            patch.object(qs, "course_section_attempt_no", lambda _i: 1), \
            patch.object(qs, "_lab_assignment_open", lambda *_a: open_):
        return qs.course_writing_state(user_id="u1", bank_id="b1")


def _graded(**extra):
    return [{"qid": q, "answer": RESP, "explain": "REF", "ok": n == 0, **extra}
            for n, q in enumerate(("S01-Q01", "S01-Q02"))]


def test_state_before_submit_hides_checkpoint_guide_and_keys():
    st = _state(None)
    lab = st["sentence_lab"]
    assert lab["guide"] is None and lab["guide_locked"] is True
    q = st["questions"][0]
    assert q["sentence_lab_item"] == {"id": "S01-Q01", "source": "src"}
    assert "explain" not in q
    assert REF not in json.dumps(st) and '"key"' not in json.dumps(st)


def test_state_after_submit_shows_guide_but_not_answers_until_revision():
    st = _state(_graded())
    assert st["sentence_lab"]["guide"]["worked"]["answer"] == "WORKED"
    assert st["sentence_lab"]["revision_done"] is False
    assert all("explain" not in i for i in st["submission"]["items"])
    assert all("explain" not in q for q in st["questions"])


def test_state_after_revision_reveals_reference_answers():
    st = _state(_graded(revision=None))
    assert st["sentence_lab"]["revision_done"] is True
    assert st["submission"]["items"][0]["explain"] == "REF"
    assert st["questions"][0]["explain"].startswith("**Đáp án tham khảo:**")


def _revise(answers, sub_items, grade=None, open_=True):
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": [
        {"id": "sub", "class_assignment_item_id": ITEM, "attempt_no": 1,
         "items": sub_items, "graded_at": "t"}]})

    async def default_grade(entries, *, mode, **_k):
        assert mode == "review"
        return ([{"qid": e["qid"], "answer": e["response"], "ok": True,
                  "status": "accepted", "score": 10, "feedback": {"status": "accepted"},
                  "corrected": None} for e in entries], "gpt-test")

    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_for_review_or_404", lambda *_a, **_k: LAB_BANK), \
            patch.object(qs, "_assignment_item_for_review",
                         lambda *_a, **_k: {"id": ITEM}), \
            patch.object(qs, "course_section_attempt_no", lambda _i: 1), \
            patch.object(qs, "_lab_assignment_open", lambda *_a: open_), \
            patch.object(qs.sentence_lab_grader, "grade", grade or default_grade):
        out = asyncio.run(qs.revise_course_writing(
            user_id="u1", bank_id="b1", answers=answers))
    return out, db


def test_revision_grades_review_mode_and_keeps_the_first_answer():
    out, db = _revise({"S01-Q02": "Public transport is affordable."}, _graded())
    items = db.updates[0]["items"]
    assert items[1]["answer"] == RESP, "câu đầu không bị ghi đè"
    assert items[1]["revision"]["answer"] == "Public transport is affordable."
    assert items[0]["revision"] is None
    assert ("items->0->revision", "null") in db.updates[0]["filters"]
    assert "clean" not in db.updates[0] and "total" not in db.updates[0]
    assert out["revision_done"] is True


def test_revision_with_no_answers_just_closes_without_a_model_call():
    async def never(*_a, **_k):
        raise AssertionError("no model call")

    _out, db = _revise({}, _graded(), grade=never)
    assert all(i["revision"] is None for i in db.updates[0]["items"])


def test_revision_is_once_and_capped_at_six():
    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, _graded(revision=None))
    assert e.value.status_code == 409
    many = {f"S01-Q{i:02d}": "x" for i in range(1, 8)}
    items = [{"qid": q, "answer": "a", "ok": False} for q in many]
    with pytest.raises(HTTPException) as e:
        _revise(many, items)
    assert e.value.status_code == 422


def test_revision_grader_failure_does_not_close_the_round():
    async def broken(entries, **_k):
        return ([{"qid": e["qid"], "answer": e["response"], "ok": None}
                 for e in entries], "gpt-test")

    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, _graded(), grade=broken)
    assert e.value.status_code == 503


def test_revision_refused_for_non_lab_banks():
    db = _DB({})
    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_for_review_or_404",
                         lambda *_a, **_k: {"id": "b1", "meta": {}}):
        with pytest.raises(HTTPException) as e:
            asyncio.run(qs.revise_course_writing(user_id="u", bank_id="b1", answers={}))
    assert e.value.status_code == 404


def test_play_path_strips_the_guide_from_bank_meta():
    src = open(qs.__file__, encoding="utf-8").read()
    assert 'meta["sentence_lab"] = {k: v for k, v in lab.items() if k != "guide"}' in src


# ── SENTLAB-0101 FR-002/FR-003: lộ đáp án gần đúng, biến thể ─────────────────
def test_coach_near_copy_or_variant_of_the_answer_is_a_reveal():
    near = _fb(errors=[{**_fb()["errors"][0],
                        "hint_vi": "Viết: Public transport is quite affordable for many "
                                   "low income workers."}])
    assert any("reveals" in p for p in _check(near))
    variant = "Many low-income workers can afford public transport."
    leak = _fb(next_action_vi="Thử: many low-income workers can afford public transport")
    assert any("reveals" in p for p in g.validate_feedback(
        leak, item_id="S01-Q01", mode="coach", response=RESP,
        reference_answer=REF, variants=[variant]))


def test_quoting_the_learners_own_sentence_is_not_a_reveal():
    quote = _fb(errors=[{**_fb()["errors"][0],
                         "reason_vi": "Câu 'Public transport affordable for many "
                                      "low-income workers' thiếu động từ."}])
    assert _check(quote) == []


def test_model_request_carries_no_learner_identity():
    payload = json.dumps(g._payload({"qid": "S01-Q01", "item": {"source": "s"},
                                     "key": {"answer": REF}, "response": "x"}, "coach"))
    assert "u1" not in payload and "user" not in payload and "email" not in payload


# ── FR-004: viết lại chỉ khi bài giao còn nhận bài ───────────────────────────
def test_rewrite_after_the_deadline_is_refused_before_any_model_call():
    async def never(*_a, **_k):
        raise AssertionError("no model call after the deadline")

    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, _graded(), grade=never, open_=False)
    assert e.value.status_code == 404


def test_closing_without_rewrites_still_works_after_the_deadline():
    _out, db = _revise({}, _graded(), open_=False)
    assert all(i["revision"] is None for i in db.updates[0]["items"])


def test_state_reports_whether_rewriting_is_open():
    assert _state(_graded())["sentence_lab"]["revision_open"] is True
    assert _state(_graded(), open_=False)["sentence_lab"]["revision_open"] is False
    assert _state(_graded(revision=None))["sentence_lab"]["revision_open"] is False


def test_course1_regrade_skips_sentence_lab_rows():
    rows = [{"id": "r1", "user_id": "u", "items": [
        {"qid": "S01-Q01", "answer": "a", "ok": None, "mode": "coach"}]}]

    async def never(*_a, **_k):
        raise AssertionError("Course 1 grader must not regrade a lab row")

    with patch.object(qs, "_report_pages", lambda *_a, **_k: rows), \
            patch.object(qs.course_writing_grader, "grade", never):
        assert asyncio.run(qs.regrade_failed_course_writing(object())) == []


# ── FR-007: trần lượt gọi mỗi học viên mỗi ngày ──────────────────────────────
class _CountDB:
    def __init__(self, count=None, boom=False):
        self.count, self.boom = count, boom

    def table(self, name):
        assert name == "ai_usage_logs"
        outer = self

        class Q:
            def select(self, *_a, **_k): return self
            def eq(self, *_a): return self
            def gte(self, *_a): return self
            def limit(self, *_a): return self

            def execute(self):
                if outer.boom:
                    raise RuntimeError("db down")
                class R: pass
                r = R(); r.count = outer.count; r.data = []
                return r
        return Q()


def _cap(db, cap=40):
    import database
    with patch.object(database, "supabase_admin", db), \
            patch.object(g.settings, "SENTENCE_LAB_MAX_CALLS_PER_USER_PER_DAY", cap):
        g.enforce_daily_call_cap("u1")


def test_call_cap_allows_under_and_refuses_at_the_cap():
    _cap(_CountDB(count=39))
    with pytest.raises(HTTPException) as e:
        _cap(_CountDB(count=40))
    assert e.value.status_code == 429 and "reset_at" in e.value.detail


def test_call_cap_fails_closed_on_lookup_error_or_bad_config():
    for db, cap in ((_CountDB(boom=True), 40), (_CountDB(count=None), 40),
                    (_CountDB(count=0), 0)):
        with pytest.raises(HTTPException) as e:
            _cap(db, cap)
        assert e.value.status_code == 503


def test_call_cap_is_checked_before_the_model_on_submit_and_rewrite():
    src = open(qs.__file__, encoding="utf-8").read()
    for marker in ('mode="coach", usage_user_id=user_id)',
                   'entries, mode="review", usage_user_id=user_id)'):
        head = src[:src.index(marker)]
        assert "enforce_daily_call_cap" in head[-900:], marker


# ── FR-001: importer chỉ ghi khi project ref khớp ────────────────────────────
def test_importer_commit_requires_matching_project_ref(monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://prodref1234.supabase.co")
    with pytest.raises(SystemExit):
        imp.check_target("zjphffoujxkpltixsbzj")
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://zjphffoujxkpltixsbzj.supabase.co")
    imp.check_target("zjphffoujxkpltixsbzj")


def test_importer_commit_without_expect_ref_writes_nothing(tmp_path, monkeypatch):
    monkeypatch.setattr(imp, "commit_plan", lambda *_a, **_k: pytest.fail("wrote"))
    with pytest.raises(SystemExit):
        imp.main(["--package", str(_package(tmp_path)), "--commit"])
