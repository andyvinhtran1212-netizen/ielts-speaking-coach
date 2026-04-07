from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from config import settings
from routers.auth import router as auth_router
from routers.sessions import router as sessions_router
from routers.questions import router as questions_router
from routers.responses import router as responses_router
from routers.grading import router as grading_router
from routers.tts import router as tts_router
from routers.export import router as export_router
from routers.admin import router as admin_router

app = FastAPI(
    title="IELTS Speaking Coach",
    version="1.0.0"
)

origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:5500",
    "http://127.0.0.1:5500",
    "null",
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

# LEGACY audio-only route: POST /sessions/{id}/responses/{question_id}/audio
#   → upload only, no grading; kept for reference, not used by the frontend
app.include_router(responses_router)


# Catch-all: ensures any unhandled exception still returns JSON + CORS headers
# (without this, Starlette's raw 500 page can strip CORS headers)
@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    print(f"[error] Unhandled exception on {request.url}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"detail": f"Internal server error: {exc}"},
    )


@app.on_event("startup")
async def startup_event():
    print("Server started")


@app.get("/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}


@app.get("/topics")
async def get_topics():
    return [
        {"id": "1", "title": "Technology", "category": "Society", "part": 1},
        {"id": "2", "title": "Travel", "category": "Lifestyle", "part": 1},
        {"id": "3", "title": "My hometown", "category": "Personal", "part": 2},
        {"id": "4", "title": "Technology and society", "category": "Society", "part": 3},
    ]