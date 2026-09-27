"""Plugin Sandbox & Watchdog API — Antigravity WebUI v0.5.0

REST endpoints for:
- Plugin management (register, list, invoke, disable)
- Watchdog sentinel controls (start, stop, status, alerts)
- Maintenance sweeps (run, history)
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.plugin_sandbox import (
    ensure_plugin_schema,
    register_plugin,
    get_plugin,
    list_plugins,
    disable_plugin,
    invoke_plugin,
    VALID_SCOPES,
)
from app.services.watchdog_sentinel import (
    start_watchdog,
    stop_watchdog,
    get_watchdog_status,
    get_alerts,
    resolve_alert,
    clear_alerts,
    run_watchdog_scan,
)
from app.services.maintenance_sweeps import (
    sweep_dependency_vulnerabilities,
    sweep_dead_git_branches,
    sweep_changelog_summary,
    get_sweep_history,
    run_all_sweeps,
)

logger = logging.getLogger("antigravity.api.plugins")

router = APIRouter(prefix="/api/plugins", tags=["plugins"])
watchdog_router = APIRouter(prefix="/api/watchdog", tags=["watchdog"])
sweeps_router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])


# ─────────────────────────── PLUGIN MODELS ──────────────────────────────────

class PluginRegisterBody(BaseModel):
    slug: str
    name: str
    version: str = "1.0.0"
    description: str | None = None
    entry_point: str | None = None
    scopes: list[str] = Field(default_factory=list)
    author: str = "community"
    homepage: str | None = None


class PluginInvokeBody(BaseModel):
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


# ─────────────────────────── PLUGIN ENDPOINTS ───────────────────────────────

@router.get("/scopes")
def get_valid_scopes():
    """Return list of valid permission scopes."""
    return {"scopes": sorted(VALID_SCOPES)}


@router.get("")
def list_all_plugins(active_only: bool = True):
    """List all registered plugins."""
    plugins = list_plugins(active_only=active_only)
    return {"plugins": plugins, "total": len(plugins)}


@router.post("")
def create_plugin(body: PluginRegisterBody):
    """Register a new plugin or update an existing one by slug."""
    try:
        plugin = register_plugin(
            slug=body.slug,
            name=body.name,
            version=body.version,
            description=body.description,
            entry_point=body.entry_point,
            scopes=body.scopes,
            author=body.author,
            homepage=body.homepage,
        )
        return plugin
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@router.get("/{slug}")
def get_plugin_by_slug(slug: str):
    """Get a plugin by its slug."""
    plugin = get_plugin(slug)
    if not plugin:
        raise HTTPException(status_code=404, detail=f"Plugin '{slug}' not found")
    return plugin


@router.delete("/{slug}")
def deactivate_plugin(slug: str):
    """Disable (soft-delete) a plugin."""
    ok = disable_plugin(slug)
    if not ok:
        raise HTTPException(status_code=404, detail=f"Plugin '{slug}' not found")
    return {"status": "disabled", "slug": slug}


@router.post("/{slug}/invoke")
def invoke_plugin_endpoint(slug: str, body: PluginInvokeBody):
    """Invoke a plugin method in the sandbox."""
    try:
        result = invoke_plugin(slug, body.method, body.params)
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))


# ─────────────────────────── WATCHDOG ENDPOINTS ─────────────────────────────

class WatchdogStartBody(BaseModel):
    workspace_path: str
    interval_seconds: int = Field(default=300, ge=30, le=3600)


@watchdog_router.get("/status")
def watchdog_status():
    """Get watchdog sentinel status."""
    return get_watchdog_status()


@watchdog_router.post("/start")
def start_watchdog_sentinel(body: WatchdogStartBody):
    """Start the watchdog sentinel for a workspace."""
    result = start_watchdog(body.workspace_path, body.interval_seconds)
    return result


@watchdog_router.post("/stop")
def stop_watchdog_sentinel():
    """Stop the watchdog sentinel."""
    return stop_watchdog()


@watchdog_router.post("/scan")
def scan_workspace(workspace_path: str):
    """Run a one-off synchronous watchdog scan."""
    result = run_watchdog_scan(workspace_path)
    return result


@watchdog_router.get("/alerts")
def list_watchdog_alerts(workspace: str | None = None, unresolved_only: bool = True):
    """List watchdog alerts."""
    alerts = get_alerts(workspace=workspace, unresolved_only=unresolved_only)
    return {"alerts": alerts, "total": len(alerts)}


@watchdog_router.patch("/alerts/{alert_id}/resolve")
def resolve_watchdog_alert(alert_id: str):
    """Mark an alert as resolved."""
    ok = resolve_alert(alert_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Alert not found")
    return {"status": "resolved", "alert_id": alert_id}


@watchdog_router.delete("/alerts")
def clear_watchdog_alerts(workspace: str | None = None):
    """Clear all (or workspace-specific) watchdog alerts."""
    count = clear_alerts(workspace=workspace)
    return {"cleared": count}


# ─────────────────────────── SWEEPS ENDPOINTS ───────────────────────────────

class SweepRunBody(BaseModel):
    workspace_path: str
    sweep_type: str = "all"
    since_days: int = Field(default=7, ge=1, le=90)


@sweeps_router.post("/run")
async def run_sweep(body: SweepRunBody):
    """Run maintenance sweep(s) on a workspace."""
    ws = body.workspace_path
    if body.sweep_type == "all":
        result = await run_all_sweeps(ws)
    elif body.sweep_type == "vulnerabilities":
        result = sweep_dependency_vulnerabilities(ws)
    elif body.sweep_type == "branches":
        result = sweep_dead_git_branches(ws)
    elif body.sweep_type == "changelog":
        result = sweep_changelog_summary(ws, since_days=body.since_days)
    else:
        raise HTTPException(status_code=422, detail=f"Unknown sweep_type '{body.sweep_type}'")
    return result


@sweeps_router.get("/history")
def get_history(workspace: str | None = None, sweep_type: str | None = None):
    """Get maintenance sweep history."""
    history = get_sweep_history(workspace=workspace, sweep_type=sweep_type)
    return {"history": history, "total": len(history)}
