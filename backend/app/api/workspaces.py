from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
from typing import List, Dict, Any
from app.services.storage import get_settings, save_settings
from app.config import DEFAULT_WORKSPACE

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])

@router.get("")
def list_workspaces() -> List[str]:
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    if DEFAULT_WORKSPACE not in workspaces:
        workspaces.insert(0, DEFAULT_WORKSPACE)
    return workspaces

@router.post("")
def add_workspace(path: str = Query(...)):
    p = Path(path).resolve()
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

@router.get("/explore")
def explore_dir(path: str = Query(DEFAULT_WORKSPACE)) -> Dict[str, Any]:
    p = Path(path).resolve()
    if not p.exists() or not p.is_dir():
        raise HTTPException(status_code=404, detail="Path is not a valid directory")
    
    entries = []
    try:
        for item in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Ignore hidden dirs or huge node_modules/git by default
            if item.name.startswith(".") and item.name not in [".gemini", ".hermes"]:
                continue
            entries.append({
                "name": item.name,
                "path": str(item),
                "is_dir": item.is_dir(),
                "size": item.stat().st_size if item.is_file() else None
            })
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))

    return {
        "current_path": str(p),
        "parent_path": str(p.parent) if p.parent != p else None,
        "entries": entries
    }
