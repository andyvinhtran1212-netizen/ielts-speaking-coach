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


def test_inline_reading_preserves_a_structure_multiple_choice_question():
    shared = {
        "title": "NHÓM NGHIÊN CỨU", "focus": "hoà hợp chủ vị",
        "passage": "The scientists measure the air.",
        "translation": "Các nhà khoa học đo không khí.",
        "vocabulary": [{"tu": "measure", "loai": "v", "nghia": "đo"}],
    }
    rows = [
        _row("TM20-B09-DOC-R01", "course_reading", "READ-CONTENT", 100,
             prompt="The scientists measure the air.", options=["T", "F", "NG"],
             answer=0, explain="Đúng.",
             segments={"section": "content", "shared": shared}),
        _row("TM20-B09-DOC-R02", "course_reading", "READ-STRUCTURE", 101,
             prompt="Vì sao dùng measure?", options=["Chủ ngữ số nhiều", "Số ít"],
             answer=0, explain="Scientists là số nhiều.",
             segments={"section": "structure"}),
    ]

    result = repair.reading_meta(rows)

    question = result["question_groups"][1]["questions"][0]
    assert question == {
        "id": "TM20-B09-DOC-02", "number": 2,
        "prompt": "Vì sao dùng measure?", "input_type": "choice",
        "options": ["Chủ ngữ số nhiều", "Số ít"],
    }
    assert result["answers"][1]["answer"] == "Chủ ngữ số nhiều"


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


def test_reopened_item_state_matches_the_submitted_at_constraint():
    item = {"opened_at": "2026-08-24T01:00:00+00:00"}

    patch = repair.reopened_item_patch(item, {"attempts": []})

    assert patch["state"] == "opened"
    assert patch["submitted_at"] is None
    assert patch["passed_at"] is None
    assert patch["artifact_kind"] is None
    assert patch["artifact_id"] is None


def _tfng_rows(answer):
    shared = {
        "title": "T", "focus": "F", "passage": "The library is near the gate.",
        "translation": "Thư viện.", "vocabulary": [{"tu": "gate", "loai": "n", "nghia": "cổng"}],
    }
    return [
        _row("TM20-B06-DOC-R01", "course_reading", "READ-CONTENT", 100,
             prompt="P", options=["T", "F", "NG"], answer=answer, explain="E",
             segments={"section": "content", "shared": shared}),
        _row("TM20-B06-DOC-R02", "course_reading", "READ-STRUCTURE", 101,
             prompt="P2", accept=["near"], explain="E2",
             segments={"section": "structure"}),
    ]


import pytest  # noqa: E402


@pytest.mark.parametrize("bad", [-1, True, False, 3])
def test_tfng_answer_outside_0_to_2_or_bool_is_rejected(bad):
    # Báo cáo săn lỗi #48: -1 từng thành "NG", True thành "F".
    with pytest.raises(ValueError, match="T/F/NG"):
        repair.reading_meta(_tfng_rows(bad))


@pytest.mark.parametrize("good,letter", [(0, "T"), (1, "F"), (2, "NG")])
def test_tfng_valid_answers_still_map(good, letter):
    assert repair.reading_meta(_tfng_rows(good))["answers"][0]["answer"] == letter


def _two_section_mastery(completed):
    return {"attempts": [{
        "phase": "run", "completed": completed,
        "sections": {"quiz": {"completed": True, "pct": 80.0}},
    }]}


def test_in_progress_item_is_not_reopened():
    # Báo cáo săn lỗi #53: item đang làm dở bị chèn lượt mới và xoá điểm.
    item = {"id": "i", "state": "opened", "submitted_at": None,
            "mastery": _two_section_mastery(False)}
    assert repair.item_needs_reopen(item) is False


@pytest.mark.parametrize("extra", [
    {"state": "submitted", "submitted_at": "2026-08-24T01:00:00+00:00"},
    {"state": "graded", "submitted_at": "2026-08-24T01:00:00+00:00"},
])
def test_submitted_item_is_reopened(extra):
    item = {"id": "i", "mastery": _two_section_mastery(True), **extra}
    assert repair.item_needs_reopen(item) is True


def test_already_repaired_item_is_skipped():
    mastery = _two_section_mastery(True)
    mastery["attempts"][-1]["repair_reason"] = repair.REPAIR_REASON
    assert repair.item_needs_reopen({"state": "submitted", "mastery": mastery}) is False
