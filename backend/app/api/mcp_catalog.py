"""FastAPI router for MCP Catalog (Store 1-Clic)."""

from __future__ import annotations

from typing import Any, Dict, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services.mcp_catalog import (
    list_mcp_catalog,
    get_mcp_catalog_item,
    install_mcp_catalog_item,
    uninstall_mcp_catalog_item,
    test_mcp_connection
)

router = APIRouter(prefix="/api/mcp/catalog", tags=["MCP Catalog"])


class InstallMcpPayload(BaseModel):
    api_key: Optional[str] = None
    env: Optional[Dict[str, str]] = None
    headers: Optional[list[str]] = None


@router.get("")
async def get_catalog(
    q: Optional[str] = Query(None, description="Recherche textuelle par nom, slug, mot-clé"),
    category: Optional[str] = Query(None, description="Filtre de catégorie (ex: Database, Developer Tools)")
):
    try:
        items = await list_mcp_catalog(query=q, category=category)
        return {
            "total": len(items),
            "items": items
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{slug}")
async def get_catalog_entry(slug: str):
    item = await get_mcp_catalog_item(slug)
    if not item:
        raise HTTPException(status_code=404, detail=f"Serveur MCP '{slug}' introuvable.")
    return item


@router.post("/{slug}/install")
async def install_entry(slug: str, payload: InstallMcpPayload = InstallMcpPayload()):
    try:
        res = await install_mcp_catalog_item(slug, payload.model_dump())
        return res
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{slug}/uninstall")
async def uninstall_entry(slug: str):
    try:
        res = await uninstall_mcp_catalog_item(slug)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{slug}/test")
async def ping_mcp_server(slug: str):
    try:
        res = await test_mcp_connection(slug)
        return res
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
