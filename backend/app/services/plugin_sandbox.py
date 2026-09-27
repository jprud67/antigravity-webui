"""Plugin Sandbox Engine — Antigravity WebUI v0.5.0

Secure sandboxed plugin system: register, list, invoke, and revoke
third-party agent plugins with scoped permission grants.
"""
from __future__ import annotations

import json
import logging
import re
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import sqlite3

from app.config import CONVERSATION_DB

logger = logging.getLogger("antigravity.plugins")

# Plugin permission scopes
VALID_SCOPES = frozenset({
    "register_command",
    "register_tool",
    "register_view",
    "read_workspace",
    "write_workspace",
    "run_terminal",
    "chat_access",
})

PLUGIN_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{1,60}$")


@contextmanager
def _get_db():
    CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        with conn:
            yield conn
    finally:
        try:
            conn.close()
        except Exception as e:
            logger.debug("Failed to close plugin_sandbox connection: %s", e)


def ensure_plugin_schema() -> None:
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS plugins (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                version TEXT NOT NULL DEFAULT '1.0.0',
                description TEXT,
                entry_point TEXT,
                scopes TEXT NOT NULL DEFAULT '[]',
                author TEXT DEFAULT 'community',
                homepage TEXT,
                is_active INTEGER DEFAULT 1,
                installed_at TEXT NOT NULL,
                last_invoked_at TEXT
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_plugins_slug ON plugins(slug);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_plugins_active ON plugins(is_active);")


def register_plugin(
    slug: str,
    name: str,
    version: str = "1.0.0",
    description: str | None = None,
    entry_point: str | None = None,
    scopes: list[str] | None = None,
    author: str = "community",
    homepage: str | None = None,
) -> dict[str, Any]:
    """Register or update a plugin in the sandbox registry."""
    ensure_plugin_schema()

    if not PLUGIN_SLUG_RE.match(slug):
        raise ValueError(f"Invalid plugin slug '{slug}'. Must match [a-z0-9][a-z0-9_-]{{1,60}}")

    granted_scopes = [s for s in (scopes or []) if s in VALID_SCOPES]

    plugin_id = f"plugin_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    with _get_db() as conn:
        existing = conn.execute("SELECT id FROM plugins WHERE slug = ?", (slug,)).fetchone()
        if existing:
            conn.execute(
                """UPDATE plugins SET name = ?, version = ?, description = ?, entry_point = ?,
                   scopes = ?, author = ?, homepage = ?, is_active = 1
                   WHERE slug = ?""",
                (name, version, description, entry_point, json.dumps(granted_scopes),
                 author, homepage, slug),
            )
            plugin_id = existing[0]
        else:
            conn.execute(
                """INSERT INTO plugins (id, slug, name, version, description, entry_point, scopes,
                   author, homepage, is_active, installed_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)""",
                (plugin_id, slug, name, version, description, entry_point,
                 json.dumps(granted_scopes), author, homepage, now),
            )

    return get_plugin(slug)  # type: ignore[return-value]


def get_plugin(slug: str) -> dict[str, Any] | None:
    """Retrieve a plugin by slug."""
    ensure_plugin_schema()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT id, slug, name, version, description, entry_point, scopes, author, homepage, is_active, installed_at, last_invoked_at FROM plugins WHERE slug = ?",
            (slug,),
        ).fetchone()
    if not row:
        return None
    return _row_to_dict(row)


def list_plugins(active_only: bool = True) -> list[dict[str, Any]]:
    """List all registered plugins, optionally filtered to active ones."""
    ensure_plugin_schema()
    with _get_db() as conn:
        if active_only:
            rows = conn.execute(
                "SELECT id, slug, name, version, description, entry_point, scopes, author, homepage, is_active, installed_at, last_invoked_at FROM plugins WHERE is_active = 1 ORDER BY installed_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, slug, name, version, description, entry_point, scopes, author, homepage, is_active, installed_at, last_invoked_at FROM plugins ORDER BY installed_at DESC"
            ).fetchall()
    return [_row_to_dict(r) for r in rows]


def disable_plugin(slug: str) -> bool:
    """Disable (soft-delete) a plugin."""
    ensure_plugin_schema()
    with _get_db() as conn:
        cur = conn.execute("UPDATE plugins SET is_active = 0 WHERE slug = ?", (slug,))
        return cur.rowcount > 0


def invoke_plugin(slug: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Simulate invoking a plugin method (sandbox stub).

    In production this would dispatch to a Wasm Worker / Web Worker process.
    """
    ensure_plugin_schema()
    plugin = get_plugin(slug)
    if not plugin:
        raise ValueError(f"Plugin '{slug}' not found or not active")

    if not plugin["is_active"]:
        raise PermissionError(f"Plugin '{slug}' is disabled")

    now = datetime.now(timezone.utc).isoformat()
    with _get_db() as conn:
        conn.execute("UPDATE plugins SET last_invoked_at = ? WHERE slug = ?", (now, slug))

    logger.info("Plugin '%s' invoked method '%s' with params %s", slug, method, params)
    return {
        "plugin_id": plugin["id"],
        "slug": slug,
        "method": method,
        "params": params or {},
        "status": "ok",
        "result": {"sandbox": "wasm-worker", "message": f"Method '{method}' dispatched to sandbox"},
        "invoked_at": now,
    }


def _row_to_dict(row: tuple) -> dict[str, Any]:
    (pid, slug, name, version, desc, ep, scopes_json, author, homepage, is_active, installed_at, last_invoked_at) = row
    return {
        "id": pid,
        "slug": slug,
        "name": name,
        "version": version,
        "description": desc,
        "entry_point": ep,
        "scopes": json.loads(scopes_json or "[]"),
        "author": author,
        "homepage": homepage,
        "is_active": bool(is_active),
        "installed_at": installed_at,
        "last_invoked_at": last_invoked_at,
    }
