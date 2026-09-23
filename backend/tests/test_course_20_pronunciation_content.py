"""Canonical pronunciation coverage for all 20 Course 1 lessons."""

from __future__ import annotations

import json
import re
from pathlib import Path

from scripts.setup_course_pronunciation import _load


ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / "data" / "course_pronunciation"
SOURCE_DOCUMENT = "Giao-trinh-ngu-phap-nen-IELTS_20-buoi-v2.docx"
WORD_RE = re.compile(r"[A-Za-z]+(?:[’'][A-Za-z]+)?|[0-9]+")


def test_all_twenty_lessons_have_exactly_fifteen_medium_length_sentences():
    manifests = sorted(CONTENT.glob("C1-B*.json"))
    assert [path.stem for path in manifests] == [
        f"C1-B{lesson:02d}" for lesson in range(1, 21)
    ]

    all_texts: set[str] = set()
    for lesson, path in enumerate(manifests, 1):
        data, content_hash = _load(path)
        sentences = data["sentences"]

        assert data["bank_code"] == f"C1-B{lesson:02d}"
        assert data["requirement_id"] == f"TM20-B{lesson:02d}-PHAT-AM"
        assert data["role"] == "bài luyện phát âm — nghe và nhắc lại"
        assert data["source_document"] == SOURCE_DOCUMENT
        assert data["selection_seed"] == 20260914
        assert len(sentences) == 15
        assert [row["order"] for row in sentences] == list(range(1, 16))
        assert len({row["id"] for row in sentences}) == 15
        assert all(
            re.fullmatch(
                rf"C1-B{lesson:02d}-PRON-V\d+-{order:02d}", row["id"]
            )
            for order, row in enumerate(sentences, 1)
        )

        word_counts = [len(WORD_RE.findall(row["text"])) for row in sentences]
        assert min(word_counts) >= 7
        assert max(word_counts) <= 23
        assert 7 <= sum(word_counts) / len(word_counts) <= 14
        assert len({row["source_section"] for row in sentences}) >= 5
        assert len(content_hash) == 64

        lesson_texts = {row["text"] for row in sentences}
        assert len(lesson_texts) == 15
        assert all(not re.search(r"\d", text) for text in lesson_texts)
        assert all_texts.isdisjoint(lesson_texts)
        all_texts.update(lesson_texts)


def test_manifest_payloads_do_not_store_runtime_audio_paths():
    """Content-addressed audio paths are added only after Kokoro succeeds."""
    for path in sorted(CONTENT.glob("C1-B*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        assert all("audio_storage_path" not in row for row in data["sentences"])


def test_b12_revision_uses_v2_ids_to_invalidate_cached_v1_recordings():
    data = json.loads((CONTENT / "C1-B12.json").read_text(encoding="utf-8"))
    assert [row["id"] for row in data["sentences"]] == [
        f"C1-B12-PRON-V2-{order:02d}" for order in range(1, 16)
    ]
