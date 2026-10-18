"""Self-Healing Watchdog Sentinel — Antigravity WebUI v0.5.0

Background sentinel that monitors workspace build integrity, lint status,
and test suite health. Generates proactive patch suggestions when issues
are detected.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger("antigravity.watchdog")

# Singleton sentinel task reference
_watchdog_task: asyncio.Task | None = None
_watchdog_running: bool = False

# In-memory alert log (ring buffer, max 100)
_alert_log: list[dict[str, Any]] = []
MAX_ALERTS = 100


def ensure_watchdog_schema() -> None:
    try:
        import sqlite3

        from app.config import CONVERSATION_DB
        with sqlite3.connect(str(CONVERSATION_DB), timeout=15.0) as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS watchdog_alerts (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    message TEXT NOT NULL,
                    workspace TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    resolved INTEGER NOT NULL DEFAULT 0
                )
            """)
            conn.commit()
    except Exception as exc:
        logger.debug("Failed ensuring watchdog schema: %s", exc)


def _add_alert(category: str, severity: str, message: str, workspace: str = "") -> dict[str, Any]:
    ensure_watchdog_schema()
    import datetime
    entry = {
        "id": f"alert_{int(time.time() * 1000)}",
        "category": category,
        "severity": severity,  # "info" | "warning" | "error"
        "message": message,
        "workspace": workspace,
        "timestamp": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "resolved": False,
    }
    _alert_log.append(entry)
    if len(_alert_log) > MAX_ALERTS:
        _alert_log.pop(0)

    try:
        import sqlite3

        from app.config import CONVERSATION_DB
        with sqlite3.connect(str(CONVERSATION_DB), timeout=15.0) as conn:
            conn.execute(
                "INSERT OR REPLACE INTO watchdog_alerts (id, category, severity, message, workspace, timestamp, resolved) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (entry["id"], category, severity, message, workspace, entry["timestamp"], 0),
            )
            conn.commit()
    except Exception as exc:
        logger.debug("Failed persisting watchdog alert to DB: %s", exc)

    return entry


def get_alerts(workspace: str | None = None, unresolved_only: bool = True) -> list[dict[str, Any]]:
    """Return watchdog alerts, optionally filtered."""
    if not _alert_log:
        try:
            ensure_watchdog_schema()
            import sqlite3

            from app.config import CONVERSATION_DB
            with sqlite3.connect(str(CONVERSATION_DB), timeout=15.0) as conn:
                rows = conn.execute(
                    "SELECT id, category, severity, message, workspace, timestamp, resolved FROM watchdog_alerts ORDER BY timestamp DESC LIMIT 100"
                ).fetchall()
                for r in reversed(rows):
                    _alert_log.append({
                        "id": r[0],
                        "category": r[1],
                        "severity": r[2],
                        "message": r[3],
                        "workspace": r[4],
                        "timestamp": r[5],
                        "resolved": bool(r[6]),
                    })
        except Exception as exc:
            logger.debug("Failed loading watchdog alerts from DB: %s", exc)

    alerts = _alert_log
    if workspace:
        alerts = [a for a in alerts if a["workspace"] == workspace]
    if unresolved_only:
        alerts = [a for a in alerts if not a["resolved"]]
    return list(reversed(alerts))  # newest first


def resolve_alert(alert_id: str) -> bool:
    found = False
    for a in _alert_log:
        if a["id"] == alert_id:
            a["resolved"] = True
            found = True
            break
    try:
        import sqlite3

        from app.config import CONVERSATION_DB
        with sqlite3.connect(str(CONVERSATION_DB), timeout=15.0) as conn:
            cur = conn.execute("UPDATE watchdog_alerts SET resolved = 1 WHERE id = ?", (alert_id,))
            conn.commit()
            if cur.rowcount > 0:
                found = True
    except Exception as exc:
        logger.debug("Failed resolving watchdog alert in DB: %s", exc)
    return found


def clear_alerts(workspace: str | None = None) -> int:
    global _alert_log
    if workspace:
        before = len(_alert_log)
        _alert_log = [a for a in _alert_log if a["workspace"] != workspace]
        deleted = before - len(_alert_log)
    else:
        deleted = len(_alert_log)
        _alert_log = []

    try:
        import sqlite3

        from app.config import CONVERSATION_DB
        with sqlite3.connect(str(CONVERSATION_DB), timeout=15.0) as conn:
            if workspace:
                conn.execute("DELETE FROM watchdog_alerts WHERE workspace = ?", (workspace,))
            else:
                conn.execute("DELETE FROM watchdog_alerts")
            conn.commit()
    except Exception as exc:
        logger.debug("Failed clearing watchdog alerts in DB: %s", exc)

    return deleted


def _run_cmd(cmd: list[str], cwd: str, timeout: int = 60) -> tuple[int, str]:
    """Run a command, return (returncode, combined output)."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.returncode, (result.stdout + result.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, f"Command timeout after {timeout}s"
    except FileNotFoundError:
        return -1, f"Command not found: {cmd[0]}"
    except Exception as e:
        return -1, str(e)


def run_watchdog_scan(workspace_path: str) -> dict[str, Any]:
    """Run a single watchdog scan on a workspace path.

    Checks: tsc type errors, oxlint warnings, pytest failures.
    Returns a summary dict with issues found.
    """
    ws = Path(workspace_path)
    issues: list[dict[str, Any]] = []

    # 1. TypeScript type check
    ts_config = ws / "frontend" / "tsconfig.json"
    if ts_config.exists():
        rc, out = _run_cmd(["npx", "tsc", "-b", "--noEmit"], str(ws / "frontend"), timeout=90)
        if rc != 0:
            msg = f"TypeScript errors detected:\n{out[:500]}"
            issues.append({"type": "ts_error", "severity": "error", "detail": msg})
            _add_alert("typescript", "error", msg, workspace_path)
            logger.warning("Watchdog: TS errors in %s", workspace_path)

    # 2. Oxlint
    frontend_src = ws / "frontend" / "src"
    if frontend_src.exists():
        rc, out = _run_cmd(["npx", "oxlint", "--max-warnings=0"], str(ws / "frontend"), timeout=60)
        if rc != 0 and "error" in out.lower():
            msg = f"Oxlint issues detected:\n{out[:300]}"
            issues.append({"type": "lint_error", "severity": "warning", "detail": msg})
            _add_alert("linting", "warning", msg, workspace_path)

    # 3. Backend pytest (quick, bail fast)
    pytest_ini = ws / "backend"
    if pytest_ini.exists():
        rc, out = _run_cmd(
            ["backend/venv/bin/pytest", "-q", "--bail", "--tb=no"],
            str(ws), timeout=120
        )
        if rc not in (0, 5):  # 5 = no tests collected
            msg = f"Pytest failures:\n{out[:300]}"
            issues.append({"type": "test_failure", "severity": "error", "detail": msg})
            _add_alert("tests", "error", msg, workspace_path)
            logger.warning("Watchdog: Test failures in %s", workspace_path)

    return {
        "workspace": workspace_path,
        "scanned_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "issues_count": len(issues),
        "issues": issues,
        "healthy": len(issues) == 0,
    }


async def _watchdog_loop(workspace_path: str, interval_seconds: int = 300) -> None:
    """Continuous watchdog loop, runs every `interval_seconds`."""
    global _watchdog_running
    _watchdog_running = True
    logger.info("Watchdog sentinel started for %s (interval=%ds)", workspace_path, interval_seconds)

    while _watchdog_running:
        try:
            result = await asyncio.to_thread(run_watchdog_scan, workspace_path)
            if not result["healthy"]:
                logger.warning("Watchdog detected %d issue(s) in %s", result["issues_count"], workspace_path)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error("Watchdog scan error: %s", e)

        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            break

    _watchdog_running = False
    logger.info("Watchdog sentinel stopped")


def start_watchdog(workspace_path: str, interval_seconds: int = 300) -> dict[str, Any]:
    """Start the background watchdog sentinel (non-blocking)."""
    global _watchdog_task

    if _watchdog_task and not _watchdog_task.done():
        return {"status": "already_running", "workspace": workspace_path}

    try:
        loop = asyncio.get_event_loop()
        _watchdog_task = loop.create_task(_watchdog_loop(workspace_path, interval_seconds))
        return {"status": "started", "workspace": workspace_path, "interval_seconds": interval_seconds}
    except RuntimeError:
        # No running event loop — acceptable in sync contexts
        return {"status": "deferred", "workspace": workspace_path}


def stop_watchdog() -> dict[str, Any]:
    """Stop the background watchdog sentinel."""
    global _watchdog_running
    _watchdog_running = False
    if _watchdog_task and not _watchdog_task.done():
        _watchdog_task.cancel()
        return {"status": "stopping"}
    return {"status": "not_running"}


def get_watchdog_status() -> dict[str, Any]:
    running = _watchdog_running and _watchdog_task is not None and not _watchdog_task.done()
    return {
        "running": running,
        "pending_alerts": len([a for a in _alert_log if not a["resolved"]]),
        "total_alerts": len(_alert_log),
    }
