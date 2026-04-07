"""
routers/export.py — Session export endpoints

GET /sessions/{session_id}/export/pdf
  → Auth required (Bearer token)
  → Ownership enforced (session must belong to the requesting user)
  → Returns PDF as attachment
"""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import StreamingResponse

from database import supabase_admin
from routers.auth import get_supabase_user
# PDF DISABLED: WeasyPrint gobject dependency missing on this machine.
# To re-enable: install system deps (see main.py comment), then uncomment this line.
# from services.pdf_generator import generate_session_pdf

logger = logging.getLogger(__name__)

router = APIRouter(tags=["export"])


@router.get("/sessions/{session_id}/export/pdf")
async def export_session_pdf(
    session_id: str,
    authorization: str | None = Header(default=None),
):
    """
    Generate and stream a PDF performance report for a session.

    The session must belong to the authenticated user.
    Returns: application/pdf with Content-Disposition: attachment.
    """
    # ── Auth ───────────────────────────────────────────────────────────────────
    auth_user = await get_supabase_user(authorization)
    user_id   = auth_user["id"]

    # ── Ownership check ────────────────────────────────────────────────────────
    try:
        s_res = (
            supabase_admin.table("sessions")
            .select("id, started_at")
            .eq("id", session_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(500, f"Lỗi khi kiểm tra session: {exc}")

    if not s_res.data:
        raise HTTPException(404, "Session không tồn tại hoặc không có quyền truy cập")

    # ── Generate PDF ───────────────────────────────────────────────────────────
    # PDF DISABLED: WeasyPrint system dependencies not available.
    # To re-enable: uncomment the import above and the block below.
    raise HTTPException(503, "PDF export is temporarily disabled (missing system dependencies)")

    # logger.info("[export] generating PDF for session=%s user=%s", session_id, user_id)
    # try:
    #     pdf_bytes = await generate_session_pdf(session_id)
    # except ValueError as exc:
    #     raise HTTPException(404, str(exc))
    # except RuntimeError as exc:
    #     logger.error("[export] PDF render failed for session=%s: %s", session_id, exc)
    #     raise HTTPException(500, f"Không thể tạo PDF: {exc}")

    # # ── Filename ───────────────────────────────────────────────────────────────
    # date_tag = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # filename = f"IELTS_Report_{date_tag}.pdf"

    # return StreamingResponse(
    #     iter([pdf_bytes]),
    #     media_type="application/pdf",
    #     headers={
    #         "Content-Disposition": f'attachment; filename="{filename}"',
    #         "Content-Length": str(len(pdf_bytes)),
    #     },
    # )
