import asyncio
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.services.agy_driver import (
    get_credits,
    get_model_families,
    get_usage_quota,
    stream_turn,
)
from app.services.execution_manager import execution_manager
from app.services.google_auth import get_active_account
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.agent_api")
router = APIRouter(prefix="/api/v1/agent", tags=["agent-api"])


# ============================================================================
# Request / Response Schemas
# ============================================================================

class AgentRunRequest(BaseModel):
    prompt: str = Field(..., description="L'instruction ou la tâche pour l'agent Antigravity")
    conversation_id: str | None = Field(None, description="ID de session existante pour continuer une conversation")
    workspace_path: str | None = Field(None, description="Répertoire de travail (dossier du projet)")
    model: str | None = Field(None, description="Modèle (ex: gemini-3.8-flash, claude-sonnet-4-6)")
    effort: str | None = Field(None, description="Niveau de réflexion (low, medium, high)")
    auto_approve: bool = Field(True, description="Approuver automatiquement les outils sans blocage")
    agent_mode: str | None = Field(None, description="Mode d'exécution : 'plan' ou 'accept-edits'")
    stream: bool = Field(True, description="Streaming en temps réel (Server-Sent Events)")


class AgentInterruptRequest(BaseModel):
    conversation_id: str | None = Field(None, description="ID de la conversation à interrompre")


class AgentSteerRequest(BaseModel):
    conversation_id: str | None = Field(None, description="ID de la conversation à réorienter")
    instruction: str = Field(..., description="Nouvelle consigne prioritaire à injecter")


class AgentInputRequest(BaseModel):
    conversation_id: str = Field(..., description="ID de la session à laquelle envoyer l'entrée ou la réponse")
    text: str = Field(..., description="Texte de la réponse ou commande envoyée sur stdin")


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/status")
async def get_agent_status(_: bool = Depends(require_auth)):
    """
    Retourne l'état complet du serveur Antigravity :
    Quotas Google Cloud, crédits G1, compte Google actif, sessions en cours.
    """
    quota_task = asyncio.create_task(get_usage_quota())
    credits_task = asyncio.create_task(get_credits())

    try:
        quota, credits_info = await asyncio.gather(quota_task, credits_task)
    except Exception as e:
        logger.warning(f"Erreur lors de la récupération des statuts: {e}")
        quota = {}
        credits_info = {}

    active_acc = get_active_account()
    running_cids = execution_manager.get_running_conversations()

    return {
        "status": "ready",
        "service": "antigravity-webui",
        "active_google_account": active_acc.get("email") if active_acc else None,
        "running_conversations": running_cids,
        "running_count": len(running_cids),
        "default_workspace": DEFAULT_WORKSPACE,
        "quotas": quota,
        "credits": credits_info,
    }


@router.get("/models")
async def get_agent_models(_: bool = Depends(require_auth)):
    """Retourne les familles de modèles avec tous leurs efforts et variantes."""
    families = await get_model_families()
    return {"models": families}


@router.post("/run")
async def run_agent_turn(
    req: AgentRunRequest,
    _: bool = Depends(require_auth)
):
    """
    Lance un tour d'agent Antigravity complet.
    En mode `stream=true`, émet des événements SSE typés :
    - `init`: conversation_id
    - `thought`: pensées internes de réflexion
    - `text_delta`: fragments de la réponse finale
    - `tool_call`: début d'exécution d'un outil
    - `tool_result`: résultat d'un outil exécuté
    - `usage`: tokens consommés
    - `error`: message d'erreur
    - `done`: fin de tour avec récapitulatif complet
    """
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le paramètre 'prompt' est obligatoire et ne peut être vide."
        )
    if req.conversation_id and not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'identifiant de conversation (conversation_id) est invalide."
        )

    # 1. Mode Streaming SSE
    if req.stream:
        async def agent_sse_generator() -> AsyncGenerator[str, None]:
            active_cid = req.conversation_id
            full_text = []
            full_thought = []
            tool_calls: list[dict[str, Any]] = []
            usage_stats: dict[str, Any] = {}
            had_error = False

            try:
                async for event in stream_turn(
                    prompt=prompt,
                    conversation_id=active_cid,
                    workspace_path=req.workspace_path,
                    model=req.model,
                    effort=req.effort,
                    auto_approve=req.auto_approve,
                    agent_mode=req.agent_mode
                ):
                    evt_type = event.get("event")

                    if evt_type == "init":
                        active_cid = event.get("conversation_id")
                        yield f"event: init\ndata: {json.dumps({'conversation_id': active_cid}, ensure_ascii=False)}\n\n"

                    elif evt_type == "step_update":
                        su = event.get("step_update", {})
                        cid = su.get("conversation_id")
                        if cid and not active_cid:
                            active_cid = cid
                            yield f"event: init\ndata: {json.dumps({'conversation_id': active_cid}, ensure_ascii=False)}\n\n"

                        # Pensée
                        if su.get("thinking"):
                            th = su["thinking"]
                            full_thought.append(th)
                            yield f"event: thought\ndata: {json.dumps({'delta': th, 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"

                        # Texte réponse
                        if su.get("step_type") == "agent_response" and su.get("text_delta"):
                            td = su["text_delta"]
                            full_text.append(td)
                            yield f"event: text_delta\ndata: {json.dumps({'delta': td, 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"

                        # Outil
                        if su.get("step_type") == "tool":
                            tool_name = su.get("tool_name") or su.get("tool_info", {}).get("name")
                            tool_id = su.get("tool_id") or su.get("tool_info", {}).get("id")
                            tool_args = su.get("tool_info", {}).get("parameters") or su.get("parameters")
                            tool_out = su.get("tool_info", {}).get("output")
                            is_done = su.get("state") == "DONE"

                            if is_done and tool_out is not None:
                                yield f"event: tool_result\ndata: {json.dumps({'id': tool_id, 'name': tool_name, 'output': tool_out, 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"
                            else:
                                tool_payload = {'id': tool_id, 'name': tool_name, 'args': tool_args, 'conversation_id': active_cid}
                                tool_calls.append(tool_payload)
                                yield f"event: tool_call\ndata: {json.dumps(tool_payload, ensure_ascii=False)}\n\n"

                        # Quota / Usage
                        if su.get("usage"):
                            usage_stats = su["usage"]
                            yield f"event: usage\ndata: {json.dumps(usage_stats, ensure_ascii=False)}\n\n"

                    elif evt_type == "result":
                        res = event.get("result", {})
                        resp_text = res.get("response")
                        if resp_text and not full_text:
                            full_text.append(resp_text)
                            yield f"event: text_delta\ndata: {json.dumps({'delta': resp_text, 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"
                        if res.get("usage"):
                            usage_stats = res["usage"]
                            yield f"event: usage\ndata: {json.dumps(usage_stats, ensure_ascii=False)}\n\n"

                    elif evt_type == "error":
                        had_error = True
                        err_msg = event.get("message") or "Erreur CLI Antigravity"
                        yield f"event: error\ndata: {json.dumps({'error': err_msg, 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"
                        break

            except Exception as e:
                had_error = True
                logger.error(f"Erreur durant l'exécution SSE de l'agent: {e}")
                yield f"event: error\ndata: {json.dumps({'error': str(e), 'conversation_id': active_cid}, ensure_ascii=False)}\n\n"

            # Événement de fin de tour 'done'
            done_payload = {
                "conversation_id": active_cid,
                "text": "".join(full_text).strip(),
                "thought": "".join(full_thought).strip() or None,
                "tool_calls_count": len(tool_calls),
                "usage": usage_stats,
                "status": "error" if had_error else "completed"
            }
            yield f"event: done\ndata: {json.dumps(done_payload, ensure_ascii=False)}\n\n"

        return StreamingResponse(
            agent_sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    # 2. Mode Synchrone (JSON complet)
    active_cid = req.conversation_id
    full_text = []
    full_thought = []
    tool_calls: list[dict[str, Any]] = []
    usage_stats: dict[str, Any] = {}

    try:
        async for event in stream_turn(
            prompt=prompt,
            conversation_id=active_cid,
            workspace_path=req.workspace_path,
            model=req.model,
            effort=req.effort,
            auto_approve=req.auto_approve,
            agent_mode=req.agent_mode
        ):
            evt_type = event.get("event")
            if evt_type == "init":
                active_cid = event.get("conversation_id")
            elif evt_type == "step_update":
                su = event.get("step_update", {})
                cid = su.get("conversation_id")
                if cid and not active_cid:
                    active_cid = cid
                if su.get("thinking"):
                    full_thought.append(su["thinking"])
                if su.get("step_type") == "agent_response" and su.get("text_delta"):
                    full_text.append(su["text_delta"])
                if su.get("step_type") == "tool":
                    tool_calls.append({
                        "name": su.get("tool_name") or su.get("tool_info", {}).get("name"),
                        "args": su.get("tool_info", {}).get("parameters") or su.get("parameters"),
                        "output": su.get("tool_info", {}).get("output")
                    })
                if su.get("usage"):
                    usage_stats = su["usage"]
            elif evt_type == "result":
                res = event.get("result", {})
                resp = res.get("response")
                if resp and not full_text:
                    full_text.append(resp)
                if res.get("usage"):
                    usage_stats = res["usage"]
            elif evt_type == "error":
                raise RuntimeError(event.get("message") or "Erreur CLI Antigravity")

    except HTTPException:
        raise  # Laisser passer les HTTPException déjà construites
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Erreur durant l'exécution synchrone agent API: {err_msg}")
        # Détection quota Google Cloud (RESOURCE_EXHAUSTED 429)
        quota_keywords = ("RESOURCE_EXHAUSTED", "quota reached", "Individual quota", "rate limit", "429", "RATE_LIMIT_EXCEEDED")
        if any(kw.lower() in err_msg.lower() for kw in quota_keywords):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": {
                        "code": "rate_limit_exceeded",
                        "message": "Quota Google Cloud épuisé. Antigravity bascule automatiquement entre les comptes disponibles. Réessayez dans quelques instants.",
                        "type": "quota_exceeded",
                        "source": "/api/v1/agent/run"
                    }
                },
                headers={"Retry-After": "60"}
            )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Échec de l'agent Antigravity: {err_msg}"
        )

    return {
        "status": "success",
        "conversation_id": active_cid,
        "text": "".join(full_text).strip(),
        "thought": "".join(full_thought).strip() or None,
        "tool_calls": tool_calls,
        "usage": usage_stats
    }


@router.post("/interrupt")
async def interrupt_agent(
    req: AgentInterruptRequest,
    _: bool = Depends(require_auth)
):
    """Interrompt immédiatement l'exécution en cours d'une session agent."""
    if req.conversation_id and not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'identifiant de conversation (conversation_id) est invalide."
        )
    await execution_manager.interrupt(req.conversation_id)
    return {
        "success": True,
        "message": f"Interruption déclenchée pour la session {req.conversation_id or 'active'}."
    }


@router.post("/steer")
async def steer_agent(
    req: AgentSteerRequest,
    _: bool = Depends(require_auth)
):
    """
    Injecte une consigne prioritaire de guidage (steer) dans une session en cours,
    ce qui réoriente immédiatement l'agent sans perdre le fil du dialogue.
    """
    if req.conversation_id and not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'identifiant de conversation (conversation_id) est invalide."
        )
    session = execution_manager.get_session(req.conversation_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Aucune session active trouvée pour l'ID {req.conversation_id}."
        )

    await execution_manager.submit_prompt(None, {  # type: ignore
        "prompt": req.instruction,
        "conversation_id": req.conversation_id,
        "mode": "steer"
    })
    return {
        "success": True,
        "message": "Instruction de guidage transmise avec succès à l'agent."
    }


@router.post("/input")
async def send_agent_input(
    req: AgentInputRequest,
    _: bool = Depends(require_auth)
):
    """
    Transmet une saisie utilisateur stdin ou une réponse à une question interactive à une session en cours.
    """
    if not req.conversation_id or not is_safe_conversation_id(req.conversation_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="L'identifiant de conversation (conversation_id) est invalide."
        )
    session = execution_manager.get_session(req.conversation_id)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Aucune session active trouvée pour l'ID {req.conversation_id}."
        )

    await execution_manager.handle_stdin_input(req.conversation_id, req.text)
    return {
        "success": True,
        "message": f"Entrée transmise avec succès à la session {req.conversation_id}."
    }

