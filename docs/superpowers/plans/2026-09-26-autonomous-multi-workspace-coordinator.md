# Autonomous Multi-Workspace Coordinator & Pipelines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the Autonomous Multi-Workspace Coordinator & Pipelines engine to enable parallel multi-project monitoring, conventional CI/CD pipeline discovery and execution with WebSocket streaming, and 1-click autonomous Auto-Fix remediation.

**Architecture:** A FastAPI service (`workspace_coordinator.py`) with conventional pipeline discovery and an asynchronous runner using `asyncio.Semaphore(4)` streams real-time step outputs via WebSocket. A dedicated glassmorphic React studio modal (`MultiWorkspaceCoordinatorModal.tsx`) provides multi-project telemetry, live log inspection, batch operations (Git sync, batch tests), and 1-click Auto-Fix triggering.

**Tech Stack:** FastAPI, Pydantic, Python `asyncio` subprocesses, React 19, TypeScript, Lucide Icons, Vite, Tailwind CSS / Vanilla CSS Variables, WebSocket.

**Spec:** [docs/superpowers/specs/2026-09-26-multi-workspace-coordinator-design.md](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-26-multi-workspace-coordinator-design.md)

## Global Constraints
- Target version: `0.4.2`
- Parity: 100% key parity across all 15 languages in `frontend/public/locales.json`.
- Zero TypeScript errors (`npx tsc -b`).
- Absolute path traversal guards using `is_blocked_sensitive_path` and `trustedWorkspaces`.
- Subprocess timeout cap of 120s per step.
- Final deliverable must be pushed to remote `origin` with git tag `v0.4.2`.

---

### Task 1: Backend Coordinator Service & Models

**Files:**
- Create: `backend/app/services/workspace_coordinator.py`
- Create: `backend/tests/test_workspace_coordinator.py`

**Interfaces:**
- Produces:
  - `PipelineStep`, `WorkspacePipeline`, `PipelineExecutionRun`, `RemediationRequest`, `MultiWorkspaceOverview`
  - `discover_workspace_pipelines(workspace_path: str) -> list[WorkspacePipeline]`
  - `get_multi_workspace_overview(active_workspace_path: str) -> MultiWorkspaceOverview`
  - `execute_pipeline(workspace_path: str, pipeline_id: str, on_step_update=None) -> PipelineExecutionRun`
  - `cancel_pipeline_run(run_id: str) -> bool`

- [ ] **Step 1: Write unit tests for models, conventional discovery, and runner**

```python
import pytest
from app.services.workspace_coordinator import (
    discover_workspace_pipelines,
    get_multi_workspace_overview,
    cancel_pipeline_run,
    WorkspacePipeline
)

def test_models_structure():
    # Verify model instantiations and field validations
    ...

def test_discover_pipelines_node_and_python(tmp_path):
    # Setup mock package.json and pyproject.toml
    ...

def test_custom_pipelines_override(tmp_path):
    # Setup .antigravity/pipelines.json
    ...

def test_security_path_guards():
    # Non-trusted or sensitive path raises ValueError
    ...
```

- [ ] **Step 2: Run pytest to verify tests fail initially**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspace_coordinator.py -v`
Expected: FAIL (ModuleNotFoundError)

- [ ] **Step 3: Implement `workspace_coordinator.py`**
  - Implement Pydantic models.
  - Implement conventional detectors for npm, pytest, cargo, composer, makefile, and `.antigravity/pipelines.json`.
  - Implement async pipeline runner with concurrency semaphore and circular buffer.
  - Implement path traversal security guards.

- [ ] **Step 4: Run pytest to verify all tests pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspace_coordinator.py -v`
Expected: PASS

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/services/workspace_coordinator.py backend/tests/test_workspace_coordinator.py
git commit -m "feat(coordinator): implement backend workspace coordinator service, discovery engine, and runner"
```

---

### Task 2: Backend REST Endpoints & Router Registration

**Files:**
- Create: `backend/app/api/coordinator.py`
- Modify: `backend/app/main.py`
- Modify: `backend/tests/test_workspace_coordinator.py`

**Interfaces:**
- Produces:
  - `GET /api/coordinator/overview`
  - `GET /api/coordinator/pipelines/{workspace_path:path}`
  - `POST /api/coordinator/pipeline/run`
  - `POST /api/coordinator/pipeline/cancel`
  - `POST /api/coordinator/batch/action`
  - `POST /api/coordinator/remediate`

- [ ] **Step 1: Write integration tests for coordinator REST endpoints**
  - Test `GET /api/coordinator/overview` with auth guard.
  - Test `POST /api/coordinator/pipeline/run` with mock execution.
  - Test `POST /api/coordinator/batch/action` (git_fetch).
  - Test `POST /api/coordinator/remediate`.

- [ ] **Step 2: Run pytest to verify failure**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspace_coordinator.py -k test_api -v`
Expected: FAIL (404 Not Found)

- [ ] **Step 3: Implement `backend/app/api/coordinator.py` and register in `backend/app/main.py`**
  - Bind router with `prefix="/api/coordinator"`.
  - Protect with `require_auth`.
  - Register in `main.py`: `app.include_router(coordinator_router)`.

- [ ] **Step 4: Run pytest to verify endpoints pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspace_coordinator.py -v`
Expected: PASS

- [ ] **Step 5: Commit Task 2**

```bash
git add backend/app/api/coordinator.py backend/app/main.py backend/tests/test_workspace_coordinator.py
git commit -m "feat(coordinator): add REST API endpoints and router registration for workspace coordinator"
```

---

### Task 3: WebSocket Streaming for Coordinator Events & Actions

**Files:**
- Modify: `backend/app/services/execution_manager.py`
- Modify: `backend/app/api/chat.py`
- Modify: `backend/tests/test_workspace_coordinator.py`

**Interfaces:**
- Produces:
  - `execution_manager.broadcast_coordinator_event(event_data: dict)`
  - WebSocket action handler `coordinator_run` & `coordinator_cancel`

- [ ] **Step 1: Write test for coordinator event broadcasting**
  - Verify `broadcast_coordinator_event` dispatches to active websockets.

- [ ] **Step 2: Implement WebSocket event broadcasting in `execution_manager.py`**
  - Add `broadcast_coordinator_event` method.

- [ ] **Step 3: Handle client actions in `backend/app/api/chat.py`**
  - Add `elif action == "coordinator_run": ...` and `elif action == "coordinator_cancel": ...`.

- [ ] **Step 4: Run pytest to verify tests pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspace_coordinator.py -v`
Expected: PASS

- [ ] **Step 5: Commit Task 3**

```bash
git add backend/app/services/execution_manager.py backend/app/api/chat.py backend/tests/test_workspace_coordinator.py
git commit -m "feat(coordinator): add real-time WebSocket event streaming and actions for coordinator"
```

---

### Task 4: Frontend Types & API Client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces:
  - TypeScript types: `PipelineStep`, `WorkspacePipeline`, `PipelineExecutionRun`, `MultiWorkspaceOverview`, `RemediationRequest`, `BatchCoordinatorAction`
  - API methods: `fetchCoordinatorOverview()`, `fetchWorkspacePipelines(path)`, `runCoordinatorPipeline(path, pipelineId)`, `cancelCoordinatorPipeline(runId)`, `triggerCoordinatorBatch(action, paths)`, `triggerCoordinatorRemediation(payload)`

- [ ] **Step 1: Add types in `frontend/src/types/index.ts`**
- [ ] **Step 2: Add API methods in `frontend/src/services/api.ts`**
- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc -b` in `frontend/`
Expected: PASS with 0 errors

- [ ] **Step 4: Commit Task 4**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(coordinator): define frontend types and API client methods for workspace coordinator"
```

---

### Task 5: Full 15-Language i18n Key Parity

**Files:**
- Modify: `frontend/public/locales.json`

**Interfaces:**
- Produces: ~40 keys prefixed with `coordinator_*` in all 15 supported languages:
  - `coordinator_title`, `coordinator_overview`, `coordinator_pipelines`, `coordinator_run_all_tests`, `coordinator_batch_fetch`, `coordinator_install_deps`, `coordinator_auto_fix`, etc.
  - Strict parity across EN, FR, DE, ES, IT, PT, NL, PL, RU, JA, KO, ZH, AR, TR, HI.

- [ ] **Step 1: Write helper script in scratch/ to generate and inject localized keys into `frontend/public/locales.json`**
- [ ] **Step 2: Run verification script to check exact key count and parity across all 15 languages**
- [ ] **Step 3: Commit Task 5**

```bash
git add frontend/public/locales.json
git commit -m "feat(i18n): add 15-language parity for autonomous multi-workspace coordinator and pipelines"
```

---

### Task 6: Frontend Coordinator Studio Modal Component

**Files:**
- Create: `frontend/src/components/MultiWorkspaceCoordinatorModal.tsx`

**Interfaces:**
- Produces:
  - `export const MultiWorkspaceCoordinatorModal: React.FC<MultiWorkspaceCoordinatorModalProps>`
  - Header summary strip with active metrics (workspaces, dirty git, out of sync, active runs, health)
  - Batch action toolbar (Run all tests, Batch git fetch, Install dependencies)
  - Interactive workspace cards grid with runtime badges, git branch & sync info, pipelines list with run buttons
  - Live execution log drawer with terminal styling, step tabs, and 1-click Auto-Fix action button

- [ ] **Step 1: Implement `MultiWorkspaceCoordinatorModal.tsx` with full interactive states and WebSocket listening**
- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc -b` in `frontend/`
Expected: PASS with 0 errors

- [ ] **Step 3: Commit Task 6**

```bash
git add frontend/src/components/MultiWorkspaceCoordinatorModal.tsx
git commit -m "feat(coordinator): implement MultiWorkspaceCoordinatorModal with live pipelines, telemetry, and auto-fix"
```

---

### Task 7: Application Integration, Shortcuts & Slash Commands

**Files:**
- Modify: `frontend/src/services/commands.ts`
- Modify: `frontend/src/components/ChatInput.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/components/ProjectSwitcherModal.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - Slash commands `/coordinator`, `/pipelines`, `/workspaces`
  - Global keyboard shortcut: `Ctrl+Alt+M` / `Cmd+Alt+M`
  - 14th Studio item in `Sidebar.tsx`
  - Bridge button in `ProjectSwitcherModal.tsx`
  - Modal rendering and state management in `App.tsx`

- [ ] **Step 1: Add slash commands in `commands.ts` and dispatch in `ChatInput.tsx`**
- [ ] **Step 2: Add sidebar navigation entry in `Sidebar.tsx`**
- [ ] **Step 3: Add bridge link in `ProjectSwitcherModal.tsx`**
- [ ] **Step 4: Wire modal, lazy loading, custom events, and `Ctrl+Alt+M` shortcut in `App.tsx`**
- [ ] **Step 5: Verify TypeScript compilation**

Run: `npx tsc -b` in `frontend/`
Expected: PASS with 0 errors

- [ ] **Step 6: Commit Task 7**

```bash
git add frontend/src/services/commands.ts frontend/src/components/ChatInput.tsx frontend/src/components/Sidebar.tsx frontend/src/components/ProjectSwitcherModal.tsx frontend/src/App.tsx
git commit -m "feat(coordinator): integrate MultiWorkspaceCoordinatorModal, shortcuts, slash commands, and sidebar navigation"
```

---

### Task 8: End-to-End Verification, Version Bump & Release

**Files:**
- Modify: `backend/app/main.py` (version="0.4.2")
- Modify: `backend/app/services/updater.py` (CURRENT_VERSION = "0.4.2")
- Modify: `frontend/package.json` (version: "0.4.2")
- Modify: `frontend/public/sw.js` (antigravity-cache-v0.4.2)
- Modify: `docs/ROADMAP.md` (mark Jalon v0.4.2 as completed)

- [ ] **Step 1: Run full backend test suite**
  - Run: `.\venv\Scripts\python.exe -m pytest tests/ -v`
- [ ] **Step 2: Run frontend production build**
  - Run: `npm run build` in `frontend/`
- [ ] **Step 3: Bump version to `0.4.2` across the 5 standard files**
- [ ] **Step 4: Commit release**

```bash
git add backend/app/main.py backend/app/services/updater.py frontend/package.json frontend/public/sw.js docs/ROADMAP.md
git commit -m "feat(release): Release v0.4.2 - Autonomous Multi-Workspace Coordinator & Pipelines Engine"
```

- [ ] **Step 5: Create git tag `v0.4.2` and push to remote**

```bash
git tag -a v0.4.2 -m "Release v0.4.2 - Autonomous Multi-Workspace Coordinator & Pipelines Engine"
git push origin main
git push origin v0.4.2
```
