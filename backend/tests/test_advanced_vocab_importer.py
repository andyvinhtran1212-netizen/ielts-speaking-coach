from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

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
        assert payload["code"] == f"C4-{lesson_id}"
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
