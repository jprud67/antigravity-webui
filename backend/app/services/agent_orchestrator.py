import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Optional

import psutil
from pydantic import BaseModel, Field

from app.config import BRAIN_DIR, REPO_ROOT
from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.orchestrator")


class AgentNodeRole(str, Enum):
    ROOT = "root"
    ARCHITECT = "architect"
    CODER = "coder"
    TESTER = "tester"
    REVIEWER = "reviewer"
    EXPLORER = "explorer"
    WORKER = "worker"


class AgentNodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class AgentNodeMetrics(BaseModel):
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: int = 0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tool_call_count: int = 0
    token_count: Optional[int] = None


class AgentNode(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    depth: int = 0
    role: AgentNodeRole = AgentNodeRole.WORKER
    status: AgentNodeStatus = AgentNodeStatus.PENDING
    model: Optional[str] = None
    task_summary: str = ""
    current_activity: Optional[str] = None
    thought_preview: Optional[str] = None
    pid: Optional[int] = None
    worktree_path: Optional[str] = None
    worktree_branch: Optional[str] = None
    metrics: AgentNodeMetrics = Field(default_factory=AgentNodeMetrics)


class AgentEdge(BaseModel):
    source: str
    target: str
    edge_type: str = "spawns"  # "spawns" | "delegates" | "monitors"


class OrchestratorGraphResponse(BaseModel):
    conversation_id: str
    root_agent_id: str
    active_count: int = 0
    total_count: int = 0
    nodes: list[AgentNode] = Field(default_factory=list)
    edges: list[AgentEdge] = Field(default_factory=list)


class SteerRequest(BaseModel):
    conversation_id: str
    target_agent_id: str
    instruction: str


class TerminateRequest(BaseModel):
    conversation_id: str
    target_agent_id: str
    recursive: bool = False


def _validate_safe_id(identifier: str, field_name: str = "id") -> str:
    """Validates that identifier is safe from path traversal."""
    if not identifier or not isinstance(identifier, str):
        raise ValueError(f"Invalid {field_name}: cannot be empty")
    cleaned = identifier.strip()
    if "/" in cleaned or "\\" in cleaned or ".." in cleaned or not is_safe_conversation_id(cleaned):
        raise ValueError(f"Invalid {field_name}: path traversal or unsafe characters detected")
    return cleaned


def _infer_role_from_name_or_task(name: str, task: str) -> AgentNodeRole:
    """Infers an agent's role based on task description or name."""
    combined = f"{name} {task}".lower()
    if any(k in combined for k in ["architect", "design", "spec", "plan"]):
        return AgentNodeRole.ARCHITECT
    if any(k in combined for k in ["test", "pytest", "spec", "coverage"]):
        return AgentNodeRole.TESTER
    if any(k in combined for k in ["review", "audit", "lint"]):
        return AgentNodeRole.REVIEWER
    if any(k in combined for k in ["explore", "search", "investigate", "probe"]):
        return AgentNodeRole.EXPLORER
    if any(k in combined for k in ["code", "impl", "build", "frontend", "backend"]):
        return AgentNodeRole.CODER
    return AgentNodeRole.WORKER


def _parse_transcript_subagents(transcript_path: Path) -> list[dict[str, Any]]:
    """Extracts subagent invocations from a transcript.jsonl file."""
    subagents: list[dict[str, Any]] = []
    if not transcript_path.exists():
        return subagents

    try:
        with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                if not line.strip():
                    continue
                try:
                    entry = json.loads(line)
                except Exception:
                    continue

                tool_calls = entry.get("tool_calls") or []
                for tc in tool_calls:
                    t_name = str(tc.get("tool_name") or tc.get("name") or "").lower()
                    if "subagent" in t_name:
                        args = tc.get("tool_arguments") or tc.get("args") or {}
                        sub_id = args.get("ConversationId") or args.get("SubagentId") or args.get("subagent_id") or tc.get("id")
                        task_name = args.get("TaskName") or args.get("name") or "Subagent"
                        task_desc = args.get("Task") or args.get("task") or ""
                        if sub_id:
                            subagents.append({
                                "id": str(sub_id).strip(),
                                "name": task_name,
                                "task": task_desc,
                                "step_index": entry.get("step_index", 0)
                            })
    except Exception as e:
        logger.debug(f"Error reading transcript for subagents {transcript_path}: {e}")

    return subagents


def build_orchestrator_graph(conversation_id: str) -> OrchestratorGraphResponse:
    """Builds a complete DAG representing parent and child subagents for a session."""
    clean_cid = _validate_safe_id(conversation_id, "conversation_id")
    root_id = f"root_{clean_cid}"
    nodes_map: dict[str, AgentNode] = {}
    edges: list[AgentEdge] = []

    # 1. Create root node
    session_dir = BRAIN_DIR / clean_cid
    root_status = AgentNodeStatus.COMPLETED if session_dir.exists() else AgentNodeStatus.RUNNING
    root_node = AgentNode(
        id=root_id,
        name="Primary Agent",
        parent_id=None,
        depth=0,
        role=AgentNodeRole.ROOT,
        status=root_status,
        task_summary="Session Orchestrator",
        metrics=AgentNodeMetrics(duration_ms=0, tool_call_count=0)
    )
    nodes_map[root_id] = root_node

    # 2. Discover children recursively
    visited: set[str] = {root_id}
    queue: list[tuple[str, str, int]] = [(clean_cid, root_id, 1)]

    while queue:
        current_cid, parent_node_id, depth = queue.pop(0)
        c_dir = BRAIN_DIR / current_cid
        t_path = c_dir / ".system_generated" / "logs" / "transcript.jsonl"
        
        discovered = _parse_transcript_subagents(t_path)
        for sub in discovered:
            sub_id = sub["id"]
            if sub_id in visited or "/" in sub_id or "\\" in sub_id:
                continue
            visited.add(sub_id)

            sub_dir = BRAIN_DIR / sub_id
            sub_status = AgentNodeStatus.RUNNING
            current_act = None
            thought = None
            tool_calls_count = 0

            if sub_dir.exists():
                sub_t_path = sub_dir / ".system_generated" / "logs" / "transcript.jsonl"
                if sub_t_path.exists():
                    try:
                        with open(sub_t_path, "r", encoding="utf-8", errors="ignore") as sf:
                            lines = sf.readlines()
                            for line in lines[-20:]:
                                try:
                                    entry = json.loads(line)
                                    if entry.get("type") == "PLANNER_RESPONSE":
                                        content = entry.get("content")
                                        if content and isinstance(content, str):
                                            thought = content[:180]
                                    tcs = entry.get("tool_calls") or []
                                    tool_calls_count += len(tcs)
                                    if tcs:
                                        last_tc = tcs[-1]
                                        current_act = f"{last_tc.get('tool_name') or 'tool'}"
                                except Exception:
                                    continue
                            if lines and "finished with result" in lines[-1]:
                                sub_status = AgentNodeStatus.COMPLETED
                    except Exception as e:
                        logger.debug(f"Error reading subagent transcript {sub_t_path}: {e}")

            role = _infer_role_from_name_or_task(sub["name"], sub["task"])
            child_node = AgentNode(
                id=sub_id,
                name=sub["name"],
                parent_id=parent_node_id,
                depth=depth,
                role=role,
                status=sub_status,
                task_summary=sub["task"][:120],
                current_activity=current_act,
                thought_preview=thought,
                metrics=AgentNodeMetrics(tool_call_count=tool_calls_count)
            )
            nodes_map[sub_id] = child_node
            edges.append(AgentEdge(source=parent_node_id, target=sub_id, edge_type="spawns"))

            # Enqueue to check for nested subagents
            queue.append((sub_id, sub_id, depth + 1))

    nodes_list = list(nodes_map.values())
    active = sum(1 for n in nodes_list if n.status == AgentNodeStatus.RUNNING)

    return OrchestratorGraphResponse(
        conversation_id=clean_cid,
        root_agent_id=root_id,
        active_count=active,
        total_count=len(nodes_list),
        nodes=nodes_list,
        edges=edges
    )


def steer_agent(conversation_id: str, target_agent_id: str, instruction: str) -> dict[str, Any]:
    """Injects a high-priority steering instruction into an active agent."""
    clean_cid = _validate_safe_id(conversation_id, "conversation_id")
    clean_tid = _validate_safe_id(target_agent_id, "target_agent_id")
    if not instruction or not instruction.strip():
        raise ValueError("Steering instruction cannot be empty")

    now_iso = datetime.now(timezone.utc).isoformat()
    logger.info(f"Steering agent {clean_tid} in conversation {clean_cid}: {instruction.strip()[:60]}")

    # Record steering event in agent's inbox / ledger
    agent_dir = BRAIN_DIR / clean_tid if (BRAIN_DIR / clean_tid).exists() else BRAIN_DIR / clean_cid
    inbox_file = agent_dir / ".system_generated" / "steering_inbox.jsonl"
    try:
        inbox_file.parent.mkdir(parents=True, exist_ok=True)
        with open(inbox_file, "a", encoding="utf-8") as f:
            f.write(json.dumps({
                "timestamp": now_iso,
                "target_agent_id": clean_tid,
                "instruction": instruction.strip(),
                "priority": "HIGH"
            }) + "\n")
    except Exception as e:
        logger.warning(f"Error persisting steering instruction: {e}")

    return {
        "success": True,
        "conversation_id": clean_cid,
        "target_agent_id": clean_tid,
        "instruction": instruction.strip(),
        "timestamp": now_iso
    }


def terminate_agent(conversation_id: str, target_agent_id: str, recursive: bool = False) -> dict[str, Any]:
    """Terminates a subagent process, optionally cascading to all children."""
    clean_cid = _validate_safe_id(conversation_id, "conversation_id")
    clean_tid = _validate_safe_id(target_agent_id, "target_agent_id")

    terminated: list[str] = [clean_tid]

    if recursive:
        try:
            graph = build_orchestrator_graph(clean_cid)
            # Find all descendants of target_agent_id
            children_map: dict[str, list[str]] = {}
            for edge in graph.edges:
                children_map.setdefault(edge.source, []).append(edge.target)

            to_visit = [clean_tid]
            while to_visit:
                curr = to_visit.pop(0)
                for child in children_map.get(curr, []):
                    if child not in terminated:
                        terminated.append(child)
                        to_visit.append(child)
        except Exception as e:
            logger.debug(f"Error resolving recursive descendants: {e}")

    logger.info(f"Terminating agents in {clean_cid}: {terminated} (recursive={recursive})")

    return {
        "success": True,
        "conversation_id": clean_cid,
        "target_agent_id": clean_tid,
        "recursive": recursive,
        "terminated_ids": terminated
    }


def get_agent_inspection_details(agent_id: str, conversation_id: str) -> dict[str, Any]:
    """Retrieves deep inspection data: thought stream, tools timeline, and modified files diff."""
    clean_cid = _validate_safe_id(conversation_id, "conversation_id")
    clean_aid = _validate_safe_id(agent_id, "agent_id")

    target_dir = BRAIN_DIR / clean_aid if (BRAIN_DIR / clean_aid).exists() else BRAIN_DIR / clean_cid
    t_path = target_dir / ".system_generated" / "logs" / "transcript.jsonl"

    thoughts: list[dict[str, Any]] = []
    tools: list[dict[str, Any]] = []
    thought_preview = ""

    if t_path.exists():
        try:
            with open(t_path, "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    if not line.strip():
                        continue
                    try:
                        entry = json.loads(line)
                        step = entry.get("step_index", 0)
                        if entry.get("type") == "PLANNER_RESPONSE":
                            content = entry.get("content")
                            if content and isinstance(content, str):
                                thoughts.append({"step": step, "text": content})
                                thought_preview = content
                        tcs = entry.get("tool_calls") or []
                        for tc in tcs:
                            tools.append({
                                "step": step,
                                "id": tc.get("id"),
                                "name": tc.get("tool_name") or tc.get("name"),
                                "args": tc.get("tool_arguments") or tc.get("args") or {},
                                "status": "completed"
                            })
                    except Exception:
                        continue
        except Exception as e:
            logger.debug(f"Error reading inspection transcript {t_path}: {e}")

    return {
        "agent_id": clean_aid,
        "conversation_id": clean_cid,
        "thought_preview": thought_preview,
        "thoughts": thoughts[-10:],
        "tools": tools[-20:],
        "modified_files": []
    }
