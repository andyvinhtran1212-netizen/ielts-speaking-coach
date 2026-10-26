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
    for row in data["days"]:
        original = row.get("original")
        if not original or not (playback := original.get("practice")):
            continue
        expected = f"source-collections/{data['package_id']}/{data['manifest_sha256']}/variants/original-practice-v1/{playback['sha256']}.mp3"
        intervals = playback["kept_intervals"]
        if (playback["storage_path"] != expected or not intervals
                or any(not 0 <= start < end <= original["duration_seconds"] for start, end in intervals)
                or any(left[1] > right[0] for left, right in zip(intervals, intervals[1:]))
                or abs(playback["duration_seconds"] - sum(end-start for start, end in intervals)) > .15):
            raise ValueError("Invalid original practice audio binding")
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
        playback = original.get("practice", original)
        variants.append({"variant_id": "original", "label_vi": "Bản ghi gốc", "synthetic": False,
            "duration_seconds": playback["duration_seconds"], "url": signer(playback["storage_path"]),
            "note_vi": "Nguồn chỉ có Section 1–2." if original["partial"] else "Đã bỏ phần giới thiệu và nhạc dạo; giữ nội dung bài nghe."})
    new = row["kokoro"]
    note = ("Luyện phát âm từ vựng tiếng Anh; không phải hội thoại."
            if new["kind"] == "source_vocabulary_pronunciation_extension"
            else "Bạn có thể nghe lại audio toàn buổi.")
    variants.append({"variant_id": "kokoro-v1", "label_vi": "Bản luyện nghe", "synthetic": True,
        "duration_seconds": new["duration_seconds"], "url": signer(new["storage_path"]), "note_vi": note})
    from services.listening_source_question_audio import question_clips
    clips = question_clips(package, day, row["original"], signer)
    return SourceAudioResponse(day=day, variants=variants, question_clips=clips).model_dump()
