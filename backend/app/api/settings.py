from fastapi import APIRouter
from typing import Dict, Any, List
from app.services.storage import get_settings, save_settings
from app.services.agy_driver import get_available_models

router = APIRouter(prefix="/api/settings", tags=["settings"])

@router.get("")
def read_settings() -> Dict[str, Any]:
    return get_settings()

@router.post("")
def update_settings(payload: Dict[str, Any]) -> Dict[str, Any]:
    return save_settings(payload)

@router.get("/models")
async def list_models() -> List[Dict[str, str]]:
    return await get_available_models()
