import base64
import json
import logging
import os
import re
import select
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

try:
    import pty
    HAS_PTY = True
except ImportError:  # Windows : pty absent
    HAS_PTY = False

try:
    import winpty  # type: ignore[import-not-found]  # paquet « pywinpty » (Windows uniquement)
    HAS_WINPTY = True
except ImportError:
    HAS_WINPTY = False

from app.config import AGY_BIN, GEMINI_DIR, HOME
from app.platform_utils import IS_WINDOWS, restrict_file_permissions

logger = logging.getLogger("antigravity.google_auth")

if IS_WINDOWS:
    import ctypes
    from ctypes import wintypes

    CRED_TYPE_GENERIC = 1
    CRED_PERSIST_LOCAL_MACHINE = 2

    class _WIN_CREDENTIAL_WRITE(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.c_char_p),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    class _WIN_CREDENTIAL_READ(ctypes.Structure):
        _fields_ = [
            ("Flags", wintypes.DWORD),
            ("Type", wintypes.DWORD),
            ("TargetName", wintypes.LPWSTR),
            ("Comment", wintypes.LPWSTR),
            ("LastWritten", wintypes.FILETIME),
            ("CredentialBlobSize", wintypes.DWORD),
            ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
            ("Persist", wintypes.DWORD),
            ("AttributeCount", wintypes.DWORD),
            ("Attributes", ctypes.c_void_p),
            ("TargetAlias", wintypes.LPWSTR),
            ("UserName", wintypes.LPWSTR),
        ]

    _advapi32: Any = ctypes.WinDLL("Advapi32.dll")  # type: ignore[attr-defined]
    _CredReadW = _advapi32.CredReadW
    _CredReadW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.POINTER(ctypes.POINTER(_WIN_CREDENTIAL_READ))]
    _CredReadW.restype = wintypes.BOOL

    _CredWriteW = _advapi32.CredWriteW
    _CredWriteW.argtypes = [ctypes.POINTER(_WIN_CREDENTIAL_WRITE), wintypes.DWORD]
    _CredWriteW.restype = wintypes.BOOL

    _CredDeleteW = _advapi32.CredDeleteW
    _CredDeleteW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD]
    _CredDeleteW.restype = wintypes.BOOL

    _CredFree = _advapi32.CredFree
    _CredFree.argtypes = [ctypes.c_void_p]


def _read_windows_keyring_token() -> dict[str, Any] | None:
    if not IS_WINDOWS:
        return None
    try:
        pcred = ctypes.POINTER(_WIN_CREDENTIAL_READ)()
        if _CredReadW("gemini:antigravity", CRED_TYPE_GENERIC, 0, ctypes.byref(pcred)):
            cred = pcred.contents
            blob = bytes(cred.CredentialBlob[:cred.CredentialBlobSize])
            _CredFree(pcred)
            return json.loads(blob.decode("utf-8"))
    except Exception as e:
        logger.debug(f"Failed to read from Windows keyring: {e}")
    return None


def _write_windows_keyring_token(token_data: dict[str, Any]) -> bool:
    if not IS_WINDOWS:
        return False
    try:
        raw_bytes = json.dumps(token_data).encode("utf-8")
        c = _WIN_CREDENTIAL_WRITE()
        c.Flags = 0
        c.Type = CRED_TYPE_GENERIC
        c.TargetName = "gemini:antigravity"
        c.Comment = None
        c.CredentialBlobSize = len(raw_bytes)
        c.CredentialBlob = raw_bytes
        c.Persist = CRED_PERSIST_LOCAL_MACHINE
        c.AttributeCount = 0
        c.Attributes = None
        c.TargetAlias = None
        c.UserName = "antigravity"
        return bool(_CredWriteW(ctypes.byref(c), 0))
    except Exception as e:
        logger.warning(f"Failed to write to Windows keyring: {e}")
        return False


def _delete_windows_keyring_token() -> bool:
    if not IS_WINDOWS:
        return False
    try:
        return bool(_CredDeleteW("gemini:antigravity", CRED_TYPE_GENERIC, 0))
    except Exception as e:
        logger.debug(f"Failed to delete Windows keyring token: {e}")
        return False


TOKEN_FILE = GEMINI_DIR / "antigravity-oauth-token"
ACCOUNTS_DIR = GEMINI_DIR / "accounts"

# Active login sessions: session_id -> { "proc": subprocess.Popen, "started_at": float, "stash_path": str }
_LOGIN_SESSIONS: dict[str, dict[str, Any]] = {}
_login_lock = threading.Lock()

_account_exhaustion_tracker: dict[str, float] = {}
_exhaustion_lock = threading.Lock()
_QUOTA_429_RE = re.compile(r"(?:code|status|http|error)[\s:=]+429\b|\b429\s+(?:too many|rate|quota|error)\b")


def clear_account_exhaustion(email: str | None) -> None:
    if not email or not isinstance(email, str):
        return
    norm_email = email.strip().lower()
    if not norm_email:
        return
    with _exhaustion_lock:
        _account_exhaustion_tracker.pop(norm_email, None)


def ensure_dirs():
    GEMINI_DIR.mkdir(parents=True, exist_ok=True)
    ACCOUNTS_DIR.mkdir(parents=True, exist_ok=True)


def parse_jwt_claims(jwt_str: str) -> dict[str, Any]:
    try:
        if not jwt_str or not isinstance(jwt_str, str) or "." not in jwt_str:
            return {}
        parts = jwt_str.split(".")
        if len(parts) < 2:
            return {}
        payload = parts[1]
        payload += "=" * (-len(payload) % 4)
        decoded = base64.urlsafe_b64decode(payload.encode("utf-8"))
        return json.loads(decoded.decode("utf-8"))
    except Exception as e:
        logger.warning(f"Failed to parse JWT: {e}")
        return {}


def get_account_meta_from_token_data(data: dict[str, Any]) -> dict[str, Any]:
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
    # Si le fichier token n'existe pas, tente de le récupérer depuis le Credential Manager Windows
    if not TOKEN_FILE.exists() and IS_WINDOWS:
        keyring_data = _read_windows_keyring_token()
        if keyring_data and isinstance(keyring_data, dict):
            try:
                temp = TOKEN_FILE.parent / f".{TOKEN_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
                with open(temp, "w", encoding="utf-8") as f:
                    json.dump(keyring_data, f, indent=2)
                restrict_file_permissions(temp)
                temp.replace(TOKEN_FILE)
                restrict_file_permissions(TOKEN_FILE)
                logger.info("Synchronisé le token Google depuis le gestionnaire d'identifiants Windows (gemini:antigravity).")
            except Exception as e:
                logger.warning(f"Failed to sync Windows keyring token to {TOKEN_FILE}: {e}")

    if not TOKEN_FILE.exists():
        return
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        meta = get_account_meta_from_token_data(data)
        email = meta.get("email")
        if email and "@" in email:
            # Validation anti-traversée + écriture atomique + permissions 0600
            dest = _validate_account_file(email)
            temp = dest.parent / f".{dest.name}.tmp.{uuid.uuid4().hex[:8]}"
            try:
                with open(temp, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                restrict_file_permissions(temp)
                temp.replace(dest)
                restrict_file_permissions(dest)
            finally:
                if temp.exists():
                    try:
                        temp.unlink()
                    except Exception as e:
                        logger.debug(f"Ignored error: {e}")
    except Exception as e:
        logger.error(f"Error syncing active account: {e}")


def get_active_account() -> dict[str, Any] | None:
    ensure_dirs()
    if not TOKEN_FILE.exists():
        sync_active_account_to_store()
    if not TOKEN_FILE.exists():
        return None
    try:
        with open(TOKEN_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
        meta = get_account_meta_from_token_data(data)
        meta["is_active"] = True
        return meta
    except Exception as e:
        logger.error(f"Failed to read active account: {e}")
        return None


def list_google_accounts() -> dict[str, Any]:
    ensure_dirs()
    sync_active_account_to_store()
    active_meta = get_active_account()
    active_email = (active_meta.get("email") or "").strip().lower() if active_meta else None
    if active_meta:
        active_meta["is_exhausted"] = is_account_marked_exhausted(active_meta.get("email", ""))

    accounts = []
    for p in ACCOUNTS_DIR.glob("*.json"):
        if p.name.startswith(".") or p.name.endswith(".tmp") or ".tmp." in p.name:
            continue
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            meta = get_account_meta_from_token_data(data)
            email_val = (meta.get("email") or "").strip().lower()
            meta["is_active"] = bool(active_email and email_val == active_email)
            meta["is_exhausted"] = is_account_marked_exhausted(email_val)
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
    if cleaned.lower().endswith(".json"):
        cleaned = cleaned[:-5].strip()
    if not cleaned or "/" in cleaned or "\\" in cleaned or ".." in cleaned or "@" not in cleaned:
        raise ValueError("Adresse email invalide ou chemin suspect.")
    target_file = (ACCOUNTS_DIR / f"{cleaned}.json").resolve()
    if target_file.parent != ACCOUNTS_DIR.resolve():
        raise ValueError("Tentative de traversée de répertoire non autorisée.")
    if not target_file.exists() and ACCOUNTS_DIR.exists():
        cleaned_lower = cleaned.lower()
        for p in ACCOUNTS_DIR.glob("*.json"):
            if p.name.startswith(".") or p.name.endswith(".tmp") or ".tmp." in p.name:
                continue
            if p.stem.lower() == cleaned_lower:
                return p.resolve()
    return target_file


def switch_google_account(target_email: str) -> dict[str, Any]:
    ensure_dirs()
    target_file = _validate_account_file(target_email)
    if not target_file.exists():
        raise FileNotFoundError(f"Le compte {target_email} n'est pas enregistré.")

    # Backup current token if exists
    if TOKEN_FILE.exists():
        bak_file = GEMINI_DIR / "antigravity-oauth-token.bak"
        shutil.copy2(TOKEN_FILE, bak_file)
        restrict_file_permissions(bak_file)

    # Copy target account to active
    # Écriture atomique (tmp + replace) : évite toute lecture partielle par agy
    temp_file = TOKEN_FILE.parent / f".{TOKEN_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        shutil.copy2(target_file, temp_file)
        restrict_file_permissions(temp_file)
        temp_file.replace(TOKEN_FILE)
        restrict_file_permissions(TOKEN_FILE)
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink()
            except Exception as e:
                logger.debug(f"Ignored error: {e}")

    clear_account_exhaustion(target_email)

    # Sync to Windows keyring as well so agy uses the switched account!
    if IS_WINDOWS:
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                target_data = json.load(f)
            _write_windows_keyring_token(target_data)
        except Exception as e:
            logger.warning(f"Failed to sync Windows keyring on switch: {e}")

    active_meta = get_active_account()
    logger.info(f"Switched Google account to {target_email}")
    return {
        "success": True,
        "active_account": active_meta,
        "message": f"Compte Google basculé sur {target_email}"
    }


def delete_google_account(email: str) -> dict[str, Any]:
    ensure_dirs()
    target_file = _validate_account_file(email)
    if not target_file.exists():
        raise FileNotFoundError(f"Le compte {email} est introuvable.")

    active_meta = get_active_account()
    if active_meta and active_meta.get("email", "").lower() == email.strip().lower():
        raise ValueError("Impossible de supprimer le compte Google actuellement actif. Veuillez d'abord basculer sur un autre compte.")

    target_file.unlink(missing_ok=True)
    clear_account_exhaustion(email)
    logger.info(f"Deleted saved Google account {email}")
    return {"success": True, "message": f"Compte {email} supprimé"}



def _proc_running(proc) -> bool:
    """Vrai si le processus de connexion tourne encore (Popen ou PtyProcess winpty)."""
    if proc is None:
        return False
    isalive = getattr(proc, "isalive", None)
    if callable(isalive):
        return bool(isalive())
    return proc.poll() is None


def _terminate_login_proc(proc) -> None:
    """Arrête le processus de connexion (Popen ou winpty), sans lever d'exception."""
    if proc is None:
        return
    try:
        terminate = getattr(proc, "terminate", None)
        if callable(terminate) and callable(getattr(proc, "isalive", None)):
            terminate(force=True)
        else:
            proc.kill()
    except Exception as e:
        logger.debug(f"Arrêt du processus de connexion impossible: {e}")


def _close_login_resources(master_fd, proc) -> None:
    """Ferme le descripteur PTY et arrête le processus de connexion."""
    if master_fd is not None:
        try:
            os.close(master_fd)
        except OSError:
            logger.debug("Ignored error")
    _terminate_login_proc(proc)


def _restore_stash(stash_path: Path) -> None:
    """Restaure le token de secours de manière sûre et multiplateforme."""
    if not stash_path.exists():
        return
    try:
        if TOKEN_FILE.exists():
            TOKEN_FILE.unlink(missing_ok=True)
        shutil.move(stash_path, TOKEN_FILE)
        restrict_file_permissions(TOKEN_FILE)
    except Exception as e:
        logger.warning(f"Failed to restore token stash {stash_path}: {e}")


def _spawn_login_process(env):
    """
    Démarre `agy -p auth_login_init` en mode PTY.
    POSIX : pty.openpty() ; Windows : pywinpty.
    Retourne (proc, master_fd, win_pty).
    """
    # Utilise un répertoire temporaire neutre pour éviter de charger des MCP lents configurés localement
    spawn_cwd = os.environ.get("TEMP") or str(HOME)

    if IS_WINDOWS:
        if not HAS_WINPTY:
            raise RuntimeError(
                "La connexion Google nécessite le paquet « pywinpty » sous Windows "
                "(pip install pywinpty)."
            )
        win_pty = winpty.PtyProcess.spawn([AGY_BIN, "-p", "auth_login_init"], cwd=str(spawn_cwd), env=env)
        return win_pty, None, win_pty

    if not HAS_PTY:
        raise RuntimeError("La connexion Google nécessite les modules POSIX pty/select.")
    master_fd, slave_fd = pty.openpty()
    try:
        proc = subprocess.Popen(
            [AGY_BIN, "-p", "auth_login_init"],
            stdin=slave_fd,
            stdout=slave_fd,
            stderr=slave_fd,
            close_fds=True,
            env=env,
            cwd=str(spawn_cwd)
        )  # nosec B603
    except Exception:
        try:
            os.close(master_fd)
        except OSError:
            pass
        try:
            os.close(slave_fd)
        except OSError:
            pass
        raise
    finally:
        try:
            os.close(slave_fd)
        except OSError:
            pass
    return proc, master_fd, None


_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[a-zA-Z]")
_AUTH_URL_PATTERN = re.compile(r"https://accounts\.google\.com/o/oauth2/(?:v2/)?auth[^\s\r\n]+")


def _clean_auth_url(raw_url: str) -> str:
    cleaned = _ANSI_ESCAPE_RE.sub("", raw_url)
    return cleaned.rstrip("'\"`>)];.,")


def _read_auth_url(proc, master_fd, win_pty, timeout: float = 25.0):
    """Lit la sortie du CLI jusqu'à capturer l'URL OAuth Google."""
    import queue
    import threading

    output = ""

    if IS_WINDOWS:
        chunks: queue.Queue = queue.Queue()
        stop_event = threading.Event()

        def reader():
            try:
                while not stop_event.is_set():
                    data = win_pty.read(4096)
                    if not data:
                        break
                    chunks.put(str(data))
            except Exception as e:
                logger.debug(f"winpty reader stopped: {e}")
            finally:
                chunks.put(None)

        threading.Thread(target=reader, daemon=True, name="gauth-reader").start()

        start_time = time.time()
        try:
            while time.time() - start_time < timeout:
                try:
                    chunk = chunks.get(timeout=0.2)
                except queue.Empty:
                    if not win_pty.isalive():
                        break
                    continue
                if chunk is None:
                    break
                output += chunk
                match = _AUTH_URL_PATTERN.search(output)
                if match:
                    return _clean_auth_url(match.group(0)), output
        finally:
            stop_event.set()
        return None, output

    # POSIX : lecture non bloquante via select
    start_time = time.time()
    while time.time() - start_time < timeout:
        r, _, _ = select.select([master_fd], [], [], 0.2)
        if master_fd in r:
            try:
                chunk = os.read(master_fd, 4096).decode("utf-8", errors="ignore")
            except OSError:
                break
            if not chunk:
                break
            output += chunk
            match = _AUTH_URL_PATTERN.search(output)
            if match:
                return _clean_auth_url(match.group(0)), output
        elif proc is not None and getattr(proc, "poll", None) and proc.poll() is not None:
            break
    return None, output


def start_google_login_flow() -> dict[str, Any]:
    ensure_dirs()
    cleanup_stale_sessions()

    session_id = f"gauth_{int(time.time())}_{os.urandom(4).hex()}"
    stash_path = GEMINI_DIR / f"antigravity-oauth-token.stash_{session_id}"
    keyring_stash_path = GEMINI_DIR / f"gemini-keyring.stash_{session_id}"

    # Stash current token temporarily so agy is forced to initiate OAuth
    if TOKEN_FILE.exists():
        shutil.move(TOKEN_FILE, stash_path)

    # Stash current Windows keyring token temporarily if present
    stashed_keyring = False
    if IS_WINDOWS:
        kw_token = _read_windows_keyring_token()
        if kw_token:
            try:
                with open(keyring_stash_path, "w", encoding="utf-8") as f:
                    json.dump(kw_token, f, indent=2)
                restrict_file_permissions(keyring_stash_path)
                _delete_windows_keyring_token()
                stashed_keyring = True
            except Exception as e:
                logger.warning(f"Failed to stash Windows keyring: {e}")

    proc = None
    master_fd = None
    win_pty = None
    try:
        env = os.environ.copy()
        env["HOME"] = str(HOME)

        proc, master_fd, win_pty = _spawn_login_process(env)
        auth_url, output = _read_auth_url(proc, master_fd, win_pty, timeout=25.0)

        if not auth_url:
            logger.error(f"Failed to capture Google auth URL. agy output: {output!r}")
            raise RuntimeError("Impossible de récupérer l'URL de connexion Google depuis Antigravity.")

        with _login_lock:
            _LOGIN_SESSIONS[session_id] = {
                "proc": proc,
                "master_fd": master_fd,
                "win_pty": win_pty is not None,
                "started_at": time.time(),
                "stash_path": str(stash_path),
                "keyring_stash_path": str(keyring_stash_path) if stashed_keyring else None,
                "auth_url": auth_url
            }

        return {
            "session_id": session_id,
            "auth_url": auth_url,
            "instructions": "Ouvrez l'URL dans votre navigateur, connectez-vous avec votre compte Google, puis copiez-collez le code d'autorisation obtenu.",
            "timeout_seconds": 180
        }
    except Exception:
        _close_login_resources(master_fd, proc)
        _restore_stash(stash_path)
        if stashed_keyring and keyring_stash_path.exists():
            try:
                with open(keyring_stash_path, "r", encoding="utf-8") as f:
                    rest_data = json.load(f)
                _write_windows_keyring_token(rest_data)
                keyring_stash_path.unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to restore keyring from stash: {e}")
        raise


def submit_google_auth_code(session_id: str, raw_input: str) -> dict[str, Any]:
    with _login_lock:
        session = _LOGIN_SESSIONS.get(session_id)
    if not session:
        raise ValueError("Session de connexion expirée ou invalide.")

    proc = session["proc"]
    master_fd = session.get("master_fd")
    stash_path = Path(session["stash_path"])
    keyring_stash_str = session.get("keyring_stash_path")
    keyring_stash_path = Path(keyring_stash_str) if keyring_stash_str else None

    code = raw_input.strip()
    # If the user pasted the entire redirect URL e.g. https://...?code=... or fragment or code=...
    if "code=" in code:
        try:
            parsed = urlparse(code)
            query_str = parsed.query or parsed.fragment or ""
            if query_str:
                params = parse_qs(query_str)
                if params.get("code"):
                    code = params["code"][0]
            if "code=" in code:
                m = re.search(r'(?:[?&#]code=|^code=)([^&\s#]+)', code)
                if m:
                    code = m.group(1)
        except Exception as e:
            logger.debug(f"Ignored error: {e}")
        code = code.removeprefix("code=")

    code = unquote(code.strip())

    if not code:
        raise ValueError("Code d'autorisation vide.")

    try:
        if IS_WINDOWS and proc is not None:
            proc.write(f"{code}\n")
        elif master_fd is not None:
            os.write(master_fd, f"{code}\n".encode())

        # Wait for agy to complete token exchange and flush TOKEN_FILE
        start_wait = time.time()
        token_ready = False
        while time.time() - start_wait < 20:
            if TOKEN_FILE.exists() and TOKEN_FILE.stat().st_size > 0:
                try:
                    with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict) and data:
                            token_ready = True
                            break
                except (json.JSONDecodeError, OSError) as e:
                    logger.debug(f"Ignored error: {e}")
            if not _proc_running(proc):
                for _ in range(5):
                    time.sleep(0.25)
                    if TOKEN_FILE.exists() and TOKEN_FILE.stat().st_size > 0:
                        try:
                            with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                                data = json.load(f)
                                if isinstance(data, dict) and data:
                                    token_ready = True
                                    break
                        except (json.JSONDecodeError, OSError) as e:
                            logger.debug(f"Ignored error during token read: {e}")
                    if token_ready:
                        break
                break
            time.sleep(0.3)

        # Ensure login resources (PTY fd and child process) are fully closed
        _close_login_resources(master_fd, proc)

        if not token_ready or not TOKEN_FILE.exists():
            # Auth failed, restore previous tokens
            _restore_stash(stash_path)
            if keyring_stash_path and keyring_stash_path.exists():
                try:
                    with open(keyring_stash_path, "r", encoding="utf-8") as f:
                        kdata = json.load(f)
                    _write_windows_keyring_token(kdata)
                    keyring_stash_path.unlink(missing_ok=True)
                except Exception as e:
                    logger.warning(f"Failed to restore keyring from stash: {e}")
            raise RuntimeError("Échec de l'échange du jeton avec Google: le token n'a pas été généré ou est invalide.")

        # Auth succeeded! Clean up stashes
        if stash_path.exists():
            stash_path.unlink(missing_ok=True)
        if keyring_stash_path and keyring_stash_path.exists():
            keyring_stash_path.unlink(missing_ok=True)

        restrict_file_permissions(TOKEN_FILE)
        sync_active_account_to_store()
        active_meta = get_active_account()

        # Update Windows keyring with new token so agy CLI uses it directly
        if IS_WINDOWS:
            try:
                with open(TOKEN_FILE, "r", encoding="utf-8") as f:
                    new_token_data = json.load(f)
                _write_windows_keyring_token(new_token_data)
            except Exception as e:
                logger.warning(f"Failed to update Windows keyring after login: {e}")

        with _login_lock:
            _LOGIN_SESSIONS.pop(session_id, None)

        active_email = active_meta.get("email") if active_meta else "Inconnu"
        return {
            "success": True,
            "active_account": active_meta,
            "message": f"Nouveau compte Google connecté avec succès : {active_email}"
        }
    except Exception:
        _close_login_resources(master_fd, proc)
        _restore_stash(stash_path)
        if keyring_stash_path and keyring_stash_path.exists():
            try:
                with open(keyring_stash_path, "r", encoding="utf-8") as f:
                    kdata = json.load(f)
                _write_windows_keyring_token(kdata)
                keyring_stash_path.unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to restore keyring from stash: {e}")
        with _login_lock:
            _LOGIN_SESSIONS.pop(session_id, None)
        raise


def cancel_google_login_flow(session_id: str) -> dict[str, Any]:
    with _login_lock:
        session = _LOGIN_SESSIONS.pop(session_id, None)
    if session:
        _close_login_resources(session.get("master_fd"), session.get("proc"))
        stash_path = Path(session["stash_path"])
        _restore_stash(stash_path)
        keyring_stash_str = session.get("keyring_stash_path")
        if keyring_stash_str and Path(keyring_stash_str).exists():
            try:
                p = Path(keyring_stash_str)
                with open(p, "r", encoding="utf-8") as f:
                    kdata = json.load(f)
                _write_windows_keyring_token(kdata)
                p.unlink(missing_ok=True)
            except Exception as e:
                logger.warning(f"Failed to restore keyring on cancel: {e}")
    return {"success": True, "message": "Session annulée"}


def cleanup_stale_sessions():
    now = time.time()
    stale_ids = []
    with _login_lock:
        for sid, sess in list(_LOGIN_SESSIONS.items()):
            if now - sess["started_at"] > 300:  # 5 minutes
                stale_ids.append(sid)
    for sid in stale_ids:
        cancel_google_login_flow(sid)


def restore_stashed_token_if_needed() -> None:
    """Restaure le token d'authentification s'il est resté stashed suite à un crash/redémarrage."""
    try:
        ensure_dirs()
        if TOKEN_FILE.exists():
            for p in GEMINI_DIR.glob("antigravity-oauth-token.stash_*"):
                try:
                    p.unlink(missing_ok=True)
                    logger.info(f"Orphan token stash supprimé : {p.name}")
                except Exception as e:
                    logger.debug(f"Impossible de supprimer l'orphan stash {p}: {e}")
        else:
            stashes = sorted(
                GEMINI_DIR.glob("antigravity-oauth-token.stash_*"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if stashes:
                latest_stash = stashes[0]
                shutil.move(latest_stash, TOKEN_FILE)
                restrict_file_permissions(TOKEN_FILE)
                logger.info(f"Token OAuth restauré depuis le stash orphelin : {latest_stash.name}")
                for remaining in stashes[1:]:
                    remaining.unlink(missing_ok=True)

        if IS_WINDOWS:
            keyring_stashes = sorted(
                GEMINI_DIR.glob("gemini-keyring.stash_*"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
            if keyring_stashes:
                try:
                    with open(keyring_stashes[0], "r", encoding="utf-8") as f:
                        kdata = json.load(f)
                    _write_windows_keyring_token(kdata)
                    logger.info(f"Keyring Windows restauré depuis le stash orphelin : {keyring_stashes[0].name}")
                except Exception as e:
                    logger.warning(f"Erreur restauration keyring orphan: {e}")
                for kp in keyring_stashes:
                    kp.unlink(missing_ok=True)
    except Exception as e:
        logger.warning(f"Erreur lors de la vérification des stashes orphelins : {e}")


def import_raw_token(token_data: dict[str, Any]) -> dict[str, Any]:
    ensure_dirs()
    meta = get_account_meta_from_token_data(token_data)
    email = meta.get("email")
    if not email or "@" not in email:
        raise ValueError("Données de jeton invalides : adresse email introuvable.")

    account_file = _validate_account_file(email)
    temp_acc = account_file.parent / f".{account_file.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        with open(temp_acc, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2)
        restrict_file_permissions(temp_acc)
        temp_acc.replace(account_file)
        restrict_file_permissions(account_file)
    finally:
        if temp_acc.exists():
            try:
                temp_acc.unlink()
            except Exception as e:
                logger.debug(f"Ignored error: {e}")

    temp_file = TOKEN_FILE.parent / f".{TOKEN_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        with open(temp_file, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2)
        restrict_file_permissions(temp_file)
        temp_file.replace(TOKEN_FILE)
        restrict_file_permissions(TOKEN_FILE)
    finally:
        if temp_file.exists():
            try:
                temp_file.unlink()
            except Exception as e:
                logger.debug(f"Ignored error: {e}")

    clear_account_exhaustion(email)

    if IS_WINDOWS:
        try:
            _write_windows_keyring_token(token_data)
        except Exception as e:
            logger.warning(f"Failed to sync Windows keyring on import: {e}")

    return {
        "success": True,
        "active_account": get_active_account(),
        "message": f"Compte {email} importé et activé avec succès."
    }


def is_quota_error(message: str) -> bool:
    if not message:
        return False
    lower = message.lower()
    patterns = [
        "resource_exhausted",
        "code 429",
        "status 429",
        "http 429",
        "quota reached",
        "quota exceeded",
        "quota limit",
        "individual quota reached",
        "exceeded your quota",
        "exhausted your capacity",
        "rate limit exceeded",
        "rate limit reached",
        "increase your limits",
        "free tier quota",
        "out of quota",
        "too many requests",
        "insufficient quota",
        "credit balance",
        "capacity exceeded",
        "quota_exceeded",
        "resource has been exhausted",
        "quota_error",
        "rate_limit_exceeded",
        "ratelimit",
        "rate-limit",
        "rate_limit",
        "ratelimited",
        "quota épuisé",
        "quota epuise",
        "quota atteint",
        "limite de quota",
        "quota google épuisé",
        "quota google epuise"
    ]
    return any(p in lower for p in patterns) or bool(_QUOTA_429_RE.search(lower))


# Limites DURABLES (compte épuisé, réinitialisation à des heures/jours) —
# à distinguer des 429 transitoires qui se règlent par backoff.
_HARD_QUOTA_PATTERNS = [
    "individual quota reached",
    "quota reached",
    "quota exceeded",
    "exceeded your quota",
    "out of quota",
    "insufficient quota",
    "exhausted your capacity",
    "resource has been exhausted",
    "capacity exceeded",
    "quota épuisé",
    "quota atteint",
]


def is_hard_quota_error(message: str) -> bool:
    """Détecte une limite de quota durable (compte épuisé) dans une ligne de log."""
    if not message:
        return False
    lower = message.lower()
    return any(p in lower for p in _HARD_QUOTA_PATTERNS)


def mark_account_exhausted(email: str | None, duration_seconds: float = 900.0) -> None:
    """Mark an account as exhausted for a given duration (default 15 minutes)."""
    if not email or not isinstance(email, str):
        return
    norm_email = email.strip().lower()
    if not norm_email:
        return
    now = time.time()
    with _exhaustion_lock:
        expired = [e for e, exp in _account_exhaustion_tracker.items() if exp <= now]
        for e in expired:
            _account_exhaustion_tracker.pop(e, None)
        _account_exhaustion_tracker[norm_email] = now + duration_seconds
    logger.warning(f"Google account {norm_email} marked as quota-exhausted for {duration_seconds}s")


def is_account_marked_exhausted(email: str | None) -> bool:
    if not email or not isinstance(email, str):
        return False
    norm_email = email.strip().lower()
    if not norm_email:
        return False
    now = time.time()
    with _exhaustion_lock:
        expired = [e for e, exp in _account_exhaustion_tracker.items() if exp <= now]
        for e in expired:
            _account_exhaustion_tracker.pop(e, None)
        exp = _account_exhaustion_tracker.get(norm_email, 0.0)
    return now < exp


def get_account_exhaustion_expiry(email: str | None) -> float:
    """Retourne le timestamp d'expiration de l'épuisement du compte (0.0 si sain)."""
    if not email or not isinstance(email, str):
        return 0.0
    norm_email = email.strip().lower()
    if not norm_email:
        return 0.0
    now = time.time()
    with _exhaustion_lock:
        expired = [e for e, exp in _account_exhaustion_tracker.items() if exp <= now]
        for e in expired:
            _account_exhaustion_tracker.pop(e, None)
        exp = _account_exhaustion_tracker.get(norm_email, 0.0)
    return exp if exp > now else 0.0


def get_candidate_accounts(exclude_email: str | None = None) -> list[str]:
    ensure_dirs()
    candidates = []
    norm_exclude = exclude_email.strip().lower() if exclude_email else None
    for p in ACCOUNTS_DIR.glob("*.json"):
        if p.name.startswith(".") or p.name.endswith(".tmp") or ".tmp." in p.name:
            continue
        email = p.stem.strip()
        if "@" not in email:
            continue
        if norm_exclude and email.lower() == norm_exclude:
            continue
        candidates.append(email)

    # Sort candidates: prioritize accounts that are NOT marked exhausted.
    # If all accounts are exhausted, prioritize the one whose exhaustion expires earliest.
    candidates.sort(key=lambda e: (is_account_marked_exhausted(e), get_account_exhaustion_expiry(e), e))
    return candidates


def switch_to_next_healthy_account(exclude_email: str | None = None, model: str | None = None) -> str | None:
    """
    Selects and activates the next available healthy Google account.
    Returns the email of the newly activated account, or None if no valid candidate exists.
    """
    if exclude_email:
        mark_account_exhausted(exclude_email, duration_seconds=1800.0)

    model_info = f" for model {model}" if model else ""
    candidates = get_candidate_accounts(exclude_email=exclude_email)
    if not candidates:
        logger.warning(f"No candidate Google accounts available for auto-failover{model_info}.")
        return None

    # Filter out accounts currently marked exhausted if any non-exhausted candidate exists
    non_exhausted = [c for c in candidates if not is_account_marked_exhausted(c)]
    target_list = non_exhausted if non_exhausted else candidates

    for target_email in target_list:
        try:
            switch_google_account(target_email)
            logger.info(f"Auto-Failover: Switched active Google account to {target_email}{model_info}")
            return target_email
        except Exception as e:
            logger.error(f"Auto-Failover: Failed switching to {target_email}{model_info}: {e}")
            continue

    return None

