import logging
from fastapi import APIRouter, HTTPException, Query, Depends
from typing import Dict, Any, Optional

from app.api.auth import require_auth
from app.services.updater import (
    get_local_version_info,
    check_for_updates,
    apply_update
)

logger = logging.getLogger("antigravity.updater_api")
router = APIRouter(prefix="/api/system", tags=["system_updates"])


@router.get("/version")
def get_version(_ = Depends(require_auth)) -> Dict[str, Any]:
    """Returns local version, commit, active branch, and release tag."""
    return get_local_version_info()


@router.get("/update/check")
async def api_check_for_updates(force: bool = Query(False), _ = Depends(require_auth)) -> Dict[str, Any]:
    """
    Checks if an update is available on GitHub origin/main.
    Follows Hermes' non-blocking and cached update check architecture.
    """
    import asyncio
    return await asyncio.to_thread(check_for_updates, force=force)


@router.post("/update/apply")
async def api_apply_update(_ = Depends(require_auth)) -> Dict[str, Any]:
    """
    Applies the latest update from origin/main, rebuilds frontend if required,
    and cleanly restarts the service in the background.
    """
    try:
        res = await apply_update()
        if not res.get("ok"):
            raise HTTPException(status_code=500, detail=res.get("message", "Échec de la mise à jour"))
        return res
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error applying update: {e}")
        raise HTTPException(status_code=500, detail=str(e))
