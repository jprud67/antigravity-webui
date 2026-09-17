import asyncio
import json
import logging
import time
import uuid
from typing import Any, AsyncGenerator

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.services.agy_driver import (
    get_model_families,
    resolve_model_and_effort,
    stream_turn,
)

logger = logging.getLogger("antigravity.openai_compat")
router = APIRouter(prefix="/v1", tags=["openai-compatibility"])


# Signatures d'erreur de quota Google Cloud (429 RESOURCE_EXHAUSTED)
_QUOTA_KEYWORDS = (
    "RESOURCE_EXHAUSTED",
    "quota reached",
    "Individual quota",
    "rate limit",
    "429",
    "RATE_LIMIT_EXCEEDED",
    "exceeded your current quota",
)

def _is_quota_error(msg: str) -> bool:
    """Détecte si un message d'erreur correspond à une erreur de quota Google Cloud."""
    msg_lower = msg.lower()
    return any(kw.lower() in msg_lower for kw in _QUOTA_KEYWORDS)

def _raise_http_for_error(msg: str, context: str = "") -> None:
    """Lève l'HTTPException appropriée selon le type d'erreur CLI."""
    if _is_quota_error(msg):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail={
                "error": {
                    "code": "rate_limit_exceeded",
                    "message": "Quota Google Cloud épuisé. Antigravity bascule automatiquement entre les comptes disponibles. Réessayez dans quelques instants.",
                    "type": "quota_exceeded",
                    "source": context or "antigravity_cli"
                }
            },
            headers={"Retry-After": "60"}
        )
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail=f"Erreur d'exécution Antigravity: {msg}"
    )


# ============================================================================
# Pydantic Models for OpenAI Compatibility
# ============================================================================

class ChatMessage(BaseModel):
    role: str = "user"
    content: str | None = ""
    name: str | None = None


class ChatCompletionRequest(BaseModel):
    model: str = "gemini-3.8-flash"
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stop: list[str] | str | None = None

    # Paramètres d'extension Antigravity (acceptés gracieusement par les clients externes)
    conversation_id: str | None = None
    workspace_path: str | None = None
    effort: str | None = None
    auto_approve: bool = True
    agent_mode: str | None = None


# ============================================================================
# Helpers
# ============================================================================

def _extract_usage_info(raw_u: Any) -> dict[str, int]:
    """Extrait et normalise les métriques de tokens à partir des différents formats de retour du CLI."""
    if not isinstance(raw_u, dict):
        return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
    prompt_tokens = (
        raw_u.get("inputTokens")
        or raw_u.get("input_tokens")
        or raw_u.get("prompt_tokens")
        or raw_u.get("promptTokenCount")
        or 0
    )
    completion_tokens = (
        raw_u.get("outputTokens")
        or raw_u.get("output_tokens")
        or raw_u.get("completion_tokens")
        or raw_u.get("candidatesTokenCount")
        or 0
    )
    total_tokens = (
        raw_u.get("totalTokens")
        or raw_u.get("total_tokens")
        or raw_u.get("totalTokenCount")
        or (prompt_tokens + completion_tokens)
    )
    return {
        "prompt_tokens": int(prompt_tokens),
        "completion_tokens": int(completion_tokens),
        "total_tokens": int(total_tokens),
    }


def _messages_to_prompt(messages: list[ChatMessage], has_conv_id: bool = False) -> str:
    """
    Transforme la liste de messages OpenAI en prompt unifié pour le CLI Antigravity.
    Si une conversation existante est reprise avec un historique, seul le dernier message
    utilisateur est transmis pour éviter de dupliquer la transcription déjà présente dans le brain.
    Si un seul message user, retourne directement le texte.
    Si nouvel échange multi-tours, formate le contexte de dialogue de façon claire.
    """
    if not messages:
        return ""

    if has_conv_id and len(messages) > 1:
        last_msg = messages[-1]
        if last_msg.role.lower() == "user":
            return (last_msg.content or "").strip()

    if len(messages) == 1 and messages[0].role == "user":
        return messages[0].content or ""

    formatted_turns: list[str] = []
    for msg in messages:
        role = msg.role.lower()
        content = (msg.content or "").strip()
        if not content:
            continue
        if role == "system":
            formatted_turns.append(f"[Directives Système / Contexte]:\n{content}\n")
        elif role == "assistant":
            formatted_turns.append(f"[Assistant Antigravity]:\n{content}\n")
        else:
            formatted_turns.append(f"[Utilisateur]:\n{content}\n")

    return "\n".join(formatted_turns).strip()


# ============================================================================
# Endpoints
# ============================================================================

@router.get("/models")
async def list_models(_: bool = Depends(require_auth)):
    """
    Endpoint standard OpenAI /v1/models.
    Permet à Cursor, Continue, LangChain, LiteLLM de découvrir automatiquement
    tous les modèles supportés par Antigravity CLI.
    """
    try:
        families = await get_model_families()
    except Exception as e:
        logger.warning(f"Erreur lors de la récupération des familles de modèles: {e}")
        families = []

    model_entries: list[dict[str, Any]] = []
    created_ts = int(time.time())

    for f in families:
        fid = f.get("id")
        if fid:
            model_entries.append({
                "id": fid,
                "object": "model",
                "created": created_ts,
                "owned_by": "antigravity",
                "permission": [],
                "root": fid,
                "parent": None,
            })
        for variant_name, variant_id in (f.get("variants") or {}).items():
            if variant_id and variant_id != fid:
                model_entries.append({
                    "id": variant_id,
                    "object": "model",
                    "created": created_ts,
                    "owned_by": "antigravity",
                    "permission": [],
                    "root": fid,
                    "parent": fid,
                })

    return {
        "object": "list",
        "data": model_entries
    }


@router.get("/models/{model_id:path}")
async def retrieve_model(model_id: str, _: bool = Depends(require_auth)):
    """Détail d'un modèle pour compatibilité OpenAI."""
    return {
        "id": model_id,
        "object": "model",
        "created": int(time.time()),
        "owned_by": "antigravity",
        "permission": [],
        "root": model_id,
        "parent": None
    }


@router.post("/chat/completions")
async def create_chat_completion(
    req: ChatCompletionRequest,
    x_conversation_id: str | None = Header(None, alias="X-Conversation-Id"),
    _: bool = Depends(require_auth)
):
    """
    Endpoint standard OpenAI /v1/chat/completions.
    Gère à la fois le mode synchrone (JSON complet) et le mode streaming (SSE).
    Transmet le raisonnement (thinking) dans reasoning_content (standard DeepSeek R1 / o1).
    """
    conv_id = req.conversation_id or x_conversation_id
    prompt = _messages_to_prompt(req.messages, has_conv_id=bool(conv_id))
    if not prompt:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Le message utilisateur ou l'historique ne peut pas être vide."
        )

    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_ts = int(time.time())

    # 1. Mode Streaming (SSE standard OpenAI)
    if req.stream:
        async def sse_generator() -> AsyncGenerator[str, None]:
            first_chunk_sent = False
            full_content_emitted = ""
            usage_info = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
            has_error = False

            try:
                async for event in stream_turn(
                    prompt=prompt,
                    conversation_id=conv_id,
                    workspace_path=req.workspace_path,
                    model=req.model,
                    effort=req.effort,
                    auto_approve=req.auto_approve,
                    agent_mode=req.agent_mode
                ):
                    evt_type = event.get("event")

                    # Extraction du texte incrémental
                    if evt_type == "step_update":
                        su = event.get("step_update", {})
                        # Pensée / Raisonnement (DeepSeek R1 / OpenAI o1 reasoning_content)
                        thinking_delta = su.get("thinking")
                        if thinking_delta:
                            chunk = {
                                "id": completion_id,
                                "object": "chat.completion.chunk",
                                "created": created_ts,
                                "model": req.model,
                                "system_fingerprint": "fp_antigravity",
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": {
                                            "role": "assistant" if not first_chunk_sent else None,
                                            "reasoning_content": thinking_delta
                                        },
                                        "finish_reason": None
                                    }
                                ]
                            }
                            first_chunk_sent = True
                            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

                        # Texte incrémental de l'agent
                        if su.get("step_type") == "agent_response":
                            text_delta = su.get("text_delta")
                            if text_delta:
                                full_content_emitted += text_delta
                                chunk = {
                                    "id": completion_id,
                                    "object": "chat.completion.chunk",
                                    "created": created_ts,
                                    "model": req.model,
                                    "system_fingerprint": "fp_antigravity",
                                    "choices": [
                                        {
                                            "index": 0,
                                            "delta": {
                                                "role": "assistant" if not first_chunk_sent else None,
                                                "content": text_delta
                                            },
                                            "finish_reason": None
                                        }
                                    ]
                                }
                                first_chunk_sent = True
                                yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

                        if su.get("usage"):
                            usage_info = _extract_usage_info(su["usage"])

                    elif evt_type == "result":
                        res = event.get("result", {})
                        resp_text = res.get("response", "")
                        # Si aucun delta n'a été émis avant, émettre la réponse complète
                        if resp_text and not full_content_emitted:
                            chunk = {
                                "id": completion_id,
                                "object": "chat.completion.chunk",
                                "created": created_ts,
                                "model": req.model,
                                "system_fingerprint": "fp_antigravity",
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": {
                                            "role": "assistant" if not first_chunk_sent else None,
                                            "content": resp_text
                                        },
                                        "finish_reason": None
                                    }
                                ]
                            }
                            yield f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

                        if res.get("usage"):
                            usage_info = _extract_usage_info(res["usage"])

                    elif evt_type == "error":
                        has_error = True
                        err_msg = event.get("message") or "Erreur lors de l'exécution"
                        is_quota = _is_quota_error(err_msg)
                        error_chunk = {
                            "id": completion_id,
                            "object": "chat.completion.chunk",
                            "created": created_ts,
                            "model": req.model,
                            "system_fingerprint": "fp_antigravity",
                            "choices": [
                                {
                                    "index": 0,
                                    "delta": {
                                        "content": f"\n\n[{'Quota épuisé – Retry-After: 60s' if is_quota else 'Erreur Antigravity'}]: {err_msg[:200]}"
                                    },
                                    "finish_reason": "error"
                                }
                            ],
                            "x_error_type": "quota_exceeded" if is_quota else "internal_error"
                        }
                        yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"
                        break

            except Exception as ex:
                has_error = True
                logger.error(f"Erreur durant le streaming OpenAI compat: {ex}")
                error_chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": req.model,
                    "system_fingerprint": "fp_antigravity",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {"content": f"\n\n[Erreur interne]: {str(ex)}"},
                            "finish_reason": "error"
                        }
                    ]
                }
                yield f"data: {json.dumps(error_chunk, ensure_ascii=False)}\n\n"

            if not has_error:
                # Final stop chunk
                final_chunk = {
                    "id": completion_id,
                    "object": "chat.completion.chunk",
                    "created": created_ts,
                    "model": req.model,
                    "system_fingerprint": "fp_antigravity",
                    "choices": [
                        {
                            "index": 0,
                            "delta": {},
                            "finish_reason": "stop"
                        }
                    ],
                    "usage": usage_info
                }
                yield f"data: {json.dumps(final_chunk, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

        return StreamingResponse(
            sse_generator(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            }
        )

    # 2. Mode Synchrone (Attend la fin et renvoie la réponse complète)
    full_content = []
    full_thinking = []
    usage_data = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    try:
        async for event in stream_turn(
            prompt=prompt,
            conversation_id=conv_id,
            workspace_path=req.workspace_path,
            model=req.model,
            effort=req.effort,
            auto_approve=req.auto_approve,
            agent_mode=req.agent_mode
        ):
            evt_type = event.get("event")
            if evt_type == "step_update":
                su = event.get("step_update", {})
                if su.get("thinking"):
                    full_thinking.append(su["thinking"])
                if su.get("step_type") == "agent_response" and su.get("text_delta"):
                    full_content.append(su["text_delta"])
                if su.get("usage"):
                    usage_data = _extract_usage_info(su["usage"])
            elif evt_type == "result":
                res = event.get("result", {})
                resp = res.get("response")
                if resp and not full_content:
                    full_content.append(resp)
                if res.get("usage"):
                    usage_data = _extract_usage_info(res["usage"])
            elif evt_type == "error":
                raise RuntimeError(event.get("message") or "Erreur CLI Antigravity")

    except HTTPException:
        raise  # Laisser passer les HTTPException déjà construites
    except Exception as ex:
        logger.error(f"Erreur durant l'exécution synchrone OpenAI compat: {ex}")
        _raise_http_for_error(str(ex), context="/v1/chat/completions")

    final_text = "".join(full_content).strip()
    final_thought = "".join(full_thinking).strip() or None

    return {
        "id": completion_id,
        "object": "chat.completion",
        "created": created_ts,
        "model": req.model,
        "system_fingerprint": "fp_antigravity",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": final_text,
                    "reasoning_content": final_thought
                },
                "finish_reason": "stop"
            }
        ],
        "usage": usage_data
    }
