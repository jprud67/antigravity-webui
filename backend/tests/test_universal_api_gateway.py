"""
test_universal_api_gateway.py — Tests exhaustifs pour la Passerelle API Universelle pour Applications Externes :
- OpenAI-compatible endpoints (/v1/models, /v1/models/{id}, /v1/chat/completions)
- Antigravity Native Agent API (/api/v1/agent/status, /api/v1/agent/models, /api/v1/agent/run, /api/v1/agent/interrupt, /api/v1/agent/steer)
- API Key and Bearer Authentication
- Streaming SSE protocols, error structures, and multimodal inputs
"""

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.auth import create_api_key, get_auth_config, save_auth_config

client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_api_auth():
    """Configure a known API key for testing external app gateway."""
    config = get_auth_config()
    orig_enabled = config.get("enabled", True)
    config["enabled"] = True
    save_auth_config(config)

    new_key_data = create_api_key("External Test Gateway")
    test_key = new_key_data["key"]

    yield test_key

    # Teardown
    cfg = get_auth_config()
    cfg["enabled"] = orig_enabled
    save_auth_config(cfg)


# ============================================================================
# 1. Authentication Security Tests
# ============================================================================

def test_gateway_auth_unauthorized_rejection(setup_api_auth):
    """External clients without API key must receive 401 Unauthorized."""
    resp = client.get("/v1/models")
    assert resp.status_code == 401
    assert "WWW-Authenticate" in resp.headers


def test_gateway_auth_with_bearer_token(setup_api_auth):
    """External clients with 'Authorization: Bearer <key>' must authenticate cleanly."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}
    resp = client.get("/v1/models", headers=headers)
    assert resp.status_code == 200


def test_gateway_auth_with_x_api_key_header(setup_api_auth):
    """External clients with 'X-API-Key: <key>' must authenticate cleanly."""
    test_key = setup_api_auth
    headers = {"X-API-Key": test_key}
    resp = client.get("/v1/models", headers=headers)
    assert resp.status_code == 200


def test_gateway_auth_invalid_key_rejected(setup_api_auth):
    """External clients with an invalid API key must receive 401 Unauthorized."""
    headers = {"Authorization": "Bearer invalid_key_12345"}
    resp = client.get("/v1/models", headers=headers)
    assert resp.status_code == 401


# ============================================================================
# 2. OpenAI Compatibility: /v1/models
# ============================================================================

def test_v1_models_discovery(setup_api_auth):
    """Standard OpenAI /v1/models discovery endpoint."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    resp = client.get("/v1/models", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("object") == "list"
    assert isinstance(data.get("data"), list)
    assert len(data["data"]) > 0

    first_model = data["data"][0]
    assert "id" in first_model
    assert first_model["object"] == "model"
    assert first_model["owned_by"] == "antigravity"


def test_v1_model_retrieve(setup_api_auth):
    """Standard OpenAI /v1/models/{model_id} endpoint."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    resp = client.get("/v1/models/gemini-3.8-flash", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["id"] == "gemini-3.8-flash"
    assert data["object"] == "model"
    assert data["owned_by"] == "antigravity"


# ============================================================================
# 3. OpenAI Compatibility: /v1/chat/completions
# ============================================================================

def test_v1_chat_completions_empty_prompt_validation(setup_api_auth):
    """Calling /v1/chat/completions with empty messages returns OpenAI-formatted 400."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    payload = {
        "model": "gemini-3.8-flash",
        "messages": []
    }
    resp = client.post("/v1/chat/completions", json=payload, headers=headers)
    assert resp.status_code == 400
    err_body = resp.json()
    assert "error" in err_body or "detail" in err_body
    error_obj = err_body.get("detail", {}).get("error") or err_body.get("error")
    assert error_obj is not None
    assert error_obj.get("code") == "empty_prompt"
    assert error_obj.get("type") == "invalid_request_error"


def test_v1_chat_completions_sync(setup_api_auth):
    """Sync execution of /v1/chat/completions returning OpenAI standard payload."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    mock_events = [
        {"event": "step_update", "step_update": {"thinking": "Réflexion en cours..."}},
        {"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Bonjour ! "}},
        {"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Comment puis-je vous aider ?"}},
        {"event": "result", "result": {"response": "Bonjour ! Comment puis-je vous aider ?", "usage": {"input_tokens": 12, "output_tokens": 8}}}
    ]

    async def mock_stream_turn(*args, **kwargs):
        for evt in mock_events:
            yield evt

    with patch("app.api.openai_compat.stream_turn", side_effect=mock_stream_turn):
        payload = {
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Bonjour"}]
        }
        resp = client.post("/v1/chat/completions", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data.get("object") == "chat.completion"
        assert data["model"] == "gemini-3.8-flash"
        assert len(data["choices"]) == 1
        choice = data["choices"][0]
        assert choice["message"]["role"] == "assistant"
        assert "Bonjour ! Comment puis-je vous aider ?" in choice["message"]["content"]
        assert choice["message"]["reasoning_content"] == "Réflexion en cours..."
        assert choice["finish_reason"] == "stop"
        assert data["usage"]["total_tokens"] == 20


def test_v1_chat_completions_streaming(setup_api_auth):
    """Streaming SSE execution of /v1/chat/completions returning valid chunks and [DONE]."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    mock_events = [
        {"event": "step_update", "step_update": {"thinking": "Analyse..."}},
        {"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Réponse"}},
        {"event": "result", "result": {"usage": {"totalTokens": 15}}}
    ]

    async def mock_stream_turn(*args, **kwargs):
        for evt in mock_events:
            yield evt

    with patch("app.api.openai_compat.stream_turn", side_effect=mock_stream_turn):
        payload = {
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Test stream"}],
            "stream": True
        }
        resp = client.post("/v1/chat/completions", json=payload, headers=headers)
        assert resp.status_code == 200
        assert "text/event-stream" in resp.headers["content-type"]

        lines = [line.strip() for line in resp.text.split("\n") if line.strip()]
        assert "data: [DONE]" in lines

        # Verify parsed data chunks
        chunks = []
        for line in lines:
            if line.startswith("data: ") and line != "data: [DONE]":
                chunks.append(json.loads(line[6:]))

        assert len(chunks) >= 2
        # First chunk contains role
        assert chunks[0]["choices"][0]["delta"].get("role") == "assistant"
        # Reasoning chunk
        assert "reasoning_content" in chunks[0]["choices"][0]["delta"]
        # Stop chunk has finish_reason == 'stop'
        last_chunk = chunks[-1]
        assert last_chunk["choices"][0]["finish_reason"] == "stop"


def test_v1_chat_completions_multimodal_extraction(setup_api_auth):
    """Verify OpenAI vision / multi-part messages with image_url are correctly extracted."""
    from app.api.openai_compat import _extract_message_content

    # 1. Text + URL image
    complex_content = [
        {"type": "text", "text": "Regarde cette capture :"},
        {"type": "image_url", "image_url": {"url": "https://example.com/screenshot.png"}},
    ]
    extracted = _extract_message_content(complex_content)
    assert "Regarde cette capture :" in extracted
    assert "[Image attachment: https://example.com/screenshot.png]" in extracted

    # 2. Large data:image base64 URI is cleanly summarized
    b64_dummy = "A" * 200
    data_uri_content = [
        {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64_dummy}"}}
    ]
    extracted_b64 = _extract_message_content(data_uri_content)
    assert "[Image attachment: image/png" in extracted_b64
    assert b64_dummy not in extracted_b64  # Safeguard against huge token payload


def test_v1_chat_completions_tool_calling(setup_api_auth):
    """Verify tool calling with tools definitions delegates to tool_bridge."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    mock_outcome = {
        "kind": "tool_call",
        "name": "get_weather",
        "arguments": {"location": "Paris"},
        "id": "call_123456",
        "thinking": "Besoin de la météo pour répondre",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}
    }

    with patch("app.services.tool_bridge.run_turn", return_value=mock_outcome):
        payload = {
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Quelle est la météo à Paris ?"}],
            "tools": [
                {
                    "type": "function",
                    "function": {
                        "name": "get_weather",
                        "description": "Obtenir la météo",
                        "parameters": {
                            "type": "object",
                            "properties": {"location": {"type": "string"}},
                            "required": ["location"]
                        }
                    }
                }
            ]
        }
        resp = client.post("/v1/chat/completions", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["choices"][0]["finish_reason"] == "tool_calls"
        tool_call = data["choices"][0]["message"]["tool_calls"][0]
        assert tool_call["function"]["name"] == "get_weather"
        assert json.loads(tool_call["function"]["arguments"]) == {"location": "Paris"}


# ============================================================================
# 4. Native Agent API: /api/v1/agent/*
# ============================================================================

def test_native_agent_status(setup_api_auth):
    """Verify /api/v1/agent/status returns comprehensive system state."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    resp = client.get("/api/v1/agent/status", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ready"
    assert data["service"] == "antigravity-webui"
    assert "default_workspace" in data
    assert "running_conversations" in data
    assert "running_count" in data


def test_native_agent_models(setup_api_auth):
    """Verify /api/v1/agent/models returns model families."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    resp = client.get("/api/v1/agent/models", headers=headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "models" in data
    assert isinstance(data["models"], list)


def test_native_agent_run_sync(setup_api_auth):
    """Verify /api/v1/agent/run in synchronous mode (stream=false)."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    mock_events = [
        {"event": "init", "conversation_id": "test-agent-conv-1"},
        {"event": "step_update", "step_update": {"thinking": "Plan d'action..."}},
        {"event": "step_update", "step_update": {"step_type": "agent_response", "text_delta": "Tâche terminée avec succès !"}},
        {"event": "result", "result": {"response": "Tâche terminée avec succès !", "usage": {"inputTokens": 50, "outputTokens": 20}}}
    ]

    async def mock_stream_turn(*args, **kwargs):
        for evt in mock_events:
            yield evt

    with patch("app.api.agent_api.stream_turn", side_effect=mock_stream_turn):
        payload = {
            "prompt": "Analyse ce projet et propose un plan",
            "stream": False
        }
        resp = client.post("/api/v1/agent/run", json=payload, headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "success"
        assert data["conversation_id"] == "test-agent-conv-1"
        assert "Tâche terminée avec succès !" in data["text"]
        assert data["thought"] == "Plan d'action..."


def test_native_agent_run_empty_prompt_validation(setup_api_auth):
    """Verify /api/v1/agent/run rejects empty prompts with 400."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    payload = {"prompt": "   ", "stream": False}
    resp = client.post("/api/v1/agent/run", json=payload, headers=headers)
    assert resp.status_code == 400
    assert "prompt" in resp.json()["detail"].lower()


def test_native_agent_interrupt_and_steer_guards(setup_api_auth):
    """Verify interrupt and steer route guards."""
    test_key = setup_api_auth
    headers = {"Authorization": f"Bearer {test_key}"}

    # Interruption without active session is handled gracefully
    int_resp = client.post("/api/v1/agent/interrupt", json={}, headers=headers)
    assert int_resp.status_code == 200
    assert int_resp.json()["success"] is True

    # Steer with empty instruction raises 400
    steer_resp = client.post("/api/v1/agent/steer", json={"instruction": ""}, headers=headers)
    assert steer_resp.status_code == 400


def test_api_keys_bulk_delete_and_rotate(setup_api_auth):
    """Verify bulk delete and bulk rotate endpoints for API gateway keys."""
    from app.services.auth import create_access_token, create_api_key, get_api_keys

    admin_token = create_access_token()
    admin_headers = {"Authorization": f"Bearer {admin_token}"}

    k1 = create_api_key("App 1")
    k2 = create_api_key("App 2")
    k3 = create_api_key("App 3")

    # Test Bulk Rotate
    rotate_resp = client.post(
        "/api/auth/api-keys/bulk-rotate",
        json={"key_ids": [k1["id"], k2["id"]]},
        headers=admin_headers
    )
    assert rotate_resp.status_code == 200
    r_data = rotate_resp.json()
    assert r_data["success"] is True
    assert r_data["count"] == 2
    rotated_map = {item["id"]: item["key"] for item in r_data["rotated_keys"]}
    assert rotated_map[k1["id"]] != k1["key"]
    assert rotated_map[k2["id"]] != k2["key"]
    assert rotated_map[k1["id"]].startswith("agy_sk_")

    # Test Bulk Delete
    del_resp = client.post(
        "/api/auth/api-keys/bulk-delete",
        json={"key_ids": [k1["id"], k3["id"]]},
        headers=admin_headers
    )
    assert del_resp.status_code == 200
    del_data = del_resp.json()
    assert del_data["success"] is True
    assert del_data["deleted_count"] == 2
    assert set(del_data["deleted_ids"]) == {k1["id"], k3["id"]}

    # Verify k1 and k3 are gone, k2 remains
    remaining_keys = get_api_keys()
    remaining_ids = {item["id"] for item in remaining_keys}
    assert k1["id"] not in remaining_ids
    assert k3["id"] not in remaining_ids
    assert k2["id"] in remaining_ids
