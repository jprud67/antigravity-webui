"""
API des tâches planifiées — 100 % propre à Antigravity WebUI.

Le stockage (jobs.json, heartbeat, journaux) est géré par
`app/services/cron_store.py` dans le dossier de données de l'application.
L'exécution des jobs est assurée par le ticker interne
(`app/services/cron_ticker.py`), démarré avec le serveur — aucune dépendance
à Hermes.
"""
import logging
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.platform_utils import is_safe_path
from app.services.cron_store import (
    HEARTBEAT_FILE,
    JOBS_FILE,
    OUTPUT_DIR,
    compute_next_run,
    load_jobs,
    now_iso,
    save_jobs,
)

logger = logging.getLogger("antigravity.crons")
router = APIRouter(prefix="/api/crons", tags=["crons"])


class CreateCronJobRequest(BaseModel):
    name: str
    prompt: str
    schedule: str  # e.g. "*/15 * * * *" or "every 30m"
    deliver: str | None = "local"
    skills: list[str] | None = None
    model: str | None = None
    effort: str | None = None


class UpdateCronJobRequest(BaseModel):
    name: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    state: str | None = None  # "scheduled" or "paused"
    skills: list[str] | None = None
    model: str | None = None
    effort: str | None = None


@router.get("")
def list_cron_jobs(_ = Depends(require_auth)):
    data = load_jobs()
    jobs = data.get("jobs", [])

    # Statut du ticker interne de l'application
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
        except OSError as e:
            logger.warning(f"Heartbeat illisible: {e}")

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

    data = load_jobs()
    job_id = uuid.uuid4().hex[:8]

    sched_raw = req.schedule.strip()
    next_run = compute_next_run(sched_raw)
    if next_run is None:
        raise HTTPException(
            status_code=400,
            detail=f"Expression de planification invalide : '{sched_raw}'. Utilisez un format cron (ex: '*/15 * * * *') ou un intervalle (ex: 'every 30m')."
        )

    from croniter import croniter
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
        "model": req.model.strip() if req.model else None,
        "effort": req.effort.strip() if req.effort else None,
        "enabled": True,
        "state": "scheduled",
        "created_at": now_iso(),
        "next_run_at": next_run,
        "last_run_at": None,
        "last_status": None,
        "deliver": req.deliver or "local"
    }

    data.setdefault("jobs", []).append(new_job)
    save_jobs(data)

    return {"success": True, "job": new_job}


@router.patch("/{job_id}")
def update_cron_job(job_id: str, req: UpdateCronJobRequest, _ = Depends(require_auth)):
    data = load_jobs()
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
    if req.model is not None:
        target["model"] = req.model.strip() if req.model else None
    if req.effort is not None:
        target["effort"] = req.effort.strip() if req.effort else None

    if req.schedule is not None:
        sched_raw = req.schedule.strip()
        next_run = compute_next_run(sched_raw)
        if next_run is None:
            raise HTTPException(
                status_code=400,
                detail=f"Expression de planification invalide : '{sched_raw}'."
            )
        from croniter import croniter
        target["schedule"] = {
            "kind": "cron" if croniter.is_valid(sched_raw) else "interval",
            "expr": sched_raw,
            "display": sched_raw
        }
        target["schedule_display"] = sched_raw
        target["next_run_at"] = next_run

    if req.state is not None:
        new_state = req.state.lower()
        if new_state in ["paused", "disabled"]:
            target["enabled"] = False
            target["state"] = "paused"
            target["paused_at"] = now_iso()
            target["next_run_at"] = None
        else:
            target["enabled"] = True
            target["state"] = "scheduled"
            target["paused_at"] = None
            target["next_run_at"] = compute_next_run(target.get("schedule") or target.get("schedule_display")) or now_iso()

    save_jobs(data)
    return {"success": True, "job": target}


@router.delete("/{job_id}")
def delete_cron_job(job_id: str, _ = Depends(require_auth)):
    data = load_jobs()
    jobs = data.get("jobs", [])
    before_count = len(jobs)
    jobs = [j for j in jobs if j.get("id") != job_id]
    if len(jobs) == before_count:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    data["jobs"] = jobs
    save_jobs(data)
    return {"success": True, "job_id": job_id}


@router.post("/{job_id}/run")
def trigger_cron_job_now(job_id: str, _ = Depends(require_auth)):
    data = load_jobs()
    jobs = data.get("jobs", [])
    target = None
    for j in jobs:
        if j.get("id") == job_id:
            target = j
            break

    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    # Le ticker interne exécute le job dès le prochain tick (<= 20 s)
    # Si le job était en pause ou désactivé, on le réactive pour qu'il soit pris en compte par tick_once
    target["enabled"] = True
    target["state"] = "scheduled"
    target["paused_at"] = None
    target["next_run_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
    target["last_run_at"] = now_iso()
    target["last_status"] = "triggered"
    save_jobs(data)

    return {
        "success": True,
        "message": f"Job {target.get('name')} déclenché immédiatement (prochain tick du ticker interne)",
        "job": target,
        "prompt": target.get("prompt")
    }


@router.get("/{job_id}/log")
def get_cron_job_log(job_id: str, _ = Depends(require_auth)):
    data = load_jobs()
    jobs = data.get("jobs", [])
    target = next((j for j in jobs if j.get("id") == job_id), None)
    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    log_path: Path | None = None
    if target.get("last_log"):
        p = Path(target["last_log"])
        if is_safe_path(p, [OUTPUT_DIR]) and p.exists() and p.is_file():
            log_path = p

    if not log_path and OUTPUT_DIR.exists():
        matching = sorted(OUTPUT_DIR.glob(f"{job_id}_*.log"), key=lambda f: f.stat().st_mtime, reverse=True)
        if matching:
            candidate = matching[0]
            if is_safe_path(candidate, [OUTPUT_DIR]):
                log_path = candidate

    if not log_path or not is_safe_path(log_path, [OUTPUT_DIR]):
        return {
            "job_id": job_id,
            "has_log": False,
            "file": None,
            "mtime": None,
            "content": "Aucun journal d'exécution disponible pour ce job."
        }

    try:
        content = log_path.read_text(encoding="utf-8", errors="replace")
        if len(content) > 50_000:
            content = content[-50_000:]
        return {
            "job_id": job_id,
            "has_log": True,
            "file": log_path.name,
            "mtime": log_path.stat().st_mtime,
            "content": content
        }
    except Exception as e:
        logger.error(f"Erreur lors de la lecture du log pour {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du journal : {e}")
