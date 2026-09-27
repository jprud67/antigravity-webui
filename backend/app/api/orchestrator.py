import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_auth
from app.services.agent_orchestrator import (
    AgentComparisonResponse,
    ForkAgentRequest,
    ForkAgentResponse,
    OrchestratorGraphResponse,
    SteerRequest,
    TerminateRequest,
    build_orchestrator_graph,
    compare_execution_branches,
    fork_agent_node,
    get_agent_inspection_details,
    steer_agent,
    terminate_agent,
)
from app.services.execution_manager import execution_manager

logger = logging.getLogger("antigravity.orchestrator.api")

router = APIRouter(prefix="/api/orchestrator", tags=["orchestrator"])


@router.get("/graph/{conversation_id}", response_model=OrchestratorGraphResponse)
def get_graph(
    conversation_id: str,
    user: dict[str, Any] = Depends(require_auth)
) -> OrchestratorGraphResponse:
    """Returns the multi-agent DAG execution hierarchy for a session."""
    try:
        return build_orchestrator_graph(conversation_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error building orchestrator graph for {conversation_id}")
        raise HTTPException(status_code=500, detail="Internal error generating agent graph")


@router.post("/steer")
def post_steer(
    req: SteerRequest,
    user: dict[str, Any] = Depends(require_auth)
) -> dict[str, Any]:
    """Injects high-priority steering instructions to an agent."""
    try:
        return steer_agent(
            conversation_id=req.conversation_id,
            target_agent_id=req.target_agent_id,
            instruction=req.instruction
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error steering agent {req.target_agent_id}")
        raise HTTPException(status_code=500, detail="Internal error sending steering instruction")


@router.post("/terminate")
def post_terminate(
    req: TerminateRequest,
    user: dict[str, Any] = Depends(require_auth)
) -> dict[str, Any]:
    """Terminates an agent process or cascades termination to its child subagents."""
    try:
        return terminate_agent(
            conversation_id=req.conversation_id,
            target_agent_id=req.target_agent_id,
            recursive=req.recursive
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error terminating agent {req.target_agent_id}")
        raise HTTPException(status_code=500, detail="Internal error terminating agent")


@router.get("/inspect/{agent_id}")
def get_inspect(
    agent_id: str,
    conversation_id: str = Query(..., description="ID of the parent conversation"),
    user: dict[str, Any] = Depends(require_auth)
) -> dict[str, Any]:
    """Retrieves deep telemetry, live thought stream, and tools history for an agent."""
    try:
        return get_agent_inspection_details(agent_id=agent_id, conversation_id=conversation_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error inspecting agent {agent_id}")
        raise HTTPException(status_code=500, detail="Internal error retrieving agent telemetry")


@router.post("/fork", response_model=ForkAgentResponse)
async def post_fork(
    req: ForkAgentRequest,
    user: dict[str, Any] = Depends(require_auth)
) -> ForkAgentResponse:
    """Forks an agent execution branch into an isolated worktree with custom directives and model."""
    try:
        res = fork_agent_node(req)
        try:
            await execution_manager.broadcast_orchestrator_update(
                conversation_id=req.conversation_id,
                event_type="fork_created",
                node_data=res.model_dump()
            )
        except Exception as exc:
            logger.debug(f"Broadcast orchestrator update ignored: {exc}")
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error forking agent node {req.parent_agent_id}")
        raise HTTPException(status_code=500, detail="Internal error forking agent execution branch")


@router.get("/compare", response_model=AgentComparisonResponse)
def get_compare(
    conversation_id: str = Query(..., description="ID of the session"),
    agent_ids: str | None = Query(None, description="Comma-separated IDs of agents to compare"),
    user: dict[str, Any] = Depends(require_auth)
) -> AgentComparisonResponse:
    """Compares execution alternatives and forks side-by-side."""
    try:
        ids_list = [i.strip() for i in agent_ids.split(",") if i.strip()] if agent_ids else None
        return compare_execution_branches(conversation_id=conversation_id, agent_ids=ids_list)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception(f"Error comparing execution branches for session {conversation_id}")
        raise HTTPException(status_code=500, detail="Internal error generating execution comparison")
