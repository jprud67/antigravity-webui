"""Vector Memory & Auto-Recall API Router.

Endpoints to store, search, list, clear memories, execute auto-recall,
and configure embedding parameters.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.vector_memory import (
    AutoRecallConfig,
    MemoryCategory,
    MemoryEntry,
    MemorySearchInput,
    MemorySearchResult,
    MemoryStoreInput,
    RecallHookResult,
    clear_memories,
    delete_memory,
    execute_auto_recall_hook,
    get_auto_recall_config,
    list_memories,
    save_auto_recall_config,
    search_memories,
    store_memory,
)

router = APIRouter(prefix="/api/memory/vector", tags=["Vector Memory"])


class RecallRequest(BaseModel):
    prompt: str
    agent_id: str = "default"


class ClearRequest(BaseModel):
    agent_id: str = "default"


@router.post("/store", response_model=MemoryEntry)
async def api_store_memory(payload: MemoryStoreInput):
    """Stores a new memory entry with computed vector embedding."""
    try:
        entry = await store_memory(payload)
        return entry
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store memory: {e}")


@router.post("/search", response_model=list[MemorySearchResult])
async def api_search_memories(payload: MemorySearchInput):
    """Searches memories using semantic vector similarity."""
    try:
        results = await search_memories(payload)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Search failed: {e}")


@router.get("/list", response_model=list[MemoryEntry])
def api_list_memories(
    agent_id: str = Query("default", alias="agentId"),
    category: MemoryCategory | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Lists stored memories for an agent."""
    return list_memories(agent_id=agent_id, category=category, limit=limit)


@router.delete("/{memory_id}")
def api_delete_memory(memory_id: str):
    """Deletes a single memory entry."""
    success = delete_memory(memory_id)
    if not success:
        raise HTTPException(status_code=404, detail="Memory not found")
    return {"status": "ok", "deleted": memory_id}


@router.post("/recall", response_model=RecallHookResult)
async def api_execute_recall(payload: RecallRequest):
    """Executes the auto-recall hook for a user prompt."""
    try:
        return await execute_auto_recall_hook(payload.prompt, agent_id=payload.agent_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Auto-recall failed: {e}")


@router.get("/config", response_model=AutoRecallConfig)
def api_get_config():
    """Gets the current auto-recall and embedding configuration."""
    return get_auto_recall_config()


@router.put("/config", response_model=AutoRecallConfig)
def api_update_config(payload: AutoRecallConfig):
    """Updates auto-recall configuration."""
    save_auto_recall_config(payload)
    return payload


@router.post("/clear")
def api_clear_memories(payload: ClearRequest):
    """Clears all memories for an agent."""
    deleted_count = clear_memories(agent_id=payload.agent_id)
    return {"status": "ok", "deletedCount": deleted_count}
