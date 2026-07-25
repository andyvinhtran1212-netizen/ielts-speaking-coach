"""services/student_service.py — Student CRUD for Writing Coach (Sprint W2 Phase 1).

Phase 1 admin-only: all callers come from `/admin/students/*` routes which
already gate with `require_admin`. Uses service-role `supabase_admin` (matches
existing convention in `services/ai_usage_logger.py`, `services/pdf_generator.py`).

Soft delete deferred to Sprint W3 — `delete_student()` performs a hard DELETE.
"""

from __future__ import annotations

import csv
import io
import logging
from typing import Optional

from fastapi import HTTPException

from database import supabase_admin
from services.pg_search import ilike_or_filter

logger = logging.getLogger(__name__)


# Required columns for CSV bulk import. Optional cells may be blank.
_CSV_REQUIRED_COLS = {"student_code", "full_name"}
_CSV_OPTIONAL_COLS = {"target_band", "target_date", "persona_notes", "current_band_estimate"}


def _is_duplicate_code_error(exc: Exception) -> bool:
    """Detect Postgres unique-violation on students.student_code."""
    s = str(exc).lower()
    return "23505" in s or "duplicate key" in s or "unique constraint" in s


# ── Single-record CRUD ────────────────────────────────────────────────

def create_student(*, data: dict, admin_id: str) -> dict:
    """Insert one row into students. Returns the inserted row.

    Raises HTTPException(409) when student_code already exists, or (Sprint 18.1
    convert path) when the given user_id already has a student row.
    """
    # Sprint 18.1 — convert guard: one student row per user (idempotency = 409).
    user_id = data.get("user_id")
    if user_id:
        try:
            existing = (
                supabase_admin.table("students")
                .select("id, student_code, full_name")
                .eq("user_id", user_id)
                .limit(1)
                .execute()
            )
        except Exception as exc:
            logger.error("[students] user_id pre-check failed: %s", exc)
            raise HTTPException(500, f"Database lookup failed: {exc}")
        if existing.data:
            row = existing.data[0]
            raise HTTPException(
                status_code=409,
                detail={"message": "Người dùng này đã là học viên.",
                        "student": {"id": row["id"], "student_code": row.get("student_code"),
                                    "full_name": row.get("full_name")}},
            )

    payload = {**data, "created_by": admin_id}
    try:
        r = supabase_admin.table("students").insert(payload).execute()
    except Exception as exc:
        if _is_duplicate_code_error(exc):
            raise HTTPException(
                status_code=409,
                detail=f"student_code already exists: {data.get('student_code')!r}",
            )
        logger.error("[students] insert failed: %s", exc)
        raise HTTPException(500, f"Database insert failed: {exc}")

    rows = r.data or []
    if not rows:
        raise HTTPException(500, "Insert returned no rows")
    return rows[0]


def list_students(
    *,
    search: Optional[str] = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """List students; optionally filter by case-insensitive substring match
    against student_code or full_name.
    """
    q = supabase_admin.table("students").select("*").order("created_at", desc=True)
    if search:
        # F2 — PostgREST-safe or_(): the value is double-quoted so commas/parens
        # in the term don't break the logic tree, and LIKE wildcards are escaped.
        q = q.or_(ilike_or_filter(["student_code", "full_name"], search))
    r = q.range(offset, offset + limit - 1).execute()
    rows = r.data or []

    # WF-1 — enrich each row with its class name (students.cohort_id →
    # cohorts.name) via ONE batched lookup (no N+1; mirrors the access-code
    # list's cohort_name precedent). Unassigned → cohort_name None so the UI
    # renders "—" rather than silently dropping it.
    _attach_cohort_names(rows)
    return rows


def _attach_cohort_names(rows: list[dict]) -> None:
    """Set `cohort_name` on each row from its `cohort_id` (in place). One
    batched cohorts query; a lookup failure leaves cohort_name=None (UI shows
    "—") and never blocks the list."""
    cohort_ids = list({r.get("cohort_id") for r in rows if r.get("cohort_id")})
    names: dict[str, str] = {}
    if cohort_ids:
        try:
            cr = (
                supabase_admin.table("cohorts")
                .select("id, name")
                .in_("id", cohort_ids)
                .execute()
            )
            names = {c["id"]: (c.get("name") or "") for c in (cr.data or [])}
        except Exception:
            names = {}
    for r in rows:
        r["cohort_name"] = names.get(r.get("cohort_id"))


def _iso_to_dt(s):
    from datetime import datetime
    if not s:
        return None
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except ValueError:
        return None


def _listening_summary(user_id: str | None) -> dict | None:
    """Hoạt động Listening của học viên cho hồ sơ admin (audit 2026-07-17 đợt 3).

    Nguồn: listening_test_attempts + dictation_sessions (canonical). Best-effort:
    lỗi đọc → None (drawer hiện "không tải được"), không 500 cả trang detail.
    avg_accuracy dùng quy tắc lượt-NỘP-đầu per test — nhất quán với dashboard
    admin và thống kê học viên (đợt 2)."""
    if not user_id:
        return None

    def _fetch_all(table: str, cols: str) -> list[dict]:
        """Phân trang đủ TOÀN BỘ lịch sử (lô 1000 = PostgREST cap) — hồ sơ ghi
        "tổng lượt"/"% đúng" nên không được cắt ở newest-N: cắt vừa sai tổng
        vừa có thể chọn nhầm retry làm "lượt nộp đầu" (review P2, PR #810).
        Trần an toàn 20 lô (20k lượt/học viên) — vượt xa thực tế."""
        out: list[dict] = []
        page = 1000
        for i in range(20):
            res = (
                supabase_admin.table(table)
                .select(cols)
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .range(i * page, (i + 1) * page - 1)
                .execute()
            ).data or []
            out.extend(res)
            if len(res) < page:
                break
        return out

    try:
        rows = _fetch_all(
            "listening_test_attempts",
            "test_id,status,score,grading_details,started_at,submitted_at,created_at",
        )
        d_rows = _fetch_all("dictation_sessions", "accuracy,completed_at,created_at")
        u_rows = (
            supabase_admin.table("users").select("email")
            .eq("id", user_id).limit(1).execute()
        ).data or []
    except Exception as exc:  # noqa: BLE001
        logger.warning("[students] listening summary read failed: %s", exc)
        return None

    abandoned = sum(1 for r in rows if r.get("status") == "abandoned")
    submitted = [r for r in rows if r.get("status") == "submitted"]

    first_acc_by_test: dict[str, float] = {}
    for r in reversed(rows):                       # rows đang newest-first
        gd = r.get("grading_details") or []
        tid = r.get("test_id")
        if (tid and tid not in first_acc_by_test and r.get("status") == "submitted"
                and r.get("score") is not None and gd):
            first_acc_by_test[tid] = r["score"] / len(gd)
    accs = list(first_acc_by_test.values())

    durations = []
    for r in submitted:
        a, b = _iso_to_dt(r.get("started_at")), _iso_to_dt(r.get("submitted_at"))
        if a and b:
            durations.append(max(0, int((b - a).total_seconds())))

    d_accs = [float(r["accuracy"]) for r in d_rows if r.get("accuracy") is not None]
    return {
        "user_email":         (u_rows[0].get("email") if u_rows else None),
        "attempts_total":     len(rows),
        "attempts_submitted": len(submitted),
        "attempts_abandoned": abandoned,
        "avg_accuracy":       round(sum(accs) / len(accs), 4) if accs else None,
        "avg_duration_seconds": (int(sum(durations) / len(durations))
                                 if durations else None),
        "last_attempt_at":    rows[0]["created_at"] if rows else None,
        "dictation_total":    len(d_rows),
        "dictation_avg_accuracy": (round(sum(d_accs) / len(d_accs), 4)
                                   if d_accs else None),
        "dictation_last_at":  ((d_rows[0].get("completed_at")
                                or d_rows[0].get("created_at")) if d_rows else None),
    }


def get_student_with_history(student_id: str) -> dict:
    """Return one student row + recent essay history (up to 50 essays)."""
    sr = (
        supabase_admin.table("students")
        .select("*")
        .eq("id", student_id)
        .limit(1)
        .execute()
    )
    if not sr.data:
        raise HTTPException(404, "Student not found")

    student = dict(sr.data[0])

    er = (
        supabase_admin.table("writing_essays")
        .select("id, task_type, status, analysis_level, created_at, delivered_at")
        .eq("student_id", student_id)
        .is_("deleted_at", "null")          # exclude soft-deleted from student history
        .order("created_at", desc=True)
        .limit(50)
        .execute()
    )
    student["essay_history"] = er.data or []
    # Audit 2026-07-17 đợt 3 — hoạt động Listening trong hồ sơ học viên
    # (None khi chưa kích hoạt tài khoản hoặc đọc lỗi — drawer nêu rõ).
    student["listening"] = _listening_summary(student.get("user_id"))
    return student


def update_student(*, student_id: str, data: dict) -> dict:
    """Update student row. Raises 400 when no fields supplied, 404 when not found."""
    if not data:
        raise HTTPException(400, "No fields to update")

    try:
        r = (
            supabase_admin.table("students")
            .update(data)
            .eq("id", student_id)
            .execute()
        )
    except Exception as exc:
        logger.error("[students] update failed: %s", exc)
        raise HTTPException(500, f"Database update failed: {exc}")

    if not r.data:
        raise HTTPException(404, "Student not found")
    return r.data[0]


def delete_student(student_id: str) -> None:
    """Hard delete (W2 scope). Soft delete deferred to W3.

    Raises 404 when student does not exist (idempotent semantics: caller may
    treat this as already-deleted).
    """
    r = (
        supabase_admin.table("students")
        .delete()
        .eq("id", student_id)
        .execute()
    )
    if not r.data:
        raise HTTPException(404, "Student not found")


# ── CSV bulk import ──────────────────────────────────────────────────

def bulk_import_students(*, csv_content: str, admin_id: str) -> dict:
    """Parse a UTF-8 CSV and insert each valid row. Returns a summary.

    CSV header must include: student_code, full_name (required).
    Optional columns: target_band, target_date, persona_notes, current_band_estimate.

    Returns:
        {
          "imported": <int — rows inserted>,
          "errors":   [ {"row": <line number>, "code": "...", "error": "..."} ]
        }
    """
    reader = csv.DictReader(io.StringIO(csv_content))

    if reader.fieldnames is None:
        raise HTTPException(400, "CSV is empty or missing header row")

    fieldnames = {f.strip().lower() for f in reader.fieldnames}
    missing = _CSV_REQUIRED_COLS - fieldnames
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"CSV missing required columns: {sorted(missing)}",
        )

    imported = 0
    errors: list[dict] = []

    for line_no, raw in enumerate(reader, start=2):  # start=2: header is line 1
        # Normalize keys to lowercase + strip values
        row = {(k or "").strip().lower(): (v or "").strip() for k, v in raw.items()}

        code = row.get("student_code", "")
        if not code or not row.get("full_name"):
            errors.append({
                "row": line_no, "code": code,
                "error": "student_code or full_name empty",
            })
            continue

        data: dict = {
            "student_code": code,
            "full_name": row["full_name"],
        }
        if row.get("target_band"):
            try:
                data["target_band"] = float(row["target_band"])
            except ValueError:
                errors.append({
                    "row": line_no, "code": code,
                    "error": f"target_band not numeric: {row['target_band']!r}",
                })
                continue
        if row.get("current_band_estimate"):
            try:
                data["current_band_estimate"] = float(row["current_band_estimate"])
            except ValueError:
                errors.append({
                    "row": line_no, "code": code,
                    "error": f"current_band_estimate not numeric: {row['current_band_estimate']!r}",
                })
                continue
        if row.get("target_date"):
            data["target_date"] = row["target_date"]
        if row.get("persona_notes"):
            data["persona_notes"] = row["persona_notes"]

        try:
            create_student(data=data, admin_id=admin_id)
            imported += 1
        except HTTPException as he:
            errors.append({"row": line_no, "code": code, "error": he.detail})
        except Exception as e:
            errors.append({"row": line_no, "code": code, "error": str(e)})

    return {"imported": imported, "errors": errors}
