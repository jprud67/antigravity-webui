from fastapi import APIRouter, Depends
from typing import Dict, Any, List
from app.api.auth import require_auth
from app.services.storage import get_settings, save_settings
from app.services.agy_driver import (
    get_model_families,
    get_usage_quota,
    get_credits,
    get_changelog
)

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("")
def read_settings(_ = Depends(require_auth)) -> Dict[str, Any]:
    return get_settings()

@router.post("")
def update_settings(payload: Dict[str, Any], _ = Depends(require_auth)) -> Dict[str, Any]:
    return save_settings(payload)

@router.get("/models")
async def list_models(_ = Depends(require_auth)) -> List[Dict[str, Any]]:
    return await get_model_families()

@router.get("/usage")
async def read_usage_quota(_ = Depends(require_auth)) -> Dict[str, Any]:
    return await get_usage_quota()

@router.get("/credits")
async def read_credits(_ = Depends(require_auth)) -> Dict[str, Any]:
    return await get_credits()

@router.get("/changelog")
async def read_changelog(_ = Depends(require_auth)) -> Dict[str, Any]:
    return await get_changelog()

