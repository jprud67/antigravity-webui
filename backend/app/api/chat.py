import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel
from typing import Optional
from app.services.agy_driver import stream_turn

logger = logging.getLogger("antigravity.chat")
router = APIRouter(tags=["chat"])

class PromptRequest(BaseModel):
    prompt: str
    conversation_id: Optional[str] = None
    workspace_path: Optional[str] = None
    model: Optional[str] = None
    effort: Optional[str] = None
    auto_approve: bool = True

from app.services.auth import verify_access_token, get_auth_config

@router.websocket("/ws/chat")
async def chat_websocket(websocket: WebSocket, token: Optional[str] = None):
    config = get_auth_config()
    if config.get("enabled", True) and not verify_access_token(token):
        await websocket.close(code=1008, reason="Unauthorized")
        logger.warning("Rejected unauthenticated WebSocket connection to /ws/chat")
        return

    await websocket.accept()
    logger.info("WebSocket client connected to /ws/chat")
    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "prompt")
            if action == "prompt":
                prompt = data.get("prompt", "")
                conversation_id = data.get("conversation_id")
                workspace_path = data.get("workspace_path")
                model = data.get("model")
                effort = data.get("effort")
                auto_approve = data.get("auto_approve", True)

                if not prompt.strip():
                    await websocket.send_json({"event": "error", "message": "Prompt cannot be empty"})
                    continue

                async for event in stream_turn(
                    prompt=prompt,
                    conversation_id=conversation_id,
                    workspace_path=workspace_path,
                    model=model,
                    effort=effort,
                    auto_approve=auto_approve
                ):
                    await websocket.send_json(event)

                await websocket.send_json({"event": "done"})

            elif action == "ping":
                await websocket.send_json({"event": "pong"})

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
        try:
            await websocket.send_json({"event": "error", "message": str(e)})
        except Exception:
            pass
        raise e
