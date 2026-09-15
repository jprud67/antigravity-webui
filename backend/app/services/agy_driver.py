import asyncio
import json
import logging
import time
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

_models_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}


async def get_model_families() -> List[Dict[str, Any]]:
    """
    Returns unique base model families deduplicated with supported efforts and concrete variant IDs.
    Cached for 5 minutes to avoid spawning the `agy models` CLI on every settings/model fetch.
    """
    global _models_cache
    now = time.time()
    if _models_cache["data"] is not None and (now - _models_cache["timestamp"]) < 300:
        return _models_cache["data"]

    try:
        models_raw = await get_available_models()
    except Exception as e:
        if _models_cache["data"] is not None:
            logger.warning(f"agy models failed ({e}); returning stale cached model families.")
            return _models_cache["data"]
        raise

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

    result = list(families.values())
    _models_cache = {"data": result, "timestamp": now}
    return result

def resolve_model_and_effort(model: Optional[str], effort: Optional[str]) -> Tuple[Optional[str], Optional[str]]:
    """
    Safely reconciles model and effort parameters for agy CLI.
    Prevents CLI errors like 'invalid model selection' or 'model conflicts with --effort'.
    """
    if not model:
        return None, effort

    model = model.strip()

    # Claude models do NOT accept --effort flag and must not have -high/-medium/-low suffix
    if "claude" in model.lower():
        for sfx in ["-high", "-medium", "-low"]:
            if model.endswith(sfx):
                model = model[:-len(sfx)]
        return model, None

    # GPT-OSS only supports medium
    if "gpt-oss" in model.lower():
        return "gpt-oss-120b-medium", None

    # Detect base model and current suffix
    base_model = model
    model_suffix = None
    for sfx in ["-high", "-medium", "-low"]:
        if model.endswith(sfx):
            model_suffix = sfx[1:]
            base_model = model[:-len(sfx)]
            break

    eff = (effort or model_suffix or "high").lower().strip()

    # Gemini 3.1 Pro only supports high and low
    if "gemini-3.1-pro" in base_model:
        if eff not in ["high", "low"]:
            eff = "high"
        return f"gemini-3.1-pro-{eff}", None

    # For Gemini 3.6, 3.7, 3.8: support high, medium, low
    if eff not in ["high", "medium", "low"]:
        eff = "high"

    target_model = f"{base_model}-{eff}"
    return target_model, None

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

    cmd = [AGY_BIN, "--output-format", "stream-json", "--print-timeout", "30m"]

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
        if stderr_task and not stderr_task.done():
            stderr_task.cancel()
            try:
                await stderr_task
            except (asyncio.CancelledError, Exception):
                pass
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGTERM)
            await asyncio.sleep(0.1)
            if proc.returncode is None:
                os.killpg(pgid, signal.SIGKILL)
            await asyncio.wait_for(proc.wait(), timeout=1.0)
        except Exception as e:
            logger.debug(f"Error terminating proc group: {e}")
        raise
    finally:
        if stderr_task and not stderr_task.done():
            stderr_task.cancel()
            try:
                await stderr_task
            except (asyncio.CancelledError, Exception):
                pass


_quota_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}
_credits_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}
_changelog_cache: Dict[str, Any] = {"data": None, "timestamp": 0.0}


async def get_usage_quota() -> Dict[str, Any]:
    global _quota_cache
    now = time.time()
    if _quota_cache["data"] is not None and (now - _quota_cache["timestamp"]) < 10:
        return _quota_cache["data"]

    cmd = [AGY_BIN, "--output-format", "json", "-p", "/usage"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode(errors="replace"))
                _quota_cache = {"data": data, "timestamp": now}
                return data
        except Exception as proc_err:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise proc_err
    except Exception as e:
        logger.warning(f"Error fetching usage quota: {e}")

    return _quota_cache["data"] or {"status": "unavailable", "message": "Impossible de charger les quotas Antigravity."}


async def get_credits() -> Dict[str, Any]:
    global _credits_cache
    now = time.time()
    if _credits_cache["data"] is not None and (now - _credits_cache["timestamp"]) < 30:
        return _credits_cache["data"]

    cmd = [AGY_BIN, "--output-format", "json", "-p", "/credits"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode(errors="replace"))
                _credits_cache = {"data": data, "timestamp": now}
                return data
        except Exception as proc_err:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise proc_err
    except Exception as e:
        logger.warning(f"Error fetching credits: {e}")

    return _credits_cache["data"] or {"status": "unavailable"}


async def get_changelog() -> Dict[str, Any]:
    global _changelog_cache
    now = time.time()
    if _changelog_cache["data"] is not None and (now - _changelog_cache["timestamp"]) < 300:
        return _changelog_cache["data"]

    cmd = [AGY_BIN, "--output-format", "json", "-p", "/changelog"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
            if proc.returncode == 0 and stdout:
                data = json.loads(stdout.decode(errors="replace"))
                _changelog_cache = {"data": data, "timestamp": now}
                return data
        except Exception as proc_err:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            raise proc_err
    except Exception as e:
        logger.warning(f"Error fetching changelog: {e}")

    return _changelog_cache["data"] or {"status": "unavailable"}


