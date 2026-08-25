"""Learner API for course pronunciation/shadowing exercises."""

from __future__ import annotations

import json
from uuid import UUID

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile

from routers.auth import get_supabase_user
from services import course_pronunciation

router = APIRouter(prefix="/api/quiz/course/pronunciation", tags=["course-pronunciation"])


def _raise(exc: course_pronunciation.CoursePronunciationError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("")
async def pronunciation_state(
    bank_id: UUID,
    class_item: UUID | None = None,
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        return course_pronunciation.get_state(
            user_id=user["id"], bank_id=str(bank_id),
            assignment_item_id=str(class_item) if class_item else None,
        )
    except course_pronunciation.CoursePronunciationError as exc:
        _raise(exc)


@router.post("/submit")
async def submit_pronunciation(
    bank_id: UUID = Form(...),
    class_item: UUID | None = Form(default=None),
    client_id: UUID = Form(...),
    sentence_ids: str = Form(...),
    duration_sec: int = Form(default=0, ge=0, le=12 * 60 * 60),
    recordings: list[UploadFile] = File(...),
    authorization: str | None = Header(default=None),
):
    user = await get_supabase_user(authorization)
    try:
        parsed = json.loads(sentence_ids)
    except (TypeError, ValueError) as exc:
        raise HTTPException(422, "Danh sách câu ghi âm không hợp lệ") from exc
    if not isinstance(parsed, list) or any(not isinstance(value, str) for value in parsed):
        raise HTTPException(422, "Danh sách câu ghi âm không hợp lệ")
    if len(parsed) != len(recordings) or len(parsed) > course_pronunciation.MAX_RECORDINGS:
        raise HTTPException(422, "Số bản ghi không khớp bộ câu")

    loaded: list[course_pronunciation.Recording] = []
    total = 0
    for sentence_id, upload in zip(parsed, recordings):
        data = await upload.read(course_pronunciation.MAX_FILE_BYTES + 1)
        if len(data) > course_pronunciation.MAX_FILE_BYTES:
            raise HTTPException(413, f"Bản ghi {sentence_id} vượt quá 4 MB")
        if not data:
            raise HTTPException(422, f"Bản ghi {sentence_id} đang trống")
        total += len(data)
        if total > course_pronunciation.MAX_TOTAL_BYTES:
            raise HTTPException(413, "Tổng dung lượng ghi âm vượt quá 32 MB")
        loaded.append(course_pronunciation.Recording(
            sentence_id=sentence_id,
            data=data,
            content_type=upload.content_type or "application/octet-stream",
        ))

    try:
        return await course_pronunciation.submit(
            user_id=user["id"],
            bank_id=str(bank_id),
            client_id=str(client_id),
            recordings=loaded,
            duration_sec=duration_sec,
            assignment_item_id=str(class_item) if class_item else None,
        )
    except course_pronunciation.CoursePronunciationError as exc:
        _raise(exc)
