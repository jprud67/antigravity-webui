import hashlib
import hmac
import json
import logging
import os
import secrets
import shutil
import threading
import time
import uuid
from typing import Any

from app.config import GEMINI_DIR
from app.platform_utils import restrict_file_permissions

logger = logging.getLogger("antigravity.auth")

AUTH_CONFIG_FILE = GEMINI_DIR / "webui_auth.json"

DEFAULT_SECRET = "antigravity-super-secret-webui-token-key-2026"
DEFAULT_PASSWORD = os.environ.get("WEBUI_PASSWORD") or "antigravity2026"

def hash_password(password: str, salt: str | None = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2_sha256${salt}${key.hex()}"

_auth_lock = threading.RLock()
_auth_cache: dict[str, Any] | None = None
_auth_cache_mtime: float = 0.0

def get_auth_config() -> dict[str, Any]:
    global _auth_cache, _auth_cache_mtime
    with _auth_lock:
        try:
            if AUTH_CONFIG_FILE.exists():
                stat = AUTH_CONFIG_FILE.stat()
                if _auth_cache is not None and stat.st_mtime == _auth_cache_mtime:
                    return _auth_cache.copy()
                with open(AUTH_CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    _auth_cache = data
                    _auth_cache_mtime = stat.st_mtime
                    return data.copy()
        except Exception as e:
            logger.warning(f"Configuration d'authentification illisible — régénération : {e}")
            if AUTH_CONFIG_FILE.exists():
                try:
                    corrupt_bak = AUTH_CONFIG_FILE.parent / f"{AUTH_CONFIG_FILE.name}.corrupt.bak"
                    shutil.copy2(AUTH_CONFIG_FILE, corrupt_bak)
                    restrict_file_permissions(corrupt_bak)
                    logger.warning(f"Sauvegarde du fichier corrompu créée: {corrupt_bak}")
                except Exception as bak_err:
                    logger.debug(f"Impossible de sauvegarder le fichier auth corrompu: {bak_err}")

        # Default config
        config = {
            "enabled": True,
            "password": hash_password(DEFAULT_PASSWORD),
            "secret_key": secrets.token_hex(32)
        }
        save_auth_config(config)
        return config.copy()

def save_auth_config(config: dict[str, Any]):
    global _auth_cache, _auth_cache_mtime
    with _auth_lock:
        AUTH_CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
        temp_file = AUTH_CONFIG_FILE.parent / f".{AUTH_CONFIG_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
        try:
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(config, f, indent=2)
            restrict_file_permissions(temp_file)
            temp_file.replace(AUTH_CONFIG_FILE)
            restrict_file_permissions(AUTH_CONFIG_FILE)
            _auth_cache = config.copy()
            _auth_cache_mtime = AUTH_CONFIG_FILE.stat().st_mtime
        except Exception:
            if temp_file.exists():
                try:
                    temp_file.unlink()
                except Exception as e:
                    logger.debug(f"Ignored error: {e}")
            raise


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
    token = token.strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
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
    if user != "antigravity_user":
        return False
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
    if not new_password or len(new_password.strip()) < 8:
        raise ValueError("Le nouveau mot de passe doit comporter au moins 8 caractères.")
    config = get_auth_config()
    config["password"] = hash_password(new_password.strip())
    config["secret_key"] = secrets.token_hex(32)  # Invalidate previous tokens
    save_auth_config(config)


# ============================================================================
# API Key Management for External Applications (OpenAI / Agent SDKs / Scripts)
# ============================================================================

ENV_API_KEY = os.environ.get("ANTIGRAVITY_API_KEY", "").strip()


def _ensure_api_keys_storage(config: dict[str, Any]) -> list[dict[str, Any]]:
    """Garantit la présence d'au moins une clé d'API par défaut lors de la configuration initiale."""
    if "api_keys" not in config or not isinstance(config.get("api_keys"), list):
        default_key = f"agy_sk_{secrets.token_hex(24)}"
        config["api_keys"] = [{
            "id": "master-default",
            "name": "Clé Maîtresse Principale",
            "key": default_key,
            "created_at": int(time.time()),
            "last_used_at": None,
        }]
        save_auth_config(config)
    return config["api_keys"]


def get_api_keys() -> list[dict[str, Any]]:
    """Retourne la liste des clés d'API configurées pour les apps externes."""
    config = get_auth_config()
    keys = _ensure_api_keys_storage(config)
    result = []
    for k in keys:
        raw_key = k.get("key", "")
        # Masquage partiel pour l'affichage public
        masked = f"{raw_key[:10]}...{raw_key[-4:]}" if len(raw_key) > 14 else raw_key
        result.append({
            "id": k.get("id"),
            "name": k.get("name", "Sans nom"),
            "masked_key": masked,
            "key": raw_key,  # Disponible pour affichage/copie dans la WebUI
            "created_at": k.get("created_at"),
            "last_used_at": k.get("last_used_at"),
        })
    return result


def create_api_key(name: str = "Application Externe") -> dict[str, Any]:
    """Génère une nouvelle clé d'API sécurisée pour une application externe."""
    config = get_auth_config()
    keys = _ensure_api_keys_storage(config)
    new_id = f"key_{uuid.uuid4().hex[:8]}"
    raw_key = f"agy_sk_{secrets.token_hex(24)}"
    now = int(time.time())
    new_entry = {
        "id": new_id,
        "name": name.strip() or "Application Externe",
        "key": raw_key,
        "created_at": now,
        "last_used_at": None,
    }
    keys.append(new_entry)
    config["api_keys"] = keys
    save_auth_config(config)
    return {
        "id": new_id,
        "name": new_entry["name"],
        "key": raw_key,
        "created_at": now,
    }


def delete_api_key(key_id: str) -> bool:
    """Supprime une clé d'API par son identifiant."""
    config = get_auth_config()
    keys = _ensure_api_keys_storage(config)
    initial_count = len(keys)
    keys = [k for k in keys if k.get("id") != key_id]
    if len(keys) < initial_count:
        config["api_keys"] = keys
        save_auth_config(config)
        return True
    return False


def verify_api_key(key: str | None) -> bool:
    """
    Vérifie si la clé passée correspond à l'environnement ANTIGRAVITY_API_KEY
    ou à une des clés enregistrées dans auth_config.
    """
    if not key:
        return False
    key = key.strip()
    if key.lower().startswith("bearer "):
        key = key[7:].strip()
    if not key:
        return False

    # 1. Vérification avec variable d'environnement maîtresse
    env_api_key = os.environ.get("ANTIGRAVITY_API_KEY", "").strip() or ENV_API_KEY
    if env_api_key and hmac.compare_digest(key, env_api_key):
        return True

    # 2. Vérification dans le fichier de configuration auth
    config = get_auth_config()
    keys = _ensure_api_keys_storage(config)
    for k in keys:
        stored = k.get("key", "")
        if stored and hmac.compare_digest(key, stored):
            now = int(time.time())
            last_used = k.get("last_used_at") or 0
            # Mettre à jour last_used_at et persister si plus de 60 secondes se sont écoulées
            if now - last_used > 60:
                k["last_used_at"] = now
                try:
                    save_auth_config(config)
                except Exception as e:
                    logger.debug(f"Impossible de sauvegarder last_used_at: {e}")
            else:
                k["last_used_at"] = now
            return True

    return False


def verify_token_or_api_key(token_or_key: str | None) -> bool:
    """Valide soit un token de session WebUI, soit une clé d'API externe."""
    if not token_or_key:
        return False
    return verify_api_key(token_or_key) or verify_access_token(token_or_key)

