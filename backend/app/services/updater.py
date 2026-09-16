"""
Système de recherche de mise à jour automatique d'Antigravity WebUI.

Implémentation fidèle au principe de Hermes Agent (analyse de référence :
`hermes_cli/banner.py::check_for_updates()` + endpoint dashboard
`/api/hermes/update/check` + `hermes update`) :

- détection de la méthode d'installation (ici : git local) ;
- résultat mis en cache sur disque avec TTL de 6 h, invalidé si le commit
  installé change (équivalent du garde rev/ver de Hermes) ;
- vérification non bloquante (thread dédié au démarrage + rafraîchissement
  périodique toutes les 6 h) et ne levant jamais côté API ;
- ``force=True`` court-circuite le cache (bouton « Rechercher les mises à jour ») ;
- marqueur « mise à jour incomplète » posé pendant l'application puis retiré —
  il survit à une interruption pour signaler un état éventuellement bancal ;
- application : refus si l'arbre git est modifié, ``git pull --ff-only``,
  rebuild du frontend, rollback automatique si le build échoue, puis
  redémarrage du service (systemd sous Linux uniquement).

Tout est local à l'application : cache et marqueur vivent dans le dossier de
données d'Antigravity WebUI — aucune dépendance à Hermes.
"""
import asyncio
import json
import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from app.config import GEMINI_DIR
from app.platform_utils import IS_MACOS, IS_WINDOWS, npm_argv, platform_name

logger = logging.getLogger("antigravity.updater")

REPO_DIR = Path(__file__).resolve().parent.parent.parent.parent
CACHE_FILE = GEMINI_DIR / ".update_check"
MARKER_FILE = GEMINI_DIR / ".update_incomplete"
CURRENT_VERSION = "0.1.53"

# Principe Hermes : cache de 6 h + rafraîchissement périodique de 6 h
CACHE_DURATION_SECONDS = 6 * 3600
REFRESH_INTERVAL_SECONDS = 6 * 3600

_update_result_cache: dict[str, Any] | None = None


def _git_cmd(args: list[str], timeout: int = 10, cwd: Path | None = None) -> str | None:
    target_cwd = cwd or REPO_DIR
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    try:
        res = subprocess.run(
            ["git", *args],
            cwd=str(target_cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env
        )
        if res.returncode == 0:
            return (res.stdout or "").strip()
        logger.debug(f"git {' '.join(args)} returned {res.returncode}: {res.stderr}")
        return None
    except Exception as e:
        logger.debug(f"git {' '.join(args)} exception: {e}")
        return None


def get_local_version_info() -> dict[str, Any]:
    """Returns local git commit hash, branch, release tag, and version string."""
    sha = _git_cmd(["rev-parse", "--short=8", "HEAD"]) or "unknown"
    branch = _git_cmd(["branch", "--show-current"]) or "main"
    tag = _git_cmd(["describe", "--tags", "--abbrev=0"]) or f"v{CURRENT_VERSION}"
    commit_date = _git_cmd(["log", "-1", "--format=%cd", "--date=relative"]) or "récemment"
    commit_msg = _git_cmd(["log", "-1", "--format=%s"]) or ""

    return {
        "version": CURRENT_VERSION,
        "commit": sha,
        "branch": branch,
        "tag": tag,
        "commit_date": commit_date,
        "commit_message": commit_msg,
        "repo_path": str(REPO_DIR)
    }


def _recent_upstream_commits(n: int = 20) -> list[dict[str, Any]]:
    """
    Returns commits the local checkout is behind origin/main by, newest first.
    Replicates Hermes' git log format (%H%x1f%s%x1f%an%x1f%ct).
    """
    raw = _git_cmd(
        [
            "log",
            "--format=%H%x1f%s%x1f%an%x1f%ct",
            "HEAD..origin/main",
            f"-n{int(n)}"
        ],
        timeout=8
    )
    if not raw:
        return []

    rows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        parts = (line.split("\x1f") + ["", "", "", "0"])[:4]
        sha, summary, author, at = parts
        rows.append({
            "sha": sha[:8],
            "full_sha": sha,
            "summary": summary,
            "author": author,
            "timestamp": int(at or 0)
        })
    return rows


# ---------------------------------------------------------------------------
# Cache disque (principe Hermes : ~/.hermes/.update_check versionné par commit)
# ---------------------------------------------------------------------------

def _read_disk_cache() -> dict[str, Any] | None:
    if not CACHE_FILE.exists():
        return None
    try:
        return json.loads(CACHE_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.debug(f"Cache de mise à jour illisible: {e}")
        return None


def _write_disk_cache(payload: dict[str, Any], now: float) -> None:
    try:
        CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
        CACHE_FILE.write_text(
            json.dumps(
                {"ts": now, "commit": payload.get("current_commit"), "payload": payload},
                indent=2,
                ensure_ascii=False
            ),
            encoding="utf-8"
        )
    except Exception as e:
        logger.debug(f"Impossible d'écrire le cache de mise à jour: {e}")


def _bust_cache() -> None:
    """Invalide le cache mémoire et disque (principe Hermes : _invalidate_update_cache)."""
    global _update_result_cache
    _update_result_cache = None
    try:
        CACHE_FILE.unlink(missing_ok=True)
    except OSError as e:
        logger.debug(f"Impossible de supprimer le cache de mise à jour: {e}")


# ---------------------------------------------------------------------------
# Marqueur « mise à jour incomplète » (principe Hermes : .update-incomplete)
# ---------------------------------------------------------------------------

def _write_update_marker() -> None:
    try:
        MARKER_FILE.parent.mkdir(parents=True, exist_ok=True)
        MARKER_FILE.write_text(f"started={time.time()}\npid={os.getpid()}\n", encoding="utf-8")
    except OSError as e:
        logger.warning(f"Impossible d'écrire le marqueur de mise à jour: {e}")


def _clear_update_marker() -> None:
    try:
        MARKER_FILE.unlink(missing_ok=True)
    except OSError as e:
        logger.warning(f"Impossible de retirer le marqueur de mise à jour: {e}")


def _check_incomplete_marker() -> None:
    """Signale (une fois) qu'une mise à jour précédente a été interrompue."""
    if not MARKER_FILE.exists():
        return
    try:
        content = MARKER_FILE.read_text(encoding="utf-8").strip().replace("\n", " ")
    except OSError:
        content = ""
    logger.warning(
        f"Mise à jour précédente interrompue détectée ({content or 'sans détail'}). "
        "Vérifiez l'état du dépôt (git status / git log) — le marqueur est retiré."
    )
    _clear_update_marker()


# ---------------------------------------------------------------------------
# Vérification des mises à jour (cœur du principe Hermes)
# ---------------------------------------------------------------------------

def check_for_updates(force: bool = False) -> dict[str, Any]:
    """
    Vérifie si une mise à jour est disponible sur GitHub origin/main.

    - Cache mémoire + disque (TTL 6 h, invalidé si le commit local change).
    - ``force=True`` : refait un fetch immédiat (bouton « Rechercher »).
    - Ne lève jamais : en cas d'échec réseau, renvoie un payload explicatif.
    """
    global _update_result_cache
    now = time.time()

    if not force:
        local_sha = _git_cmd(["rev-parse", "--short=8", "HEAD"], timeout=5)

        if _update_result_cache is not None:
            age = now - _update_result_cache.get("checked_at", 0)
            if age < CACHE_DURATION_SECONDS and _update_result_cache.get("current_commit") == local_sha:
                return _update_result_cache

        cached = _read_disk_cache()
        if cached and (now - cached.get("ts", 0)) < CACHE_DURATION_SECONDS:
            cached_payload = cached.get("payload") or {}
            if cached_payload and cached.get("commit") == local_sha:
                _update_result_cache = cached_payload
                return cached_payload

    version_info = get_local_version_info()
    payload: dict[str, Any] = {
        "install_method": "git",
        "current_version": version_info["version"],
        "current_commit": version_info["commit"],
        "branch": version_info["branch"],
        "tag": version_info["tag"],
        "behind": 0,
        "update_available": False,
        "can_apply": True,
        "commits": [],
        "checked_at": now,
        "message": "Antigravity WebUI est à jour."
    }

    try:
        # 1. Fetch des dernières références du dépôt distant
        fetch_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
        fetch_res = subprocess.run(
            ["git", "fetch", "origin", "main", "--quiet"],
            cwd=str(REPO_DIR),
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
            env=fetch_env
        )

        if fetch_res.returncode != 0:
            logger.warning(f"git fetch origin main failed: {fetch_res.stderr}")
            payload["message"] = "Impossible de joindre le dépôt GitHub distant. Vérifiez la connexion réseau."
            return payload

        # 2. Nombre de commits de retard
        count_raw = _git_cmd(["rev-list", "--count", "HEAD..origin/main"], timeout=6)
        behind = int(count_raw) if count_raw and count_raw.isdigit() else 0
        payload["behind"] = behind

        if behind > 0:
            payload["update_available"] = True
            payload["message"] = f"Mise à jour disponible : {behind} nouveau(x) commit(s) sur origin/main."
            payload["commits"] = _recent_upstream_commits(n=30)
        else:
            payload["message"] = "Vous disposez de la version la plus récente."

        # 3. Cache (mémoire + disque)
        _write_disk_cache(payload, now)
        _update_result_cache = payload
        return payload

    except Exception as exc:
        logger.error(f"Error checking for updates: {exc}")
        payload["message"] = f"Erreur lors de la vérification : {exc}"
        return payload


def prefetch_update_check():
    """
    Vérification non bloquante au démarrage + rafraîchissement périodique (6 h),
    comme le cycle de cache de Hermes.
    """
    def _worker():
        try:
            _check_incomplete_marker()
            check_for_updates(force=False)
            logger.info("Background update check completed.")
        except Exception as e:
            logger.debug(f"Background update check encountered an exception: {e}")

        while True:
            time.sleep(REFRESH_INTERVAL_SECONDS)
            try:
                check_for_updates(force=True)
                logger.info("Periodic update check refreshed.")
            except Exception as e:
                logger.debug(f"Periodic update check failed: {e}")

    t = threading.Thread(target=_worker, daemon=True, name="antigravity_update_prefetch")
    t.start()


# ---------------------------------------------------------------------------
# Application de la mise à jour (principe Hermes : pull sûr + rollback)
# ---------------------------------------------------------------------------

async def apply_update() -> dict[str, Any]:
    """
    Applique la mise à jour : pull fast-forward, rebuild frontend,
    rollback automatique si le build échoue, puis redémarrage du service.
    """
    logger.info("Applying Antigravity WebUI update from origin/main...")

    # 0. Marqueur anti-interruption
    _write_update_marker()

    # 1. Refus si l'arbre git contient des modifications locales
    dirty = _git_cmd(["status", "--porcelain", "--untracked-files=no"], timeout=10)
    if dirty:
        _clear_update_marker()
        logger.warning("Update refused: dirty worktree.")
        return {
            "ok": False,
            "error": "dirty_worktree",
            "message": "Des modifications locales non commitées bloquent la mise à jour. Committez-les d'abord (aucun changement appliqué)."
        }

    prev_sha = _git_cmd(["rev-parse", "HEAD"], timeout=6)

    # 2. Pull fast-forward uniquement (pas de merge surprise)
    git_env = {**os.environ, "GIT_TERMINAL_PROMPT": "0"}
    pull_proc = await asyncio.create_subprocess_exec(
        "git", "pull", "--ff-only", "origin", "main",
        cwd=str(REPO_DIR),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=git_env
    )
    stdout, stderr = await pull_proc.communicate()
    if pull_proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip()
        _clear_update_marker()
        logger.error(f"git pull --ff-only failed: {err_msg}")
        return {
            "ok": False,
            "error": "git_pull_failed",
            "message": f"Échec lors de la récupération Git : {err_msg}"
        }

    pull_output = stdout.decode(errors="replace").strip()
    logger.info(f"git pull success: {pull_output}")

    # 3. Rebuild du frontend
    frontend_dir = REPO_DIR / "frontend"
    build_ok = True
    build_output = ""
    if frontend_dir.exists() and (frontend_dir / "package.json").exists():
        try:
            build_proc = await asyncio.create_subprocess_exec(
                *npm_argv("run", "build"),
                cwd=str(frontend_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=os.environ
            )
            _b_out, b_err = await asyncio.wait_for(build_proc.communicate(), timeout=300.0)
            if build_proc.returncode != 0:
                build_ok = False
                build_output = b_err.decode(errors="replace").strip()
                logger.warning(f"Frontend build failed after update: {build_output}")
            else:
                build_output = "Frontend compilé avec succès."
        except Exception as e:
            build_ok = False
            build_output = str(e)
            logger.warning(f"Frontend build error after update: {e}")

    # 3b. Rollback automatique si le build échoue (ne pas laisser un état bancal)
    if not build_ok and prev_sha:
        logger.warning(f"Build en échec après mise à jour — rollback vers {prev_sha[:8]}...")
        rollback = await asyncio.to_thread(
            subprocess.run,
            ["git", "reset", "--keep", prev_sha],
            cwd=str(REPO_DIR), capture_output=True, text=True, timeout=20, check=False,
            env=git_env
        )
        rolled = rollback.returncode == 0
        if not rolled:
            logger.error(f"Rollback --keep impossible ({rollback.stderr.strip()}), tentative --hard...")
            hard = await asyncio.to_thread(
                subprocess.run,
                ["git", "reset", "--hard", prev_sha],
                cwd=str(REPO_DIR), capture_output=True, text=True, timeout=20, check=False,
                env=git_env
            )
            rolled = hard.returncode == 0

        if rolled:
            try:
                rb = await asyncio.to_thread(
                    subprocess.run,
                    npm_argv("run", "build"), cwd=str(frontend_dir), capture_output=True, timeout=120, check=False,
                    env=os.environ
                )
                hint = "frontend restauré" if rb.returncode == 0 else "relancez un build manuellement"
            except Exception:
                hint = "relancez un build manuellement"
            _clear_update_marker()
            return {
                "ok": False,
                "error": "build_failed_rolled_back",
                "message": f"Build frontend en échec — mise à jour annulée et code restauré ({hint}). Détail : {build_output[:300]}"
            }

        _clear_update_marker()
        return {
            "ok": False,
            "error": "build_failed",
            "message": f"Build frontend en échec et rollback impossible — intervention manuelle requise. Détail : {build_output[:300]}"
        }

    # 4. Succès : invalider le cache et retirer le marqueur
    _bust_cache()
    _clear_update_marker()

    # 5. Redémarrage automatique du service (systemd sous Linux uniquement)
    if IS_WINDOWS or IS_MACOS:
        logger.info(
            f"{platform_name()} : redémarrage automatique du service non pris en charge — "
            "relancez le script de démarrage après la mise à jour."
        )
    else:
        async def _restart_service_soon():
            await asyncio.sleep(1.5)
            if shutil.which("systemctl"):
                logger.info("Executing graceful systemctl restart antigravity-webui...")
                try:
                    await asyncio.to_thread(
                        subprocess.run, ["systemctl", "--no-block", "restart", "antigravity-webui"], check=False
                    )
                except Exception as e:
                    logger.error(f"Service restart trigger error: {e}")
            else:
                logger.info("systemctl not found; skipping automatic service restart.")

        asyncio.create_task(_restart_service_soon())

    if IS_WINDOWS:
        restart_hint = "Relancez start.bat pour redémarrer le serveur."
    elif IS_MACOS:
        restart_hint = "Relancez start.sh (ou votre service launchd) pour redémarrer le serveur."
    else:
        restart_hint = "Le service WebUI redémarre..."

    return {
        "ok": True,
        "message": f"Mise à jour appliquée avec succès ! {restart_hint}",
        "pull_output": pull_output,
        "frontend_rebuilt": build_ok,
        "build_output": build_output,
        "version_info": get_local_version_info()
    }
