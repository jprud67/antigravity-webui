"""Docker & Container Management Studio Service.

Inspects local container engines (Docker / Podman), discovers Dockerfiles
and Docker Compose configurations in the active workspace, manages container
lifecycles (start, stop, restart, delete, inspect, logs, exec), and coordinates
containerized workflows (inspired by Antigravity Core src/agents/sandbox/container-engine.ts).
"""

from __future__ import annotations

import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("antigravity.docker_studio")

ContainerEngineType = Literal["docker", "podman", "none"]
ContainerState = Literal["running", "exited", "paused", "restarting", "dead", "unknown"]


class ContainerPort(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    host_ip: Optional[str] = Field(None, alias="hostIp")
    host_port: Optional[str] = Field(None, alias="hostPort")
    container_port: Optional[str] = Field(None, alias="containerPort")
    protocol: str = "tcp"


class ContainerSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    names: List[str]
    image: str
    state: ContainerState
    status: str
    created_at: str = Field(..., alias="createdAt")
    ports: List[str] = Field(default_factory=list)
    command: Optional[str] = None


class ComposeServiceSummary(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    name: str
    image: Optional[str] = None
    build: Optional[str] = None
    ports: List[str] = Field(default_factory=list)
    environment: List[str] = Field(default_factory=list)
    volumes: List[str] = Field(default_factory=list)


class WorkspaceDockerItem(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    path: str
    filename: str
    kind: Literal["dockerfile", "compose", "dockerignore"]
    services: Optional[List[ComposeServiceSummary]] = None


class DockerEngineStatus(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    is_available: bool = Field(..., alias="isAvailable")
    engine: ContainerEngineType
    binary_path: Optional[str] = Field(None, alias="binaryPath")
    version: Optional[str] = None
    containers_count: int = Field(0, alias="containersCount")
    running_count: int = Field(0, alias="runningCount")
    server_info: Dict[str, Any] = Field(default_factory=dict, alias="serverInfo")
    error: Optional[str] = None


class ContainerActionRequest(BaseModel):
    action: Literal["start", "stop", "restart", "kill", "remove", "pause", "unpause"]


class ContainerExecRequest(BaseModel):
    command: str
    workdir: Optional[str] = None


class ComposeActionRequest(BaseModel):
    compose_path: str = Field(..., alias="composePath")
    action: Literal["up", "down", "restart", "ps", "build"]


def resolve_container_binary() -> Optional[tuple[ContainerEngineType, str]]:
    """Detects available container engine binary in PATH (docker or podman)."""
    docker_bin = shutil.which("docker")
    if docker_bin:
        return "docker", docker_bin
    podman_bin = shutil.which("podman")
    if podman_bin:
        return "podman", podman_bin
    return None


def get_docker_status() -> DockerEngineStatus:
    """Probes docker/podman daemon and returns comprehensive engine status."""
    bin_info = resolve_container_binary()
    if not bin_info:
        return DockerEngineStatus(
            is_available=False,
            engine="none",
            error="Docker ou Podman n'a pas été trouvé dans le PATH système. Installez Docker Desktop ou Podman pour activer le Container Studio.",
        )

    engine_type, bin_path = bin_info
    try:
        # Run docker info --format '{{json .}}'
        res = subprocess.run(
            [bin_path, "info", "--format", "{{json .}}"],
            capture_output=True,
            text=True,
            timeout=4.0,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            try:
                info_data = json.loads(res.stdout)
                return DockerEngineStatus(
                    is_available=True,
                    engine=engine_type,
                    binary_path=bin_path,
                    version=info_data.get("ServerVersion", "Unknown"),
                    containers_count=int(info_data.get("Containers", 0)),
                    running_count=int(info_data.get("ContainersRunning", 0)),
                    server_info={
                        "os": info_data.get("OperatingSystem"),
                        "arch": info_data.get("Architecture"),
                        "cpus": info_data.get("NCPU"),
                        "mem_total": info_data.get("MemTotal"),
                        "driver": info_data.get("Driver"),
                    },
                )
            except Exception:
                pass

        # Fallback to --version if daemon is starting or json formatting differs
        ver_res = subprocess.run(
            [bin_path, "--version"],
            capture_output=True,
            text=True,
            timeout=3.0,
            check=False,
        )
        if ver_res.returncode == 0:
            return DockerEngineStatus(
                is_available=True,
                engine=engine_type,
                binary_path=bin_path,
                version=ver_res.stdout.strip(),
                server_info={},
            )
        else:
            return DockerEngineStatus(
                is_available=False,
                engine=engine_type,
                binary_path=bin_path,
                error=f"Le démon {engine_type} ne répond pas : {res.stderr.strip() or ver_res.stderr.strip()}",
            )
    except subprocess.TimeoutExpired:
        return DockerEngineStatus(
            is_available=False,
            engine=engine_type,
            binary_path=bin_path,
            error=f"Délai d'attente dépassé lors de la communication avec le démon {engine_type}.",
        )
    except Exception as e:
        return DockerEngineStatus(
            is_available=False,
            engine=engine_type,
            binary_path=bin_path,
            error=str(e),
        )


def scan_workspace_docker_files(workspace_dir: str) -> List[WorkspaceDockerItem]:
    """Scans workspace directory recursively (max depth 3) for Dockerfile and compose files."""
    root = Path(workspace_dir).resolve()
    if not root.exists() or not root.is_dir():
        return []

    items: List[WorkspaceDockerItem] = []
    ignored_patterns = {".git", "node_modules", "venv", ".pytest_cache", "dist", ".gemini", "__pycache__"}

    for dirpath, dirnames, filenames in os.walk(root):
        # Exclude ignored subdirectories
        dirnames[:] = [d for d in dirnames if d not in ignored_patterns and not d.startswith(".")]

        # Limit search depth
        rel_depth = len(Path(dirpath).relative_to(root).parts)
        if rel_depth > 3:
            dirnames.clear()
            continue

        for fname in filenames:
            fl_lower = fname.lower()
            rel_file_path = str(Path(dirpath, fname).relative_to(root)).replace("\\", "/")
            full_file_path = str(Path(dirpath, fname))

            if fl_lower.startswith("dockerfile"):
                items.append(
                    WorkspaceDockerItem(
                        path=rel_file_path,
                        filename=fname,
                        kind="dockerfile",
                    )
                )
            elif fl_lower.endswith(".dockerignore"):
                items.append(
                    WorkspaceDockerItem(
                        path=rel_file_path,
                        filename=fname,
                        kind="dockerignore",
                    )
                )
            elif (
                fl_lower in ("docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml")
                or fl_lower.startswith("docker-compose.")
                or fl_lower.startswith("compose.")
            ) and (fl_lower.endswith(".yml") or fl_lower.endswith(".yaml")):
                # Parse compose services
                services: List[ComposeServiceSummary] = []
                try:
                    with open(full_file_path, "r", encoding="utf-8") as f:
                        data = yaml.safe_load(f)
                    if isinstance(data, dict) and "services" in data and isinstance(data["services"], dict):
                        for s_name, s_cfg in data["services"].items():
                            if isinstance(s_cfg, dict):
                                ports_list = [str(p) for p in s_cfg.get("ports", [])]
                                env_list = (
                                    [f"{k}={v}" for k, v in s_cfg.get("environment", {}).items()]
                                    if isinstance(s_cfg.get("environment"), dict)
                                    else [str(e) for e in s_cfg.get("environment", [])]
                                )
                                vols_list = [str(v) for v in s_cfg.get("volumes", [])]
                                bld = s_cfg.get("build")
                                bld_str = bld if isinstance(bld, str) else (bld.get("context", ".") if isinstance(bld, dict) else None)
                                services.append(
                                    ComposeServiceSummary(
                                        name=str(s_name),
                                        image=s_cfg.get("image"),
                                        build=bld_str,
                                        ports=ports_list,
                                        environment=env_list,
                                        volumes=vols_list,
                                    )
                                )
                except Exception as e:
                    logger.debug(f"Failed to parse compose file {full_file_path}: {e}")

                items.append(
                    WorkspaceDockerItem(
                        path=rel_file_path,
                        filename=fname,
                        kind="compose",
                        services=services,
                    )
                )

    return items


def list_containers(all_containers: bool = True) -> List[ContainerSummary]:
    """Lists containers from local Docker/Podman engine."""
    bin_info = resolve_container_binary()
    if not bin_info:
        return []

    _, bin_path = bin_info
    cmd = [bin_path, "ps", "--format", "{{json .}}"]
    if all_containers:
        cmd.append("-a")

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=5.0, check=False)
        if res.returncode != 0:
            return []

        containers: List[ContainerSummary] = []
        for line in res.stdout.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
                raw_state = row.get("State", "").lower()
                state_mapped: ContainerState = (
                    raw_state if raw_state in ("running", "exited", "paused", "restarting", "dead") else "unknown"
                )

                # Parse names
                names_str = row.get("Names", "")
                names = [n.strip() for n in names_str.split(",") if n.strip()]

                # Parse ports
                ports_str = row.get("Ports", "")
                ports = [p.strip() for p in ports_str.split(",") if p.strip()]

                containers.append(
                    ContainerSummary(
                        id=row.get("ID", ""),
                        names=names,
                        image=row.get("Image", ""),
                        state=state_mapped,
                        status=row.get("Status", ""),
                        createdAt=row.get("CreatedAt", ""),
                        ports=ports,
                        command=row.get("Command"),
                    )
                )
            except Exception as e:
                logger.debug(f"Failed to parse container ps line: {e}")

        return containers
    except Exception as e:
        logger.warning(f"Error listing containers: {e}")
        return []


def inspect_container(container_id: str) -> Optional[Dict[str, Any]]:
    """Retrieves full inspection dictionary for a given container ID."""
    # Strict alphanumeric validation against command injection
    if not re.match(r"^[a-zA-Z0-9._-]+$", container_id):
        raise ValueError(f"Invalid container identifier: {container_id}")

    bin_info = resolve_container_binary()
    if not bin_info:
        return None

    _, bin_path = bin_info
    try:
        res = subprocess.run(
            [bin_path, "inspect", container_id],
            capture_output=True,
            text=True,
            timeout=4.0,
            check=False,
        )
        if res.returncode == 0 and res.stdout.strip():
            parsed = json.loads(res.stdout)
            if isinstance(parsed, list) and len(parsed) > 0:
                return parsed[0]
        return None
    except Exception as e:
        logger.warning(f"Error inspecting container {container_id}: {e}")
        return None


def execute_container_action(container_id: str, action: str) -> Dict[str, Any]:
    """Executes a lifecycle action on a container (start, stop, restart, remove, kill)."""
    if not re.match(r"^[a-zA-Z0-9._-]+$", container_id):
        raise ValueError("ID de conteneur invalide.")

    bin_info = resolve_container_binary()
    if not bin_info:
        raise RuntimeError("Aucun moteur Docker/Podman disponible.")

    action_map = {
        "start": "start",
        "stop": "stop",
        "restart": "restart",
        "kill": "kill",
        "pause": "pause",
        "unpause": "unpause",
        "remove": "rm",
    }
    cmd_action = action_map.get(action)
    if not cmd_action:
        raise ValueError(f"Action non supportée: {action}")

    _, bin_path = bin_info
    args = [bin_path, cmd_action]
    if action == "remove":
        args.append("-f")  # Force remove if needed

    args.append(container_id)

    res = subprocess.run(args, capture_output=True, text=True, timeout=10.0, check=False)
    if res.returncode != 0:
        raise RuntimeError(f"Échec de l'action {action} : {res.stderr.strip() or res.stdout.strip()}")

    return {
        "status": "ok",
        "action": action,
        "container_id": container_id,
        "output": res.stdout.strip(),
    }


def get_container_logs(container_id: str, tail: int = 200, timestamps: bool = True) -> str:
    """Fetches stdout & stderr logs from a container."""
    if not re.match(r"^[a-zA-Z0-9._-]+$", container_id):
        raise ValueError("ID de conteneur invalide.")

    bin_info = resolve_container_binary()
    if not bin_info:
        return "Erreur : Moteur de conteneur non disponible."

    _, bin_path = bin_info
    cmd = [bin_path, "logs", f"--tail={tail}"]
    if timestamps:
        cmd.append("-t")
    cmd.append(container_id)

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=6.0, check=False)
        output = (res.stdout or "") + ("\n" + res.stderr if res.stderr else "")
        return output.strip() or "(Aucun log enregistré pour ce conteneur)"
    except Exception as e:
        return f"Erreur lors de la récupération des logs : {e}"


def exec_command_in_container(
    container_id: str,
    command: str,
    workdir: Optional[str] = None,
) -> Dict[str, Any]:
    """Executes a command inside a running container and returns stdout/stderr/exit_code."""
    if not re.match(r"^[a-zA-Z0-9._-]+$", container_id):
        raise ValueError("ID de conteneur invalide.")

    bin_info = resolve_container_binary()
    if not bin_info:
        raise RuntimeError("Aucun moteur Docker/Podman disponible.")

    _, bin_path = bin_info
    cmd = [bin_path, "exec"]
    if workdir:
        cmd.extend(["-w", workdir])

    # Run command inside shell
    cmd.extend([container_id, "sh", "-c", command])

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15.0, check=False)
        return {
            "exit_code": res.returncode,
            "stdout": res.stdout,
            "stderr": res.stderr,
            "success": res.returncode == 0,
        }
    except subprocess.TimeoutExpired:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": "Délai d'exécution dépassé (15s).",
            "success": False,
        }
    except Exception as e:
        return {
            "exit_code": -1,
            "stdout": "",
            "stderr": str(e),
            "success": False,
        }


def execute_compose_action(compose_file_path: str, action: str) -> Dict[str, Any]:
    """Executes a docker compose action (up -d, down, restart, ps)."""
    bin_info = resolve_container_binary()
    if not bin_info:
        raise RuntimeError("Aucun moteur Docker/Podman disponible.")

    comp_path = Path(compose_file_path).resolve()
    if not comp_path.exists():
        raise FileNotFoundError(f"Fichier compose introuvable : {compose_file_path}")

    _, bin_path = bin_info
    cmd = [bin_path, "compose", "-f", str(comp_path)]

    if action == "up":
        cmd.extend(["up", "-d"])
    elif action == "down":
        cmd.extend(["down"])
    elif action == "restart":
        cmd.extend(["restart"])
    elif action == "ps":
        cmd.extend(["ps"])
    elif action == "build":
        cmd.extend(["build"])
    else:
        raise ValueError(f"Action Compose invalide: {action}")

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=60.0, check=False)
        return {
            "status": "ok" if res.returncode == 0 else "error",
            "action": action,
            "exit_code": res.returncode,
            "stdout": res.stdout,
            "stderr": res.stderr,
        }
    except Exception as e:
        raise RuntimeError(f"Échec de l'action compose {action} : {e}")
