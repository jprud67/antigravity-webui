# Autonomous Multi-Workspace Coordinator & Pipelines Design Specification

- **Date:** 2026-09-26
- **Status:** Approved
- **Milestone Target:** v0.4.2
- **Author:** Antigravity Pair-Programming Agent & jprud67

---

## 1. Executive Summary & Problem Statement

Modern software projects frequently comprise multiple interdependent codebases: microservices, separate frontends and backends, worker queues, documentation repositories, and shared libraries.

In earlier versions of Antigravity WebUI, interactions were scoped to a single active workspace at a time (`trustedWorkspaces`). Switching projects required a full workspace swap, and running continuous integration, test suites, builds, or linting across multiple repositories required manual repetitive operations.

The **Autonomous Multi-Workspace Coordinator & Pipelines Engine** introduces:
1. **Unified Multi-Workspace Cockpit**: Real-time health monitoring, Git synchronization status (`ahead`, `behind`, `dirty`), and dependency readiness across all registered repositories.
2. **Conventional Pipeline Discovery Engine**: Automatic detection of project scripts and testing workflows (`package.json`, `pyproject.toml`, `Cargo.toml`, `composer.json`, `Makefile`, `.github/workflows`) with optional custom overrides via `.antigravity/pipelines.json`.
3. **Concurrent Async Pipeline Runner**: Controlled parallel execution (`asyncio.Semaphore`) with live streaming logs over WebSocket, step timing in milliseconds, and exit-code tracking.
4. **Autonomous Auto-Fix Remediation Agent**: 1-click intelligent root-cause analysis on failed test/build steps, generating targeted code repairs and automatically re-running tests to verify resolution.
5. **Full Studio UI Modal (`MultiWorkspaceCoordinatorModal.tsx`)**: High-density glassmorphic dashboard with global shortcut `Ctrl+Alt+M`, slash commands (`/coordinator`, `/pipelines`, `/workspaces`), and 100% 15-language internationalization parity.

---

## 2. Architecture & Data Models

### 2.1 Backend Models (`backend/app/services/workspace_coordinator.py`)

```python
from typing import Literal, Any
from pydantic import BaseModel, Field

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

class PipelineRunRequest(BaseModel):
    workspace_path: str
    pipeline_id: str
    steps_filter: list[str] | None = None

class BatchActionRequest(BaseModel):
    action: Literal["git_fetch", "git_pull", "install_deps", "run_all_tests"]
    workspace_paths: list[str] = Field(default_factory=list)

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
```

---

## 3. Conventional Pipeline Discovery & Extensibility

The coordinator inspects the root of each trusted workspace to automatically detect runnable workflows:

| Stack / Descriptor | Detected Pipelines | Standard Commands |
|---|---|---|
| **Node.js (`package.json`)** | `test`, `build`, `lint`, `typecheck` | `npm test` (or `pnpm`/`yarn`/`bun` if lockfile present) |
| **Python (`pyproject.toml`, `setup.cfg`, `tox.ini`)** | `test`, `lint`, `typecheck` | `pytest -v`, `ruff check`, `mypy .` |
| **Rust (`Cargo.toml`)** | `test`, `build`, `check` | `cargo test`, `cargo build --release`, `cargo check` |
| **PHP (`composer.json`)** | `test`, `lint`, `analyze` | `composer test`, `vendor/bin/phpunit`, `vendor/bin/phpstan` |
| **Go (`go.mod`)** | `test`, `build` | `go test ./...`, `go build ./...` |
| **Makefile (`Makefile`)** | Targets present | `make test`, `make build`, `make check` |
| **GitHub Actions (`.github/workflows/*.yml`)** | Jobs / Steps | Parsed run commands mapped into executable local steps |

### Override & Custom Pipelines (`.antigravity/pipelines.json`)
If present in a workspace root, `.antigravity/pipelines.json` takes precedence or supplements discovered pipelines:
```json
{
  "pipelines": [
    {
      "id": "e2e_ci",
      "name": "Full CI Validation",
      "pipeline_type": "full",
      "steps": [
        { "id": "lint", "name": "Linting", "command": "npm run lint" },
        { "id": "typecheck", "name": "TypeScript Typecheck", "command": "npx tsc -b" },
        { "id": "unit_test", "name": "Unit Tests", "command": "pytest tests/ -v" },
        { "id": "bundle", "name": "Production Build", "command": "npm run build" }
      ]
    }
  ]
}
```

---

## 4. Asynchronous Pipeline Execution Engine & Concurrency Control

### 4.1 Process Isolation & Concurrency
- **Controlled Parallelism**: `asyncio.Semaphore(value=4)` guarantees that batch multi-project executions do not starve OS memory or CPU.
- **Asynchronous Subprocess Streaming**: Commands run through `asyncio.create_subprocess_exec` (or shell where needed), with non-blocking stream readers on both `stdout` and `stderr`.
- **Configurable Timeout**: Default 120s per step with graceful SIGTERM followed by SIGKILL after 5 seconds if non-responsive.

### 4.2 Circular Memory Log Buffer & Disk Archiving
- In-memory circular buffer preserving the latest 20,000 characters per step for immediate UI rendering.
- Complete logs written to `.antigravity/logs/pipeline_<run_id>.log` within the workspace.

---

## 5. Real-Time WebSocket Streaming Protocol

Events are streamed over the existing `/ws/chat` connection via `execution_manager.py`:

```json
{
  "type": "coordinator_event",
  "data": {
    "event": "step_started" | "step_output" | "step_finished" | "pipeline_finished",
    "run_id": "pipe_run_9f2a",
    "workspace_path": "c:/laragon/www/my-api",
    "pipeline_id": "test_suite",
    "step_id": "step_unit_tests",
    "status": "running" | "success" | "failed",
    "chunk": "... output text ...",
    "duration_ms": 1420.5,
    "exit_code": 0
  }
}
```

Client-to-server action handlers registered in `backend/app/api/chat.py`:
- `coordinator_run` : Trigger a pipeline execution run.
- `coordinator_cancel` : Abort an active run immediately.

---

## 6. Autonomous Remediation Agent (Auto-Fixer)

When a step fails (`exit_code != 0`):
1. **Error Extraction**: Regex extraction of stack traces, failing test assertions, file paths and line numbers.
2. **Context Packaging**: Generates a self-contained diagnostic prompt containing:
   - Failing command and exit code
   - Truncated relevant error trace (last 50 lines)
   - Modified files in the working directory
3. **1-Click Agent Launch**:
   - Spawns an Antigravity agent in the target workspace with isolated instruction.
   - Applies targeted minimal fix.
   - Automatically re-executes the failed step to verify if it passes.
   - If green: notifies user with success toast and Git diff link.
   - Safety boundary: Max 2 automated attempts before handing control back to the user.

---

## 7. REST API Surface (`backend/app/api/coordinator.py`)

All endpoints require authentication (`Depends(require_auth)`) and validate paths with `is_blocked_sensitive_path` and `Path.resolve()`:

| Endpoint | Method | Description |
|---|---|---|
| `/api/coordinator/overview` | `GET` | Aggregated multi-workspace matrix, health, git status, and pipelines |
| `/api/coordinator/pipelines/{workspace_path}` | `GET` | Discovered and custom pipelines for a specific workspace |
| `/api/coordinator/pipeline/run` | `POST` | Execute a pipeline (unitaire or across multiple workspaces) |
| `/api/coordinator/pipeline/cancel` | `POST` | Cancel a running execution by `run_id` |
| `/api/coordinator/pipeline/logs/{run_id}` | `GET` | Retrieve full buffered log file for a run |
| `/api/coordinator/batch/action` | `POST` | Execute batch Git fetch, git pull, dependency install |
| `/api/coordinator/remediate` | `POST` | Trigger autonomous remediation agent on a failed step |

---

## 8. Frontend Studio: `MultiWorkspaceCoordinatorModal.tsx`

### 8.1 Studio Architecture
- **Header Summary Strip**:
  - Global badges: Workspaces count, Git status (`dirty`, `ahead/behind`), Active pipelines count, Overall health badge (`healthy`, `warning`, `error`).
  - Batch Action Toolbar: `⚡ Exécuter tous les tests`, `🔄 Tout synchroniser (Git Fetch)`, `📦 Installer dépendances`.
  - Filter input: Text search + category filters (Tous, En erreur, Modifiés, En cours).
- **Workspace Cards Grid**:
  - Runtime indicators (React, Node, Python, PHP, Rust, Docker).
  - Git branch, ahead/behind indicators, uncommitted files badge.
  - Interactive pipeline list with step indicators and 1-click run buttons.
  - Button to switch active workspace immediately.
- **Live Pipeline Console Drawer**:
  - Collapsible execution log inspector with live auto-scroll, duration badges, and step tabs.
  - Failing step banner with **`🪄 Réparer avec l'Agent (Auto-Fix)`** action button.

### 8.2 Shortcuts & Navigation
- Global shortcut: `Ctrl+Alt+M` / `Cmd+Alt+M`.
- Slash commands: `/coordinator`, `/pipelines`, `/workspaces`.
- Sidebar studios grid: Add "Coordinateur" studio (14 studios total).
- Bridge in `ProjectSwitcherModal.tsx`: Link "Ouvrir le Coordinateur Multi-Workspaces".

---

## 9. Security & Safety Guards

- **Path Traversal Guards**: Strict verification that every `workspace_path` matches an entry in `trustedWorkspaces` and is not a restricted system directory.
- **Subprocess Shell Injection Guard**: Commands run with sanitized argument lists wherever possible or bounded command strings within the designated project folder.
- **Timeout Caps**: Hard timeout per step (120s) preventing orphaned hanging processes.
- **Resource Protection**: Concurrency semaphore prevents memory exhaustion when triggering batch operations across many large workspaces.

---

## 10. Internationalization Parity (15 Languages)

Adding ~40 new keys `coordinator_*` in `frontend/public/locales.json` across all 15 supported languages (FR, EN, DE, ES, IT, PT, NL, PL, RU, JA, KO, ZH, AR, TR, HI), maintaining 100% key parity.
