"""Inline Code Reviews and Annotated Comments Service.

Manages line-anchored comments, threaded reviews, and autonomous @agent review triggers
for collaborative sessions in Monaco Editor and Diff Studio.
"""

from __future__ import annotations

import logging
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any

from pydantic import BaseModel, Field

from app.config import CONVERSATION_DB
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.inline_comments")


class CommentCreatePayload(BaseModel):
    conversation_id: str
    file_path: str
    line_number: int = Field(ge=1)
    author: str = "Host"
    content: str
    parent_id: str | None = None


class CommentUpdatePayload(BaseModel):
    content: str | None = None
    resolved: bool | None = None


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
            logger.debug("Failed to close inline_comments connection: %s", e)


def ensure_comments_schema() -> None:
    """Creates the SQLite inline_comments table if missing."""
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS inline_comments (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL,
                file_path TEXT NOT NULL,
                line_number INTEGER NOT NULL,
                author TEXT NOT NULL,
                content TEXT NOT NULL,
                parent_id TEXT,
                resolved INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            );
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_conv_file ON inline_comments(conversation_id, file_path);")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_parent ON inline_comments(parent_id);")


def list_comments(
    conversation_id: str,
    file_path: str | None = None
) -> list[dict[str, Any]]:
    """Returns all inline comments for a conversation, optionally filtered by file."""
    ensure_comments_schema()
    clean_cid = conversation_id.strip()

    with _get_db() as conn:
        if file_path:
            clean_fp = file_path.strip()
            cursor = conn.execute(
                """
                SELECT id, conversation_id, file_path, line_number, author, content, parent_id, resolved, created_at
                FROM inline_comments
                WHERE conversation_id = ? AND file_path = ?
                ORDER BY line_number ASC, created_at ASC
                """,
                (clean_cid, clean_fp),
            )
        else:
            cursor = conn.execute(
                """
                SELECT id, conversation_id, file_path, line_number, author, content, parent_id, resolved, created_at
                FROM inline_comments
                WHERE conversation_id = ?
                ORDER BY file_path ASC, line_number ASC, created_at ASC
                """,
                (clean_cid,),
            )
        rows = cursor.fetchall()

    comments: list[dict[str, Any]] = []
    for r in rows:
        c_id, cid, fp, line_num, author, content, parent_id, resolved, created_at = r
        comments.append({
            "id": c_id,
            "conversation_id": cid,
            "file_path": fp,
            "line_number": line_num,
            "author": author,
            "content": content,
            "parent_id": parent_id,
            "resolved": bool(resolved),
            "created_at": created_at,
            "has_agent_mention": "@agent" in content.lower(),
        })

    return comments


def create_comment(payload: CommentCreatePayload) -> dict[str, Any]:
    """Inserts a new line-anchored inline comment and detects @agent triggers."""
    ensure_comments_schema()

    if not is_safe_conversation_id(payload.conversation_id):
        raise ValueError("Invalid conversation_id")

    comment_id = f"comment_{uuid.uuid4().hex[:10]}"
    now_iso = datetime.now(timezone.utc).isoformat()
    clean_content = payload.content.strip()

    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO inline_comments (
                id, conversation_id, file_path, line_number, author, content, parent_id, resolved, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)
            """,
            (
                comment_id,
                payload.conversation_id.strip(),
                payload.file_path.strip(),
                payload.line_number,
                payload.author.strip() or "Anonymous",
                clean_content,
                payload.parent_id,
                now_iso,
            ),
        )

    has_agent = "@agent" in clean_content.lower()

    return {
        "id": comment_id,
        "conversation_id": payload.conversation_id.strip(),
        "file_path": payload.file_path.strip(),
        "line_number": payload.line_number,
        "author": payload.author.strip() or "Anonymous",
        "content": clean_content,
        "parent_id": payload.parent_id,
        "resolved": False,
        "created_at": now_iso,
        "has_agent_mention": has_agent,
    }


def update_comment(comment_id: str, payload: CommentUpdatePayload) -> dict[str, Any]:
    """Updates a comment's content or resolves/reopens it."""
    ensure_comments_schema()
    clean_id = comment_id.strip()

    with _get_db() as conn:
        cursor = conn.execute(
            "SELECT id, conversation_id, file_path, line_number, author, content, parent_id, resolved, created_at FROM inline_comments WHERE id = ?",
            (clean_id,),
        )
        row = cursor.fetchone()
        if not row:
            raise ValueError(f"Comment {clean_id} not found")

        cur_id, cid, fp, line_num, author, content, parent_id, resolved, created_at = row

        new_content = payload.content.strip() if payload.content is not None else content
        new_resolved = int(payload.resolved) if payload.resolved is not None else resolved

        conn.execute(
            "UPDATE inline_comments SET content = ?, resolved = ? WHERE id = ?",
            (new_content, new_resolved, clean_id),
        )

    return {
        "id": clean_id,
        "conversation_id": cid,
        "file_path": fp,
        "line_number": line_num,
        "author": author,
        "content": new_content,
        "parent_id": parent_id,
        "resolved": bool(new_resolved),
        "created_at": created_at,
        "has_agent_mention": "@agent" in new_content.lower(),
    }


def delete_comment(comment_id: str) -> bool:
    """Deletes a comment and cascades to any children replies."""
    ensure_comments_schema()
    clean_id = comment_id.strip()

    with _get_db() as conn:
        cursor = conn.execute(
            "DELETE FROM inline_comments WHERE id = ? OR parent_id = ?",
            (clean_id, clean_id),
        )
        return cursor.rowcount > 0
