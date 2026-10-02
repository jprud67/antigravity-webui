"""Telegram Messaging Gateway & NIST SP 800-63B Compliant PIN Pairing.

Enables controlling Antigravity WebUI / CLI agents directly from Telegram.
Enforces PIN pairing for unknown senders, rate limiting, and lockout.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from typing import Any

import httpx

from app.config import DEFAULT_WORKSPACE
from app.services.execution_manager import execution_manager
from app.services.messaging_gateway import (
    get_gateway_raw_config,
    is_user_approved,
    request_pairing,
)

logger = logging.getLogger("antigravity.telegram_gateway")

TELEGRAM_API_BASE = "https://api.telegram.org/bot{token}"
MAX_TELEGRAM_MSG_LEN = 4000


class TelegramSessionSubscriber:
    """Subscribes to an ExecutionSession to relay progress and answers back to Telegram."""

    def __init__(self, chat_id: int | str, gateway: TelegramGateway, conv_id: str):
        self.chat_id = chat_id
        self.gateway = gateway
        self.conv_id = conv_id
        self.last_action_time = 0.0
        self.accumulated_text = ""
        self.is_done = False

    async def send_json(self, event: dict[str, Any]) -> None:
        try:
            evt_type = event.get("event")
            now = time.time()

            if evt_type == "step_update":
                if now - self.last_action_time > 4.0:
                    self.last_action_time = now
                    asyncio.create_task(self.gateway.send_chat_action(self.chat_id, "typing"))

            elif evt_type == "approval_request":
                cmd = event.get("command") or ""
                tool = event.get("tool_name") or event.get("tool") or "Action Requise"
                path = event.get("path") or ""
                detail = f"\nCommande: `{cmd}`" if cmd else (f"\nChemin: `{path}`" if path else "")
                msg = (
                    f"⚠️ **Demande d'approbation Antigravity**\n\n"
                    f"Outil : **{tool}**{detail}\n\n"
                    f"👉 Répondez `/approve` pour valider ou `/reject` pour refuser."
                )
                await self.gateway.send_message(self.chat_id, msg)

            elif evt_type == "result":
                res = event.get("result", {})
                if isinstance(res, dict) and res.get("response"):
                    self.accumulated_text = res["response"]

            elif evt_type == "error":
                err = event.get("message") or "Une erreur est survenue lors de l'exécution."
                self.is_done = True
                await self.gateway.send_message(self.chat_id, f"❌ **Erreur Antigravity** :\n{err}")
                self._detach()

            elif evt_type in ("done", "interrupted"):
                if self.is_done:
                    return
                self.is_done = True
                session = execution_manager.get_session(self.conv_id)
                final_text = self.accumulated_text or (session.live_content if session else "")
                if evt_type == "interrupted":
                    final_text = (final_text + "\n\n⏹️ *Exécution interrompue.*").strip()
                elif not final_text:
                    final_text = "✅ *Tâche terminée par Antigravity.*"

                await self.gateway.send_message(self.chat_id, final_text)
                self._detach()

        except Exception as e:
            logger.debug(f"TelegramSessionSubscriber error: {e}")

    def _detach(self) -> None:
        try:
            session = execution_manager.get_session(self.conv_id)
            if session:
                session.remove_subscriber(self)
        except Exception as e:
            logger.debug(f"Failed detaching telegram subscriber: {e}")


class TelegramGateway:
    """Manages Telegram bot long-polling, PIN pairing, and Antigravity execution."""

    def __init__(self) -> None:
        self._poller_task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()
        self._user_conversations: dict[str, str] = {}  # chat_id -> conv_id
        self._active_subscribers: dict[str, TelegramSessionSubscriber] = {}
        self._bot_token: str | None = None

    def _get_token(self) -> str | None:
        if self._bot_token and not self._bot_token.startswith("123456789:") and not self._bot_token.startswith("actual_bot_secret"):
            return self._bot_token

        cfg = get_gateway_raw_config("telegram")
        db_token = (cfg.get("bot_token") or "").strip() if cfg and cfg.get("is_active") else ""
        env_token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()

        # If DB token is not a dummy test token, prioritize it
        if db_token and not db_token.startswith("123456789:") and not db_token.startswith("actual_bot_secret"):
            self._bot_token = db_token
            return db_token

        if env_token:
            self._bot_token = env_token
            return env_token

        if db_token:
            self._bot_token = db_token
            return db_token

        return None

    async def start(self) -> None:
        """Start the Telegram gateway poller if a token is configured."""
        if self._poller_task and not self._poller_task.done():
            return
        token = self._get_token()
        if not token:
            logger.info("Telegram gateway: No bot token configured. Poller idle.")
            return

        self._bot_token = token
        self._stop_event.clear()
        self._poller_task = asyncio.create_task(self._poll_loop(token), name="telegram_gateway_poller")
        logger.info("Telegram gateway service started successfully")

    async def stop(self) -> None:
        """Stop the Telegram gateway poller."""
        self._stop_event.set()
        if self._poller_task:
            self._poller_task.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(self._poller_task), timeout=2.0)
            except (asyncio.CancelledError, asyncio.TimeoutError, Exception):
                pass
            self._poller_task = None
        logger.info("Telegram gateway service stopped")

    async def restart(self) -> None:
        """Restart gateway poller (e.g. after updating token)."""
        await self.stop()
        await self.start()

    async def send_message(
        self,
        chat_id: int | str,
        text: str,
        parse_mode: str | None = "Markdown",
        reply_markup: dict[str, Any] | None = None,
    ) -> bool:
        """Send a message to a Telegram chat with automatic chunking and fallback."""
        token = self._get_token()
        if not token:
            return False

        url = f"{TELEGRAM_API_BASE.format(token=token)}/sendMessage"
        chunks = self._chunk_text(text)

        async with httpx.AsyncClient(timeout=15.0) as client:
            for chunk in chunks:
                payload: dict[str, Any] = {"chat_id": chat_id, "text": chunk}
                if parse_mode:
                    payload["parse_mode"] = parse_mode
                if reply_markup:
                    payload["reply_markup"] = reply_markup

                try:
                    resp = await client.post(url, json=payload)
                    if resp.status_code == 400 and parse_mode:
                        # Retry without Markdown formatting if entity parsing failed
                        payload.pop("parse_mode", None)
                        await client.post(url, json=payload)
                    elif resp.status_code >= 400:
                        logger.warning(f"Telegram sendMessage failed ({resp.status_code}): {resp.text}")
                except Exception as e:
                    logger.error(f"Error sending Telegram message to {chat_id}: {e}")
                    return False
        return True

    async def send_chat_action(self, chat_id: int | str, action: str = "typing") -> None:
        """Emit a chat action (typing, upload_document, etc.)."""
        token = self._get_token()
        if not token:
            return
        url = f"{TELEGRAM_API_BASE.format(token=token)}/sendChatAction"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                await client.post(url, json={"chat_id": chat_id, "action": action})
        except Exception:
            pass

    async def send_notification(self, text: str, chat_id: str | None = None) -> bool:
        """Send an administrative notification to the default configured chat_id or specified chat."""
        target_chat = chat_id
        if not target_chat:
            cfg = get_gateway_raw_config("telegram")
            if cfg and cfg.get("chat_id"):
                target_chat = cfg["chat_id"]
        if not target_chat:
            return False
        return await self.send_message(target_chat, text)

    @staticmethod
    def _chunk_text(text: str) -> list[str]:
        """Split text into chunks under MAX_TELEGRAM_MSG_LEN without breaking lines unnecessarily."""
        if len(text) <= MAX_TELEGRAM_MSG_LEN:
            return [text]

        chunks: list[str] = []
        lines = text.split("\n")
        current_chunk: list[str] = []
        current_len = 0

        for line in lines:
            line_len = len(line) + 1
            if current_len + line_len > MAX_TELEGRAM_MSG_LEN:
                if current_chunk:
                    chunks.append("\n".join(current_chunk))
                    current_chunk = []
                    current_len = 0
                if len(line) > MAX_TELEGRAM_MSG_LEN:
                    for i in range(0, len(line), MAX_TELEGRAM_MSG_LEN):
                        chunks.append(line[i : i + MAX_TELEGRAM_MSG_LEN])
                else:
                    current_chunk.append(line)
                    current_len = len(line)
            else:
                current_chunk.append(line)
                current_len += line_len

        if current_chunk:
            chunks.append("\n".join(current_chunk))

        return chunks or [text]

    async def _poll_loop(self, token: str) -> None:
        """Long polling loop for Telegram updates."""
        offset = 0
        get_updates_url = f"{TELEGRAM_API_BASE.format(token=token)}/getUpdates"
        logger.info("Telegram gateway polling loop initiated")

        # Initial check to delete webhooks if present
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{TELEGRAM_API_BASE.format(token=token)}/deleteWebhook"
                await client.post(del_url, json={"drop_pending_updates": False})
                me_url = f"{TELEGRAM_API_BASE.format(token=token)}/getMe"
                me_res = await client.get(me_url)
                if me_res.status_code == 200:
                    bot_user = me_res.json().get("result", {})
                    logger.info(f"Connected to Telegram bot: @{bot_user.get('username')}")
        except Exception as e:
            logger.warning(f"Telegram webhook reset check: {e}")

        while not self._stop_event.is_set():
            try:
                async with httpx.AsyncClient(timeout=35.0) as client:
                    resp = await client.post(
                        get_updates_url,
                        json={
                            "offset": offset,
                            "timeout": 25,
                            "allowed_updates": ["message", "callback_query"],
                        },
                    )

                    if resp.status_code == 200:
                        data = resp.json()
                        updates = data.get("result", [])
                        for update in updates:
                            update_id = update.get("update_id", 0)
                            offset = max(offset, update_id + 1)
                            await self._handle_update(update)
                    elif resp.status_code in (401, 404):
                        logger.error("Telegram bot token invalid. Stopping poller.")
                        break
                    elif resp.status_code == 409:
                        logger.warning("Telegram conflict (another bot instance running). Retrying in 10s...")
                        await asyncio.sleep(10.0)
                    else:
                        logger.debug(f"Telegram getUpdates returned {resp.status_code}")
                        await asyncio.sleep(2.0)

            except (httpx.TimeoutException, asyncio.TimeoutError):
                continue
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Telegram polling loop exception: {e}")
                await asyncio.sleep(5.0)

    async def _handle_update(self, update: dict[str, Any]) -> None:
        """Route incoming updates."""
        message = update.get("message")
        if not message:
            return

        sender = message.get("from", {})
        user_id = str(sender.get("id"))
        username = sender.get("username")
        user_name = username or f"{sender.get('first_name', '')} {sender.get('last_name', '')}".strip() or "Telegram User"
        chat_id = message.get("chat", {}).get("id")
        text = (message.get("text") or "").strip()

        if not chat_id or not user_id:
            return

        # ── NIST SP 800-63B Authentication & Pairing Check ────────────────
        if not is_user_approved("telegram", user_id):
            ok, msg, code = request_pairing("telegram", user_id, user_name)
            if ok and code:
                reply = (
                    "🔒 **Antigravity WebUI — Appairage PIN Requis**\n"
                    "*(Conforme aux normes de sécurité NIST SP 800-63B)*\n\n"
                    f"Votre code d'authentification unique : `{code}`\n\n"
                    "👉 Veuillez saisir ce code dans votre interface **Antigravity WebUI** "
                    "(Menu > **Passerelle Telegram & Discord**) pour autoriser cet appareil.\n"
                    "*(Code temporaire valable 1 heure, 5 tentatives maximum)*"
                )
            else:
                reply = f"⏳ **Accès restreint** :\n{msg}"

            await self.send_message(chat_id, reply)
            return

        # ── Authenticated User Command & Prompt Handling ───────────────────
        if text.startswith("/"):
            parts = text.split(maxsplit=1)
            cmd = parts[0].lower().split("@")[0]
            args = parts[1] if len(parts) > 1 else ""
            await self._handle_command(chat_id, user_id, user_name, cmd, args)
        elif text:
            await self._execute_prompt(chat_id, text)

    async def _handle_command(
        self,
        chat_id: int,
        user_id: str,
        user_name: str,
        cmd: str,
        args: str,
    ) -> None:
        """Handle slash commands from approved users."""
        chat_str = str(chat_id)
        conv_id = self._user_conversations.get(chat_str)

        if cmd in ("/start", "/help"):
            msg = (
                "🤖 **Antigravity WebUI — Passerelle Connectée**\n\n"
                f"Bienvenue **{user_name}** ! Votre appareil est vérifié et conforme **NIST SP 800-63B**.\n"
                "Vous pouvez piloter directement votre agent Antigravity depuis cette conversation.\n\n"
                "**Commandes disponibles :**\n"
                "• Envoyez simplement un message texte pour exécuter une tâche\n"
                "• `/status` — Vérifier l'état de l'agent et de la session\n"
                "• `/new` — Démarrer une nouvelle conversation vierge\n"
                "• `/stop` ou `/cancel` — Interrompre l'exécution en cours\n"
                "• `/approve` ou `/reject` — Valider ou rejeter une commande outil en attente\n"
            )
            await self.send_message(chat_id, msg)

        elif cmd == "/status":
            running = execution_manager.is_running(conv_id) if conv_id else False
            all_running = execution_manager.get_running_conversations()
            session = execution_manager.get_session(conv_id) if conv_id else None
            qsize = session.message_queue.qsize() if session else 0

            msg = (
                "📊 **État Antigravity WebUI**\n\n"
                f"• **Session active :** `{conv_id or 'Aucune (sera créée au 1er message)'}`\n"
                f"• **En cours d'exécution :** {'🟢 Oui' if running else '⚪ Inactif'}\n"
                f"• **File d'attente locale :** `{qsize}` tâche(s)\n"
                f"• **Sessions globales actives :** `{len(all_running)}`\n"
                f"• **Répertoire de travail :** `{DEFAULT_WORKSPACE}`"
            )
            await self.send_message(chat_id, msg)

        elif cmd in ("/new", "/reset"):
            new_cid = f"tg_{chat_id}_{secrets.token_hex(4)}"
            self._user_conversations[chat_str] = new_cid
            await self.send_message(
                chat_id,
                f"✨ **Nouvelle session Antigravity initialisée !**\nID : `{new_cid}`",
            )

        elif cmd in ("/stop", "/cancel", "/interrupt"):
            if conv_id and execution_manager.is_running(conv_id):
                await execution_manager.interrupt(conv_id)
                await self.send_message(chat_id, "⏹️ **Instruction envoyée : exécution Antigravity interrompue.**")
            else:
                await self.send_message(chat_id, "ℹ️ Aucune exécution en cours sur votre session.")

        elif cmd in ("/approve", "/reject"):
            decision = "approved" if cmd == "/approve" else "rejected"
            if conv_id:
                session = execution_manager.get_session(conv_id)
                if session and session.pending_approval:
                    await execution_manager.handle_approval(conv_id, decision=decision)
                    await self.send_message(
                        chat_id,
                        f"✅ **Décision enregistrée :** `{decision}` pour l'action en attente.",
                    )
                else:
                    await self.send_message(chat_id, "ℹ️ Aucune action en attente d'approbation sur cette session.")
            else:
                await self.send_message(chat_id, "ℹ️ Aucune session active.")

        else:
            await self.send_message(chat_id, f"Commande inconnue : `{cmd}`. Tapez `/help` pour la liste.")

    async def _execute_prompt(self, chat_id: int, prompt: str) -> None:
        """Enqueue prompt into Antigravity execution manager and stream feedback."""
        chat_str = str(chat_id)
        conv_id = self._user_conversations.get(chat_str)
        if not conv_id:
            conv_id = f"tg_{chat_id}_{secrets.token_hex(4)}"
            self._user_conversations[chat_str] = conv_id

        await self.send_chat_action(chat_id, "typing")
        await self.send_message(chat_id, "🤖 *Antigravity prend en charge votre demande...*")

        session = execution_manager.get_or_create_session(conv_id, DEFAULT_WORKSPACE)
        subscriber = TelegramSessionSubscriber(chat_id, self, conv_id)
        session.add_subscriber(subscriber)
        self._active_subscribers[chat_str] = subscriber

        # Submit prompt to execution manager
        data = {
            "prompt": prompt,
            "conversation_id": conv_id,
            "workspace_path": DEFAULT_WORKSPACE,
            "mode": "normal",
        }
        await execution_manager.submit_prompt(ws=None, data=data)



# Global singleton instance
telegram_gateway = TelegramGateway()


async def run_standalone() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    logger.info("Starting Antigravity Telegram Gateway...")
    await telegram_gateway.start()
    try:
        while True:
            await asyncio.sleep(1)
    except (asyncio.CancelledError, KeyboardInterrupt):
        await telegram_gateway.stop()


if __name__ == "__main__":
    asyncio.run(run_standalone())
