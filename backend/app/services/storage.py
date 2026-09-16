import html
import json
import logging
import re
import shutil
import sqlite3
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import BRAIN_DIR, CONVERSATION_DB, DEFAULT_WORKSPACE, SETTINGS_FILE
from app.services.session_metadata import (
    bulk_delete_session_meta,
    delete_session_meta,
    get_all_session_metadata,
    get_session_meta,
    update_session_meta,
)

logger = logging.getLogger("antigravity.storage")


def is_safe_conversation_id(conversation_id: str) -> bool:
    """Verifies conversation_id is safe, contains no directory traversal elements, and stays inside BRAIN_DIR."""
    if not conversation_id or not isinstance(conversation_id, str):
        return False
    if ".." in conversation_id or "/" in conversation_id or "\\" in conversation_id:
        return False
    try:
        resolved_brain = BRAIN_DIR.resolve()
        resolved_conv = (BRAIN_DIR / conversation_id).resolve()
        return resolved_conv.is_relative_to(resolved_brain) and resolved_conv != resolved_brain
    except Exception:
        return False


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
    return conn

def _build_conversation_dict(r: sqlite3.Row, meta: dict) -> dict:
    """Construit le dict conversation à partir d'une ligne SQLite et des métadonnées session."""
    cid = r["conversation_id"]
    custom_title = (meta.get("customTitle") or "").strip()
    display_title = custom_title or r["title"] or "Nouvelle session"
    return {
        "conversation_id": cid,
        "title": display_title,
        "raw_title": r["title"] or "Nouvelle session",
        "preview": r["preview"],
        "step_count": r["step_count"],
        "last_modified_time": r["last_modified_time"],
        "workspace_uris": r["workspace_uris"],
        "status": r["status"],
        "agent_name": r["agent_name"],
        "parent_conversation_id": dict(r).get("parent_conversation_id"),
        "pinned": meta.get("pinned", False),
        "archived": meta.get("archived", False),
        "tags": meta.get("tags", []),
        "project": meta.get("project", ""),
        "projectColor": meta.get("projectColor", ""),
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
                parent_conversation_id
            FROM conversation_summaries
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (limit * 2,)  # fetch more to allow sorting pinned items
        )
        rows = list(cursor.fetchall())
        all_meta = get_all_session_metadata()

        # Guarantee all pinned conversations are fetched even if older than limit * 2
        pinned_ids = [cid for cid, m in all_meta.items() if m.get("pinned")]
        fetched_ids = {r["conversation_id"] for r in rows}
        missing_pinned = [cid for cid in pinned_ids if cid not in fetched_ids]
        if missing_pinned:
            placeholders = ",".join("?" * len(missing_pinned))
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
                    parent_conversation_id
                FROM conversation_summaries
                WHERE conversation_id IN ({placeholders})
                """,
                tuple(missing_pinned)
            )
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

def get_conversation_by_id(conversation_id: str) -> dict[str, Any] | None:
    if not CONVERSATION_DB.exists():
        return None
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
                parent_conversation_id
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
        conn.close()


def get_conversation_transcript(conversation_id: str) -> list[dict[str, Any]]:
    if not is_safe_conversation_id(conversation_id):
        return []
    conv_dir = BRAIN_DIR / conversation_id
    transcript_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    transcript_full_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"

    target_file = transcript_full_file if transcript_full_file.exists() else (transcript_file if transcript_file.exists() else None)

    if not target_file:
        return []

    steps = []
    try:
        with open(target_file, "r", encoding="utf-8") as f:
            for line in f:
                line_str = line.strip()
                if not line_str:
                    continue
                try:
                    steps.append(json.loads(line_str))
                except json.JSONDecodeError:
                    continue
    except Exception:
        pass
    return steps

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
        if "usage" in s and isinstance(s["usage"], dict) and s["usage"].get("total_tokens", 0) > 0:
            u = s["usage"]
            return {
                "input_tokens": u.get("input_tokens", 0),
                "output_tokens": u.get("output_tokens", 0),
                "thinking_tokens": u.get("thinking_tokens", 0),
                "total_tokens": u.get("total_tokens", 0),
                "is_estimated": False
            }

    # Antigravity base system context (system prompt + 30+ tool definitions + schemas)
    base_sys_tokens = 13370
    
    prompt_chars = 0
    response_chars = 0
    thinking_chars = 0
    
    for s in steps:
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
            prompt_chars += len(content)
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

def atomic_write_jsonl(target_path: Path, items: list[dict[str, Any]]) -> None:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_file = target_path.parent / f".{target_path.name}.tmp.{uuid.uuid4().hex[:8]}"
    try:
        with open(tmp_file, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(item, ensure_ascii=False) + "\n" for item in items)
        tmp_file.replace(target_path)
    except Exception:
        if tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass
        raise

def fork_conversation(
    source_conversation_id: str,
    up_to_step_index: int,
    new_title: str | None = None
) -> dict[str, Any]:
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
            with open(source_full_file, "r", encoding="utf-8") as sf:
                for line in sf:
                    line = line.strip()
                    if line:
                        source_full_steps.append(json.loads(line))
        except Exception:
            source_full_steps = []

    forked_full_steps = [s for s in source_full_steps if s.get("step_index", 0) <= up_to_step_index] if source_full_steps else forked_steps
    if not forked_full_steps:
        forked_full_steps = forked_steps

    forked_transcripts = []
    for step in forked_steps:
        cloned = dict(step)
        if "conversation_id" in cloned:
            cloned["conversation_id"] = new_id
        forked_transcripts.append(cloned)
    atomic_write_jsonl(transcript_path, forked_transcripts)

    forked_full_transcripts = []
    for step in forked_full_steps:
        cloned = dict(step)
        if "conversation_id" in cloned:
            cloned["conversation_id"] = new_id
        forked_full_transcripts.append(cloned)
    atomic_write_jsonl(transcript_full_path, forked_full_transcripts)

    # Copy artifacts if present
    source_dir = BRAIN_DIR / source_conversation_id
    if source_dir.exists():
        for item in source_dir.iterdir():
            # Exclude internal system folders, scratch, and temp/lock files
            if item.name not in [".system_generated", "scratch"] and not item.name.startswith((".tmp", ".lock")):
                try:
                    target = new_conv_dir / item.name
                    if item.is_file():
                        shutil.copy2(item, target)
                    elif item.is_dir():
                        shutil.copytree(item, target, dirs_exist_ok=True)
                except Exception as e:
                    logger.warning(f"Failed to copy artifact {item.name}: {e}")

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

        title = new_title or f"{source_title} (Branche #{up_to_step_index})"
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")
        
        last_step = forked_steps[-1]
        preview = str(last_step.get("content") or last_step.get("thinking") or "")[:150]

        cursor.execute(
            """
            INSERT INTO conversation_summaries (
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                last_user_input_time,
                last_user_input_step_index
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                title,
                preview,
                len(forked_steps),
                now_str,
                source_workspace,
                "DONE",
                agent_name,
                source_conversation_id,
                now_str,
                up_to_step_index
            )
        )
        conn.commit()
    finally:
        conn.close()

    # Inherit tags & project from source metadata
    source_meta = get_session_meta(source_conversation_id)
    if source_meta:
        update_session_meta(new_id, {
            "tags": list(source_meta.get("tags", [])),
            "project": source_meta.get("project", ""),
            "projectColor": source_meta.get("projectColor", ""),
            "pinned": False,
            "customTitle": ""
        })

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
                user_requests.append(content.strip()[:300])
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

    # Copy artifacts if present
    if source_dir.exists():
        for item in source_dir.iterdir():
            if item.name not in [".system_generated", "scratch"]:
                target = new_conv_dir / item.name
                if item.is_file():
                    shutil.copy2(item, target)
                elif item.is_dir():
                    shutil.copytree(item, target, dirs_exist_ok=True)

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


    title = new_title or f"[Suite] {source_title}"
    preview = f"Nouvelle section avec mémoire transférée de « {source_title} »"

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO conversation_summaries (
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                last_user_input_time,
                last_user_input_step_index
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                title,
                preview,
                2,
                now_iso,
                source_workspace,
                "DONE",
                agent_name,
                source_conversation_id,
                now_iso,
                0
            )
        )
        conn.commit()
    finally:
        conn.close()

    # Inherit tags & project from source metadata
    source_meta = get_session_meta(source_conversation_id) or {}
    new_tags = list(source_meta.get("tags", []))
    if "suite" not in new_tags:
        new_tags.append("suite")
    update_session_meta(new_id, {
        "tags": new_tags,
        "project": source_meta.get("project", ""),
        "projectColor": source_meta.get("projectColor", ""),
        "pinned": False,
        "customTitle": ""
    })

    return {
        "conversation_id": new_id,
        "title": title,
        "step_count": 2,
        "parent_conversation_id": source_conversation_id,
        "summary": summary_text
    }


def bulk_delete_conversations(conversation_ids: list[str]) -> bool:
    if not conversation_ids:
        return True
    safe_ids = [cid for cid in conversation_ids if is_safe_conversation_id(cid)]
    if not safe_ids:
        return True
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.executemany("DELETE FROM conversation_summaries WHERE conversation_id = ?", [(cid,) for cid in safe_ids])
        conn.commit()
    finally:
        conn.close()

    brain_resolved = BRAIN_DIR.resolve()
    for cid in safe_ids:
        conv_dir = (BRAIN_DIR / cid).resolve()
        if conv_dir.exists() and conv_dir.is_relative_to(brain_resolved) and conv_dir != brain_resolved:
            shutil.rmtree(conv_dir, ignore_errors=True)

    bulk_delete_session_meta(safe_ids)
    return True

def delete_conversation(conversation_id: str) -> bool:
    if not is_safe_conversation_id(conversation_id):
        return False
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversation_summaries WHERE conversation_id = ?", (conversation_id,))
        conn.commit()
    finally:
        conn.close()

    # Remove brain directory safely
    brain_resolved = BRAIN_DIR.resolve()
    conv_dir = (BRAIN_DIR / conversation_id).resolve()
    if conv_dir.exists() and conv_dir.is_relative_to(brain_resolved) and conv_dir != brain_resolved:
        shutil.rmtree(conv_dir, ignore_errors=True)

    # Delete metadata
    delete_session_meta(conversation_id)
    return True

def update_conversation_title(conversation_id: str, new_title: str) -> bool:
    update_session_meta(conversation_id, {"customTitle": new_title})
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("UPDATE conversation_summaries SET title = ? WHERE conversation_id = ?", (new_title, conversation_id))
        conn.commit()
    finally:
        conn.close()
    return True

def undo_conversation_turn(conversation_id: str) -> dict[str, Any]:
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Invalid conversation_id")
    conv_dir = BRAIN_DIR / conversation_id
    transcript_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    transcript_full_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"

    steps = get_conversation_transcript(conversation_id)
    if not steps:
        return {"conversation_id": conversation_id, "step_count": 0, "steps": [], "usage": calculate_conversation_tokens([])}

    # Locate the last user input step
    last_user_idx = -1
    for i in range(len(steps) - 1, -1, -1):
        s = steps[i]
        if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
            last_user_idx = i
            break

    if last_user_idx != -1:
        remaining_steps = steps[:last_user_idx]
    else:
        remaining_steps = steps[:-1]

    # Persist updated compact transcript file atomically
    if transcript_file.exists():
        atomic_write_jsonl(transcript_file, remaining_steps)

    # Persist updated full transcript file independently to avoid degrading unabridged history
    remaining_full_steps = remaining_steps  # valeur de repli sûre si le fichier est absent
    if transcript_full_file.exists():
        full_steps = []
        try:
            with open(transcript_full_file, "r", encoding="utf-8") as f:
                for line in f:
                    line_str = line.strip()
                    if line_str:
                        full_steps.append(json.loads(line_str))
        except Exception as e:
            logger.warning(f"Failed to read transcript_full_file: {e}")
            full_steps = []

        if full_steps:
            last_full_user_idx = -1
            for i in range(len(full_steps) - 1, -1, -1):
                s = full_steps[i]
                if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT":
                    last_full_user_idx = i
                    break
            if last_full_user_idx != -1:
                remaining_full_steps = full_steps[:last_full_user_idx]
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
        new_preview = str(last_step.get("content") or last_step.get("thinking") or "")[:150]

        cursor.execute(
            """
            UPDATE conversation_summaries
            SET step_count = ?, preview = ?, last_modified_time = ?
            WHERE conversation_id = ?
            """,
            (len(remaining_steps), new_preview, now_str, conversation_id)
        )
        conn.commit()
    finally:
        conn.close()

    usage = calculate_conversation_tokens(remaining_steps)
    return {
        "conversation_id": conversation_id,
        "step_count": len(remaining_steps),
        "steps": remaining_steps,
        "usage": usage
    }

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
                parent_conversation_id
            FROM conversation_summaries
            WHERE title LIKE ? OR preview LIKE ?
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (f"%{q_clean}%", f"%{q_clean}%", limit)
        )
        for r in cursor.fetchall():
            cid = r["conversation_id"]
            meta = all_meta.get(cid, {})
            custom_title = meta.get("customTitle", "").strip()
            display_title = custom_title or r["title"] or "Nouvelle session"
            c = {
                "conversation_id": cid,
                "title": display_title,
                "raw_title": r["title"] or "Nouvelle session",
                "preview": r["preview"],
                "step_count": r["step_count"],
                "last_modified_time": r["last_modified_time"],
                "workspace_uris": r["workspace_uris"],
                "status": r["status"],
                "agent_name": r["agent_name"],
                "parent_conversation_id": dict(r).get("parent_conversation_id"),
                "pinned": meta.get("pinned", False),
                "archived": meta.get("archived", False),
                "tags": meta.get("tags", []),
                "project": meta.get("project", ""),
                "projectColor": meta.get("projectColor", ""),
                "customTitle": custom_title,
                "match_type": "metadata",
                "match_snippet": r["preview"] or display_title
            }
            matched.append(c)
            seen_ids.add(cid)
    finally:
        conn.close()

    # 2. Match customTitle, tags, project from session metadata for convs not yet matched
    if len(matched) < limit:
        for cid, meta in all_meta.items():
            if cid in seen_ids:
                continue
            custom_title = (meta.get("customTitle") or "").lower()
            project = (meta.get("project") or "").lower()
            tags = [t.lower() for t in meta.get("tags", [])]
            if (
                q_lower in custom_title
                or q_lower in project
                or any(q_lower in t or t in q_lower for t in tags)
            ):
                c_item = get_conversation_by_id(cid)
                if c_item:
                    c_item["match_type"] = "metadata"
                    c_item["match_snippet"] = meta.get("customTitle") or meta.get("project") or c_item.get("preview")
                    matched.append(c_item)
                    seen_ids.add(cid)
                    if len(matched) >= limit:
                        break

    # 3. Deep transcript scan for content if room left (scans recent active sessions)
    if len(matched) < limit:
        recent_convs = list_conversations(limit=50)
        for c in recent_convs:
            cid = c["conversation_id"]
            if cid in seen_ids:
                continue

            conv_dir = BRAIN_DIR / cid
            t_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
            if not t_file.exists():
                t_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"
            if not t_file.exists():
                continue

            try:
                with open(t_file, "r", encoding="utf-8", errors="ignore") as f:
                    for line in f:
                        if q_lower not in line.lower():
                            continue
                        try:
                            s = json.loads(line)
                            raw_content = s.get("content") or ""
                            raw_thinking = s.get("thinking") or ""
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
                                c_copy["match_snippet"] = snippet
                                matched.append(c_copy)
                                seen_ids.add(cid)
                                break
                        except Exception:
                            continue
            except Exception:
                continue

            if len(matched) >= limit:
                break

    return matched[:limit]

def clean_user_prompt(raw: str) -> str:
    if not raw:
        return ""
    text = raw
    text = re.sub(r'</?USER_REQUEST>', '', text)
    text = re.sub(r'<ADDITIONAL_METADATA>[\s\S]*?</ADDITIONAL_METADATA>', '', text)
    text = re.sub(r'<USER_SETTINGS_CHANGE>[\s\S]*?</USER_SETTINGS_CHANGE>', '', text)
    return text.strip()

def aggregate_steps_into_turns(steps: list[dict[str, Any]]) -> list[dict[str, Any]]:
    if not steps:
        return []

    turns: list[dict[str, Any]] = []
    current_asst: dict[str, Any] | None = None

    def flush_asst():
        nonlocal current_asst
        if current_asst:
            turns.append(current_asst)
            current_asst = None

    for idx, s in enumerate(steps):
        stype = s.get("type", "")
        source = s.get("source", "")
        raw_c = s.get("content")
        if isinstance(raw_c, str):
            content = raw_c
        elif raw_c is None:
            content = ""
        else:
            try:
                content = json.dumps(raw_c, ensure_ascii=False, indent=2)
            except Exception:
                content = str(raw_c)

        raw_t = s.get("thinking")
        if isinstance(raw_t, str):
            thinking = raw_t
        elif raw_t is None:
            thinking = ""
        else:
            try:
                thinking = json.dumps(raw_t, ensure_ascii=False, indent=2)
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

        # 2. User input
        if source == "USER_EXPLICIT" or stype == "USER_INPUT":
            flush_asst()
            turns.append({
                "role": "user",
                "step_index": step_index,
                "timestamp": ts,
                "content": clean_user_prompt(content) or content,
            })
            continue

        # 3. Tool outputs (GENERIC / SYSTEM steps following a tool call)
        tool_calls = s.get("tool_calls") or []
        is_tool_output = (
            stype in ["GENERIC", "SYSTEM", "TOOL_RESULT"]
            and not tool_calls
            and not thinking
        )

        if is_tool_output and current_asst:
            activities = current_asst.get("tool_activities", [])
            pending = None
            for act in reversed(activities):
                if not act.get("result"):
                    pending = act
                    break
            if pending:
                pending["result"] = content
                pending["status"] = "done"
            else:
                if content:
                    existing = current_asst.get("content", "")
                    current_asst["content"] = f"{existing}\n\n{content}".strip() if existing else content
            continue

        # 4. Assistant actions
        mapped_tools = []
        for tc in tool_calls:
            mapped_tools.append({
                "name": tc.get("name", "tool"),
                "args": tc.get("args", {}),
                "result": "",
                "status": "done" if s.get("status") == "DONE" else "running"
            })

        if current_asst:
            if thinking:
                existing_t = current_asst.get("thinking", "")
                current_asst["thinking"] = f"{existing_t}\n\n{thinking}".strip() if existing_t else thinking
            if content:
                existing_c = current_asst.get("content", "")
                current_asst["content"] = f"{existing_c}\n\n{content}".strip() if existing_c else content
            if mapped_tools:
                current_asst["tool_activities"].extend(mapped_tools)
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
            md_lines.append(turn.get("content", "").strip() or "*(Message vide)*")
            md_lines.append("")
            md_lines.append("---")
            md_lines.append("")
            continue

        # Assistant turn
        md_lines.append(f"## ⚡ Assistant Antigravity (Étape #{idx})")
        md_lines.append("")

        thinking = turn.get("thinking", "").strip()
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
                targs = json.dumps(act.get("args", {}), indent=2, ensure_ascii=False)
                res = act.get("result", "")
                md_lines.append(f"### Outil : `{tname}`")
                md_lines.append(f"```json\n{targs}\n```")
                if res:
                    md_lines.append("**Résultat :**")
                    md_lines.append(f"```\n{res[:2000]}{'...' if len(res) > 2000 else ''}\n```")
                md_lines.append("")
            md_lines.append("</details>\n")

        content = turn.get("content", "").strip()
        if content:
            md_lines.append(content)
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

    messages_html = []
    for turn in turns:
        role = turn["role"]
        idx = turn.get("step_index", 0)

        if role == "checkpoint":
            messages_html.append(f"""
            <div class="checkpoint-divider">
                <span>📌 Point de restauration — Étape #{idx}</span>
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
            escaped_thought = html.escape(thinking)
            thought_html = f"""
            <details class="thought-block">
                <summary>🧠 Raisonnement interne ({len(thinking)} car.)</summary>
                <pre class="thought-content">{escaped_thought}</pre>
            </details>
            """

        tools_html = ""
        if tool_activities:
            tools_rendered = []
            for act in tool_activities:
                tname = html.escape(act.get("name", "tool"))
                targs = html.escape(json.dumps(act.get("args", {}), indent=2, ensure_ascii=False))
                res = act.get("result", "")
                res_html = ""
                if res:
                    escaped_res = html.escape(res[:2000] + ("..." if len(res) > 2000 else ""))
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

        escaped_content = html.escape(content).replace("\n", "<br>")

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
                <div class="content">{escaped_content}</div>
            </div>
        </div>
        """)

    body_content = "\n".join(messages_html)

    return f"""<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{html.escape(title)} - Antigravity WebUI</title>
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
            align-items: center;
            justify-content: center;
            margin: 24px 0;
            position: relative;
        }}
        .checkpoint-divider::before {{
            content: '';
            position: absolute;
            left: 0;
            right: 0;
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
                <h1>{html.escape(title)}</h1>
                <div class="meta">Session ID: {conversation_id} • Exporté le {date_str} • {len(turns)} échanges ({len(steps)} étapes)</div>
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
        dirs_to_scan = [p for p in BRAIN_DIR.iterdir() if p.is_dir()] if BRAIN_DIR.exists() else []

    for cdir in dirs_to_scan:
        if not cdir.is_dir():
            continue
        c_id = cdir.name
        for p in cdir.rglob("*"):
            if not p.is_file():
                continue
            rel_parts = p.relative_to(cdir).parts
            if ".system_generated" in rel_parts or "scratch" in rel_parts:
                continue
            stat = p.stat()
            artifacts.append({
                "conversation_id": c_id,
                "filename": p.name,
                "relative_path": str(p.relative_to(cdir)),
                "full_path": str(p),
                "size": stat.st_size,
                "last_modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat()
            })
    artifacts.sort(key=lambda x: str(x["last_modified"]), reverse=True)
    return artifacts

_settings_lock = threading.RLock()

def read_artifact_content(conversation_id: str, filename: str) -> str:
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")
    base_dir = (BRAIN_DIR / conversation_id).resolve()
    target_path = (base_dir / filename).resolve()
    if not target_path.is_relative_to(base_dir):
        raise PermissionError("Accès refusé : tentative de traversée de répertoire non autorisée.")
    rel_parts = target_path.relative_to(base_dir).parts
    if ".system_generated" in rel_parts or "scratch" in rel_parts:
        raise PermissionError("Accès refusé : les fichiers système internes ou temporaires ne sont pas accessibles via les artefacts.")
    if not target_path.exists() or not target_path.is_file():
        raise FileNotFoundError(f"Artifact introuvable : {filename}")
    try:
        return target_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw = target_path.read_bytes()
        return f"[Fichier binaire : {len(raw)} octets]"

def get_settings() -> dict[str, Any]:
    defaults: dict[str, Any] = {
        "agentMode": "accept-edits",
        "colorScheme": "dark",
        "model": "Gemini 3.8 Flash (High)",
        "trustedWorkspaces": [DEFAULT_WORKSPACE]
    }
    with _settings_lock:
        if not SETTINGS_FILE.exists():
            return defaults
        try:
            content = SETTINGS_FILE.read_text(encoding="utf-8")
            if not content.strip():
                return defaults
            data = json.loads(content)
            return data if isinstance(data, dict) else defaults
        except Exception as exc:
            logger.warning(f"Failed to parse settings.json, returning defaults: {exc}")
            return defaults

def save_settings(new_settings: dict[str, Any]) -> dict[str, Any]:
    with _settings_lock:
        current = get_settings()
        current.update(new_settings)
        SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = SETTINGS_FILE.parent / f".settings.json.tmp.{uuid.uuid4().hex[:8]}"
        try:
            tmp_file.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_file.replace(SETTINGS_FILE)
        except Exception:
            if tmp_file.exists():
                try:
                    tmp_file.unlink()
                except Exception:
                    pass
            raise
        return current

def import_conversation(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Import a conversation from JSON payload.
    Supports:
    1. Antigravity JSON export format ({ conversation_id, metadata, steps })
    2. Hermes WebUI session format ({ session_id, title, messages, ... })
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    new_id = str(uuid.uuid4())

    title = "Conversation importée"
    steps = []

    # Format 1: Antigravity export
    if "steps" in payload and isinstance(payload["steps"], list):
        steps = payload["steps"]
        meta = payload.get("metadata") or {}
        title = meta.get("customTitle") or meta.get("title") or title
    # Format 2: Hermes session format
    elif "messages" in payload and isinstance(payload["messages"], list):
        title = payload.get("title") or title
        for idx, m in enumerate(payload["messages"]):
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
    new_logs_dir = new_conv_dir / ".system_generated" / "logs"
    new_logs_dir.mkdir(parents=True, exist_ok=True)

    transcript_path = new_logs_dir / "transcript.jsonl"
    transcript_full_path = new_logs_dir / "transcript_full.jsonl"

    cloned_steps = []
    for s in steps:
        cloned = dict(s)
        cloned["conversation_id"] = new_id
        cloned_steps.append(cloned)

    atomic_write_jsonl(transcript_path, cloned_steps)
    atomic_write_jsonl(transcript_full_path, cloned_steps)

    update_session_meta(new_id, {
        "customTitle": title,
        "title": title,
        "pinned": False,
        "archived": False,
        "tags": payload.get("tags") or ["importé"],
        "project": payload.get("project") or ""
    })

    # Persist summary in SQLite database so the imported session appears in session lists
    preview = ""
    for s in steps:
        c = s.get("content") or s.get("thinking") or ""
        if c:
            preview = str(c)[:150]
            break

    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute(
            """
            INSERT INTO conversation_summaries (
                conversation_id,
                title,
                preview,
                step_count,
                last_modified_time,
                workspace_uris,
                status,
                agent_name,
                parent_conversation_id,
                last_user_input_time,
                last_user_input_step_index
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                new_id,
                title,
                preview,
                len(steps),
                now_iso,
                json.dumps([get_default_workspace_uri()]),
                "DONE",
                "import",
                None,
                now_iso,
                0
            )
        )
        conn.commit()
    finally:
        conn.close()

    return {
        "success": True,
        "conversation_id": new_id,
        "title": title,
        "steps_count": len(steps)
    }

