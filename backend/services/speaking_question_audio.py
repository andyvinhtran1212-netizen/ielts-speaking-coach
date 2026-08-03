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

    Tiêu đề trong kho được viết để ĐỌC TRONG DANH SÁCH ("Daily routine",
    "Going out"), không phải để NÓI giữa câu. Hạ chữ hoa là thứ biến một tiêu đề
    thành lời nói: "Let's talk about Going out" nghe như đang xướng một nhãn,
    "let's talk about going out" nghe như một người đang nói chuyện.

    HẠ TẤT CẢ, TRỪ NGOẠI LỆ — không phải ngược lại. Bản đầu dùng một danh sách
    từ-được-phép-hạ và sai 3 trong 5 tiêu đề mẫu đầu tiên ("Going out",
    "Having a break", "Fruits and vegetables"), vì danh sách ấy không bao giờ
    đuổi kịp nội dung. Đã soi cả 38 tiêu đề Part 1/3 đang có: KHÔNG cái nào chứa
    danh từ riêng, và chữ hoa giữa dòng chỉ xuất hiện sau dấu "&".

    Giữ nguyên chữ HOA TOÀN BỘ (IELTS, TV, UK) — hạ chúng sẽ đổi cách giọng đọc
    phát âm. `_KEEP_CASE` để dành cho danh từ riêng nếu kho đề có thêm sau này;
    hôm nay nó rỗng, và nói rõ như vậy tốt hơn là giả vờ đã lo liệu.

    "&" đọc thành "and": ký tự đó không phải một từ, và để nguyên là phó mặc cho
    engine đoán.
    """
    words = []
    for w in (title or "").strip().split():
        if w == "&":
            words.append("and")
        elif len(w) > 1 and w.isupper():        # IELTS, TV, UK
            words.append(w)
        elif w in _KEEP_CASE:
            words.append(w)
        else:
            words.append(w.lower())
    return " ".join(words) or "this topic"


# Danh từ riêng cần giữ chữ hoa. Rỗng hôm nay — 38 tiêu đề Part 1/3 hiện có đều
# là tiêu đề thường. Thêm vào đây khi kho đề có "London", "Tết"…
_KEEP_CASE: set[str] = set()


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
