import asyncio
import json
import logging
from pathlib import Path

from app.config import AGY_BIN
from app.platform_utils import spawn_group_kwargs, terminate_process_group_async

logger = logging.getLogger("antigravity.agy_subcommand")

async def run_agy_subcommand(args: list[str], timeout: float = 15.0) -> tuple[int, str, str]:
    """Exécute agy avec les args donnés, retourne (returncode, stdout, stderr)."""
    cmd = [AGY_BIN] + args
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            **spawn_group_kwargs()
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        ret_code = proc.returncode if proc.returncode is not None else -1
        return ret_code, stdout.decode(errors="replace"), stderr.decode(errors="replace")
    except asyncio.TimeoutError:
        logger.error(f"Timeout executing agy {' '.join(args)}")
        try:
            await terminate_process_group_async(proc, grace=0.5)
        except Exception as kill_err:
            logger.debug(f"Erreur arrêt sous-processus agy après timeout: {kill_err}")
        return -1, "", f"Timeout après {timeout}s"
    except Exception as e:
        logger.error(f"Erreur d'exécution agy {' '.join(args)}: {e}")
        return -1, "", str(e)

async def run_agy_subcommand_json(args: list[str], timeout: float = 15.0) -> dict | list:
    """Version qui essaie de parser la sortie en JSON."""
    code, stdout, stderr = await run_agy_subcommand(["--output-format", "json"] + args, timeout)
    if code != 0:
        logger.warning(f"agy {' '.join(args)} a échoué (code {code}): {stderr}")
        raise RuntimeError(stderr or stdout)
    
    try:
        return json.loads(stdout.strip())
    except json.JSONDecodeError:
        logger.error(f"Impossible de parser la sortie JSON de agy {' '.join(args)}")
        raise RuntimeError("Format de sortie invalide depuis le CLI")

async def get_agents() -> list[dict]:
    """Parse la sortie de `agy agents` (format: ID Name par ligne)."""
    code, stdout, stderr = await run_agy_subcommand(["agents"])
    if code != 0:
        raise RuntimeError(stderr)
    
    agents = []
    for line in stdout.strip().splitlines():
        line = line.strip()
        if not line or line.startswith("ID") or "Fetching" in line:
            continue
        parts = line.split(None, 1)
        if len(parts) >= 2:
            agents.append({"id": parts[0], "name": parts[1]})
        elif len(parts) == 1:
            agents.append({"id": parts[0], "name": parts[0]})
    return agents

async def get_plugins() -> list[dict]:
    """Parse la sortie de `agy plugin list`."""
    code, stdout, stderr = await run_agy_subcommand(["plugin", "list"])
    if code != 0:
        raise RuntimeError(stderr)
    
    if "No imported plugins." in stdout:
        return []
    
    # Simplement retourner les lignes splittées pour l'instant (à améliorer selon le format exact)
    plugins = []
    lines = stdout.strip().splitlines()
    # On saute les en-têtes si existants
    start_idx = 0
    for i, line in enumerate(lines):
        if line.startswith("NAME"):
            start_idx = i + 1
            break
            
    for line in lines[start_idx:]:
        parts = line.split()
        if len(parts) >= 3:
            plugins.append({
                "name": parts[0],
                "source": parts[1],
                "status": parts[2],
                "details": " ".join(parts[3:]) if len(parts) > 3 else ""
            })
    return plugins

async def install_plugin(target: str, source: str | None = None) -> dict:
    if source:
        code, stdout, stderr = await run_agy_subcommand(["plugin", "import", source])
    else:
        code, stdout, stderr = await run_agy_subcommand(["plugin", "install", target])
        
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def uninstall_plugin(name: str) -> dict:
    code, stdout, stderr = await run_agy_subcommand(["plugin", "uninstall", name])
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def toggle_plugin(name: str, enabled: bool) -> dict:
    action = "enable" if enabled else "disable"
    code, stdout, stderr = await run_agy_subcommand(["plugin", action, name])
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def get_mcp_servers() -> list[dict]:
    code, stdout, stderr = await run_agy_subcommand(["mcp", "list"])
    if code != 0:
        raise RuntimeError(stderr)
        
    if "No MCP servers configured." in stdout:
        return []
        
    # Idem, parsing basique des lignes
    servers = []
    lines = stdout.strip().splitlines()
    start_idx = 0
    for i, line in enumerate(lines):
        if line.startswith("NAME"):
            start_idx = i + 1
            break
            
    for line in lines[start_idx:]:
        parts = line.split()
        if len(parts) >= 3:
            servers.append({
                "name": parts[0],
                "type": parts[1],
                "status": parts[2],
                "details": " ".join(parts[3:]) if len(parts) > 3 else ""
            })
    return servers

async def add_mcp_server(
    name: str,
    command_or_url: str,
    args: list[str] | None = None,
    server_type: str = 'stdio',
    env: list[str] | None = None,
    headers: list[str] | None = None
) -> dict:
    args = args or []
    env = env or []
    headers = headers or []
    cmd = ["mcp", "add", "--type", server_type]
    for e in env:
        cmd.extend(["--env", e])
    for h in headers:
        cmd.extend(["--header", h])
    cmd.extend([name, command_or_url] + args)
    
    code, stdout, stderr = await run_agy_subcommand(cmd)
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def remove_mcp_server(name: str) -> dict:
    code, stdout, stderr = await run_agy_subcommand(["mcp", "remove", name])
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def toggle_mcp_server(name: str, enabled: bool) -> dict:
    action = "enable" if enabled else "disable"
    code, stdout, stderr = await run_agy_subcommand(["mcp", action, name])
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def get_remote_control_status() -> dict:
    code, stdout, stderr = await run_agy_subcommand(["remote-control", "status"])
    if code != 0:
        raise RuntimeError(stderr)
        
    lines = stdout.strip().splitlines()
    active = False
    instance_name = None
    for line in lines:
        if "active" in line.lower() and "inactive" not in line.lower():
            active = True
        if "Instance name:" in line:
            instance_name = line.split(":", 1)[1].strip()
            
    return {
        "active": active,
        "instance_name": instance_name,
        "raw": stdout.strip()
    }

async def start_remote_control(name: str | None = None, session: bool = False) -> dict:
    cmd = ["remote-control", "start"]
    if name:
        cmd.extend(["--name", name])
    if session:
        cmd.append("--session")
        
    code, stdout, stderr = await run_agy_subcommand(cmd)
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def stop_remote_control() -> dict:
    code, stdout, stderr = await run_agy_subcommand(["remote-control", "stop"])
    if code != 0:
        raise RuntimeError(stderr)
    return {"status": "success", "message": stdout.strip()}

async def get_agy_info() -> dict:
    code, stdout, _stderr = await run_agy_subcommand(["--version"])
    version = stdout.strip() if code == 0 else "unknown"
    bin_exists = Path(AGY_BIN).exists()
    return {
        "version": version,
        "bin_path": AGY_BIN,
        "bin_exists": bin_exists
    }
