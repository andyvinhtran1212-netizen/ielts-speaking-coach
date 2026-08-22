"""Generate and stamp Kokoro audio for English MCQ stems in a course bank.

Dry-run is the default.  A real run is idempotent because every clip uses the
content-addressed path from ``services.tts_audio``.  A pre-rendered ZIP may be
supplied to avoid loading Kokoro on the deployment machine; it must contain a
``manifest.json`` plus each MP3 at its declared storage path.

Examples:
  cd backend
  python -m scripts.pregen_course_question_audio --bank C1-B06
  python -m scripts.pregen_course_question_audio --bank C1-B06 \
    --tts-pack /path/to/buoi-06_kokoro_tts.zip --commit
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import zipfile
from pathlib import Path

from database import supabase_admin
from services import tts_audio

logger = logging.getLogger("pregen-course-question-audio")

ENGINE = "kokoro"
DEFAULT_VOICE = "bf_emma"


def _bank(code: str) -> dict:
    rows = (
        supabase_admin.table("quiz_banks")
        .select("id, code, skill_area")
        .eq("code", code)
        .eq("skill_area", "course")
        .limit(1)
        .execute()
        .data
        or []
    )
    if not rows:
        raise SystemExit(f"Không tồn tại bank course {code!r}.")
    return rows[0]


def _question_rows(bank_id: str) -> list[dict]:
    return (
        supabase_admin.table("quiz_questions")
        .select("id, qid, type, segments, audio_url")
        .eq("bank_id", bank_id)
        .order("order")
        .execute()
        .data
        or []
    )


def _plan(questions: list[dict]) -> list[dict]:
    planned = []
    for question in questions:
        segments = question.get("segments") or {}
        text = str(segments.get("question_audio_text") or "").strip()
        if not text:
            continue
        planned.append({
            "id": question["id"],
            "qid": question.get("qid"),
            "text": text,
            "voice": str(segments.get("voice") or DEFAULT_VOICE),
            "audio_url": question.get("audio_url"),
        })
    return planned


def _read_pack(path: Path, planned: list[dict]) -> tuple[zipfile.ZipFile, dict]:
    if not path.is_file():
        raise SystemExit(f"Không thấy gói TTS {path}.")
    archive = zipfile.ZipFile(path)
    try:
        manifest = json.loads(archive.read("manifest.json"))
    except (KeyError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        archive.close()
        raise SystemExit(f"Gói TTS không có manifest hợp lệ: {exc}") from exc
    if manifest.get("engine") != ENGINE:
        archive.close()
        raise SystemExit(
            f"Gói TTS dùng engine {manifest.get('engine')!r}, cần {ENGINE!r}.")
    packed = {item.get("storage_path"): item for item in manifest.get("items") or []}
    names = set(archive.namelist())
    for row in planned:
        storage_path = tts_audio.audio_path(row["text"], row["voice"], ENGINE)
        item = packed.get(storage_path)
        if not item or storage_path not in names:
            archive.close()
            raise SystemExit(f"Gói TTS thiếu clip của {row.get('qid')}.")
        if item.get("text") != row["text"] or item.get("voice") != row["voice"]:
            archive.close()
            raise SystemExit(f"Manifest TTS không khớp nội dung {row.get('qid')}.")
    return archive, packed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bank", required=True, help="Mã bank, ví dụ C1-B06.")
    parser.add_argument("--tts-pack", help="ZIP Kokoro đã render sẵn.")
    parser.add_argument("--commit", action="store_true", help="Upload/render và ghi URL thật.")
    parser.add_argument("--dry-run", action="store_true", help="Chỉ kiểm tra (mặc định).")
    parser.add_argument(
        "--regen", action="store_true", help="Tạo/stamp lại cả câu đã có URL.")
    args = parser.parse_args()
    commit = args.commit and not args.dry_run
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    bank = _bank(args.bank)
    questions = _question_rows(bank["id"])
    planned = _plan(questions)
    if not questions:
        raise SystemExit(f"Bank {bank['code']} chưa có câu hỏi.")
    if not planned:
        raise SystemExit(f"Bank {bank['code']} chưa đánh dấu câu tiếng Anh cần audio.")

    archive = None
    if args.tts_pack:
        archive, _manifest = _read_pack(Path(args.tts_pack), planned)
    pending = planned if args.regen else [row for row in planned if not row["audio_url"]]
    logger.info("Bank %s · %d/%d câu cần audio · %d clip đang chờ",
                bank["code"], len(planned), len(questions), len(pending))
    if not commit:
        if archive:
            archive.close()
        logger.info("THỬ KHÔ — thêm --commit để upload/render và stamp URL.")
        return 0

    try:
        for position, row in enumerate(pending, 1):
            storage_path = tts_audio.audio_path(row["text"], row["voice"], ENGINE)
            if not args.regen and tts_audio.audio_exists(storage_path):
                action = "CACHE"
            elif archive:
                tts_audio.upload_mp3(storage_path, archive.read(storage_path))
                action = "PACK"
            else:
                data = tts_audio.synth_sync(row["text"], engine=ENGINE, voice=row["voice"])
                tts_audio.upload_mp3(storage_path, tts_audio.pad_silence_mp3(data))
                action = "RENDER"
            url = tts_audio.public_url(storage_path)
            (supabase_admin.table("quiz_questions").update({"audio_url": url})
             .eq("id", row["id"]).execute())
            logger.info("%s %d/%d %s", action, position, len(pending), row.get("qid"))
    except Exception as exc:  # noqa: BLE001
        logger.error("HỎNG mẻ audio: %s", exc)
        logger.error(
            "Bank %s chưa sẵn sàng; chạy lại cùng lệnh để tiếp tục.", bank["code"])
        return 1
    finally:
        if archive:
            archive.close()

    logger.info(
        "HOÀN TẤT — %d câu tiếng Anh của %s đã có audio.",
        len(planned), bank["code"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
