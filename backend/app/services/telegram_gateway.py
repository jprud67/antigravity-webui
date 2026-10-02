"""Telegram Messaging Gateway & NIST SP 800-63B Compliant PIN Pairing.

Enables controlling Antigravity WebUI / CLI agents directly from Telegram.
Features adapted from Hermes Agent Telegram integration:
1. NIST SP 800-63B compliant PIN pairing for unknown senders.
2. Interactive inline keyboard buttons for tool approvals & quick actions.
3. In-place live message editing for streaming progress updates.
4. Native Telegram slash command menu registration (setMyCommands).
5. Document, photo, and voice file ingestion saved directly to workspace.
6. Automatic message chunking (4000 chars) & Markdown entity parsing fallback.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from pathlib import Path
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
    """Subscribes to an ExecutionSession to relay progress and answers back to Telegram with in-place edits."""

    def __init__(
        self,
        chat_id: int | str,
        gateway: TelegramGateway,
        conv_id: str,
        initial_msg_id: int | None = None,
    ):
        self.chat_id = chat_id
        self.gateway = gateway
        self.conv_id = conv_id
        self.initial_msg_id = initial_msg_id
        self.last_action_time = 0.0
        self.last_edit_time = 0.0
        self.accumulated_text = ""
        self.is_done = False
        self.current_step_desc = ""

    async def send_json(self, event: dict[str, Any]) -> None:
        try:
            evt_type = event.get("event")
            now = time.time()

            if evt_type == "step_update":
                step = event.get("step_update", {})
                tool_name = step.get("name") or step.get("type") or ""
                if tool_name:
                    self.current_step_desc = f"Action : `{tool_name}`"

                # Edit message in-place throttled every 3.5s (Hermes style progress edit)
                if self.initial_msg_id and (now - self.last_edit_time > 3.5):
                    self.last_edit_time = now
                    status_text = f"⚙️ *Antigravity en cours...*\n{self.current_step_desc}".strip()
                    await self.gateway.edit_message(self.chat_id, self.initial_msg_id, status_text)
                elif now - self.last_action_time > 4.0:
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
                    f"👉 Cliquez sur une option ci-dessous pour valider ou refuser :"
                )
                # Hermes style interactive approval buttons
                keyboard = {
                    "inline_keyboard": [
                        [
                            {"text": "✅ Approuver", "callback_data": f"approve:{self.conv_id}"},
                            {"text": "❌ Rejeter", "callback_data": f"reject:{self.conv_id}"},
                        ]
                    ]
                }
                await self.gateway.send_message(self.chat_id, msg, reply_markup=keyboard)

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
                elif not final_text and session and session.live_tool_calls:
                    tools_done = [t.get("name") for t in session.live_tool_calls if t.get("status") == "done"]
                    if tools_done:
                        final_text = f"✅ Tâche terminée ({len(tools_done)} action(s) effectuée(s) : {', '.join(tools_done[:3])})."
                if not final_text:
                    final_text = "✅ *Tâche terminée par Antigravity.*"

                # Interactive quick action buttons
                quick_menu = {
                    "inline_keyboard": [
                        [
                            {"text": "📊 Statut", "callback_data": "cmd:status"},
                            {"text": "✨ Nouveau", "callback_data": "cmd:new"},
                            {"text": "⏹️ Arrêter", "callback_data": "cmd:stop"},
                        ]
                    ]
                }

                chunks = TelegramGateway._chunk_text(final_text)
                if self.initial_msg_id and chunks:
                    first_markup = quick_menu if len(chunks) == 1 else None
                    edited = await self.gateway.edit_message(
                        self.chat_id,
                        self.initial_msg_id,
                        chunks[0],
                        reply_markup=first_markup,
                    )
                    if not edited:
                        await self.gateway.send_message(self.chat_id, chunks[0], reply_markup=first_markup)

                    for idx, chunk in enumerate(chunks[1:], start=2):
                        is_last = (idx == len(chunks))
                        await self.gateway.send_message(
                            self.chat_id,
                            chunk,
                            reply_markup=quick_menu if is_last else None,
                        )
                else:
                    await self.gateway.send_message(self.chat_id, final_text, reply_markup=quick_menu)

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
            for idx, chunk in enumerate(chunks):
                is_last = (idx == len(chunks) - 1)
                payload: dict[str, Any] = {"chat_id": chat_id, "text": chunk}
                if parse_mode:
                    payload["parse_mode"] = parse_mode
                if reply_markup and is_last:
                    payload["reply_markup"] = reply_markup

                try:
                    resp = await client.post(url, json=payload)
                    if resp.status_code == 400 and parse_mode:
                        payload.pop("parse_mode", None)
                        await client.post(url, json=payload)
                    elif resp.status_code >= 400:
                        logger.warning(f"Telegram sendMessage failed ({resp.status_code}): {resp.text}")
                except Exception as e:
                    logger.error(f"Error sending Telegram message to {chat_id}: {e}")
                    return False
        return True

    async def send_message_returning_id(
        self,
        chat_id: int | str,
        text: str,
        parse_mode: str | None = "Markdown",
        reply_markup: dict[str, Any] | None = None,
    ) -> int | None:
        """Send a message and return the Telegram message_id for subsequent in-place edits."""
        token = self._get_token()
        if not token:
            return None

        url = f"{TELEGRAM_API_BASE.format(token=token)}/sendMessage"
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text[:MAX_TELEGRAM_MSG_LEN]}
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 400 and parse_mode:
                    payload.pop("parse_mode", None)
                    resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    return resp.json().get("result", {}).get("message_id")
                logger.warning(f"Telegram sendMessageReturningId failed ({resp.status_code}): {resp.text}")
            except Exception as e:
                logger.error(f"Error in send_message_returning_id: {e}")
        return None

    async def edit_message(
        self,
        chat_id: int | str,
        message_id: int,
        text: str,
        parse_mode: str | None = "Markdown",
        reply_markup: dict[str, Any] | None = None,
    ) -> bool:
        """Edit an existing message in-place for live streaming and status updates."""
        token = self._get_token()
        if not token:
            return False

        url = f"{TELEGRAM_API_BASE.format(token=token)}/editMessageText"
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "message_id": message_id,
            "text": text[:MAX_TELEGRAM_MSG_LEN],
        }
        if parse_mode:
            payload["parse_mode"] = parse_mode
        if reply_markup:
            payload["reply_markup"] = reply_markup

        async with httpx.AsyncClient(timeout=15.0) as client:
            try:
                resp = await client.post(url, json=payload)
                if resp.status_code == 400 and parse_mode:
                    payload.pop("parse_mode", None)
                    resp = await client.post(url, json=payload)
                return resp.status_code == 200
            except Exception as e:
                logger.debug(f"Error in edit_message: {e}")
                return False

    async def answer_callback_query(
        self,
        callback_query_id: str,
        text: str | None = None,
        show_alert: bool = False,
    ) -> bool:
        """Acknowledge an interactive button press on Telegram."""
        token = self._get_token()
        if not token:
            return False

        url = f"{TELEGRAM_API_BASE.format(token=token)}/answerCallbackQuery"
        payload: dict[str, Any] = {"callback_query_id": callback_query_id}
        if text:
            payload["text"] = text
        if show_alert:
            payload["show_alert"] = True

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                resp = await client.post(url, json=payload)
                return resp.status_code == 200
            except Exception as e:
                logger.debug(f"Error in answer_callback_query: {e}")
                return False

    async def register_bot_commands(self, token: str) -> None:
        """Register Telegram native slash commands menu on Bot API."""
        url = f"{TELEGRAM_API_BASE.format(token=token)}/setMyCommands"
        commands = [
            {"command": "help", "description": "Afficher l'aide et les commandes"},
            {"command": "status", "description": "État de l'agent et de la session"},
            {"command": "new", "description": "Démarrer une nouvelle session"},
            {"command": "stop", "description": "Interrompre l'exécution en cours"},
            {"command": "approve", "description": "Approuver une action d'outil"},
            {"command": "reject", "description": "Rejeter une action d'outil"},
        ]
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json={"commands": commands})
                if resp.status_code == 200:
                    logger.info("Telegram setMyCommands registered successfully")
                else:
                    logger.warning(f"Telegram setMyCommands failed: {resp.text}")
        except Exception as e:
            logger.warning(f"Error registering setMyCommands: {e}")

    async def download_file(self, file_id: str, file_name: str) -> str | None:
        """Download uploaded files/photos/audio from Telegram into the workspace."""
        token = self._get_token()
        if not token:
            return None

        get_file_url = f"{TELEGRAM_API_BASE.format(token=token)}/getFile"
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(get_file_url, json={"file_id": file_id})
            if res.status_code != 200:
                logger.error(f"Failed getFile for {file_id}: {res.text}")
                return None
            file_path = res.json().get("result", {}).get("file_path")
            if not file_path:
                return None

            download_url = f"https://api.telegram.org/file/bot{token}/{file_path}"
            dl_res = await client.get(download_url)
            if dl_res.status_code != 200:
                logger.error(f"Failed downloading file from {file_path}")
                return None

            save_dir = Path(DEFAULT_WORKSPACE) / "telegram_uploads"
            save_dir.mkdir(parents=True, exist_ok=True)
            safe_name = os.path.basename(file_name).replace(" ", "_")
            target_file = save_dir / safe_name
            target_file.write_bytes(dl_res.content)
            logger.info(f"Downloaded Telegram media to {target_file}")
            return f"telegram_uploads/{safe_name}"

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

        # Initial handshake, webhook cleanup and native commands registration
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                del_url = f"{TELEGRAM_API_BASE.format(token=token)}/deleteWebhook"
                await client.post(del_url, json={"drop_pending_updates": False})
                me_url = f"{TELEGRAM_API_BASE.format(token=token)}/getMe"
                me_res = await client.get(me_url)
                if me_res.status_code == 200:
                    bot_user = me_res.json().get("result", {})
                    logger.info(f"Connected to Telegram bot: @{bot_user.get('username')}")
            await self.register_bot_commands(token)
        except Exception as e:
            logger.warning(f"Telegram init check: {e}")

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
        """Route incoming updates: messages and inline keyboard callback queries."""
        # 1. Handle interactive button callbacks
        if "callback_query" in update:
            await self._handle_callback_query(update["callback_query"])
            return

        # 2. Handle standard messages
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

        # ── Authenticated User Media Upload Handling (Files, Photos, Audio) ─
        has_media = any(k in message for k in ("document", "photo", "voice", "audio"))
        if has_media:
            await self._handle_media_message(chat_id, message)
            return

        # ── Authenticated User Command & Prompt Handling ───────────────────
        if text.startswith("/"):
            parts = text.split(maxsplit=1)
            cmd = parts[0].lower().split("@")[0]
            args = parts[1] if len(parts) > 1 else ""
            await self._handle_command(chat_id, user_id, user_name, cmd, args)
        elif text:
            await self._execute_prompt(chat_id, text)

    async def _handle_callback_query(self, cb: dict[str, Any]) -> None:
        """Handle inline button presses from Telegram (approvals, quick commands)."""
        cb_id = cb.get("id")
        cb_data = cb.get("data", "")
        sender = cb.get("from", {})
        user_id = str(sender.get("id"))
        user_name = sender.get("username") or sender.get("first_name", "Operator")
        msg = cb.get("message", {})
        chat_id = msg.get("chat", {}).get("id")
        msg_id = msg.get("message_id")

        if not is_user_approved("telegram", user_id):
            if cb_id:
                await self.answer_callback_query(cb_id, text="Accès refusé : Appairage requis", show_alert=True)
            return

        if cb_data.startswith("approve:"):
            conv_id = cb_data.split(":", 1)[1]
            await execution_manager.handle_approval(conv_id, decision="approved")
            if cb_id:
                await self.answer_callback_query(cb_id, text="Action approuvée !")
            if chat_id and msg_id:
                await self.edit_message(chat_id, msg_id, "✅ **Action validée et exécutée par Antigravity.**")

        elif cb_data.startswith("reject:"):
            conv_id = cb_data.split(":", 1)[1]
            await execution_manager.handle_approval(conv_id, decision="rejected")
            if cb_id:
                await self.answer_callback_query(cb_id, text="Action rejetée.")
            if chat_id and msg_id:
                await self.edit_message(chat_id, msg_id, "❌ **Action rejetée par l'opérateur.**")

        elif cb_data == "cmd:status":
            if cb_id:
                await self.answer_callback_query(cb_id, text="Actualisation du statut...")
            if chat_id:
                await self._handle_command(chat_id, user_id, user_name, "/status", "")

        elif cb_data == "cmd:new":
            if cb_id:
                await self.answer_callback_query(cb_id, text="Nouvelle session...")
            if chat_id:
                await self._handle_command(chat_id, user_id, user_name, "/new", "")

        elif cb_data == "cmd:stop":
            if cb_id:
                await self.answer_callback_query(cb_id, text="Interruption...")
            if chat_id:
                await self._handle_command(chat_id, user_id, user_name, "/stop", "")

    async def _handle_media_message(self, chat_id: int, message: dict[str, Any]) -> None:
        """Download attached documents, images or voice clips and pass to Antigravity."""
        caption = (message.get("caption") or "").strip()
        file_id = None
        file_name = None

        if "document" in message:
            doc = message["document"]
            file_id = doc.get("file_id")
            file_name = doc.get("file_name", f"doc_{int(time.time())}")
        elif "photo" in message:
            photos = message["photo"]
            if photos:
                file_id = photos[-1].get("file_id")
                file_name = f"photo_{int(time.time())}.jpg"
        elif "voice" in message or "audio" in message:
            aud = message.get("voice") or message.get("audio")
            if aud:
                file_id = aud.get("file_id")
                file_name = f"voice_{int(time.time())}.ogg"

        if not file_id or not file_name:
            await self.send_message(chat_id, "⚠️ Impossible de traiter le fichier joint.")
            return

        await self.send_chat_action(chat_id, "upload_document")
        saved_rel_path = await self.download_file(file_id, file_name)

        if not saved_rel_path:
            await self.send_message(chat_id, "❌ Échec du téléchargement du fichier.")
            return

        prompt = (
            f"[Fichier attaché déposé dans le workspace : {saved_rel_path}]\n"
            f"{caption if caption else 'Analyse ce fichier joint et détaille son contenu.'}"
        )
        await self._execute_prompt(chat_id, prompt)

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
                "• Envoyez directement vos instructions ou déposez des fichiers/photos\n"
                "• `/status` — Vérifier l'état de l'agent et de la session\n"
                "• `/new` — Démarrer une nouvelle conversation vierge\n"
                "• `/stop` ou `/cancel` — Interrompre l'exécution en cours\n"
                "• `/approve` ou `/reject` — Valider ou rejeter une commande outil en attente\n"
            )
            quick_menu = {
                "inline_keyboard": [
                    [
                        {"text": "📊 Statut", "callback_data": "cmd:status"},
                        {"text": "✨ Nouveau", "callback_data": "cmd:new"},
                        {"text": "⏹️ Arrêter", "callback_data": "cmd:stop"},
                    ]
                ]
            }
            await self.send_message(chat_id, msg, reply_markup=quick_menu)

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
        """Enqueue prompt into Antigravity execution manager and stream feedback with in-place edits."""
        chat_str = str(chat_id)
        conv_id = self._user_conversations.get(chat_str)
        if not conv_id:
            conv_id = f"tg_{chat_id}_{secrets.token_hex(4)}"
            self._user_conversations[chat_str] = conv_id

        await self.send_chat_action(chat_id, "typing")
        initial_msg_id = await self.send_message_returning_id(chat_id, "⏳ *Antigravity initialise la tâche...*")

        session = execution_manager.get_or_create_session(conv_id, DEFAULT_WORKSPACE)
        subscriber = TelegramSessionSubscriber(chat_id, self, conv_id, initial_msg_id=initial_msg_id)
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
    logger.info("Starting Antigravity Telegram Gateway (Hermes-enhanced)...")
    await telegram_gateway.start()
    try:
        while True:
            await asyncio.sleep(1)
    except (asyncio.CancelledError, KeyboardInterrupt):
        await telegram_gateway.stop()


if __name__ == "__main__":
    asyncio.run(run_standalone())
