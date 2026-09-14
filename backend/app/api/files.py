import os
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from app.config import DEFAULT_WORKSPACE
from app.api.auth import require_auth

logger = logging.getLogger("antigravity.files")
router = APIRouter(prefix="/api/files", tags=["files"])

IGNORED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", 
    "dist", ".cache", ".next", ".turbo", "vendor"
}

def scan_dir(dir_path: Path, current_depth: int = 0, max_depth: int = 2) -> List[Dict[str, Any]]:
    if current_depth > max_depth or not dir_path.is_dir():
        return []

    items = []
    try:
        entries = sorted(list(dir_path.iterdir()), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            name = entry.name
            if name.startswith(".") and name not in [".env", ".gitignore"]:
                continue
            if entry.is_dir() and name in IGNORED_DIRS:
                continue

            try:
                stat = entry.stat()
                is_dir = entry.is_dir()
                item: Dict[str, Any] = {
                    "name": name,
                    "path": str(entry.resolve()),
                    "is_dir": is_dir,
                    "size": stat.st_size if not is_dir else 0,
                    "last_modified": stat.st_mtime,
                }

                if is_dir and current_depth < max_depth:
                    item["children"] = scan_dir(entry, current_depth + 1, max_depth)

                items.append(item)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError) as e:
        logger.warning(f"Unable to read dir {dir_path}: {e}")

    return items

@router.get("/tree")
def get_file_tree(
    path: Optional[str] = Query(None),
    depth: int = Query(2, ge=1, le=4),
    _ = Depends(require_auth)
):
    target_path = Path(path) if path else Path(DEFAULT_WORKSPACE)
    if not target_path.exists() or not target_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Répertoire invalide : {target_path}")

    return {
        "root": str(target_path.resolve()),
        "name": target_path.name or str(target_path),
        "items": scan_dir(target_path, current_depth=0, max_depth=depth)
    }

@router.get("/content")
def get_file_content(path: str = Query(...), _ = Depends(require_auth)):
    file_path = Path(path)
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    stat = file_path.stat()
    if stat.st_size > 1024 * 1024 * 2: # 2MB limit
        raise HTTPException(status_code=400, detail="Fichier trop volumineux pour l'éditeur (max 2 Mo).")

    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        return {
            "path": str(file_path.resolve()),
            "filename": file_path.name,
            "extension": file_path.suffix.lstrip("."),
            "size": stat.st_size,
            "last_modified": stat.st_mtime,
            "content": content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du fichier : {str(e)}")

class SaveFileRequest(BaseModel):
    path: str
    content: str

@router.post("/save")
def save_file_content(req: SaveFileRequest, _ = Depends(require_auth)):
    file_path = Path(req.path)
    try:
        file_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = file_path.with_suffix(file_path.suffix + ".tmp")
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(req.content)
        tmp_path.replace(file_path)
        stat = file_path.stat()
        return {
            "success": True,
            "path": str(file_path.resolve()),
            "size": stat.st_size,
            "last_modified": stat.st_mtime
        }
    except Exception as e:
        if 'tmp_path' in locals() and tmp_path.exists():
            tmp_path.unlink()
        logger.error(f"Error saving file {file_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'enregistrement : {str(e)}")

