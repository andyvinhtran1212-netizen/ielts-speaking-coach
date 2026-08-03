"""Bản đọc đề Speaking — câu dẫn theo khuôn phòng thi.

Học viên KHÔNG được xem chữ ở Part 1 và Part 3, nên đoạn audio này là toàn bộ
những gì họ có. Nó phải nghe ra như giám khảo nói, không phải như một câu hỏi
bị bắn ra trơ trọi — người nghe quen lời dẫn ấy sẽ nhận ra nhịp bài thi.
"""

from __future__ import annotations

import pytest

from services import speaking_question_audio as mod


def test_the_script_follows_the_exam_wording():
    s = mod.build_script(part=1, topic_title="Hometown",
                         question_text="Where do you live")
    assert s == "This is Part 1. Let's talk about hometown. Question: Where do you live?"


def test_part_3_uses_the_discussion_lead_in():
    """Part 3 không phải màn khởi động — lời dẫn phải báo đúng chuyển cảnh đó."""
    s = mod.build_script(part=3, topic_title="Technology",
                         question_text="How has technology changed families?")
    assert s.startswith("This is Part 3. Now let's discuss technology.")


def test_a_question_missing_its_final_punctuation_still_ends_as_a_sentence():
    """Thiếu dấu cuối thì giọng đọc chạy tuột chữ cuối vào khoảng lặng."""
    s = mod.build_script(part=1, topic_title="Food", question_text="Do you cook")
    assert s.endswith("Do you cook?")


def test_existing_punctuation_is_not_doubled():
    s = mod.build_script(part=1, topic_title="Food", question_text="Do you cook?")
    assert s.endswith("Do you cook?") and "??" not in s


def test_every_real_heading_becomes_speech():
    """HẠ TẤT CẢ, TRỪ NGOẠI LỆ — không phải ngược lại.

    Bản đầu dùng danh sách từ-được-phép-hạ và sai 3 trong 5 tiêu đề mẫu đầu tiên
    của mẻ render thật. Danh sách kiểu đó không bao giờ đuổi kịp nội dung; đây là
    những tiêu đề CÓ THẬT trong kho đã làm nó trượt."""
    for title, spoken in [
        ("Daily routine", "daily routine"),
        ("Going out", "going out"),
        ("Having a break", "having a break"),
        ("Fruits and vegetables", "fruits and vegetables"),
        ("Dream job & Future plans", "dream job and future plans"),
    ]:
        assert f"Let's talk about {spoken}." in mod.build_script(
            part=1, topic_title=title, question_text="q?"), title


def test_an_ampersand_is_spoken_as_a_word():
    """"&" không phải một từ; để nguyên là phó mặc engine đoán."""
    s = mod.build_script(part=1, topic_title="Views & Scenery", question_text="q?")
    assert "views and scenery" in s and "&" not in s


def test_acronyms_keep_their_case():
    """Hạ 'IELTS' hay 'TV' sẽ đổi cách giọng đọc phát âm."""
    for keep in ("IELTS", "TV", "UK"):
        assert keep in mod.build_script(part=1, topic_title=keep, question_text="q?")


def test_a_proper_noun_can_be_protected_when_the_bank_gains_one():
    """Hôm nay `_KEEP_CASE` rỗng vì 38 tiêu đề Part 1/3 đều là tiêu đề thường.
    Cơ chế phải sẵn ở đó để lần thêm là một dòng, không phải một cuộc điều tra."""
    mod._KEEP_CASE.add("London")
    try:
        assert "about London." in mod.build_script(
            part=1, topic_title="London", question_text="q?")
    finally:
        mod._KEEP_CASE.discard("London")


def test_part_2_is_refused_because_it_is_a_cue_card():
    """Đọc to một cue card lấy mất chính việc phần thi ấy đang kiểm tra: đọc đề
    và tự lập dàn ý trong một phút."""
    with pytest.raises(ValueError) as exc:
        mod.build_script(part=2, topic_title="A trip", question_text="Describe a trip")
    assert "cue card" in str(exc.value)


def test_an_empty_question_is_refused():
    with pytest.raises(ValueError):
        mod.build_script(part=1, topic_title="Food", question_text="   ")


def test_whitespace_does_not_change_the_object_key():
    """Khoá lưu trữ băm từ câu đọc, nên một dấu cách thừa sẽ render ra một file
    nghe y hệt ở đường MỚI và bỏ lại file cũ mồ côi trong bucket."""
    a = mod.script_fingerprint("This is  Part 1.\n Question: x?")
    b = mod.script_fingerprint("This is Part 1. Question: x?")
    assert a == b


def test_rendering_skips_part_2_entirely():
    assert mod.render_question_audio({"part": 2, "question_text": "x"}, "T") is None


def test_rendering_is_idempotent_when_the_clip_already_exists(monkeypatch):
    """Chạy lại trên cả kho phải KHÔNG upload lại gì: giá của việc render lại là
    thời gian và tiền, và mỗi lần upload thừa là một cơ hội ghi đè."""
    calls = {"synth": 0, "upload": 0}
    monkeypatch.setattr(mod.tts_audio, "audio_exists", lambda _p: True)
    monkeypatch.setattr(mod.tts_audio, "public_url", lambda p: f"https://cdn/{p}")
    monkeypatch.setattr(mod.tts_audio, "synth_sync",
                        lambda *a, **k: calls.__setitem__("synth", calls["synth"] + 1))
    monkeypatch.setattr(mod.tts_audio, "upload_mp3",
                        lambda *a: calls.__setitem__("upload", calls["upload"] + 1))

    out = mod.render_question_audio(
        {"part": 1, "question_text": "Where do you live?"}, "Hometown")
    assert out["synthesized"] is False
    assert calls == {"synth": 0, "upload": 0}


def test_editing_a_question_moves_it_to_a_new_key(monkeypatch):
    """Sửa lời câu hỏi phải render lại ĐÚNG câu đó, các câu khác không đụng tới."""
    monkeypatch.setattr(mod.tts_audio, "audio_exists", lambda _p: False)
    monkeypatch.setattr(mod.tts_audio, "public_url", lambda p: f"https://cdn/{p}")
    monkeypatch.setattr(mod.tts_audio, "synth_sync", lambda *a, **k: b"\x00")
    monkeypatch.setattr(mod.tts_audio, "pad_silence_mp3", lambda d: d)
    monkeypatch.setattr(mod.tts_audio, "upload_mp3", lambda *a: None)

    a = mod.render_question_audio({"part": 1, "question_text": "Where do you live?"}, "Hometown")
    b = mod.render_question_audio({"part": 1, "question_text": "Where do you work?"}, "Hometown")
    assert a["audio_path"] != b["audio_path"]


def test_the_topic_is_part_of_the_key_too(monkeypatch):
    """Cùng một câu hỏi dưới hai chủ đề khác nhau có câu dẫn khác nhau, nên phải
    là hai file — dùng chung sẽ đọc sai tên chủ đề."""
    monkeypatch.setattr(mod.tts_audio, "audio_exists", lambda _p: False)
    monkeypatch.setattr(mod.tts_audio, "public_url", lambda p: f"https://cdn/{p}")
    monkeypatch.setattr(mod.tts_audio, "synth_sync", lambda *a, **k: b"\x00")
    monkeypatch.setattr(mod.tts_audio, "pad_silence_mp3", lambda d: d)
    monkeypatch.setattr(mod.tts_audio, "upload_mp3", lambda *a: None)

    q = {"part": 1, "question_text": "Do you like it?"}
    assert (mod.render_question_audio(q, "Music")["audio_path"]
            != mod.render_question_audio(q, "Sport")["audio_path"])


def test_kokoro_is_the_engine_and_the_voice_is_british():
    """Giọng Mỹ dạy sai đích nghe: bài thi IELTS đọc bằng giọng Anh."""
    assert mod.ENGINE == "kokoro"
    assert mod.VOICE.startswith("b"), "voice id bắt đầu bằng 'b' = British English"


def test_a_missing_kokoro_package_says_so_instead_of_switching_voice():
    """Rơi thầm sang engine khác sẽ trộn hai giọng trong cùng một đề thi —
    không ai nhìn ra."""
    from services import tts_audio
    import builtins

    real_import = builtins.__import__

    def _no_kokoro(name, *a, **k):
        if name == "kokoro":
            raise ImportError("no kokoro")
        return real_import(name, *a, **k)

    builtins.__import__ = _no_kokoro
    try:
        with pytest.raises(RuntimeError) as exc:
            tts_audio.synth_sync("x", engine="kokoro")
    finally:
        builtins.__import__ = real_import
    assert "kokoro" in str(exc.value).lower()
    assert "pip install" in str(exc.value)
