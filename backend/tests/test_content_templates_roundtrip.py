"""test_content_templates_roundtrip.py — anti-drift guard for the downloadable
content-import templates (frontend/templates/).

The "Tải khuôn mẫu" buttons serve these files to content authors so a download →
upload → parse → render round-trips. This test parses the SHIPPED frontend copies
through the REAL parsers, so if a template ever drifts from a parsable format (or
a parser format changes without updating the template) CI fails. Value-gate #1
of the feature: the template must round-trip, not just look like the spec.
"""
import json
from pathlib import Path

import pytest

# frontend/templates/ relative to this test file (backend/tests/).
TPL = Path(__file__).resolve().parents[2] / "frontend" / "templates"


def test_reading_prose_bundle_template_roundtrips():
    """Reading bundle template (đề + giải) → 3 passages, 40 questions."""
    from services.reading_prose_import import build_parsed_reading_test_from_prose

    test_md = (TPL / "reading" / "IELTS_Reading_Test_06.md").read_text(encoding="utf-8")
    sol_md = (TPL / "reading" / "IELTS_Reading_Test_06_Solution.md").read_text(encoding="utf-8")
    parsed = build_parsed_reading_test_from_prose(test_md, sol_md)

    assert parsed.passage_count == 3
    assert parsed.total_questions == 40
    assert parsed.test_id  # non-empty


def test_reading_l1l2_single_file_template_roundtrips():
    """Reading single-file L1/L2 template parses + validates with no errors."""
    from services.content_import_service import (
        parse_reading_passage,
        validate_reading_passage,
    )

    md = (TPL / "reading" / "l2-a2-detail-emperor-penguins.md").read_text(encoding="utf-8")
    parsed = parse_reading_passage(md)
    errors = validate_reading_passage(parsed)
    assert errors == [], f"L1/L2 template has validation errors: {errors}"


def test_listening_fulltest_pack_template_roundtrips():
    """Listening pack template (QP + giải + timings) → 4 sections, 40 questions,
    zero parser errors (the audio .mp3 is the author's own — not templated)."""
    from services.listening_fulltest_import import parse_fulltest

    qp = (TPL / "listening" / "ILR_LIS_001_Question_Paper.md").read_text(encoding="utf-8")
    sol = (TPL / "listening" / "ILR_LIS_001_Solution.md").read_text(encoding="utf-8")
    timings = json.loads((TPL / "listening" / "timings.json").read_text(encoding="utf-8"))

    res = parse_fulltest(qp, sol, timings)

    assert res.errors == [], f"Listening template parse errors: {res.errors}"
    assert len(res.sections) == 4
    assert len(res.questions) == 40


def test_template_files_present():
    """All six template files the download buttons reference exist."""
    for rel in [
        "reading/IELTS_Reading_Test_06.md",
        "reading/IELTS_Reading_Test_06_Solution.md",
        "reading/l2-a2-detail-emperor-penguins.md",
        "listening/ILR_LIS_001_Question_Paper.md",
        "listening/ILR_LIS_001_Solution.md",
        "listening/timings.json",
    ]:
        assert (TPL / rel).is_file(), f"missing template: {rel}"
