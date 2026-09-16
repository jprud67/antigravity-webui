from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_blocked_sensitive_path
from app.services.storage import get_settings, save_settings

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

@router.get("")
def list_workspaces(_ = Depends(require_auth)) -> list[str]:
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)
    return workspaces

@router.post("")
def add_workspace(path: str = Query(...), _ = Depends(require_auth)):
    p = Path(path).resolve()
    if is_blocked_sensitive_path(p):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire système ou restreint.")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory '{path}' does not exist")
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    str_p = str(p)
    if str_p not in workspaces:
        workspaces.append(str_p)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)
    return {"status": "ok", "workspaces": workspaces}

@router.delete("")
def delete_workspace(path: str = Query(...), _ = Depends(require_auth)):
    p = str(Path(path).resolve())
    if p == str(Path(DEFAULT_WORKSPACE).resolve()):
        raise HTTPException(status_code=400, detail="Cannot delete default workspace")
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    workspaces = [w for w in workspaces if str(Path(w).resolve()) != p]
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)
    settings["trustedWorkspaces"] = workspaces
    save_settings(settings)
    return {"status": "ok", "workspaces": workspaces}

@router.get("/explore")
def explore_dir(path: str = Query(DEFAULT_WORKSPACE), _ = Depends(require_auth)) -> dict[str, Any]:
    try:
        p = Path(path).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide: {e}")

    if is_blocked_sensitive_path(p):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire système ou restreint.")
    try:
        if not p.exists() or not p.is_dir():
            raise HTTPException(status_code=404, detail="Path is not a valid directory")
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    entries = []
    try:
        raw_entries = list(p.iterdir())
        def _safe_sort_key(x: Path):
            try:
                return (not x.is_dir(), x.name.lower())
            except OSError:
                return (True, x.name.lower())

        for item in sorted(raw_entries, key=_safe_sort_key):
            if item.name.startswith(".") and item.name not in [".gemini", ".hermes"]:
                continue
            if is_blocked_sensitive_path(item):
                continue
            try:
                is_dir = item.is_dir()
                size = item.stat().st_size if not is_dir else None
                entries.append({
                    "name": item.name,
                    "path": str(item),
                    "is_dir": is_dir,
                    "size": size
                })
            except OSError:
                continue
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'accès au dossier : {e}")

    return {
        "current_path": str(p),
        "parent_path": str(p.parent) if p.parent != p else None,
        "entries": entries
    }
