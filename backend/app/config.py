import os
from pathlib import Path
from pydantic import BaseModel

HOME = Path.home()
GEMINI_DIR = Path(os.environ.get("ANTIGRAVITY_DATA_DIR", HOME / ".gemini" / "antigravity-cli"))
SETTINGS_FILE = GEMINI_DIR / "settings.json"
CONVERSATION_DB = GEMINI_DIR / "conversation_summaries.db"
BRAIN_DIR = GEMINI_DIR / "brain"
LOG_DIR = GEMINI_DIR / "log"

AGY_BIN = os.environ.get("AGY_BIN", "/root/.local/bin/agy")
if not Path(AGY_BIN).exists():
    import shutil
    resolved = shutil.which("agy")
    if resolved:
        AGY_BIN = resolved

DEFAULT_WORKSPACE = "/root"
