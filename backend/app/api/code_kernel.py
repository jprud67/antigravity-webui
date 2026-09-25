"""API router for Persistent Code Kernel and Tool RPC."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.code_kernel import (
    get_or_create_kernel,
    stop_kernel,
    list_active_kernels,
)

router = APIRouter(prefix="/api/kernel", tags=["kernel"])


class ExecuteCodeRequest(BaseModel):
    session_id: Optional[str] = "default"
    code: str
    cwd: Optional[str] = "."
    timeout: Optional[int] = 30


class ResetKernelRequest(BaseModel):
    session_id: Optional[str] = "default"
    cwd: Optional[str] = None


@router.get("/status")
def api_kernel_status():
    """List all active persistent kernels."""
    kernels = list_active_kernels()
    return {"active_kernels": kernels, "total": len(kernels)}


@router.post("/execute")
def api_execute_kernel(req: ExecuteCodeRequest):
    """Execute a code cell inside the persistent kernel."""
    if not req.code.strip():
        raise HTTPException(status_code=400, detail="Le code à exécuter ne peut pas être vide.")
    kernel = get_or_create_kernel(req.session_id or "default", req.cwd or ".")
    result = kernel.execute(req.code, timeout=req.timeout or 30)
    return result


@router.post("/reset")
def api_reset_kernel(req: ResetKernelRequest):
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
def api_stop_kernel(session_id: str):
    """Terminate and destroy a persistent kernel session."""
    stopped = stop_kernel(session_id)
    return {"success": stopped, "session_id": session_id}
