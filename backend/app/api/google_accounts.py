import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.google_auth import (
    cancel_google_login_flow,
    delete_google_account,
    get_active_account,
    import_raw_token,
    list_google_accounts,
    start_google_login_flow,
    submit_google_auth_code,
    switch_google_account,
)

logger = logging.getLogger("antigravity.google_api")
router = APIRouter(prefix="/api/google", tags=["google_accounts"])


class SwitchAccountRequest(BaseModel):
    email: str


class SubmitCodeRequest(BaseModel):
    session_id: str
    code: str


class CancelSessionRequest(BaseModel):
    session_id: str


class ImportTokenRequest(BaseModel):
    token_data: dict[str, Any]


@router.get("/accounts")
def get_accounts(_ = Depends(require_auth)):
    try:
        return list_google_accounts()
    except Exception as e:
        logger.error(f"Error listing Google accounts: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/active")
def get_current_active_account(_ = Depends(require_auth)):
    account = get_active_account()
    if not account:
        return {"connected": False, "account": None}
    return {"connected": True, "account": account}


@router.post("/accounts/switch")
def switch_account(req: SwitchAccountRequest, _ = Depends(require_auth)):
    try:
        res = switch_google_account(req.email)
        return res
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error switching Google account: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/accounts")
def delete_account(email: str, _ = Depends(require_auth)):
    try:
        res = delete_google_account(email)
        return res
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error deleting Google account: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accounts/login/start")
def start_login(_ = Depends(require_auth)):
    try:
        res = start_google_login_flow()
        return res
    except Exception as e:
        logger.error(f"Error starting Google OAuth flow: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accounts/login/submit")
def submit_code(req: SubmitCodeRequest, _ = Depends(require_auth)):
    try:
        res = submit_google_auth_code(req.session_id, req.code)
        return res
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except TimeoutError as e:
        raise HTTPException(status_code=408, detail=str(e))
    except Exception as e:
        logger.error(f"Error completing Google OAuth login: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/accounts/login/cancel")
def cancel_login(req: CancelSessionRequest, _ = Depends(require_auth)):
    return cancel_google_login_flow(req.session_id)


@router.post("/accounts/import")
def import_token(req: ImportTokenRequest, _ = Depends(require_auth)):
    try:
        res = import_raw_token(req.token_data)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
