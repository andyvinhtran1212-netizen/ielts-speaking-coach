import logging
import sys

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user, router as auth_router
from routers.sessions import router as sessions_router
from routers.questions import router as questions_router
from routers.grading import router as grading_router
from routers.tts import router as tts_router
from routers.export import router as export_router
from routers.admin import router as admin_router
from routers.cohorts import router as cohorts_router
from routers.admin_writing import router as admin_writing_router
from routers.admin_writing_prompts import router as admin_writing_prompts_router
from routers.admin_writing_assignments import router as admin_writing_assignments_router
from routers.admin_instructor import router as admin_instructor_router
from routers.admin_students import router as admin_students_router
from routers.writing_student import router as writing_student_router
from routers.grammar import router as grammar_router
from routers.pronunciation import router as pronunciation_router
from routers.sitemap import router as sitemap_router
from routers.vocabulary import router as vocabulary_router
from routers.analytics import router as analytics_router
from routers.vocabulary_bank import router as vocabulary_bank_router
from routers.exercises import (
    user_router as exercises_user_router,
    admin_router as exercises_admin_router,
)
from routers.flashcards import user_router as flashcards_user_router
from routers.listening import (
    user_router as listening_user_router,
    admin_router as listening_admin_router,
)
from routers.health import router as health_router
from routers.dashboard import router as dashboard_router
from routers.student_home import router as student_home_router

# Configure logging to emit INFO+ to stdout (Railway captures stdout).
# Sprint 6.6: backend never called basicConfig before, so Python defaulted
# to WARNING — silencing every Sprint 6.5 matcher_match / anchor_resolve
# / grammar_recommendations_built diagnostic. force=True overrides
# uvicorn's pre-installed handlers so this config wins regardless of
# import order.
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    handlers=[logging.StreamHandler(sys.stdout)],
    force=True,
)

# Reduce noise from common libraries (keep our app at INFO).
logging.getLogger("uvicorn.access").setLevel(logging.INFO)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)

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
    # Cache the CORS preflight (OPTIONS) response for 24h.  Without this the
    # browser issues a fresh preflight before every authenticated request,
    # which on Railway adds ~300-500ms × N endpoints to first paint.  86400
    # is the maximum Chromium honours; Firefox caps at 24h, so 86400 is the
    # right value across both engines.
    max_age=86400,
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
app.include_router(cohorts_router)
app.include_router(admin_writing_router)
app.include_router(admin_writing_prompts_router)
app.include_router(admin_writing_assignments_router)
app.include_router(admin_instructor_router)
app.include_router(admin_students_router)
app.include_router(writing_student_router)
app.include_router(grammar_router)
app.include_router(pronunciation_router)
app.include_router(sitemap_router)
app.include_router(vocabulary_router)
app.include_router(analytics_router)
app.include_router(vocabulary_bank_router)
app.include_router(exercises_user_router)
app.include_router(exercises_admin_router)
app.include_router(flashcards_user_router)
app.include_router(listening_user_router)
app.include_router(listening_admin_router)
app.include_router(health_router)
app.include_router(dashboard_router)
app.include_router(student_home_router)


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
