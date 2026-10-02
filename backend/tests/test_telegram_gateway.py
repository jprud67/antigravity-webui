import asyncio
import uuid
from unittest.mock import AsyncMock, patch
import pytest

from app.services.messaging_gateway import (
    approve_pairing_code,
    is_user_approved,
    request_pairing,
    reset_approval_rate_limits,
    revoke_device,
)
from app.services.telegram_gateway import TelegramGateway, TelegramSessionSubscriber


@pytest.fixture(autouse=True)
def isolate_messaging_db(tmp_path):
    test_db = str(tmp_path / "test_sessions.db")
    with patch("app.services.messaging_gateway.DB_PATH", test_db):
        yield


def test_telegram_gateway_nist_pairing_unapproved():
    async def _run():
        reset_approval_rate_limits()
        unapproved_id = "test_unapproved_9999"
        revoke_device("telegram", unapproved_id)
        assert not is_user_approved("telegram", unapproved_id)

        gw = TelegramGateway()
        mock_send = AsyncMock(return_value=True)
        gw.send_message = mock_send

        update = {
            "update_id": 1,
            "message": {
                "from": {"id": unapproved_id, "username": "unpaired_user"},
                "chat": {"id": 123456},
                "text": "Hello Antigravity!"
            }
        }

        await gw._handle_update(update)

        mock_send.assert_called_once()
        sent_text = mock_send.call_args[0][1]
        assert "NIST SP 800-63B" in sent_text
        assert "Appairage PIN Requis" in sent_text

    asyncio.run(_run())


def test_telegram_gateway_approved_user_command():
    async def _run():
        user_id = f"test_approved_{uuid.uuid4().hex[:8]}"
        ok, _, code = request_pairing("telegram", user_id, "approved_tester")
        assert ok
        approve_ok, _, _ = approve_pairing_code(code)
        assert approve_ok
        assert is_user_approved("telegram", user_id)

        gw = TelegramGateway()
        mock_send = AsyncMock(return_value=True)
        gw.send_message = mock_send

        # Test /start command
        update_start = {
            "update_id": 2,
            "message": {
                "from": {"id": user_id, "username": "approved_tester"},
                "chat": {"id": 777777},
                "text": "/start"
            }
        }
        await gw._handle_update(update_start)
        mock_send.assert_called_once()
        assert "Antigravity WebUI" in mock_send.call_args[0][1]
        assert "Passerelle Connectée" in mock_send.call_args[0][1]

        # Test /status command
        mock_send.reset_mock()
        update_status = {
            "update_id": 3,
            "message": {
                "from": {"id": user_id, "username": "approved_tester"},
                "chat": {"id": 777777},
                "text": "/status"
            }
        }
        await gw._handle_update(update_status)
        mock_send.assert_called_once()
        assert "État Antigravity WebUI" in mock_send.call_args[0][1]

    asyncio.run(_run())


def test_telegram_session_subscriber_lifecycle():
    async def _run():
        gw = TelegramGateway()
        mock_send = AsyncMock(return_value=True)
        gw.send_message = mock_send

        sub = TelegramSessionSubscriber(chat_id=12345, gateway=gw, conv_id="test_conv_abc")
        
        # Receive step_update
        await sub.send_json({"event": "step_update", "step_update": {"type": "plan"}})
        
        # Receive result
        await sub.send_json({"event": "result", "result": {"response": "Response from Antigravity"}})
        assert sub.accumulated_text == "Response from Antigravity"

        # Receive done
        await sub.send_json({"event": "done"})
        assert sub.is_done
        mock_send.assert_called_once_with(12345, "Response from Antigravity")

    asyncio.run(_run())
