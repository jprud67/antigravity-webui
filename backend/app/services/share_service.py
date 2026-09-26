"""Collaborative Session Sharing Service.

Manages direct share links, cryptographic access tokens, expiration lifespans,
PIN code protections, and instant revocation for shared sessions.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import sqlite3
import time
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from typing import Any, Literal

from app.config import CONVERSATION_DB

logger = logging.getLogger("antigravity.share")

SharePermission = Literal["read", "write"]


@contextmanager
def _get_db():
    CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        with conn:
            yield conn
    finally:
        try:
            conn.close()
        except Exception as e:
            logger.debug("Failed to close shared_sessions connection: %s", e)


def ensure_share_schema() -> None:
    """Creates the SQLite shared_sessions table if missing."""
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS shared_sessions (
                token TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
                pin_hash TEXT,
                expires_at TEXT,
                created_at TEXT NOT NULL,
                created_by TEXT DEFAULT 'host',
                is_revoked INTEGER DEFAULT 0
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shared_sessions_conv ON shared_sessions(conversation_id);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shared_sessions_token ON shared_sessions(token);")


def _hash_pin(pin_code: str) -> str:
    """Compute salted PBKDF2-HMAC-SHA256 hash for PIN protection."""
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac("sha256", pin_code.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return f"pbkdf2:sha256:100000${salt}${key.hex()}"


def _verify_pin(pin_code: str, stored_hash: str | None) -> bool:
    """Constant-time verification of PIN against stored PBKDF2 hash."""
    if not stored_hash or not pin_code:
        return False
    try:
        parts = stored_hash.split("$")
        if len(parts) != 3:
            return False
        _algo, salt, expected_hex = parts
        computed = hashlib.pbkdf2_hmac("sha256", pin_code.encode("utf-8"), salt.encode("utf-8"), 100_000).hex()
        return hmac.compare_digest(computed, expected_hex)
    except Exception as e:
        logger.warning("Error verifying PIN: %s", e)
        return False


def create_share_link(
    conversation_id: str,
    permission: SharePermission = "read",
    duration_hours: int | None = None,
    pin_code: str | None = None,
    created_by: str = "host",
) -> dict[str, Any]:
    """Generates a secure share link with expiration and optional PIN."""
    ensure_share_schema()

    if permission not in ("read", "write"):
        permission = "read"

    token = secrets.token_urlsafe(24)
    now_utc = datetime.now(timezone.utc)
    created_at = now_utc.isoformat()

    expires_at = None
    if duration_hours is not None:
        expires_at = (now_utc + timedelta(hours=duration_hours)).isoformat()

    clean_pin = (pin_code or "").strip()
    pin_hash = _hash_pin(clean_pin) if clean_pin else None

    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO shared_sessions (
                token, conversation_id, permission, pin_hash, expires_at, created_at, created_by, is_revoked
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
            """,
            (token, conversation_id, permission, pin_hash, expires_at, created_at, created_by),
        )

    return {
        "token": token,
        "conversation_id": conversation_id,
        "permission": permission,
        "expires_at": expires_at,
        "created_at": created_at,
        "created_by": created_by,
        "is_revoked": 0,
        "has_pin": bool(pin_hash),
    }


def verify_share_token(token: str, pin_code: str | None = None) -> dict[str, Any]:
    """Verifies validity of a share token, checking revocation, expiration, and PIN."""
    ensure_share_schema()

    if not token or not isinstance(token, str):
        return {"valid": False, "reason": "invalid_token"}

    clean_token = token.strip()
    with _get_db() as conn:
        cursor = conn.execute(
            """
            SELECT token, conversation_id, permission, pin_hash, expires_at, created_at, is_revoked
            FROM shared_sessions
            WHERE token = ?
            """,
            (clean_token,),
        )
        row = cursor.fetchone()

    if not row:
        return {"valid": False, "reason": "not_found"}

    _tok, conv_id, permission, pin_hash, expires_at_str, created_at_str, is_revoked = row

    if bool(is_revoked):
        return {"valid": False, "reason": "revoked", "conversation_id": conv_id}

    if expires_at_str:
        try:
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > expires_at:
                return {"valid": False, "reason": "expired", "conversation_id": conv_id}
        except Exception as e:
            logger.warning("Error parsing expires_at (%s): %s", expires_at_str, e)

    # Check PIN protection
    if pin_hash:
        if not pin_code:
            return {
                "valid": False,
                "reason": "pin_required",
                "requires_pin": True,
                "conversation_id": conv_id,
                "permission": permission,
            }
        if not _verify_pin(pin_code, pin_hash):
            return {
                "valid": False,
                "reason": "invalid_pin",
                "requires_pin": True,
                "conversation_id": conv_id,
                "permission": permission,
            }

    return {
        "valid": True,
        "conversation_id": conv_id,
        "permission": permission,
        "requires_pin": False,
        "expires_at": expires_at_str,
        "created_at": created_at_str,
    }


def list_share_links(conversation_id: str) -> list[dict[str, Any]]:
    """Returns all share links for a conversation with sanitized metadata."""
    ensure_share_schema()

    with _get_db() as conn:
        cursor = conn.execute(
            """
            SELECT token, conversation_id, permission, pin_hash, expires_at, created_at, created_by, is_revoked
            FROM shared_sessions
            WHERE conversation_id = ?
            ORDER BY created_at DESC
            """,
            (conversation_id,),
        )
        rows = cursor.fetchall()

    results: list[dict[str, Any]] = []
    now_utc = datetime.now(timezone.utc)

    for row in rows:
        token, conv_id, permission, pin_hash, expires_at_str, created_at_str, created_by, is_revoked = row
        is_expired = False
        if expires_at_str:
            try:
                is_expired = now_utc > datetime.fromisoformat(expires_at_str)
            except Exception:
                pass

        results.append({
            "token": token,
            "conversation_id": conv_id,
            "permission": permission,
            "has_pin": bool(pin_hash),
            "expires_at": expires_at_str,
            "created_at": created_at_str,
            "created_by": created_by,
            "is_revoked": bool(is_revoked),
            "is_expired": is_expired,
            "is_active": not bool(is_revoked) and not is_expired,
        })

    return results


def revoke_share_link(token: str) -> bool:
    """Revokes a share link immediately."""
    ensure_share_schema()
    clean_token = (token or "").strip()
    if not clean_token:
        return False

    with _get_db() as conn:
        cursor = conn.execute(
            """
            UPDATE shared_sessions
            SET is_revoked = 1
            WHERE token = ?
            """,
            (clean_token,),
        )
        revoked = cursor.rowcount > 0

    return revoked


def get_shared_session_info(token: str) -> dict[str, Any] | None:
    """Returns summary metadata for a share token without requiring pin for title inspection."""
    ensure_share_schema()
    clean_token = (token or "").strip()
    if not clean_token:
        return None

    with _get_db() as conn:
        cursor = conn.execute(
            """
            SELECT token, conversation_id, permission, pin_hash, expires_at, created_at, is_revoked
            FROM shared_sessions
            WHERE token = ?
            """,
            (clean_token,),
        )
        row = cursor.fetchone()

    if not row:
        return None

    token, conv_id, permission, pin_hash, expires_at_str, created_at_str, is_revoked = row
    now_utc = datetime.now(timezone.utc)
    is_expired = False
    if expires_at_str:
        try:
            is_expired = now_utc > datetime.fromisoformat(expires_at_str)
        except Exception:
            pass

    return {
        "token": token,
        "conversation_id": conv_id,
        "permission": permission,
        "requires_pin": bool(pin_hash),
        "expires_at": expires_at_str,
        "created_at": created_at_str,
        "is_revoked": bool(is_revoked),
        "is_expired": is_expired,
        "is_active": not bool(is_revoked) and not is_expired,
    }
