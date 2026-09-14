import os
import time
import hmac
import hashlib
import json
import secrets
from pathlib import Path
from typing import Optional, Dict, Any
from app.config import GEMINI_DIR

AUTH_CONFIG_FILE = GEMINI_DIR / "webui_auth.json"

DEFAULT_SECRET = "antigravity-super-secret-webui-token-key-2026"
DEFAULT_PASSWORD = os.environ.get("WEBUI_PASSWORD", "antigravity2026")

def get_auth_config() -> Dict[str, Any]:
    if AUTH_CONFIG_FILE.exists():
        try:
            with open(AUTH_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    
    # Default config
    config = {
        "enabled": True,
        "password": DEFAULT_PASSWORD,
        "secret_key": secrets.token_hex(32)
    }
    save_auth_config(config)
    return config

def save_auth_config(config: Dict[str, Any]):
    AUTH_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(AUTH_CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

def verify_password(input_password: str) -> bool:
    config = get_auth_config()
    if not config.get("enabled", True):
        return True
    configured_pwd = config.get("password", DEFAULT_PASSWORD)
    return hmac.compare_digest(input_password.strip(), configured_pwd.strip())

def create_access_token(expires_in_days: int = 7) -> str:
    config = get_auth_config()
    secret = config.get("secret_key", DEFAULT_SECRET)
    exp = int(time.time()) + (expires_in_days * 86400)
    payload = f"antigravity_user:{exp}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"

def verify_access_token(token: Optional[str]) -> bool:
    if not token:
        return False
    config = get_auth_config()
    if not config.get("enabled", True):
        return True
    secret = config.get("secret_key", DEFAULT_SECRET)
    
    parts = token.split(":")
    if len(parts) != 3:
        return False
    
    user, exp_str, sig = parts
    try:
        exp = int(exp_str)
        if time.time() > exp:
            return False
    except ValueError:
        return False
        
    payload = f"{user}:{exp_str}"
    expected_sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(sig, expected_sig)

def update_password(new_password: str):
    config = get_auth_config()
    config["password"] = new_password.strip()
    config["secret_key"] = secrets.token_hex(32)  # Invalidate previous tokens
    save_auth_config(config)
