"""
Checkpoint & Rewind REST API — Antigravity WebUI v0.4.2
Endpoints pour capturer, lister, restaurer et bifurquer des checkpoints de session.
"""

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.checkpoint_service import (
    create_checkpoint,
    delete_checkpoint,
    fork_from_checkpoint,
    get_checkpoint_detail,
    list_checkpoints,
    restore_checkpoint,
)

logger = logging.getLogger("antigravity.checkpoint.api")

router = APIRouter(prefix="/api/checkpoints", tags=["checkpoints"])


class CreateCheckpointRequest(BaseModel):
    label: str = ""


class ForkFromCheckpointRequest(BaseModel):
    new_title: str | None = None


@router.get("/{conversation_id}")
def get_checkpoints(
    conversation_id: str,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Liste tous les checkpoints d'une conversation."""
    try:
        checkpoints = list_checkpoints(conversation_id)
        return {"checkpoints": checkpoints, "count": len(checkpoints)}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors du listing des checkpoints : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors du listing des checkpoints")


@router.post("/{conversation_id}")
def post_create_checkpoint(
    conversation_id: str,
    req: CreateCheckpointRequest,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Crée un nouveau checkpoint (snapshot) de l'état actuel de la conversation."""
    try:
        checkpoint = create_checkpoint(
            conversation_id=conversation_id,
            label=req.label,
            auto_generated=False,
        )
        return {"success": True, "checkpoint": checkpoint}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors de la création du checkpoint : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la création du checkpoint")


@router.get("/{conversation_id}/{checkpoint_id}")
def get_checkpoint(
    conversation_id: str,
    checkpoint_id: str,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Récupère les détails complets d'un checkpoint spécifique."""
    try:
        detail = get_checkpoint_detail(conversation_id, checkpoint_id)
        return detail
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors de la récupération du checkpoint : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la récupération du checkpoint")


@router.post("/{conversation_id}/{checkpoint_id}/restore")
def post_restore_checkpoint(
    conversation_id: str,
    checkpoint_id: str,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Restaure (rewind) la conversation au state du checkpoint sélectionné."""
    try:
        result = restore_checkpoint(conversation_id, checkpoint_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors de la restauration : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la restauration du checkpoint")


@router.post("/{conversation_id}/{checkpoint_id}/fork")
def post_fork_from_checkpoint(
    conversation_id: str,
    checkpoint_id: str,
    req: ForkFromCheckpointRequest | None = None,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Bifurque (fork) une nouvelle conversation depuis un checkpoint sans toucher à l'originale."""
    try:
        new_title = req.new_title if req else None
        result = fork_from_checkpoint(conversation_id, checkpoint_id, new_title)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors de la bifurcation : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la bifurcation du checkpoint")


@router.delete("/{conversation_id}/{checkpoint_id}")
def delete_checkpoint_endpoint(
    conversation_id: str,
    checkpoint_id: str,
    user: dict[str, Any] = Depends(require_auth),
) -> dict[str, Any]:
    """Supprime un checkpoint spécifique."""
    try:
        result = delete_checkpoint(conversation_id, checkpoint_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Erreur lors de la suppression du checkpoint : {e}")
        raise HTTPException(status_code=500, detail="Erreur interne lors de la suppression du checkpoint")
