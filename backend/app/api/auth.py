import asyncio
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel

from app.services.auth import (
    create_access_token,
    get_auth_config,
    save_auth_config,
    update_password,
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

class CreateApiKeyRequest(BaseModel):
    name: str = "Application Externe"

def get_current_token(
    authorization: str | None = Header(None),
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    token: str | None = Query(None),
    api_key: str | None = Query(None)
) -> str | None:
    # 1. Vérifier le header spécifique X-API-Key
    if x_api_key and x_api_key.strip():
        return x_api_key.strip()

    # 2. Vérifier le paramètre d'URL api_key
    if api_key and api_key.strip():
        return api_key.strip()

    # 3. Vérifier le header standard Authorization (Bearer)
    if authorization:
        auth_stripped = authorization.strip()
        if auth_stripped.lower().startswith("bearer "):
            return auth_stripped[7:].strip()
        return auth_stripped

    # 4. Vérifier le paramètre d'URL token
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
    from app.services.auth import verify_token_or_api_key
    if not token or not verify_token_or_api_key(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Clé d'API ou session expirée/invalide. Veuillez fournir un token ou une clé d'API valide (Authorization: Bearer <key> ou X-API-Key: <key>).",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True

@router.get("/status")
def auth_status(token: str | None = Depends(get_current_token)):
    config = get_auth_config()
    enabled = config.get("enabled", True)
    from app.services.auth import verify_token_or_api_key
    is_valid = verify_token_or_api_key(token) if enabled else True
    return {
        "enabled": enabled,
        "authenticated": is_valid
    }

@router.get("/api-keys")
def list_api_keys(_ = Depends(require_auth)):
    from app.services.auth import get_api_keys
    return {"api_keys": get_api_keys()}

@router.post("/api-keys")
def add_api_key(req: CreateApiKeyRequest, _ = Depends(require_auth)):
    from app.services.auth import create_api_key
    new_key = create_api_key(req.name)
    return {"success": True, "api_key": new_key}

@router.delete("/api-keys/{key_id}")
def remove_api_key(key_id: str, _ = Depends(require_auth)):
    from app.services.auth import delete_api_key
    success = delete_api_key(key_id)
    if not success:
        raise HTTPException(status_code=404, detail="Clé d'API introuvable.")
    return {"success": True, "message": "Clé d'API supprimée avec succès."}


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
    if len(req.new_password.strip()) < 8:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit comporter au moins 8 caractères.")

    
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
