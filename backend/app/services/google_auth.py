import os
import json
import base64
import shutil
import time
import re
import asyncio
import subprocess
import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from app.config import AGY_BIN

logger = logging.getLogger("antigravity.google_auth")

GEMINI_DIR = Path("/root/.gemini/antigravity-cli")
TOKEN_FILE = GEMINI_DIR / "antigravity-oauth-token"
ACCOUNTS_DIR = GEMINI_DIR / "accounts"

# Active login sessions: session_id -> { "proc": subprocess.Popen, "started_at": float, "stash_path": str }
_LOGIN_SESSIONS: Dict[str, Dict[str, Any]] = {}


def ensure_dirs():
    GEMINI_DIR.mkdir(parents=True, exist_ok=True)
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)


def parse_jwt_claims(jwt_str: str) -> Dict[str, Any]:
    try:
        if not jwt_str or "." not in jwt_str:
            return {}
        payload = jwt_str.split(".")[1]
        payload += "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        return json.loads(decoded.decode("utf-8"))
    except Exception as e:
        logger.warning(f"Failed to parse JWT: {e}")
        return {}


def get_account_meta_from_token_data(data: Dict[str, Any]) -> Dict[str, Any]:
    jwt_str = data.get("id_token")
    claims = parse_jwt_claims(jwt_str) if jwt_str else {}
    
    email = claims.get("email") or "compte-inconnu@google.com"
    email_verified = claims.get("email_verified", False)
    sub = claims.get("sub", "")
    
    token_obj = data.get("token", {})
    expiry_str = token_obj.get("expiry") if isinstance(token_obj, dict) else None
    auth_method = data.get("auth_method", "oauth2")

    return {
        "email": email,
        "email_verified": email_verified,
        "sub": sub,
        "expiry": expiry_str,
        "auth_method": auth_method,
        "claims": claims
    }


def sync_active_account_to_store():
    ensure_dirs()
    if not TOKEN_FILE.exists():
        return
    try:
        with open(TOKEN_FILE, "r") as f:
            data = json.load(f)
        meta = get_account_meta_from_token_data(data)
        email = meta.get("email")
        if email and "@" in email:
            dest = ACCOUNTS_DIR / f"{email}.json"
            with open(dest, "w") as f:
                json.dump(data, f, indent=2)
    except Exception as e:
        logger.error(f"Error syncing active account: {e}")


def get_active_account() -> Optional[Dict[str, Any]]:
    ensure_dirs()
    if not TOKEN_FILE.exists():
        return None
    try:
        with open(TOKEN_FILE, "r") as f:
            data = json.load(f)
        meta = get_account_meta_from_token_data(data)
        meta["is_active"] = True
        return meta
    except Exception as e:
        logger.error(f"Failed to read active account: {e}")
        return None


def list_google_accounts() -> Dict[str, Any]:
    ensure_dirs()
    sync_active_account_to_store()
    active_meta = get_active_account()
    active_email = active_meta.get("email") if active_meta else None

    accounts = []
    for p in ACCOUNTS_DIR.glob("*.json"):
        try:
            with open(p, "r") as f:
                data = json.load(f)
            meta = get_account_meta_from_token_data(data)
            meta["is_active"] = (meta.get("email") == active_email)
            meta["file_name"] = p.name
            meta["last_modified"] = p.stat().st_mtime
            accounts.append(meta)
        except Exception as e:
            logger.warning(f"Error reading account file {p}: {e}")

    # Sort so active is first, then alphabetical
    accounts.sort(key=lambda x: (not x.get("is_active", False), x.get("email", "")))

    return {
        "active_account": active_meta,
        "accounts": accounts,
        "total": len(accounts)
    }


def switch_google_account(target_email: str) -> Dict[str, Any]:
    ensure_dirs()
    target_file = ACCOUNTS_DIR / f"{target_email}.json"
    if not target_file.exists():
        raise FileNotFoundError(f"Le compte {target_email} n'est pas enregistré.")

    # Backup current token if exists
    if TOKEN_FILE.exists():
        shutil.copy2(TOKEN_FILE, GEMINI_DIR / "antigravity-oauth-token.bak")

    # Copy target account to active
    shutil.copy2(target_file, TOKEN_FILE)
    os.chmod(TOKEN_FILE, 0o600)

    active_meta = get_active_account()
    logger.info(f"Switched Google account to {target_email}")
    return {
        "success": True,
        "active_account": active_meta,
        "message": f"Compte Google basculé sur {target_email}"
    }


def delete_google_account(email: str) -> Dict[str, Any]:
    ensure_dirs()
    target_file = ACCOUNTS_DIR / f"{email}.json"
    if not target_file.exists():
        raise FileNotFoundError(f"Le compte {email} est introuvable.")

    active_meta = get_active_account()
    if active_meta and active_meta.get("email") == email:
        raise ValueError("Impossible de supprimer le compte Google actuellement actif. Veuillez d'abord basculer sur un autre compte.")

    target_file.unlink(missing_ok=True)
    logger.info(f"Deleted saved Google account {email}")
    return {"success": True, "message": f"Compte {email} supprimé"}


def start_google_login_flow() -> Dict[str, Any]:
    ensure_dirs()
    cleanup_stale_sessions()

    session_id = f"gauth_{int(time.time())}_{os.urandom(4).hex()}"
    stash_path = GEMINI_DIR / f"antigravity-oauth-token.stash_{session_id}"

    # Stash current token temporarily so agy is forced to initiate OAuth
    if TOKEN_FILE.exists():
        shutil.move(TOKEN_FILE, stash_path)

    try:
        proc = subprocess.Popen(
            [AGY_BIN, "-p", "auth_login_init"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1
        )

        auth_url = None
        start_time = time.time()

        # Read stderr to catch the auth URL
        while time.time() - start_time < 10:
            line = proc.stderr.readline()
            if not line:
                break
            if "https://accounts.google.com/o/oauth2/auth" in line:
                auth_url = line.strip()
                break

        if not auth_url:
            # Restore token on failure
            if stash_path.exists():
                shutil.move(stash_path, TOKEN_FILE)
            proc.kill()
            raise RuntimeError("Impossible de récupérer l'URL de connexion Google depuis Antigravity.")

        _LOGIN_SESSIONS[session_id] = {
            "proc": proc,
            "started_at": time.time(),
            "stash_path": str(stash_path),
            "auth_url": auth_url
        }

        return {
            "session_id": session_id,
            "auth_url": auth_url,
            "instructions": "Ouvrez l'URL dans votre navigateur, connectez-vous avec votre compte Google, puis copiez-collez le code d'autorisation obtenu.",
            "timeout_seconds": 180
        }
    except Exception as e:
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
        raise e


def submit_google_auth_code(session_id: str, raw_input: str) -> Dict[str, Any]:
    session = _LOGIN_SESSIONS.get(session_id)
    if not session:
        raise ValueError("Session de connexion expirée ou invalide.")

    proc: subprocess.Popen = session["proc"]
    stash_path = Path(session["stash_path"])

    code = raw_input.strip()
    # If the user pasted the entire redirect URL e.g. https://antigravity.google/oauth-callback?code=...
    if "code=" in code:
        try:
            parsed = urlparse(code)
            params = parse_qs(parsed.query)
            if "code" in params and params["code"]:
                code = params["code"][0]
        except Exception:
            pass

    if not code:
        raise ValueError("Code d'autorisation vide.")

    try:
        proc.stdin.write(f"{code}\n")
        proc.stdin.flush()

        # Wait for agy to complete token exchange
        stdout, stderr = proc.communicate(timeout=15)
        logger.info(f"agy auth response: {stdout} {stderr}")

        if not TOKEN_FILE.exists():
            # Auth failed, restore previous token
            if stash_path.exists():
                shutil.move(stash_path, TOKEN_FILE)
            raise RuntimeError(f"Échec de l'échange du jeton avec Google: {stderr or stdout}")

        # Auth succeeded! Clean up stash
        if stash_path.exists():
            stash_path.unlink(missing_ok=True)

        os.chmod(TOKEN_FILE, 0o600)
        sync_active_account_to_store()
        active_meta = get_active_account()

        del _LOGIN_SESSIONS[session_id]

        return {
            "success": True,
            "active_account": active_meta,
            "message": f"Nouveau compte Google connecté avec succès : {active_meta.get('email')}"
        }
    except subprocess.TimeoutExpired:
        proc.kill()
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
        if session_id in _LOGIN_SESSIONS:
            del _LOGIN_SESSIONS[session_id]
        raise TimeoutError("Le délai d'attente d'authentification a expiré.")
    except Exception as e:
        proc.kill()
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
        if session_id in _LOGIN_SESSIONS:
            del _LOGIN_SESSIONS[session_id]
        raise e


def cancel_google_login_flow(session_id: str) -> Dict[str, Any]:
    session = _LOGIN_SESSIONS.pop(session_id, None)
    if session:
        try:
            session["proc"].kill()
        except Exception:
            pass
        stash_path = Path(session["stash_path"])
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
    return {"success": True, "message": "Session annulée"}


def cleanup_stale_sessions():
    now = time.time()
    stale_ids = []
    for sid, sess in _LOGIN_SESSIONS.items():
        if now - sess["started_at"] > 300:  # 5 minutes
            stale_ids.append(sid)
    for sid in stale_ids:
        cancel_google_login_flow(sid)


def import_raw_token(token_data: Dict[str, Any]) -> Dict[str, Any]:
    ensure_dirs()
    meta = get_account_meta_from_token_data(token_data)
    email = meta.get("email")
    if not email or "@" not in email:
        raise ValueError("Données de jeton invalides : adresse email introuvable.")

    account_file = ACCOUNTS_DIR / f"{email}.json"
    with open(account_file, "w") as f:
        json.dump(token_data, f, indent=2)

    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)
    os.chmod(TOKEN_FILE, 0o600)

    return {
        "success": True,
        "active_account": get_active_account(),
        "message": f"Compte {email} importé et activé avec succès."
    }
