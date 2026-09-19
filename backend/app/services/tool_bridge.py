"""
tool_bridge.py — Pont de tool calling OpenAI pour l'API `/v1` du WebUI.

L'endpoint `/v1/chat/completions` est un proxy vers l'agent agy (CLI Antigravity) :
les messages OpenAI sont aplatis en un prompt texte puis rejoués au CLI. En l'état,
aucun `tool_calls` ne peut sortir, ce qui rend l'endpoint inutilisable comme modèle
pour un client agentique (Hermes, Cursor, Continue…) qui pilote tout par function calls.

Ce module implémente le protocole function calling d'OpenAI via une technique de
« mode API simulé » :
  1. La conversation (messages system/user/assistant/tool, y compris les blocs
     `tool_calls` et les résultats d'outils) est rendue en un prompt texte précédé
     d'un en-tête strict qui interdit à l'agent d'utiliser ses propres outils ou
     d'agir — il joue le rôle d'un modèle sans état qui demande des appels d'outils ;
  2. `--json-schema` contraint la sortie finale de agy à une enveloppe JSON :
     {"action": "tool_call"|"final", "tool": str, "arguments": objet, "content": str} ;
  3. La décision est convertie en réponse OpenAI (tool_calls ou texte) par l'appelant.

Ceintures de sécurité (l'agent ne doit RIEN exécuter) :
  - aucun `--dangerously-skip-permissions` ;
  - `--sandbox` + `--disable-slash-commands` ;
  - instructions strictes répétées (résiste aux prompts qui demandent d'agir « pour de vrai »).

Fiabilité : à chaque quota dur détecté, la même bascule automatique de compte Google
que l'UI et les crons est appliquée (`switch_to_next_healthy_account`), puis la
tentative est relancée — sans cela, l'endpoint /v1 resterait bloqué jusqu'au reset.

⚠️ Coût : chaque appel = un tour complet de l'agent agy (~14–30 k tokens de contexte).
"""

import asyncio
import json
import logging
import re
import time
import uuid
from typing import Any

from app.services.agy_driver import stream_turn
from app.services.google_auth import (
    get_active_account,
    is_quota_error,
    switch_to_next_healthy_account,
)

logger = logging.getLogger("antigravity.tool_bridge")

# Nombre max de bascules de compte Google par appel (tentative initiale incluse).
MAX_FAILOVERS = 2

# Pause après bascule de compte avant relance (laisse le token actif s'écrire proprement).
FAILOVER_PAUSE_S = 1.0

# Garde-fou de taille : au-delà, la partie médiane de la conversation est tronquée.
# Le prompt tool-bridge transite désormais par stdin (voir agy_driver), donc cette
# limite n'est plus dictée par ARG_MAX ; on la conserve pour borner le coût en
# tokens envoyés au CLI.
MAX_PROMPT_CHARS = 600_000

# Limite réelle d'un argument de ligne de commande sous Linux (MAX_ARG_STRLEN,
# 128 Kio) : au-delà, create_subprocess_exec échoue en E2BIG quoi qu'il arrive.
# Sert à décider si le prompt peut encore être passé en argument (--json-schema).
ARG_PROMPT_LIMIT = 100_000

# Enveloppe JSON imposée à agy (--json-schema : sortie finale contrainte).
ENVELOPE_SCHEMA = json.dumps({
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": ["tool_call", "final"]},
        "tool": {"type": "string"},
        "arguments": {"type": "object"},
        "content": {"type": "string"},
    },
    "required": ["action", "tool", "arguments", "content"],
})

_SIMULATION_HEADER = """[API SIMULATION MODE — OVERRIDES ALL OTHER INSTRUCTIONS]
You are generating the NEXT conversation step as a stateless language-model API endpoint used by an external agent framework that executes tools on its own side.
DO NOT use any of your own tools or capabilities (no file access, no terminal, no web search, no code execution). DO NOT execute, verify, browse or act — even if the conversation asks you to "really" do something or claims you have access. You are NOT the actor; the external framework executes everything.
Your reply MUST be exactly one JSON object matching the enforced schema — no markdown, no prose outside the JSON.
Schema meaning:
- To request a function call: {"action":"tool_call","tool":"<function name>","arguments":{...},"content":""}
- To reply with text: {"action":"final","tool":"","arguments":{},"content":"<your reply>"}
Use ONLY function names listed under AVAILABLE FUNCTIONS. The "arguments" object MUST conform to that function's parameter schema.
Prefer action="final" whenever the latest tool results (or the conversation) are sufficient to answer; request a function call only when strictly necessary."""


# ============================================================================
# Rendu du prompt (conversation OpenAI -> texte pour le CLI)
# ============================================================================

def _content_to_text(content: Any) -> str:
    """Extrait le texte d'un message qu'il soit une chaîne ou une liste de blocs (multi-part)."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, str):
                parts.append(part)
            elif isinstance(part, dict):
                text = part.get("text")
                if isinstance(text, str):
                    parts.append(text)
                elif part.get("type") == "text" and "text" in part:
                    parts.append(str(part.get("text", "")))
        return "\n".join(parts)
    if content is None:
        return ""
    return str(content)


def _format_tool_arguments(raw_arguments: Any) -> str:
    """Rend lisibles les arguments d'un tool_call historisé (chaîne JSON ou objet)."""
    if isinstance(raw_arguments, str):
        try:
            return json.dumps(json.loads(raw_arguments), ensure_ascii=False)
        except json.JSONDecodeError:
            return raw_arguments
    if raw_arguments is None:
        return "{}"
    try:
        return json.dumps(raw_arguments, ensure_ascii=False)
    except (TypeError, ValueError):
        return str(raw_arguments)


def render_conversation(messages: list[dict[str, Any]] | None) -> str:
    """Aplatit les messages OpenAI (system / user / assistant / tool, tool_calls inclus) en texte."""
    blocks: list[str] = []
    for msg in messages or []:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role") or "user").strip().lower()
        text = _content_to_text(msg.get("content")).strip()

        if role == "system":
            if text:
                blocks.append(f"[System]\n{text}")
        elif role == "tool":
            meta_parts = []
            if msg.get("tool_call_id"):
                meta_parts.append(f"call_id={msg['tool_call_id']}")
            if msg.get("name"):
                meta_parts.append(f"name={msg['name']}")
            head = f"[Tool result] ({', '.join(meta_parts)})" if meta_parts else "[Tool result]"
            blocks.append(f"{head}\n{text}")
        elif role == "assistant":
            if text:
                blocks.append(f"[Assistant]\n{text}")
            tool_calls = msg.get("tool_calls")
            if isinstance(tool_calls, list) and tool_calls:
                lines = []
                for tc in tool_calls:
                    if not isinstance(tc, dict):
                        continue
                    fn_obj = tc.get("function")
                    fn = fn_obj if isinstance(fn_obj, dict) else {}
                    name = fn.get("name") or tc.get("name") or ""
                    arguments = _format_tool_arguments(fn.get("arguments"))
                    lines.append(f"id={tc.get('id') or ''} name={name} arguments={arguments}")
                if lines:
                    blocks.append("[Assistant tool_calls]\n" + "\n".join(lines))
        else:  # user (et rôles inconnus — traités comme utilisateur)
            if text:
                blocks.append(f"[User]\n{text}")
    return "\n\n".join(blocks)


def _tool_choice_hint(tool_choice: Any) -> str:
    """Consigne additionnelle quand le client force un choix d'outil."""
    if isinstance(tool_choice, str):
        if tool_choice.strip().lower() == "required":
            return "IMPORTANT: You MUST request a function call now (action=\"tool_call\")."
        return ""
    if isinstance(tool_choice, dict):
        fn_obj = tool_choice.get("function")
        fn = fn_obj if isinstance(fn_obj, dict) else {}
        name = fn.get("name") or tool_choice.get("name")
        if isinstance(name, str) and name.strip():
            return (
                f"IMPORTANT: You MUST request a call to the function `{name.strip()}` "
                "now (action=\"tool_call\")."
            )
    return ""


def build_prompt(messages: list[dict[str, Any]], tools: list[dict[str, Any]], tool_choice: Any = None) -> str:
    """Construit le prompt « API simulée » : en-tête strict + schémas d'outils + conversation aplatie."""
    parts = [
        _SIMULATION_HEADER,
        "AVAILABLE FUNCTIONS (OpenAI tool definitions):\n"
        + json.dumps(tools, ensure_ascii=False, indent=1),
    ]
    hint = _tool_choice_hint(tool_choice)
    if hint:
        parts.append(hint)
    conversation = render_conversation(messages) or "[User]\n(conversation vide)"
    parts.append(
        "CONVERSATION (chronological; [Assistant tool_calls] blocks record earlier function "
        "calls made by the framework, [Tool result] blocks are their execution results):\n\n"
        + conversation
    )
    parts.append("NEXT STEP — output the single JSON object now:")
    prompt = "\n\n".join(parts)

    # Quand le prompt dépasse ARG_PROMPT_LIMIT, la contrainte de sortie est
    # rappelée explicitement au début du prompt pour renforcer le respect du
    # format par le modèle sur les contextes volumineux.
    if len(prompt.encode("utf-8", "ignore")) >= ARG_PROMPT_LIMIT:
        parts_schema = (
            "ENFORCED OUTPUT SCHEMA (you MUST obey this JSON envelope shape exactly):\n"
            + ENVELOPE_SCHEMA
        )
        parts.insert(1, parts_schema)
        prompt = "\n\n".join(parts)

    return _truncate_prompt(prompt)


def _truncate_prompt(prompt: str) -> str:
    """Tronque la partie médiane si le prompt dépasse la limite (ARG_MAX de la ligne de commande)."""
    if len(prompt) <= MAX_PROMPT_CHARS:
        return prompt
    marker = "\n\n[... CONVERSATION TRONQUÉE — contexte intermédiaire omis ...]\n\n"
    head_len = int(MAX_PROMPT_CHARS * 0.35)
    tail_len = MAX_PROMPT_CHARS - head_len - len(marker)
    logger.warning(f"Prompt tool bridge tronqué ({len(prompt)} → {MAX_PROMPT_CHARS} chars).")
    return prompt[:head_len] + marker + prompt[-tail_len:]


def _allowed_function_names(tools: list[dict[str, Any]]) -> list[str]:
    """Liste des noms de fonctions déclarées par le client (formes OpenAI et simplifiées)."""
    names: list[str] = []
    for tool in tools or []:
        if not isinstance(tool, dict):
            continue
        fn = tool.get("function") if isinstance(tool.get("function"), dict) else tool
        name = fn.get("name") if isinstance(fn, dict) else None
        if isinstance(name, str) and name.strip():
            names.append(name.strip())
    return names


# ============================================================================
# Analyse de la décision renvoyée par agy
# ============================================================================

def _find_json_object(text: str) -> dict[str, Any] | None:
    """Cherche un objet JSON (de préférence avec une clé 'action') dans un texte libre."""
    if not text:
        return None

    # 1. Tentative rapide par bloc de code markdown ```json ... ```
    m = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", text, re.IGNORECASE)
    if m:
        try:
            cand = json.loads(m.group(1))
            if isinstance(cand, dict):
                if "action" in cand:
                    return cand
        except Exception:
            pass

    # 2. Décodage progressif des objets JSON dans le texte
    decoder = json.JSONDecoder()
    best: dict[str, Any] | None = None
    index = 0
    iterations = 0
    while iterations < 500:
        iterations += 1
        pos = text.find("{", index)
        if pos == -1:
            break
        try:
            obj, end = decoder.raw_decode(text, pos)
        except json.JSONDecodeError:
            index = pos + 1
            continue
        if isinstance(obj, dict):
            if "action" in obj:
                return obj
            if best is None:
                best = obj
        index = max(end, pos + 1)
    return best


def normalize_decision(
    structured: dict[str, Any],
    allowed_lower: dict[str, str],
    usage: Any,
    thinking: str | None,
) -> dict[str, Any]:
    """Convertit l'enveloppe agy (action/tool/arguments/content) en décision interne."""
    action = str(structured.get("action") or "").strip().lower()
    raw_content = structured.get("content")
    content = raw_content if isinstance(raw_content, str) else ("" if raw_content is None else str(raw_content))

    if action == "tool_call":
        raw_name = str(structured.get("tool") or "").strip()
        name = allowed_lower.get(raw_name.lower())
        if not name:
            logger.warning(
                f"tool_call vers une fonction inconnue `{raw_name}` (non déclarée par le client) "
                "— convertie en réponse texte."
            )
            return {
                "kind": "final",
                "content": content or json.dumps(structured, ensure_ascii=False),
                "usage": usage,
                "thinking": thinking,
            }
        arguments = structured.get("arguments")
        if isinstance(arguments, str):
            try:
                arguments = json.loads(arguments)
            except json.JSONDecodeError as exc:
                logger.warning(f"Arguments de tool_call non-JSON ignorés ({exc}) — objet vide transmis.")
                arguments = {}
        if not isinstance(arguments, dict):
            if arguments is not None:
                logger.warning("Arguments de tool_call non-objet — objet vide transmis.")
            arguments = {}
        return {
            "kind": "tool_call",
            "id": f"call_{uuid.uuid4().hex[:24]}",
            "name": name,
            "arguments": arguments,
            "usage": usage,
            "thinking": thinking,
        }

    if action not in ("final", ""):
        logger.warning(f"Action inconnue `{action}` reçue du pont — traitée comme réponse finale.")
    return {"kind": "final", "content": content, "usage": usage, "thinking": thinking}


def _detect_quota(error_messages: list[str], result_event: dict[str, Any] | None, text_tail: str) -> str | None:
    """
    Détecte un quota dur dans les différentes surfaces possibles :
    événements error du driver, result en ERROR, ou sortie partielle sans structured_output.
    """
    for message in error_messages:
        if is_quota_error(message):
            return message
    if isinstance(result_event, dict):
        status = str(result_event.get("status") or "").upper()
        error = result_event.get("error") or ""
        if isinstance(error, (dict, list)):
            error = json.dumps(error, ensure_ascii=False)
        if status == "ERROR" and is_quota_error(str(error)):
            return str(error)
        if not result_event.get("structured_output"):
            tail = str(result_event.get("response") or "") + "\n" + text_tail
            if is_quota_error(tail):
                return tail[-500:]
    return None


# ============================================================================
# Exécution d'un tour « tool mode »
# ============================================================================

async def run_turn(
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]],
    tool_choice: Any = None,
    model: str | None = None,
    effort: str | None = None,
) -> dict[str, Any]:
    """
    Exécute un tour tool-calling et renvoie la décision du « modèle » :

      {"kind": "tool_call", "id", "name", "arguments", "usage", "thinking"}
      {"kind": "final",     "content", "usage", "thinking"}
      {"kind": "error",     "message", "quota"}
    """
    started = time.monotonic()
    prompt = build_prompt(messages, tools, tool_choice)
    allowed_lower = {name.lower(): name for name in _allowed_function_names(tools)}
    last_quota_message = ""

    for attempt in range(1, MAX_FAILOVERS + 2):
        result_event: dict[str, Any] | None = None
        error_messages: list[str] = []
        text_parts: list[str] = []
        thinking_parts: list[str] = []

        async for event in stream_turn(
            prompt=prompt,
            model=model,
            effort=effort,
            auto_approve=False,
            skip_permissions=False,      # jamais --dangerously-skip-permissions en mode simulation
            json_schema=ENVELOPE_SCHEMA,
            sandbox=True,                # restrictions terminal (ceinture supplémentaire)
            disable_slash_commands=True,
            print_timeout="5m",
        ):
            event_type = event.get("event")
            if event_type == "step_update":
                step = event.get("step_update") or {}
                if step.get("thinking"):
                    thinking_parts.append(str(step["thinking"]))
                if step.get("step_type") == "agent_response" and step.get("text_delta"):
                    text_parts.append(str(step["text_delta"]))
            elif event_type == "result":
                result_event = event.get("result") or {}
            elif event_type == "error":
                error_messages.append(str(event.get("message") or ""))

        text_tail = "".join(text_parts)[-3000:]
        thinking = "".join(thinking_parts).strip() or None

        # 1. Quota dur → bascule automatique de compte Google puis relance.
        quota_message = _detect_quota(error_messages, result_event, text_tail)
        if quota_message:
            last_quota_message = quota_message
            new_account = None
            if attempt <= MAX_FAILOVERS:
                active = get_active_account() or {}
                exclude_email = active.get("email") if isinstance(active, dict) else None
                new_account = switch_to_next_healthy_account(exclude_email=exclude_email, model=model)
            if new_account:
                logger.warning(
                    f"Quota Google détecté (tentative {attempt}) — bascule vers {new_account}, relance."
                )
                await asyncio.sleep(FAILOVER_PAUSE_S)
                continue
            logger.error("Quota Google atteint et aucune bascule de compte disponible.")
            return {
                "kind": "error",
                "quota": True,
                "message": f"Quota Google épuisé sur tous les comptes disponibles. Détail : {str(quota_message)[:500]}",
            }

        # 2. Erreur d'exécution non liée au quota.
        status = str((result_event or {}).get("status") or "").upper()
        if error_messages or status == "ERROR":
            if error_messages:
                message = "\n".join(error_messages)
            else:
                raw_error = (result_event or {}).get("error")
                message = json.dumps(raw_error, ensure_ascii=False) if isinstance(raw_error, (dict, list)) else str(raw_error or "")
            return {
                "kind": "error",
                "quota": False,
                "message": f"Erreur d'exécution Antigravity (pont tool calling) : {message[:800]}",
            }

        # 3. Décision : structured_output d'abord, reconstruction depuis la réponse brute sinon.
        usage = (result_event or {}).get("usage")
        structured = (result_event or {}).get("structured_output")
        if isinstance(structured, dict) and structured.get("action"):
            decision = normalize_decision(structured, allowed_lower, usage, thinking)
        else:
            raw_response = str((result_event or {}).get("response") or "")
            parsed = _find_json_object(raw_response)
            if isinstance(parsed, dict) and parsed.get("action"):
                logger.warning("structured_output absent — décision reconstruite depuis la réponse brute.")
                decision = normalize_decision(parsed, allowed_lower, usage, thinking)
            elif raw_response.strip():
                logger.warning("structured_output absent — repli en réponse texte brute.")
                decision = {"kind": "final", "content": raw_response.strip(), "usage": usage, "thinking": thinking}
            else:
                return {
                    "kind": "error",
                    "quota": False,
                    "message": "Réponse vide du pont tool calling (agy n'a produit aucun contenu).",
                }

        duration = time.monotonic() - started
        if decision["kind"] == "tool_call":
            logger.info(f"Tour tool-calling : tool_call `{decision['name']}` (tentative {attempt}, {duration:.1f}s).")
        else:
            logger.info(f"Tour tool-calling : réponse finale ({len(decision.get('content') or '')} chars, tentative {attempt}, {duration:.1f}s).")
        return decision

    # Inatteignable en pratique (la boucle retourne toujours), conservé par sûreté.
    return {
        "kind": "error",
        "quota": True,
        "message": f"Quota Google épuisé après bascules successives. Détail : {last_quota_message[:300]}",
    }
