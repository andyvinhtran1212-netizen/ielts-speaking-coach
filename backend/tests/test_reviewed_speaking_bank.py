from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.build_reviewed_speaking_bank import (  # noqa: E402
    PROMPTS, REVIEWED, SOURCE, build_reviewed_bank, read_prompts,
)
from scripts.import_speaking_bank_admin import import_bank  # noqa: E402
from test_import_speaking_bank_admin import _Session  # noqa: E402


def test_reviewed_manifest_covers_every_part_one_and_three_topic():
    source = json.loads(SOURCE.read_text(encoding="utf-8"))
    saved = json.loads(REVIEWED.read_text(encoding="utf-8"))
    rebuilt = build_reviewed_bank(source, read_prompts(PROMPTS[1]), read_prompts(PROMPTS[3]))

    assert saved == rebuilt
    assert len(saved["topics"]) == 126
    assert sum(len(topic["questions"]) for topic in saved["topics"]) == 504
    assert {topic["source_id"] for topic in saved["topics"]} == {
        topic["source_id"] for topic in source["topics"] if topic["part"] in (1, 3)
    }
    assert saved["source_sha256"] == source["source_sha256"]
    assert all(len(topic["questions"]) == 4 for topic in saved["topics"])
    assert not any("does old objects" in q["question_text"].lower()
                   for topic in saved["topics"] for q in topic["questions"])


def test_all_reviewed_topics_can_be_imported_with_historical_rows_held():
    bank = json.loads(REVIEWED.read_text(encoding="utf-8"))
    approved = {
        topic["source_id"] for topic in bank["topics"]
        if topic["window_end"] is None or
        topic["window_start"] <= "2026-09-29" <= topic["window_end"]
    }
    session = _Session()

    result = import_bank(session, "https://example.test", bank, parts={1, 3},
                         commit=True, today=date(2026, 9, 29), render_audio=True,
                         approved_source_ids=approved, progress=lambda _: None)

    assert result == {"planned": 126, "created": 126, "questions_added": 504,
                      "activated": 74, "unchanged": 52}
    assert sum(topic["is_active"] for topic in session.topics) == 74
    assert sum(path.endswith("render-audio") for _, path, _ in session.actions) == 296
