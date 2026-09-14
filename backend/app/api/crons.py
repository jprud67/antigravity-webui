import os
import json
import time
import uuid
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Union
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from app.api.auth import require_auth
from app.config import HOME
from croniter import croniter

logger = logging.getLogger("antigravity.crons")
router = APIRouter(prefix="/api/crons", tags=["crons"])

HERMES_HOME = Path(os.environ.get("HERMES_HOME", str(HOME / ".hermes")))
CRON_DIR = HERMES_HOME / "cron"
JOBS_FILE = CRON_DIR / "jobs.json"
HEARTBEAT_FILE = CRON_DIR / "ticker_heartbeat"

def _ensure_cron_dirs():
    CRON_DIR.mkdir(parents=True, exist_ok=True)
    if not JOBS_FILE.exists():
        with open(JOBS_FILE, "w", encoding="utf-8") as f:
            json.dump({"jobs": [], "updated_at": datetime.now(timezone.utc).isoformat()}, f, indent=2)

def _load_jobs_file() -> Dict[str, Any]:
    _ensure_cron_dirs()
    try:
        with open(JOBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            if isinstance(data, dict):
                return data
            elif isinstance(data, list):
                return {"jobs": data, "updated_at": datetime.now(timezone.utc).isoformat()}
            return {"jobs": [], "updated_at": datetime.now(timezone.utc).isoformat()}
    except Exception as e:
        logger.error(f"Error loading jobs.json: {e}")
        return {"jobs": [], "updated_at": datetime.now(timezone.utc).isoformat()}

def _save_jobs_file(data: Dict[str, Any]):
    _ensure_cron_dirs()
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    temp_path = JOBS_FILE.with_suffix(".tmp")
    with open(temp_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    temp_path.replace(JOBS_FILE)

import re

def _compute_next_run(schedule: Union[str, Dict[str, Any]]) -> Optional[str]:
    now = datetime.now(timezone.utc)
    expr = ""
    if isinstance(schedule, str):
        expr = schedule.strip()
    elif isinstance(schedule, dict):
        if schedule.get("kind") == "interval":
            try:
                mins = int(schedule.get("minutes", 15))
                return (now + timedelta(minutes=mins)).isoformat()
            except (ValueError, TypeError):
                return (now + timedelta(minutes=15)).isoformat()
        elif schedule.get("kind") == "cron":
            expr = schedule.get("expr", "")
        else:
            expr = schedule.get("display") or schedule.get("expr") or ""

    if not expr:
        return None

    # Handle quick interval syntax like "every 10m", "every 2 hours", "toutes les 30 min"
    lower = expr.lower().strip()
    match = re.match(r"^(?:every|toutes les|chaque)\s+(\d+)\s*(m|min|minutes?|h|hours?|heures?|d|days?|jours?)?$", lower)
    if match:
        try:
            val = int(match.group(1))
            unit = match.group(2) or "m"
            if unit.startswith("h"):
                return (now + timedelta(hours=val)).isoformat()
            elif unit.startswith("d") or unit.startswith("j"):
                return (now + timedelta(days=val)).isoformat()
            else:
                return (now + timedelta(minutes=val)).isoformat()
        except Exception:
            pass

    try:
        if croniter.is_valid(expr):
            iter_cron = croniter(expr, now)
            next_dt = iter_cron.get_next(datetime)
            return next_dt.isoformat()
    except Exception as e:
        logger.warning(f"Could not compute next run for cron expr '{expr}': {e}")
    return None

class CreateCronJobRequest(BaseModel):
    name: str
    prompt: str
    schedule: str  # e.g. "*/15 * * * *" or "every 30m"
    deliver: Optional[str] = "local"
    skills: Optional[List[str]] = None

class UpdateCronJobRequest(BaseModel):
    name: Optional[str] = None
    prompt: Optional[str] = None
    schedule: Optional[str] = None
    state: Optional[str] = None  # "scheduled" or "paused"
    skills: Optional[List[str]] = None

@router.get("")
def list_cron_jobs(_ = Depends(require_auth)):
    data = _load_jobs_file()
    jobs = data.get("jobs", [])

    # Check ticker heartbeat
    ticker_status = "idle"
    heartbeat_age = None
    if HEARTBEAT_FILE.exists():
        try:
            mtime = HEARTBEAT_FILE.stat().st_mtime
            heartbeat_age = round(time.time() - mtime, 1)
            if heartbeat_age <= 180:
                ticker_status = "active"
            else:
                ticker_status = "stale"
        except Exception:
            pass

    return {
        "jobs": jobs,
        "ticker_status": ticker_status,
        "heartbeat_age_seconds": heartbeat_age,
        "jobs_file": str(JOBS_FILE)
    }

@router.post("")
def create_cron_job(req: CreateCronJobRequest, _ = Depends(require_auth)):
    if not req.name.strip():
        raise HTTPException(status_code=400, detail="Le nom du job est requis")
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="L'instruction du prompt est requise")
    if not req.schedule.strip():
        raise HTTPException(status_code=400, detail="L'expression cron / planification est requise")

    data = _load_jobs_file()
    job_id = uuid.uuid4().hex[:8]
    now_iso = datetime.now(timezone.utc).isoformat()

    sched_raw = req.schedule.strip()
    next_run = _compute_next_run(sched_raw)
    if next_run is None:
        raise HTTPException(
            status_code=400,
            detail=f"Expression de planification invalide : '{sched_raw}'. Utilisez un format cron (ex: '*/15 * * * *') ou un intervalle (ex: 'every 30m')."
        )

    schedule_dict = {
        "kind": "cron" if croniter.is_valid(sched_raw) else "interval",
        "expr": sched_raw,
        "display": sched_raw
    }

    new_job = {
        "id": job_id,
        "name": req.name.strip(),
        "prompt": req.prompt.strip(),
        "schedule": schedule_dict,
        "schedule_display": sched_raw,
        "skills": req.skills or [],
        "enabled": True,
        "state": "scheduled",
        "created_at": now_iso,
        "next_run_at": next_run,
        "last_run_at": None,
        "last_status": None,
        "deliver": req.deliver or "local"
    }

    data.setdefault("jobs", []).append(new_job)
    _save_jobs_file(data)

    return {"success": True, "job": new_job}

@router.patch("/{job_id}")
def update_cron_job(job_id: str, req: UpdateCronJobRequest, _ = Depends(require_auth)):
    data = _load_jobs_file()
    jobs = data.get("jobs", [])
    target = None
    for j in jobs:
        if j.get("id") == job_id:
            target = j
            break

    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    if req.name is not None:
        target["name"] = req.name.strip()
    if req.prompt is not None:
        target["prompt"] = req.prompt.strip()
    if req.skills is not None:
        target["skills"] = req.skills

    if req.schedule is not None:
        sched_raw = req.schedule.strip()
        target["schedule"] = {
            "kind": "cron" if croniter.is_valid(sched_raw) else "interval",
            "expr": sched_raw,
            "display": sched_raw
        }
        target["schedule_display"] = sched_raw
        target["next_run_at"] = _compute_next_run(sched_raw)

    if req.state is not None:
        new_state = req.state.lower()
        if new_state in ["paused", "disabled"]:
            target["enabled"] = False
            target["state"] = "paused"
            target["paused_at"] = datetime.now(timezone.utc).isoformat()
            target["next_run_at"] = None
        else:
            target["enabled"] = True
            target["state"] = "scheduled"
            target["paused_at"] = None
            target["next_run_at"] = _compute_next_run(target.get("schedule", {}))

    _save_jobs_file(data)
    return {"success": True, "job": target}

@router.delete("/{job_id}")
def delete_cron_job(job_id: str, _ = Depends(require_auth)):
    data = _load_jobs_file()
    jobs = data.get("jobs", [])
    before_count = len(jobs)
    jobs = [j for j in jobs if j.get("id") != job_id]
    if len(jobs) == before_count:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    data["jobs"] = jobs
    _save_jobs_file(data)
    return {"success": True, "job_id": job_id}

@router.post("/{job_id}/run")
def trigger_cron_job_now(job_id: str, _ = Depends(require_auth)):
    data = _load_jobs_file()
    jobs = data.get("jobs", [])
    target = None
    for j in jobs:
        if j.get("id") == job_id:
            target = j
            break

    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    # Mark to run immediately on next tick and record run timestamp
    target["next_run_at"] = datetime.now(timezone.utc).isoformat()
    target["last_run_at"] = datetime.now(timezone.utc).isoformat()
    target["last_status"] = "triggered"
    _save_jobs_file(data)

    return {
        "success": True,
        "message": f"Job {target.get('name')} déclenché immédiatement",
        "job": target,
        "prompt": target.get("prompt")
    }
