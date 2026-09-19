"""
Tests du pont tool calling OpenAI (/v1/chat/completions).

- Tests unitaires : rendu de conversation, prompt, normalisation des décisions.
- Failover : `stream_turn` et la bascule de compte sont stubbés (zéro run agy, zéro quota).
- HTTP : TestClient FastAPI, `tool_bridge.run_turn` monkeypatché (sync + streaming SSE).
- Test live (opt-in, consomme le quota Google) : AGY_LIVE_TEST=1 pytest test_tool_bridge.py
"""

import asyncio
import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import tool_bridge
from app.services.auth import create_access_token
from app.services.tool_bridge import (
    _find_json_object,
    build_prompt,
    normalize_decision,
    render_conversation,
)

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}


def _auth_headers() -> dict:
    return {"Authorization": f"Bearer {create_access_token()}"}


# ============================================================================
# Rendu de conversation / prompt
# ============================================================================

def test_render_conversation_includes_tool_calls_and_results():
    messages = [
        {"role": "system", "content": "Tu es un assistant."},
        {"role": "user", "content": "Météo à Paris ?"},
        {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {
                    "id": "call_1",
                    "type": "function",
                    "function": {"name": "get_weather", "arguments": '{"city": "Paris"}'},
                }
            ],
        },
        {"role": "tool", "tool_call_id": "call_1", "name": "get_weather", "content": '{"temp": 18}'},
        {"role": "user", "content": "Et demain ?"},
    ]
    text = render_conversation(messages)
    assert "[System]\nTu es un assistant." in text
    assert "[User]\nMétéo à Paris ?" in text
    assert "[Assistant tool_calls]" in text
    assert "id=call_1 name=get_weather" in text
    assert '"city": "Paris"' in text
    assert "[Tool result] (call_id=call_1, name=get_weather)" in text
    assert '{"temp": 18}' in text
    assert "[User]\nEt demain ?" in text


def test_build_prompt_contains_protocol_and_tools():
    prompt = build_prompt([{"role": "user", "content": "hello"}], [WEATHER_TOOL])
    assert "API SIMULATION MODE" in prompt
    assert "get_weather" in prompt
    assert '"action":"tool_call"' in prompt
    assert "AVAILABLE FUNCTIONS" in prompt
    assert "NEXT STEP" in prompt


def test_build_prompt_tool_choice_hints():
    prompt = build_prompt([{"role": "user", "content": "x"}], [WEATHER_TOOL], tool_choice="required")
    assert "You MUST request a function call" in prompt
    prompt2 = build_prompt(
        [{"role": "user", "content": "x"}],
        [WEATHER_TOOL],
        tool_choice={"type": "function", "function": {"name": "get_weather"}},
    )
    assert "`get_weather`" in prompt2
    prompt3 = build_prompt([{"role": "user", "content": "x"}], [WEATHER_TOOL], tool_choice="auto")
    assert "You MUST" not in prompt3


def test_build_prompt_truncates_oversized_conversation(monkeypatch):
    monkeypatch.setattr(tool_bridge, "MAX_PROMPT_CHARS", 500)
    big = "A" * 5000
    prompt = build_prompt([{"role": "user", "content": big}], [WEATHER_TOOL])
    assert "TRONQUÉE" in prompt
    assert len(prompt) <= 500 + 200  # marge pour le marqueur


# ============================================================================
# Normalisation des décisions
# ============================================================================

def test_normalize_decision_tool_call():
    allowed = {"get_weather": "get_weather"}
    decision = normalize_decision(
        {"action": "tool_call", "tool": "get_weather", "arguments": {"city": "Paris"}, "content": ""},
        allowed,
        {"input_tokens": 5},
        None,
    )
    assert decision["kind"] == "tool_call"
    assert decision["name"] == "get_weather"
    assert decision["arguments"] == {"city": "Paris"}
    assert decision["id"].startswith("call_")


def test_normalize_decision_accepts_string_arguments_and_case_insensitive_name():
    allowed = {"get_weather": "get_weather"}
    decision = normalize_decision(
        {"action": "tool_call", "tool": "GET_WEATHER", "arguments": '{"city": "Lyon"}', "content": ""},
        allowed,
        None,
        None,
    )
    assert decision["kind"] == "tool_call"
    assert decision["name"] == "get_weather"
    assert decision["arguments"] == {"city": "Lyon"}


def test_normalize_decision_unknown_tool_falls_back_to_text():
    decision = normalize_decision(
        {"action": "tool_call", "tool": "unknown_fn", "arguments": {}, "content": ""},
        {"get_weather": "get_weather"},
        None,
        None,
    )
    assert decision["kind"] == "final"
    assert "unknown_fn" in decision["content"]


def test_normalize_decision_final():
    decision = normalize_decision(
        {"action": "final", "tool": "", "arguments": {}, "content": "Voilà la réponse."},
        {},
        None,
        "un peu de réflexion",
    )
    assert decision["kind"] == "final"
    assert decision["content"] == "Voilà la réponse."
    assert decision["thinking"] == "un peu de réflexion"


def test_content_to_text_summarizes_data_uris_and_multimodal_blocks():
    from app.services.tool_bridge import _content_to_text

    # String with large base64 data URI
    dummy_b64 = "A" * 200
    text_with_data_uri = f"Regarde cette image: data:image/png;base64,{dummy_b64} fin."
    result = _content_to_text(text_with_data_uri)
    assert "[Image attachment: image/png" in result
    assert dummy_b64 not in result

    # Multimodal parts list with text, image_url (data URI and remote URI), audio
    multi_part = [
        {"type": "text", "text": "Décris ce document :"},
        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{dummy_b64}"}},
        {"type": "image_url", "image_url": "https://example.com/photo.png"},
        {"type": "input_audio", "input_audio": {"data": dummy_b64}},
    ]
    multi_res = _content_to_text(multi_part)
    assert "Décris ce document :" in multi_res
    assert "[Image attachment: image/jpeg" in multi_res
    assert "[Image attachment: https://example.com/photo.png]" in multi_res
    assert "[Audio attachment]" in multi_res


def test_normalize_decision_fallback_tool_keys():
    allowed = {"get_weather": "get_weather"}
    # Model returns "name" instead of "tool"
    d1 = normalize_decision(
        {"action": "tool_call", "name": "get_weather", "arguments": {"city": "Marseille"}},
        allowed,
        None,
        None,
    )
    assert d1["kind"] == "tool_call"
    assert d1["name"] == "get_weather"
    assert d1["arguments"] == {"city": "Marseille"}

    # Model returns "function" dict
    d2 = normalize_decision(
        {"action": "tool_call", "function": {"name": "get_weather"}, "arguments": {"city": "Bordeaux"}},
        allowed,
        None,
        None,
    )
    assert d2["kind"] == "tool_call"
    assert d2["name"] == "get_weather"
    assert d2["arguments"] == {"city": "Bordeaux"}



def test_find_json_object_prefers_action_key():
    text = 'blabla ```json\n{"foo": 1}\n``` puis {"action": "final", "tool": "", "arguments": {}, "content": "ok"}'
    obj = _find_json_object(text)
    assert isinstance(obj, dict)
    assert obj.get("action") == "final"


# ============================================================================
# Failover (stubs — aucun run agy réel)
# ============================================================================

def _result_event(structured: dict) -> dict:
    return {
        "event": "result",
        "result": {
            "status": "SUCCESS",
            "structured_output": structured,
            "response": "",
            "usage": {"input_tokens": 10, "output_tokens": 5, "total_tokens": 15},
        },
    }


def _quota_error_event() -> dict:
    return {
        "event": "error",
        "code": 1,
        "message": "Run: attempt 1 failed (RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h) ...",
    }


def test_run_turn_auto_failover_switches_account_and_retries(monkeypatch):
    calls = {"count": 0}

    async def fake_stream_turn(**kwargs):
        calls["count"] += 1
        assert kwargs.get("json_schema") == tool_bridge.ENVELOPE_SCHEMA
        assert kwargs.get("skip_permissions") is False
        assert kwargs.get("sandbox") is True
        assert kwargs.get("auto_approve") is False
        events = (
            [_quota_error_event()]
            if calls["count"] == 1
            else [_result_event({"action": "tool_call", "tool": "get_weather", "arguments": {"city": "Paris"}, "content": ""})]
        )
        for event in events:
            yield event

    switched: list = []
    monkeypatch.setattr(tool_bridge, "stream_turn", fake_stream_turn)
    monkeypatch.setattr(tool_bridge, "get_active_account", lambda: {"email": "old@example.com"})
    monkeypatch.setattr(
        tool_bridge,
        "switch_to_next_healthy_account",
        lambda exclude_email=None, model=None: (switched.append(exclude_email) or "new@example.com"),
    )
    monkeypatch.setattr(tool_bridge, "FAILOVER_PAUSE_S", 0.0)

    outcome = asyncio.run(
        tool_bridge.run_turn(
            messages=[{"role": "user", "content": "Météo à Paris ?"}],
            tools=[WEATHER_TOOL],
            model="gemini-3.8-flash",
        )
    )
    assert outcome["kind"] == "tool_call"
    assert outcome["name"] == "get_weather"
    assert calls["count"] == 2
    assert switched == ["old@example.com"]


def test_run_turn_quota_without_alternative_returns_error(monkeypatch):
    async def fake_stream_turn(**kwargs):
        yield _quota_error_event()

    monkeypatch.setattr(tool_bridge, "stream_turn", fake_stream_turn)
    monkeypatch.setattr(tool_bridge, "get_active_account", lambda: {"email": "only@example.com"})
    monkeypatch.setattr(tool_bridge, "switch_to_next_healthy_account", lambda exclude_email=None, model=None: None)

    outcome = asyncio.run(
        tool_bridge.run_turn(messages=[{"role": "user", "content": "x"}], tools=[WEATHER_TOOL])
    )
    assert outcome["kind"] == "error"
    assert outcome["quota"] is True


def test_run_turn_final_decision(monkeypatch):
    async def fake_stream_turn(**kwargs):
        yield _result_event({"action": "final", "tool": "", "arguments": {}, "content": "18°C à Paris."})

    monkeypatch.setattr(tool_bridge, "stream_turn", fake_stream_turn)
    outcome = asyncio.run(
        tool_bridge.run_turn(messages=[{"role": "user", "content": "x"}], tools=[WEATHER_TOOL])
    )
    assert outcome["kind"] == "final"
    assert "Paris" in outcome["content"]


def test_run_turn_non_quota_error(monkeypatch):
    async def fake_stream_turn(**kwargs):
        yield {"event": "error", "code": 2, "message": "invalid value for flag --model"}

    monkeypatch.setattr(tool_bridge, "stream_turn", fake_stream_turn)
    outcome = asyncio.run(
        tool_bridge.run_turn(messages=[{"role": "user", "content": "x"}], tools=[WEATHER_TOOL])
    )
    assert outcome["kind"] == "error"
    assert outcome["quota"] is False


# ============================================================================
# Endpoint HTTP /v1/chat/completions (run_turn monkeypatché — zéro quota)
# ============================================================================

def test_http_tool_call_sync(monkeypatch):
    from app.api import openai_compat

    async def fake_run_turn(**kwargs):
        assert kwargs["tools"] and kwargs["tools"][0]["function"]["name"] == "get_weather"
        assert kwargs["messages"][-1]["role"] == "user"
        return {
            "kind": "tool_call",
            "id": "call_test123",
            "name": "get_weather",
            "arguments": {"city": "Paris"},
            "usage": {"input_tokens": 12, "output_tokens": 8},
            "thinking": None,
        }

    monkeypatch.setattr(openai_compat.tool_bridge, "run_turn", fake_run_turn)
    client = TestClient(app)
    res = client.post(
        "/v1/chat/completions",
        headers=_auth_headers(),
        json={
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Météo à Paris ?"}],
            "tools": [WEATHER_TOOL],
            "stream": False,
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    choice = data["choices"][0]
    assert choice["finish_reason"] == "tool_calls"
    call = choice["message"]["tool_calls"][0]
    assert call["id"] == "call_test123"
    assert call["type"] == "function"
    assert call["function"]["name"] == "get_weather"
    assert json.loads(call["function"]["arguments"]) == {"city": "Paris"}
    assert data["usage"]["prompt_tokens"] == 12
    assert data["usage"]["completion_tokens"] == 8


def test_http_text_response_sync(monkeypatch):
    from app.api import openai_compat

    async def fake_run_turn(**kwargs):
        return {"kind": "final", "content": "18°C et ensoleillé.", "usage": None, "thinking": None}

    monkeypatch.setattr(openai_compat.tool_bridge, "run_turn", fake_run_turn)
    client = TestClient(app)
    res = client.post(
        "/v1/chat/completions",
        headers=_auth_headers(),
        json={
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Météo ?"}],
            "tools": [WEATHER_TOOL],
            "stream": False,
        },
    )
    assert res.status_code == 200, res.text
    choice = res.json()["choices"][0]
    assert choice["finish_reason"] == "stop"
    assert choice["message"]["content"] == "18°C et ensoleillé."
    assert "tool_calls" not in choice["message"]


def test_http_tool_choice_none_bypasses_bridge(monkeypatch):
    from app.api import openai_compat

    async def fake_run_turn(**kwargs):  # ne doit jamais être appelé
        raise AssertionError("run_turn aurait dû être ignoré avec tool_choice='none'")

    async def fake_stream_turn(*args, **kwargs):
        yield {"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "texte direct"}}
        yield {"event": "result", "result": {"status": "SUCCESS", "response": "texte direct", "usage": {}}}

    monkeypatch.setattr(openai_compat.tool_bridge, "run_turn", fake_run_turn)
    monkeypatch.setattr(openai_compat, "stream_turn", fake_stream_turn)
    client = TestClient(app)
    res = client.post(
        "/v1/chat/completions",
        headers=_auth_headers(),
        json={
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Bonjour"}],
            "tools": [WEATHER_TOOL],
            "tool_choice": "none",
            "stream": False,
        },
    )
    assert res.status_code == 200, res.text
    assert "texte direct" in res.json()["choices"][0]["message"]["content"]


def test_http_tool_call_stream(monkeypatch):
    from app.api import openai_compat

    async def fake_run_turn(**kwargs):
        return {
            "kind": "tool_call",
            "id": "call_stream1",
            "name": "get_weather",
            "arguments": {"city": "Nice"},
            "usage": {"input_tokens": 3, "output_tokens": 2},
            "thinking": None,
        }

    monkeypatch.setattr(openai_compat.tool_bridge, "run_turn", fake_run_turn)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/chat/completions",
        headers=_auth_headers(),
        json={
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Météo à Nice ?"}],
            "tools": [WEATHER_TOOL],
            "stream": True,
        },
    ) as res:
        assert res.status_code == 200
        body = "".join(res.iter_text())

    assert body.endswith("data: [DONE]\n\n")
    chunks = [
        json.loads(line[len("data: "):])
        for line in body.splitlines()
        if line.startswith("data: ") and line[len("data: "):].strip() != "[DONE]"
    ]
    tool_chunks = [c for c in chunks if c["choices"][0]["delta"].get("tool_calls")]
    assert tool_chunks, body
    first_call = tool_chunks[0]["choices"][0]["delta"]["tool_calls"][0]
    assert first_call["id"] == "call_stream1"
    assert first_call["function"]["name"] == "get_weather"
    args_chunks = [
        c["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"]
        for c in tool_chunks
        if c["choices"][0]["delta"]["tool_calls"][0]["function"].get("arguments")
    ]
    assert json.loads("".join(args_chunks)) == {"city": "Nice"}
    assert any(c["choices"][0]["finish_reason"] == "tool_calls" for c in chunks)


def test_http_text_stream(monkeypatch):
    from app.api import openai_compat

    async def fake_run_turn(**kwargs):
        return {"kind": "final", "content": "Bonjour !", "usage": None, "thinking": None}

    monkeypatch.setattr(openai_compat.tool_bridge, "run_turn", fake_run_turn)
    client = TestClient(app)
    with client.stream(
        "POST",
        "/v1/chat/completions",
        headers=_auth_headers(),
        json={
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "salut"}],
            "tools": [WEATHER_TOOL],
            "stream": True,
        },
    ) as res:
        body = "".join(res.iter_text())

    chunks = [
        json.loads(line[len("data: "):])
        for line in body.splitlines()
        if line.startswith("data: ") and line[len("data: "):].strip() != "[DONE]"
    ]
    content = "".join(
        c["choices"][0]["delta"].get("content") or "" for c in chunks
    )
    assert content == "Bonjour !"
    assert any(c["choices"][0]["finish_reason"] == "stop" for c in chunks)


# ============================================================================
# Test live (opt-in — consomme le quota Google)
# ============================================================================

@pytest.mark.skipif(
    os.environ.get("AGY_LIVE_TEST") != "1",
    reason="Test live désactivé par défaut (AGY_LIVE_TEST=1 pour l'activer, consomme le quota Google)",
)
def test_live_tool_call_roundtrip():
    messages = [{"role": "user", "content": "Quel temps fait-il à Paris ? Utilise l'outil."}]
    outcome = asyncio.run(
        tool_bridge.run_turn(messages=messages, tools=[WEATHER_TOOL], model="gemini-3.8-flash-low")
    )
    assert outcome["kind"] == "tool_call", outcome
    assert outcome["name"] == "get_weather"
    assert "city" in outcome["arguments"]
