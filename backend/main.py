from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from config import settings

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
