from fastapi import APIRouter, HTTPException, Query, Response, Depends
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.api.auth import require_auth
from app.services.storage import (
    list_conversations,
    get_conversation_by_id,
    get_conversation_transcript,
    calculate_conversation_tokens,
    fork_conversation,
    delete_conversation,
    search_conversations,
    update_conversation_title,
    export_conversation_html,
    export_conversation_markdown,
)
from app.services.session_metadata import (
    get_all_session_metadata,
    get_session_meta,
    update_session_meta
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

class ForkRequest(BaseModel):
    up_to_step_index: int
    new_title: Optional[str] = None

class TitleUpdateRequest(BaseModel):
    title: str

class MetadataUpdateRequest(BaseModel):
    pinned: Optional[bool] = None
    tags: Optional[List[str]] = None
    project: Optional[str] = None
    projectColor: Optional[str] = None
    customTitle: Optional[str] = None

@router.get("", response_model=List[Dict[str, Any]])
def get_conversations(limit: int = 100, q: Optional[str] = None, _ = Depends(require_auth)):
    if q and q.strip():
        return search_conversations(query=q.strip(), limit=limit)
    return list_conversations(limit=limit)

@router.get("/search", response_model=List[Dict[str, Any]])
def search(q: str = Query(..., min_length=1), limit: int = 50, _ = Depends(require_auth)):
    return search_conversations(query=q, limit=limit)

@router.get("/metadata")
def get_all_metadata(_ = Depends(require_auth)):
    return get_all_session_metadata()

@router.get("/{conversation_id}")
def get_conversation(conversation_id: str, _ = Depends(require_auth)):
    transcript = get_conversation_transcript(conversation_id)
    meta = get_conversation_by_id(conversation_id) or get_session_meta(conversation_id)
    usage = calculate_conversation_tokens(transcript)
    return {
        "conversation_id": conversation_id,
        "meta": meta,
        "steps": transcript,
        "usage": usage
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
