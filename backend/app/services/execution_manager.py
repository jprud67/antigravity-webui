import asyncio
import logging
import time
import uuid
from collections import deque
from typing import Any

from fastapi import WebSocket

from app.platform_utils import (
    terminate_process_group_async,
    terminate_process_group_sync,
)
from app.services import google_auth
from app.services.agy_driver import (
    get_model_families,
    resolve_model_and_effort,
    stream_turn,
)
from app.services.context_budget import (
    enforce_context_budget,
)
from app.services.google_auth import (
    get_active_account,
    is_quota_error,
    switch_to_next_healthy_account,
)
from app.services.link_understanding import enrich_user_prompt_with_links
from app.services.progress_card import get_progress_card, save_progress_card
from app.services.storage import (
    auto_truncate_transcript,
    get_settings,
    is_safe_conversation_id,
    save_settings,
)
from app.services.vector_memory import execute_auto_recall_hook

logger = logging.getLogger("antigravity.execution")

TOKEN_SAVER_DIRECTIVE = (
    "[CONSIGNE SYSTÈME ÉCONOMIE TOKENS : "
    "1) Commandes terminal : utiliser systématiquement des modes silencieux (-q, --bail) ou filtrés (grep, head -n 50, git log -n 5). "
    "2) Fichiers : privilégier strictement replace_file_content à write_to_file pour les modifications, et borner view_file avec StartLine/EndLine. "
    "3) Réponses : rester concis, ne pas régurgiter le code déjà existant inchangé.]\n\n"
)


def inject_eco_directives(prompt: str) -> str:
    clean = (prompt or "").strip()
    return f"{TOKEN_SAVER_DIRECTIVE}{clean}" if clean else TOKEN_SAVER_DIRECTIVE.strip()


def should_warn_error_loop(consecutive_errors: int) -> bool:
    return consecutive_errors == 3


def _clean_cid(cid: Any) -> str | None:
    if not cid or not isinstance(cid, str):
        return None
    c = cid.strip()
    if c.lower() in ("", "null", "undefined", "none"):
        return None
    if not is_safe_conversation_id(c):
        return None
    return c


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
        self.live_progress_card: dict[str, Any] | None = None
        self.recent_events: deque[dict[str, Any]] = deque(maxlen=50)

    def add_subscriber(self, ws: WebSocket | None):
        if ws is not None:
            self.subscribers.add(ws)
        self.last_active_at = time.time()

    def remove_subscriber(self, ws: WebSocket | None):
        if ws is not None:
            self.subscribers.discard(ws)
        if not self.subscribers:
            self.last_active_at = time.time()


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
                "tool_calls": self.live_tool_calls[-50:] if len(self.live_tool_calls) > 50 else self.live_tool_calls,
                "usage": self.live_usage,
                "pending_approval": self.pending_approval,
                "progress_card": self.live_progress_card or (get_progress_card(self.conversation_id) if self.conversation_id else None),
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

        # Enrich event with session's conversation_id if omitted
        if self.conversation_id:
            if "conversation_id" not in event:
                event["conversation_id"] = self.conversation_id
            if event.get("event") == "step_update" and isinstance(event.get("step_update"), dict):
                if not event["step_update"].get("conversation_id"):
                    event["step_update"]["conversation_id"] = self.conversation_id

        # Broadcast to all connected subscribers concurrently with bounded timeout
        subs = list(self.subscribers)
        if subs:
            async def _safe_send(ws: Any) -> tuple[bool, Any]:
                try:
                    await asyncio.wait_for(ws.send_json(event), timeout=2.0)
                    return True, ws
                except Exception:
                    return False, ws

            results = await asyncio.gather(*[_safe_send(ws) for ws in subs], return_exceptions=True)
            dead = set()
            for idx, res in enumerate(results):
                if isinstance(res, tuple) and not res[0]:
                    dead.add(res[1])
                elif isinstance(res, Exception):
                    dead.add(subs[idx])

            for ws in dead:
                self.subscribers.discard(ws)
                execution_manager.unregister_socket(ws, prune=False)

    def _update_live_state(self, event: dict[str, Any]):
        evt_type = event.get("event")
        if evt_type == "init":
            cid = _clean_cid(event.get("conversation_id"))
            if cid:
                self.conversation_id = cid
                execution_manager.register_session_cid(self, cid)

        elif evt_type == "progress_card":
            card_data = event.get("card")
            if isinstance(card_data, dict):
                self.live_progress_card = card_data
                if self.conversation_id:
                    save_progress_card(self.conversation_id, card_data)

        elif evt_type == "step_update":
            raw_update = event.get("step_update")
            update = raw_update if isinstance(raw_update, dict) else {}
            cid = _clean_cid(update.get("conversation_id"))
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
                cmd_val = update.get("command")
                if isinstance(cmd_val, str):
                    cmd_val = cmd_val.strip()
                path_val = update.get("path")
                if isinstance(path_val, str):
                    path_val = path_val.strip()
                self.pending_approval = {
                    "toolName": update.get("tool_name") or update.get("tool") or "Action Requise",
                    "command": cmd_val,
                    "path": path_val
                }

            if update.get("step_type") == "tool":
                raw_info = update.get("tool_info")
                tool_info = raw_info if isinstance(raw_info, dict) else {}
                tool_id = update.get("tool_id") or tool_info.get("id") or update.get("id")
                tool_name = update.get("tool_name") or tool_info.get("name") or "tool"
                tool_args = tool_info.get("parameters") or update.get("parameters")
                tool_output = tool_info.get("output")
                state_val = str(update.get("state") or "").upper()
                is_done = state_val == "DONE"
                is_error = state_val in ("ERROR", "FAILED")
                is_cancelled = state_val == "CANCELLED"

                found = False
                if tool_id:
                    for t in reversed(self.live_tool_calls):
                        if t.get("id") == tool_id:
                            if tool_args and not t.get("args"):
                                t["args"] = tool_args
                            if tool_output is not None:
                                t["result"] = tool_output
                            if is_done:
                                t["status"] = "done"
                            elif is_error:
                                t["status"] = "error"
                            elif is_cancelled:
                                t["status"] = "cancelled"
                            found = True
                            break
                    if not found:
                        for t in reversed(self.live_tool_calls):
                            if t.get("name") == tool_name and t.get("status") == "running" and not t.get("id"):
                                t["id"] = tool_id
                                if tool_args and not t.get("args"):
                                    t["args"] = tool_args
                                if is_done:
                                    t["status"] = "done"
                                elif is_error:
                                    t["status"] = "error"
                                elif is_cancelled:
                                    t["status"] = "cancelled"
                                if tool_output is not None:
                                    t["result"] = tool_output
                                found = True
                                break
                else:
                    for t in reversed(self.live_tool_calls):
                        if t.get("name") == tool_name and t.get("status") == "running":
                            if tool_args and not t.get("args"):
                                t["args"] = tool_args
                            if is_done:
                                t["status"] = "done"
                            elif is_error:
                                t["status"] = "error"
                            elif is_cancelled:
                                t["status"] = "cancelled"
                            if tool_output is not None:
                                t["result"] = tool_output
                            found = True
                            break

                if not found:
                    new_status = "done" if is_done else ("error" if is_error else ("cancelled" if is_cancelled else "running"))
                    new_tool_call = {
                        "name": tool_name,
                        "args": tool_args,
                        "result": tool_output,
                        "status": new_status
                    }
                    if tool_id:
                        new_tool_call["id"] = tool_id
                    self.live_tool_calls.append(new_tool_call)
                    if len(self.live_tool_calls) > 100:
                        running_calls = [t for t in self.live_tool_calls if t.get("status") == "running"]
                        done_calls = [t for t in self.live_tool_calls if t.get("status") != "running"]
                        keep_done = max(10, 100 - len(running_calls))
                        self.live_tool_calls = (running_calls + done_calls[-keep_done:])[-100:]

        elif evt_type == "command_result":
            raw_cmd = event.get("command")
            cmd = raw_cmd if isinstance(raw_cmd, dict) else {}
            c_name = cmd.get("name")
            raw_data = cmd.get("data")
            c_data = raw_data if isinstance(raw_data, dict) else {}
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
            raw_res = event.get("result")
            res = raw_res if isinstance(raw_res, dict) else {}
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
            cmd_val = event.get("command")
            if isinstance(cmd_val, str):
                cmd_val = cmd_val.strip()
            path_val = event.get("path")
            if isinstance(path_val, str):
                path_val = path_val.strip()
            self.pending_approval = {
                "toolName": event.get("tool_name") or event.get("tool") or "Action Requise",
                "command": cmd_val,
                "path": path_val
            }
        elif evt_type == "approval_resolved" or evt_type in ("done", "interrupted", "error", "model_failover", "account_failover"):
            self.pending_approval = None

    async def _clear_pending_approval(self, decision: str = "cancelled", reason: str = "reset") -> None:
        """Réinitialise et diffuse la résolution de toute approbation en suspens si nécessaire."""
        if self.pending_approval:
            self.pending_approval = None
            try:
                await self.broadcast({
                    "event": "approval_resolved",
                    "conversation_id": self.conversation_id,
                    "decision": decision,
                    "reason": reason
                })
            except Exception as e:
                logger.debug(f"Failed broadcasting approval_resolved: {e}")

    async def run_turn(self, params: dict[str, Any]):
        self.is_running = True
        if params.get("mode") == "steer":
            self.is_steering = True
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
        if isinstance(model, str) and not model.strip():
            model = None
        effort = params.get("effort")
        if isinstance(effort, str) and not effort.strip():
            effort = None
        auto_approve = params.get("auto_approve", True)
        agent_mode = params.get("agent_mode")
        if isinstance(agent_mode, str) and not agent_mode.strip():
            agent_mode = None
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
            settings = {}

        eco_mode = params.get("eco_mode")
        if eco_mode is None:
            eco_mode = settings.get("ecoMode", True)

        if eco_mode:
            prompt = inject_eco_directives(prompt)

        # Adaptive Effort (Token Thrift Architecture):
        # Prevent excessive thinking tokens on short conversational prompts (e.g., "oui", "1", "continue")
        clean_prompt_len = len((prompt or "").strip())
        current_model = model
        current_effort = effort
        if not current_effort:
            if clean_prompt_len <= 50:
                current_effort = "low"
            elif eco_mode:
                current_effort = "medium"
            else:
                current_effort = "medium"

        def on_proc_spawned(p: asyncio.subprocess.Process):
            self.active_proc = p

        attempt = 0
        max_failover_attempts = 5
        model_switched_on_current_account = False

        try:
            while attempt < max_failover_attempts:
                attempt += 1
                consecutive_errors = 0
                quota_error_detected = False
                self.live_thought = ""
                self.live_content = ""
                self.live_tool_calls = []
                self.live_usage = None
                self.pending_approval = None
                self.active_proc = None

                try:
                    active_cid = self.conversation_id or conv_id
                    # Context Budget Manager (IDE Token Parity & Cumulative Bloat Prevention):
                    # In Antigravity IDE, history is strictly constrained to avoid quadratic token explosion.
                    # In WebUI, we enforce a strict token ceiling via multi-stage progressive compaction
                    # (tool outputs, thinking blocks, assistant condensation, and sliding window).
                    if active_cid:
                        try:
                            auto_compact = settings.get("autoCompactContext", True)
                            if auto_compact:
                                budget_tokens = int(settings.get("contextBudgetTokens", 35000))
                                preserve_turns = int(settings.get("preserveLastNTurns", 2))
                                budget_res = enforce_context_budget(
                                    active_cid,
                                    max_tokens=budget_tokens,
                                    preserve_last_n_turns=preserve_turns
                                )
                                if budget_res.get("action_taken"):
                                    logger.info(
                                        f"[Session {active_cid}] Context Budget Manager applied {budget_res.get('stages_applied')}: "
                                        f"{budget_res.get('initial_tokens'):,} -> {budget_res.get('final_tokens'):,} tokens "
                                        f"(-{budget_res.get('tokens_saved'):,} tokens saved, {budget_res.get('compacted_steps')} steps)."
                                    )
                        except Exception as cp_err:
                            logger.debug(f"Context budget manager error: {cp_err}")

                    logger.info(f"[Session {active_cid}] Starting turn in background (attempt {attempt}, model={current_model}, effort={current_effort})...")
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
                        raw_cid = event.get("conversation_id") or event.get("step_update", {}).get("conversation_id")
                        cid = _clean_cid(raw_cid)
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
                                consecutive_errors += 1
                                if should_warn_error_loop(consecutive_errors):
                                    logger.warning(f"[Session {self.conversation_id}] Consecutive error loop detected ({consecutive_errors} errors).")
                                    await self.broadcast({
                                        "event": "loop_warning",
                                        "conversation_id": self.conversation_id or active_cid,
                                        "consecutive_errors": consecutive_errors,
                                        "message": "Boucle d'erreurs détectée (3 échecs consécutifs). Envisagez d'interrompre ou de réorienter l'agent pour préserver vos tokens."
                                    })
                                su_msg = su.get("error") or su.get("content") or ""
                                if is_quota_error(su_msg):
                                    quota_error_detected = True
                                    logger.warning(f"[Session {self.conversation_id}] Quota error detected in step_update: {su_msg}")
                                    break
                            elif su.get("status") in ("COMPLETED", "DONE", "SUCCESS"):
                                consecutive_errors = 0

                        await self.broadcast(event)

                except asyncio.CancelledError:
                    # Note: the canceller (user "interrupt" or steering) is responsible for
                    # broadcasting the relevant event; avoid duplicating "interrupted" here.
                    await self._clear_pending_approval(reason="interrupted")
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
                        await self._clear_pending_approval(reason="error")
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
                        await self._clear_pending_approval(reason="error")
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
                            cand_model = (
                                variants.get(cand.get("default_effort") or "")
                                or variants.get("default")
                                or next(iter(variants.values()), None)
                                or cand.get("id")
                            )
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
                                    await self._clear_pending_approval(reason="failover")
                                    if self.active_proc and self.active_proc.returncode is None:
                                        try:
                                            await terminate_process_group_async(self.active_proc, grace=0.5)
                                        except Exception as e:
                                            logger.debug(f"Error terminating previous proc on model failover: {e}")
                                    self.active_proc = None
                                    await self.broadcast({
                                        "event": "model_failover",
                                        "conversation_id": self.conversation_id,
                                        "previous_model": old_model,
                                        "new_model": current_model,
                                        "account": current_email,
                                        "reset_turn": True,
                                        "message": f"Quota atteint avec {old_model}. Basculement automatique sur {current_model} et relance de la tâche..."
                                    })
                                    break
                        if found_alternative and attempt < max_failover_attempts:
                            await asyncio.sleep(1.0)
                            continue
                        model_switched_on_current_account = True

                    # 2. Si le modèle a déjà été basculé ou si c'est impossible, basculer le compte Google
                    target_check_model = model if model else current_model
                    _switch_fn = getattr(google_auth, "switch_to_next_healthy_account", switch_to_next_healthy_account)
                    new_account = _switch_fn(exclude_email=exclude_email, model=target_check_model)
                    if not new_account and target_check_model != current_model:
                        new_account = _switch_fn(exclude_email=exclude_email, model=current_model)
                        target_check_model = current_model

                    if new_account and attempt < max_failover_attempts:
                        model_switched_on_current_account = False
                        current_model = target_check_model
                        current_effort = effort
                        logger.info(
                            f"[Session {self.conversation_id}] Auto-failover: Switched from {current_email} to {new_account} with model {current_model}. Relaunching task immediately..."
                        )
                        self.live_thought = ""
                        self.live_content = ""
                        self.live_tool_calls = []
                        await self._clear_pending_approval(reason="failover")
                        if self.active_proc and self.active_proc.returncode is None:
                            try:
                                await terminate_process_group_async(self.active_proc, grace=0.5)
                            except Exception as e:
                                logger.debug(f"Error terminating previous proc on account failover: {e}")
                        self.active_proc = None
                        await self.broadcast({
                            "event": "account_failover",
                            "conversation_id": self.conversation_id,
                            "previous_account": current_email,
                            "new_account": new_account,
                            "reset_turn": True,
                            "message": f"Quota atteint sur le compte Google {current_email}. Basculement automatique sur {new_account} et relance de la tâche..."
                        })
                        # Brief 1s pause before restarting to ensure token file is cleanly committed and locked
                        await asyncio.sleep(1.0)
                        continue
                    else:
                        await self._clear_pending_approval(reason="error")
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

                    # Auto-truncate large tool outputs in transcript to safeguard tokens for subsequent turns
                    if self.conversation_id:
                        try:
                            trunc_res = auto_truncate_transcript(self.conversation_id, max_lines=30, max_chars=2500)
                            if trunc_res.get("truncated_steps_count", 0) > 0:
                                logger.info(
                                    f"[Session {self.conversation_id}] Auto-truncated {trunc_res['truncated_steps_count']} steps in transcript "
                                    f"({trunc_res['chars_saved']} chars saved)."
                                )
                        except Exception as tr_err:
                            logger.debug(f"Auto-truncate transcript warning: {tr_err}")

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
            await self._clear_pending_approval(reason="error")
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
            if self.active_proc and self.active_proc.returncode is None:
                try:
                    await terminate_process_group_async(self.active_proc, grace=0.5)
                except Exception as e:
                    logger.debug(f"Error terminating active_proc in finally: {e}")
            self.active_proc = None
            self.is_running = False
            for tc in self.live_tool_calls:
                if isinstance(tc, dict) and tc.get("status") == "running":
                    tc["status"] = "cancelled" if self.is_steering else "done"
            await self._clear_pending_approval(reason="completed")
            self.last_active_at = time.time()

    async def queue_worker(self):
        try:
            while True:
                try:
                    item = await self.message_queue.get()
                except asyncio.CancelledError:
                    break
                self.is_steering = bool(item.get("mode") == "steer")
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
                        cancelling = getattr(current, "cancelling", None)
                        is_cancelling = callable(cancelling) and cancelling() > 0
                        if is_cancelling or (current is not None and current.cancelled()):
                            raise
                    except Exception as e:
                        logger.error(f"[Session {self.conversation_id}] Worker task error: {e}")
                finally:
                    self.active_task = None
                    self.is_running = False
                    self.is_steering = False
                    self.last_active_at = time.time()
                    self.message_queue.task_done()
        finally:
            self.is_running = False
            self.active_task = None


class ExecutionManager:
    """
    Server-level singleton managing all active background turns across conversations.
    Guarantees tasks never abort on accidental client reload or network drops.
    """
    def __init__(self) -> None:
        self.sessions: dict[str, ExecutionSession] = {}
        self.active_session: ExecutionSession | None = None
        self.connected_sockets: set[WebSocket] = set()
        self.socket_info: dict[WebSocket, dict[str, Any]] = {}
        self._background_tasks: set[asyncio.Task[Any]] = set()
        self._lock: asyncio.Lock = asyncio.Lock()

    def remove_session(self, conversation_id: str | None) -> None:
        """Immediately removes a session from memory, terminates any active child processes, and cancels tasks."""
        if not conversation_id:
            return
        target_session = self.sessions.pop(conversation_id, None)
        if self.active_session and (self.active_session.conversation_id == conversation_id or self.active_session is target_session):
            if not target_session:
                target_session = self.active_session
            self.active_session = None
        if target_session:
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
            target_session.is_steering = False
            target_session.active_proc = None
            target_session.pending_approval = None
            logger.info(f"Removed execution session for conversation {conversation_id} from memory.")

    def register_socket(self, ws: WebSocket, info: dict[str, Any] | None = None):
        self.connected_sockets.add(ws)
        if info is not None:
            self.socket_info[ws] = info
        else:
            self.socket_info[ws] = {
                "client_id": uuid.uuid4().hex[:8],
                "role": "host",
                "nickname": "Hôte",
                "avatar_color": "#3b82f6",
                "joined_at": time.time(),
            }

    def unregister_socket(self, ws: WebSocket, prune: bool = True):
        self.connected_sockets.discard(ws)
        info = self.socket_info.pop(ws, None)
        bound_cid = info.get("bound_conversation_id") if info else None

        # Track all affected conversation IDs to refresh live presence
        affected_cids: set[str] = set()
        if bound_cid:
            affected_cids.add(bound_cid)

        # Detach from all sessions WITHOUT stopping or cancelling anything!
        for cid, s in list(self.sessions.items()):
            if ws in s.subscribers:
                s.remove_subscriber(ws)
                if cid:
                    affected_cids.add(cid)
        if self.active_session:
            if ws in self.active_session.subscribers:
                self.active_session.remove_subscriber(ws)
                if getattr(self.active_session, "conversation_id", None):
                    affected_cids.add(self.active_session.conversation_id)

        if affected_cids:
            try:
                loop = asyncio.get_running_loop()
                if loop.is_running():
                    for target_cid in affected_cids:
                        loop.create_task(self.broadcast_presence(target_cid))
            except Exception as e:
                logger.debug(f"Could not broadcast presence on socket unregister: {e}")

        if prune:
            try:
                self.prune_inactive_sessions()
            except Exception as e:
                logger.debug(f"Error during socket disconnect prune: {e}")
        logger.info(
            f"WebSocket client disconnected; {len(self.get_running_conversations())} background task(s) continue running uninterrupted."
        )

    async def broadcast_presence(self, conversation_id: str | None) -> None:
        """Broadcasts live attendee presence list and count to all subscribers of a conversation."""
        if not conversation_id:
            return
        session = self.get_session(conversation_id)
        if not session:
            return

        participants: list[dict[str, Any]] = []
        seen_ids: set[str] = set()

        for ws in list(session.subscribers):
            info = self.socket_info.get(ws)
            if info:
                cid = info.get("client_id")
                if cid and cid not in seen_ids:
                    seen_ids.add(cid)
                    participants.append({
                        "client_id": cid,
                        "role": info.get("role", "host"),
                        "nickname": info.get("nickname", "Participant"),
                        "avatar_color": info.get("avatar_color", "#6366f1"),
                    })
            else:
                dummy_id = f"host_{id(ws) % 10000}"
                if dummy_id not in seen_ids:
                    seen_ids.add(dummy_id)
                    participants.append({
                        "client_id": dummy_id,
                        "role": "host",
                        "nickname": "Hôte",
                        "avatar_color": "#3b82f6",
                    })

        event = {
            "event": "presence_update",
            "conversation_id": conversation_id,
            "count": len(participants),
            "participants": participants,
        }
        await session.broadcast(event)

    async def broadcast_orchestrator_update(
        self,
        conversation_id: str | None,
        event_type: str = "node_update",
        node_data: dict[str, Any] | None = None
    ) -> None:
        """Broadcasts live multi-agent DAG hierarchy updates to all subscribers of a conversation."""
        if not conversation_id:
            return
        session = self.get_session(conversation_id)
        if not session:
            return

        event = {
            "event": "orchestrator_update",
            "conversation_id": conversation_id,
            "update_type": event_type,
            "node": node_data or {},
            "timestamp": time.time(),
        }
        await session.broadcast(event)

    def disconnect_token(self, share_token: str) -> int:
        """Closes all WebSockets attached to a specific share token."""
        to_disconnect = [
            ws for ws, info in self.socket_info.items()
            if info.get("share_token") == share_token
        ]
        for ws in to_disconnect:
            try:
                loop = asyncio.get_running_loop()
                loop.create_task(ws.close(code=4403, reason="Session Share Revoked"))
            except Exception as e:
                logger.debug("Failed closing revoked websocket: %s", e)
        return len(to_disconnect)

    def register_session_cid(self, session: ExecutionSession, cid: str | None) -> None:
        clean = _clean_cid(cid)
        if clean:
            old_cid = getattr(session, "conversation_id", None)
            if old_cid and old_cid != clean:
                self.sessions.pop(old_cid, None)
            existing = self.sessions.get(clean)
            if existing and existing is not session:
                for sub in list(existing.subscribers):
                    session.add_subscriber(sub)
                if not session.workspace_path and existing.workspace_path:
                    session.workspace_path = existing.workspace_path
                # Migrate pending queue messages from existing to session
                while not existing.message_queue.empty():
                    try:
                        item = existing.message_queue.get_nowait()
                        session.message_queue.put_nowait(item)
                        existing.message_queue.task_done()
                    except (asyncio.QueueEmpty, ValueError):
                        break
                if existing.active_proc and existing.active_proc.returncode is None:
                    try:
                        task = asyncio.create_task(terminate_process_group_async(existing.active_proc, grace=0.5))
                        self._background_tasks.add(task)
                        task.add_done_callback(self._background_tasks.discard)
                    except RuntimeError:
                        terminate_process_group_sync(existing.active_proc, force=True)
                if existing.worker_task and not existing.worker_task.done():
                    existing.worker_task.cancel()
                existing.is_running = False
                existing.active_proc = None
            session.conversation_id = clean
            self.sessions[clean] = session

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
                    try:
                        s.worker_task = asyncio.create_task(s.queue_worker())
                    except RuntimeError:
                        s.worker_task = None
                return s
            if self.active_session and self.active_session.conversation_id == conversation_id:
                self.sessions[conversation_id] = self.active_session
                if workspace_path:
                    self.active_session.workspace_path = workspace_path
                if not self.active_session.worker_task or self.active_session.worker_task.done():
                    try:
                        self.active_session.worker_task = asyncio.create_task(self.active_session.queue_worker())
                    except RuntimeError:
                        self.active_session.worker_task = None
                return self.active_session

        if not conversation_id and self.active_session and self.active_session.is_busy:
            if ws is None or ws in self.active_session.subscribers or self.active_session.conversation_id is None:
                if workspace_path and not self.active_session.workspace_path:
                    self.active_session.workspace_path = workspace_path
                if not self.active_session.worker_task or self.active_session.worker_task.done():
                    try:
                        self.active_session.worker_task = asyncio.create_task(self.active_session.queue_worker())
                    except RuntimeError:
                        self.active_session.worker_task = None
                return self.active_session

        if self.active_session and (not self.active_session.conversation_id or self.active_session.conversation_id not in self.sessions):
            if not self.active_session.is_busy and self.active_session.worker_task and not self.active_session.worker_task.done():
                self.active_session.worker_task.cancel()

        session = ExecutionSession(conversation_id=conversation_id, workspace_path=workspace_path)
        try:
            session.worker_task = asyncio.create_task(session.queue_worker())
        except RuntimeError:
            session.worker_task = None
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
            running = [s for s in list(self.sessions.values()) if s.is_busy]
            if running:
                return running[0]
        return None

    def is_running(self, conversation_id: str | None) -> bool:
        conversation_id = _clean_cid(conversation_id)
        session = self.get_session(conversation_id)
        return bool(session and session.is_busy)

    def get_running_conversations(self) -> list[str]:
        cids = {cid for cid, s in list(self.sessions.items()) if s.is_busy and cid}
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

        card = get_progress_card(conversation_id) if conversation_id else None
        return {
            "conversation_id": conversation_id,
            "is_running": False,
            "queue_size": 0,
            "live_state": {
                "progress_card": card
            } if card else None,
            "recent_events": []
        }

    async def submit_prompt(self, ws: WebSocket | None, data: dict[str, Any]):
        prompt = data.get("prompt", "").strip()
        if not prompt:
            if ws:
                await ws.send_json({"event": "error", "message": "Le prompt ne peut pas être vide."})
            return

        raw_cid = data.get("conversation_id")
        if raw_cid and isinstance(raw_cid, str) and raw_cid.strip().lower() not in ("", "null", "undefined", "none"):
            if not is_safe_conversation_id(raw_cid.strip()):
                if ws:
                    await ws.send_json({"event": "error", "message": "Identifiant de conversation invalide."})
                return

        conv_id = _clean_cid(raw_cid)
        ws_path = data.get("workspace_path")
        mode = data.get("mode", "normal")

        # Link understanding: if bare URLs are present in prompt, enrich it in background
        try:
            enriched_prompt, extracted = await enrich_user_prompt_with_links(prompt)
            if extracted:
                data["prompt"] = enriched_prompt
                prompt = enriched_prompt
        except Exception as e:
            logger.debug(f"Link understanding enrichment skipped: {e}")

        # Auto-recall vector memory hook: if relevant memories exist, prepend them
        try:
            recall_res = await execute_auto_recall_hook(prompt, agent_id=conv_id or "default")
            if recall_res.should_inject and recall_res.context_block:
                logger.info(f"Injecting {recall_res.recalled_count} auto-recalled memories into prompt for session {conv_id}")
                prompt = f"{recall_res.context_block}\n\n{prompt}"
                data["prompt"] = prompt
        except Exception as e:
            logger.debug(f"Auto-recall memory hook skipped: {e}")

        session = self.get_or_create_session(conv_id, ws_path, ws=ws)
        if ws is not None:
            session.add_subscriber(ws)
        session.last_active_at = time.time()
        self.active_session = session
        payload = dict(data)
        for k in ("model", "effort", "agent_mode"):
            v = payload.get(k)
            if isinstance(v, str) and not v.strip():
                payload[k] = None
        if not session.worker_task or session.worker_task.done():
            try:
                session.worker_task = asyncio.create_task(session.queue_worker())
            except RuntimeError:
                session.worker_task = None

        if session.is_busy:
            if mode == "steer":
                logger.info(f"Steering session {session.conversation_id}")
                session.is_steering = True
                if session.active_proc and session.active_proc.returncode is None:
                    await terminate_process_group_async(session.active_proc, grace=0.5)
                session.active_proc = None
                await session._clear_pending_approval(decision="cancelled", reason="steered")
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
                steering_prefix = "[Instruction Prioritaire de Guidage] : "
                payload["mode"] = "steer"
                payload["prompt"] = prompt if prompt.startswith(steering_prefix) else f"{steering_prefix}{prompt}"
                await session.message_queue.put(payload)
                await session.broadcast({
                    "event": "steered",
                    "conversation_id": session.conversation_id,
                    "message": "Guidage transmis : nouvelle instruction prioritaire en cours d'exécution."
                })
            else:
                await session.message_queue.put(payload)
                qsize = session.message_queue.qsize()
                logger.info(f"Queued message in session {session.conversation_id} (queue size: {qsize})")
                await session.broadcast({
                    "event": "queued",
                    "conversation_id": session.conversation_id,
                    "queue_size": qsize,
                    "prompt_preview": prompt[:60]
                })
        else:
            await session.message_queue.put(payload)

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

        for tc in session.live_tool_calls:
            if isinstance(tc, dict) and tc.get("status") == "running":
                tc["status"] = "cancelled"
        session.is_running = False
        session.is_steering = False
        session.active_proc = None
        await session._clear_pending_approval(decision="cancelled", reason="interrupted")
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

        proc_stdin = session.active_proc.stdin if session.active_proc else None
        is_closing_fn = getattr(proc_stdin, "is_closing", None)
        closing = is_closing_fn() if callable(is_closing_fn) else False
        if (
            session.active_proc
            and proc_stdin
            and session.active_proc.returncode is None
            and not closing
        ):
            try:
                input_char = "y\n" if decision in ["allow-once", "allow-session", "always-allow"] else "n\n"
                proc_stdin.write(input_char.encode())
                await proc_stdin.drain()
            except (BrokenPipeError, ConnectionResetError, ValueError, RuntimeError, OSError):
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

        proc_stdin = session.active_proc.stdin if session.active_proc else None
        is_closing_fn = getattr(proc_stdin, "is_closing", None)
        closing = is_closing_fn() if callable(is_closing_fn) else False
        if (
            session.active_proc
            and proc_stdin
            and session.active_proc.returncode is None
            and not closing
        ):
            try:
                payload = text if text.endswith("\n") else f"{text}\n"
                proc_stdin.write(payload.encode("utf-8"))
                await proc_stdin.drain()
                logger.info(f"Stdin input routed to active proc in session {session.conversation_id}")
            except (BrokenPipeError, ConnectionResetError, ValueError, RuntimeError, OSError):
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
