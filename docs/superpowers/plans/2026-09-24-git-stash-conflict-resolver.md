# Git Stash & Interactive Branch/Conflict Resolver Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an enterprise-grade Git Stash management and interactive Conflict Resolution Studio in `GitTab.tsx` and Monaco Editor with 3-way conflict inspection, one-click resolution (`ours`, `theirs`, or custom merge), stash diff previews, and interactive commit cherry-picking.

**Architecture:**
- **Backend (`backend/app/api/git.py`)**: REST endpoints for `stash` (list, save, pop, apply, drop, diff), `conflicts` (retrieve `:1:base`, `:2:ours`, `:3:theirs` and resolve via atomic write + `git add`), and `cherry-pick` (execute, continue, abort).
- **Frontend Services & Types (`types/index.ts`, `api.ts`)**: Structured interfaces `GitStashItem`, `ConflictFileInfo`, `ResolveConflictRequest`, and corresponding client methods.
- **Frontend Components (`GitTab.tsx`, `GitConflictModal.tsx` or MonacoStudio integration)**: Stash stack viewer with quick pop/apply/diff buttons, conflict alert banner with one-click resolver modal, and cherry-pick actions in commit log.

**Tech Stack:** FastAPI, Python subprocess Git API, React 19, TypeScript, Tailwind CSS, `@monaco-editor/react`, Lucide Icons, Pytest.

**Spec:** Sprint 14 Milestone from `ROADMAP.md`.

## Global Constraints
- Strictly adhere to `v0.*.*` semantic versioning (target `0.2.18`).
- Zero warnings/errors policy for Oxlint (`npx oxlint --deny-warnings src`) and TypeScript (`npx tsc -b`).
- 100% backend test pass rate across all pytest files.
- Safe path normalization and Git command injection prevention (no raw shell concatenation, sanitize refs and commit hashes).

---

### Task 1: Backend Git Stash Endpoints & Tests

**Files:**
- Modify: `backend/app/api/git.py`
- Create: `backend/tests/test_git_stash_conflicts.py`

**Interfaces:**
- `GET /api/git/stash`: returns `list[GitStashItem]`
- `POST /api/git/stash`: request `StashSaveRequest(workspace, message, include_untracked, keep_index)` -> `GitStashItem`
- `POST /api/git/stash/pop`: request `StashActionRequest(workspace, index)` -> `{"status": "ok", "message": str}`
- `POST /api/git/stash/apply`: request `StashActionRequest(workspace, index)` -> `{"status": "ok", "message": str}`
- `DELETE /api/git/stash`: request params `workspace`, `index` (optional: if omitted, clear all)
- `GET /api/git/stash/diff`: params `workspace`, `index`, `path` (optional) -> `{"diff": str, "index": int}`
- `GET /api/git/stash/file-versions`: params `workspace`, `index`, `path` -> `{"original_content": str, "modified_content": str, "file_path": str}`

- [ ] **Step 1: Write pytest unit tests for stash endpoints**
  - Verify listing stashes (empty and populated).
  - Verify creating stash with custom message and untracked files.
  - Verify applying and dropping stash.
  - Verify popping stash with conflicts.
  - Verify stash diff generation.

- [ ] **Step 2: Run pytest to verify tests fail**
  - Command: `.\venv\Scripts\python.exe -m pytest tests/test_git_stash_conflicts.py`

- [ ] **Step 3: Implement Git Stash endpoints in `backend/app/api/git.py`**
  - Parse `git stash list --format="%gd%x1f%h%x1f%cr%x1f%gs"` safely.
  - Implement save (`git stash push -m ...`), pop, apply, drop, and diff.
  - Implement security checks for index formatting and workspace access.

- [ ] **Step 4: Re-run pytest and ensure all tests pass**
  - Command: `.\venv\Scripts\python.exe -m pytest tests/test_git_stash_conflicts.py`

---

### Task 2: Backend Conflict Resolution & Cherry-Pick Endpoints

**Files:**
- Modify: `backend/app/api/git.py`
- Modify: `backend/tests/test_git_stash_conflicts.py`

**Interfaces:**
- `GET /api/git/conflicts/file`: params `workspace`, `path` -> `ConflictFileInfo(file_path, base_content, ours_content, theirs_content, current_content)`
- `POST /api/git/conflicts/resolve`: request `ResolveConflictRequest(workspace, path, resolution: 'ours' | 'theirs' | 'custom', custom_content?: str)` -> `{"status": "resolved", "file_path": str}`
- `POST /api/git/cherry-pick`: request `CherryPickRequest(workspace, commit_hash)` -> `{"status": "applied" | "conflict", "message": str, "conflicts": list[str]}`
- `POST /api/git/cherry-pick/abort`: request `{"workspace": str}` -> `{"status": "aborted"}`
- `POST /api/git/cherry-pick/continue`: request `{"workspace": str}` -> `{"status": "continued"}`

- [ ] **Step 1: Add unit tests for 3-way conflict extraction and resolution**
  - Create a temporary repository with merge conflict scenario.
  - Test fetching `:1:base`, `:2:ours`, and `:3:theirs` contents.
  - Test resolving conflict with `ours`, `theirs`, and `custom_content`.
  - Test cherry-pick with and without conflict.

- [ ] **Step 2: Implement conflict and cherry-pick handlers in `git.py`**
  - Use `git show :1:<path>`, `git show :2:<path>`, `git show :3:<path>`.
  - Atomic write and `git add` for resolved conflict.
  - Safely invoke `git cherry-pick`.

- [ ] **Step 3: Verify all backend tests pass**
  - Command: `.\venv\Scripts\python.exe -m pytest tests/test_git_stash_conflicts.py`

---

### Task 3: Frontend TypeScript Types & API Services

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Add types: `GitStashItem`, `StashSaveRequest`, `StashActionRequest`, `ConflictFileInfo`, `ResolveConflictRequest`, `CherryPickRequest`.
- Add functions: `fetchGitStashes`, `saveGitStash`, `popGitStash`, `applyGitStash`, `dropGitStash`, `fetchGitStashDiff`, `fetchGitStashFileVersions`, `fetchConflictFileInfo`, `resolveGitConflict`, `cherryPickCommit`, `abortCherryPick`, `continueCherryPick`.

- [ ] **Step 1: Declare TypeScript interfaces in `frontend/src/types/index.ts`**
- [ ] **Step 2: Implement API client methods in `frontend/src/services/api.ts`**
- [ ] **Step 3: Verify with Oxlint and TypeScript compiler**
  - Command: `npx oxlint --deny-warnings src/services/api.ts`
  - Command: `npx tsc -b`

---

### Task 4: Frontend Stash Manager & Conflict Resolver in GitTab

**Files:**
- Modify: `frontend/src/components/GitTab.tsx`
- Create: `frontend/src/components/GitConflictModal.tsx`

**Features:**
- Stash section in `GitTab.tsx`:
  - List stashes with accordion / collapsible cards showing index, age, commit hash, and message.
  - Buttons: Pop, Apply, Drop, and Diff Preview in Monaco Studio.
  - "Nouveau Stash" action with modal prompting for message and untracked inclusion.
- Conflict Banner & Resolver:
  - When status contains `conflicts.length > 0`, display warning banner with action "Résoudre les conflits".
  - `GitConflictModal.tsx` provides side-by-side or 3-way visual resolution:
    - Choose Ours (`Accept Current`).
    - Choose Theirs (`Accept Incoming`).
    - Monaco custom editor to manually edit and click "Marquer comme résolu".
- Cherry-Pick Action in Commit History:
  - Add "Cherry-pick" icon button on each commit in the log.
  - Confirms action, executes cherry-pick, handles conflict notification gracefully.

- [ ] **Step 1: Create `GitConflictModal.tsx`**
- [ ] **Step 2: Integrate Stash Manager and Conflict Resolver in `GitTab.tsx`**
- [ ] **Step 3: Add Cherry-Pick triggers to Commit Log cards**
- [ ] **Step 4: Quality gate check on frontend components**
  - Command: `npx oxlint --deny-warnings src`
  - Command: `npx tsc -b`

---

### Task 5: Live Verification, Version Bump & Release v0.2.18

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`
- Modify: `ROADMAP.md`
- Modify: `walkthrough.md`
- Modify: `task.md`

- [ ] **Step 1: Full backend pytest verification**
  - Command: `.\venv\Scripts\python.exe -m pytest`
- [ ] **Step 2: Production Vite build**
  - Command: `npm run build`
- [ ] **Step 3: Interactive Chrome DevTools MCP testing**
  - Create a stash, inspect its diff in Monaco, apply/pop it.
  - Simulate a merge conflict, open `GitConflictModal`, inspect 3-way contents, resolve it.
  - Capture screenshots: `git_stash_manager.png` and `git_conflict_resolver.png`.
- [ ] **Step 4: Version bump to `0.2.18`**
- [ ] **Step 5: Git commit, tag `v0.2.18` and push to GitHub**
