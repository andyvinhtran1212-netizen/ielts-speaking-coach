from __future__ import annotations

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from scripts.import_speaking_bank_admin import import_bank  # noqa: E402


class _Response:
    content = b"{}"

    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class _Session:
    def __init__(self):
        self.topics = []
        self.questions = {}
        self.actions = []

    def request(self, method, url, **kwargs):
        path = url.split("/admin/topics", 1)[1].strip("/")
        body = kwargs.get("json", {})
        self.actions.append((method, path, body))
        if not path:
            if method == "GET":
                return _Response([dict(topic) for topic in self.topics])
            topic = {**body, "id": f"topic-{len(self.topics) + 1}", "is_active": True}
            self.topics.append(topic)
            return _Response(dict(topic))
        topic_id, *remainder = path.split("/")
        topic = next(row for row in self.topics if row["id"] == topic_id)
        if len(remainder) == 3 and remainder[0] == "questions" and remainder[2] == "render-audio":
            row = next(row for row in self.questions[topic_id] if row["id"] == remainder[1])
            row["audio_url"] = "https://example.test/audio.mp3"
            row["audio_path"] = "matching-script"
            return _Response({"id": row["id"], "audio_ready": True})
        if remainder == ["questions"]:
            rows = self.questions.setdefault(topic_id, [])
            if method == "GET":
                return _Response([dict(row) for row in rows])
            row = {**body, "id": f"question-{len(rows) + 1}"}
            rows.append(row)
            return _Response(dict(row))
        assert method == "PATCH" and not remainder
        topic.update(body)
        return _Response(dict(topic))


def test_current_cue_card_activates_after_verified_questions_and_old_card_stays_held():
    source = Path(__file__).parent.parent / "content/speaking_bank/2026-09-source.json"
    bank = json.loads(source.read_text(encoding="utf-8"))
    bank["topics"] = [next(row for row in bank["topics"] if row["source_id"] == source_id)
                      for source_id in ("p2-001", "p2-055")]
    session = _Session()
    result = import_bank(session, "https://example.test", bank, parts={2},
                         commit=True, today=date(2026, 9, 29), progress=lambda _: None)

    assert result == {"planned": 2, "created": 2, "questions_added": 6,
                      "activated": 1, "unchanged": 1}
    assert session.topics[0]["is_active"] is True
    assert session.topics[1]["is_active"] is False
    first_activation = next(index for index, (method, path, body) in enumerate(session.actions)
                            if method == "PATCH" and body == {"is_active": True})
    assert sum(method == "GET" and path == "topic-1/questions"
               for method, path, _ in session.actions[:first_activation]) == 2
    assert import_bank(session, "https://example.test", bank, parts={2},
                       commit=True, today=date(2026, 9, 29), progress=lambda _: None)["questions_added"] == 0


def test_part_one_requires_explicit_approval_and_verified_audio_before_activation():
    source = Path(__file__).parent.parent / "content/speaking_bank/2026-09-source.json"
    bank = json.loads(source.read_text(encoding="utf-8"))
    bank["topics"] = [next(row for row in bank["topics"] if row["source_id"] == "p1-004")]
    session = _Session()
    import_bank(session, "https://example.test", bank, parts={1}, commit=True,
                today=date(2026, 9, 29), progress=lambda _: None)
    assert session.topics[0]["is_active"] is False
    assert not any(path.endswith("render-audio") for _, path, _ in session.actions)

    import_bank(session, "https://example.test", bank, parts={1}, commit=True,
                today=date(2026, 9, 29), render_audio=True,
                approved_source_ids={"p1-004"}, progress=lambda _: None)
    assert session.topics[0]["is_active"] is True
    assert sum(path.endswith("render-audio") for _, path, _ in session.actions) == 7
