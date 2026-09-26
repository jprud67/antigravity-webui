"""
fts_search.py — Moteur de recherche plein-texte cross-sessions haute performance (SQLite FTS5 + Trigram).
Inspiré directement de l'architecture Antigravity Core (session-transcript-fts & Antigravity Core-agent-transcript-fts-schema).

Fournit :
  - Indexation en temps réel des messages de sessions (rôle, contenu texte, appels d'outils, timestamp, projet).
  - Recherche instantanée ultra-rapide (< 10 ms) à travers toutes les conversations passées.
  - Surlignage précis des extraits contextuels via la fonction native `snippet()`.
  - Tokenizer Trigram (avec fallback unicode61 si non disponible).
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import threading
import time
from datetime import datetime, timezone
from typing import Any

from app.config import BRAIN_DIR, CONVERSATION_DB

logger = logging.getLogger("antigravity.fts_search")

_fts_lock = threading.RLock()
_fts_initialized = False


def _get_connection() -> sqlite3.Connection:
    CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def ensure_fts_schema(conn: sqlite3.Connection | None = None) -> None:
    """Initialise la table virtuelle FTS5 avec tokenizer trigram ou fallback unicode61."""
    global _fts_initialized
    if _fts_initialized and conn is None:
        return

    with _fts_lock:
        close_after = False
        if conn is None:
            conn = _get_connection()
            close_after = True

        try:
            # 1. Table de suivi d'indexation par session
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_fts_index_state (
                    session_id TEXT PRIMARY KEY,
                    last_step_index INTEGER NOT NULL DEFAULT -1,
                    indexed_row_count INTEGER NOT NULL DEFAULT 0,
                    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                """
            )

            # 1b. Table d'index B-Tree pour dédoublonnage instantané O(1) des messages
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_fts_indexed_messages (
                    session_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    PRIMARY KEY (session_id, message_id)
                );
                """
            )

            # 2. Table virtuelle FTS5
            # Test d'abord avec le tokenizer trigram (recherche par sous-chaînes partielles et code)
            try:
                conn.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS session_transcript_fts USING fts5(
                        session_id UNINDEXED,
                        message_id UNINDEXED,
                        role UNINDEXED,
                        project UNINDEXED,
                        timestamp UNINDEXED,
                        text,
                        tokenize='trigram'
                    );
                    """
                )
            except sqlite3.OperationalError:
                # Fallback standard si trigram n'est pas présent
                logger.info("FTS5 trigram non disponible, fallback vers unicode61.")
                conn.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS session_transcript_fts USING fts5(
                        session_id UNINDEXED,
                        message_id UNINDEXED,
                        role UNINDEXED,
                        project UNINDEXED,
                        timestamp UNINDEXED,
                        text,
                        tokenize='unicode61'
                    );
                    """
                )
            conn.commit()
            _fts_initialized = True
        except Exception as e:
            logger.error(f"Erreur initialisation schema FTS5: {e}")
        finally:
            if close_after:
                conn.close()


def clean_search_query(raw_query: str) -> str:
    """Sécurise et formate la requête pour FTS5 (échappement des caractères spéciaux FTS)."""
    q = raw_query.strip()
    if not q:
        return ""
    # Retire les guillemets non appariés ou caractères de syntaxe FTS risqués
    # Si la requête contient des espaces sans guillemets, on entoure chaque mot d'astérisques ou de guillemets
    words = re.findall(r'[\w\-]+|"[^"]+"', q)
    if not words:
        return ""
    formatted_words = []
    for w in words:
        if w.startswith('"') and w.endswith('"'):
            formatted_words.append(w)
        else:
            # Recherche de préfixe sûre
            cleaned = re.sub(r'[^\w\-]', '', w)
            if cleaned:
                formatted_words.append(f'"{cleaned}"*')
    return " AND ".join(formatted_words) if formatted_words else ""


class TranscriptFtsService:
    """Service d'indexation et recherche FTS5 cross-sessions."""

    def __init__(self):
        ensure_fts_schema()

    def index_message(
        self,
        session_id: str,
        message_id: str,
        role: str,
        text: str,
        project: str = "",
        timestamp: str | None = None,
        conn: sqlite3.Connection | None = None,
    ) -> bool:
        """Indexe un message unique dans FTS5 avec dédoublonnage O(1)."""
        if not text or not text.strip():
            return False

        ts = timestamp or datetime.now(timezone.utc).isoformat()
        close_after = False
        if conn is None:
            conn = _get_connection()
            close_after = True

        try:
            with _fts_lock:
                # Évite d'indexer deux fois le même message_id via la table B-Tree indexée (O(1))
                existing = conn.execute(
                    "SELECT 1 FROM session_fts_indexed_messages WHERE session_id = ? AND message_id = ?",
                    (session_id, message_id)
                ).fetchone()
                if existing:
                    return False

                clean_text = text.strip()
                conn.execute(
                    """
                    INSERT INTO session_transcript_fts(session_id, message_id, role, project, timestamp, text)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (session_id, message_id, role, project, ts, clean_text)
                )
                conn.execute(
                    """
                    INSERT OR IGNORE INTO session_fts_indexed_messages(session_id, message_id)
                    VALUES (?, ?)
                    """,
                    (session_id, message_id)
                )
                if close_after:
                    conn.commit()
            return True
        except Exception as e:
            logger.debug(f"Erreur indexation message FTS ({session_id}/{message_id}): {e}")
            return False
        finally:
            if close_after:
                conn.close()

    def index_session_transcript(self, session_id: str, conn: sqlite3.Connection | None = None) -> int:
        """Lit transcript.jsonl pour une session et indexe par lots haute performance (executemany)."""
        transcript_file = BRAIN_DIR / session_id / ".system_generated" / "logs" / "transcript.jsonl"
        if not transcript_file.is_file():
            # Alternative: direct logs/transcript.jsonl
            transcript_file = BRAIN_DIR / session_id / "logs" / "transcript.jsonl"
            if not transcript_file.is_file():
                return 0

        close_after = False
        if conn is None:
            conn = _get_connection()
            close_after = True

        try:
            # Récupère le projet associé depuis conversation_summaries
            proj_row = conn.execute(
                "SELECT project_id FROM conversation_summaries WHERE conversation_id = ?",
                (session_id,)
            ).fetchone()
            project = proj_row["project_id"] if proj_row and proj_row["project_id"] else ""

            # Dernier état d'indexation
            state_row = conn.execute(
                "SELECT last_step_index FROM session_fts_index_state WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            last_indexed_step = state_row["last_step_index"] if state_row else -1

            max_step = last_indexed_step
            batch_fts: list[tuple[str, str, str, str, str, str]] = []
            batch_meta: list[tuple[str, str]] = []

            with open(transcript_file, "r", encoding="utf-8", errors="replace") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        step = json.loads(line)
                    except Exception:
                        continue

                    step_idx = step.get("step_index", 0)
                    if step_idx <= last_indexed_step:
                        continue

                    role = step.get("type", "").lower()
                    if "user" in role or step.get("source") == "USER_EXPLICIT":
                        assigned_role = "user"
                    elif "planner" in role or "agent" in role or step.get("source") == "MODEL":
                        assigned_role = "assistant"
                    else:
                        assigned_role = "system"

                    content = step.get("content") or ""
                    # Extraction du texte si c'est un dictionnaire ou objet
                    if isinstance(content, dict):
                        content = content.get("text") or json.dumps(content, ensure_ascii=False)
                    elif not isinstance(content, str):
                        content = str(content)

                    # Si des tool_calls sont présents, indexe également leurs noms et arguments
                    tool_calls = step.get("tool_calls")
                    if tool_calls and isinstance(tool_calls, list):
                        tool_texts = []
                        for tc in tool_calls:
                            if isinstance(tc, dict):
                                name = tc.get("name", "")
                                args = json.dumps(tc.get("arguments", {}), ensure_ascii=False)
                                tool_texts.append(f"Tool {name}: {args}")
                        if tool_texts:
                            content = (content + "\n" + "\n".join(tool_texts)).strip()

                    msg_id = f"step_{step_idx}"
                    ts = step.get("timestamp") or datetime.now(timezone.utc).isoformat()
                    cleaned_text = content.strip()

                    if cleaned_text:
                        batch_fts.append((session_id, msg_id, assigned_role, project, ts, cleaned_text))
                        batch_meta.append((session_id, msg_id))

                    max_step = max(max_step, step_idx)

            if batch_fts:
                with _fts_lock:
                    conn.executemany(
                        """
                        INSERT INTO session_transcript_fts(session_id, message_id, role, project, timestamp, text)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        batch_fts
                    )
                    conn.executemany(
                        """
                        INSERT OR IGNORE INTO session_fts_indexed_messages(session_id, message_id)
                        VALUES (?, ?)
                        """,
                        batch_meta
                    )
                    conn.execute(
                        """
                        INSERT INTO session_fts_index_state(session_id, last_step_index, indexed_row_count, updated_at)
                        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                        ON CONFLICT(session_id) DO UPDATE SET
                            last_step_index = excluded.last_step_index,
                            indexed_row_count = indexed_row_count + excluded.indexed_row_count,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (session_id, max_step, len(batch_fts))
                    )
                    conn.commit()
            elif max_step > last_indexed_step:
                with _fts_lock:
                    conn.execute(
                        """
                        INSERT INTO session_fts_index_state(session_id, last_step_index, indexed_row_count, updated_at)
                        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
                        ON CONFLICT(session_id) DO UPDATE SET
                            last_step_index = excluded.last_step_index,
                            updated_at = CURRENT_TIMESTAMP
                        """,
                        (session_id, max_step)
                    )
                    conn.commit()

            return len(batch_fts)
        except Exception as e:
            logger.debug(f"Erreur indexation session {session_id}: {e}")
            return 0
        finally:
            if close_after:
                conn.close()

    def search(
        self,
        query: str,
        role: str | None = None,
        session_id: str | None = None,
        project: str | None = None,
        limit: int = 50,
    ) -> dict[str, Any]:
        """Exécute une recherche plein-texte avec ranking BM25 et extraits surlignés."""
        start_time = time.perf_counter()
        q_cleaned = clean_search_query(query)
        if not q_cleaned:
            return {"query": query, "matches": [], "total_matches": 0, "took_ms": 0.0}

        conn = _get_connection()
        try:
            clauses = ["session_transcript_fts MATCH ?"]
            params: list[Any] = [q_cleaned]

            if role:
                clauses.append("role = ?")
                params.append(role.lower())
            if session_id:
                clauses.append("session_id = ?")
                params.append(session_id)
            if project:
                clauses.append("project = ?")
                params.append(project)

            where_sql = " AND ".join(clauses)
            
            # Utilise snippet(session_transcript_fts, 5, '<mark class="fts-match">', '</mark>', '...', 28)
            sql = (
                "SELECT session_id, message_id, role, project, timestamp, "
                "snippet(session_transcript_fts, 5, '<mark class=\"fts-match\">', '</mark>', '...', 28) AS snippet_text, "
                "bm25(session_transcript_fts) AS rank_score "
                "FROM session_transcript_fts "
                f"WHERE {where_sql} "  # nosec B608
                "ORDER BY rank_score ASC LIMIT ?"
            )
            params.append(max(1, min(limit, 200)))

            cursor = conn.execute(sql, params)
            rows = cursor.fetchall()

            # Titres de conversations pour enrichir la réponse
            session_ids = list({r["session_id"] for r in rows})
            titles = {}
            if session_ids:
                try:
                    from app.services.session_metadata import get_all_session_metadata
                    all_meta = get_all_session_metadata()
                except Exception:
                    all_meta = {}
                try:
                    placeholders = ",".join("?" * len(session_ids))
                    title_rows = conn.execute(
                        f"SELECT conversation_id, title FROM conversation_summaries WHERE conversation_id IN ({placeholders})",  # nosec B608
                        session_ids
                    ).fetchall()
                    for tr in title_rows:
                        cid = tr["conversation_id"]
                        meta = all_meta.get(cid, {})
                        custom_title = (meta.get("customTitle") or meta.get("custom_title") or "").strip()
                        titles[cid] = custom_title or tr["title"] or cid
                except Exception:
                    pass

            matches = []
            for r in rows:
                matches.append({
                    "session_id": r["session_id"],
                    "session_title": titles.get(r["session_id"], r["session_id"]),
                    "message_id": r["message_id"],
                    "role": r["role"],
                    "project": r["project"],
                    "timestamp": r["timestamp"],
                    "snippet": r["snippet_text"],
                    "rank": round(float(r["rank_score"]), 3),
                })

            took_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "query": query,
                "matches": matches,
                "total_matches": len(matches),
                "took_ms": took_ms,
            }
        except sqlite3.OperationalError as e:
            logger.warning(f"Erreur recherche FTS5: {e}")
            return {"query": query, "matches": [], "total_matches": 0, "took_ms": 0.0, "error": str(e)}
        finally:
            conn.close()

    def rebuild_all_sessions(self) -> dict[str, Any]:
        """Reconstruit l'intégralité de l'index FTS5 à partir des dossiers de conversations."""
        start_time = time.perf_counter()
        conn = _get_connection()
        try:
            with _fts_lock:
                conn.execute("DELETE FROM session_transcript_fts")
                conn.execute("DELETE FROM session_fts_indexed_messages")
                conn.execute("DELETE FROM session_fts_index_state")
                conn.commit()

            cursor = conn.execute("SELECT conversation_id FROM conversation_summaries")
            sessions = [r["conversation_id"] for r in cursor.fetchall()]

            total_messages_indexed = 0
            for sid in sessions:
                count = self.index_session_transcript(sid, conn=conn)
                total_messages_indexed += count

            self.optimize()

            took_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "success": True,
                "total_sessions": len(sessions),
                "total_messages_indexed": total_messages_indexed,
                "took_ms": took_ms,
            }
        finally:
            conn.close()

    def sync_all_sessions(self) -> dict[str, Any]:
        """Indexe incrémentalement toutes les sessions qui ont de nouveaux messages sans reconstruire l'index."""
        start_time = time.perf_counter()
        conn = _get_connection()
        try:
            cursor = conn.execute("SELECT conversation_id FROM conversation_summaries")
            sessions = [r["conversation_id"] for r in cursor.fetchall()]

            total_messages_indexed = 0
            for sid in sessions:
                count = self.index_session_transcript(sid, conn=conn)
                total_messages_indexed += count

            took_ms = round((time.perf_counter() - start_time) * 1000, 2)
            return {
                "success": True,
                "total_sessions": len(sessions),
                "total_messages_indexed": total_messages_indexed,
                "took_ms": took_ms,
            }
        finally:
            conn.close()

    def optimize(self) -> None:
        """Optimise les structures d'arbre B et les segments d'index FTS5."""
        conn = _get_connection()
        try:
            with _fts_lock:
                conn.execute("INSERT INTO session_transcript_fts(session_transcript_fts) VALUES('optimize');")
                conn.commit()
        except Exception as e:
            logger.debug(f"FTS optimize notice: {e}")
        finally:
            conn.close()

    def get_stats(self) -> dict[str, Any]:
        """Fournit les statistiques de l'index FTS5."""
        conn = _get_connection()
        try:
            count_row = conn.execute("SELECT count(*) as cnt FROM session_transcript_fts").fetchone()
            sessions_row = conn.execute("SELECT count(DISTINCT session_id) as cnt FROM session_transcript_fts").fetchone()
            return {
                "total_indexed_rows": count_row["cnt"] if count_row else 0,
                "indexed_sessions": sessions_row["cnt"] if sessions_row else 0,
                "engine": "sqlite_fts5",
            }
        finally:
            conn.close()

    # Alias for compatibility with doctor and maintenance callers
    reindex_all = rebuild_all_sessions


fts_service = TranscriptFtsService()


def get_fts_stats() -> dict[str, Any]:
    return fts_service.get_stats()


def reindex_all_conversations() -> dict[str, Any]:
    return fts_service.rebuild_all_sessions()


def sync_fts_conversations() -> dict[str, Any]:
    return fts_service.sync_all_sessions()

