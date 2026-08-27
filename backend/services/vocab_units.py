"""Business logic for the curated Vocab Wiki learning-unit layer.

Legacy ``vocab_cards`` stays the broad reference library. This module owns the
versioned, editorially reviewed learning units and deterministic task grading.
It deliberately imports no FastAPI symbols so routes only translate errors and
authentication; all canonical learning outcomes are produced here and persisted
through the atomic database RPC from migration 235.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone
from typing import Any, Iterable

from database import supabase_admin
from services import vocab_unit_rules

GRADER_VERSION = vocab_unit_rules.GRADER_VERSION
MASTERY_DIMENSIONS = vocab_unit_rules.MASTERY_DIMENSIONS
REVIEW_TYPES = vocab_unit_rules.REVIEW_TYPES


class VocabUnitError(Exception):
    """Base domain error."""


class VocabUnitNotFound(VocabUnitError):
    """Requested unit/version/task does not exist in the required state."""


class VocabUnitConflict(VocabUnitError):
    """Identity, version, or idempotency conflict."""


class VocabUnitValidationError(VocabUnitError):
    """Editorial content or learner response did not pass validation."""

    def __init__(self, message: str, errors: list[str] | None = None):
        super().__init__(message)
        self.errors = errors or [message]


def _rows(result: Any) -> list[dict[str, Any]]:
    data = getattr(result, "data", None)
    return data if isinstance(data, list) else []


def _one(result: Any) -> dict[str, Any] | None:
    data = getattr(result, "data", None)
    if isinstance(data, list):
        return data[0] if data else None
    return data if isinstance(data, dict) else None


def _paged_rows(query: Any, *, page_size: int = 1000) -> list[dict[str, Any]]:
    """Read every PostgREST page explicitly; the server otherwise caps at 1,000."""
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        batch = _rows(query.range(start, start + page_size - 1).execute())
        rows.extend(batch)
        if len(batch) < page_size:
            return rows
        start += page_size


def _unit_summary(unit: dict[str, Any], version: dict[str, Any]) -> dict[str, Any]:
    content = version.get("content") if isinstance(version.get("content"), dict) else {}
    return {
        "id": unit.get("id"),
        "unit_slug": unit.get("unit_slug"),
        "display_headword": unit.get("display_headword"),
        "unit_type": unit.get("unit_type"),
        "target_level": unit.get("target_level"),
        "problem_tags": unit.get("problem_tags") or [],
        "learner_tags": unit.get("learner_tags") or [],
        "title_vi": content.get("title_vi") or unit.get("display_headword"),
        "learning_goal_vi": content.get("learning_goal_vi") or "",
        "estimated_minutes": content.get("estimated_minutes"),
        "version_number": version.get("version_number"),
        "published_at": version.get("published_at"),
    }


def _load_published_units(
    *,
    level: str | None = None,
    unit_type: str | None = None,
    unit_ids: Iterable[str] | None = None,
) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    query = (
        supabase_admin.table("vocab_learning_units")
        .select(
            "id,kp_id,unit_slug,display_headword,unit_type,target_level,"
            "problem_tags,learner_tags,current_published_version_id"
        )
        .eq("status", "published")
    )
    if level:
        query = query.eq("target_level", level)
    if unit_type:
        query = query.eq("unit_type", unit_type)
    ids = [str(item) for item in (unit_ids or []) if item]
    if unit_ids is not None:
        if not ids:
            return []
        query = query.in_("id", ids)
    units = _paged_rows(query.order("display_headword").order("id"))
    version_ids = [u.get("current_published_version_id") for u in units if u.get("current_published_version_id")]
    if not version_ids:
        return []
    versions: list[dict[str, Any]] = []
    # Keep PostgREST URLs bounded as well as paging response rows.
    for start in range(0, len(version_ids), 200):
        versions.extend(_paged_rows(
            supabase_admin.table("vocab_unit_versions")
            .select("id,unit_id,version_number,content,published_at")
            .in_("id", version_ids[start:start + 200])
            .eq("status", "published")
        ))
    by_id = {str(v.get("id")): v for v in versions}
    return [
        (unit, by_id[str(unit["current_published_version_id"])])
        for unit in units
        if str(unit.get("current_published_version_id")) in by_id
    ]


def list_units(
    *,
    level: str | None = None,
    unit_type: str | None = None,
    problem_tag: str | None = None,
) -> list[dict[str, Any]]:
    """List published unit summaries without private task answer keys."""
    items = [_unit_summary(unit, version) for unit, version in _load_published_units(
        level=level, unit_type=unit_type,
    )]
    if problem_tag:
        items = [item for item in items if problem_tag in item["problem_tags"]]
    return items


def get_unit(unit_slug: str) -> dict[str, Any]:
    unit = _one(
        supabase_admin.table("vocab_learning_units")
        .select(
            "id,kp_id,unit_slug,display_headword,unit_type,sense_key,"
            "construction_key,communicative_function,context_key,target_level,"
            "problem_tags,learner_tags,current_published_version_id"
        )
        .eq("unit_slug", unit_slug)
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not unit or not unit.get("current_published_version_id"):
        raise VocabUnitNotFound("Không tìm thấy learning unit đã xuất bản")
    version = _one(
        supabase_admin.table("vocab_unit_versions")
        .select("id,unit_id,version_number,schema_version,content,sources,published_at")
        .eq("id", unit["current_published_version_id"])
        .eq("status", "published")
        .limit(1)
        .execute()
    )
    if not version or str(version.get("unit_id")) != str(unit.get("id")):
        raise VocabUnitNotFound("Published version của learning unit không hợp lệ")
    tasks = _rows(
        supabase_admin.table("vocab_unit_tasks")
        .select("id,sequence,task_type,dimension,prompt,options")
        .eq("version_id", version["id"])
        .eq("status", "active")
        .order("sequence")
        .execute()
    )
    return {
        **_unit_summary(unit, version),
        "sense_key": unit.get("sense_key"),
        "construction_key": unit.get("construction_key"),
        "communicative_function": unit.get("communicative_function"),
        "context_key": unit.get("context_key"),
        "content": version.get("content") or {},
        "sources": version.get("sources") or [],
        "tasks": tasks,
    }


def list_pathways() -> list[dict[str, Any]]:
    pathways = _paged_rows(
        supabase_admin.table("vocab_pathways")
        .select("id,pathway_slug,title_vi,description_vi,target_level,learner_tags")
        .eq("status", "published")
        .order("title_vi")
        .order("id")
    )
    if not pathways:
        return []
    pathway_ids = [row["id"] for row in pathways]
    links = _paged_rows(
        supabase_admin.table("vocab_pathway_units")
        .select("pathway_id,unit_id,sequence,rationale_vi")
        .in_("pathway_id", pathway_ids)
        .order("sequence")
    )
    unit_ids = list({str(link["unit_id"]) for link in links})
    units = {
        str(unit["id"]): _unit_summary(unit, version)
        for unit, version in _load_published_units(unit_ids=unit_ids)
    }
    links_by_path: dict[str, list[dict[str, Any]]] = {}
    for link in links:
        unit = units.get(str(link.get("unit_id")))
        if not unit:
            continue
        links_by_path.setdefault(str(link["pathway_id"]), []).append({
            "sequence": link.get("sequence"),
            "rationale_vi": link.get("rationale_vi"),
            "unit": unit,
        })
    return [
        {**path, "units": links_by_path.get(str(path["id"]), [])}
        for path in pathways
    ]


def get_user_mastery(
    user_id: str,
    *,
    page: int = 1,
    page_size: int = 50,
) -> dict[str, Any]:
    offset = (page - 1) * page_size
    unit_page = _rows(
        supabase_admin.table("vocab_learning_units")
        .select("id,kp_id,unit_slug,display_headword,target_level")
        .eq("status", "published")
        .order("display_headword")
        .order("id")
        .range(offset, offset + page_size)
        .execute()
    )
    has_more = len(unit_page) > page_size
    units = unit_page[:page_size]
    kp_ids = [str(unit["kp_id"]) for unit in units if unit.get("kp_id")]
    rows = _rows(
        supabase_admin.table("user_kp_dimension_mastery")
        .select(
            "kp_id,dimension,state,attempt_count,success_count,last_attempt_at,"
            "last_success_at,next_review_at,updated_at"
        )
        .eq("user_id", user_id)
        .in_("kp_id", kp_ids)
        .order("updated_at", desc=True)
        .execute()
    ) if kp_ids else []
    units_by_kp = {str(unit["kp_id"]): unit for unit in units}
    now = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    counts = {
        "not_started": 0,
        "acquiring": 0,
        "controlled": 0,
        "transfer_ready": 0,
        "retained": 0,
        "needs_refresh": 0,
    }
    seen: set[tuple[str, str]] = set()
    for row in rows:
        unit = units_by_kp.get(str(row.get("kp_id")))
        if not unit:
            continue
        state = str(row.get("state") or "acquiring")
        due = row.get("next_review_at")
        if due and state in {"controlled", "transfer_ready", "retained"}:
            try:
                parsed = datetime.fromisoformat(str(due).replace("Z", "+00:00"))
                if parsed <= now:
                    state = "needs_refresh"
            except ValueError:
                pass
        counts[state] = counts.get(state, 0) + 1
        seen.add((str(row.get("kp_id")), str(row.get("dimension"))))
        items.append({**row, "state": state, "unit": unit})
    for unit in units:
        for dimension in MASTERY_DIMENSIONS:
            key = (str(unit.get("kp_id")), dimension)
            if key in seen:
                continue
            counts["not_started"] += 1
            items.append({
                "kp_id": unit.get("kp_id"), "dimension": dimension,
                "state": "not_started", "attempt_count": 0, "success_count": 0,
                "last_attempt_at": None, "last_success_at": None,
                "next_review_at": None, "updated_at": None, "unit": unit,
            })
    return {
        "page_counts": counts,
        "items": items,
        "dimensions": list(MASTERY_DIMENSIONS),
        "pagination": {
            "page": page,
            "page_size": page_size,
            "returned_units": len(units),
            "has_more": has_more,
        },
    }


def get_today(user_id: str, *, include_recommendations: bool) -> dict[str, Any]:
    """Return a bounded queue: feedback recommendations, due review, then discovery."""
    recommendations: list[dict[str, Any]] = []
    if include_recommendations:
        recommendations = _rows(
            supabase_admin.table("vocab_unit_recommendations")
            .select("id,unit_id,reason_vi,source_kind,source_id,status,created_at")
            .eq("user_id", user_id)
            .in_("status", ["pending", "opened"])
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
    now_iso = datetime.now(timezone.utc).isoformat()
    due = _rows(
        supabase_admin.table("user_kp_dimension_mastery")
        .select("kp_id,dimension,state,next_review_at")
        .eq("user_id", user_id)
        .lte("next_review_at", now_iso)
        .order("next_review_at")
        .limit(8)
        .execute()
    )
    kp_ids = list({str(row["kp_id"]) for row in due if row.get("kp_id")})
    due_units = _rows(
        supabase_admin.table("vocab_learning_units")
        .select("id,kp_id")
        .in_("kp_id", kp_ids)
        .eq("status", "published")
        .execute()
    ) if kp_ids else []
    recommendation_unit_ids = [str(row["unit_id"]) for row in recommendations]
    due_unit_ids = [str(row["id"]) for row in due_units]
    requested_ids = list(dict.fromkeys(recommendation_unit_ids + due_unit_ids))
    requested = {
        str(unit["id"]): _unit_summary(unit, version)
        for unit, version in _load_published_units(unit_ids=requested_ids)
    }
    selected_unit_ids: set[str] = set()
    recommendation_items: list[dict[str, Any]] = []
    for row in recommendations:
        unit_id = str(row.get("unit_id"))
        unit = requested.get(unit_id)
        if not unit or unit_id in selected_unit_ids or len(recommendation_items) >= 5:
            continue
        recommendation_items.append({**row, "unit": unit})
        selected_unit_ids.add(unit_id)
    due_unit_by_kp = {
        str(unit.get("kp_id")): unit for unit in due_units if unit.get("kp_id")
    }
    due_items: list[dict[str, Any]] = []
    for row in due:
        unit = due_unit_by_kp.get(str(row.get("kp_id")))
        unit_id = str(unit.get("id")) if unit else ""
        summary = requested.get(unit_id)
        if not summary or unit_id in selected_unit_ids:
            continue
        if len(recommendation_items) + len(due_items) >= 5:
            break
        due_items.append({**row, "unit": summary})
        selected_unit_ids.add(unit_id)
    mastery_rows = _paged_rows(
        supabase_admin.table("user_kp_dimension_mastery")
        .select("kp_id,dimension,state")
        .eq("user_id", user_id)
    )
    retained_by_kp: dict[str, set[str]] = {}
    for row in mastery_rows:
        if row.get("state") == "retained":
            retained_by_kp.setdefault(str(row.get("kp_id")), set()).add(
                str(row.get("dimension")),
            )
    fully_retained = {
        kp_id for kp_id, dimensions in retained_by_kp.items()
        if set(MASTERY_DIMENSIONS).issubset(dimensions)
    }
    candidates = [
        (unit, version)
        for unit, version in _load_published_units()
        if str(unit.get("id")) not in selected_unit_ids
        and str(unit.get("kp_id")) not in fully_retained
    ]
    day = datetime.now(timezone.utc).date().isoformat()
    candidates.sort(key=lambda pair: hashlib.sha256(
        f"{user_id}:{day}:{pair[0].get('id')}".encode("utf-8")
    ).hexdigest())
    discovery_slots = max(0, 5 - len(recommendation_items) - len(due_items))
    discovery = [
        _unit_summary(unit, version)
        for unit, version in candidates[:discovery_slots]
    ]
    return {
        "recommendations": recommendation_items,
        "due": due_items,
        "discover": discovery,
    }


def grade_response(task: dict[str, Any], response: dict[str, Any]) -> dict[str, Any]:
    """Translate pure-rule validation errors into the service domain."""
    try:
        return vocab_unit_rules.grade_response(task, response)
    except vocab_unit_rules.VocabUnitRuleError as exc:
        raise VocabUnitValidationError(str(exc)) from exc


def submit_attempt(
    user_id: str,
    task_id: str,
    attempt_id: str,
    response: dict[str, Any],
) -> dict[str, Any]:
    task = _one(
        supabase_admin.table("vocab_unit_tasks")
        .select("id,version_id,task_type,dimension,answer_key,explanation_vi")
        .eq("id", task_id)
        .eq("status", "active")
        .limit(1)
        .execute()
    )
    if not task:
        raise VocabUnitNotFound("Không tìm thấy task đang hoạt động")
    grade = {
        **grade_response(task, response),
        # Editorial explanation is withheld from the lesson payload and only
        # released after a server-graded attempt.
        "explanation_vi": task.get("explanation_vi"),
    }
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        stored = _one(
            supabase_admin.rpc("fn_record_vocab_unit_attempt", {
                "p_user": user_id,
                "p_task": task_id,
                "p_attempt": attempt_id,
                "p_response": response,
                "p_result": grade,
                "p_score": grade["score"],
                "p_is_correct": grade["correct"],
                "p_grader_version": GRADER_VERSION,
                "p_now": now_iso,
            }).execute()
        )
    except Exception as exc:
        message = str(exc)
        if "attempt_id_reused_for_different_task" in message:
            raise VocabUnitConflict("attempt_id đã được dùng cho một task khác") from exc
        if "attempt_id_reused_for_different_payload" in message:
            raise VocabUnitConflict("attempt_id đã được dùng với câu trả lời khác") from exc
        if "task_not_active" in message:
            raise VocabUnitNotFound("Task không còn thuộc published version hiện tại") from exc
        raise
    if not stored:
        raise VocabUnitError("Không lưu được kết quả học")
    attempt = stored.get("attempt") if isinstance(stored.get("attempt"), dict) else {}
    persisted_result = attempt.get("result") if isinstance(attempt.get("result"), dict) else grade
    return {
        "attempt_id": attempt.get("attempt_id") or attempt_id,
        "duplicate": stored.get("duplicate") is True,
        "correct": persisted_result.get("correct") is True,
        "score": attempt.get("score", persisted_result.get("score", 0)),
        "feedback_vi": persisted_result.get("feedback_vi"),
        "model_answer": persisted_result.get("model_answer"),
        "explanation_vi": persisted_result.get("explanation_vi"),
        "mastery": stored.get("mastery"),
    }


def validate_for_publish(
    content: dict[str, Any],
    sources: list[Any],
    tasks: list[dict[str, Any]],
) -> list[str]:
    return vocab_unit_rules.validate_for_publish(content, sources, tasks)


def create_unit(payload: dict[str, Any], admin_id: str) -> dict[str, Any]:
    try:
        result = supabase_admin.rpc("fn_create_vocab_learning_unit", {
            "p_unit_slug": payload["unit_slug"],
            "p_display_headword": payload["display_headword"],
            "p_unit_type": payload.get("unit_type", "learning_unit"),
            "p_sense_key": payload["sense_key"],
            "p_construction_key": payload["construction_key"],
            "p_communicative_function": payload["communicative_function"],
            "p_context_key": payload["context_key"],
            "p_target_level": payload["target_level"],
            "p_problem_tags": payload.get("problem_tags") or [],
            "p_learner_tags": payload.get("learner_tags") or [],
            "p_created_by": admin_id,
        }).execute()
    except Exception as exc:
        if "duplicate key" in str(exc).lower():
            raise VocabUnitConflict("Unit slug hoặc identity đã tồn tại") from exc
        raise
    row = _one(result)
    if not row:
        raise VocabUnitError("Không tạo được learning unit")
    return row


def create_version(
    unit_id: str,
    *,
    content: dict[str, Any],
    sources: list[dict[str, Any]],
    tasks: list[dict[str, Any]],
    change_note: str | None,
    admin_id: str,
) -> dict[str, Any]:
    try:
        result = supabase_admin.rpc("fn_create_vocab_unit_version", {
            "p_unit": unit_id,
            "p_content": content,
            "p_content_hash": vocab_unit_rules.canonical_version_hash(
                content, sources, tasks,
            ),
            "p_sources": sources,
            "p_tasks": tasks,
            "p_change_note": change_note,
            "p_authored_by": admin_id,
        }).execute()
    except Exception as exc:
        message = str(exc).lower()
        if "unit_not_found" in message:
            raise VocabUnitNotFound("Không tìm thấy learning unit") from exc
        if "duplicate key" in message:
            raise VocabUnitConflict("Nội dung version này đã tồn tại") from exc
        raise
    row = _one(result)
    if not row:
        raise VocabUnitError("Không tạo được version")
    return row


def validate_version(version_id: str) -> dict[str, Any]:
    version = _one(
        supabase_admin.table("vocab_unit_versions")
        .select("id,unit_id,status,content,sources")
        .eq("id", version_id)
        .limit(1)
        .execute()
    )
    if not version:
        raise VocabUnitNotFound("Không tìm thấy version")
    tasks = _rows(
        supabase_admin.table("vocab_unit_tasks")
        .select("id,task_type,dimension,prompt,answer_key,status")
        .eq("version_id", version_id)
        .order("sequence")
        .execute()
    )
    errors = validate_for_publish(
        version.get("content") if isinstance(version.get("content"), dict) else {},
        version.get("sources") if isinstance(version.get("sources"), list) else [],
        tasks,
    )
    return {"valid": not errors, "errors": errors, "version_id": version_id}


def review_version(
    version_id: str,
    *,
    review_type: str,
    decision: str,
    notes: str | None,
    admin_id: str,
) -> dict[str, Any]:
    if review_type not in REVIEW_TYPES:
        raise VocabUnitValidationError("Review type không hợp lệ")
    version = _one(
        supabase_admin.table("vocab_unit_versions")
        .select("id,status")
        .eq("id", version_id)
        .in_("status", ["draft", "in_review"])
        .limit(1)
        .execute()
    )
    if not version:
        raise VocabUnitNotFound("Không tìm thấy draft/in-review version")
    row = _one(
        supabase_admin.table("vocab_unit_version_reviews")
        .upsert({
            "version_id": version_id,
            "reviewer_id": admin_id,
            "review_type": review_type,
            "decision": decision,
            "notes": notes,
        }, on_conflict="version_id,reviewer_id,review_type")
        .execute()
    )
    if not row:
        raise VocabUnitError("Không lưu được editorial review")
    supabase_admin.table("vocab_unit_versions").update({"status": "in_review"}).eq("id", version_id).in_(
        "status", ["draft", "in_review"]
    ).execute()
    return row


def publish_version(version_id: str, admin_id: str) -> dict[str, Any]:
    validation = validate_version(version_id)
    if not validation["valid"]:
        raise VocabUnitValidationError("Version chưa đạt publish gate", validation["errors"])
    try:
        row = _one(
            supabase_admin.rpc("fn_publish_vocab_unit_version", {
                "p_version": version_id,
                "p_published_by": admin_id,
                "p_now": datetime.now(timezone.utc).isoformat(),
            }).execute()
        )
    except Exception as exc:
        message = str(exc)
        if any(token in message for token in (
            "missing_approval", "changes_requested", "missing_task_count",
            "missing_task_dimension", "task_dimension_mismatch",
            "reviewers_must_be_distinct", "version_not_publishable",
        )):
            raise VocabUnitValidationError("Version chưa đạt editorial publish gate", [message]) from exc
        raise
    if not row:
        raise VocabUnitError("Không publish được version")
    return row


def rollback_version(unit_id: str, version_id: str, admin_id: str) -> dict[str, Any]:
    try:
        row = _one(
            supabase_admin.rpc("fn_rollback_vocab_unit_version", {
                "p_unit": unit_id,
                "p_version": version_id,
                "p_updated_by": admin_id,
                "p_now": datetime.now(timezone.utc).isoformat(),
            }).execute()
        )
    except Exception as exc:
        if "not_found" in str(exc):
            raise VocabUnitNotFound("Không tìm thấy published version thuộc unit") from exc
        raise
    if not row:
        raise VocabUnitError("Không rollback được version")
    return row
