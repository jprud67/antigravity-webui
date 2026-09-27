import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.services.execution_manager import execution_manager
from app.services.inline_comments import (
    CommentCreatePayload,
    CommentUpdatePayload,
    create_comment,
    delete_comment,
    list_comments,
    update_comment,
)
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.inline_comments.api")

router = APIRouter(prefix="/api/comments", tags=["Inline Code Reviews"])


class TriggerReviewRequest(BaseModel):
    conversation_id: str
    file_path: str
    diff_or_code: str | None = None
    prompt: str = "Effectue une revue de code concise sur ce fichier, en identifiant les bugs, les optimisations de performance et les problèmes de sécurité."


@router.get("")
def get_comments(
    conversation_id: str = Query(..., description="ID of conversation"),
    file_path: str | None = Query(None, description="Optional file path filter"),
    user: dict[str, Any] = Depends(require_auth)
):
    """Lists inline comments for a conversation, optionally filtered by file."""
    if not is_safe_conversation_id(conversation_id):
        raise HTTPException(status_code=400, detail="Invalid conversation_id")
    return list_comments(conversation_id, file_path)


@router.post("")
async def post_comment(
    payload: CommentCreatePayload,
    user: dict[str, Any] = Depends(require_auth)
):
    """Creates a new line-anchored comment. Broadcasts comment_created event via WebSocket."""
    if not is_safe_conversation_id(payload.conversation_id):
        raise HTTPException(status_code=400, detail="Invalid conversation_id")

    try:
        comment = create_comment(payload)

        # Broadcast via WebSocket to all session participants
        session = execution_manager.get_session(payload.conversation_id)
        if session:
            await session.broadcast({
                "event": "comment_created",
                "conversation_id": payload.conversation_id,
                "comment": comment
            })

        # If @agent was mentioned in comment, queue steering / review prompt to agent
        if comment.get("has_agent_mention"):
            try:
                review_instruction = (
                    f"[REVUE DE CODE INLINE - Ligne {comment['line_number']} de {comment['file_path']}]\n"
                    f"Auteur: {comment['author']}\n"
                    f"Commentaire: {comment['content']}\n"
                    f"Instruction: Analyse cette demande et propose une solution ou correction ciblée."
                )
                from app.services.agent_orchestrator import steer_agent
                steer_agent(payload.conversation_id, "root_" + payload.conversation_id, review_instruction)
            except Exception as e:
                logger.debug(f"Failed to auto-steer agent for @agent comment: {e}")

        return comment
    except Exception as e:
        logger.error(f"Error creating comment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/{comment_id}")
async def patch_comment(
    comment_id: str,
    payload: CommentUpdatePayload,
    user: dict[str, Any] = Depends(require_auth)
):
    """Updates comment content or resolves/reopens it."""
    try:
        updated = update_comment(comment_id, payload)
        session = execution_manager.get_session(updated["conversation_id"])
        if session:
            await session.broadcast({
                "event": "comment_updated",
                "conversation_id": updated["conversation_id"],
                "comment": updated
            })
        return updated
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating comment: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{comment_id}")
async def remove_comment(
    comment_id: str,
    conversation_id: str = Query(..., description="ID of conversation"),
    user: dict[str, Any] = Depends(require_auth)
):
    """Deletes an inline comment."""
    success = delete_comment(comment_id)
    if not success:
        raise HTTPException(status_code=404, detail="Comment not found")

    session = execution_manager.get_session(conversation_id)
    if session:
        await session.broadcast({
            "event": "comment_deleted",
            "conversation_id": conversation_id,
            "comment_id": comment_id
        })
    return {"success": True, "comment_id": comment_id}


@router.post("/trigger-review")
async def trigger_file_review(
    req: TriggerReviewRequest,
    user: dict[str, Any] = Depends(require_auth)
):
    """Triggers an automated code review on a file with @agent, generating inline review comments."""
    if not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(status_code=400, detail="Invalid conversation_id")

    instruction = (
        f"Demande de revue de code contextuelle pour le fichier `{req.file_path}`:\n"
        f"{req.prompt}\n"
    )
    if req.diff_or_code:
        instruction += f"\nExtrait / Diff à examiner:\n```\n{req.diff_or_code[:4000]}\n```"

    try:
        from app.services.agent_orchestrator import steer_agent
        res = steer_agent(req.conversation_id, "root_" + req.conversation_id, instruction)
        return {"success": True, "review_queued": True, "details": res}
    except Exception as e:
        logger.error(f"Error triggering review: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to trigger review: {e}")
