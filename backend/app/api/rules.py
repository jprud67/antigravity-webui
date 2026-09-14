import os
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from app.api.auth import require_auth

router = APIRouter(prefix="/api/rules", tags=["rules"])

HERMES_HOME = Path(os.environ.get("HERMES_HOME", "/root/.hermes"))
SETTINGS_FILE = Path("/root/.gemini/antigravity-cli/settings.json")
GLOBAL_AGENTS_FILE = Path("/root/AGENTS.md")
ARCH_STATE_FILE = HERMES_HOME / "memories" / "ARCHITECTURE_STATE.md"

def _get_current_journal_path() -> Path:
    now = datetime.now()
    month_str = now.strftime("%Y_%m")
    log_dir = HERMES_HOME / "memories" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    return log_dir / f"server_actions_{month_str}.md"

def _resolve_file_path(file_id: str, workspace_path: Optional[str] = None) -> Optional[Path]:
    if file_id == "agents_global":
        return GLOBAL_AGENTS_FILE
    elif file_id == "settings_cli":
        return SETTINGS_FILE
    elif file_id == "hermes_arch":
        return ARCH_STATE_FILE
    elif file_id == "hermes_journal":
        return _get_current_journal_path()
    elif file_id == "workspace_agents" and workspace_path:
        return Path(workspace_path) / "AGENTS.md"
    elif file_id == "workspace_gemini" and workspace_path:
        return Path(workspace_path) / "GEMINI.md"
    return None

class SaveRuleRequest(BaseModel):
    file_id: str
    content: str
    workspace_path: Optional[str] = None

@router.get("/files")
def list_rules_files(workspace_path: Optional[str] = Query(None), _ = Depends(require_auth)):
    files = [
        {
            "id": "agents_global",
            "name": "AGENTS.md (Système Global)",
            "description": "Règles directrices globales pour Antigravity et Hermes",
            "path": str(GLOBAL_AGENTS_FILE),
            "syntax": "markdown",
            "exists": GLOBAL_AGENTS_FILE.exists(),
            "size": GLOBAL_AGENTS_FILE.stat().st_size if GLOBAL_AGENTS_FILE.exists() else 0,
            "last_modified": GLOBAL_AGENTS_FILE.stat().st_mtime if GLOBAL_AGENTS_FILE.exists() else 0,
        },
        {
            "id": "settings_cli",
            "name": "settings.json (Config Antigravity)",
            "description": "Permissions système, modèles et répertoires de confiance",
            "path": str(SETTINGS_FILE),
            "syntax": "json",
            "exists": SETTINGS_FILE.exists(),
            "size": SETTINGS_FILE.stat().st_size if SETTINGS_FILE.exists() else 0,
            "last_modified": SETTINGS_FILE.stat().st_mtime if SETTINGS_FILE.exists() else 0,
        },
        {
            "id": "hermes_arch",
            "name": "ARCHITECTURE_STATE.md (Mémoire Hermes)",
            "description": "Synthèse architecturale et état consolidé du serveur",
            "path": str(ARCH_STATE_FILE),
            "syntax": "markdown",
            "exists": ARCH_STATE_FILE.exists(),
            "size": ARCH_STATE_FILE.stat().st_size if ARCH_STATE_FILE.exists() else 0,
            "last_modified": ARCH_STATE_FILE.stat().st_mtime if ARCH_STATE_FILE.exists() else 0,
        },
        {
            "id": "hermes_journal",
            "name": f"server_actions_{datetime.now().strftime('%Y_%m')}.md (Journal Hermes)",
            "description": "Journal mensuel horodaté des actions et interventions serveur",
            "path": str(_get_current_journal_path()),
            "syntax": "markdown",
            "exists": _get_current_journal_path().exists(),
            "size": _get_current_journal_path().stat().st_size if _get_current_journal_path().exists() else 0,
            "last_modified": _get_current_journal_path().stat().st_mtime if _get_current_journal_path().exists() else 0,
        }
    ]

    if workspace_path:
        ws_p = Path(workspace_path)
        ws_agents = ws_p / "AGENTS.md"
        ws_gemini = ws_p / "GEMINI.md"

        files.append({
            "id": "workspace_agents",
            "name": f"AGENTS.md ({ws_p.name})",
            "description": f"Règles locales du workspace {workspace_path}",
            "path": str(ws_agents),
            "syntax": "markdown",
            "exists": ws_agents.exists(),
            "size": ws_agents.stat().st_size if ws_agents.exists() else 0,
            "last_modified": ws_agents.stat().st_mtime if ws_agents.exists() else 0,
        })

        files.append({
            "id": "workspace_gemini",
            "name": f"GEMINI.md ({ws_p.name})",
            "description": f"Instructions contextuelles du workspace {workspace_path}",
            "path": str(ws_gemini),
            "syntax": "markdown",
            "exists": ws_gemini.exists(),
            "size": ws_gemini.stat().st_size if ws_gemini.exists() else 0,
            "last_modified": ws_gemini.stat().st_mtime if ws_gemini.exists() else 0,
        })

    return {"files": files}

@router.get("/content")
def get_rule_content(
    file_id: str = Query(...),
    workspace_path: Optional[str] = Query(None),
    _ = Depends(require_auth)
):
    target_path = _resolve_file_path(file_id, workspace_path)
    if not target_path:
        raise HTTPException(status_code=400, detail="Identifiant de fichier inconnu")

    if not target_path.exists():
        return {
            "file_id": file_id,
            "path": str(target_path),
            "content": "",
            "exists": False,
            "syntax": "json" if target_path.suffix == ".json" else "markdown"
        }

    try:
        with open(target_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
        return {
            "file_id": file_id,
            "path": str(target_path),
            "content": content,
            "exists": True,
            "syntax": "json" if target_path.suffix == ".json" else "markdown",
            "size": target_path.stat().st_size,
            "last_modified": target_path.stat().st_mtime
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lors de la lecture du fichier: {e}")

@router.put("/content")
def save_rule_content(req: SaveRuleRequest, _ = Depends(require_auth)):
    target_path = _resolve_file_path(req.file_id, req.workspace_path)
    if not target_path:
        raise HTTPException(status_code=400, detail="Identifiant de fichier inconnu")

    # If JSON, validate syntax before saving
    if target_path.suffix == ".json":
        try:
            json.loads(req.content)
        except json.JSONDecodeError as jde:
            raise HTTPException(status_code=400, detail=f"Erreur de syntaxe JSON: {jde}")

    target_path.parent.mkdir(parents=True, exist_ok=True)

    # Create backup if file exists
    if target_path.exists():
        try:
            backup_path = target_path.with_suffix(target_path.suffix + ".bak")
            shutil.copy2(target_path, backup_path)
        except Exception:
            pass

    # Save content atomically
    tmp_path = target_path.with_suffix(target_path.suffix + ".tmp")
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(req.content)
        tmp_path.replace(target_path)
    except Exception as e:
        if tmp_path.exists():
            tmp_path.unlink()
        raise HTTPException(status_code=500, detail=f"Erreur d'écriture: {e}")

    # Trigger Hermes IPC event
    try:
        events_dir = HERMES_HOME / "events"
        events_dir.mkdir(parents=True, exist_ok=True)
        (events_dir / "antigravity_update.trigger").touch()
    except Exception:
        pass

    return {
        "success": True,
        "message": f"Fichier {target_path.name} sauvegardé avec succès",
        "path": str(target_path),
        "size": target_path.stat().st_size
    }
