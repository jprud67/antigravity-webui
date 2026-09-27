import json
import pytest
from pathlib import Path

from app.services.workspace_coordinator import (
    PipelineStep,
    WorkspacePipeline,
    PipelineExecutionRun,
    MultiWorkspaceOverview,
    discover_workspace_pipelines,
    validate_workspace_path,
    build_remediation_context,
    cancel_pipeline_run,
    execute_pipeline_run,
)


def test_models_structure():
    step = PipelineStep(
        id="step_test",
        name="Unit Tests",
        command="npm test",
        cwd="/tmp/project",
        status="pending",
    )
    assert step.id == "step_test"
    assert step.status == "pending"
    assert step.exit_code is None

    pipeline = WorkspacePipeline(
        id="pipe_node",
        workspace_path="/tmp/project",
        workspace_name="Project",
        pipeline_type="test",
        name="Test Pipeline",
        steps=[step],
        status="idle",
    )
    assert pipeline.id == "pipe_node"
    assert len(pipeline.steps) == 1

    overview = MultiWorkspaceOverview(
        workspaces=[],
        active_workspace_path="/tmp/project",
        discovered_pipelines=[pipeline],
        global_health="healthy",
        running_pipeline_count=0,
        dirty_repos_count=0,
        out_of_sync_count=0,
    )
    assert overview.global_health == "healthy"
    assert len(overview.discovered_pipelines) == 1


def test_discover_pipelines_node(tmp_path):
    pkg_json = tmp_path / "package.json"
    pkg_json.write_text(
        json.dumps({
            "name": "my-node-app",
            "scripts": {
                "test": "vitest run",
                "build": "vite build",
                "lint": "oxlint",
                "typecheck": "tsc -b"
            }
        }),
        encoding="utf-8"
    )

    pipelines = discover_workspace_pipelines(str(tmp_path))
    pipeline_ids = [p.id for p in pipelines]
    assert "node_test" in pipeline_ids
    assert "node_build" in pipeline_ids
    assert "node_lint" in pipeline_ids
    assert "node_typecheck" in pipeline_ids

    test_pipe = next(p for p in pipelines if p.id == "node_test")
    assert test_pipe.pipeline_type == "test"
    assert len(test_pipe.steps) == 1
    assert "npm test" in test_pipe.steps[0].command
    assert "vitest run" in test_pipe.description


def test_discover_pipelines_python(tmp_path):
    pyproject = tmp_path / "pyproject.toml"
    pyproject.write_text(
        """
[project]
name = "my-python-app"

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
""",
        encoding="utf-8"
    )

    pipelines = discover_workspace_pipelines(str(tmp_path))
    pipeline_ids = [p.id for p in pipelines]
    assert "python_pytest" in pipeline_ids
    assert "python_ruff" in pipeline_ids

    pytest_pipe = next(p for p in pipelines if p.id == "python_pytest")
    assert pytest_pipe.pipeline_type == "test"
    assert "pytest" in pytest_pipe.steps[0].command


def test_discover_pipelines_custom_override(tmp_path):
    antigravity_dir = tmp_path / ".antigravity"
    antigravity_dir.mkdir(parents=True)
    custom_pipelines_file = antigravity_dir / "pipelines.json"
    custom_pipelines_file.write_text(
        json.dumps({
            "pipelines": [
                {
                    "id": "full_ci",
                    "name": "Full CI / CD Pipeline",
                    "pipeline_type": "full",
                    "steps": [
                        {"id": "step1", "name": "Lint", "command": "echo lint"},
                        {"id": "step2", "name": "Test", "command": "echo test"},
                    ]
                }
            ]
        }),
        encoding="utf-8"
    )

    pipelines = discover_workspace_pipelines(str(tmp_path))
    custom_pipe = next((p for p in pipelines if p.id == "full_ci"), None)
    assert custom_pipe is not None
    assert custom_pipe.name == "Full CI / CD Pipeline"
    assert len(custom_pipe.steps) == 2


def test_validate_workspace_path_security(monkeypatch):
    monkeypatch.setattr(
        "app.services.workspace_coordinator.get_settings",
        lambda: {"trustedWorkspaces": ["C:\\safe\\workspace", "/safe/workspace"]}
    )

    # Sensitive path should be blocked
    with pytest.raises(ValueError, match="interdit ou sensible"):
        validate_workspace_path("C:\\Windows\\System32")

    # Non-trusted workspace should be blocked
    with pytest.raises(ValueError, match="non autorisé"):
        validate_workspace_path("C:\\random\\untrusted\\dir")


@pytest.mark.asyncio
async def test_execute_pipeline_and_cancel(tmp_path, monkeypatch):
    str_path = str(tmp_path.resolve())
    monkeypatch.setattr(
        "app.services.workspace_coordinator.get_settings",
        lambda: {"trustedWorkspaces": [str_path], "defaultWorkspace": str_path}
    )

    pkg_json = tmp_path / "package.json"
    pkg_json.write_text(json.dumps({"scripts": {"test": "echo test-ok"}}), encoding="utf-8")

    # Execute discovered pipeline
    run = await execute_pipeline_run(str_path, "node_test", wait_complete=True)
    assert isinstance(run, PipelineExecutionRun)
    assert run.status in ["success", "running"]
    assert len(run.steps) == 1
    assert run.steps[0].exit_code == 0
    assert "test-ok" in run.steps[0].output_preview

    # Test cancel on non-existent or completed
    assert cancel_pipeline_run("non_existent_run_id") is False


def test_build_remediation_context(tmp_path):
    error_output = """
Traceback (most recent call last):
  File "app/main.py", line 42, in test_fn
    assert 1 == 2
AssertionError: assert 1 == 2
"""
    ctx = build_remediation_context(
        workspace_path=str(tmp_path),
        run_id="run_123",
        failed_step_id="step_test",
        step_command="pytest tests/",
        step_output=error_output
    )
    assert ctx["workspace_path"] == str(tmp_path)
    assert ctx["failed_step_id"] == "step_test"
    assert "AssertionError" in ctx["error_summary"]
    assert "app/main.py" in ctx["suspected_files"]
    assert "pytest tests/" in ctx["remediation_prompt"]
