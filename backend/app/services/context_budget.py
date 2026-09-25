import json
import logging
from typing import Any

from app.config import BRAIN_DIR
from app.services.storage import (
    TOOL_STEP_TYPES,
    _notify_transcript_changed,
    atomic_write_jsonl,
    clean_user_prompt,
    get_settings,
    is_safe_conversation_id,
    is_tool_output_content,
)

logger = logging.getLogger("antigravity.context_budget")

# Base tokens consumed by Antigravity's system prompt + 30+ tool definitions and schemas
BASE_SYSTEM_TOKENS = 13_370
CHARS_PER_TOKEN = 3.8
DEFAULT_CONTEXT_BUDGET_TOKENS = 35_000
DEFAULT_PRESERVE_LAST_N_TURNS = 2


def is_user_step(step: dict[str, Any]) -> bool:
    """Détermine si une étape correspond à une intervention de l'utilisateur."""
    stype = (step.get("type") or "").upper()
    source = (step.get("source") or "").upper()
    role = (step.get("role") or "").lower()
    return stype == "USER_INPUT" or source == "USER_EXPLICIT" or role == "user"


def calculate_conversation_context_size(steps: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Calcule précisément le volume de tokens et de caractères qui seraient réingérés
    par `agy` lors du tour suivant à partir du contenu de `transcript.jsonl`.
    """
    total_chars = 0
    user_chars = 0
    assistant_chars = 0
    tool_chars = 0
    thinking_chars = 0
    user_turns_count = 0

    for s in steps:
        if not isinstance(s, dict):
            continue

        raw_c = s.get("content")
        try:
            content = raw_c if isinstance(raw_c, str) else (json.dumps(raw_c, ensure_ascii=False, default=str) if raw_c is not None else "")
        except Exception:
            content = str(raw_c) if raw_c is not None else ""

        raw_t = s.get("thinking")
        try:
            thinking = raw_t if isinstance(raw_t, str) else (json.dumps(raw_t, ensure_ascii=False, default=str) if raw_t is not None else "")
        except Exception:
            thinking = str(raw_t) if raw_t is not None else ""

        try:
            tool_calls = json.dumps(s.get("tool_calls") or [], default=str) if s.get("tool_calls") else ""
        except Exception:
            tool_calls = str(s.get("tool_calls") or "")

        c_len = len(content)
        t_len = len(thinking)
        tc_len = len(tool_calls)

        stype = (s.get("type") or "").upper()
        if is_user_step(s):
            user_turns_count += 1
            clean_p = clean_user_prompt(raw_c if raw_c is not None else content)
            p_len = len(clean_p) if clean_p else c_len
            user_chars += p_len
            total_chars += p_len
        elif stype in TOOL_STEP_TYPES or is_tool_output_content(content):
            tool_chars += c_len + tc_len
            total_chars += c_len + tc_len
        else:
            assistant_chars += c_len + tc_len
            total_chars += c_len + tc_len

        thinking_chars += t_len
        total_chars += t_len

    transcript_tokens = int(total_chars / CHARS_PER_TOKEN) if total_chars > 0 else 0
    estimated_input_tokens = BASE_SYSTEM_TOKENS + transcript_tokens

    user_tokens = int(user_chars / CHARS_PER_TOKEN) if user_chars > 0 else 0
    assistant_tokens = int(assistant_chars / CHARS_PER_TOKEN) if assistant_chars > 0 else 0
    tool_tokens = int(tool_chars / CHARS_PER_TOKEN) if tool_chars > 0 else 0
    thinking_tokens = int(thinking_chars / CHARS_PER_TOKEN) if thinking_chars > 0 else 0

    return {
        "base_system_tokens": BASE_SYSTEM_TOKENS,
        "transcript_chars": total_chars,
        "transcript_tokens": transcript_tokens,
        "estimated_input_tokens": estimated_input_tokens,
        "breakdown": {
            "user_chars": user_chars,
            "user_tokens": user_tokens,
            "assistant_chars": assistant_chars,
            "assistant_tokens": assistant_tokens,
            "tool_chars": tool_chars,
            "tool_tokens": tool_tokens,
            "thinking_chars": thinking_chars,
            "thinking_tokens": thinking_tokens,
        },
        "user_turns_count": user_turns_count,
        "total_steps_count": len(steps)
    }


def get_conversation_context_budget_info(conversation_id: str, budget_tokens: int | None = None) -> dict[str, Any]:
    """
    Retourne un diagnostic complet de l'état de consommation du contexte par rapport au budget configuré.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conv_dir = BRAIN_DIR / conversation_id
    transcript_path = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"

    if budget_tokens is None:
        try:
            settings = get_settings()
            budget_tokens = int(settings.get("contextBudgetTokens", DEFAULT_CONTEXT_BUDGET_TOKENS))
        except Exception:
            budget_tokens = DEFAULT_CONTEXT_BUDGET_TOKENS

    if not transcript_path.exists() or transcript_path.stat().st_size == 0:
        return {
            "conversation_id": conversation_id,
            "budget_tokens": budget_tokens,
            "estimated_input_tokens": BASE_SYSTEM_TOKENS,
            "transcript_tokens": 0,
            "is_over_budget": False,
            "budget_usage_pct": round((BASE_SYSTEM_TOKENS / max(1, budget_tokens)) * 100, 1),
            "user_turns_count": 0,
            "total_steps_count": 0,
            "breakdown": {},
            "recommendation": "Conversation vierge ou compacte. Contexte optimal."
        }

    raw_lines: list[str] = []
    with open(transcript_path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw_lines = [l.strip().lstrip("\ufeff") for l in f if l.strip().lstrip("\ufeff")]

    steps: list[dict[str, Any]] = []
    for l in raw_lines:
        try:
            steps.append(json.loads(l))
        except Exception:
            continue

    metrics = calculate_conversation_context_size(steps)
    est_tokens = metrics["estimated_input_tokens"]
    is_over = est_tokens > budget_tokens
    usage_pct = round((est_tokens / max(1, budget_tokens)) * 100, 1)

    if is_over:
        excess = est_tokens - budget_tokens
        rec = f"Dépassement de budget : +{excess:,} tokens au-dessus du plafond ({usage_pct}% du budget). Compactage automatique recommandé."
    elif usage_pct >= 85:
        rec = f"Contexte élevé ({usage_pct}% du budget). Proche du seuil de compactage."
    else:
        rec = f"Contexte sain ({usage_pct}% du budget). Économie de tokens optimale."

    return {
        "conversation_id": conversation_id,
        "budget_tokens": budget_tokens,
        "estimated_input_tokens": est_tokens,
        "transcript_tokens": metrics["transcript_tokens"],
        "base_system_tokens": metrics["base_system_tokens"],
        "is_over_budget": is_over,
        "budget_usage_pct": usage_pct,
        "user_turns_count": metrics["user_turns_count"],
        "total_steps_count": metrics["total_steps_count"],
        "breakdown": metrics["breakdown"],
        "recommendation": rec
    }


def enforce_context_budget(
    conversation_id: str,
    max_tokens: int | None = None,
    preserve_last_n_turns: int | None = None,
) -> dict[str, Any]:
    """
    Gestionnaire proactif de budget de contexte (Context Budget Manager) :
    1. Mesure le volume de tokens réingéré.
    2. Sauvegarde systématiquement l'historique complet dans `transcript_full.jsonl`.
    3. Si le volume dépasse `max_tokens`, applique une suite progressive de passes :
       - Étape 1 : Compactage des sorties d'outils et des arguments volumineux des tours antérieurs.
       - Étape 2 : Élagage des blocs de pensée (thinking/CoT) des tours antérieurs.
       - Étape 3 : Condensation des réponses verbeuses de l'assistant des tours anciens.
       - Étape 4 : Repliement contextuel (Sliding Window Checkpoint) des tours intermédiaires si session très longue.
    4. Réécrit atomiquement `transcript.jsonl` et notifie les observateurs.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conv_dir = BRAIN_DIR / conversation_id
    logs_dir = conv_dir / ".system_generated" / "logs"
    transcript_path = logs_dir / "transcript.jsonl"
    transcript_full_path = logs_dir / "transcript_full.jsonl"

    if max_tokens is None:
        try:
            settings = get_settings()
            max_tokens = int(settings.get("contextBudgetTokens", DEFAULT_CONTEXT_BUDGET_TOKENS))
        except Exception:
            max_tokens = DEFAULT_CONTEXT_BUDGET_TOKENS

    if preserve_last_n_turns is None:
        try:
            settings = get_settings()
            preserve_last_n_turns = int(settings.get("preserveLastNTurns", DEFAULT_PRESERVE_LAST_N_TURNS))
        except Exception:
            preserve_last_n_turns = DEFAULT_PRESERVE_LAST_N_TURNS

    if not transcript_path.exists() or transcript_path.stat().st_size == 0:
        return {
            "status": "ok",
            "conversation_id": conversation_id,
            "action_taken": False,
            "initial_tokens": BASE_SYSTEM_TOKENS,
            "final_tokens": BASE_SYSTEM_TOKENS,
            "tokens_saved": 0,
            "reduction_pct": 0.0,
            "stages_applied": [],
            "compacted_steps": 0
        }

    raw_lines: list[str] = []
    with open(transcript_path, "r", encoding="utf-8-sig", errors="replace") as f:
        raw_lines = [l.strip().lstrip("\ufeff") for l in f if l.strip().lstrip("\ufeff")]

    steps: list[dict[str, Any]] = []
    for l in raw_lines:
        try:
            steps.append(json.loads(l))
        except Exception:
            continue

    if not steps:
        return {
            "status": "ok",
            "conversation_id": conversation_id,
            "action_taken": False,
            "initial_tokens": BASE_SYSTEM_TOKENS,
            "final_tokens": BASE_SYSTEM_TOKENS,
            "tokens_saved": 0,
            "reduction_pct": 0.0,
            "stages_applied": [],
            "compacted_steps": 0
        }

    # Sauvegarde intégrale absolue dans transcript_full.jsonl avant toute modification
    if not transcript_full_path.exists() or transcript_full_path.stat().st_size < transcript_path.stat().st_size:
        atomic_write_jsonl(transcript_full_path, steps)

    init_metrics = calculate_conversation_context_size(steps)
    initial_tokens = init_metrics["estimated_input_tokens"]

    # Si déjà dans le budget configuré, aucune modification requise
    if max_tokens > 0 and initial_tokens <= max_tokens:
        return {
            "status": "ok",
            "conversation_id": conversation_id,
            "action_taken": False,
            "initial_tokens": initial_tokens,
            "final_tokens": initial_tokens,
            "tokens_saved": 0,
            "reduction_pct": 0.0,
            "stages_applied": [],
            "compacted_steps": 0
        }

    user_step_indices = [i for i, s in enumerate(steps) if is_user_step(s)]
    boundary_idx = 0
    if len(user_step_indices) > preserve_last_n_turns:
        boundary_idx = user_step_indices[-preserve_last_n_turns]
    elif len(user_step_indices) > 1:
        boundary_idx = user_step_indices[-1]

    stages_applied: list[str] = []
    compacted_steps_count = 0
    modified = False

    # -------------------------------------------------------------
    # Étape 1 : Compactage des sorties d'outils et arguments lourds
    # -------------------------------------------------------------
    if boundary_idx > 0:
        stage1_modified = False
        for i in range(boundary_idx):
            s = steps[i]
            stype = (s.get("type") or "").upper()
            is_tool = stype in TOOL_STEP_TYPES or is_tool_output_content(s.get("content"))
            if is_tool:
                cnt = str(s.get("content") or "")
                if len(cnt) > 120:
                    is_err = s.get("status") == "ERROR" or bool(s.get("error"))
                    status_desc = "Erreur" if is_err else "Succès"
                    s["content"] = f"[✓ {status_desc} — Sortie archivée dans transcript_full.jsonl (~{len(cnt)} car.)]"
                    s["is_truncated"] = True
                    tf = s.setdefault("truncated_fields", [])
                    if "content" not in tf:
                        tf.append("content")
                    compacted_steps_count += 1
                    stage1_modified = True

            # Troncature des arguments volumineux dans tool_calls (ex: gros fichiers écrits)
            tool_calls = s.get("tool_calls")
            if isinstance(tool_calls, list):
                for tc in tool_calls:
                    if isinstance(tc, dict) and isinstance(tc.get("args"), dict):
                        for k, v in tc["args"].items():
                            if isinstance(v, str) and len(v) > 250:
                                tc["args"][k] = v[:100] + "... [Paramètre volumineux archivé dans transcript_full.jsonl]"
                                stage1_modified = True

        if stage1_modified:
            stages_applied.append("tool_compaction")
            modified = True

    # Vérification après Étape 1
    curr_metrics = calculate_conversation_context_size(steps)
    if max_tokens > 0 and curr_metrics["estimated_input_tokens"] <= max_tokens:
        return _finish_compaction(conversation_id, steps, initial_tokens, curr_metrics, stages_applied, compacted_steps_count)

    # -------------------------------------------------------------
    # Étape 2 : Élagage des blocs de pensée (thinking/CoT) anciens
    # -------------------------------------------------------------
    if boundary_idx > 0:
        stage2_modified = False
        for i in range(boundary_idx):
            s = steps[i]
            raw_t = s.get("thinking")
            if raw_t and isinstance(raw_t, str) and len(raw_t) > 120:
                s["thinking"] = "[Pensée d'étape archivée dans transcript_full.jsonl pour sobriété de tokens]"
                s["is_truncated"] = True
                tf = s.setdefault("truncated_fields", [])
                if "thinking" not in tf:
                    tf.append("thinking")
                compacted_steps_count += 1
                stage2_modified = True

        if stage2_modified:
            stages_applied.append("thinking_stripping")
            modified = True

    # Vérification après Étape 2
    curr_metrics = calculate_conversation_context_size(steps)
    if max_tokens > 0 and curr_metrics["estimated_input_tokens"] <= max_tokens:
        return _finish_compaction(conversation_id, steps, initial_tokens, curr_metrics, stages_applied, compacted_steps_count)

    # -------------------------------------------------------------
    # Étape 3 : Condensation des réponses longues de l'assistant
    # -------------------------------------------------------------
    if boundary_idx > 0:
        stage3_modified = False
        for i in range(boundary_idx):
            s = steps[i]
            stype = (s.get("type") or "").upper()
            if not is_user_step(s) and stype not in TOOL_STEP_TYPES:
                cnt = str(s.get("content") or "")
                if len(cnt) > 600:
                    prefix = cnt[:250]
                    suffix = cnt[-100:]
                    s["content"] = f"{prefix}\n\n[...Réponse détaillée compressée pour respecter le budget de tokens ({max_tokens} tokens). L'intégralité reste disponible dans transcript_full.jsonl...]\n\n{suffix}"
                    s["is_truncated"] = True
                    tf = s.setdefault("truncated_fields", [])
                    if "content" not in tf:
                        tf.append("content")
                    compacted_steps_count += 1
                    stage3_modified = True

        if stage3_modified:
            stages_applied.append("assistant_condensation")
            modified = True

    # Vérification après Étape 3
    curr_metrics = calculate_conversation_context_size(steps)
    if max_tokens > 0 and curr_metrics["estimated_input_tokens"] <= max_tokens:
        return _finish_compaction(conversation_id, steps, initial_tokens, curr_metrics, stages_applied, compacted_steps_count)

    # -------------------------------------------------------------
    # Étape 4 : Sliding Window Context Checkpoint (Sessions longues)
    # -------------------------------------------------------------
    if len(user_step_indices) > (preserve_last_n_turns + 1):
        # Préserve le Tour 1 intégral (contexte originel / objectif)
        # Préserve les N derniers tours utilisateur
        # Replie les tours intermédiaires dans un point d'étape synthétique
        first_turn_end = user_step_indices[1]
        interm_steps = steps[first_turn_end:boundary_idx]

        if len(interm_steps) > 2:
            middle_turns_count = len(user_step_indices) - preserve_last_n_turns - 1
            checkpoint_step = {
                "step_index": interm_steps[0].get("step_index", first_turn_end),
                "source": "SYSTEM",
                "type": "CONTEXT_CHECKPOINT",
                "status": "DONE",
                "content": (
                    f"[📌 Point d'étape de contexte : {middle_turns_count} tours intermédiaires "
                    f"ont été archivés pour respecter le plafond strict de budget ({max_tokens:,} tokens). "
                    f"Consultez transcript_full.jsonl pour l'historique complet et non tronqué.]"
                ),
                "is_truncated": True,
                "truncated_fields": ["content"]
            }

            steps = steps[:first_turn_end] + [checkpoint_step] + steps[boundary_idx:]
            compacted_steps_count += len(interm_steps)
            stages_applied.append("sliding_window_checkpoint")
            modified = True

    curr_metrics = calculate_conversation_context_size(steps)
    if modified:
        return _finish_compaction(conversation_id, steps, initial_tokens, curr_metrics, stages_applied, compacted_steps_count)

    return {
        "status": "ok",
        "conversation_id": conversation_id,
        "action_taken": False,
        "initial_tokens": initial_tokens,
        "final_tokens": curr_metrics["estimated_input_tokens"],
        "tokens_saved": max(0, initial_tokens - curr_metrics["estimated_input_tokens"]),
        "reduction_pct": 0.0,
        "stages_applied": stages_applied,
        "compacted_steps": compacted_steps_count
    }


def _finish_compaction(
    conversation_id: str,
    steps: list[dict[str, Any]],
    initial_tokens: int,
    curr_metrics: dict[str, Any],
    stages_applied: list[str],
    compacted_steps_count: int
) -> dict[str, Any]:
    conv_dir = BRAIN_DIR / conversation_id
    transcript_path = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"
    atomic_write_jsonl(transcript_path, steps)
    _notify_transcript_changed(conversation_id)

    final_tokens = curr_metrics["estimated_input_tokens"]
    tokens_saved = max(0, initial_tokens - final_tokens)
    reduction_pct = round((tokens_saved / max(1, initial_tokens)) * 100, 1)

    logger.info(
        f"[Context Budget {conversation_id}] Applied stages {stages_applied}: "
        f"{initial_tokens:,} -> {final_tokens:,} tokens (-{tokens_saved:,} tokens, -{reduction_pct}%)."
    )

    return {
        "status": "ok",
        "conversation_id": conversation_id,
        "action_taken": True,
        "initial_tokens": initial_tokens,
        "final_tokens": final_tokens,
        "tokens_saved": tokens_saved,
        "reduction_pct": reduction_pct,
        "stages_applied": stages_applied,
        "compacted_steps": compacted_steps_count
    }
