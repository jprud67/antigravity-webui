import asyncio
import hashlib
import json
import logging
import os
import struct
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.auth import require_auth
from app.platform_utils import (
    IS_MACOS,
    IS_WINDOWS,
    spawn_group_kwargs,
    terminate_process_group_async,
)
from app.services.auth import get_auth_config, verify_access_token

# Modules POSIX uniquement — absents de Windows (import conditionnel obligatoire).
try:
    import fcntl
    import pty
    import termios
    HAS_PTY = True
except ImportError:  # Windows
    HAS_PTY = False

# Backend terminal sous Windows : pywinpty (optionnel — dégradation propre sinon).
try:
    import winpty  # type: ignore[import-not-found]  # paquet « pywinpty » (Windows uniquement)
    HAS_WINPTY = True
except ImportError:
    HAS_WINPTY = False

logger = logging.getLogger("antigravity.terminal")
router = APIRouter(tags=["terminal"])


def set_winsize(fd: int, rows: int, cols: int):
    """Redimensionne le PTY (POSIX)."""
    if not HAS_PTY:
        return
    try:
        rows = max(4, min(int(rows or 24), 200))
        cols = max(10, min(int(cols or 80), 300))
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception as e:
        logger.warning(f"Error setting winsize: {e}")


async def _safe_send_bytes(ws: WebSocket, data: bytes):
    try:
        await ws.send_bytes(data)
    except Exception as e:
        logger.debug(f"terminal send failed: {e}")


class PersistentTerminalSession:
    def __init__(self, session_id: str, cwd: str):
        self.session_id = session_id
        self.cwd = cwd
        self.master_fd: int = -1
        self.proc: asyncio.subprocess.Process | None = None
        self.win_pty = None  # winpty.PtyProcess (Windows)
        self._win_reader: threading.Thread | None = None
        self._closing = False
        self.scrollback: bytearray = bytearray()
        self.max_scrollback = 1024 * 1024  # 1 MB memory buffer
        self.active_websocket: WebSocket | None = None
        self.last_active: float = time.time()
        self.cols: int = 80
        self.rows: int = 24
        self.loop: asyncio.AbstractEventLoop | None = None

    def is_alive(self) -> bool:
        if IS_WINDOWS:
            return self.win_pty is not None and not self._closing and self.win_pty.isalive()
        return self.proc is not None and self.proc.returncode is None and self.master_fd > 0

    # ----------------------------- Démarrage -----------------------------

    async def start(self):
        self.loop = asyncio.get_running_loop()
        self._closing = False
        if IS_WINDOWS:
            await self._start_windows()
        else:
            await self._start_posix()

    async def _start_posix(self):
        if not HAS_PTY:
            raise RuntimeError("Le terminal persistant requiert les modules POSIX pty/fcntl/termios.")
        master_fd, slave_fd = pty.openpty()
        flags = fcntl.fcntl(master_fd, fcntl.F_GETFL)
        fcntl.fcntl(master_fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)

        shell = os.environ.get("SHELL", "/bin/bash")
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        env["COLORTERM"] = "truecolor"

        proc = await asyncio.create_subprocess_exec(
            shell,
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            cwd=self.cwd,
            env=env,
            **spawn_group_kwargs()
        )
        os.close(slave_fd)

        self.master_fd = master_fd
        self.proc = proc
        set_winsize(self.master_fd, self.rows, self.cols)

        def on_master_read():
            try:
                if self.master_fd <= 0:
                    return
                data = os.read(self.master_fd, 4096)
                if data:
                    self.last_active = time.time()
                    self.scrollback.extend(data)
                    if len(self.scrollback) > self.max_scrollback:
                        self.scrollback = self.scrollback[-self.max_scrollback:]

                    ws = self.active_websocket
                    if ws and self.loop and not self.loop.is_closed():
                        self.loop.create_task(_safe_send_bytes(ws, data))
                else:
                    self._handle_eof_or_exit()
            except (BlockingIOError, InterruptedError):
                pass
            except OSError:
                self._handle_eof_or_exit()

        if self.loop and not self.loop.is_closed():
            self.loop.add_reader(self.master_fd, on_master_read)
        logger.info(f"Persistent PTY session started: {self.session_id} (pid={proc.pid}, cwd={self.cwd})")

    def _handle_eof_or_exit(self):
        fd = self.master_fd
        if fd > 0:
            self.master_fd = -1
            if self.loop and not self.loop.is_closed():
                try:
                    self.loop.remove_reader(fd)
                except Exception:
                    pass
            try:
                os.close(fd)
            except Exception:
                pass
        ws = self.active_websocket
        if ws and self.loop and not self.loop.is_closed():
            self.loop.create_task(_safe_send_bytes(ws, b"\r\n\x1b[33m\xe2\x9a\xa1 Session terminal ferm\xc3\xa9e.\x1b[0m\r\n"))

    async def _start_windows(self):
        if not HAS_WINPTY:
            raise RuntimeError(
                "Le terminal intégré nécessite le paquet « pywinpty » sous Windows "
                "(pip install pywinpty)."
            )
        shell = os.environ.get("COMSPEC") or "cmd.exe"
        env = os.environ.copy()

        def _spawn() -> Any:
            return winpty.PtyProcess.spawn([shell], cwd=self.cwd, env=env)

        self.win_pty = await asyncio.to_thread(_spawn)  # type: ignore[func-returns-value]
        self._win_reader = threading.Thread(
            target=self._windows_read_loop,
            name=f"term-{self.session_id}",
            daemon=True
        )
        self._win_reader.start()
        pid = getattr(self.win_pty, "pid", None)
        logger.info(f"Persistent winpty session started: {self.session_id} (pid={pid}, cwd={self.cwd})")

    def _windows_read_loop(self):
        """Boucle de lecture bloquante winpty (thread dédié) — relaie vers la WebSocket."""
        p = self.win_pty
        while not self._closing and p is not None:
            try:
                data = p.read(4096)
            except (EOFError, OSError):
                break
            if not data:
                break
            raw = data if isinstance(data, (bytes, bytearray)) else str(data).encode("utf-8", errors="replace")
            self.last_active = time.time()
            self.scrollback.extend(raw)
            if len(self.scrollback) > self.max_scrollback:
                self.scrollback = self.scrollback[-self.max_scrollback:]

            ws = self.active_websocket
            if ws and self.loop:
                try:
                    asyncio.run_coroutine_threadsafe(_safe_send_bytes(ws, bytes(raw)), self.loop)
                except RuntimeError as e:
                    logger.debug(f"terminal relay failed: {e}")
        logger.info(f"winpty reader loop ended for {self.session_id}")

    # ----------------------------- Entrées / sorties -----------------------------

    async def write(self, data: bytes):
        if not self.is_alive():
            return
        if IS_WINDOWS:
            if self.win_pty is not None:
                try:
                    await asyncio.to_thread(self.win_pty.write, data.decode("utf-8", errors="replace"))
                except (OSError, EOFError) as e:
                    logger.debug(f"terminal write failed: {e}")
            return
        offset = 0
        total = len(data)
        retries = 0
        while offset < total and retries < 50:
            try:
                written = os.write(self.master_fd, data[offset:])
                offset += written
                retries = 0
            except (BlockingIOError, InterruptedError):
                retries += 1
                await asyncio.sleep(0.01)
            except OSError as e:
                # PTY fermé de l'autre côté (EPIPE/EIO) — abandonner proprement
                logger.debug(f"terminal write interrompu (PTY fermé ?) : {e}")
                return
        if retries >= 50:
            logger.warning("terminal write dropped remaining bytes after 50 retries")

    async def resize(self, rows: Any, cols: Any):
        try:
            self.rows = max(4, min(int(rows or 24), 200))
        except (ValueError, TypeError):
            self.rows = 24
        try:
            self.cols = max(10, min(int(cols or 80), 300))
        except (ValueError, TypeError):
            self.cols = 80
        if not self.is_alive():
            return
        if IS_WINDOWS:
            if self.win_pty is not None:
                try:
                    await asyncio.to_thread(self.win_pty.setwinsize, self.rows, self.cols)
                except Exception as e:
                    logger.debug(f"terminal resize failed: {e}")
            return
        set_winsize(self.master_fd, self.rows, self.cols)

    async def close(self):
        self._closing = True
        if IS_WINDOWS:
            p = self.win_pty
            self.win_pty = None
            if p is not None:
                try:
                    if p.isalive():
                        p.terminate(force=True)
                except Exception as e:
                    logger.debug(f"winpty terminate failed: {e}")
            logger.info(f"Persistent winpty session terminated: {self.session_id}")
            return

        if self.master_fd > 0:
            fd = self.master_fd
            self.master_fd = -1
            if self.loop:
                try:
                    self.loop.remove_reader(fd)
                except Exception:
                    pass
            try:
                os.close(fd)
            except Exception:
                pass

        if self.proc:
            await terminate_process_group_async(self.proc, grace=0.1)
            self.proc = None
        logger.info(f"Persistent PTY session terminated: {self.session_id}")

_sessions: dict[str, PersistentTerminalSession] = {}
_sessions_lock = asyncio.Lock()

async def get_or_create_session(session_id: str, cwd: str) -> tuple[PersistentTerminalSession, bool]:
    """Returns (session, is_new)"""
    async with _sessions_lock:
        session = _sessions.get(session_id)
        if session and session.is_alive():
            return session, False

        if session:
            await session.close()

        new_session = PersistentTerminalSession(session_id, cwd)
        await new_session.start()
        _sessions[session_id] = new_session
        return new_session, True

async def kill_session(session_id: str):
    async with _sessions_lock:
        session = _sessions.pop(session_id, None)
        if session:
            await session.close()

async def close_all_terminal_sessions():
    """Ferme proprement toutes les sessions de terminal PTY persistantes."""
    async with _sessions_lock:
        sessions = list(_sessions.values())
        _sessions.clear()
    for s in sessions:
        try:
            await s.close()
        except Exception as e:
            logger.debug(f"Erreur fermeture session terminal {s.session_id}: {e}")

@router.websocket("/ws/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    token: str | None = None,
    workspace: str | None = None,
    session_id: str | None = None
):
    # Verify authentication
    config = get_auth_config()
    if config.get("enabled", True) and not verify_access_token(token):
        await websocket.close(code=1008, reason="Unauthorized")
        logger.warning("Unauthorized terminal websocket connection attempt")
        return

    await websocket.accept()

    default_home = os.environ.get("HOME") or os.environ.get("USERPROFILE") or str(Path.home())
    cwd = workspace if workspace and os.path.isdir(workspace) else default_home
    # Identify session (default to global persistent session for workspace)
    # hash() est non-déterministe entre redémarrages (PYTHONHASHSEED) → utiliser hashlib pour un ID stable
    sid = session_id or f"ws_{hashlib.md5(cwd.encode()).hexdigest()[:8]}"

    session: PersistentTerminalSession | None = None
    try:
        session, is_new = await get_or_create_session(sid, cwd)
    except Exception as e:
        # Terminal indisponible sur cette plateforme ou erreur d'initialisation
        logger.error(f"Failed to start terminal session {sid}: {e}")
        try:
            await websocket.send_text(f"\r\n\x1b[31m✖ {e}\x1b[0m\r\n")
        except Exception as send_err:
            logger.debug(f"terminal error message failed: {send_err}")
        await websocket.close(code=1011)
        return

    session.active_websocket = websocket
    session.last_active = time.time()

    # Replay scrollback buffer so client restores full terminal history
    if not is_new and session.scrollback:
        try:
            await websocket.send_bytes(bytes(session.scrollback))
            await websocket.send_text("\r\n\x1b[38;5;38m✔ Session terminal restaurée avec succès.\x1b[0m\r\n")
        except Exception as e:
            logger.debug(f"Failed to replay scrollback: {e}")

    try:
        while True:
            message = await websocket.receive()
            if message.get("bytes"):
                await session.write(message["bytes"])
            elif message.get("text"):
                text = message["text"]
                if text.startswith("{"):
                    try:
                        msg_obj = json.loads(text)
                        action = msg_obj.get("action")
                        if action == "resize":
                            try:
                                cols = int(msg_obj.get("cols") or 80)
                                rows = int(msg_obj.get("rows") or 24)
                                if cols > 0 and rows > 0:
                                    await session.resize(rows, cols)
                            except (TypeError, ValueError):
                                pass
                            continue
                        elif action == "stdin":
                            data = msg_obj.get("data", "")
                            await session.write(data.encode("utf-8", errors="replace"))
                            continue
                        elif action in ("restart", "reset", "kill"):
                            await kill_session(sid)
                            session, _ = await get_or_create_session(sid, cwd)
                            session.active_websocket = websocket
                            reset_label = "✔ Interpréteur bash réinitialisé." if not IS_WINDOWS and not IS_MACOS else "✔ Console réinitialisée."
                            await websocket.send_text(f"\r\n\x1b[32m{reset_label}\x1b[0m\r\n")
                            continue
                    except json.JSONDecodeError:
                        pass
                await session.write(text.encode("utf-8", errors="replace"))
    except (WebSocketDisconnect, ConnectionResetError):
        pass
    except Exception as e:
        logger.debug(f"Terminal client disconnected from session {sid}: {e}")
    finally:
        # DETACH CLIENT BUT KEEP PTY PROCESS ALIVE!
        if session and session.active_websocket == websocket:
            session.active_websocket = None
        logger.info(f"Terminal WebSocket detached from session {sid} (process kept running)")

async def prune_dead_sessions() -> None:
    """Removes dead sessions (process exited and no client attached) from _sessions dictionary."""
    async with _sessions_lock:
        dead_sids = [
            sid for sid, s in _sessions.items()
            if not s.is_alive() and s.active_websocket is None
        ]
        for sid in dead_sids:
            s = _sessions.pop(sid, None)
            if s:
                try:
                    await s.close()
                except Exception:
                    pass

@router.get("/api/terminal/sessions")
async def list_terminal_sessions(_ = Depends(require_auth)):
    """List active persistent terminal sessions"""
    await prune_dead_sessions()
    return [
        {
            "session_id": sid,
            "cwd": s.cwd,
            "is_alive": s.is_alive(),
            "cols": s.cols,
            "rows": s.rows,
            "last_active": s.last_active,
            "has_client": s.active_websocket is not None
        }
        for sid, s in _sessions.items()
    ]

@router.post("/api/terminal/sessions/{session_id}/restart")
async def restart_terminal_session(session_id: str, _ = Depends(require_auth)):
    """Explicitly kill and restart a terminal session"""
    await kill_session(session_id)
    return {"success": True, "session_id": session_id}
