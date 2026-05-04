"""routers/admin_students.py — Admin endpoints for Writing Coach student management.

Sprint W2: student CRUD + bulk CSV import. Soft delete deferred to W3
(`delete_student` performs a hard DELETE).

Auth pattern: each endpoint calls `await require_admin(authorization)`
inline, matching routers/admin.py.
"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, Header, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from routers.admin import require_admin
from services import student_service


router = APIRouter(
    prefix="/admin/students",
    tags=["admin-students"],
)


# ── Request bodies ────────────────────────────────────────────────────

class CreateStudentRequest(BaseModel):
    student_code: str = Field(..., min_length=1, max_length=64)
    full_name:    str = Field(..., min_length=1, max_length=255)
    target_band:  Optional[float] = Field(default=None, ge=0, le=9)
    target_date:  Optional[str]   = None  # ISO date string; DB validates
    persona_notes: Optional[str]  = None
    current_band_estimate: Optional[float] = Field(default=None, ge=0, le=9)


class UpdateStudentRequest(BaseModel):
    student_code: Optional[str]   = Field(default=None, min_length=1, max_length=64)
    full_name:    Optional[str]   = Field(default=None, min_length=1, max_length=255)
    target_band:  Optional[float] = Field(default=None, ge=0, le=9)
    target_date:  Optional[str]   = None
    persona_notes: Optional[str]  = None
    current_band_estimate: Optional[float] = Field(default=None, ge=0, le=9)


# ── Endpoints ─────────────────────────────────────────────────────────

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_student(
    body: CreateStudentRequest,
    authorization: str | None = Header(None),
):
    """Create student profile. Returns the inserted row."""
    admin = await require_admin(authorization)
    data = body.model_dump(exclude_none=True)
    return student_service.create_student(data=data, admin_id=admin["id"])


@router.post("/import")
async def import_students_csv(
    file: UploadFile = File(..., description="UTF-8 CSV with student_code, full_name (required)"),
    authorization: str | None = Header(None),
):
    """Bulk import via CSV. Returns {imported, errors}."""
    admin = await require_admin(authorization)

    raw = await file.read()
    try:
        csv_content = raw.decode("utf-8")
    except UnicodeDecodeError:
        raise HTTPException(400, "CSV must be UTF-8 encoded")

    return student_service.bulk_import_students(
        csv_content=csv_content,
        admin_id=admin["id"],
    )


@router.get("")
async def list_students(
    search: Optional[str] = Query(default=None, max_length=128),
    limit:  int           = Query(default=50, ge=1, le=200),
    offset: int           = Query(default=0, ge=0),
    authorization: str | None = Header(None),
):
    """List students; optional case-insensitive substring filter on
    student_code or full_name."""
    await require_admin(authorization)
    return student_service.list_students(search=search, limit=limit, offset=offset)


@router.get("/{student_id}")
async def get_student(
    student_id: UUID,
    authorization: str | None = Header(None),
):
    """Get student + recent essay history (up to 50)."""
    await require_admin(authorization)
    return student_service.get_student_with_history(str(student_id))


@router.patch("/{student_id}")
async def update_student(
    student_id: UUID,
    body: UpdateStudentRequest,
    authorization: str | None = Header(None),
):
    """Update student profile. Empty body → 400."""
    await require_admin(authorization)
    data = body.model_dump(exclude_none=True)
    return student_service.update_student(student_id=str(student_id), data=data)


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(
    student_id: UUID,
    authorization: str | None = Header(None),
):
    """Hard delete (W2 scope). Soft delete deferred to W3."""
    await require_admin(authorization)
    student_service.delete_student(str(student_id))
