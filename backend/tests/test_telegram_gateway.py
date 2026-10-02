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
        # Quick menu inline keyboard is attached
        assert "reply_markup" in mock_send.call_args[1]

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


def test_telegram_gateway_callback_query():
    async def _run():
        user_id = f"test_cb_{uuid.uuid4().hex[:8]}"
        ok, _, code = request_pairing("telegram", user_id, "cb_tester")
        assert ok
        approve_ok, _, _ = approve_pairing_code(code)
        assert approve_ok
        assert is_user_approved("telegram", user_id)

        gw = TelegramGateway()
        gw.answer_callback_query = AsyncMock(return_value=True)
        gw.edit_message = AsyncMock(return_value=True)

        with patch("app.services.execution_manager.execution_manager.handle_approval", new_callable=AsyncMock) as mock_handle:
            cb_update = {
                "update_id": 10,
                "callback_query": {
                    "id": "cb_query_123",
                    "from": {"id": user_id, "username": "cb_tester"},
                    "data": "approve:conv_test_123",
                    "message": {
                        "message_id": 999,
                        "chat": {"id": 888888}
                    }
                }
            }
            await gw._handle_update(cb_update)

            gw.answer_callback_query.assert_called_once_with("cb_query_123", text="Action approuvée !")
            mock_handle.assert_called_once_with("conv_test_123", decision="approved")
            gw.edit_message.assert_called_once()

    asyncio.run(_run())


def test_telegram_session_subscriber_lifecycle():
    async def _run():
        gw = TelegramGateway()
        mock_send = AsyncMock(return_value=True)
        mock_edit = AsyncMock(return_value=True)
        gw.send_message = mock_send
        gw.edit_message = mock_edit

        sub = TelegramSessionSubscriber(chat_id=12345, gateway=gw, conv_id="test_conv_abc", initial_msg_id=777)
        
        # Receive step_update
        await sub.send_json({"event": "step_update", "step_update": {"type": "plan", "name": "bash"}})
        
        # Receive result
        await sub.send_json({"event": "result", "result": {"response": "Response from Antigravity"}})
        assert sub.accumulated_text == "Response from Antigravity"

        # Receive done
        await sub.send_json({"event": "done"})
        assert sub.is_done
        # Should edit on step_update (progress) and on done (final response with menu)
        assert mock_edit.call_count == 2
        # Verify first call was progress edit
        assert mock_edit.call_args_list[0][0][2] == "⚙️ *Antigravity en cours...*\nAction : `bash`"
        # Verify final call was response with quick menu
        args, kwargs = mock_edit.call_args_list[1]
        assert args[0] == 12345
        assert args[1] == 777
        assert args[2] == "Response from Antigravity"
        assert "reply_markup" in kwargs

    asyncio.run(_run())
