from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import import_advanced_vocab_core30 as importer


def test_core30_import_payloads_are_complete_assignment_only_banks():
    assert importer.LESSON_IDS == tuple(
        f"ADV-T{number:02d}" for number in range(1, 31)
    )
    specs = [importer.lesson_spec(lesson_id) for lesson_id in importer.LESSON_IDS]

    assert len(specs) == 30
    assert len({spec["payload"]["code"] for spec in specs}) == 30
    assert sum(len(spec["rows"]) for spec in specs) == 1440
    for lesson_id, spec in zip(importer.LESSON_IDS, specs, strict=True):
        payload = spec["payload"]
        runtime = payload["meta"]["runtime"]
        assert payload["code"] == f"C5-{lesson_id}"
        assert payload["source"] == "advanced-vocab-core30-v6-t11-map-locked"
        assert payload["lesson_no"] is None
        assert payload["is_published"] is False
        assert payload["words_count"] == 24
        assert runtime["lesson_id"] == lesson_id
        assert runtime["score_policy"] == "none"
        assert runtime["required_stages"] == [
            "vocabulary", "practice_1", "practice_2", "reading",
            "controlled_rewrite", "listening",
        ]
        assert runtime["writing_submittable"] is False
        assert runtime["speaking_graded_by_default"] is False
        assert len(runtime["practice_question_ids"]) == 48


def test_importer_dry_run_is_offline_without_supabase_environment():
    script = (Path(__file__).resolve().parents[1] / "scripts"
              / "import_advanced_vocab_core30.py")
    env = os.environ.copy()
    for key in ("SUPABASE_URL", "SUPABASE_KEY", "SUPABASE_SERVICE_KEY",
                "SUPABASE_SERVICE_ROLE_KEY"):
        env.pop(key, None)

    result = subprocess.run(
        [sys.executable, str(script), "--lesson", "ADV-T01"],
        cwd=script.parents[2], env=env, capture_output=True, text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert "THỬ KHÔ: 1/30 lesson hợp lệ" in result.stdout


class _Result:
    def __init__(self, data=None, count=None):
        self.data = data
        self.count = count


class _Query:
    def __init__(self, admin, table):
        self.admin = admin
        self.table = table

    def select(self, *_args, **_kwargs):
        return self

    def update(self, payload):
        self.admin.writes.append(("update", self.table, payload))
        self.admin.updated_payload = payload
        return self

    def eq(self, _key, _value):
        return self

    def limit(self, _value):
        return self

    def execute(self):
        if self.table == "quiz_banks":
            return _Result([self.admin.bank])
        if self.table == "class_assignments":
            return _Result([{"id": "assignment-v1"}])
        if self.table == "rpc":
            return _Result(0)
        return _Result([])


class _Admin:
    def __init__(self):
        self.bank = {
            "id": "bank-v1",
            "is_published": True,
            "meta": {"runtime": {"content_checksum": "checksum-v1"}},
        }
        self.writes = []
        self.updated_payload = None

    def table(self, name):
        return _Query(self, name)

    def rpc(self, *_args, **_kwargs):
        self.writes.append(("rpc", "quiz_replace_questions"))
        return _Query(self, "rpc")


def test_importer_rejects_revision_that_would_orphan_frozen_assignment(monkeypatch):
    admin = _Admin()
    monkeypatch.setattr(importer, "_admin", lambda: admin)
    spec = {
        "payload": {
            "course_id": "course-c5", "code": "C5-ADV-T01",
            "meta": {"runtime": {"content_checksum": "checksum-v2"}},
        },
        "rows": [{"qid": "q1"}],
    }

    with pytest.raises(SystemExit, match="bank/content version mới"):
        importer._upsert_bank(spec)

    assert admin.writes == []


def test_importer_preserves_published_bank_unless_publish_is_explicit(monkeypatch):
    admin = _Admin()
    monkeypatch.setattr(importer, "_admin", lambda: admin)
    spec = {
        "payload": {
            "course_id": "course-c5", "code": "C5-ADV-T01",
            "is_published": False,
            "meta": {"runtime": {"content_checksum": "checksum-v1"}},
        },
        "rows": [],
    }

    importer._upsert_bank(spec)
    assert admin.updated_payload["is_published"] is True

    admin.bank["is_published"] = False
    importer._upsert_bank(spec, publish=True)
    assert admin.updated_payload["is_published"] is True
