"""
Ticker interne d'Antigravity WebUI — exécuteur des tâches planifiées propres
à l'application (aucune dépendance Hermes).

Fonctionnement :
- Toutes les TICK_SECONDS, le ticker vérifie les jobs dus (next_run_at <= maintenant)
  et lance leur exécution en arrière-plan.
- Chaque job s'exécute via le CLI `agy` en mode headless (`-p`), dans le
  workspace par défaut de l'application.
- En cas de quota Google atteint pendant l'exécution : bascule automatique vers
  un autre compte Google non épuisé, puis relance immédiate de la tâche
  (jusqu'à MAX_TASK_FAILOVER tentatives) — même logique que les tours de chat.
- Un heartbeat est écrit à chaque tick (l'UI affiche « Ticker Actif ») et la
  sortie de chaque run est journalisée dans CRON_DIR/output/.
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app.config import AGY_BIN, DEFAULT_WORKSPACE
from app.platform_utils import spawn_group_kwargs, terminate_process_group_async
from app.services.agy_driver import resolve_model_and_effort
from app.services.cron_store import (
    CRON_DIR,
    OUTPUT_DIR,
    compute_next_run,
    ensure_dirs,
    load_jobs,
    now_iso,
    save_jobs,
    write_heartbeat,
)
from app.services.google_auth import (
    get_active_account,
    is_hard_quota_error,
    is_quota_error,
    switch_to_next_healthy_account,
)
from app.services.quota_watch import watch_agy_log_for_quota

logger = logging.getLogger("antigravity.cron_ticker")

TICK_SECONDS = 20
JOB_TIMEOUT_SECONDS = 20 * 60
MAX_TASK_FAILOVER = 5

_running_jobs: set[str] = set()
_jobs_write_lock = asyncio.Lock()


async def run_agy_task(
    prompt: str,
    skills: list[str] | None = None,
    model: str | None = None,
    effort: str | None = None,
    timeout: int = JOB_TIMEOUT_SECONDS
) -> tuple[str, str, int]:
    """
    Exécute un prompt via `agy` en mode headless. Retourne (stdout, stderr, code).

    Surveille aussi en direct le journal agy : si un quota DUR apparaît
    (compte épuisé), le processus est terminé immédiatement afin que la
    bascule de compte + relance s'opère sans attendre les retries internes.
    """
    effective_prompt = prompt
    if skills:
        skills_prefix = f"[Active skills: {', '.join(skills)}]\n"
        effective_prompt = f"{skills_prefix}{prompt}"
    cmd = [AGY_BIN, "--dangerously-skip-permissions", "--print-timeout", "20m"]
    resolved_model, resolved_effort = resolve_model_and_effort(model, effort)
    if resolved_model and resolved_model.strip():
        cmd.extend(["--model", resolved_model.strip()])
    if resolved_effort and resolved_effort.strip():
        cmd.extend(["--effort", resolved_effort.strip()])
    cmd.extend(["-p", effective_prompt])
    spawned_at = time.time()
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=DEFAULT_WORKSPACE,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **spawn_group_kwargs()
    )

    stdout_chunks: list = []
    stderr_chunks: list = []
    quota_seen: dict[str, Any] = {"line": None}

    async def pump(stream, chunks, watch_quota: bool = False):
        while True:
            line = await stream.readline()
            if not line:
                break
            text = line.decode("utf-8", errors="replace")
            chunks.append(text)
            if (
                watch_quota
                and quota_seen["line"] is None
                and is_hard_quota_error(text)
                and proc.returncode is None
            ):
                quota_seen["line"] = text.strip()
                logger.warning(
                    f"[Cron] Quota dur détecté sur stderr — terminaison pour bascule: {text.strip()[:140]}"
                )
                await terminate_process_group_async(proc, grace=1.5)

    async def quota_supervisor():
        line = await watch_agy_log_for_quota(
            since_ts=spawned_at,
            should_stop=lambda: proc.returncode is not None
        )
        if line and proc.returncode is None:
            quota_seen["line"] = line
            logger.warning(f"[Cron] Quota dur détecté (logs agy) — terminaison pour bascule: {line[:140]}")
            await terminate_process_group_async(proc, grace=1.5)
        return line

    pumps = [
        asyncio.create_task(pump(proc.stdout, stdout_chunks)),
        asyncio.create_task(pump(proc.stderr, stderr_chunks, watch_quota=True)),
    ]
    quota_task = asyncio.create_task(quota_supervisor())

    timed_out = False
    try:
        try:
            await asyncio.wait_for(proc.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            timed_out = True
            await terminate_process_group_async(proc, grace=2.0)

        for t in pumps:
            try:
                await asyncio.wait_for(t, timeout=3.0)
            except Exception:
                t.cancel()

        if quota_seen["line"] is None:
            try:
                quota_line = await asyncio.wait_for(quota_task, timeout=2.0)
                if quota_line:
                    quota_seen["line"] = quota_line
            except Exception:
                quota_task.cancel()
        elif not quota_task.done():
            quota_task.cancel()
    finally:
        if proc.returncode is None:
            await terminate_process_group_async(proc, grace=1.0)
        for t in pumps + [quota_task]:
            if not t.done():
                t.cancel()
        await asyncio.gather(*pumps, quota_task, return_exceptions=True)

    out = "".join(stdout_chunks)
    err = "".join(stderr_chunks)
    if quota_seen["line"]:
        err = (err + "\n" if err else "") + f"[quota] {quota_seen['line']}"
    if timed_out:
        err = (err + "\n" if err else "") + f"[timeout] Tâche interrompue après {timeout}s"

    code = proc.returncode if proc.returncode is not None else -1
    return out, err, code


async def run_job_with_failover(job: dict[str, Any]) -> dict[str, Any]:
    """
    Exécute un job avec bascule automatique de compte Google en cas de quota
    atteint, puis relance immédiate de la tâche.
    Retourne {status, attempts, failovers, output}.
    """
    prompt = (job.get("prompt") or "").strip()
    attempts = 0
    failovers: list[dict[str, Any]] = []
    output = ""
    status = "error"

    skills = job.get("skills", [])
    model = job.get("model")
    effort = job.get("effort")
    while attempts < MAX_TASK_FAILOVER:
        attempts += 1
        try:
            out, err, code = await run_agy_task(prompt, skills=skills, model=model, effort=effort)
        except Exception as exc:
            logger.error(f"[Cron] Exception levée pendant run_agy_task: {exc}", exc_info=True)
            output = f"Exception: {exc}"
            status = "failed"
            break
        combined = f"{out}\n{err}".strip()
        output = combined

        if is_quota_error(combined):
            current = get_active_account()
            current_email = (current or {}).get("email") or "inconnu"
            new_account = switch_to_next_healthy_account(exclude_email=current_email, model=model)
            if new_account:
                failovers.append({"from": current_email, "to": new_account, "attempt": attempts})
                logger.warning(
                    f"[Cron] Quota atteint sur {current_email} — bascule sur {new_account}, "
                    f"relance de la tâche (tentative {attempts + 1}/{MAX_TASK_FAILOVER})..."
                )
                await asyncio.sleep(1.0)
                continue
            status = "quota_exhausted"
            logger.error("[Cron] Quota atteint et aucun compte alternatif disponible.")
            break

        # agy s'auto-limite à son print-timeout en sortant code 0 avec une sortie
        # partielle — ne pas présenter cela comme un succès complet.
        if code == 0 and "print timeout" in combined.lower():
            status = "timeout"
            logger.warning("[Cron] agy a atteint son print-timeout (sortie partielle) — job marqué 'timeout'.")
            break

        if code != 0 and "[timeout]" in combined:
            status = "timeout"
            logger.warning("[Cron] Job interrompu par le timeout du ticker — marqué 'timeout'.")
            break

        if code == 0:
            status = "ok"
        else:
            status = "failed"
            logger.error(f"[Cron] Échec du job (code {code}).")
        break

    return {"status": status, "attempts": attempts, "failovers": failovers, "output": output}


async def _execute_job(job: dict[str, Any]) -> None:
    job_id = job.get("id")
    name = job.get("name") or job_id
    started = time.time()
    logger.info(f"[Cron] Exécution du job « {name} » ({job_id})...")

    result = await run_job_with_failover(job)
    duration = round(time.time() - started, 1)

    # Journal d'exécution (propre à l'application)
    ensure_dirs()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_file = OUTPUT_DIR / f"{job_id}_{stamp}.log"
    header = (
        f"Job: {name} ({job_id})\n"
        f"Début: {datetime.now(timezone.utc).isoformat()}\n"
        f"Durée: {duration}s — Statut: {result.get('status', 'failed')} — Tentatives: {result.get('attempts', 1)}\n"
        f"Basculements: {result.get('failovers') or 'aucun'}\n"
        f"{'-' * 60}\n"
    )
    try:
        log_file.write_text(header + str(result.get("output") or ""), encoding="utf-8")
        logger.info(f"[Cron] Journal écrit: {log_file}")
    except Exception as log_err:
        logger.warning(f"[Cron] Impossible d'écrire le journal {log_file}: {log_err}")

    # Mise à jour du job (verrou pour éviter les écritures concurrentes)
    async with _jobs_write_lock:
        data = load_jobs()
        for j in data.get("jobs", []):
            if j.get("id") == job_id:
                j["last_run_at"] = now_iso()
                j["last_status"] = result.get("status", "failed")
                j["last_duration_seconds"] = duration
                j["last_log"] = str(log_file)
                failovers = result.get("failovers")
                if failovers:
                    j["last_failover"] = failovers[-1]
                # Ne recalculer next_run_at que s'il n'est pas déjà planifié dans le futur (évite la dérive de timing)
                current_next = j.get("next_run_at")
                is_future = False
                if current_next:
                    try:
                        due = datetime.fromisoformat(str(current_next))
                        if due.tzinfo is None:
                            due = due.replace(tzinfo=timezone.utc)
                        if due > datetime.now(timezone.utc):
                            is_future = True
                    except (ValueError, TypeError):
                        pass
                if not is_future:
                    computed_next = compute_next_run(j.get("schedule"))
                    if not computed_next:
                        logger.warning(f"[Cron] Impossible de recalculer le prochain run pour {j.get('id')}, repli sur +1h.")
                        computed_next = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
                    j["next_run_at"] = computed_next
                break
        save_jobs(data)
    logger.info(f"[Cron] Job « {name} » terminé: {result.get('status', 'unknown')} ({duration}s).")


async def _guarded_execute(job: dict[str, Any]) -> None:
    job_id = job.get("id")
    try:
        await _execute_job(job)
    except Exception as e:
        logger.error(f"[Cron] Erreur pendant l'exécution du job {job_id}: {e}", exc_info=True)
        try:
            async with _jobs_write_lock:
                data = load_jobs()
                for j in data.get("jobs", []):
                    if j.get("id") == job_id and j.get("last_status") == "running":
                        j["last_status"] = "failed"
                        j["last_run_at"] = now_iso()
                        break
                save_jobs(data)
        except Exception as save_err:
            logger.error(f"[Cron] Impossible de mettre à jour le statut d'échec pour {job_id}: {save_err}")
    finally:
        _running_jobs.discard(job_id)


async def tick_once() -> int:
    """
    Vérifie les jobs dus et lance leur exécution en arrière-plan.
    Retourne le nombre de jobs lancés.
    """
    ensure_dirs()
    to_launch: list[dict[str, Any]] = []

    async with _jobs_write_lock:
        data = load_jobs()
        now = datetime.now(timezone.utc)
        changed = False

        for job in data.get("jobs", []):
            job_id = job.get("id")
            if not job_id:
                continue
            if not job.get("enabled", True):
                continue
            if job.get("state", "scheduled") != "scheduled":
                continue
            nxt = job.get("next_run_at")
            if not nxt:
                continue
            if job_id in _running_jobs:
                continue
            try:
                due = datetime.fromisoformat(str(nxt))
                if due.tzinfo is None:
                    due = due.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError) as parse_err:
                logger.warning(
                    f"[Cron] Date next_run_at invalide pour le job {job_id} ('{nxt}': {parse_err}). Recalcul automatique."
                )
                computed_next = compute_next_run(job.get("schedule"))
                if not computed_next:
                    computed_next = (now + timedelta(hours=1)).isoformat()
                job["next_run_at"] = computed_next
                changed = True
                continue
            if due <= now:
                job["last_status"] = "running"
                job["last_started_at"] = now_iso()
                computed_next = compute_next_run(job.get("schedule"))
                if not computed_next:
                    logger.warning(f"[Cron] Impossible de calculer le prochain run pour {job_id}, repli sur +1h.")
                    computed_next = (now + timedelta(hours=1)).isoformat()
                job["next_run_at"] = computed_next
                changed = True
                _running_jobs.add(job_id)
                to_launch.append(dict(job))

        if changed:
            save_jobs(data)

    for job in to_launch:
        asyncio.create_task(_guarded_execute(job))

    return len(to_launch)


async def cron_ticker_loop() -> None:
    """Boucle principale du ticker (démarrée avec le serveur)."""
    ensure_dirs()
    # Nettoyage préventif des tâches restées en 'running' lors d'un crash ou redémarrage antérieur
    try:
        async with _jobs_write_lock:
            init_data = load_jobs()
            cleaned = False
            for j in init_data.get("jobs", []):
                if j.get("last_status") == "running":
                    j["last_status"] = "interrupted"
                    cleaned = True
            if cleaned:
                save_jobs(init_data)
                logger.info("[Cron] Nettoyage des jobs orphelins restés en 'running' effectué.")
    except Exception as e:
        logger.warning(f"[Cron] Erreur lors du nettoyage initial des jobs: {e}")

    logger.info(f"Cron ticker Antigravity WebUI démarré (tick={TICK_SECONDS}s, dossier={CRON_DIR}).")
    while True:
        try:
            write_heartbeat()
            await tick_once()
        except Exception as e:
            logger.error(f"Cron ticker: erreur de tick: {e}", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)
