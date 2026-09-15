import os
import json
import time
import logging
import asyncio
import subprocess
import threading
from pathlib import Path
from typing import Dict, Any, List, Optional
from app.config import HOME

logger = logging.getLogger("antigravity.updater")

REPO_DIR = Path(__file__).resolve().parent.parent.parent.parent
CACHE_FILE = HOME / ".gemini" / "antigravity_update_cache.json"
CURRENT_VERSION = "0.1.0"
CACHE_DURATION_SECONDS = 3600  # 1 hour cache to avoid unnecessary network queries

_update_result_cache: Optional[Dict[str, Any]] = None
_prefetch_thread: Optional[threading.Thread] = None


def _git_cmd(args: List[str], timeout: int = 10, cwd: Optional[Path] = None) -> Optional[str]:
    target_cwd = cwd or REPO_DIR
    try:
        res = subprocess.run(
            ["git", *args],
            cwd=str(target_cwd),
            capture_output=True,
            text=True,
            timeout=timeout
        )
        if res.returncode == 0:
            return (res.stdout or "").strip()
        logger.debug(f"git {' '.join(args)} returned {res.returncode}: {res.stderr}")
        return None
    except Exception as e:
        logger.debug(f"git {' '.join(args)} exception: {e}")
        return None


def get_local_version_info() -> Dict[str, Any]:
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


def _recent_upstream_commits(n: int = 20) -> List[Dict[str, Any]]:
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

    rows: List[Dict[str, Any]] = []
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


def check_for_updates(force: bool = False) -> Dict[str, Any]:
    """
    Checks whether a new Antigravity WebUI update is available on GitHub origin/main.
    Implements Hermes' robust caching and git inspection architecture.
    """
    global _update_result_cache
    now = time.time()

    # Read from cache file if not forced
    if not force:
        if _update_result_cache and (now - _update_result_cache.get("checked_at", 0)) < CACHE_DURATION_SECONDS:
            return _update_result_cache

        if CACHE_FILE.exists():
            try:
                cached = json.loads(CACHE_FILE.read_text(encoding="utf-8"))
                if (now - cached.get("checked_at", 0)) < CACHE_DURATION_SECONDS:
                    _update_result_cache = cached
                    return cached
            except Exception:
                pass

    version_info = get_local_version_info()
    payload: Dict[str, Any] = {
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
        # 1. Fetch latest refs from remote
        fetch_res = subprocess.run(
            ["git", "fetch", "origin", "main", "--quiet"],
            cwd=str(REPO_DIR),
            capture_output=True,
            text=True,
            timeout=15
        )

        if fetch_res.returncode != 0:
            logger.warning(f"git fetch origin main failed: {fetch_res.stderr}")
            payload["message"] = "Impossible de joindre le dépôt GitHub distant. Vérifiez la connexion réseau."
            return payload

        # 2. Count commits behind
        count_raw = _git_cmd(["rev-list", "--count", "HEAD..origin/main"], timeout=6)
        behind = int(count_raw) if count_raw and count_raw.isdigit() else 0
        payload["behind"] = behind

        if behind > 0:
            payload["update_available"] = True
            payload["message"] = f"Mise à jour disponible : {behind} nouveau(x) commit(s) sur origin/main."
            payload["commits"] = _recent_upstream_commits(n=30)
        else:
            payload["message"] = "Vous disposez de la version la plus récente."

        # Write cache
        try:
            CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
            CACHE_FILE.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
            _update_result_cache = payload
        except Exception as e:
            logger.debug(f"Failed to write update cache file: {e}")

        return payload

    except Exception as exc:
        logger.error(f"Error checking for updates: {exc}")
        payload["message"] = f"Erreur lors de la vérification : {exc}"
        return payload


def prefetch_update_check():
    """Starts a non-blocking background update check upon server startup (Hermes pattern)."""
    def _worker():
        try:
            check_for_updates(force=False)
            logger.info("Background update check completed.")
        except Exception as e:
            logger.debug(f"Background update check encountered an exception: {e}")

    t = threading.Thread(target=_worker, daemon=True, name="antigravity_update_prefetch")
    t.start()


async def apply_update() -> Dict[str, Any]:
    """
    Applies the update by pulling the latest commits from origin/main,
    rebuilding the frontend if necessary, and triggering a clean service restart.
    """
    logger.info("Applying Antigravity WebUI update from origin/main...")

    # 1. Pull origin/main
    pull_proc = await asyncio.create_subprocess_exec(
        "git", "pull", "origin", "main",
        cwd=str(REPO_DIR),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    stdout, stderr = await pull_proc.communicate()
    if pull_proc.returncode != 0:
        err_msg = stderr.decode(errors="replace").strip()
        logger.error(f"git pull failed: {err_msg}")
        return {
            "ok": False,
            "error": "git_pull_failed",
            "message": f"Échec lors de la récupération des modifications Git: {err_msg}"
        }

    pull_output = stdout.decode(errors="replace").strip()
    logger.info(f"git pull success: {pull_output}")

    # Invalidate cache
    try:
        CACHE_FILE.unlink(missing_ok=True)
    except Exception:
        pass

    # 2. Rebuild frontend if dist or src was affected
    frontend_dir = REPO_DIR / "frontend"
    build_success = True
    build_output = ""
    if frontend_dir.exists() and (frontend_dir / "package.json").exists():
        try:
            build_proc = await asyncio.create_subprocess_exec(
                "npm", "run", "build",
                cwd=str(frontend_dir),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE
            )
            b_out, b_err = await asyncio.wait_for(build_proc.communicate(), timeout=90.0)
            if build_proc.returncode != 0:
                build_success = False
                build_output = b_err.decode(errors="replace").strip()
                logger.warning(f"Frontend build warning after update: {build_output}")
            else:
                build_output = "Frontend compilé avec succès."
        except Exception as e:
            build_success = False
            build_output = str(e)
            logger.warning(f"Frontend build error after update: {e}")

    # 3. Schedule background restart of systemd service
    async def _restart_service_soon():
        await asyncio.sleep(1.5)
        logger.info("Executing graceful systemctl restart antigravity-webui...")
        try:
            subprocess.run(["systemctl", "restart", "antigravity-webui"], check=False)
        except Exception as e:
            logger.error(f"Service restart trigger error: {e}")

    asyncio.create_task(_restart_service_soon())

    return {
        "ok": True,
        "message": "Mise à jour appliquée avec succès ! Le service WebUI redémarre...",
        "pull_output": pull_output,
        "frontend_rebuilt": build_success,
        "build_output": build_output,
        "version_info": get_local_version_info()
    }
