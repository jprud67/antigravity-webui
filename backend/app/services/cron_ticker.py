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
from datetime import datetime, timezone
from typing import Any

from app.config import AGY_BIN, DEFAULT_WORKSPACE
from app.platform_utils import spawn_group_kwargs, terminate_process_group_async
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

_running_jobs: set = set()
_jobs_write_lock = asyncio.Lock()


async def run_agy_task(prompt: str, skills: list[str] | None = None, timeout: int = JOB_TIMEOUT_SECONDS) -> tuple[str, str, int]:
    """
    Exécute un prompt via `agy` en mode headless. Retourne (stdout, stderr, code).

    Surveille aussi en direct le journal agy : si un quota DUR apparaît
    (compte épuisé), le processus est terminé immédiatement afin que la
    bascule de compte + relance s'opère sans attendre les retries internes.
    """
    cmd = [AGY_BIN, "--dangerously-skip-permissions", "--print-timeout", "20m"]
    if skills:
        for sk in skills:
            cmd.extend(["--skill", sk])
    cmd.extend(["-p", prompt])
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
        await asyncio.wait_for(proc.wait(), timeout=timeout)
    except asyncio.TimeoutError:
        timed_out = True
        await terminate_process_group_async(proc, grace=2.0)

    for t in pumps:
        try:
            await asyncio.wait_for(t, timeout=3.0)
        except asyncio.TimeoutError:
            t.cancel()

    if quota_seen["line"] is None:
        try:
            quota_line = await asyncio.wait_for(quota_task, timeout=2.0)
            if quota_line:
                quota_seen["line"] = quota_line
        except asyncio.TimeoutError:
            quota_task.cancel()
    elif not quota_task.done():
        quota_task.cancel()

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
    while attempts < MAX_TASK_FAILOVER:
        attempts += 1
        out, err, code = await run_agy_task(prompt, skills)
        combined = f"{out}\n{err}".strip()
        output = combined

        if is_quota_error(combined):
            current = get_active_account()
            current_email = (current or {}).get("email") or "inconnu"
            new_account = switch_to_next_healthy_account(exclude_email=current_email)
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
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    log_file = OUTPUT_DIR / f"{job_id}_{stamp}.log"
    header = (
        f"Job: {name} ({job_id})\n"
        f"Début: {datetime.now().isoformat()}\n"
        f"Durée: {duration}s — Statut: {result['status']} — Tentatives: {result['attempts']}\n"
        f"Basculements: {result['failovers'] or 'aucun'}\n"
        f"{'-' * 60}\n"
    )
    log_file.write_text(header + result["output"], encoding="utf-8")
    logger.info(f"[Cron] Journal écrit: {log_file}")

    # Mise à jour du job (verrou pour éviter les écritures concurrentes)
    async with _jobs_write_lock:
        data = load_jobs()
        for j in data.get("jobs", []):
            if j.get("id") == job_id:
                j["last_run_at"] = now_iso()
                j["last_status"] = result["status"]
                j["last_duration_seconds"] = duration
                j["last_log"] = str(log_file)
                if result["failovers"]:
                    j["last_failover"] = result["failovers"][-1]
                j["next_run_at"] = compute_next_run(j.get("schedule"))
                break
        save_jobs(data)
    logger.info(f"[Cron] Job « {name} » terminé: {result['status']} ({duration}s).")


async def _guarded_execute(job: dict[str, Any]) -> None:
    try:
        await _execute_job(job)
    except Exception as e:
        logger.error(f"[Cron] Erreur pendant l'exécution du job {job.get('id')}: {e}", exc_info=True)
    finally:
        _running_jobs.discard(job.get("id"))


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
            if not job.get("enabled", True):
                continue
            if job.get("state", "scheduled") != "scheduled":
                continue
            nxt = job.get("next_run_at")
            if not nxt:
                continue
            if job.get("id") in _running_jobs:
                continue
            try:
                due = datetime.fromisoformat(str(nxt))
                if due.tzinfo is None:
                    due = due.replace(tzinfo=timezone.utc)
            except ValueError:
                continue
            if due <= now:
                job["last_status"] = "running"
                job["last_started_at"] = now_iso()
                job["next_run_at"] = compute_next_run(job.get("schedule"))
                changed = True
                _running_jobs.add(job.get("id"))
                to_launch.append(dict(job))

        if changed:
            save_jobs(data)

    for job in to_launch:
        asyncio.create_task(_guarded_execute(job))

    return len(to_launch)


async def cron_ticker_loop() -> None:
    """Boucle principale du ticker (démarrée avec le serveur)."""
    ensure_dirs()
    logger.info(f"Cron ticker Antigravity WebUI démarré (tick={TICK_SECONDS}s, dossier={CRON_DIR}).")
    while True:
        try:
            write_heartbeat()
            await tick_once()
        except Exception as e:
            logger.error(f"Cron ticker: erreur de tick: {e}", exc_info=True)
        await asyncio.sleep(TICK_SECONDS)
