"""System Doctor and Diagnostics Service for Antigravity WebUI.

Directly adapted from Antigravity Core (src/commands/doctor.ts, src/plugin-sdk/runtime-doctor.ts)
and Agent Antigravity (tools/computer_use/doctor.py).
Provides full-stack health monitoring (RAM, CPU, disk, SQLite integrity, Git, LLM latency)
and one-click automated repairs (Auto-Doctor).
"""

from __future__ import annotations

import asyncio
import logging
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import httpx
import psutil

from app.config import CONVERSATION_DB, REPO_ROOT, SESSIONS_DB
from app.services.fts_search import (
    fts_service,
    get_fts_stats,
    reindex_all_conversations,
    sync_fts_conversations,
)

__all__ = [
    "reindex_all_conversations",
    "run_auto_repair",
    "run_system_diagnostics",
]

logger = logging.getLogger(__name__)

DB_PATH = SESSIONS_DB
WORKSPACE_DIR = REPO_ROOT


LLM_PROBES = [
    {"name": "Google Gemini", "url": "https://generativelanguage.googleapis.com", "provider": "google"},
    {"name": "OpenAI", "url": "https://api.openai.com/v1/models", "provider": "openai"},
    {"name": "Anthropic", "url": "https://api.anthropic.com/v1/messages", "provider": "anthropic"},
    {"name": "OpenRouter", "url": "https://openrouter.ai/api/v1/models", "provider": "openrouter"},
]


async def _probe_endpoint(probe: dict[str, str], timeout_s: float = 3.5) -> dict[str, Any]:
    name = probe["name"]
    url = probe["url"]
    provider = probe["provider"]
    if os.environ.get("ANTIGRAVITY_TESTING") == "1":
        return {
            "name": name,
            "provider": provider,
            "url": url,
            "status": "online",
            "status_code": 200,
            "latency_ms": 1.0,
            "error": None
        }
    start = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_s, follow_redirects=True) as client:
            resp = await client.head(url)
            latency = round((time.perf_counter() - start) * 1000, 1)
            # HTTP status codes like 200, 401, 403, 404, 405 indicate the endpoint is alive and reached
            is_alive = resp.status_code in (200, 204, 400, 401, 403, 404, 405)
            return {
                "name": name,
                "provider": provider,
                "url": url,
                "status": "online" if is_alive else "degraded",
                "status_code": resp.status_code,
                "latency_ms": latency,
                "error": None
            }
    except Exception as e:
        latency = round((time.perf_counter() - start) * 1000, 1)
        return {
            "name": name,
            "provider": provider,
            "url": url,
            "status": "offline",
            "status_code": 0,
            "latency_ms": latency,
            "error": str(e)
        }


def _check_sqlite_integrity() -> dict[str, Any]:
    db_paths = [("sessions.db", DB_PATH), ("conversation_summaries.db", CONVERSATION_DB)]
    total_size_mb = 0.0
    statuses = []
    integrities = []
    journal_modes: dict[str, str] = {}
    latencies: list[float] = []

    for db_name, p in db_paths:
        if not p.exists():
            continue
        conn = None
        try:
            size_mb = round(p.stat().st_size / (1024 * 1024), 2)
            wal_p = p.with_name(p.name + "-wal")
            if wal_p.exists():
                size_mb += round(wal_p.stat().st_size / (1024 * 1024), 2)
            total_size_mb += size_mb

            t0 = time.perf_counter()
            conn = sqlite3.connect(str(p), timeout=10.0)
            cursor = conn.cursor()
            cursor.execute("SELECT 1;")
            cursor.fetchone()
            latencies.append((time.perf_counter() - t0) * 1000)

            cursor.execute("PRAGMA journal_mode;")
            jm_row = cursor.fetchone()
            jm = jm_row[0].lower() if jm_row else "unknown"
            journal_modes[db_name] = jm

            cursor.execute("PRAGMA integrity_check;")
            row = cursor.fetchone()
            check_result = row[0] if row else "unknown"
            statuses.append("ok" if check_result == "ok" else "corrupted")
            integrities.append(f"{db_name}: {check_result}")
        except Exception as e:
            statuses.append("error")
            integrities.append(f"{db_name}: {e}")
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception as close_err:
                    logger.debug("Failed to close SQLite diagnostic connection: %s", close_err)

    if not statuses:
        return {
            "status": "missing",
            "size_mb": 0,
            "integrity": "missing",
            "wal_mode": False,
            "journal_modes": {},
            "query_latency_ms": 0.0,
        }

    overall_status = "ok" if all(s == "ok" for s in statuses) else ("error" if "error" in statuses else "corrupted")
    wal_active = bool(journal_modes and all(jm == "wal" for jm in journal_modes.values()))
    avg_latency = round(sum(latencies) / len(latencies), 2) if latencies else 0.0

    return {
        "status": overall_status,
        "size_mb": round(total_size_mb, 2),
        "integrity": "; ".join(integrities),
        "wal_mode": wal_active,
        "journal_modes": journal_modes,
        "query_latency_ms": avg_latency,
    }


def _check_git_status() -> dict[str, Any]:
    git_bin = shutil.which("git")
    if not git_bin:
        return {"installed": False, "branch": None, "dirty_files": 0}

    branch = None
    dirty_count = 0
    try:
        res = subprocess.run([git_bin, "branch", "--show-current"], cwd=str(WORKSPACE_DIR), capture_output=True, text=True, timeout=2)
        if res.returncode == 0:
            branch = res.stdout.strip()

        status_res = subprocess.run([git_bin, "status", "--porcelain"], cwd=str(WORKSPACE_DIR), capture_output=True, text=True, timeout=2)
        if status_res.returncode == 0:
            lines = [l for l in status_res.stdout.splitlines() if l.strip()]
            dirty_count = len(lines)
    except Exception:
        pass

    return {
        "installed": True,
        "path": git_bin,
        "branch": branch or "main",
        "dirty_files": dirty_count
    }


def _check_agy_status() -> dict[str, Any]:
    agy_path = shutil.which("agy")
    if not agy_path:
        candidate = Path.home() / ".local" / "bin" / "agy"
        if candidate.exists() and os.access(candidate, os.X_OK):
            agy_path = str(candidate)

    if not agy_path:
        return {"installed": False, "version": None, "path": None}

    version = None
    try:
        res = subprocess.run([agy_path, "--version"], capture_output=True, text=True, timeout=3)
        if res.returncode == 0:
            version = res.stdout.strip() or res.stderr.strip()
    except Exception:
        pass

    return {
        "installed": True,
        "version": version or "détecté",
        "path": agy_path
    }


def _check_node_status() -> dict[str, Any]:
    node_path = shutil.which("node")
    if not node_path:
        return {"installed": False, "version": None, "npm_version": None, "path": None}

    version = None
    npm_version = None
    try:
        res = subprocess.run([node_path, "--version"], capture_output=True, text=True, timeout=3)
        if res.returncode == 0:
            version = res.stdout.strip()
    except Exception:
        pass

    npm_path = shutil.which("npm")
    if npm_path:
        try:
            res_npm = subprocess.run([npm_path, "--version"], capture_output=True, text=True, timeout=3)
            if res_npm.returncode == 0:
                npm_version = res_npm.stdout.strip()
        except Exception:
            pass

    return {
        "installed": True,
        "version": version,
        "npm_version": npm_version,
        "path": node_path
    }


def _check_docker_status() -> dict[str, Any]:
    try:
        from app.services.docker_studio import get_docker_status
        st = get_docker_status()
        return {
            "available": bool(st.is_available),
            "engine": st.engine if st.engine != "none" else None,
            "version": st.version,
            "running_containers": st.running_count
        }
    except Exception:
        return {
            "available": False,
            "engine": None,
            "version": None,
            "running_containers": 0
        }


def _check_watchdog_status() -> dict[str, Any]:
    try:
        from app.services.watchdog_sentinel import get_alerts, get_watchdog_status
        ws = get_watchdog_status()
        unresolved = get_alerts(unresolved_only=True)
        return {
            "running": bool(ws.get("running", False)),
            "unresolved_alerts": len(unresolved),
            "total_alerts": int(ws.get("total_alerts", 0))
        }
    except Exception:
        return {
            "running": False,
            "unresolved_alerts": 0,
            "total_alerts": 0
        }


def _get_process_metrics() -> dict[str, Any]:
    try:
        proc = psutil.Process(os.getpid())
        create_t = proc.create_time()
        uptime_s = round(time.time() - create_t, 1)

        days, rem = divmod(int(uptime_s), 86400)
        hours, rem = divmod(rem, 3600)
        minutes, seconds = divmod(rem, 60)
        if days > 0:
            uptime_fmt = f"{days}j {hours}h {minutes}m"
        elif hours > 0:
            uptime_fmt = f"{hours}h {minutes}m"
        elif minutes > 0:
            uptime_fmt = f"{minutes}m {seconds}s"
        else:
            uptime_fmt = f"{seconds}s"

        rss_mb = round(proc.memory_info().rss / (1024 * 1024), 2)
        threads = proc.num_threads()
    except Exception:
        uptime_s = 0.0
        uptime_fmt = "inconnu"
        rss_mb = 0.0
        threads = 1

    try:
        from app.services.execution_manager import execution_manager
        from app.services.fs_watcher import get_subscribers
        active_sessions = len(execution_manager.sessions)
        running_sessions = len(execution_manager.get_running_conversations())
        connected_websockets = len(execution_manager.connected_sockets)
        sse_subscribers = len(get_subscribers())
    except Exception:
        active_sessions = 0
        running_sessions = 0
        connected_websockets = 0
        sse_subscribers = 0

    return {
        "uptime_seconds": uptime_s,
        "uptime_formatted": uptime_fmt,
        "memory_rss_mb": rss_mb,
        "threads_count": threads,
        "active_sessions": active_sessions,
        "running_sessions": running_sessions,
        "connected_websockets": connected_websockets,
        "sse_subscribers": sse_subscribers
    }


async def run_system_diagnostics() -> dict[str, Any]:
    """Runs a complete system health scan."""
    # Process & Server Uptime
    process_metrics = _get_process_metrics()

    # RAM & CPU
    mem = psutil.virtual_memory()
    ram_data = {
        "total_gb": round(mem.total / (1024**3), 2),
        "available_gb": round(mem.available / (1024**3), 2),
        "used_gb": round(mem.used / (1024**3), 2),
        "percent": mem.percent
    }
    cpu_percent = psutil.cpu_percent(interval=None)

    # Disk
    disk = shutil.disk_usage(str(WORKSPACE_DIR))
    disk_data = {
        "total_gb": round(disk.total / (1024**3), 2),
        "free_gb": round(disk.free / (1024**3), 2),
        "used_percent": round(((disk.total - disk.free) / disk.total) * 100, 1)
    }

    # Python, Git, and Ecosystem Runtimes
    python_data = {
        "version": platform.python_version(),
        "executable": sys.executable,
        "is_venv": hasattr(sys, "real_prefix") or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)
    }
    git_data = _check_git_status()
    agy_data = _check_agy_status()
    node_data = _check_node_status()
    docker_data = _check_docker_status()

    # Database & FTS
    sqlite_data = _check_sqlite_integrity()
    try:
        fts_stats = get_fts_stats()
    except Exception:
        fts_stats = {"total_indexed_rows": 0, "indexed_sessions": 0, "engine": "unavailable"}

    # Security Watchdog
    watchdog_data = _check_watchdog_status()

    # Probe LLM endpoints concurrently
    probe_tasks = [_probe_endpoint(p) for p in LLM_PROBES]
    llm_results = await asyncio.gather(*probe_tasks)

    # Calculate overall health status and anomalies
    anomalies: list[dict[str, str]] = []
    if ram_data["percent"] > 95:
        anomalies.append({"level": "warning", "message": f"Utilisation de la RAM très élevée ({ram_data['percent']}%)"})
    if disk_data["free_gb"] < 5.0:
        anomalies.append({"level": "warning", "message": f"Espace disque critique ({disk_data['free_gb']} Go restants)"})
    if sqlite_data["status"] != "ok":
        anomalies.append({"level": "error", "message": f"Anomalie intégrité SQLite : {sqlite_data['integrity']}"})

    if watchdog_data.get("unresolved_alerts", 0) > 0:
        anomalies.append({
            "level": "warning",
            "message": f"Sentinelle de Sécurité : {watchdog_data['unresolved_alerts']} alerte(s) en attente de traitement"
        })

    offline_llms = [p["name"] for p in llm_results if p["status"] == "offline"]
    if offline_llms:
        anomalies.append({"level": "warning", "message": f"Points de terminaison LLM inaccessibles : {', '.join(offline_llms)}"})

    health_status = "healthy"
    if any(a["level"] == "error" for a in anomalies):
        health_status = "critical"
    elif anomalies:
        health_status = "warning"

    return {
        "health_status": health_status,
        "timestamp": time.time(),
        "system": {
            "platform": platform.platform(),
            "cpu_cores": psutil.cpu_count(logical=True),
            "cpu_percent": cpu_percent,
            "ram": ram_data,
            "disk": disk_data,
            "process": process_metrics,
        },
        "runtimes": {
            "python": python_data,
            "git": git_data,
            "agy": agy_data,
            "node": node_data,
            "docker": docker_data,
        },
        "database": {
            **sqlite_data,
            "fts5": fts_stats
        },
        "security_watchdog": watchdog_data,
        "llm_connectivity": llm_results,
        "anomalies": anomalies
    }


async def run_auto_repair() -> dict[str, Any]:
    """Performs automated maintenance and repair operations."""
    repaired_actions: list[str] = []

    # 1. Vacuum, WAL checkpoint and optimize SQLite databases
    target_dbs = [("sessions.db", DB_PATH), ("conversation_summaries.db", CONVERSATION_DB)]
    vacuumed = []
    for db_name, p in target_dbs:
        if p.exists():
            conn = None
            try:
                conn = sqlite3.connect(str(p), timeout=15.0, isolation_level=None)
                conn.execute("PRAGMA journal_mode=WAL;")
                conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
                conn.execute("VACUUM;")
                conn.execute("ANALYZE;")
                conn.execute("PRAGMA optimize;")
                vacuumed.append(db_name)
            except Exception as e:
                logger.warning(f"Failed to vacuum/optimize {db_name}: {e}")
            finally:
                if conn is not None:
                    try:
                        conn.close()
                    except Exception as close_err:
                        logger.debug("Failed to close vacuum connection: %s", close_err)
    if vacuumed:
        repaired_actions.append(f"Optimisation, synchronisation WAL et compactage des bases SQLite ({', '.join(vacuumed)}) (VACUUM & ANALYZE)")

    # 2. Sync and optimize FTS
    try:
        sync_res = sync_fts_conversations()
        fts_service.optimize()
        repaired_actions.append(f"Optimisation et synchronisation du moteur FTS5 ({sync_res.get('total_messages_indexed', 0)} messages)")
    except Exception as e:
        logger.warning(f"Failed to sync/optimize FTS during doctor repair: {e}")

    # 3. Clean temporary scratch files
    scratch_dir = WORKSPACE_DIR / "backend" / "app" / "scratch"
    if scratch_dir.exists():
        try:
            cleaned = 0
            for item in scratch_dir.iterdir():
                if item.is_file() and (time.time() - item.stat().st_mtime) > 86400:
                    item.unlink()
                    cleaned += 1
            if cleaned > 0:
                repaired_actions.append(f"Nettoyage de {cleaned} fichier(s) temporaire(s) orphelin(s)")
        except Exception:
            pass

    # 4. Proactive orphan session and process reaping
    try:
        from app.services.execution_manager import execution_manager
        reap_stats = await execution_manager.reap_orphaned_and_idle_sessions(max_idle_seconds=1800.0, max_orphan_seconds=3600.0)
        reaped_count = reap_stats.get("reaped_zombies", 0) + reap_stats.get("reaped_orphans", 0) + reap_stats.get("pruned_idle", 0)
        if reaped_count > 0:
            repaired_actions.append(
                f"Assainissement des sessions d'exécution ({reap_stats.get('reaped_zombies', 0)} zombie(s), "
                f"{reap_stats.get('reaped_orphans', 0)} orphelin(s), {reap_stats.get('pruned_idle', 0)} inactive(s))"
            )
    except Exception as e:
        logger.debug(f"Doctor auto-repair session reaping failed: {e}")

    # 5. Re-run diagnostics
    post_diag = await run_system_diagnostics()

    return {
        "success": True,
        "actions_taken": repaired_actions,
        "post_repair_diagnostics": post_diag
    }
