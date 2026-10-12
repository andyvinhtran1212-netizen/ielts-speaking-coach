from types import SimpleNamespace

import pytest

from services.claude_compat import json_request_kwargs, response_text


def test_haiku55_omits_rejected_sampling_and_leaves_room_for_new_tokenizer():
    request = json_request_kwargs("claude-haiku-5-5", max_tokens=512, temperature=0.3)
    assert request == {
        "model": "claude-haiku-5-5", "max_tokens": 666,
        "extra_body": {"thinking": {"type": "disabled"}},
    }


def test_haiku45_rollback_preserves_request_budget_and_sampling():
    assert json_request_kwargs("claude-haiku-4-5-20251001", max_tokens=400, temperature=0.3) == {
        "model": "claude-haiku-4-5-20251001", "max_tokens": 400, "temperature": 0.3,
    }


def test_text_is_selected_by_type_after_thinking():
    response = SimpleNamespace(stop_reason="end_turn", content=[
        SimpleNamespace(type="thinking", thinking="private reasoning"),
        SimpleNamespace(type="text", text='{"ok":'),
        SimpleNamespace(type="text", text='true}'),
    ])
    assert response_text(response) == '{"ok":true}'


@pytest.mark.parametrize("reason", ["refusal", "max_tokens", "model_context_window_exceeded"])
def test_noncompletion_never_enters_json_parser(reason):
    with pytest.raises(ValueError):
        response_text(SimpleNamespace(stop_reason=reason, content=[SimpleNamespace(type="text", text='{"ok":true}')]))


def test_empty_or_nontext_content_has_no_answer():
    assert response_text(SimpleNamespace(content=[])) == ""
    assert response_text(SimpleNamespace(content=[SimpleNamespace(type="thinking", thinking="")])) == ""
