"""Omni-channel Messaging Gateway & PIN Pairing Service (Telegram & Discord).
Directly adapted from Hermes Agent (`gateway/pairing.py` and messaging tests).

Provides:
1. NIST SP 800-63-4 compliant 8-character PIN pairing for unknown devices/senders.
2. Bot credentials and webhook/notification routing for Telegram & Discord.
3. Interactive approval alerts (Approve/Reject) pushed to paired mobile devices.
"""

from __future__ import annotations

import logging
import secrets
import sqlite3
import time
from typing import Any, Dict, List, Optional, Tuple

from app.config import SESSIONS_DB

logger = logging.getLogger(__name__)

DB_PATH = str(SESSIONS_DB)

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_LENGTH = 8
CODE_TTL_SECONDS = 3600             # 1 hour
MAX_PENDING_PER_PLATFORM = 3
MAX_FAILED_ATTEMPTS = 5
RATE_LIMIT_SECONDS = 600            # 10 minutes


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_messaging_gateway_schema() -> None:
    """Ensure database tables exist for pairing codes, approved devices and gateway configs."""
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messaging_gateway_configs (
                platform TEXT PRIMARY KEY,
                bot_token TEXT NOT NULL,
                chat_id TEXT,
                is_active INTEGER NOT NULL DEFAULT 1,
                notify_on_approval INTEGER NOT NULL DEFAULT 1,
                notify_on_complete INTEGER NOT NULL DEFAULT 1,
                updated_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messaging_pairing_codes (
                code TEXT PRIMARY KEY,
                platform TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                created_at REAL NOT NULL,
                expires_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messaging_approved_devices (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                user_id TEXT NOT NULL,
                user_name TEXT,
                approved_at REAL NOT NULL,
                UNIQUE(platform, user_id)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS messaging_pairing_rate_limits (
                key TEXT PRIMARY KEY,
                failed_attempts INTEGER NOT NULL DEFAULT 0,
                last_request_at REAL NOT NULL,
                lockout_until REAL NOT NULL DEFAULT 0
            )
        """)
        conn.commit()


def generate_pairing_code() -> str:
    """Generate an unambiguous 8-character code (formatted as XXXX-XXXX)."""
    raw = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    return f"{raw[:4]}-{raw[4:]}"


def request_pairing(platform: str, user_id: str, user_name: Optional[str] = None) -> Tuple[bool, str, Optional[str]]:
    """Request a new pairing PIN for a user on a given platform.
    
    Returns (success, message, code).
    """
    ensure_messaging_gateway_schema()
    now = time.time()
    rate_key = f"{platform}:{user_id}"

    with _get_db() as conn:
        # Check if already approved
        existing = conn.execute(
            "SELECT 1 FROM messaging_approved_devices WHERE platform = ? AND user_id = ?",
            (platform, user_id)
        ).fetchone()
        if existing:
            return True, "Appareil déjà approuvé.", None

        # Check rate limits & lockout
        rl = conn.execute(
            "SELECT failed_attempts, last_request_at, lockout_until FROM messaging_pairing_rate_limits WHERE key = ?",
            (rate_key,)
        ).fetchone()

        if rl:
            if rl["lockout_until"] > now:
                remaining = int(rl["lockout_until"] - now)
                return False, f"Trop de tentatives infructueuses. Réessayez dans {remaining}s.", None
            if (now - rl["last_request_at"]) < RATE_LIMIT_SECONDS:
                wait_sec = int(RATE_LIMIT_SECONDS - (now - rl["last_request_at"]))
                return False, f"Veuillez patienter {wait_sec}s avant de générer un nouveau code.", None

        # Clean expired codes
        conn.execute("DELETE FROM messaging_pairing_codes WHERE expires_at < ?", (now,))

        # Check pending cap for this platform
        count_pending = conn.execute(
            "SELECT COUNT(*) as cnt FROM messaging_pairing_codes WHERE platform = ?",
            (platform,)
        ).fetchone()["cnt"]

        if count_pending >= MAX_PENDING_PER_PLATFORM:
            return False, f"Trop de demandes en attente pour {platform}. Approbation requise sur le WebUI.", None

        # Delete any previous pending code for this specific user
        conn.execute(
            "DELETE FROM messaging_pairing_codes WHERE platform = ? AND user_id = ?",
            (platform, user_id)
        )

        code = generate_pairing_code()
        expires_at = now + CODE_TTL_SECONDS
        conn.execute(
            "INSERT INTO messaging_pairing_codes (code, platform, user_id, user_name, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (code, platform, user_id, user_name or "Utilisateur Inconnu", now, expires_at)
        )

        # Update rate limit record
        conn.execute("""
            INSERT INTO messaging_pairing_rate_limits (key, failed_attempts, last_request_at, lockout_until)
            VALUES (?, 0, ?, 0)
            ON CONFLICT(key) DO UPDATE SET
                last_request_at = excluded.last_request_at
        """, (rate_key, now))
        conn.commit()

    return True, "Code de couplage généré. Veuillez le valider dans Antigravity WebUI.", code


def approve_pairing_code(code: str) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
    """Approve a pending device code by the host operator."""
    ensure_messaging_gateway_schema()
    clean_code = code.strip().upper().replace(" ", "")
    now = time.time()

    with _get_db() as conn:
        row = conn.execute(
            "SELECT code, platform, user_id, user_name, expires_at FROM messaging_pairing_codes WHERE code = ?",
            (clean_code,)
        ).fetchone()

        if not row:
            # Check without hyphen
            row = conn.execute(
                "SELECT code, platform, user_id, user_name, expires_at FROM messaging_pairing_codes WHERE REPLACE(code, '-', '') = ?",
                (clean_code.replace("-", ""),)
            ).fetchone()

        if not row:
            return False, "Code de couplage introuvable ou expiré.", None

        if row["expires_at"] < now:
            conn.execute("DELETE FROM messaging_pairing_codes WHERE code = ?", (row["code"],))
            conn.commit()
            return False, "Ce code de couplage a expiré (validité 1 heure).", None

        # Add to approved devices
        conn.execute("""
            INSERT INTO messaging_approved_devices (platform, user_id, user_name, approved_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(platform, user_id) DO UPDATE SET
                approved_at = excluded.approved_at,
                user_name = excluded.user_name
        """, (row["platform"], row["user_id"], row["user_name"], now))

        # Delete pairing code
        conn.execute("DELETE FROM messaging_pairing_codes WHERE code = ?", (row["code"],))
        conn.commit()

        approved_device = {
            "platform": row["platform"],
            "user_id": row["user_id"],
            "user_name": row["user_name"],
            "approved_at": now
        }
        logger.info("messaging_gateway: approved device %s on %s", row["user_id"], row["platform"])
        return True, f"Appareil {row['user_name']} ({row['platform']}) approuvé avec succès !", approved_device


def is_user_approved(platform: str, user_id: str) -> bool:
    """Check if a platform sender ID is approved to send commands."""
    ensure_messaging_gateway_schema()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT 1 FROM messaging_approved_devices WHERE platform = ? AND user_id = ?",
            (platform, user_id)
        ).fetchone()
        return bool(row)


def list_pending_pairings() -> List[Dict[str, Any]]:
    """List pending pairing requests waiting for operator approval."""
    ensure_messaging_gateway_schema()
    now = time.time()
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT code, platform, user_id, user_name, created_at, expires_at FROM messaging_pairing_codes WHERE expires_at > ? ORDER BY created_at DESC",
            (now,)
        ).fetchall()
        return [dict(r) for r in rows]


def list_approved_devices() -> List[Dict[str, Any]]:
    """List all paired and authorized devices."""
    ensure_messaging_gateway_schema()
    with _get_db() as conn:
        rows = conn.execute(
            "SELECT id, platform, user_id, user_name, approved_at FROM messaging_approved_devices ORDER BY approved_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def revoke_device(platform: str, user_id: str) -> bool:
    """Revoke authorization for a paired device."""
    ensure_messaging_gateway_schema()
    with _get_db() as conn:
        cur = conn.execute(
            "DELETE FROM messaging_approved_devices WHERE platform = ? AND user_id = ?",
            (platform, user_id)
        )
        conn.commit()
        return cur.rowcount > 0


def save_gateway_config(
    platform: str,
    bot_token: str,
    chat_id: Optional[str] = None,
    is_active: bool = True,
    notify_on_approval: bool = True,
    notify_on_complete: bool = True
) -> bool:
    """Save bot token and settings for Telegram or Discord."""
    ensure_messaging_gateway_schema()
    with _get_db() as conn:
        conn.execute("""
            INSERT INTO messaging_gateway_configs (platform, bot_token, chat_id, is_active, notify_on_approval, notify_on_complete, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(platform) DO UPDATE SET
                bot_token = excluded.bot_token,
                chat_id = excluded.chat_id,
                is_active = excluded.is_active,
                notify_on_approval = excluded.notify_on_approval,
                notify_on_complete = excluded.notify_on_complete,
                updated_at = excluded.updated_at
        """, (platform, bot_token, chat_id or "", int(is_active), int(notify_on_approval), int(notify_on_complete), time.time()))
        conn.commit()
    return True


def get_gateway_configs() -> Dict[str, Any]:
    """Retrieve gateway configs with masked bot tokens."""
    ensure_messaging_gateway_schema()
    with _get_db() as conn:
        rows = conn.execute("SELECT platform, bot_token, chat_id, is_active, notify_on_approval, notify_on_complete, updated_at FROM messaging_gateway_configs").fetchall()
        result = {}
        for r in rows:
            token = r["bot_token"]
            masked = f"{token[:4]}...{token[-4:]}" if len(token) > 8 else "***"
            result[r["platform"]] = {
                "platform": r["platform"],
                "has_token": bool(token),
                "masked_token": masked,
                "chat_id": r["chat_id"],
                "is_active": bool(r["is_active"]),
                "notify_on_approval": bool(r["notify_on_approval"]),
                "notify_on_complete": bool(r["notify_on_complete"]),
                "updated_at": r["updated_at"]
            }
        return result
