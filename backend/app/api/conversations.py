import asyncio
import logging
from typing import Any

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.context_budget import (
    enforce_context_budget,
    get_conversation_context_budget_info,
)
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
    compact_conversation_in_place,
    create_conversation_handoff,
    delete_conversation,
    export_conversation_html,
    export_conversation_markdown,
    fork_conversation,
    get_conversation_branch_tree,
    get_conversation_by_id,
    get_conversation_transcript,
    import_conversation,
    is_safe_conversation_id,
    list_conversations,
    prune_conversation_steps,
    search_conversations,
    undo_conversation_turn,
    update_conversation_summary_fields,
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

class BookmarkCreateRequest(BaseModel):
    step_index: int
    label: str
    preview: str | None = None

class MetadataUpdateRequest(BaseModel):
    pinned: bool | None = None
    archived: bool | None = None
    tags: list[str] | None = None
    project: str | None = None
    projectColor: str | None = None
    customTitle: str | None = None
    groupId: str | None = None
    group_id: str | None = None
    projectId: str | None = None
    project_id: str | None = None
    bookmarks: list[dict[str, Any]] | None = None

@router.get("", response_model=list[dict[str, Any]])
def get_conversations(limit: int = Query(100, ge=1, le=1000), q: str | None = None, _ = Depends(require_auth)):
    running_set = set(execution_manager.get_running_conversations())
    if q and q.strip():
        items = search_conversations(query=q.strip(), limit=limit)
    else:
        items = list_conversations(limit=limit)
    for c in items:
        c["is_running"] = c.get("conversation_id") in running_set
    return items

@router.get("/search", response_model=list[dict[str, Any]])
def search(q: str = Query(..., min_length=1), limit: int = Query(50, ge=1, le=500), _ = Depends(require_auth)):
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
        if "project_id" in payload:
            updates["project_id"] = payload.get("project_id") or ""
        if "projectId" in payload:
            updates["project_id"] = payload.get("projectId") or ""
        if "projectColor" in payload:
            updates["projectColor"] = payload.get("projectColor") or ""
        if "group_id" in payload:
            updates["group_id"] = payload.get("group_id") or ""
        if "groupId" in payload:
            updates["group_id"] = payload.get("groupId") or ""

        try:
            bulk_update_session_meta(ids, updates)
            proj_val = updates["project_id"] if "project_id" in updates else updates.get("project")
            grp_val = updates.get("group_id")
            if proj_val is not None or grp_val is not None:
                for cid in ids:
                    try:
                        update_conversation_summary_fields(cid, project_id=proj_val, group_id=grp_val)
                    except Exception as e:
                        logger.debug(f"Ignored sync error: {e}")
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
    if not req.conversation_ids:
        raise HTTPException(status_code=400, detail="Aucun identifiant de conversation fourni pour l'export.")
    if len(req.conversation_ids) > 500:
        raise HTTPException(status_code=400, detail="Nombre maximal de conversations dépassé pour un export groupé (max 500).")
    for cid in req.conversation_ids:
        if not is_safe_conversation_id(cid):
            raise HTTPException(status_code=400, detail=f"Identifiant de conversation non valide : {cid}")
    ids = list(dict.fromkeys(req.conversation_ids))
    exported = []
    for cid in ids:
        try:
            steps = get_conversation_transcript(cid)
            meta = get_session_meta(cid) or {}
            conv_record = get_conversation_by_id(cid) or {}
            merged_meta = {**meta, **conv_record}
            exported.append({
                "conversation_id": cid,
                "title": conv_record.get("title") or meta.get("customTitle") or cid,
                "metadata": merged_meta,
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

def _do_zip_export(conversation_ids: list[str] | None = None) -> Response:
    """Export conversations as a ZIP archive of Markdown files."""
    import datetime
    import io
    import re
    import zipfile

    target_ids = conversation_ids if conversation_ids else []
    if not target_ids:
        all_convs = list_conversations(limit=500)
        target_ids = [c["conversation_id"] for c in all_convs if c.get("conversation_id")]

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        for cid in target_ids:
            if not is_safe_conversation_id(cid):
                continue
            try:
                md_content = export_conversation_markdown(cid)
                conv_info = get_conversation_by_id(cid) or get_session_meta(cid) or {}
                raw_title = conv_info.get("customTitle") or conv_info.get("title") or cid[:8]
                clean_title = re.sub(r'[^a-zA-Z0-9_\-\.]+', '_', raw_title).strip('_')[:40] or cid[:8]
                ts = conv_info.get("last_modified_time")
                date_prefix = "session"
                if ts:
                    if isinstance(ts, (int, float)):
                        val = ts / 1000.0 if ts > 10000000000 else ts
                        date_prefix = datetime.datetime.fromtimestamp(val).strftime("%Y%m%d")
                    elif isinstance(ts, str):
                        s = ts.strip()
                        if s.isdigit():
                            val = int(s)
                            val = val / 1000.0 if val > 10000000000 else val
                            date_prefix = datetime.datetime.fromtimestamp(val).strftime("%Y%m%d")
                        else:
                            try:
                                dt = datetime.datetime.fromisoformat(s.replace("Z", "+00:00"))
                                date_prefix = dt.strftime("%Y%m%d")
                            except Exception:
                                date_prefix = "session"
                filename = f"{date_prefix}_{clean_title}_{cid[:6]}.md"
                zip_file.writestr(filename, md_content)
            except Exception as e:
                logger.warning(f"Could not export conversation {cid} to zip: {e}")
                continue

    zip_buffer.seek(0)
    today_str = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
    return Response(
        content=zip_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="antigravity_archive_{today_str}.zip"'
        }
    )

@router.post("/export/zip")
def export_zip_archive_post(req: BulkActionRequest | None = None, _ = Depends(require_auth)):
    ids = req.conversation_ids if req else None
    return _do_zip_export(ids)

@router.get("/export/zip")
def export_zip_archive_get(_ = Depends(require_auth)):
    return _do_zip_export(None)

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

    title_val = updates.get("customTitle")
    project_val = updates.get("project_id") if "project_id" in updates else (updates.get("projectId") if "projectId" in updates else updates.get("project"))
    group_val = updates.get("group_id") if "group_id" in updates else updates.get("groupId")
    if (title_val is not None and str(title_val).strip()) or project_val is not None or group_val is not None:
        try:
            update_conversation_summary_fields(
                conversation_id,
                title=str(title_val).strip() if (title_val is not None and str(title_val).strip()) else None,
                project_id=str(project_val).strip() if project_val is not None else None,
                group_id=str(group_val).strip() if group_val is not None else None,
            )
        except Exception as e:
            logger.warning(f"Failed to sync conversation summary metadata for {conversation_id}: {e}")

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
        execution_manager.remove_session(conversation_id)
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
    session_meta = get_session_meta(conversation_id) or {}
    conv_meta = get_conversation_by_id(conversation_id) or {}
    merged_meta = {**session_meta, **conv_meta}
    export_payload = {
        "conversation_id": conversation_id,
        "metadata": merged_meta,
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


class CompactRequest(BaseModel):
    preserve_last_n_turns: int = 2

@router.post("/{conversation_id}/compact")
def compact_session(conversation_id: str, req: CompactRequest = Body(default_factory=CompactRequest), _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        res = compact_conversation_in_place(conversation_id, preserve_last_n_turns=req.preserve_last_n_turns)
        return res
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error compacting conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Échec du compactage : {e!s}")


class PruneRequest(BaseModel):
    step_indices: list[int] | None = None
    preserve_last_n_turns: int = 2

@router.post("/{conversation_id}/prune")
def prune_session(conversation_id: str, req: PruneRequest = Body(default_factory=PruneRequest), _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        res = prune_conversation_steps(
            conversation_id,
            step_indices=req.step_indices,
            preserve_last_n_turns=req.preserve_last_n_turns
        )
        return res
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error pruning conversation {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Échec de l'élagage : {e!s}")


@router.get("/{conversation_id}/context-budget")
def get_session_context_budget(
    conversation_id: str,
    budget_tokens: int | None = Query(None, description="Plafond de tokens à tester"),
    _ = Depends(require_auth)
):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        return get_conversation_context_budget_info(conversation_id, budget_tokens=budget_tokens)
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error getting context budget for {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Erreur d'analyse du budget de contexte : {e!s}")


class ContextBudgetEnforceRequest(BaseModel):
    budget_tokens: int | None = None
    preserve_last_n_turns: int | None = None


@router.post("/{conversation_id}/context-budget/enforce")
def enforce_session_context_budget(
    conversation_id: str,
    req: ContextBudgetEnforceRequest = Body(default_factory=ContextBudgetEnforceRequest),
    _ = Depends(require_auth)
):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        return enforce_context_budget(
            conversation_id,
            max_tokens=req.budget_tokens,
            preserve_last_n_turns=req.preserve_last_n_turns
        )
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error enforcing context budget for {conversation_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Échec de l'application du budget de contexte : {e!s}")


@router.get("/{conversation_id}/branches")
def get_branches(conversation_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    try:
        res = get_conversation_branch_tree(conversation_id)
        return res
    except Exception as e:
        logger.error(f"Error fetching branches for {conversation_id}: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Échec de récupération de l'arbre des branches: {e!s}")


@router.post("/{conversation_id}/bookmarks")
def add_bookmark(conversation_id: str, req: BookmarkCreateRequest, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    if not req.label.strip():
        raise HTTPException(status_code=400, detail="Le libellé du marque-page ne peut pas être vide")

    import time
    import uuid

    meta = get_session_meta(conversation_id) or {}
    existing_bms = meta.get("bookmarks") or []
    if not isinstance(existing_bms, list):
        existing_bms = []

    new_bm = {
        "id": f"bm-{int(time.time() * 1000)}-{uuid.uuid4().hex[:6]}",
        "step_index": req.step_index,
        "label": req.label.strip(),
        "preview": (req.preview or "").strip()[:200],
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    updated_bms = [b for b in existing_bms if isinstance(b, dict) and b.get("id") != new_bm["id"]]
    updated_bms.append(new_bm)
    updated_bms.sort(key=lambda x: x.get("step_index", 0))

    update_session_meta(conversation_id, {"bookmarks": updated_bms})
    return {"success": True, "bookmark": new_bm, "bookmarks": updated_bms}


@router.delete("/{conversation_id}/bookmarks/{bookmark_id}")
def remove_bookmark(conversation_id: str, bookmark_id: str, _ = Depends(require_auth)):
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Identifiant de conversation non valide")
    meta = get_session_meta(conversation_id) or {}
    existing_bms = meta.get("bookmarks") or []
    if not isinstance(existing_bms, list):
        existing_bms = []

    filtered = [b for b in existing_bms if isinstance(b, dict) and b.get("id") != bookmark_id]
    update_session_meta(conversation_id, {"bookmarks": filtered})
    return {"success": True, "bookmarks": filtered}



