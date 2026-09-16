import logging
import os
import time
from typing import Any

import psutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import BRAIN_DIR

logger = logging.getLogger("antigravity.tasks")
router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class KillTaskRequest(BaseModel):
    pid: int | None = None
    task_id: str | None = None

@router.get("/list")
def list_active_tasks(conversation_id: str | None = None, _ = Depends(require_auth)):
    tasks: list[dict[str, Any]] = []
    subagents: list[dict[str, Any]] = []

    # 1. Scan background tasks from brain
    if BRAIN_DIR.exists():
        if conversation_id and (BRAIN_DIR / conversation_id).exists():
            conv_dirs = [BRAIN_DIR / conversation_id]
        else:
            try:
                all_dirs = [d for d in BRAIN_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
                all_dirs.sort(key=lambda d: d.stat().st_mtime, reverse=True)
                conv_dirs = all_dirs[:30]
            except Exception:
                conv_dirs = []
        for cdir in conv_dirs:
            if not cdir.is_dir():
                continue
            cid = cdir.name
            
            # Tasks
            tasks_dir = cdir / ".system_generated" / "tasks"
            if tasks_dir.exists() and tasks_dir.is_dir():
                for tfile in tasks_dir.glob("*.log"):
                    tid = tfile.stem
                    try:
                        stat = tfile.stat()
                        stat_size = stat.st_size
                        stat_mtime = stat.st_mtime
                        with open(tfile, "r", encoding="utf-8", errors="replace") as f:
                            if stat_size > 65536:
                                f.seek(stat_size - 65536)
                                lines = f.readlines()
                                if len(lines) > 1:
                                    lines = lines[1:]
                            else:
                                lines = f.readlines()
                            preview = "".join(lines[-10:]) if lines else ""
                    except Exception:
                        preview = ""
                        stat_size = 0
                        stat_mtime = 0.0

                    now_ts = time.time()
                    is_finished = (
                        "finished with result" in preview
                        or "exited with code" in preview
                        or "Completed At:" in preview
                        or (now_ts - stat_mtime) > 1800
                    )
                    tasks.append({
                        "id": f"{cid}/{tid}",
                        "task_id": tid,
                        "conversation_id": cid,
                        "log_path": str(tfile),
                        "size": stat_size,
                        "last_modified": stat_mtime,
                        "preview": preview,
                        "status": "completed" if is_finished else "running"
                    })

            # Subagents
            subagent_dir = cdir / ".system_generated" / "subagents"
            if subagent_dir.exists() and subagent_dir.is_dir():
                for sdir in subagent_dir.iterdir():
                    if sdir.is_dir():
                        try:
                            s_mtime = sdir.stat().st_mtime
                        except OSError:
                            s_mtime = 0.0
                        subagents.append({
                            "id": sdir.name,
                            "conversation_id": cid,
                            "path": str(sdir),
                            "last_modified": s_mtime,
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
    tasks.sort(key=lambda x: float(x.get("last_modified") or 0.0), reverse=True)

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

    current_pgid = None
    if hasattr(os, "getpgid"):
        try:
            current_pgid = os.getpgid(current_pid)
        except Exception:
            pass

    # Block killing system critical PIDs and backend server itself
    if (
        target_pid <= 100
        or target_pid == current_pid
        or target_pid == parent_pid
        or (current_pgid is not None and target_pid == current_pgid)
    ):
        raise HTTPException(
            status_code=403,
            detail=f"Arrêt non autorisé pour le PID système critique ou processus serveur {target_pid}"
        )

    try:
        proc = psutil.Process(target_pid)
        proc_name = proc.name().lower()
        cmdline = " ".join(proc.cmdline()).lower()

        # Disallow killing systemd or uvicorn/run.py backend
        if (
            "systemd" in proc_name
            or ("uvicorn" in cmdline and "backend" in cmdline)
            or ("antigravity-webui" in cmdline and "run.py" in cmdline)
        ):
            raise HTTPException(status_code=403, detail="Arrêt non autorisé pour les services principaux du serveur")

        # Terminate process and its children cleanly
        try:
            children = proc.children(recursive=True)
        except (psutil.NoSuchProcess, Exception):
            children = []

        for child in children:
            try:
                child.terminate()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

        proc.terminate()
        _, alive = psutil.wait_procs([proc] + children, timeout=1.5)
        for p in alive:
            try:
                p.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass

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
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'arrêt du processus: {e!s}")
