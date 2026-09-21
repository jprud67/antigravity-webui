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
from datetime import datetime, timezone
from pathlib import Path

from app.config import LOG_DIR
from app.services.google_auth import is_hard_quota_error

logger = logging.getLogger("antigravity.quota_watch")


def _read_log_chunk(path: Path, off: int) -> tuple[str, int]:
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        f.seek(off)
        data = f.read()
        return data, f.tell()


def _newest_log_after(since_ts: float) -> Path | None:
    """Retourne le journal cli-*.log créé/modifié depuis `since_ts` (le plus récent)."""
    if not LOG_DIR.exists():
        return None
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
    On vérifie à la fois l'heure locale et UTC pour supporter toute configuration.
    """
    if not LOG_DIR.exists():
        return []
    out: list[Path] = []
    seen: set[Path] = set()
    base = int(since_ts) - 1
    for t in range(base, base + int(window) + 2):
        names: list[str] = []
        try:
            # Heure locale (défaut CLI)
            names.append("cli-" + datetime.fromtimestamp(t).strftime("%Y%m%d_%H%M%S") + ".log")
            # Heure UTC (au cas où le système/CLI est en UTC)
            names.append("cli-" + datetime.fromtimestamp(t, tz=timezone.utc).strftime("%Y%m%d_%H%M%S") + ".log")
        except (OverflowError, OSError, ValueError):
            continue

        for name in names:
            p = LOG_DIR / name
            if p in seen:
                continue
            seen.add(p)
            try:
                if p.exists():
                    out.append(p)
            except OSError:
                continue

    def _safe_mtime(item: Path) -> float:
        try:
            return item.stat().st_mtime
        except OSError:
            return 0.0

    # Sort candidates by mtime descending so candidates[0] is the most recently created/written log
    out.sort(key=_safe_mtime, reverse=True)
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
            chunk, offset = await asyncio.to_thread(_read_log_chunk, log_file, offset)
        except (OSError, ValueError) as exc:
            logger.debug(f"quota_watch: lecture impossible ({log_file}): {exc}")
            continue

        for line in chunk.splitlines():
            if is_hard_quota_error(line):
                logger.warning(f"quota_watch: quota dur détecté — {line.strip()[:160]}")
                return line.strip()

    # Drain terminal : détection du quota même si le processus s'est arrêté juste après l'écriture
    if log_file is not None:
        try:
            size = log_file.stat().st_size
            if size > offset:
                chunk, _ = await asyncio.to_thread(_read_log_chunk, log_file, offset)
                for line in chunk.splitlines():
                    if is_hard_quota_error(line):
                        logger.warning(f"quota_watch: quota dur détecté (drain terminal) — {line.strip()[:160]}")
                        return line.strip()
        except Exception as drain_exc:
            logger.debug(f"quota_watch: drain terminal impossible ({log_file}): {drain_exc}")

    return None
