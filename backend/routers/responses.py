"""
routers/responses.py — LEGACY audio-upload-only route.

  POST /sessions/{session_id}/responses/{question_id}/audio

This route uploads audio to Supabase Storage but does NOT run Whisper or Claude.
It is NOT used by the frontend. The official grading pipeline is in grading.py:

  POST /sessions/{session_id}/responses   ← use this one

Kept here in case it is needed for debugging or manual uploads.
"""
from fastapi import APIRouter, HTTPException, Header, UploadFile, File

from database import supabase_admin
from routers.auth import get_supabase_user

router = APIRouter(tags=["responses"])

_AUDIO_BUCKET = "audio-responses"


# ── POST /sessions/{session_id}/responses/{question_id}/audio ─────────────────

@router.post("/sessions/{session_id}/responses/{question_id}/audio")
async def upload_audio_response(
    session_id:  str,
    question_id: str,
    audio: UploadFile = File(...),
    authorization: str | None = Header(default=None),
):
    """
    Nhận file âm thanh cho một câu trả lời, lưu vào Supabase Storage,
    tạo (hoặc cập nhật) bản ghi trong bảng responses.
    """
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    # Verify session ownership
    try:
        s_result = (
            supabase_admin.table("sessions")
            .select("id, part")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải session: {e}")

    if not s_result.data:
        raise HTTPException(status_code=404, detail="Session không tồn tại")

    # Read audio bytes
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="File âm thanh trống")

    # Upload to Supabase Storage (upsert so re-attempts overwrite)
    storage_path = f"{user_id}/{session_id}/{question_id}.webm"
    audio_url    = None

    try:
        supabase_admin.storage.from_(_AUDIO_BUCKET).upload(
            path=storage_path,
            file=audio_bytes,
            file_options={
                "content-type": audio.content_type or "audio/webm",
                "upsert":       "true",
            },
        )
        audio_url = supabase_admin.storage.from_(_AUDIO_BUCKET).get_public_url(storage_path)
    except Exception as e:
        # Storage might not be set up yet — log and continue without URL
        print(f"[warn] Storage upload failed ({storage_path}): {e}")

    # Check if a response row already exists for this question
    try:
        existing = (
            supabase_admin.table("responses")
            .select("id")
            .eq("session_id",  session_id)
            .eq("question_id", question_id)
            .limit(1)
            .execute()
        )
    except Exception:
        existing = None

    # Upsert response row
    try:
        if existing and existing.data:
            result = (
                supabase_admin.table("responses")
                .update({"audio_url": audio_url})
                .eq("id", existing.data[0]["id"])
                .execute()
            )
        else:
            result = (
                supabase_admin.table("responses")
                .insert({
                    "session_id":   session_id,
                    "question_id":  question_id,
                    "user_id":      user_id,
                    "audio_url":    audio_url,
                    "transcript":   None,
                    "feedback":     None,
                    "overall_band": None,
                })
                .execute()
            )

        return result.data[0]

    except Exception as e:
        # responses table might not exist yet — return a stub so the frontend can continue
        print(f"[warn] Could not persist response to DB: {e}")
        return {
            "session_id":   session_id,
            "question_id":  question_id,
            "user_id":      user_id,
            "audio_url":    audio_url,
            "transcript":   None,
            "feedback":     None,
            "overall_band": None,
            "_stub":        True,
        }
