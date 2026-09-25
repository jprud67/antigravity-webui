"""System Doctor and Diagnostics Service for Antigravity WebUI.

Directly adapted from OpenClaw (src/commands/doctor.ts, src/plugin-sdk/runtime-doctor.ts)
and Hermes Agent (tools/computer_use/doctor.py).
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
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional
import httpx
import psutil

from app.services.fts_search import get_fts_stats, reindex_all_conversations

logger = logging.getLogger(__name__)

DB_PATH = Path(__file__).resolve().parent.parent.parent / "sessions.db"
WORKSPACE_DIR = Path(__file__).resolve().parent.parent.parent.parent

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
    if not DB_PATH.exists():
        return {"status": "missing", "size_mb": 0, "integrity": "missing"}
    size_mb = round(DB_PATH.stat().st_size / (1024 * 1024), 2)
    try:
        with sqlite3.connect(str(DB_PATH)) as conn:
            cursor = conn.cursor()
            cursor.execute("PRAGMA integrity_check;")
            row = cursor.fetchone()
            check_result = row[0] if row else "unknown"
            return {
                "status": "ok" if check_result == "ok" else "corrupted",
                "size_mb": size_mb,
                "integrity": check_result
            }
    except Exception as e:
        return {
            "status": "error",
            "size_mb": size_mb,
            "integrity": str(e)
        }


def _check_git_status() -> dict[str, Any]:
    git_bin = shutil.which("git")
    if not git_bin:
        return {"installed": False, "branch": None, "dirty_files": 0}
    
    branch = None
    dirty_count = 0
    try:
        import subprocess
        res = subprocess.run(["git", "branch", "--show-current"], cwd=str(WORKSPACE_DIR), capture_output=True, text=True, timeout=2)
        if res.returncode == 0:
            branch = res.stdout.strip()
        
        status_res = subprocess.run(["git", "status", "--porcelain"], cwd=str(WORKSPACE_DIR), capture_output=True, text=True, timeout=2)
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


async def run_system_diagnostics() -> dict[str, Any]:
    """Runs a complete system health scan."""
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

    # Python & Git
    python_data = {
        "version": platform.python_version(),
        "executable": sys.executable,
        "is_venv": hasattr(sys, "real_prefix") or (hasattr(sys, "base_prefix") and sys.base_prefix != sys.prefix)
    }
    git_data = _check_git_status()

    # Database & FTS
    sqlite_data = _check_sqlite_integrity()
    try:
        fts_stats = get_fts_stats()
    except Exception:
        fts_stats = {"total_indexed_rows": 0, "indexed_sessions": 0, "engine": "unavailable"}

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
            "disk": disk_data
        },
        "runtimes": {
            "python": python_data,
            "git": git_data
        },
        "database": {
            **sqlite_data,
            "fts5": fts_stats
        },
        "llm_connectivity": llm_results,
        "anomalies": anomalies
    }


async def run_auto_repair() -> dict[str, Any]:
    """Performs automated maintenance and repair operations."""
    repaired_actions: list[str] = []

    # 1. Vacuum SQLite
    if DB_PATH.exists():
        try:
            with sqlite3.connect(str(DB_PATH)) as conn:
                conn.execute("VACUUM;")
                conn.execute("ANALYZE;")
                conn.execute("PRAGMA optimize;")
                conn.commit()
            repaired_actions.append("Optimisation et compactage de la base de données SQLite (VACUUM & ANALYZE)")
        except Exception as e:
            logger.warning(f"Failed to vacuum SQLite: {e}")

    # 2. Re-index FTS
    try:
        reindex_res = reindex_all_conversations()
        repaired_actions.append(f"Réindexation complète du moteur FTS5 ({reindex_res.get('total_messages_indexed', 0)} messages)")
    except Exception as e:
        logger.warning(f"Failed to reindex FTS during doctor repair: {e}")

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

    # 4. Re-run diagnostics
    post_diag = await run_system_diagnostics()

    return {
        "success": True,
        "actions_taken": repaired_actions,
        "post_repair_diagnostics": post_diag
    }
