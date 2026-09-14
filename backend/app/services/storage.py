import json
import sqlite3
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime
from app.config import (
    CONVERSATION_DB,
    BRAIN_DIR,
    SETTINGS_FILE,
    DEFAULT_WORKSPACE
)

def get_db_connection() -> sqlite3.Connection:
    if not CONVERSATION_DB.exists():
        raise FileNotFoundError(f"Database {CONVERSATION_DB} not found")
    conn = sqlite3.connect(str(CONVERSATION_DB))
    conn.row_factory = sqlite3.Row
    return conn

def list_conversations(limit: int = 100) -> List[Dict[str, Any]]:
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
                agent_name
            FROM conversation_summaries
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (limit,)
        )
        rows = cursor.fetchall()
        result = []
        for r in rows:
            result.append({
                "conversation_id": r["conversation_id"],
                "title": r["title"] or "Nouvelle session",
                "preview": r["preview"],
                "step_count": r["step_count"],
                "last_modified_time": r["last_modified_time"],
                "workspace_uris": r["workspace_uris"],
                "status": r["status"],
                "agent_name": r["agent_name"]
            })
        return result
    finally:
        conn.close()

def get_conversation_transcript(conversation_id: str) -> List[Dict[str, Any]]:
    conv_dir = BRAIN_DIR / conversation_id
    transcript_file = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    transcript_full_file = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"

    target_file = transcript_file if transcript_file.exists() else None
    if not target_file and transcript_full_file.exists():
        target_file = transcript_full_file

    if not target_file:
        return []

    steps = []
    with open(target_file, "r", encoding="utf-8") as f:
        for line in f:
            line_str = line.strip()
            if not line_str:
                continue
            steps.append(json.loads(line_str))
    return steps

def list_artifacts(conversation_id: Optional[str] = None) -> List[Dict[str, Any]]:
    artifacts = []
    if conversation_id:
        dirs_to_scan = [BRAIN_DIR / conversation_id]
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
                "last_modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })
    artifacts.sort(key=lambda x: x["last_modified"], reverse=True)
    return artifacts

def read_artifact_content(conversation_id: str, filename: str) -> str:
    path = BRAIN_DIR / conversation_id / filename
    if not path.exists():
        raise FileNotFoundError(f"Artifact not found at {path}")
    return path.read_text(encoding="utf-8")

def get_settings() -> Dict[str, Any]:
    if not SETTINGS_FILE.exists():
        return {
            "agentMode": "accept-edits",
            "colorScheme": "dark",
            "model": "Gemini 3.8 Flash (High)",
            "trustedWorkspaces": [DEFAULT_WORKSPACE]
        }
    return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))

def save_settings(new_settings: Dict[str, Any]) -> Dict[str, Any]:
    current = get_settings()
    current.update(new_settings)
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(current, indent=2), encoding="utf-8")
    return current
