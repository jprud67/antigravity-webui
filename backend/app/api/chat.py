import base64
import logging
import secrets
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services import share_service
from app.services.auth import get_auth_config, verify_token_or_api_key
from app.services.execution_manager import execution_manager
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.chat")
router = APIRouter(tags=["chat"])

@router.websocket("/ws/chat")
async def chat_websocket(
    websocket: WebSocket,
    token: str | None = None,
    api_key: str | None = None
):
    # Support token / API key extraction from query params or headers
    effective_token = token or api_key or websocket.query_params.get("token") or websocket.query_params.get("api_key")
    if not effective_token:
        x_api_key = websocket.headers.get("x-api-key", "").strip()
        if x_api_key:
            effective_token = x_api_key

    # Support token extraction via Sec-WebSocket-Protocol header (e.g. token.<token>)
    selected_subprotocol: str | None = None
    raw_subprotocols = websocket.headers.get("sec-websocket-protocol", "")
    if raw_subprotocols:
        for sp in raw_subprotocols.split(","):
            sp_clean = sp.strip()
            if sp_clean.startswith("token."):
                raw_token = sp_clean[6:]
                if not effective_token:
                    from urllib.parse import unquote
                    try:
                        clean_unquoted = unquote(raw_token).strip()
                        rem = len(clean_unquoted) % 4
                        padded = clean_unquoted + ("=" * ((4 - rem) % 4))
                        decoded = None
                        try:
                            decoded = base64.urlsafe_b64decode(padded.encode("ascii")).decode("utf-8")
                        except Exception:
                            try:
                                decoded = base64.b64decode(padded.encode("ascii")).decode("utf-8")
                            except Exception:
                                decoded = None
                        if decoded and verify_token_or_api_key(decoded):
                            effective_token = decoded
                        elif verify_token_or_api_key(raw_token):
                            effective_token = raw_token
                    except Exception:
                        if verify_token_or_api_key(raw_token):
                            effective_token = raw_token
                selected_subprotocol = sp_clean
                break
            elif sp_clean == "antigravity":
                selected_subprotocol = "antigravity"

    share_token = websocket.query_params.get("share_token")
    client_role = "host"
    client_nickname = "Hôte"
    client_color = "#3b82f6"
    bound_conv_id = None

    if share_token:
        pin_code = websocket.query_params.get("pin_code")
        v_res = share_service.verify_share_token(share_token, pin_code=pin_code)
        if not v_res.get("valid"):
            await websocket.close(code=1008, reason="Unauthorized")
            logger.warning("Rejected invalid share_token WebSocket connection to /ws/chat")
            return
        share_permission = v_res.get("permission", "read")
        bound_conv_id = v_res.get("conversation_id")
        client_role = "spectator" if share_permission == "read" else "copilot"
        cid_tag = bound_conv_id[:4] if bound_conv_id else "Guest"
        client_nickname = f"Spectateur {cid_tag}" if client_role == "spectator" else f"Co-pilote {cid_tag}"
        client_color = "#06b6d4" if client_role == "spectator" else "#8b5cf6"
    else:
        config = get_auth_config()
        if config.get("enabled", True) and not verify_token_or_api_key(effective_token):
            await websocket.close(code=1008, reason="Unauthorized")
            logger.warning("Rejected unauthenticated WebSocket connection to /ws/chat")
            return

    client_info = {
        "client_id": secrets.token_hex(4),
        "role": client_role,
        "nickname": client_nickname,
        "avatar_color": client_color,
        "share_token": share_token,
        "bound_conversation_id": bound_conv_id,
        "joined_at": time.time(),
    }

    await websocket.accept(subprotocol=selected_subprotocol)
    execution_manager.register_socket(websocket, client_info)
    logger.info(f"WebSocket client connected to /ws/chat (role={client_role}, bound={bound_conv_id})")

    # Send connection handshake with server status
    try:
        active_cids = execution_manager.get_running_conversations()
        _active_session = execution_manager.active_session
        active_turn = (
            _active_session.get_live_state()
            if _active_session is not None and (_active_session.is_busy or _active_session.is_running)
            else None
        )
        await websocket.send_json({
            "event": "connected",
            "active_conversations": active_cids,
            "active_turn": active_turn,
            "role": client_role,
            "nickname": client_nickname,
            "bound_conversation_id": bound_conv_id
        })
    except Exception as e:
        logger.warning(f"Failed to send initial handshake to websocket: {e}")

    # If bound to a shared conversation, auto-attach to session subscribers and broadcast presence
    if bound_conv_id:
        session = execution_manager.get_or_create_session(bound_conv_id)
        session.add_subscriber(websocket)
        await execution_manager.broadcast_presence(bound_conv_id)

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "prompt")
            conv_id = data.get("conversation_id")
            if isinstance(conv_id, str):
                conv_id = conv_id.strip()
                if conv_id in ("", "null", "undefined", "None"):
                    conv_id = None

            # Guest isolation: cannot manipulate conversations other than the bound one
            if bound_conv_id and conv_id and conv_id != bound_conv_id:
                await websocket.send_json({"event": "error", "message": "Accès limité à la session partagée."})
                continue
            if bound_conv_id and not conv_id:
                conv_id = bound_conv_id

            if conv_id and not is_safe_conversation_id(conv_id):
                await websocket.send_json({"event": "error", "message": "Identifiant de conversation invalide."})
                continue
            data["conversation_id"] = conv_id

            # Role enforcement: spectator cannot send prompts, steering, or approvals
            if client_role == "spectator" and action in ("prompt", "steer", "interrupt", "cancel", "clear_queue", "approval", "input", "answer", "stdin"):
                await websocket.send_json({
                    "event": "forbidden",
                    "action": action,
                    "message": "Action refusée : session partagée en lecture seule (Mode Spectateur)"
                })
                continue

            if action == "prompt":
                await execution_manager.submit_prompt(websocket, data)

            elif action == "attach":
                state = await execution_manager.attach(conv_id, websocket)
                await websocket.send_json({"event": "attached", **state})
                await execution_manager.broadcast_presence(conv_id)

            elif action in ["interrupt", "cancel"]:
                await execution_manager.interrupt(conv_id)

            elif action == "clear_queue":
                await execution_manager.clear_queue(conv_id)

            elif action == "approval":
                decision = data.get("decision")
                rule = data.get("rule")
                await execution_manager.handle_approval(conv_id, decision, rule)

            elif action in ["input", "answer", "stdin"]:
                input_val = None
                for k in ("text", "input", "answer"):
                    if k in data and data[k] is not None:
                        input_val = data[k]
                        break
                input_text = str(input_val) if input_val is not None else ""
                await execution_manager.handle_stdin_input(conv_id, input_text)

            elif action == "ping":
                session = execution_manager.get_session(conv_id)
                await websocket.send_json({
                    "event": "pong",
                    "conversation_id": conv_id,
                    "queue_size": session.message_queue.qsize() if session else 0,
                    "is_running": execution_manager.is_running(conv_id),
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

