"""
Surveillance en direct des journaux du CLI agy pour détecter les dépassements
de quota Google PENDANT une exécution.

Pourquoi : lorsqu'un compte Google atteint sa limite, le CLI agy ne s'arrête
pas immédiatement — il retente en interne avec un backoff exponentiel (des
dizaines de minutes avant l'échec final). En surveillant le journal propre du
CLI (`<data>/log/cli-*.log`), Antigravity WebUI détecte la limite en quelques
secondes, termine le processus et déclenche la bascule automatique de compte
puis la relance de la tâche.

Aucune dépendance Hermes : les journaux surveillés appartiennent au CLI agy,
dans le dossier de données de l'application.
"""
import asyncio
import logging
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

import aiofiles

from app.config import LOG_DIR
from app.services.google_auth import is_hard_quota_error

logger = logging.getLogger("antigravity.quota_watch")


def _newest_log_after(since_ts: float) -> Path | None:
    """Retourne le journal cli-*.log créé/modifié depuis `since_ts` (le plus récent)."""
    candidates = []
    try:
        for f in LOG_DIR.glob("cli-*.log"):
            try:
                st = f.stat()
            except OSError:
                continue
            if st.st_mtime >= since_ts - 5:
                candidates.append((st.st_mtime, f))
    except OSError as e:
        logger.debug(f"quota_watch: scan des logs impossible: {e}")
        return None
    if not candidates:
        return None
    candidates.sort()
    return candidates[-1][1]


def _expected_log_candidates(since_ts: float, window: float = 5.0) -> list[Path]:
    """
    Le CLI agy nomme son journal ``cli-AAAAMMJJ_HHMMSS.log`` avec l'heure
    locale de démarrage de la session (vérifié empiriquement). On cible donc
    précisément les fichiers dont le nom correspond à la seconde du spawn
    (± quelques secondes) — ce qui lève l'ambiguïté entre runs concurrents.
    """
    out: list[Path] = []
    base = int(since_ts) - 1
    for t in range(base, base + int(window) + 2):
        try:
            name = "cli-" + datetime.fromtimestamp(t).strftime("%Y%m%d_%H%M%S") + ".log"
        except (OverflowError, OSError, ValueError):
            continue
        p = LOG_DIR / name
        try:
            if p.exists():
                out.append(p)
        except OSError:
            continue
    return out


async def watch_agy_log_for_quota(
    since_ts: float,
    should_stop: Callable[[], bool],
    poll_interval: float = 1.0,
    max_seconds: float = 1800.0,
) -> str | None:
    """
    Surveille le journal CLI créé par un run agy et retourne la première ligne
    signalant un quota DUR (compte épuisé), ou None si le run se termine avant.

    - `since_ts` : timestamp de départ du run (ciblage par nom horodaté, avec
      repli sur le journal le plus récent en cas de nom inattendu).
    - `should_stop` : callback vérifié à chaque tour (ex: processus terminé).
    """
    start = time.time()
    log_file: Path | None = None
    offset = 0

    while not should_stop() and (time.time() - start) < max_seconds:
        await asyncio.sleep(poll_interval)

        if log_file is None:
            candidates = _expected_log_candidates(since_ts)
            if candidates:
                log_file = candidates[0]
            elif (time.time() - start) > 8.0:
                # Repli : nom de journal inattendu (version différente du CLI)
                log_file = _newest_log_after(since_ts)
            if log_file is None:
                continue

        try:
            size = log_file.stat().st_size
        except OSError:
            continue
        if size <= offset:
            if size < offset:  # journal remplacé/tronqué
                offset = 0
            continue

        try:
            async with aiofiles.open(log_file, "r", encoding="utf-8", errors="replace") as f:
                await f.seek(offset)
                chunk = await f.read()
                offset = await f.tell()
        except (OSError, ValueError) as exc:
            logger.debug(f"quota_watch: lecture impossible ({log_file}): {exc}")
            continue

        for line in chunk.splitlines():
            if is_hard_quota_error(line):
                logger.warning(f"quota_watch: quota dur détecté — {line.strip()[:160]}")
                return line.strip()

    return None
