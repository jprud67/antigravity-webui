import json
import logging
import os
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE, HOME, SETTINGS_FILE
from app.platform_utils import is_safe_path
from app.services.storage import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/rules", tags=["rules"])

HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(HOME / ".hermes")))
GLOBAL_AGENTS_FILE = HOME / "AGENTS.md"
ARCH_STATE_FILE = HERMES_HOME / "memories" / "ARCHITECTURE_STATE.md"


def _validate_workspace_path(workspace_path: str) -> Path:
    """Resolve a workspace path and confine it to the authorized working roots."""
    try:
        resolved = Path(workspace_path).resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Chemin de workspace invalide.")

    allowed_roots = [Path(DEFAULT_WORKSPACE).resolve()]
    try:
        for ws in get_settings().get("trustedWorkspaces", []) or []:
            try:
                allowed_roots.append(Path(ws).resolve())
            except Exception:
                continue
    except Exception as e:
        logger.debug(f"Ignored error: {e}")

    if not is_safe_path(resolved, allowed_roots):
        raise HTTPException(status_code=403, detail="Accès refusé : chemin en dehors des répertoires de travail autorisés.")
    return resolved

def _get_current_journal_path() -> Path:
    now = datetime.now(timezone.utc)
    month_str = now.strftime("%Y_%m")
    log_dir = HERMES_HOME / "memories" / "logs"
    return log_dir / f"server_actions_{month_str}.md"

def _resolve_file_path(file_id: str, workspace_path: str | None = None) -> Path | None:
    if file_id == "agents_global":
        return GLOBAL_AGENTS_FILE
    elif file_id == "settings_cli":
        return SETTINGS_FILE
    elif file_id == "hermes_arch":
        return ARCH_STATE_FILE
    elif file_id == "hermes_journal":
        return _get_current_journal_path()
    elif file_id == "workspace_agents" and workspace_path:
        return _validate_workspace_path(workspace_path) / "AGENTS.md"
    elif file_id == "workspace_gemini" and workspace_path:
        return _validate_workspace_path(workspace_path) / "GEMINI.md"
    return None

class SaveRuleRequest(BaseModel):
    file_id: str
    content: str
    workspace_path: str | None = None

def _safe_stat(p: Path) -> tuple[bool, int, float]:
    try:
        if p.exists():
            st = p.stat()
            return True, st.st_size, st.st_mtime
    except OSError:
        logger.debug("Ignored error")
    return False, 0, 0.0

@router.get("/files")
def list_rules_files(workspace_path: str | None = Query(None), _ = Depends(require_auth)):
    journal_path = _get_current_journal_path()
    journal_month = datetime.now(timezone.utc).strftime('%Y_%m')

    ag_exists, ag_size, ag_mtime = _safe_stat(GLOBAL_AGENTS_FILE)
    sc_exists, sc_size, sc_mtime = _safe_stat(SETTINGS_FILE)
    ha_exists, ha_size, ha_mtime = _safe_stat(ARCH_STATE_FILE)
    hj_exists, hj_size, hj_mtime = _safe_stat(journal_path)

    files = [
        {
            "id": "agents_global",
            "name": "AGENTS.md (Système Global)",
            "description": "Règles directrices globales pour Antigravity et Hermes",
            "path": str(GLOBAL_AGENTS_FILE),
            "syntax": "markdown",
            "exists": ag_exists,
            "size": ag_size,
            "last_modified": ag_mtime,
        },
        {
            "id": "settings_cli",
            "name": "settings.json (Config Antigravity)",
            "description": "Permissions système, modèles et répertoires de confiance",
            "path": str(SETTINGS_FILE),
            "syntax": "json",
            "exists": sc_exists,
            "size": sc_size,
            "last_modified": sc_mtime,
        },
        {
            "id": "hermes_arch",
            "name": "ARCHITECTURE_STATE.md (Mémoire Hermes)",
            "description": "Synthèse architecturale et état consolidé du serveur",
            "path": str(ARCH_STATE_FILE),
            "syntax": "markdown",
            "exists": ha_exists,
            "size": ha_size,
            "last_modified": ha_mtime,
        },
        {
            "id": "hermes_journal",
            "name": f"server_actions_{journal_month}.md (Journal Hermes)",
            "description": "Journal mensuel horodaté des actions et interventions serveur",
            "path": str(journal_path),
            "syntax": "markdown",
            "exists": hj_exists,
            "size": hj_size,
            "last_modified": hj_mtime,
        }
    ]


    if workspace_path:
        try:
            ws_p = _validate_workspace_path(workspace_path)
        except HTTPException:
            ws_p = None

        if ws_p is not None:
            ws_agents = ws_p / "AGENTS.md"
            ws_gemini = ws_p / "GEMINI.md"

            wa_exists, wa_size, wa_mtime = _safe_stat(ws_agents)
            wg_exists, wg_size, wg_mtime = _safe_stat(ws_gemini)

            files.append({
                "id": "workspace_agents",
                "name": f"AGENTS.md ({ws_p.name})",
                "description": f"Règles locales du workspace {workspace_path}",
                "path": str(ws_agents),
                "syntax": "markdown",
                "exists": wa_exists,
                "size": wa_size,
                "last_modified": wa_mtime,
            })

            files.append({
                "id": "workspace_gemini",
                "name": f"GEMINI.md ({ws_p.name})",
                "description": f"Instructions contextuelles du workspace {workspace_path}",
                "path": str(ws_gemini),
                "syntax": "markdown",
                "exists": wg_exists,
                "size": wg_size,
                "last_modified": wg_mtime,
            })

    return {"files": files}

@router.get("/content")
def get_rule_content(
    file_id: str = Query(...),
    workspace_path: str | None = Query(None),
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

    # Guard against modifying external Hermes system memory without explicit authorization
    if req.file_id in ("hermes_arch", "hermes_journal"):
        if os.environ.get("ENABLE_HERMES_WRITE", "0").lower() not in ("1", "true"):
            raise HTTPException(
                status_code=403,
                detail="La modification directe des mémoires Hermes est désactivée par mesure de sécurité."
            )

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
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    # Save content atomically with unique temp name to prevent concurrent write collisions
    tmp_path = target_path.parent / f".{target_path.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            f.write(req.content)
        tmp_path.replace(target_path)
    except Exception as e:
        tmp_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Erreur d'écriture: {e}")


    # Trigger Hermes IPC event only if explicitly enabled via environment variable
    if os.environ.get("ENABLE_HERMES_IPC", "0").lower() in ("1", "true"):
        try:
            events_dir = HERMES_HOME / "events"
            if events_dir.is_dir():
                (events_dir / "antigravity_update.trigger").touch()
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    return {
        "success": True,
        "message": f"Fichier {target_path.name} sauvegardé avec succès",
        "path": str(target_path),
        "size": target_path.stat().st_size
    }
