"""
backend/app/api/tool_repair.py — Endpoints API pour le diagnostic et la réparation d'appels d'outils.
"""

from typing import Any, Dict, List, Optional
from fastapi import APIRouter
from pydantic import BaseModel

from app.services.tool_repair import tool_repair_engine

router = APIRouter(prefix="/api/tools", tags=["tools"])


class ToolRepairRequest(BaseModel):
    text: str
    allowed_tools: Optional[List[str]] = None
    promote_shell: bool = True


@router.post("/repair")
def repair_tool_calls(req: ToolRepairRequest) -> Dict[str, Any]:
    """Analyse et répare les appels d'outils émis sous forme de markdown ou JSON mal formé."""
    cleaned_text, tool_calls, was_repaired = tool_repair_engine.repair_and_extract(
        raw_text=req.text,
        allowed_tools=req.allowed_tools,
        promote_shell=req.promote_shell,
    )
    return {
        "cleaned_text": cleaned_text,
        "tool_calls": tool_calls,
        "was_repaired": was_repaired,
        "repaired_count": len(tool_calls),
    }


@router.get("/repair/stats")
def get_repair_stats() -> Dict[str, Any]:
    """Renvoie les statistiques du moteur de normalisation et réparation."""
    return tool_repair_engine.get_stats()
