"""services/speaking_question_audio.py — bản đọc đề Speaking (Part 1 & Part 3).

Part 1 và Part 3 được giao BẰNG AUDIO và học viên không được xem chữ: phải nghe
mới biết đề hỏi gì, đúng như phòng thi. Module này dựng câu đọc và render nó.

VÌ SAO KHÔNG ĐỌC TRỐNG MỖI CÂU HỎI. Trong phòng thi, giám khảo không bắn thẳng
một câu hỏi trần: họ nói phần nào, nêu chủ đề, rồi mới hỏi. Người học nghe quen
lời dẫn đó sẽ nhận ra nhịp của bài thi, còn nghe một câu trơ trọi thì không.
Cho nên câu đọc theo đúng khuôn:

    This is Part 1. Let's talk about your hometown. Question: Where do you live?

Part 2 KHÔNG có ở đây — phần đó là cue card, học viên đọc bằng mắt và có một phút
chuẩn bị. Đọc to một cue card sẽ lấy mất chính việc mà phần thi ấy đang kiểm tra.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

from services import tts_audio

logger = logging.getLogger(__name__)

# Chỉ hai phần này giao bằng audio.
AUDIO_PARTS = (1, 3)

ENGINE = "kokoro"
VOICE = tts_audio.KOKORO_DEFAULT_VOICE


def _spoken_topic(title: str) -> str:
    """Tên chủ đề đưa vào câu dẫn "Let's talk about …".

    Bank titles are written to be READ in a list ("Animals and pets", "Daily
    routine"), not to be SPOKEN mid-sentence. Lower-casing them is what turns a
    heading into speech: "Let's talk about Daily routine" lands as a label being
    announced, "let's talk about daily routine" as a person talking.

    Acronyms and proper nouns keep their case — lower-casing "IELTS" or "London"
    would change how the voice pronounces them.
    """
    words = []
    for w in (title or "").strip().split():
        if w.isupper() or (w[:1].isupper() and w[1:2].isupper()):
            words.append(w)                      # IELTS, TV, UK
        elif w[:1].isupper() and w.lower() in _COMMON_LOWER:
            words.append(w.lower())
        else:
            words.append(w)
    return " ".join(words) or "this topic"


# Ordinary nouns that begin a bank title only because it is a heading. Anything
# not listed keeps its capital, so proper nouns are never damaged.
_COMMON_LOWER = {
    "advertisements", "animals", "borrowing", "buildings", "cash", "chatting",
    "childhood", "crowded", "daily", "days", "doing", "dream", "family",
    "food", "friends", "hobbies", "holidays", "hometown", "housework", "music",
    "neighbours", "news", "reading", "shopping", "sleep", "sport", "study",
    "technology", "transport", "travel", "weather", "weekends", "work",
}


def build_script(*, part: int, topic_title: str, question_text: str) -> str:
    """Câu đọc đầy đủ cho MỘT câu hỏi, theo khuôn phòng thi.

    Raises ValueError for Part 2: that part is a cue card, and reading it aloud
    removes the reading-and-planning the part exists to test.
    """
    if part not in AUDIO_PARTS:
        raise ValueError(
            f"Part {part} không giao bằng audio. Part 2 là cue card — học viên "
            f"đọc bằng mắt và có một phút chuẩn bị."
        )
    q = (question_text or "").strip()
    if not q:
        raise ValueError("Câu hỏi rỗng — không dựng được bản đọc.")
    # Ensure the question ends as a spoken sentence: without final punctuation
    # the voice runs the last word flat into silence.
    if q[-1] not in ".?!":
        q += "?"
    lead_in = "Let's talk about" if part == 1 else "Now let's discuss"
    return (
        f"This is Part {part}. "
        f"{lead_in} {_spoken_topic(topic_title)}. "
        f"Question: {q}"
    )


_WS = re.compile(r"\s+")


def script_fingerprint(script: str) -> str:
    """Chuẩn hoá khoảng trắng trước khi băm.

    The object key is derived from the script text, so a stray double space would
    otherwise render an identical-sounding clip at a brand-new path and leave the
    old one orphaned in the bucket.
    """
    return _WS.sub(" ", (script or "").strip())


def render_question_audio(
    question: Dict[str, Any],
    topic_title: str,
    *,
    engine: str = ENGINE,
    voice: str = VOICE,
) -> Optional[Dict[str, str]]:
    """Render bản đọc cho một câu, trả về {audio_path, audio_url} — hoặc None
    nếu câu này không thuộc phần giao bằng audio.

    Idempotent: the object key is the hash of (script, voice, engine), so a
    re-run over the whole bank re-uploads nothing and costs nothing. Editing a
    question's wording changes the hash, so its audio is re-rendered while every
    other clip is skipped.
    """
    part = question.get("part")
    if part not in AUDIO_PARTS:
        return None

    script = script_fingerprint(
        build_script(part=part, topic_title=topic_title,
                     question_text=question.get("question_text") or "")
    )
    path = tts_audio.audio_path(script, voice, engine)
    if tts_audio.audio_exists(path):
        return {"audio_path": path, "audio_url": tts_audio.public_url(path),
                "script": script, "synthesized": False}

    data = tts_audio.synth_sync(script, engine=engine, voice=voice)
    data = tts_audio.pad_silence_mp3(data)
    tts_audio.upload_mp3(path, data)
    return {"audio_path": path, "audio_url": tts_audio.public_url(path),
            "script": script, "synthesized": True}
