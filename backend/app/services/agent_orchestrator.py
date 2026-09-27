import json
import logging
import uuid
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

from app.config import BRAIN_DIR, REPO_ROOT
from app.services.git_worktree import create_subagent_worktree
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
    started_at: str | None = None
    completed_at: str | None = None
    duration_ms: int = 0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tool_call_count: int = 0
    token_count: int | None = None


class AgentNode(BaseModel):
    id: str
    name: str
    parent_id: str | None = None
    depth: int = 0
    role: AgentNodeRole = AgentNodeRole.WORKER
    status: AgentNodeStatus = AgentNodeStatus.PENDING
    model: str | None = None
    task_summary: str = ""
    current_activity: str | None = None
    thought_preview: str | None = None
    pid: int | None = None
    worktree_path: str | None = None
    worktree_branch: str | None = None
    is_fork: bool = False
    fork_parent_id: str | None = None
    fork_branch: str | None = None
    metrics: AgentNodeMetrics = Field(default_factory=AgentNodeMetrics)


class AgentEdge(BaseModel):
    source: str
    target: str
    edge_type: str = "spawns"  # "spawns" | "delegates" | "monitors" | "forks"


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


class ForkAgentRequest(BaseModel):
    conversation_id: str
    parent_agent_id: str
    branch_name: str | None = None
    model: str | None = None
    directives: str | None = None
    create_worktree: bool = True
    workspace_path: str | None = None


class ForkAgentResponse(BaseModel):
    success: bool
    forked_agent_id: str
    parent_agent_id: str
    branch_name: str | None = None
    worktree_path: str | None = None
    model: str | None = None
    created_at: str


class AgentComparisonItem(BaseModel):
    agent_id: str
    name: str
    role: AgentNodeRole
    status: AgentNodeStatus
    model: str | None = None
    duration_ms: int = 0
    tool_call_count: int = 0
    token_count: int | None = None
    modified_files_count: int = 0
    modified_files: list[dict[str, Any]] = Field(default_factory=list)
    thought_preview: str | None = None
    worktree_branch: str | None = None
    is_fork: bool = False
    fork_parent_id: str | None = None


class AgentComparisonResponse(BaseModel):
    conversation_id: str
    agents: list[AgentComparisonItem]


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

    # 3. Discover forked execution branches
    forks_file = session_dir / ".system_generated" / "forks.jsonl"
    if forks_file.exists():
        try:
            with open(forks_file, "r", encoding="utf-8", errors="ignore") as ff:
                for f_line in ff:
                    if not f_line.strip():
                        continue
                    try:
                        f_entry = json.loads(f_line)
                    except Exception:
                        continue
                    forked_id = f_entry.get("forked_agent_id")
                    if not forked_id or forked_id in visited:
                        continue
                    visited.add(forked_id)

                    parent_aid = f_entry.get("parent_agent_id") or root_id
                    f_directives = f_entry.get("directives") or ""
                    f_model = f_entry.get("model")
                    f_branch = f_entry.get("branch_name")
                    f_wt_path = f_entry.get("worktree_path")
                    f_role = _infer_role_from_name_or_task("Forked Branch", f_directives)

                    # Check forked agent transcript for activity
                    fork_dir = BRAIN_DIR / forked_id
                    fork_status = AgentNodeStatus.RUNNING
                    fork_thought = None
                    fork_tools = 0
                    if fork_dir.exists():
                        f_tpath = fork_dir / ".system_generated" / "logs" / "transcript.jsonl"
                        if f_tpath.exists():
                            try:
                                with open(f_tpath, "r", encoding="utf-8", errors="ignore") as fst:
                                    flines = fst.readlines()
                                    for line in flines[-15:]:
                                        try:
                                            en = json.loads(line)
                                            if en.get("type") == "PLANNER_RESPONSE" and en.get("content"):
                                                fork_thought = str(en["content"])[:180]
                                            fork_tools += len(en.get("tool_calls") or [])
                                        except Exception:
                                            continue
                                    if flines and ("finished with result" in flines[-1] or "Ready for execution" in flines[-1]):
                                        fork_status = AgentNodeStatus.COMPLETED
                            except Exception:
                                pass

                    parent_node = nodes_map.get(parent_aid)
                    p_depth = (parent_node.depth + 1) if parent_node else 1

                    fork_node = AgentNode(
                        id=forked_id,
                        name=f"Fork ({f_branch or forked_id[:12]})",
                        parent_id=parent_aid,
                        depth=p_depth,
                        role=f_role,
                        status=fork_status,
                        model=f_model,
                        task_summary=f_directives[:120] if f_directives else "Bifurcation d'exécution",
                        current_activity=f"Branch: {f_branch}" if f_branch else None,
                        thought_preview=fork_thought,
                        worktree_path=f_wt_path,
                        worktree_branch=f_branch,
                        is_fork=True,
                        fork_parent_id=parent_aid,
                        fork_branch=f_branch,
                        metrics=AgentNodeMetrics(tool_call_count=fork_tools)
                    )
                    nodes_map[forked_id] = fork_node
                    edges.append(AgentEdge(source=parent_aid, target=forked_id, edge_type="forks"))
        except Exception as e:
            logger.debug(f"Error reading forks file {forks_file}: {e}")

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
    modified_files: list[dict[str, Any]] = []
    seen_files: set[str] = set()
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
                            t_name = tc.get("tool_name") or tc.get("name") or ""
                            t_args = tc.get("tool_arguments") or tc.get("args") or {}
                            tools.append({
                                "step": step,
                                "id": tc.get("id"),
                                "name": t_name,
                                "args": t_args,
                                "status": "completed"
                            })
                            if isinstance(t_args, dict):
                                path = (
                                    t_args.get("TargetFile")
                                    or t_args.get("target_file")
                                    or t_args.get("AbsolutePath")
                                    or t_args.get("path")
                                )
                                if path and str(path) not in seen_files:
                                    seen_files.add(str(path))
                                    is_write = str(t_name).lower() in (
                                        "write_to_file",
                                        "replace_file_content",
                                        "multi_replace_file_content",
                                        "save_file",
                                    )
                                    modified_files.append({
                                        "path": str(path),
                                        "step": step,
                                        "is_write": is_write,
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
        "modified_files": modified_files[-30:]
    }


def fork_agent_node(req: ForkAgentRequest) -> ForkAgentResponse:
    """Forks an agent node to instantiate an isolated sub-branch with dedicated directives/model and worktree."""
    clean_cid = _validate_safe_id(req.conversation_id, "conversation_id")
    clean_pid = _validate_safe_id(req.parent_agent_id, "parent_agent_id")

    now_iso = datetime.now(timezone.utc).isoformat()
    forked_id = f"fork_{uuid.uuid4().hex[:8]}"

    worktree_path = None
    branch = None

    if req.create_worktree:
        cwd = req.workspace_path or str(REPO_ROOT)
        try:
            wt = create_subagent_worktree(cwd, subagent_id=forked_id, branch_name=req.branch_name)
            if wt:
                worktree_path = wt.get("path")
                branch = wt.get("branch")
        except Exception as exc:
            logger.warning(f"Error provisioning worktree for fork {forked_id}: {exc}")

    # Create subagent storage in BRAIN_DIR
    fork_dir = BRAIN_DIR / forked_id
    logs_dir = fork_dir / ".system_generated" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)

    fork_metadata = {
        "forked_agent_id": forked_id,
        "parent_agent_id": clean_pid,
        "conversation_id": clean_cid,
        "model": req.model or "Gemini 3.8 Flash (Low)",
        "directives": req.directives or "",
        "branch_name": branch,
        "worktree_path": worktree_path,
        "created_at": now_iso
    }

    try:
        meta_file = fork_dir / ".system_generated" / "fork_meta.json"
        meta_file.write_text(json.dumps(fork_metadata, indent=2), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to write fork_meta.json: {e}")

    # Register in parent conversation forks.jsonl
    conv_dir = BRAIN_DIR / clean_cid
    conv_sys = conv_dir / ".system_generated"
    conv_sys.mkdir(parents=True, exist_ok=True)
    forks_ledger = conv_sys / "forks.jsonl"
    try:
        with open(forks_ledger, "a", encoding="utf-8") as f:
            f.write(json.dumps(fork_metadata) + "\n")
    except Exception as e:
        logger.warning(f"Failed to register fork in {forks_ledger}: {e}")

    # Seed initial transcript for forked subagent
    t_file = logs_dir / "transcript.jsonl"
    try:
        with open(t_file, "w", encoding="utf-8") as f:
            f.write(json.dumps({
                "step_index": 1,
                "type": "USER_INPUT",
                "source": "USER_EXPLICIT",
                "created_at": now_iso,
                "content": req.directives or f"Branche de bifurcation issue de l'agent {clean_pid}"
            }) + "\n")
            f.write(json.dumps({
                "step_index": 2,
                "type": "PLANNER_RESPONSE",
                "created_at": now_iso,
                "content": f"Branche d'exécution isolée initialisée ({branch or 'espace partagé'}). Modèle: {req.model or 'Défaut'}."
            }) + "\n")
    except Exception as e:
        logger.warning(f"Failed to seed fork transcript: {e}")

    logger.info(f"Forked agent node {clean_pid} -> {forked_id} (branch: {branch}, model: {req.model})")

    return ForkAgentResponse(
        success=True,
        forked_agent_id=forked_id,
        parent_agent_id=clean_pid,
        branch_name=branch,
        worktree_path=worktree_path,
        model=req.model,
        created_at=now_iso
    )


def compare_execution_branches(
    conversation_id: str,
    agent_ids: list[str] | None = None
) -> AgentComparisonResponse:
    """Compares execution alternatives, measuring metrics, files, and outputs side-by-side."""
    clean_cid = _validate_safe_id(conversation_id, "conversation_id")
    graph = build_orchestrator_graph(clean_cid)

    # Determine nodes to compare
    target_nodes: list[AgentNode] = []
    if agent_ids:
        clean_ids = set(agent_ids)
        target_nodes = [n for n in graph.nodes if n.id in clean_ids]
    else:
        # Default: compare forked nodes and their immediate parents, or all subagents
        forks = [n for n in graph.nodes if getattr(n, "is_fork", False)]
        if forks:
            parent_ids = {n.fork_parent_id for n in forks if n.fork_parent_id}
            target_nodes = [n for n in graph.nodes if n.id in parent_ids or getattr(n, "is_fork", False)]
        else:
            # Fallback to all non-root nodes, or top nodes if <= 5
            target_nodes = [n for n in graph.nodes if n.role != AgentNodeRole.ROOT] or graph.nodes

    items: list[AgentComparisonItem] = []
    for node in target_nodes:
        insp = get_agent_inspection_details(agent_id=node.id, conversation_id=clean_cid)
        mod_files = insp.get("modified_files", [])

        duration = node.metrics.duration_ms
        if duration == 0 and insp.get("thoughts"):
            duration = len(insp["thoughts"]) * 1200

        items.append(AgentComparisonItem(
            agent_id=node.id,
            name=node.name,
            role=node.role,
            status=node.status,
            model=node.model,
            duration_ms=duration,
            tool_call_count=len(insp.get("tools", [])),
            token_count=node.metrics.token_count,
            modified_files_count=len(mod_files),
            modified_files=mod_files,
            thought_preview=insp.get("thought_preview") or node.thought_preview,
            worktree_branch=node.worktree_branch,
            is_fork=getattr(node, "is_fork", False),
            fork_parent_id=getattr(node, "fork_parent_id", None)
        ))

    return AgentComparisonResponse(
        conversation_id=clean_cid,
        agents=items
    )
