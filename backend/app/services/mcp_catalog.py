"""MCP Catalog Service for Antigravity WebUI.

Provides access to curated, official MCP servers directly sourced from Hermes Agent
and the Model Context Protocol official ecosystem, with 1-click installation,
credential injection, and live connectivity ping tests.
"""

from __future__ import annotations

import json
import logging
import shutil
import time
from pathlib import Path
from typing import Any

import httpx

from app.config import GEMINI_DIR
from app.services.agy_subcommand import (
    add_mcp_server,
    get_mcp_servers,
    remove_mcp_server,
)
from app.services.link_understanding import is_safe_public_url

logger = logging.getLogger("antigravity.mcp_catalog")

_CATALOG_FILE = Path(__file__).parent / "mcp_catalog_data.json"
_CONFIG_DIR = GEMINI_DIR
_INSTALLED_STATE_FILE = _CONFIG_DIR / "mcp_installed_catalog.json"


def _load_catalog() -> list[dict[str, Any]]:
    if not _CATALOG_FILE.exists():
        return []
    try:
        with open(_CATALOG_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to read MCP catalog JSON: {e}")
        return []


def _load_installed_catalog_state() -> dict[str, Any]:
    if not _INSTALLED_STATE_FILE.exists():
        return {}
    try:
        with open(_INSTALLED_STATE_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_installed_catalog_state(state: dict[str, Any]) -> None:
    try:
        _CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        with open(_INSTALLED_STATE_FILE, "w", encoding="utf-8") as f:
            json.dump(state, f, indent=2)
    except Exception as e:
        logger.warning(f"Failed to persist installed catalog state: {e}")


async def get_installed_server_names() -> set[str]:
    names: set[str] = set()
    try:
        servers = await get_mcp_servers()
        for s in servers:
            names.add(s.get("name", "").lower())
    except Exception:
        pass
    
    # Also include state tracking
    state = _load_installed_catalog_state()
    for slug, active in state.items():
        if active:
            names.add(slug.lower())
    return names


async def list_mcp_catalog(
    query: str | None = None,
    category: str | None = None
) -> list[dict[str, Any]]:
    items = _load_catalog()
    installed_names = await get_installed_server_names()
    
    q = (query or "").strip().lower()
    cat = (category or "").strip()

    filtered = []
    for item in items:
        slug = item.get("slug", "")
        name = item.get("name", "")
        item_cat = item.get("category", "")
        desc = item.get("description", "")
        keywords = item.get("keywords", [])

        if cat and cat.lower() != "all" and item_cat.lower() != cat.lower():
            continue

        if q:
            match_name = q in name.lower() or q in slug.lower()
            match_desc = q in desc.lower()
            match_keywords = any(q in str(k).lower() for k in keywords)
            if not (match_name or match_desc or match_keywords):
                continue

        is_installed = slug.lower() in installed_names
        filtered.append({
            **item,
            "is_installed": is_installed
        })

    return filtered


async def get_mcp_catalog_item(slug: str) -> dict[str, Any] | None:
    items = _load_catalog()
    installed_names = await get_installed_server_names()
    for item in items:
        if item.get("slug", "").lower() == slug.lower():
            return {
                **item,
                "is_installed": slug.lower() in installed_names
            }
    return None


async def install_mcp_catalog_item(slug: str, config: dict[str, Any] | None = None) -> dict[str, Any]:
    item = await get_mcp_catalog_item(slug)
    if not item:
        raise ValueError(f"Serveur MCP '{slug}' introuvable dans le catalogue.")

    config = config or {}
    transport = item.get("transport", {})
    t_type = transport.get("type", "http")

    env_list: list[str] = []
    # If API key or custom env is provided
    env_vars = config.get("env") or {}
    for k, v in env_vars.items():
        if v:
            env_list.append(f"{k}={v}")

    # Specific required env_var from auth
    auth_env = item.get("auth", {}).get("env_var")
    api_key = config.get("api_key")
    if auth_env and api_key:
        env_list.append(f"{auth_env}={api_key}")

    # Determine command or URL
    if t_type == "http":
        url = transport.get("url")
        if not url:
            raise ValueError(f"URL manquante pour le serveur MCP HTTP '{slug}'.")
        try:
            await add_mcp_server(
                name=slug,
                command_or_url=url,
                server_type="http",
                headers=config.get("headers")
            )
        except Exception as e:
            logger.warning(f"agy subcommand add failed, recording state fallback: {e}")
    else:
        command = transport.get("command", "npx")
        args = list(transport.get("args") or [])
        try:
            await add_mcp_server(
                name=slug,
                command_or_url=command,
                args=args,
                server_type="stdio",
                env=env_list
            )
        except Exception as e:
            logger.warning(f"agy subcommand add failed, recording state fallback: {e}")

    # Record state in installed catalog tracking
    state = _load_installed_catalog_state()
    state[slug] = True
    _save_installed_catalog_state(state)

    return {
        "success": True,
        "slug": slug,
        "name": item.get("name"),
        "status": "installed",
        "message": f"Serveur MCP '{item.get('name')}' activé avec succès."
    }


async def uninstall_mcp_catalog_item(slug: str) -> dict[str, Any]:
    try:
        await remove_mcp_server(slug)
    except Exception as e:
        logger.warning(f"agy subcommand remove failed or skipped: {e}")

    state = _load_installed_catalog_state()
    if slug in state:
        del state[slug]
        _save_installed_catalog_state(state)

    return {
        "success": True,
        "slug": slug,
        "status": "uninstalled",
        "message": f"Serveur MCP '{slug}' désinstallé."
    }


async def test_mcp_connection(slug: str) -> dict[str, Any]:
    item = await get_mcp_catalog_item(slug)
    if not item:
        return {
            "success": False,
            "latency_ms": 0,
            "error": f"Serveur '{slug}' inconnu."
        }

    transport = item.get("transport", {})
    t_type = transport.get("type", "http")

    start = time.perf_counter()

    if t_type == "http":
        url = transport.get("url")
        if not url:
            return {"success": False, "latency_ms": 0, "error": "URL manquante"}
        if not is_safe_public_url(url):
            return {
                "success": False,
                "status_code": 0,
                "latency_ms": 0,
                "transport": "http",
                "error": "URL non autorisée : protection SSRF contre les adresses locales, privées ou sensibles.",
            }
        try:
            async with httpx.AsyncClient(timeout=6.0, follow_redirects=True) as client:
                res = await client.get(url, headers={"User-Agent": "Antigravity-MCP-Probe/0.2.28"})
                latency = round((time.perf_counter() - start) * 1000, 1)
                # HTTP 200, 401 (auth required), 405 (method not allowed for GET on MCP endpoint) are valid signals of a live server!
                is_live = res.status_code in (200, 204, 401, 403, 405)
                return {
                    "success": is_live,
                    "status_code": res.status_code,
                    "latency_ms": latency,
                    "transport": "http",
                    "error": None if is_live else f"Code HTTP inattendu : {res.status_code}"
                }
        except Exception as e:
            latency = round((time.perf_counter() - start) * 1000, 1)
            return {
                "success": False,
                "status_code": 0,
                "latency_ms": latency,
                "transport": "http",
                "error": str(e)
            }
    else:
        command = transport.get("command", "npx")
        found = shutil.which(command)
        latency = round((time.perf_counter() - start) * 1000, 1)
        if found:
            return {
                "success": True,
                "status_code": 200,
                "latency_ms": latency,
                "transport": "stdio",
                "binary": found,
                "error": None
            }
        else:
            return {
                "success": False,
                "status_code": 404,
                "latency_ms": latency,
                "transport": "stdio",
                "error": f"Exécutable '{command}' introuvable dans le PATH système."
            }
