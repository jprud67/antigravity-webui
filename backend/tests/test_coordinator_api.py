"""Unit tests for Multi-Workspace Coordinator & Pipelines REST API."""

from __future__ import annotations

from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_coordinator_overview_endpoint(auth_headers: dict):
    res = client.get("/api/coordinator/overview", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "workspaces" in data
    assert "active_workspace_path" in data
    assert "global_health" in data


def test_coordinator_pipelines_discovery(auth_headers: dict):
    res = client.get("/api/coordinator/pipelines", headers=auth_headers)
    assert res.status_code == 200
    pipelines = res.json()
    assert isinstance(pipelines, list)


def test_coordinator_run_and_details_not_found(auth_headers: dict):
    res = client.get("/api/coordinator/run/non-existent-run-id", headers=auth_headers)
    assert res.status_code == 404


def test_coordinator_cancel_not_found(auth_headers: dict):
    res = client.post("/api/coordinator/cancel/non-existent-run-id", headers=auth_headers)
    assert res.status_code == 404


def test_coordinator_remediation_context(auth_headers: dict, tmp_path: Path):
    payload = {
        "workspace_path": str(tmp_path),
        "run_id": "fake-run",
        "failed_step_id": "test",
        "step_command": "pytest",
        "step_output": "AssertionError: 1 != 2",
    }
    res = client.post("/api/coordinator/remediation", json=payload, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "remediation_prompt" in data
    assert "AssertionError" in data["remediation_prompt"]
