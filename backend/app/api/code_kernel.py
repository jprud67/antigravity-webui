"""API router for Persistent Code Kernel and Tool RPC."""

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.platform_utils import is_blocked_sensitive_path, is_safe_path
from app.services.code_kernel import (
    get_or_create_kernel,
    list_active_kernels,
    stop_kernel,
)
from app.services.storage import get_allowed_workspace_roots

router = APIRouter(prefix="/api/kernel", tags=["kernel"], dependencies=[Depends(require_auth)])


def _validate_safe_kernel_cwd(cwd: str | None) -> str:
    if not cwd or cwd.strip() in ("", "."):
        target_path = Path.cwd()
    else:
        clean = cwd.strip()
        if "\x00" in clean or any(ord(c) < 32 for c in clean):
            raise HTTPException(status_code=400, detail="Chemin de travail invalide.")
        try:
            target_path = Path(clean).resolve()
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Chemin de travail invalide : {e}")

    if is_blocked_sensitive_path(target_path):
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : chemin de travail pointant vers un emplacement sensible.",
        )
    allowed_roots = get_allowed_workspace_roots()
    if not is_safe_path(target_path, allowed_roots):
        raise HTTPException(
            status_code=403,
            detail="Accès refusé : répertoire en dehors des racines de travail autorisées.",
        )
    if not target_path.is_dir():
        raise HTTPException(status_code=404, detail="Dossier de travail introuvable.")
    return str(target_path)


class ExecuteCodeRequest(BaseModel):
    session_id: str | None = "default"
    code: str
    cwd: str | None = "."
    timeout: int | None = 30


class ResetKernelRequest(BaseModel):
    session_id: str | None = "default"
    cwd: str | None = None


@router.get("/status")
def api_kernel_status(_=Depends(require_auth)):
    """List all active persistent kernels."""
    kernels = list_active_kernels()
    return {"active_kernels": kernels, "total": len(kernels)}


@router.post("/execute")
def api_execute_kernel(req: ExecuteCodeRequest, _=Depends(require_auth)):
    """Execute a code cell inside the persistent kernel."""
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="Le code à exécuter ne peut pas être vide.")
    safe_cwd = _validate_safe_kernel_cwd(req.cwd)
    kernel = get_or_create_kernel(req.session_id or "default", safe_cwd)
    effective_timeout = max(1, min(req.timeout or 30, 300))
    result = kernel.execute(req.code, timeout=effective_timeout)
    return result


@router.post("/reset")
def api_reset_kernel(req: ResetKernelRequest, _=Depends(require_auth)):
    """Reset kernel state and execution count."""
    safe_cwd = _validate_safe_kernel_cwd(req.cwd) if req.cwd is not None else None
    kernel = get_or_create_kernel(req.session_id or "default")
    kernel.reset(new_cwd=safe_cwd)
    return {
        "success": True,
        "session_id": kernel.session_id,
        "execution_count": kernel.execution_count,
        "message": "Kernel réinitialisé avec succès.",
    }


@router.delete("/{session_id}")
def api_stop_kernel(session_id: str, _=Depends(require_auth)):
    """Terminate and destroy a persistent kernel session."""
    stopped = stop_kernel(session_id)
    return {"success": stopped, "session_id": session_id}
