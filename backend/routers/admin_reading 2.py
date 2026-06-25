"""routers/admin_reading.py — Admin content import for the Reading module
(Sprint 20.1, cluster 20.x foundation).

Phase 1 ships ONE endpoint:

  POST /admin/reading/content/import   — L1 vocab-reading passage import
                                         (Markdown + YAML frontmatter)

It mirrors the writing content import (admin_writing_tips.py `content_router`)
— same dry-run-then-commit, upsert-by-slug contract — but upserts into the
`reading_passages` table (library='l1_vocab'), NOT writing_tips. Reading keeps
its own tables per the cluster 20.0 Discovery watch-item (the writing_tips
table + writing-only task_type are not a fit, and a rename of writing_tips is
deferred debt — do not entangle reading into it).

Contract: docs/clusters/20_x/reading_content_format_v1.md.

Out of scope (later sprints): L2 skill-exercise + L3 full-test structured
question import (reading_questions / reading_tests) is a separate pipeline
(Sprints 20.3 / 20.5); the student-facing reads live in a reading_student
router (Sprint 20.2). There is no admin import UI yet — this endpoint is
driven by the test suite / curl until the admin page lands (Sprint 20.3/20.8).
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile

from database import supabase_admin
from routers.admin import require_admin
from services.content_import_service import (
    FrontmatterError,
    build_reading_passage_payload,
    parse_reading_passage,
    slugify,
    validate_reading_passage,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/reading/content",
    tags=["admin-reading-content"],
)


@router.post("/import")
async def import_reading_content(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    """Parse an uploaded `.md` L1 passage, validate it, and (when
    dry_run=false + no errors) upsert into reading_passages by slug.

    Idempotent by slug — a re-uploaded file with the same slug UPDATES the
    row in place (created_by preserved), so fixing content = re-upload.

    Response: { parsed_data, validation_errors, dry_run, committed_id,
    action }. dry_run (default true) and any validation error both
    short-circuit before touching the DB."""
    admin = await require_admin(authorization)

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    try:
        parsed = parse_reading_passage(text)
    except FrontmatterError as exc:
        return {
            "parsed_data": None,
            "validation_errors": [{"field": "frontmatter", "message": str(exc)}],
            "dry_run": dry_run,
            "committed_id": None,
            "action": None,
        }

    # Fill the effective slug for the preview + commit (only when omitted).
    if not parsed.slug:
        parsed.slug = slugify(parsed.title or "")

    errors = validate_reading_passage(parsed)
    result = {
        "parsed_data": parsed.as_preview(),
        "validation_errors": errors,
        "dry_run": dry_run,
        "committed_id": None,
        "action": None,
    }
    if dry_run or errors:
        return result

    # ── Commit: upsert by slug ──
    payload = build_reading_passage_payload(parsed, parsed.slug)
    try:
        existing = (
            supabase_admin.table("reading_passages")
            .select("id")
            .eq("slug", parsed.slug)
            .limit(1)
            .execute()
        )
        if existing.data:
            supabase_admin.table("reading_passages").update(payload).eq("slug", parsed.slug).execute()
            result["committed_id"] = existing.data[0]["id"]
            result["action"] = "updated"
        else:
            payload["created_by"] = admin["id"]
            r = supabase_admin.table("reading_passages").insert(payload).execute()
            if not r.data:
                raise HTTPException(500, "Không lưu được nội dung.")
            result["committed_id"] = r.data[0]["id"]
            result["action"] = "created"
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("import_reading_content commit failed slug=%s: %s", parsed.slug, exc)
        raise HTTPException(500, "Không lưu được nội dung. Vui lòng thử lại.")

    return result
