import os
import pty
import fcntl
import termios
import struct
import signal
import asyncio
import json
import logging
from typing import Optional
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

@router.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket, token: Optional[str] = None, workspace: Optional[str] = None):
    # Verify authentication
    config = get_auth_config()
    if config.get("enabled", True) and not verify_access_token(token):
        await websocket.close(code=1008, reason="Unauthorized")
        logger.warning("Unauthorized terminal websocket connection attempt")
        return

    await websocket.accept()
    logger.info(f"Terminal WebSocket connected (workspace={workspace})")

    cwd = workspace if workspace and os.path.isdir(workspace) else os.environ.get("HOME", "/root")

    master_fd, slave_fd = pty.openpty()
    # Set non-blocking on master_fd
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
        cwd=cwd,
        env=env,
        preexec_fn=os.setsid
    )
    os.close(slave_fd)
    set_winsize(master_fd, 24, 80)

    loop = asyncio.get_running_loop()
    read_queue: asyncio.Queue[bytes] = asyncio.Queue()

    def on_master_read():
        try:
            data = os.read(master_fd, 4096)
            if data:
                read_queue.put_nowait(data)
            else:
                loop.remove_reader(master_fd)
                read_queue.put_nowait(b"")
        except (BlockingIOError, InterruptedError):
            pass
        except OSError:
            try:
                loop.remove_reader(master_fd)
            except Exception:
                pass
            read_queue.put_nowait(b"")

    loop.add_reader(master_fd, on_master_read)

    async def pty_to_ws():
        try:
            while True:
                chunk = await read_queue.get()
                if not chunk:
                    break
                await websocket.send_bytes(chunk)
        except Exception:
            pass

    async def ws_to_pty():
        try:
            while True:
                message = await websocket.receive()
                if "bytes" in message and message["bytes"]:
                    os.write(master_fd, message["bytes"])
                elif "text" in message and message["text"]:
                    text = message["text"]
                    if text.startswith("{"):
                        try:
                            msg_obj = json.loads(text)
                            action = msg_obj.get("action")
                            if action == "resize":
                                cols = msg_obj.get("cols", 80)
                                rows = msg_obj.get("rows", 24)
                                set_winsize(master_fd, rows, cols)
                                continue
                            elif action == "stdin":
                                data = msg_obj.get("data", "")
                                os.write(master_fd, data.encode("utf-8", errors="replace"))
                                continue
                        except json.JSONDecodeError:
                            pass
                    os.write(master_fd, text.encode("utf-8", errors="replace"))
        except (WebSocketDisconnect, ConnectionResetError):
            pass
        except Exception as e:
            logger.debug(f"ws_to_pty terminated: {e}")

    task_read = asyncio.create_task(pty_to_ws())
    task_write = asyncio.create_task(ws_to_pty())

    done, pending = await asyncio.wait([task_read, task_write], return_when=asyncio.FIRST_COMPLETED)
    for p in pending:
        p.cancel()

    try:
        loop.remove_reader(master_fd)
    except Exception:
        pass

    try:
        os.close(master_fd)
    except Exception:
        pass

    # Terminate process group cleanly
    try:
        pgid = os.getpgid(proc.pid)
        os.killpg(pgid, signal.SIGTERM)
        await asyncio.sleep(0.1)
        if proc.returncode is None:
            os.killpg(pgid, signal.SIGKILL)
    except Exception:
        pass

    logger.info("Terminal session ended and cleaned up")
