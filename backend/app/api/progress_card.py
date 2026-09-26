"""FastAPI router for session Progress Cards."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_auth
from app.services.progress_card import (
    ProgressCardPayload,
    delete_progress_card,
    get_progress_card,
    save_progress_card,
)

router = APIRouter(prefix="/api/conversations/{conversation_id}/progress-card", tags=["Progress Card"], dependencies=[Depends(require_auth)])


@router.get("")
async def fetch_card(conversation_id: str):
    card = get_progress_card(conversation_id)
    if not card:
        return {"exists": False, "card": None}
    return {"exists": True, "card": card}


@router.post("")
async def update_card(conversation_id: str, payload: ProgressCardPayload):
    try:
        saved = save_progress_card(conversation_id, payload.model_dump())
        return {"success": True, "card": saved}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("")
async def remove_card(conversation_id: str):
    success = delete_progress_card(conversation_id)
    return {"success": success}
