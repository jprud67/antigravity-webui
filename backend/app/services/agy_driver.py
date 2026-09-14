import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, Any, Optional, List
from pathlib import Path
from app.config import AGY_BIN, DEFAULT_WORKSPACE

logger = logging.getLogger("antigravity.driver")

async def get_available_models() -> List[Dict[str, str]]:
    cmd = [AGY_BIN, "models"]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        logger.error(f"Error fetching models: {stderr.decode()}")
        raise RuntimeError(f"agy models failed: {stderr.decode()}")

    lines = stdout.decode().splitlines()
    models = []
    for line in lines:
        cleaned = line.strip()
        if not cleaned or "Fetching available models" in cleaned:
            continue
        parts = cleaned.split(None, 1)
        if len(parts) >= 2:
            models.append({"id": parts[0].strip(), "name": parts[1].strip()})
        elif len(parts) == 1:
            models.append({"id": parts[0].strip(), "name": parts[0].strip()})
    return models

async def stream_turn(
    prompt: str,
    conversation_id: Optional[str] = None,
    workspace_path: Optional[str] = None,
    model: Optional[str] = None,
    effort: Optional[str] = None,
    auto_approve: bool = True
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Executes a turn using `agy --output-format stream-json` and yields parsed NDJSON events.
    """
    cwd = workspace_path if workspace_path and Path(workspace_path).is_dir() else DEFAULT_WORKSPACE
    
    cmd = [AGY_BIN, "--output-format", "stream-json"]

    if auto_approve:
        cmd.append("--dangerously-skip-permissions")

    if conversation_id:
        cmd.extend(["--conversation", conversation_id])

    if model:
        cmd.extend(["--model", model])

    if effort:
        cmd.extend(["--effort", effort])

    if workspace_path and workspace_path != "/root":
        cmd.extend(["--add-dir", workspace_path])

    # Prompt parameter
    cmd.extend(["-p", prompt])

    logger.info(f"Spawning agy: {' '.join(cmd)} (cwd={cwd})")

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )

    async def read_stderr():
        err_lines = []
        while True:
            line = await proc.stderr.readline()
            if not line:
                break
            text = line.decode(errors="replace").strip()
            if text:
                logger.warning(f"[agy stderr] {text}")
                err_lines.append(text)
        return "\n".join(err_lines)

    stderr_task = asyncio.create_task(read_stderr())

    while True:
        line = await proc.stdout.readline()
        if not line:
            break
        raw_str = line.decode(errors="replace").strip()
        if not raw_str:
            continue
        
        # Parse JSON event
        try:
            event_data = json.loads(raw_str)
            yield event_data
        except json.JSONDecodeError:
            # Fallback if non-JSON log line leaks to stdout
            yield {
                "event": "raw_output",
                "text": raw_str
            }

    returncode = await proc.wait()
    stderr_output = await stderr_task

    if returncode != 0:
        logger.error(f"agy process exited with code {returncode}. Stderr: {stderr_output}")
        yield {
            "event": "error",
            "code": returncode,
            "message": stderr_output or f"agy failed with exit code {returncode}"
        }
