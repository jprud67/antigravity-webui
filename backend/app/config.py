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

# Workspace par défaut : dossier utilisateur (surchargeable via ANTIGRAVITY_DEFAULT_WORKSPACE)
DEFAULT_WORKSPACE = os.environ.get("ANTIGRAVITY_DEFAULT_WORKSPACE") or str(HOME)
