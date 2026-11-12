"""Class-linked Skill Drill evidence and completion rules."""
from collections import defaultdict

from fastapi import HTTPException
from postgrest.exceptions import APIError


def require_homework_schema(db) -> None:
    try:
        if db.rpc("fn_listening_drill_homework_ready", {}).execute().data is True:
            return
    except APIError as exc:
        if exc.code not in {"PGRST202", "42883"}:
            raise
    raise HTTPException(503, "Tính năng giao bài luyện nghe đang chờ cập nhật dữ liệu.")


def drill_config(assignment: dict) -> dict | None:
    if assignment.get("skill") != "listening":
        return None
    return (assignment.get("content_config") or {}).get("skill_drill")


def completed_at(assignment: dict, listening_at: str, dictation: list[dict]) -> str | None:
    config = drill_config(assignment) or {}
    if not config.get("dictation_required"):
        return listening_at
    from services.class_assignment_service import _at

    first_by_section = {}
    for row in dictation:
        when = row.get("completed_at")
        if when and _at(when) >= _at(listening_at):
            section = row["section_num"]
            if section not in first_by_section or _at(when) < _at(first_by_section[section]):
                first_by_section[section] = when
    required = set(config.get("sections") or [])
    if not required or not required.issubset(first_by_section):
        return None
    return max((first_by_section[section] for section in required), key=_at)


def evidence_by_item(db, ids: list[str], *, include_details: bool = False) -> dict[str, list[dict]]:
    from services.class_assignment_service import _paged

    columns = "id,class_assignment_item_id,section_num,completed_at"
    if include_details:
        columns += ",results,error_trends,accuracy,correct_words,total_words,grading_version,reference_sha256"
    out = defaultdict(list)
    for offset in range(0, len(ids), 100):
        rows = _paged(db, "dictation_sessions", columns, lambda query: query.in_(
            "class_assignment_item_id", ids[offset:offset + 100]))
        for row in rows:
            out[row["class_assignment_item_id"]].append(row)
    return out


def public_drill(row: dict) -> bool:
    return (row.get("test_type") == "drill" and row.get("is_public") is True
            and row.get("status") == "published"
            and (row.get("scoring_policy") or "diagnostic") == "diagnostic"
            and not row.get("content_package_id"))


def report_by_item(db, items: list[dict], config: dict) -> dict:
    from services.class_assignment_service import _paged

    ids = [item["id"] for item in items]
    sessions = evidence_by_item(db, ids)
    attempts = defaultdict(list)
    playback = defaultdict(list)
    for offset in range(0, len(ids), 100):
        chunk = ids[offset:offset + 100]
        for row in _paged(db, "listening_test_attempts",
                          "id,class_assignment_item_id,submitted_at,status,score,grading_details,created_at",
                          lambda q: q.in_("class_assignment_item_id", chunk)):
            attempts[row["class_assignment_item_id"]].append(row)
        for row in _paged(db, "listening_drill_playback",
                          "class_assignment_item_id,stage,attempt_id,page_id,plays,played_ms",
                          lambda q: q.in_("class_assignment_item_id", chunk)):
            playback[row["class_assignment_item_id"]].append(row)
    out = {}
    for item in items:
        key = item["id"]
        submitted = [a for a in attempts[key] if a.get("submitted_at")]
        chosen = next((a for a in submitted if a["id"] == item.get("artifact_id")), None)
        if not chosen and submitted:
            chosen = min(submitted, key=lambda a: a["submitted_at"])
        if not chosen and attempts[key]:
            chosen = max(attempts[key], key=lambda a: a["created_at"])
        totals = {}
        for stage in ("listening", "dictation"):
            matching = [r for r in playback[key] if r["stage"] == stage and
                        (stage == "dictation" or (chosen and r["attempt_id"] == chosen["id"]))]
            totals[stage] = {"plays": sum(r["plays"] for r in matching),
                             "played_ms": sum(r["played_ms"] for r in matching)} if matching else None
        details = (chosen or {}).get("grading_details") or []
        out[key] = {
            "listening_submitted_at": (chosen or {}).get("submitted_at"),
            "correct": (chosen or {}).get("score"),
            "total": len(details) or None,
            "playback": totals,
            "dictation_required": config["dictation_required"],
            "dictation_sections": len(config["sections"]),
            "dictation_done": len({s["section_num"] for s in sessions[key]} & set(config["sections"])),
            "dictation_reports": [
                {"id": s["id"], "section_num": s["section_num"]}
                for s in sorted(sessions[key], key=lambda s: (s["section_num"], s["completed_at"]))
            ],
        }
    return out
