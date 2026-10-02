"""Submitted review context from the private admission revision, never live keys.

Callers retain ownership, seal/release and confidence gates before loading.
Legacy attempts are explicitly current fallback; no historical capture/backfill.
"""
from copy import deepcopy
import hashlib
import json

from fastapi import HTTPException


def load_review_snapshot(db, skill: str, attempt: dict) -> dict | None:
    if attempt.get("paper_revision") is None or attempt.get("_admin_preview"):
        return None
    try:
        rows = (db.table("mock_paper_attempt_snapshots").select("*")
                .eq("skill", skill).eq("attempt_id", str(attempt["id"]))
                .limit(1).execute().data)
        if not isinstance(rows, list) or len(rows) != 1:
            raise ValueError("missing frozen context")
        row = rows[0]
        if (row.get("skill") != skill or str(row.get("attempt_id")) != str(attempt["id"])
                or str(row.get("paper_id")) != str(attempt.get("test_id"))
                or row.get("paper_revision") != attempt["paper_revision"]
                or not isinstance(row.get("paper_row"), dict)
                or not isinstance(row.get("source_rows"), list)
                or not isinstance(row.get("marking_rows"), list)
                or any(not isinstance(value, dict) for value in row["source_rows"] + row["marking_rows"])):
            raise ValueError("invalid frozen context")
        return deepcopy(row)
    except Exception as exc:
        raise HTTPException(503, "Chưa đọc được nội dung gốc của lượt làm. Hãy thử lại.") from exc


def provenance(value, snapshot: dict | None, *, persisted=False, present=True) -> str:
    # Present-but-empty frozen fields remain empty and never fall through.
    if not present:
        return "unavailable"
    if persisted or snapshot is not None:
        return "submission_snapshot"
    return "unavailable" if value is None else "current_content_fallback"


def context_reference(snapshot: dict | None) -> dict:
    if snapshot is None:
        return {"provenance": "current_content_fallback", "possibly_changed": True,
                "paper_revision": None, "policy_revision": None}
    return {"provenance": "submission_snapshot", "possibly_changed": False,
            "paper_revision": snapshot["paper_revision"],
            "policy_revision": snapshot.get("policy_revision"),
            "context_sha256": hashlib.sha256(json.dumps({key: snapshot[key] for key in
                ("paper_row", "source_rows", "marking_rows")}, ensure_ascii=False,
                sort_keys=True, separators=(",", ":")).encode()).hexdigest()}


def question_context(question: dict | None, snapshot: dict | None) -> dict:
    """Display-only authored context: no accepted answer policy or hidden keys.

    Full private marking rows stay protected. Explicitly select display fields
    instead of returning a full payload, even in a post-submit response.
    """
    question = question or {}
    payload = question.get("payload") or {}
    fields = {"question_id": question.get("id") or question.get("question_id"),
              "instructions": payload.get("instructions", question.get("instructions")),
              "instruction": payload.get("instruction", question.get("instruction")),
              "options": payload.get("options", question.get("options")),
              "template": payload.get("template", question.get("template")),
              "max_words": payload.get("max_words", question.get("max_words")),
              "paragraph_labels": payload.get("paragraph_labels", question.get("paragraph_labels"))}
    for name in ("image_url", "image_alt", "template_kind", "variant", "word_limit",
                 "word_limit_text", "response_type"):
        fields[name] = payload.get(name, question.get(name))
    return {**deepcopy(fields), "context_provenance": {
        name: provenance(value, snapshot, present=(
            ("id" in question or "question_id" in question) if name == "question_id"
            else name in payload or name in question)) for name, value in fields.items()}}


def attach_review_web_explanations(skill, attempt, review, snapshot):
    """Keep the existing live permission gate, but serve only the frozen object.

    Publication can withdraw access; it cannot replace the question's original
    rationale with a subsequently authored version inside submitted review.
    """
    from services import mock_correction_service
    access = mock_correction_service.attach_web_explanations(
        skill, attempt, review, admin_preview=bool(attempt.get("_admin_preview")))
    original = {row.get("question_number"): row for row in
                (snapshot or {}).get("scoring_override_rows", [])}
    for item in review:
        if snapshot is not None and "web_explanation_object" in item:
            del item["web_explanation_object"]
            row = original.get(item.get("q_num"))
            if row is not None and "payload" in row:
                item["web_explanation_object"] = deepcopy(row["payload"])
        item.setdefault("context_provenance", {})["web_explanation_object"] = provenance(
            item.get("web_explanation_object"), snapshot,
            present="web_explanation_object" in item)
    return access
