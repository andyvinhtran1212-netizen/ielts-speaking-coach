"""Course pronunciation/shadowing business logic.

Reference clips are fixed course content.  Learner recordings stay separate per
sentence for retry UX, then this service packs them into <=3-sentence, <=28 s
WAV batches for Azure's short-audio Pronunciation Assessment endpoint.
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any

from pydub import AudioSegment

from database import supabase_admin
from services import azure_pronunciation, quiz_service
from services.tts_audio import VOCAB_AUDIO_BUCKET

logger = logging.getLogger(__name__)

MAX_RECORDINGS = 20
MAX_FILE_BYTES = 4 * 1024 * 1024
MAX_TOTAL_BYTES = 32 * 1024 * 1024
MAX_CLIP_MS = 28_000
MAX_BATCH_MS = 28_000
MAX_SENTENCES_PER_BATCH = 3
SENTENCE_GAP_MS = 450
WEAK_WORD_THRESHOLD = 70.0

_WORD_RE = re.compile(r"[A-Za-z]+(?:['’][A-Za-z]+)?")


class CoursePronunciationError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True)
class Recording:
    sentence_id: str
    data: bytes
    content_type: str


@dataclass(frozen=True)
class DecodedRecording:
    sentence: dict
    audio: AudioSegment


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _json(value: Any) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return value
    return value


def _set_for_bank(bank_id: str) -> dict:
    try:
        rows = (
            supabase_admin.table("course_pronunciation_sets")
            .select("*")
            .eq("bank_id", bank_id)
            .eq("is_active", True)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[course-pronunciation] set lookup failed bank=%s: %s", bank_id, exc)
        raise CoursePronunciationError(500, "Không tải được phần luyện phát âm") from exc
    if not rows:
        raise CoursePronunciationError(404, "Bài tập này chưa có phần luyện phát âm")
    result = dict(rows[0])
    result["sentences"] = _json(result.get("sentences")) or []
    result["playback_rates"] = _json(result.get("playback_rates")) or [0.85, 1.0]
    return result


def _assignment_item(bank_id: str, user_id: str) -> dict:
    # Reuse the canonical live-assignment gate.  A saved URL must not keep
    # exposing course content after archive, deadline, or cohort transfer.
    item = quiz_service._assignment_item_for(bank_id, user_id)
    if not item:
        raise CoursePronunciationError(404, "Không tìm thấy bài tập")
    return item


def _public_set(row: dict) -> dict:
    sentences = []
    for sentence in row.get("sentences") or []:
        served = {
            "id": str(sentence.get("id") or ""),
            "order": int(sentence.get("order") or 0),
            "text": str(sentence.get("text") or ""),
        }
        path = str(sentence.get("audio_storage_path") or "").strip()
        if path:
            served["audio_url"] = (
                supabase_admin.storage.from_(VOCAB_AUDIO_BUCKET).get_public_url(path)
            )
        sentences.append(served)
    return {
        "id": row["id"],
        "bank_id": row["bank_id"],
        "title": row["title"],
        "playback_rates": row.get("playback_rates") or [0.85, 1.0],
        "sentences": sentences,
    }


def _public_attempt(row: dict | None) -> dict | None:
    if not row:
        return None
    results = _json(row.get("results")) or {}
    # Raw Azure payloads are persisted for audit/rebuild, not sent to the
    # browser.  The normalized sentence/batch contract is the learner surface.
    safe_results = {k: v for k, v in results.items() if k != "provider_payloads"}
    return {
        "id": row.get("id"),
        # The learner reuses this persisted key after a reload so a retry cannot
        # bypass the database idempotency constraint and spend another AI call.
        "client_id": row.get("client_id"),
        "status": row.get("status"),
        "batch_count": row.get("batch_count") or 0,
        "duration_sec": int(row.get("duration_sec") or 0),
        "pronunciation_score": row.get("pronunciation_score"),
        "accuracy_score": row.get("accuracy_score"),
        "fluency_score": row.get("fluency_score"),
        "completeness_score": row.get("completeness_score"),
        "results": safe_results,
        "error_message": row.get("error_message") if row.get("status") == "failed" else None,
        "graded_at": row.get("graded_at"),
        "created_at": row.get("created_at"),
    }


def get_state(*, user_id: str, bank_id: str) -> dict:
    _assignment_item(bank_id, user_id)
    exercise = _set_for_bank(bank_id)
    try:
        latest = (
            supabase_admin.table("course_pronunciation_submissions")
            .select("*")
            .eq("user_id", user_id)
            .eq("bank_id", bank_id)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[course-pronunciation] attempt lookup failed: %s", exc)
        raise CoursePronunciationError(500, "Không tải được kết quả phát âm") from exc
    return {"exercise": _public_set(exercise), "latest_attempt": _public_attempt(latest[0] if latest else None)}


def _decode_recording(recording: Recording, sentence: dict) -> DecodedRecording:
    try:
        # Reuse the bounded (30 s) ffmpeg path.  Pydub's generic decoder has no
        # subprocess timeout, which would let one malformed browser upload hold
        # a grading worker indefinitely.
        wav = azure_pronunciation._convert_to_wav(recording.data)
        if not wav:
            raise ValueError("ffmpeg could not decode browser audio")
        audio = AudioSegment.from_file(io.BytesIO(wav), format="wav")
    except Exception as exc:  # noqa: BLE001
        raise CoursePronunciationError(
            422, f"Không đọc được bản ghi của câu {sentence.get('order')}. Hãy thu lại câu này."
        ) from exc
    if len(audio) < 350:
        raise CoursePronunciationError(422, f"Bản ghi câu {sentence.get('order')} quá ngắn.")
    if len(audio) > MAX_CLIP_MS:
        raise CoursePronunciationError(
            422, f"Bản ghi câu {sentence.get('order')} dài quá 28 giây. Hãy thu lại ngắn hơn."
        )
    return DecodedRecording(sentence=sentence, audio=audio)


def _decode_all(recordings: list[Recording], sentences: list[dict]) -> list[DecodedRecording]:
    by_id = {recording.sentence_id: recording for recording in recordings}
    return [_decode_recording(by_id[str(sentence["id"])], sentence) for sentence in sentences]


def _pack_batches(decoded: list[DecodedRecording]) -> list[list[DecodedRecording]]:
    batches: list[list[DecodedRecording]] = []
    current: list[DecodedRecording] = []
    current_ms = 0
    for item in decoded:
        added = len(item.audio) + (SENTENCE_GAP_MS if current else 0)
        if current and (
            len(current) >= MAX_SENTENCES_PER_BATCH or current_ms + added > MAX_BATCH_MS
        ):
            batches.append(current)
            current = []
            current_ms = 0
            added = len(item.audio)
        current.append(item)
        current_ms += added
    if current:
        batches.append(current)
    return batches


def _batch_wav(batch: list[DecodedRecording]) -> bytes:
    combined = AudioSegment.empty()
    for index, item in enumerate(batch):
        if index:
            combined += AudioSegment.silent(duration=SENTENCE_GAP_MS, frame_rate=16_000)
        combined += item.audio
    out = io.BytesIO()
    combined.export(out, format="wav")
    return out.getvalue()


def _reference_text(text: str) -> str:
    return (
        unicodedata.normalize("NFKC", text)
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
        .strip()
    )


def _tokens(text: str) -> list[str]:
    return [_reference_text(match.group(0)).lower() for match in _WORD_RE.finditer(text or "")]


def _align_sentence_results(batch: list[DecodedRecording], provider: dict) -> list[dict]:
    expected: list[tuple[str, int, str]] = []
    for item in batch:
        for token in _tokens(str(item.sentence.get("text") or "")):
            expected.append((str(item.sentence["id"]), int(item.sentence["order"]), token))

    words = provider.get("words") or []
    observed = [_tokens(str(word.get("word") or "")) for word in words]
    observed_tokens = [parts[0] if parts else "" for parts in observed]
    aligned: list[dict] = [
        {"word": token, "accuracy_score": 0.0, "error_type": "Omission", "phonemes": []}
        for _sid, _order, token in expected
    ]
    inserted: list[dict] = []
    matcher = SequenceMatcher(
        a=[token for _sid, _order, token in expected],
        b=observed_tokens,
        autojunk=False,
    )
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            for left, right in zip(range(i1, i2), range(j1, j2)):
                aligned[left] = words[right]
        elif tag == "replace":
            for left, right in zip(range(i1, i2), range(j1, j2)):
                aligned[left] = words[right]
            for right in range(j1 + min(i2 - i1, j2 - j1), j2):
                inserted.append(words[right])
        elif tag == "insert":
            inserted.extend(words[j1:j2])

    output = []
    for item in batch:
        sid = str(item.sentence["id"])
        sentence_words = [
            dict(aligned[index])
            for index, (word_sid, _order, _token) in enumerate(expected)
            if word_sid == sid
        ]
        scores = [float(word.get("accuracy_score") or 0) for word in sentence_words]
        pronounced = sum(1 for word in sentence_words if word.get("error_type") != "Omission")
        weak = [
            word for word in sentence_words
            if float(word.get("accuracy_score") or 0) < WEAK_WORD_THRESHOLD
            or word.get("error_type") not in (None, "None")
        ]
        output.append({
            "id": sid,
            "order": int(item.sentence["order"]),
            "text": str(item.sentence["text"]),
            "accuracy_score": round(sum(scores) / len(scores), 1) if scores else None,
            "completeness_score": round(100 * pronounced / len(sentence_words), 1)
            if sentence_words else None,
            "words": sentence_words,
            "weak_words": weak,
            "duration_seconds": round(len(item.audio) / 1000, 1),
        })
    if inserted and output:
        output[-1]["insertions"] = inserted
    return output


def _weighted(providers: list[dict], batches: list[list[DecodedRecording]], key: str) -> float | None:
    weighted = []
    for provider, batch in zip(providers, batches):
        value = provider.get(key)
        if value is None:
            continue
        weight = sum(len(_tokens(str(item.sentence.get("text") or ""))) for item in batch)
        weighted.append((float(value), weight))
    total = sum(weight for _value, weight in weighted)
    return round(sum(value * weight for value, weight in weighted) / total, 1) if total else None


async def _grade_batches(
    batches: list[list[DecodedRecording]], *, locale: str,
) -> list[dict]:
    async def one(batch: list[DecodedRecording]) -> dict:
        reference = " ".join(_reference_text(str(item.sentence["text"])) for item in batch)
        return await azure_pronunciation.assess_pronunciation(
            audio_bytes=await asyncio.to_thread(_batch_wav, batch),
            content_type="audio/wav",
            locale=locale,
            reference_text=reference,
            enable_miscue=True,
            # bf_emma/en-GB must not silently request the paid, en-US-only add-on.
            enable_prosody=False,
        )

    return list(await asyncio.gather(*(one(batch) for batch in batches)))


def _existing_by_client(client_id: str, user_id: str) -> dict | None:
    try:
        rows = (
            supabase_admin.table("course_pronunciation_submissions")
            .select("*")
            .eq("client_id", client_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
            .data
            or []
        )
    except Exception as exc:  # noqa: BLE001
        raise CoursePronunciationError(500, "Không kiểm tra được trạng thái lượt nộp") from exc
    return rows[0] if rows else None


async def submit(
    *, user_id: str, bank_id: str, client_id: str, recordings: list[Recording],
    duration_sec: int = 0,
) -> dict:
    item = _assignment_item(bank_id, user_id)
    exercise = _set_for_bank(bank_id)
    sentences = sorted(exercise.get("sentences") or [], key=lambda row: int(row.get("order") or 0))
    if not sentences or len(sentences) > MAX_RECORDINGS:
        raise CoursePronunciationError(500, "Bộ câu phát âm chưa hợp lệ")

    expected = [str(sentence.get("id") or "") for sentence in sentences]
    received = [recording.sentence_id for recording in recordings]
    if len(received) != len(set(received)):
        raise CoursePronunciationError(422, "Có câu ghi âm bị gửi trùng")
    missing = [sid for sid in expected if sid not in received]
    extra = [sid for sid in received if sid not in expected]
    if missing or extra:
        raise CoursePronunciationError(422, f"Cần gửi đủ {len(expected)} câu theo đúng bộ đề")
    if sum(len(recording.data) for recording in recordings) > MAX_TOTAL_BYTES:
        raise CoursePronunciationError(413, "Tổng dung lượng ghi âm quá lớn")

    existing = _existing_by_client(client_id, user_id)
    if existing:
        if existing.get("bank_id") != bank_id:
            raise CoursePronunciationError(409, "Mã lượt nộp đã được dùng cho bài khác")
        if existing.get("status") == "completed":
            return _public_attempt(existing) or {}
        if existing.get("status") == "processing":
            raise CoursePronunciationError(409, "Lượt nộp này đang được chấm")

    try:
        decoded = await asyncio.to_thread(_decode_all, recordings, sentences)
        batches = _pack_batches(decoded)
    except CoursePronunciationError:
        raise

    snapshot = {
        "exercise_title": exercise["title"],
        "sentences": [{"id": row["id"], "order": row["order"], "text": row["text"]}
                      for row in sentences],
    }
    pending = {
        "client_id": client_id,
        "set_id": exercise["id"],
        "bank_id": bank_id,
        "user_id": user_id,
        "class_assignment_item_id": item.get("id"),
        "status": "processing",
        "provider": exercise["provider"],
        "locale": exercise["locale"],
        "voice": exercise["voice"],
        "batch_count": len(batches),
        "duration_sec": max(0, min(int(duration_sec or 0), 12 * 60 * 60)),
        "results": snapshot,
        "error_message": None,
        "updated_at": _now(),
    }
    try:
        if existing:
            saved = (
                supabase_admin.table("course_pronunciation_submissions")
                .update(pending)
                .eq("id", existing["id"])
                .eq("user_id", user_id)
                # Compare-and-set: two retries of the same failed client_id must
                # not both spend four Azure calls.
                .eq("status", "failed")
                .execute()
                .data
                or []
            )
            if not saved:
                raced = _existing_by_client(client_id, user_id)
                if raced and raced.get("status") == "completed":
                    return _public_attempt(raced) or {}
                raise CoursePronunciationError(409, "Lượt nộp này đang được chấm")
            saved = saved[0]
        else:
            saved = (
                supabase_admin.table("course_pronunciation_submissions")
                .insert(pending)
                .execute()
                .data
                or []
            )[0]
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, CoursePronunciationError):
            raise
        raced = _existing_by_client(client_id, user_id)
        if raced and raced.get("status") == "completed":
            return _public_attempt(raced) or {}
        if raced and raced.get("status") == "processing":
            raise CoursePronunciationError(409, "Lượt nộp này đang được chấm") from exc
        raise CoursePronunciationError(500, "Không khởi tạo được lượt chấm") from exc

    try:
        providers = await _grade_batches(batches, locale=str(exercise["locale"]))
        sentence_results = []
        for batch, provider in zip(batches, providers):
            sentence_results.extend(_align_sentence_results(batch, provider))
        results = {
            **snapshot,
            "sentences": sentence_results,
            "batch_summaries": [
                {
                    "sentence_ids": [str(item.sentence["id"]) for item in batch],
                    "pronunciation_score": provider.get("pronunciation_score"),
                    "accuracy_score": provider.get("accuracy_score"),
                    "fluency_score": provider.get("fluency_score"),
                    "completeness_score": provider.get("completeness_score"),
                    "short_summary": provider.get("short_summary") or [],
                }
                for batch, provider in zip(batches, providers)
            ],
            "provider_payloads": [provider.get("raw_payload") or {} for provider in providers],
        }
        finished = {
            "status": "completed",
            "pronunciation_score": _weighted(providers, batches, "pronunciation_score"),
            "accuracy_score": _weighted(providers, batches, "accuracy_score"),
            "fluency_score": _weighted(providers, batches, "fluency_score"),
            "completeness_score": _weighted(providers, batches, "completeness_score"),
            "results": results,
            "error_message": None,
            "graded_at": _now(),
            "updated_at": _now(),
        }
        rows = (
            supabase_admin.table("course_pronunciation_submissions")
            .update(finished)
            .eq("id", saved["id"])
            .eq("user_id", user_id)
            .execute()
            .data
            or []
        )
        if not rows:
            raise RuntimeError("submission update returned no row")
        public = _public_attempt(rows[0]) or {}
    except Exception as exc:  # noqa: BLE001
        logger.exception("[course-pronunciation] grading failed submission=%s", saved.get("id"))
        try:
            supabase_admin.table("course_pronunciation_submissions").update({
                "status": "failed",
                "error_message": "Chưa chấm được audio. Có thể gửi lại cùng lượt mà không cần thu lại.",
                "updated_at": _now(),
            }).eq("id", saved["id"]).eq("user_id", user_id).execute()
        except Exception as persist_exc:  # noqa: BLE001
            logger.warning("[course-pronunciation] failed-state write failed: %s", persist_exc)
        raise CoursePronunciationError(502, "Dịch vụ chấm phát âm tạm thời chưa phản hồi") from exc

    # Kết quả Azure đã lưu là bất biến. Lỗi cập nhật checklist không được đổi
    # nó thành một submission `failed` rồi tốn thêm tiền chấm ở lần retry.
    try:
        public["course"] = quiz_service.refresh_course_completion(
            user_id=user_id, bank_id=bank_id, item_id=item["id"],
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("[course-pronunciation] completion refresh failed item=%s: %s",
                       item.get("id"), exc)
        public["completion_pending"] = True
    return public
