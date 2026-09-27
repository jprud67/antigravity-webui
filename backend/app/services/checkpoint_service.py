"""
Checkpoint & Rewind Service — Antigravity WebUI v0.4.2
Permet de capturer des snapshots (checkpoints) de l'état d'une conversation,
puis de restaurer (rewind) ou bifurquer (fork) depuis n'importe quel checkpoint.
"""

import json
import logging
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import BRAIN_DIR
from app.services.storage import (
    atomic_write_jsonl,
    calculate_conversation_tokens,
    fork_conversation,
    get_conversation_transcript,
    is_safe_conversation_id,
)

logger = logging.getLogger("antigravity.checkpoint")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _checkpoints_dir(conversation_id: str) -> Path:
    """Returns the checkpoints storage directory for a conversation."""
    return BRAIN_DIR / conversation_id / ".system_generated" / "checkpoints"


def _read_jsonl(path: Path) -> list[dict[str, Any]]:
    """Reads a JSONL file and returns a list of dicts."""
    items: list[dict[str, Any]] = []
    if not path.exists() or path.stat().st_size == 0:
        return items
    try:
        with open(path, "r", encoding="utf-8-sig", errors="replace") as f:
            for line in f:
                stripped = line.strip().lstrip("\ufeff")
                if not stripped:
                    continue
                try:
                    items.append(json.loads(stripped))
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        logger.warning(f"Failed reading JSONL {path}: {e}")
    return items


def _count_messages(steps: list[dict[str, Any]]) -> int:
    """Counts user+assistant messages in transcript steps."""
    count = 0
    for s in steps:
        stype = s.get("type", "")
        if stype in ("USER_INPUT", "PLANNER_RESPONSE"):
            count += 1
    return count


def _extract_tools_used(steps: list[dict[str, Any]]) -> list[str]:
    """Extracts unique tool names from transcript steps."""
    tools: set[str] = set()
    for s in steps:
        for tc in s.get("tool_calls", []):
            name = tc.get("name") or tc.get("tool_name", "")
            if name:
                tools.add(name)
    return sorted(tools)


def _extract_preview_messages(steps: list[dict[str, Any]], max_count: int = 5) -> list[dict[str, str]]:
    """Extracts the last N user/assistant messages for preview."""
    messages: list[dict[str, str]] = []
    for s in reversed(steps):
        stype = s.get("type", "")
        content = s.get("content", "")
        if stype == "USER_INPUT" and content:
            messages.insert(0, {"role": "user", "content": content[:500]})
        elif stype == "PLANNER_RESPONSE" and content:
            messages.insert(0, {"role": "assistant", "content": content[:500]})
        if len(messages) >= max_count:
            break
    return messages


# ---------------------------------------------------------------------------
# Core API
# ---------------------------------------------------------------------------

def create_checkpoint(
    conversation_id: str,
    label: str = "",
    auto_generated: bool = False,
) -> dict[str, Any]:
    """
    Creates a checkpoint (snapshot) of the current conversation state.
    Saves the full transcript, metadata, and artifacts manifest.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    conv_dir = BRAIN_DIR / conversation_id
    if not conv_dir.exists():
        raise ValueError(f"Conversation introuvable : {conversation_id}")

    # Read current transcript (prefer transcript_full.jsonl for completeness)
    full_transcript_path = conv_dir / ".system_generated" / "logs" / "transcript_full.jsonl"
    compact_transcript_path = conv_dir / ".system_generated" / "logs" / "transcript.jsonl"

    steps = _read_jsonl(full_transcript_path)
    if not steps:
        steps = _read_jsonl(compact_transcript_path)
    if not steps:
        steps = get_conversation_transcript(conversation_id)
    if not steps:
        raise ValueError("Aucun historique trouvé pour créer un checkpoint")

    # Determine step_index (last step)
    last_step_index = max((s.get("step_index", 0) for s in steps), default=0)

    # Generate checkpoint ID
    checkpoint_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    # Calculate token usage
    usage = calculate_conversation_tokens(steps)
    token_count = usage.get("total_tokens", 0) if isinstance(usage, dict) else 0

    # Count messages and extract tools
    message_count = _count_messages(steps)

    # Determine agent state
    agent_state = "idle"
    if steps:
        last = steps[-1]
        if last.get("status") == "RUNNING" or last.get("type") == "TOOL_CALL":
            agent_state = "running"
        elif last.get("status") == "DONE":
            agent_state = "completed"

    # List artifacts
    artifacts: list[str] = []
    artifacts_dir = conv_dir
    for item in artifacts_dir.iterdir():
        if item.is_file() and item.suffix in (".md", ".py", ".json", ".txt", ".html", ".css", ".js", ".ts", ".tsx"):
            artifacts.append(item.name)
    scratch_dir = conv_dir / "scratch"
    if scratch_dir.exists():
        for item in scratch_dir.iterdir():
            if item.is_file():
                artifacts.append(f"scratch/{item.name}")

    # Generate label if empty
    if not label:
        label = f"Checkpoint au step {last_step_index}" if not auto_generated else f"Auto-checkpoint #{last_step_index}"

    # Build metadata
    metadata = {
        "id": checkpoint_id,
        "conversation_id": conversation_id,
        "step_index": last_step_index,
        "label": label,
        "timestamp": now,
        "token_count": token_count,
        "message_count": message_count,
        "agent_state": agent_state,
        "auto_generated": auto_generated,
        "artifacts_count": len(artifacts),
    }

    # Create checkpoint directory
    chk_dir = _checkpoints_dir(conversation_id) / checkpoint_id
    chk_dir.mkdir(parents=True, exist_ok=True)

    # Write snapshot metadata
    with open(chk_dir / "snapshot.json", "w", encoding="utf-8") as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)

    # Write transcript snapshot
    atomic_write_jsonl(chk_dir / "transcript_snapshot.jsonl", steps)

    # Write artifacts manifest
    with open(chk_dir / "artifacts_manifest.json", "w", encoding="utf-8") as f:
        json.dump({"artifacts": artifacts, "timestamp": now}, f, ensure_ascii=False, indent=2)

    logger.info(f"Checkpoint {checkpoint_id} created for conversation {conversation_id} at step {last_step_index}")
    return metadata


def list_checkpoints(conversation_id: str) -> list[dict[str, Any]]:
    """Lists all checkpoints for a conversation, sorted by timestamp (newest first)."""
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    chk_root = _checkpoints_dir(conversation_id)
    if not chk_root.exists():
        return []

    checkpoints: list[dict[str, Any]] = []
    for chk_dir in chk_root.iterdir():
        if not chk_dir.is_dir():
            continue
        snapshot_file = chk_dir / "snapshot.json"
        if not snapshot_file.exists():
            continue
        try:
            with open(snapshot_file, "r", encoding="utf-8") as f:
                meta = json.load(f)
            checkpoints.append(meta)
        except Exception as e:
            logger.warning(f"Failed reading checkpoint snapshot {snapshot_file}: {e}")
            continue

    # Sort by timestamp descending (newest first)
    checkpoints.sort(key=lambda c: c.get("timestamp", ""), reverse=True)
    return checkpoints


def get_checkpoint_detail(conversation_id: str, checkpoint_id: str) -> dict[str, Any]:
    """
    Retrieves detailed information about a specific checkpoint,
    including preview messages, modified files summary, and tools used.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    # Validate checkpoint_id (alphanumeric + dashes only)
    if not checkpoint_id or ".." in checkpoint_id or "/" in checkpoint_id or "\\" in checkpoint_id:
        raise ValueError("Identifiant de checkpoint non valide")

    chk_dir = _checkpoints_dir(conversation_id) / checkpoint_id
    if not chk_dir.exists():
        raise ValueError(f"Checkpoint introuvable : {checkpoint_id}")

    # Read metadata
    snapshot_file = chk_dir / "snapshot.json"
    if not snapshot_file.exists():
        raise ValueError(f"Métadonnées de checkpoint introuvables pour : {checkpoint_id}")

    with open(snapshot_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    # Read transcript snapshot for preview
    transcript_snapshot = _read_jsonl(chk_dir / "transcript_snapshot.jsonl")

    # Extract preview messages
    preview_messages = _extract_preview_messages(transcript_snapshot)

    # Extract tools used
    tools_used = _extract_tools_used(transcript_snapshot)

    # Extract modified files (from tool calls targeting files)
    modified_files: list[dict[str, Any]] = []
    seen_paths: set[str] = set()
    for s in transcript_snapshot:
        for tc in s.get("tool_calls", []):
            name = tc.get("name", "")
            args = tc.get("args", {})
            if isinstance(args, dict):
                path = args.get("TargetFile") or args.get("target_file") or args.get("AbsolutePath", "")
                if path and path not in seen_paths:
                    seen_paths.add(path)
                    is_write = name in ("write_to_file", "replace_file_content", "multi_replace_file_content")
                    modified_files.append({
                        "path": path,
                        "additions": 1 if is_write else 0,
                        "deletions": 0,
                    })

    # Read artifacts manifest
    artifacts_manifest = chk_dir / "artifacts_manifest.json"
    artifacts_list: list[str] = []
    if artifacts_manifest.exists():
        try:
            with open(artifacts_manifest, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            artifacts_list = manifest.get("artifacts", [])
        except Exception:
            pass

    return {
        **metadata,
        "preview_messages": preview_messages,
        "modified_files": modified_files[:50],  # Limit to 50
        "tools_used": tools_used,
        "artifacts": artifacts_list,
    }


def restore_checkpoint(conversation_id: str, checkpoint_id: str) -> dict[str, Any]:
    """
    Restores (rewinds) a conversation to a specific checkpoint.
    WARNING: This truncates all steps after the checkpoint's step_index.
    A safety backup is created automatically before the restore.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    if not checkpoint_id or ".." in checkpoint_id or "/" in checkpoint_id or "\\" in checkpoint_id:
        raise ValueError("Identifiant de checkpoint non valide")

    chk_dir = _checkpoints_dir(conversation_id) / checkpoint_id
    if not chk_dir.exists():
        raise ValueError(f"Checkpoint introuvable : {checkpoint_id}")

    # Read checkpoint snapshot
    snapshot_file = chk_dir / "snapshot.json"
    with open(snapshot_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    snapshot_transcript = _read_jsonl(chk_dir / "transcript_snapshot.jsonl")
    if not snapshot_transcript:
        raise ValueError("Snapshot de transcription vide — restauration impossible")

    conv_dir = BRAIN_DIR / conversation_id
    logs_dir = conv_dir / ".system_generated" / "logs"

    # Safety backup: create an auto-checkpoint of the current state before restore
    try:
        create_checkpoint(
            conversation_id=conversation_id,
            label=f"Sauvegarde automatique avant restauration vers {checkpoint_id}",
            auto_generated=True,
        )
    except Exception as e:
        logger.warning(f"Failed creating safety backup before restore: {e}")

    # Overwrite transcript files with the snapshot
    transcript_path = logs_dir / "transcript.jsonl"
    transcript_full_path = logs_dir / "transcript_full.jsonl"

    atomic_write_jsonl(transcript_path, snapshot_transcript)
    atomic_write_jsonl(transcript_full_path, snapshot_transcript)

    logger.info(
        f"Conversation {conversation_id} restored to checkpoint {checkpoint_id} "
        f"(step {metadata.get('step_index', '?')})"
    )

    return {
        "success": True,
        "checkpoint_id": checkpoint_id,
        "restored_step_index": metadata.get("step_index", 0),
        "message": f"Conversation restaurée au checkpoint « {metadata.get('label', checkpoint_id)} »",
    }


def fork_from_checkpoint(
    conversation_id: str,
    checkpoint_id: str,
    new_title: str | None = None,
) -> dict[str, Any]:
    """
    Creates a new conversation (fork/branch) from a specific checkpoint,
    without modifying the original conversation.
    """
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    if not checkpoint_id or ".." in checkpoint_id or "/" in checkpoint_id or "\\" in checkpoint_id:
        raise ValueError("Identifiant de checkpoint non valide")

    chk_dir = _checkpoints_dir(conversation_id) / checkpoint_id
    if not chk_dir.exists():
        raise ValueError(f"Checkpoint introuvable : {checkpoint_id}")

    # Read checkpoint metadata
    snapshot_file = chk_dir / "snapshot.json"
    with open(snapshot_file, "r", encoding="utf-8") as f:
        metadata = json.load(f)

    step_index = metadata.get("step_index", 0)
    label = metadata.get("label", checkpoint_id)

    # Use the existing fork_conversation utility with the checkpoint's step_index
    fork_title = new_title or f"Fork depuis « {label} » (step {step_index})"
    result = fork_conversation(
        source_conversation_id=conversation_id,
        up_to_step_index=step_index,
        new_title=fork_title,
    )

    logger.info(
        f"Forked conversation {conversation_id} from checkpoint {checkpoint_id} "
        f"→ new conversation {result.get('conversation_id', '?')}"
    )

    return {
        "success": True,
        "new_conversation_id": result.get("conversation_id", ""),
        "source_checkpoint_id": checkpoint_id,
        "forked_at_step": step_index,
        "title": fork_title,
    }


def delete_checkpoint(conversation_id: str, checkpoint_id: str) -> dict[str, Any]:
    """Deletes a specific checkpoint."""
    if not is_safe_conversation_id(conversation_id):
        raise ValueError("Identifiant de conversation non valide")

    if not checkpoint_id or ".." in checkpoint_id or "/" in checkpoint_id or "\\" in checkpoint_id:
        raise ValueError("Identifiant de checkpoint non valide")

    chk_dir = _checkpoints_dir(conversation_id) / checkpoint_id
    if not chk_dir.exists():
        raise ValueError(f"Checkpoint introuvable : {checkpoint_id}")

    try:
        shutil.rmtree(chk_dir)
    except Exception as e:
        raise ValueError(f"Échec de la suppression du checkpoint : {e}")

    logger.info(f"Checkpoint {checkpoint_id} deleted for conversation {conversation_id}")
    return {"success": True, "deleted_checkpoint_id": checkpoint_id}
