"""
backend/app/api/memory.py — Endpoints API pour la Mémoire Continue (USER.md + MEMORY.md).
"""

from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.memory_store import memory_store

router = APIRouter(prefix="/api/memory", tags=["memory"])


class MemoryOperationRequest(BaseModel):
    target: str = "memory"  # "memory" ou "user"
    action: str  # "add", "replace", "remove", "save_raw"
    content: Optional[str] = None
    old_text: Optional[str] = None
    new_content: Optional[str] = None
    raw_markdown: Optional[str] = None


@router.get("")
def get_memory_status() -> Dict[str, Any]:
    """Renvoie l'état complet de la mémoire continue (profil utilisateur et mémoire workspace)."""
    return memory_store.get_status()


@router.get("/snapshot")
def get_memory_snapshot() -> Dict[str, Any]:
    """Renvoie le snapshot gelé pour le prompt système de l'agent."""
    snapshot = memory_store.get_system_prompt_snapshot()
    return {
        "snapshot": snapshot,
        "available": bool(snapshot),
    }


@router.post("/refresh-snapshot")
def refresh_memory_snapshot() -> Dict[str, Any]:
    """Force le rafraîchissement du snapshot prompt système après une mise à jour manuelle."""
    snapshot = memory_store.refresh_snapshot()
    return {
        "success": True,
        "snapshot": snapshot,
        "message": "Snapshot mémoire rafraîchi avec succès.",
    }


@router.post("")
def execute_memory_operation(req: MemoryOperationRequest) -> Dict[str, Any]:
    """Exécute une action sur la mémoire (add, replace, remove, save_raw)."""
    target = req.target.lower()
    action = req.action.lower()

    if action == "add":
        if not req.content:
            raise HTTPException(status_code=400, detail="Le champ 'content' est obligatoire pour l'action 'add'.")
        result = memory_store.add(target, req.content)
    elif action == "replace":
        if not req.old_text or not req.new_content:
            raise HTTPException(status_code=400, detail="Les champs 'old_text' et 'new_content' sont requis.")
        result = memory_store.replace(target, req.old_text, req.new_content)
    elif action == "remove":
        if not req.old_text:
            raise HTTPException(status_code=400, detail="Le champ 'old_text' est requis pour l'action 'remove'.")
        result = memory_store.remove(target, req.old_text)
    elif action == "save_raw":
        if req.raw_markdown is None:
            raise HTTPException(status_code=400, detail="Le champ 'raw_markdown' est requis.")
        result = memory_store.save_raw(target, req.raw_markdown)
    else:
        raise HTTPException(status_code=400, detail=f"Action inconnue '{req.action}'. Actions valides: add, replace, remove, save_raw.")

    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Échec de l'opération mémoire."))

    return result
