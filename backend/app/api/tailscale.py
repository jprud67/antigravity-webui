"""API router for Tailscale Remote Access."""

from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.tailscale import (
    get_tailscale_status,
    toggle_tailscale_serve,
)

router = APIRouter(prefix="/api/tailscale", tags=["tailscale"])


class ToggleServeRequest(BaseModel):
    enable: bool
    port: Optional[int] = Field(8000, ge=1, le=65535)


@router.get("/status")
def api_tailscale_status():
    """Get current Tailscale status, MagicDNS URL and serve state."""
    return get_tailscale_status()


@router.post("/serve")
def api_tailscale_serve(req: ToggleServeRequest):
    """Enable or disable Tailscale Serve."""
    res = toggle_tailscale_serve(enable=req.enable, port=req.port or 8000)
    return res
