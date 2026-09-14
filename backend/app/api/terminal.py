import os
import pty
import fcntl
import termios
import struct
import signal
import asyncio
import json
import logging
import time
from typing import Optional, Dict
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.services.auth import verify_access_token, get_auth_config

logger = logging.getLogger("antigravity.terminal")
router = APIRouter(tags=["terminal"])

def set_winsize(fd: int, rows: int, cols: int):
    try:
        rows = max(4, min(int(rows or 24), 200))
        cols = max(10, min(int(cols or 80), 300))
        winsize = struct.pack("HHHH", rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)
    except Exception as e:
        logger.warning(f"Error setting winsize: {e}")

class PersistentTerminalSession:
    def __init__(self, session_id: str, cwd: str):
        self.session_id = session_id
        self.cwd = cwd
        self.master_fd: int = -1
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.scrollback: bytearray = bytearray()
        self.max_scrollback = 1024 * 1024  # 1 MB memory buffer
        self.active_websocket: Optional[WebSocket] = None
        self.last_active: float = time.time()
        self.cols: int = 80
        self.rows: int = 24
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def is_alive(self) -> bool:
        return self.proc is not None and self.proc.returncode is None and self.master_fd > 0

    async def start(self):
        self.loop = asyncio.get_running_loop()
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
            preexec_fn=os.setsid
        )
        os.close(slave_fd)

        self.master_fd = master_fd
        self.proc = proc
        set_winsize(self.master_fd, self.rows, self.cols)

        def on_master_read():
            try:
                data = os.read(self.master_fd, 4096)
                if data:
                    self.last_active = time.time()
                    self.scrollback.extend(data)
                    if len(self.scrollback) > self.max_scrollback:
                        self.scrollback = self.scrollback[-self.max_scrollback:]

                    ws = self.active_websocket
                    if ws:
                        async def send():
                            try:
                                await ws.send_bytes(data)
                            except Exception:
                                pass
                        asyncio.create_task(send())
                else:
                    if self.loop and self.master_fd > 0:
                        try:
                            self.loop.remove_reader(self.master_fd)
                        except Exception:
                            pass
            except (BlockingIOError, InterruptedError):
                pass
            except OSError:
                if self.loop and self.master_fd > 0:
                    try:
                        self.loop.remove_reader(self.master_fd)
                    except Exception:
                        pass

        self.loop.add_reader(self.master_fd, on_master_read)
        logger.info(f"Persistent PTY session started: {self.session_id} (pid={proc.pid}, cwd={self.cwd})")

    async def write(self, data: bytes):
        if not self.is_alive():
            return
        offset = 0
        total = len(data)
        while offset < total:
            try:
                written = os.write(self.master_fd, data[offset:])
                offset += written
            except (BlockingIOError, InterruptedError):
                await asyncio.sleep(0.01)

    async def resize(self, rows: int, cols: int):
        self.rows = rows
        self.cols = cols
        if self.is_alive():
            set_winsize(self.master_fd, rows, cols)

    async def close(self):
        if self.loop and self.master_fd > 0:
            try:
                self.loop.remove_reader(self.master_fd)
            except Exception:
                pass
            try:
                os.close(self.master_fd)
            except Exception:
                pass
            self.master_fd = -1

        if self.proc:
            try:
                pgid = os.getpgid(self.proc.pid)
                os.killpg(pgid, signal.SIGTERM)
                await asyncio.sleep(0.1)
                if self.proc.returncode is None:
                    os.killpg(pgid, signal.SIGKILL)
                await asyncio.wait_for(self.proc.wait(), timeout=1.0)
            except Exception:
                pass
            self.proc = None
        logger.info(f"Persistent PTY session terminated: {self.session_id}")

_sessions: Dict[str, PersistentTerminalSession] = {}
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

@router.websocket("/ws/terminal")
async def terminal_websocket(
    websocket: WebSocket,
    token: Optional[str] = None,
    workspace: Optional[str] = None,
    session_id: Optional[str] = None
):
    # Verify authentication
    config = get_auth_config()
    if config.get("enabled", True) and not verify_access_token(token):
        await websocket.close(code=1008, reason="Unauthorized")
        logger.warning("Unauthorized terminal websocket connection attempt")
        return

    await websocket.accept()

    cwd = workspace if workspace and os.path.isdir(workspace) else os.environ.get("HOME", "/root")
    # Identify session (default to global persistent session for workspace)
    sid = session_id or f"ws_{abs(hash(cwd)) % 1000000}"

    session, is_new = await get_or_create_session(sid, cwd)
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
            if "bytes" in message and message["bytes"]:
                await session.write(message["bytes"])
            elif "text" in message and message["text"]:
                text = message["text"]
                if text.startswith("{"):
                    try:
                        msg_obj = json.loads(text)
                        action = msg_obj.get("action")
                        if action == "resize":
                            cols = msg_obj.get("cols", 80)
                            rows = msg_obj.get("rows", 24)
                            await session.resize(rows, cols)
                            continue
                        elif action == "stdin":
                            data = msg_obj.get("data", "")
                            await session.write(data.encode("utf-8", errors="replace"))
                            continue
                        elif action in ("restart", "reset", "kill"):
                            await kill_session(sid)
                            session, _ = await get_or_create_session(sid, cwd)
                            session.active_websocket = websocket
                            await websocket.send_text("\r\n\x1b[32m✔ Interpréteur bash réinitialisé.\x1b[0m\r\n")
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
        if session.active_websocket == websocket:
            session.active_websocket = None
        logger.info(f"Terminal WebSocket detached from session {sid} (process kept running)")

@router.get("/api/terminal/sessions")
def list_terminal_sessions():
    """List active persistent terminal sessions"""
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
async def restart_terminal_session(session_id: str):
    """Explicitly kill and restart a terminal session"""
    await kill_session(session_id)
    return {"success": True, "session_id": session_id}
