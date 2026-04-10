import logging

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user, router as auth_router
from routers.sessions import router as sessions_router
from routers.questions import router as questions_router
from routers.responses import router as responses_router
from routers.grading import router as grading_router
from routers.tts import router as tts_router
from routers.export import router as export_router
from routers.admin import router as admin_router
from routers.grammar import router as grammar_router

logger = logging.getLogger(__name__)

app = FastAPI(
    title="IELTS Speaking Coach",
    version="1.0.0"
)

origins = [
    # Local development
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    # Production
    "https://averlearning.com",
    "https://www.averlearning.com",
    "https://ielts-speaking-coach-sage.vercel.app",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(sessions_router)
app.include_router(questions_router)

# OFFICIAL grading route: POST /sessions/{id}/responses
#   → full pipeline: Whisper STT + Claude grading, returns band scores + feedback
app.include_router(grading_router)
app.include_router(tts_router)
# PDF export router is registered but the endpoint returns 503 until WeasyPrint
# system deps are installed. To fully re-enable: see routers/export.py.
app.include_router(export_router)
app.include_router(admin_router)
app.include_router(grammar_router)

# LEGACY audio-only route: POST /sessions/{id}/responses/{question_id}/audio
#   → upload only, no grading; kept for reference, not used by the frontend
app.include_router(responses_router)


# Catch-all: ensures any unhandled exception still returns JSON + CORS headers
# (without this, Starlette's raw 500 page can strip CORS headers)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("[error] Unhandled exception on %s: %s", request.url, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )


@app.on_event("startup")
async def startup_event():
    logger.info("Server started")


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/topics")
async def get_topics(
    part: int | None = None,
    authorization: str | None = Header(default=None),
):
    """Return active topics for authenticated users, optionally filtered by part (1/2/3)."""
    await get_supabase_user(authorization)

    try:
        query = (
            supabase_admin.table("topics")
            .select("id, title, category, part")
            .eq("is_active", True)
            .order("part")
            .order("title")
        )
        if part is not None:
            query = query.eq("part", part)
        res = query.execute()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Lỗi khi tải topics: {exc}")

    return res.data or []
