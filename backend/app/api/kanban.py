import logging
import os
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE, GEMINI_DIR
from app.platform_utils import restrict_file_permissions

logger = logging.getLogger("antigravity.kanban")
router = APIRouter(prefix="/api/kanban", tags=["kanban"])

KANBAN_DB_PATH = Path(os.environ.get("ANTIGRAVITY_KANBAN_DB", str(GEMINI_DIR / "webui_kanban.db")))
_schema_lock = threading.RLock()
_schema_initialized = False


def get_db_connection() -> sqlite3.Connection:
    global _schema_initialized
    KANBAN_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(KANBAN_DB_PATH), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=5000")
    if not _schema_initialized:
        with _schema_lock:
            if not _schema_initialized:
                _ensure_schema(conn)
                restrict_file_permissions(KANBAN_DB_PATH)
                _schema_initialized = True
    return conn


@contextmanager
def get_db():
    conn = get_db_connection()
    try:
        yield conn
    finally:
        try:
            conn.close()
        except Exception as e:
            logger.debug(f"Fermeture DB kanban : {e}")

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
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(tasks)")
    existing_cols = {row[1] for row in cur.fetchall()}
    expected_cols = {
        "workspace_path": "TEXT",
        "branch_name": "TEXT",
        "project_id": "TEXT",
        "result": "TEXT",
        "started_at": "INTEGER",
        "completed_at": "INTEGER",
        "skills": "TEXT",
        "model_override": "TEXT",
    }
    for col, col_type in expected_cols.items():
        if col not in existing_cols:
            try:
                conn.execute(f'ALTER TABLE tasks ADD COLUMN "{col}" {col_type}')
            except Exception as e:
                logger.debug(f"Ignored error: {e}")
    conn.commit()

class CreateTaskRequest(BaseModel):
    title: str
    body: str | None = ""
    assignee: str | None = "antigravity"
    status: str | None = "todo"
    priority: int | None = 0
    workspace_path: str | None = None
    project_id: str | None = "default"

class UpdateTaskRequest(BaseModel):
    title: str | None = None
    body: str | None = None
    assignee: str | None = None
    status: str | None = None
    priority: int | None = None
    workspace_path: str | None = None
    project_id: str | None = None
    result: str | None = None

def _normalize_status(st: str) -> str:
    return st.lower().strip().replace("-", "_")


_ALLOWED_TASK_UPDATE_COLUMNS: frozenset[str] = frozenset({
    "title",
    "body",
    "assignee",
    "status",
    "priority",
    "workspace_path",
    "project_id",
    "result",
    "started_at",
    "completed_at",
})


@router.get("/tasks")
def list_tasks(
    status: str | None = Query(None),
    project_id: str | None = Query(None),
    _ = Depends(require_auth)
):
    try:
        with get_db() as conn:
            query = "SELECT * FROM tasks WHERE 1=1"
            params: list = []
            if status:
                query += " AND LOWER(REPLACE(status, '-', '_')) = ?"
                params.append(_normalize_status(status))
            if project_id:
                query += " AND project_id = ?"
                params.append(project_id.strip())
            
            query += " ORDER BY priority DESC, created_at DESC"
            cur = conn.cursor()
            cur.execute(query, params)
            rows = cur.fetchall()
            tasks = [dict(row) for row in rows]

        # Grouping helper
        columns: dict[str, list[dict[str, Any]]] = {
            "todo": [],
            "running": [],
            "blocked": [],
            "done": []
        }
        for t in tasks:
            st = _normalize_status(t.get("status") or "todo")
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
    st = _normalize_status(req.status or "todo")
    started_at = now if st in ["running", "in_progress"] else None
    completed_at = now if st in ["done", "completed"] else None
    if completed_at and not started_at:
        started_at = now
    
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("""
            INSERT INTO tasks (
                id, title, body, assignee, status, priority, created_by,
                created_at, workspace_kind, workspace_path, project_id,
                started_at, completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                req.workspace_path or DEFAULT_WORKSPACE,
                req.project_id or "default",
                started_at,
                completed_at
            ))
            conn.commit()

            cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            created = dict(cur.fetchone())
        return {"success": True, "task": created}
    except Exception as e:
        logger.error(f"Error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.patch("/tasks/{task_id}")
def update_task(task_id: str, req: UpdateTaskRequest, _ = Depends(require_auth)):
    if req.title is not None and not req.title.strip():
        raise HTTPException(status_code=400, detail="Le titre de la tâche ne peut pas être vide")
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Tâche introuvable")

            current = dict(row)
            updates = []
            params: list = []

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
                new_st = _normalize_status(req.status)
                updates.append("status = ?")
                params.append(new_st)
                now = int(time.time())
                if new_st in ["running", "in_progress"]:
                    if not current.get("started_at"):
                        updates.append("started_at = ?")
                        params.append(now)
                    if current.get("completed_at"):
                        updates.append("completed_at = ?")
                        params.append(None)
                elif new_st in ["done", "completed"]:
                    if not current.get("completed_at"):
                        updates.append("completed_at = ?")
                        params.append(now)
                    if not current.get("started_at"):
                        updates.append("started_at = ?")
                        params.append(now)
                else:
                    # If moved away from done (e.g. reopened to todo or blocked), reset completed_at
                    if current.get("completed_at"):
                        updates.append("completed_at = ?")
                        params.append(None)

            if updates:
                for item in updates:
                    col = item.split()[0]
                    if col not in _ALLOWED_TASK_UPDATE_COLUMNS:
                        raise HTTPException(status_code=400, detail=f"Colonne non autorisée pour la mise à jour: {col}")
                params.append(task_id)
                cur.execute(f"UPDATE tasks SET {', '.join(updates)} WHERE id = ?", params)  # nosec B608
                conn.commit()

            cur.execute("SELECT * FROM tasks WHERE id = ?", (task_id,))
            updated_row = cur.fetchone()
            if not updated_row:
                raise HTTPException(status_code=404, detail="Tâche introuvable")
            updated = dict(updated_row)
        return {"success": True, "task": updated}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/tasks/{task_id}")
def delete_task(task_id: str, _ = Depends(require_auth)):
    try:
        with get_db() as conn:
            cur = conn.cursor()
            cur.execute("SELECT id FROM tasks WHERE id = ?", (task_id,))
            if not cur.fetchone():
                raise HTTPException(status_code=404, detail="Tâche introuvable")

            cur.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            conn.commit()
        return {"success": True, "task_id": task_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
