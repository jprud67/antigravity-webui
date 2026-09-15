from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.session_metadata import (
    get_all_session_metadata,
    get_session_meta,
    update_session_meta,
)
from app.services.storage import (
    calculate_conversation_tokens,
    create_conversation_handoff,
    delete_conversation,
    export_conversation_html,
    export_conversation_markdown,
    fork_conversation,
    get_conversation_by_id,
    get_conversation_transcript,
    import_conversation,
    list_conversations,
    search_conversations,
    undo_conversation_turn,
    update_conversation_title,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

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
    from app.services.execution_manager import execution_manager
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
    return search_conversations(query=q, limit=limit)

class BulkActionRequest(BaseModel):
    action: str  # "delete", "pin", "unpin", "tag", "project"
    conversation_ids: list[str]
    payload: dict[str, Any] | None = None

@router.post("/bulk")
def bulk_conversations(req: BulkActionRequest, _ = Depends(require_auth)):
    action = req.action
    ids = req.conversation_ids
    results = {}

    if action == "delete":
        for cid in ids:
            try:
                delete_conversation(cid)
                results[cid] = True
            except Exception:
                results[cid] = False
        return {"success": True, "action": action, "count": len(ids), "results": results}

    elif action in ("pin", "unpin"):
        pinned = (action == "pin")
        for cid in ids:
            try:
                update_session_meta(cid, {"pinned": pinned})
                results[cid] = True
            except Exception:
                results[cid] = False
        return {"success": True, "action": action, "count": len(ids), "results": results}

    elif action in ("archive", "unarchive"):
        archived = (action == "archive")
        for cid in ids:
            try:
                update_session_meta(cid, {"archived": archived})
                results[cid] = True
            except Exception:
                results[cid] = False
        return {"success": True, "action": action, "count": len(ids), "results": results}

    elif action == "tag":
        tags = req.payload.get("tags", []) if req.payload else []
        mode = req.payload.get("mode", "add") if req.payload else "add"
        for cid in ids:
            try:
                if mode == "replace":
                    merged = list(dict.fromkeys(tags))
                else:
                    current_meta = get_session_meta(cid)
                    existing_tags = current_meta.get("tags") or []
                    merged = list(dict.fromkeys(existing_tags + tags))
                update_session_meta(cid, {"tags": merged})
                results[cid] = True
            except Exception:
                results[cid] = False
        return {"success": True, "action": action, "count": len(ids), "results": results}

    elif action == "project":
        payload = req.payload or {}
        updates: dict[str, Any] = {}
        if "project" in payload:
            updates["project"] = payload.get("project") or ""
        if "projectColor" in payload:
            # Key-presence based so an empty color can explicitly clear the project color
            updates["projectColor"] = payload.get("projectColor") or ""
        for cid in ids:
            try:
                update_session_meta(cid, updates)
                results[cid] = True
            except Exception:
                results[cid] = False
        return {"success": True, "action": action, "count": len(ids), "results": results}

    else:
        raise HTTPException(status_code=400, detail=f"Action non supportée: {action}")

@router.post("/bulk/export")
def bulk_export(req: BulkActionRequest, _ = Depends(require_auth)):
    import json
    import time
    ids = req.conversation_ids
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
        except Exception:
            pass

    return Response(
        content=json.dumps({"exported_at": time.time(), "count": len(exported), "conversations": exported}, indent=2, ensure_ascii=False),
        media_type="application/json",
        headers={
            "Content-Disposition": 'attachment; filename="antigravity_bulk_export.json"'
        }
    )

@router.get("/metadata")
def get_all_metadata(_ = Depends(require_auth)):
    return get_all_session_metadata()

@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, _ = Depends(require_auth)):
    transcript = get_conversation_transcript(conversation_id)
    meta = get_conversation_by_id(conversation_id) or get_session_meta(conversation_id)
    usage = calculate_conversation_tokens(transcript)
    from app.services.execution_manager import execution_manager
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
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Le titre ne peut pas être vide")
    success = update_conversation_title(conversation_id, req.title.strip())
    return {"success": success, "conversation_id": conversation_id, "title": req.title.strip()}

@router.put("/{conversation_id}/metadata")
def update_metadata(conversation_id: str, req: MetadataUpdateRequest, _ = Depends(require_auth)):
    updates = req.model_dump(exclude_unset=True)
    updated = update_session_meta(conversation_id, updates)
    return {"success": True, "conversation_id": conversation_id, "metadata": updated}

@router.delete("/{conversation_id}")
def remove_conversation(conversation_id: str, _ = Depends(require_auth)):
    success = delete_conversation(conversation_id)
    return {"success": success, "conversation_id": conversation_id}

@router.post("/{conversation_id}/undo")
def undo_turn(conversation_id: str, _ = Depends(require_auth)):
    try:
        res = undo_conversation_turn(conversation_id)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/{conversation_id}/export/html")
def export_html(conversation_id: str, _ = Depends(require_auth)):
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
def import_session(payload: dict[str, Any], _ = Depends(require_auth)):
    try:
        res = import_conversation(payload)
        return res
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Échec de l'import : {e!s}")

