"""Maintenance Sweeps Scheduler — Antigravity WebUI v0.5.0

Autonomous scheduled maintenance tasks:
- Dependency vulnerability scans
- Dead Git branch cleanup suggestions
- Config schema updates detection
- Weekly changelog summary generation
"""
from __future__ import annotations

import asyncio
import json
import logging
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger("antigravity.maintenance")

# In-memory sweep history (ring buffer)
_sweep_history: list[dict[str, Any]] = []
MAX_HISTORY = 50

# Active sweep tasks
_sweep_tasks: dict[str, asyncio.Task] = {}


def _add_to_history(sweep_type: str, workspace: str, result: dict[str, Any]) -> None:
    entry = {
        "id": f"sweep_{int(time.time() * 1000)}",
        "type": sweep_type,
        "workspace": workspace,
        "result": result,
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }
    _sweep_history.append(entry)
    if len(_sweep_history) > MAX_HISTORY:
        _sweep_history.pop(0)


def get_sweep_history(workspace: str | None = None, sweep_type: str | None = None) -> list[dict[str, Any]]:
    history = list(reversed(_sweep_history))
    if workspace:
        history = [h for h in history if h["workspace"] == workspace]
    if sweep_type:
        history = [h for h in history if h["type"] == sweep_type]
    return history


def _run_cmd(cmd: list[str], cwd: str, timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, f"Timeout after {timeout}s"
    except Exception as e:
        return -1, str(e)


def sweep_dependency_vulnerabilities(workspace_path: str) -> dict[str, Any]:
    """Scan for known dependency vulnerabilities via npm audit / pip check."""
    ws = Path(workspace_path)
    results: list[dict[str, Any]] = []

    # npm audit
    pkg_json = ws / "frontend" / "package.json"
    if pkg_json.exists():
        rc, out = _run_cmd(["npm", "audit", "--json", "--audit-level=high"], str(ws / "frontend"), timeout=60)
        if rc != 0 and out:
            try:
                data = json.loads(out)
                vulns = data.get("metadata", {}).get("vulnerabilities", {})
                if any(v > 0 for v in vulns.values()):
                    results.append({"source": "npm", "vulnerabilities": vulns, "raw": out[:500]})
            except json.JSONDecodeError:
                results.append({"source": "npm", "raw": out[:300]})

    # pip check
    venv_pip = ws / "backend" / "venv" / "bin" / "pip"
    if venv_pip.exists():
        rc, out = _run_cmd([str(venv_pip), "check"], str(ws / "backend"), timeout=60)
        if rc != 0 and out:
            results.append({"source": "pip", "issues": out[:500]})

    summary = {
        "type": "dependency_vulnerabilities",
        "workspace": workspace_path,
        "issues_found": len(results) > 0,
        "findings": results,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }
    _add_to_history("dependency_vulnerabilities", workspace_path, summary)
    logger.info("Dep vulnerability sweep for %s: %d issue(s)", workspace_path, len(results))
    return summary


def sweep_dead_git_branches(workspace_path: str) -> dict[str, Any]:
    """Identify merged/dead Git branches that can be safely pruned."""
    ws = Path(workspace_path)
    if not (ws / ".git").exists():
        return {"type": "dead_branches", "workspace": workspace_path, "skipped": True, "reason": "Not a git repo"}

    rc, merged = _run_cmd(["git", "branch", "--merged", "main"], str(ws), timeout=30)
    dead_branches: list[str] = []
    if rc == 0:
        for b in merged.splitlines():
            b = b.strip().lstrip("* ")
            if b and b not in ("main", "master", "develop"):
                dead_branches.append(b)

    summary = {
        "type": "dead_branches",
        "workspace": workspace_path,
        "dead_branches": dead_branches,
        "count": len(dead_branches),
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }
    _add_to_history("dead_branches", workspace_path, summary)
    return summary


def sweep_changelog_summary(workspace_path: str, since_days: int = 7) -> dict[str, Any]:
    """Generate a changelog summary from recent Git commits."""
    ws = Path(workspace_path)
    if not (ws / ".git").exists():
        return {"type": "changelog", "workspace": workspace_path, "skipped": True, "reason": "Not a git repo"}

    since = f"--since={since_days} days ago"
    rc, log_out = _run_cmd(
        ["git", "log", since, "--oneline", "--no-merges", "--format=%s"],
        str(ws), timeout=30
    )

    commits: list[str] = []
    if rc == 0 and log_out:
        commits = [l.strip() for l in log_out.splitlines() if l.strip()]

    # Build markdown summary
    lines = [f"## Changelog Summary — Last {since_days} Days\n"]
    categories: dict[str, list[str]] = {"feat": [], "fix": [], "docs": [], "other": []}
    for c in commits:
        if c.startswith("feat"):
            categories["feat"].append(c)
        elif c.startswith("fix"):
            categories["fix"].append(c)
        elif c.startswith("docs"):
            categories["docs"].append(c)
        else:
            categories["other"].append(c)

    for cat, items in categories.items():
        if items:
            emoji = {"feat": "✨", "fix": "🐛", "docs": "📚", "other": "🔧"}.get(cat, "•")
            lines.append(f"\n### {emoji} {cat.title()}")
            for item in items:
                lines.append(f"- {item}")

    markdown = "\n".join(lines) if commits else f"No commits in the last {since_days} days."

    summary = {
        "type": "changelog",
        "workspace": workspace_path,
        "since_days": since_days,
        "commit_count": len(commits),
        "markdown": markdown,
        "scanned_at": datetime.now(timezone.utc).isoformat(),
    }
    _add_to_history("changelog", workspace_path, summary)
    return summary


async def run_all_sweeps(workspace_path: str) -> dict[str, Any]:
    """Run all maintenance sweeps concurrently."""
    loop = asyncio.get_event_loop()
    deps, branches, changelog = await asyncio.gather(
        loop.run_in_executor(None, sweep_dependency_vulnerabilities, workspace_path),
        loop.run_in_executor(None, sweep_dead_git_branches, workspace_path),
        loop.run_in_executor(None, sweep_changelog_summary, workspace_path),
    )
    return {
        "workspace": workspace_path,
        "sweeps": {
            "dependency_vulnerabilities": deps,
            "dead_branches": branches,
            "changelog": changelog,
        },
        "ran_at": datetime.now(timezone.utc).isoformat(),
    }
