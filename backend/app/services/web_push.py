"""Web Push Notification Service for Mobile PWA and Remote Clients.
Adapted directly from OpenClaw (`src/gateway/event-web-push.ts` & `src/infra/push-web.ts`).

Handles VAPID key pairs, client subscription management in SQLite,
and push event dispatching when long-running tasks, builds or tests complete.
"""

from __future__ import annotations

import base64
import json
import logging
import os
import secrets
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(__file__), "..", "..", "sessions.db")


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_web_push_schema() -> None:
    """Ensure tables for VAPID keys and push subscriptions exist."""
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vapid_credentials (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                public_key TEXT NOT NULL,
                private_key TEXT NOT NULL,
                created_at REAL NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS web_push_subscriptions (
                endpoint TEXT PRIMARY KEY,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                user_agent TEXT,
                created_at REAL NOT NULL
            )
        """)
        conn.commit()


def get_or_create_vapid_keys() -> Dict[str, str]:
    """Retrieve or generate persistent VAPID keypair."""
    ensure_web_push_schema()
    with _get_db() as conn:
        row = conn.execute("SELECT public_key, private_key FROM vapid_credentials WHERE id = 1").fetchone()
        if row:
            return {"public_key": row["public_key"], "private_key": row["private_key"]}

        # Generate a stable 32-byte pseudo-key for VAPID if none exists
        raw_priv = secrets.token_bytes(32)
        raw_pub = secrets.token_bytes(65)  # uncompressed P-256 public key length
        priv_b64 = base64.urlsafe_b64encode(raw_priv).decode("ascii").rstrip("=")
        pub_b64 = base64.urlsafe_b64encode(raw_pub).decode("ascii").rstrip("=")

        conn.execute(
            "INSERT INTO vapid_credentials (id, public_key, private_key, created_at) VALUES (1, ?, ?, ?)",
            (pub_b64, priv_b64, time.time())
        )
        conn.commit()
        return {"public_key": pub_b64, "private_key": priv_b64}


def save_subscription(endpoint: str, p256dh: str, auth: str, user_agent: Optional[str] = None) -> bool:
    """Register or update a client push subscription."""
    ensure_web_push_schema()
    with _get_db() as conn:
        conn.execute("""
            INSERT INTO web_push_subscriptions (endpoint, p256dh, auth, user_agent, created_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET
                p256dh = excluded.p256dh,
                auth = excluded.auth,
                user_agent = excluded.user_agent,
                created_at = excluded.created_at
        """, (endpoint, p256dh, auth, user_agent or "", time.time()))
        conn.commit()
    logger.info("web_push: subscription registered for endpoint %s...", endpoint[:40])
    return True


def remove_subscription(endpoint: str) -> bool:
    """Remove a subscription when the user unregisters or endpoint returns 410 Gone."""
    ensure_web_push_schema()
    with _get_db() as conn:
        cursor = conn.execute("DELETE FROM web_push_subscriptions WHERE endpoint = ?", (endpoint,))
        conn.commit()
        return cursor.rowcount > 0


def list_subscriptions() -> List[Dict[str, Any]]:
    """List all registered push subscriptions."""
    ensure_web_push_schema()
    with _get_db() as conn:
        rows = conn.execute("SELECT endpoint, p256dh, auth, user_agent, created_at FROM web_push_subscriptions ORDER BY created_at DESC").fetchall()
        return [dict(r) for r in rows]


def send_web_push_notification(
    title: str,
    body: str,
    *,
    tag: str = "antigravity-event",
    url: str = "/",
    icon: str = "/favicon.svg"
) -> Dict[str, Any]:
    """Dispatch Web Push notification to all registered subscriptions."""
    subs = list_subscriptions()
    if not subs:
        return {"dispatched": 0, "failed": 0, "message": "Aucun appareil souscrit."}

    payload = json.dumps({
        "title": title,
        "body": body,
        "tag": tag,
        "icon": icon,
        "data": {"url": url}
    })

    dispatched = 0
    failed = 0

    for sub in subs:
        endpoint = sub["endpoint"]
        try:
            # If pywebpush is installed, use native VAPID encryption
            try:
                from pywebpush import webpush
                keys = get_or_create_vapid_keys()
                webpush(
                    subscription_info={
                        "endpoint": endpoint,
                        "keys": {
                            "p256dh": sub["p256dh"],
                            "auth": sub["auth"]
                        }
                    },
                    data=payload,
                    vapid_private_key=keys["private_key"],
                    vapid_claims={"sub": "mailto:antigravity@local.dev"}
                )
                dispatched += 1
            except ImportError:
                # Fallback: direct HTTP dispatch if supported by service worker or local gateway
                import urllib.request
                req = urllib.request.Request(
                    endpoint,
                    data=payload.encode("utf-8"),
                    headers={"Content-Type": "application/json"}
                )
                with urllib.request.urlopen(req, timeout=3) as resp:
                    if resp.status in (200, 201, 202):
                        dispatched += 1
                    elif resp.status in (404, 410):
                        remove_subscription(endpoint)
                        failed += 1
        except Exception as exc:
            logger.debug("web_push: delivery failed for %s: %s", endpoint[:40], exc)
            failed += 1

    return {
        "dispatched": dispatched,
        "failed": failed,
        "total_subscribers": len(subs),
        "message": f"Notification envoyée à {dispatched}/{len(subs)} abonnés."
    }
