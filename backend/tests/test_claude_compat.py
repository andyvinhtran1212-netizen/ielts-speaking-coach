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


@pytest.mark.parametrize("reason", ["refusal", "model_context_window_exceeded"])
def test_pinned_sdk_deserializes_new_stop_reasons_before_guard(reason):
    import anthropic
    import httpx

    response = {
        "id": "msg_test", "type": "message", "role": "assistant",
        "model": "claude-haiku-5-5",
        "content": [{"type": "text", "text": "Cannot complete."}],
        "stop_reason": reason, "stop_sequence": None,
        "usage": {"input_tokens": 20, "output_tokens": 5},
    }
    # Exercise the real HTTP deserializer with the same default client options
    # as the application, rather than constructing a permissive test namespace.
    with anthropic.Anthropic(api_key="test", http_client=httpx.Client(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json=response)),
    )) as client:
        msg = client.messages.create(
            model="claude-haiku-5-5", max_tokens=20,
            messages=[{"role": "user", "content": "test"}],
        )
    assert msg.stop_reason == reason
    assert msg.usage.input_tokens == 20
    assert msg.usage.output_tokens == 5
    with pytest.raises(ValueError):
        response_text(msg)
