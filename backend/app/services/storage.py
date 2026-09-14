import json
import sqlite3
import shutil
import uuid
import html
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from app.config import (
    CONVERSATION_DB,
    BRAIN_DIR,
    SETTINGS_FILE,
    DEFAULT_WORKSPACE
)
from app.services.session_metadata import (
    get_all_session_metadata,
    get_session_meta,
    update_session_meta,
    delete_session_meta
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
                agent_name,
                parent_conversation_id
            FROM conversation_summaries
            ORDER BY last_modified_time DESC
            LIMIT ?
            """,
            (limit * 2,)  # fetch more to allow sorting pinned items
        )
        rows = cursor.fetchall()
        all_meta = get_all_session_metadata()
        
        result = []
        for r in rows:
            cid = r["conversation_id"]
            meta = all_meta.get(cid, {})
            custom_title = meta.get("customTitle", "").strip()
            display_title = custom_title or r["title"] or "Nouvelle session"

            result.append({
                "conversation_id": cid,
                "title": display_title,
                "raw_title": r["title"] or "Nouvelle session",
                "preview": r["preview"],
                "step_count": r["step_count"],
                "last_modified_time": r["last_modified_time"],
                "workspace_uris": r["workspace_uris"],
                "status": r["status"],
                "agent_name": r["agent_name"],
                "parent_conversation_id": r["parent_conversation_id"] if "parent_conversation_id" in r.keys() else None,
                "pinned": meta.get("pinned", False),
                "tags": meta.get("tags", []),
                "project": meta.get("project", ""),
                "projectColor": meta.get("projectColor", ""),
                "customTitle": custom_title
            })

        # Sort pinned conversations first, then by last_modified_time descending (newest first)
        result.sort(key=lambda x: (1 if x["pinned"] else 0, x["last_modified_time"] or ""), reverse=True)
        return result[:limit]
    finally:
        conn.close()

def get_conversation_by_id(conversation_id: str) -> Optional[Dict[str, Any]]:
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
        custom_title = meta.get("customTitle", "").strip()
        display_title = custom_title or r["title"] or "Nouvelle session"
        return {
            "conversation_id": r["conversation_id"],
            "title": display_title,
            "raw_title": r["title"] or "Nouvelle session",
            "preview": r["preview"],
            "step_count": r["step_count"],
            "last_modified_time": r["last_modified_time"],
            "workspace_uris": r["workspace_uris"],
            "status": r["status"],
            "agent_name": r["agent_name"],
            "parent_conversation_id": r["parent_conversation_id"] if "parent_conversation_id" in r.keys() else None,
            "pinned": meta.get("pinned", False),
            "tags": meta.get("tags", []),
            "project": meta.get("project", ""),
            "projectColor": meta.get("projectColor", ""),
            "customTitle": custom_title
        }
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

def calculate_conversation_tokens(steps: List[Dict[str, Any]]) -> Dict[str, Any]:
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
        content = s.get("content") or ""
        thinking = s.get("thinking") or ""
        tool_calls = json.dumps(s.get("tool_calls") or []) if s.get("tool_calls") else ""
        
        src = s.get("source") or ""
        stype = s.get("type") or ""
        
        if src == "USER_EXPLICIT" or stype == "USER_INPUT":
            prompt_chars += len(content)
        else:
            response_chars += len(content) + len(tool_calls)
            thinking_chars += len(thinking)

    p_tokens = max(1, int(prompt_chars / 3.8)) if prompt_chars > 0 else 0
    r_tokens = max(1, int(response_chars / 3.8)) if response_chars > 0 else 0
    t_tokens = max(0, int(thinking_chars / 3.8)) if thinking_chars > 0 else 0
    
    input_tokens = base_sys_tokens + p_tokens + r_tokens + t_tokens
    output_tokens = max(0, r_tokens + t_tokens)
    total_tokens = input_tokens

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "thinking_tokens": t_tokens,
        "total_tokens": total_tokens,
        "is_estimated": True
    }

def fork_conversation(
    source_conversation_id: str,
    up_to_step_index: int,
    new_title: Optional[str] = None
) -> Dict[str, Any]:
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

    with open(transcript_path, "w", encoding="utf-8") as f:
        for step in forked_steps:
            cloned = dict(step)
            if "conversation_id" in cloned:
                cloned["conversation_id"] = new_id
            f.write(json.dumps(cloned, ensure_ascii=False) + "\n")

    with open(transcript_full_path, "w", encoding="utf-8") as f:
        for step in forked_full_steps:
            cloned = dict(step)
            if "conversation_id" in cloned:
                cloned["conversation_id"] = new_id
            f.write(json.dumps(cloned, ensure_ascii=False) + "\n")

    # Copy artifacts if present
    source_dir = BRAIN_DIR / source_conversation_id
    if source_dir.exists():
        for item in source_dir.iterdir():
            if item.name not in [".system_generated", "scratch"]:
                target = new_conv_dir / item.name
                if item.is_file():
                    shutil.copy2(item, target)
                elif item.is_dir():
                    shutil.copytree(item, target, dirs_exist_ok=True)

    # Fetch source record from SQLite
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM conversation_summaries WHERE conversation_id = ?", (source_conversation_id,))
        source_row = cursor.fetchone()
        source_title = source_row["title"] if source_row and source_row["title"] else "Session"
        source_workspace = source_row["workspace_uris"] if source_row and source_row["workspace_uris"] else f'["{DEFAULT_WORKSPACE}"]'
        agent_name = source_row["agent_name"] if source_row and source_row["agent_name"] else ""

        title = new_title or f"{source_title} (Branche #{up_to_step_index})"
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")
        
        last_step = forked_steps[-1]
        preview = (last_step.get("content") or last_step.get("thinking") or "")[:150]

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

def delete_conversation(conversation_id: str) -> bool:
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM conversation_summaries WHERE conversation_id = ?", (conversation_id,))
        conn.commit()
    finally:
        conn.close()

    # Remove brain directory
    conv_dir = BRAIN_DIR / conversation_id
    if conv_dir.exists():
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

def undo_conversation_turn(conversation_id: str) -> Dict[str, Any]:
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

    # Persist updated transcript files
    if transcript_file.exists():
        with open(transcript_file, "w", encoding="utf-8") as f:
            for s in remaining_steps:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")

    if transcript_full_file.exists():
        with open(transcript_full_file, "w", encoding="utf-8") as f:
            for s in remaining_steps:
                f.write(json.dumps(s, ensure_ascii=False) + "\n")

    # Update summary in SQLite database
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        now_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f+00:00")
        last_step = remaining_steps[-1] if remaining_steps else {}
        new_preview = (last_step.get("content") or last_step.get("thinking") or "")[:150]

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

def search_conversations(query: str, limit: int = 50) -> List[Dict[str, Any]]:
    if not query.strip():
        return list_conversations(limit=limit)

    q_lower = query.lower().strip()
    all_convs = list_conversations(limit=200)
    all_meta = get_all_session_metadata()

    matched = []
    seen_ids = set()

    # 1. Match title, preview, customTitle, tags, project
    for c in all_convs:
        cid = c["conversation_id"]
        meta = all_meta.get(cid, {})
        title = (c.get("title") or "").lower()
        preview = (c.get("preview") or "").lower()
        custom_title = (meta.get("customTitle") or "").lower()
        project = (meta.get("project") or "").lower()
        tags = [t.lower() for t in meta.get("tags", [])]

        if (
            q_lower in title
            or q_lower in preview
            or q_lower in custom_title
            or q_lower in project
            or any(q_lower in t or t in q_lower for t in tags)
        ):
            c_copy = dict(c)
            c_copy["match_type"] = "metadata"
            c_copy["match_snippet"] = c.get("preview") or c.get("title")
            matched.append(c_copy)
            seen_ids.add(cid)

    # 2. Deep transcript scan for content if room left
    if len(matched) < limit:
        for c in all_convs:
            cid = c["conversation_id"]
            if cid in seen_ids:
                continue

            steps = get_conversation_transcript(cid)
            for s in steps:
                raw_content = s.get("content") or ""
                raw_thinking = s.get("thinking") or ""
                content_lower = raw_content.lower()
                thinking_lower = raw_thinking.lower()
                if q_lower in content_lower or q_lower in thinking_lower:
                    snippet = ""
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

            if len(matched) >= limit:
                break

    return matched[:limit]

def export_conversation_markdown(conversation_id: str) -> str:
    steps = get_conversation_transcript(conversation_id)
    all_convs = [c for c in list_conversations(limit=200) if c["conversation_id"] == conversation_id]
    title = all_convs[0]["title"] if all_convs else "Conversation Antigravity"

    md_lines = [
        f"# {title}",
        f"**ID de Session :** `{conversation_id}`  ",
        f"**Date d'export :** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC')}  ",
        f"**Nombre d'étapes :** {len(steps)}  ",
        "---",
        ""
    ]

    for s in steps:
        role = "User" if s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT" else "Antigravity Assistant"
        content = s.get("content", "").strip()
        thinking = s.get("thinking", "").strip()
        tool_calls = s.get("tool_calls", [])

        md_lines.append(f"## {role}")
        if thinking:
            md_lines.append("> [!NOTE] Raisonnement Interne")
            for t_line in thinking.splitlines():
                md_lines.append(f"> {t_line}")
            md_lines.append("")

        if tool_calls:
            for tc in tool_calls:
                tname = tc.get("name", "tool")
                targs = json.dumps(tc.get("args", {}), indent=2)
                md_lines.append(f"**Appel d'outil :** `{tname}`")
                md_lines.append(f"```json\n{targs}\n```")
                md_lines.append("")

        if content:
            md_lines.append(content)
            md_lines.append("")

        md_lines.append("---")
        md_lines.append("")

    return "\n".join(md_lines)

def export_conversation_html(conversation_id: str) -> str:
    steps = get_conversation_transcript(conversation_id)
    all_convs = [c for c in list_conversations(limit=200) if c["conversation_id"] == conversation_id]
    title = all_convs[0]["title"] if all_convs else "Conversation Antigravity"
    date_str = datetime.now(timezone.utc).strftime('%d/%m/%Y %H:%M:%S UTC')

    messages_html = []
    for idx, s in enumerate(steps):
        is_user = s.get("source") == "USER_EXPLICIT" or s.get("type") == "USER_INPUT"
        content = s.get("content", "")
        thinking = s.get("thinking", "")
        tool_calls = s.get("tool_calls", [])

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
        if tool_calls:
            tools_rendered = []
            for tc in tool_calls:
                tname = html.escape(tc.get("name", "tool"))
                targs = html.escape(json.dumps(tc.get("args", {}), indent=2))
                tools_rendered.append(f"""
                <div class="tool-card">
                    <div class="tool-header">⚙️ <strong>{tname}</strong></div>
                    <pre class="tool-args">{targs}</pre>
                </div>
                """)
            tools_html = "".join(tools_rendered)

        escaped_content = html.escape(content).replace("\n", "<br>")

        messages_html.append(f"""
        <div class="message-row {'row-user' if is_user else 'row-assistant'}">
            <div class="avatar">{avatar}</div>
            <div class="bubble {bubble_class}">
                <div class="bubble-header">
                    <span class="sender">{sender_label}</span>
                    <span class="step-badge">Étape #{s.get('step_index', idx)}</span>
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
        .thought-block {{
            background: #090e1c;
            border: 1px solid #1e1b4b;
            border-radius: 8px;
            margin-bottom: 12px;
            overflow: hidden;
        }}
        .thought-block summary {{
            padding: 8px 12px;
            font-size: 11px;
            cursor: pointer;
            color: #a5b4fc;
            font-weight: 600;
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
        .tool-card {{
            background: #090e1c;
            border: 1px solid #1e293b;
            border-radius: 8px;
            margin-bottom: 12px;
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
        }}
        .content {{
            white-space: pre-wrap;
            word-break: break-word;
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
                <div class="meta">Session ID: {conversation_id} • Exporté le {date_str} • {len(steps)} étapes</div>
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
    # Strictly confine path to BRAIN_DIR / conversation_id
    base_dir = (BRAIN_DIR / conversation_id).resolve()
    target_path = (base_dir / filename).resolve()
    try:
        if not target_path.is_relative_to(base_dir):
            raise PermissionError("Accès refusé : tentative de traversée de répertoire non autorisée.")
    except AttributeError:
        if base_dir not in target_path.parents and target_path != base_dir:
            raise PermissionError("Accès refusé : tentative de traversée de répertoire non autorisée.")
    if not target_path.exists() or not target_path.is_file():
        raise FileNotFoundError(f"Artifact introuvable : {filename}")
    try:
        return target_path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        raw = target_path.read_bytes()
        return f"[Fichier binaire : {len(raw)} octets]"

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
    tmp_file = SETTINGS_FILE.parent / f".settings.json.tmp.{uuid.uuid4().hex[:8]}"
    tmp_file.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp_file.replace(SETTINGS_FILE)
    return current
