import asyncio
import logging
import time
from collections import deque
from typing import Any

from fastapi import WebSocket

from app.platform_utils import (
    terminate_process_group_async,
    terminate_process_group_sync,
)
from app.services.agy_driver import (
    get_model_families,
    resolve_model_and_effort,
    stream_turn,
)
from app.services.google_auth import (
    get_active_account,
    is_quota_error,
    switch_to_next_healthy_account,
)
from app.services.storage import get_settings, save_settings

logger = logging.getLogger("antigravity.execution")


def _clean_cid(cid: Any) -> str | None:
    if not cid or not isinstance(cid, str):
        return None
    c = cid.strip()
    return None if c in ("", "null", "undefined", "None") else c


class ExecutionSession:
    """
    Represents an ongoing execution lifecycle for a conversation.
    Decoupled from ephemeral client WebSocket connections.
    Runs until natural completion or explicit user cancellation ('Arrêter').
    """
    def __init__(self, conversation_id: str | None = None, workspace_path: str | None = None):
        self.conversation_id: str | None = conversation_id
        self.workspace_path: str | None = workspace_path
        self.message_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.subscribers: set[WebSocket] = set()
        self.active_proc: asyncio.subprocess.Process | None = None
        self.active_task: asyncio.Task | None = None
        self.worker_task: asyncio.Task | None = None
        self.is_running: bool = False
        self.is_steering: bool = False
        self.started_at: float = 0.0
        self.last_active_at: float = time.time()

        # Live state for reconnection and late hydration
        self.live_thought: str = ""
        self.live_content: str = ""
        self.live_tool_calls: list[dict[str, Any]] = []
        self.live_usage: dict[str, Any] | None = None
        self.pending_approval: dict[str, Any] | None = None
        self.recent_events: deque[dict[str, Any]] = deque(maxlen=50)

    def add_subscriber(self, ws: WebSocket):
        self.subscribers.add(ws)
        self.last_active_at = time.time()

    def remove_subscriber(self, ws: WebSocket):
        self.subscribers.discard(ws)

    @property
    def is_busy(self) -> bool:
        return bool(
            self.is_running
            or (self.active_task is not None and not self.active_task.done())
            or not self.message_queue.empty()
        )

    def get_live_state(self) -> dict[str, Any]:
        return {
            "conversation_id": self.conversation_id,
            "is_running": self.is_busy,
            "queue_size": self.message_queue.qsize(),
            "started_at": self.started_at,
            "live_state": {
                "thought": self.live_thought,
                "content": self.live_content,
                "tool_calls": self.live_tool_calls,
                "usage": self.live_usage,
                "pending_approval": self.pending_approval,
            },
            "recent_events": list(self.recent_events)[-30:]
        }

    async def broadcast(self, event: dict[str, Any]):
        self.last_active_at = time.time()
        
        # Keep ring buffer of recent events (filter out high-frequency stream chunks)
        evt_type = event.get("event")
        if evt_type not in ("step_update", "raw_output"):
            self.recent_events.append(event)

        # Update live state from event
        self._update_live_state(event)

        # Broadcast to all connected subscribers with bounded timeout
        dead = set()
        for ws in list(self.subscribers):
            try:
                await asyncio.wait_for(ws.send_json(event), timeout=2.0)
            except Exception:
                dead.add(ws)
        for ws in dead:
            self.subscribers.discard(ws)
            execution_manager.connected_sockets.discard(ws)

    def _update_live_state(self, event: dict[str, Any]):
        evt_type = event.get("event")
        if evt_type == "init":
            cid = event.get("conversation_id")
            if cid:
                self.conversation_id = cid
                execution_manager.register_session_cid(self, cid)

        elif evt_type == "step_update":
            update = event.get("step_update", {})
            cid = update.get("conversation_id")
            if cid:
                self.conversation_id = cid
                execution_manager.register_session_cid(self, cid)

            if update.get("thinking"):
                self.live_thought += update["thinking"]

            if update.get("step_type") == "agent_response" and update.get("text_delta"):
                self.live_content += update["text_delta"]

            if update.get("usage"):
                self.live_usage = update["usage"]

            if update.get("step_type") in ("permission_request", "ask_permission"):
                self.pending_approval = {
                    "toolName": update.get("tool_name") or "Action Requise",
                    "command": update.get("command"),
                    "path": update.get("path")
                }

            if update.get("step_type") == "tool":
                tool_name = update.get("tool_name") or update.get("tool_info", {}).get("name") or "tool"
                tool_args = update.get("tool_info", {}).get("parameters") or update.get("parameters")
                tool_output = update.get("tool_info", {}).get("output")
                is_done = update.get("state") == "DONE"

                found = False
                for t in self.live_tool_calls:
                    if t.get("name") == tool_name and t.get("status") == "running":
                        if is_done:
                            t["status"] = "done"
                            t["result"] = tool_output
                        found = True
                        break
                if not found:
                    self.live_tool_calls.append({
                        "name": tool_name,
                        "args": tool_args,
                        "result": tool_output,
                        "status": "done" if is_done else "running"
                    })

        elif evt_type == "command_result":
            cmd = event.get("command", {})
            c_name = cmd.get("name")
            c_data = cmd.get("data", {})
            if c_name == "usage":
                lines = ["### 📊 Quotas & Limites Antigravity (Google Cloud)\n"]
                desc = c_data.get("description")
                if desc:
                    lines.append(f"> {desc}\n")
                groups = c_data.get("groups", [])
                for g in groups:
                    lines.append(f"#### {g.get('name')}")
                    lines.append("| Limite | Restant | Réinitialisation |")
                    lines.append("| :--- | :---: | :--- |")
                    for b in g.get("buckets", []):
                        pct = round(b.get("remaining_fraction", 0) * 100)
                        reset = b.get("reset_time", "N/A")
                        lines.append(f"| **{b.get('name')}** | `{pct}%` | `{reset}` |")
                    lines.append("")
                self.live_content = "\n".join(lines)
            elif c_name == "credits":
                rem = c_data.get("remaining_credits", 0)
                uri = c_data.get("upgrade_uri", "")
                self.live_content = f"### 💳 Crédits Antigravity G1\n\n- **Crédits restants :** `{rem}`\n- **Recharge / Souscription :** [{uri}]({uri})"

        elif evt_type == "result":
            res = event.get("result", {})
            resp = res.get("response")
            if resp:
                if not self.live_content:
                    if "\t" in resp and "\n" in resp:
                        raw_lines = [l.strip() for l in resp.strip().splitlines() if l.strip()]
                        table_lines = ["| Élément / Modèle | Métrique | Valeur | Réinitialisation |", "| :--- | :--- | :---: | :--- |"]
                        for line in raw_lines:
                            cols = [c.strip() for c in line.split("\t") if c.strip()]
                            if len(cols) >= 4:
                                table_lines.append(f"| **{cols[0]}** | {cols[1]} | `{cols[2]}` | `{cols[3]}` |")
                            elif len(cols) == 3:
                                table_lines.append(f"| **{cols[0]}** | {cols[1]} | `{cols[2]}` | - |")
                            elif len(cols) == 2:
                                table_lines.append(f"| **{cols[0]}** | {cols[1]} | - | - |")
                            else:
                                table_lines.append(f"| {line} | | | |")
                        self.live_content = "\n".join(table_lines)
                    else:
                        self.live_content = resp
            if res.get("usage"):
                self.live_usage = res["usage"]

        elif evt_type == "approval_request":
            self.pending_approval = {
                "toolName": event.get("tool_name") or "Action système",
                "command": event.get("command"),
                "path": event.get("path")
            }
        elif evt_type == "approval_resolved" or evt_type in ("done", "interrupted", "error"):
            self.pending_approval = None

    async def run_turn(self, params: dict[str, Any]):
        self.is_running = True
        self.started_at = time.time()
        self.live_thought = ""
        self.live_content = ""
        self.live_tool_calls = []
        self.live_usage = None
        self.pending_approval = None

        prompt = params.get("prompt", "")
        conv_id = params.get("conversation_id") or self.conversation_id
        ws_path = params.get("workspace_path") or self.workspace_path
        model = params.get("model")
        effort = params.get("effort")
        auto_approve = params.get("auto_approve", True)
        agent_mode = params.get("agent_mode")
        try:
            settings = get_settings()
            if not agent_mode:
                agent_mode = settings.get("agentMode")
            if not model:
                model = settings.get("model")
            if not effort:
                effort = settings.get("effort")
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

        def on_proc_spawned(p: asyncio.subprocess.Process):
            self.active_proc = p

        attempt = 0
        max_failover_attempts = 5
        model_switched_on_current_account = False
        current_model = model
        current_effort = effort

        try:
            while attempt < max_failover_attempts:
                attempt += 1
                quota_error_detected = False
                self.live_thought = ""
                self.live_content = ""
                self.live_tool_calls = []
                self.live_usage = None
                self.pending_approval = None
                self.active_proc = None

                try:
                    active_cid = self.conversation_id or conv_id
                    logger.info(f"[Session {active_cid}] Starting turn in background (attempt {attempt})...")
                    async for event in stream_turn(
                        prompt=prompt,
                        conversation_id=active_cid,
                        workspace_path=ws_path,
                        model=current_model,
                        effort=current_effort,
                        auto_approve=auto_approve,
                        agent_mode=agent_mode,
                        proc_callback=on_proc_spawned
                    ):
                        cid = event.get("conversation_id") or event.get("step_update", {}).get("conversation_id")
                        if cid and not self.conversation_id:
                            self.conversation_id = cid
                            execution_manager.register_session_cid(self, cid)

                        # Check for quota error in event
                        if event.get("event") == "error":
                            err_msg = event.get("message") or event.get("error") or ""
                            if is_quota_error(err_msg):
                                quota_error_detected = True
                                logger.warning(f"[Session {self.conversation_id}] Quota error detected in event: {err_msg}")
                                break
                        elif event.get("event") == "step_update":
                            su = event.get("step_update", {})
                            if su.get("step_type") in ("error", "ERROR_MESSAGE") or su.get("status") == "ERROR":
                                su_msg = su.get("error") or su.get("content") or ""
                                if is_quota_error(su_msg):
                                    quota_error_detected = True
                                    logger.warning(f"[Session {self.conversation_id}] Quota error detected in step_update: {su_msg}")
                                    break

                        await self.broadcast(event)

                except asyncio.CancelledError:
                    # Note: the canceller (user "interrupt" or steering) is responsible for
                    # broadcasting the relevant event; avoid duplicating "interrupted" here.
                    for tc in self.live_tool_calls:
                        if isinstance(tc, dict) and tc.get("status") == "running":
                            tc["status"] = "cancelled"
                    if not self.is_steering:
                        logger.info(f"[Session {self.conversation_id}] Turn cancelled by user interruption.")
                    else:
                        logger.info(f"[Session {self.conversation_id}] Turn cancelled for steering directive.")
                    return
                except Exception as e:
                    err_text = str(e)
                    if is_quota_error(err_text):
                        quota_error_detected = True
                    else:
                        for tc in self.live_tool_calls:
                            if isinstance(tc, dict) and tc.get("status") == "running":
                                tc["status"] = "error"
                        logger.error(f"[Session {self.conversation_id}] Error during turn execution: {e}")
                        self.is_running = False
                        await self.broadcast({
                            "event": "error",
                            "conversation_id": self.conversation_id,
                            "message": str(e)
                        })
                        return

                if quota_error_detected:
                    current_meta = get_active_account()
                    current_email = current_meta.get("email") if current_meta else "inconnu"
                    if attempt >= max_failover_attempts:
                        logger.error(
                            f"[Session {self.conversation_id}] Quota error detected and max failover attempts ({max_failover_attempts}) reached."
                        )
                        for tc in self.live_tool_calls:
                            if isinstance(tc, dict) and tc.get("status") == "running":
                                tc["status"] = "error"
                        self.is_running = False
                        await self.broadcast({
                            "event": "error",
                            "conversation_id": self.conversation_id,
                            "message": f"Quota atteint sur le compte Google ({current_email}). Limite maximale de tentatives ({max_failover_attempts}) atteinte."
                        })
                        return

                    exclude_email = current_email if (current_email and "@" in current_email) else None
                    logger.warning(
                        f"[Session {self.conversation_id}] Google Account {current_email} reached quota limits. Triggering auto-failover..."
                    )

                    # 1. Essayer de basculer sur un autre type de modèle (Gemini <-> Externe) avant de changer de compte
                    if not model_switched_on_current_account:
                        families = await get_model_families()
                        is_gemini = ("gemini" in str(current_model).lower()) if current_model else True
                        candidate_models = [
                            f for f in families
                            if ("gemini" not in f.get("id", "").lower() if is_gemini else "gemini" in f.get("id", "").lower())
                        ]
                        found_alternative = False
                        for cand in candidate_models:
                            variants = cand.get("variants") or {}
                            cand_model = variants.get("default") or next(iter(variants.values()), None)
                            if cand_model:
                                norm_cand_model, norm_effort = resolve_model_and_effort(cand_model, cand.get("default_effort"))
                                target_candidate = norm_cand_model or cand_model
                                if target_candidate and target_candidate != current_model:
                                    old_model = current_model
                                    current_model = target_candidate
                                    current_effort = norm_effort
                                    model_switched_on_current_account = True
                                    found_alternative = True
                                    logger.warning(
                                        f"[Session {self.conversation_id}] Quota reached on {current_email} with {old_model} — switching to alternative model {current_model}..."
                                    )
                                    self.live_thought = ""
                                    self.live_content = ""
                                    self.live_tool_calls = []
                                    self.pending_approval = None
                                    self.active_proc = None
                                    await self.broadcast({
                                        "event": "model_failover",
                                        "conversation_id": self.conversation_id,
                                        "previous_model": old_model,
                                        "new_model": current_model,
                                        "account": current_email,
                                        "message": f"Quota atteint avec {old_model}. Basculement automatique sur {current_model} et relance de la tâche..."
                                    })
                                    break
                        if found_alternative and attempt < max_failover_attempts:
                            await asyncio.sleep(1.0)
                            continue
                        model_switched_on_current_account = True

                    # 2. Si le modèle a déjà été basculé ou si c'est impossible, basculer le compte Google
                    new_account = switch_to_next_healthy_account(exclude_email=exclude_email, model=current_model)
                    if new_account and attempt < max_failover_attempts:
                        model_switched_on_current_account = False
                        logger.info(
                            f"[Session {self.conversation_id}] Auto-failover: Switched from {current_email} to {new_account}. Relaunching task immediately..."
                        )
                        self.live_thought = ""
                        self.live_content = ""
                        self.live_tool_calls = []
                        self.pending_approval = None
                        self.active_proc = None
                        await self.broadcast({
                            "event": "account_failover",
                            "conversation_id": self.conversation_id,
                            "previous_account": current_email,
                            "new_account": new_account,
                            "message": f"Quota atteint sur le compte Google {current_email}. Basculement automatique sur {new_account} et relance de la tâche..."
                        })
                        # Brief 1s pause before restarting to ensure token file is cleanly committed and locked
                        await asyncio.sleep(1.0)
                        continue
                    else:
                        for tc in self.live_tool_calls:
                            if isinstance(tc, dict) and tc.get("status") == "running":
                                tc["status"] = "error"
                        logger.error(f"[Session {self.conversation_id}] Auto-failover failed: No alternative healthy accounts.")
                        self.is_running = False
                        await self.broadcast({
                            "event": "error",
                            "conversation_id": self.conversation_id,
                            "message": f"Quota atteint sur le compte Google ({current_email}). Aucun autre compte avec quota disponible n'a été trouvé. Veuillez patienter jusqu'à la réinitialisation ou ajouter un nouveau compte Google."
                        })
                        return
                else:
                    logger.info(f"[Session {self.conversation_id}] Turn finished naturally.")
                    for tc in self.live_tool_calls:
                        if isinstance(tc, dict) and tc.get("status") == "running":
                            tc["status"] = "done"
                    queue_sz = self.message_queue.qsize()
                    if queue_sz == 0:
                        self.is_running = False
                    await self.broadcast({
                        "event": "done",
                        "conversation_id": self.conversation_id,
                        "queue_size": queue_sz
                    })
                    return

            # All failover attempts were exhausted without a conclusive outcome
            for tc in self.live_tool_calls:
                if isinstance(tc, dict) and tc.get("status") == "running":
                    tc["status"] = "error"
            logger.error(f"[Session {self.conversation_id}] Auto-failover retries exhausted ({max_failover_attempts} attempts).")
            self.is_running = False
            await self.broadcast({
                "event": "error",
                "conversation_id": self.conversation_id,
                "message": "Basculements automatiques épuisés : impossible de terminer la tâche. Veuillez réessayer ultérieurement."
            })

        finally:
            self.active_proc = None
            self.is_running = False
            self.pending_approval = None
            self.last_active_at = time.time()

    async def queue_worker(self):
        while True:
            try:
                item = await self.message_queue.get()
            except asyncio.CancelledError:
                break
            self.is_steering = False
            self.is_running = True
            try:
                self.active_task = asyncio.create_task(self.run_turn(item))
                try:
                    await self.active_task
                except asyncio.CancelledError:
                    # Distinguer : le worker lui-même est annulé (pruning → sortir
                    # proprement) vs la tâche active annulée par steer/interrupt
                    # (l'erreur remonte de la tâche attendue → continuer la boucle).
                    current = asyncio.current_task()
                    # Task.cancelling() est disponible uniquement à partir de Python 3.11.
                    cancelling = getattr(current, "cancelling", None)
                    if current is not None and callable(cancelling) and cancelling() > 0:
                        raise
                except Exception as e:
                    logger.error(f"[Session {self.conversation_id}] Worker task error: {e}")
            finally:
                self.active_task = None
                self.last_active_at = time.time()
                self.message_queue.task_done()


class ExecutionManager:
    """
    Server-level singleton managing all active background turns across conversations.
    Guarantees tasks never abort on accidental client reload or network drops.
    """
    def __init__(self) -> None:
        self.sessions: dict[str, ExecutionSession] = {}
        self.active_session: ExecutionSession | None = None
        self.connected_sockets: set[WebSocket] = set()
        self._background_tasks: set[asyncio.Task[Any]] = set()
        self._lock: asyncio.Lock = asyncio.Lock()

    def remove_session(self, conversation_id: str | None) -> None:
        """Immediately removes a session from memory, terminates any active child processes, and cancels tasks."""
        if not conversation_id:
            return
        target_session = self.sessions.pop(conversation_id, None)
        if not target_session and self.active_session and self.active_session.conversation_id == conversation_id:
            target_session = self.active_session
        if target_session:
            if target_session is self.active_session:
                self.active_session = None
            if target_session.active_task and not target_session.active_task.done():
                target_session.active_task.cancel()
            if target_session.active_proc and target_session.active_proc.returncode is None:
                terminated_async = False
                try:
                    loop = asyncio.get_running_loop()
                    if loop.is_running():
                        task = loop.create_task(terminate_process_group_async(target_session.active_proc, grace=0.5))
                        self._background_tasks.add(task)
                        task.add_done_callback(self._background_tasks.discard)
                        terminated_async = True
                except RuntimeError as e:
                    logger.debug(f"Ignored error: {e}")

                if not terminated_async:
                    try:
                        session_loop = getattr(target_session, "loop", None)
                        if session_loop and session_loop.is_running():
                            asyncio.run_coroutine_threadsafe(
                                terminate_process_group_async(target_session.active_proc, grace=0.5),
                                session_loop
                            )
                        else:
                            terminate_process_group_sync(target_session.active_proc, force=True)
                    except Exception:
                        terminate_process_group_sync(target_session.active_proc, force=True)
            if target_session.worker_task and not target_session.worker_task.done():
                target_session.worker_task.cancel()
            while not target_session.message_queue.empty():
                try:
                    target_session.message_queue.get_nowait()
                    target_session.message_queue.task_done()
                except (asyncio.QueueEmpty, ValueError):
                    break
            target_session.is_running = False
            target_session.active_proc = None
            logger.info(f"Removed execution session for conversation {conversation_id} from memory.")

    def register_socket(self, ws: WebSocket):
        self.connected_sockets.add(ws)

    def unregister_socket(self, ws: WebSocket):
        self.connected_sockets.discard(ws)
        # Detach from all sessions WITHOUT stopping or cancelling anything!
        for s in list(self.sessions.values()):
            s.remove_subscriber(ws)
        if self.active_session:
            self.active_session.remove_subscriber(ws)
        try:
            self.prune_inactive_sessions()
        except Exception as e:
            logger.debug(f"Error during socket disconnect prune: {e}")
        logger.info(
            f"WebSocket client disconnected; {len(self.get_running_conversations())} background task(s) continue running uninterrupted."
        )

    def register_session_cid(self, session: ExecutionSession, cid: str):
        if cid:
            self.sessions[cid] = session

    def prune_inactive_sessions(self, max_idle_seconds: float = 3600.0):
        """
        Prunes idle sessions from memory that are not running, have empty queues,
        no connected subscribers, and have been inactive for over max_idle_seconds.
        """
        now = time.time()
        to_prune = []
        for cid, s in list(self.sessions.items()):
            if (
                not s.is_busy
                and len(s.subscribers) == 0
                and (now - getattr(s, "last_active_at", 0.0)) > max_idle_seconds
            ):
                to_prune.append(cid)

        for cid in to_prune:
            target_session = self.sessions.pop(cid, None)
            if target_session:
                if target_session is self.active_session:
                    self.active_session = None
                if target_session.active_task and not target_session.active_task.done():
                    target_session.active_task.cancel()
                if target_session.active_proc and target_session.active_proc.returncode is None:
                    try:
                        task = asyncio.create_task(terminate_process_group_async(target_session.active_proc, grace=0.5))
                        self._background_tasks.add(task)
                        task.add_done_callback(self._background_tasks.discard)
                    except RuntimeError:
                        terminate_process_group_sync(target_session.active_proc, force=True)
                if target_session.worker_task and not target_session.worker_task.done():
                    target_session.worker_task.cancel()
                while not target_session.message_queue.empty():
                    try:
                        target_session.message_queue.get_nowait()
                        target_session.message_queue.task_done()
                    except (asyncio.QueueEmpty, ValueError):
                        break
                target_session.is_running = False
                target_session.active_proc = None
            logger.info(f"Pruned inactive execution session for conversation {cid} from memory.")

    def get_or_create_session(
        self,
        conversation_id: str | None,
        workspace_path: str | None = None,
        ws: WebSocket | None = None,
    ) -> ExecutionSession:
        conversation_id = _clean_cid(conversation_id)
        self.prune_inactive_sessions()
        if conversation_id:
            if conversation_id in self.sessions:
                s = self.sessions[conversation_id]
                if workspace_path:
                    s.workspace_path = workspace_path
                # Ensure worker task is running
                if not s.worker_task or s.worker_task.done():
                    s.worker_task = asyncio.create_task(s.queue_worker())
                return s
            if self.active_session and self.active_session.conversation_id == conversation_id:
                self.sessions[conversation_id] = self.active_session
                if workspace_path:
                    self.active_session.workspace_path = workspace_path
                if not self.active_session.worker_task or self.active_session.worker_task.done():
                    self.active_session.worker_task = asyncio.create_task(self.active_session.queue_worker())
                return self.active_session

        if not conversation_id and self.active_session and self.active_session.conversation_id is None and self.active_session.is_busy:
            if ws is None or ws in self.active_session.subscribers:
                if workspace_path and not self.active_session.workspace_path:
                    self.active_session.workspace_path = workspace_path
                return self.active_session

        if self.active_session and (not self.active_session.conversation_id or self.active_session.conversation_id not in self.sessions):
            if not self.active_session.is_busy and self.active_session.worker_task and not self.active_session.worker_task.done():
                self.active_session.worker_task.cancel()

        session = ExecutionSession(conversation_id=conversation_id, workspace_path=workspace_path)
        session.worker_task = asyncio.create_task(session.queue_worker())
        if conversation_id:
            self.sessions[conversation_id] = session
        self.active_session = session
        return session

    def get_session(self, conversation_id: str | None) -> ExecutionSession | None:
        conversation_id = _clean_cid(conversation_id)
        if conversation_id:
            if conversation_id in self.sessions:
                return self.sessions[conversation_id]
            for s in list(self.sessions.values()):
                if s.conversation_id == conversation_id:
                    self.sessions[conversation_id] = s
                    return s
            if self.active_session and self.active_session.conversation_id == conversation_id:
                self.sessions[conversation_id] = self.active_session
                return self.active_session
        else:
            if self.active_session and self.active_session.is_busy:
                return self.active_session
            running = [s for s in self.sessions.values() if s.is_busy]
            if running:
                return running[0]
        return None

    def is_running(self, conversation_id: str | None) -> bool:
        conversation_id = _clean_cid(conversation_id)
        session = self.get_session(conversation_id)
        return bool(session and session.is_busy)

    def get_running_conversations(self) -> list[str]:
        cids = {cid for cid, s in self.sessions.items() if s.is_busy and cid}
        if self.active_session and self.active_session.is_busy and self.active_session.conversation_id:
            cids.add(self.active_session.conversation_id)
        return list(cids)

    async def attach(self, conversation_id: str | None, ws: WebSocket) -> dict[str, Any]:
        conversation_id = _clean_cid(conversation_id)
        # If conversation_id is None or empty, user is not viewing any conversation.
        # Detach WebSocket from all sessions so that live events don't leak into new chat / home.
        if not conversation_id:
            for s in list(self.sessions.values()):
                s.remove_subscriber(ws)
            if self.active_session:
                self.active_session.remove_subscriber(ws)
            return {
                "conversation_id": None,
                "is_running": False,
                "queue_size": 0,
                "live_state": None,
                "recent_events": []
            }

        session = self.get_session(conversation_id)

        # Detach WebSocket from all other sessions to prevent event cross-talk across conversations
        for s in list(self.sessions.values()):
            if s is not session:
                s.remove_subscriber(ws)
        if self.active_session and self.active_session is not session:
            self.active_session.remove_subscriber(ws)

        if session:
            session.add_subscriber(ws)
            if session.conversation_id and session.conversation_id not in self.sessions:
                self.sessions[session.conversation_id] = session
            return session.get_live_state()

        return {
            "conversation_id": conversation_id,
            "is_running": False,
            "queue_size": 0,
            "live_state": None,
            "recent_events": []
        }

    async def submit_prompt(self, ws: WebSocket, data: dict[str, Any]):
        prompt = data.get("prompt", "").strip()
        if not prompt:
            await ws.send_json({"event": "error", "message": "Le prompt ne peut pas être vide."})
            return

        conv_id = _clean_cid(data.get("conversation_id"))
        ws_path = data.get("workspace_path")
        mode = data.get("mode", "normal")

        session = self.get_or_create_session(conv_id, ws_path, ws=ws)
        session.add_subscriber(ws)
        session.last_active_at = time.time()
        self.active_session = session

        if session.is_busy:
            if mode == "steer":
                logger.info(f"Steering session {session.conversation_id}")
                session.is_steering = True
                if session.active_proc and session.active_proc.returncode is None:
                    await terminate_process_group_async(session.active_proc, grace=0.5)
                session.active_proc = None
                session.pending_approval = None
                if session.active_task and not session.active_task.done():
                    session.active_task.cancel()
                    try:
                        await asyncio.wait_for(asyncio.shield(session.active_task), timeout=2.0)
                    except (asyncio.CancelledError, asyncio.TimeoutError, Exception) as e:
                        logger.debug(f"Ignored error: {e}")
                # Purge obsolete pending messages in the queue so the steering directive executes immediately
                while not session.message_queue.empty():
                    try:
                        session.message_queue.get_nowait()
                        session.message_queue.task_done()
                    except (asyncio.QueueEmpty, ValueError):
                        break
                data["prompt"] = f"[Instruction Prioritaire de Guidage] : {prompt}"
                await session.message_queue.put(data)
                await session.broadcast({
                    "event": "steered",
                    "conversation_id": session.conversation_id,
                    "message": "Guidage transmis : nouvelle instruction prioritaire en cours d'exécution."
                })
            else:
                await session.message_queue.put(data)
                qsize = session.message_queue.qsize()
                logger.info(f"Queued message in session {session.conversation_id} (queue size: {qsize})")
                await session.broadcast({
                    "event": "queued",
                    "conversation_id": session.conversation_id,
                    "queue_size": qsize,
                    "prompt_preview": prompt[:60]
                })
        else:
            await session.message_queue.put(data)

    async def interrupt(self, conversation_id: str | None = None):
        session = self.get_session(conversation_id)
        if not session:
            return

        logger.info(f"User requested explicit interruption for session {session.conversation_id}")
        # 1. Drain queued items
        while not session.message_queue.empty():
            try:
                session.message_queue.get_nowait()
                session.message_queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break

        # 2. Terminate active CLI process group (multiplateforme POSIX/Windows)
        if session.active_proc and session.active_proc.returncode is None:
            await terminate_process_group_async(session.active_proc, grace=0.5)

        # 3. Cancel active task
        if session.active_task and not session.active_task.done():
            session.active_task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(session.active_task), timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                logger.debug("Ignored error")

        session.is_running = False
        session.active_proc = None
        session.pending_approval = None
        await session.broadcast({
            "event": "interrupted",
            "conversation_id": session.conversation_id,
            "message": "Tour et file d'attente interrompus par l'utilisateur.",
            "queue_size": 0
        })

    async def clear_queue(self, conversation_id: str | None = None):
        session = self.get_session(conversation_id)
        if not session:
            return
        while not session.message_queue.empty():
            try:
                session.message_queue.get_nowait()
                session.message_queue.task_done()
            except (asyncio.QueueEmpty, ValueError):
                break
        await session.broadcast({
            "event": "queue_cleared",
            "conversation_id": session.conversation_id,
            "queue_size": 0
        })

    async def handle_approval(self, conversation_id: str | None, decision: str, rule: str | None):
        session = self.get_session(conversation_id)
        if not session:
            return

        logger.info(f"Approval decision: {decision} for rule: {rule} in session {session.conversation_id}")
        if decision == "always-allow" and rule:
            try:
                settings = get_settings()
                perms = settings.get("permissions")
                if not isinstance(perms, dict):
                    perms = {}
                    settings["permissions"] = perms
                raw_allow = perms.get("allow")
                allow_rules = list(raw_allow) if isinstance(raw_allow, list) else []
                if rule not in allow_rules:
                    allow_rules.append(rule)
                    perms["allow"] = allow_rules
                    save_settings(settings)
                    logger.info(f"Rule {rule} permanently added to permissions")
            except Exception as e:
                logger.error(f"Failed to update settings for approval: {e}")

        if (
            session.active_proc
            and session.active_proc.stdin
            and session.active_proc.returncode is None
            and not session.active_proc.stdin.is_closing()
        ):
            try:
                input_char = "y\n" if decision in ["allow-once", "allow-session", "always-allow"] else "n\n"
                session.active_proc.stdin.write(input_char.encode())
                await session.active_proc.stdin.drain()
            except (BrokenPipeError, ConnectionResetError):
                logger.debug("Proc stdin was closed before approval could be delivered")
            except Exception as e:
                logger.warning(f"Error writing approval to proc stdin: {e}")

        session.pending_approval = None
        await session.broadcast({
            "event": "approval_resolved",
            "conversation_id": session.conversation_id,
            "decision": decision
        })

    async def handle_stdin_input(self, conversation_id: str | None, text: str):
        session = self.get_session(conversation_id)
        if not session:
            return

        if (
            session.active_proc
            and session.active_proc.stdin
            and session.active_proc.returncode is None
            and not session.active_proc.stdin.is_closing()
        ):
            try:
                payload = text if text.endswith("\n") else f"{text}\n"
                session.active_proc.stdin.write(payload.encode("utf-8"))
                await session.active_proc.stdin.drain()
                logger.info(f"Stdin input routed to active proc in session {session.conversation_id}")
            except (BrokenPipeError, ConnectionResetError):
                logger.debug("Proc stdin was closed before stdin input could be delivered")
            except Exception as e:
                logger.warning(f"Error writing stdin input to proc stdin: {e}")

    async def close_all_sessions(self):
        """Cleanly terminates all active sessions, process groups, and background workers on server shutdown."""
        async with self._lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
            self.active_session = None

        for session in sessions:
            # 1. Drain queue
            while not session.message_queue.empty():
                try:
                    session.message_queue.get_nowait()
                    session.message_queue.task_done()
                except (asyncio.QueueEmpty, ValueError):
                    break

            # 2. Terminate active process group
            if session.active_proc and session.active_proc.returncode is None:
                try:
                    await terminate_process_group_async(session.active_proc, grace=0.5)
                except Exception as e:
                    logger.debug(f"Error terminating proc group for session {session.conversation_id}: {e}")

            # 3. Cancel active task
            if session.active_task and not session.active_task.done():
                session.active_task.cancel()

            # 4. Cancel worker task
            if session.worker_task and not session.worker_task.done():
                session.worker_task.cancel()

            session.is_running = False
            session.active_proc = None
            session.pending_approval = None


execution_manager = ExecutionManager()
