import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.execution_manager import execution_manager
from app.services.session_metadata import (
    bulk_update_session_meta,
    bulk_update_session_meta_batch,
    get_all_session_metadata,
    get_session_meta,
    update_session_meta,
)
from app.services.storage import (
    bulk_delete_conversations,
    calculate_conversation_tokens,
    create_conversation_handoff,
    delete_conversation,
    export_conversation_html,
    export_conversation_markdown,
    fork_conversation,
    get_conversation_by_id,
    get_conversation_transcript,
    import_conversation,
    is_safe_conversation_id,
    list_conversations,
    search_conversations,
    undo_conversation_turn,
    update_conversation_title,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])
logger = logging.getLogger(__name__)

class ForkRequest(BaseModel):
    up_to_step_index: int
    new_title: str | None = None

class HandoffRequest(BaseModel):
    new_title: str | None = None

class TitleUpdateRequest(BaseModel):
    title: str

class MetadataUpdateRequest(BaseModel):
    pinned: bool | None = None
    archived: bool | None = None
    tags: list[str] | None = None
    project: str | None = None
    projectColor: str | None = None
    customTitle: str | None = None

@router.get("", response_model=list[dict[str, Any]])
def get_conversations(limit: int = 100, q: str | None = None, _ = Depends(require_auth)):
    running_set = set(execution_manager.get_running_conversations())
    if q and q.strip():
        items = search_conversations(query=q.strip(), limit=limit)
    else:
        items = list_conversations(limit=limit)
    for c in items:
        c["is_running"] = c.get("conversation_id") in running_set
    return items

@router.get("/search", response_model=list[dict[str, Any]])
def search(q: str = Query(..., min_length=1), limit: int = 50, _ = Depends(require_auth)):
    items = search_conversations(query=q, limit=limit)
    running_set = set(execution_manager.get_running_conversations())
    for c in items:
        c["is_running"] = c.get("conversation_id") in running_set
    return items

class BulkActionRequest(BaseModel):
    action: str  # "delete", "pin", "unpin", "tag", "project"
    conversation_ids: list[str]
    payload: dict[str, Any] | None = None

@router.post("/bulk")
async def bulk_conversations(req: BulkActionRequest, _ = Depends(require_auth)):
    action = req.action
    ids = req.conversation_ids
    if len(ids) > 500:
        raise HTTPException(status_code=400, detail="Nombre maximal de conversations dépassé pour une action groupée (max 500).")
    if not ids:
        return {"success": True, "action": action, "count": 0, "results": {}}
    for cid in ids:
        if not is_safe_conversation_id(cid):
            raise HTTPException(status_code=400, detail=f"Identifiant de conversation non valide : {cid}")
    results = {}

    if action == "delete":
        for cid in ids:
            try:
                await execution_manager.interrupt(cid)
                execution_manager.remove_session(cid)
            except Exception as e:
                logger.debug(f"Ignored error: {e}")
        try:
            await asyncio.to_thread(bulk_delete_conversations, ids)
            for cid in ids:
                results[cid] = True
            return {"success": True, "action": action, "count": len(ids), "results": results}
        except Exception as e:
            logger.error(f"Erreur lors de la suppression groupée: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Échec de la suppression groupée: {e}")

    elif action in ("pin", "unpin"):
        pinned = (action == "pin")
        try:
            bulk_update_session_meta(ids, {"pinned": pinned})
            for cid in ids:
                results[cid] = True
            return {"success": True, "action": action, "count": len(ids), "results": results}
        except Exception as e:
            logger.error(f"Erreur lors de l'épinglage groupé: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Échec de l'épinglage groupé: {e}")

    elif action in ("archive", "unarchive"):
        archived = (action == "archive")
        try:
            bulk_update_session_meta(ids, {"archived": archived})
            for cid in ids:
                results[cid] = True
            return {"success": True, "action": action, "count": len(ids), "results": results}
        except Exception as e:
            logger.error(f"Erreur lors de l'archivage groupé: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Échec de l'archivage groupé: {e}")

    elif action == "tag":
        raw_tags = req.payload.get("tags", []) if req.payload else []
        tags = [t.strip() for t in raw_tags if isinstance(t, str) and t.strip()] if isinstance(raw_tags, list) else []
        mode = req.payload.get("mode", "add") if req.payload else "add"
        updates_per_id = {}
        for cid in ids:
            if mode == "replace":
                merged = list(dict.fromkeys(tags))
            else:
                current_meta = get_session_meta(cid)
                existing_raw = current_meta.get("tags") or []
                existing_tags = [t.strip() for t in existing_raw if isinstance(t, str) and t.strip()] if isinstance(existing_raw, list) else []
                merged = list(dict.fromkeys(existing_tags + tags))
            updates_per_id[cid] = {"tags": merged}
        
        try:
            bulk_update_session_meta_batch(updates_per_id)
            for cid in ids:
                results[cid] = True
            return {"success": True, "action": action, "count": len(ids), "results": results}
        except Exception as e:
            logger.error(f"Erreur lors de l'application groupée des tags: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Échec lors de l'application groupée des tags: {e}")

    elif action == "project":
        payload = req.payload or {}
        updates: dict[str, Any] = {}
        if "project" in payload:
            updates["project"] = payload.get("project") or ""
        if "projectColor" in payload:
            updates["projectColor"] = payload.get("projectColor") or ""
        
        try:
            bulk_update_session_meta(ids, updates)
            for cid in ids:
                results[cid] = True
            return {"success": True, "action": action, "count": len(ids), "results": results}
        except Exception as e:
            logger.error(f"Erreur lors de l'assignation groupée de projet: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Échec lors de l'assignation groupée de projet: {e}")
    elif action == "export":
        return await asyncio.to_thread(_do_bulk_export, req)
    else:
        raise HTTPException(status_code=400, detail=f"Action non supportée: {action}")

def _do_bulk_export(req: "BulkActionRequest") -> Response:
    """Internal bulk export logic (auth already verified by caller)."""
    import json
    import time
    if len(req.conversation_ids) > 500:
        raise HTTPException(status_code=400, detail="Nombre maximal de conversations dépassé pour un export groupé (max 500).")
    ids = [cid for cid in req.conversation_ids if is_safe_conversation_id(cid)]
    exported = []
    for cid in ids:
        try:
            steps = get_conversation_transcript(cid)
            meta = get_session_meta(cid)
            conv_record = get_conversation_by_id(cid)
            exported.append({
                "conversation_id": cid,
                "title": (conv_record or {}).get("title") or meta.get("customTitle") or cid,
                "metadata": meta,
                "steps": steps
            })
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    return Response(
        content=json.dumps({"exported_at": time.time(), "count": len(exported), "conversations": exported}, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="antigravity_bulk_export.json"'
        }
    )

@router.post("/bulk/export")
def bulk_export(req: BulkActionRequest, _ = Depends(require_auth)):
    return _do_bulk_export(req)

@router.get("/metadata")
def get_all_metadata(_ = Depends(require_auth)):
    return get_all_session_metadata()

@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    transcript = get_conversation_transcript(conversation_id)
    meta = get_conversation_by_id(conversation_id) or get_session_meta(conversation_id)
    usage = calculate_conversation_tokens(transcript)
    is_running = execution_manager.is_running(conversation_id)
    return {
        "conversation_id": conversation_id,
        "meta": meta,
        "steps": transcript,
        "usage": usage,
        "is_running": is_running
    }

@router.post("/{conversation_id}/fork")
def fork(conversation_id: str, req: ForkRequest, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        result = fork_conversation(
            source_conversation_id=conversation_id,
            up_to_step_index=req.up_to_step_index,
            new_title=req.new_title
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/{conversation_id}/handoff")
def handoff(conversation_id: str, req: HandoffRequest | None = None, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        new_title = req.new_title if req else None
        result = create_conversation_handoff(
            source_conversation_id=conversation_id,
            new_title=new_title
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.put("/{conversation_id}/title")
def rename_conversation(conversation_id: str, req: TitleUpdateRequest, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Le titre ne peut pas être vide")
    success = update_conversation_title(conversation_id, req.title.strip())
    return {"success": success, "conversation_id": conversation_id, "title": req.title.strip()}

@router.put("/{conversation_id}/metadata")
def update_metadata(conversation_id: str, req: MetadataUpdateRequest, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    updates = req.model_dump(exclude_unset=True)
    if "tags" in updates and isinstance(updates["tags"], list):
        updates["tags"] = [t.strip() for t in updates["tags"] if isinstance(t, str) and t.strip()]
    updated = update_session_meta(conversation_id, updates)
    return {"success": True, "conversation_id": conversation_id, "metadata": updated}

@router.delete("/{conversation_id}")
async def remove_conversation(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        await execution_manager.interrupt(conversation_id)
        execution_manager.remove_session(conversation_id)
    except Exception as e:
        logger.debug(f"Ignored error: {e}")
    success = await asyncio.to_thread(delete_conversation, conversation_id)
    return {"success": success, "conversation_id": conversation_id}

@router.post("/{conversation_id}/undo")
def undo_turn(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    if execution_manager.is_running(conversation_id):
        raise HTTPException(
            status_code=400,
            detail="Impossible d'annuler un tour pendant qu'une tâche est en cours d'exécution. Veuillez d'abord l'interrompre."
        )
    try:
        res = undo_conversation_turn(conversation_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{conversation_id}/export/html")
def export_html(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    html_content = export_conversation_html(conversation_id)
    return Response(
        content=html_content,
        media_type="text/html",
        headers={
            "Content-Disposition": f'attachment; filename="antigravity_{conversation_id[:8]}.html"'
        }
    )

@router.get("/{conversation_id}/export/markdown")
def export_markdown(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    md_content = export_conversation_markdown(conversation_id)
    return Response(
        content=md_content,
        media_type="text/markdown",
        headers={
            "Content-Disposition": f'attachment; filename="antigravity_{conversation_id[:8]}.md"'
        }
    )

@router.get("/{conversation_id}/export/json")
def export_json(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    steps = get_conversation_transcript(conversation_id)
    meta = get_conversation_by_id(conversation_id) or get_session_meta(conversation_id)
    export_payload = {
        "conversation_id": conversation_id,
        "metadata": meta,
        "steps": steps
    }
    import json
    return Response(
        content=json.dumps(export_payload, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="antigravity_{conversation_id[:8]}.json"'
        }
    )

@router.post("/import")
def import_session(payload: Any = Body(...), _ = Depends(require_auth)):
    try:
        if not isinstance(payload, (dict, list)):
            raise TypeError("Le payload doit être un objet JSON ou une liste d'objets JSON")
        res = import_conversation(payload)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Échec de l'import : {e!s}")

