"""Canonical pronunciation content for Course 1, lesson 9."""

from pathlib import Path

from scripts.import_course_exercise_bank import _pronunciation_meta
from scripts.setup_course_pronunciation import _load


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "data" / "course_pronunciation" / "C1-B09.json"


def test_b09_has_fifteen_medium_length_kokoro_sentences():
    data, content_hash = _load(CONTENT)
    assert data["bank_code"] == "C1-B09"
    assert data["locale"] == "en-GB"
    assert (data["voice_engine"], data["voice"]) == ("kokoro", "bf_emma")
    assert [row["order"] for row in data["sentences"]] == list(range(1, 16))
    assert [row["id"] for row in data["sentences"]] == [
        f"C1-B09-PRON-{number:02d}" for number in range(1, 16)
    ]
    word_counts = [len(row["text"].split()) for row in data["sentences"]]
    assert min(word_counts) >= 11
    assert max(word_counts) <= 18
    assert 13 <= sum(word_counts) / len(word_counts) <= 15
    assert len(content_hash) == 64


def test_b09_import_requirement_matches_the_registered_set_hash():
    data, registered_hash = _load(CONTENT)
    requirement = _pronunciation_meta({
        "id": "TM20-B09-PHAT-AM",
        "vai_tro": "bài luyện phát âm — nghe và nhắc lại",
        "lang": data["locale"],
        "voice_engine": data["voice_engine"],
        "voice": data["voice"],
        "sentences": [
            {"so": sentence["order"], "text": sentence["text"]}
            for sentence in data["sentences"]
        ],
    })
    assert requirement["sentence_count"] == 15
    assert requirement["content_hash"] == registered_hash
