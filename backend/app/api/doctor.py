"""FastAPI router for System Doctor and Diagnostics."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.services.doctor import run_auto_repair, run_system_diagnostics

router = APIRouter(prefix="/api/doctor", tags=["System Doctor"])


@router.get("/diagnose")
async def diagnose_system():
    try:
        report = await run_system_diagnostics()
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/repair")
async def execute_repair():
    try:
        result = await run_auto_repair()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
