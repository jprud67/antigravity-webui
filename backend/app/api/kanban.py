import os
import time
import uuid
import sqlite3
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from app.api.auth import require_auth

logger = logging.getLogger("antigravity.kanban")
router = APIRouter(prefix="/api/kanban", tags=["kanban"])

HERMES_ROOT = Path(os.environ.get("HERMES_HOME", "/root/.hermes"))
KANBAN_DB_PATH = Path(os.environ.get("HERMES_KANBAN_DB", str(HERMES_ROOT / "kanban.db")))

def get_db_connection() -> sqlite3.Connection:
    KANBAN_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(KANBAN_DB_PATH), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    _ensure_schema(conn)
    return conn

def _ensure_schema(conn: sqlite3.Connection):
    conn.execute("""
    CREATE TABLE IF NOT EXISTS tasks (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        body                 TEXT,
        assignee             TEXT,
        status               TEXT NOT NULL,
        priority             INTEGER DEFAULT 0,
        created_by           TEXT,
        created_at           INTEGER NOT NULL,
        started_at           INTEGER,
        completed_at         INTEGER,
        workspace_kind       TEXT NOT NULL DEFAULT 'scratch',
        workspace_path       TEXT,
        branch_name          TEXT,
        project_id           TEXT,
        claim_lock           TEXT,
        claim_expires        INTEGER,
        tenant               TEXT,
        result               TEXT,
        idempotency_key      TEXT,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        worker_pid           INTEGER,
        last_failure_error   TEXT,
        max_runtime_seconds  INTEGER,
        last_heartbeat_at    INTEGER,
        current_run_id       INTEGER,
        workflow_template_id TEXT,
        current_step_key     TEXT,
        skills               TEXT,
        model_override       TEXT,
        max_retries          INTEGER,
        goal_mode            INTEGER NOT NULL DEFAULT 0,
        goal_max_turns       INTEGER,
        session_id           TEXT,
        block_kind           TEXT,
        block_recurrences    INTEGER NOT NULL DEFAULT 0
    )
    """)
    conn.commit()

class CreateTaskRequest(BaseModel):
    title: str
    body: Optional[str] = ""
    assignee: Optional[str] = "antigravity"
    status: Optional[str] = "todo"
    priority: Optional[int] = 0
    workspace_path: Optional[str] = "/root"
    project_id: Optional[str] = "default"

class UpdateTaskRequest(BaseModel):
    title: Optional[str] = None
    body: Optional[str] = None
    assignee: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[int] = None
    workspace_path: Optional[str] = None
    project_id: Optional[str] = None
    result: Optional[str] = None

@router.get("/tasks")
def list_tasks(
    status: Optional[str] = Query(None),
    project_id: Optional[str] = Query(None),
    _ = Depends(require_auth)
):
    try:
        conn = get_db_connection()
        query = "SELECT * FROM tasks WHERE 1=1"
        params = []
        if status:
            query += " AND status = ?"
            params.append(status)
        if project_id:
            query += " AND project_id = ?"
            params.append(project_id)
        
        query += " ORDER BY priority DESC, created_at DESC"
        cur = conn.cursor()
        cur.execute(query, params)
        rows = cur.fetchall()
        tasks = [dict(row) for row in rows]
        conn.close()

        # Grouping helper
        columns = {
            "todo": [],
            "running": [],
            "blocked": [],
            "done": []
        }
        for t in tasks:
            st = (t.get("status") or "todo").lower()
            if st in ["todo", "ready", "triage", "scheduled"]:
                columns["todo"].append(t)
            elif st in ["running", "review", "in_progress"]:
                columns["running"].append(t)
            elif st in ["blocked", "failed"]:
                columns["blocked"].append(t)
            elif st in ["done", "archived", "completed"]:
                columns["done"].append(t)
            else:
                columns["todo"].append(t)

        return {
            "tasks": tasks,
            "columns": columns,
            "count": len(tasks),
            "db_path": str(KANBAN_DB_PATH)
        }
    except Exception as e:
        logger.error(f"Error listing tasks: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/tasks")
def create_task(req: CreateTaskRequest, _ = Depends(require_auth)):
    if not req.title or not req.title.strip():
        raise HTTPException(status_code=400, detail="Le titre de la tâche est requis")
    
    task_id = f"task-{uuid.uuid4().hex[:8]}"
    now = int(time.time())
    st = req.status.lower() if req.status else "todo"
    
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
        INSERT INTO tasks (
            id, title, body, assignee, status, priority, created_by,
            created_at, workspace_kind, workspace_path, project_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            task_id,
            req.title.strip(),
            req.body or "",
            req.assignee or "antigravity",
            st,
            req.priority or 0,
            "antigravity-webui",
            now,
            "scratch",
            req.workspace_path or "/root",
            req.project_id or "default"
        ))
        conn.commit()

        cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        created = dict(cur.fetchone())
        conn.close()
        return {"success": True, "task": created}
    except Exception as e:
        logger.error(f"Error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/tasks/{task_id}")
def update_task(task_id: str, req: UpdateTaskRequest, _ = Depends(require_auth)):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        row = cur.fetchone()
        if not row:
            conn.close()
            raise HTTPException(status_code=404, detail="Tâche introuvable")

        current = dict(row)
        updates = []
        params = []

        if req.title is not None:
            updates.append("title = ?")
            params.append(req.title.strip())
        if req.body is not None:
            updates.append("body = ?")
            params.append(req.body)
        if req.assignee is not None:
            updates.append("assignee = ?")
            params.append(req.assignee)
        if req.priority is not None:
            updates.append("priority = ?")
            params.append(req.priority)
        if req.workspace_path is not None:
            updates.append("workspace_path = ?")
            params.append(req.workspace_path)
        if req.project_id is not None:
            updates.append("project_id = ?")
            params.append(req.project_id)
        if req.result is not None:
            updates.append("result = ?")
            params.append(req.result)

        if req.status is not None:
            new_st = req.status.lower()
            updates.append("status = ?")
            params.append(new_st)
            now = int(time.time())
            if new_st in ["running", "in_progress"] and not current.get("started_at"):
                updates.append("started_at = ?")
                params.append(now)
            elif new_st in ["done", "completed"] and not current.get("completed_at"):
                updates.append("completed_at = ?")
                params.append(now)

        if updates:
            params.append(task_id)
            cur.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)
            conn.commit()

        cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
        updated = dict(cur.fetchone())
        conn.close()
        return {"success": True, "task": updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, _ = Depends(require_auth)):
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("SELECT id FROM tasks WHERE id = ?", (task_id,))
        if not cur.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="Tâche introuvable")

        cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        conn.close()
        return {"success": True, "task_id": task_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
