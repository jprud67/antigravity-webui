import json

import pytest

from app.services.agent_orchestrator import (
    AgentEdge,
    AgentNode,
    AgentNodeMetrics,
    AgentNodeRole,
    AgentNodeStatus,
    OrchestratorGraphResponse,
    build_orchestrator_graph,
    get_agent_inspection_details,
    steer_agent,
    terminate_agent,
)


def test_models_structure():
    metrics = AgentNodeMetrics(duration_ms=1500, tool_call_count=3)
    node = AgentNode(
        id="test_node",
        name="Worker 1",
        parent_id=None,
        depth=0,
        role=AgentNodeRole.WORKER,
        status=AgentNodeStatus.RUNNING,
        metrics=metrics,
    )
    assert node.id == "test_node"
    assert node.status == AgentNodeStatus.RUNNING
    assert node.metrics.duration_ms == 1500

    edge = AgentEdge(source="root", target="child_1", edge_type="spawns")
    assert edge.source == "root"
    assert edge.target == "child_1"


def test_build_graph_empty_session(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    res = build_orchestrator_graph("clean_session_123")
    assert isinstance(res, OrchestratorGraphResponse)
    assert res.conversation_id == "clean_session_123"
    assert len(res.nodes) >= 1
    assert res.nodes[0].role == AgentNodeRole.ROOT
    assert res.nodes[0].id == "root_clean_session_123"
    assert res.nodes[0].status == AgentNodeStatus.COMPLETED or res.nodes[0].status == AgentNodeStatus.RUNNING


def test_build_graph_with_subagents(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    
    # Create parent session directory and transcript
    parent_dir = tmp_path / "parent_session"
    logs_dir = parent_dir / ".system_generated" / "logs"
    logs_dir.mkdir(parents=True)
    
    # Create child session directory
    child_dir = tmp_path / "child_subagent_1"
    child_logs_dir = child_dir / ".system_generated" / "logs"
    child_logs_dir.mkdir(parents=True)

    # Transcript with invoke_subagent
    parent_transcript = logs_dir / "transcript.jsonl"
    with open(parent_transcript, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "step_index": 1,
            "type": "USER_INPUT",
            "content": "Create subagent to test feature"
        }) + "\n")
        f.write(json.dumps({
            "step_index": 2,
            "type": "PLANNER_RESPONSE",
            "tool_calls": [{
                "id": "call_1",
                "tool_name": "invoke_subagent",
                "tool_arguments": {
                    "Task": "Run backend unit tests",
                    "TaskName": "Test Runner",
                    "ConversationId": "child_subagent_1"
                }
            }]
        }) + "\n")

    # Child transcript with activity
    child_transcript = child_logs_dir / "transcript.jsonl"
    with open(child_transcript, "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "step_index": 1,
            "type": "USER_INPUT",
            "content": "Run backend unit tests"
        }) + "\n")
        f.write(json.dumps({
            "step_index": 2,
            "type": "PLANNER_RESPONSE",
            "content": "Running test suite now...",
            "tool_calls": [{
                "id": "call_pytest",
                "tool_name": "run_command",
                "tool_arguments": {"CommandLine": "pytest"}
            }]
        }) + "\n")

    graph = build_orchestrator_graph("parent_session")
    assert len(graph.nodes) == 2
    root = next(n for n in graph.nodes if n.role == AgentNodeRole.ROOT)
    child = next(n for n in graph.nodes if n.id == "child_subagent_1")
    assert child.parent_id == root.id
    assert child.depth == 1
    assert len(graph.edges) == 1
    assert graph.edges[0].source == root.id
    assert graph.edges[0].target == child.id


def test_steer_agent(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    res = steer_agent("parent_conv", "child_agent_1", "Focus on edge cases")
    assert res["success"] is True
    assert res["target_agent_id"] == "child_agent_1"
    assert "Focus on edge cases" in res["instruction"]


def test_terminate_agent_single_and_cascade(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    
    # Single termination
    res_single = terminate_agent("parent_conv", "agent_worker_1", recursive=False)
    assert res_single["success"] is True
    assert res_single["target_agent_id"] == "agent_worker_1"
    assert res_single["recursive"] is False

    # Cascade termination
    res_cascade = terminate_agent("parent_conv", "agent_worker_1", recursive=True)
    assert res_cascade["success"] is True
    assert res_cascade["recursive"] is True


def test_security_traversal_guards():
    with pytest.raises(ValueError):
        build_orchestrator_graph("../../etc/passwd")

    with pytest.raises(ValueError):
        steer_agent("valid_conv", "../malicious/id", "bad instruction")

    with pytest.raises(ValueError):
        terminate_agent("../bad/conv", "valid_target", recursive=False)


def test_get_agent_inspection_details(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    
    agent_dir = tmp_path / "inspect_agent_1"
    logs_dir = agent_dir / ".system_generated" / "logs"
    logs_dir.mkdir(parents=True)
    
    with open(logs_dir / "transcript.jsonl", "w", encoding="utf-8") as f:
        f.write(json.dumps({
            "step_index": 1,
            "type": "PLANNER_RESPONSE",
            "content": "Analyzing repository structure to optimize routes.",
            "tool_calls": [{
                "id": "t1",
                "tool_name": "view_file",
                "tool_arguments": {"AbsolutePath": "/app/main.py"}
            }]
        }) + "\n")

    details = get_agent_inspection_details("inspect_agent_1", "parent_conv")
    assert details["agent_id"] == "inspect_agent_1"
    assert "Analyzing repository structure" in details["thought_preview"] or len(details["tools"]) >= 1


from fastapi.testclient import TestClient

from app.main import app

api_client = TestClient(app)


def get_auth_headers():
    login_res = api_client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_api_orchestrator_auth_guard():
    # Unauthenticated calls should be rejected with 401 or 403
    res = api_client.get("/api/orchestrator/graph/test_conv")
    assert res.status_code in (401, 403)

    res_steer = api_client.post("/api/orchestrator/steer", json={
        "conversation_id": "test_conv",
        "target_agent_id": "target",
        "instruction": "do something"
    })
    assert res_steer.status_code in (401, 403)


def test_api_orchestrator_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    headers = get_auth_headers()

    # 1. GET /api/orchestrator/graph/{conversation_id}
    res_graph = api_client.get("/api/orchestrator/graph/api_conv_1", headers=headers)
    assert res_graph.status_code == 200
    graph_data = res_graph.json()
    assert graph_data["conversation_id"] == "api_conv_1"
    assert len(graph_data["nodes"]) >= 1

    # 2. POST /api/orchestrator/steer
    res_steer = api_client.post("/api/orchestrator/steer", json={
        "conversation_id": "api_conv_1",
        "target_agent_id": "worker_node_1",
        "instruction": "Prioritize unit tests"
    }, headers=headers)
    assert res_steer.status_code == 200
    assert res_steer.json()["success"] is True

    # 3. POST /api/orchestrator/terminate
    res_term = api_client.post("/api/orchestrator/terminate", json={
        "conversation_id": "api_conv_1",
        "target_agent_id": "worker_node_1",
        "recursive": True
    }, headers=headers)
    assert res_term.status_code == 200
    assert res_term.json()["success"] is True
    assert res_term.json()["recursive"] is True

    # 4. GET /api/orchestrator/inspect/{agent_id}
    res_inspect = api_client.get("/api/orchestrator/inspect/worker_node_1?conversation_id=api_conv_1", headers=headers)
    assert res_inspect.status_code == 200
    assert res_inspect.json()["agent_id"] == "worker_node_1"

    # 5. POST /api/orchestrator/fork
    res_fork = api_client.post("/api/orchestrator/fork", json={
        "conversation_id": "api_conv_1",
        "parent_agent_id": "worker_node_1",
        "branch_name": "feature-fork-test",
        "model": "Claude 3.7 Sonnet",
        "directives": "Alternative implementation test",
        "create_worktree": False
    }, headers=headers)
    assert res_fork.status_code == 200
    fork_data = res_fork.json()
    assert fork_data["success"] is True
    assert fork_data["parent_agent_id"] == "worker_node_1"
    assert "fork_" in fork_data["forked_agent_id"]

    # 6. GET /api/orchestrator/compare
    res_compare = api_client.get("/api/orchestrator/compare?conversation_id=api_conv_1", headers=headers)
    assert res_compare.status_code == 200
    compare_data = res_compare.json()
    assert compare_data["conversation_id"] == "api_conv_1"
    assert isinstance(compare_data["agents"], list)


def test_fork_agent_node_and_graph_integration(tmp_path, monkeypatch):
    monkeypatch.setattr("app.services.agent_orchestrator.BRAIN_DIR", tmp_path)
    from app.services.agent_orchestrator import (
        ForkAgentRequest,
        fork_agent_node,
        build_orchestrator_graph,
        compare_execution_branches,
    )

    req = ForkAgentRequest(
        conversation_id="session_fork_test",
        parent_agent_id="root_session_fork_test",
        branch_name="feature-opt",
        model="Gemini 3.8 Flash (Low)",
        directives="Benchmark parallel sorting algorithm",
        create_worktree=False
    )
    res = fork_agent_node(req)
    assert res.success is True
    assert res.parent_agent_id == "root_session_fork_test"
    assert res.forked_agent_id.startswith("fork_")

    # Verify graph includes forked node and edge
    graph = build_orchestrator_graph("session_fork_test")
    fork_nodes = [n for n in graph.nodes if n.is_fork]
    assert len(fork_nodes) == 1
    assert fork_nodes[0].id == res.forked_agent_id
    assert fork_nodes[0].fork_parent_id == "root_session_fork_test"

    # Verify edge
    fork_edges = [e for e in graph.edges if e.edge_type == "forks"]
    assert len(fork_edges) == 1
    assert fork_edges[0].source == "root_session_fork_test"
    assert fork_edges[0].target == res.forked_agent_id

    # Verify comparison
    comp = compare_execution_branches("session_fork_test")
    assert comp.conversation_id == "session_fork_test"
    assert len(comp.agents) >= 1


