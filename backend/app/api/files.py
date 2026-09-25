import fnmatch
import logging
import os
import re
import shutil
import time
import uuid
from pathlib import Path
from typing import Any

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE, GEMINI_DIR, REPO_ROOT
from app.platform_utils import is_blocked_sensitive_path, is_safe_path
from app.services.storage import _safe_atomic_replace, get_settings

logger = logging.getLogger("antigravity.files")
router = APIRouter(prefix="/api/files", tags=["files"])

IGNORED_DIRS = {
    ".git", "node_modules", "__pycache__", ".venv", "venv", 
    "dist", ".cache", ".next", ".turbo", "vendor", "AppData",
    "Application Data", "Local Settings", ".cargo", ".rustup",
    ".vscode", ".idea", "build", "target", "env"
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
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []

    # Toujours inclure DEFAULT_WORKSPACE, GEMINI_DIR, et la racine du dépôt antigravity-webui
    allowed_roots = [
        Path(DEFAULT_WORKSPACE).resolve(),
        Path(GEMINI_DIR).resolve(),
        REPO_ROOT.resolve()
    ]
    if settings.get("defaultWorkspace"):
        try:
            allowed_roots.append(Path(settings["defaultWorkspace"]).resolve())
        except Exception:
            pass

    for ws in workspaces:
        try:
            allowed_roots.append(Path(ws).resolve())
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    base_root = Path(DEFAULT_WORKSPACE).resolve()
    if base_dir:
        try:
            cand_base = Path(base_dir).resolve()
            if not _is_blocked_sensitive_path(cand_base) and (
                is_safe_path(cand_base, allowed_roots)
                or (cand_base / ".git").exists()
                or any((p / ".git").exists() for p in cand_base.parents)
            ):
                allowed_roots.append(cand_base)
                base_root = cand_base
            elif is_safe_path(cand_base, allowed_roots) and not _is_blocked_sensitive_path(cand_base):
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
        p_check = p_str.replace("\\", "/")
        if not p_str or p_check in ("workspace:", "workspace:/", "workspace://", "file:", "file:/", "file://", "file:///", "file:/localhost", "file://localhost", "file://localhost/"):
            raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
        if os.name == "posix" and re.match(r'^[a-zA-Z]:[/\\]', p_str):
            raise HTTPException(status_code=400, detail="Chemin de style Windows non valide sur ce système d'exploitation.")
        if p_str.lower().startswith("workspace:"):
            sub = re.sub(r'^workspace:[/\\]*', '', p_str, flags=re.IGNORECASE)
            if not sub:
                raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
            target_file_path = base_root / sub
        elif p_str.lower().startswith("file:"):
            sub = re.sub(r'^file:(?:[/\\]*localhost)?[/\\]*', '', p_str, flags=re.IGNORECASE)
            if not sub:
                raise HTTPException(status_code=400, detail="Chemin invalide : chemin vide.")
            if os.name == "posix" and re.match(r'^[a-zA-Z]:[/\\]', sub):
                raise HTTPException(status_code=400, detail="Chemin de style Windows non valide sur ce système d'exploitation.")
            win_drive_match = re.match(r'^[/\\]*([a-zA-Z]:.*)', sub)
            if win_drive_match:
                sub = win_drive_match.group(1)
            elif not (len(sub) > 1 and sub[1] == ":") and not sub.startswith(("/", "\\")):
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
    resolved_path = _validate_path_access(target_path, base_dir=path)
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

class CreateFileRequest(BaseModel):
    path: str
    content: str = ""
    workspace: str | None = None

@router.post("/create")
def create_file(req: CreateFileRequest, _ = Depends(require_auth)):
    file_path = Path(req.path)
    resolved_path = _validate_path_access(file_path, base_dir=req.workspace)

    if resolved_path.exists():
        raise HTTPException(status_code=409, detail="Un fichier ou dossier avec ce nom existe déjà.")

    try:
        resolved_path.parent.mkdir(parents=True, exist_ok=True)
        with open(resolved_path, "w", encoding="utf-8") as f:
            f.write(req.content)

        stat = resolved_path.stat()
        return {
            "success": True,
            "path": str(resolved_path),
            "filename": resolved_path.name,
            "size": stat.st_size,
            "last_modified": stat.st_mtime
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating file {resolved_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du fichier : {e!s}")

class CreateDirRequest(BaseModel):
    path: str
    workspace: str | None = None

@router.post("/create-dir")
def create_directory(req: CreateDirRequest, _ = Depends(require_auth)):
    dir_path = Path(req.path)
    resolved_path = _validate_path_access(dir_path, base_dir=req.workspace)

    if resolved_path.exists():
        if resolved_path.is_file():
            raise HTTPException(status_code=409, detail="Un fichier avec ce nom existe déjà.")
        return {
            "success": True,
            "path": str(resolved_path),
            "already_existed": True
        }

    try:
        resolved_path.mkdir(parents=True, exist_ok=True)
        return {
            "success": True,
            "path": str(resolved_path),
            "name": resolved_path.name
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating directory {resolved_path}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du dossier : {e!s}")

class RenameFileRequest(BaseModel):
    old_path: str
    new_path: str
    workspace: str | None = None

@router.post("/rename")
def rename_file_or_dir(req: RenameFileRequest, _ = Depends(require_auth)):
    old_p = _validate_path_access(req.old_path, base_dir=req.workspace)
    new_p = _validate_path_access(req.new_path, base_dir=req.workspace)

    if not old_p.exists():
        raise HTTPException(status_code=404, detail="Élément source introuvable.")

    # Prevent renaming root directories
    settings = get_settings()
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []
    allowed_roots = {Path(DEFAULT_WORKSPACE).resolve(), Path(GEMINI_DIR).resolve(), REPO_ROOT.resolve()}
    for ws in workspaces:
        try:
            allowed_roots.add(Path(ws).resolve())
        except Exception:
            pass

    if old_p in allowed_roots:
        raise HTTPException(status_code=403, detail="Impossible de renommer la racine du workspace.")

    if new_p.exists():
        raise HTTPException(status_code=409, detail="La cible existe déjà.")

    try:
        new_p.parent.mkdir(parents=True, exist_ok=True)
        import shutil
        shutil.move(str(old_p), str(new_p))
        return {
            "success": True,
            "old_path": str(old_p),
            "new_path": str(new_p),
            "name": new_p.name,
            "is_dir": new_p.is_dir()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error renaming {old_p} -> {new_p}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors du renommage : {e!s}")

class DeleteFileRequest(BaseModel):
    path: str
    workspace: str | None = None

@router.post("/delete")
def delete_file_or_dir(req: DeleteFileRequest, _ = Depends(require_auth)):
    target = _validate_path_access(req.path, base_dir=req.workspace)

    if not target.exists():
        raise HTTPException(status_code=404, detail="Élément introuvable.")

    # Guard against deleting workspace roots
    settings = get_settings()
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []
    allowed_roots = {Path(DEFAULT_WORKSPACE).resolve(), Path(GEMINI_DIR).resolve(), REPO_ROOT.resolve()}
    for ws in workspaces:
        try:
            allowed_roots.add(Path(ws).resolve())
        except Exception:
            pass

    if target in allowed_roots:
        raise HTTPException(status_code=403, detail="Interdiction formelle de supprimer la racine du projet.")

    try:
        import shutil
        is_dir = target.is_dir()
        if is_dir:
            shutil.rmtree(target)
        else:
            target.unlink()

        return {
            "success": True,
            "path": str(target),
            "was_dir": is_dir
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting {target}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la suppression : {e!s}")

@router.get("/search")
def search_files(
    q: str = Query(..., min_length=1),
    path: str | None = Query(None),
    max_results: int = Query(50, ge=1, le=200),
    _ = Depends(require_auth)
):
    target_path = Path(path) if path else Path(DEFAULT_WORKSPACE)
    resolved_root = _validate_path_access(target_path)
    if not resolved_root.exists() or not resolved_root.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire racine invalide.")

    query_lower = q.lower().strip()
    results = []

    try:
        for root, dirs, files in os.walk(resolved_root):
            try:
                rel_depth = len(Path(root).relative_to(resolved_root).parts)
            except Exception:
                rel_depth = 0
            if rel_depth >= 4:
                dirs.clear()

            # Prune ignored directories in-place
            dirs[:] = [
                d for d in dirs
                if d not in IGNORED_DIRS and not d.startswith(".")
            ]

            # Check directory names
            for d in dirs:
                if query_lower in d.lower():
                    full_p = Path(root) / d
                    results.append({
                        "name": d,
                        "path": str(full_p),
                        "is_dir": True,
                        "match_type": "name"
                    })
                    if len(results) >= max_results:
                        return {"query": q, "results": results, "total": len(results)}

            # Check files
            for f in files:
                if f.startswith(".") and f != ".gitignore":
                    continue
                file_p = Path(root) / f
                if query_lower in f.lower():
                    results.append({
                        "name": f,
                        "path": str(file_p),
                        "is_dir": False,
                        "match_type": "name"
                    })
                    if len(results) >= max_results:
                        return {"query": q, "results": results, "total": len(results)}

                # Also search text content inside small text files (< 256KB)
                if len(query_lower) >= 2:
                    try:
                        stat = file_p.stat()
                        if stat.st_size < 256 * 1024:
                            with open(file_p, "r", encoding="utf-8", errors="ignore") as content_f:
                                for line_idx, line in enumerate(content_f, 1):
                                    if query_lower in line.lower():
                                        results.append({
                                            "name": f,
                                            "path": str(file_p),
                                            "is_dir": False,
                                            "match_type": "content",
                                            "line_number": line_idx,
                                            "snippet": line.strip()[:160]
                                        })
                                        if len(results) >= max_results:
                                            return {"query": q, "results": results, "total": len(results)}
                                        break  # one snippet per file match
                    except (OSError, PermissionError):
                        continue

        return {"query": q, "results": results, "total": len(results)}
    except Exception as e:
        logger.error(f"Error searching files in {resolved_root}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur de recherche : {e!s}")

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

MAX_UPLOAD_SIZE = 50 * 1024 * 1024  # 50 MB

@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    destination_dir: str = Form(...),
    workspace: str | None = Form(None),
    _ = Depends(require_auth)
):
    target_dir = Path(destination_dir)
    resolved_dir = _validate_path_access(target_dir, base_dir=workspace)
    if not resolved_dir.exists():
        resolved_dir.mkdir(parents=True, exist_ok=True)
    elif not resolved_dir.is_dir():
        resolved_dir = resolved_dir.parent

    # Sanitize filename: extract strictly the basename and remove dangerous chars
    raw_name = file.filename or "uploaded_file"
    safe_name = Path(raw_name).name
    if not safe_name or safe_name in (".", ".."):
        safe_name = f"uploaded_{uuid.uuid4().hex[:6]}"

    target_file = resolved_dir / safe_name
    resolved_target = _validate_path_access(target_file, base_dir=workspace)

    total_bytes = 0
    chunk_size = 64 * 1024
    try:
        async with aiofiles.open(resolved_target, "wb") as out_f:
            while chunk := await file.read(chunk_size):
                total_bytes += len(chunk)
                if total_bytes > MAX_UPLOAD_SIZE:
                    await out_f.close()
                    try:
                        resolved_target.unlink(missing_ok=True)
                    except Exception:
                        pass
                    raise HTTPException(
                        status_code=413,
                        detail="Fichier trop volumineux (taille maximale de 50 Mo dépassée)."
                    )
                await out_f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving uploaded file {resolved_target}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'enregistrement du fichier : {e!s}")

    return {
        "success": True,
        "path": str(resolved_target),
        "filename": resolved_target.name,
        "size": total_bytes
    }

class DuplicateFileRequest(BaseModel):
    path: str
    workspace: str | None = None

@router.post("/duplicate")
def duplicate_file(req: DuplicateFileRequest, _ = Depends(require_auth)):
    file_path = Path(req.path)
    resolved_path = _validate_path_access(file_path, base_dir=req.workspace)
    if not resolved_path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")
    if resolved_path.is_dir():
        raise HTTPException(status_code=400, detail="La duplication des dossiers n'est pas supportée.")

    stem = resolved_path.stem
    suffix = resolved_path.suffix
    parent = resolved_path.parent

    # Find unique name: stem_copy.ext, stem_copy_1.ext, stem_copy_2.ext...
    candidate_name = f"{stem}_copy{suffix}"
    candidate_path = parent / candidate_name
    counter = 1
    while candidate_path.exists():
        candidate_name = f"{stem}_copy_{counter}{suffix}"
        candidate_path = parent / candidate_name
        counter += 1

    resolved_candidate = _validate_path_access(candidate_path, base_dir=req.workspace)
    try:
        shutil.copy2(resolved_path, resolved_candidate)
        return {
            "success": True,
            "new_path": str(resolved_candidate),
            "new_name": resolved_candidate.name,
            "size": resolved_candidate.stat().st_size
        }
    except Exception as e:
        logger.error(f"Error duplicating file {resolved_path} to {resolved_candidate}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la duplication du fichier : {e!s}")


def _matches_pattern(rel_path: str, filename: str, pattern: str) -> bool:
    tokens = [p.strip() for p in pattern.split(",") if p.strip()]
    norm_rel = rel_path.replace("\\", "/")
    for token in tokens:
        if fnmatch.fnmatch(filename, token) or fnmatch.fnmatch(norm_rel, token) or fnmatch.fnmatch(norm_rel, f"*{token}*"):
            return True
    return False


def _compile_search_regex(query: str, case_sensitive: bool, whole_word: bool, is_regex: bool) -> re.Pattern:
    if not is_regex:
        pat_str = re.escape(query)
    else:
        pat_str = query

    if whole_word:
        pat_str = rf"\b{pat_str}\b"

    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(pat_str, flags)


class SearchMatchItem(BaseModel):
    line_number: int
    column: int
    match_length: int
    line_text: str
    match_text: str


class FileSearchResult(BaseModel):
    file_path: str
    relative_path: str
    matches: list[SearchMatchItem]


class WorkspaceSearchRequest(BaseModel):
    query: str
    workspace: str | None = None
    case_sensitive: bool = False
    whole_word: bool = False
    is_regex: bool = False
    include_pattern: str | None = None
    exclude_pattern: str | None = None
    max_results: int = 500
    max_file_size_kb: int = 1024


class WorkspaceSearchResponse(BaseModel):
    query: str
    total_matches: int
    total_files: int
    files: list[FileSearchResult]
    duration_ms: float
    truncated: bool


@router.post("/workspace-search", response_model=WorkspaceSearchResponse)
def workspace_search(req: WorkspaceSearchRequest, _ = Depends(require_auth)):
    if not req.query:
        raise HTTPException(status_code=400, detail="Requête de recherche vide.")

    start_time = time.time()
    target_path = Path(req.workspace) if req.workspace else Path(DEFAULT_WORKSPACE)
    resolved_root = _validate_path_access(target_path)
    if not resolved_root.exists() or not resolved_root.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire workspace invalide.")

    try:
        regex = _compile_search_regex(req.query, req.case_sensitive, req.whole_word, req.is_regex)
    except re.error as e:
        raise HTTPException(status_code=400, detail=f"Expression régulière invalide : {e!s}")

    total_matches = 0
    results_by_file: list[FileSearchResult] = []
    truncated = False
    max_bytes = req.max_file_size_kb * 1024

    try:
        for root, dirs, files in os.walk(resolved_root, onerror=lambda err: None):
            try:
                rel_depth = len(Path(root).relative_to(resolved_root).parts)
            except Exception:
                rel_depth = 0
            if rel_depth >= 6:
                dirs.clear()

            dirs[:] = [
                d for d in dirs
                if d not in IGNORED_DIRS and not d.startswith(".") and not os.path.islink(os.path.join(root, d))
            ]

            for f in files:
                if f.startswith(".") and f != ".gitignore":
                    continue

                full_file_p = Path(root) / f
                try:
                    rel_path = str(full_file_p.relative_to(resolved_root))
                except Exception:
                    rel_path = f

                if req.exclude_pattern and _matches_pattern(rel_path, f, req.exclude_pattern):
                    continue
                if req.include_pattern and not _matches_pattern(rel_path, f, req.include_pattern):
                    continue

                try:
                    stat = full_file_p.stat()
                    if stat.st_size > max_bytes:
                        continue

                    with open(full_file_p, "r", encoding="utf-8", errors="ignore") as f_obj:
                        first_chunk = f_obj.read(1024)
                        if "\x00" in first_chunk:
                            continue
                        f_obj.seek(0)

                        file_matches: list[SearchMatchItem] = []
                        for line_idx, line in enumerate(f_obj, 1):
                            for m in regex.finditer(line):
                                match_len = m.end() - m.start()
                                file_matches.append(SearchMatchItem(
                                    line_number=line_idx,
                                    column=m.start() + 1,
                                    match_length=match_len,
                                    line_text=line.rstrip("\r\n")[:300],
                                    match_text=m.group(0)
                                ))
                                total_matches += 1
                                if total_matches >= req.max_results:
                                    truncated = True
                                    break
                            if truncated:
                                break

                        if file_matches:
                            results_by_file.append(FileSearchResult(
                                file_path=str(full_file_p),
                                relative_path=rel_path.replace("\\", "/"),
                                matches=file_matches
                            ))

                except (OSError, PermissionError):
                    continue

                if (time.time() - start_time) > 8.0:
                    truncated = True
                    break

                if truncated:
                    break
            if truncated:
                break
    except Exception as e:
        logger.error(f"Error during workspace search: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de la recherche : {e!s}")

    duration = round((time.time() - start_time) * 1000, 2)
    return WorkspaceSearchResponse(
        query=req.query,
        total_matches=total_matches,
        total_files=len(results_by_file),
        files=results_by_file,
        duration_ms=duration,
        truncated=truncated
    )


class FileReplacePreview(BaseModel):
    file_path: str
    relative_path: str
    replacements_count: int
    original_content: str
    modified_content: str


class WorkspaceReplaceRequest(BaseModel):
    query: str
    replace_text: str
    workspace: str | None = None
    case_sensitive: bool = False
    whole_word: bool = False
    is_regex: bool = False
    include_pattern: str | None = None
    exclude_pattern: str | None = None
    file_paths: list[str] | None = None
    dry_run: bool = False


class WorkspaceReplaceResponse(BaseModel):
    query: str
    replace_text: str
    total_replacements: int
    files_modified: int
    previews: list[FileReplacePreview]
    dry_run: bool
    duration_ms: float


@router.post("/workspace-replace", response_model=WorkspaceReplaceResponse)
def workspace_replace(req: WorkspaceReplaceRequest, _ = Depends(require_auth)):
    if not req.query:
        raise HTTPException(status_code=400, detail="Requête de remplacement vide.")

    start_time = time.time()
    target_path = Path(req.workspace) if req.workspace else Path(DEFAULT_WORKSPACE)
    resolved_root = _validate_path_access(target_path)
    if not resolved_root.exists() or not resolved_root.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire workspace invalide.")

    try:
        regex = _compile_search_regex(req.query, req.case_sensitive, req.whole_word, req.is_regex)
    except re.error as e:
        raise HTTPException(status_code=400, detail=f"Expression régulière invalide : {e!s}")

    previews: list[FileReplacePreview] = []
    total_replacements = 0
    files_modified = 0

    files_to_check: list[Path] = []
    if req.file_paths:
        for fp in req.file_paths:
            p = _validate_path_access(Path(fp), base_dir=str(resolved_root))
            if p.exists() and p.is_file():
                files_to_check.append(p)
    else:
        for root, dirs, files in os.walk(resolved_root, onerror=lambda err: None):
            try:
                rel_depth = len(Path(root).relative_to(resolved_root).parts)
            except Exception:
                rel_depth = 0
            if rel_depth >= 6:
                dirs.clear()
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".") and not os.path.islink(os.path.join(root, d))]
            for f in files:
                if f.startswith(".") and f != ".gitignore":
                    continue
                full_p = Path(root) / f
                try:
                    rel = str(full_p.relative_to(resolved_root))
                except Exception:
                    rel = f
                if req.exclude_pattern and _matches_pattern(rel, f, req.exclude_pattern):
                    continue
                if req.include_pattern and not _matches_pattern(rel, f, req.include_pattern):
                    continue
                files_to_check.append(full_p)

    for file_p in files_to_check:
        try:
            stat = file_p.stat()
            if stat.st_size > 2 * 1024 * 1024:
                continue
            with open(file_p, "r", encoding="utf-8", errors="ignore") as f_in:
                original = f_in.read()
            if "\x00" in original[:1024]:
                continue

            matches_count = len(regex.findall(original))
            if matches_count == 0:
                continue

            modified = regex.sub(req.replace_text, original)
            try:
                rel_path = str(file_p.relative_to(resolved_root))
            except Exception:
                rel_path = file_p.name

            total_replacements += matches_count
            files_modified += 1

            previews.append(FileReplacePreview(
                file_path=str(file_p),
                relative_path=rel_path.replace("\\", "/"),
                replacements_count=matches_count,
                original_content=original,
                modified_content=modified
            ))

            if not req.dry_run:
                tmp_file = file_p.parent / f".{file_p.name}.tmp_{uuid.uuid4().hex[:8]}"
                try:
                    with open(tmp_file, "w", encoding="utf-8") as f_out:
                        f_out.write(modified)
                    _safe_atomic_replace(tmp_file, file_p)
                finally:
                    tmp_file.unlink(missing_ok=True)


        except (OSError, PermissionError) as e:
            logger.warning(f"Could not replace in file {file_p}: {e}")
            continue

    duration = round((time.time() - start_time) * 1000, 2)
    return WorkspaceReplaceResponse(
        query=req.query,
        replace_text=req.replace_text,
        total_replacements=total_replacements,
        files_modified=files_modified,
        previews=previews,
        dry_run=req.dry_run,
        duration_ms=duration
    )


class SingleReplaceRequest(BaseModel):
    file_path: str
    workspace: str | None = None
    line_number: int
    column: int
    match_length: int
    replace_text: str
    expected_match: str | None = None


@router.post("/single-replace")
def single_replace(req: SingleReplaceRequest, _ = Depends(require_auth)):
    p = _validate_path_access(Path(req.file_path), base_dir=req.workspace)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable.")

    try:
        with open(p, "r", encoding="utf-8") as f_in:
            lines = f_in.readlines()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur de lecture : {e!s}")

    if req.line_number < 1 or req.line_number > len(lines):
        raise HTTPException(status_code=400, detail=f"Numéro de ligne {req.line_number} hors limites.")

    target_line = lines[req.line_number - 1]
    col_idx = req.column - 1
    if col_idx < 0 or req.match_length < 0 or col_idx + req.match_length > len(target_line):
        raise HTTPException(status_code=400, detail="Coordonnées de remplacement invalides.")

    actual_match = target_line[col_idx : col_idx + req.match_length]
    if req.expected_match and actual_match != req.expected_match:
        raise HTTPException(status_code=409, detail=f"Le contenu cible a changé (attendu: '{req.expected_match}', trouvé: '{actual_match}').")

    new_line = target_line[:col_idx] + req.replace_text + target_line[col_idx + req.match_length:]
    lines[req.line_number - 1] = new_line
    modified_content = "".join(lines)

    tmp_file = p.parent / f".{p.name}.tmp_{uuid.uuid4().hex[:8]}"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f_out:
            f_out.write(modified_content)
        _safe_atomic_replace(tmp_file, p)
    finally:
        tmp_file.unlink(missing_ok=True)


    return {
        "success": True,
        "file_path": str(p),
        "modified_content": modified_content
    }



