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

<<<<<<< HEAD
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
=======
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Workspace par défaut : répertoire de travail actuel s'il contient un dépôt Git, sinon racine du projet, sinon dossier utilisateur (surchargeable via ANTIGRAVITY_DEFAULT_WORKSPACE)
DEFAULT_WORKSPACE = (
    os.environ.get("ANTIGRAVITY_DEFAULT_WORKSPACE")
    or (str(Path.cwd()) if (Path.cwd() / ".git").exists() else (str(REPO_ROOT) if (REPO_ROOT / ".git").exists() else str(HOME)))
)

>>>>>>> 43c60e5 (fix(core): hermetic test isolation, git query normalization and safe file replacement)
