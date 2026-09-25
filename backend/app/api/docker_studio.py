"""Docker & Container Studio API Router.

REST endpoints to inspect engines, scan project Dockerfiles/Compose files,
and manage container lifecycles, streaming logs, and exec commands.
"""

from __future__ import annotations

from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.config import DEFAULT_WORKSPACE
from app.services.docker_studio import (
    ComposeActionRequest,
    ContainerActionRequest,
    ContainerExecRequest,
    ContainerSummary,
    DockerEngineStatus,
    WorkspaceDockerItem,
    exec_command_in_container,
    execute_compose_action,
    execute_container_action,
    get_container_logs,
    get_docker_status,
    inspect_container,
    list_containers,
    scan_workspace_docker_files,
)

router = APIRouter(prefix="/api/docker", tags=["Docker Studio"])


@router.get("/status", response_model=DockerEngineStatus)
def api_get_docker_status():
    """Returns local Docker/Podman engine availability and daemon info."""
    return get_docker_status()


@router.get("/workspace", response_model=List[WorkspaceDockerItem])
def api_scan_workspace_docker(
    workspace: Optional[str] = Query(None, description="Workspace path to scan"),
):
    """Discovers Dockerfile and docker-compose files in current workspace."""
    ws = workspace or DEFAULT_WORKSPACE
    return scan_workspace_docker_files(ws)


@router.get("/containers", response_model=List[ContainerSummary])
def api_list_containers(
    all: bool = Query(True, description="Include stopped containers"),
):
    """Lists containers on the host."""
    return list_containers(all_containers=all)


@router.get("/containers/{container_id}")
def api_inspect_container(container_id: str):
    """Detailed inspection of a specific container."""
    try:
        data = inspect_container(container_id)
        if not data:
            raise HTTPException(status_code=404, detail="Conteneur introuvable.")
        return data
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/containers/{container_id}/action")
def api_container_action(container_id: str, payload: ContainerActionRequest):
    """Executes lifecycle action on a container (start, stop, restart, remove, kill)."""
    try:
        return execute_container_action(container_id, payload.action)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/containers/{container_id}/logs")
def api_get_container_logs(
    container_id: str,
    tail: int = Query(200, ge=10, le=5000),
    timestamps: bool = Query(True),
):
    """Retrieves logs of a container."""
    try:
        logs = get_container_logs(container_id, tail=tail, timestamps=timestamps)
        return {"logs": logs, "container_id": container_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/containers/{container_id}/exec")
def api_exec_in_container(container_id: str, payload: ContainerExecRequest):
    """Executes a command inside a running container."""
    try:
        res = exec_command_in_container(
            container_id=container_id,
            command=payload.command,
            workdir=payload.workdir,
        )
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compose/action")
def api_compose_action(payload: ComposeActionRequest):
    """Triggers docker compose up / down / restart."""
    try:
        return execute_compose_action(payload.compose_path, payload.action)
    except (FileNotFoundError, ValueError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
