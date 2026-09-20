"""
Stockage des tâches planifiées (crons) — 100 % propre à Antigravity WebUI.

Aucune dépendance à Hermes : les jobs vivent dans le dossier de données de
l'application (ANTIGRAVITY_DATA_DIR, par défaut ~/.gemini/antigravity-cli/cron).

Fichiers gérés :
- jobs.json          : définition des jobs (créés via l'UI ou l'API)
- ticker_heartbeat   : battement du ticker interne (lu par l'UI pour le statut)
- output/            : journaux d'exécution de chaque run
"""
import copy
import json
import logging
import os
import re
import threading
import time
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, TypeVar

from croniter import croniter

T = TypeVar("T")

from app.config import GEMINI_DIR
from app.platform_utils import restrict_file_permissions

logger = logging.getLogger("antigravity.cron_store")

CRON_DIR = Path(os.environ.get("ANTIGRAVITY_CRON_DIR", str(GEMINI_DIR / "cron")))
JOBS_FILE = CRON_DIR / "jobs.json"
HEARTBEAT_FILE = CRON_DIR / "ticker_heartbeat"
OUTPUT_DIR = CRON_DIR / "output"

_jobs_lock = threading.RLock()


def ensure_dirs() -> None:
    CRON_DIR.mkdir(parents=True, exist_ok=True)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_heartbeat() -> None:
    """Marque le ticker comme actif (lu par l'API /api/crons)."""
    ensure_dirs()
    HEARTBEAT_FILE.write_text(str(time.time()), encoding="utf-8")


def load_jobs() -> dict[str, Any]:
    """Charge jobs.json (crée une structure vide si absent ou illisible)."""
    with _jobs_lock:
        ensure_dirs()
        if not JOBS_FILE.exists():
            return {"jobs": [], "updated_at": now_iso()}
        try:
            with open(JOBS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as e:
            logger.error(f"Lecture de jobs.json impossible: {e}")
            return {"jobs": [], "updated_at": now_iso()}

        if isinstance(data, dict):
            data.setdefault("jobs", [])
            return copy.deepcopy(data)
        if isinstance(data, list):
            return {"jobs": copy.deepcopy(data), "updated_at": now_iso()}
        return {"jobs": [], "updated_at": now_iso()}


def save_jobs(data: dict[str, Any]) -> None:
    """Écrit jobs.json de façon atomique."""
    with _jobs_lock:
        ensure_dirs()
        payload = copy.deepcopy(data)
        payload["updated_at"] = now_iso()
        temp_path = JOBS_FILE.parent / f"{JOBS_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, indent=2, ensure_ascii=False)
            restrict_file_permissions(temp_path)
            temp_path.replace(JOBS_FILE)
            restrict_file_permissions(JOBS_FILE)
        except Exception:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception as e:
                    logger.debug(f"Ignored error: {e}")
            raise

def update_jobs(modifier: Callable[[dict[str, Any]], T]) -> T:
    """Effectue une opération atomique de lecture, modification et écriture."""
    with _jobs_lock:
        ensure_dirs()
        data: dict[str, Any] = {"jobs": [], "updated_at": now_iso()}
        if JOBS_FILE.exists():
            try:
                with open(JOBS_FILE, "r", encoding="utf-8") as f:
                    file_data = json.load(f)
                    if isinstance(file_data, dict):
                        file_data.setdefault("jobs", [])
                        data = file_data
                    elif isinstance(file_data, list):
                        data = {"jobs": file_data, "updated_at": now_iso()}
            except Exception as e:
                logger.error(f"Lecture de jobs.json impossible: {e}")

        snapshot = copy.deepcopy(data)
        result = modifier(data)

        # Si les données n'ont subi aucune modification, éviter une réécriture inutile du disque
        if data == snapshot:
            return copy.deepcopy(result) if isinstance(result, (dict, list)) else result
        
        data["updated_at"] = now_iso()
        temp_path = JOBS_FILE.parent / f"{JOBS_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
        try:
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            restrict_file_permissions(temp_path)
            temp_path.replace(JOBS_FILE)
            restrict_file_permissions(JOBS_FILE)
        except Exception:
            if temp_path.exists():
                try:
                    temp_path.unlink()
                except Exception as e:
                    logger.debug(f"Ignored error: {e}")
            raise
        return copy.deepcopy(result) if isinstance(result, (dict, list)) else result


_SCHEDULE_INTERVAL_RE = re.compile(
    r"^(?:every|toutes les|chaque)\s+(\d+)\s*(s|sec|seconds?|secondes?|m|min|mins|minutes?|h|hr|hrs|hours?|heures?|d|day|days?|jours?|w|week|weeks?|semaines?|mo|month|months?|mois)?$",
    re.IGNORECASE
)
_DAILY_AT_RE = re.compile(
    r"^(?:every\s+day|daily|chaque\s+jour|tous\s+les\s+jours)\s+(?:at|à)\s+(\d{1,2})(?:[:hH](\d{1,2})|[hH])?$",
    re.IGNORECASE
)


def compute_next_run(schedule: str | dict[str, Any] | None) -> str | None:
    """Calcule la prochaine date d'exécution depuis une expression cron ou un intervalle."""
    if not schedule:
        return None
    now = datetime.now(timezone.utc).replace(microsecond=0)
    expr = ""
    if isinstance(schedule, str):
        expr = schedule.strip()
    elif isinstance(schedule, dict):
        if schedule.get("kind") == "interval":
            total_delta = timedelta()
            has_units = False
            unit_defs = [
                ("months", lambda v: timedelta(days=30 * max(0, int(v)))),
                ("weeks", lambda v: timedelta(weeks=max(0, int(v)))),
                ("days", lambda v: timedelta(days=max(0, int(v)))),
                ("hours", lambda v: timedelta(hours=max(0, int(v)))),
                ("minutes", lambda v: timedelta(minutes=max(0, int(v)))),
                ("seconds", lambda v: timedelta(seconds=max(0, int(v)))),
            ]
            for unit_key, delta_fn in unit_defs:
                if unit_key in schedule and schedule[unit_key] is not None:
                    try:
                        unit_delta = delta_fn(schedule[unit_key])
                        if unit_delta.total_seconds() > 0:
                            total_delta += unit_delta
                            has_units = True
                    except (ValueError, TypeError):
                        logger.debug("Ignored error")
            if has_units:
                if total_delta.total_seconds() < 10:
                    total_delta = timedelta(seconds=10)
                return (now + total_delta).isoformat()
            expr = schedule.get("expr") or schedule.get("display") or schedule.get("schedule_display") or ""

        elif schedule.get("kind") == "cron":
            expr = schedule.get("expr") or schedule.get("display") or schedule.get("schedule_display") or ""
        else:
            expr = schedule.get("expr") or schedule.get("display") or schedule.get("schedule_display") or ""

    if not expr:
        return None
    expr = expr.strip().strip("'\"")
    if not expr:
        return None

    # Syntaxes rapides : "every 10m", "hourly", "daily", "monthly", "chaque mois"...
    lower = expr.lower().strip()
    if lower in ("every minute", "chaque minute", "toutes les minutes"):
        return (now + timedelta(minutes=1)).isoformat()
    if lower in ("every hour", "hourly", "chaque heure", "toutes les heures"):
        return (now + timedelta(hours=1)).isoformat()
    if lower in ("every day", "daily", "chaque jour", "tous les jours"):
        return (now + timedelta(days=1)).isoformat()
    if lower in ("every week", "weekly", "chaque semaine", "toutes les semaines"):
        return (now + timedelta(weeks=1)).isoformat()
    if lower in ("every month", "monthly", "chaque mois", "tous les mois"):
        return (now + timedelta(days=30)).isoformat()

    daily_at_match = _DAILY_AT_RE.match(lower)
    if daily_at_match:
        try:
            h = int(daily_at_match.group(1))
            m_str = daily_at_match.group(2)
            m = int(m_str) if m_str is not None else 0
            if 0 <= h < 24 and 0 <= m < 60:
                target = now.replace(hour=h, minute=m, second=0)
                if target <= now:
                    target += timedelta(days=1)
                return target.isoformat()
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    match = _SCHEDULE_INTERVAL_RE.match(lower)
    if match:
        try:
            val = max(1, int(match.group(1)))  # minimum 1 pour éviter une boucle d'exécution infinie
            unit = (match.group(2) or "m").lower()
            if unit.startswith(("mo", "mois")):
                return (now + timedelta(days=30 * val)).isoformat()
            elif unit.startswith(("w", "sem")):
                return (now + timedelta(weeks=val)).isoformat()
            elif unit.startswith("h"):
                return (now + timedelta(hours=val)).isoformat()
            elif unit.startswith(("d", "j")):
                return (now + timedelta(days=val)).isoformat()
            elif unit.startswith("s"):
                return (now + timedelta(seconds=max(10, val))).isoformat()
            else:
                return (now + timedelta(minutes=val)).isoformat()
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    try:
        if croniter.is_valid(expr):
            iter_cron = croniter(expr, now)
            next_dt = iter_cron.get_next(datetime)
            if next_dt.tzinfo is None:
                next_dt = next_dt.replace(tzinfo=timezone.utc)
            return next_dt.replace(microsecond=0).isoformat()
    except Exception as e:
        logger.warning(f"Expression cron invalide '{expr}': {e}")
    return None
