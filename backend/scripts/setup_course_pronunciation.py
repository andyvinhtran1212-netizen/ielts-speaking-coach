"""Validate, render and register a fixed course pronunciation set.

Dry-run is the default.  With ``--commit`` this script renders missing Kokoro
reference clips into the content-addressed vocab-audio bucket, then upserts the
set by bank_id.  Re-running is safe: identical text/voice/model maps to the same
object path and the database row is replaced only after every clip succeeds.

Example:
  cd backend
  venv/bin/python scripts/setup_course_pronunciation.py \
    --file data/course_pronunciation/C1-B05.json --commit
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

logger = logging.getLogger(__name__)

from services.course_pronunciation_manifest import pronunciation_content_hash  # noqa: E402


def _load(path: Path) -> tuple[dict, str]:
    try:
        raw = path.read_bytes()
        data = json.loads(raw)
    except (OSError, ValueError) as exc:
        raise SystemExit(f"Không đọc được {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise SystemExit("Gói phát âm phải là một JSON object.")
    required = ("bank_code", "title", "locale", "provider", "voice_engine", "voice")
    missing = [key for key in required if not str(data.get(key) or "").strip()]
    if missing:
        raise SystemExit(f"Thiếu trường bắt buộc: {', '.join(missing)}")
    rates = data.get("playback_rates")
    if rates != [0.85, 1.0]:
        raise SystemExit("playback_rates phải đúng [0.85, 1.0].")
    sentences = data.get("sentences")
    if not isinstance(sentences, list) or not sentences:
        raise SystemExit("Gói phát âm không có câu.")
    if len(sentences) > 20:
        raise SystemExit("Một gói phát âm không được vượt quá 20 câu.")
    ids: set[str] = set()
    for order, sentence in enumerate(sentences, 1):
        if not isinstance(sentence, dict) or sentence.get("order") != order:
            raise SystemExit(f"Câu thứ {order} sai thứ tự.")
        sentence_id = str(sentence.get("id") or "").strip()
        text = str(sentence.get("text") or "").strip()
        if not sentence_id or sentence_id in ids:
            raise SystemExit(f"Câu thứ {order} thiếu hoặc trùng id.")
        if not text or len(text) > 500:
            raise SystemExit(f"Câu thứ {order} trống hoặc dài quá 500 ký tự.")
        ids.add(sentence_id)
    content_hash = pronunciation_content_hash(
        sentences=[sentence["text"] for sentence in sentences],
        locale=data["locale"],
        voice_engine=data["voice_engine"],
        voice=data["voice"],
    )
    return data, content_hash


def _bank(code: str, supabase_admin) -> dict:
    try:
        rows = (
            supabase_admin.table("quiz_banks")
            .select("id, code, skill_area, lesson_no")
            .eq("code", code)
            .eq("skill_area", "course")
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Không tìm được bank {code}: {exc}") from exc
    if not rows:
        raise SystemExit(f"Không tồn tại bank course {code}.")
    return rows[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--file",
        default="data/course_pronunciation/C1-B05.json",
        help="JSON gói phát âm (mặc định B05 của Course 1).",
    )
    parser.add_argument("--commit", action="store_true", help="Sinh audio và ghi thật.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    path = Path(args.file)
    data, content_hash = _load(path)
    logger.info(
        "%s · %d câu · %s · %s/%s · hash %s",
        data["bank_code"], len(data["sentences"]), data["locale"],
        data["voice_engine"], data["voice"], content_hash[:12],
    )
    if not args.commit:
        for sentence in data["sentences"]:
            logger.info("%02d  %s", sentence["order"], sentence["text"])
        logger.info("THỬ KHÔ — thêm --commit để render/cache và đăng ký bộ câu.")
        return 0

    # Credentials and the heavy Kokoro/Storage dependency are intentionally
    # loaded only for a real write.  Dry-run must work on a clean review machine
    # and must not create a Supabase client as a side effect of validation.
    from database import supabase_admin
    from services import tts_audio

    bank = _bank(str(data["bank_code"]), supabase_admin)
    prepared = []
    for sentence in data["sentences"]:
        _url, rendered = tts_audio.get_or_create_audio_sync(
            sentence["text"], engine=data["voice_engine"], voice=data["voice"]
        )
        storage_path = tts_audio.audio_path(
            sentence["text"], data["voice"], data["voice_engine"]
        )
        prepared.append({**sentence, "audio_storage_path": storage_path})
        logger.info("%02d  %s  %s", sentence["order"], "render" if rendered else "cache", storage_path)

    payload = {
        "bank_id": bank["id"],
        "title": data["title"],
        "locale": data["locale"],
        "provider": data["provider"],
        "voice_engine": data["voice_engine"],
        "voice": data["voice"],
        "content_hash": content_hash,
        "playback_rates": data["playback_rates"],
        "sentences": prepared,
        "is_active": True,
    }
    try:
        rows = (
            supabase_admin.table("course_pronunciation_sets")
            .upsert(payload, on_conflict="bank_id")
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(f"Audio đã cache nhưng chưa đăng ký được bộ câu: {exc}") from exc
    if not rows:
        raise SystemExit("Upsert bộ câu không trả về dữ liệu.")
    logger.info("Đã đăng ký %s cho bank %s (%s).", rows[0]["id"], bank["code"], bank["id"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
