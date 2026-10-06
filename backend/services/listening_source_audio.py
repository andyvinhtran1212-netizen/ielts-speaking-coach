"""Read independently published synthetic audio without replacing source assets."""
from functools import lru_cache
import json
from pathlib import Path
from typing import Callable

from fastapi import HTTPException
from models.listening_source_audio import SourceAudioResponse

CATALOG_PATH = Path(__file__).resolve().parents[1] / "content/listening/80-days-audio-variants-v1.json"


@lru_cache(maxsize=1)
def audio_catalog() -> dict:
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    if data.get("schema") != "80-days-audio-variants/1" or [row.get("day") for row in data["days"]] != list(range(1, 81)):
        raise ValueError("Invalid audio catalog")
    return data


def audio_response(package: dict, lesson: dict, signer: Callable[[str], str | None]) -> dict:
    catalog = audio_catalog()
    if (package.get("package_id"), package.get("manifest_sha256")) != (catalog["package_id"], catalog["manifest_sha256"]):
        raise HTTPException(409, "Bản audio mới chưa được gắn với phiên bản nội dung này.")
    day = lesson["sequence_num"]
    if not isinstance(day, int) or not 1 <= day <= 80:
        raise HTTPException(503, "Thông tin ngày học chưa hợp lệ.")
    row = catalog["days"][day - 1]
    if lesson.get("source_lesson_id") != row["source_day_id"]:
        raise HTTPException(503, "Audio chưa khớp ngày học.")
    variants = []
    if original := row["original"]:
        variants.append({"variant_id": "original", "label_vi": "Bản ghi gốc", "synthetic": False,
            "duration_seconds": original["duration_seconds"], "url": signer(original["storage_path"]),
            "note_vi": "Nguồn chỉ có Section 1–2." if original["partial"] else "Bản ghi được giữ nguyên từ nguồn."})
    new = row["kokoro"]
    note = ("Luyện phát âm từ vựng tiếng Anh; không phải hội thoại."
            if new["kind"] == "source_vocabulary_pronunciation_extension"
            else "Bạn có thể nghe lại audio toàn buổi.")
    variants.append({"variant_id": "kokoro-v1", "label_vi": "Bản luyện nghe", "synthetic": True,
        "duration_seconds": new["duration_seconds"], "url": signer(new["storage_path"]), "note_vi": note})
    return SourceAudioResponse(day=day, variants=variants).model_dump()
