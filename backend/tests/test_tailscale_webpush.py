"""Unit tests for Tailscale and Web Push services."""

from unittest.mock import patch, MagicMock
from app.services.tailscale import (
    get_tailscale_status,
)
from app.services.web_push import (
    get_or_create_vapid_keys,
    save_subscription,
    remove_subscription,
    list_subscriptions,
    send_web_push_notification,
)


def test_tailscale_status_mocked():
    sample_status = """
    {
        "Self": {
            "DNSName": "my-pc.tailnet.ts.net.",
            "TailscaleIPs": ["100.64.1.2", "fd7a:115c:a1e0::1"]
        }
    }
    """
    with patch("app.services.tailscale._find_tailscale_binary", return_value="tailscale"), \
         patch("app.services.tailscale._run_tailscale_command") as mock_cmd:
        
        mock_res = MagicMock()
        mock_res.returncode = 0
        mock_res.stdout = sample_status
        mock_res.stderr = ""
        mock_cmd.return_value = mock_res

        status = get_tailscale_status()
        assert status["installed"] is True
        assert status["running"] is True
        assert status["magicdns"] == "my-pc.tailnet.ts.net"
        assert status["tailscale_ip"] == "100.64.1.2"


def test_web_push_lifecycle(tmp_path):
    # Test VAPID key generation
    keys = get_or_create_vapid_keys()
    assert "public_key" in keys
    assert "private_key" in keys
    assert len(keys["public_key"]) > 10

    # Test Subscription save
    endpoint = f"https://push.example.com/sub-{tmp_path.name}"
    save_subscription(
        endpoint=endpoint,
        p256dh="dummy_p256dh_key",
        auth="dummy_auth_secret",
        user_agent="Mozilla/5.0 Test"
    )

    subs = list_subscriptions()
    assert any(s["endpoint"] == endpoint for s in subs)

    # Test test dispatch
    res = send_web_push_notification("Test Title", "Test Message")
    assert "total_subscribers" in res
    assert res["total_subscribers"] >= 1

    # Test Unsubscribe
    removed = remove_subscription(endpoint)
    assert removed is True
    assert not any(s["endpoint"] == endpoint for s in list_subscriptions())
