"""Multi-Workspace Coordinator & Pipelines API Router.

REST endpoints to monitor multi-project workspaces, discover pipelines,
execute CI/CD steps asynchronously, cancel runs, inspect telemetry,
trigger batch operations, and invoke auto-fix remediation.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_blocked_sensitive_path
from app.services.execution_manager import execution_manager
from app.services.workspace_coordinator import (
    BatchActionRequest,
    MultiWorkspaceOverview,
    PipelineExecutionRun,
    PipelineRunRequest,
    WorkspacePipeline,
    build_remediation_context,
    cancel_pipeline_run,
    discover_workspace_pipelines,
    execute_batch_action,
    execute_pipeline_run,
    get_multi_workspace_overview,
    get_pipeline_run_details,
    validate_workspace_path,
)

logger = logging.getLogger("antigravity.coordinator.api")

router = APIRouter(prefix="/api/coordinator", tags=["Workspace Coordinator"], dependencies=[Depends(require_auth)])


class CoordinatorRemediationInput(BaseModel):
    workspace_path: str
    run_id: str
    failed_step_id: str
    step_command: str = ""
    step_output: str = ""


@router.get("/overview", response_model=MultiWorkspaceOverview)
def api_get_coordinator_overview(
    active_workspace: str | None = Query(None, description="Active workspace path"),
):
    """Retrieves multi-workspace overview with Git metrics and discovered pipelines."""
    try:
        return get_multi_workspace_overview(active_workspace_path=active_workspace)
    except Exception as exc:
        logger.exception("Error computing multi-workspace overview: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erreur d'analyse des workspaces: {exc}")


@router.get("/pipelines", response_model=list[WorkspacePipeline])
def api_get_workspace_pipelines(
    workspace: str | None = Query(None, description="Workspace path to scan for pipelines"),
):
    """Scans a workspace and discovers conventional and custom pipelines."""
    target_ws = workspace or DEFAULT_WORKSPACE
    if is_blocked_sensitive_path(target_ws):
        raise HTTPException(status_code=403, detail="Accès au répertoire interdit.")
    try:
        resolved = validate_workspace_path(target_ws)
        return discover_workspace_pipelines(str(resolved))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Error discovering pipelines in %s: %s", target_ws, exc)
        raise HTTPException(status_code=500, detail=f"Erreur lors de la détection des pipelines: {exc}")


@router.post("/run", response_model=PipelineExecutionRun)
async def api_run_pipeline(payload: PipelineRunRequest):
    """Asynchronously starts a pipeline run with controlled concurrency."""
    try:
        run_obj = await execute_pipeline_run(
            workspace_path=payload.workspace_path,
            pipeline_id=payload.pipeline_id,
            on_step_update=execution_manager.broadcast_coordinator_event,
            wait_complete=False
        )
        return run_obj
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        logger.exception("Error starting pipeline %s: %s", payload.pipeline_id, exc)
        raise HTTPException(status_code=500, detail=f"Échec du lancement du pipeline: {exc}")


@router.get("/run/{run_id}", response_model=PipelineExecutionRun)
def api_get_run_details(run_id: str):
    """Retrieves real-time progress and logs of an active or past pipeline run."""
    run_obj = get_pipeline_run_details(run_id)
    if not run_obj:
        raise HTTPException(status_code=404, detail=f"Exécution introuvable : {run_id}")
    return run_obj


@router.post("/cancel/{run_id}")
def api_cancel_pipeline(run_id: str):
    """Cancels an active running pipeline process."""
    success = cancel_pipeline_run(run_id)
    if not success:
        # Check if run exists but already finished
        run_obj = get_pipeline_run_details(run_id)
        if run_obj:
            return {"success": False, "run_id": run_id, "status": run_obj.status, "message": "Pipeline déjà terminé"}
        raise HTTPException(status_code=404, detail=f"Exécution introuvable : {run_id}")
    return {"success": True, "run_id": run_id, "status": "cancelled"}


@router.post("/remediation")
def api_build_remediation(payload: CoordinatorRemediationInput):
    """Parses failing test/build log and generates structured context for auto-fixing."""
    try:
        return build_remediation_context(
            workspace_path=payload.workspace_path,
            run_id=payload.run_id,
            failed_step_id=payload.failed_step_id,
            step_command=payload.step_command,
            step_output=payload.step_output
        )
    except Exception as exc:
        logger.exception("Error creating remediation context: %s", exc)
        raise HTTPException(status_code=500, detail=f"Erreur lors de la génération du diagnostic: {exc}")


@router.post("/batch")
async def api_execute_batch(payload: BatchActionRequest):
    """Executes a batch action across all or selected trusted workspaces."""
    try:
        return await execute_batch_action(payload.action, payload.workspace_paths)
    except Exception as exc:
        logger.exception("Error executing batch action %s: %s", payload.action, exc)
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'action par lot: {exc}")
