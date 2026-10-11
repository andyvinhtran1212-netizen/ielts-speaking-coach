"""Collection resources use the same signed-in Listening boundary as practice."""
from fastapi import APIRouter, Header, HTTPException, Path
from config import settings
from database import supabase_admin
from routers.auth import get_supabase_user
from models.listening_source_collection import (
    ListeningSourceCollectionResponse, ListeningSourceDayResponse,
    ListeningSourceStudyRequest, ListeningSourceStudyResponse,
)
from services import listening_source_collection as service
from models.listening_source_audio import SourceAudioResponse

router = APIRouter(prefix="/api/listening/source-collections", tags=["listening-source"])


def _sign(path: str) -> str | None:
    try:
        value = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).create_signed_url(path, 7200)
        return value.get("signedURL") or value.get("signed_url")
    except Exception:
        return None


def _context(day: int | None = None):
    try:
        package = service.published_package(supabase_admin)
        lessons = service.source_lessons(supabase_admin, package, day)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(503, "Không tải được bộ ngày học; hãy thử lại.") from exc
    if day is not None and len(lessons) != 1:
        raise HTTPException(404, "Không tìm thấy ngày học.")
    if day is None and [row["sequence_num"] for row in lessons] != list(range(1, 81)):
        raise HTTPException(503, "Bộ ngày học chưa đầy đủ; hãy thử lại.")
    return package, lessons


@router.get("/80-days", response_model=ListeningSourceCollectionResponse)
async def get_source_collection(authorization: str | None = Header(default=None)):
    from routers.listening import _programme_attempt_state
    user = await get_supabase_user(authorization)
    package, lessons = _context()
    forms = service.source_forms(supabase_admin, package)
    states, partial = _programme_attempt_state(user["id"], forms)
    cards = [service.day_card(lesson, forms, states) for lesson in lessons]
    return {"collection_id": "80-days", "package_id": package["package_id"],
        "manifest_sha256": package["manifest_sha256"], "title": package["title"],
        "groups": [{"id": key, "title": title, "days": [card for card in cards if card["group"] == key]}
                   for key, title in service.GROUP_TITLES.items()], "partial_data": partial}


@router.get("/80-days/days/{day_number}", response_model=ListeningSourceDayResponse)
async def get_source_day(day_number: int = Path(ge=1, le=80), authorization: str | None = Header(default=None)):
    from routers.listening import _programme_attempt_state
    user = await get_supabase_user(authorization)
    package, lessons = _context(day_number)
    forms = service.source_forms(supabase_admin, package)
    states, partial = _programme_attempt_state(user["id"], forms)
    return service.day_response(package, lessons[0], forms, states, _sign, partial)


@router.post("/80-days/days/{day_number}/study", response_model=ListeningSourceStudyResponse)
async def open_source_study(body: ListeningSourceStudyRequest, day_number: int = Path(ge=1, le=80),
                            authorization: str | None = Header(default=None)):
    await get_supabase_user(authorization)
    package, lessons = _context(day_number)
    return service.study_response(lessons[0], body.block_ids, _sign, manifest_sha256=package.get("manifest_sha256"))


@router.get("/80-days/days/{day_number}/audio", response_model=SourceAudioResponse)
async def get_source_audio(day_number: int = Path(ge=1, le=80), authorization: str | None = Header(default=None)):
    from services.listening_source_audio import audio_response
    await get_supabase_user(authorization)
    package, lessons = _context(day_number)
    paths = []
    audio_response(package, lessons[0], lambda path: paths.append(path))
    unique = list(dict.fromkeys(paths))
    try:
        rows = supabase_admin.storage.from_(settings.LISTENING_AUDIO_BUCKET).create_signed_urls(unique, 7200)
        allowed = set(unique)
        signed = {row["path"]: row.get("signedURL") or row.get("signedUrl") for row in rows
                  if row.get("path") in allowed and not row.get("error")}
    except Exception:
        signed = {}
    return audio_response(package, lessons[0], lambda path: signed.get(path))
