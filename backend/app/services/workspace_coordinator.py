import asyncio
import json
import logging
import re
import shutil
import time
import uuid
from collections.abc import Callable, Coroutine
from pathlib import Path
from typing import Any, Literal

import aiofiles
from pydantic import BaseModel, Field

from app.config import DEFAULT_WORKSPACE
from app.platform_utils import (
    is_blocked_sensitive_path,
    spawn_group_kwargs,
    terminate_process_group_async,
)
from app.services.project_detector import detect_project_details
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.workspace_coordinator")


# ============================================================================
# Pydantic Models
# ============================================================================

class PipelineStep(BaseModel):
    id: str
    name: str
    command: str
    cwd: str
    status: Literal["pending", "running", "success", "failed", "skipped"] = "pending"
    exit_code: int | None = None
    started_at: float | None = None
    finished_at: float | None = None
    duration_ms: float = 0.0
    output_preview: str = ""


class WorkspacePipeline(BaseModel):
    id: str
    workspace_path: str
    workspace_name: str
    pipeline_type: Literal["test", "build", "lint", "custom", "full"]
    name: str
    description: str = ""
    steps: list[PipelineStep]
    status: Literal["idle", "running", "success", "failed"] = "idle"
    total_duration_ms: float = 0.0
    last_run_at: float | None = None


class PipelineExecutionRun(BaseModel):
    run_id: str
    workspace_path: str
    pipeline_id: str
    pipeline_name: str
    status: Literal["running", "success", "failed", "cancelled"] = "running"
    current_step_index: int = 0
    steps: list[PipelineStep]
    started_at: float
    finished_at: float | None = None
    total_duration_ms: float = 0.0
    triggered_by: str = "manual"


class RemediationRequest(BaseModel):
    workspace_path: str
    run_id: str
    failed_step_id: str
    error_summary: str
    instruction: str | None = None


class MultiWorkspaceOverview(BaseModel):
    workspaces: list[dict[str, Any]]
    active_workspace_path: str
    discovered_pipelines: list[WorkspacePipeline]
    global_health: Literal["healthy", "warning", "error"]
    running_pipeline_count: int
    dirty_repos_count: int
    out_of_sync_count: int


class PipelineRunRequest(BaseModel):
    workspace_path: str
    pipeline_id: str
    steps_filter: list[str] | None = None


class BatchActionRequest(BaseModel):
    action: Literal["git_fetch", "git_pull", "install_deps", "run_all_tests"]
    workspace_paths: list[str] = Field(default_factory=list)


# ============================================================================
# Concurrency & In-Memory Execution State
# ============================================================================

_concurrency_semaphore: asyncio.Semaphore | None = None


def _get_semaphore() -> asyncio.Semaphore:
    global _concurrency_semaphore
    if _concurrency_semaphore is None:
        _concurrency_semaphore = asyncio.Semaphore(4)
    return _concurrency_semaphore


_active_tasks: dict[str, asyncio.Task] = {}
_run_history: dict[str, PipelineExecutionRun] = {}
MAX_RUN_HISTORY = 100


def _record_run(run_obj: PipelineExecutionRun) -> None:
    _run_history[run_obj.run_id] = run_obj
    if len(_run_history) > MAX_RUN_HISTORY:
        excess = len(_run_history) - MAX_RUN_HISTORY
        for k in list(_run_history.keys())[:excess]:
            _run_history.pop(k, None)


# ============================================================================
# Security Path Validation
# ============================================================================

def validate_workspace_path(path_str: str) -> Path:
    """Validate that a workspace path is legitimate, non-sensitive, and trusted."""
    if not path_str or not path_str.strip():
        raise ValueError("Chemin de workspace invalide : chemin vide.")

    cleaned = path_str.strip()
    if "\x00" in cleaned or any(ord(c) < 32 or ord(c) == 127 for c in cleaned):
        raise ValueError("Caractère interdit dans le chemin.")

    try:
        resolved = Path(cleaned).resolve()
    except Exception as e:
        raise ValueError(f"Impossible de résoudre le chemin '{path_str}': {e}")

    raw_segments = {p.lower() for p in re.split(r"[\\/]+", cleaned) if p}
    resolved_segments = {p.lower() for p in resolved.parts if p}
    all_segments = raw_segments | resolved_segments
    system_dirs = {"windows", "winnt", "system32", "syswow64", "program files", "proc", "sys", "dev"}
    if any(s in system_dirs for s in all_segments) or is_blocked_sensitive_path(resolved):
        raise ValueError(f"Accès interdit ou sensible : '{path_str}' est un dossier système.")

    # Validate against trustedWorkspaces
    settings = get_settings()
    trusted = settings.get("trustedWorkspaces", [])
    default_ws = settings.get("defaultWorkspace", DEFAULT_WORKSPACE)

    trusted_resolved: list[str] = []
    for tw in list(trusted) + [default_ws]:
        try:
            trusted_resolved.append(str(Path(tw).resolve()).lower())
        except Exception:
            pass

    resolved_str_lower = str(resolved).lower()
    if not any(resolved_str_lower == tw_str for tw_str in trusted_resolved):
        raise ValueError(f"Accès non autorisé : '{path_str}' ne figure pas dans les workspaces approuvés.")

    return resolved


# ============================================================================
# Conventional Pipeline Discovery Engine
# ============================================================================

def discover_workspace_pipelines(workspace_path: str) -> list[WorkspacePipeline]:
    """Scan workspace for conventional and custom CI/CD pipelines."""
    try:
        p = Path(workspace_path).resolve()
    except Exception:
        return []

    if not p.is_dir():
        return []

    workspace_name = p.name or "Projet"
    pipelines: list[WorkspacePipeline] = []

    # 1. Custom overrides from .antigravity/pipelines.json
    custom_pipelines_file = p / ".antigravity" / "pipelines.json"
    if custom_pipelines_file.is_file():
        try:
            data = json.loads(custom_pipelines_file.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "pipelines" in data:
                for item in data["pipelines"]:
                    steps = []
                    for s in item.get("steps", []):
                        steps.append(PipelineStep(
                            id=s.get("id", str(uuid.uuid4())[:8]),
                            name=s.get("name", "Étape"),
                            command=s.get("command", "echo running"),
                            cwd=str(p),
                            status="pending"
                        ))
                    pipelines.append(WorkspacePipeline(
                        id=item.get("id", f"custom_{uuid.uuid4().hex[:6]}"),
                        workspace_path=str(p),
                        workspace_name=workspace_name,
                        pipeline_type=item.get("pipeline_type", "custom"),
                        name=item.get("name", "Custom Pipeline"),
                        description=item.get("description", "Pipeline personnalisé .antigravity"),
                        steps=steps,
                        status="idle"
                    ))
        except Exception as e:
            logger.warning(f"Error parsing .antigravity/pipelines.json in {p}: {e}")

    # 2. Node.js / JavaScript / TypeScript (package.json)
    pkg_json = p / "package.json"
    if pkg_json.is_file():
        try:
            pkg_data = json.loads(pkg_json.read_text(encoding="utf-8"))
            scripts = pkg_data.get("scripts", {})
            pm = "npm"
            if (p / "pnpm-lock.yaml").exists():
                pm = "pnpm"
            elif (p / "yarn.lock").exists():
                pm = "yarn"
            elif (p / "bun.lockb").exists() or (p / "bun.lock").exists():
                pm = "bun"

            if "test" in scripts:
                pipelines.append(WorkspacePipeline(
                    id="node_test",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="test",
                    name="Tests Unitaires (Node)",
                    description=f"Exécute '{pm} test' ({scripts['test']})",
                    steps=[PipelineStep(
                        id="step_node_test",
                        name="Test Suite",
                        command=f"{pm} test",
                        cwd=str(p)
                    )]
                ))

            if "build" in scripts:
                pipelines.append(WorkspacePipeline(
                    id="node_build",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="build",
                    name="Production Build (Node)",
                    description=f"Exécute '{pm} run build' ({scripts['build']})",
                    steps=[PipelineStep(
                        id="step_node_build",
                        name="Build Assets",
                        command=f"{pm} run build",
                        cwd=str(p)
                    )]
                ))

            if "lint" in scripts:
                pipelines.append(WorkspacePipeline(
                    id="node_lint",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="lint",
                    name="Linter Code (Node)",
                    description=f"Exécute '{pm} run lint' ({scripts['lint']})",
                    steps=[PipelineStep(
                        id="step_node_lint",
                        name="Linter",
                        command=f"{pm} run lint",
                        cwd=str(p)
                    )]
                ))

            if "typecheck" in scripts or "check" in scripts:
                cmd_script = "typecheck" if "typecheck" in scripts else "check"
                pipelines.append(WorkspacePipeline(
                    id="node_typecheck",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="lint",
                    name="Vérification TypeScript",
                    description=f"Exécute '{pm} run {cmd_script}'",
                    steps=[PipelineStep(
                        id="step_node_typecheck",
                        name="TypeScript Compilation Check",
                        command=f"{pm} run {cmd_script}",
                        cwd=str(p)
                    )]
                ))
        except Exception as e:
            logger.warning(f"Error parsing package.json in {p}: {e}")

    # 3. Python (pyproject.toml, pytest, ruff, tox)
    pyproject = p / "pyproject.toml"
    pytest_ini = p / "pytest.ini"
    setup_cfg = p / "setup.cfg"
    has_python = pyproject.exists() or pytest_ini.exists() or setup_cfg.exists() or list(p.glob("*.py"))
    if has_python:
        # Check pytest
        py_bin = "python"
        if (p / "venv" / "Scripts" / "python.exe").exists():
            py_bin = ".\\venv\\Scripts\\python.exe"
        elif (p / "venv" / "bin" / "python").exists():
            py_bin = "./venv/bin/python"

        pipelines.append(WorkspacePipeline(
            id="python_pytest",
            workspace_path=str(p),
            workspace_name=workspace_name,
            pipeline_type="test",
            name="Tests Pytest (Python)",
            description=f"Exécute '{py_bin} -m pytest -v'",
            steps=[PipelineStep(
                id="step_python_pytest",
                name="Pytest Suite",
                command=f"{py_bin} -m pytest -v",
                cwd=str(p)
            )]
        ))

        # Check ruff
        if pyproject.exists() and "ruff" in pyproject.read_text(encoding="utf-8", errors="ignore"):
            pipelines.append(WorkspacePipeline(
                id="python_ruff",
                workspace_path=str(p),
                workspace_name=workspace_name,
                pipeline_type="lint",
                name="Ruff Linter (Python)",
                description=f"Exécute '{py_bin} -m ruff check .'",
                steps=[PipelineStep(
                    id="step_python_ruff",
                    name="Ruff Linter",
                    command=f"{py_bin} -m ruff check .",
                    cwd=str(p)
                )]
            ))

    # 4. Rust (Cargo.toml)
    cargo_toml = p / "Cargo.toml"
    if cargo_toml.is_file():
        pipelines.append(WorkspacePipeline(
            id="rust_test",
            workspace_path=str(p),
            workspace_name=workspace_name,
            pipeline_type="test",
            name="Cargo Tests (Rust)",
            description="Exécute 'cargo test'",
            steps=[PipelineStep(
                id="step_rust_test",
                name="Cargo Test",
                command="cargo test",
                cwd=str(p)
            )]
        ))
        pipelines.append(WorkspacePipeline(
            id="rust_build",
            workspace_path=str(p),
            workspace_name=workspace_name,
            pipeline_type="build",
            name="Cargo Build (Rust)",
            description="Exécute 'cargo build'",
            steps=[PipelineStep(
                id="step_rust_build",
                name="Cargo Build",
                command="cargo build",
                cwd=str(p)
            )]
        ))

    # 5. PHP (composer.json)
    composer_json = p / "composer.json"
    if composer_json.is_file():
        try:
            c_data = json.loads(composer_json.read_text(encoding="utf-8"))
            scripts = c_data.get("scripts", {})
            if "test" in scripts:
                pipelines.append(WorkspacePipeline(
                    id="composer_test",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="test",
                    name="Tests Composer (PHP)",
                    description="Exécute 'composer test'",
                    steps=[PipelineStep(
                        id="step_composer_test",
                        name="Composer Test",
                        command="composer test",
                        cwd=str(p)
                    )]
                ))
            elif (p / "vendor" / "bin" / "phpunit").exists() or (p / "vendor" / "bin" / "phpunit.bat").exists():
                pipelines.append(WorkspacePipeline(
                    id="php_phpunit",
                    workspace_path=str(p),
                    workspace_name=workspace_name,
                    pipeline_type="test",
                    name="PHPUnit (PHP)",
                    description="Exécute 'vendor/bin/phpunit'",
                    steps=[PipelineStep(
                        id="step_phpunit",
                        name="PHPUnit Suite",
                        command="vendor/bin/phpunit",
                        cwd=str(p)
                    )]
                ))
        except Exception:
            pass

    # 6. Makefile
    makefile = p / "Makefile"
    if makefile.is_file():
        try:
            content = makefile.read_text(encoding="utf-8", errors="ignore")
            targets = re.findall(r"^([a-zA-Z0-9_\-]+):", content, flags=re.MULTILINE)
            for t in ["test", "build", "lint", "check"]:
                if t in targets:
                    p_type: Literal["test", "build", "lint", "custom", "full"] = (
                        "test" if t == "test" else ("build" if t == "build" else "lint")
                    )
                    pipelines.append(WorkspacePipeline(
                        id=f"make_{t}",
                        workspace_path=str(p),
                        workspace_name=workspace_name,
                        pipeline_type=p_type,
                        name=f"Make {t.capitalize()}",
                        description=f"Exécute 'make {t}'",
                        steps=[PipelineStep(
                            id=f"step_make_{t}",
                            name=f"Make {t}",
                            command=f"make {t}",
                            cwd=str(p)
                        )]
                    ))
        except Exception:
            pass

    # Deduplicate pipelines by ID
    deduped: dict[str, WorkspacePipeline] = {}
    for pl in pipelines:
        if pl.id not in deduped:
            deduped[pl.id] = pl
    return list(deduped.values())


# ============================================================================
# Multi-Workspace Overview
# ============================================================================

def get_multi_workspace_overview(active_workspace_path: str | None = None) -> MultiWorkspaceOverview:
    """Retrieve multi-workspace overview with Git metrics and discovered pipelines."""
    settings = get_settings()
    trusted_raw = settings.get("trustedWorkspaces", [])
    workspaces_paths = list(trusted_raw) if isinstance(trusted_raw, list) else []
    default_ws = settings.get("defaultWorkspace", DEFAULT_WORKSPACE)

    if default_ws not in workspaces_paths:
        workspaces_paths.insert(0, default_ws)

    active_path = active_workspace_path or default_ws
    try:
        norm_active = str(Path(active_path).resolve())
    except Exception:
        norm_active = active_path

    workspace_details: list[dict[str, Any]] = []
    all_pipelines: list[WorkspacePipeline] = []
    dirty_count = 0
    out_of_sync_count = 0
    health_status: Literal["healthy", "warning", "error"] = "healthy"

    for ws in workspaces_paths:
        try:
            norm_ws = str(Path(ws).resolve())
        except Exception:
            norm_ws = ws

        is_default = (norm_ws == str(Path(default_ws).resolve()) if default_ws else False)
        is_active = (norm_ws == norm_active)

        detail = detect_project_details(ws, is_default=is_default, is_active=is_active)
        workspace_details.append(detail)

        # Check git metrics
        git_info = detail.get("git", {})
        if git_info.get("is_dirty"):
            dirty_count += 1
        if (git_info.get("ahead", 0) > 0) or (git_info.get("behind", 0) > 0):
            out_of_sync_count += 1

        # Check health
        health = detail.get("health", {})
        if health.get("status") in ["warning", "error"]:
            if health_status != "error":
                health_status = health.get("status", "warning")

        # Discover pipelines
        ws_pipelines = discover_workspace_pipelines(ws)
        all_pipelines.extend(ws_pipelines)

    # Active running pipelines count
    running_count = sum(1 for t in _active_tasks.values() if not t.done())

    return MultiWorkspaceOverview(
        workspaces=workspace_details,
        active_workspace_path=active_path,
        discovered_pipelines=all_pipelines,
        global_health=health_status,
        running_pipeline_count=running_count,
        dirty_repos_count=dirty_count,
        out_of_sync_count=out_of_sync_count
    )


# ============================================================================
# Asynchronous Pipeline Runner
# ============================================================================

async def execute_pipeline_run(
    workspace_path: str,
    pipeline_id: str,
    on_step_update: Callable[[dict[str, Any]], Coroutine[Any, Any, None]] | None = None,
    wait_complete: bool = False
) -> PipelineExecutionRun:
    """Execute a pipeline asynchronously with controlled concurrency and live output buffering."""
    resolved_path = validate_workspace_path(workspace_path)
    pipelines = discover_workspace_pipelines(str(resolved_path))
    target_pipeline = next((p for p in pipelines if p.id == pipeline_id), None)
    if not target_pipeline:
        raise ValueError(f"Pipeline '{pipeline_id}' introuvable dans '{workspace_path}'.")

    run_id = f"pipe_{uuid.uuid4().hex[:10]}"
    started_at = time.time()

    # Deep copy steps for execution run
    run_steps = [s.model_copy(deep=True) for s in target_pipeline.steps]
    run_obj = PipelineExecutionRun(
        run_id=run_id,
        workspace_path=str(resolved_path),
        pipeline_id=pipeline_id,
        pipeline_name=target_pipeline.name,
        status="running",
        current_step_index=0,
        steps=run_steps,
        started_at=started_at
    )
    _record_run(run_obj)

    async def _runner_coroutine():
        async with _get_semaphore():
            total_duration = 0.0
            overall_success = True

            logs_dir = resolved_path / ".antigravity" / "logs"
            try:
                logs_dir.mkdir(parents=True, exist_ok=True)
            except Exception:
                pass
            run_log_file = logs_dir / f"pipeline_{run_id}.log"

            try:
                async with aiofiles.open(run_log_file, "a", encoding="utf-8") as log_file:
                    await log_file.write(f"=== PIPELINE RUN: {target_pipeline.name} ({run_id}) ===\n")
                    await log_file.write(f"Workspace: {resolved_path}\nStarted: {time.ctime(started_at)}\n\n")

                    for idx, step in enumerate(run_obj.steps):
                        run_obj.current_step_index = idx
                        step.status = "running"
                        step_start = time.time()
                        step.started_at = step_start

                        if on_step_update:
                            await on_step_update({
                                "event": "step_started",
                                "run_id": run_id,
                                "workspace_path": str(resolved_path),
                                "pipeline_id": pipeline_id,
                                "step_id": step.id,
                                "status": "running"
                            })

                        # Execute command safely via shell with process group isolation
                        process = None
                        try:
                            process = await asyncio.create_subprocess_shell(
                                step.command,
                                cwd=step.cwd,
                                stdout=asyncio.subprocess.PIPE,
                                stderr=asyncio.subprocess.PIPE,
                                **spawn_group_kwargs()
                            )

                            stdout_bytes, stderr_bytes = await asyncio.wait_for(
                                process.communicate(),
                                timeout=120.0
                            )

                            step_end = time.time()
                            step_duration = (step_end - step_start) * 1000.0
                            total_duration += step_duration
                            step.finished_at = step_end
                            step.duration_ms = step_duration
                            step.exit_code = process.returncode

                            stdout_str = stdout_bytes.decode("utf-8", errors="replace")
                            stderr_str = stderr_bytes.decode("utf-8", errors="replace")
                            combined_output = (stdout_str + ("\n" + stderr_str if stderr_str else "")).strip()

                            # Keep memory output preview limited to last 20,000 chars
                            step.output_preview = combined_output[-20000:]
                            await log_file.write(f"--- STEP: {step.name} ({step.command}) ---\n")
                            await log_file.write(combined_output + "\n\n")
                            await log_file.flush()

                            if process.returncode == 0:
                                step.status = "success"
                            else:
                                step.status = "failed"
                                overall_success = False

                            if on_step_update:
                                await on_step_update({
                                    "event": "step_finished",
                                    "run_id": run_id,
                                    "workspace_path": str(resolved_path),
                                    "pipeline_id": pipeline_id,
                                    "step_id": step.id,
                                    "status": step.status,
                                    "duration_ms": step_duration,
                                    "exit_code": step.exit_code,
                                    "output_preview": step.output_preview
                                })

                            if not overall_success:
                                # Skip subsequent steps
                                for rem_step in run_obj.steps[idx + 1:]:
                                    rem_step.status = "skipped"
                                break

                        except asyncio.TimeoutError:
                            if process and process.returncode is None:
                                try:
                                    await terminate_process_group_async(process, grace=0.5)
                                except Exception as te:
                                    logger.debug(f"Error terminating child process on timeout: {te}")
                            step_end = time.time()
                            step_duration = (step_end - step_start) * 1000.0
                            total_duration += step_duration
                            step.status = "failed"
                            step.exit_code = 124
                            step.output_preview = "Erreur : délai d'exécution dépassé (120 secondes)."
                            overall_success = False
                            break
                        except asyncio.CancelledError:
                            if process and process.returncode is None:
                                try:
                                    await terminate_process_group_async(process, grace=0.5)
                                except Exception as te:
                                    logger.debug(f"Error terminating child process on cancel: {te}")
                            step.status = "failed"
                            step.output_preview = "Exécution annulée par l'utilisateur."
                            run_obj.status = "cancelled"
                            raise
            except asyncio.CancelledError:
                run_obj.status = "cancelled"
                raise
            finally:
                if run_obj.finished_at is None:
                    run_obj.finished_at = time.time()
                run_obj.total_duration_ms = total_duration
                if run_obj.status != "cancelled":
                    run_obj.status = "success" if overall_success else "failed"

                if on_step_update:
                    try:
                        await on_step_update({
                            "event": "pipeline_finished",
                            "run_id": run_id,
                            "workspace_path": str(resolved_path),
                            "pipeline_id": pipeline_id,
                            "status": run_obj.status,
                            "total_duration_ms": total_duration
                        })
                    except Exception as notif_err:
                        logger.debug(f"Notification error in pipeline_finished: {notif_err}")

    task = asyncio.create_task(_runner_coroutine())
    _active_tasks[run_id] = task

    def _cleanup(t):
        _active_tasks.pop(run_id, None)

    task.add_done_callback(_cleanup)

    if wait_complete:
        await task
    else:
        # Await minimal progression so run starts reliably
        await asyncio.sleep(0.05)
    return run_obj


def cancel_pipeline_run(run_id: str) -> bool:
    """Cancel an active pipeline run if present."""
    task = _active_tasks.get(run_id)
    if task and not task.done():
        task.cancel()
        if run_id in _run_history:
            _run_history[run_id].status = "cancelled"
        return True
    return False


def get_pipeline_run_details(run_id: str) -> PipelineExecutionRun | None:
    """Retrieve details and step logs of a pipeline run."""
    return _run_history.get(run_id)


# ============================================================================
# Autonomous Remediation Helper (Auto-Fixer)
# ============================================================================

def build_remediation_context(
    workspace_path: str,
    run_id: str,
    failed_step_id: str,
    step_command: str = "",
    step_output: str = ""
) -> dict[str, Any]:
    """Parse failing test/build log and generate structured context for the auto-fix agent."""
    summary_lines = []
    suspected_files: set[str] = set()

    for line in step_output.splitlines():
        line_clean = line.strip()
        # Detect common error indicators
        if any(err in line_clean for err in ["Error", "AssertionError", "TypeError", "SyntaxError", "FAIL", "FAILED", "error TS"]):
            summary_lines.append(line_clean)

        # Detect suspected file paths in traceback (e.g. File "path/to/file.py", line 42)
        match_py = re.search(r'File ["\']([^"\']+\.py)["\']', line)
        if match_py:
            suspected_files.add(match_py.group(1))

        # Detect TS/JS paths (e.g. src/App.tsx:42:10)
        match_ts = re.search(r'([a-zA-Z0-9_\-\.\/]+\.[tj]sx?)(?::\d+)', line)
        if match_ts:
            suspected_files.add(match_ts.group(1))

    error_summary = "\n".join(summary_lines[:5]) if summary_lines else "Échec de commande avec code d'erreur non nul."

    prompt = (
        f"Tu es un agent expert en remédiation de code. Une étape de pipeline a échoué dans le workspace '{workspace_path}'.\n\n"
        f"Commande exécutée : `{step_command}`\n"
        f"Résumé de l'erreur :\n```\n{error_summary}\n```\n"
        f"Fichiers potentiellement concernés : {list(suspected_files)}\n\n"
        f"Extrait du journal d'exécution :\n```\n{step_output[-2500:]}\n```\n\n"
        f"Mission : analyse la cause racine, applique le correctif minimal nécessaire avec tes outils de modification de fichier, "
        f"et relance la commande `{step_command}` pour valider que le test repasse au vert."
    )

    return {
        "workspace_path": workspace_path,
        "run_id": run_id,
        "failed_step_id": failed_step_id,
        "error_summary": error_summary,
        "suspected_files": sorted(suspected_files),
        "remediation_prompt": prompt
    }


# ============================================================================
# Batch Action Executor
# ============================================================================

async def execute_batch_action(action: str, workspace_paths: list[str]) -> dict[str, Any]:
    """Execute batch operations across target workspaces."""
    settings = get_settings()
    trusted_raw = settings.get("trustedWorkspaces", [])
    all_trusted = list(trusted_raw) if isinstance(trusted_raw, list) else []
    default_ws = settings.get("defaultWorkspace", DEFAULT_WORKSPACE)
    if default_ws and default_ws not in all_trusted:
        all_trusted.insert(0, default_ws)

    def _norm(p: str) -> str:
        try:
            return str(Path(p).resolve()).lower()
        except Exception:
            return str(p).strip().lower()

    trusted_norm = {_norm(w) for w in all_trusted}
    if workspace_paths:
        targets = [p for p in workspace_paths if _norm(p) in trusted_norm]
    else:
        targets = all_trusted

    results = []
    git_bin = shutil.which("git") or "git"

    for ws in targets:
        try:
            ws_path = Path(ws).resolve()
            if not ws_path.is_dir():
                continue

            if action == "git_fetch":
                proc = await asyncio.create_subprocess_exec(
                    git_bin, "fetch", "--all",
                    cwd=str(ws_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _stderr = await proc.communicate()
                results.append({
                    "workspace": str(ws_path),
                    "status": "success" if proc.returncode == 0 else "failed",
                    "exit_code": proc.returncode,
                    "output": stdout.decode("utf-8", errors="replace")
                })

            elif action == "git_pull":
                proc = await asyncio.create_subprocess_exec(
                    git_bin, "pull",
                    cwd=str(ws_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE
                )
                stdout, _stderr = await proc.communicate()
                results.append({
                    "workspace": str(ws_path),
                    "status": "success" if proc.returncode == 0 else "failed",
                    "exit_code": proc.returncode,
                    "output": stdout.decode("utf-8", errors="replace")
                })

            elif action == "install_deps":
                # Check package manager
                cmd = None
                if (ws_path / "package.json").exists():
                    cmd = "npm install"
                elif (ws_path / "pyproject.toml").exists() or (ws_path / "requirements.txt").exists():
                    cmd = "pip install -r requirements.txt" if (ws_path / "requirements.txt").exists() else "pip install ."
                elif (ws_path / "composer.json").exists():
                    cmd = "composer install"

                if cmd:
                    proc = await asyncio.create_subprocess_shell(
                        cmd,
                        cwd=str(ws_path),
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.PIPE
                    )
                    stdout, _stderr = await proc.communicate()
                    results.append({
                        "workspace": str(ws_path),
                        "status": "success" if proc.returncode == 0 else "failed",
                        "command": cmd,
                        "exit_code": proc.returncode,
                        "output": stdout.decode("utf-8", errors="replace")[:1000]
                    })

            elif action == "run_all_tests":
                ws_pipelines = discover_workspace_pipelines(str(ws_path))
                test_pipelines = [p for p in ws_pipelines if p.pipeline_type == "test"]
                if not test_pipelines:
                    results.append({
                        "workspace": str(ws_path),
                        "status": "skipped",
                        "output": "Aucun pipeline de test détecté dans ce workspace."
                    })
                    continue
                target_p = test_pipelines[0]
                run_obj = await execute_pipeline_run(
                    workspace_path=str(ws_path),
                    pipeline_id=target_p.id,
                    wait_complete=True
                )
                results.append({
                    "workspace": str(ws_path),
                    "status": run_obj.status,
                    "pipeline_id": target_p.id,
                    "pipeline_name": target_p.name,
                    "duration_ms": run_obj.total_duration_ms,
                    "steps_count": len(run_obj.steps),
                    "output": "\n".join(s.output_preview for s in run_obj.steps if s.output_preview)[:1000]
                })

            else:
                results.append({
                    "workspace": str(ws_path),
                    "status": "error",
                    "error": f"Action non supportée : {action}"
                })
        except Exception as e:
            results.append({
                "workspace": ws,
                "status": "error",
                "error": str(e)
            })

    return {
        "action": action,
        "processed_count": len(results),
        "results": results
    }
