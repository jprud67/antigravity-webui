import os
import json
import base64
import shutil
import time
import re
import pty
import select
import subprocess
import logging
from typing import Dict, Any, List, Optional
from urllib.parse import urlparse, parse_qs
from pathlib import Path
from app.config import AGY_BIN, HOME, GEMINI_DIR

logger = logging.getLogger("antigravity.google_auth")

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


def _validate_account_file(email: str) -> Path:
    cleaned = email.strip()
    if not cleaned or "/" in cleaned or "\\" in cleaned or ".." in cleaned or "@" not in cleaned:
        raise ValueError("Adresse email invalide ou chemin suspect.")
    target_file = (ACCOUNTS_DIR / f"{cleaned}.json").resolve()
    if target_file.parent != ACCOUNTS_DIR.resolve():
        raise ValueError("Tentative de traversée de répertoire non autorisée.")
    return target_file


def switch_google_account(target_email: str) -> Dict[str, Any]:
    ensure_dirs()
    target_file = _validate_account_file(target_email)
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
    target_file = _validate_account_file(email)
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

    master_fd = None
    try:
        master_fd, slave_fd = pty.openpty()
        env = os.environ.copy()
        env["HOME"] = str(HOME)

        proc = subprocess.Popen(
            [AGY_BIN, "-p", "auth_login_init"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
            env=env,
            cwd=str(HOME)
        )
        os.close(slave_fd)

        auth_url = None
        output = ""
        start_time = time.time()

        # Read master_fd with select to catch the auth URL
        while time.time() - start_time < 12:
            r, _, _ = select.select([master_fd], [], [], 0.2)
            if master_fd in r:
                try:
                    chunk = os.read(master_fd, 4096).decode("utf-8", errors="ignore")
                except OSError:
                    break
                if not chunk:
                    break
                output += chunk
                match = re.search(r"https://accounts\.google\.com/o/oauth2/auth[^\s\r\n]+", output)
                if match:
                    auth_url = match.group(0)
                    break

        if not auth_url:
            logger.error(f"Failed to capture Google auth URL. agy output: {output!r}")
            if master_fd is not None:
                try:
                    os.close(master_fd)
                except Exception:
                    pass
            # Restore token on failure
            if stash_path.exists():
                shutil.move(stash_path, TOKEN_FILE)
            try:
                proc.kill()
            except Exception:
                pass
            raise RuntimeError("Impossible de récupérer l'URL de connexion Google depuis Antigravity.")

        _LOGIN_SESSIONS[session_id] = {
            "proc": proc,
            "master_fd": master_fd,
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
        if master_fd is not None:
            try:
                os.close(master_fd)
            except Exception:
                pass
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
        raise e


def submit_google_auth_code(session_id: str, raw_input: str) -> Dict[str, Any]:
    session = _LOGIN_SESSIONS.get(session_id)
    if not session:
        raise ValueError("Session de connexion expirée ou invalide.")

    proc: subprocess.Popen = session["proc"]
    master_fd = session.get("master_fd")
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
        if master_fd is not None:
            os.write(master_fd, f"{code}\n".encode("utf-8"))

        # Wait for agy to complete token exchange
        start_wait = time.time()
        while time.time() - start_wait < 20:
            if proc.poll() is not None:
                break
            time.sleep(0.3)

        if master_fd is not None:
            try:
                os.close(master_fd)
            except Exception:
                pass

        if not TOKEN_FILE.exists():
            # Auth failed, restore previous token
            if stash_path.exists():
                shutil.move(stash_path, TOKEN_FILE)
            raise RuntimeError("Échec de l'échange du jeton avec Google: le token n'a pas été généré.")

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
    except Exception as e:
        try:
            proc.kill()
        except Exception:
            pass
        if master_fd is not None:
            try:
                os.close(master_fd)
            except Exception:
                pass
        if stash_path.exists():
            shutil.move(stash_path, TOKEN_FILE)
        if session_id in _LOGIN_SESSIONS:
            del _LOGIN_SESSIONS[session_id]
        raise e


def cancel_google_login_flow(session_id: str) -> Dict[str, Any]:
    session = _LOGIN_SESSIONS.pop(session_id, None)
    if session:
        master_fd = session.get("master_fd")
        if master_fd is not None:
            try:
                os.close(master_fd)
            except Exception:
                pass
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


_account_exhaustion_tracker: Dict[str, float] = {}


def is_quota_error(message: str) -> bool:
    if not message:
        return False
    lower = message.lower()
    patterns = [
        "resource_exhausted",
        "code 429",
        "429",
        "quota reached",
        "quota exceeded",
        "individual quota reached",
        "exceeded your quota",
        "exhausted your capacity",
        "rate limit exceeded",
        "rate limit reached",
        "increase your limits",
        "free tier quota",
        "out of quota",
        "too many requests"
    ]
    return any(p in lower for p in patterns)


def mark_account_exhausted(email: str, duration_seconds: float = 900.0):
    """Mark an account as exhausted for a given duration (default 15 minutes)."""
    _account_exhaustion_tracker[email] = time.time() + duration_seconds
    logger.warning(f"Google account {email} marked as quota-exhausted for {duration_seconds}s")


def is_account_marked_exhausted(email: str) -> bool:
    exp = _account_exhaustion_tracker.get(email, 0.0)
    return time.time() < exp


def get_candidate_accounts(exclude_email: Optional[str] = None) -> List[str]:
    ensure_dirs()
    candidates = []
    for p in ACCOUNTS_DIR.glob("*.json"):
        email = p.stem
        if exclude_email and email.lower() == exclude_email.lower():
            continue
        candidates.append(email)

    # Sort candidates: prioritize accounts that are NOT marked exhausted
    candidates.sort(key=lambda e: (is_account_marked_exhausted(e), e))
    return candidates


def switch_to_next_healthy_account(exclude_email: Optional[str] = None, model: Optional[str] = None) -> Optional[str]:
    """
    Selects and activates the next available healthy Google account.
    Returns the email of the newly activated account, or None if no valid candidate exists.
    """
    if exclude_email:
        mark_account_exhausted(exclude_email, duration_seconds=1800.0)

    candidates = get_candidate_accounts(exclude_email=exclude_email)
    if not candidates:
        logger.warning("No candidate Google accounts available for auto-failover.")
        return None

    # Filter out accounts currently marked exhausted if any non-exhausted candidate exists
    non_exhausted = [c for c in candidates if not is_account_marked_exhausted(c)]
    target_list = non_exhausted if non_exhausted else candidates

    for target_email in target_list:
        try:
            switch_google_account(target_email)
            logger.info(f"Auto-Failover: Switched active Google account to {target_email}")
            return target_email
        except Exception as e:
            logger.error(f"Auto-Failover: Failed switching to {target_email}: {e}")
            continue

    return None

