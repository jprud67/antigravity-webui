"""Progress Card Service for Antigravity WebUI.

Directly adapted from Antigravity Core's dynamic replace-on-write progress card architecture
(src/session-cards/progress-card-store.ts & src/session-cards/progress-card-input.ts).
Provides structured, non-spammy real-time tracking for multi-step agent plans.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import time
from typing import Any

from pydantic import BaseModel, Field

from app.config import SESSIONS_DB

logger = logging.getLogger(__name__)

DB_PATH = SESSIONS_DB

PROGRESS_CARD_MAX_STEPS = 25
PROGRESS_CARD_MAX_BYTES = 16384


class ProgressCardStep(BaseModel):
    label: str
    status: str = Field(default="pending", pattern="^(pending|in_progress|completed)$")


class ProgressCardPayload(BaseModel):
    title: str | None = "Plan d'action"
    markdown: str | None = None
    plan: list[ProgressCardStep]


def _get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def ensure_progress_card_schema():
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS session_progress_cards (
                session_id TEXT PRIMARY KEY,
                title TEXT,
                markdown TEXT,
                steps_json TEXT NOT NULL,
                percent INTEGER NOT NULL DEFAULT 0,
                updated_at REAL NOT NULL
            )
        """)
        conn.commit()


def normalize_progress_card_input(data: dict[str, Any]) -> dict[str, Any]:
    """Validates and normalizes the replace-on-write progress-card payload."""
    title = str(data.get("title") or "Plan d'action").strip()
    raw_md = data.get("markdown")
    markdown = str(raw_md).strip() if raw_md else None

    raw_plan = data.get("plan")
    if not isinstance(raw_plan, list):
        # Fallback if provided under steps
        raw_plan = data.get("steps") or []

    if len(raw_plan) > PROGRESS_CARD_MAX_STEPS:
        raw_plan = raw_plan[:PROGRESS_CARD_MAX_STEPS]

    steps: list[dict[str, str]] = []
    completed_count = 0

    for item in raw_plan:
        if isinstance(item, dict):
            label = str(item.get("label") or "").strip()
            status = str(item.get("status") or "pending").strip().lower()
            if status not in ("pending", "in_progress", "completed"):
                status = "pending"
            if label:
                steps.append({"label": label, "status": status})
                if status == "completed":
                    completed_count += 1
        elif isinstance(item, str) and item.strip():
            steps.append({"label": item.strip(), "status": "pending"})

    total = len(steps)
    percent = round(completed_count / total * 100) if total > 0 else 0

    return {
        "title": title,
        "markdown": markdown,
        "steps": steps,
        "percent": percent,
        "updated_at": time.time()
    }


def save_progress_card(session_id: str, data: dict[str, Any]) -> dict[str, Any]:
    ensure_progress_card_schema()
    card = normalize_progress_card_input(data)

    with _get_db() as conn:
        conn.execute("""
            INSERT INTO session_progress_cards (session_id, title, markdown, steps_json, percent, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(session_id) DO UPDATE SET
                title = excluded.title,
                markdown = excluded.markdown,
                steps_json = excluded.steps_json,
                percent = excluded.percent,
                updated_at = excluded.updated_at
        """, (
            session_id,
            card["title"],
            card["markdown"],
            json.dumps(card["steps"]),
            card["percent"],
            card["updated_at"]
        ))
        conn.commit()

    return card


def get_progress_card(session_id: str) -> dict[str, Any] | None:
    ensure_progress_card_schema()
    with _get_db() as conn:
        row = conn.execute(
            "SELECT * FROM session_progress_cards WHERE session_id = ?",
            (session_id,)
        ).fetchone()
        if not row:
            return None

        return {
            "title": row["title"],
            "markdown": row["markdown"],
            "steps": json.loads(row["steps_json"]),
            "percent": row["percent"],
            "updated_at": row["updated_at"]
        }


def delete_progress_card(session_id: str) -> bool:
    ensure_progress_card_schema()
    with _get_db() as conn:
        cur = conn.execute(
            "DELETE FROM session_progress_cards WHERE session_id = ?",
            (session_id,)
        )
        conn.commit()
        return cur.rowcount > 0
