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
    _split_frontmatter,
    build_reading_passage_payload,
    build_reading_question_payloads,
    build_reading_test_payloads,
    parse_reading_passage,
    parse_reading_test,
    slugify,
    validate_reading_passage,
    validate_reading_test,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/admin/reading/content",
    tags=["admin-reading-content"],
)


_LIBRARIES = {"l1_vocab", "l2_skill", "l3_test"}
_STATUSES = {"draft", "published", "archived"}


@router.get("")
async def list_reading_content(
    library: str | None = Query(default=None),
    status: str | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(None),
):
    """Admin list across reading_passages OR reading_tests (Sprint 20.3 →
    Sprint 20.8). Returns all rows regardless of publish state (distinct from
    the student endpoints, which filter status='published'). Optional library +
    status filters. Light fields only — clients fetch the body via re-import or
    a future detail endpoint.

    Sprint 20.8 A4: when library='l3_test', the listing switches to the
    reading_tests table (one row per uploaded test, not three rows per test
    via reading_passages). This matches the import unit (one .md upload = one
    test_id) and gives a coherent admin view. Output rows share a normalised
    shape with the L1/L2 case so the frontend's list template stays uniform.
    """
    await require_admin(authorization)

    if library is not None and library not in _LIBRARIES:
        raise HTTPException(422, f"library must be one of {sorted(_LIBRARIES)}")
    if status is not None and status not in _STATUSES:
        raise HTTPException(422, f"status must be one of {sorted(_STATUSES)}")

    # ── L3 branch — list reading_tests (one row per test_id) ───────────
    if library == "l3_test":
        q = (
            supabase_admin.table("reading_tests")
            .select(
                "id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,status,updated_at,created_at",
                count="exact",
            )
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if status:
            q = q.eq("status", status)
        res = q.execute()
        # Normalise to the L1/L2 row shape so the frontend can reuse one
        # template. Map test_id → slug (the file-level identity), surface
        # module + the "60 min · 40 Qs" summary in `skill_focus`-equivalent.
        items: list[dict] = []
        for r in res.data or []:
            mins = r.get("time_limit_minutes")
            tot  = r.get("total_questions")
            summary = " · ".join(filter(None, [
                f"{mins} phút" if mins else None,
                f"{tot} câu" if tot else None,
            ]))
            items.append({
                "id":               r.get("id"),
                "slug":             r.get("test_id"),
                "library":          "l3_test",
                "title":            r.get("title"),
                "status":           r.get("status"),
                "difficulty_level": r.get("module"),
                "skill_focus":      summary,
                "topic_tags":       [],
                "updated_at":       r.get("updated_at"),
                "created_at":       r.get("created_at"),
            })
        return {
            "items":  items,
            "total":  getattr(res, "count", None) or 0,
            "limit":  limit,
            "offset": offset,
        }

    # ── L1/L2/all (other) branch — list reading_passages ───────────────
    q = (
        supabase_admin.table("reading_passages")
        .select(
            "id,slug,library,title,status,difficulty_level,skill_focus,"
            "topic_tags,updated_at,created_at",
            count="exact",
        )
        .order("updated_at", desc=True)
        .range(offset, offset + limit - 1)
    )
    if library:
        q = q.eq("library", library)
    if status:
        q = q.eq("status", status)

    res = q.execute()
    return {
        "items":  res.data or [],
        "total":  getattr(res, "count", None) or 0,
        "limit":  limit,
        "offset": offset,
    }



@router.post("/import")
async def import_reading_content(
    file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    authorization: str | None = Header(None),
):
    """Parse an uploaded `.md` file, validate, and (when dry_run=false + no
    errors) upsert into the appropriate tables.

    Dispatches by content_type:
      • reading_passage_l1 / reading_skill_exercise → reading_passages
        (+ reading_questions) — L1/L2 path, idempotent by slug.
      • reading_full_test → reading_tests + 3 reading_passages
        (library='l3_test') + reading_questions — L3 path (Sprint 20.5),
        idempotent by test_id (test row) + slug (each passage).

    Response: { parsed_data, validation_errors, dry_run, committed_id,
    action }. dry_run (default true) and any validation error both
    short-circuit before touching the DB."""
    admin = await require_admin(authorization)

    raw = await file.read()
    text = raw.decode("utf-8", errors="replace")

    # Peek the content_type once before committing to a parser. Frontmatter
    # parse errors short-circuit the same way for both L1/L2 and L3.
    try:
        fm, _body = _split_frontmatter(text)
    except FrontmatterError as exc:
        return {
            "parsed_data": None,
            "validation_errors": [{"field": "frontmatter", "message": str(exc)}],
            "dry_run": dry_run,
            "committed_id": None,
            "action": None,
        }

    if fm.get("content_type") == "reading_full_test":
        return await _import_l3_full_test(text, dry_run, admin)

    # L1 / L2 path (unchanged Sprint 20.1/20.3 logic below).
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
            passage_id = existing.data[0]["id"]
            result["action"] = "updated"
        else:
            payload["created_by"] = admin["id"]
            r = supabase_admin.table("reading_passages").insert(payload).execute()
            if not r.data:
                raise HTTPException(500, "Không lưu được nội dung.")
            passage_id = r.data[0]["id"]
            result["action"] = "created"
        result["committed_id"] = passage_id

        # Sync the passage's comprehension questions (idempotent: replace the
        # whole set on re-import so a corrected file fully overwrites). Delete
        # then insert — the FK is ON DELETE CASCADE but we scope by passage_id.
        supabase_admin.table("reading_questions").delete().eq("passage_id", passage_id).execute()
        if parsed.questions:
            q_rows = build_reading_question_payloads(parsed.questions, passage_id)
            supabase_admin.table("reading_questions").insert(q_rows).execute()
        result["question_count"] = len(parsed.questions)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("import_reading_content commit failed slug=%s: %s", parsed.slug, exc)
        raise HTTPException(500, "Không lưu được nội dung. Vui lòng thử lại.")

    return result


# ── Sprint 20.5 — L3 full-test import handler ─────────────────────────


async def _import_l3_full_test(text: str, dry_run: bool, admin: dict) -> dict:
    """Commit an L3 full-test: one reading_tests row + 3 reading_passages
    rows + their reading_questions. Idempotent by test_id (test row) and by
    slug (each passage). Re-import REPLACES the question set for each
    passage (delete-then-insert), so a corrected file fully overwrites.

    The supabase-py client doesn't expose transactions over REST, so the
    sequence runs best-effort sequential. A failure mid-way is logged and
    surfaces as a 500 — the partial state is consistent enough for an
    admin re-import to recover (idempotency above)."""
    parsed = parse_reading_test(text)
    errors = validate_reading_test(parsed)
    result = {
        "parsed_data":       parsed.as_preview(),
        "validation_errors": errors,
        "dry_run":           dry_run,
        "committed_id":      None,
        "action":            None,
    }
    if dry_run or errors:
        return result

    plan = build_reading_test_payloads(parsed)

    try:
        # 1) Upsert reading_tests row by test_id (TEXT UNIQUE — mig 086).
        test_existing = (
            supabase_admin.table("reading_tests")
            .select("id")
            .eq("test_id", parsed.test_id)
            .limit(1)
            .execute()
        )
        if test_existing.data:
            supabase_admin.table("reading_tests").update(plan["test_row"]).eq(
                "test_id", parsed.test_id
            ).execute()
            test_uuid = test_existing.data[0]["id"]
            result["action"] = "updated"
        else:
            test_payload = dict(plan["test_row"])
            test_payload["created_by"] = admin["id"]
            r = supabase_admin.table("reading_tests").insert(test_payload).execute()
            if not r.data:
                raise HTTPException(500, "Không lưu được test.")
            test_uuid = r.data[0]["id"]
            result["action"] = "created"
        result["committed_id"] = test_uuid

        # 2) Upsert each passage by slug (with test_id FK = the test we just
        #    created/found). Collect the passage_id per slug so step 3 can
        #    fan questions out.
        slug_to_passage_id: dict[str, str] = {}
        for prow in plan["passage_rows"]:
            prow = dict(prow)
            prow["test_id"] = test_uuid
            slug = prow.get("slug")
            existing = (
                supabase_admin.table("reading_passages")
                .select("id")
                .eq("slug", slug)
                .limit(1)
                .execute()
            )
            if existing.data:
                supabase_admin.table("reading_passages").update(prow).eq(
                    "slug", slug
                ).execute()
                slug_to_passage_id[slug] = existing.data[0]["id"]
            else:
                prow["created_by"] = admin["id"]
                r = supabase_admin.table("reading_passages").insert(prow).execute()
                if not r.data:
                    raise HTTPException(500, f"Không lưu được passage '{slug}'.")
                slug_to_passage_id[slug] = r.data[0]["id"]

        # 3) Replace each passage's reading_questions (delete-then-insert).
        total_qs = 0
        for slug, q_rows_partial in plan["passage_questions"]:
            passage_id = slug_to_passage_id.get(slug)
            if not passage_id:
                continue
            supabase_admin.table("reading_questions").delete().eq(
                "passage_id", passage_id
            ).execute()
            if q_rows_partial:
                q_rows = [dict(r, passage_id=passage_id) for r in q_rows_partial]
                supabase_admin.table("reading_questions").insert(q_rows).execute()
                total_qs += len(q_rows)
        result["question_count"] = total_qs
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("import_reading_content L3 commit failed test_id=%s: %s",
                     parsed.test_id, exc)
        raise HTTPException(500, "Không lưu được test. Vui lòng thử lại.")

    return result
