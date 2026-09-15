import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.auth import verify_access_token, get_auth_config
from app.services.execution_manager import execution_manager

logger = logging.getLogger("antigravity.chat")
router = APIRouter(tags=["chat"])

@router.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket, token: Optional[str] = None):
    config = get_auth_config()
    if config.get("enabled", True) and not verify_access_token(token):
        await websocket.close(code=1008, reason="Unauthorized")
        logger.warning("Rejected unauthenticated WebSocket connection to /ws/chat")
        return

    await websocket.accept()
    execution_manager.register_socket(websocket)
    if execution_manager.active_session and execution_manager.active_session.is_running:
        execution_manager.active_session.add_subscriber(websocket)
    logger.info("WebSocket client connected to /ws/chat")

    # Send connection handshake with server status
    try:
        active_cids = execution_manager.get_running_conversations()
        active_turn = (
            execution_manager.active_session.get_live_state()
            if execution_manager.active_session and execution_manager.active_session.is_running
            else None
        )
        await websocket.send_json({
            "event": "connected",
            "active_conversations": active_cids,
            "active_turn": active_turn
        })
    except Exception as e:
        logger.warning(f"Failed to send initial handshake to websocket: {e}")

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "prompt")
            conv_id = data.get("conversation_id")

            if action == "prompt":
                await execution_manager.submit_prompt(websocket, data)

            elif action == "attach":
                state = await execution_manager.attach(conv_id, websocket)
                await websocket.send_json({"event": "attached", **state})

            elif action in ["interrupt", "cancel"]:
                await execution_manager.interrupt(conv_id)

            elif action == "clear_queue":
                await execution_manager.clear_queue(conv_id)

            elif action == "approval":
                decision = data.get("decision")
                rule = data.get("rule")
                await execution_manager.handle_approval(conv_id, decision, rule)

            elif action == "ping":
                session = execution_manager.get_session(conv_id)
                await websocket.send_json({
                    "event": "pong",
                    "conversation_id": conv_id,
                    "queue_size": session.message_queue.qsize() if session else 0,
                    "is_running": session.is_running if session else False,
                    "active_conversations": execution_manager.get_running_conversations()
                })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        # Crucial: Unregister socket only, DO NOT kill processes or cancel tasks!
        execution_manager.unregister_socket(websocket)
        logger.info("WebSocket connection cleaned up; background tasks continue running.")
