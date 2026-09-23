import logging
import os
import re
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE, GEMINI_DIR
from app.platform_utils import is_blocked_sensitive_path, is_safe_path
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.files")
router = APIRouter(prefix="/api/files", tags=["files"])

IGNORED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", 
    "dist", ".cache", ".next", ".turbo", "vendor"
}

def scan_dir(dir_path: Path, current_depth: int = 0, max_depth: int = 2, visited: set[Path] | None = None) -> list[dict[str, Any]]:
    if current_depth > max_depth or not dir_path.is_dir():
        return []

    if visited is None:
        visited = set()
    try:
        resolved_dir = dir_path.resolve()
    except (OSError, RuntimeError):
        return []
    if resolved_dir in visited:
        return []
    visited.add(resolved_dir)

    items = []
    try:
        def _safe_sort_key(e: Path) -> tuple[bool, str]:
            try:
                is_directory = e.is_dir()
            except (OSError, RuntimeError):
                is_directory = False
            return (not is_directory, e.name.lower())

        entries = sorted(dir_path.iterdir(), key=_safe_sort_key)
        for entry in entries:
            name = entry.name
            if name.startswith(".") and name != ".gitignore":
                continue
            if name in IGNORED_DIRS and entry.is_dir():
                continue
            if is_blocked_sensitive_path(entry):
                continue

            try:
                is_symlink = entry.is_symlink()
                is_dir = entry.is_dir() and not is_symlink
                stat = entry.stat()
                try:
                    resolved_entry_path = str(entry.resolve())
                except (OSError, RuntimeError):
                    resolved_entry_path = str(entry)
                item: dict[str, Any] = {
                    "name": name,
                    "path": resolved_entry_path,
                    "is_dir": is_dir,
                    "size": 0 if is_dir else stat.st_size,
                    "last_modified": stat.st_mtime,
                }

                if is_dir:
                    if current_depth < max_depth:
                        item["children"] = scan_dir(entry, current_depth + 1, max_depth, visited)
                    else:
                        item["children"] = []

                items.append(item)
            except (PermissionError, OSError):
                continue
    except (PermissionError, OSError) as e:
        logger.warning(f"Unable to read dir {dir_path}: {e}")

    return items


def _is_blocked_sensitive_path(resolved: Path) -> bool:
    return is_blocked_sensitive_path(resolved)


def _validate_path_access(file_path: Path | str, base_dir: Path | str | None = None) -> Path:
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    allowed_roots = [Path(DEFAULT_WORKSPACE).resolve(), Path(GEMINI_DIR).resolve()]
    for ws in workspaces:
        try:
            allowed_roots.append(Path(ws).resolve())
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    base_root = Path(DEFAULT_WORKSPACE).resolve()
    if base_dir:
        try:
            cand_base = Path(base_dir).resolve()
            if is_safe_path(cand_base, allowed_roots) and not _is_blocked_sensitive_path(cand_base):
                base_root = cand_base
        except Exception as e:
            logger.debug(f"Ignored error with candidate base_dir: {e}")

    try:
        import unicodedata
        from urllib.parse import unquote
        p_str = str(file_path).strip()
        for _ in range(3):
            next_p = unquote(p_str)
            if next_p == p_str:
                break
            p_str = next_p
        p_str = unicodedata.normalize("NFC", p_str)
        if "\x00" in p_str:
            raise HTTPException(status_code=400, detail="Chemin invalide : octet nul détecté.")
        # Strip URL fragment (#L10-L20) or query string (?...) if present from markdown links
        if "#" in p_str:
            p_str = p_str.split("#", 1)[0]
        if "?" in p_str:
            p_str = p_str.split("?", 1)[0]
        p_str = p_str.strip()
        if any(ord(c) < 32 or ord(c) == 127 for c in p_str):
            raise HTTPException(status_code=400, detail="Chemin invalide : caractère de contrôle interdit détecté.")
        if not p_str or p_str in ("workspace:", "workspace:/", "workspace://", "file:", "file:/", "file://", "file:///", "file:/localhost", "file://localhost", "file://localhost/"):
            raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
        if os.name == "posix" and re.match(r'^[a-zA-Z]:[/\\]', p_str):
            raise HTTPException(status_code=400, detail="Chemin de style Windows non valide sur ce système d'exploitation.")
        if p_str.lower().startswith("workspace:"):
            sub = re.sub(r'^workspace:/*', '', p_str, flags=re.IGNORECASE)
            if not sub:
                raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
            target_file_path = base_root / sub
        elif p_str.lower().startswith("file:"):
            sub = re.sub(r'^file:(?:/*localhost)?/*', '', p_str, flags=re.IGNORECASE)
            if not sub:
                raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
            if os.name == "posix" and re.match(r'^[a-zA-Z]:[/\\]', sub):
                raise HTTPException(status_code=400, detail="Chemin de style Windows non valide sur ce système d'exploitation.")
            if not (len(sub) > 1 and sub[1] == ":"):
                sub = "/" + sub
            target_file_path = Path(sub)
        else:
            target_file_path = Path(p_str)
            if not target_file_path.is_absolute():
                target_file_path = base_root / target_file_path
        resolved = target_file_path.resolve()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide : {e}")

    if _is_blocked_sensitive_path(resolved):
        raise HTTPException(status_code=403, detail="Accès refusé : fichier ou répertoire restreint.")

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
def get_file_content(path: str = Query(...), workspace: str | None = Query(None), _ = Depends(require_auth)):
    file_path = Path(path)
    resolved_path = _validate_path_access(file_path, base_dir=workspace)
    if not resolved_path.exists() or not resolved_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    stat = resolved_path.stat()
    if stat.st_size > 1024 * 1024 * 2: # 2MB limit
        raise HTTPException(status_code=400, detail="Fichier trop volumineux pour l'éditeur (max 2 Mo).")

    try:
        with open(resolved_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        content = content.lstrip("\ufeff")

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
    workspace: str | None = None

MAX_FILE_SAVE_BYTES = 5 * 1024 * 1024  # 5 Mo max

@router.post("/save")
def save_file_content(req: SaveFileRequest, _ = Depends(require_auth)):
    if len(req.content.encode("utf-8")) > MAX_FILE_SAVE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Taille du fichier excessive : la taille maximale autorisée est de {MAX_FILE_SAVE_BYTES // (1024 * 1024)} Mo."
        )

    file_path = Path(req.path)
    resolved_path = _validate_path_access(file_path, base_dir=req.workspace)
    if resolved_path.exists() and resolved_path.is_dir():
        raise HTTPException(status_code=400, detail="Impossible d'écrire un fichier sur un répertoire existant.")

    tmp_path: Path | None = None
    try:
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        existing_mode = resolved_path.stat().st_mode if resolved_path.exists() else None
        tmp_target: Path = resolved_path.parent / f".{resolved_path.name}.tmp.{uuid.uuid4().hex[:8]}"
        tmp_path = tmp_target
        with open(tmp_target, "w", encoding="utf-8") as f:
            f.write(req.content)
        if existing_mode is not None:
            try:
                tmp_target.chmod(existing_mode)
            except Exception as e:
                logger.debug(f"Ignored chmod error: {e}")
        for attempt in range(3):
            try:
                tmp_target.replace(resolved_path)
                tmp_path = None
                break
            except (PermissionError, OSError):
                if attempt == 2:
                    import shutil
                    try:
                        shutil.copy2(tmp_target, resolved_path)
                    finally:
                        tmp_target.unlink(missing_ok=True)
                    tmp_path = None
                    break
                import time
                time.sleep(0.05)
        stat = resolved_path.stat()
        return {
            "success": True,
            "path": str(resolved_path),
            "size": stat.st_size,
            "last_modified": stat.st_mtime
        }
    except HTTPException:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        raise
    except Exception as e:
        if tmp_path is not None:
            tmp_path.unlink(missing_ok=True)
        logger.error(f"Error saving file {resolved_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'enregistrement : {e!s}")

@router.get("/download")
def download_file(path: str = Query(...), workspace: str | None = Query(None), _ = Depends(require_auth)):
    import mimetypes
    resolved_path = _validate_path_access(path, base_dir=workspace)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    if not resolved_path.is_file():
        raise HTTPException(status_code=400, detail="La cible n'est pas un fichier.")
    try:
        if isinstance(resolved_path, Path) and not os.access(resolved_path, os.R_OK):
            raise HTTPException(status_code=403, detail="Permission de lecture refusée sur ce fichier.")
    except (TypeError, OSError):
        pass

    known_mime_types = {
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".doc": "application/msword",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".pdf": "application/pdf",
        ".json": "application/json; charset=utf-8",
        ".md": "text/markdown; charset=utf-8",
        ".markdown": "text/markdown; charset=utf-8",
        ".yaml": "text/yaml; charset=utf-8",
        ".yml": "text/yaml; charset=utf-8",
        ".csv": "text/csv; charset=utf-8",
        ".tsv": "text/tab-separated-values; charset=utf-8",
        ".svg": "image/svg+xml",
        ".txt": "text/plain; charset=utf-8",
        ".log": "text/plain; charset=utf-8",
        ".py": "text/x-python; charset=utf-8",
        ".ts": "text/typescript; charset=utf-8",
        ".tsx": "text/typescript-jsx; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
    }
    ext = resolved_path.suffix.lower()
    media_type = known_mime_types.get(ext)
    if not media_type:
        guessed, _ = mimetypes.guess_type(resolved_path.name)
        media_type = guessed

    return FileResponse(
        path=str(resolved_path),
        filename=resolved_path.name,
        media_type=media_type or "application/octet-stream"
    )

