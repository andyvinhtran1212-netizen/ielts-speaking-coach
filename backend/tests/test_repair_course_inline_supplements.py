from scripts import repair_course_inline_supplements as repair


def _row(qid, qtype, subtype, order, **extra):
    return {
        "qid": qid, "type": qtype, "subtype": subtype, "order": order,
        **extra,
    }


def test_inline_reading_becomes_answer_protected_bank_metadata():
    shared = {
        "title": "BẢN ĐỒ KHUÔN VIÊN TRƯỜNG",
        "focus": "giới từ & nở cụm danh từ",
        "passage": "The library is near the gate.",
        "translation": "Thư viện ở gần cổng.",
        "vocabulary": [{"tu": "gate", "loai": "n", "nghia": "cổng"}],
    }
    rows = [
        _row("TM20-B06-DOC-R01", "course_reading", "READ-CONTENT", 100,
             prompt="The library is near the gate.", options=["T", "F", "NG"],
             answer=0, explain="Đúng nguyên văn.",
             segments={"section": "content", "shared": shared}),
        _row("TM20-B06-DOC-R02", "course_reading", "READ-STRUCTURE", 101,
             prompt="Điền giới từ.", accept=["near"], explain="Dùng near.",
             segments={"section": "structure"}),
    ]

    result = repair.reading_meta(rows)

    assert result["id"] == "TM20-B06-DOC"
    assert result["word_count"] == 6
    assert result["vocabulary"] == [
        {"term": "gate", "part_of_speech": "n", "meaning": "cổng"}]
    assert [row["answer"] for row in result["answers"]] == ["T", "near"]
    assert [group["input_type"] for group in result["question_groups"]] == [
        "tfng", "short_text"]


def test_inline_listening_reuses_private_audio_paths_and_builds_solution():
    rows = []
    for order, label in enumerate("ABC", 110):
        rows.append(_row(
            f"TM20-B06-NGHE-{label}01", "course_listening", f"LISTEN-{label}",
            order, prompt="Nghe và chọn.", options=["one", "two"], answer=1,
            explain="Bạn nghe được: two",
            segments={"section": label, "course_audio_path": f"course/b06/{label}.mp3"},
        ))
    rows.append(_row(
        "TM20-B06-NGHE-D01", "course_listening", "LISTEN-D", 113,
        prompt="The gate is open.", options=["T", "F", "NG"], answer=0,
        explain="Đáp án: T.", segments={
            "section": "D", "course_audio_path": "course/b06/D.mp3",
            "shared": {"transcript": "The gate is open.",
                       "translation": "Cổng đang mở."},
        },
    ))

    result = repair.listening_meta(rows, title="Khuôn viên", focus="giới từ")

    assert result["id"] == "TM20-B06-NGHE"
    assert result["sections"][0]["questions"][0]["audio_storage_path"] == (
        "course/b06/A.mp3")
    assert result["sections"][3]["audio_storage_path"] == "course/b06/D.mp3"
    assert [row["answer"] for row in result["solution"]["answers"]] == [
        "B", "B", "B", "T"]
    assert result["solution"]["answers"][0]["transcript"] == "two"


def test_pronunciation_rows_must_match_manifest_and_keep_cached_audio_paths():
    rows = [_row(
        "TM20-B06-PHAT-AM-P01", "course_pronunciation", "PRON-SENTENCE", 130,
        prompt="The gate is open.",
        audio_url=("https://example.supabase.co/storage/v1/object/public/"
                   "vocab-audio/hash.mp3"),
    )]
    manifest = {
        "title": "Phát âm", "locale": "en-GB", "provider": "azure",
        "voice_engine": "kokoro", "voice": "bf_emma",
        "playback_rates": [0.85, 1.0],
        "sentences": [{"id": "C1-B06-PRON-01", "order": 1,
                       "text": "The gate is open."}],
    }

    payload, requirement = repair.pronunciation_payload(
        rows, manifest, bank_id="bank-6")

    assert payload["sentences"][0]["audio_storage_path"] == "hash.mp3"
    assert payload["content_hash"] == requirement["content_hash"]
    assert requirement["id"] == "TM20-B06-PHAT-AM"


def test_completed_two_section_ledger_reopens_as_a_carried_continuation():
    item = {"id": "item-1", "mastery": {"attempts": [{
        "phase": "run", "pct": 81.0, "completed": True,
        "sections": {
            "quiz": {"completed": True, "pct": 82.0, "duration_sec": 100},
            "writing": {"completed": True, "pct": 80.0, "duration_sec": 50},
        },
    }]}}
    weights = {"quiz": 41.69, "writing": 13.52, "reading": 13.52,
               "listening": 17.04, "pronunciation": 14.23}

    result = repair.continued_mastery(item, weights, writing_attempt=2)

    assert result["attempts"][0]["completed"] is True
    continuation = result["attempts"][1]
    assert continuation["completed"] is False
    assert continuation["attempt_no"] == 2
    assert set(continuation["sections"]) == {"quiz", "writing"}
    assert continuation["sections"]["quiz"]["carried"] is True
    assert continuation["sections"]["quiz"]["weight"] == 41.69
    assert result["active_section_attempt_no"] == 2
