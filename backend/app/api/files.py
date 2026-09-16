import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_safe_path
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.files")
router = APIRouter(prefix="/api/files", tags=["files"])

IGNORED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", 
    "dist", ".cache", ".next", ".turbo", "vendor"
}

def scan_dir(dir_path: Path, current_depth: int = 0, max_depth: int = 2) -> list[dict[str, Any]]:
    if current_depth > max_depth or not dir_path.is_dir():
        return []

    items = []
    try:
        entries = sorted(dir_path.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
        for entry in entries:
            name = entry.name
            if name.startswith(".") and name not in [".env", ".gitignore"]:
                continue
            if entry.is_dir() and name in IGNORED_DIRS:
                continue

            try:
                stat = entry.stat()
                is_dir = entry.is_dir()
                item: dict[str, Any] = {
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


def _is_blocked_sensitive_path(resolved: Path) -> bool:
    """
    Vérifie avec précision si un chemin cible pointe vers un fichier ou dossier
    sensible (clés SSH, tokens, identifiants, répertoires système critiques).
    Évite les faux positifs des recherches de sous-chaînes sur des fichiers
    légitimes de code source (ex: system.ts, processing.py, etc.).
    """
    parts = resolved.parts
    # Répertoires système et dossiers cachés sensibles
    if any(p in (".ssh", ".gnupg") for p in parts):
        return True
    # Points de montage système root
    if len(parts) > 1 and parts[1] in ("proc", "sys"):
        return True
    if len(parts) > 2 and parts[1] == "etc" and parts[2] in ("shadow", "sudoers", "master.passwd"):
        return True

    # Fichiers de secrets et identifiants
    name = resolved.name.lower()
    if any(p == ".git" for p in parts):
        return True
    if name in ("antigravity-oauth-token", "webui_auth.json", "webui_password.txt", "google_accounts.json"):
        return True
    if name in ("id_rsa", "id_ed25519", "id_dsa", "id_ecdsa") or name.startswith(("id_rsa.", "id_ed25519.")):
        return True
    if name == ".env" or name.startswith(".env."):
        return True
    return ".stash_" in name


def _validate_path_access(file_path: Path) -> Path:
    try:
        if not file_path.is_absolute():
            file_path = Path(DEFAULT_WORKSPACE) / file_path
        resolved = file_path.resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if _is_blocked_sensitive_path(resolved):
        raise HTTPException(status_code=403, detail="Accès refusé : fichier ou répertoire restreint.")

    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    allowed_roots = [Path(DEFAULT_WORKSPACE).resolve()]
    for ws in workspaces:
        try:
            allowed_roots.append(Path(ws).resolve())
        except Exception:
            pass

    if not is_safe_path(resolved, allowed_roots):
        raise HTTPException(status_code=403, detail="Accès refusé : chemin en dehors des répertoires de travail autorisés.")

    return resolved

@router.get("/tree")
def get_file_tree(
    path: str | None = Query(None),
    depth: int = Query(2, ge=1, le=4),
    _ = Depends(require_auth)
):
    target_path = Path(path) if path else Path(DEFAULT_WORKSPACE)
    if not path and not target_path.exists():
        try:
            target_path.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            logger.warning(f"Could not create default workspace directory {target_path}: {e}")
    resolved_path = _validate_path_access(target_path)
    if not resolved_path.exists() or not resolved_path.is_dir():
        raise HTTPException(status_code=400, detail=f"Répertoire invalide : {target_path}")

    return {
        "root": str(resolved_path),
        "name": resolved_path.name or str(resolved_path),
        "items": scan_dir(resolved_path, current_depth=0, max_depth=depth)
    }

@router.get("/content")
def get_file_content(path: str = Query(...), _ = Depends(require_auth)):
    file_path = Path(path)
    resolved_path = _validate_path_access(file_path)
    if not resolved_path.exists() or not resolved_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    stat = resolved_path.stat()
    if stat.st_size > 1024 * 1024 * 2: # 2MB limit
        raise HTTPException(status_code=400, detail="Fichier trop volumineux pour l'éditeur (max 2 Mo).")

    try:
        with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()

        return {
            "path": str(resolved_path),
            "filename": resolved_path.name,
            "extension": resolved_path.suffix.lstrip("."),
            "size": stat.st_size,
            "last_modified": stat.st_mtime,
            "content": content
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du fichier : {e!s}")

class SaveFileRequest(BaseModel):
    path: str
    content: str

@router.post("/save")
def save_file_content(req: SaveFileRequest, _ = Depends(require_auth)):
    file_path = Path(req.path)
    resolved_path = _validate_path_access(file_path)
    tmp_path: Path | None = None
    try:
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = resolved_path.parent / f".{resolved_path.name}.tmp.{uuid.uuid4().hex[:8]}"
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(req.content)
        tmp_path.replace(resolved_path)
        stat = resolved_path.stat()
        return {
            "success": True,
            "path": str(resolved_path),
            "size": stat.st_size,
            "last_modified": stat.st_mtime
        }
    except Exception as e:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        logger.error(f"Error saving file {resolved_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'enregistrement : {e!s}")

@router.get("/download")
def download_file(path: str = Query(...), _ = Depends(require_auth)):
    file_path = Path(path)
    resolved_path = _validate_path_access(file_path)
    if not resolved_path.exists() or not resolved_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    return FileResponse(
        path=str(resolved_path),
        filename=resolved_path.name
    )

