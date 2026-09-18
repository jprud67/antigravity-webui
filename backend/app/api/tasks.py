import logging
import os
import re
import time
from pathlib import Path
from typing import Any

import psutil
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import BRAIN_DIR
from app.services.storage import is_safe_conversation_id

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
        if conversation_id:
            if not is_safe_conversation_id(conversation_id):
                raise HTTPException(status_code=400, detail="Identifiant de conversation invalide.")
            target_dir = BRAIN_DIR / conversation_id
            conv_dirs = [target_dir] if target_dir.exists() else []
        else:
            try:
                def _safe_mtime(d: Path) -> float:
                    try:
                        return d.stat().st_mtime
                    except OSError:
                        return 0.0

                all_dirs = [d for d in BRAIN_DIR.iterdir() if d.is_dir() and not d.name.startswith(".")]
                all_dirs.sort(key=_safe_mtime, reverse=True)
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
                        with open(tfile, "rb") as f:
                            if stat_size > 65536:
                                f.seek(stat_size - 65536)
                            raw = f.read().decode("utf-8", errors="replace")
                            lines = raw.splitlines(keepends=True)
                            if stat_size > 65536 and len(lines) > 1:
                                lines = lines[1:]
                            preview = "".join(lines[-10:]) if lines else ""
                    except Exception:
                        preview = ""
                        stat_size = 0
                        stat_mtime = 0.0

                    now_ts = time.time()
                    is_finished = (
                        "finished with result" in preview
                        or "exited with code" in preview
                        or "exit code" in preview
                        or "Completed At:" in preview
                        or "The command exited" in preview
                        or "process terminated" in preview
                        or "Task cancelled" in preview
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
                info = proc.info
                if not info or not info.get('pid'):
                    continue
                cmdline = info.get('cmdline') or []
                cmd_str = " ".join(cmdline)
                name = info.get('name') or ''
                if 'agy' in name or 'agy' in cmd_str or 'antigravity' in cmd_str:
                    mem = info.get('memory_info')
                    mem_rss = getattr(mem, 'rss', 0) if mem else 0
                    running_processes.append({
                        "pid": info['pid'],
                        "name": name,
                        "cmd": cmd_str[:120],
                        "created_at": info.get('create_time') or 0.0,
                        "memory_mb": round((mem_rss or 0) / (1024 * 1024), 1)
                    })
            except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, AttributeError, KeyError, TypeError):
                continue
    except Exception as e:
        logger.warning(f"Error scanning psutil processes: {e}")

    # Sort recent first
    tasks.sort(key=lambda x: float(x.get("last_modified") or 0.0), reverse=True)
    running_processes.sort(key=lambda p: float(p.get("created_at") or 0.0), reverse=True)

    return {
        "tasks": tasks[:50],
        "subagents": subagents[:50],
        "processes": running_processes
    }

@router.post("/kill")
def kill_task(req: KillTaskRequest, _ = Depends(require_auth)):
    target_pid = req.pid
    if target_pid is not None and target_pid <= 100:
        raise HTTPException(
            status_code=403,
            detail=f"Arrêt non autorisé pour le PID système critique {target_pid}"
        )

    current_pid = os.getpid()
    parent_pid = os.getppid()
    current_pgid = None
    if hasattr(os, "getpgid"):
        try:
            current_pgid = os.getpgid(current_pid)
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    if not target_pid or target_pid <= 0:
        if req.task_id:
            try:
                clean_tid = req.task_id.strip()
                pure_tid = clean_tid.split("/")[-1].strip() if "/" in clean_tid else clean_tid
                raw_cands = [clean_tid]
                if pure_tid and pure_tid != clean_tid:
                    raw_cands.append(pure_tid)
                excluded_tokens = {
                    "bash", "sh", "zsh", "node", "npm", "python", "python3", "uvicorn",
                    "git", "cat", "grep", "root", "systemd", "task", "tasks", "subagent",
                    "subagents", "process", "worker", "service", "start", "stop", "test", "run",
                    "bin", "usr", "opt", "etc", "dev", "api", "pid", "app", "web", "kill", "ps"
                }
                candidate_tids = [
                    c for c in raw_cands
                    if len(c) >= 3 and c.lower() not in excluded_tokens
                ]

                if candidate_tids:
                    for p in psutil.process_iter(['pid', 'cmdline', 'name']):
                        try:
                            p_info = p.info
                            if not p_info:
                                continue
                            candidate_pid = p_info.get('pid')
                            if not candidate_pid or candidate_pid <= 100:
                                continue
                            if candidate_pid in (current_pid, parent_pid) or (current_pgid and candidate_pid == current_pgid):
                                continue

                            cmdline_list = p_info.get('cmdline') or []
                            cmd_str = " ".join(cmdline_list)
                            cmd_lower = cmd_str.lower()
                            p_name = (p_info.get('name') or '').lower()

                            # Disallow matching server or uvicorn
                            if ("uvicorn" in cmd_lower and "backend" in cmd_lower) or ("antigravity-webui" in cmd_lower and "run.py" in cmd_lower):
                                continue

                            matches_task = False
                            for tid_cand in candidate_tids:
                                escaped_tid = re.escape(tid_cand)
                                tid_regex = re.compile(rf"(?:^|[\s\"'=/]){escaped_tid}(?:[\s\"'/]|$)")
                                if (
                                    tid_cand in cmdline_list
                                    or any(tid_cand in arg.split("=") for arg in cmdline_list)
                                    or bool(tid_regex.search(cmd_str))
                                    or (len(tid_cand) >= 4 and tid_cand.lower() == p_name)
                                ):
                                    matches_task = True
                                    break

                            if matches_task:
                                target_pid = candidate_pid
                                break
                        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, AttributeError, KeyError):
                            continue
            except Exception as e:
                logger.warning(f"Error resolving task_id to pid: {e}")
        if not target_pid:
            return {"success": False, "message": "Aucun PID spécifié ou processus actif trouvé pour la tâche demandée"}

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
                logger.debug("Ignored error")

        proc.terminate()
        _, alive = psutil.wait_procs([proc] + children, timeout=1.5)
        for p in alive:
            try:
                p.kill()
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                logger.debug("Ignored error")

        logger.info(f"Terminated process PID {target_pid} ({proc_name})")
        return {"success": True, "message": f"Processus {target_pid} ({proc_name}) arrêté avec succès"}
    except (psutil.NoSuchProcess, psutil.ZombieProcess):
        raise HTTPException(status_code=404, detail="Processus introuvable ou déjà terminé")
    except psutil.AccessDenied:
        raise HTTPException(status_code=403, detail="Permission refusée pour arrêter ce processus")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error terminating PID {target_pid}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur lors de l'arrêt du processus: {e!s}")
