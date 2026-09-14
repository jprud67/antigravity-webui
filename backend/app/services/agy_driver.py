import asyncio
import json
import logging
from typing import AsyncGenerator, Dict, Any, Optional, List, Tuple
from pathlib import Path
from app.config import AGY_BIN, DEFAULT_WORKSPACE

logger = logging.getLogger("antigravity.driver")

def parse_model_metadata(m_id: str, m_name: str) -> Dict[str, Any]:
    effort = None
    family_id = m_id
    for sfx in ['-high', '-medium', '-low']:
        if m_id.endswith(sfx):
            effort = sfx[1:]
            family_id = m_id[:-len(sfx)]
            break
    
    family_name = m_name
    for sfx_label in [' (High)', ' (Medium)', ' (Low)']:
        if family_name.endswith(sfx_label):
            family_name = family_name[:-len(sfx_label)]
            break

    if 'claude' in m_id.lower():
        supported_efforts = []
    elif 'gemini-3.1-pro' in m_id.lower():
        supported_efforts = ['high', 'low']
    elif 'gpt-oss' in m_id.lower():
        supported_efforts = ['medium']
    else:
        supported_efforts = ['high', 'medium', 'low']

    return {
        'id': m_id,
        'name': m_name,
        'family_id': family_id,
        'family_name': family_name,
        'effort': effort,
        'supported_efforts': supported_efforts
    }

async def get_available_models() -> List[Dict[str, Any]]:
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
            m_id = parts[0].strip()
            m_name = parts[1].strip()
            models.append(parse_model_metadata(m_id, m_name))
        elif len(parts) == 1:
            m_id = parts[0].strip()
            models.append(parse_model_metadata(m_id, m_id))
    return models

async def get_model_families() -> List[Dict[str, Any]]:
    """
    Returns unique base model families deduplicated with supported efforts and concrete variant IDs.
    """
    models_raw = await get_available_models()
    families: Dict[str, Dict[str, Any]] = {}
    for meta in models_raw:
        fid = meta['family_id']
        if fid not in families:
            families[fid] = {
                'id': fid,
                'name': meta['family_name'],
                'default_effort': meta['effort'] or ('high' if meta['supported_efforts'] else None),
                'supported_efforts': meta['supported_efforts'],
                'variants': {}
            }
        if meta['effort']:
            families[fid]['variants'][meta['effort']] = meta['id']
        else:
            families[fid]['variants']['default'] = meta['id']
    return list(families.values())

def resolve_model_and_effort(model: Optional[str], effort: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Safely reconciles model and effort parameters for agy CLI.
    Prevents CLI errors like 'model conflicts with --effort' or '--effort is not supported for model'.
    """
    if not model:
        return None, effort

    model = model.strip()

    # Claude does NOT accept --effort flag at all
    if "claude" in model.lower():
        return model, None

    # Detect base model and current suffix
    base_model = model
    model_suffix = None
    for sfx in ["-high", "-medium", "-low"]:
        if model.endswith(sfx):
            model_suffix = sfx[1:]
            base_model = model[:-len(sfx)]
            break

    # If effort requested
    if effort:
        effort_clean = effort.lower().strip()
        
        # Gemini 3.1 Pro only supports high and low
        if "gemini-3.1-pro" in base_model and effort_clean == "medium":
            effort_clean = "high"

        # GPT-OSS only supports medium
        if "gpt-oss" in base_model and effort_clean != "medium":
            effort_clean = "medium"

        # Resolve to clean concrete variant name to avoid passing contradictory --effort
        target_model = f"{base_model}-{effort_clean}"
        return target_model, None

    return model, None

async def stream_turn(
    prompt: str,
    conversation_id: Optional[str] = None,
    workspace_path: Optional[str] = None,
    model: Optional[str] = None,
    effort: Optional[str] = None,
    auto_approve: bool = True,
    proc_callback: Optional[Any] = None
) -> AsyncGenerator[Dict[str, Any], None]:
    """
    Executes a turn using `agy --output-format stream-json` and yields parsed NDJSON events.
    Supports cancellation, process group termination, and proc_callback.
    """
    import os
    import signal

    cwd = workspace_path if workspace_path and Path(workspace_path).is_dir() else DEFAULT_WORKSPACE
    
    resolved_model, resolved_effort = resolve_model_and_effort(model, effort)

    cmd = [AGY_BIN, "--output-format", "stream-json"]

    if auto_approve:
        cmd.append("--dangerously-skip-permissions")

    if conversation_id:
        cmd.extend(["--conversation", conversation_id])

    if resolved_model:
        cmd.extend(["--model", resolved_model])

    if resolved_effort:
        cmd.extend(["--effort", resolved_effort])

    if workspace_path and workspace_path != "/root":
        cmd.extend(["--add-dir", workspace_path])

    # Prompt parameter
    cmd.extend(["-p", prompt])

    logger.info(f"Spawning agy: {' '.join(cmd)} (cwd={cwd})")

    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        preexec_fn=os.setsid
    )

    if proc_callback:
        proc_callback(proc)

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

    try:
        while True:
            line = await proc.stdout.readline()
            if not line:
                break
            raw_str = line.decode(errors="replace").strip()
            if not raw_str:
                continue
            
            try:
                event_data = json.loads(raw_str)
                yield event_data
            except json.JSONDecodeError:
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
    except asyncio.CancelledError:
        logger.info(f"stream_turn cancelled: terminating process group {proc.pid}")
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
            await asyncio.sleep(0.1)
            if proc.returncode is None:
                os.killpg(pgid, signal.SIGKILL)
            await asyncio.wait_for(proc.wait(), timeout=1.0)
        except Exception as e:
            logger.debug(f"Error terminating proc group: {e}")
        yield {
            "event": "interrupted",
            "message": "Exécution interrompue par l'utilisateur."
        }
        raise

