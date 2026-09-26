import copy
import html
import json
import logging
import os
import re
import shutil
import sqlite3
import stat
import sys
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import BRAIN_DIR, CONVERSATION_DB, DEFAULT_WORKSPACE, SETTINGS_FILE
from app.platform_utils import (
    is_blocked_sensitive_path,
    is_safe_path,
    restrict_file_permissions,
)
from app.services.session_metadata import (
    bulk_delete_session_meta,
    delete_session_meta,
    get_all_session_metadata,
    get_session_meta,
    update_session_meta,
)

logger = logging.getLogger("antigravity.storage")


RESERVED_CONVERSATION_IDS: frozenset[str] = frozenset({
    "null", "undefined", "none", "",
    "logs", "log", "scratch", ".system_generated",
    "tmp", "temp", "system"
})


def is_safe_conversation_id(conversation_id: str) -> bool:
    """Verifies conversation_id is safe, contains no directory traversal elements, and stays inside BRAIN_DIR."""
    if not conversation_id or not isinstance(conversation_id, str):
        return False
    clean = conversation_id.strip()
    if clean.lower() in RESERVED_CONVERSATION_IDS:
        return False
    if clean.startswith(".") or ".." in clean or "/" in clean or "\\" in clean or "\x00" in clean:
        return False
    if not re.fullmatch(r"^[a-zA-Z0-9_\-]{1,128}$", clean):
        return False
    try:
        resolved_brain = BRAIN_DIR.resolve()
        resolved_conv = (BRAIN_DIR / clean).resolve()
        return resolved_conv.is_relative_to(resolved_brain) and resolved_conv != resolved_brain
    except Exception:
        return False


def _notify_conversations_changed() -> None:
    """Notifie les abonnés SSE d'une mise à jour de la liste des conversations."""
    try:
        from app.services.fs_watcher import notify_event_sync
        notify_event_sync({"type": "conversations_updated", "ts": time.time()})
    except Exception as e:
        logger.debug(f"Failed to notify conversations_updated: {e}")


def _notify_transcript_changed(conversation_id: str) -> None:
    """Notifie les abonnés SSE d'une mise à jour du transcript d'une conversation."""
    try:
        from app.services.fs_watcher import notify_event_sync
        notify_event_sync({
            "type": "transcript_updated",
            "conversation_id": conversation_id,
            "ts": time.time()
        })
    except Exception as e:
        logger.debug(f"Failed to notify transcript_updated for {conversation_id}: {e}")


def get_default_workspace_uri() -> str:
    """Safely return the default workspace as a file URI."""
    try:
        return Path(DEFAULT_WORKSPACE).resolve().as_uri()
    except Exception:
        resolved = str(Path(DEFAULT_WORKSPACE).resolve()).replace("\\", "/")
        if not resolved.startswith("/"):
            resolved = "/" + resolved
        return f"file://{resolved}"


def get_db_connection() -> sqlite3.Connection:
    # Crée le dossier parent si nécessaire (premier démarrage) ; sqlite3.connect crée la DB si absente.
    CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    # Double-checked locking: cheap read without lock, then initialize if needed under lock
    db_path_str = str(CONVERSATION_DB)
    if not _schema_initialized or db_path_str not in _initialized_db_paths:
        with _schema_lock:
            if not _schema_initialized or db_path_str not in _initialized_db_paths:
                ensure_db_schema(conn)
    return conn



_schema_initialized = False
_initialized_db_paths: set[str] = set()
_schema_lock = threading.RLock()


def ensure_db_schema(conn: sqlite3.Connection | None = None, force: bool = False) -> None:
    """Garantit l'existence de la table conversation_summaries dans la base SQLite."""
    global _schema_initialized
    if conn is not None:
        try:
            cur = conn.cursor()
            cur.execute("PRAGMA database_list")
            row = cur.fetchone()
            if row and len(row) >= 3 and row[2]:
                db_path_str = str(row[2])
            else:
                db_path_str = f"conn_{id(conn)}"
        except Exception:
            db_path_str = f"conn_{id(conn)}"
    else:
        db_path_str = str(CONVERSATION_DB)

    if conn is None:
        if _schema_initialized and db_path_str in _initialized_db_paths and not force:
            return
    else:
        if db_path_str in _initialized_db_paths and not force:
            return

    with _schema_lock:
        if conn is None:
            if _schema_initialized and db_path_str in _initialized_db_paths and not force:
                return
        else:
            if db_path_str in _initialized_db_paths and not force:
                return
        close_after = False
        if conn is None:
            CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
            conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
            conn.execute("PRAGMA busy_timeout=5000")
            close_after = True
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS conversation_summaries (
                    conversation_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    preview TEXT NOT NULL DEFAULT '',
                    step_count INTEGER NOT NULL DEFAULT 0,
                    last_modified_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    workspace_uris TEXT NOT NULL DEFAULT '[]',
                    status TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '',
                    project_id TEXT NOT NULL DEFAULT '',
                    agent_name TEXT NOT NULL DEFAULT '',
                    parent_conversation_id TEXT NOT NULL DEFAULT '',
                    nesting_depth INTEGER NOT NULL DEFAULT 0,
                    battle_id TEXT NOT NULL DEFAULT '',
                    winning_conversation_id TEXT NOT NULL DEFAULT '',
                    not_fully_idle NUMERIC NOT NULL DEFAULT 0,
                    killed NUMERIC NOT NULL DEFAULT 0,
                    last_user_input_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_user_input_step_index INTEGER NOT NULL DEFAULT -1,
                    app_data_dir TEXT NOT NULL DEFAULT '',
                    raw_summary BLOB,
                    group_id TEXT NOT NULL DEFAULT ''
                );
                """
            )
            # Automatic column migration for older database schemas
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(conversation_summaries)")
            existing_cols = {row[1] for row in cursor.fetchall()}

            expected_cols: dict[str, str] = {
                "title": "TEXT NOT NULL DEFAULT ''",
                "preview": "TEXT NOT NULL DEFAULT ''",
                "step_count": "INTEGER NOT NULL DEFAULT 0",
                "last_modified_time": "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
                "workspace_uris": "TEXT NOT NULL DEFAULT '[]'",
                "status": "TEXT NOT NULL DEFAULT ''",
                "source": "TEXT NOT NULL DEFAULT ''",
                "project_id": "TEXT NOT NULL DEFAULT ''",
                "agent_name": "TEXT NOT NULL DEFAULT ''",
                "parent_conversation_id": "TEXT NOT NULL DEFAULT ''",
                "nesting_depth": "INTEGER NOT NULL DEFAULT 0",
                "battle_id": "TEXT NOT NULL DEFAULT ''",
                "winning_conversation_id": "TEXT NOT NULL DEFAULT ''",
                "not_fully_idle": "NUMERIC NOT NULL DEFAULT 0",
                "killed": "NUMERIC NOT NULL DEFAULT 0",
                "last_user_input_time": "DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP",
                "last_user_input_step_index": "INTEGER NOT NULL DEFAULT -1",
                "app_data_dir": "TEXT NOT NULL DEFAULT ''",
                "raw_summary": "BLOB",
                "group_id": "TEXT NOT NULL DEFAULT ''",
            }
            for col_name, col_def in expected_cols.items():
                if col_name not in existing_cols:
                    clean_def = col_def.rstrip(",")
                    try:
                        conn.execute(f"ALTER TABLE conversation_summaries ADD COLUMN {col_name} {clean_def}")
                    except Exception as alter_err:
                        logger.debug(f"Column {col_name} migration notice: {alter_err}")

            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conv_last_modified ON conversation_summaries(last_modified_time DESC);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conv_parent ON conversation_summaries(parent_conversation_id);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conv_project_id ON conversation_summaries(project_id);"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_conv_group_id ON conversation_summaries(group_id);"
            )
            conn.commit()
            if conn is None or db_path_str == str(CONVERSATION_DB):
                _schema_initialized = True
            _initialized_db_paths.add(db_path_str)
        except Exception as e:
            logger.warning(f"ensure_db_schema warning: {e}")
        finally:
            if close_after:
                conn.close()

_ALLOWED_CONVERSATION_SUMMARY_COLUMNS: frozenset[str] = frozenset({
    "conversation_id",
    "title",
    "preview",
    "step_count",
    "last_modified_time",
    "workspace_uris",
    "status",
    "source",
    "project_id",
    "agent_name",
    "parent_conversation_id",
    "nesting_depth",
    "battle_id",
    "winning_conversation_id",
    "not_fully_idle",
    "killed",
    "last_user_input_time",
    "last_user_input_step_index",
    "app_data_dir",
    "raw_summary",
    "group_id",
})


def _build_conversation_dict(r: sqlite3.Row, meta: dict) -> dict:
    """Construit le dict conversation à partir d'une ligne SQLite et des métadonnées session."""
    cid = r["conversation_id"]
    custom_title = (meta.get("customTitle") or meta.get("custom_title") or "").strip()
    display_title = custom_title or r["title"] or "Nouvelle session"
    raw_tags = meta.get("tags")
    safe_tags = list(raw_tags) if isinstance(raw_tags, list) else []
    raw_lmt = r["last_modified_time"]
    if hasattr(raw_lmt, "isoformat"):
        safe_lmt = raw_lmt.isoformat()
    elif isinstance(raw_lmt, (int, float)):
        ts = float(raw_lmt)
        if ts > 100_000_000_000:
            ts /= 1000.0
        try:
            safe_lmt = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
        except (OverflowError, ValueError, OSError):
            safe_lmt = str(raw_lmt)
    elif isinstance(raw_lmt, str) and raw_lmt.strip():
        stripped_lmt = raw_lmt.strip()
        if stripped_lmt.replace(".", "", 1).isdigit():
            try:
                ts = float(stripped_lmt)
                if ts > 100_000_000_000:
                    ts /= 1000.0
                safe_lmt = datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
            except (OverflowError, ValueError, OSError):
                safe_lmt = stripped_lmt
        else:
            safe_lmt = stripped_lmt
    else:
        safe_lmt = str(raw_lmt) if raw_lmt is not None else ""

    parent_id = None
    try:
        parent_id = r["parent_conversation_id"] or None
    except (IndexError, KeyError):
        parent_id = None

    project_id = ""
    try:
        project_id = str(r["project_id"] or "")
    except (IndexError, KeyError):
        project_id = ""

    group_id = ""
    try:
        group_id = str(r["group_id"] or "")
    except (IndexError, KeyError):
        group_id = ""

    meta_project = str(meta.get("project") or "").strip()
    meta_project_id = str(meta.get("project_id") or meta.get("projectId") or "").strip()

    resolved_project_id = project_id or meta_project_id or meta_project
    resolved_project = meta_project or meta_project_id or project_id
    resolved_group = group_id or str(meta.get("group_id") or meta.get("groupId") or "").strip()

    ws_uris = r["workspace_uris"]
    if ws_uris is None:
        safe_ws_uris = "[]"
    elif isinstance(ws_uris, str):
        safe_ws_uris = ws_uris
    else:
        try:
            safe_ws_uris = json.dumps(ws_uris)
        except Exception:
            safe_ws_uris = "[]"

    return {
        "conversation_id": cid,
        "title": display_title,
        "raw_title": r["title"] or "Nouvelle session",
        "preview": r["preview"],
        "step_count": r["step_count"],
        "last_modified_time": safe_lmt,
        "workspace_uris": safe_ws_uris,
        "status": r["status"],
        "agent_name": r["agent_name"],
        "parent_conversation_id": parent_id,
        "project_id": resolved_project_id,
        "group_id": resolved_group,
        "pinned": bool(meta.get("pinned", False)),
        "archived": bool(meta.get("archived", False)),
        "tags": safe_tags,
        "project": resolved_project,
        "projectColor": str(meta.get("projectColor") or ""),
        "customTitle": custom_title,
    }



def list_conversations(limit: int = 100) -> list[dict[str, Any]]:
    if not CONVERSATION_DB.exists():
        return []
    
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                project_id,
                group_id
            FROM conversation_summaries
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (limit * 2,)  # fetch more to allow sorting pinned items
        )
        rows = list(cursor.fetchall())
        all_meta = get_all_session_metadata()

        # Guarantee all pinned conversations are fetched even if older than limit * 2
        pinned_ids = [cid for cid, m in all_meta.items() if m.get("pinned") and is_safe_conversation_id(cid)]
        fetched_ids = {r["conversation_id"] for r in rows}
        missing_pinned = [cid for cid in pinned_ids if cid not in fetched_ids]
        if missing_pinned:
            # Chunk missing_pinned in batches of 500 to avoid SQLite variable limits
            chunk_size = 500
            for i in range(0, len(missing_pinned), chunk_size):
                chunk = missing_pinned[i : i + chunk_size]
                placeholders = ",".join("?" * len(chunk))
                query_sql = (
                    f"SELECT conversation_id, title, preview, step_count, last_modified_time, workspace_uris, status, agent_name, parent_conversation_id, project_id, group_id FROM conversation_summaries WHERE conversation_id IN ({placeholders})"  # nosec B608
                )
                cursor.execute(query_sql, tuple(chunk))
                rows.extend(cursor.fetchall())

        result = []
        for r in rows:
            cid = r["conversation_id"]
            meta = all_meta.get(cid, {})
            result.append(_build_conversation_dict(r, meta))


        # Sort pinned conversations first, then by last_modified_time descending (newest first)
        result.sort(key=lambda x: (1 if x["pinned"] else 0, x["last_modified_time"] or ""), reverse=True)
        return result[:limit]
    finally:
        conn.close()

def get_conversation_by_id(conversation_id: str, conn: Any = None) -> dict[str, Any] | None:
    if not CONVERSATION_DB.exists():
        return None
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT 
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                project_id,
                group_id
            FROM conversation_summaries
            WHERE conversation_id = ?
            LIMIT 1
            """,
            (conversation_id,)
        )
        r = cursor.fetchone()
        if not r:
            return None
        meta = get_session_meta(conversation_id)
        return _build_conversation_dict(r, meta)
    finally:
        if should_close:
            conn.close()


def get_conversation_transcript(conversation_id: str) -> list[dict[str, Any]]:
    if not is_safe_conversation_id(conversation_id):
        return []
    conv_dir = BRAIN_DIR / conversation_id
    transcript_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    transcript_full_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"
    legacy_file = conv_dir / "transcript.jsonl"

    target_file = None
    has_canonical = transcript_full_file.exists() or transcript_file.exists()
    if transcript_full_file.exists() and transcript_full_file.stat().st_size > 0:
        target_file = transcript_full_file
    elif transcript_file.exists() and transcript_file.stat().st_size > 0:
        target_file = transcript_file
    elif not has_canonical and legacy_file.exists() and legacy_file.stat().st_size > 0:
        target_file = legacy_file
    elif transcript_full_file.exists():
        target_file = transcript_full_file
    elif transcript_file.exists():
        target_file = transcript_file
    elif legacy_file.exists():
        target_file = legacy_file

    if not target_file:
        return []

    steps = []
    try:
        with open(target_file, "r", encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                line_str = line.strip().lstrip("\ufeff")
                if not line_str:
                    continue
                try:
                    steps.append(json.loads(line_str))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.debug(f"Ignored error: {e}")
    return steps


_TAGS_PATTERN = (
    r"ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|CONTEXT_SUMMARY|SKILLS|"
    r"USER_INFORMATION|SYSTEM_MESSAGE|ENVIRONMENT_DETAILS|IDENTITY|SUBAGENTS|"
    r"MESSAGING|CONVERSATION_TRANSCRIPT|ARTIFACTS|SLASH_COMMANDS|GUIDELINES|"
    r"COMMUNICATION_STYLE|SKILL_CALL|EXTENSIONS|SYSTEM_PROMPT|PLANNER_RESPONSE|"
    r"TOOL_CALL|AGENT_MODE"
)
_USER_REQUEST_RE = re.compile(r'<USER_REQUEST(?:\s+[^>]*)?>([\s\S]*?)</USER_REQUEST>', re.IGNORECASE)
_CONTEXT_SUMMARY_RE = re.compile(r'<CONTEXT_SUMMARY(?:\s+[^>]*)?>[\s\S]*?</CONTEXT_SUMMARY>', re.IGNORECASE)
_XML_BLOCKS_RE = re.compile(
    rf'<({_TAGS_PATTERN})(?:\s+[^>]*)?>[\s\S]*?</\1>',
    re.IGNORECASE,
)
_XML_TAGS_RE = re.compile(
    rf'</?(?:USER_REQUEST|{_TAGS_PATTERN})(?:\s+[^>]*)?>',
    re.IGNORECASE,
)
_STEERING_PREFIX_RE = re.compile(
    r'^(?:⚡\s*\[(?:Guidage|Steering)\]\s*|📥\s*\[(?:En attente|Queued)\]\s*|\[(?:Instruction Prioritaire de Guidage|Priority Steering Instruction)\]\s*:?\s*)+',
    re.IGNORECASE,
)
_THOUGHT_TAGS_RE = re.compile(
    r'<(?:thinking|thought|think|reasoning)>([\s\S]*?)</(?:thinking|thought|think|reasoning)>',
    re.IGNORECASE,
)
_COMMAND_FAILURE_RE = re.compile(
    r'(?:The command exited with code (?!0\b)\d+|Command exited with code (?!0\b)\d+|Exit code: (?!0\b)\d+|process terminated with exit code)',
    re.IGNORECASE,
)


def clean_user_prompt(raw: Any) -> str:
    if not raw:
        return ""
    if isinstance(raw, str) and (raw.strip().startswith("{") or raw.strip().startswith("[")):
        try:
            parsed = json.loads(raw.strip())
            if isinstance(parsed, (dict, list)):
                cleaned = clean_user_prompt(parsed)
                if cleaned:
                    return cleaned
        except Exception:
            pass
    if not isinstance(raw, str):
        if isinstance(raw, list):
            parts: list[str] = []
            for item in raw:
                if isinstance(item, str):
                    parts.append(item)
                elif isinstance(item, dict):
                    if "text" in item and isinstance(item["text"], str):
                        parts.append(item["text"])
                    elif "content" in item and isinstance(item["content"], str):
                        parts.append(item["content"])
                    elif "content" in item and isinstance(item["content"], list):
                        for sub in item["content"]:
                            if isinstance(sub, str):
                                parts.append(sub)
                            elif isinstance(sub, dict) and "text" in sub and isinstance(sub["text"], str):
                                parts.append(sub["text"])
            if parts:
                raw = "\n".join(parts)
            else:
                try:
                    raw = str(raw)
                except Exception:
                    return ""
        elif isinstance(raw, dict):
            if "text" in raw and isinstance(raw["text"], str):
                raw = raw["text"]
            elif "prompt" in raw and isinstance(raw["prompt"], str):
                raw = raw["prompt"]
            elif "content" in raw and isinstance(raw["content"], str):
                raw = raw["content"]
            elif "content" in raw and isinstance(raw["content"], list):
                parts = []
                for sub in raw["content"]:
                    if isinstance(sub, str):
                        parts.append(sub)
                    elif isinstance(sub, dict) and "text" in sub and isinstance(sub["text"], str):
                        parts.append(sub["text"])
                    elif isinstance(sub, dict) and "prompt" in sub and isinstance(sub["prompt"], str):
                        parts.append(sub["prompt"])
                raw = "\n".join(parts) if parts else ""
            else:
                try:
                    raw = json.dumps(raw, ensure_ascii=False)
                except Exception:
                    try:
                        raw = str(raw)
                    except Exception:
                        return ""
        else:
            try:
                raw = str(raw)
            except Exception:
                return ""
    # 1. Retirer d'abord le bloc de résumé de contexte pour éviter d'extraire d'anciennes requêtes archivées
    text_no_context = _CONTEXT_SUMMARY_RE.sub('', raw)

    # 2. Si une balise explicite <USER_REQUEST> existe, extraire son contenu en préservant le code interne
    matches = _USER_REQUEST_RE.findall(text_no_context)
    if matches:
        text = matches[-1].strip()
    else:
        # Repli pour les invites brutes sans balise <USER_REQUEST>
        text = _XML_BLOCKS_RE.sub('', raw)
        text = _XML_TAGS_RE.sub('', text)

    # 3. Retirer les préfixes de guidage/file d'attente
    text = _STEERING_PREFIX_RE.sub('', text)
    return text.strip()


def calculate_conversation_tokens(steps: list[dict[str, Any]]) -> dict[str, Any]:
    if not steps:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "thinking_tokens": 0,
            "total_tokens": 0,
            "is_estimated": True
        }

    # Check if any recent step has exact usage metadata from agy
    for s in reversed(steps):
        if not isinstance(s, dict):
            continue
        u = s.get("usage") or s.get("usage_metadata") or s.get("usageMetadata")
        if not u and isinstance(s.get("result"), dict):
            u = s["result"].get("usage") or s["result"].get("usage_metadata") or s["result"].get("usageMetadata")
        if not u and isinstance(s.get("step_update"), dict):
            u = s["step_update"].get("usage") or s["step_update"].get("usage_metadata") or s["step_update"].get("usageMetadata")
        if not u and isinstance(s.get("metadata"), dict):
            u = s["metadata"].get("usage") or s["metadata"].get("usage_metadata") or s["metadata"].get("usageMetadata")
        if not u and s.get("token_count"):
            tc = s.get("token_count")
            if isinstance(tc, dict):
                u = tc
            elif isinstance(tc, (int, float)) and tc > 0:
                return {
                    "input_tokens": 0,
                    "output_tokens": 0,
                    "thinking_tokens": 0,
                    "total_tokens": int(tc),
                    "is_estimated": False,
                }
        if isinstance(u, dict):
            def _to_int(val: Any) -> int:
                if val is None:
                    return 0
                try:
                    return int(val)
                except (ValueError, TypeError):
                    return 0

            inp_val = (
                u.get("input_tokens")
                if u.get("input_tokens") is not None
                else (
                    u.get("prompt_tokens")
                    if u.get("prompt_tokens") is not None
                    else (
                        u.get("promptTokenCount")
                        if u.get("promptTokenCount") is not None
                        else u.get("prompt_token_count")
                    )
                )
            )
            out_val = (
                u.get("output_tokens")
                if u.get("output_tokens") is not None
                else (
                    u.get("completion_tokens")
                    if u.get("completion_tokens") is not None
                    else (
                        u.get("candidatesTokenCount")
                        if u.get("candidatesTokenCount") is not None
                        else u.get("candidates_token_count")
                    )
                )
            )
            thk_val = (
                u.get("thinking_tokens")
                or u.get("reasoning_tokens")
                or u.get("thinkingTokenCount")
                or u.get("thoughtsTokenCount")
                or u.get("thinking_token_count")
                or 0
            )
            tot_val = (
                u.get("total_tokens")
                if u.get("total_tokens") is not None
                else (
                    u.get("totalTokenCount")
                    if u.get("totalTokenCount") is not None
                    else u.get("total_token_count")
                )
            )

            inp = _to_int(inp_val)
            out = _to_int(out_val)
            thk = _to_int(thk_val)
            tot = _to_int(tot_val)

            if tot == 0:
                tot = inp + out + thk
            if tot > 0:
                return {
                    "input_tokens": inp,
                    "output_tokens": out,
                    "thinking_tokens": thk,
                    "total_tokens": tot,
                    "is_estimated": False,
                }

    # Antigravity base system context (system prompt + 30+ tool definitions + schemas)
    base_sys_tokens = 13370
    
    prompt_chars = 0
    response_chars = 0
    thinking_chars = 0
    
    for s in steps:
        if not isinstance(s, dict):
            continue
        raw_c = s.get("content")
        try:
            content = raw_c if isinstance(raw_c, str) else (json.dumps(raw_c, ensure_ascii=False, default=str) if raw_c is not None else "")
        except Exception:
            content = str(raw_c) if raw_c is not None else ""

        raw_t = s.get("thinking")
        try:
            thinking = raw_t if isinstance(raw_t, str) else (json.dumps(raw_t, ensure_ascii=False, default=str) if raw_t is not None else "")
        except Exception:
            thinking = str(raw_t) if raw_t is not None else ""

        try:
            tool_calls = json.dumps(s.get("tool_calls") or [], default=str) if s.get("tool_calls") else ""
        except Exception:
            tool_calls = str(s.get("tool_calls") or "")
        
        src = s.get("source") or ""
        stype = s.get("type") or ""
        
        if src == "USER_EXPLICIT" or stype == "USER_INPUT":
            clean_p = clean_user_prompt(raw_c if raw_c is not None else content)
            prompt_chars += len(clean_p) if clean_p else len(content)
        else:
            response_chars += len(content) + len(tool_calls)
            thinking_chars += len(thinking)

    if prompt_chars == 0 and response_chars == 0 and thinking_chars == 0:
        return {
            "input_tokens": 0,
            "output_tokens": 0,
            "thinking_tokens": 0,
            "total_tokens": 0,
            "is_estimated": True
        }

    p_tokens = max(1, int(prompt_chars / 3.8)) if prompt_chars > 0 else 0
    r_tokens = max(1, int(response_chars / 3.8)) if response_chars > 0 else 0
    t_tokens = max(0, int(thinking_chars / 3.8)) if thinking_chars > 0 else 0
    
    input_tokens = base_sys_tokens + p_tokens
    output_tokens = max(0, r_tokens + t_tokens)
    total_tokens = input_tokens + output_tokens

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": t_tokens,
        "total_tokens": total_tokens,
        "is_estimated": True
    }

def _safe_atomic_replace(tmp_file: Path, target_path: Path, max_retries: int = 5) -> None:
    """
    Remplacement atomique résilient aux verrous de fichiers temporaires sous Windows.
    Effectue des réessais avec backoff et un repli en écriture directe si le renommage est bloqué.
    """
    try:
        for attempt in range(max_retries):
            try:
                tmp_file.replace(target_path)
                return
            except (PermissionError, OSError) as e:
                if attempt < max_retries - 1:
                    time.sleep(0.05 * (attempt + 1))
                else:
                    try:
                        target_path.write_bytes(tmp_file.read_bytes())
                        return
                    except Exception:
                        raise e
    finally:
        try:
            if tmp_file.exists() and tmp_file.resolve() != target_path.resolve():
                tmp_file.unlink(missing_ok=True)
        except Exception:
            pass


def atomic_write_jsonl(target_path: Path, items: list[dict[str, Any]]) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = target_path.parent / f".{target_path.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        tmp_file.touch(mode=0o600, exist_ok=True)
        restrict_file_permissions(tmp_file)
        with open(tmp_file, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(item, ensure_ascii=False, default=str) + "\n" for item in items)
        restrict_file_permissions(tmp_file)
        _safe_atomic_replace(tmp_file, target_path)
        restrict_file_permissions(target_path)
    except Exception:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception as e:
                logger.debug(f"Ignored error: {e}")
        raise

_USER_METADATA_CHECK_RE = re.compile(
    r'<(?:USER_REQUEST|ADDITIONAL_METADATA|CONTEXT_SUMMARY|USER_SETTINGS_CHANGE|SKILLS|USER_INFORMATION|SYSTEM_MESSAGE|ENVIRONMENT_DETAILS|IDENTITY)>',
    re.IGNORECASE,
)
_TASK_NOTIFY_RE = re.compile(r'Task id "([^"]+)" finished with result:\s*([\s\S]*)', re.IGNORECASE)
_SYSTEM_MESSAGE_TAG_RE = re.compile(r'<SYSTEM_MESSAGE>([\s\S]*?)</SYSTEM_MESSAGE>', re.IGNORECASE)

TOOL_STEP_TYPES: set[str] = {
    "GENERIC",
    "SYSTEM",
    "TOOL_RESULT",
    "TOOL_OUTPUT",
    "VIEW_FILE",
    "RUN_COMMAND",
    "CODE_ACTION",
    "GREP_SEARCH",
    "LIST_DIRECTORY",
    "LIST_DIR",
    "WRITE_TO_FILE",
    "REPLACE_FILE_CONTENT",
    "SEARCH_WEB",
    "READ_URL_CONTENT",
    "FIND_BY_NAME",
    "MANAGE_TASK",
    "SCHEDULE",
    "ASK_QUESTION",
    "INVOKE_SUBAGENT",
    "MANAGE_SUBAGENTS",
    "DEFINE_SUBAGENT",
    "GENERATE_IMAGE",
}


def is_tool_output_content(content: Any) -> bool:
    if not content:
        return False
    c = content[:256].lstrip() if isinstance(content, str) else str(content)[:256].lstrip()
    return c.startswith((
        "Created At:",
        "Completed At:",
        "File Path:",
        "The command exited with code",
        "The command exited",
        "Tool is running as a background task",
        "Encountered error in tool execution:",
        "Exit code:",
        "process terminated",
        "Process terminated",
        "Command exited with code",
        '{"File":',
        '{"status":',
        '{"event":',
        '{"step_index":',
        '{"type":',
        '[{"File":',
        '[{"status":',
        '[{"name":',
        '[{"step_index":',
        'Task id "',
        "[Active skills:",
        "Starting background task",
    ))


def truncate_tool_output(content: Any, max_lines: int = 50, max_chars: int = 3500) -> tuple[str, bool]:
    """
    Tronque intelligemment les sorties verbeuses d'outils et de terminal (Head + Tail).
    Préserve les premières lignes (contexte/lancement) et les dernières lignes (résultat/erreur).
    Retourne (texte_tronque, a_ete_tronque).
    """
    if content is None:
        return "", False
    if not isinstance(content, str):
        try:
            content = json.dumps(content, ensure_ascii=False, default=str)
        except Exception:
            content = str(content)

    lines = content.splitlines(keepends=True)
    if len(lines) <= max_lines and len(content) <= max_chars:
        return content, False

    head_n = min(20, max_lines // 2)
    tail_n = min(20, max_lines // 2)

    if len(lines) > max_lines:
        head = "".join(lines[:head_n])
        tail = "".join(lines[-tail_n:])
        omitted = len(lines) - head_n - tail_n
        marker = f"\n\n[... SORTIE TRONQUÉE : {omitted} lignes masquées pour préserver les tokens ...]\n\n"
        return head + marker + tail, True

    half = max_chars // 2
    omitted_chars = len(content) - max_chars
    marker = f"\n\n[... SORTIE TRONQUÉE : {omitted_chars} caractères masqués pour préserver les tokens ...]\n\n"
    return content[:half] + marker + content[-half:], True


def auto_truncate_transcript(conversation_id: str, max_lines: int = 30, max_chars: int = 2500) -> dict[str, Any]:
    """
    Scanne transcript.jsonl et tronque toute sortie volumineuse d'outil/terminal.
    Sauvegarde systématiquement l'historique complet dans transcript_full.jsonl.
    """
    if not is_safe_conversation_id(conversation_id):
        return {"truncated_steps_count": 0, "chars_saved": 0}

    conv_dir = BRAIN_DIR / conversation_id
    logs_dir = conv_dir / ".system_generated" / "logs"
    transcript_path = logs_dir / "transcript.jsonl"
    transcript_full_path = logs_dir / "transcript_full.jsonl"

    if not transcript_path.exists() or transcript_path.stat().st_size == 0:
        return {"truncated_steps_count": 0, "chars_saved": 0}

    raw_lines: list[str] = []
    try:
        with open(transcript_path, "r", encoding="utf-8-sig", errors="replace") as f:
            raw_lines = [l.strip().lstrip("\ufeff") for l in f if l.strip().lstrip("\ufeff")]
    except Exception as e:
        logger.debug(f"Failed to read transcript for auto_truncate: {e}")
        return {"truncated_steps_count": 0, "chars_saved": 0}

    steps: list[dict[str, Any]] = []
    for l in raw_lines:
        try:
            steps.append(json.loads(l))
        except Exception:
            continue

    if not steps:
        return {"truncated_steps_count": 0, "chars_saved": 0}

    # S'assurer que transcript_full.jsonl existe avec la version complète avant troncature
    if not transcript_full_path.exists() or transcript_full_path.stat().st_size < transcript_path.stat().st_size:
        atomic_write_jsonl(transcript_full_path, steps)

    truncated_count = 0
    chars_saved = 0
    modified = False

    for s in steps:
        stype = (s.get("type") or "").upper()
        if stype in TOOL_STEP_TYPES or is_tool_output_content(s.get("content")):
            cnt = s.get("content")
            if isinstance(cnt, str) and (len(cnt.splitlines()) > max_lines or len(cnt) > max_chars):
                old_len = len(cnt)
                trunc_cnt, was_trunc = truncate_tool_output(cnt, max_lines=max_lines, max_chars=max_chars)
                if was_trunc:
                    s["content"] = trunc_cnt
                    s["is_truncated"] = True
                    tf = s.get("truncated_fields") or []
                    if "content" not in tf:
                        tf.append("content")
                    s["truncated_fields"] = tf
                    chars_saved += (old_len - len(trunc_cnt))
                    truncated_count += 1
                    modified = True

    if modified:
        atomic_write_jsonl(transcript_path, steps)
        _notify_transcript_changed(conversation_id)

    return {
        "truncated_steps_count": truncated_count,
        "chars_saved": chars_saved
    }


def compact_conversation_in_place(conversation_id: str, preserve_last_n_turns: int = 2) -> dict[str, Any]:
    """
    Compacte directement une conversation existante :
    - Sauvegarde l'historique complet dans transcript_full.jsonl.
    - Pour tous les outils antérieurs aux N derniers tours utilisateur, compresse
      les sorties verbeuses en un résumé concis d'une ligne.
    - Met à jour transcript.jsonl atomiquement.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conv_dir = BRAIN_DIR / conversation_id
    logs_dir = conv_dir / ".system_generated" / "logs"
    transcript_path = logs_dir / "transcript.jsonl"
    transcript_full_path = logs_dir / "transcript_full.jsonl"

    if not transcript_path.exists():
        raise ValueError("Aucun transcript à compacter")
    if transcript_path.stat().st_size == 0:
        return {"status": "ok", "conversation_id": conversation_id, "compacted_steps": 0, "chars_saved": 0, "tokens_saved": 0, "reduction_pct": 0.0}

    raw_lines: list[str] = []
    with open(transcript_path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw_lines = [l.strip().lstrip("\ufeff") for l in f if l.strip().lstrip("\ufeff")]

    steps: list[dict[str, Any]] = []
    for l in raw_lines:
        try:
            steps.append(json.loads(l))
        except Exception:
            continue

    if not steps:
        return {"status": "ok", "conversation_id": conversation_id, "compacted_steps": 0, "chars_saved": 0, "tokens_saved": 0, "reduction_pct": 0.0}

    # Sauvegarde complète systématique
    if not transcript_full_path.exists() or transcript_full_path.stat().st_size < transcript_path.stat().st_size:
        atomic_write_jsonl(transcript_full_path, steps)

    user_step_indices = [
        i for i, s in enumerate(steps)
        if (
            (s.get("type") or "").upper() == "USER_INPUT"
            or (s.get("source") or "").upper() == "USER_EXPLICIT"
            or (s.get("role") or "").lower() == "user"
        )
    ]

    boundary_idx = 0
    if len(user_step_indices) > preserve_last_n_turns:
        boundary_idx = user_step_indices[-preserve_last_n_turns]

    compacted_count = 0
    chars_before = sum(len(str(s.get("content") or "")) for s in steps)

    for i in range(boundary_idx):
        s = steps[i]
        stype = (s.get("type") or "").upper()
        if stype in TOOL_STEP_TYPES or is_tool_output_content(s.get("content")):
            cnt = str(s.get("content") or "")
            if len(cnt) > 200:
                is_err = s.get("status") == "ERROR" or bool(s.get("error"))
                status_desc = "Erreur" if is_err else "Succès"
                s["content"] = f"[✓ {status_desc} — Résultat d'étape archivé dans transcript_full.jsonl pour économie de tokens]"
                s["is_truncated"] = True
                s["truncated_fields"] = ["content"]
                compacted_count += 1

    chars_after = sum(len(str(s.get("content") or "")) for s in steps)
    chars_saved = max(0, chars_before - chars_after)
    tokens_saved = int(chars_saved / 3.8)

    atomic_write_jsonl(transcript_path, steps)
    _notify_transcript_changed(conversation_id)

    return {
        "status": "ok",
        "conversation_id": conversation_id,
        "compacted_steps": compacted_count,
        "chars_saved": chars_saved,
        "tokens_saved": tokens_saved,
        "reduction_pct": round((chars_saved / max(1, chars_before)) * 100, 1)
    }


def prune_conversation_steps(
    conversation_id: str,
    step_indices: list[int] | None = None,
    preserve_last_n_turns: int = 2
) -> dict[str, Any]:
    """
    Élagage ciblé d'étapes de conversation :
    - Sauvegarde l'intégralité dans transcript_full.jsonl.
    - Si step_indices est fourni, élague précisément ces étapes.
    - Si step_indices est None/vide, applique la préservation des N derniers tours.
    - Tronque le contenu verbeux tout en conservant statut, rôle et type.
    - Écrit atomiquement transcript.jsonl et notifie les observateurs.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conv_dir = BRAIN_DIR / conversation_id
    logs_dir = conv_dir / ".system_generated" / "logs"
    transcript_path = logs_dir / "transcript.jsonl"
    transcript_full_path = logs_dir / "transcript_full.jsonl"

    if not transcript_path.exists() or transcript_path.stat().st_size == 0:
        raise ValueError("Aucun transcript à élaguer")

    raw_lines: list[str] = []
    with open(transcript_path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw_lines = [l.strip().lstrip("\ufeff") for l in f if l.strip().lstrip("\ufeff")]

    steps: list[dict[str, Any]] = []
    for l in raw_lines:
        try:
            steps.append(json.loads(l))
        except Exception:
            continue

    if not steps:
        raise ValueError("Transcript vide ou corrompu")

    if not transcript_full_path.exists() or transcript_full_path.stat().st_size < transcript_path.stat().st_size:
        atomic_write_jsonl(transcript_full_path, steps)

    chars_before = sum(len(str(s.get("content") or "")) for s in steps)
    pruned_count = 0

    target_indices_set = set(step_indices) if step_indices is not None and len(step_indices) > 0 else None

    if target_indices_set is not None:
        for idx in target_indices_set:
            if 0 <= idx < len(steps):
                s = steps[idx]
                cnt = str(s.get("content") or "")
                if len(cnt) > 120:
                    is_err = s.get("status") == "ERROR" or bool(s.get("error"))
                    status_desc = "Erreur" if is_err else "Succès"
                    s["content"] = f"[✓ {status_desc} — Contenu élagué pour économie de tokens. Version intégrale dans transcript_full.jsonl]"
                    s["is_truncated"] = True
                    s["truncated_fields"] = ["content"]
                    pruned_count += 1
    else:
        user_step_indices = [
            i for i, s in enumerate(steps)
            if (
                (s.get("type") or "").upper() == "USER_INPUT"
                or (s.get("source") or "").upper() == "USER_EXPLICIT"
                or (s.get("role") or "").lower() == "user"
            )
        ]
        boundary_idx = 0
        if len(user_step_indices) > preserve_last_n_turns:
            boundary_idx = user_step_indices[-preserve_last_n_turns]

        for i in range(boundary_idx):
            s = steps[i]
            stype = (s.get("type") or "").upper()
            if stype in TOOL_STEP_TYPES or is_tool_output_content(s.get("content")):
                cnt = str(s.get("content") or "")
                if len(cnt) > 120:
                    is_err = s.get("status") == "ERROR" or bool(s.get("error"))
                    status_desc = "Erreur" if is_err else "Succès"
                    s["content"] = f"[✓ {status_desc} — Contenu élagué pour économie de tokens. Version intégrale dans transcript_full.jsonl]"
                    s["is_truncated"] = True
                    s["truncated_fields"] = ["content"]
                    pruned_count += 1

    chars_after = sum(len(str(s.get("content") or "")) for s in steps)
    chars_saved = max(0, chars_before - chars_after)
    tokens_saved = int(chars_saved / 3.8)

    atomic_write_jsonl(transcript_path, steps)
    _notify_transcript_changed(conversation_id)

    return {
        "status": "ok",
        "conversation_id": conversation_id,
        "pruned_steps": pruned_count,
        "chars_saved": chars_saved,
        "tokens_saved": tokens_saved,
        "reduction_pct": round((chars_saved / max(1, chars_before)) * 100, 1)
    }


def _safe_copy_artifacts(source_dir: Path, target_dir: Path) -> None:
    """
    Copie de façon sécurisée les artefacts d'une session source vers une session cible.
    Exclut les dossiers système, fichiers temporaires, fichiers sensibles et liens symboliques.
    """
    if not source_dir.exists() or not source_dir.is_dir():
        return

    def _ignore_unsafe(dir_path: str, names: list[str]) -> set[str]:
        ignored = set()
        for name in names:
            p = Path(dir_path) / name
            try:
                if (
                    p.is_symlink()
                    or name in (".system_generated", "scratch")
                    or name.startswith((".", ".tmp", ".lock"))
                    or is_blocked_sensitive_path(p)
                ):
                    ignored.add(name)
            except Exception:
                ignored.add(name)
        return ignored

    for item in source_dir.iterdir():
        if item.name in (".system_generated", "scratch") or item.name.startswith((".", ".tmp", ".lock")):
            continue
        target: Path | None = None
        try:
            # Ne jamais suivre de lien symbolique (évite les traversées et boucles)
            if item.is_symlink():
                continue
            resolved_item = item.resolve()
            if not is_safe_path(resolved_item, [source_dir]) or is_blocked_sensitive_path(resolved_item):
                continue
            target = target_dir / item.name
            if item.is_file():
                shutil.copy2(item, target, follow_symlinks=False)
            elif item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True, symlinks=False, ignore=_ignore_unsafe)
        except Exception as e:
            logger.warning(f"Failed to copy artifact {item.name}: {e}")
            if target is not None and target.exists() and item.is_file():
                try:
                    target.unlink(missing_ok=True)
                except OSError as unl_err:
                    logger.debug(f"Failed to remove incomplete artifact copy {target}: {unl_err}")


def fork_conversation(
    source_conversation_id: str,
    up_to_step_index: int,
    new_title: str | None = None
) -> dict[str, Any]:
    if not is_safe_conversation_id(source_conversation_id):
        raise ValueError("Identifiant de conversation source non valide")
    source_compact_file = BRAIN_DIR / source_conversation_id / ".system_generated" / "logs" / "transcript.jsonl"
    source_steps = []
    if source_compact_file.exists() and source_compact_file.stat().st_size > 0:
        try:
            with open(source_compact_file, "r", encoding="utf-8-sig", errors="replace") as cf:
                for line in cf:
                    line_str = line.strip().lstrip("\ufeff")
                    if not line_str:
                        continue
                    try:
                        source_steps.append(json.loads(line_str))
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            logger.debug(f"Failed reading source_compact_file: {e}")
            source_steps = []
    if not source_steps:
        source_steps = get_conversation_transcript(source_conversation_id)
    if not source_steps:
        raise ValueError(f"Aucun historique trouvé pour la conversation {source_conversation_id}")

    # Keep steps up to up_to_step_index
    forked_steps = [s for s in source_steps if s.get("step_index", 0) <= up_to_step_index]
    if not forked_steps:
        forked_steps = source_steps[:1]

    new_id = str(uuid.uuid4())
    new_conv_dir = BRAIN_DIR / new_id
    new_logs_dir = new_conv_dir / ".system_generated" / "logs"
    new_logs_dir.mkdir(parents=True, exist_ok=True)

    # Write new transcript.jsonl and transcript_full.jsonl
    transcript_path = new_logs_dir / "transcript.jsonl"
    transcript_full_path = new_logs_dir / "transcript_full.jsonl"

    # Read full steps if available from source
    source_full_file = BRAIN_DIR / source_conversation_id / ".system_generated" / "logs" / "transcript_full.jsonl"
    source_full_steps = []
    if source_full_file.exists():
        try:
            with open(source_full_file, "r", encoding="utf-8-sig", errors="replace") as sf:
                for line in sf:
                    line_str = line.strip().lstrip("\ufeff")
                    if not line_str:
                        continue
                    try:
                        source_full_steps.append(json.loads(line_str))
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            logger.debug(f"Failed reading source_full_file: {e}")
            source_full_steps = []

    forked_full_steps = [s for s in source_full_steps if s.get("step_index", 0) <= up_to_step_index] if source_full_steps else forked_steps
    if not forked_full_steps:
        forked_full_steps = forked_steps

    forked_transcripts = []
    for idx, step in enumerate(forked_steps):
        cloned = copy.deepcopy(step)
        if "conversation_id" in cloned:
            cloned["conversation_id"] = new_id
        cloned["step_index"] = step.get("step_index", idx)
        forked_transcripts.append(cloned)
    atomic_write_jsonl(transcript_path, forked_transcripts)

    forked_full_transcripts = []
    for idx, step in enumerate(forked_full_steps):
        cloned = copy.deepcopy(step)
        if "conversation_id" in cloned:
            cloned["conversation_id"] = new_id
        cloned["step_index"] = step.get("step_index", idx)
        forked_full_transcripts.append(cloned)
    atomic_write_jsonl(transcript_full_path, forked_full_transcripts)

    # Copy artifacts safely if present
    source_dir = BRAIN_DIR / source_conversation_id
    _safe_copy_artifacts(source_dir, new_conv_dir)

    # Fetch source record from SQLite
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversation_summaries WHERE conversation_id = ?", (source_conversation_id,))
        source_row = cursor.fetchone()
        row_dict = dict(source_row) if source_row else {}
        source_title = row_dict.get("title") or "Session"
        default_workspace_uri = json.dumps([get_default_workspace_uri()])
        source_workspace = row_dict.get("workspace_uris") or default_workspace_uri
        agent_name = row_dict.get("agent_name") or ""
        source_project_id = str(row_dict.get("project_id") or "")
        source_group_id = str(row_dict.get("group_id") or "")

        sanitized_title = (new_title or "").strip()
        title = sanitized_title if sanitized_title else f"{source_title} (Branche #{up_to_step_index})"
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")
        
        last_step = forked_steps[-1]
        raw_preview = str(last_step.get("content") or last_step.get("thinking") or "")
        stype = last_step.get("type", "")
        source = last_step.get("source", "")
        if stype == "USER_INPUT" or source == "USER_EXPLICIT" or "<USER_REQUEST>" in raw_preview:
            preview = clean_user_prompt(raw_preview)[:150]
        else:
            preview = raw_preview[:150]

        forked_last_user_idx = -1
        forked_last_user_time = None
        for i in range(len(forked_transcripts) - 1, -1, -1):
            s = forked_transcripts[i]
            if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
                try:
                    forked_last_user_idx = int(s.get("step_index", i))
                except (ValueError, TypeError):
                    forked_last_user_idx = i
                forked_last_user_time = s.get("created_at") or s.get("timestamp")
                break

        cursor.execute("PRAGMA table_info(conversation_summaries)")
        existing_cols = {row[1] for row in cursor.fetchall()}

        fields = [
            "conversation_id", "title", "preview", "step_count",
            "last_modified_time", "workspace_uris", "status",
            "agent_name", "parent_conversation_id",
            "last_user_input_time", "last_user_input_step_index"
        ]
        values: list[Any] = [
            new_id, title, preview, len(forked_steps),
            now_str, source_workspace, "DONE",
            agent_name, source_conversation_id,
            forked_last_user_time or now_str,
            forked_last_user_idx
        ]
        if "project_id" in existing_cols:
            fields.append("project_id")
            values.append(source_project_id)
        if "group_id" in existing_cols:
            fields.append("group_id")
            values.append(source_group_id)

        for col in fields:
            if col not in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS:
                raise ValueError(f"Invalid column name: {col}")

        placeholders = ", ".join(["?"] * len(fields))
        field_str = ", ".join(fields)
        cursor.execute(f"INSERT INTO conversation_summaries ({field_str}) VALUES ({placeholders})", tuple(values))  # nosec B608
        conn.commit()
    except Exception:
        conn.rollback()
        delete_session_meta(new_id)
        if new_conv_dir.exists():
            shutil.rmtree(new_conv_dir, ignore_errors=True)
        raise
    finally:
        conn.close()

    # Inherit tags & project from source metadata
    source_meta = get_session_meta(source_conversation_id)
    if source_meta:
        source_tags = source_meta.get("tags")
        inherited_tags = list(source_tags) if isinstance(source_tags, list) else []
        update_session_meta(new_id, {
            "tags": inherited_tags,
            "project": source_meta.get("project", ""),
            "projectColor": source_meta.get("projectColor", ""),
            "project_id": source_meta.get("project_id") or source_project_id or "",
            "group_id": source_meta.get("group_id") or source_group_id or "",
            "pinned": False,
            "customTitle": ""
        })

    _notify_transcript_changed(new_id)
    _notify_conversations_changed()

    return {
        "conversation_id": new_id,
        "title": title,
        "step_count": len(forked_steps),
        "parent_conversation_id": source_conversation_id
    }

def create_conversation_handoff(
    source_conversation_id: str,
    new_title: str | None = None
) -> dict[str, Any]:
    if not is_safe_conversation_id(source_conversation_id):
        raise ValueError("Identifiant de conversation source non valide")
    source_steps = get_conversation_transcript(source_conversation_id)
    if not source_steps:
        raise ValueError(f"Aucun historique trouvé pour la conversation {source_conversation_id}")

    # Fetch source record from SQLite
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversation_summaries WHERE conversation_id = ?", (source_conversation_id,))
        source_row = cursor.fetchone()
        row_dict = dict(source_row) if source_row else {}
        source_title = row_dict.get("title") or "Session"
        default_workspace_uri = json.dumps([get_default_workspace_uri()])
        source_workspace = row_dict.get("workspace_uris") or default_workspace_uri
        agent_name = row_dict.get("agent_name") or ""
        source_project_id = str(row_dict.get("project_id") or "")
        source_group_id = str(row_dict.get("group_id") or "")
    finally:
        conn.close()

    # Extract user requests, model actions, and touched files
    user_requests = []
    actions_taken = []
    files_touched = set()
    artifacts_found = []

    for s in source_steps:
        stype = s.get("type", "")
        source = s.get("source", "")
        content = s.get("content", "")
        if stype == "USER_INPUT" or source == "USER_EXPLICIT":
            if content and content.strip():
                clean_req = clean_user_prompt(content)
                if clean_req:
                    user_requests.append(clean_req[:300])
        elif source == "MODEL":
            tool_calls = s.get("tool_calls", [])
            for tc in tool_calls:
                fn = tc.get("name") or tc.get("toolAction") or ""
                args = tc.get("args") or tc.get("parameters") or {}
                if "TargetFile" in args:
                    files_touched.add(args["TargetFile"])
                elif "SearchDirectory" in args:
                    files_touched.add(args["SearchDirectory"])
                elif "CommandLine" in args:
                    actions_taken.append(f"Exécution: `{args['CommandLine'][:80]}`")
                elif fn:
                    actions_taken.append(f"Outil: `{fn}`")

    # Check artifacts in brain directory
    source_dir = BRAIN_DIR / source_conversation_id
    if source_dir.exists():
        for item in source_dir.iterdir():
            if item.is_file() and item.name.endswith(".md"):
                artifacts_found.append(item.name)

    now_iso = datetime.now(timezone.utc).isoformat()
    now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
    now_db = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")

    user_reqs_md = "\n".join([f"{i+1}. {req}" for i, req in enumerate(user_requests[-6:])]) if user_requests else "Poursuite de la session de développement."
    files_md = "\n".join([f"- `{f}`" for f in list(files_touched)[:12]]) if files_touched else "- Fichiers du workspace de travail"
    artifacts_md = ", ".join([f"`{a}`" for a in artifacts_found]) if artifacts_found else "Aucun artefact autonome"

    summary_text = f"""<CONTEXT_SUMMARY>
Le contexte de la session précédente a été consolidé et transféré dans cette nouvelle section pour libérer l'espace mémoire sans perte d'information :

# Session Précédente : {source_title}
- **Date de transfert :** {now_str}
- **Historique source :** {len(source_steps)} étapes archivées dans `{source_conversation_id}`
- **Workspace actif :** {source_workspace}

# Demandes Utilisateur & Objectifs Clés
{user_reqs_md}

# Fichiers Traités & Contexte Technique
{files_md}

# Artefacts Disponibles
{artifacts_md}

# Statut de la Continuité
Cette nouvelle section de chat démarre avec un compteur de tokens réinitialisé. Les décisions d'architecture et connaissances restent actives en mémoire.
</CONTEXT_SUMMARY>"""

    new_id = str(uuid.uuid4())
    new_conv_dir = BRAIN_DIR / new_id
    new_logs_dir = new_conv_dir / ".system_generated" / "logs"
    new_logs_dir.mkdir(parents=True, exist_ok=True)

    # Copy artifacts safely if present
    _safe_copy_artifacts(source_dir, new_conv_dir)

    # Prepare initial steps:
    # Step 0: System Context Summary
    # Step 1: Assistant readiness message
    step_summary = {
        "step_index": 0,
        "source": "SYSTEM",
        "type": "CONTEXT_SUMMARY",
        "status": "DONE",
        "created_at": now_iso,
        "content": summary_text,
        "conversation_id": new_id
    }
    step_assistant = {
        "step_index": 1,
        "source": "MODEL",
        "type": "PLANNER_RESPONSE",
        "status": "DONE",
        "created_at": now_iso,
        "content": f"✨ **Nouvelle section de chat initialisée avec mémoire intégrée !**\n\nJ'ai synthétisé et repris tout le contexte de la conversation précédente (**« {source_title} »**). L'ensemble des décisions, fichiers créés et statuts d'avancement sont préservés, tandis que votre compteur de contexte a été réinitialisé à zéro pour vous garantir une réactivité maximale.\n\nQuelle est l'étape suivante sur laquelle nous travaillons ?",
        "conversation_id": new_id
    }

    # Définir les chemins de transcripts
    transcript_path = new_logs_dir / "transcript.jsonl"
    transcript_full_path = new_logs_dir / "transcript_full.jsonl"

    # Écriture atomique des transcripts (protège contre la corruption en cas de crash)
    atomic_write_jsonl(transcript_path, [step_summary, step_assistant])
    atomic_write_jsonl(transcript_full_path, [step_summary, step_assistant])


    sanitized_title = (new_title or "").strip()
    title = sanitized_title if sanitized_title else f"[Suite] {source_title}"
    preview = f"Nouvelle section avec mémoire transférée de « {source_title} »"

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(conversation_summaries)")
        existing_cols = {row[1] for row in cursor.fetchall()}

        fields = [
            "conversation_id", "title", "preview", "step_count",
            "last_modified_time", "workspace_uris", "status",
            "agent_name", "parent_conversation_id",
            "last_user_input_time", "last_user_input_step_index"
        ]
        values: list[Any] = [
            new_id, title, preview, 2,
            now_db, source_workspace, "DONE",
            agent_name, source_conversation_id,
            now_db, -1
        ]
        if "project_id" in existing_cols:
            fields.append("project_id")
            values.append(source_project_id)
        if "group_id" in existing_cols:
            fields.append("group_id")
            values.append(source_group_id)

        for col in fields:
            if col not in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS:
                raise ValueError(f"Invalid column name: {col}")

        placeholders = ", ".join(["?"] * len(fields))
        field_str = ", ".join(fields)
        cursor.execute(f"INSERT INTO conversation_summaries ({field_str}) VALUES ({placeholders})", tuple(values))  # nosec B608
        conn.commit()
    except Exception:
        conn.rollback()
        delete_session_meta(new_id)
        if new_conv_dir.exists():
            shutil.rmtree(new_conv_dir, ignore_errors=True)
        raise
    finally:
        conn.close()

    # Inherit tags & project from source metadata
    source_meta = get_session_meta(source_conversation_id) or {}
    source_tags = source_meta.get("tags")
    new_tags = list(source_tags) if isinstance(source_tags, list) else []
    if "suite" not in new_tags:
        new_tags.append("suite")
    update_session_meta(new_id, {
        "tags": new_tags,
        "project": source_meta.get("project", ""),
        "projectColor": source_meta.get("projectColor", ""),
        "project_id": source_meta.get("project_id") or source_project_id or "",
        "group_id": source_meta.get("group_id") or source_group_id or "",
        "pinned": False,
        "customTitle": ""
    })

    _notify_transcript_changed(new_id)
    _notify_conversations_changed()

    return {
        "conversation_id": new_id,
        "title": title,
        "step_count": 2,
        "parent_conversation_id": source_conversation_id,
        "summary": summary_text
    }


def _safe_rmtree(dir_path: Path, root_boundary: Path) -> None:
    try:
        resolved = dir_path.resolve()
        root_resolved = root_boundary.resolve()
        if resolved.exists() and resolved.is_relative_to(root_resolved) and resolved != root_resolved:
            def _remove_readonly(func, path, exc=None):
                try:
                    os.chmod(path, stat.S_IRWXU)
                    func(path)
                except Exception:
                    pass

            try:
                if sys.version_info >= (3, 12):
                    shutil.rmtree(resolved, onexc=_remove_readonly)
                else:
                    shutil.rmtree(resolved, onerror=_remove_readonly)
            except Exception as e:
                logger.debug(f"Direct rmtree failed for {resolved} ({e}), retrying with ignore_errors")
                shutil.rmtree(resolved, ignore_errors=True)
    except Exception as err:
        logger.warning(f"Error removing directory {dir_path}: {err}")

def bulk_delete_conversations(conversation_ids: list[str]) -> bool:
    if not conversation_ids:
        return True
    safe_ids = [cid for cid in conversation_ids if is_safe_conversation_id(cid)]
    if not safe_ids:
        return True

    try:
        from app.services.execution_manager import execution_manager
        for cid in safe_ids:
            execution_manager.remove_session(cid)
    except Exception as e:
        logger.debug(f"Ignored error: {e}")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.executemany("DELETE FROM conversation_summaries WHERE conversation_id = ?", [(cid,) for cid in safe_ids])
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    for cid in safe_ids:
        _safe_rmtree(BRAIN_DIR / cid, BRAIN_DIR)

    bulk_delete_session_meta(safe_ids)
    _notify_conversations_changed()
    return True

def delete_conversation(conversation_id: str) -> bool:
    if not is_safe_conversation_id(conversation_id):
        return False

    try:
        from app.services.execution_manager import execution_manager
        execution_manager.remove_session(conversation_id)
    except Exception as e:
        logger.debug(f"Ignored error: {e}")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversation_summaries WHERE conversation_id = ?", (conversation_id,))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    # Remove brain directory safely
    _safe_rmtree(BRAIN_DIR / conversation_id, BRAIN_DIR)

    # Delete metadata
    delete_session_meta(conversation_id)
    _notify_conversations_changed()
    return True

def update_conversation_title(conversation_id: str, new_title: str) -> bool:
    if not is_safe_conversation_id(conversation_id):
        return False
    clean_title = new_title.strip() if new_title else ""
    if not clean_title:
        return False
    update_session_meta(conversation_id, {"customTitle": clean_title})
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?", (clean_title, conversation_id))
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    _notify_conversations_changed()
    return True

def update_conversation_summary_fields(
    conversation_id: str,
    title: str | None = None,
    project_id: str | None = None,
    group_id: str | None = None,
) -> bool:
    """Updates one or more specific columns in SQLite conversation_summaries."""
    if not is_safe_conversation_id(conversation_id):
        return False
    updates = []
    params: list[Any] = []
    if title is not None:
        updates.append("title = ?")
        params.append(title.strip())
    if project_id is not None:
        updates.append("project_id = ?")
        params.append(project_id.strip())
    if group_id is not None:
        updates.append("group_id = ?")
        params.append(group_id.strip())
    if not updates:
        return True
    for item in updates:
        col = item.split()[0]
        if col not in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS:
            raise ValueError(f"Invalid column: {col}")
    params.append(conversation_id)
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(f"UPDATE conversation_summaries SET {', '.join(updates)} WHERE conversation_id = ?", params)  # nosec B608
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
    try:
        from app.services.session_metadata import update_session_meta
        meta_updates: dict[str, Any] = {}
        if project_id is not None:
            meta_updates["project"] = project_id.strip()
        if title is not None:
            meta_updates["customTitle"] = title.strip()
            meta_updates["custom_title"] = title.strip()
        if meta_updates:
            update_session_meta(conversation_id, meta_updates)
    except Exception as e:
        logger.debug(f"Could not sync summary fields to session_metadata: {e}")
    _notify_conversations_changed()
    return True

def undo_conversation_turn(conversation_id: str) -> dict[str, Any]:
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Invalid conversation_id")
    conv_dir = BRAIN_DIR / conversation_id
    transcript_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    transcript_full_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"
    legacy_file = conv_dir / "transcript.jsonl"

    steps = get_conversation_transcript(conversation_id)
    if not steps:
        return {"conversation_id": conversation_id, "step_count": 0, "steps": [], "usage": calculate_conversation_tokens([])}

    # Locate the last user input step
    last_user_idx = -1
    last_user_step_index = None
    for i in range(len(steps) - 1, -1, -1):
        s = steps[i]
        if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
            last_user_idx = i
            last_user_step_index = s.get("step_index")
            break

    if last_user_idx != -1:
        remaining_steps = steps[:last_user_idx]
    else:
        remaining_steps = steps[:-1]

    # Persist updated compact transcript file atomically
    transcript_file.parent.mkdir(parents=True, exist_ok=True)
    atomic_write_jsonl(transcript_file, remaining_steps)
    if legacy_file.exists():
        try:
            legacy_file.unlink(missing_ok=True)
        except OSError as unl_err:
            logger.debug(f"Ignored legacy transcript removal error: {unl_err}")

    # Persist updated full transcript file independently to avoid degrading unabridged history
    remaining_full_steps = remaining_steps  # valeur de repli sûre si le fichier est absent
    if transcript_full_file.exists():
        full_steps = []
        try:
            with open(transcript_full_file, "r", encoding="utf-8-sig", errors="replace") as f:
                for line in f:
                    line_str = line.strip().lstrip("\ufeff")
                    if not line_str:
                        continue
                    try:
                        full_steps.append(json.loads(line_str))
                    except json.JSONDecodeError:
                        continue
        except Exception as e:
            logger.warning(f"Failed to read transcript_full_file: {e}")
            full_steps = []

        if full_steps:
            cutoff_idx = -1
            if isinstance(last_user_step_index, int):
                for i in range(len(full_steps) - 1, -1, -1):
                    s = full_steps[i]
                    s_idx = s.get("step_index")
                    if isinstance(s_idx, int) and s_idx == last_user_step_index and (
                        s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT" or s.get("role") == "user"
                    ):
                        cutoff_idx = i
                        break
            if cutoff_idx == -1 and isinstance(last_user_step_index, int):
                for i in range(len(full_steps) - 1, -1, -1):
                    s = full_steps[i]
                    s_idx = s.get("step_index")
                    if isinstance(s_idx, int) and s_idx == last_user_step_index:
                        cutoff_idx = i
                        break
            if cutoff_idx == -1:
                for i in range(len(full_steps) - 1, -1, -1):
                    s = full_steps[i]
                    if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT" or s.get("role") == "user":
                        cutoff_idx = i
                        break
            if cutoff_idx != -1:
                remaining_full_steps = full_steps[:cutoff_idx]
            else:
                remaining_full_steps = full_steps[:-1]
        else:
            remaining_full_steps = remaining_steps

        atomic_write_jsonl(transcript_full_file, remaining_full_steps)


    # Update summary in SQLite database
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")
        last_step = remaining_steps[-1] if remaining_steps else {}
        raw_prev = last_step.get("content") or last_step.get("thinking") or ""
        if last_step.get("source") == "USER_EXPLICIT" or last_step.get("type") == "USER_INPUT":
            new_preview = clean_user_prompt(raw_prev)[:150]
        else:
            new_preview = str(raw_prev)[:150]

        new_last_user_idx = -1
        new_last_user_time = None
        for i in range(len(remaining_steps) - 1, -1, -1):
            s = remaining_steps[i]
            if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
                try:
                    new_last_user_idx = int(s.get("step_index", i))
                except (ValueError, TypeError):
                    new_last_user_idx = i
                new_last_user_time = s.get("created_at") or s.get("timestamp")
                break

        if new_last_user_idx != -1:
            effective_user_time = new_last_user_time or now_str
        else:
            meta = get_session_meta(conversation_id)
            effective_user_time = (meta.get("createdAt") if isinstance(meta, dict) else None) or now_str
        cursor.execute(
            """
            UPDATE conversation_summaries
            SET step_count = ?, preview = ?, last_modified_time = ?, last_user_input_step_index = ?, last_user_input_time = ?
            WHERE conversation_id = ?
            """,
            (len(remaining_steps), new_preview, now_str, new_last_user_idx, effective_user_time, conversation_id)
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    usage = calculate_conversation_tokens(remaining_steps)
    _notify_transcript_changed(conversation_id)
    _notify_conversations_changed()

    return {
        "conversation_id": conversation_id,
        "step_count": len(remaining_steps),
        "steps": remaining_steps,
        "usage": usage
    }

def _sanitize_snippet(snippet: Any) -> str:
    """Nettoie une chaîne d'aperçu de recherche en supprimant les caractères de contrôle, null bytes et blocs de code Markdown non fermés."""
    if not snippet:
        return ""
    cleaned = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", str(snippet))
    cleaned = re.sub(r"`{3,}", "'''", cleaned)
    return re.sub(r"\s+", " ", cleaned).strip()


def search_conversations(query: str, limit: int = 50) -> list[dict[str, Any]]:
    if not query.strip():
        return list_conversations(limit=limit)

    q_clean = query.strip()
    q_lower = q_clean.lower()
    all_meta = get_all_session_metadata()
    matched = []
    seen_ids = set()

    # 1. Direct SQLite Search on title and preview across the entire database
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        escaped_query = q_clean.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        cursor.execute(
            """
            SELECT 
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                project_id,
                group_id
            FROM conversation_summaries
            WHERE title LIKE ? ESCAPE '\\' OR preview LIKE ? ESCAPE '\\'
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (f"%{escaped_query}%", f"%{escaped_query}%", limit)
        )
        for r in cursor.fetchall():
            cid = r["conversation_id"]
            meta = all_meta.get(cid, {})
            c = _build_conversation_dict(r, meta)
            c["match_type"] = "metadata"
            c["match_snippet"] = _sanitize_snippet(r["preview"] or c["title"])
            matched.append(c)
            seen_ids.add(cid)

        # 2. Match customTitle, tags, project from session metadata for convs not yet matched
        if len(matched) < limit:
            metadata_cids = []
            for cid, meta in all_meta.items():
                if cid in seen_ids or not is_safe_conversation_id(cid):
                    continue
                custom_title = (meta.get("customTitle") or "").lower()
                project = (meta.get("project") or "").lower()
                raw_tags = meta.get("tags")
                tags = [t.lower().strip() for t in raw_tags if isinstance(t, str) and t.strip()] if isinstance(raw_tags, list) else []
                if (
                    q_lower in custom_title
                    or q_lower in project
                    or any(q_lower in t for t in tags)
                ):
                    metadata_cids.append(cid)
                    if len(matched) + len(metadata_cids) >= limit:
                        break
            
            if metadata_cids:
                chunk_size = 500
                for i in range(0, len(metadata_cids), chunk_size):
                    chunk = metadata_cids[i : i + chunk_size]
                    placeholders = ",".join(["?"] * len(chunk))
                    cursor.execute(
                        f"""
                        SELECT 
                            conversation_id,
                            title,
                            preview,
                            step_count,
                            last_modified_time,
                            workspace_uris,
                            status,
                            agent_name,
                            parent_conversation_id,
                            project_id,
                            group_id
                        FROM conversation_summaries
                        WHERE conversation_id IN ({placeholders})
                        """,  # nosec B608
                        tuple(chunk),
                    )
                    for r in cursor.fetchall():
                        cid = r["conversation_id"]
                        meta = all_meta.get(cid, {})
                        c_item = _build_conversation_dict(r, meta)
                        c_item["match_type"] = "metadata"
                        c_item["match_snippet"] = _sanitize_snippet(meta.get("customTitle") or meta.get("project") or c_item.get("preview"))
                        matched.append(c_item)
                        seen_ids.add(cid)
                        if len(matched) >= limit:
                            break
                    if len(matched) < limit:
                        for cid in chunk:
                            if cid not in seen_ids:
                                meta = all_meta.get(cid, {})
                                conv = get_conversation_by_id(cid, conn=conn)
                                if conv:
                                    c_item = dict(conv)
                                    c_item["match_type"] = "metadata"
                                    c_item["match_snippet"] = _sanitize_snippet(meta.get("customTitle") or meta.get("project") or c_item.get("preview"))
                                    matched.append(c_item)
                                    seen_ids.add(cid)
                                    if len(matched) >= limit:
                                        break
                    if len(matched) >= limit:
                        break
    finally:
        conn.close()

    # 3. Deep transcript scan for content if room left (scans recent active sessions)
    if len(matched) < limit:
        recent_convs = list_conversations(limit=30)
        for c in recent_convs:
            cid = c["conversation_id"]
            if cid in seen_ids:
                continue

            conv_dir = BRAIN_DIR / cid
            t_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
            if not t_file.exists():
                t_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"
            if not t_file.exists():
                t_file = conv_dir / "transcript.jsonl"
            if not t_file.exists():
                continue

            try:
                # Bound transcript scan to prevent blocking FastAPI event loop on massive files
                file_size = t_file.stat().st_size
                if file_size > 512 * 1024:
                    with open(t_file, "rb") as f:
                        f.seek(file_size - 512 * 1024)
                        f.readline()  # Skip partial line and align cleanly on UTF-8 line boundary
                        raw_data = f.read().decode("utf-8", errors="replace")
                    lines = raw_data.splitlines()
                    if len(lines) > 500:
                        lines = lines[-500:]
                else:
                    with open(t_file, "r", encoding="utf-8-sig", errors="replace") as f:
                        lines = list(deque(f, maxlen=500))

                for line in reversed(lines):
                    line_str = line.strip().lstrip("\ufeff")
                    if not line_str:
                        continue
                    if q_lower not in line_str.lower():
                        continue
                    try:
                        s = json.loads(line_str)
                        val_content = s.get("content")
                        if isinstance(val_content, str):
                            raw_content = val_content
                        elif val_content is None:
                            raw_content = ""
                        else:
                            try:
                                raw_content = json.dumps(val_content, ensure_ascii=False, default=str)
                            except Exception:
                                raw_content = str(val_content)

                        val_thinking = s.get("thinking")
                        if isinstance(val_thinking, str):
                            raw_thinking = val_thinking
                        elif val_thinking is None:
                            raw_thinking = ""
                        else:
                            try:
                                raw_thinking = json.dumps(val_thinking, ensure_ascii=False, default=str)
                            except Exception:
                                raw_thinking = str(val_thinking)

                        content_lower = raw_content.lower()
                        thinking_lower = raw_thinking.lower()
                        if q_lower in content_lower or q_lower in thinking_lower:
                            if q_lower in content_lower:
                                idx = content_lower.find(q_lower)
                                start = max(0, idx - 40)
                                end = min(len(raw_content), idx + 80)
                                snippet = ("..." if start > 0 else "") + raw_content[start:end] + ("..." if end < len(raw_content) else "")
                            else:
                                idx = thinking_lower.find(q_lower)
                                start = max(0, idx - 40)
                                end = min(len(raw_thinking), idx + 80)
                                snippet = "[Raisonnement] " + ("..." if start > 0 else "") + raw_thinking[start:end] + ("..." if end < len(raw_thinking) else "")

                            c_copy = dict(c)
                            c_copy["match_type"] = "transcript"
                            c_copy["match_snippet"] = _sanitize_snippet(snippet)
                            matched.append(c_copy)
                            seen_ids.add(cid)
                            break
                    except Exception as step_err:
                        logger.debug(f"Error checking transcript step: {step_err}")
                        continue
            except Exception as conv_err:
                logger.debug(f"Error reading transcript for {cid}: {conv_err}")
                continue

            if len(matched) >= limit:
                break

    return matched[:limit]

def aggregate_steps_into_turns(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not steps:
        return []

    turns: list[dict[str, Any]] = []
    current_asst: dict[str, Any] | None = None

    def flush_asst():
        nonlocal current_asst
        if current_asst:
            for act in current_asst.get("tool_activities", []):
                if act.get("result") is None:
                    act["result"] = ""
                if act.get("status") == "running":
                    act["status"] = "done" if act.get("result") else "cancelled"
            if current_asst.get("content") or current_asst.get("thinking") or current_asst.get("tool_activities"):
                turns.append(current_asst)
            current_asst = None

    for idx, s in enumerate(steps):
        if not isinstance(s, dict):
            continue
        stype = s.get("type", "")
        source = s.get("source", "")
        raw_c = s.get("content")
        if isinstance(raw_c, str):
            content = raw_c
        elif raw_c is None:
            content = ""
        else:
            try:
                content = json.dumps(raw_c, ensure_ascii=False, indent=2, default=str)
            except Exception:
                content = str(raw_c)

        raw_t = s.get("thinking")
        if isinstance(raw_t, str):
            thinking = raw_t
        elif raw_t is None:
            thinking = ""
        else:
            try:
                thinking = json.dumps(raw_t, ensure_ascii=False, indent=2, default=str)
            except Exception:
                thinking = str(raw_t)

        step_index = s.get("step_index", idx)
        ts = s.get("created_at", "")

        # 1. Checkpoints
        if stype == "CHECKPOINT":
            flush_asst()
            turns.append({
                "role": "checkpoint",
                "step_index": step_index,
                "timestamp": ts,
                "content": content,
            })
            continue

        # 1b. Context Summary (Handoff / Session Memory Consolidation)
        if stype == "CONTEXT_SUMMARY":
            flush_asst()
            clean_summary = content.strip()
            if clean_summary.startswith("<CONTEXT_SUMMARY>") and clean_summary.endswith("</CONTEXT_SUMMARY>"):
                clean_summary = clean_summary[len("<CONTEXT_SUMMARY>"): -len("</CONTEXT_SUMMARY>")].strip()
            turns.append({
                "role": "system",
                "subtype": "context_summary",
                "step_index": step_index,
                "timestamp": ts,
                "content": clean_summary or "Synthèse de continuité de session",
            })
            continue

        # 2. User input
        if source == "USER_EXPLICIT" or stype == "USER_INPUT":
            flush_asst()
            clean_c = clean_user_prompt(content)
            display_c = clean_c or (
                "" if _USER_METADATA_CHECK_RE.search(content)
                else content.strip()
            )
            if display_c:
                turns.append({
                    "role": "user",
                    "step_index": step_index,
                    "timestamp": ts,
                    "content": display_c,
                })
            continue

        # 3. System notifications and background task completions
        if stype == "SYSTEM_MESSAGE":
            flush_asst()
            if "finished with result:" in content:
                match_task = _TASK_NOTIFY_RE.search(content)
                task_id = match_task.group(1) if match_task else "Tâche"
                task_res = match_task.group(2).strip() if match_task else content
                turns.append({
                    "role": "system",
                    "subtype": "task",
                    "task_id": task_id,
                    "step_index": step_index,
                    "timestamp": ts,
                    "content": task_res,
                })
            else:
                m_sys = _SYSTEM_MESSAGE_TAG_RE.search(content)
                sys_text = m_sys.group(1).strip() if m_sys else content.strip()
                if sys_text:
                    turns.append({
                        "role": "system",
                        "subtype": "system",
                        "step_index": step_index,
                        "timestamp": ts,
                        "content": sys_text,
                    })
            continue

        # 4. Tool outputs (GENERIC / SYSTEM / Tool-specific steps following a tool call)
        tool_calls = s.get("tool_calls") or []
        is_tool_output = (
            (
                stype.upper() in TOOL_STEP_TYPES
                or is_tool_output_content(content)
            )
            and not tool_calls
            and not thinking
        )

        if is_tool_output:
            if not current_asst:
                current_asst = {
                    "role": "assistant",
                    "step_index": step_index,
                    "timestamp": ts,
                    "content": "",
                    "thinking": "",
                    "tool_activities": [],
                }
            activities = current_asst.setdefault("tool_activities", [])
            tool_call_id = s.get("tool_call_id") or s.get("call_id")
            pending = None
            if tool_call_id:
                for act in activities:
                    if act.get("id") == tool_call_id and act.get("result") is None:
                        pending = act
                        break
                if not pending:
                    for act in activities:
                        if not act.get("id") and act.get("result") is None:
                            pending = act
                            pending["id"] = tool_call_id
                            break
            else:
                for act in activities:
                    if act.get("result") is None:
                        pending = act
                        break
            is_cmd_failure = (
                isinstance(content, str)
                and (
                    bool(_COMMAND_FAILURE_RE.search(content))
                    or content.startswith(("Encountered error in tool execution:", "Tool execution failed:"))
                )
            )
            is_err = s.get("status") == "ERROR" or bool(s.get("error")) or is_cmd_failure
            status_val = "error" if is_err else "done"
            out_content = content or (str(s.get("error")) if s.get("error") else "")
            if pending:
                pending["result"] = out_content
                pending["status"] = status_val
            else:
                act_name = (
                    stype.lower()
                    if stype.upper() not in ("GENERIC", "SYSTEM", "TOOL_RESULT", "TOOL_OUTPUT")
                    else "action"
                )
                activities.append({
                    "id": tool_call_id or None,
                    "name": act_name,
                    "args": {},
                    "result": out_content,
                    "status": status_val,
                })
            continue

        # 5. Assistant actions
        mapped_tools = []
        if isinstance(tool_calls, list):
            for tc in tool_calls:
                if not isinstance(tc, dict):
                    continue
                raw_fn = tc.get("function")
                fn: dict[str, Any] = raw_fn if isinstance(raw_fn, dict) else {}
                name = (
                    tc.get("name")
                    or tc.get("tool_name")
                    or tc.get("toolAction")
                    or fn.get("name")
                    or "tool"
                )
                raw_args = tc.get("args")
                if raw_args is None:
                    raw_args = tc.get("parameters")
                if raw_args is None:
                    raw_args = tc.get("arguments")
                if raw_args is None and "arguments" in fn:
                    raw_args = fn.get("arguments")
                if raw_args is None:
                    raw_args = {}

                if isinstance(raw_args, str):
                    try:
                        parsed_args = json.loads(raw_args)
                        if isinstance(parsed_args, dict):
                            raw_args = parsed_args
                    except Exception:
                        raw_args = {"raw": raw_args}
                elif not isinstance(raw_args, (dict, list)):
                    raw_args = {"raw": raw_args}

                direct_res = tc.get("result") if "result" in tc else tc.get("output")

                mapped_tools.append({
                    "id": tc.get("id") or tc.get("tool_call_id") or tc.get("call_id"),
                    "name": name,
                    "args": raw_args,
                    "result": direct_res,
                    "status": "done" if (s.get("status") == "DONE" or direct_res is not None) else "running"
                })

        if content:
            matches = _THOUGHT_TAGS_RE.findall(content)
            if matches:
                extracted_thought = "\n\n".join(m.strip() for m in matches if m.strip())
                if extracted_thought:
                    thinking = f"{thinking}\n\n{extracted_thought}".strip() if thinking else extracted_thought
                content = _THOUGHT_TAGS_RE.sub("", content).strip()

        if current_asst:
            if thinking:
                existing_t = current_asst.get("thinking", "")
                current_asst["thinking"] = f"{existing_t}\n\n{thinking}".strip() if existing_t else thinking
            if content:
                existing_c = current_asst.get("content", "")
                current_asst["content"] = f"{existing_c}\n\n{content}".strip() if existing_c else content
            if mapped_tools:
                current_asst.setdefault("tool_activities", []).extend(mapped_tools)
        else:
            current_asst = {
                "role": "assistant",
                "step_index": step_index,
                "timestamp": ts,
                "content": content,
                "thinking": thinking,
                "tool_activities": mapped_tools,
            }

    flush_asst()
    return turns

def _safe_json_dumps(val: Any) -> str:
    """Sérialise un objet en JSON avec repli robuste si référence circulaire ou type non géré."""
    try:
        return json.dumps(val, indent=2, ensure_ascii=False, default=str)
    except Exception:
        try:
            return repr(val)
        except Exception:
            return "<unrepresentable object>"


def export_conversation_markdown(conversation_id: str) -> str:
    steps = get_conversation_transcript(conversation_id)
    conv = get_conversation_by_id(conversation_id)
    title = conv["title"] if conv else "Conversation Antigravity"
    turns = aggregate_steps_into_turns(steps)

    md_lines = [
        f"# {title}",
        f"**ID de Session :** `{conversation_id}`  ",
        f"**Date d'export :** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}  ",
        f"**Statistiques :** {len(turns)} échanges ({len(steps)} étapes brutes)",
        "---",
        ""
    ]

    for turn in turns:
        role = turn["role"]
        idx = turn["step_index"]

        if role == "checkpoint":
            md_lines.append(f"> 📌 **Point de Restauration (Étape #{idx})**")
            if turn.get("content"):
                md_lines.append(f"> {turn['content']}")
            md_lines.append("\n---\n")
            continue

        if role == "user":
            md_lines.append(f"## 👤 Utilisateur (Étape #{idx})")
            md_lines.append("")
            raw_u = turn.get("content")
            if isinstance(raw_u, (dict, list)):
                u_content = _safe_json_dumps(raw_u).strip()
            else:
                u_content = str(raw_u or "").strip()
            md_lines.append(u_content or "*(Message vide)*")
            md_lines.append("")
            md_lines.append("---")
            md_lines.append("")
            continue

        if role == "system":
            subtype = turn.get("subtype", "system")
            if subtype == "task":
                task_id = turn.get("task_id", "Tâche")
                md_lines.append(f"> ⚙️ **Notification de tâche [{task_id}] (Étape #{idx})**")
            elif subtype == "context_summary":
                md_lines.append(f"> 📋 **Synthèse de Continuité & Contexte de Session (Étape #{idx})**")
            else:
                md_lines.append(f"> ℹ️ **Notification Système (Étape #{idx})**")
            if turn.get("content"):
                for s_line in str(turn["content"]).strip().splitlines():
                    md_lines.append(f"> {s_line}")
            md_lines.append("\n---\n")
            continue

        # Assistant turn
        md_lines.append(f"## ⚡ Assistant Antigravity (Étape #{idx})")
        md_lines.append("")

        thinking = str(turn.get("thinking") or "").strip()
        if thinking:
            md_lines.append("> [!NOTE] Raisonnement Interne")
            for t_line in thinking.splitlines():
                md_lines.append(f"> {t_line}")
            md_lines.append("")

        tool_activities = turn.get("tool_activities", [])
        if tool_activities:
            md_lines.append(f"<details><summary>⚡ Activité de l'agent ({len(tool_activities)} actions)</summary>\n")
            for act in tool_activities:
                tname = act.get("name", "tool")
                raw_args = act.get("args")
                if isinstance(raw_args, (dict, list)):
                    targs = _safe_json_dumps(raw_args)
                elif isinstance(raw_args, str):
                    targs = raw_args
                elif raw_args is None:
                    targs = "{}"
                else:
                    targs = str(raw_args)
                res = act.get("result", "")
                md_lines.append(f"### Outil : `{tname}`")
                md_lines.append(f"```json\n{targs}\n```")
                if res is not None and (res or res == 0):
                    if isinstance(res, (dict, list)):
                        res_str = _safe_json_dumps(res)
                    else:
                        res_str = str(res)
                    if res_str:
                        md_lines.append("**Résultat :**")
                        md_lines.append(f"```\n{res_str[:2000]}{'...' if len(res_str) > 2000 else ''}\n```")
                md_lines.append("")
            md_lines.append("</details>\n")

        raw_content = turn.get("content")
        if isinstance(raw_content, (dict, list)):
            content = _safe_json_dumps(raw_content).strip()
        else:
            content = str(raw_content or "").strip()
        if content:
            md_lines.append(content)
            md_lines.append("")
        elif not tool_activities and not thinking:
            md_lines.append("*(Réponse vide)*")
            md_lines.append("")
        elif not content and tool_activities:
            md_lines.append("*(Exécution d'outils terminée)*")
            md_lines.append("")

        md_lines.append("---")
        md_lines.append("")

    return "\n".join(md_lines)

def export_conversation_html(conversation_id: str) -> str:
    steps = get_conversation_transcript(conversation_id)
    conv = get_conversation_by_id(conversation_id)
    title = conv["title"] if conv else "Conversation Antigravity"
    date_str = datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M:%S UTC')
    turns = aggregate_steps_into_turns(steps)

    def _clean_html_text(val: Any) -> str:
        if val is None:
            return ""
        if isinstance(val, (dict, list)):
            s = _safe_json_dumps(val)
        else:
            s = str(val)
        s = s.replace("\x00", "")
        s = re.sub(r"[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]", "", s)
        return html.escape(s, quote=True)

    messages_html = []
    for turn in turns:
        role = turn["role"]
        idx = turn.get("step_index", 0)

        if role == "checkpoint":
            chk_text = _clean_html_text(turn.get("content", "")).strip()
            chk_note = f'<div class="checkpoint-note">{chk_text}</div>' if chk_text else ""
            messages_html.append(f"""
            <div class="checkpoint-divider">
                <span>📌 Point de restauration — Étape #{idx}</span>
                {chk_note}
            </div>
            """)
            continue

        if role == "system":
            subtype = turn.get("subtype", "system")
            if subtype == "task":
                label = f"⚙️ Tâche [{turn.get('task_id', 'Tâche')}]"
            elif subtype == "context_summary":
                label = "📋 Synthèse de Continuité & Contexte de Session"
            else:
                label = "ℹ️ Notification Système"
            escaped_sys = _clean_html_text(turn.get("content", ""))
            messages_html.append(f"""
            <div class="system-divider">
                <span>{label} — Étape #{idx}</span>
                <pre class="system-content">{escaped_sys}</pre>
            </div>
            """)
            continue

        is_user = (role == "user")
        content = turn.get("content", "")
        thinking = turn.get("thinking", "")
        tool_activities = turn.get("tool_activities", [])

        bubble_class = "user-bubble" if is_user else "assistant-bubble"
        sender_label = "Utilisateur" if is_user else "Antigravity Agent"
        avatar = "👤" if is_user else "⚡"

        thought_html = ""
        if thinking:
            escaped_thought = _clean_html_text(thinking)
            thought_html = f"""
            <details class="thought-block">
                <summary>🧠 Raisonnement interne ({len(str(thinking))} car.)</summary>
                <pre class="thought-content">{escaped_thought}</pre>
            </details>
            """

        tools_html = ""
        if tool_activities:
            tools_rendered = []
            for act in tool_activities:
                tname = _clean_html_text(act.get("name") or "tool")
                raw_args = act.get("args")
                if isinstance(raw_args, (dict, list)):
                    targs_str = _safe_json_dumps(raw_args)
                elif raw_args is None:
                    targs_str = "{}"
                else:
                    targs_str = str(raw_args)
                targs = _clean_html_text(targs_str)
                res = act.get("result", "")
                res_html = ""
                if res is not None and (res or res == 0):
                    if isinstance(res, (dict, list)):
                        res_str = _safe_json_dumps(res)
                    else:
                        res_str = str(res)
                    if res_str:
                        escaped_res = _clean_html_text(res_str[:2000] + ("..." if len(res_str) > 2000 else ""))
                        res_html = f'<div class="tool-result-header">Résultat :</div><pre class="tool-result">{escaped_res}</pre>'

                tools_rendered.append(f"""
                <div class="tool-card">
                    <div class="tool-header">⚙️ <strong>{tname}</strong></div>
                    <pre class="tool-args">{targs}</pre>
                    {res_html}
                </div>
                """)
            tools_content = "".join(tools_rendered)
            tools_html = f"""
            <details class="tools-accordion">
                <summary>⚡ Activité de l'agent ({len(tool_activities)} actions)</summary>
                <div class="tools-list">
                    {tools_content}
                </div>
            </details>
            """

        escaped_content = _clean_html_text(content)
        if not escaped_content.strip():
            if not tool_activities and not thinking:
                display_content = "<em>(Message vide)</em>"
            elif tool_activities:
                display_content = "<em>(Exécution d'outils terminée)</em>"
            else:
                display_content = ""
        else:
            display_content = escaped_content

        messages_html.append(f"""
        <div class="message-row {'row-user' if is_user else 'row-assistant'}">
            <div class="avatar">{avatar}</div>
            <div class="bubble {bubble_class}">
                <div class="bubble-header">
                    <span class="sender">{sender_label}</span>
                    <span class="step-badge">Étape #{idx}</span>
                </div>
                {thought_html}
                {tools_html}
                <div class="content">{display_content}</div>
            </div>
        </div>
        """)

    body_content = "\n".join(messages_html)
    escaped_title = html.escape(title, quote=True)
    escaped_conv_id = html.escape(conversation_id, quote=True)

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{escaped_title} - Antigravity WebUI</title>
    <style>
        :root {{
            --bg-body: #080c16;
            --bg-card: #0d1322;
            --bg-user: #0284c7;
            --border: #1e293b;
            --text-main: #f1f5f9;
            --text-muted: #94a3b8;
            --accent: #38bdf8;
            --code-bg: #030712;
        }}
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{
            background-color: var(--bg-body);
            color: var(--text-main);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            line-height: 1.6;
            padding: 24px;
        }}
        .container {{
            max-width: 960px;
            margin: 0 auto;
        }}
        .header {{
            background: linear-gradient(to right, #0f172a, #1e1b4b);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 32px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 16px;
        }}
        .header h1 {{
            font-size: 20px;
            font-weight: 700;
            color: #fff;
            margin-bottom: 6px;
        }}
        .header .meta {{
            font-size: 12px;
            color: var(--text-muted);
            font-family: monospace;
        }}
        .print-btn {{
            background: #0284c7;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 8px;
            cursor: pointer;
            font-size: 13px;
            font-weight: 600;
        }}
        .print-btn:hover {{ background: #0369a1; }}
        .checkpoint-divider {{
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            margin: 24px 0;
            position: relative;
            gap: 4px;
        }}
        .checkpoint-divider::before {{
            content: '';
            position: absolute;
            left: 0;
            right: 0;
            top: 12px;
            height: 1px;
            background: #1e293b;
        }}
        .checkpoint-divider span {{
            position: relative;
            background: var(--bg-body);
            padding: 4px 16px;
            font-size: 11px;
            font-weight: 600;
            color: #64748b;
            border-radius: 9999px;
            border: 1px solid #1e293b;
        }}
        .checkpoint-note {{
            position: relative;
            background: var(--bg-body);
            padding: 2px 14px;
            font-size: 11px;
            color: var(--text-muted);
            font-style: italic;
            max-width: 80%;
            text-align: center;
        }}
        .system-divider {{
            margin: 20px 0;
            padding: 12px 16px;
            background: #0f172a;
            border: 1px solid #1e293b;
            border-radius: 8px;
        }}
        .system-divider span {{
            display: inline-block;
            font-size: 12px;
            font-weight: 600;
            color: #38bdf8;
            margin-bottom: 6px;
        }}
        .system-content {{
            font-family: 'JetBrains Mono', monospace;
            font-size: 12px;
            color: #94a3b8;
            margin: 0;
            white-space: pre-wrap;
            word-break: break-word;
        }}
        .message-row {{
            display: flex;
            gap: 12px;
            margin-bottom: 24px;
        }}
        .row-user {{ flex-direction: row-reverse; }}
        .avatar {{
            width: 36px;
            height: 36px;
            border-radius: 10px;
            background: #1e293b;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }}
        .bubble {{
            max-width: 80%;
            padding: 16px;
            border-radius: 16px;
            font-size: 13px;
        }}
        .assistant-bubble {{
            background: var(--bg-card);
            border: 1px solid var(--border);
            border-top-left-radius: 4px;
        }}
        .user-bubble {{
            background: var(--bg-user);
            color: white;
            border-top-right-radius: 4px;
        }}
        .bubble-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 11px;
            opacity: 0.8;
            border-bottom: 1px solid rgba(255,255,255,0.08);
            padding-bottom: 4px;
        }}
        .step-badge {{ font-family: monospace; }}
        .thought-block, .tools-accordion {{
            background: #090e1c;
            border: 1px solid #1e1b4b;
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
        }}
        .thought-block summary, .tools-accordion summary {{
            padding: 8px 12px;
            font-size: 11px;
            cursor: pointer;
            color: #a5b4fc;
            font-weight: 600;
        }}
        .tools-accordion {{
            border-color: #1e293b;
        }}
        .tools-accordion summary {{
            color: #38bdf8;
        }}
        .thought-content {{
            padding: 12px;
            font-size: 11px;
            font-family: monospace;
            background: #040711;
            color: #94a3b8;
            white-space: pre-wrap;
            border-top: 1px solid #1e1b4b;
            max-height: 300px;
            overflow-y: auto;
        }}
        .tools-list {{
            padding: 12px;
            background: #060a14;
            border-top: 1px solid #1e293b;
        }}
        .tool-card {{
            background: #0d1322;
            border: 1px solid #1e293b;
            border-radius: 8px;
            margin-bottom: 10px;
            padding: 10px;
            font-size: 11px;
        }}
        .tool-header {{ color: #fbbf24; margin-bottom: 4px; }}
        .tool-args {{
            background: var(--code-bg);
            padding: 8px;
            border-radius: 6px;
            font-family: monospace;
            overflow-x: auto;
            color: #cbd5e1;
            max-height: 200px;
        }}
        .tool-result-header {{
            font-size: 10px;
            color: #94a3b8;
            margin-top: 8px;
            margin-bottom: 4px;
            text-transform: uppercase;
            font-weight: 700;
        }}
        .tool-result {{
            background: #02040a;
            padding: 8px;
            border-radius: 6px;
            font-family: monospace;
            overflow-x: auto;
            color: #94a3b8;
            max-height: 200px;
            white-space: pre-wrap;
        }}
        .content {{
            white-space: pre-wrap;
            word-break: break-word;
            line-height: 1.7;
        }}
        @media print {{
            body {{ background: white; color: black; }}
            .header, .print-btn {{ display: none; }}
            .bubble {{ max-width: 100%; border: 1px solid #ccc; }}
            .user-bubble {{ background: #eee; color: black; }}
            .assistant-bubble {{ background: white; color: black; }}
        }}
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <div>
                <h1>{escaped_title}</h1>
                <div class="meta">Session ID: {escaped_conv_id} • Exporté le {date_str} • {len(turns)} échanges ({len(steps)} étapes)</div>
            </div>
            <button class="print-btn" onclick="window.print()">Imprimer / PDF</button>
        </div>

        <div class="messages">
            {body_content}
        </div>
    </div>
</body>
</html>
"""

def list_artifacts(conversation_id: str | None = None) -> list[dict[str, Any]]:
    artifacts = []
    if conversation_id:
        if not is_safe_conversation_id(conversation_id):
            return []
        dirs_to_scan = [(BRAIN_DIR / conversation_id).resolve()]
    else:
        if BRAIN_DIR.exists():
            dirs_to_scan = [p for p in BRAIN_DIR.iterdir() if p.is_dir() and is_safe_conversation_id(p.name)]
            def _safe_mtime(d: Path) -> float:
                try:
                    return d.stat().st_mtime
                except OSError:
                    return 0.0

            dirs_to_scan.sort(key=_safe_mtime, reverse=True)
            dirs_to_scan = dirs_to_scan[:50]
        else:
            dirs_to_scan = []

    for cdir in dirs_to_scan:
        if not cdir.is_dir():
            continue
        c_id = cdir.name
        cdir_str = str(cdir)
        cdir_depth = cdir_str.rstrip(os.sep).count(os.sep)
        for root, dirs, files in os.walk(cdir_str):
            # Limit scan depth to 5 levels to avoid runaway recursive scans in massive subtrees
            if root.count(os.sep) - cdir_depth > 5:
                dirs.clear()
                continue
            # Prune internal and hidden directories in-place so os.walk avoids scanning them
            dirs[:] = [d for d in dirs if d not in (".system_generated", "scratch") and not d.startswith(".")]
            for fname in files:
                if fname.startswith((".", ".tmp", ".lock")):
                    continue
                p = Path(root) / fname
                try:
                    resolved_p = p.resolve()
                    if not is_safe_path(resolved_p, [cdir]):
                        continue
                    if is_blocked_sensitive_path(resolved_p):
                        continue
                    stat = resolved_p.stat()
                    artifacts.append({
                        "conversation_id": c_id,
                        "filename": p.name,
                        "relative_path": resolved_p.relative_to(cdir).as_posix(),
                        "full_path": str(resolved_p),
                        "size": stat.st_size,
                        "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
                    })
                except (OSError, ValueError):
                    continue
    artifacts.sort(key=lambda x: str(x["last_modified"]), reverse=True)
    return artifacts

_settings_lock = threading.RLock()
_cached_settings: dict[str, Any] | None = None
_cached_settings_mtime: float = -1.0

MAX_ARTIFACT_READ_BYTES = 5 * 1024 * 1024  # 5 Mo max


def read_artifact_content(conversation_id: str, filename: str) -> str:
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")
    base_dir = (BRAIN_DIR / conversation_id).resolve()
    clean_filename = filename.lstrip("/\\")
    try:
        target_path = (base_dir / clean_filename).resolve()
    except (RuntimeError, OSError):
        raise FileNotFoundError(f"Artifact introuvable ou lien symbolique invalide : {filename}")
    if not target_path.exists() and "%" in clean_filename:
        from urllib.parse import unquote
        try:
            unquoted = unquote(clean_filename)
            cand = (base_dir / unquoted).resolve()
            if cand.exists():
                target_path = cand
                clean_filename = unquoted
        except (RuntimeError, OSError):
            pass
    if not is_safe_path(target_path, [base_dir]):
        raise PermissionError("Accès refusé : tentative de traversée de répertoire non autorisée.")
    if is_blocked_sensitive_path(target_path):
        raise PermissionError("Accès refusé : ce fichier est sensible ou restreint.")
    try:
        rel_parts = target_path.relative_to(base_dir).parts
    except ValueError:
        raise PermissionError("Accès refusé : tentative de traversée de répertoire non autorisée.")
    if ".system_generated" in rel_parts or "scratch" in rel_parts:
        raise PermissionError("Accès refusé : les fichiers système internes ou temporaires ne sont pas accessibles via les artefacts.")
    if not target_path.exists() or not target_path.is_file():
        raise FileNotFoundError(f"Artifact introuvable : {filename}")

    file_size = target_path.stat().st_size
    if file_size > MAX_ARTIFACT_READ_BYTES:
        try:
            with open(target_path, "r", encoding="utf-8", errors="replace") as f:
                content_chunk = f.read(MAX_ARTIFACT_READ_BYTES)
            return f"[Fichier volumineux ({file_size} octets) : affichage limité aux 5 premiers Mo]\n{content_chunk}"
        except Exception:
            return f"[Fichier binaire ou non lisible : {file_size} octets]"

    try:
        with open(target_path, "rb") as bf:
            sample = bf.read(8192)
            if b"\x00" in sample:
                return f"[Fichier binaire : {file_size} octets]"
        content = target_path.read_text(encoding="utf-8", errors="replace")
        return content.lstrip("\ufeff")
    except OSError as e:
        return f"[Erreur de lecture du fichier : {e}]"


def get_settings() -> dict[str, Any]:
    global _cached_settings, _cached_settings_mtime
    defaults: dict[str, Any] = {
        "agentMode": "accept-edits",
        "colorScheme": "dark",
        "model": "Gemini 3.8 Flash (Medium)",
        "trustedWorkspaces": [DEFAULT_WORKSPACE],
        "defaultWorkspace": DEFAULT_WORKSPACE,
        "ecoMode": True,
        "contextBudgetTokens": 35000,
        "autoCompactContext": True,
        "preserveLastNTurns": 2,
    }
    with _settings_lock:
        if not SETTINGS_FILE.exists():
            _cached_settings = None
            _cached_settings_mtime = -1.0
            return copy.deepcopy(defaults)
        try:
            mtime = SETTINGS_FILE.stat().st_mtime
            if _cached_settings is not None and mtime <= _cached_settings_mtime:
                return copy.deepcopy(_cached_settings)

            content = SETTINGS_FILE.read_text(encoding="utf-8")
            if not content.strip():
                _cached_settings = copy.deepcopy(defaults)
                _cached_settings_mtime = mtime
                return copy.deepcopy(defaults)
            data = json.loads(content)
            res = data if isinstance(data, dict) else copy.deepcopy(defaults)
            if not res.get("defaultWorkspace"):
                res["defaultWorkspace"] = DEFAULT_WORKSPACE
            if "ecoMode" not in res:
                res["ecoMode"] = True
            if "contextBudgetTokens" not in res:
                res["contextBudgetTokens"] = 35000
            if "autoCompactContext" not in res:
                res["autoCompactContext"] = True
            if "preserveLastNTurns" not in res:
                res["preserveLastNTurns"] = 2
            _cached_settings = copy.deepcopy(res)
            _cached_settings_mtime = mtime
            return copy.deepcopy(res)
        except Exception as exc:
            logger.warning(f"Failed to parse settings.json, returning defaults: {exc}")
            return copy.deepcopy(defaults)

def save_settings(new_settings: dict[str, Any]) -> dict[str, Any]:
    global _cached_settings, _cached_settings_mtime
    with _settings_lock:
        current = get_settings()
        current.update(new_settings)
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = SETTINGS_FILE.parent / f".settings.json.tmp.{uuid.uuid4().hex[:8]}"
        try:
            tmp_file.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
            restrict_file_permissions(tmp_file)
            _safe_atomic_replace(tmp_file, SETTINGS_FILE)
            restrict_file_permissions(SETTINGS_FILE)
            _cached_settings = copy.deepcopy(current)
            try:
                _cached_settings_mtime = SETTINGS_FILE.stat().st_mtime
            except OSError:
                _cached_settings_mtime = -1.0
        except Exception:
            if tmp_file.exists():
                try:
                    tmp_file.unlink()
                except Exception as e:
                    logger.debug(f"Ignored error: {e}")
            raise
        return copy.deepcopy(current)

def _import_single_conversation(payload: dict[str, Any], now_iso: str, now_db: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    new_id = str(uuid.uuid4())
    title = payload.get("title") or "Conversation importée"
    steps: list[dict[str, Any]] = []

    # Format 1: Antigravity export
    if "steps" in payload and isinstance(payload["steps"], list):
        steps = [s for s in payload["steps"] if isinstance(s, dict)]
        meta = payload.get("metadata") or {}
        title = meta.get("customTitle") or meta.get("title") or payload.get("title") or title
    # Format 2: Hermes session format
    elif "messages" in payload and isinstance(payload["messages"], list):
        title = payload.get("title") or title
        for idx, m in enumerate(payload["messages"]):
            if not isinstance(m, dict):
                continue
            role = m.get("role", "user")
            content = m.get("content", "")
            if role == "user":
                steps.append({
                    "step_index": idx,
                    "source": "USER_EXPLICIT",
                    "type": "USER_INPUT",
                    "status": "DONE",
                    "content": content,
                    "created_at": m.get("timestamp") or now_iso
                })
            else:
                steps.append({
                    "step_index": idx,
                    "source": "MODEL",
                    "type": "PLANNER_RESPONSE",
                    "status": "DONE",
                    "content": content,
                    "created_at": m.get("timestamp") or now_iso
                })

    if not steps:
        # Fallback single step
        steps = [{
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "status": "DONE",
            "content": payload.get("title") or "Session importée",
            "created_at": now_iso
        }]

    new_conv_dir = BRAIN_DIR / new_id
    should_close = False
    if conn is None:
        conn = get_db_connection()
        should_close = True

    try:
        new_logs_dir = new_conv_dir / ".system_generated" / "logs"
        new_logs_dir.mkdir(parents=True, exist_ok=True)

        transcript_path = new_logs_dir / "transcript.jsonl"
        transcript_full_path = new_logs_dir / "transcript_full.jsonl"

        cloned_steps = []
        for s in steps:
            cloned = copy.deepcopy(s)
            cloned["conversation_id"] = new_id
            cloned_steps.append(cloned)

        atomic_write_jsonl(transcript_path, cloned_steps)
        atomic_write_jsonl(transcript_full_path, cloned_steps)

        meta_raw = payload.get("metadata")
        meta_payload: dict[str, Any] = meta_raw if isinstance(meta_raw, dict) else {}
        project_val = str(payload.get("project") or payload.get("project_id") or meta_payload.get("project") or meta_payload.get("project_id") or "")
        project_id_val = str(payload.get("project_id") or meta_payload.get("project_id") or project_val)
        group_val = str(payload.get("group_id") or payload.get("groupId") or meta_payload.get("group_id") or meta_payload.get("groupId") or "")
        project_color_val = str(payload.get("projectColor") or meta_payload.get("projectColor") or "")

        update_session_meta(new_id, {
            "customTitle": title,
            "title": title,
            "pinned": bool(meta_payload.get("pinned", False)),
            "archived": bool(meta_payload.get("archived", False)),
            "tags": payload.get("tags") or meta_payload.get("tags") or ["importé"],
            "project": project_val,
            "project_id": project_id_val,
            "projectColor": project_color_val,
            "group_id": group_val,
        })

        # Persist summary in SQLite database so the imported session appears in session lists
        preview = ""
        for s in steps:
            c = s.get("content") or s.get("thinking") or ""
            if c:
                preview = clean_user_prompt(str(c))[:150]
                break

        parent_conv_id = payload.get("parent_conversation_id") or meta_payload.get("parent_conversation_id") or ""

        raw_uris = payload.get("workspace_uris") or meta_payload.get("workspace_uris")
        if isinstance(raw_uris, list):
            stored_uris = json.dumps(raw_uris)
        elif isinstance(raw_uris, str) and raw_uris.strip().startswith("["):
            stored_uris = raw_uris
        elif isinstance(raw_uris, str) and raw_uris.strip():
            stored_uris = json.dumps([raw_uris.strip()])
        else:
            stored_uris = json.dumps([get_default_workspace_uri()])

        imported_last_user_idx = -1
        imported_last_user_time = None
        for i in range(len(steps) - 1, -1, -1):
            s = steps[i]
            if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
                try:
                    imported_last_user_idx = int(s.get("step_index", i))
                except (ValueError, TypeError):
                    imported_last_user_idx = i
                imported_last_user_time = s.get("created_at") or s.get("timestamp")
                break

        cursor = conn.cursor()
        cursor.execute("PRAGMA table_info(conversation_summaries)")
        existing_cols = {row[1] for row in cursor.fetchall()}

        fields = [
            "conversation_id", "title", "preview", "step_count",
            "last_modified_time", "workspace_uris", "status",
            "agent_name", "parent_conversation_id",
            "last_user_input_time", "last_user_input_step_index"
        ]
        values: list[Any] = [
            new_id,
            title,
            preview,
            len(steps),
            now_db,
            stored_uris,
            "DONE",
            "import",
            parent_conv_id,
            imported_last_user_time or now_db,
            imported_last_user_idx
        ]
        if "project_id" in existing_cols:
            fields.append("project_id")
            values.append(project_id_val)
        if "group_id" in existing_cols:
            fields.append("group_id")
            values.append(group_val)

        for col in fields:
            if col not in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS:
                raise ValueError(f"Invalid column name: {col}")

        placeholders = ", ".join(["?"] * len(fields))
        field_str = ", ".join(fields)
        cursor.execute(f"INSERT INTO conversation_summaries ({field_str}) VALUES ({placeholders})", tuple(values))  # nosec B608
        if should_close:
            conn.commit()
    except Exception:
        delete_session_meta(new_id)
        if new_conv_dir.exists():
            shutil.rmtree(new_conv_dir, ignore_errors=True)
        if should_close and conn is not None:
            try:
                conn.rollback()
            except Exception as roll_err:
                logger.debug(f"Import rollback error: {roll_err}")
        raise
    finally:
        if should_close and conn is not None:
            conn.close()

    return {
        "success": True,
        "conversation_id": new_id,
        "title": title,
        "step_count": len(steps),
        "steps_count": len(steps)
    }


def import_conversation(payload: dict[str, Any] | list[Any]) -> dict[str, Any]:
    """
    Import a conversation or bulk export from JSON payload.
    Supports:
    1. Bulk export format ({ exported_at, count, conversations: [...] })
    2. Direct list of conversations ([ {...}, {...} ])
    3. Antigravity JSON export format ({ conversation_id, metadata, steps })
    4. Hermes WebUI session format ({ session_id, title, messages, ... })
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    now_db = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")

    # Bulk export or list of conversations
    items_to_import: list[dict[str, Any]] | None = None
    if isinstance(payload, list):
        items_to_import = [item for item in payload if isinstance(item, dict)]
    elif isinstance(payload, dict) and isinstance(payload.get("conversations"), list):
        items_to_import = [item for item in payload["conversations"] if isinstance(item, dict)]

    if items_to_import is not None:
        imported = []
        created_dirs: list[Path] = []
        created_ids: list[str] = []
        conn = get_db_connection()
        try:
            for item in items_to_import:
                res = _import_single_conversation(item, now_iso, now_db, conn=conn)
                imported.append(res)
                created_ids.append(res["conversation_id"])
                created_dirs.append(BRAIN_DIR / res["conversation_id"])
            conn.commit()
        except Exception:
            conn.rollback()
            for cid in created_ids:
                delete_session_meta(cid)
            for d in created_dirs:
                if d.exists():
                    shutil.rmtree(d, ignore_errors=True)
            raise
        finally:
            conn.close()
        primary_id = imported[-1]["conversation_id"] if imported else ""
        for cid in created_ids:
            _notify_transcript_changed(cid)
        _notify_conversations_changed()
        return {
            "success": True,
            "conversation_id": primary_id,
            "count": len(imported),
            "imported_count": len(imported),
            "conversations": imported,
            "title": f"{len(imported)} conversations importées",
            "step_count": sum(c.get("step_count", 0) for c in imported),
            "steps_count": sum(c.get("step_count", 0) for c in imported)
        }

    if not isinstance(payload, dict):
        raise TypeError("Format de payload non valide pour l'import de conversation")

    res = _import_single_conversation(payload, now_iso, now_db)
    _notify_transcript_changed(res["conversation_id"])
    _notify_conversations_changed()
    return res


def get_conversation_branch_tree(conversation_id: str) -> dict[str, Any]:
    """
    Construit l'arbre complet des embranchements (ancêtres, racine, ramifications et signets)
    autour d'une conversation donnée.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            SELECT conversation_id, title, preview, step_count, last_modified_time, parent_conversation_id, project_id, group_id
            FROM conversation_summaries
            WHERE conversation_id = ?
            """,
            (conversation_id,)
        )
        row = cursor.fetchone()
        if not row:
            return {
                "root_id": conversation_id,
                "current_id": conversation_id,
                "total_branches": 1,
                "tree": None,
                "all_bookmarks": []
            }

        visited_up = set()
        curr_id = conversation_id
        curr_parent = row[5] or ""

        while curr_parent and curr_parent not in visited_up:
            visited_up.add(curr_id)
            cursor.execute(
                "SELECT parent_conversation_id FROM conversation_summaries WHERE conversation_id = ?",
                (curr_parent,)
            )
            parent_row = cursor.fetchone()
            if not parent_row:
                break
            curr_id = curr_parent
            curr_parent = parent_row[0] or ""

        root_id = curr_id

        cursor.execute(
            """
            SELECT conversation_id, title, preview, step_count, last_modified_time, parent_conversation_id, project_id, group_id
            FROM conversation_summaries
            """
        )
        all_rows = cursor.fetchall()
    finally:
        conn.close()

    nodes_by_id: dict[str, dict[str, Any]] = {}
    children_map: dict[str, list[str]] = {}

    for r in all_rows:
        cid = r[0]
        pid = r[5] or ""
        nodes_by_id[cid] = {
            "conversation_id": cid,
            "title": r[1] or "Sans titre",
            "preview": r[2] or "",
            "step_count": r[3] or 0,
            "last_modified_time": r[4] or "",
            "parent_conversation_id": pid or None,
            "project_id": r[6] or "",
            "group_id": r[7] or "",
            "is_current": (cid == conversation_id),
            "is_root": (cid == root_id),
            "bookmarks": [],
            "children": []
        }
        children_map.setdefault(pid, []).append(cid)

    family_ids: set[str] = set()
    def _collect_descendants(node_id: str):
        family_ids.add(node_id)
        for child_id in children_map.get(node_id, []):
            if child_id not in family_ids:
                _collect_descendants(child_id)

    _collect_descendants(root_id)

    all_bookmarks = []
    from app.services.session_metadata import get_session_meta
    for fid in family_ids:
        if fid in nodes_by_id:
            meta = get_session_meta(fid) or {}
            bms = meta.get("bookmarks") or []
            if isinstance(bms, list):
                nodes_by_id[fid]["bookmarks"] = bms
                for b in bms:
                    if isinstance(b, dict):
                        all_bookmarks.append({**b, "conversation_id": fid, "conversation_title": nodes_by_id[fid]["title"]})

    def _build_tree(node_id: str) -> dict[str, Any]:
        node = nodes_by_id.get(node_id, {
            "conversation_id": node_id,
            "title": "Racine inconnue",
            "step_count": 0,
            "children": [],
            "bookmarks": []
        })
        children = []
        for child_id in children_map.get(node_id, []):
            if child_id in family_ids:
                children.append(_build_tree(child_id))
        node["children"] = children
        return node

    root_tree = _build_tree(root_id) if root_id in nodes_by_id else None

    return {
        "root_id": root_id,
        "current_id": conversation_id,
        "total_branches": len(family_ids),
        "tree": root_tree,
        "all_bookmarks": all_bookmarks
    }


