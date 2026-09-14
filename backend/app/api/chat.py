import asyncio
import json
import logging
import os
import signal
from typing import Optional, Dict, Any
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.agy_driver import stream_turn
from app.services.auth import verify_access_token, get_auth_config
from app.services.storage import get_settings, save_settings

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
    logger.info("WebSocket client connected to /ws/chat")

    message_queue: asyncio.Queue[Dict[str, Any]] = asyncio.Queue()
    active_proc: Optional[asyncio.subprocess.Process] = None
    active_task: Optional[asyncio.Task] = None
    is_turn_running = False
    is_steering = False

    async def run_turn(params: Dict[str, Any]):
        nonlocal active_proc, is_turn_running, is_steering
        is_turn_running = True
        prompt = params.get("prompt", "")
        conv_id = params.get("conversation_id")
        ws_path = params.get("workspace_path")
        model = params.get("model")
        effort = params.get("effort")
        auto_approve = params.get("auto_approve", True)

        def on_proc_spawned(p: asyncio.subprocess.Process):
            nonlocal active_proc
            active_proc = p

        async def safe_send(payload: dict):
            try:
                await websocket.send_json(payload)
            except Exception:
                pass

        try:
            async for event in stream_turn(
                prompt=prompt,
                conversation_id=conv_id,
                workspace_path=ws_path,
                model=model,
                effort=effort,
                auto_approve=auto_approve,
                proc_callback=on_proc_spawned
            ):
                await safe_send(event)

            await safe_send({"event": "done", "queue_size": message_queue.qsize()})
        except asyncio.CancelledError:
            if not is_steering:
                logger.info("Turn cancelled / interrupted by client")
                await safe_send({"event": "interrupted", "message": "Exécution interrompue."})
            else:
                logger.info("Turn cancelled for steering handover - suppressing premature interrupted event")
        except Exception as e:
            logger.error(f"Error in turn: {e}")
            await safe_send({"event": "error", "message": str(e)})
        finally:
            active_proc = None
            is_turn_running = False

    async def queue_worker():
        nonlocal active_task, is_steering
        while True:
            item = await message_queue.get()
            is_steering = False
            active_task = asyncio.create_task(run_turn(item))
            try:
                await active_task
            except asyncio.CancelledError:
                pass
            message_queue.task_done()

    worker_task = asyncio.create_task(queue_worker())

    try:
        while True:
            data = await websocket.receive_json()
            action = data.get("action", "prompt")

            if action == "prompt":
                prompt = data.get("prompt", "")
                mode = data.get("mode", "normal")  # "normal" | "queue" | "steer" | "interrupt"

                if not prompt.strip():
                    await websocket.send_json({"event": "error", "message": "Prompt cannot be empty"})
                    continue

                if is_turn_running:
                    if mode == "steer":
                        # Steer: cancel current turn and immediately prioritize new instruction
                        logger.info("Steering agent with new directive")
                        is_steering = True
                        if active_task and not active_task.done():
                            active_task.cancel()
                        # Prepend steering flag
                        data["prompt"] = f"[Instruction Prioritaire de Guidage] : {prompt}"
                        await message_queue.put(data)
                        await websocket.send_json({
                            "event": "steered",
                            "message": "Guidage transmis : nouvelle instruction prioritaire en cours d'exécution."
                        })
                    else:
                        # Queue: enqueue message for next turn
                        await message_queue.put(data)
                        qsize = message_queue.qsize()
                        logger.info(f"Queued message (queue size: {qsize})")
                        await websocket.send_json({
                            "event": "queued",
                            "queue_size": qsize,
                            "prompt_preview": prompt[:60]
                        })
                else:
                    await message_queue.put(data)

            elif action in ["interrupt", "cancel"]:
                logger.info("Client requested interrupt")
                # Drain queue
                while not message_queue.empty():
                    try:
                        message_queue.get_nowait()
                        message_queue.task_done()
                    except asyncio.QueueEmpty:
                        break

                if active_proc:
                    try:
                        pgid = os.getpgid(active_proc.pid)
                        os.killpg(pgid, signal.SIGTERM)
                    except Exception:
                        pass

                if active_task and not active_task.done():
                    active_task.cancel()

                await websocket.send_json({
                    "event": "interrupted",
                    "message": "Tour et file d'attente interrompus avec succès.",
                    "queue_size": 0
                })

            elif action == "clear_queue":
                while not message_queue.empty():
                    try:
                        message_queue.get_nowait()
                        message_queue.task_done()
                    except asyncio.QueueEmpty:
                        break
                await websocket.send_json({"event": "queue_cleared", "queue_size": 0})

            elif action == "approval":
                # Handle interactive approval card response
                decision = data.get("decision")  # "allow-once" | "allow-session" | "always-allow" | "deny"
                rule = data.get("rule")  # e.g. "command(*)"

                logger.info(f"Approval response: {decision} for rule: {rule}")
                if decision in ["allow-session", "always-allow"] and rule:
                    try:
                        settings = get_settings()
                        allow_rules = settings.get("permissions", {}).get("allow", [])
                        if rule not in allow_rules:
                            allow_rules.append(rule)
                            if "permissions" not in settings:
                                settings["permissions"] = {}
                            settings["permissions"]["allow"] = allow_rules
                            save_settings(settings)
                            logger.info(f"Rule {rule} permanently added to permissions")
                    except Exception as e:
                        logger.error(f"Failed to update settings for approval: {e}")

                if active_proc and active_proc.stdin:
                    try:
                        input_char = "y\n" if decision in ["allow-once", "allow-session", "always-allow"] else "n\n"
                        active_proc.stdin.write(input_char.encode())
                        await active_proc.stdin.drain()
                    except Exception as e:
                        logger.warning(f"Error writing approval to proc stdin: {e}")

                await websocket.send_json({"event": "approval_resolved", "decision": decision})

            elif action == "ping":
                await websocket.send_json({
                    "event": "pong",
                    "queue_size": message_queue.qsize(),
                    "is_running": is_turn_running
                })

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        worker_task.cancel()
        if active_proc:
            try:
                pgid = os.getpgid(active_proc.pid)
                os.killpg(pgid, signal.SIGTERM)
            except Exception:
                pass
        if active_task and not active_task.done():
            active_task.cancel()
