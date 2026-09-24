from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_blocked_sensitive_path
from app.services.project_detector import detect_project_details, detect_project_health
from app.services.storage import get_settings, save_settings

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

@router.get("")
def list_workspaces(_ = Depends(require_auth)) -> list[str]:
    settings = get_settings()
    raw = settings.get("trustedWorkspaces", [])
    workspaces = list(raw) if isinstance(raw, list) else []
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)
    return workspaces

@router.get("/details")
def list_workspace_details(active_path: str | None = Query(None), _ = Depends(require_auth)) -> list[dict[str, Any]]:
    settings = get_settings()
    raw = settings.get("trustedWorkspaces", [])
    workspaces = list(raw) if isinstance(raw, list) else []
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)

    default_ws = settings.get("defaultWorkspace") or DEFAULT_WORKSPACE
    try:
        norm_default = str(Path(default_ws).resolve())
    except Exception:
        norm_default = default_ws

    norm_active = None
    if active_path:
        try:
            norm_active = str(Path(active_path).resolve())
        except Exception:
            norm_active = active_path

    results = []
    for w in workspaces:
        try:
            norm_w = str(Path(w).resolve())
        except Exception:
            norm_w = w
        is_default = (norm_w == norm_default)
        is_active = (norm_w == norm_active) if norm_active else is_default
        results.append(detect_project_details(w, is_default=is_default, is_active=is_active))
    return results

@router.get("/health")
def get_workspace_health(path: str = Query(...), _ = Depends(require_auth)) -> dict[str, Any]:
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
    cleaned_path = path.strip()
    if "\x00" in cleaned_path or any(ord(c) < 32 or ord(c) == 127 for c in cleaned_path):
        raise HTTPException(status_code=400, detail="Chemin invalide : caractère interdit détecté.")
    try:
        p = Path(cleaned_path).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if is_blocked_sensitive_path(p):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire système ou restreint.")
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Le dossier '{path}' n'existe pas.")

    return detect_project_health(str(p))

@router.post("/default")
def set_default_workspace(path: str = Query(...), _ = Depends(require_auth)):
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
    cleaned_path = path.strip()
    if "\x00" in cleaned_path or any(ord(c) < 32 or ord(c) == 127 for c in cleaned_path):
        raise HTTPException(status_code=400, detail="Chemin invalide : caractère interdit détecté.")
    try:
        p = Path(cleaned_path).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if is_blocked_sensitive_path(p):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire système ou restreint.")
    if not p.is_dir():
        raise HTTPException(status_code=404, detail=f"Le dossier '{path}' n'existe pas.")

    settings = get_settings()
    raw = settings.get("trustedWorkspaces", [])
    workspaces = list(raw) if isinstance(raw, list) else []
    str_p = str(p)
    if str_p not in workspaces:
        workspaces.append(str_p)
        settings["trustedWorkspaces"] = workspaces
    settings["defaultWorkspace"] = str_p
    save_settings(settings)
    return {"status": "ok", "default_workspace": str_p}

@router.post("")
def add_workspace(path: str = Query(...), _ = Depends(require_auth)):
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
    cleaned_path = path.strip()
    if "\x00" in cleaned_path or any(ord(c) < 32 or ord(c) == 127 for c in cleaned_path):
        raise HTTPException(status_code=400, detail="Chemin invalide : caractère interdit détecté.")
    try:
        p = Path(cleaned_path).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if is_blocked_sensitive_path(p):
        raise HTTPException(status_code=403, detail="Accès refusé : répertoire système ou restreint.")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory '{path}' does not exist")
    settings = get_settings()
    raw = settings.get("trustedWorkspaces", [])
    workspaces = list(raw) if isinstance(raw, list) else []
    str_p = str(p)
    if str_p not in workspaces:
        workspaces.append(str_p)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)
    return {"status": "ok", "workspaces": workspaces}

@router.delete("")
def delete_workspace(path: str = Query(...), _ = Depends(require_auth)):
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
    cleaned_path = path.strip()
    if "\x00" in cleaned_path or any(ord(c) < 32 or ord(c) == 127 for c in cleaned_path):
        raise HTTPException(status_code=400, detail="Chemin invalide : caractère interdit détecté.")
    try:
        p = str(Path(cleaned_path).resolve())
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if p == str(Path(DEFAULT_WORKSPACE).resolve()):
        raise HTTPException(status_code=400, detail="Cannot delete default workspace")
    settings = get_settings()
    raw = settings.get("trustedWorkspaces", [])
    raw_list = list(raw) if isinstance(raw, list) else []
    def _safe_resolve(w_path: str) -> str:
        try:
            return str(Path(w_path).resolve())
        except Exception:
            return str(w_path)

    workspaces = [w for w in raw_list if _safe_resolve(w) != p]
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)
    settings["trustedWorkspaces"] = workspaces
    save_settings(settings)
    return {"status": "ok", "workspaces": workspaces}

@router.get("/explore")
def explore_dir(path: str = Query(DEFAULT_WORKSPACE), _ = Depends(require_auth)) -> dict[str, Any]:
    if not path or not path.strip():
        raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
    cleaned_path = path.strip()
    if "\x00" in cleaned_path or any(ord(c) < 32 or ord(c) == 127 for c in cleaned_path):
        raise HTTPException(status_code=400, detail="Chemin invalide : caractère interdit détecté.")
    try:
        p = Path(cleaned_path).resolve()
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
