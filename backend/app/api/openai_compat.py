import json
import logging
import time
import uuid
from collections.abc import AsyncGenerator
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.services import tool_bridge
from app.services.agy_driver import (
    get_model_families,
    stream_turn,
)
from app.services.google_auth import is_quota_error
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.openai_compat")
router = APIRouter(prefix="/v1", tags=["openai-compatibility"])


def _is_quota_error(msg: str) -> bool:
    """Détecte si un message d'erreur correspond à une erreur de quota Google Cloud."""
    return is_quota_error(msg)

def _raise_http_for_error(msg: str, context: str = "", is_quota: bool = False) -> None:
    """Lève l'HTTPException appropriée selon le type d'erreur CLI."""
    if is_quota or _is_quota_error(msg):
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
    content: Any = ""
    name: str | None = None
    # Tool calling OpenAI : assistant avec appels d'outils, messages role="tool" avec résultat.
    tool_calls: Any = None
    tool_call_id: str | None = None


def _extract_message_content(content: Any) -> str:
    """Extrait le texte d'un message qu'il soit sous forme de chaîne, de dictionnaire ou de liste de blocs (multi-part)."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        text = content.get("text")
        if isinstance(text, str):
            return text
        inner = content.get("content")
        if isinstance(inner, str):
            return inner
        if text is not None:
            return str(text)
        if inner is not None:
            return str(inner)
        return ""
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
                elif "content" in part and isinstance(part.get("content"), str):
                    parts.append(str(part.get("content")))
                elif part.get("type") == "text" and "text" in part:
                    parts.append(str(part.get("text", "")))
        return "\n".join(parts)
    if content is None:
        return ""
    return str(content)


class ChatCompletionRequest(BaseModel):
    model: str = "gemini-3.8-flash"
    messages: list[ChatMessage] = Field(default_factory=list)
    stream: bool = False
    temperature: float | None = None
    top_p: float | None = None
    max_tokens: int | None = None
    stop: list[str] | str | None = None

    # Tool calling OpenAI (function calling) — traité par le pont tool_bridge (agy en « API simulée »).
    tools: Any = None
    tool_choice: Any = None
    parallel_tool_calls: Any = None

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
            return _extract_message_content(last_msg.content).strip()

    if len(messages) == 1 and messages[0].role.lower() == "user":
        return _extract_message_content(messages[0].content)

    formatted_turns: list[str] = []
    for msg in messages:
        role = msg.role.lower()
        content = _extract_message_content(msg.content).strip()
        if not content and not msg.tool_calls:
            continue
        if role == "system":
            formatted_turns.append(f"[Directives Système / Contexte]:\n{content}\n")
        elif role == "assistant":
            tc_info = ""
            if msg.tool_calls:
                tc_info = f"\n[Tool Calls]: {json.dumps(msg.tool_calls, ensure_ascii=False) if not isinstance(msg.tool_calls, str) else msg.tool_calls}"
            formatted_turns.append(f"[Assistant Antigravity]:\n{content}{tc_info}\n")
        elif role == "tool":
            tool_id = msg.tool_call_id or msg.name or ""
            prefix = f"[Résultat Outil ({tool_id})]:" if tool_id else "[Résultat Outil]:"
            formatted_turns.append(f"{prefix}\n{content}\n")
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
        for variant_id in (f.get("variants") or {}).values():
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
    Si le client déclare des outils (`tools`), la décision est produite par le pont tool_bridge
    (agy en mode « API simulée ») puis convertie en tool_calls / texte OpenAI — sync et streaming.
    """
    tool_list = _normalized_tool_list(req.tools)
    if tool_list and not _tool_choice_disables_tools(req.tool_choice):
        return await _tool_mode_response(req, tool_list)

    raw_cid = req.conversation_id or x_conversation_id
    conv_id = raw_cid.strip() if raw_cid and is_safe_conversation_id(raw_cid) else None
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
                            delta_payload: dict[str, Any] = {"reasoning_content": thinking_delta}
                            if not first_chunk_sent:
                                delta_payload["role"] = "assistant"
                            chunk = {
                                "id": completion_id,
                                "object": "chat.completion.chunk",
                                "created": created_ts,
                                "model": req.model,
                                "system_fingerprint": "fp_antigravity",
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": delta_payload,
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
                                delta_payload = {"content": text_delta}
                                if not first_chunk_sent:
                                    delta_payload["role"] = "assistant"
                                chunk = {
                                    "id": completion_id,
                                    "object": "chat.completion.chunk",
                                    "created": created_ts,
                                    "model": req.model,
                                    "system_fingerprint": "fp_antigravity",
                                    "choices": [
                                        {
                                            "index": 0,
                                            "delta": delta_payload,
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
                            delta_payload = {"content": resp_text}
                            if not first_chunk_sent:
                                delta_payload["role"] = "assistant"
                            chunk = {
                                "id": completion_id,
                                "object": "chat.completion.chunk",
                                "created": created_ts,
                                "model": req.model,
                                "system_fingerprint": "fp_antigravity",
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": delta_payload,
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
                        is_quota = bool(event.get("is_quota")) or _is_quota_error(err_msg)
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
                            "delta": {"content": f"\n\n[Erreur interne]: {ex!s}"},
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
                _raise_http_for_error(
                    str(event.get("message") or "Erreur CLI Antigravity"),
                    context="/v1/chat/completions",
                    is_quota=bool(event.get("is_quota")),
                )

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


# ============================================================================
# Tool calling OpenAI (pont tool_bridge)
# ============================================================================

def _normalized_tool_list(raw_tools: Any) -> list[dict[str, Any]]:
    """Filtre les définitions d'outils valides (format OpenAI `{type, function}` accepté gracieusement)."""
    if not isinstance(raw_tools, list):
        return []
    tools: list[dict[str, Any]] = []
    for tool in raw_tools:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        name = fn.get("name") if isinstance(fn, dict) else None
        if isinstance(name, str) and name.strip():
            tools.append(tool)
    return tools


def _tool_choice_disables_tools(tool_choice: Any) -> bool:
    """`tool_choice: "none"` désactive le mode tool calling (chat texte classique)."""
    return isinstance(tool_choice, str) and tool_choice.strip().lower() == "none"


async def _tool_mode_response(req: ChatCompletionRequest, tool_list: list[dict[str, Any]]):
    """
    Produit la réponse OpenAI (tool_calls ou texte) via le pont tool_bridge.

    Mode volontairement « sans état » : l'historique complet est rejoué à chaque appel.
    `conversation_id`, `workspace_path` et `auto_approve` de la requête sont ignorés —
    l'agent agy reste en mode simulation, sans exécution de ses propres outils.
    """
    completion_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created_ts = int(time.time())

    outcome = await tool_bridge.run_turn(
        messages=[message.model_dump() for message in req.messages],
        tools=tool_list,
        tool_choice=req.tool_choice,
        model=req.model,
        effort=req.effort,
    )

    if outcome.get("kind") == "error":
        _raise_http_for_error(
            str(outcome.get("message") or "Erreur inconnue du pont tool calling"),
            context="/v1/chat/completions (tool bridge)",
            is_quota=bool(outcome.get("quota")),
        )

    usage = _extract_usage_info(outcome.get("usage"))
    reasoning = outcome.get("thinking") or None

    tool_call_payload: dict[str, Any] | None = None
    if outcome.get("kind") == "tool_call":
        raw_args = outcome.get("arguments")
        if isinstance(raw_args, str):
            formatted_args = raw_args
        else:
            formatted_args = json.dumps(raw_args or {}, ensure_ascii=False)
        tool_call_payload = {
            "id": outcome.get("id") or f"call_{uuid.uuid4().hex[:24]}",
            "type": "function",
            "function": {
                "name": outcome.get("name") or "",
                "arguments": formatted_args,
            },
        }
        message: dict[str, Any] = {
            "role": "assistant",
            "content": None,
            "reasoning_content": reasoning,
            "tool_calls": [tool_call_payload],
        }
        finish_reason = "tool_calls"
    else:
        message = {
            "role": "assistant",
            "content": outcome.get("content") or "",
            "reasoning_content": reasoning,
        }
        finish_reason = "stop"

    if not req.stream:
        return {
            "id": completion_id,
            "object": "chat.completion",
            "created": created_ts,
            "model": req.model,
            "system_fingerprint": "fp_antigravity",
            "choices": [
                {
                    "index": 0,
                    "message": message,
                    "finish_reason": finish_reason
                }
            ],
            "usage": usage,
        }

    def build_chunk(delta: dict[str, Any], finish: str | None = None, with_usage: bool = False) -> str:
        chunk: dict[str, Any] = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created_ts,
            "model": req.model,
            "system_fingerprint": "fp_antigravity",
            "choices": [
                {
                    "index": 0,
                    "delta": delta,
                    "finish_reason": finish
                }
            ],
        }
        if with_usage:
            chunk["usage"] = usage
        return f"data: {json.dumps(chunk, ensure_ascii=False)}\n\n"

    async def sse_generator() -> AsyncGenerator[str, None]:
        # Décision bufferisée : l'enveloppe JSON doit être analysée avant de savoir si la
        # réponse est un tool_call ou du texte ; les fragments SSE sont ensuite émis d'un bloc.
        role_sent = False
        if reasoning:
            yield build_chunk({"role": "assistant", "reasoning_content": reasoning})
            role_sent = True
        if tool_call_payload:
            first_tool_delta: dict[str, Any] = {
                "tool_calls": [
                    {
                        "index": 0,
                        "id": tool_call_payload["id"],
                        "type": "function",
                        "function": {
                            "name": tool_call_payload["function"]["name"],
                            "arguments": ""
                        }
                    }
                ]
            }
            if not role_sent:
                first_tool_delta["role"] = "assistant"
                role_sent = True
            yield build_chunk(first_tool_delta)
            yield build_chunk({
                "tool_calls": [
                    {
                        "index": 0,
                        "function": {"arguments": tool_call_payload["function"]["arguments"]}
                    }
                ]
            })
        else:
            text_delta: dict[str, Any] = {"content": message["content"]}
            if not role_sent:
                text_delta["role"] = "assistant"
                role_sent = True
            yield build_chunk(text_delta)
        yield build_chunk({}, finish=finish_reason, with_usage=True)
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
