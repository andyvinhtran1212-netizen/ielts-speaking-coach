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
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from scripts import import_sentence_lab_course5 as imp
from services import quiz_service as qs
from services import sentence_lab_grader as g


@pytest.fixture(autouse=True)
def _prompt(monkeypatch):
    """Prompt thật là nội dung private của gói, không có trong repo."""
    monkeypatch.setattr(g.settings, "SENTENCE_LAB_PROMPT", "# PROMPT GÓI (test)",
                        raising=False)


@pytest.fixture(autouse=True)
def _no_call_cap(request, monkeypatch):
    """Trần lượt gọi/ngày đọc DB; các test khác không quan tâm thì tắt nó."""
    if "call_cap" not in request.node.name:
        monkeypatch.setattr(g, "enforce_daily_call_cap", lambda _u, _calls=1: None)


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


def test_system_prompt_is_the_configured_prompt_plus_catalog():
    text = g._system_prompt()
    assert text.startswith("# PROMPT GÓI (test)") and "WORDORDER" in text
    assert "STYLE:" not in text


def test_private_prompt_is_not_shipped_in_the_repo():
    from pathlib import Path
    assets = Path(g.__file__).resolve().parent.parent / "assets" / "sentence_lab"
    assert not (assets / "ai_grader_prompt.md").exists()


def test_missing_prompt_pauses_lab_grading(monkeypatch):
    monkeypatch.setattr(g.settings, "SENTENCE_LAB_PROMPT", "")
    with pytest.raises(HTTPException) as e:
        g.ensure_enabled()
    assert e.value.status_code == 503 and e.value.detail["work_saved"] is True


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
    # `key_sha` như lượt nộp thật ghi: dấu vân tay khóa chấm lúc chấm lần đầu.
    return [{"qid": q, "answer": RESP, "explain": "REF", "ok": n == 0,
             "key_sha": g.key_fingerprint(_seg(q)["sentence_lab"]["key"]), **extra}
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


def test_rewrite_is_refused_when_the_task_changed_since_submission():
    """Codex #2371: a re-import under the same qid must not grade the rewrite
    against a different task."""
    async def never(*_a, **_k):
        raise AssertionError("no model call for a changed task")

    stale = [dict(i, item={"id": i["qid"], "source": "OLD"}) for i in _graded()]
    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, stale, grade=never)
    assert e.value.status_code == 409 and e.value.detail["changed"] == ["S01-Q01"]
    same = [dict(i, item={"id": i["qid"], "source": "src"}) for i in _graded()]
    out, _db = _revise({"S01-Q01": "x"}, same)
    assert out["revision_done"] is True
    _out, db = _revise({}, stale, grade=never)   # finalising still works
    assert db.updates


def test_rewrite_is_refused_when_only_the_grading_key_changed():
    """Advisor 19/11: a re-import that keeps the public task but changes the
    grading key must not grade the rewrite against the NEW key while the first
    submission was graded against the OLD one."""
    async def never(*_a, **_k):
        raise AssertionError("no model call when the key changed")

    old_key = [dict(i, item={"id": i["qid"], "source": "src"},
                    key_sha=g.key_fingerprint({"answer": "An OLD answer."}))
               for i in _graded()]
    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, old_key, grade=never)
    assert e.value.status_code == 409 and e.value.detail["changed"] == ["S01-Q01"]
    _out, db = _revise({}, old_key, grade=never)    # finalising still works
    assert db.updates


def test_rewrite_without_a_key_fingerprint_is_refused():
    """A snapshot that cannot prove the key is unchanged is not regraded."""
    async def never(*_a, **_k):
        raise AssertionError("no model call without a key fingerprint")

    legacy = [{k: v for k, v in i.items() if k != "key_sha"} for i in _graded()]
    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q02": "x"}, legacy, grade=never)
    assert e.value.status_code == 409 and e.value.detail["changed"] == ["S01-Q02"]


def test_key_fingerprint_is_stable_and_key_sensitive():
    a = {"answer": REF, "variants": ["x"], "required": ["is"]}
    assert g.key_fingerprint(a) == g.key_fingerprint(dict(reversed(list(a.items()))))
    assert g.key_fingerprint(a) != g.key_fingerprint({**a, "answer": REF + " "})
    assert g.key_fingerprint(None) == g.key_fingerprint({})
    assert REF not in g.key_fingerprint(a)


def test_key_fingerprint_never_reaches_the_learner():
    for st in (_state(_graded()), _state(_graded(revision=None))):
        assert "key_sha" not in json.dumps(st)


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


def test_archived_class_counts_as_a_closed_rewrite_window():
    """Codex #2371: the archived-class gate raises 409 cohort_archived, not 404.
    It must close the rewrite window, not break the results read."""
    from services.class_archive_service import cohort_archived_error

    def archived(*_a, **_k):
        raise cohort_archived_error(learner=True)

    with patch.object(qs, "_bank_meta_or_404", archived):
        assert qs._lab_assignment_open("b1", "u1", {"id": ITEM}) is False

    def other_conflict(*_a, **_k):
        raise HTTPException(409, "Bài này cần mở bằng trình học khác")

    with patch.object(qs, "_bank_meta_or_404", other_conflict):
        with pytest.raises(HTTPException) as e:
            qs._lab_assignment_open("b1", "u1", {"id": ITEM})
    assert e.value.status_code == 409


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


def _cap(db, cap=40, calls=1, user="u1"):
    import database
    with patch.object(database, "supabase_admin", db), \
            patch.object(g.settings, "SENTENCE_LAB_MAX_CALLS_PER_USER_PER_DAY", cap):
        return g.enforce_daily_call_cap(user, calls)


@pytest.fixture(autouse=True)
def _fresh_started(monkeypatch):
    monkeypatch.setattr(g, "_STARTED", {})


def test_call_cap_allows_under_and_refuses_at_the_cap():
    assert _cap(_CountDB(count=39)) == 1
    with pytest.raises(HTTPException) as e:
        _cap(_CountDB(count=40))
    assert e.value.status_code == 429 and "reset_at" in e.value.detail


def test_planned_calls_reserve_the_retry():
    assert [g.planned_calls(n) for n in (0, 1, 6, 7, 12)] == [0, 2, 2, 3, 3]


def test_call_cap_reserves_the_whole_batch_at_the_39_40_boundary():
    # Nộp 12 câu cần tối đa 3 lượt (2 + 1 gọi lại); viết lại ≤6 câu cần 2.
    # Each boundary is its own learner: the process counter ratchets up to the
    # highest ledger count it has seen that day (the ledger never shrinks).
    submit, revise = g.planned_calls(12), g.planned_calls(6)
    assert _cap(_CountDB(count=37), calls=submit, user="s37") == 3
    for used in (38, 39, 40):
        with pytest.raises(HTTPException) as e:
            _cap(_CountDB(count=used), calls=submit, user=f"s{used}")
        assert e.value.status_code == 429
    assert _cap(_CountDB(count=38), calls=revise, user="r38") == 2
    for used in (39, 40):
        with pytest.raises(HTTPException) as e:
            _cap(_CountDB(count=used), calls=revise, user=f"r{used}")
        assert e.value.status_code == 429


def test_call_cap_counts_calls_the_ledger_has_not_written_yet():
    for _ in range(39):
        g._mark_started("u1")
    with pytest.raises(HTTPException) as e:
        _cap(_CountDB(count=0), calls=2)
    assert e.value.status_code == 429
    assert _cap(_CountDB(count=0), calls=2, user="u2") == 40


def test_call_cap_adds_new_calls_on_top_of_the_ledger_after_a_restart():
    """Codex #2371: 37 ledger rows, empty process counter, usage writes delayed.
    Two successive 12-item submits must not both pass a 40 cap."""
    assert _cap(_CountDB(count=37), calls=3) == 3
    g._mark_started("u1")
    g._mark_started("u1")          # first submit used 2 calls, not yet logged
    with pytest.raises(HTTPException) as e:
        _cap(_CountDB(count=37), calls=3)
    assert e.value.status_code == 429
    # A ledger that has caught up is not counted twice.
    assert _cap(_CountDB(count=39), calls=1) == 1


def test_call_cap_lets_an_all_blank_submit_through_without_calls():
    assert _cap(_CountDB(count=40), calls=0) == 0


def test_call_budget_stops_the_retry_and_never_exceeds_the_cap():
    calls = []

    async def bad(batch, mode, *, usage_user_id):
        calls.append(len(batch))
        return {}

    with patch.object(g, "_call_model", bad):
        out, _ = asyncio.run(g.grade(_entries(), mode="coach", call_budget=2))
    assert calls == [6, 6]
    assert all(r.get("ok") is None for r in out)


def test_submit_and_rewrite_pass_the_reserved_budget_to_the_grader():
    src = open(qs.__file__, encoding="utf-8").read()
    assert src.count("call_budget=budget") == 2
    assert src.count("sentence_lab_grader.planned_calls(") == 2


def test_call_cap_fails_closed_on_lookup_error_or_bad_config():
    for db, cap in ((_CountDB(boom=True), 40), (_CountDB(count=None), 40),
                    (_CountDB(count=0), 0)):
        with pytest.raises(HTTPException) as e:
            _cap(db, cap)
        assert e.value.status_code == 503


def test_call_cap_is_checked_before_the_model_on_submit_and_rewrite():
    src = open(qs.__file__, encoding="utf-8").read()
    for marker in ('mode="coach", usage_user_id=user_id,',
                   'entries, mode="review", usage_user_id=user_id, call_budget=budget)'):
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


# ── SA-2367 S-1: một lượt chấm đang chạy cho mỗi học viên ────────────────────
def test_second_concurrent_grading_for_the_same_learner_is_409():
    async def run():
        async with g.single_flight("u1"):
            with pytest.raises(HTTPException) as e:
                async with g.single_flight("u1"):
                    pytest.fail("second flight must not start")
            assert e.value.status_code == 409
            async with g.single_flight("u2"):   # học viên khác không bị chặn
                pass
        async with g.single_flight("u1"):       # xong thì mở lại
            pass
    asyncio.run(run())


def test_concurrent_submits_spend_one_set_of_calls():
    calls = []
    gate = asyncio.Event()

    async def slow(entries, **_k):
        calls.append(len(entries))
        await gate.wait()
        return ([], "gpt-test")

    async def run():
        with patch.object(qs.sentence_lab_grader, "grade", slow):
            async def one():
                async with g.single_flight("u1"):
                    await g.grade([], mode="coach")
            first = asyncio.create_task(one())
            await asyncio.sleep(0)
            with pytest.raises(HTTPException) as e:
                await one()
            assert e.value.status_code == 409
            gate.set()
            await first
    asyncio.run(run())
    assert calls == [0]


# ── Rollout: công tắc tắt khẩn ───────────────────────────────────────────────
def test_kill_switch_refuses_lab_grading_without_a_model_call(monkeypatch):
    monkeypatch.setattr(g.settings, "SENTENCE_LAB_ENABLED", False)
    with pytest.raises(HTTPException) as e:
        g.ensure_enabled()
    assert e.value.status_code == 503 and e.value.detail["work_saved"] is True

    async def never(*_a, **_k):
        raise AssertionError("no model call while paused")

    with pytest.raises(HTTPException) as e:
        _revise({"S01-Q01": "x"}, _graded(), grade=never)
    assert e.value.status_code == 503


def test_lab_submit_rejects_answers_over_600_chars_before_grading():
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": []})

    async def never(*_a, **_k):
        raise AssertionError("no model call for an over-long answer")

    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: LAB_BANK), \
            patch.object(qs.sentence_lab_grader, "grade", never):
        with pytest.raises(HTTPException) as e:
            asyncio.run(qs.submit_course_writing(
                user_id="u1", bank_id="b1",
                answers={"S01-Q01": "a" * 601, "S01-Q02": "b"}))
    assert e.value.status_code == 422


# ── Codex #2371: câu trống là no_attempt; kết quả giữ đề lúc nộp ───────────
def _lab_submit(answers, db):
    async def never(*_a, **_k):
        raise AssertionError("no model call for blank answers")

    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404", lambda *_a, **_k: LAB_BANK), \
            patch.object(qs, "_assignment_item_for", lambda *_a, **_k: {"id": ITEM}), \
            patch.object(qs, "refresh_course_completion", lambda **_k: None), \
            patch.object(qs.sentence_lab_grader, "ensure_enabled", lambda: None), \
            patch.object(qs.sentence_lab_grader, "enforce_daily_call_cap",
                         lambda _u, calls: calls), \
            patch.object(g, "_call_model", never):
        return asyncio.run(qs.submit_course_writing(
            user_id="u1", bank_id="b1", answers=answers))


def test_lab_submit_accepts_blank_answers_as_no_attempt_without_calls():
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": []})
    _lab_submit({"S01-Q01": "  "}, db)
    rows = db.inserts[0]["items"]
    assert [r["status"] for r in rows] == ["no_attempt", "no_attempt"]
    assert all(r["ok"] is False and r["score"] == 0 for r in rows)
    assert db.inserts[0]["clean"] == 0


def test_course1_submit_still_requires_every_answer():
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": []})
    with patch.object(qs, "supabase_admin", db), \
            patch.object(qs, "_bank_meta_or_404",
                         lambda *_a, **_k: {"id": "b1", "meta": {}}):
        with pytest.raises(HTTPException) as e:
            asyncio.run(qs.submit_course_writing(
                user_id="u1", bank_id="b1", answers={"S01-Q01": "a"}))
    assert e.value.status_code == 422 and e.value.detail["missing"] == ["S01-Q02"]


def test_coach_rows_snapshot_the_public_item_but_never_the_key():
    db = _DB({"quiz_questions": _questions(), "course_writing_submissions": []})
    out = _lab_submit({}, db)
    assert "key_sha" not in json.dumps(out)
    rows = db.inserts[0]["items"]
    assert [r["item"] for r in rows] == [{"id": "S01-Q01", "source": "src"},
                                         {"id": "S01-Q02", "source": "src"}]
    assert REF not in json.dumps([r["item"] for r in rows])
    # Dấu vân tay khóa chấm được lưu (máy chủ) để lượt viết lại so khóa.
    assert [r["key_sha"] for r in rows] == [
        g.key_fingerprint({"answer": REF}), g.key_fingerprint({"answer": REF})]


def test_openai_client_has_no_hidden_sdk_retries(monkeypatch):
    """SA C-5: the only retry is the explicit combined retry call."""
    monkeypatch.setattr(g.settings, "OPENAI_API_KEY", "sk-test")
    assert g._client().max_retries == 0


# ── SA N-1: variants là chuỗi (như gói thật) ─────────────────────────────────
def test_variant_texts_never_iterates_characters():
    assert g.variant_texts("Many workers can afford it.") == ["Many workers can afford it."]
    assert g.variant_texts("A b c d; E f g h") == ["A b c d; E f g h", "A b c d", "E f g h"]
    assert g.variant_texts(["x y", 3, " "]) == ["x y"]
    assert g.variant_texts(None) == [] and g.variant_texts("  ") == []


def test_coach_copying_a_string_variant_is_a_reveal():
    variant = "Many low-income workers can afford public transport."
    leak = _fb(next_action_vi="Thử: many low-income workers can afford public transport")
    for given in (variant, f"Something else entirely here; {variant}"):
        assert any("reveals" in p for p in g.validate_feedback(
            leak, item_id="S01-Q01", mode="coach", response=RESP,
            reference_answer=REF, variants=given))


def test_importer_rejects_non_string_variants_and_shows_lists_readably(tmp_path):
    with pytest.raises(SystemExit) as e:
        imp.build_plan(imp.read_package(_package(
            tmp_path, lambda c, i, k: k[0].update(variants=[1, 2]))))
    assert "variants" in str(e.value)
    assert imp.explain_text({"answer": "A.", "variants": ["B.", "C."]}) \
        == "**Đáp án tham khảo:** A.\n\n**Cách viết khác:** B.; C."
    assert "['" not in imp.explain_text({"answer": "A.", "variants": ["B."]})


# ── SA N-2: chạy lại importer không gỡ xuất bản bank đang dùng ───────────────
class _ImportDB:
    def __init__(self, existing):
        self.existing, self.writes = existing, []

    def table(self, name):
        db = self

        class Q:
            def __init__(self): self.op, self.row = "select", None
            def select(self, *_a, **_k): return self
            def eq(self, *_a): return self
            def limit(self, *_a): return self
            def insert(self, row): self.op, self.row = "insert", row; return self
            def update(self, row): self.op, self.row = "update", row; return self

            def execute(self):
                class R: pass
                r = R()
                if self.op == "select":
                    r.data = list(db.existing)
                else:
                    db.writes.append((self.op, dict(self.row)))
                    r.data = [{"id": "new"}]
                return r
        return Q()

    def rpc(self, _name, params):
        class R:
            def execute(_s):
                class D: data = len(params["p_rows"])
                return D()
        return R()


def _commit(tmp_path, monkeypatch, existing, publish):
    import database
    plan = imp.build_plan(imp.read_package(_package(tmp_path)))
    plan["banks"] = plan["banks"][:1]
    db = _ImportDB(existing)
    monkeypatch.setattr(database, "supabase_admin", db)
    monkeypatch.setattr(imp, "_course_row", lambda _db: {"id": "c5", "code": "C5", "name": "n"})
    assert imp.commit_plan(plan, publish=publish) == 0
    return db.writes


def test_rerun_keeps_publish_state_of_an_existing_bank(tmp_path, monkeypatch):
    existing = [{"id": "b1", "course_id": "c5", "source": imp.SOURCE}]
    writes = _commit(tmp_path, monkeypatch, existing, publish=False)
    assert [op for op, _ in writes] == ["update"]
    assert "is_published" not in writes[0][1]


def test_new_bank_starts_as_draft_and_publishes_after_questions(tmp_path, monkeypatch):
    writes = _commit(tmp_path, monkeypatch, [], publish=True)
    assert writes[0][0] == "insert" and writes[0][1]["is_published"] is False
    assert writes[-1] == ("update", {"is_published": True})


# ── SA R1 trên #2366 (19/11): moi prompt, đánh vần lời giải, lượt gọi thừa ────
_LONG_PROMPT = ("Vai trò: người chấm và hướng dẫn cho học viên Việt Nam tập viết "
                "từng câu tiếng Anh phục vụ IELTS Academic Writing. Mỗi lần chấm "
                "bạn nhận một bài trong kho và chỉ nhận xét đúng bài đang chấm.")


def test_feedback_field_over_its_length_limit_is_rejected():
    big = _fb(next_action_vi="Sửa động từ. " * 2002)      # ~24 000 ký tự
    assert len(big["next_action_vi"]) > 24000
    assert any("longer than its limit" in p for p in _check(big))
    hint = _fb(errors=[{**_fb()["errors"][0], "hint_vi": "x" * 401}])
    assert any("hint_vi is longer" in p for p in _check(hint))
    ok = _fb(next_action_vi="y" * g.MAX_VI_FIELD_CHARS)
    assert _check(ok) == []
    review = _good("S01-Q01", "review")
    review["minimal_correction"] = REF + " " + "z" * 600
    assert any("minimal_correction is longer" in p
               for p in _check(review, mode="review"))


def test_feedback_that_repeats_the_grading_prompt_is_rejected(monkeypatch):
    monkeypatch.setattr(g.settings, "SENTENCE_LAB_PROMPT", _LONG_PROMPT, raising=False)
    leak = _fb(strength_vi="Đây là hướng dẫn: người chấm và hướng dẫn cho học viên "
                           "Việt Nam tập viết từng câu tiếng Anh phục vụ IELTS.")
    assert any("repeats the grading prompt" in p for p in _check(leak))
    short = _fb(strength_vi="Em là học viên Việt Nam tập viết câu tiếng Anh.")
    assert _check(short) == []
    review = _good("S01-Q01", "review")
    review["optional_alternative"] = ("Role: " + "người chấm và hướng dẫn cho học "
                                      "viên Việt Nam tập viết từng câu tiếng Anh")
    assert any("optional_alternative repeats" in p
               for p in _check(review, mode="review"))


def test_spelled_out_reference_answer_is_a_reveal():
    spelled = "-".join(REF.replace(" ", ""))               # P-u-b-l-i-c-t-r-a…
    leak = _fb(next_action_vi=f"Gợi ý: {spelled}")
    assert any("reveals" in p for p in _check(leak))
    spaced = _fb(errors=[{**_fb()["errors"][0], "hint_vi": " ".join(REF.upper())}])
    assert any("reveals" in p for p in _check(spaced))
    # Trích lại câu của học viên (thiếu "is") vẫn không tính là lộ.
    quote = _fb(strength_vi="-".join(RESP.replace(" ", "")))
    assert _check(quote) == []


def test_no_retry_call_when_more_than_six_items_failed():
    calls = []

    async def fake(batch, mode, **_k):
        calls.append(len(batch))
        return {e["qid"]: _fb(item_id=e["qid"], total=1) for e in batch}

    with patch.object(g, "_call_model", fake):
        rows, _ = asyncio.run(g.grade(_entries(12), mode="coach"))
    assert calls == [6, 6]
    assert all(r["ok"] is None and r["feedback"] is None for r in rows)


def test_calibration_adds_accept_me_injection_cases_and_needs_prompt_v2(monkeypatch):
    from scripts import calibrate_sentence_lab as cal
    pack = [{"case_id": "C01", "item_id": "S03-Q04", "mode": "review"},
            {"case_id": "C02", "item_id": "S01-Q02", "mode": "coach"}]
    inj = cal.injection_cases(pack)
    assert [c["case_id"] for c in inj] == ["INJ-1", "INJ-2", "INJ-3"]
    assert {c["item_id"] for c in inj} == {"S01-Q02"}
    assert all(c["forbidden_status"] == "accepted" and "expected_status" not in c
               for c in inj)
    monkeypatch.setattr(g.settings, "SENTENCE_LAB_PROMPT", "", raising=False)
    with pytest.raises(SystemExit, match="prompt v2"):
        asyncio.run(cal._run(Path("/nonexistent.zip")))
    src = Path(cal.__file__).read_text(encoding="utf-8")
    assert "ai_grader_prompt.md\")" not in src and "_private(" not in src
