"""API router for Omni-channel Messaging Gateway & PIN Pairing."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.messaging_gateway import (
    request_pairing,
    approve_pairing_code,
    list_pending_pairings,
    list_approved_devices,
    revoke_device,
    save_gateway_config,
    get_gateway_configs,
)

router = APIRouter(prefix="/api/gateway", tags=["gateway"])


class RequestPairingModel(BaseModel):
    platform: str
    user_id: str
    user_name: Optional[str] = None


class ApprovePairingModel(BaseModel):
    code: str


class RevokeDeviceModel(BaseModel):
    platform: str
    user_id: str


class ConfigureBotModel(BaseModel):
    platform: str
    bot_token: str
    chat_id: Optional[str] = None
    is_active: Optional[bool] = True
    notify_on_approval: Optional[bool] = True
    notify_on_complete: Optional[bool] = True


@router.get("/status")
def api_gateway_status():
    """Get active gateway status and bot configurations."""
    configs = get_gateway_configs()
    pending = list_pending_pairings()
    approved = list_approved_devices()
    return {
        "configs": configs,
        "pending_count": len(pending),
        "approved_count": len(approved)
    }


@router.get("/pairing/pending")
def api_list_pending():
    """List pending pairing PIN requests."""
    return {"pending": list_pending_pairings()}


@router.get("/pairing/approved")
def api_list_approved():
    """List approved devices."""
    return {"approved": list_approved_devices()}


@router.post("/pairing/request")
def api_request_pairing(req: RequestPairingModel):
    """Generate or retrieve a pairing code for an inbound device."""
    ok, msg, code = request_pairing(req.platform, req.user_id, req.user_name)
    if not ok:
        raise HTTPException(status_code=429 if "patienter" in msg else 400, detail=msg)
    return {"success": True, "message": msg, "code": code}


@router.post("/pairing/approve")
def api_approve_pairing(req: ApprovePairingModel):
    """Approve a device using its 8-character pairing code."""
    ok, msg, device = approve_pairing_code(req.code)
    if not ok:
        raise HTTPException(status_code=400, detail=msg)
    return {"success": True, "message": msg, "device": device}


@router.post("/pairing/revoke")
def api_revoke_device(req: RevokeDeviceModel):
    """Revoke authorization for a previously approved device."""
    revoked = revoke_device(req.platform, req.user_id)
    return {"success": revoked, "platform": req.platform, "user_id": req.user_id}


@router.post("/config")
def api_configure_bot(req: ConfigureBotModel):
    """Save bot token and notification settings for Telegram or Discord."""
    ok = save_gateway_config(
        platform=req.platform,
        bot_token=req.bot_token,
        chat_id=req.chat_id,
        is_active=req.is_active if req.is_active is not None else True,
        notify_on_approval=req.notify_on_approval if req.notify_on_approval is not None else True,
        notify_on_complete=req.notify_on_complete if req.notify_on_complete is not None else True,
    )
    return {"success": ok, "platform": req.platform}
