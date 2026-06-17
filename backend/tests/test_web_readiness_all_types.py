"""P5 / W-6 — all-question-types harness.

Locks the web-readiness contract end-to-end: the listening classifier covers
EVERY supported question type (incl. the P2-P4 additions matching / mcq_multi /
flow_chart_completion), real committed content classifies with 0 unknown, and a
mixed grade smoke (incl. the mcq_multi any-order set) scores sanely.

Real-content lock (D-3): runs parse_question_blocks on the committed
docs/content-samples/listening-full-test/ILR-LIS-055/056/057 Question Papers —
the actual content the web must render — and asserts 0 unknown blocks.
"""
from __future__ import annotations

import os

import pytest

from services import listening_convert as lc
from services import listening_test_grader as grader

_SAMPLE_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..",
    "docs", "content-samples", "listening-full-test",
)


def _qp(test_id: str) -> str | None:
    p = os.path.join(_SAMPLE_DIR, f"{test_id}_Question_Paper.md")
    return p if os.path.exists(p) else None


# ── 1. Classifier covers every type (synthetic, format-faithful) ──────

_TYPE_INSTRUCTIONS = {
    "form_completion":       "> Complete the form below.",
    "table_completion":      "> Complete the table below.",
    "notes_completion":      "> Complete the notes below.",
    "summary_completion":    "> Complete the summary below.",
    "sentence_completion":   "> Complete the sentences below.",
    "short_answer":          "> Answer the questions below.",
    "mcq_3option":           "> Choose the correct letter, A, B or C.",
    "plan_label":            "> Label the campus map below.",          # B1
    "flow_chart_completion": "> Complete the flow-chart below.",        # P2
    "matching":              "> Match each speaker with the correct option (A-G).",  # P3
    "mcq_multi":             "> Choose TWO letters, A-E.",              # P4
}


@pytest.mark.parametrize("expected_kind,instruction", list(_TYPE_INSTRUCTIONS.items()))
def test_classifier_covers_every_type(expected_kind, instruction):
    q_type, template_kind = lc._classify_instruction(instruction)
    assert template_kind == expected_kind, (
        f"{instruction!r} → {template_kind!r}, expected {expected_kind!r}"
    )
    assert q_type != "unknown"


def test_qtype_marker_covers_every_render_kind():
    """Every render kind the marker map advertises resolves (marker-read path)."""
    for kind in ("flow_chart", "matching", "mcq_multi", "plan_label",
                 "form_completion", "short_answer"):
        assert lc._read_qtype_marker(f"<!-- qtype: {kind} -->") is not None


# ── 2. Real-content lock (D-3) — 0 unknown on committed samples ───────

@pytest.mark.parametrize("test_id", ["ILR-LIS-055", "ILR-LIS-056", "ILR-LIS-057"])
def test_real_sample_zero_unknown(test_id):
    qp = _qp(test_id)
    if not qp:
        pytest.skip(f"{test_id} sample not present")
    with open(qp, encoding="utf-8") as f:
        text = f.read()
    sections = lc.split_qp_sections(text)
    unknown = []
    kinds = set()
    for sn in sorted(sections):
        for b in lc.parse_question_blocks(sections[sn]):
            kinds.add(b["template_kind"])
            if b["q_type"] == "unknown":
                unknown.append(b["q_range"])
    assert unknown == [], f"{test_id} has unknown blocks: {unknown}"
    # Sanity: the per-test signature type is present.
    sig = {"ILR-LIS-055": "flow_chart_completion",
           "ILR-LIS-056": "matching",
           "ILR-LIS-057": "mcq_multi"}[test_id]
    assert sig in kinds, f"{test_id} missing its signature type {sig}"


def test_057_heterogeneous_split_on_real_content():
    """The real 057 26-30 heading → mcq_multi (26-27) + matching (28-30)."""
    qp = _qp("ILR-LIS-057")
    if not qp:
        pytest.skip("057 not present")
    with open(qp, encoding="utf-8") as f:
        sections = lc.split_qp_sections(f.read())
    ranges = {}
    for sn in sorted(sections):
        for b in lc.parse_question_blocks(sections[sn]):
            ranges[b["q_range"]] = b["template_kind"]
    assert ranges.get((26, 27)) == "mcq_multi"
    assert ranges.get((28, 30)) == "matching"


# ── 3. Mixed grade smoke (incl. mcq_multi any-order set) ──────────────

def test_mixed_grade_smoke():
    answer_key = grader.collect_answer_key([
        {"payload": {"template_kind": "form_completion",
                     "answers": [{"q_num": 1, "answer": "Brighton"}]}},
        {"payload": {"template_kind": "matching",
                     "answers": [{"q_num": 2, "answer": "C"}]}},
        {"payload": {"template_kind": "flow_chart_completion",
                     "answers": [{"q_num": 3, "answer": "deadline"}]}},
        {"payload": {"template_kind": "mcq_multi",
                     "answers": [{"q_num": 4, "answer": "B"}, {"q_num": 5, "answer": "D"}]}},
    ])
    user = [
        {"q_num": 1, "user_answer": "brighton"},   # text, case-insensitive → ok
        {"q_num": 2, "user_answer": "c"},            # matching letter → ok
        {"q_num": 3, "user_answer": "wrong"},        # flow-chart text → wrong
        {"q_num": 4, "user_answer": "D"},            # mcq_multi swapped…
        {"q_num": 5, "user_answer": "B"},            # …any-order → both ok (2)
    ]
    res = grader.grade_attempt(user, answer_key)
    assert res["score"] == 4          # 1 + 2(matching) wait: 1,2 ok; 3 wrong; 4,5 ok = 4
    assert res["max_score"] == 5
    by_q = {r["q_num"]: r["correct"] for r in res["per_question"]}
    assert by_q == {1: True, 2: True, 3: False, 4: True, 5: True}
