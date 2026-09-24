# Multi-Workspace & Project Switcher Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an enterprise-grade Multi-Workspace & Project Switcher Studio in Antigravity WebUI with automatic runtime detection (Node, Python, PHP, Rust, Docker), project health diagnostics, and seamless workspace switching without breaking active conversations.

**Architecture:** Create `backend/app/services/project_detector.py` for non-blocking runtime and health analysis with 5s memory caching. Extend `backend/app/api/workspaces.py` with `/details`, `/health`, and `/default` endpoints. Define TypeScript types and API service methods. Implement `ProjectSwitcherModal.tsx` with active hero card, search/filter, and 1-click remediation actions. Integrate global triggers (`Ctrl+Alt+W`, `/workspace`, ChatInput chip, and Sidebar icon) and dispatch `workspace-changed` event.

**Tech Stack:** Python 3.13 / FastAPI, React 19, TypeScript, Tailwind CSS, Lucide Icons, Pytest, Vite.

**Spec:** [`docs/superpowers/specs/2026-09-24-multi-workspace-switcher-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-24-multi-workspace-switcher-design.md)

## Global Constraints
- Target version: `0.2.21`
- Zero warnings/errors on `npx oxlint --deny-warnings`
- Zero errors on TypeScript compiler `npx tsc -b`
- 100% backend test suite pass rate on `pytest tests/`
- All commits authored strictly as `jprud67 <jprud67@gmail.com>` with no `Co-Authored-By` trailers
- Strict path containment checks via `is_blocked_sensitive_path` and `Path.resolve()`

---

### Task 1: Backend Project Detector Service & Unit Tests

**Files:**
- Create: `backend/app/services/project_detector.py`
- Test: `backend/tests/test_workspaces_health.py`

**Interfaces:**
- Produces:
  - `detect_project_details(workspace_path: str, is_default: bool = False, is_active: bool = False) -> dict[str, Any]`
  - `detect_project_health(workspace_path: str) -> dict[str, Any]`
  - `clear_detector_cache() -> None`

- [ ] **Step 1: Write unit tests for project detection & health**

Create `backend/tests/test_workspaces_health.py` covering:
- Node.js project detection (`package.json`, dependencies, scripts, devDependencies, missing `node_modules` warning).
- Python project detection (`pyproject.toml`, `requirements.txt`, missing `venv` warning).
- PHP project detection (`composer.json`, missing `vendor` warning).
- Git repository telemetry detection (branch, clean/dirty working tree, last commit).
- Caching behavior (subsequent calls return cached result within TTL).
- Safe path handling (reject invalid / sensitive system paths).

- [ ] **Step 2: Run test to verify it fails**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspaces_health.py -v`
Expected: FAIL (module `project_detector` not found).

- [ ] **Step 3: Implement `project_detector.py`**

In `backend/app/services/project_detector.py`:
- Implement manifest parsers for:
  - `package.json`: extract name, version, detect frameworks (`react`, `vite`, `next`, `vue`, `express`, `tailwind`, `typescript`), detect package manager (`npm`, `pnpm`, `yarn`, `bun`), check `node_modules` existence.
  - `pyproject.toml` / `requirements.txt` / `Pipfile`: extract project metadata, frameworks (`fastapi`, `django`, `flask`, `pytest`, `torch`), detect package manager (`pip`, `poetry`), check `.venv` or `venv` existence.
  - `composer.json`: extract name, detect frameworks (`laravel`, `symfony`, `wordpress`), check `vendor` existence.
  - `Cargo.toml`, `go.mod`, `Dockerfile`, `docker-compose.yml`.
- Implement fast Git telemetry extractor:
  - Check `.git` existence.
  - Run `git branch --show-current`, `git status --porcelain -uno`, and `git log -1 --format="%h|%cI|%s"` with strict 1.5s timeout.
- Implement thread-safe cache with 5-second TTL.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspaces_health.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/project_detector.py backend/tests/test_workspaces_health.py
git commit -m "feat(workspaces): add project detector service and health tests" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 2: Backend Workspaces Endpoints Extension

**Files:**
- Modify: `backend/app/api/workspaces.py`
- Test: `backend/tests/test_workspaces_health.py`

**Interfaces:**
- Produces:
  - `GET /api/workspaces/details` -> `list[WorkspaceProjectDetail]`
  - `GET /api/workspaces/health?path=...` -> `ProjectHealthDiagnostic`
  - `POST /api/workspaces/default?path=...` -> `{"status": "ok", "default_workspace": str}`
  - Enriched `POST /api/workspaces` -> `{"status": "ok", "workspaces": list[str], "project": dict}`

- [ ] **Step 1: Add endpoint tests in `test_workspaces_health.py`**

Test:
- `client.get("/api/workspaces/details")` returns list with project name, runtimes, and health diagnostics.
- `client.get("/api/workspaces/health?path=...")` returns specific project health.
- `client.post("/api/workspaces/default?path=...")` updates `defaultWorkspace` in settings.
- Rejection of invalid paths with 400 or 403.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspaces_health.py -v`
Expected: FAIL (endpoints `/details`, `/health`, `/default` return 404).

- [ ] **Step 3: Implement endpoints in `backend/app/api/workspaces.py`**

In `backend/app/api/workspaces.py`:
- Add `GET /details`: get `trustedWorkspaces`, call `detect_project_details` on each, mark `is_default` if matches `settings.get("defaultWorkspace")`.
- Add `GET /health`: validate path, call `detect_project_health(path)`.
- Add `POST /default`: validate path is a directory and not blocked, update `settings["defaultWorkspace"] = str(p)`, save settings, return status ok.
- Ensure all endpoints use `require_auth` and proper error handling.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_workspaces_health.py -v`
Expected: PASS (all tests pass).

- [ ] **Step 5: Run full backend test suite**

Run: `.\venv\Scripts\python.exe -m pytest tests/ -v`
Expected: PASS (100% test pass rate).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/workspaces.py backend/tests/test_workspaces_health.py
git commit -m "feat(workspaces): add details, health, and default workspace endpoints" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 3: Frontend TypeScript Types & API Service

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces:
  - TypeScript types: `ProjectRuntimeInfo`, `ProjectGitStatus`, `ProjectHealthDiagnostic`, `WorkspaceProjectDetail`
  - API methods: `fetchWorkspaceProjects()`, `fetchProjectHealth(path)`, `setDefaultWorkspace(path)`, `addWorkspaceProject(path)`, `removeWorkspaceProject(path)`

- [ ] **Step 1: Add types in `frontend/src/types/index.ts`**

Add:
```typescript
export interface ProjectRuntimeInfo {
  type: 'node' | 'python' | 'php' | 'rust' | 'go' | 'docker' | 'generic';
  version?: string;
  frameworks: string[];
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'composer' | 'cargo';
}

export interface ProjectGitStatus {
  isRepo: boolean;
  branch?: string;
  isDirty: boolean;
  uncommittedCount: number;
  remoteUrl?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: {
    sha: string;
    date: string;
    subject: string;
  };
}

export interface ProjectHealthDiagnostic {
  status: 'healthy' | 'warning' | 'error';
  dependenciesInstalled: boolean;
  venvPresent?: boolean;
  nodeModulesPresent?: boolean;
  vendorPresent?: boolean;
  warnings: string[];
  suggestedAction?: {
    label: string;
    command: string;
  } | null;
}

export interface WorkspaceProjectDetail {
  path: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  lastModified?: string;
  stats?: {
    fileCount?: number;
    diskSizeMb?: number;
  };
  runtimes: ProjectRuntimeInfo[];
  git: ProjectGitStatus;
  health: ProjectHealthDiagnostic;
}
```

- [ ] **Step 2: Add API functions in `frontend/src/services/api.ts`**

Implement:
- `fetchWorkspaceProjects()` -> `GET /api/workspaces/details`
- `fetchProjectHealth(path)` -> `GET /api/workspaces/health?path=...`
- `setDefaultWorkspace(path)` -> `POST /api/workspaces/default?path=...`
- `addWorkspaceProject(path)` -> `POST /api/workspaces?path=...`
- `removeWorkspaceProject(path)` -> `DELETE /api/workspaces?path=...`

- [ ] **Step 3: Validate TypeScript compilation & Oxlint**

Run:
- `npx oxlint --deny-warnings src/types src/services/api.ts`
- `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(types): add workspace project and health diagnostic types and API methods" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 4: UI Studio Component (`ProjectSwitcherModal.tsx`)

**Files:**
- Create: `frontend/src/components/ProjectSwitcherModal.tsx`

**Interfaces:**
- Props:
  ```typescript
  export interface ProjectSwitcherModalProps {
    isOpen: boolean;
    onClose: () => void;
    currentWorkspace: string;
    onSelectWorkspace: (path: string) => void;
    onRunTerminalCommand?: (command: string) => void;
  }
  ```

- [ ] **Step 1: Implement `ProjectSwitcherModal.tsx`**

Build:
- Header with title "Studio Projets & Workspaces", subtitle, close button (`X` and `Échap`).
- Active Project Hero Card:
  - Big prominent card displaying current active project.
  - Active status pill with emerald pulse.
  - Runtime pills with framework tags.
  - Git branch and cleanliness pill.
  - Quick action buttons: `Terminal ici` and `Explorer dossier`.
- Search & Filter bar:
  - Search input with clear button.
  - Filter pills: `Tous`, `Node`, `Python`, `PHP`, `Git`, `Alertes de santé`.
  - Button `+ Ajouter un dossier`.
- Project Cards Grid:
  - Render list of projects with runtime icons, status badges (Default, Ready, Warnings).
  - Health warning alerts with 1-click remediation button (`Installer (npm install)`, `Créer venv`).
  - Action buttons: `Basculer` (selects project and closes modal with toast), `Définir par défaut` (star icon), `Retirer` (trash icon, guarded if default).
- Add Workspace Drawer / Browse Input:
  - Input path with validation and `explore_dir` quick suggestions.
- Keyboard navigation (arrows Up/Down, Enter to activate, Escape to close).

- [ ] **Step 2: Validate TypeScript & Oxlint**

Run:
- `npx oxlint --deny-warnings src/components/ProjectSwitcherModal.tsx`
- `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ProjectSwitcherModal.tsx
git commit -m "feat(ui): create ProjectSwitcherModal studio with active hero and health diagnostics" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 5: Integration in `App.tsx`, `ChatInput.tsx`, `Sidebar.tsx`, and Global Triggers

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/ChatInput.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/services/commands.ts`

- [ ] **Step 1: Connect `onOpenWorkspace` in `ChatInput.tsx` and `App.tsx`**

In `App.tsx`:
- Add state `isProjectSwitcherOpen` (boolean).
- Pass `onOpenWorkspace={() => setIsProjectSwitcherOpen(true)}` to `<ChatInput>`.
- Render `<ProjectSwitcherModal>` with lazy loading or direct import.
- Pass `onRunTerminalCommand` that dispatches `terminal-run-command` and opens the terminal drawer if closed.
- Handle `workspace-changed` event to update any local workspace state.

- [ ] **Step 2: Add global keyboard shortcut `Ctrl+Alt+W`**

In `App.tsx`:
- Listen for `(e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'w' || e.key === 'W')`.
- Toggle `isProjectSwitcherOpen`.

- [ ] **Step 3: Register `/workspace` and `/project` commands**

In `frontend/src/services/commands.ts` and `ChatInput.tsx`:
- Register `/workspace` and `/project` commands to open the studio.

- [ ] **Step 4: Add Project Switcher button in `Sidebar.tsx`**

In `Sidebar.tsx`:
- Add a project switcher button in the sidebar header with `FolderSync` or `Layers` icon and tooltip "Changer de projet (Ctrl+Alt+W)".
- Trigger `onOpenProjectSwitcher`.

- [ ] **Step 5: Validate TypeScript & Oxlint**

Run:
- `npx oxlint --deny-warnings`
- `npx tsc -b`
Expected: 0 warnings, 0 errors across all files.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/components/ChatInput.tsx frontend/src/components/Sidebar.tsx frontend/src/services/commands.ts
git commit -m "feat(integration): connect ProjectSwitcherModal to ChatInput, Sidebar, and Ctrl+Alt+W shortcut" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 6: Quality Gates, Chrome DevTools MCP Live Verification & Release v0.2.21

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/public/sw.js`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run complete Oxlint & TypeScript check**

Run:
- `npx oxlint --deny-warnings`
- `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 2: Run production Vite build**

Run: `npm run build`
Expected: Build succeeds with optimized bundles.

- [ ] **Step 3: Run complete backend test suite**

Run: `.\venv\Scripts\python.exe -m pytest tests/ -v`
Expected: 100% test pass rate across all tests.

- [ ] **Step 4: Chrome DevTools MCP Live Verification**

- Navigate to `http://localhost:8000/`.
- Press `Ctrl+Alt+W` or click on workspace chip in ChatInput to open Project Switcher Studio.
- Verify Active Project Hero Card displays `antigravity-webui` with Node.js and Python runtimes, Git branch `main`, and clean status.
- Verify project cards list with health indicators.
- Test search filtering.
- Take high-resolution screenshot and save to artifacts directory:
  - `project_switcher_studio.png`

- [ ] **Step 5: Version bump to v0.2.21**

- Update `frontend/package.json` to `0.2.21`.
- Update `frontend/public/sw.js` cache name to `antigravity-cache-v0.2.21`.
- Update `backend/app/main.py` version to `0.2.21`.
- Update `backend/app/services/updater.py` `CURRENT_VERSION` to `0.2.21`.
- Update `docs/ROADMAP.md` marking Sprint 17 as Completed and proposing Sprint 18.

- [ ] **Step 6: Git commit, tag, and push**

```bash
git add frontend/package.json frontend/public/sw.js backend/app/main.py backend/app/services/updater.py docs/ROADMAP.md
git commit -m "chore(release): bump version to v0.2.21 for Multi-Workspace & Project Switcher Studio" --author="jprud67 <jprud67@gmail.com>"
git tag -a v0.2.21 -m "Release v0.2.21: Multi-Workspace & Project Switcher Studio"
git push origin main --tags
```
