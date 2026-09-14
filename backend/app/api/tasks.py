import os
import signal
import json
import logging
import psutil
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from app.config import BRAIN_DIR
from app.api.auth import require_auth

logger = logging.getLogger("antigravity.tasks")
router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class KillTaskRequest(BaseModel):
    pid: Optional[int] = None
    task_id: Optional[str] = None

@router.get("/list")
def list_active_tasks(conversation_id: Optional[str] = None, _ = Depends(require_auth)):
    tasks = []
    subagents = []

    # 1. Scan background tasks from brain
    if BRAIN_DIR.exists():
        conv_dirs = [BRAIN_DIR / conversation_id] if conversation_id and (BRAIN_DIR / conversation_id).exists() else list(BRAIN_DIR.iterdir())
        for cdir in conv_dirs:
            if not cdir.is_dir():
                continue
            cid = cdir.name
            
            # Tasks
            tasks_dir = cdir / ".system_generated" / "tasks"
            if tasks_dir.exists() and tasks_dir.is_dir():
                for tfile in tasks_dir.glob("*.log"):
                    tid = tfile.stem
                    stat = tfile.stat()
                    try:
                        with open(tfile, "r", encoding="utf-8", errors="replace") as f:
                            lines = f.readlines()
                            preview = "".join(lines[-10:]) if lines else ""
                    except Exception:
                        preview = ""

                    tasks.append({
                        "id": f"{cid}/{tid}",
                        "task_id": tid,
                        "conversation_id": cid,
                        "log_path": str(tfile),
                        "size": stat.st_size,
                        "last_modified": stat.st_mtime,
                        "preview": preview,
                        "status": "completed" if "finished with result" in preview or "exited with code" in preview else "running"
                    })

            # Subagents
            subagent_dir = cdir / ".system_generated" / "subagents"
            if subagent_dir.exists() and subagent_dir.is_dir():
                for sdir in subagent_dir.iterdir():
                    if sdir.is_dir():
                        stat = sdir.stat()
                        subagents.append({
                            "id": sdir.name,
                            "conversation_id": cid,
                            "path": str(sdir),
                            "last_modified": stat.st_mtime,
                            "status": "idle"
                        })

    # 2. Scan active process tree for agy and background workers
    running_processes = []
    try:
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'cpu_percent', 'memory_info']):
            try:
                cmdline = proc.info.get('cmdline') or []
                cmd_str = " ".join(cmdline)
                name = proc.info.get('name', '')
                if 'agy' in name or 'agy' in cmd_str or 'antigravity' in cmd_str:
                    running_processes.append({
                        "pid": proc.info['pid'],
                        "name": name,
                        "cmd": cmd_str[:120],
                        "created_at": proc.info['create_time'],
                        "memory_mb": round((proc.info['memory_info'].rss or 0) / (1024 * 1024), 1) if proc.info.get('memory_info') else 0
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
    except Exception as e:
        logger.warning(f"Error scanning psutil processes: {e}")

    # Sort recent first
    tasks.sort(key=lambda x: x["last_modified"], reverse=True)

    return {
        "tasks": tasks[:20],
        "subagents": subagents[:20],
        "processes": running_processes
    }

@router.post("/kill")
def kill_task(req: KillTaskRequest, _ = Depends(require_auth)):
    if not req.pid:
        return {"success": False, "message": "Aucun PID spécifié"}

    target_pid = req.pid
    current_pid = os.getpid()
    parent_pid = os.getppid()

    # Block killing system critical PIDs and backend server itself
    if target_pid <= 100 or target_pid == current_pid or target_pid == parent_pid:
        raise HTTPException(status_code=403, detail=f"Arrêt non autorisé pour le PID système critique {target_pid}")

    try:
        proc = psutil.Process(target_pid)
        proc_name = proc.name().lower()
        cmdline = " ".join(proc.cmdline()).lower()

        # Disallow killing systemd or uvicorn backend
        if "systemd" in proc_name or "uvicorn" in cmdline and "backend" in cmdline:
            raise HTTPException(status_code=403, detail="Arrêt non autorisé pour les services principaux du serveur")

        # Terminate cleanly
        proc.terminate()
        try:
            proc.wait(timeout=1.5)
        except psutil.TimeoutExpired:
            proc.kill()

        logger.info(f"Terminated process PID {target_pid} ({proc_name})")
        return {"success": True, "message": f"Processus {target_pid} ({proc_name}) arrêté avec succès"}
    except psutil.NoSuchProcess:
        raise HTTPException(status_code=404, detail="Processus introuvable")
    except psutil.AccessDenied:
        raise HTTPException(status_code=403, detail="Permission refusée pour arrêter ce processus")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error terminating PID {target_pid}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'arrêt du processus: {str(e)}")
