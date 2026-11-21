"""routers.listening.admin_import — admin test-bundle import (BACKENDSPLIT-0076 T004).

The "Cambridge IELTS test bundle" block of the former single-file
routers/listening.py (lines 2471–3830), cut and pasted unchanged: test CRUD,
audio upload and assembly, full-test and drill import. The package re-exports
every name; tests patch ``routers.listening``, never this module (see __init__.py).
"""

from __future__ import annotations

import hashlib
import uuid
from typing import Any, Literal, Optional
from fastapi import (
    APIRouter, File, Header, HTTPException, Query,
    UploadFile,
)
from pydantic import BaseModel, ConfigDict, Field
from services import listening_blackeye as blackeye
from starlette.concurrency import run_in_threadpool
from config import settings
from services.errors import clip_user_value, describe_parse_error
from database import supabase_admin
from services.class_assignment_service import (
    active_exam_assignment_references,
    DeadlinePassedError,
    ItemNotFoundError,
    TaskMismatchError,
    validate_class_item_for_test,
)
from services import listening_fulltest_import
from services import listening_drill_import

from ._common import _upload_audio_to_bucket, admin_router, logger, require_admin


# ── Sprint 13.4 — Cambridge IELTS test bundle (listening_tests) ──────────────


_TEST_STATUS_VALUES = {"draft", "published", "archived"}
# Sprint 13.4.2 — markdown parser ships with a tighter 1 MB cap per file
# (markdown is text-only; Pilot 01 is ~30KB so 1MB is generous).
_CONVERT_MAX_DOCX_BYTES = 1 * 1024 * 1024
_CONVERT_ALLOWED_EXTENSIONS = (".md", ".markdown")


class ListeningTestPatchRequest(BaseModel):
    """PATCH /admin/listening/tests/{id} body — Sprint 13.4.

    Allow-list (all optional, partial-update friendly):
      test_id, title, version, band_target, accent_profile, themes.
    """
    model_config = ConfigDict(extra="forbid")

    test_id:        Optional[str]              = None
    title:          Optional[str]              = None
    version:        Optional[str]              = None
    band_target:    Optional[float]            = None
    accent_profile: Optional[list[str]]        = None
    themes:         Optional[dict[str, str]]   = None
    # Dành riêng cho kỳ thi thử — ẩn khỏi thư viện học viên (mig 170).
    exam_only:      Optional[bool]              = None
    # Canonical self-practice visibility (mig 258), independent of mock/class.
    is_public:      Optional[bool]              = None


class ListeningTestStatusPatchRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: str


@admin_router.get("/tests")
async def admin_list_listening_tests(
    status: str = Query(default="all"),
    search: str = Query(default=""),
    test_type: str = Query(default="all"),
    limit: int  = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    authorization: str | None = Header(default=None),
):
    """Paginated list of test bundles for the admin browser.

    status defaults to 'all'. ``search`` is a substring match against
    ``test_id`` (case-insensitive ilike). Each row carries a synthetic
    ``audio_ready_count`` — how many of the 4 section rows already have
    audio_storage_path set (powers the "X/4 sections có audio" column).

    `test_type` accepts a concrete type, `exam` (= full|mini|drill, everything
    that existed before the generated `practice` bank) or `all`.

    It defaults to **all**, and the narrowing is the CALLER's job. It used to
    default to `exam`, to keep a few hundred imported practice items from
    filling the mock-exam picker's first page and pushing the Cambridge papers
    out of sight. But four clients share this endpoint and only that one wants
    the narrow view: the tests browser, the audit page and the import lookup
    all call it plain, so the default silently made the entire practice bank
    unfindable — an operator could not audit or publish an imported pack at
    all. A default that hides rows is the wrong shape for a management list;
    the picker asks for `exam` explicitly instead.
    """
    await require_admin(authorization)

    if status != "all" and status not in _TEST_STATUS_VALUES:
        raise HTTPException(
            422,
            f"status must be one of {sorted(_TEST_STATUS_VALUES | {'all'})}",
        )
    _ADMIN_TYPE_FILTERS = {"exam", "all", "full", "mini", "drill", "practice"}
    # Called directly (unit tests, internal reuse) an omitted Query() param
    # arrives as its FieldInfo sentinel, not the default string — comparing that
    # to "all" is false, so the filter would fall through to
    # `eq("test_type", <FieldInfo>)` and quietly return nothing.
    if not isinstance(test_type, str):
        test_type = "all"
    if test_type not in _ADMIN_TYPE_FILTERS:
        raise HTTPException(
            422, f"test_type must be one of {sorted(_ADMIN_TYPE_FILTERS)}")

    q = (
        supabase_admin.table("listening_tests")
        .select("*", count="exact")
        .order("created_at", desc=True)
        .order("id", desc=True)
        .range(offset, offset + limit - 1)
    )
    if test_type == "exam":
        q = q.in_("test_type", ["full", "mini", "drill"])
    elif test_type != "all":
        q = q.eq("test_type", test_type)
    if status != "all":
        q = q.eq("status", status)
    if search.strip():
        q = q.ilike("test_id", f"%{search.strip()}%")

    q = await run_in_threadpool(blackeye.exclude_tests, supabase_admin, q, key="id")
    res = q.execute()
    total = getattr(res, "count", None)
    if not isinstance(total, int) or isinstance(total, bool) or total < 0:
        raise HTTPException(503, "Không xác định được tổng số đề Listening. Vui lòng tải lại.")
    items = res.data or []

    # Annotate each test with audio-readiness counts. One round-trip per
    # response (admin lists are page-sized, so this is fine for now).
    test_ids = [t["id"] for t in items]
    audio_counts: dict[str, int] = {}
    section_counts: dict[str, int] = {}
    if test_ids:
        sections = (
            supabase_admin.table("listening_content")
            .select("test_id,audio_storage_path")
            .in_("test_id", test_ids)
            .execute()
        )
        for row in sections.data or []:
            tid = row.get("test_id")
            if not tid:
                continue
            section_counts[tid] = section_counts.get(tid, 0) + 1
            if row.get("audio_storage_path"):
                audio_counts[tid] = audio_counts.get(tid, 0) + 1

    for item in items:
        item["section_count"]      = section_counts.get(item["id"], 0)
        item["audio_ready_count"]  = audio_counts.get(item["id"], 0)

    return {
        "items":  items,
        "total":  total,
        "limit":  limit,
        "offset": offset,
    }


@admin_router.get("/tests/{test_id}")
async def admin_get_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Single test detail — bundles the 4 section content_ids +
    per-section exercise counts so the admin tests-detail page (Sprint
    13.5) can render without N+1 lookups.
    """
    await require_admin(authorization)

    res = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "Test bundle not found")
    test = res.data[0]

    sections_res = (
        supabase_admin.table("listening_content")
        .select("id,section_num,title,status,audio_storage_path,transcript")
        .eq("test_id", test_id)
        .order("section_num")
        .execute()
    )
    sections = sections_res.data or []
    content_ids = [s["id"] for s in sections]

    exercise_counts: dict[str, int] = {}
    if content_ids:
        ex_res = (
            supabase_admin.table("listening_exercises")
            .select("content_id")
            .in_("content_id", content_ids)
            .execute()
        )
        for row in ex_res.data or []:
            cid = row["content_id"]
            exercise_counts[cid] = exercise_counts.get(cid, 0) + 1

    for s in sections:
        s["exercise_count"] = exercise_counts.get(s["id"], 0)
        s["audio_ready"] = bool(s.get("audio_storage_path"))

    # Sprint 13.5.6 — surface plan-label exercises so the admin
    # tests-detail page can show a "Hình map" panel per exercise
    # without a second round-trip. We deliberately strip the answers
    # field at this admin surface as well — admins manage answer keys
    # through the import-fulltest re-import flow, not this endpoint.
    plan_label_exercises: list[dict] = []
    if content_ids:
        pl_res = (
            supabase_admin.table("listening_exercises")
            .select("id,content_id,payload")
            .in_("content_id", content_ids)
            .execute()
        )
        section_num_by_id = {s["id"]: s.get("section_num") for s in sections}
        for row in pl_res.data or []:
            payload = row.get("payload") or {}
            if payload.get("variant") != "mcq_letter_label":
                continue
            metadata = payload.get("metadata") or {}
            plan_label_exercises.append({
                "id":               row["id"],
                "content_id":       row["content_id"],
                "section_num":      section_num_by_id.get(row["content_id"]),
                "map_description":  metadata.get("map_description")
                                    or payload.get("map_description")
                                    or "",
                "letter_options":   metadata.get("letter_options")
                                    or payload.get("letter_options")
                                    or list("ABCDEFGH"),
                # Sprint 13.5.9 — surface the curated prompt (when the
                # parser found one) + the source used by the most recent
                # successful generation so the admin UI can show
                # "custom" vs "template" without a second round-trip.
                "map_image_custom_prompt": (
                    metadata.get("map_image_custom_prompt")
                    or payload.get("map_image_custom_prompt")
                    or None
                ),
                "map_image_prompt_source": payload.get("map_image_prompt_source"),
                "has_map_image":    bool(payload.get("map_image_storage_path")),
                "map_image_model":  payload.get("map_image_model"),
                "map_image_generated_at": payload.get("map_image_generated_at"),
                # Sprint 13.5.9.3 — provenance flag so the admin panel
                # can render a "Manual upload" vs "API: <model>" badge
                # without inferring from null fields.
                "map_image_source": payload.get("map_image_source")
                                    or ("api_generation" if payload.get("map_image_model") else None),
            })

    test["sections"] = sections
    test["content_ids"] = content_ids
    test["plan_label_exercises"] = plan_label_exercises
    return test


@admin_router.patch("/tests/{test_id}")
async def admin_patch_listening_test(
    test_id: str,
    body: ListeningTestPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Update editable metadata fields on a listening_tests row.

    Metadata-only requests retain the existing field allow-list. Requests
    containing visibility fields use the serialized policy writer; mixed
    metadata/policy requests are rejected atomically by its policy allow-list.
    """
    actor = await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")
    current = existing.data[0]

    update: dict = {}

    if body.test_id is not None:
        new_id = body.test_id.strip()
        if not new_id:
            raise HTTPException(422, "test_id must not be empty")
        if new_id != current.get("test_id"):
            # UNIQUE — surface 422 before Supabase rejects with 23505.
            dup = (
                supabase_admin.table("listening_tests")
                .select("id")
                .eq("test_id", new_id)
                .limit(1)
                .execute()
            )
            if dup.data:
                raise HTTPException(422, f"Test ID '{clip_user_value(new_id)}' đã tồn tại.")
        update["test_id"] = new_id

    if body.title is not None:
        title = body.title.strip()
        if not title:
            raise HTTPException(422, "title must not be empty")
        update["title"] = title

    if body.exam_only is not None:
        update["exam_only"] = bool(body.exam_only)

    if body.is_public is not None:
        update["is_public"] = bool(body.is_public)

    if body.version is not None:
        update["version"] = body.version.strip() or "1.0"

    if body.band_target is not None:
        if not (1.0 <= body.band_target <= 9.0):
            raise HTTPException(422, "band_target must be in [1.0, 9.0]")
        update["band_target"] = body.band_target

    if body.accent_profile is not None:
        update["accent_profile"] = [
            str(a).strip() for a in body.accent_profile if str(a).strip()
        ]

    if body.themes is not None:
        update["themes"] = {
            str(k): str(v) for k, v in body.themes.items()
        }

    if not update:
        return current

    if "exam_only" in update or "is_public" in update:
        from services.mock_paper_policy import mutate, unavailable
        if not isinstance(current.get("policy_revision"), int):
            raise unavailable("policy_update", "listening", test_id)
        return mutate(supabase_admin, "listening", test_id, update, actor["id"],
                      expected_revision=current["policy_revision"])

    res = (
        supabase_admin.table("listening_tests")
        .update(update)
        .eq("id", test_id)
        .execute()
    )
    rows = res.data or []
    return rows[0] if rows else {**current, **update}


@admin_router.patch("/tests/{test_id}/status")
async def admin_patch_listening_test_status(
    test_id: str,
    body: ListeningTestStatusPatchRequest,
    authorization: str | None = Header(default=None),
):
    """Transition a listening_tests row between draft / published /
    archived.

    Sprint 13.4.3 — transitions to 'published' enforce the audio gate
    via ``listening_audio.can_publish``: at least one of
    ``full_audio_storage_path`` (mode=full_premixed) or
    ``assembled_audio_storage_path`` (mode=parts_auto_assembled) must
    be populated. Mode 'parts_only' is always blocked from publish.
    """
    from services import listening_audio                                  # local import

    await require_admin(authorization)

    new_status = body.status.strip().lower()
    if new_status not in _TEST_STATUS_VALUES:
        raise HTTPException(
            422, f"status must be one of {sorted(_TEST_STATUS_VALUES)}",
        )

    existing = (
        supabase_admin.table("listening_tests")
        .select("*")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")
    current = existing.data[0]

    if new_status != "published" and (current.get("status") or "") == "published":
        active_gives = active_exam_assignment_references(
            supabase_admin, "listening", test_id,
        )
        if active_gives:
            names = ", ".join(
                str(row.get("title") or row["id"]) for row in active_gives[:3]
            )
            raise HTTPException(
                409,
                f"Đề đang được giao trong bài còn nhận nộp: {names}. Hãy đóng bài giao trước.",
            )

    # Sprint 13.4.3 publish gate.
    if new_status == "published":
        allowed, reason = listening_audio.can_publish(current)
        if not allowed:
            raise HTTPException(422, reason or "Không thể publish — kiểm tra audio.")

    res = (
        supabase_admin.table("listening_tests")
        .update({"status": new_status})
        .eq("id", test_id)
        .execute()
    )
    rows = res.data or []
    if rows:
        return rows[0]
    return {"id": test_id, "status": new_status}


@admin_router.delete("/tests/{test_id}")
async def admin_delete_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Soft-delete a Cambridge test bundle.

    Sprint 13.4 lock: cascade — flips the test + all its section rows to
    status='archived'. ON DELETE CASCADE in migration 066 is a safety net
    for ops-level hard deletes; the endpoint itself never hard-deletes.
    """
    await require_admin(authorization)

    existing = (
        supabase_admin.table("listening_tests")
        .select("id")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(404, "Test bundle not found")

    active_gives = active_exam_assignment_references(
        supabase_admin, "listening", test_id,
    )
    if active_gives:
        names = ", ".join(str(row.get("title") or row["id"]) for row in active_gives[:3])
        raise HTTPException(
            409,
            f"Đề đang được giao trong bài còn nhận nộp: {names}. Hãy đóng bài giao trước.",
        )

    # Archive the parent.
    (
        supabase_admin.table("listening_tests")
        .update({"status": "archived"})
        .eq("id", test_id)
        .execute()
    )
    # Cascade archive the section rows so they drop out of admin views.
    (
        supabase_admin.table("listening_content")
        .update({"status": "archived"})
        .eq("test_id", test_id)
        .execute()
    )
    return {"id": test_id, "status": "archived"}


@admin_router.delete("/tests/{test_id}/hard")
async def admin_hard_delete_listening_test(
    test_id: str,
    authorization: str | None = Header(default=None),
):
    """Sprint 13.5.4 — permanently delete a Cambridge test bundle.

    Cascades through FK ON DELETE CASCADE chains:
      * listening_tests (the row itself)
      * listening_content (FK test_id → tests.id ON DELETE CASCADE)
      * listening_exercises (FK content_id → content.id ON DELETE CASCADE)
      * listening_test_attempts (FK test_id → tests.id ON DELETE CASCADE)

    Also performs best-effort cleanup of storage objects so audio files
    don't orphan in the bucket:
      * tests.full_audio_storage_path
      * tests.assembled_audio_storage_path
      * each section's content.audio_storage_path

    Storage failures are logged but never block the DB delete — orphans
    are a low-impact issue compared to leaving the row.

    Distinct from the soft-delete (PATCH status='archived') endpoint
    which preserves attempt history for analytics/compliance. Use the
    hard delete only when historical retention is no longer needed.
    """
    await require_admin(authorization)

    test_row = (
        supabase_admin.table("listening_tests")
        .select("id,test_id,full_audio_storage_path,assembled_audio_storage_path")
        .eq("id", test_id)
        .limit(1)
        .execute()
    )
    if not test_row.data:
        raise HTTPException(404, "Test bundle not found")
    test = test_row.data[0]

    active_gives = active_exam_assignment_references(
        supabase_admin, "listening", test_id,
    )
    if active_gives:
        names = ", ".join(str(row.get("title") or row["id"]) for row in active_gives[:3])
        raise HTTPException(
            409,
            f"Đề đang được giao trong bài còn nhận nộp: {names}. Hãy đóng bài giao trước.",
        )

    content_rows = (
        supabase_admin.table("listening_content")
        .select("id,audio_storage_path")
        .eq("test_id", test_id)
        .execute()
    )
    content_paths = [
        c.get("audio_storage_path")
        for c in (content_rows.data or [])
        if c.get("audio_storage_path")
    ]

    storage_paths = [
        p for p in (
            test.get("full_audio_storage_path"),
            test.get("assembled_audio_storage_path"),
            *content_paths,
        ) if p
    ]
    storage_removed = 0
    storage_failed: list[str] = []
    for path in storage_paths:
        try:
            supabase_admin.storage.from_(
                settings.LISTENING_AUDIO_BUCKET,
            ).remove([path])
            storage_removed += 1
        except Exception as exc:                                          # pragma: no cover
            logger.warning(
                "[listening] hard-delete storage cleanup failed for %s: %s",
                path, exc,
            )
            storage_failed.append(path)

    # Count cascade targets BEFORE the delete so the response is
    # auditable (after the delete the rows are gone).
    exercise_count = 0
    if content_rows.data:
        ex_count_res = (
            supabase_admin.table("listening_exercises")
            .select("id", count="exact")
            .in_("content_id", [c["id"] for c in content_rows.data])
            .execute()
        )
        exercise_count = ex_count_res.count or len(ex_count_res.data or [])
    attempt_count_res = (
        supabase_admin.table("listening_test_attempts")
        .select("id", count="exact")
        .eq("test_id", test_id)
        .execute()
    )
    attempt_count = attempt_count_res.count or len(attempt_count_res.data or [])

    (
        supabase_admin.table("listening_tests")
        .delete()
        .eq("id", test_id)
        .execute()
    )

    return {
        "deleted":          True,
        "id":               test_id,
        "test_id":          test.get("test_id"),
        "cascade_count": {
            "content":      len(content_rows.data or []),
            "exercises":    exercise_count,
            "attempts":     attempt_count,
            "storage_files_removed": storage_removed,
            "storage_files_failed":  storage_failed,
        },
    }


# ── Sprint 13.4 — Convert DOCX → test bundle ─────────────────────────────────


def _read_markdown_upload(upload: UploadFile, label: str) -> bytes:
    """Sprint 13.4.2 — accept .md/.markdown text bundles (was .docx in 13.4)."""
    name = (upload.filename or "").lower()
    if not name.endswith(_CONVERT_ALLOWED_EXTENSIONS):
        raise HTTPException(
            422,
            f"{label} phải là file .md hoặc .markdown (nhận: {clip_user_value(upload.filename)!r})",
        )
    data = upload.file.read()
    if len(data) == 0:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _CONVERT_MAX_DOCX_BYTES:
        raise HTTPException(
            422,
            f"{label} vượt 1 MB ({len(data) // 1024} KB).",
        )
    return data


# listening-fulltest-md-import (Phase A) — JSON sidecar (timings.json) reader.
_FULLTEST_MAX_TEXT_BYTES = 2 * 1024 * 1024   # Solution.md can run ~200KB+; allow headroom


def _read_json_upload(upload: UploadFile, label: str) -> dict:
    import json as _json
    name = (upload.filename or "").lower()
    if not name.endswith(".json"):
        raise HTTPException(422, f"{label} phải là file .json (nhận: {clip_user_value(upload.filename)!r})")
    data = upload.file.read()
    if not data:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _FULLTEST_MAX_TEXT_BYTES:
        raise HTTPException(422, f"{label} quá lớn ({len(data) // 1024} KB).")
    try:
        return _json.loads(data.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(422, f"{label} không phải JSON hợp lệ: {describe_parse_error(exc)}") from exc


def _read_text_upload(upload: UploadFile, label: str, *, exts: tuple) -> bytes:
    """Like _read_markdown_upload but with a higher size cap (Solution.md is
    large) + caller-chosen extensions."""
    name = (upload.filename or "").lower()
    if not name.endswith(exts):
        raise HTTPException(422, f"{label} phải là file {' / '.join(exts)} (nhận: {clip_user_value(upload.filename)!r})")
    data = upload.file.read()
    if not data:
        raise HTTPException(422, f"{label} rỗng — không đọc được nội dung.")
    if len(data) > _FULLTEST_MAX_TEXT_BYTES:
        raise HTTPException(422, f"{label} quá lớn ({len(data) // 1024} KB).")
    return data


@admin_router.post("/import-fulltest")
async def admin_import_fulltest_dry_run(
    question_paper: UploadFile = File(...),
    solution:       UploadFile = File(...),
    timings:        UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """listening-fulltest-md-import (Phase A) — dry-run parse of the
    full-test pack (Question_Paper.md + Solution.md + timings.json; the audio
    mp3 is uploaded at commit). Returns the merged 40-question preview +
    FAIL-LOUD validation (every missing answer / missing audio window /
    audio↔timings divergence is an explicit error). No DB writes — the admin
    reviews, then commits (A2)."""
    await require_admin(authorization)

    qp_bytes  = _read_text_upload(question_paper, "Question Paper", exts=(".md", ".markdown"))
    sol_bytes = _read_text_upload(solution,       "Solution",       exts=(".md", ".markdown"))
    timings_dict = _read_json_upload(timings, "timings.json")

    try:
        result = listening_fulltest_import.parse_fulltest(
            qp_bytes.decode("utf-8"), sol_bytes.decode("utf-8"), timings_dict,
        )
    except Exception as exc:
        logger.exception("Full-test import dry-run failed")
        raise HTTPException(422, f"Lỗi khi phân tích full-test pack: {describe_parse_error(exc)}") from exc

    preview = result.as_preview()

    # Surface a duplicate ACTIVE test_id (archived rows are reusable).
    test_id_external = (result.metadata or {}).get("test_id")
    if test_id_external:
        dup = (
            supabase_admin.table("listening_tests")
            .select("id,status").eq("test_id", test_id_external)
            .neq("status", "archived").limit(1).execute()
        )
        if dup.data:
            preview.setdefault("warnings", []).append(
                f"Test ID '{test_id_external}' đang ACTIVE (status={dup.data[0].get('status')}) "
                f"— archive bản cũ trước khi import lại, hoặc đổi test_id.")
            preview["duplicate_test_id"] = True

    return preview


_FULLTEST_MAX_AUDIO_BYTES = 60 * 1024 * 1024   # 60MB headroom over the ~26MB pack


@admin_router.post("/import-fulltest/commit")
async def admin_import_fulltest_commit(
    question_paper: UploadFile = File(...),
    solution:       UploadFile = File(...),
    timings:        UploadFile = File(...),
    audio:          UploadFile = File(...),
    mini:           bool = Query(default=False),
    authorization: str | None = Header(default=None),
):
    """listening-fulltest-md-import (Phase A2) — persist a full-test pack +
    its premixed audio. RE-PARSES the 3 text files (authoritative, never trusts
    client-sent parsed data) → fail-loud 422 on any validation error → uploads
    the mp3 to the listening-audio bucket → writes 1 listening_tests
    (full_premixed) + 4 listening_content + block-shaped listening_exercises
    (payload enriched with per-question audio_windows + solutions). The rows are
    the SAME shape the existing player + grader + attempt flow consume, so an
    imported test is takeable / gradeable / reviewable with no other changes.
    No migration (Pattern #15)."""
    from services import listening_audio

    await require_admin(authorization)

    qp_bytes  = _read_text_upload(question_paper, "Question Paper", exts=(".md", ".markdown"))
    sol_bytes = _read_text_upload(solution,       "Solution",       exts=(".md", ".markdown"))
    timings_dict = _read_json_upload(timings, "timings.json")

    audio_name = (audio.filename or "").lower()
    from services.storage_limits import read_upload_capped, upload_error
    if not audio_name.endswith(".mp3"):
        raise upload_error("listening-audio", 415, message=f"Audio phải là .mp3 (nhận: {clip_user_value(audio.filename)!r})",
                           allowed=["audio/mpeg"])
    audio_bytes = read_upload_capped(
        audio, _FULLTEST_MAX_AUDIO_BYTES,
        lambda size: upload_error("listening-audio", 413, max_bytes=_FULLTEST_MAX_AUDIO_BYTES,
                                  message=f"Audio quá lớn ({size//(1024*1024)} MB > 60 MB)."))

    # Parse + FAIL-LOUD validation (the accuracy gate).
    try:
        res = listening_fulltest_import.parse_fulltest(
            qp_bytes.decode("utf-8"), sol_bytes.decode("utf-8"), timings_dict)
    except Exception as exc:
        logger.exception("Full-test commit parse failed")
        raise HTTPException(422, f"Lỗi khi phân tích full-test pack: {describe_parse_error(exc)}") from exc
    if not res.ok:
        raise HTTPException(422, {"message": "Pack không hợp lệ — sửa rồi import lại.",
                                  "errors": res.errors, "warnings": res.warnings})

    test_id_external = (res.metadata or {}).get("test_id")
    if not test_id_external:
        raise HTTPException(422, "Thiếu test_id (heading H1 của Question Paper).")

    # Validate the audio (size/duration). A mini test is a SINGLE section, so its
    # audio is minutes (not ~30 min) — use the section-level floor (60s/20KB) for
    # mini, the full-test floor (300s/50KB) for a real full test. Both validators
    # return {duration_seconds, size_bytes, errors, warnings}, so downstream use
    # of `av` is unchanged. (Without this, mini commit 422'd on the 300s floor
    # even though validate/preview — which never sees the audio — passed.)
    av = (listening_audio.validate_section_audio(audio_bytes, test_type="mini") if mini
          else listening_audio.validate_full_audio(audio_bytes))
    if av["errors"]:
        raise HTTPException(422, "; ".join(av["errors"]))

    # Duplicate ACTIVE test_id guard (archived rows are fine).
    dup = (
        supabase_admin.table("listening_tests")
        .select("id,status").eq("test_id", test_id_external)
        .neq("status", "archived").limit(1).execute()
    )
    if dup.data:
        raise HTTPException(
            422, f"Test ID '{clip_user_value(test_id_external)}' đang ACTIVE (status={dup.data[0].get('status')}) "
                 f"— archive bản cũ rồi import lại, hoặc đổi test_id.")

    test_uuid = str(uuid.uuid4())
    offsets = res.metadata.get("section_offsets") or {}

    # 1) listening_tests row (full_premixed; audio path set after upload).
    storage_path = f"tests/{test_uuid}/full.mp3"
    test_payload = {
        "id":                          test_uuid,
        "test_id":                     test_id_external,
        "title":                       res.metadata.get("title") or test_id_external,
        "version":                     res.metadata.get("format_version") or "1.0",
        "band_target":                 res.metadata.get("band_target"),
        "accent_profile":              list(res.metadata.get("accent_profile") or []),
        "themes":                      dict(res.metadata.get("topic_distribution") or {}),
        "full_audio_storage_path":     storage_path,
        "full_audio_duration_seconds": av["duration_seconds"],
        "full_audio_size_bytes":       av["size_bytes"],
        "cue_points":                  listening_fulltest_import.build_cue_points(offsets),
        "audio_assembly_mode":         "full_premixed",
        "metadata": {
            "source_format":   "listening-fulltest-v1.1",
            "section_offsets": offsets,
            "band_conversion": res.metadata.get("band_conversion") or [],
        },
        # Mig 157 — test_type là cột thật có CHECK ('mini' 1 section vs
        # 'full' 4 sections); list endpoint student lọc trên cột này.
        "test_type":                   "mini" if mini else "full",
        "status":                      "draft",
        "is_public":                   False,
    }
    # ── Persist ALL-OR-NOTHING with full rollback ────────────────────
    # Postgres has no cross-statement transaction over PostgREST here, so on ANY
    # failure we explicitly delete everything created (exercises → content →
    # test row → uploaded object) and 422 with the failing stage. This is the
    # fix for the prod 500 that left an orphan draft + mp3: never half-import,
    # never block the next re-import with a stray ACTIVE row.
    created_content_ids: list[str] = []
    audio_uploaded = False
    sections_created = 0
    exercises_created = 0

    def _rollback() -> None:
        try:
            for cid in created_content_ids:
                supabase_admin.table("listening_exercises").delete().eq("content_id", cid).execute()
            supabase_admin.table("listening_content").delete().eq("test_id", test_uuid).execute()
            supabase_admin.table("listening_tests").delete().eq("id", test_uuid).execute()
            if audio_uploaded:
                try:
                    supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).remove([storage_path])
                except Exception:
                    logger.warning("[fulltest] rollback: storage remove failed for %s", storage_path)
        except Exception:
            logger.exception("[fulltest] rollback cleanup itself failed for test %s", test_uuid)

    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()           # 1) test row
        _upload_audio_to_bucket(storage_path, audio_bytes)                               # 2) mp3
        audio_uploaded = True
        sections = listening_fulltest_import.build_section_persistence(                  # 3) content + exercises
            res, qp_bytes.decode("utf-8"))
        for sec in sections:
            content_row = dict(sec["content_row"])
            content_row["id"] = str(uuid.uuid4())
            content_row["test_id"] = test_uuid
            supabase_admin.table("listening_content").insert(content_row).execute()
            created_content_ids.append(content_row["id"])
            sections_created += 1
            for ex in sec["exercise_rows"]:
                supabase_admin.table("listening_exercises").insert({
                    "id":            str(uuid.uuid4()),
                    "content_id":    content_row["id"],
                    "exercise_type": ex.get("exercise_type", "dictation"),
                    "payload":       ex.get("payload", {}),
                    "order_num":     ex.get("order_num", 1),
                    "cefr_level":    content_row.get("cefr_level"),
                    "status":        "draft",
                }).execute()
                exercises_created += 1
        # Mini test: a mini has 1 section, a full test has 4. The loader already
        # validated the section count (1–4); here we only guard against a partial
        # write (0 sections / 0 exercises).
        if sections_created < 1 or exercises_created == 0:
            raise RuntimeError(
                f"persist incomplete (sections={sections_created}, exercises={exercises_created})")
    except HTTPException:
        _rollback()
        raise
    except Exception as exc:
        logger.exception("[fulltest] commit persist failed — rolling back test %s", test_uuid)
        _rollback()
        raise HTTPException(
            500, "Lỗi khi lưu full-test (đã rollback sạch, không để lại rác). Vui lòng thử lại.") from None

    return {
        "id":                test_uuid,
        "test_id":           test_id_external,
        "status":            "draft",
        "sections_created":  sections_created,
        "exercises_created": exercises_created,
        "audio": {"storage_path": storage_path,
                  "duration_seconds": av["duration_seconds"],
                  "size_bytes": av["size_bytes"]},
        "warnings":          res.warnings,
        "next_step":         "Mở /admin/listening/tests → kiểm tra → đặt status='published' để mở cho học sinh.",
    }


async def _publish_drill(
    drill_id: uuid.UUID,
    authorization: str | None,
    *,
    sync_owner: str | None = None,
):
    """Publish an imported drill only after its audio and every rich answer
    are present. The test row is flipped last so incomplete child rows never
    become visible in the learner library during a partial failure. Retrying
    the same UUID is safe after a transient PostgREST error.
    """
    from services import listening_audio

    await require_admin(authorization)
    identifier = str(drill_id)
    tests = (supabase_admin.table("listening_tests").select("*")
             .eq("id", identifier).limit(1).execute().data or [])
    if not tests or tests[0].get("test_type") != "drill":
        raise HTTPException(404, "Skill drill not found")
    test = tests[0]
    if test.get("status") not in {"draft", "published"}:
        raise HTTPException(409, "Skill drill is archived")
    held_owner = (test.get("metadata") or {}).get("sync_owner")
    if held_owner != sync_owner:
        raise HTTPException(409, "Drill đang được đồng bộ bởi yêu cầu khác.")
    allowed, reason = listening_audio.can_publish(test)
    if not allowed:
        raise HTTPException(422, reason or "Audio chưa sẵn sàng.")

    contents = (supabase_admin.table("listening_content")
                .select("id,status,transcript,metadata")
                .eq("test_id", identifier).execute().data or [])
    if len(contents) != 1 or not (contents[0].get("transcript") or "").strip():
        raise HTTPException(422, "Drill phải có đúng một section và transcript.")
    content_id = str(contents[0]["id"])
    exercises = (supabase_admin.table("listening_exercises")
                 .select("id,status,payload,exercise_type")
                 .eq("content_id", content_id).execute().data or [])
    if not exercises:
        raise HTTPException(422, "Drill chưa có bài tập.")
    answer_count = 0
    for exercise in exercises:
        payload = exercise.get("payload") or {}
        questions = payload.get("questions") or []
        answers = payload.get("answers") or []
        solutions = payload.get("solutions") or {}
        windows = payload.get("audio_windows") or {}
        if not isinstance(questions, list) or not isinstance(answers, list) or not isinstance(solutions, dict) or not isinstance(windows, dict):
            raise HTTPException(422, "Bài tập có cấu trúc câu hỏi/đáp án/lời giải không hợp lệ.")
        question_ids = [str(question.get("q_num") or question.get("qnum") or "") for question in questions if isinstance(question, dict)]
        answer_ids = [str(answer.get("q_num") or answer.get("qnum") or "") for answer in answers if isinstance(answer, dict)]
        if (not question_ids or len(question_ids) != len(questions)
                or len(answer_ids) != len(answers) or "" in question_ids + answer_ids
                or len(set(question_ids)) != len(question_ids)
                or len(set(answer_ids)) != len(answer_ids)
                or set(question_ids) != set(answer_ids)
                or set(question_ids) != set(solutions)
                or set(question_ids) != set(windows)):
            raise HTTPException(422, "Câu hỏi, đáp án, lời giải và mốc nghe lại phải khớp từng số câu.")
        for answer in answers:
            q = str(answer.get("q_num") or answer.get("qnum") or "")
            detail = solutions.get(q) or {}
            if not q or q not in windows or not all(
                (detail.get(key) or "").strip()
                for key in ("why_correct", "script", "translation_vi")
            ):
                raise HTTPException(422, f"Câu {clip_user_value(q or '?')} thiếu lời giải/script/audio window.")
            answer_count += 1

    # Publish descendants first. A retry converges after any interrupted write.
    for exercise in exercises:
        if exercise.get("status") != "published":
            supabase_admin.table("listening_exercises").update({"status": "published"}).eq("id", exercise["id"]).execute()
    if contents[0].get("status") != "published":
        supabase_admin.table("listening_content").update({"status": "published"}).eq("id", content_id).execute()
    if test.get("status") != "published" or test.get("is_public") is not True:
        supabase_admin.table("listening_tests").update({"status": "published", "is_public": True}).eq("id", identifier).execute()

    checked_test = (supabase_admin.table("listening_tests").select("id,status,is_public")
                    .eq("id", identifier).limit(1).execute().data or [])
    checked_content = (supabase_admin.table("listening_content").select("id,status")
                       .eq("id", content_id).limit(1).execute().data or [])
    checked_exercises = (supabase_admin.table("listening_exercises").select("id,status")
                        .eq("content_id", content_id).execute().data or [])
    if (not checked_test or checked_test[0].get("status") != "published"
            or checked_test[0].get("is_public") is not True
            or not checked_content or checked_content[0].get("status") != "published"
            or len(checked_exercises) != len(exercises)
            or any(row.get("status") != "published" for row in checked_exercises)):
        raise HTTPException(503, "Publish chưa được xác nhận đầy đủ; thử lại cùng UUID.")
    return {"id": identifier, "test_id": test["test_id"], "status": "published",
            "is_public": True, "content_count": 1, "exercise_count": len(exercises),
            "answer_count": answer_count}


@admin_router.post("/drills/{drill_id}/publish")
async def admin_publish_drill(
    drill_id: uuid.UUID,
    authorization: str | None = Header(default=None),
):
    """Publish an imported drill only after its audio and every rich answer
    are present. The test row is flipped last so incomplete child rows never
    become visible in the learner library during a partial failure. Retrying
    the same UUID is safe after a transient PostgREST error.
    """
    return await _publish_drill(drill_id, authorization)


# ── Skill-drill import (Skills Practice) ─────────────────────────────────────
# A drill = a 1-section mini test isolating ONE question type. Imported one
# drill per request (JSON + optional timings.json + optional mp3); the admin
# panel orchestrates the batch. Rows are the SAME shape the player/grader/review
# consume — see services/listening_drill_import.parse_drill. No migration
# (metadata.test_type='drill' rides the existing JSONB, Pattern #15).

_DRILL_MAX_AUDIO_BYTES = 30 * 1024 * 1024   # a single section is minutes, not 30m


@admin_router.post("/drills/{drill_id}/sync")
async def admin_sync_drill(
    drill_id: uuid.UUID,
    source_json: UploadFile = File(...),
    solution: UploadFile = File(...),
    timings: UploadFile = File(...),
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """Refresh one existing drill in place, preserving UUIDs and attempts.

    The uploaded section MP3 is reused verbatim; a content-addressed path
    leaves the previous object available for rollback. Each write is safe to
    retry for the same bundle if a network response is lost.
    """
    from services import listening_audio

    await require_admin(authorization)
    sj = _read_json_upload(source_json, "Source JSON")
    source_json.file.seek(0)
    source_hash = hashlib.sha256(source_json.file.read()).hexdigest()
    timing_dict = _read_json_upload(timings, "timings.json")
    timings.file.seek(0)
    timing_hash = hashlib.sha256(timings.file.read()).hexdigest()
    solution_bytes = _read_text_upload(solution, "Solution.md", exts=(".md", ".markdown"))
    from services.storage_limits import read_upload_capped, upload_error
    if not (audio.filename or "").lower().endswith(".mp3"):
        raise upload_error("listening-audio", 415, message="Audio phải là .mp3.", allowed=["audio/mpeg"])
    audio_bytes = read_upload_capped(
        audio, _DRILL_MAX_AUDIO_BYTES,
        lambda _size: upload_error("listening-audio", 413, max_bytes=_DRILL_MAX_AUDIO_BYTES,
                                   message="Audio vượt giới hạn 30 MB."))
    av = listening_audio.validate_section_audio(audio_bytes, test_type="drill")
    if av["errors"]:
        raise HTTPException(422, "; ".join(av["errors"]))
    sections = timing_dict.get("sections") or []
    if len(sections) != 1 or sections[0].get("file") != audio.filename:
        raise HTTPException(422, "MP3 không khớp section file trong timings.json.")
    if abs(float(sections[0].get("duration") or 0) - float(av["duration_seconds"])) > 1.0:
        raise HTTPException(422, "Thời lượng audio section khác timings.json hơn 1 giây.")

    try:
        parsed = listening_drill_import.parse_drill(sj, timing_dict, solution_bytes.decode("utf-8"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(422, f"Không phân tích được nguồn drill: {describe_parse_error(exc)}") from exc
    if parsed.errors:
        raise HTTPException(422, {"message": "Drill không hợp lệ.", "errors": parsed.errors})

    identifier = str(drill_id)
    rows = (supabase_admin.table("listening_tests").select("*")
            .eq("id", identifier).limit(1).execute().data or [])
    if not rows or rows[0].get("test_type") != "drill":
        raise HTTPException(404, "Skill drill not found")
    current = rows[0]
    if current.get("status") == "archived" or current.get("test_id") != parsed.test_metadata.get("test_id"):
        raise HTTPException(409, "UUID, Test ID hoặc trạng thái drill không khớp nguồn.")
    if (current.get("metadata") or {}).get("sync_owner"):
        raise HTTPException(409, "Drill đang được đồng bộ bởi yêu cầu khác.")
    contents = (supabase_admin.table("listening_content").select("*")
                .eq("test_id", identifier).execute().data or [])
    if len(contents) != 1:
        raise HTTPException(409, "Drill cũ không có đúng một section; cần sửa thủ công.")
    content = contents[0]
    existing_exercises = (supabase_admin.table("listening_exercises")
                          .select("id,content_id,order_num,exercise_type")
                          .eq("content_id", content["id"]).execute().data or [])
    by_order = {row.get("order_num"): row for row in existing_exercises}
    new_orders = [row.get("order_num") for row in parsed.exercise_rows]
    if (len(by_order) != len(existing_exercises) or len(by_order) != len(new_orders)
            or set(by_order) != set(new_orders)):
        raise HTTPException(409, "Cấu trúc exercise cũ khác nguồn; không thay UUID đang được attempt tham chiếu.")

    # Claim the JSONB row atomically before touching any public child. The
    # metadata-path predicate is checked by Postgres inside the UPDATE, so a
    # second admin cannot acquire the same drill after it becomes draft.
    owner = uuid.uuid4().hex
    claimed_metadata = {**(current.get("metadata") or {}), "sync_owner": owner}
    (supabase_admin.table("listening_tests")
     .update({"status": "draft", "is_public": False, "metadata": claimed_metadata})
     .eq("id", identifier).eq("status", current["status"])
     .is_("metadata->>sync_owner", None).execute())
    hidden = (supabase_admin.table("listening_tests").select("status,is_public,metadata")
              .eq("id", identifier).limit(1).execute().data or [])
    if (not hidden or hidden[0].get("status") != "draft" or hidden[0].get("is_public") is not False
            or (hidden[0].get("metadata") or {}).get("sync_owner") != owner):
        raise HTTPException(409, "Không chiếm được quyền đồng bộ độc quyền; chưa ghi nội dung.")

    def release_owner() -> None:
        latest = (supabase_admin.table("listening_tests").select("metadata")
                  .eq("id", identifier).limit(1).execute().data or [])
        metadata = dict((latest[0].get("metadata") or {}) if latest else {})
        if metadata.get("sync_owner") != owner:
            raise HTTPException(503, "Quyền đồng bộ đã đổi; chưa thể xác nhận giải phóng khóa.")
        metadata.pop("sync_owner")
        (supabase_admin.table("listening_tests").update({"metadata": metadata})
         .eq("id", identifier).eq("metadata->>sync_owner", owner).execute())
        checked = (supabase_admin.table("listening_tests").select("metadata")
                   .eq("id", identifier).limit(1).execute().data or [])
        if not checked or (checked[0].get("metadata") or {}).get("sync_owner"):
            raise HTTPException(503, "Chưa xác nhận giải phóng quyền đồng bộ.")

    succeeded = False
    try:
        audio_hash = hashlib.sha256(audio_bytes).hexdigest()
        new_path = f"drills/{identifier}/sync-{audio_hash[:16]}.mp3"
        if current.get("full_audio_storage_path") != new_path:
            _upload_audio_to_bucket(new_path, audio_bytes)
        tm = parsed.test_metadata
        new_test_metadata = {**claimed_metadata, **(tm.get("metadata") or {}),
                             "source_hashes": {"source_json": source_hash,
                                               "solution_md": hashlib.sha256(solution_bytes).hexdigest(),
                                               "timings_json": timing_hash, "audio_mp3": audio_hash}}
        new_content = {key: value for key, value in parsed.content_row.items()
                       if key not in {"id", "test_id", "status"}}
        new_content["metadata"] = {**(content.get("metadata") or {}), **new_content["metadata"]}
        for fresh in parsed.exercise_rows:
            old = by_order[fresh["order_num"]]
            supabase_admin.table("listening_exercises").update({
                "exercise_type": fresh["exercise_type"], "payload": fresh["payload"],
                "order_num": fresh["order_num"], "cefr_level": parsed.content_row.get("cefr_level"),
            }).eq("id", old["id"]).execute()
        supabase_admin.table("listening_content").update(new_content).eq("id", content["id"]).execute()
        supabase_admin.table("listening_tests").update({
            "title": tm.get("title") or current.get("title"),
            "band_target": tm.get("band_target"),
            "accent_profile": list(tm.get("accent_profile") or []),
            "themes": dict(tm.get("themes") or {}), "cue_points": parsed.cue_points,
            "audio_assembly_mode": "full_premixed", "full_audio_storage_path": new_path,
            "full_audio_duration_seconds": av["duration_seconds"],
            "full_audio_size_bytes": av["size_bytes"], "metadata": new_test_metadata,
        }).eq("id", identifier).execute()
        checked_test = (supabase_admin.table("listening_tests").select("metadata,full_audio_storage_path")
                        .eq("id", identifier).limit(1).execute().data or [])
        checked_content = (supabase_admin.table("listening_content").select("transcript,metadata")
                           .eq("id", content["id"]).limit(1).execute().data or [])
        checked_exercises = (supabase_admin.table("listening_exercises")
                             .select("id,payload,order_num").eq("content_id", content["id"]).execute().data or [])
        expected_payloads = {by_order[row["order_num"]]["id"]: row["payload"] for row in parsed.exercise_rows}
        if (not checked_test or (checked_test[0].get("metadata") or {}).get("source_hashes") != new_test_metadata["source_hashes"]
                or checked_test[0].get("full_audio_storage_path") != new_path
                or not checked_content or checked_content[0].get("transcript") != new_content["transcript"]
                or checked_content[0].get("metadata") != new_content["metadata"]
                or len(checked_exercises) != len(expected_payloads)
                or any(row.get("payload") != expected_payloads.get(row.get("id")) for row in checked_exercises)):
            raise HTTPException(503, "Cập nhật drill chưa khớp nguồn; thử lại cùng UUID trước khi phát hành.")
        published = await _publish_drill(drill_id, authorization, sync_owner=owner)
        succeeded = True
        return {**published, "audio_sha256": audio_hash, "source_hashes": new_test_metadata["source_hashes"]}
    finally:
        if not succeeded:
            try:
                (supabase_admin.table("listening_tests").update({"status": "draft", "is_public": False})
                 .eq("id", identifier).eq("metadata->>sync_owner", owner).execute())
            except Exception:
                logger.exception("[drill-sync] failed to hide incomplete drill %s", identifier)
        try:
            release_owner()
        except Exception:
            logger.exception("[drill-sync] failed to release owner for %s", identifier)
            if succeeded:
                raise


@admin_router.post("/drills/import")
async def admin_import_drill_dry_run(
    source_json:   UploadFile = File(...),
    timings:       UploadFile | None = File(default=None),
    solution:      UploadFile | None = File(default=None),
    authorization: str | None = Header(default=None),
):
    """ADDITIVE dry-run parse of one skill-drill Source JSON (+ optional
    timings.json). No DB writes — returns a preview row (drill_type, level,
    task, question_count, has_audio, errors, warnings) for the batch table."""
    await require_admin(authorization)

    sj = _read_json_upload(source_json, "Source JSON")
    timings_dict = _read_json_upload(timings, "timings.json") if timings is not None else None
    solution_text = (_read_text_upload(solution, "Solution.md", exts=(".md", ".markdown")).decode("utf-8")
                     if solution is not None else None)

    try:
        res = listening_drill_import.parse_drill(sj, timings_dict, solution_text)
    except Exception as exc:
        logger.exception("Drill import dry-run failed")
        raise HTTPException(422, f"Lỗi khi phân tích drill JSON: {describe_parse_error(exc)}") from exc

    test_ext = (res.test_metadata.get("test_id")
                or sj.get("test_id") or sj.get("drill_id") or "")
    md = res.test_metadata.get("metadata") or {}
    preview = {
        "test_id":        test_ext,
        "title":          res.test_metadata.get("title") or test_ext,
        "drill_type":     md.get("drill_type"),
        "level":          md.get("level"),
        "task":           md.get("task"),
        "question_count": res.question_count,
        "has_audio":      res.has_audio,
        "ok":             not res.errors,
        "errors":         res.errors,
        "warnings":       res.warnings,
    }
    if test_ext:
        dup = (
            supabase_admin.table("listening_tests")
            .select("id,status").eq("test_id", test_ext)
            .neq("status", "archived").limit(1).execute()
        )
        if dup.data:
            preview["duplicate_test_id"] = True
            preview["warnings"] = list(preview["warnings"]) + [
                f"Test ID '{test_ext}' đang ACTIVE (status={dup.data[0].get('status')}) "
                f"— archive bản cũ trước khi import lại."]
    return preview


@admin_router.post("/drills/import/commit")
async def admin_import_drill_commit(
    source_json:   UploadFile = File(...),
    timings:       UploadFile | None = File(default=None),
    solution:      UploadFile | None = File(default=None),
    audio:         UploadFile | None = File(default=None),
    authorization: str | None = Header(default=None),
):
    """Persist one skill-drill: 1 listening_tests (test_type='drill') +
    1 listening_content + block-shaped listening_exercises (payload enriched
    with audio_windows + solutions + map_svg). If an mp3 is provided the drill
    is audio-ready (full_premixed); without audio it imports as ``draft`` and
    stays hidden from students ("Sắp có") until audio lands. ALL-OR-NOTHING with
    explicit rollback (no PostgREST transaction), same guard as full-test."""
    from services import listening_audio

    await require_admin(authorization)

    sj = _read_json_upload(source_json, "Source JSON")
    timings_dict = _read_json_upload(timings, "timings.json") if timings is not None else None
    solution_text = (_read_text_upload(solution, "Solution.md", exts=(".md", ".markdown")).decode("utf-8")
                     if solution is not None else None)

    audio_bytes: bytes | None = None
    av: dict | None = None
    if audio is not None:
        audio_name = (audio.filename or "").lower()
        if not audio_name.endswith(".mp3"):
            from services.storage_limits import upload_error
            raise upload_error("listening-audio", 415, message=f"Audio phải là .mp3 (nhận: {clip_user_value(audio.filename)!r})",
                               allowed=["audio/mpeg"])
        # Audio without timings would publish an "audio-ready" drill whose
        # exercises have NO audio_windows — the review's per-question 🔊 replay
        # (driven solely by item.audio_window) would silently vanish. Require
        # timings whenever audio is provided so an audio-ready drill always has
        # its replay windows.
        if timings_dict is None:
            raise HTTPException(
                422, "Có audio thì phải kèm timings.json (để tạo cửa sổ nghe lại "
                     "theo từng câu). Thêm timings.json rồi import lại, hoặc import "
                     "không audio (drill sẽ ở trạng thái 'Sắp có').")
        from services.storage_limits import read_upload_capped, upload_error
        audio_bytes = read_upload_capped(
            audio, _DRILL_MAX_AUDIO_BYTES,
            lambda size: upload_error("listening-audio", 413, max_bytes=_DRILL_MAX_AUDIO_BYTES,
                                      message=f"Audio quá lớn ({size//(1024*1024)} MB > 30 MB)."))
        av = listening_audio.validate_section_audio(audio_bytes, test_type="drill")
        if av["errors"]:
            raise HTTPException(422, "; ".join(av["errors"]))

    try:
        res = listening_drill_import.parse_drill(sj, timings_dict, solution_text)
    except Exception as exc:
        logger.exception("Drill commit parse failed")
        raise HTTPException(422, f"Lỗi khi phân tích drill JSON: {describe_parse_error(exc)}") from exc
    if res.errors:
        raise HTTPException(422, {"message": "Drill không hợp lệ — sửa rồi import lại.",
                                  "errors": res.errors, "warnings": res.warnings})

    test_id_external = res.test_metadata.get("test_id")
    if not test_id_external:
        raise HTTPException(422, "Thiếu test_id / drill_id trong Source JSON.")

    dup = (
        supabase_admin.table("listening_tests")
        .select("id,status").eq("test_id", test_id_external)
        .neq("status", "archived").limit(1).execute()
    )
    if dup.data:
        raise HTTPException(
            422, f"Test ID '{clip_user_value(test_id_external)}' đang ACTIVE (status={dup.data[0].get('status')}) "
                 f"— archive bản cũ rồi import lại.")

    test_uuid = str(uuid.uuid4())
    storage_path = f"drills/{test_uuid}/full.mp3" if audio_bytes else None
    tm = res.test_metadata
    source_json.file.seek(0)
    source_hashes = {"source_json": hashlib.sha256(source_json.file.read()).hexdigest()}
    if timings is not None:
        timings.file.seek(0)
        source_hashes["timings_json"] = hashlib.sha256(timings.file.read()).hexdigest()
    if solution_text is not None:
        source_hashes["solution_md"] = hashlib.sha256(solution_text.encode("utf-8")).hexdigest()
    if audio_bytes:
        source_hashes["audio_mp3"] = hashlib.sha256(audio_bytes).hexdigest()
    test_payload = {
        "id":              test_uuid,
        "test_id":         test_id_external,
        "title":           tm.get("title") or test_id_external,
        "band_target":     tm.get("band_target"),
        "accent_profile":  list(tm.get("accent_profile") or []),
        "themes":          dict(tm.get("themes") or {}),
        "cue_points":      res.cue_points,
        "audio_assembly_mode": "full_premixed",
        "metadata":        {**(tm.get("metadata") or {}), "source_hashes": source_hashes},
        # Mig 157 — test_type là cột thật (CHECK full|mini|drill).
        "test_type":       tm.get("test_type") or "drill",
        "status":          "draft",
    }
    if audio_bytes and av:
        test_payload["full_audio_storage_path"]     = storage_path
        test_payload["full_audio_duration_seconds"] = av["duration_seconds"]
        test_payload["full_audio_size_bytes"]       = av["size_bytes"]

    created_content_ids: list[str] = []
    audio_uploaded = False

    def _rollback() -> None:
        try:
            for cid in created_content_ids:
                supabase_admin.table("listening_exercises").delete().eq("content_id", cid).execute()
            supabase_admin.table("listening_content").delete().eq("test_id", test_uuid).execute()
            supabase_admin.table("listening_tests").delete().eq("id", test_uuid).execute()
            if audio_uploaded and storage_path:
                try:
                    supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).remove([storage_path])
                except Exception:
                    logger.warning("[drill] rollback: storage remove failed for %s", storage_path)
        except Exception:
            logger.exception("[drill] rollback cleanup itself failed for %s", test_uuid)

    exercises_created = 0
    try:
        supabase_admin.table("listening_tests").insert(test_payload).execute()
        if audio_bytes and storage_path:
            _upload_audio_to_bucket(storage_path, audio_bytes)
            audio_uploaded = True
        content_row = dict(res.content_row)
        content_row["id"] = str(uuid.uuid4())
        content_row["test_id"] = test_uuid
        supabase_admin.table("listening_content").insert(content_row).execute()
        created_content_ids.append(content_row["id"])
        for ex in res.exercise_rows:
            supabase_admin.table("listening_exercises").insert({
                "id":            str(uuid.uuid4()),
                "content_id":    content_row["id"],
                "exercise_type": ex.get("exercise_type", "dictation"),
                "payload":       ex.get("payload", {}),
                "order_num":     ex.get("order_num", 1),
                "cefr_level":    content_row.get("cefr_level"),
                "status":        "draft",
            }).execute()
            exercises_created += 1
        if exercises_created == 0:
            raise RuntimeError("persist incomplete (0 exercises)")
    except HTTPException:
        _rollback()
        raise
    except Exception as exc:
        logger.exception("[drill] commit persist failed — rolling back %s", test_uuid)
        _rollback()
        raise HTTPException(500, "Lỗi khi lưu drill (đã rollback sạch). Vui lòng thử lại.") from None

    return {
        "id":                test_uuid,
        "test_id":           test_id_external,
        "status":            "draft",
        "drill_type":        (tm.get("metadata") or {}).get("drill_type"),
        "level":             (tm.get("metadata") or {}).get("level"),
        "has_audio":         bool(audio_bytes),
        "exercises_created": exercises_created,
        "warnings":          res.warnings,
        "next_step":         ("Mở /admin/listening/tests → publish khi đã có audio."
                              if audio_bytes else
                              "Đã import metadata (chưa có audio) — thêm audio rồi publish."),
    }
