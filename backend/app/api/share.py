import logging
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Path as FastApiPath, Query
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.services import share_service
from app.services.execution_manager import execution_manager
from app.services.session_metadata import get_session_meta
from app.services.storage import (
    calculate_conversation_tokens,
    get_conversation_by_id,
    get_conversation_transcript,
    is_safe_conversation_id,
)

logger = logging.getLogger("antigravity.share_api")

router = APIRouter(prefix="/api/share", tags=["Collaborative Session Sharing"])


class ShareCreateRequest(BaseModel):
    conversation_id: str
    permission: Literal["read", "write"] = "read"
    duration_hours: Optional[int] = Field(default=None, ge=-1, le=8760)  # up to 1 year
    pin_code: Optional[str] = None


class ShareUnlockRequest(BaseModel):
    pin_code: str


@router.post("/create", dependencies=[Depends(require_auth)])
def create_share_link(req: ShareCreateRequest):
    """Generates a new shareable link for a conversation."""
    if not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation invalide")

    try:
        link_info = share_service.create_share_link(
            conversation_id=req.conversation_id,
            permission=req.permission,
            duration_hours=req.duration_hours,
            pin_code=req.pin_code,
            created_by="host",
        )
        return link_info
    except Exception as e:
        logger.error("Error creating share link: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Échec de création du lien de partage: {e}")


@router.get("/links/{conversation_id}", dependencies=[Depends(require_auth)])
def list_share_links(conversation_id: str):
    """Lists all active and expired share links for the specified conversation."""
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation invalide")

    try:
        links = share_service.list_share_links(conversation_id)
        return {"links": links, "count": len(links)}
    except Exception as e:
        logger.error("Error listing share links: %s", e, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Échec de récupération des liens: {e}")


@router.post("/revoke/{share_token}", dependencies=[Depends(require_auth)])
def revoke_share_link(share_token: str):
    """Revokes a share link and immediately disconnects any attached spectators."""
    clean_token = (share_token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Token manquant")

    revoked = share_service.revoke_share_link(clean_token)
    if not revoked:
        raise HTTPException(status_code=404, detail="Lien introuvable ou déjà révoqué")

    # Disconnect any live WebSockets using this share token
    try:
        if hasattr(execution_manager, "disconnect_token"):
            execution_manager.disconnect_token(clean_token)
    except Exception as e:
        logger.warning("Could not evict WebSockets for token %s: %s", clean_token, e)

    return {"success": True, "token": clean_token}


@router.get("/verify/{share_token}")
def verify_share_link(share_token: str):
    """Public verification endpoint returning status, permission, and PIN requirement."""
    clean_token = (share_token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Token manquant")

    info = share_service.get_shared_session_info(clean_token)
    if not info:
        raise HTTPException(status_code=404, detail="Lien de partage introuvable")

    if info["is_revoked"]:
        return {
            "valid": False,
            "reason": "revoked",
            "token": clean_token,
            "is_revoked": True,
            "conversation_id": info["conversation_id"],
        }

    if info["is_expired"]:
        return {
            "valid": False,
            "reason": "expired",
            "token": clean_token,
            "is_expired": True,
            "conversation_id": info["conversation_id"],
        }

    conv_id = info["conversation_id"]
    meta = get_conversation_by_id(conv_id) or get_session_meta(conv_id)
    title = meta.get("customTitle") or meta.get("title") or conv_id[:8]

    if info["requires_pin"]:
        return {
            "valid": False,
            "requires_pin": True,
            "reason": "pin_required",
            "token": clean_token,
            "permission": info["permission"],
            "title": title,
            "conversation_id": conv_id,
        }

    return {
        "valid": True,
        "requires_pin": False,
        "token": clean_token,
        "permission": info["permission"],
        "title": title,
        "conversation_id": conv_id,
        "expires_at": info["expires_at"],
    }


@router.post("/unlock/{share_token}")
def unlock_share_link(share_token: str, req: ShareUnlockRequest):
    """Unlocks a PIN-protected share link."""
    clean_token = (share_token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Token manquant")

    res = share_service.verify_share_token(clean_token, pin_code=req.pin_code)
    if not res.get("valid"):
        reason = res.get("reason", "invalid_pin")
        status = 403 if reason in ("revoked", "expired") else 400
        raise HTTPException(status_code=status, detail=reason)

    conv_id = res["conversation_id"]
    meta = get_conversation_by_id(conv_id) or get_session_meta(conv_id)
    title = meta.get("customTitle") or meta.get("title") or conv_id[:8]

    return {
        "valid": True,
        "token": clean_token,
        "permission": res["permission"],
        "conversation_id": conv_id,
        "title": title,
        "expires_at": res.get("expires_at"),
    }


@router.get("/transcript/{share_token}")
def get_shared_transcript(share_token: str, pin_code: Optional[str] = Query(default=None)):
    """Fetches the conversation transcript for a validated share link."""
    clean_token = (share_token or "").strip()
    if not clean_token:
        raise HTTPException(status_code=400, detail="Token manquant")

    res = share_service.verify_share_token(clean_token, pin_code=pin_code)
    if not res.get("valid"):
        reason = res.get("reason", "unauthorized")
        status = 401 if reason == "pin_required" else 403
        raise HTTPException(status_code=status, detail=f"Accès refusé ({reason})")

    conv_id = res["conversation_id"]
    if not is_safe_conversation_id(conv_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")

    transcript = get_conversation_transcript(conv_id)
    meta = get_conversation_by_id(conv_id) or get_session_meta(conv_id)
    usage = calculate_conversation_tokens(transcript)
    is_running = execution_manager.is_running(conv_id)

    return {
        "conversation_id": conv_id,
        "permission": res["permission"],
        "meta": meta,
        "steps": transcript,
        "usage": usage,
        "is_running": is_running,
    }
