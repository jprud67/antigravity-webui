import asyncio
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel

from app.services.auth import (
    create_access_token,
    get_auth_config,
    save_auth_config,
    update_password,
    verify_access_token,
    verify_password,
)

logger = logging.getLogger("antigravity.auth")
router = APIRouter(prefix="/api/auth", tags=["auth"])

class LoginRequest(BaseModel):
    password: str

class PasswordChangeRequest(BaseModel):
    old_password: str
    new_password: str

class AuthToggleRequest(BaseModel):
    enabled: bool

def get_current_token(
    authorization: str | None = Header(None),
    token: str | None = Query(None)
) -> str | None:
    if authorization:
        auth_stripped = authorization.strip()
        if auth_stripped.lower().startswith("bearer "):
            return auth_stripped[7:].strip()
        return auth_stripped
    if token:
        tok_stripped = token.strip()
        if tok_stripped.lower().startswith("bearer "):
            return tok_stripped[7:].strip()
        return tok_stripped
    return None

def require_auth(token: str | None = Depends(get_current_token)):
    config = get_auth_config()
    if not config.get("enabled", True):
        return True
    if not token or not verify_access_token(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expirée ou non autorisée. Veuillez vous connecter.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True

@router.get("/status")
def auth_status(token: str | None = Depends(get_current_token)):
    config = get_auth_config()
    enabled = config.get("enabled", True)
    is_valid = verify_access_token(token) if enabled else True
    return {
        "enabled": enabled,
        "authenticated": is_valid
    }

@router.post("/login")
async def login(req: LoginRequest):
    if verify_password(req.password):
        token = create_access_token(expires_in_days=14)
        logger.info("Successful authentication login")
        return {
            "success": True,
            "token": token,
            "message": "Connexion réussie"
        }
    else:
        # Délai constant anti-bruteforce (0.5s) — asynchrone pour ne pas bloquer les threads workers
        await asyncio.sleep(0.5)
        logger.warning("Failed authentication login attempt")
        raise HTTPException(status_code=401, detail="Mot de passe incorrect.")


@router.post("/update-password")
def change_pwd(req: PasswordChangeRequest, _ = Depends(require_auth)):
    if not verify_password(req.old_password):
        raise HTTPException(status_code=400, detail="L'ancien mot de passe est incorrect.")
    if len(req.new_password.strip()) < 4:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit comporter au moins 4 caractères.")
    
    update_password(req.new_password.strip())
    new_token = create_access_token(expires_in_days=14)
    return {
        "success": True,
        "token": new_token,
        "message": "Mot de passe mis à jour avec succès."
    }

@router.post("/toggle")
def toggle_auth(req: AuthToggleRequest, _ = Depends(require_auth)):
    config = get_auth_config()
    config["enabled"] = req.enabled
    save_auth_config(config)
    return {"success": True, "enabled": req.enabled}
