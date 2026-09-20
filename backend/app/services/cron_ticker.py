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
import inspect
import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import AGY_BIN, DEFAULT_WORKSPACE
from app.platform_utils import (
    restrict_file_permissions,
    spawn_group_kwargs,
    terminate_process_group_async,
    terminate_process_group_sync,
)
from app.services.agy_driver import get_model_families, resolve_model_and_effort
from app.services.cron_store import (
    CRON_DIR,
    OUTPUT_DIR,
    compute_next_run,
    ensure_dirs,
    now_iso,
    update_jobs,
    write_heartbeat,
)
from app.services.google_auth import (
    get_active_account,
    is_hard_quota_error,
    is_quota_error,
    switch_to_next_healthy_account,
)
from app.services.quota_watch import watch_agy_log_for_quota
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.cron_ticker")

TICK_SECONDS = 20
JOB_TIMEOUT_SECONDS = 20 * 60
MAX_TASK_FAILOVER = 5

_running_jobs: set[str] = set()
_running_job_tasks: dict[str, asyncio.Task[None]] = {}
_running_job_procs: dict[str, Any] = {}
_background_tasks: set[asyncio.Task[None]] = set()
_jobs_write_lock = asyncio.Lock()


def cancel_running_job(job_id: str) -> bool:
    """Annule immédiatement l'exécution d'un job cron en cours et de son groupe de processus."""
    canceled = False
    task = _running_job_tasks.get(job_id)
    if task and not task.done():
        task.cancel()
        canceled = True
    proc = _running_job_procs.get(job_id)
    if proc:
        try:
            terminate_process_group_sync(proc, force=True)
            canceled = True
        except OSError as term_err:
            logger.debug(f"[Cron] Error terminating process group for job {job_id}: {term_err}")
    return canceled


def extract_stream_json_text(raw_text: str) -> str:
    """Extrait le texte assistant d'un flux stream-json (NDJSON) si présent."""
    if not raw_text or not raw_text.strip():
        return raw_text
    parts: list[str] = []
    has_json = False
    for line in raw_text.splitlines():
        line_s = line.strip()
        if not line_s:
            continue
        if line_s.startswith("{") and line_s.endswith("}"):
            try:
                ev = json.loads(line_s)
                has_json = True
                if ev.get("type") == "message" and ev.get("role") == "assistant":
                    content = ev.get("content")
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "text":
                                parts.append(c.get("text", ""))
                    elif isinstance(content, str):
                        parts.append(content)
                elif ev.get("event") == "assistant":
                    msg = ev.get("message", {})
                    content = msg.get("content")
                    if isinstance(content, list):
                        for c in content:
                            if isinstance(c, dict) and c.get("type") == "text":
                                parts.append(c.get("text", ""))
                    elif isinstance(content, str):
                        parts.append(content)
                elif "delta" in ev:
                    delta = ev.get("delta")
                    if isinstance(delta, str):
                        parts.append(delta)
                    elif isinstance(delta, dict) and "text" in delta:
                        parts.append(delta["text"])
            except Exception:
                parts.append(line)
        else:
            parts.append(line)
    if has_json and parts:
        return "\n".join(parts).strip()
    return raw_text


async def run_agy_task(
    prompt: str,
    skills: list[str] | None = None,
    model: str | None = None,
    effort: str | None = None,
    timeout: int = JOB_TIMEOUT_SECONDS,
    job_id: str | None = None
) -> tuple[str, str, int]:
    """
    Exécute un prompt via `agy` en mode headless. Retourne (stdout, stderr, code).

    Surveille aussi en direct le journal agy : si un quota DUR apparaît
    (compte épuisé), le processus est terminé immédiatement afin que la
    bascule de compte + relance s'opère sans attendre les retries internes.
    """
    effective_prompt = prompt
    if skills:
        if isinstance(skills, str):
            skills_list = [skills]
        elif isinstance(skills, (list, tuple, set)):
            skills_list = list(skills)
        else:
            skills_list = []
        valid_skills = [str(s).strip() for s in skills_list if s and str(s).strip()]
        if valid_skills:
            skills_prefix = f"[Active skills: {', '.join(valid_skills)}]\n"
            effective_prompt = f"{skills_prefix}{prompt}"
    cmd = [AGY_BIN, "--dangerously-skip-permissions", "--print-timeout", "20m"]
    resolved_model, resolved_effort = resolve_model_and_effort(model, effort)
    if resolved_model and resolved_model.strip():
        cmd.extend(["--model", resolved_model.strip()])
    if resolved_effort and resolved_effort.strip():
        cmd.extend(["--effort", resolved_effort.strip()])
    prompt_bytes = len(effective_prompt.encode("utf-8", "ignore"))
    via_stdin = prompt_bytes >= 100_000
    if via_stdin:
        cmd.extend(["--input-format", "stream-json", "--output-format", "stream-json"])
    else:
        cmd.extend(["-p", effective_prompt])

    spawned_at = time.time()
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=DEFAULT_WORKSPACE,
        stdin=asyncio.subprocess.PIPE if via_stdin else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **spawn_group_kwargs()
    )
    if job_id:
        _running_job_procs[job_id] = proc

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

    if via_stdin and proc.stdin is not None:
        payload = json.dumps({
            "event": "user",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": effective_prompt}],
            },
        }).encode("utf-8")
        stdin_obj: Any = proc.stdin
        try:
            res = stdin_obj.write(payload + b"\n")
            if inspect.isawaitable(res):
                await res
            drain = stdin_obj.drain()
            if inspect.isawaitable(drain):
                await drain
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            try:
                res_close = stdin_obj.close()
                if inspect.isawaitable(res_close):
                    await res_close
            except Exception:
                pass

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
        try:
            if proc.returncode is None:
                await asyncio.shield(terminate_process_group_async(proc, grace=1.0))
            for t in pumps + [quota_task]:
                if not t.done():
                    t.cancel()
            try:
                await asyncio.wait_for(asyncio.shield(asyncio.gather(*pumps, quota_task, return_exceptions=True)), timeout=2.0)
            except (asyncio.TimeoutError, Exception):
                pass
        finally:
            if job_id and _running_job_procs.get(job_id) is proc:
                _running_job_procs.pop(job_id, None)

    out = "".join(stdout_chunks)
    err = "".join(stderr_chunks)
    if via_stdin and out:
        out = extract_stream_json_text(out)
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
    if not model or not str(model).strip() or not effort or not str(effort).strip():
        try:
            settings = get_settings()
            if not model or not str(model).strip():
                model = settings.get("model")
            if not effort or not str(effort).strip():
                effort = settings.get("effort")
        except Exception as e:
            logger.debug(f"Ignored error: {e}")
    initial_target_model = model
    initial_target_effort = effort
    model_switched_on_current_account = False
    
    while attempts < MAX_TASK_FAILOVER:
        attempts += 1
        try:
            out, err, code = await run_agy_task(prompt, skills=skills, model=model, effort=effort, job_id=job.get("id"))
        except Exception as exc:
            logger.error(f"[Cron] Exception levée pendant run_agy_task: {exc}", exc_info=True)
            output = f"Exception: {exc}"
            status = "failed"
            break
        combined = f"{out}\n{err}".strip()
        output = combined

        if is_quota_error(combined):
            if attempts >= MAX_TASK_FAILOVER:
                status = "quota_exhausted"
                logger.error(
                    f"[Cron] Quota atteint et limite maximale de tentatives ({MAX_TASK_FAILOVER}) atteinte."
                )
                break

            current = get_active_account()
            current_email = (current or {}).get("email") or "inconnu"
            exclude_email = current_email if (current_email and "@" in current_email) else None
            
            # 1. Essayer de basculer sur un autre type de modèle (Gemini <-> Externe) avant de changer de compte
            if not model_switched_on_current_account:
                families = await get_model_families()
                is_gemini = ("gemini" in str(model).lower()) if model else True
                candidate_models = [
                    f for f in families 
                    if ("gemini" not in f.get("id", "").lower() if is_gemini else "gemini" in f.get("id", "").lower())
                ]
                found_alternative = False
                for cand in candidate_models:
                    variants = cand.get("variants") or {}
                    cand_model = (
                        variants.get(cand.get("default_effort") or "")
                        or variants.get("default")
                        or next(iter(variants.values()), None)
                        or cand.get("id")
                    )
                    if cand_model:
                        norm_cand_model, norm_effort = resolve_model_and_effort(cand_model, cand.get("default_effort"))
                        target_model = norm_cand_model or cand_model
                        if target_model and target_model != model:
                            old_model = model
                            model = target_model
                            effort = norm_effort
                            model_switched_on_current_account = True
                            found_alternative = True

                            failovers.append({"from": old_model, "to": model, "attempt": attempts, "type": "model"})
                            logger.warning(
                                f"[Cron] Quota atteint sur {current_email} avec {old_model} — bascule sur le modèle alternatif {model}, "
                                f"relance de la tâche (tentative {attempts + 1}/{MAX_TASK_FAILOVER})..."
                            )
                            break

                if found_alternative and attempts < MAX_TASK_FAILOVER:
                    await asyncio.sleep(1.0)
                    continue
                model_switched_on_current_account = True

            # 2. Si le modèle a déjà été basculé ou si c'est impossible, basculer le compte Google
            target_check_model = initial_target_model or model
            new_account = switch_to_next_healthy_account(exclude_email=exclude_email, model=target_check_model)
            if not new_account and target_check_model != model:
                new_account = switch_to_next_healthy_account(exclude_email=exclude_email, model=model)
                target_check_model = model

            if new_account and attempts < MAX_TASK_FAILOVER:
                # On réinitialise la bascule de modèle pour ce nouveau compte et on restaure le modèle initial
                model_switched_on_current_account = False
                model = target_check_model
                effort = initial_target_effort or effort
                
                failovers.append({"from": current_email, "to": new_account, "attempt": attempts, "type": "account"})
                logger.warning(
                    f"[Cron] Quota atteint sur {current_email} — bascule sur le compte {new_account} avec modèle {model}, "
                    f"relance de la tâche (tentative {attempts + 1}/{MAX_TASK_FAILOVER})..."
                )
                await asyncio.sleep(1.0)
                continue
                
            status = "quota_exhausted"
            logger.error("[Cron] Quota atteint et limite de failover atteinte ou aucun compte sain disponible.")
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


def prune_job_logs(job_id: str, keep_latest: int = 20) -> None:
    """Prunes old execution logs for a specific cron job to prevent disk bloat."""
    if not job_id or not OUTPUT_DIR.exists():
        return
    try:
        def _safe_mtime(p):
            try:
                return p.stat().st_mtime
            except OSError:
                return 0.0

        prefix = f"{job_id}_"
        logs = sorted(
            [p for p in OUTPUT_DIR.iterdir() if p.is_file() and p.name.startswith(prefix) and p.name.endswith(".log")],
            key=_safe_mtime,
            reverse=True
        )
        for old_log in logs[keep_latest:]:
            try:
                old_log.unlink(missing_ok=True)
            except OSError as unl_err:
                logger.debug(f"[Cron] Error pruning old log {old_log}: {unl_err}")
    except Exception as e:
        logger.debug(f"[Cron] Error pruning logs for job {job_id}: {e}")


def _recompute_job_next_run(j: dict[str, Any]) -> None:
    """Recalcule next_run_at si le job est actif et n'est pas déjà planifié dans le futur."""
    if j.get("state") in ("paused", "disabled") or not j.get("enabled", True):
        j["next_run_at"] = None
        return
    current_next = j.get("next_run_at")
    is_future = False
    if current_next:
        try:
            due = datetime.fromisoformat(str(current_next).replace("Z", "+00:00"))
            if due.tzinfo is None:
                due = due.replace(tzinfo=timezone.utc)
            if due > datetime.now(timezone.utc):
                is_future = True
        except (ValueError, TypeError):
            pass
    if not is_future:
        computed_next = compute_next_run(j.get("schedule") or j.get("schedule_display"))
        if not computed_next:
            logger.info(f"[Cron] Job {j.get('id')} sans planification récurrente marqué comme 'completed'.")
            j["next_run_at"] = None
            j["state"] = "completed"
        else:
            j["next_run_at"] = computed_next


def _write_job_log_entry(
    job_id: str,
    name: str,
    started_at: datetime,
    duration: float,
    status: str,
    output: str,
    attempts: int = 1,
    failovers: list | None = None
) -> Path | None:
    """Écrit le fichier journal pour une exécution de tâche cron et applique les restrictions d'accès."""
    ensure_dirs()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    log_file = OUTPUT_DIR / f"{job_id}_{stamp}.log"
    header = (
        f"Job: {name} ({job_id})\n"
        f"Début: {started_at.isoformat()}\n"
        f"Durée: {duration}s — Statut: {status} — Tentatives: {attempts}\n"
        f"Basculements: {failovers or 'aucun'}\n"
        f"{'-' * 60}\n"
    )
    try:
        log_file.write_text(header + str(output or ""), encoding="utf-8")
        restrict_file_permissions(log_file)
        if job_id:
            prune_job_logs(job_id, 20)
        logger.info(f"[Cron] Journal écrit: {log_file}")
        return log_file
    except Exception as log_err:
        logger.warning(f"[Cron] Impossible d'écrire le journal {log_file}: {log_err}")
        return None


async def _execute_job(job: dict[str, Any]) -> None:
    raw_job_id = job.get("id")
    job_id = str(raw_job_id) if raw_job_id is not None else ""
    name = str(job.get("name") or job_id)
    started = time.time()
    logger.info(f"[Cron] Exécution du job « {name} » ({job_id})...")

    result = await run_job_with_failover(job)
    duration = round(time.time() - started, 1)
    start_dt = datetime.fromtimestamp(started, tz=timezone.utc)

    # Journal d'exécution (propre à l'application)
    log_file = await asyncio.to_thread(
        _write_job_log_entry,
        job_id,
        name,
        start_dt,
        duration,
        result.get("status", "failed"),
        result.get("output") or "",
        result.get("attempts", 1),
        result.get("failovers")
    )

    # Mise à jour du job (verrou pour éviter les écritures concurrentes)
    async with _jobs_write_lock:
        def _update_result(data: dict[str, Any]) -> None:
            for j in data.get("jobs", []):
                if j.get("id") == job_id:
                    j["last_run_at"] = now_iso()
                    j["last_status"] = result.get("status", "failed")
                    j["last_duration_seconds"] = duration
                    if log_file:
                        j["last_log"] = str(log_file)
                    failovers = result.get("failovers")
                    if failovers:
                        j["last_failover"] = failovers[-1]
                    _recompute_job_next_run(j)
                    break
        update_jobs(_update_result)
    logger.info(f"[Cron] Job « {name} » terminé: {result.get('status', 'unknown')} ({duration}s).")


async def _guarded_execute(job: dict[str, Any]) -> None:
    raw_job_id = job.get("id")
    job_id = str(raw_job_id) if raw_job_id is not None else ""
    name = str(job.get("name") or job_id)
    if job_id:
        _running_jobs.add(job_id)
        current_task = asyncio.current_task()
        if current_task is not None:
            _running_job_tasks[job_id] = current_task
    started = time.time()
    try:
        await _execute_job(job)
    except asyncio.CancelledError:
        logger.warning(f"[Cron] Job {job_id} annulé.")
        duration = round(time.time() - started, 1)
        start_dt = datetime.fromtimestamp(started, tz=timezone.utc)

        async def _finalize_interrupted() -> None:
            log_file = None
            if job_id:
                try:
                    log_file = await asyncio.to_thread(
                        _write_job_log_entry,
                        job_id,
                        name,
                        start_dt,
                        duration,
                        "interrupted",
                        "[Interrompu] L'exécution de la tâche a été annulée ou interrompue."
                    )
                except Exception as log_err:
                    logger.error(f"[Cron] Impossible d'écrire le log pour {job_id}: {log_err}")
            try:
                async with _jobs_write_lock:
                    def _mark_interrupted(data: dict[str, Any]) -> None:
                        for j in data.get("jobs", []):
                            if j.get("id") == job_id:
                                j["last_status"] = "interrupted"
                                j["last_run_at"] = now_iso()
                                j["last_duration_seconds"] = duration
                                if log_file:
                                    j["last_log"] = str(log_file)
                                _recompute_job_next_run(j)
                                break
                    update_jobs(_mark_interrupted)
            except Exception as save_err:
                logger.error(f"[Cron] Impossible de marquer le job {job_id} comme interrompu: {save_err}")

        finalize_task = asyncio.create_task(_finalize_interrupted())
        while not finalize_task.done():
            try:
                await asyncio.shield(finalize_task)
            except asyncio.CancelledError:
                pass
            except Exception:
                break
        raise
    except Exception as e:
        logger.error(f"[Cron] Erreur pendant l'exécution du job {job_id}: {e}", exc_info=True)
        duration = round(time.time() - started, 1)
        start_dt = datetime.fromtimestamp(started, tz=timezone.utc)
        log_file = None
        if job_id:
            log_file = await asyncio.to_thread(
                _write_job_log_entry,
                job_id,
                name,
                start_dt,
                duration,
                "failed",
                f"[Erreur] Exception pendant l'exécution : {e}"
            )
        try:
            async with _jobs_write_lock:
                def _mark_failed(data: dict[str, Any]) -> None:
                    for j in data.get("jobs", []):
                        if j.get("id") == job_id:
                            j["last_status"] = "failed"
                            j["last_run_at"] = now_iso()
                            j["last_duration_seconds"] = duration
                            if log_file:
                                j["last_log"] = str(log_file)
                            _recompute_job_next_run(j)
                            break
                update_jobs(_mark_failed)
        except Exception as save_err:
            logger.error(f"[Cron] Impossible de mettre à jour le statut d'échec pour {job_id}: {save_err}")
    finally:
        if job_id:
            _running_jobs.discard(job_id)
            _running_job_tasks.pop(job_id, None)
            _running_job_procs.pop(job_id, None)


async def tick_once() -> int:
    """
    Vérifie les jobs dus et lance leur exécution en arrière-plan.
    Retourne le nombre de jobs lancés.
    """
    ensure_dirs()
    to_launch: list[dict[str, Any]] = []

    def _collect_due(data: dict[str, Any]) -> list[dict[str, Any]]:
        now = datetime.now(timezone.utc)
        due_jobs: list[dict[str, Any]] = []

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
                due = datetime.fromisoformat(str(nxt).replace("Z", "+00:00"))
                if due.tzinfo is None:
                    due = due.replace(tzinfo=timezone.utc)
            except (ValueError, TypeError) as parse_err:
                logger.warning(
                    f"[Cron] Date next_run_at invalide pour le job {job_id} ('{nxt}': {parse_err}). Recalcul automatique."
                )
                computed_next = compute_next_run(job.get("schedule") or job.get("schedule_display"))
                if not computed_next:
                    job["next_run_at"] = None
                    job["state"] = "completed"
                    logger.info(f"[Cron] Job {job_id} sans planification récurrente valide marqué 'completed'.")
                else:
                    job["next_run_at"] = computed_next
                continue
            if due <= now:
                job["last_status"] = "running"
                job["last_started_at"] = now_iso()
                computed_next = compute_next_run(job.get("schedule") or job.get("schedule_display"))
                if not computed_next:
                    job["next_run_at"] = None
                    job["state"] = "completed"
                else:
                    job["next_run_at"] = computed_next
                due_jobs.append(dict(job))
        return due_jobs

    async with _jobs_write_lock:
        to_launch = update_jobs(_collect_due)
        for job in to_launch:
            job_id = job.get("id")
            if job_id:
                _running_jobs.add(job_id)

    for job in to_launch:
        task = asyncio.create_task(_guarded_execute(job))
        _background_tasks.add(task)
        task.add_done_callback(_background_tasks.discard)

    return len(to_launch)


async def cron_ticker_loop() -> None:
    """Boucle principale du ticker (démarrée avec le serveur)."""
    ensure_dirs()
    # Nettoyage préventif des tâches restées en 'running' lors d'un crash ou redémarrage antérieur
    try:
        async with _jobs_write_lock:
            def _clean_orphans(init_data: dict[str, Any]) -> bool:
                cleaned = False
                now_iso_str = datetime.now(timezone.utc).isoformat()
                for j in init_data.get("jobs", []):
                    if j.get("last_status") == "running":
                        j["last_status"] = "interrupted"
                        if j.get("state") in ("scheduled", "active"):
                            nxt = j.get("next_run_at")
                            if not nxt or nxt < now_iso_str:
                                computed = compute_next_run(j.get("schedule") or j.get("schedule_display"))
                                if computed:
                                    j["next_run_at"] = computed
                                else:
                                    j["state"] = "completed"
                        cleaned = True
                return cleaned
            if update_jobs(_clean_orphans):
                logger.info("[Cron] Nettoyage des jobs orphelins restés en 'running' effectué.")
    except Exception as e:
        logger.warning(f"[Cron] Erreur lors du nettoyage initial des jobs: {e}")

    logger.info(f"Cron ticker Antigravity WebUI démarré (tick={TICK_SECONDS}s, dossier={CRON_DIR}).")
    try:
        while True:
            try:
                write_heartbeat()
                await tick_once()
            except Exception as e:
                logger.error(f"Cron ticker: erreur de tick: {e}", exc_info=True)
            await asyncio.sleep(TICK_SECONDS)
    except asyncio.CancelledError:
        logger.info("[Cron] Arrêt du ticker planifié, annulation des jobs d'arrière-plan...")
        if _background_tasks:
            for t in list(_background_tasks):
                t.cancel()
            await asyncio.gather(*list(_background_tasks), return_exceptions=True)
        for jid, proc in list(_running_job_procs.items()):
            try:
                if proc.returncode is None:
                    terminate_process_group_sync(proc, force=True)
            except OSError as term_err:
                logger.debug(f"[Cron] Erreur lors de la terminaison du process {jid}: {term_err}")
        _running_job_procs.clear()
        raise
