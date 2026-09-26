"""API router for Persistent Code Kernel and Tool RPC."""


from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.code_kernel import (
    get_or_create_kernel,
    list_active_kernels,
    stop_kernel,
)

router = APIRouter(prefix="/api/kernel", tags=["kernel"])


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
    kernel = get_or_create_kernel(req.session_id or "default", req.cwd or ".")
    effective_timeout = max(1, min(req.timeout or 30, 300))
    result = kernel.execute(req.code, timeout=effective_timeout)
    return result


@router.post("/reset")
def api_reset_kernel(req: ResetKernelRequest, _=Depends(require_auth)):
    """Reset kernel state and execution count."""
    kernel = get_or_create_kernel(req.session_id or "default")
    kernel.reset(new_cwd=req.cwd)
    return {
        "success": True,
        "session_id": kernel.session_id,
        "execution_count": kernel.execution_count,
        "message": "Kernel réinitialisé avec succès."
    }


@router.delete("/{session_id}")
def api_stop_kernel(session_id: str, _=Depends(require_auth)):
    """Terminate and destroy a persistent kernel session."""
    stopped = stop_kernel(session_id)
    return {"success": stopped, "session_id": session_id}
