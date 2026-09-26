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
