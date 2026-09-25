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

from croniter import croniter
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
    update_jobs,
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
    state: str | None = "scheduled"  # "scheduled" or "paused"
    enabled: bool | None = None


class UpdateCronJobRequest(BaseModel):
    name: str | None = None
    prompt: str | None = None
    schedule: str | None = None
    state: str | None = None  # "scheduled" or "paused"
    enabled: bool | None = None
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

    sched_raw = req.schedule.strip()
    next_run = compute_next_run(sched_raw)
    if next_run is None:
        raise HTTPException(
            status_code=400,
            detail=f"Expression de planification invalide : '{sched_raw}'. Utilisez un format cron (ex: '*/15 * * * *') ou un intervalle (ex: 'every 30m')."
        )

    from croniter import croniter
    job_id = uuid.uuid4().hex[:8]
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
        "skills": [s.strip() for s in (req.skills or []) if isinstance(s, str) and s.strip()],
        "model": req.model.strip() if req.model and req.model.strip() else None,
        "effort": req.effort.strip() if req.effort and req.effort.strip() else None,
        "enabled": not ((req.state and req.state.lower() in ["paused", "disabled"]) or (req.enabled is False)),
        "state": "paused" if ((req.state and req.state.lower() in ["paused", "disabled"]) or (req.enabled is False)) else "scheduled",
        "created_at": now_iso(),
        "paused_at": now_iso() if ((req.state and req.state.lower() in ["paused", "disabled"]) or (req.enabled is False)) else None,
        "next_run_at": None if ((req.state and req.state.lower() in ["paused", "disabled"]) or (req.enabled is False)) else next_run,
        "last_run_at": None,
        "last_status": "paused" if ((req.state and req.state.lower() in ["paused", "disabled"]) or (req.enabled is False)) else None,
        "deliver": req.deliver or "local"
    }

    def _add(data):
        data.setdefault("jobs", []).append(new_job)
        return new_job

    created = update_jobs(_add)
    return {"success": True, "job": created}


@router.patch("/{job_id}")
def update_cron_job(job_id: str, req: UpdateCronJobRequest, _ = Depends(require_auth)):
    next_run = None
    if req.schedule is not None:
        sched_raw = req.schedule.strip()
        next_run = compute_next_run(sched_raw)
        if next_run is None:
            raise HTTPException(
                status_code=400,
                detail=f"Expression de planification invalide : '{sched_raw}'."
            )

    if req.name is not None and not req.name.strip():
        raise HTTPException(status_code=400, detail="Le nom du job ne peut pas être vide")
    if req.prompt is not None and not req.prompt.strip():
        raise HTTPException(status_code=400, detail="L'instruction du prompt ne peut pas être vide")

    from croniter import croniter

    def _modify(data):
        jobs = data.get("jobs", [])
        for j in jobs:
            if str(j.get("id")) == str(job_id):
                if req.name is not None:
                    j["name"] = req.name.strip()
                if req.prompt is not None:
                    j["prompt"] = req.prompt.strip()
                if req.skills is not None:
                    j["skills"] = [s.strip() for s in req.skills if isinstance(s, str) and s.strip()]
                if req.model is not None:
                    j["model"] = req.model.strip() if req.model and req.model.strip() else None
                if req.effort is not None:
                    j["effort"] = req.effort.strip() if req.effort and req.effort.strip() else None
                if req.schedule is not None:
                    sched_raw = req.schedule.strip()
                    j["schedule"] = {
                        "kind": "cron" if croniter.is_valid(sched_raw) else "interval",
                        "expr": sched_raw,
                        "display": sched_raw
                    }
                    j["schedule_display"] = sched_raw
                    j["next_run_at"] = next_run
                if req.enabled is not None:
                    if not req.enabled:
                        j["enabled"] = False
                        j["state"] = "paused"
                        j["paused_at"] = now_iso()
                        j["next_run_at"] = None
                    else:
                        j["enabled"] = True
                        j["state"] = "scheduled"
                        j["paused_at"] = None
                        j["next_run_at"] = compute_next_run(j.get("schedule") or j.get("schedule_display")) or now_iso()
                elif req.state is not None:
                    new_state = req.state.lower()
                    if new_state in ["paused", "disabled"]:
                        j["enabled"] = False
                        j["state"] = "paused"
                        j["paused_at"] = now_iso()
                        j["next_run_at"] = None
                    else:
                        j["enabled"] = True
                        j["state"] = "scheduled"
                        j["paused_at"] = None
                        j["next_run_at"] = compute_next_run(j.get("schedule") or j.get("schedule_display")) or now_iso()
                return dict(j)
        return None

    target = update_jobs(_modify)
    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    should_cancel = (
        (req.enabled is False)
        or (req.state is not None and req.state.lower() in ["paused", "disabled"])
    )
    if should_cancel:
        try:
            from app.services.cron_ticker import cancel_running_job
            cancel_running_job(job_id)
        except Exception as e:
            logger.debug(f"Error cancelling running job {job_id}: {e}")

    return {"success": True, "job": target}


@router.delete("/{job_id}")
def delete_cron_job(job_id: str, _ = Depends(require_auth)):
    def _delete(data):
        jobs = data.get("jobs", [])
        before_count = len(jobs)
        data["jobs"] = [j for j in jobs if str(j.get("id")) != str(job_id)]
        return len(data["jobs"]) < before_count

    found = update_jobs(_delete)
    if not found:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    try:
        from app.services.cron_ticker import cancel_running_job
        cancel_running_job(job_id)
    except Exception as e:
        logger.debug(f"Error cancelling running job {job_id} on deletion: {e}")

    return {"success": True, "job_id": job_id}


@router.post("/{job_id}/run")
def trigger_cron_job_now(job_id: str, _ = Depends(require_auth)):
    def _trigger(data):
        jobs = data.get("jobs", [])
        for j in jobs:
            if str(j.get("id")) == str(job_id):
                j["enabled"] = True
                j["state"] = "scheduled"
                j["paused_at"] = None
                j["next_run_at"] = (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()
                j["last_triggered_at"] = now_iso()
                j["last_status"] = "triggered"
                return dict(j)
        return None

    target = update_jobs(_trigger)
    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

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
    target = next((j for j in jobs if str(j.get("id")) == str(job_id)), None)
    if not target:
        raise HTTPException(status_code=404, detail="Job cron introuvable")

    log_path: Path | None = None
    if target.get("last_log"):
        p = Path(target["last_log"])
        if is_safe_path(p, [OUTPUT_DIR]) and p.exists() and p.is_file():
            log_path = p

    if not log_path and OUTPUT_DIR.exists():
        def _safe_mtime(f: Path) -> float:
            try:
                return f.stat().st_mtime
            except (OSError, RuntimeError):
                return 0.0

        prefix = f"{job_id}_"
        matching = sorted(
            [p for p in OUTPUT_DIR.iterdir() if p.is_file() and p.name.startswith(prefix) and p.name.endswith(".log")],
            key=_safe_mtime,
            reverse=True
        )
        if matching:
            candidate = matching[0]
            if is_safe_path(candidate, [OUTPUT_DIR]) and candidate.is_file():
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
        mtime = None
        try:
            mtime = log_path.stat().st_mtime
        except OSError:
            pass
        return {
            "job_id": job_id,
            "has_log": True,
            "file": log_path.name,
            "mtime": mtime,
            "content": content
        }
    except Exception as e:
        logger.error(f"Erreur lors de la lecture du log pour {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur de lecture du journal : {e}")
