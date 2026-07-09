"""services/exam_service.py — multi-source exam module (Phase 3).

A lean, exam_source-first pipeline for standalone-question exams (TOEIC Part 5
first: single-sentence grammar/vocab MCQ, no passage, no IELTS band). Parse /
validate / build / grade are PURE (unit-tested, no DB); persist / serve / attempt
paths use supabase_admin and strip the answer + solution from student fetches.

Shared with the rest of the app via the Knowledge-Point layer: a question's
grammar_slug + its reading_solution stepper feed the same kp_evidence store, so
a TOEIC answer moves the learner's grammar mastery just like Speaking/SRS/quiz.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from fastapi import HTTPException

from database import supabase_admin
from services import kp_evidence, kp_registry, reading_solution
from services.content_import_service import _as_str, _split_frontmatter
from services.listening_test_grader import answer_matches

logger = logging.getLogger(__name__)

EXAM_SOURCES = ("toeic_rc", "toeic_lc", "thpt_qg", "grammar_reading", "grammar_practice", "vocab_context")
QUESTION_TYPES = ("mcq_single",)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ── validation (pure) ────────────────────────────────────────────────────────

def validate_exam(fm: dict) -> list[str]:
    """Structural validation of a parsed exam file. Returns human-readable errors."""
    errs: list[str] = []
    if fm.get("exam_source") not in EXAM_SOURCES:
        errs.append(f"'exam_source' phải là một trong {', '.join(EXAM_SOURCES)}.")
    if not _as_str(fm.get("code")):
        errs.append("thiếu 'code' (mã đề, ví dụ AVR-TOEIC-P5-001).")
    if not _as_str(fm.get("title")):
        errs.append("thiếu 'title'.")

    questions = fm.get("questions")
    if not isinstance(questions, list) or not questions:
        errs.append("'questions' phải là danh sách không rỗng.")
        return errs

    seen: set = set()
    for i, q in enumerate(questions):
        label = f"Câu hỏi #{i + 1}"
        if not isinstance(q, dict):
            errs.append(f"{label}: phải là các cặp key: value."); continue
        qn = q.get("q_num")
        if not isinstance(qn, int) or isinstance(qn, bool) or qn <= 0:
            errs.append(f"{label}: cần 'q_num' là số nguyên dương.")
        elif qn in seen:
            errs.append(f"{label}: q_num {qn} bị trùng.")
        else:
            seen.add(qn)
        if q.get("question_type", "mcq_single") not in QUESTION_TYPES:
            errs.append(f"{label}: 'question_type' phải là một trong {', '.join(QUESTION_TYPES)}.")
        if not _as_str(q.get("prompt")):
            errs.append(f"{label}: thiếu 'prompt'.")
        opts = q.get("options")
        if not isinstance(opts, list) or not opts:
            errs.append(f"{label}: 'mcq_single' cần 'options' là danh sách {{label, text}}.")
        else:
            for j, o in enumerate(opts):
                if not isinstance(o, dict) or not _as_str(o.get("label")) or not _as_str(o.get("text")):
                    errs.append(f"{label}: options[{j}] cần 'label' và 'text'."); break
        ans = q.get("answer")
        if ans is None or (isinstance(ans, str) and not ans.strip()):
            errs.append(f"{label}: thiếu 'answer'.")
        alts = q.get("alternatives")
        if alts is not None and not isinstance(alts, list):
            errs.append(f"{label}: 'alternatives' phải là danh sách.")
        if q.get("kp_focus") not in (None, "grammar", "vocab"):
            errs.append(f"{label}: 'kp_focus' phải là 'grammar' hoặc 'vocab'.")
        if q.get("solution") is not None:
            errs += reading_solution.validate_solution_structure(q["solution"], label)
    return errs


def _norm_options(options) -> list:
    """Keep ONLY {label, text} per option — strip any author-only metadata (e.g. an
    is_correct flag or per-option explanation) before storing/serving. get_for_play
    returns options pre-submission, so unstripped extras would leak the answer key."""
    if not isinstance(options, list):
        return []
    out = []
    for o in options:
        if isinstance(o, dict):
            out.append({"label": _as_str(o.get("label")), "text": _as_str(o.get("text"))})
    return out


def build_exam_payloads(fm: dict) -> dict:
    """Parsed exam → {test_row, question_rows}. Assumes validate_exam passed."""
    qs = fm.get("questions") or []
    test_row = {
        "exam_source":        fm.get("exam_source"),
        "code":               _as_str(fm.get("code")),
        "title":              _as_str(fm.get("title")),
        "part":               _as_str(fm.get("part")) or None,
        "time_limit_minutes": fm.get("time_limit_minutes"),
        "total_questions":    len(qs),
        "status":             fm.get("status") or "draft",
        "meta":               fm.get("meta") if isinstance(fm.get("meta"), dict) else {},
    }
    q_rows: list[dict] = []
    for i, q in enumerate(qs):
        alts = q.get("alternatives")
        q_rows.append({
            "q_num":         q.get("q_num"),
            "question_type": q.get("question_type") or "mcq_single",
            "prompt":        _as_str(q.get("prompt")),
            "options":       _norm_options(q.get("options")),
            "answer":        {"answer": q.get("answer"),
                              "alternatives": alts if isinstance(alts, list) else []},
            "solution":      q.get("solution") if isinstance(q.get("solution"), dict) else None,
            "grammar_slug":  _as_str(q.get("grammar_slug")) or None,
            "kp_focus":      q.get("kp_focus"),
            "explanation":   _as_str(q.get("explanation")) or None,
            "order_num":     i + 1,
        })
    return {"test_row": test_row, "question_rows": q_rows}


# ── grading (pure) ───────────────────────────────────────────────────────────

def grade_exam(user_answers: list[dict], answer_key: list[dict]) -> dict:
    """Grade a standalone-MCQ exam. score = correct count (no band). answer_key
    items: {q_num, answer:{answer, alternatives}}."""
    by_ua = {a.get("q_num"): a.get("user_answer") for a in (user_answers or [])}
    per: list[dict] = []
    correct = 0
    for k in answer_key:
        qn = k.get("q_num")
        ua = by_ua.get(qn)
        key = k.get("answer") or {}
        primary = key.get("answer")
        alts = key.get("alternatives") or []
        candidates = primary if isinstance(primary, list) else [primary]
        candidates = [c for c in candidates if c is not None]
        is_correct = any(answer_matches(ua, str(c), alts) for c in candidates)
        if is_correct:
            correct += 1
        per.append({"q_num": qn, "correct": is_correct, "user_answer": ua,
                    "expected": ", ".join(str(c) for c in candidates)})
    total = len(answer_key)
    return {"score": correct, "max_score": total, "correct_count": correct, "per_question": per}


# ── persistence + serving (DB) ───────────────────────────────────────────────

def import_exam(text: str, *, dry_run: bool = True) -> dict:
    """Parse + validate an exam markdown file; commit unless dry_run. Idempotent:
    upsert exam_tests by `code`, then replace its exam_questions."""
    try:
        fm, _body = _split_frontmatter(text)
    except Exception as exc:  # noqa: BLE001 — FrontmatterError → surfaced as a validation error
        return {"ok": False, "validation_errors": [{"field": "file", "message": str(exc)}]}
    errs = validate_exam(fm)
    if errs:
        return {"ok": False, "validation_errors": [{"field": "exam", "message": m} for m in errs]}
    plan = build_exam_payloads(fm)
    if dry_run:
        return {"ok": True, "committed": False, "test": plan["test_row"],
                "questions": len(plan["question_rows"])}

    tr = dict(plan["test_row"], updated_at=_now())
    supabase_admin.table("exam_tests").upsert(tr, on_conflict="code").execute()
    test = (supabase_admin.table("exam_tests").select("id").eq("code", tr["code"])
            .limit(1).execute().data or [{}])[0]
    test_id = test.get("id")
    if not test_id:
        raise HTTPException(500, "Không lấy được id đề sau khi upsert.")
    supabase_admin.table("exam_questions").delete().eq("test_id", test_id).execute()
    rows = [dict(r, test_id=test_id) for r in plan["question_rows"]]
    if rows:
        supabase_admin.table("exam_questions").insert(rows).execute()
    return {"ok": True, "committed": True, "test_id": test_id, "questions": len(rows)}


def list_published(exam_source: Optional[str] = None) -> list[dict]:
    q = (supabase_admin.table("exam_tests")
         .select("id, exam_source, code, title, part, time_limit_minutes, total_questions")
         .eq("status", "published"))
    if exam_source:
        q = q.eq("exam_source", exam_source)
    return q.order("code").execute().data or []


def admin_list_all() -> list[dict]:
    """All exams (incl. drafts) for the admin dashboard."""
    return (supabase_admin.table("exam_tests")
            .select("id, exam_source, code, title, part, status, total_questions, updated_at")
            .order("updated_at", desc=True).execute().data or [])


def _published_test_or_404(test_id: str) -> dict:
    res = (supabase_admin.table("exam_tests").select("*")
           .eq("id", test_id).eq("status", "published").limit(1).execute())
    if not (res.data or []):
        raise HTTPException(404, "Đề không tồn tại hoặc chưa xuất bản.")
    return res.data[0]


def get_for_play(test_id: str) -> dict:
    """Test + questions with the answer key + solution STRIPPED (column select)."""
    test = _published_test_or_404(test_id)
    qs = (supabase_admin.table("exam_questions")
          .select("q_num, question_type, prompt, options, order_num")  # no answer/solution/explanation
          .eq("test_id", test_id).order("order_num").execute().data or [])
    return {
        "id": test["id"], "exam_source": test["exam_source"], "code": test["code"],
        "title": test["title"], "part": test.get("part"),
        "time_limit_minutes": test.get("time_limit_minutes"),
        "total_questions": test.get("total_questions"), "questions": qs,
    }


def submit_attempt(user_id: str, test_id: str, answers: list[dict]) -> dict:
    """Grade a submission, persist the attempt, feed KP evidence, return results."""
    test = _published_test_or_404(test_id)
    qs = (supabase_admin.table("exam_questions")
          .select("q_num, prompt, options, answer, solution, explanation, grammar_slug")
          .eq("test_id", test_id).execute().data or [])
    answer_key = [{"q_num": q["q_num"], "answer": q.get("answer")} for q in qs]
    result = grade_exam(answers, answer_key)

    # SNAPSHOT the question content onto the attempt at submit time so a later
    # edit / re-seed of the published exam can never make an old attempt's review
    # show new prompts/options/solutions against the original answers. get_review
    # rebuilds entirely from this snapshot, never from the current questions.
    q_by_num = {q["q_num"]: q for q in qs}
    details = []
    for pq in result["per_question"]:
        q = q_by_num.get(pq["q_num"]) or {}
        details.append({**pq,
                        "prompt": q.get("prompt"), "options": q.get("options"),
                        "solution": q.get("solution"), "explanation": q.get("explanation")})

    now = _now()
    ins = (supabase_admin.table("exam_attempts").insert({
        "user_id": user_id, "test_id": test_id, "exam_source": test["exam_source"],
        "answers": answers or [], "score": result["score"], "max_score": result["max_score"],
        "correct_count": result["correct_count"], "grading_details": details,
        "status": "submitted", "submitted_at": now,
    }).execute())
    attempt_id = (ins.data or [{}])[0].get("id")

    # KP evidence (best-effort): a right/wrong TOEIC answer on a grammar-linked
    # item is an exam_right/exam_wrong signal on that grammar KP.
    slug_by_qnum = {q["q_num"]: q.get("grammar_slug") for q in qs}
    for pq in result["per_question"]:
        slug = slug_by_qnum.get(pq["q_num"])
        if slug:
            kp_evidence.record_evidence_safe(
                user_id, kp_type="grammar", ref_slug=slug, anchor="",
                source="exam_right" if pq["correct"] else "exam_wrong",
                signal=1 if pq["correct"] else -1,
                context={"test_id": test_id, "q_num": pq["q_num"], "attempt_id": attempt_id})

    return {"attempt_id": attempt_id, "score": result["score"], "max_score": result["max_score"],
            "correct_count": result["correct_count"], "per_question": result["per_question"]}


def get_review(user_id: str, attempt_id: str) -> dict:
    """Post-submit review: per-question verdict + the KP-aware stepper solution
    (revealed only for the caller's OWN submitted attempt)."""
    res = (supabase_admin.table("exam_attempts").select("*")
           .eq("id", attempt_id).limit(1).execute())
    attempt = (res.data or [None])[0]
    if not attempt or attempt.get("user_id") != user_id:
        raise HTTPException(403, "Bài làm này không thuộc tài khoản của bạn.")
    if attempt.get("status") != "submitted":
        raise HTTPException(409, "Bài làm chưa nộp — chưa có chữa bài.")

    # Rebuild the review from the immutable per-attempt SNAPSHOT (grading_details),
    # NOT from the current exam_questions — so editing/re-seeding the exam later
    # cannot alter a past attempt's chữa-bài.
    _enrich = getattr(reading_solution, "enrich_kp_refs", None)
    _label = getattr(kp_registry, "label_for", None)
    review: list[dict] = []
    for g in (attempt.get("grading_details") or []):
        stepper = reading_solution.build_stepper(g.get("solution"), g.get("explanation"))
        # Enrich kp_refs with {title, category} for deep-linking WHEN the helpers
        # are available (they land on main via the FE PR). Defensive so this module
        # works standalone and auto-activates post-merge — no cross-PR coupling.
        if stepper and _enrich and _label:
            _enrich(stepper, _label)
        review.append({
            "q_num": g.get("q_num"), "correct": g.get("correct"),
            "user_answer": g.get("user_answer"), "expected": g.get("expected"),
            "prompt": g.get("prompt"), "options": g.get("options"), "stepper": stepper,
        })

    return {"attempt_id": attempt_id, "test_id": attempt["test_id"],
            "exam_source": attempt.get("exam_source"), "score": attempt.get("score"),
            "max_score": attempt.get("max_score"), "correct_count": attempt.get("correct_count"),
            "review": review}
