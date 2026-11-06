"""
backend/app/api/memory.py — Endpoints API pour la Mémoire Continue (USER.md + MEMORY.md).
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.platform_utils import is_blocked_sensitive_path, is_safe_path
from app.services.memory_store import memory_store
from app.services.storage import get_allowed_workspace_roots

router = APIRouter(prefix="/api/memory", tags=["memory"], dependencies=[Depends(require_auth)])


def _validate_safe_workspace(ws: str | None) -> Path | None:
    if not ws:
        return None
    clean = ws.strip()
    if not clean:
        return None
    if "\x00" in clean or any(ord(c) < 32 for c in clean):
        raise HTTPException(status_code=400, detail="Chemin de workspace invalide.")
    try:
        resolved = Path(clean).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin de workspace invalide : {e}")
    if is_blocked_sensitive_path(resolved):
        raise HTTPException(status_code=403, detail="Accès refusé : chemin pointant vers un fichier ou répertoire sensible.")
    allowed_roots = get_allowed_workspace_roots()
    if not is_safe_path(resolved, allowed_roots):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire en dehors des répertoires de travail autorisés.")
    if not resolved.is_dir():
        raise HTTPException(status_code=404, detail="Dossier workspace introuvable.")
    return resolved


class MemoryOperationRequest(BaseModel):
    target: str = "memory"  # "memory" ou "user"
    action: str  # "add", "replace", "remove", "save_raw"
    content: str | None = None
    old_text: str | None = None
    new_content: str | None = None
    raw_markdown: str | None = None
    workspace: str | None = None


@router.get("")
def get_memory_status(workspace: str | None = Query(None)) -> dict[str, Any]:
    """Renvoie l'état complet de la mémoire continue (profil utilisateur et mémoire workspace)."""
    valid_ws = _validate_safe_workspace(workspace)
    if valid_ws:
        memory_store.set_workspace(valid_ws)
    return memory_store.get_status()


@router.get("/snapshot")
def get_memory_snapshot() -> dict[str, Any]:
    """Renvoie le snapshot gelé pour le prompt système de l'agent."""
    snapshot = memory_store.get_system_prompt_snapshot()
    return {
        "snapshot": snapshot,
        "available": bool(snapshot),
    }


@router.post("/refresh-snapshot")
def refresh_memory_snapshot() -> dict[str, Any]:
    """Force le rafraîchissement du snapshot prompt système après une mise à jour manuelle."""
    snapshot = memory_store.refresh_snapshot()
    return {
        "success": True,
        "snapshot": snapshot,
        "message": "Snapshot mémoire rafraîchi avec succès.",
    }


@router.post("")
def execute_memory_operation(req: MemoryOperationRequest) -> dict[str, Any]:
    """Exécute une action sur la mémoire (add, replace, remove, save_raw)."""
    valid_ws = _validate_safe_workspace(req.workspace)
    if valid_ws:
        memory_store.set_workspace(valid_ws)

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
