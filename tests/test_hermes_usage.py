"""Current normalized Hermes observer telemetry, with older-runtime fallback."""
import sys
import types

import pytest

import __init__ as office


def test_hermes_usage_uses_stable_request_and_inclusive_prompt(monkeypatch):
    events = []
    monkeypatch.setattr(office, "_publish", events.append)
    fields = {"session_id": "session", "api_request_id": "request", "turn_id": "turn",
              "model": "requested", "response_model": "served", "provider": "provider",
              "platform": "telegram", "usage": {"input_tokens": 5, "prompt_tokens": 35,
                  "cache_read_tokens": 20, "cache_write_tokens": 10, "output_tokens": 8,
                  "reasoning_tokens": 3, "total_tokens": 43}}
    assert office._post_api_request(**fields) is None
    event = events.pop()
    assert event["event"] == "usage" and event["platform"] == "hermes"
    assert event["usage_id"] == "request" and event["model"] == "served"
    assert event["input_tokens"] == 35 and event["output_tokens"] == 8
    assert event["cached_input_tokens"] == 20 and event["cache_write_tokens"] == 10
    assert event["reasoning_output_tokens"] == 3 and event["total_tokens"] == 43
    assert "cost_usd" not in event
    office._post_api_request(**fields)
    assert events[0] == event


@pytest.mark.parametrize("changes", [{"session_id": ""}, {"api_request_id": ""}, {"usage": None}, {"usage": []}])
def test_hermes_usage_requires_real_identity_and_mapping(monkeypatch, changes):
    events = []
    monkeypatch.setattr(office, "_publish", events.append)
    office._post_api_request(**{"session_id": "s", "api_request_id": "a", "usage": {"prompt_tokens": 1}, **changes})
    assert events == []


def test_hermes_optional_hooks_are_feature_detected_and_never_return_context(monkeypatch):
    plugins = types.ModuleType("hermes_cli.plugins")
    plugins.VALID_HOOKS = {"pre_llm_call", "post_llm_call", "post_api_request"}
    monkeypatch.setitem(sys.modules, "hermes_cli.plugins", plugins)
    registered = {}
    office.register(types.SimpleNamespace(register_hook=lambda name, callback: registered.setdefault(name, callback)))
    assert {"pre_llm_call", "post_llm_call", "post_api_request"} <= registered.keys()
    events = []
    monkeypatch.setattr(office, "_publish", events.append)
    assert registered["pre_llm_call"](session_id="s", user_message="private") is None
    assert registered["post_llm_call"](session_id="s", assistant_response="private") is None
    assert [event["event"] for event in events] == ["session_busy", "session_idle"]
    assert all("private" not in str(event) for event in events)


def test_older_hermes_keeps_existing_hooks_without_registering_unsupported_names(monkeypatch):
    plugins = types.ModuleType("hermes_cli.plugins")
    plugins.VALID_HOOKS = {"pre_llm_call"}
    monkeypatch.setitem(sys.modules, "hermes_cli.plugins", plugins)
    registered = {}
    office.register(types.SimpleNamespace(register_hook=lambda name, callback: registered.setdefault(name, callback)))
    assert "pre_tool_call" in registered and "pre_llm_call" in registered
    assert "post_api_request" not in registered and "post_llm_call" not in registered
