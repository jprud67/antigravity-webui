import hashlib
import hmac
import json
import logging
import os
import secrets
import time
import uuid
from typing import Any

from app.config import GEMINI_DIR
from app.platform_utils import restrict_file_permissions

logger = logging.getLogger("antigravity.auth")

AUTH_CONFIG_FILE = GEMINI_DIR / "webui_auth.json"

DEFAULT_SECRET = "antigravity-super-secret-webui-token-key-2026"
DEFAULT_PASSWORD = os.environ.get("WEBUI_PASSWORD", "antigravity2026")

def hash_password(password: str, salt: str | None = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"

def get_auth_config() -> dict[str, Any]:
    if AUTH_CONFIG_FILE.exists():
        try:
            with open(AUTH_CONFIG_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"Configuration d'authentification illisible — régénération : {e}")
    
    # Default config
    config = {
        "enabled": True,
        "password": hash_password(DEFAULT_PASSWORD),
        "secret_key": secrets.token_hex(32)
    }
    save_auth_config(config)
    return config

def save_auth_config(config: dict[str, Any]):
    AUTH_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = AUTH_CONFIG_FILE.parent / f".{AUTH_CONFIG_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2)
        restrict_file_permissions(temp_file)
        temp_file.replace(AUTH_CONFIG_FILE)
        restrict_file_permissions(AUTH_CONFIG_FILE)
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink()
            except Exception:
                pass

def verify_password(input_password: str) -> bool:
    config = get_auth_config()
    if not config.get("enabled", True):
        return True
    configured_pwd = config.get("password", DEFAULT_PASSWORD)
    if configured_pwd.startswith("pbkdf2_sha256$"):
        parts = configured_pwd.split("$")
        if len(parts) == 3:
            salt = parts[1]
            computed = hash_password(input_password.strip(), salt)
            return hmac.compare_digest(computed, configured_pwd)
    
    # Fallback to direct comparison for legacy plaintext
    matched = hmac.compare_digest(input_password.strip(), configured_pwd.strip())
    if matched:
        # Auto-upgrade stored plaintext to secure PBKDF2 hash
        try:
            config["password"] = hash_password(input_password.strip())
            save_auth_config(config)
        except Exception as e:
            logger.debug(f"Mise à niveau du hash du mot de passe impossible : {e}")
    return matched

def create_access_token(expires_in_days: int = 7) -> str:
    config = get_auth_config()
    secret = config.get("secret_key", DEFAULT_SECRET)
    exp = int(time.time()) + (expires_in_days * 86400)
    payload = f"antigravity_user:{exp}"
    sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    return f"{payload}:{sig}"

def verify_access_token(token: str | None) -> bool:
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
    payload = f"{user}:{exp_str}"
    expected_sig = hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        return False

    try:
        exp = int(exp_str)
        if time.time() > exp:
            return False
    except ValueError:
        return False

    return True

def update_password(new_password: str):
    config = get_auth_config()
    config["password"] = hash_password(new_password.strip())
    config["secret_key"] = secrets.token_hex(32)  # Invalidate previous tokens
    save_auth_config(config)
