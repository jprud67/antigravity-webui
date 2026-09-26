import pytest
import time
from datetime import datetime, timezone, timedelta
from app.services import share_service


def test_create_and_verify_share_link():
    link = share_service.create_share_link("conv_test_123", permission="read", duration_hours=24)
    assert "token" in link
    assert link["permission"] == "read"
    assert link["conversation_id"] == "conv_test_123"
    assert link["is_revoked"] == 0
    assert link["has_pin"] is False
    assert link["expires_at"] is not None

    # Verify without PIN
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is True
    assert res["conversation_id"] == "conv_test_123"
    assert res["permission"] == "read"
    assert res["requires_pin"] is False


def test_pin_protection():
    link = share_service.create_share_link("conv_test_pin", permission="write", pin_code="1234")
    assert link["has_pin"] is True

    # Verify without pin should report requires_pin
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is False
    assert res["requires_pin"] is True

    # Verify with wrong pin
    res_wrong = share_service.verify_share_token(link["token"], pin_code="9999")
    assert res_wrong["valid"] is False
    assert res_wrong.get("reason") == "invalid_pin"

    # Verify with correct pin
    res_correct = share_service.verify_share_token(link["token"], pin_code="1234")
    assert res_correct["valid"] is True
    assert res_correct["permission"] == "write"
    assert res_correct["conversation_id"] == "conv_test_pin"


def test_revocation():
    link = share_service.create_share_link("conv_test_revoke", permission="read")
    revoked = share_service.revoke_share_link(link["token"])
    assert revoked is True

    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is False
    assert res.get("reason") == "revoked"


def test_expiration():
    # Negative duration to simulate expired token
    link = share_service.create_share_link("conv_test_expired", permission="read", duration_hours=-1)
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is False
    assert res.get("reason") == "expired"


def test_list_share_links():
    cid = f"conv_list_{int(time.time())}"
    l1 = share_service.create_share_link(cid, permission="read", duration_hours=1)
    l2 = share_service.create_share_link(cid, permission="write", pin_code="5678")

    links = share_service.list_share_links(cid)
    tokens = [l["token"] for l in links]
    assert l1["token"] in tokens
    assert l2["token"] in tokens

    # Ensure pin_hash is NOT leaked in list_share_links
    for item in links:
        assert "pin_hash" not in item
        assert "has_pin" in item


from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_api_auth_guard():
    # Unauthenticated requests should be rejected with 401 or 403
    res_create = client.post("/api/share/create", json={"conversation_id": "test_c", "permission": "read"})
    assert res_create.status_code in (401, 403)

    res_links = client.get("/api/share/links/test_c")
    assert res_links.status_code in (401, 403)

    res_revoke = client.post("/api/share/revoke/dummy_token")
    assert res_revoke.status_code in (401, 403)


def test_api_create_and_verify_flow():
    headers = get_auth_headers()
    cid = "conv_api_flow"
    res_create = client.post("/api/share/create", json={
        "conversation_id": cid,
        "permission": "write",
        "duration_hours": 12,
        "pin_code": "4321"
    }, headers=headers)
    assert res_create.status_code == 200
    data = res_create.json()
    assert "token" in data
    assert data["permission"] == "write"
    assert data["has_pin"] is True
    token = data["token"]

    # Public verify without PIN
    res_verify = client.get(f"/api/share/verify/{token}")
    assert res_verify.status_code == 200
    vdata = res_verify.json()
    assert vdata["valid"] is False
    assert vdata["requires_pin"] is True

    # Public unlock with wrong PIN
    res_wrong = client.post(f"/api/share/unlock/{token}", json={"pin_code": "0000"})
    assert res_wrong.status_code == 400
    assert res_wrong.json()["detail"] == "invalid_pin"

    # Public unlock with correct PIN
    res_unlock = client.post(f"/api/share/unlock/{token}", json={"pin_code": "4321"})
    assert res_unlock.status_code == 200
    udata = res_unlock.json()
    assert udata["valid"] is True
    assert udata["permission"] == "write"

    # Revoke via API
    res_revoke = client.post(f"/api/share/revoke/{token}", headers=headers)
    assert res_revoke.status_code == 200
    assert res_revoke.json()["success"] is True

    # Public verify after revocation
    res_after = client.get(f"/api/share/verify/{token}")
    assert res_after.status_code == 200
    assert res_after.json()["valid"] is False
    assert res_after.json()["reason"] == "revoked"


def test_ws_share_spectator_read_only():
    cid = "conv_ws_spectator"
    link = share_service.create_share_link(cid, permission="read")
    token = link["token"]

    # Connect via WebSocket with share_token
    with client.websocket_connect(f"/ws/chat?share_token={token}") as ws:
        ev1 = ws.receive_json()
        assert ev1["event"] == "connected"
        assert ev1["role"] == "spectator"

        ev2 = ws.receive_json()
        assert ev2["event"] == "presence_update"
        assert ev2["count"] >= 1

        # Try to submit a prompt as spectator -> must be rejected with forbidden
        ws.send_json({"action": "prompt", "conversation_id": cid, "prompt": "rm -rf /"})
        resp = ws.receive_json()
        assert resp["event"] == "forbidden"
        assert "lecture seule" in resp["message"] or "spectateur" in resp["message"].lower()


def test_ws_share_copilot_allowed():
    cid = "conv_ws_copilot"
    link = share_service.create_share_link(cid, permission="write")
    token = link["token"]

    # Connect via WebSocket with share_token (write)
    with client.websocket_connect(f"/ws/chat?share_token={token}") as ws:
        ev1 = ws.receive_json()
        assert ev1["event"] == "connected"
        assert ev1["role"] == "copilot"

        ev2 = ws.receive_json()
        assert ev2["event"] == "presence_update"

        # Ping should succeed
        ws.send_json({"action": "ping", "conversation_id": cid})
        resp = ws.receive_json()
        assert resp["event"] == "pong"


def test_ws_share_pin_protection():
    cid = "conv_ws_pin"
    link = share_service.create_share_link(cid, permission="write", pin_code="9876")
    token = link["token"]

    # Connect without pin -> should be rejected with 1008
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/chat?share_token={token}") as ws:
            ws.receive_json()

    # Connect with wrong pin -> should be rejected
    with pytest.raises(Exception):
        with client.websocket_connect(f"/ws/chat?share_token={token}&pin_code=0000") as ws:
            ws.receive_json()

    # Connect with correct pin -> should succeed
    with client.websocket_connect(f"/ws/chat?share_token={token}&pin_code=9876") as ws:
        ev1 = ws.receive_json()
        assert ev1["event"] == "connected"
        assert ev1["role"] == "copilot"
        ev2 = ws.receive_json()
        assert ev2["event"] == "presence_update"
        assert ev2["count"] >= 1



