"""Canonical pronunciation content for Course 1, lesson 6."""

from pathlib import Path

from scripts.import_course_exercise_bank import _pronunciation_meta
from scripts.setup_course_pronunciation import _load


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "data" / "course_pronunciation" / "C1-B06.json"


def test_b06_has_the_requested_twelve_renumbered_kokoro_sentences():
    data, content_hash = _load(CONTENT)
    assert data["bank_code"] == "C1-B06"
    assert data["locale"] == "en-GB"
    assert (data["voice_engine"], data["voice"]) == ("kokoro", "bf_emma")
    assert [row["order"] for row in data["sentences"]] == list(range(1, 13))
    assert [row["id"] for row in data["sentences"]] == [
        f"C1-B06-PRON-{number:02d}" for number in range(1, 13)
    ]
    assert data["sentences"][0]["text"] == (
        "My uncle works at a small clinic near the market."
    )
    assert data["sentences"][-1]["text"] == (
        "Owing to rising fuel prices, many young workers in the city now choose "
        "cheaper motorbikes."
    )
    assert len(content_hash) == 64


def test_import_requirement_and_registered_set_use_the_same_content_hash():
    data, registered_hash = _load(CONTENT)
    requirement = _pronunciation_meta({
        "id": "TM20-B06-PHAT-AM",
        "vai_tro": "bài luyện phát âm — nghe và nhắc lại",
        "lang": data["locale"],
        "voice_engine": data["voice_engine"],
        "voice": data["voice"],
        "sentences": [
            {"so": sentence["order"], "text": sentence["text"]}
            for sentence in data["sentences"]
        ],
    })
    assert requirement["content_hash"] == registered_hash
