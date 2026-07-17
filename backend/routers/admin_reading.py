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
import secrets
import string
from datetime import datetime, timedelta, timezone

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


def _normalise_l3_test_row(r: dict) -> dict:
    """A reading_tests row → the shared admin-list row shape (slug = test_id,
    difficulty_level ← module, skill_focus ← '60 phút · 40 câu' summary). The
    frontend renders ONE row per L3 test with full preview/edit/delete actions
    (l3-action-consistency), so test_id is the canonical identity everywhere."""
    mins = r.get("time_limit_minutes")
    tot = r.get("total_questions")
    summary = " · ".join(filter(None, [
        f"{mins} phút" if mins else None,
        f"{tot} câu" if tot else None,
    ]))
    return {
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
        # reading-access-tracking F1 — surface lock state for the admin row
        # action (never the password itself).
        "locked":           bool(((r.get("metadata") or {}).get("access") or {}).get("locked")),
        # reading-access-tracking B2 — surface share-link state for the admin
        # row "🔗 Link" control: whether a link is active + its (non-secret)
        # expiry. The token itself is NEVER surfaced here (it is the access
        # grant — shown only once at generate time, like the F1 password).
        "share_active":     bool(((r.get("metadata") or {}).get("share") or {}).get("token")),
        "share_expires_at": ((r.get("metadata") or {}).get("share") or {}).get("expires_at"),
    }


def _l3_test_rows(status: str | None) -> list[dict]:
    """All L3 tests, normalised — for splicing into the 'Tất cả' view so L3
    shows as test rows, not raw passages (l3-action-consistency)."""
    q = (
        supabase_admin.table("reading_tests")
        .select(
            "id,test_id,title,module,time_limit_minutes,passage_count,"
            "total_questions,band_target,status,updated_at,created_at,metadata",
        )
        .order("updated_at", desc=True)
    )
    if status:
        q = q.eq("status", status)
    return [_normalise_l3_test_row(r) for r in (q.execute().data or [])]


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

    # ── "L3 Full Test" tab → one row per test (reading_tests) ──────────
    if library == "l3_test":
        q = (
            supabase_admin.table("reading_tests")
            .select(
                "id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,status,updated_at,created_at,metadata",
                count="exact",
            )
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if status:
            q = q.eq("status", status)
        res = q.execute()
        return {
            "items":  [_normalise_l3_test_row(r) for r in (res.data or [])],
            "total":  getattr(res, "count", None) or 0,
            "limit":  limit,
            "offset": offset,
        }

    # ── L1 / L2 explicit tab → just those passages ─────────────────────
    if library in ("l1_vocab", "l2_skill"):
        q = (
            supabase_admin.table("reading_passages")
            .select(
                "id,slug,library,title,status,difficulty_level,skill_focus,"
                "topic_tags,updated_at,created_at",
                count="exact",
            )
            .order("updated_at", desc=True)
            .range(offset, offset + limit - 1)
            .eq("library", library)
        )
        if status:
            q = q.eq("status", status)
        res = q.execute()
        return {
            "items":  res.data or [],
            "total":  getattr(res, "count", None) or 0,
            "limit":  limit,
            "offset": offset,
        }

    # ── "Tất cả" (no library filter) → L1 + L2 passages + L3 TEST rows ──
    # l3-action-consistency: L3 appears as ONE test row per test (slug=test_id)
    # with full preview/edit/delete — NOT three raw passage rows (preview-only
    # + ambiguous to delete). Exclude l3_test passages, splice in the normalised
    # reading_tests rows, then sort by recency. The client fetches a single
    # ~200-row page (no pagination UI), so merge-then-slice in Python is correct
    # for the real usage; #363 stays safe because L3 carries test_id as its slug.
    pq = (
        supabase_admin.table("reading_passages")
        .select(
            "id,slug,library,title,status,difficulty_level,skill_focus,"
            "topic_tags,updated_at,created_at",
        )
        .neq("library", "l3_test")
        .order("updated_at", desc=True)
        .range(0, limit - 1)
    )
    if status:
        pq = pq.eq("status", status)
    passage_items = pq.execute().data or []

    merged = list(passage_items) + _l3_test_rows(status)
    merged.sort(key=lambda r: (r.get("updated_at") or ""), reverse=True)
    return {
        "items":  merged[offset:offset + limit],
        "total":  len(merged),
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


@router.post("/import-bundle")
async def import_reading_test_bundle(
    test_file: UploadFile = File(...),
    solution_file: UploadFile = File(...),
    dry_run: bool = Query(default=True),
    published: bool = Query(default=False),
    mini: bool = Query(default=False),
    authorization: str | None = Header(None),
):
    """reading-rich-test-solution (Part A) — import a TEST + SOLUTION markdown
    PAIR (the human-readable prose format). The answer keys live ONLY in the
    solution file, so both are required: the prose parser merges them into a
    ParsedReadingTest and commits through the SAME idempotent L3 path as the
    YAML import (_commit_l3_parsed). Rich per-Q solution → payload.solution; VI
    translation + extracted IMG-PROMPT blocks → reading_passages.metadata.

    dry_run=true (default) parses + validates without touching the DB."""
    admin = await require_admin(authorization)
    from services.reading_prose_import import build_parsed_reading_test_from_prose

    test_text = (await test_file.read()).decode("utf-8", errors="replace")
    sol_text = (await solution_file.read()).decode("utf-8", errors="replace")
    try:
        parsed = build_parsed_reading_test_from_prose(
            test_text, sol_text, published=published,
        )
    except Exception as exc:                                     # noqa: BLE001
        logger.error("prose-bundle parse failed: %s", exc)
        return {
            "parsed_data":       None,
            "validation_errors": [{"field": "bundle", "message": f"Parse lỗi: {exc}"}],
            "dry_run":           dry_run,
            "committed_id":      None,
            "action":            None,
        }
    # Reading mini test — the toggle flags this test as 'mini' (1-passage) vs
    # 'full' in the reading_tests.test_type column (mig 158), the field the
    # student list endpoint segregates on. The prose pipeline is otherwise
    # identical.
    result = await _commit_l3_parsed(
        parsed, dry_run, admin, test_type=("mini" if mini else "full"),
    )
    # bundle-import-ui — surface what the prose parse extracted so the admin
    # dry-run preview can confirm fidelity (translation + IMG-PROMPT + rich
    # solution aren't in the generic as_preview()).
    result["bundle_summary"] = {
        "passages_with_translation": sum(
            1 for p in parsed.passages if p.get("translation_vi")),
        "img_prompt_blocks": sum(
            len(p.get("img_prompts") or []) for p in parsed.passages),
        "questions_with_solution": sum(
            1 for p in parsed.passages for q in (p.get("questions") or [])
            if q.get("solution")),
    }
    # W-0 — surface non-fatal parse warnings (dropped rows / unmapped labels) so
    # the admin preview can show a red banner instead of losing answers silently.
    result["warnings"] = list(getattr(parsed, "warnings", []) or [])
    return result


# ── Sprint 20.5 — L3 full-test import handler ─────────────────────────


# l3-edit-delete-block-images — diagram/flow image metadata written by the
# upload endpoint into payload.template. The authored MD never carries these,
# so an edit (re-import = delete-then-insert of questions) must SNAPSHOT and
# RESTORE them, or editing a test would silently wipe its uploaded diagrams.
# The image lives on the run's first question (first-Q-owns the block image).
_IMAGE_TEMPLATE_KEYS = (
    "image_storage_path", "image_size_bytes", "image_format",
    "image_source", "image_uploaded_at", "image_uploaded_by",
)


def _snapshot_question_images(passage_id: str) -> dict:
    """q_num → preserved payload.template image_* keys for a passage's existing
    questions (so a re-import keeps admin-uploaded diagram/flow images)."""
    try:
        rows = (
            supabase_admin.table("reading_questions")
            .select("q_num,payload")
            .eq("passage_id", passage_id)
            .execute()
            .data
        ) or []
    except Exception:                                            # pragma: no cover
        return {}
    snap: dict = {}
    for r in rows:
        template = ((r.get("payload") or {}).get("template")) or {}
        img = {k: template[k] for k in _IMAGE_TEMPLATE_KEYS if k in template}
        if img:
            snap[r.get("q_num")] = img
    return snap


def _restore_question_images(q_rows: list[dict], preserved: dict) -> None:
    """In-place: re-merge preserved image_* keys into the new rows' payload.
    template, matched by q_num."""
    for row in q_rows:
        img = preserved.get(row.get("q_num"))
        if not img:
            continue
        payload = dict(row.get("payload") or {})
        template = dict(payload.get("template") or {})
        template.update(img)
        payload["template"] = template
        row["payload"] = payload


async def _import_l3_full_test(text: str, dry_run: bool, admin: dict) -> dict:
    """Commit an L3 full-test: one reading_tests row + 1..3 reading_passages
    rows + their reading_questions. Idempotent by test_id (test row) and by
    slug (each passage). Re-import REPLACES the question set for each
    passage (delete-then-insert) AND reconciles passages removed from the
    source file (Sprint 20.9 D1 — Codex audit P1-1): any reading_passages
    row attached to this test_id whose slug is not in the new payload is
    DELETED before the upsert step, so re-uploading a corrected file leaves
    no orphan rows. The FK on reading_questions is ON DELETE CASCADE, so
    the orphaned questions clean themselves up.

    The supabase-py client doesn't expose transactions over REST, so the
    sequence runs best-effort sequential. A failure mid-way is logged and
    surfaces as a 500 — the residual partial-state risk is documented in
    reading_content_format_v2.md §10 (quirk #8) and §11/P1-4; an admin
    re-import keys by test_id + slug + the new reconciliation step, so a
    second commit converges the state."""
    return await _commit_l3_parsed(parse_reading_test(text), dry_run, admin)


async def _commit_l3_parsed(parsed, dry_run: bool, admin: dict, test_type: str | None = None) -> dict:
    """Commit a pre-parsed ParsedReadingTest. Shared by the strict-YAML import
    (_import_l3_full_test) and the reading-rich-test-solution prose-bundle
    import, so both go through the SAME idempotent test_id/slug upsert +
    image-preserving question replace."""
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

        # Reading mini test — mig 158: test_type là cột thật (CHECK full|mini),
        # không stamp metadata nữa. test_type=None (YAML import, back-compat)
        # → không đụng: insert mới nhận DEFAULT 'full', re-import giữ nguyên.
        if test_type is not None:
            supabase_admin.table("reading_tests").update(
                {"test_type": test_type}
            ).eq("id", test_uuid).execute()

        # 2a) Sprint 20.9 D1 — RECONCILE removed passages. List the passages
        #     currently attached to this test, compare with the incoming slugs,
        #     and delete any that the operator removed from the source file.
        #     Their reading_questions go with them via the ON DELETE CASCADE
        #     FK in mig 086. This makes "fully overwrites" actually true in
        #     code, not just docs (audit P1-1).
        incoming_slugs = {
            prow.get("slug") for prow in plan["passage_rows"] if prow.get("slug")
        }
        existing_passages_res = (
            supabase_admin.table("reading_passages")
            .select("id,slug")
            .eq("test_id", test_uuid)
            .eq("library", "l3_test")
            .execute()
        )
        removed_slugs: list[str] = []
        for row in (existing_passages_res.data or []):
            slug = row.get("slug")
            if slug and slug not in incoming_slugs:
                supabase_admin.table("reading_passages").delete().eq(
                    "id", row["id"]
                ).execute()
                removed_slugs.append(slug)
        if removed_slugs:
            logger.info(
                "L3 import reconciled %d removed passage(s) for test_id=%s: %s",
                len(removed_slugs), parsed.test_id, removed_slugs,
            )
        result["removed_passage_slugs"] = removed_slugs

        # 2b) Upsert each passage by slug (with test_id FK = the test we just
        #     created/found). Collect the passage_id per slug so step 3 can
        #     fan questions out.
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
        # Snapshot uploaded diagram/flow images first, restore them onto the
        # new rows by q_num — an edit/re-import must not destroy them
        # (l3-edit-delete-block-images).
        total_qs = 0
        for slug, q_rows_partial in plan["passage_questions"]:
            passage_id = slug_to_passage_id.get(slug)
            if not passage_id:
                continue
            preserved = _snapshot_question_images(passage_id)
            supabase_admin.table("reading_questions").delete().eq(
                "passage_id", passage_id
            ).execute()
            if q_rows_partial:
                q_rows = [dict(r, passage_id=passage_id) for r in q_rows_partial]
                if preserved:
                    _restore_question_images(q_rows, preserved)
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


# ── Sprint 20.15 — L3 test admin preview + delete ──────────────────────
#
# Two test-level admin ops Andy flagged from the 20.14 dogfood:
#   GET    /admin/reading/content/tests/{test_id} — verification view
#          (full bundle WITH answer keys + explanations, any status)
#   DELETE /admin/reading/content/tests/{test_id} — attempt-safe delete
#          (hard cascade when 0 attempts, soft `status=archived` when
#          any attempt rows exist; never destroys student attempt data)
#
# Both look up by the human `test_id` text key (e.g. "AVR-READ-001") to
# match the admin list rows. The existing student detail endpoint
# (`routers/reading_student.py::get_reading_test`) is what students hit
# — it filters `status='published'` and STRIPS answer keys; the admin
# preview here filters NOTHING and includes the answer column.


def _fetch_admin_test_or_404(test_id: str) -> dict:
    """Read one reading_tests row by `test_id` (human key, TEXT UNIQUE in
    mig 086) for admin operations. 404 if absent; status filter is NOT
    applied — admins need to inspect / delete drafts + archived rows
    too. The student endpoint applies its own `status='published'` filter
    independently."""
    res = (
        supabase_admin.table("reading_tests")
        .select("id,test_id,title,module,time_limit_minutes,passage_count,"
                "total_questions,band_target,status,created_at,updated_at")
        .eq("test_id", test_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, f"Reading test {test_id!r} not found.")
    return res.data[0]


@router.get("/tests/{test_id}")
async def admin_get_reading_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 20.15 D1 — admin verification view of an uploaded L3 test.

    Same shape as the student detail (passages + questions stamped with
    passage_order + image_url signed for diagram/flow questions) but:
      • accepts any status (draft / published / archived) — admin needs
        to preview drafts before publishing
      • the question projection INCLUDES the answer key + explanation
        columns the student fetch deliberately strips. The whole
        purpose of the admin preview is to verify the keys are right
        before students see the test, so a "leak" here IS the feature.
    """
    await require_admin(authorization)
    test = _fetch_admin_test_or_404(test_id)

    passages_res = (
        supabase_admin.table("reading_passages")
        .select("id,slug,title,body_markdown,passage_order,word_count,"
                "estimated_minutes,topic_tags,status,metadata")
        .eq("test_id", test["id"])
        .eq("library", "l3_test")
        .order("passage_order")
        .execute()
    )
    passages = passages_res.data or []
    # reading-rich Part B — surface the extracted IMG-PROMPT blocks (Part A
    # stored them in metadata.img_prompts) as a clean top-level field so the
    # admin preview can show each prompt next to its block-image upload (#374),
    # for the copy → generate-externally → upload workflow. The rest of the
    # metadata blob stays server-side.
    for p in passages:
        p["img_prompts"] = (p.pop("metadata", None) or {}).get("img_prompts") or []

    passage_ids = [p["id"] for p in passages]
    questions: list[dict] = []
    if passage_ids:
        q_res = (
            supabase_admin.table("reading_questions")
            # Admin projection INCLUDES `answer` + `explanation` — the
            # student endpoint omits these on purpose; admin preview
            # exists precisely to check them.
            .select("id,q_num,question_type,prompt,payload,answer,"
                    "explanation,skill_tag,sub_skill,order_num,passage_id")
            .in_("passage_id", passage_ids)
            .order("q_num")
            .execute()
        )
        questions = q_res.data or []

    passage_order_by_id = {p["id"]: p.get("passage_order") for p in passages}
    for q in questions:
        q["passage_order"] = passage_order_by_id.get(q.get("passage_id"))

    # Sign diagram/flow images for the preview too — admin needs to see
    # what students will see. Reuse the existing helper from the student
    # router (single source of truth for the storage-path → signed-URL
    # transform).
    from routers.reading_student import _stamp_diagram_image_urls
    _stamp_diagram_image_urls(questions)

    test["passages"] = passages
    test["questions"] = questions
    return test


@router.delete("/tests/{test_id}")
async def admin_delete_reading_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 20.15 D2 — attempt-safe delete.

    Semantics (Code-authoritative per Lesson 9 "no workaround that
    loses student data"):
      • 0 attempts → HARD delete. Cascades through reading_passages →
        reading_questions via the mig 086 FK chains. The reading_test_
        attempts FK also cascades (mig 087) but there are no rows to
        cascade through. Returns ``{"action": "deleted"}``.
      • >0 attempts → SOFT delete. Sets `status='archived'` on the test
        row. Passages + questions + attempts stay intact so any
        in-flight student attempt can still resolve + so the admin's
        historic-attempt views (Sprint 20.7 diagnostic, etc) keep
        working. Student-facing endpoints already filter
        `status='published'`, so archived = invisible to new starters.
        Returns ``{"action": "archived", "attempts_preserved": N}``.

    The student-facing GET (`reading_student.get_reading_test`) and the
    list endpoint both filter `status='published'`, so a soft-delete is
    effectively the same as removal from the student's POV.
    """
    await require_admin(authorization)
    test = _fetch_admin_test_or_404(test_id)
    test_uuid = test["id"]

    # Count attempt rows. We use a head-style count so we don't haul
    # the rows themselves into memory; a single int back from supabase
    # is enough to branch the action.
    attempts_res = (
        supabase_admin.table("reading_test_attempts")
        .select("id", count="exact")
        .eq("test_id", test_uuid)
        .limit(1)
        .execute()
    )
    attempt_count = getattr(attempts_res, "count", None) or 0

    if attempt_count > 0:
        # Soft delete. Stays in the table so attempts (in-progress +
        # submitted) keep resolving and historic analytics work.
        (
            supabase_admin.table("reading_tests")
            .update({"status": "archived"})
            .eq("id", test_uuid)
            .execute()
        )
        logger.info(
            "[admin_reading] soft-delete (archived) test_id=%s attempts=%d",
            test_id, attempt_count,
        )
        return {
            "test_id":             test_id,
            "action":              "archived",
            "attempts_preserved":  attempt_count,
        }

    # Hard delete. The FK cascades (mig 086 + 087) clean up passages,
    # questions, and the (empty) attempt-row slot for this test.
    (
        supabase_admin.table("reading_tests")
        .delete()
        .eq("id", test_uuid)
        .execute()
    )
    logger.info(
        "[admin_reading] hard-delete test_id=%s (no attempts)",
        test_id,
    )
    return {
        "test_id":             test_id,
        "action":              "deleted",
        "attempts_preserved":  0,
    }


# ── reading-access-tracking F1 — lock / unlock + password ─────────────

def _gen_test_password() -> str:
    """Access-code-style password (XXXX-XXXX), via secrets. Each lock mints a
    fresh one — the old password dies."""
    alphabet = string.ascii_uppercase + string.digits
    grp = lambda: "".join(secrets.choice(alphabet) for _ in range(4))
    return grp() + "-" + grp()


@router.post("/tests/{test_id}/lock")
async def admin_lock_reading_test(
    test_id: str,
    body: dict,
    authorization: str | None = Header(default=None),
):
    """Toggle a test's password lock (for mock exams). Locking mints a NEW
    auto-generated password (regenerated every lock — the old one dies, access-
    code style) and returns it so the admin can copy + share it. Unlocking
    clears the password. The lock is enforced server-side in reading_student
    (the test bundle / start are 403'd without the matching X-Reading-Password).

    The lock config rides reading_tests.metadata.access (Pattern #15 — no
    schema change); read-modify-write preserves the rest of metadata
    (translation, img_prompts, …)."""
    admin = await require_admin(authorization)
    locked = bool((body or {}).get("locked"))

    res = (
        supabase_admin.table("reading_tests")
        .select("id,metadata").eq("test_id", test_id).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, f"Reading test {test_id!r} not found.")
    row = res.data[0]
    metadata = dict(row.get("metadata") or {})

    if locked:
        password = _gen_test_password()
        metadata["access"] = {
            "locked":     True,
            "password":   password,
            "locked_at":  None,           # stamped by the row's updated_at
            "locked_by":  admin.get("id"),
        }
    else:
        password = None
        metadata["access"] = {"locked": False}

    supabase_admin.table("reading_tests").update(
        {"metadata": metadata}
    ).eq("id", row["id"]).execute()
    logger.info("[admin_reading] %s test_id=%s by=%s",
                "lock" if locked else "unlock", test_id, admin.get("id"))
    return {"test_id": test_id, "locked": locked, "password": password}


_SHARE_MAX_DAYS = 90
_SHARE_DEFAULT_DAYS = 7


@router.post("/tests/{test_id}/share")
async def admin_share_reading_test(
    test_id: str,
    body: dict,
    authorization: str | None = Header(default=None),
):
    """reading-access-tracking Part B — generate / rotate / revoke a shareable,
    time-limited link for a full reading test. ANYONE with a live link (incl.
    anonymous, no account) can take the test and review the solution; the link
    BYPASSES the F1 password lock (it is itself the grant).

      body = {"expires_in_days": N}  → mint a FRESH token (rotation: the old one
                                       dies instantly because the student resolve
                                       looks up by the current metadata.share.token)
      body = {"revoke": true}        → drop the share entirely (all links die)

    Config rides reading_tests.metadata.share (Pattern #15 — no schema change);
    read-modify-write preserves the rest of metadata (access/translation/…).
    The token is unguessable (secrets.token_urlsafe). The client builds the URL
    (GitHub Pages origin) from the returned token."""
    admin = await require_admin(authorization)
    body = body or {}

    res = (
        supabase_admin.table("reading_tests")
        .select("id,metadata").eq("test_id", test_id).limit(1).execute()
    )
    if not res.data:
        raise HTTPException(404, f"Reading test {test_id!r} not found.")
    row = res.data[0]
    metadata = dict(row.get("metadata") or {})

    if body.get("revoke"):
        metadata.pop("share", None)
        supabase_admin.table("reading_tests").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
        logger.info("[admin_reading] share-revoke test_id=%s by=%s",
                    test_id, admin.get("id"))
        return {"test_id": test_id, "share": None}

    try:
        days = int(body.get("expires_in_days") or _SHARE_DEFAULT_DAYS)
    except (TypeError, ValueError):
        raise HTTPException(422, "expires_in_days must be an integer")
    if not (1 <= days <= _SHARE_MAX_DAYS):
        raise HTTPException(422, f"expires_in_days must be 1..{_SHARE_MAX_DAYS}")

    token = secrets.token_urlsafe(24)            # unguessable; rotation kills the old
    expires_at = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    metadata["share"] = {
        "token":      token,
        "expires_at": expires_at,
        "created_by": admin.get("id"),
    }
    supabase_admin.table("reading_tests").update(
        {"metadata": metadata}
    ).eq("id", row["id"]).execute()
    logger.info("[admin_reading] share-generate test_id=%s days=%s by=%s",
                test_id, days, admin.get("id"))
    return {
        "test_id":    test_id,
        "share": {
            "token":          token,
            "expires_at":     expires_at,
            "expires_in_days": days,
        },
    }


@router.delete("/passages/{slug}")
async def admin_delete_reading_passage(
    slug: str,
    authorization: str | None = Header(default=None),
):
    """admin-reading-l1-l2-actions — delete a standalone L1/L2 passage by slug.

    L1 vocab + L2 skill are *ungraded* practice: instant per-Q feedback with
    NO persistence — there is no L1/L2 attempt table (only `reading_test_
    attempts`, which references L3 tests). So unlike the L3 delete there is no
    student data to protect, and this is always a HARD delete: it removes the
    `reading_passages` row and cascades its `reading_questions` via the mig 086
    `passage_id` FK. Content is recoverable by re-importing the source `.md`.

    L3 passages are NOT deletable here — they belong to a test and must go
    through ``DELETE /tests/{test_id}`` (attempt-safe). This keeps the
    reading-admin-preview-fix (#363) separation intact: L3 = test_id path,
    L1/L2 = slug path, never crossed. An L3 slug → 409 pointing at the right
    endpoint.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("reading_passages")
        .select("id,library,title")
        .eq("slug", slug)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Reading passage not found")
    passage = res.data[0]

    if passage.get("library") not in ("l1_vocab", "l2_skill"):
        # An L3 passage row — refuse and point at the attempt-safe test delete.
        raise HTTPException(
            409,
            "L3 test passages must be deleted via the test (DELETE "
            "/admin/reading/content/tests/{test_id}), not by passage slug.",
        )

    (
        supabase_admin.table("reading_passages")
        .delete()
        .eq("id", passage["id"])
        .execute()
    )
    logger.info(
        "[admin_reading] hard-delete passage slug=%s library=%s",
        slug, passage.get("library"),
    )
    return {
        "slug":    slug,
        "library": passage.get("library"),
        "action":  "deleted",
    }


# ── Sprint 20.14f-α — Diagram / flow-chart image upload ──────────────
#
# Manual image upload for `diagram_label_completion` /
# `flow_chart_completion` questions. Standards §2A.13 + §2A.12 accept
# both ASCII art and a real image; this endpoint is the image path
# (AI-gen is Sprint 20.14f-β, deferred).
#
# Sits on a sibling router with a different URL prefix
# (`/admin/reading/questions/...`) so it doesn't pollute the
# content-import router. Both are registered in main.py.
#
# Why a separate file boundary wasn't created: the upload endpoints are
# small (~120 LOC) and share the same admin auth + supabase_admin
# client the import router already uses. Splitting into a third reading
# admin file would mean a third Mind-side index without earning the
# isolation.

questions_router = APIRouter(
    prefix="/admin/reading/questions",
    tags=["admin-reading-questions"],
)

_DIAGRAM_FLOW_TYPES = ("diagram_label_completion", "flow_chart_completion")
_SIGNED_URL_TTL_PREVIEW = 3600   # 1h — admin upload-preview round-trip


def _fetch_question_or_404(question_id: str) -> dict:
    """Read one reading_questions row. 404 if absent, 422 if its
    question_type isn't in the diagram / flow family — both upload +
    delete need to refuse non-image-bearing types up front."""
    res = (
        supabase_admin.table("reading_questions")
        .select("id, q_num, question_type, payload, passage_id")
        .eq("id", question_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, f"Reading question {question_id} not found.")
    row = res.data[0]
    if row.get("question_type") not in _DIAGRAM_FLOW_TYPES:
        raise HTTPException(
            422,
            f"Image upload is only available for {', '.join(_DIAGRAM_FLOW_TYPES)} "
            f"questions; this question is {row.get('question_type')!r}.",
        )
    return row


def _resolve_test_id_for_question(passage_id: str) -> str:
    """Walk passage_id → reading_passages.test_id (the parent L3 test UUID)
    so the storage path bins images by test. 500 if either lookup fails —
    every diagram/flow Q must belong to an L3 passage with a non-NULL
    test_id (mig 086 NOT NULL on reading_questions.passage_id, and L3
    passages always carry test_id by Sprint 20.5 import contract)."""
    res = (
        supabase_admin.table("reading_passages")
        .select("test_id")
        .eq("id", passage_id)
        .limit(1)
        .execute()
    )
    test_id = (res.data or [{}])[0].get("test_id")
    if not test_id:
        raise HTTPException(
            500,
            f"Reading passage {passage_id} has no parent test_id; cannot "
            "scope the diagram image storage path.",
        )
    return str(test_id)


def _sign_diagram_image_url(storage_path: str | None,
                            expires_in: int = _SIGNED_URL_TTL_PREVIEW) -> str | None:
    """Best-effort signed URL for a diagram image. Returns ``None`` on
    any failure so the admin UI can degrade to a "image uploaded but
    preview unavailable" notice without a follow-up round-trip."""
    if not storage_path:
        return None
    from config import settings
    try:
        signed = supabase_admin.storage.from_(
            settings.READING_IMAGES_BUCKET,
        ).create_signed_url(storage_path, expires_in)
    except Exception as exc:                                                  # pragma: no cover
        logger.warning("[reading_image] signed URL mint failed: %s", exc)
        return None
    return (signed or {}).get("signedURL") or (signed or {}).get("signed_url")


@questions_router.post("/{question_id}/upload-diagram-image")
async def admin_upload_diagram_image(
    question_id: str,
    image_file: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Sprint 20.14f-α — manual image upload for a diagram / flow-chart
    question. Mirrors the listening map-image upload (Sprint 13.5.9.3).

    Returns the updated `payload.template` bundle + a 1h signed URL so
    the admin UI can preview the image without a follow-up fetch.

    Status codes:
      • 200 — upload succeeded
      • 400 — image too small (<100 B)
      • 413 — image too large (>5 MB)
      • 415 — unsupported format (only PNG/JPG/WebP via magic-byte sniff)
      • 422 — question_type isn't diagram_label_completion /
              flow_chart_completion
      • 404 — question_id not found
      • 500 — bucket / storage error (likely deploy precondition: the
              `READING_IMAGES_BUCKET` Supabase bucket doesn't exist yet)
    """
    from services.reading_image import (
        InvalidImageError, upload_diagram_image,
    )

    admin_user = await require_admin(authorization)
    question = _fetch_question_or_404(question_id)
    test_id = _resolve_test_id_for_question(question["passage_id"])

    contents = await image_file.read()
    try:
        meta = upload_diagram_image(
            contents=contents,
            question_id=question_id,
            test_id=test_id,
            supabase=supabase_admin,
            uploaded_by=admin_user.get("id"),
        )
    except InvalidImageError as exc:
        raise HTTPException(exc.http_status, str(exc))

    # Merge metadata into payload.template. The existing payload may
    # already carry a template (e.g. summary_text on summary_completion
    # — not applicable here, but defensive). Read-modify-write keeps
    # any unrelated template keys intact.
    payload = dict(question.get("payload") or {})
    template = dict(payload.get("template") or {})
    template.update(meta)
    payload["template"] = template

    (
        supabase_admin.table("reading_questions")
        .update({"payload": payload})
        .eq("id", question_id)
        .execute()
    )

    logger.info(
        "[reading_image] upload q=%s size=%d fmt=%s by=%s",
        question_id, meta["image_size_bytes"], meta["image_format"],
        admin_user.get("id"),
    )

    return {
        "question_id":        question_id,
        "image_storage_path": meta["image_storage_path"],
        "image_size_bytes":   meta["image_size_bytes"],
        "image_format":       meta["image_format"],
        "image_source":       meta["image_source"],
        "image_uploaded_at":  meta["image_uploaded_at"],
        "signed_url":         _sign_diagram_image_url(meta["image_storage_path"]),
    }


@questions_router.delete("/{question_id}/diagram-image")
async def admin_delete_diagram_image(
    question_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 20.14f-α — remove the diagram image so the admin can
    re-upload (e.g. after a new render). Both the Storage object and
    the `payload.template.image_*` metadata are cleared.

    Status codes:
      • 200 — deleted (or no-op if no image was present)
      • 404 — question_id not found
      • 422 — wrong question_type
    """
    from config import settings

    admin_user = await require_admin(authorization)
    question = _fetch_question_or_404(question_id)

    payload = dict(question.get("payload") or {})
    template = dict(payload.get("template") or {})
    storage_path = template.get("image_storage_path")

    if storage_path:
        try:
            supabase_admin.storage.from_(
                settings.READING_IMAGES_BUCKET,
            ).remove([storage_path])
        except Exception as exc:                                              # pragma: no cover
            logger.warning(
                "[reading_image] delete bytes failed q=%s path=%s: %s",
                question_id, storage_path, exc,
            )
            # Continue — clearing the row metadata is the primary
            # source of truth, the stale bytes can be reaped later.

    # Strip every image_* key from template; keep unrelated template
    # fields (e.g. a future summary_text) intact.
    for k in ("image_storage_path", "image_size_bytes", "image_format",
              "image_source", "image_uploaded_at", "image_uploaded_by"):
        template.pop(k, None)
    if template:
        payload["template"] = template
    else:
        payload.pop("template", None)

    (
        supabase_admin.table("reading_questions")
        .update({"payload": payload})
        .eq("id", question_id)
        .execute()
    )

    logger.info(
        "[reading_image] delete q=%s by=%s",
        question_id, admin_user.get("id"),
    )

    return {"question_id": question_id, "deleted": bool(storage_path)}
