import os
import shutil
from pathlib import Path

HOME = Path.home()
GEMINI_DIR = Path(os.environ.get("ANTIGRAVITY_DATA_DIR", HOME / ".gemini" / "antigravity-cli"))
SETTINGS_FILE = GEMINI_DIR / "settings.json"
CONVERSATION_DB = GEMINI_DIR / "conversation_summaries.db"
BRAIN_DIR = GEMINI_DIR / "brain"
LOG_DIR = GEMINI_DIR / "log"
SESSION_METADATA_FILE = GEMINI_DIR / "session_metadata.json"

# Chemin du CLI Antigravity : variable AGY_BIN prioritaire, puis ~/.local/bin/agy,
# puis résolution dans le PATH (gère agy.exe sous Windows).
AGY_BIN = os.environ.get("AGY_BIN", str(HOME / ".local" / "bin" / "agy"))
if not Path(AGY_BIN).exists():
    resolved = shutil.which("agy")
    if resolved:
        AGY_BIN = resolved

def _detect_default_workspace() -> Path:
    env_ws = os.environ.get("ANTIGRAVITY_DEFAULT_WORKSPACE")
    if env_ws and Path(env_ws).exists():
        return Path(env_ws).resolve()

    # 1. Vérifier si le répertoire de travail actuel ou l'un de ses parents contient un dépôt Git
    cwd = Path.cwd().resolve()
    for parent in [cwd, *cwd.parents]:
        if (parent / ".git").exists():
            return parent

    # 2. Vérifier si la racine du projet antigravity-webui contient un dépôt Git
    repo_root = Path(__file__).resolve().parent.parent.parent
    if (repo_root / ".git").exists():
        return repo_root

    return HOME

# Workspace par défaut : dépôt Git parent le plus proche, racine du projet webui, ou dossier utilisateur (surchargeable via ANTIGRAVITY_DEFAULT_WORKSPACE)
DEFAULT_WORKSPACE = os.environ.get("ANTIGRAVITY_DEFAULT_WORKSPACE") or str(_detect_default_workspace())
