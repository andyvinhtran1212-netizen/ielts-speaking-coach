"""routers/admin_students.py — Admin endpoints for Writing Coach student management.

Sprint W0: scaffolding only — endpoints return 501 Not Implemented.
Sprint W2: implement student CRUD + bulk CSV import.
Sprint W3: soft delete.

Auth pattern: each endpoint calls `await require_admin(authorization)`
inline, matching routers/admin.py.
"""

from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, status

from routers.admin import require_admin


router = APIRouter(
    prefix="/admin/students",
    tags=["admin-students"],
)


@router.post("", status_code=status.HTTP_501_NOT_IMPLEMENTED)
async def create_student(authorization: str | None = Header(None)):
    """Create student profile. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.post("/import")
async def import_students_csv(authorization: str | None = Header(None)):
    """Bulk import via CSV. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.get("")
async def list_students(authorization: str | None = Header(None)):
    """List students with search. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.get("/{student_id}")
async def get_student(student_id: UUID, authorization: str | None = Header(None)):
    """Get student + essay history. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.patch("/{student_id}")
async def update_student(student_id: UUID, authorization: str | None = Header(None)):
    """Update student profile. (Sprint W2)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W2")


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(student_id: UUID, authorization: str | None = Header(None)):
    """Soft delete student. (Sprint W3)"""
    await require_admin(authorization)
    raise HTTPException(501, "Not implemented yet — Sprint W3")
