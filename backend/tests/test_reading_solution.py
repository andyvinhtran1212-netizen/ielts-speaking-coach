"""Phase 0.3 — the stepper contract: structural validation + the reconcile
(build_stepper) that unifies rich prose solutions, structured solutions, and
plain `explanation` into one view-model. Also asserts the importer rejects a
malformed solution loudly (dry-run), not silently.
"""
from __future__ import annotations

from services import reading_solution as rs
from services.content_import_service import validate_reading_questions

# A fully-structured stepper solution (what Phase 0.4 will author).
_STRUCTURED = {
    "solution_steps": [
        {"action": "locate", "instruction_vi": "Tìm 'reintroduced' ở đoạn 1"},
        {"action": "decode_vocab", "instruction_vi": "re- + introduce",
         "kp_refs": [{"type": "vocab", "slug": "reintroduce"}]},
        {"action": "parse_syntax", "instruction_vi": "Mệnh đề rút gọn",
         "kp_refs": [{"type": "grammar", "slug": "participle-clauses",
                      "anchor": "participle-clauses.overview"}]},
    ],
    "distractor_analysis": [
        {"option": "A", "why_wrong_vi": "Bẫy paraphrase",
         "kp_refs": [{"type": "skill", "slug": "scanning"}]},
    ],
}


# ── validation ───────────────────────────────────────────────────────────────

def test_structured_solution_is_valid():
    assert rs.validate_solution_structure(_STRUCTURED, "Q1") == []


def test_prose_only_and_empty_solutions_are_valid():
    # Legacy prose fields carry no stepper structure → nothing to reject.
    assert rs.validate_solution_structure({"steps": "prose", "trap_analysis": "x"}, "Q") == []
    assert rs.validate_solution_structure(None, "Q") == []
    assert rs.validate_solution_structure({}, "Q") == []


def test_bad_action_and_missing_instruction_rejected():
    bad = {"solution_steps": [{"action": "teleport", "instruction_vi": "x"},
                              {"action": "locate", "instruction_vi": "  "}]}
    errs = rs.validate_solution_structure(bad, "Q")
    assert any("action" in e for e in errs)
    assert any("instruction_vi" in e for e in errs)


def test_kp_ref_shape_and_anchor_rules():
    # Non-grammar ref may not carry an anchor.
    bad_anchor = {"kp_tags": [{"type": "vocab", "slug": "x", "anchor": "nope"}]}
    assert any("anchor" in e for e in rs.validate_solution_structure(bad_anchor, "Q"))
    # Unknown type + empty slug.
    bad_type = {"kp_tags": [{"type": "phonics", "slug": "x"}]}
    assert any("type" in e for e in rs.validate_solution_structure(bad_type, "Q"))
    bad_slug = {"kp_tags": [{"type": "grammar", "slug": ""}]}
    assert rs.validate_solution_structure(bad_slug, "Q") != []
    # Grammar WITH anchor is allowed.
    assert rs.validate_solution_structure(
        {"kp_tags": [{"type": "grammar", "slug": "a", "anchor": "a.b"}]}, "Q") == []


def test_microcheck_valid_and_invalid_shapes():
    ok = {"solution_steps": [{
        "action": "parse_syntax", "instruction_vi": "x",
        "kp_refs": [{"type": "grammar", "slug": "reduced-relative-clauses",
                     "anchor": "reduced-relative-clauses.passive-v3"}],
        "microcheck": {"prompt": "Rút gọn từ mệnh đề nào?",
                       "options": ["which was dismissed", "which dismisses"],
                       "answer": "A"},
    }]}
    assert rs.validate_solution_structure(ok, "Q") == []

    def _mc(mc, with_ref=True):
        step = {"action": "parse_syntax", "instruction_vi": "x", "microcheck": mc}
        if with_ref:
            step["kp_refs"] = [{"type": "grammar", "slug": "a"}]
        return rs.validate_solution_structure({"solution_steps": [step]}, "Q")

    assert any("prompt" in e for e in _mc({"options": ["a", "b"], "answer": "A"}))
    assert any("options" in e for e in _mc({"prompt": "p", "options": ["only"], "answer": "A"}))
    assert any("answer" in e for e in _mc({"prompt": "p", "options": ["a", "b"], "answer": "3"}))
    assert any("vượt" in e for e in _mc({"prompt": "p", "options": ["a", "b"], "answer": "C"}))
    # microcheck present but the step carries no kp_ref → recorded evidence goes nowhere.
    assert any("kp_ref" in e for e in
               _mc({"prompt": "p", "options": ["a", "b"], "answer": "A"}, with_ref=False))
    # non-dict microcheck rejected.
    assert rs.validate_solution_structure(
        {"solution_steps": [{"action": "confirm", "instruction_vi": "x",
                             "kp_refs": [{"type": "grammar", "slug": "a"}],
                             "microcheck": "nope"}]}, "Q") != []


# ── reconcile / build_stepper ────────────────────────────────────────────────

def test_build_stepper_passes_microcheck_through():
    sol = {"solution_steps": [{
        "action": "parse_syntax", "instruction_vi": "x",
        "kp_refs": [{"type": "grammar", "slug": "a"}],
        "microcheck": {"prompt": "p", "options": ["a", "b"], "answer": "A"},
    }]}
    view = rs.build_stepper(sol)
    assert view["steps"][0]["microcheck"] == {"prompt": "p", "options": ["a", "b"], "answer": "A"}
    # A step with no micro-check yields microcheck=None (frontend skips it).
    assert rs.build_stepper(_STRUCTURED)["steps"][0]["microcheck"] is None


def test_build_stepper_uses_structured_steps_and_derives_kp_tags():
    view = rs.build_stepper(_STRUCTURED)
    assert [s["action"] for s in view["steps"]] == ["locate", "decode_vocab", "parse_syntax"]
    assert {"option": "A", "why_wrong_vi": "Bẫy paraphrase",
            "kp_refs": [{"type": "skill", "slug": "scanning", "anchor": ""}]} in view["distractors"]
    # kp_tags = deduped union across steps + distractors.
    tags = {(t["type"], t["slug"], t["anchor"]) for t in view["kp_tags"]}
    assert tags == {
        ("vocab", "reintroduce", ""),
        ("grammar", "participle-clauses", "participle-clauses.overview"),
        ("skill", "scanning", ""),
    }


def test_build_stepper_prose_fallback_single_step():
    view = rs.build_stepper({"steps": "Đối chiếu đoạn 2.", "trap_analysis": "Bẫy số liệu."})
    assert len(view["steps"]) == 1
    assert view["steps"][0]["action"] == "confirm"
    assert view["steps"][0]["instruction_vi"] == "Đối chiếu đoạn 2."
    assert view["distractors"][0]["why_wrong_vi"] == "Bẫy số liệu."
    assert view["kp_tags"] == []


def test_build_stepper_explanation_only_and_empty():
    # A v2-flat question with only `explanation` still yields a 1-step stepper.
    view = rs.build_stepper(None, "Vì đoạn văn nói X.")
    assert len(view["steps"]) == 1 and view["steps"][0]["instruction_vi"] == "Vì đoạn văn nói X."
    # Nothing at all → None (frontend shows no stepper).
    assert rs.build_stepper(None, None) is None
    assert rs.build_stepper({}, "") is None


def test_explicit_kp_tags_win_over_derived():
    sol = {"solution_steps": [{"action": "infer", "instruction_vi": "x",
                               "kp_refs": [{"type": "vocab", "slug": "derived"}]}],
           "kp_tags": [{"type": "grammar", "slug": "explicit"}]}
    view = rs.build_stepper(sol)
    assert [(t["type"], t["slug"]) for t in view["kp_tags"]] == [("grammar", "explicit")]


# ── importer integration ─────────────────────────────────────────────────────

def test_importer_rejects_bad_solution_loudly():
    q = {
        "q_num": 1, "question_type": "true_false_not_given",
        "prompt": "P", "answer": "TRUE", "skill_tag": "detail",
        "solution": {"solution_steps": [{"action": "warpspeed", "instruction_vi": "x"}]},
    }
    errs = validate_reading_questions([q])
    assert any("action" in e["message"] for e in errs)


def test_enrich_kp_refs_adds_injected_metadata():
    stepper = {
        "steps": [{"action": "parse_syntax", "instruction_vi": "x",
                   "kp_refs": [{"type": "grammar", "slug": "articles"}]}],
        "distractors": [{"option": "A", "why_wrong_vi": "y",
                         "kp_refs": [{"type": "skill", "slug": "scanning"}]}],
        "kp_tags": [{"type": "vocab", "slug": "ritual"}],
    }
    labels = {"grammar": {"category": "foundations", "title": "Articles"},
              "skill": {"title": "Scanning"}, "vocab": {"title": "Ritual"}}
    rs.enrich_kp_refs(stepper, lambda t, s: labels[t])
    assert stepper["steps"][0]["kp_refs"][0]["category"] == "foundations"
    assert stepper["steps"][0]["kp_refs"][0]["title"] == "Articles"
    assert stepper["distractors"][0]["kp_refs"][0]["title"] == "Scanning"
    assert stepper["kp_tags"][0]["title"] == "Ritual"


def test_enrich_kp_refs_is_none_safe_and_does_not_override():
    assert rs.enrich_kp_refs(None, lambda t, s: {}) is None
    # setdefault: an existing title is not overwritten.
    stp = {"steps": [{"kp_refs": [{"type": "grammar", "slug": "x", "title": "keep"}]}]}
    rs.enrich_kp_refs(stp, lambda t, s: {"title": "new"})
    assert stp["steps"][0]["kp_refs"][0]["title"] == "keep"


def test_importer_accepts_good_solution():
    q = {
        "q_num": 1, "question_type": "true_false_not_given",
        "prompt": "P", "answer": "TRUE", "skill_tag": "detail",
        "solution": _STRUCTURED,
    }
    assert validate_reading_questions([q]) == []
