"""services/exam_content_service.py — nội dung kỳ thi: cấp khoá + lớp (Đợt 3).

One place that can answer "which papers exist, for which course level, for which
class" across all three libraries — reading tests, listening tests and writing
prompts — because that question is asked ACROSS them, not inside one.

Module-level `supabase_admin` like the other admin services, so the FakeSupabase
double can patch it.
"""
from __future__ import annotations

import logging
from typing import Iterable, Optional

from database import supabase_admin
from services.class_assignment_service import active_exam_assignment_references
from services.mock_correction_service import AUTO_SERVABLE, READY_EDITORIAL, READY_RIGHTS

logger = logging.getLogger(__name__)

# kind → (table, title column). Writing prompts have no `test_id` code, so the
# caller-facing shape normalises that away.
_KINDS: dict[str, tuple] = {
    "reading":   ("reading_tests",   "test_id"),
    "listening": ("listening_tests", "test_id"),
    "writing":   ("writing_prompts", None),
}

# PostgREST answers with ONE page and no error past its row cap, so anything
# that grows with the library has to page explicitly.
_PAGE = 1000
_ID_CHUNK = 100


class UnknownKindError(ValueError):
    """content_kind is not one of reading/listening/writing."""


class ContentNotReadyError(ValueError):
    """The paper cannot move to published yet."""


class ActiveAssignmentError(ValueError):
    """A published paper still belongs to an active class assignment."""


def _assert_kind(kind: str) -> tuple:
    try:
        return _KINDS[kind]
    except KeyError:
        raise UnknownKindError(
            f"content_kind phải là một trong {sorted(_KINDS)} — nhận {kind!r}."
        ) from None


def _paged(build) -> list:
    out: list = []
    start = 0
    while True:
        page = build().range(start, start + _PAGE - 1).execute().data or []
        out.extend(page)
        if len(page) < _PAGE:
            return out
        start += _PAGE


def set_course_level(kind: str, content_id: str, level: Optional[str]) -> dict:
    """Set (or clear, with None) the course level on one piece of content."""
    table, _ = _assert_kind(kind)
    value = (level or "").strip() or None
    resp = supabase_admin.table(table).update({"course_level": value}).eq(
        "id", str(content_id),
    ).execute()
    if not resp.data:
        raise LookupError(f"Không tìm thấy nội dung {kind}/{content_id}.")
    return resp.data[0]


def set_public_visibility(kind: str, content_id: str, is_public: bool) -> dict:
    """Set self-practice visibility for one Reading/Listening test."""
    table, _ = _assert_kind(kind)
    if kind == "writing":
        raise UnknownKindError(
            "Public visibility hiện chỉ áp dụng cho đề Reading/Listening."
        )
    resp = supabase_admin.table(table).update({
        "is_public": bool(is_public),
        # Compatibility cut-over: class assignment must not be rejected by
        # clients that still understand the legacy exam_only flag.
        "exam_only": False,
    }).eq("id", str(content_id)).execute()
    if not resp.data:
        raise LookupError(f"Không tìm thấy nội dung {kind}/{content_id}.")
    return resp.data[0]


def publication_readiness(kind: str, row: dict) -> tuple[bool, Optional[str]]:
    """Return the canonical publish gate used by both the API and catalog."""
    if kind == "reading":
        passages = int(row.get("passage_count") or 0)
        questions = int(row.get("total_questions") or 0)
        if passages != 3 or questions != 40:
            return False, (
                f"Đề Reading cần đủ 3 passages và 40 câu; hiện có "
                f"{passages} passages, {questions} câu."
            )
        return True, None
    if kind == "listening":
        from services import listening_audio
        return listening_audio.can_publish(row)
    return False, "Publish đề hiện chỉ áp dụng cho Reading/Listening."


def set_status(kind: str, content_id: str, status: str) -> dict:
    """Change a paper lifecycle state from the centralized exam catalog."""
    table, _ = _assert_kind(kind)
    if kind == "writing":
        raise UnknownKindError("Publish đề hiện chỉ áp dụng cho Reading/Listening.")
    next_status = (status or "").strip().lower()
    if next_status not in {"draft", "published", "archived"}:
        raise ValueError("status phải là draft, published hoặc archived.")

    rows = (
        supabase_admin.table(table).select("*").eq("id", str(content_id))
        .limit(1).execute().data or []
    )
    if not rows:
        raise LookupError(f"Không tìm thấy nội dung {kind}/{content_id}.")
    current = rows[0]

    if next_status != "published" and current.get("status") == "published":
        active = active_exam_assignment_references(
            supabase_admin, kind, str(content_id),
        )
        if active:
            names = ", ".join(str(item.get("title") or item["id"]) for item in active[:3])
            raise ActiveAssignmentError(
                f"Đề đang được giao trong bài còn nhận nộp: {names}. Hãy đóng bài giao trước."
            )

    if next_status == "published":
        ready, reason = publication_readiness(kind, current)
        if not ready:
            raise ContentNotReadyError(reason or "Đề chưa sẵn sàng để publish.")

    updated = (
        supabase_admin.table(table).update({"status": next_status})
        .eq("id", str(content_id)).execute().data or []
    )
    return updated[0] if updated else {**current, "status": next_status}


def _assert_content_exists(kind: str, content_id: str) -> None:
    """The join table deliberately has no FK on content_id (it points into one of
    three tables), so nothing else stops a stale UUID being "assigned" and the
    endpoint reporting success for content that does not exist
    (Codex review, PR #864)."""
    table, _ = _assert_kind(kind)
    rows = supabase_admin.table(table).select("id").eq(
        "id", str(content_id),
    ).limit(1).execute().data or []
    if not rows:
        raise LookupError(f"Không tìm thấy nội dung {kind}/{content_id}.")


def set_cohorts(kind: str, content_id: str, cohort_ids: Iterable[str],
                *, created_by=None) -> dict:
    """Replace the set of classes this content is meant for.

    A REPLACE, not an append: the admin screen shows the full set of ticks, so
    what it sends IS the intended state.

    ONE STATEMENT (mig 172), not insert-then-delete. As two calls, a failing
    delete left {old ∪ new} persisted while the request reported an error — the
    endpoint had then both failed AND widened the assignment, which can leave a
    paper visible to a class the admin was taking it away from. Reversing the
    order only swaps that for "assigned to nobody", so the fix is a transaction.
    """
    _assert_kind(kind)
    _assert_content_exists(kind, content_id)
    wanted = sorted({str(c) for c in (cohort_ids or []) if c})
    out = supabase_admin.rpc("fn_set_exam_content_cohorts", {
        "p_kind":       kind,
        "p_content_id": str(content_id),
        "p_cohort_ids": wanted,
        "p_created_by": str(created_by) if created_by else None,
    }).execute().data or {}
    logger.info("[exam-content] %s/%s cohorts → %d lớp", kind, content_id, len(wanted))
    return {
        "added":      sorted(out.get("added") or []),
        "removed":    int(out.get("removed") or 0),
        "cohort_ids": wanted,
    }


def cohorts_for(kind: str, content_ids: Iterable[str]) -> dict:
    """content_id → [cohort_id]. ONE batched lookup, not one per row: this feeds
    a list screen, and a per-row query there is an N+1 on every page load."""
    _assert_kind(kind)
    ids = [str(c) for c in (content_ids or []) if c]
    out: dict = {i: [] for i in ids}
    if not ids:
        return out
    for i in range(0, len(ids), _ID_CHUNK):
        chunk = ids[i:i + _ID_CHUNK]
        rows = _paged(
            lambda c=chunk: supabase_admin.table("exam_content_cohorts")
            .select("content_id, cohort_id")
            .eq("content_kind", kind).in_("content_id", c).order("cohort_id")
        )
        for r in rows:
            out.setdefault(str(r["content_id"]), []).append(str(r["cohort_id"]))
    return out


def explanation_readiness_for(kind: str, content_ids: Iterable[str]) -> dict:
    """Per-paper release readiness, fetched in batches for the admin picker."""
    ids = [str(value) for value in (content_ids or []) if value]
    if kind not in ("reading", "listening"):
        return {}
    out = {
        value: {
            "web_explanation_count": 0,
            "web_explanation_ready_count": 0,
            "web_explanation_ready": False,
            "web_explanation_state": "none",
        }
        for value in ids
    }
    fk = f"{kind}_test_id"
    try:
        for index in range(0, len(ids), _ID_CHUNK):
            chunk = ids[index:index + _ID_CHUNK]
            rows = _paged(
                lambda c=chunk: supabase_admin.table("web_explanation_objects")
                .select(
                    f"{fk},rights_status,editorial_status,serving_status"
                )
                .eq("is_current", True)
                .in_(fk, c)
                .order(fk)
            )
            for row in rows:
                paper_id = str(row.get(fk) or "")
                if paper_id not in out:
                    continue
                bucket = out[paper_id]
                bucket["web_explanation_count"] += 1
                if (row.get("rights_status") in READY_RIGHTS
                        and row.get("editorial_status") in READY_EDITORIAL
                        and row.get("serving_status") in AUTO_SERVABLE):
                    bucket["web_explanation_ready_count"] += 1
    except Exception:  # catalog stays usable, but never claims readiness
        logger.exception("[exam-content] explanation readiness failed for %s", kind)
        return {
            value: {
                "web_explanation_count": None,
                "web_explanation_ready_count": None,
                "web_explanation_ready": None,
                "web_explanation_state": "unknown",
            }
            for value in ids
        }
    for bucket in out.values():
        total = bucket["web_explanation_count"]
        ready = bucket["web_explanation_ready_count"]
        bucket["web_explanation_ready"] = total == 40 and ready == 40
        if total == 0:
            bucket["web_explanation_state"] = "none"
        elif total != 40:
            bucket["web_explanation_state"] = "incomplete"
        elif ready != 40:
            bucket["web_explanation_state"] = "blocked"
        else:
            bucket["web_explanation_state"] = "ready"
    return out


def _mock_refs_for(kind: str, content_ids: Iterable[str]) -> dict:
    """content_id -> mock exams currently referencing it (batched)."""
    ids = [str(value) for value in (content_ids or []) if value]
    out: dict[str, list[dict]] = {value: [] for value in ids}
    column = {
        "reading": "reading_test_id",
        "listening": "listening_test_id",
    }.get(kind)
    if not ids or not column:
        return out
    for index in range(0, len(ids), _ID_CHUNK):
        chunk = ids[index:index + _ID_CHUNK]
        rows = _paged(
            lambda c=chunk: supabase_admin.table("mock_exams")
            .select(f"id,code,title,status,{column}")
            .in_(column, c).order("created_at", desc=True)
        )
        for row in rows:
            content_id = str(row.get(column) or "")
            if content_id in out:
                out[content_id].append({
                    "id": row.get("id"),
                    "code": row.get("code"),
                    "title": row.get("title"),
                    "status": row.get("status"),
                })
    return out


def list_exam_content(kind: Optional[str] = None,
                      course_level: Optional[str] = None,
                      cohort_id: Optional[str] = None,
                      exam_only: Optional[bool] = None,
                      is_public: Optional[bool] = None) -> dict:
    """The admin "Đề kỳ thi" screen: papers across all three libraries, with
    their level and classes, filterable.

    Returns a normalised shape so one table can render three libraries:
      {kind, id, code, title, status, exam_only, course_level, cohort_ids}
    """
    kinds = [kind] if kind else list(_KINDS)
    for k in kinds:
        _assert_kind(k)

    out: list[dict] = []
    failed: list[str] = []
    for k in kinds:
        table, code_col = _KINDS[k]
        cols = "id,title,course_level,exam_only"
        if k in ("reading", "listening"):
            cols += ",is_public"
        cols += f",{code_col}" if code_col else ""
        cols += ",status" if k != "writing" else ",is_active"
        if k in ("reading", "listening"):
            cols += ",public_practice_enabled,web_explanation_mode"
        if k == "reading":
            cols += ",passage_count,total_questions"
        if k == "listening":
            cols += ",audio_assembly_mode,full_audio_storage_path,assembled_audio_storage_path"
        try:
            rows = _paged(
                lambda t=table, c=cols: supabase_admin.table(t).select(c).order("id")
            )
        except Exception:  # noqa: BLE001
            # One broken library must not blank the screen — an admin looking at
            # three libraries should still see two. But a silent partial reads
            # exactly like "there is no content", so the caller is TOLD which
            # library failed and decides what to show (Codex review, PR #864).
            logger.exception("[exam-content] list failed for %s", k)
            failed.append(k)
            continue
        if course_level is not None:
            rows = [r for r in rows if (r.get("course_level") or "") == course_level]
        if exam_only is not None:
            rows = [r for r in rows if bool(r.get("exam_only")) is exam_only]
        if is_public is not None:
            rows = [
                r for r in rows
                if k in ("reading", "listening")
                and bool(r.get("is_public", not bool(r.get("exam_only")))) is is_public
            ]
        by_content = cohorts_for(k, [r["id"] for r in rows])
        explanation_by_content = explanation_readiness_for(k, [r["id"] for r in rows])
        mock_refs = _mock_refs_for(k, [r["id"] for r in rows])
        for r in rows:
            cids = by_content.get(str(r["id"]), [])
            if cohort_id and str(cohort_id) not in cids:
                continue
            explanation = explanation_by_content.get(str(r["id"]), {})
            publish_ready, readiness_reason = publication_readiness(k, r)
            out.append({
                "kind":         k,
                "id":           r["id"],
                "code":         r.get(code_col) if code_col else None,
                "title":        r.get("title"),
                # Writing prompts are soft-deleted with is_active rather than a
                # status enum; normalise so the screen has one column.
                "status":       r.get("status") or
                                ("published" if r.get("is_active") else "archived"),
                "exam_only":    bool(r.get("exam_only")),
                "is_public":    (bool(r.get("is_public"))
                                 if "is_public" in r
                                 else not bool(r.get("exam_only"))),
                "public_practice_enabled": bool(r.get("public_practice_enabled")),
                "web_explanation_mode": r.get("web_explanation_mode"),
                "course_level": r.get("course_level"),
                "cohort_ids":   cids,
                "mock_exams":   mock_refs.get(str(r["id"]), []),
                "publish_ready": publish_ready,
                "readiness_reason": readiness_reason,
                **explanation,
            })
    out.sort(key=lambda r: (r["kind"], (r["code"] or r["title"] or "").lower()))
    return {"items": out, "failed_kinds": failed}


def known_course_levels() -> list[str]:
    """Levels already in use, for the admin input's suggestions. The column is
    free text on purpose (a CHECK would need a migration per new course), so the
    suggestion list is derived, never enumerated in code."""
    seen: set = set()
    for table, _ in _KINDS.values():
        try:
            rows = _paged(
                lambda t=table: supabase_admin.table(t).select("course_level").order("id")
            )
        except Exception:  # noqa: BLE001
            logger.warning("[exam-content] level scan failed for %s", table)
            continue
        seen.update((r.get("course_level") or "").strip() for r in rows)
    return sorted(x for x in seen if x)
