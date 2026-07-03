import logging
import re
import sys
from time import perf_counter

# listening-fulltest-md-import hotfix — force UTF-8 stdio. Railway/Nixpacks can
# launch Python with an ASCII locale (UTF-8 Mode OFF → sys.stdout.encoding ==
# 'ascii'); under it ANY print()/stdout write of non-ASCII (e.g. Vietnamese
# chữa-bài content flowing through a library that prints, or a stdout log) raises
# `UnicodeEncodeError: 'ascii' codec can't encode …` and bubbles to a 500. This
# was the prod-only failure of POST /admin/listening/import-fulltest/commit
# (every local path passed; httpx bodies/headers are utf-8 either way — only the
# ASCII stdout differed). Reconfiguring here makes stdout/stderr utf-8 regardless
# of locale; PYTHONUTF8=1 (deploy env) covers locale-based encodes too.
for _std in (sys.stdout, sys.stderr):
    try:
        _std.reconfigure(encoding="utf-8", errors="backslashreplace")
    except Exception:        # pragma: no cover — non-reconfigurable stream
        pass

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from services.errors import safe_detail, GENERIC_MESSAGE
from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user, router as auth_router
from services.server_timing import (
    format_header as format_server_timing_header,
    install_supabase_timing,
    reset_request as reset_server_timing_request,
    start_request as start_server_timing_request,
)
from routers.sessions import router as sessions_router
from routers.questions import router as questions_router
from routers.grading import router as grading_router
from routers.tts import router as tts_router
from routers.export import router as export_router
from routers.admin import router as admin_router
from routers.cohorts import router as cohorts_router
from routers.error_logs import router as error_logs_router
from routers.admin_overview import router as admin_overview_router
from routers.admin_writing import router as admin_writing_router
from routers.admin_writing_prompts import router as admin_writing_prompts_router
from routers.admin_writing_tips import router as admin_writing_tips_router
from routers.admin_writing_tips import content_router as admin_writing_content_router
from routers.admin_writing_cohorts import router as admin_writing_cohorts_router
from routers.admin_writing_regrade import router as admin_writing_regrade_router
from routers.admin_writing_assignments import router as admin_writing_assignments_router
from routers.admin_instructor_queue import router as admin_instructor_router
from routers.instructor import router as instructor_router
from routers.admin_instructors import router as admin_instructors_router
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
from routers.admin_reading import router as admin_reading_content_router
from routers.admin_reading import questions_router as admin_reading_questions_router
from routers.admin_vocab import router as admin_vocab_content_router
from routers.admin_topics import router as admin_topics_router
from routers.admin_quiz import router as admin_quiz_router
from routers.quiz import router as quiz_player_router
from routers.reading_student import router as reading_student_router
from routers.feedback import router as feedback_router

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
install_supabase_timing()

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
    # Production — explicit list as primary
    "https://averlearning.com",
    "https://www.averlearning.com",
    "https://ielts-speaking-coach-sage.vercel.app",
]

# Sprint 20.10 D1 — belt-and-suspenders against subdomain drift.
# Andy's prod dogfood hit "No 'Access-Control-Allow-Origin' header" from
# https://www.averlearning.com even though both apex and www were already
# in the explicit list (commit 4c9fc1e9, 2026-04-08). The most likely
# remaining single-point-of-failure is the explicit list itself going
# stale as new subdomains roll out (staging.averlearning.com, app.…, etc.).
# This regex matches the apex + any direct subdomain of averlearning.com
# over HTTPS — orthogonal to the explicit list, so either match grants
# the request. The explicit list still wins for fast-path matching;
# the regex is the safety net.
_AVERLEARNING_ORIGIN_REGEX = r"^https://(?:[a-z0-9-]+\.)?averlearning\.com$"


def _cors_headers_for_origin(origin: str | None) -> dict:
    """CORS headers to attach to a response when the request Origin is allowed —
    reuses the SAME allowlist + regex as the CORSMiddleware below (no duplication).

    Used by the unhandled-exception handler: an unhandled 500 unwinds OUTSIDE the
    CORSMiddleware (ServerErrorMiddleware is outermost), so its response would have
    NO Access-Control-Allow-Origin and the browser masks the real status as a
    generic CORS error (the failure mode that hid the compose-500). Attaching ACAO
    here lets the true 500 surface in the console.

    SECURITY: only echo an ALLOWED origin — never reflect an arbitrary one. Returns
    {} for a missing / non-allowed origin.
    """
    if origin and (origin in origins or re.match(_AVERLEARNING_ORIGIN_REGEX, origin)):
        return {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
            "Vary": "Origin",
        }
    return {}


app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_origin_regex=_AVERLEARNING_ORIGIN_REGEX,
    allow_credentials=True,
    # C-4.2 hardening — tighten from "*" to the methods/headers the app actually
    # uses (regex + credentials kept; see the intentional-regex note above).
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    # NB: beyond Authorization/Content-Type, the app sends X-Reading-Password /
    # X-Reading-Anon (reading lock + share-link flows) and X-Request-ID
    # (error-reporter). They MUST stay allowed or those flows' CORS preflight
    # breaks — the audit's 2-header list would have regressed them.
    allow_headers=["Authorization", "Content-Type",
                   "X-Reading-Password", "X-Reading-Anon", "X-Request-ID"],
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
# PDF export (GET /sessions/{id}/export/pdf) — ReportLab, pure Python, zero
# system deps (fonts-dejavu-core via nixpacks.toml). Works on Railway.
app.include_router(export_router)
app.include_router(admin_router)
app.include_router(cohorts_router)
app.include_router(error_logs_router)
app.include_router(admin_overview_router)
app.include_router(admin_writing_router)
app.include_router(admin_writing_prompts_router)
app.include_router(admin_writing_tips_router)
app.include_router(admin_writing_content_router)
app.include_router(admin_writing_cohorts_router)
app.include_router(admin_writing_regrade_router)
app.include_router(admin_writing_assignments_router)
app.include_router(admin_instructor_router)
app.include_router(instructor_router)
app.include_router(admin_instructors_router)
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
app.include_router(admin_reading_content_router)
app.include_router(admin_reading_questions_router)
app.include_router(admin_vocab_content_router)
app.include_router(admin_topics_router)
app.include_router(admin_quiz_router)
app.include_router(quiz_player_router)
app.include_router(reading_student_router)
app.include_router(feedback_router)
app.include_router(health_router)
app.include_router(dashboard_router)
app.include_router(student_home_router)


# ── Public stats — no auth, for the marketing landing page ────────────
@app.get("/api/public-stats")
def public_stats():
    try:
        users_res = (
            supabase_admin.table("users")
            .select("*", count="exact")
            .limit(0)
            .execute()
        )
        sessions_res = (
            supabase_admin.table("sessions")
            .select("*", count="exact")
            .eq("status", "completed")
            .limit(0)
            .execute()
        )
        return {
            "total_users": users_res.count or 0,
            "sessions_completed": sessions_res.count or 0,
        }
    except Exception:
        return {"total_users": None, "sessions_completed": None}


# ── PR1 single-source — per-request access-permission memo ────────────
# Speaking + /auth/me + writing all read the LIVE access-code permissions
# (get_user_access_code_permissions). This memo caches that lookup for the
# duration of ONE request so duplicate gates don't re-query; it is reset per
# request, so a revoke is always reflected on the next request (never cached
# across requests).
@app.middleware("http")
async def access_perm_memo_middleware(request: Request, call_next):
    from services.access_code_permissions import (
        begin_request_permission_memo,
        reset_request_permission_memo,
    )
    token = begin_request_permission_memo()
    try:
        return await call_next(request)
    finally:
        reset_request_permission_memo(token)


# ── Sprint Perf-1 — Server-Timing observability ───────────────────────
@app.middleware("http")
async def server_timing_middleware(request: Request, call_next):
    """Emit W3C Server-Timing for API observability.

    Skip health probes so uptime checks stay minimal. All other routes get a
    total/auth/db/app breakdown; auth/db are accumulated by helper wrappers.

    Gated behind settings.ENABLE_SERVER_TIMING (default OFF). When disabled the
    request passes straight through — no timing bucket is started, so the
    record_stage() helpers no-op (their ContextVar bucket stays None) and no
    Server-Timing header is emitted. Flip ENABLE_SERVER_TIMING=true in .env to
    re-enable for a debugging session.
    """
    if not settings.ENABLE_SERVER_TIMING:
        return await call_next(request)
    if request.url.path.startswith("/health"):
        return await call_next(request)

    token = start_server_timing_request()
    start = perf_counter()
    try:
        response = await call_next(request)
        total_ms = (perf_counter() - start) * 1000
        response.headers["Server-Timing"] = format_server_timing_header(total_ms)
        # Perf P3.3 — the frontend (Vercel) and API (Railway) are cross-origin,
        # so the browser's PerformanceResourceTiming.serverTiming stays EMPTY
        # unless we opt the caller in with Timing-Allow-Origin. Reflect the
        # request Origin (browsers only send it on cross-origin calls) so the
        # header is scoped to the actual caller; fall back to * for same-origin
        # / tooling. Timing data is low-sensitivity, but scoping keeps parity
        # with the CORS allowlist posture. Only emitted alongside Server-Timing.
        response.headers["Timing-Allow-Origin"] = request.headers.get("origin", "*")
        return response
    finally:
        reset_server_timing_request(token)


# ── Sprint 12.3 — X-Request-ID middleware ─────────────────────────────
# Generate or propagate a request ID so frontend exception reports can
# correlate to backend error_logs rows (same UUID on both sides).
@app.middleware("http")
async def request_id_middleware(request: Request, call_next):
    import uuid as _uuid
    request_id = request.headers.get("x-request-id") or str(_uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response


# ── Sprint 12.3 — fire-and-forget error_logs INSERT ───────────────────
def _insert_error_log_safely(payload: dict) -> None:
    """Persist a row to error_logs. Never raises — logging cannot
    escalate failures into user-visible 500s. Called from a background
    task so the response path is never blocked by Supabase latency."""
    try:
        supabase_admin.table("error_logs").insert(payload).execute()
    except Exception as e:
        logger.error("[error_logs] Background INSERT failed: %s", e)


# Catch-all: ensures any unhandled exception still returns JSON + CORS headers
# (without this, Starlette's raw 500 page can strip CORS headers). Sprint
# 12.3 extended this to capture the exception into the error_logs table
# via asyncio.create_task fire-and-forget — the response is returned
# immediately; logging happens in the background.
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    import asyncio as _asyncio
    import traceback as _traceback
    import uuid as _uuid

    request_id = getattr(request.state, "request_id", None) or str(_uuid.uuid4())
    logger.error("[error] Unhandled exception on %s (req=%s): %s",
                 request.url, request_id, exc)

    payload = {
        "level":      "error",
        "source":     "backend",
        "message":    (str(exc) or exc.__class__.__name__)[:1000],
        "stack":      _traceback.format_exc()[:5000],
        "url":        str(request.url.path)[:500],
        "request_id": request_id,
        "extra": {
            "method": request.method,
            "query":  dict(request.query_params) if request.query_params else None,
        },
    }
    try:
        _asyncio.create_task(
            _asyncio.to_thread(_insert_error_log_safely, payload)
        )
    except RuntimeError:
        # No running loop (e.g. during shutdown) — swallow.
        pass

    # P0-5: do NOT leak the raw exception to the client — return a safe dict
    # ({error_code, message, ref}); the full exc is logged above + persisted to
    # error_logs. `ref` == request_id so support can correlate.
    # PR-B: attach CORS headers when the Origin is allowed — this handler runs
    # OUTSIDE the CORSMiddleware (the exception unwound past it), so without this
    # the 500 carries no ACAO and the browser reports a generic CORS error,
    # masking the real status (the trap that cost 4 hypotheses on the compose-500).
    headers = {"X-Request-ID": request_id}
    headers.update(_cors_headers_for_origin(request.headers.get("origin")))
    return JSONResponse(
        status_code=500,
        content={
            "detail":     {"error_code": "internal_error",
                           "message": GENERIC_MESSAGE, "ref": request_id},
            "request_id": request_id,
        },
        headers=headers,
    )


# ── P0-5 / C-1.3 — sanitize EXPLICIT HTTPExceptions before they reach the client.
# The ~131 `raise HTTPException(500, f"…{e}")` sites are served by Starlette's
# HTTPException handler (NOT the generic Exception handler above), so they bypass
# the sanitization. This handler routes every HTTPException through safe_detail():
# 4xx pass through unchanged (intentional client-error messages); 5xx string /
# unstructured details are replaced with a safe {error_code, message, ref} + the
# original is logged. Structured 5xx dicts that already carry an error_code (e.g.
# response_persist_failed) pass through untouched.
@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(request: Request, exc: StarletteHTTPException):
    import uuid as _uuid
    request_id = getattr(request.state, "request_id", None) or str(_uuid.uuid4())
    detail = safe_detail(exc.status_code, exc.detail, ref=request_id)
    headers = dict(getattr(exc, "headers", None) or {})
    headers.setdefault("X-Request-ID", request_id)
    return JSONResponse(status_code=exc.status_code,
                        content={"detail": detail}, headers=headers)


# W-4 — owner-scope violations from the instructor accessor/services raise
# PermissionError; map them to a generic 403 (never 500, never name the object so
# B can't infer A's resource exists). The instructor route layer relies on this.
@app.exception_handler(PermissionError)
async def permission_error_handler(request: Request, exc: PermissionError):
    import uuid as _uuid
    request_id = getattr(request.state, "request_id", None) or str(_uuid.uuid4())
    return JSONResponse(
        status_code=403,
        content={"detail": "Bạn không có quyền với tài nguyên này."},
        headers={"X-Request-ID": request_id},
    )


@app.on_event("startup")
async def startup_event():
    logger.info("Server started")

    # P0-1 (C-1.1) async-DB scaffold. The event-loop-lag monitor always runs —
    # it's the baseline instrument (read it with USE_ASYNC_DB OFF = "before").
    # The async client + its timing wrapper are built ONLY when the flag is on,
    # so flag-off is a true no-op (no extra client, no patched async builders).
    from services import loop_monitor
    loop_monitor.start()
    if settings.USE_ASYNC_DB:
        from services.server_timing import install_supabase_async_timing
        from database import init_supabase_async
        install_supabase_async_timing()
        await init_supabase_async()
        logger.info("[async-db] USE_ASYNC_DB=on — async client initialised, timing wrapped")
    else:
        logger.info("[async-db] USE_ASYNC_DB=off — sync path only (scaffold no-op)")

    # Sprint W-MM — writing grading reaper. A grading BG task runs in-process; a
    # Railway restart/OOM/timeout mid-grade orphans the essay in 'grading' with
    # no error (no exception ⇒ no _mark_failed). This loop periodically sweeps
    # stuck writing_jobs and requeues / terminal-fails them. Disable via env
    # WRITING_REAPER_ENABLED=false.
    if settings.WRITING_REAPER_ENABLED:
        import asyncio as _asyncio_reaper
        from services import essay_service

        async def _writing_reaper_loop():
            while True:
                await _asyncio_reaper.sleep(settings.WRITING_REAPER_INTERVAL_SECONDS)
                try:
                    res = await essay_service.reap_stuck_grading_jobs()
                    if res.get("requeued") or res.get("failed"):
                        logger.info("[writing-reaper] sweep %s", res)
                except Exception:
                    logger.exception("[writing-reaper] sweep failed")

        _asyncio_reaper.create_task(_writing_reaper_loop())
        logger.info(
            "[writing-reaper] started (interval=%ss, std-timeout=%ss)",
            settings.WRITING_REAPER_INTERVAL_SECONDS,
            settings.WRITING_STUCK_JOB_TIMEOUT_SECONDS,
        )


@app.on_event("shutdown")
async def shutdown_event():
    # Perf (B) — release the shared token-verification keep-alive pool cleanly.
    from routers.auth import close_auth_http_client
    await close_auth_http_client()


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
