import os
import time
import hmac
import hashlib
import json
import secrets
from typing import Optional, Dict, Any
from app.config import GEMINI_DIR

AUTH_CONFIG_FILE = GEMINI_DIR / "webui_auth.json"

DEFAULT_SECRET = "antigravity-super-secret-webui-token-key-2026"
DEFAULT_PASSWORD = os.environ.get("WEBUI_PASSWORD", "antigravity2026")

def hash_password(password: str, salt: Optional[str] = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"

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
        "password": hash_password(DEFAULT_PASSWORD),
        "secret_key": secrets.token_hex(32)
    }
    save_auth_config(config)
    return config

def save_auth_config(config: Dict[str, Any]):
    AUTH_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp_file = AUTH_CONFIG_FILE.with_suffix(".tmp")
    with open(temp_file, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)
    temp_file.replace(AUTH_CONFIG_FILE)
    try:
        os.chmod(AUTH_CONFIG_FILE, 0o600)
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
        except Exception:
            pass
    return matched

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
    config["password"] = hash_password(new_password.strip())
    config["secret_key"] = secrets.token_hex(32)  # Invalidate previous tokens
    save_auth_config(config)
