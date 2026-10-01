import re
import subprocess
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_blocked_sensitive_path
from app.services.project_detector import (
    clear_detector_cache,
    detect_project_details,
    detect_project_health,
)
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
    if active_path and isinstance(active_path, str) and active_path.strip():
        try:
            norm_active = str(Path(active_path.strip()).resolve())
        except Exception:
            norm_active = active_path.strip()


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

    def _safe_resolve(w_path: str) -> str:
        try:
            return str(Path(w_path).resolve())
        except Exception:
            return str(w_path)

    if not any(_safe_resolve(w) == str_p for w in workspaces):
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
    cur_default = settings.get("defaultWorkspace")
    if cur_default and _safe_resolve(cur_default) == p:
        settings["defaultWorkspace"] = DEFAULT_WORKSPACE
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
                has_git = False
                project_type = None
                if is_dir:
                    try:
                        has_git = (item / ".git").exists()
                        if (item / "package.json").exists():
                            project_type = "node"
                        elif (item / "pyproject.toml").exists() or (item / "requirements.txt").exists():
                            project_type = "python"
                        elif (item / "composer.json").exists():
                            project_type = "php"
                        elif (item / "Cargo.toml").exists():
                            project_type = "rust"
                    except Exception:
                        pass
                entries.append({
                    "name": item.name,
                    "path": str(item),
                    "is_dir": is_dir,
                    "size": size,
                    "has_git": has_git,
                    "project_type": project_type,
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


class CreateWorkspacePayload(BaseModel):
    parent_path: str = Field(..., description="Parent directory where the new project folder will be created")
    folder_name: str = Field(..., min_length=1, max_length=100, description="Folder name of the project")
    template: Literal["empty", "node", "python", "html", "readme"] = Field("empty", description="Project template")
    init_git: bool = Field(True, description="Initialize git repository")


@router.post("/create")
def create_new_workspace(payload: CreateWorkspacePayload, _ = Depends(require_auth)) -> dict[str, Any]:
    parent_str = payload.parent_path.strip()
    folder_str = payload.folder_name.strip()

    if not parent_str or not folder_str:
        raise HTTPException(status_code=400, detail="Chemin parent et nom de dossier requis.")

    if not re.match(r"^[a-zA-Z0-9_.\-]+$", folder_str):
        raise HTTPException(status_code=400, detail="Nom de dossier invalide (lettres, chiffres, tirets et underscores uniquement).")

    try:
        parent_p = Path(parent_str).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin parent invalide: {e}")

    if is_blocked_sensitive_path(parent_p) or not parent_p.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire parent invalide ou inaccessible.")

    target_p = parent_p / folder_str
    if is_blocked_sensitive_path(target_p):
        raise HTTPException(status_code=403, detail="Chemin cible restreint.")

    if target_p.exists():
        raise HTTPException(status_code=400, detail=f"Le dossier '{folder_str}' existe déjà dans cet emplacement.")

    try:
        target_p.mkdir(parents=True, exist_ok=False)

        # Initialize template files
        readme_content = f"# {folder_str}\n\nProjet créé avec Antigravity WebUI Studio.\n"
        (target_p / "README.md").write_text(readme_content, encoding="utf-8")

        if payload.template == "node":
            pkg = {
                "name": folder_str.lower().replace(" ", "-"),
                "version": "0.1.0",
                "private": True,
                "scripts": {
                    "dev": "node index.js",
                    "start": "node index.js"
                }
            }
            import json
            (target_p / "package.json").write_text(json.dumps(pkg, indent=2), encoding="utf-8")
            (target_p / "index.js").write_text('console.log("Hello from Antigravity!");\n', encoding="utf-8")
            (target_p / ".gitignore").write_text("node_modules/\n.env\n.DS_Store\n", encoding="utf-8")

        elif payload.template == "python":
            (target_p / "main.py").write_text('def main():\n    print("Hello from Antigravity!")\n\nif __name__ == "__main__":\n    main()\n', encoding="utf-8")
            (target_p / "requirements.txt").write_text("# Vos dépendances Python\n", encoding="utf-8")
            (target_p / ".gitignore").write_text("__pycache__/\n*.py[cod]\n.venv/\nenv/\n.env\n", encoding="utf-8")

        elif payload.template == "html":
            html = f"<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n  <meta charset=\"UTF-8\" />\n  <title>{folder_str}</title>\n  <link rel=\"stylesheet\" href=\"style.css\" />\n</head>\n<body>\n  <h1>{folder_str}</h1>\n  <p>Créé dans Antigravity WebUI</p>\n</body>\n</html>\n"
            (target_p / "index.html").write_text(html, encoding="utf-8")
            (target_p / "style.css").write_text("body {\n  font-family: sans-serif;\n  padding: 2rem;\n}\n", encoding="utf-8")

        if payload.init_git:
            try:
                subprocess.run(["git", "init", "-q"], cwd=str(target_p), capture_output=True, timeout=10)
            except Exception as e:
                pass

        # Register workspace
        str_target = str(target_p)
        settings = get_settings()
        raw = settings.get("trustedWorkspaces", [])
        workspaces = list(raw) if isinstance(raw, list) else []
        if str_target not in workspaces:
            workspaces.append(str_target)
            settings["trustedWorkspaces"] = workspaces
            save_settings(settings)

        clear_detector_cache()
        return {"status": "ok", "path": str_target, "name": folder_str}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la création du projet : {e}")


class CloneWorkspacePayload(BaseModel):
    repo_url: str = Field(..., description="Git clone URL (HTTPS or SSH)")
    parent_path: str = Field(..., description="Parent directory where the repo will be cloned")
    folder_name: str | None = Field(None, description="Optional custom folder name")
    branch: str | None = Field(None, description="Optional branch to checkout")


@router.post("/clone")
def clone_new_workspace(payload: CloneWorkspacePayload, _ = Depends(require_auth)) -> dict[str, Any]:
    url = payload.repo_url.strip()
    parent_str = payload.parent_path.strip()

    if not url or not parent_str:
        raise HTTPException(status_code=400, detail="URL du dépôt et répertoire parent requis.")

    if not (url.startswith("https://") or url.startswith("http://") or url.startswith("git@") or url.startswith("ssh://")):
        raise HTTPException(status_code=400, detail="URL Git invalide. Doit commencer par https://, git@ ou ssh://")

    try:
        parent_p = Path(parent_str).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin parent invalide: {e}")

    if is_blocked_sensitive_path(parent_p) or not parent_p.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire parent invalide ou inaccessible.")

    folder_str = payload.folder_name.strip() if payload.folder_name else ""
    if not folder_str:
        # Extract folder name from URL
        extracted = url.rstrip("/").split("/")[-1]
        if extracted.endswith(".git"):
            extracted = extracted[:-4]
        folder_str = extracted

    if not folder_str or not re.match(r"^[a-zA-Z0-9_.\-]+$", folder_str):
        folder_str = "cloned-repo"

    target_p = parent_p / folder_str
    if is_blocked_sensitive_path(target_p):
        raise HTTPException(status_code=403, detail="Chemin cible restreint.")

    if target_p.exists():
        raise HTTPException(status_code=400, detail=f"Le dossier '{folder_str}' existe déjà dans cet emplacement.")

    cmd = ["git", "clone", "--depth", "50"]
    if payload.branch and payload.branch.strip():
        cmd.extend(["--branch", payload.branch.strip()])
    cmd.extend([url, str(target_p)])

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        if proc.returncode != 0:
            err = proc.stderr.strip() or proc.stdout.strip() or "Erreur lors du clonage Git."
            # Clean up empty dir if git created it
            if target_p.exists() and not any(target_p.iterdir()):
                try:
                    target_p.rmdir()
                except Exception:
                    pass
            raise HTTPException(status_code=400, detail=f"Échec du clonage Git : {err}")

        str_target = str(target_p)
        settings = get_settings()
        raw = settings.get("trustedWorkspaces", [])
        workspaces = list(raw) if isinstance(raw, list) else []
        if str_target not in workspaces:
            workspaces.append(str_target)
            settings["trustedWorkspaces"] = workspaces
            save_settings(settings)

        clear_detector_cache()
        return {"status": "ok", "path": str_target, "name": folder_str}

    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Délai d'attente dépassé (timeout 180s) lors du clonage Git.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur inattendue lors du clonage : {e}")


class GitQuickActionPayload(BaseModel):
    workspace_path: str = Field(..., description="Workspace repository path")
    action: Literal["pull", "fetch", "status"] = Field(..., description="Git quick action")


@router.post("/git-action")
def quick_git_action(payload: GitQuickActionPayload, _ = Depends(require_auth)) -> dict[str, Any]:
    ws_str = payload.workspace_path.strip()
    try:
        p = Path(ws_str).resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Chemin invalide: {e}")

    if is_blocked_sensitive_path(p) or not p.is_dir():
        raise HTTPException(status_code=400, detail="Répertoire inaccessible.")

    if not (p / ".git").exists():
        raise HTTPException(status_code=400, detail="Ce dossier n'est pas un dépôt Git.")

    cmd_map = {
        "fetch": ["git", "fetch", "--all", "--prune"],
        "pull": ["git", "pull"],
        "status": ["git", "status", "-s"]
    }
    cmd = cmd_map.get(payload.action, ["git", "status"])

    try:
        proc = subprocess.run(cmd, cwd=str(p), capture_output=True, text=True, timeout=60)
        output = (proc.stdout + proc.stderr).strip()
        clear_detector_cache()
        return {
            "status": "ok" if proc.returncode == 0 else "error",
            "exit_code": proc.returncode,
            "output": output or "Aucune modification",
            "action": payload.action
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'exécution Git: {e}")
