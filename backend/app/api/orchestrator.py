import logging
from typing import Any
from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_auth
from app.services.agent_orchestrator import (
    OrchestratorGraphResponse,
    SteerRequest,
    TerminateRequest,
    build_orchestrator_graph,
    steer_agent,
    terminate_agent,
    get_agent_inspection_details,
)

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
    except Exception as e:
        logger.exception(f"Error building orchestrator graph for {conversation_id}: {e}")
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
    except Exception as e:
        logger.exception(f"Error steering agent {req.target_agent_id}: {e}")
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
    except Exception as e:
        logger.exception(f"Error terminating agent {req.target_agent_id}: {e}")
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
    except Exception as e:
        logger.exception(f"Error inspecting agent {agent_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal error retrieving agent telemetry")
