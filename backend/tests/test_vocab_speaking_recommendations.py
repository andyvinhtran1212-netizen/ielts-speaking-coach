from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from services import claude_grader
from services import vocab_speaking_recommendations as recommendations
from routers import grading as grading_router
from scripts.seed_vocab_curated import load_pilot


ROOT = Path(__file__).resolve().parents[1]


def _mapping(
    code: str = "prefer.wrong-than",
    unit_id: str = "11111111-1111-4111-8111-111111111111",
    slug: str = "prefer-x-to-y",
    original_pattern: str = r"\bprefer\b.{1,80}\bthan\b",
    corrected_pattern: str = r"\bprefer\b.{1,80}\bto\b",
) -> dict:
    return {
        "mapping_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        "signal_code": code,
        "unit_id": unit_id,
        "unit_slug": slug,
        "title": "prefer X to Y",
        "reason_vi": "Bạn vừa dùng sai khung prefer.",
        "priority": 100,
        "match_spec": {
            "issue_type": "preposition",
            "original_pattern": original_pattern,
            "corrected_pattern": corrected_pattern,
        },
    }


def _candidate(**overrides) -> dict:
    return {
        "evidence": "I prefer tea than coffee",
        "corrected": "I prefer tea to coffee",
        "issue_type": "preposition",
        "confidence": "high",
        **overrides,
    }


def test_matches_one_editorial_rule_from_exact_transcript_evidence():
    result = recommendations.match_structured_signals(
        [_candidate()], [_mapping()], "Well, I prefer tea than coffee in the morning.",
        reliability_label="high",
    )
    assert len(result) == 1
    assert result[0]["signal_code"] == "prefer.wrong-than"
    assert result[0]["unit_slug"] == "prefer-x-to-y"
    assert result[0]["reason_vi"] == "Bạn vừa dùng sai khung prefer."


def test_fails_closed_for_unquoted_medium_low_or_unchanged_evidence():
    catalog = [_mapping()]
    transcript = "I prefer tea than coffee."
    assert recommendations.match_structured_signals(
        [_candidate(evidence="I prefer buses than trains")], catalog, transcript,
        reliability_label="high",
    ) == []
    assert recommendations.match_structured_signals(
        [_candidate(confidence="medium")], catalog, transcript,
        reliability_label="high",
    ) == []
    assert recommendations.match_structured_signals(
        [_candidate()], catalog, transcript, reliability_label="low",
    ) == []
    assert recommendations.match_structured_signals(
        [_candidate(corrected="I prefer tea than coffee")], catalog, transcript,
        reliability_label="high",
    ) == []


def test_ambiguous_editorial_rules_are_rejected_instead_of_ranked():
    duplicate = _mapping(
        code="another.prefer-rule",
        unit_id="22222222-2222-4222-8222-222222222222",
        slug="another-unit",
    )
    assert recommendations.match_structured_signals(
        [_candidate()], [_mapping(), duplicate], "I prefer tea than coffee.",
        reliability_label="high",
    ) == []


def test_false_friend_rule_requires_the_matched_lexeme_to_change():
    mapping = _mapping(
        code="fun-funny.meaning",
        slug="fun-vs-funny",
        original_pattern=r"\b(?:fun|funny)\b",
        corrected_pattern=r"\b(?:fun|funny)\b",
    )
    mapping["match_spec"].update({
        "issue_type": "meaning",
        "require_distinct_match": True,
    })
    unchanged_lexeme = _candidate(
        evidence="The trip was funny",
        corrected="The trip was really funny",
        issue_type="meaning",
    )
    changed_lexeme = _candidate(
        evidence="The trip was funny",
        corrected="The trip was fun",
        issue_type="meaning",
    )

    assert recommendations.match_structured_signals(
        [unchanged_lexeme], [mapping], "The trip was funny.", reliability_label="high",
    ) == []
    assert len(recommendations.match_structured_signals(
        [changed_lexeme], [mapping], "The trip was funny.", reliability_label="high",
    )) == 1


def test_impact_in_is_not_an_active_wrong_preposition_pattern():
    unit = next(
        item for item in load_pilot()["units"]
        if item["unit_slug"] == "have-an-impact-on"
    )
    signal = unit["speaking_signals"][0]
    mapping = {
        **_mapping(code=signal["signal_code"], slug=unit["unit_slug"]),
        "match_spec": signal["match_spec"],
    }
    assert recommendations.match_structured_signals(
        [{
            "evidence": "The policy had an impact in rural areas",
            "corrected": "The policy had an impact on rural areas",
            "issue_type": "preposition",
            "confidence": "high",
        }],
        [mapping],
        "The policy had an impact in rural areas.",
        reliability_label="high",
    ) == []


def test_symmetric_meaning_rules_remain_inactive_until_corpus_audit():
    signals = [
        signal
        for unit in load_pilot()["units"]
        for signal in unit["speaking_signals"]
    ]
    inactive_codes = {
        signal["signal_code"] for signal in signals
        if signal.get("status") == "inactive"
    }
    assert inactive_codes == {
        "actually-currently.false-friend",
        "convenient-comfortable.false-friend",
        "borrow-lend.direction",
        "economic-economical.word-choice",
        "fun-funny.meaning",
    }
    assert all(
        signal["match_spec"]["issue_type"] in {"preposition", "verb_frame"}
        for signal in signals if signal.get("status", "active") == "active"
    )


def test_signal_catalog_uses_a_short_ttl_and_returns_copies():
    catalog = [_mapping()]
    recommendations.clear_signal_catalog_cache()
    with (
        patch.object(
            recommendations, "_load_signal_catalog_uncached",
            side_effect=[[dict(catalog[0])], [dict(catalog[0])]],
        ) as loader,
        patch.object(recommendations.time, "monotonic", side_effect=[10.0, 20.0, 26.0]),
    ):
        first = recommendations.load_signal_catalog()
        first[0]["title"] = "mutated by caller"
        second = recommendations.load_signal_catalog()
        third = recommendations.load_signal_catalog()
    assert second[0]["title"] == "prefer X to Y"
    assert third[0]["title"] == "prefer X to Y"
    assert loader.call_count == 2
    recommendations.clear_signal_catalog_cache()


def test_caps_two_unique_units_and_deduplicates_one_unit():
    second = _mapping(
        code="spend-time.infinitive",
        unit_id="22222222-2222-4222-8222-222222222222",
        slug="spend-time-doing",
        original_pattern=r"\bspend\s+time\s+to\s+[a-z]+",
        corrected_pattern=r"\bspend\s+time\s+[a-z]+ing\b",
    )
    second["match_spec"]["issue_type"] = "verb_frame"
    third = _mapping(
        code="play-role.missing-article",
        unit_id="33333333-3333-4333-8333-333333333333",
        slug="play-a-role-in",
        original_pattern=r"\bplay\s+role\b",
        corrected_pattern=r"\bplay\s+a\s+role\b",
    )
    third["match_spec"]["issue_type"] = "verb_frame"
    signals = [
        _candidate(),
        _candidate(),
        _candidate(
            evidence="I spend time to read", corrected="I spend time reading",
            issue_type="verb_frame",
        ),
        _candidate(
            evidence="Friends play role in my life", corrected="Friends play a role in my life",
            issue_type="verb_frame",
        ),
    ]
    matched = recommendations.match_structured_signals(
        signals, [_mapping(), second, third],
        "I prefer tea than coffee. I spend time to read. Friends play role in my life.",
        reliability_label="high",
    )
    assert [row["unit_slug"] for row in matched] == ["prefer-x-to-y", "spend-time-doing"]


def test_preminted_ids_are_stable_for_response_identity_and_unit():
    first = [{"unit_id": "11111111-1111-4111-8111-111111111111"}]
    second = [{"unit_id": "11111111-1111-4111-8111-111111111111"}]
    recommendations.premint_recommendation_ids(first, session_id="session", question_id="question")
    recommendations.premint_recommendation_ids(second, session_id="session", question_id="question")
    assert first[0]["rec_id"] == second[0]["rec_id"]


def test_persistence_uses_atomic_rpc_and_keeps_feedback_evidence_in_memory():
    rec = recommendations.match_structured_signals(
        [_candidate()], [_mapping()], "I prefer tea than coffee.", reliability_label="high",
    )[0]
    rec["rec_id"] = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    database = MagicMock()
    database.rpc.return_value.execute.return_value = SimpleNamespace(data=[{
        "rec_id": rec["rec_id"], "unit_id": rec["unit_id"], "unit_slug": rec["unit_slug"],
        "title": rec["title"], "signal_code": rec["signal_code"],
        "reason_vi": rec["reason_vi"], "status": "pending", "confidence": "high",
    }])
    with patch.object(recommendations, "supabase_admin", database):
        stored = recommendations.persist_recommendations(
            [rec], user_id="user", response_id="response",
        )
    assert stored[0]["evidence"] == "I prefer tea than coffee"
    assert "mapping_id" not in stored[0]
    assert "signal_code" not in stored[0]
    name, payload = database.rpc.call_args.args
    assert name == "fn_replace_speaking_vocab_recommendations"
    assert payload["p_rows"][0] == {
        "id": rec["rec_id"], "mapping_id": rec["mapping_id"],
        "signal_code": rec["signal_code"], "unit_id": rec["unit_id"],
        "confidence": "high",
    }


def test_persistence_failure_never_returns_a_dangling_recommendation():
    database = MagicMock()
    database.rpc.return_value.execute.side_effect = RuntimeError("database unavailable")
    with patch.object(recommendations, "supabase_admin", database):
        assert recommendations.persist_recommendations(
            [{"rec_id": "r", "unit_id": "u"}],
            user_id="user", response_id="response",
        ) == []


def test_confirmed_recommendations_are_written_back_to_feedback_blob():
    query = MagicMock()
    query.eq.return_value.execute.return_value = SimpleNamespace(data=[])
    database = MagicMock()
    database.table.return_value.update.return_value = query
    grading = {
        "overall_band": 6.0,
        "vocab_recommendations": [{"rec_id": "r", "unit_slug": "prefer-x-to-y"}],
    }
    with patch.object(grading_router, "supabase_admin", database):
        saved = grading_router._persist_curated_vocab_feedback_blob(
            "response", grading=grading, signals={"length_warning": False},
        )
    assert saved is True
    stored = database.table.return_value.update.call_args.args[0]["feedback"]
    assert '"vocab_recommendations"' in stored
    assert '"prefer-x-to-y"' in stored


def test_recommendation_gate_requires_flag_read_switch_and_learner_cohort():
    states = {
        "vocab_unit_recommendations": True,
        "vocab_units_read": True,
    }
    with (
        patch.object(
            grading_router.runtime_flags,
            "is_enabled",
            side_effect=lambda key, default=False: states.get(key, default),
        ),
        patch.object(
            grading_router.feature_flags,
            "is_vocab_curated_enabled",
            return_value=True,
        ) as cohort,
    ):
        assert grading_router._curated_vocab_recommendations_enabled("eligible") is True
        cohort.return_value = False
        assert grading_router._curated_vocab_recommendations_enabled("outside-pilot") is False
        cohort.return_value = True
        states["vocab_units_read"] = False
        assert grading_router._curated_vocab_recommendations_enabled("read-disabled") is False


def test_recommendation_gate_short_circuits_when_recommendation_flag_is_off():
    with (
        patch.object(
            grading_router.runtime_flags, "is_enabled", return_value=False,
        ) as switches,
        patch.object(
            grading_router.feature_flags, "is_vocab_curated_enabled",
        ) as cohort,
    ):
        assert grading_router._curated_vocab_recommendations_enabled("user") is False
    switches.assert_called_once_with("vocab_unit_recommendations", default=False)
    cohort.assert_not_called()


def test_practice_parser_sanitizes_generic_evidence_without_requiring_it():
    payload = {
        "grammar_issues": [], "vocabulary_issues": [], "pronunciation_issues": [],
        "corrections": [], "strengths": ["clear"], "sample_answer": "A grounded answer.",
        "overall_band": 6.0,
        "vocabulary_evidence": [
            _candidate(),
            _candidate(issue_type="unknown"),
            "not-an-object",
        ],
    }
    import json
    parsed, error = claude_grader._parse_and_validate_practice(json.dumps(payload))
    assert error is None
    assert parsed["vocabulary_evidence"] == [_candidate()]

    payload.pop("vocabulary_evidence")
    parsed_without, error_without = claude_grader._parse_and_validate_practice(json.dumps(payload))
    assert error_without is None
    assert parsed_without["vocabulary_evidence"] == []


def test_migration_keeps_catalog_private_and_rechecks_canonical_truth():
    sql = (ROOT / "migrations" / "237_vocab_curated_speaking_signal_maps.sql").read_text("utf-8")
    assert "ALTER TABLE vocab_speaking_signal_maps ENABLE ROW LEVEL SECURITY" in sql
    assert "session.user_id = p_user" in sql
    assert "mapping.status = 'active'" in sql
    assert "unit.status <> 'published'" in sql
    assert "jsonb_array_length(p_rows) > 2" in sql
    assert "recommendation.status IN ('pending', 'opened')" in sql
    assert "char_length(signal_code) BETWEEN 3 AND 120" in sql
    assert "idx_vocab_speaking_signal_maps_creator" in sql
    assert "GRANT EXECUTE ON FUNCTION fn_replace_speaking_vocab_recommendations" in sql


def test_grading_contract_uses_generic_evidence_not_internal_catalog_codes():
    prompt = claude_grader.SYSTEM_PROMPT_PRACTICE
    assert '"vocabulary_evidence"' in prompt
    assert "do not name lessons, internal codes" in prompt
    assert "CURATED VOCABULARY SIGNAL CATALOG" not in prompt
    assert "prompt_catalog" not in Path(recommendations.__file__).read_text("utf-8")
