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
    def __init__(self, data):
        self.data = data

    def execute(self):
        if isinstance(self.data, Exception):
            raise self.data
        return _Result(self.data)


class _Admin:
    def __init__(self, result=None):
        self.result = result or [{
            "bank_id": "bank-v1", "written": 48,
            "is_published": True, "action": "updated",
        }]
        self.writes = []

    def rpc(self, name, params):
        self.writes.append((name, params))
        return _Query(self.result)


def test_importer_rejects_revision_that_would_orphan_frozen_assignment(monkeypatch):
    admin = _Admin(Exception("advanced_vocab_bank_revision_in_use"))
    monkeypatch.setattr(importer, "_admin", lambda: admin)
    spec = {
        "payload": {
            "course_id": "course-c5", "code": "C5-ADV-T01",
            "meta": {"runtime": {"content_checksum": "checksum-v2"}},
        },
        "rows": [{"qid": f"q{number}"} for number in range(48)],
    }

    with pytest.raises(SystemExit, match="bank/content version mới"):
        importer._upsert_bank(spec)

    assert admin.writes[0][0] == "import_quiz_bank_atomic"


def test_importer_preserves_published_bank_unless_publish_is_explicit(monkeypatch):
    admin = _Admin()
    monkeypatch.setattr(importer, "_admin", lambda: admin)
    spec = {
        "payload": {
            "course_id": "course-c5", "code": "C5-ADV-T01",
            "is_published": False,
            "meta": {"runtime": {"content_checksum": "checksum-v1"}},
        },
        "rows": [{"qid": f"q{number}"} for number in range(48)],
    }

    importer._upsert_bank(spec)
    assert admin.writes[-1][0] == "import_quiz_bank_atomic"
    assert admin.writes[-1][1]["p_publish_state"] == "preserve"

    importer._upsert_bank(spec, publish=True)
    assert admin.writes[-1][1]["p_publish_state"] == "published"


def test_importer_has_one_atomic_write_boundary_for_metadata_questions_and_publish(
        monkeypatch):
    admin = _Admin()
    monkeypatch.setattr(importer, "_admin", lambda: admin)
    spec = importer.lesson_spec("ADV-T01", course_id="course-c5")

    importer._upsert_bank(spec, publish=True)

    assert len(admin.writes) == 1
    name, params = admin.writes[0]
    assert name == "import_quiz_bank_atomic"
    assert params["p_payload"]["is_published"] is False
    assert params["p_publish_state"] == "published"
    assert len(params["p_rows"]) == 48


def test_atomic_import_migration_orders_replace_before_publish_in_one_function():
    migration = (Path(__file__).resolve().parents[1] / "migrations"
                 / "294_atomic_quiz_import_publish_state.sql").read_text()

    replace_at = migration.index("public.quiz_replace_questions")
    publish_at = migration.index("is_published = v_publish")
    assert "FOR UPDATE" in migration
    assert replace_at < publish_at
    assert "advanced_vocab_bank_revision_in_use" in migration
    assert "advanced_vocab_bank_question_set_mismatch" in migration
    assert "REVOKE ALL ON FUNCTION" in migration


def test_atomic_import_and_assignment_share_the_same_bank_row_lock():
    migrations = Path(__file__).resolve().parents[1] / "migrations"
    atomic_import = (
        migrations / "294_atomic_quiz_import_publish_state.sql"
    ).read_text()
    atomic_assignment = (
        migrations / "269_serialize_course_assignment_bank_revision.sql"
    ).read_text()

    assert "FROM public.quiz_banks AS qb" in atomic_import
    assert "FOR UPDATE" in atomic_import
    assert "FROM public.quiz_banks AS qb" in atomic_assignment
    assert "FOR UPDATE" in atomic_assignment
    assert "quiz_course_bank_assignment_revision" in atomic_assignment
