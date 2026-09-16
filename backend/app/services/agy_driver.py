import asyncio
import json
import logging
import re
import time
from collections.abc import AsyncGenerator
from pathlib import Path
from typing import Any

from app.config import AGY_BIN, DEFAULT_WORKSPACE
from app.platform_utils import spawn_group_kwargs, terminate_process_group_async
from app.services.quota_watch import watch_agy_log_for_quota

logger = logging.getLogger("antigravity.driver")

DEFAULT_MODEL_FAMILIES: list[dict[str, Any]] = [
    {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash",
        "default_effort": "high",
        "supported_efforts": ["high", "medium", "low"],
        "variants": {
            "high": "gemini-3.8-flash-high",
            "medium": "gemini-3.8-flash-medium",
            "low": "gemini-3.8-flash-low",
        },
    },
    {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash",
        "default_effort": "high",
        "supported_efforts": ["high", "medium", "low"],
        "variants": {
            "high": "gemini-3.7-flash-high",
            "medium": "gemini-3.7-flash-medium",
            "low": "gemini-3.7-flash-low",
        },
    },
    {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash",
        "default_effort": "high",
        "supported_efforts": ["high", "medium", "low"],
        "variants": {
            "high": "gemini-3.6-flash-high",
            "medium": "gemini-3.6-flash-medium",
            "low": "gemini-3.6-flash-low",
        },
    },
    {
        "id": "gemini-3.1-pro",
        "name": "Gemini 3.1 Pro",
        "default_effort": "high",
        "supported_efforts": ["high", "low"],
        "variants": {
            "high": "gemini-3.1-pro-high",
            "low": "gemini-3.1-pro-low",
        },
    },
    {
        "id": "claude-sonnet-4-6",
        "name": "Claude Sonnet 4.6",
        "default_effort": None,
        "supported_efforts": [],
        "variants": {"default": "claude-sonnet-4-6"},
    },
    {
        "id": "claude-opus-4-6-thinking",
        "name": "Claude Opus 4.6 (Thinking)",
        "default_effort": None,
        "supported_efforts": [],
        "variants": {"default": "claude-opus-4-6-thinking"},
    },
    {
        "id": "gpt-oss-120b-medium",
        "name": "GPT-OSS 120B",
        "default_effort": "medium",
        "supported_efforts": ["medium"],
        "variants": {"medium": "gpt-oss-120b-medium"},
    },
]

def parse_model_metadata(m_id: str, m_name: str) -> dict[str, Any]:
    effort = None
    family_id = m_id
    for sfx in ['-high', '-medium', '-low']:
        if m_id.endswith(sfx):
            effort = sfx[1:]
            family_id = m_id[:-len(sfx)]
            break
    
    family_name = m_name
    for sfx_label in [' (High)', ' (Medium)', ' (Low)', ' (Thinking)']:
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

async def get_available_models() -> list[dict[str, Any]]:
    cmd = [AGY_BIN, "models"]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **spawn_group_kwargs()
    )
    try:
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=12.0)
    except asyncio.TimeoutError:
        await terminate_process_group_async(proc, grace=1.0)
        logger.error("Timeout fetching models via agy CLI")
        raise TimeoutError("agy models timed out after 12s")
    if proc.returncode != 0:
        logger.error(f"Error fetching models: {stderr.decode(errors='replace')}")
        raise RuntimeError(f"agy models failed: {stderr.decode(errors='replace')}")

    lines = stdout.decode(errors="replace").replace("\r\n", "\n").replace("\r", "\n").splitlines()
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

_models_cache: dict[str, Any] = {"data": None, "timestamp": 0.0}
_models_family_lock = asyncio.Lock()


async def get_model_families() -> list[dict[str, Any]]:
    """
    Returns unique base model families deduplicated with supported efforts and concrete variant IDs.
    Cached for 5 minutes to avoid spawning the `agy models` CLI on every settings/model fetch.
    Uses asyncio.Lock to prevent concurrent stampedes spawning parallel CLI subprocesses.
    """
    global _models_cache
    now = time.time()
    if _models_cache["data"] is not None and (now - _models_cache["timestamp"]) < 300:
        return _models_cache["data"]

    async with _models_family_lock:
        now = time.time()
        if _models_cache["data"] is not None and (now - _models_cache["timestamp"]) < 300:
            return _models_cache["data"]

        try:
            models_raw = await get_available_models()
        except Exception as e:
            if _models_cache["data"] is not None:
                logger.warning(f"agy models failed ({e}); returning stale cached model families.")
                return _models_cache["data"]
            logger.warning(f"agy models failed ({e}); returning default known model families.")
            return DEFAULT_MODEL_FAMILIES

        families: dict[str, dict[str, Any]] = {}
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

def resolve_model_and_effort(model: str | None, effort: str | None) -> tuple[str | None, str | None]:
    """
    Safely reconciles model and effort parameters for agy CLI.
    Prevents CLI errors like 'invalid model selection' or 'model conflicts with --effort'.
    Ensures model identifiers are normalized to valid CLI model slugs.
    """
    if not model:
        return None, effort

    raw = model.strip()
    norm = raw.lower().replace(" ", "-").replace("(", "").replace(")", "").strip()

    # Claude models do NOT accept --effort flag and must not have -high/-medium/-low suffix
    if "claude" in norm:
        for sfx in ["-high", "-medium", "-low", "-thinking"]:
            norm = norm.removesuffix(sfx)
        if "opus" in norm:
            return "claude-opus-4-6-thinking", None
        if "sonnet" in norm:
            return "claude-sonnet-4-6", None
        return raw, None

    # GPT-OSS only supports medium
    if "gpt-oss" in norm:
        return "gpt-oss-120b-medium", None

    # Extract any existing suffix
    model_suffix = None
    for sfx in ["-high", "-medium", "-low"]:
        if norm.endswith(sfx):
            model_suffix = sfx[1:]
            norm = norm[:-len(sfx)]
            break

    eff = (effort or model_suffix or "high").lower().strip()

    if "gemini" in norm:
        if "3.1" in norm and "pro" in norm:
            if eff not in ["high", "low"]:
                eff = "high"
            return f"gemini-3.1-pro-{eff}", None

        # Determine version: 3.6, 3.7, 3.8 (or future)
        if eff not in ["high", "medium", "low"]:
            eff = "high"

        if "flash-lite" in norm or "flash_lite" in norm or "lite" in norm:
            tier = "flash-lite"
        elif "pro" in norm:
            tier = "pro"
        else:
            tier = "flash"

        m_ver = re.search(r"(\d+\.\d+)", norm)
        if m_ver:
            ver = m_ver.group(1)
            return f"gemini-{ver}-{tier}-{eff}", None
        else:
            base = norm.rstrip("-")
            return f"{base}-{eff}", None

    # For other models, use explicit effort if provided, otherwise preserve original suffix if it existed
    target_eff = effort or model_suffix
    if target_eff:
        eff_clean = target_eff.lower().strip()
        if model_suffix:
            return f"{norm}-{eff_clean}", None
        return raw, eff_clean
    return raw, None

async def stream_turn(
    prompt: str,
    conversation_id: str | None = None,
    workspace_path: str | None = None,
    model: str | None = None,
    effort: str | None = None,
    auto_approve: bool = True,
    agent_mode: str | None = None,
    proc_callback: Any | None = None
) -> AsyncGenerator[dict[str, Any], None]:
    """
    Executes a turn using `agy --output-format stream-json` and yields parsed NDJSON events.
    Supports cancellation, process group termination, agent_mode, and proc_callback.
    """
    cwd = workspace_path if workspace_path and Path(workspace_path).is_dir() else DEFAULT_WORKSPACE
    
    resolved_model, resolved_effort = resolve_model_and_effort(model, effort)

    cmd = [AGY_BIN, "--output-format", "stream-json", "--print-timeout", "30m"]

    if auto_approve:
        cmd.append("--dangerously-skip-permissions")

    if agent_mode and agent_mode in ["accept-edits", "plan"]:
        cmd.extend(["--mode", agent_mode])

    if conversation_id:
        cmd.extend(["--conversation", conversation_id])

    if resolved_model:
        cmd.extend(["--model", resolved_model])

    if resolved_effort:
        cmd.extend(["--effort", resolved_effort])

    if workspace_path and workspace_path != DEFAULT_WORKSPACE and Path(workspace_path).is_dir():
        cmd.extend(["--add-dir", workspace_path])

    # Prompt parameter
    cmd.extend(["-p", prompt])

    logger.info(f"Spawning agy: {' '.join(cmd)} (cwd={cwd})")

    spawned_at = time.time()
    proc: asyncio.subprocess.Process | None = None
    stderr_task: asyncio.Task | None = None
    quota_task: asyncio.Task | None = None

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            cwd=cwd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **spawn_group_kwargs()
        )

        if proc_callback:
            proc_callback(proc)

        quota_detected: dict[str, Any] = {"line": None}

        async def quota_supervisor():
            """
            Détection en direct du quota (journaux agy) → terminaison rapide pour
            permettre la bascule de compte et la relance, au lieu d'attendre les
            retries internes du CLI (qui peuvent durer des dizaines de minutes).
            """
            line = await watch_agy_log_for_quota(
                since_ts=spawned_at,
                should_stop=lambda: proc is None or proc.returncode is not None
            )
            quota_detected["line"] = line
            if line and proc and proc.returncode is None:
                logger.warning(f"Quota dur détecté (logs agy): {line[:150]} — terminaison pour bascule de compte.")
                await terminate_process_group_async(proc, grace=1.5)
            return line

        quota_task = asyncio.create_task(quota_supervisor())

        async def read_stderr():
            err_lines = []
            if not proc or not proc.stderr:
                return ""
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

        if proc.stdout is None:
            raise RuntimeError("agy process stdout is unexpectedly None — impossible de lire la sortie.")

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
        stderr_output = await stderr_task if stderr_task else ""
        # La ligne de quota est disponible même si la terminaison est encore en cours
        quota_line = quota_detected["line"]
        if quota_line is None and quota_task:
            try:
                quota_line = await asyncio.wait_for(quota_task, timeout=2.0)
            except (asyncio.TimeoutError, Exception):
                if not quota_task.done():
                    quota_task.cancel()
                quota_line = None

        if returncode != 0:
            logger.error(f"agy process exited with code {returncode}. Stderr: {stderr_output}")
            message = stderr_output or ""
            if quota_line:
                message = f"{message}\n{quota_line}" if message else quota_line
            yield {
                "event": "error",
                "code": returncode,
                "message": message or f"agy failed with exit code {returncode}"
            }
    except asyncio.CancelledError:
        pid_str = proc.pid if proc else "none"
        logger.info(f"stream_turn cancelled: terminating process group {pid_str}")
        raise
    finally:
        if stderr_task and not stderr_task.done():
            stderr_task.cancel()
            try:
                await stderr_task
            except (asyncio.CancelledError, Exception):
                pass
        if quota_task and not quota_task.done():
            quota_task.cancel()
            try:
                await quota_task
            except (asyncio.CancelledError, Exception):
                pass

        # Terminaison robuste du groupe de processus si encore actif
        # (couvre GeneratorExit, break et erreurs) — multiplateforme.
        if proc and proc.returncode is None:
            await terminate_process_group_async(proc, grace=0.8)


_quota_cache: dict[str, Any] = {"data": None, "timestamp": 0.0}
_credits_cache: dict[str, Any] = {"data": None, "timestamp": 0.0}
_changelog_cache: dict[str, Any] = {"data": None, "timestamp": 0.0}

_quota_lock = asyncio.Lock()
_credits_lock = asyncio.Lock()
_changelog_lock = asyncio.Lock()


def _extract_json_payload(raw: str) -> Any:
    """Extraie et décode un payload JSON même si des bannières ou des avertissements précèdent."""
    trimmed = raw.strip()
    try:
        return json.loads(trimmed)
    except Exception:
        pass

    # Détection des blocs de code Markdown (```json ... ``` ou ``` ... ```)
    code_fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", trimmed, re.IGNORECASE)
    if code_fence_match:
        fence_content = code_fence_match.group(1).strip()
        try:
            return json.loads(fence_content)
        except Exception:
            pass

    first_brace = trimmed.find('{')
    last_brace = trimmed.rfind('}')
    first_bracket = trimmed.find('[')
    last_bracket = trimmed.rfind(']')

    candidates: list[str] = []
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        candidates.append(trimmed[first_brace : last_brace + 1])
    if first_bracket != -1 and last_bracket != -1 and last_bracket > first_bracket:
        candidates.append(trimmed[first_bracket : last_bracket + 1])

    for c in candidates:
        try:
            return json.loads(c)
        except Exception:
            pass

    for line in trimmed.splitlines():
        line = line.strip()
        if (line.startswith('{') and line.endswith('}')) or (line.startswith('[') and line.endswith(']')):
            try:
                return json.loads(line)
            except Exception:
                pass
    raise json.JSONDecodeError("No valid JSON found", raw, 0)


async def get_usage_quota() -> dict[str, Any]:
    global _quota_cache
    now = time.time()
    if _quota_cache["data"] is not None and (now - _quota_cache["timestamp"]) < 10:
        return _quota_cache["data"]

    async with _quota_lock:
        now = time.time()
        if _quota_cache["data"] is not None and (now - _quota_cache["timestamp"]) < 10:
            return _quota_cache["data"]

        cmd = [AGY_BIN, "--output-format", "json", "-p", "/usage"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **spawn_group_kwargs(),
            )
            try:
                stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
                if proc.returncode == 0 and stdout:
                    data = _extract_json_payload(stdout.decode(errors="replace"))
                    if isinstance(data, dict):
                        _quota_cache = {"data": data, "timestamp": now}
                        return data
                    elif isinstance(data, list):
                        dict_payload = {"items": data}
                        _quota_cache = {"data": dict_payload, "timestamp": now}
                        return dict_payload
            except Exception:
                try:
                    await terminate_process_group_async(proc, grace=0.5)
                except Exception:
                    pass
                raise
        except Exception as e:
            logger.warning(f"Error fetching usage quota: {e}")

        return _quota_cache["data"] or {"status": "unavailable", "message": "Impossible de charger les quotas Antigravity."}


async def get_credits() -> dict[str, Any]:
    global _credits_cache
    now = time.time()
    if _credits_cache["data"] is not None and (now - _credits_cache["timestamp"]) < 30:
        return _credits_cache["data"]

    async with _credits_lock:
        now = time.time()
        if _credits_cache["data"] is not None and (now - _credits_cache["timestamp"]) < 30:
            return _credits_cache["data"]

        cmd = [AGY_BIN, "--output-format", "json", "-p", "/credits"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **spawn_group_kwargs(),
            )
            try:
                stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
                if proc.returncode == 0 and stdout:
                    data = _extract_json_payload(stdout.decode(errors="replace"))
                    if isinstance(data, dict):
                        _credits_cache = {"data": data, "timestamp": now}
                        return data
                    elif isinstance(data, list):
                        dict_payload = {"items": data}
                        _credits_cache = {"data": dict_payload, "timestamp": now}
                        return dict_payload
            except Exception:
                try:
                    await terminate_process_group_async(proc, grace=0.5)
                except Exception:
                    pass
                raise
        except Exception as e:
            logger.warning(f"Error fetching credits: {e}")

        return _credits_cache["data"] or {"status": "unavailable"}


async def get_changelog() -> dict[str, Any]:
    global _changelog_cache
    now = time.time()
    if _changelog_cache["data"] is not None and (now - _changelog_cache["timestamp"]) < 300:
        return _changelog_cache["data"]

    async with _changelog_lock:
        now = time.time()
        if _changelog_cache["data"] is not None and (now - _changelog_cache["timestamp"]) < 300:
            return _changelog_cache["data"]

        cmd = [AGY_BIN, "--output-format", "json", "-p", "/changelog"]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                **spawn_group_kwargs(),
            )
            try:
                stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=8.0)
                if proc.returncode == 0 and stdout:
                    data = _extract_json_payload(stdout.decode(errors="replace"))
                    if isinstance(data, dict):
                        _changelog_cache = {"data": data, "timestamp": now}
                        return data
                    elif isinstance(data, list):
                        dict_payload = {"items": data}
                        _changelog_cache = {"data": dict_payload, "timestamp": now}
                        return dict_payload
            except Exception:
                try:
                    await terminate_process_group_async(proc, grace=0.5)
                except Exception:
                    pass
                raise
        except Exception as e:
            logger.warning(f"Error fetching changelog: {e}")

        return _changelog_cache["data"] or {"status": "unavailable"}


