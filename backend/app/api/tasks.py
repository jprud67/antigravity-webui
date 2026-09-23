import logging
import os
import re
import time
from datetime import datetime, timezone
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

_EXIT_CODE_PAT = re.compile(r"exited with code (\d+)", re.IGNORECASE)
_TASK_OUTCOME_PAT = re.compile(r"Task id [\"\\]*([^\"\\\s]+)[\"\\]* (finished with result|was cancelled)", re.IGNORECASE)

def _parse_transcript_task_outcomes(transcript_path: Path) -> dict[str, dict[str, Any]]:
    """Extracts completion outcomes, exit codes, and cancellation events from transcript.jsonl."""
    outcomes: dict[str, dict[str, Any]] = {}
    if not transcript_path.exists():
        return outcomes
    try:
        with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if "Task id" not in line or ("finished with result" not in line and "was cancelled" not in line):
                    continue
                for m in _TASK_OUTCOME_PAT.finditer(line):
                    raw_id = m.group(1).split("/")[-1].replace(".log", "").strip()
                    action = m.group(2).lower()
                    if "cancel" in action:
                        outcomes[raw_id] = {"status": "cancelled", "exit_code": None}
                    else:
                        c_match = _EXIT_CODE_PAT.search(line)
                        if c_match:
                            exit_code = int(c_match.group(1))
                            outcomes[raw_id] = {
                                "status": "completed" if exit_code == 0 else "failed",
                                "exit_code": exit_code
                            }
                        else:
                            outcomes[raw_id] = {"status": "completed", "exit_code": 0}
    except Exception as e:
        logger.debug(f"Error reading transcript {transcript_path}: {e}")
    return outcomes

def _find_pid_for_task_log(log_path: Path) -> int | None:
    """Finds the PID of an active process holding log_path open."""
    try:
        resolved_target = str(log_path.resolve())
    except Exception:
        resolved_target = str(log_path)

    for proc in psutil.process_iter(['pid']):
        try:
            p_info = proc.info
            pid = p_info.get('pid')
            if not pid or pid <= 100:
                continue
            for f in proc.open_files():
                try:
                    if os.path.abspath(f.path) == resolved_target:
                        return pid
                except Exception:
                    continue
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess, AttributeError, KeyError):
            continue
    return None

class KillTaskRequest(BaseModel):
    pid: int | str | None = None
    task_id: str | None = None

@router.get("/list")
def list_active_tasks(conversation_id: str | None = None, _ = Depends(require_auth)):
    tasks: list[dict[str, Any]] = []
    subagents: list[dict[str, Any]] = []
    running_processes: list[dict[str, Any]] = []
    active_cmdlines: list[str] = []

    # 1. Scan active process tree for agy and background workers
    try:
        for proc in psutil.process_iter(['pid', 'name', 'cmdline', 'create_time', 'memory_info']):
            try:
                info = proc.info
                if not info or not info.get('pid'):
                    continue
                cmdline = info.get('cmdline') or []
                cmd_str = " ".join(cmdline)
                if cmd_str:
                    active_cmdlines.append(cmd_str.lower())
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

    # 2. Scan background tasks and subagents from brain
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
                transcript_file = cdir / ".system_generated" / "logs" / "transcript.jsonl"
                transcript_outcomes = _parse_transcript_task_outcomes(transcript_file)
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
                            if len(preview) > 2000:
                                preview = preview[-2000:]
                    except Exception:
                        preview = ""
                        stat_size = 0
                        stat_mtime = 0.0

                    now_ts = time.time()
                    lower_preview = preview.lower()
                    has_finish_marker = (
                        "finished with result" in lower_preview
                        or "exited with code" in lower_preview
                        or "exit code" in lower_preview
                        or "completed at:" in lower_preview
                        or "the command exited" in lower_preview
                        or "process terminated" in lower_preview
                        or "task cancelled" in lower_preview
                        or "status: completed" in lower_preview
                        or "status: failed" in lower_preview
                        or "command finished" in lower_preview
                    )
                    is_active_process = (
                        any(tid.lower() in cmd for cmd in active_cmdlines)
                        if (active_cmdlines and len(tid) >= 3)
                        else False
                    )

                    outcome = transcript_outcomes.get(tid)
                    if outcome:
                        status = outcome["status"]
                        exit_code = outcome.get("exit_code")
                    else:
                        if "[task cancelled by user]" in lower_preview or "task cancelled" in lower_preview:
                            status = "cancelled"
                            exit_code = None
                        elif "status: failed" in lower_preview or "the command exited with code 1" in lower_preview:
                            status = "failed"
                            exit_code = 1
                        elif has_finish_marker:
                            status = "completed"
                            exit_code = 0
                        elif (now_ts - stat_mtime) > 300 and not is_active_process:
                            status = "completed"
                            exit_code = 0
                        else:
                            status = "running"
                            exit_code = None

                    tasks.append({
                        "id": f"{cid}/{tid}",
                        "task_id": tid,
                        "conversation_id": cid,
                        "log_path": str(tfile),
                        "size": stat_size,
                        "last_modified": stat_mtime,
                        "preview": preview,
                        "status": status,
                        "exit_code": exit_code
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

    # Sort recent first
    tasks.sort(key=lambda x: float(x.get("last_modified") or 0.0), reverse=True)
    subagents.sort(key=lambda x: float(x.get("last_modified") or 0.0), reverse=True)
    running_processes.sort(key=lambda p: float(p.get("created_at") or 0.0), reverse=True)


    return {
        "tasks": tasks[:50],
        "subagents": subagents[:50],
        "processes": running_processes
    }

def _mark_task_cancelled(task_id: str) -> bool:
    """Marks task log file in BRAIN_DIR as cancelled if found."""
    if not BRAIN_DIR.exists() or not task_id:
        return False
    clean_tid = task_id.strip()
    if not clean_tid or "\x00" in clean_tid:
        return False
    cid_part = None
    if "/" in clean_tid:
        parts = clean_tid.split("/")
        cid_part = parts[0].strip()
        pure_tid = parts[-1].strip()
    else:
        pure_tid = clean_tid

    if cid_part and not is_safe_conversation_id(cid_part):
        return False
    if not pure_tid or ".." in pure_tid or "/" in pure_tid or "\\" in pure_tid:
        return False

    cands = [pure_tid]
    if not pure_tid.endswith(".log"):
        cands.append(f"{pure_tid}.log")

    marked = False
    try:
        candidate_dirs = [BRAIN_DIR / cid_part] if cid_part and (BRAIN_DIR / cid_part).is_dir() else BRAIN_DIR.iterdir()
        for cdir in candidate_dirs:
            if not cdir.is_dir():
                continue
            if not is_safe_conversation_id(cdir.name):
                continue
            for cand in cands:
                tfile = cdir / ".system_generated" / "tasks" / cand
                if tfile.exists() and tfile.is_file():
                    try:
                        with open(tfile, "a", encoding="utf-8") as f:
                            f.write(f"\n[Task cancelled by user]\nCompleted At: {datetime.now(timezone.utc).isoformat()}\n")
                        marked = True
                        return True
                    except Exception:
                        pass
    except Exception as e:
        logger.debug(f"Error marking task log file as cancelled: {e}")
    return marked


@router.post("/kill")
def kill_task(req: KillTaskRequest, _ = Depends(require_auth)):
    target_pid: int | None = None
    if req.pid is not None:
        try:
            target_pid = int(req.pid)
        except (ValueError, TypeError):
            target_pid = None

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
                clean_tid = str(req.task_id).strip()
                pure_tid = clean_tid.split("/")[-1].strip().replace(".log", "")
                cid_part = clean_tid.split("/")[0].strip() if "/" in clean_tid else None

                # 1. First priority: look for an active process writing to the task's log file
                log_cands: list[Path] = []
                if cid_part and is_safe_conversation_id(cid_part) and BRAIN_DIR.exists():
                    c_path = BRAIN_DIR / cid_part / ".system_generated" / "tasks" / f"{pure_tid}.log"
                    if c_path.exists():
                        log_cands.append(c_path)
                elif BRAIN_DIR.exists():
                    for cdir in BRAIN_DIR.iterdir():
                        if cdir.is_dir() and not cdir.name.startswith("."):
                            c_path = cdir / ".system_generated" / "tasks" / f"{pure_tid}.log"
                            if c_path.exists():
                                log_cands.append(c_path)
                                break

                for lpath in log_cands:
                    found_pid = _find_pid_for_task_log(lpath)
                    if (
                        found_pid
                        and found_pid > 100
                        and found_pid not in (current_pid, parent_pid)
                        and (not current_pgid or found_pid != current_pgid)
                    ):
                        target_pid = found_pid
                        break

                if not target_pid:
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
            if req.task_id and _mark_task_cancelled(req.task_id):
                return {"success": True, "message": f"Tâche {req.task_id} marquée comme terminée/annulée"}
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

        if req.task_id:
            _mark_task_cancelled(req.task_id)

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
