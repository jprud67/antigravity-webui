# Sprint 13 — Workspace Global Search & Replace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a professional VS Code-grade Global Search and Replace system across all workspace files with regex, case sensitivity, whole word, glob inclusion/exclusion filters, Monaco Diff preview before replacing, and single/batch atomic replacements.

**Architecture:** 
- Backend endpoints in `backend/app/api/files.py` (`POST /api/files/workspace-search`, `POST /api/files/workspace-replace`, `POST /api/files/single-replace`) providing fast, secure, multi-file regex-powered search and atomic replacements with dry-run diff generation.
- Frontend search component `WorkspaceSearchPanel.tsx` integrated directly into `WorkspacePanel.tsx` as a full tab (`RightPanelTab = 'files' | 'search' | ...`), keeping Monaco Editor visible side-by-side.
- Global keyboard shortcuts (`Ctrl+Shift+F` for Find, `Ctrl+Shift+H` for Replace) with custom event dispatching (`open-workspace-search`).
- Full integration with `FileIcon.tsx`, `MonacoStudioModal` (side-by-side diff preview), and jump-to-line selection in Monaco.

**Tech Stack:** FastAPI, Python `re` & `pathlib`, React 18, TypeScript, Tailwind CSS, Monaco Editor (`@monaco-editor/react`), Lucide React.

---

## Global Constraints
- Target version: `v0.2.17`.
- Strict quality gates: `npx oxlint --deny-warnings src` (0 warnings, 0 errors), `npx tsc -b` (0 errors), `npm run build` cleanly passing.
- 100% backend test pass rate with pytest.
- Strict security: path traversal protection via `_validate_path_access`, exclusion of sensitive directories (`.git`, `node_modules`, `venv`, `__pycache__`, etc.).
- Complete implementation with no placeholders, no `TODO`s, and full verification via Chrome DevTools MCP.

---

## Tasks Breakdown

### Task 1: Backend Global Search & Replace Endpoints
**Files:**
- Modify: `backend/app/api/files.py`
- Test: `backend/tests/test_workspace_search_replace.py`

**Interfaces:**
- Produces:
  - `POST /api/files/workspace-search`: returns `WorkspaceSearchResponse(query, total_matches, total_files, files, duration_ms, truncated)`
  - `POST /api/files/workspace-replace`: returns `WorkspaceReplaceResponse(query, replace_text, total_replacements, files_modified, previews, dry_run, duration_ms)`
  - `POST /api/files/single-replace`: returns `SingleReplaceResponse(success, file_path, modified_content)`

- [ ] **Step 1: Write the failing tests in `backend/tests/test_workspace_search_replace.py`**
  - Test authentication requirement.
  - Test search with plain text, case sensitive, whole word, regex, include/exclude glob patterns.
  - Test replace with `dry_run=True` (returns preview diffs without touching files).
  - Test replace with `dry_run=False` (atomically writes changes to files).
  - Test single occurrence replacement.
  - Test security constraints (blocking path traversal outside workspace).

- [ ] **Step 2: Run pytest to verify tests fail**
  - Command: `.\venv\Scripts\python.exe -m pytest backend/tests/test_workspace_search_replace.py -v`
  - Expected: FAIL with 404 or missing endpoints.

- [ ] **Step 3: Implement search & replace logic in `backend/app/api/files.py`**
  - Implement Pydantic models: `WorkspaceSearchRequest`, `SearchMatchItem`, `FileSearchResult`, `WorkspaceSearchResponse`, `WorkspaceReplaceRequest`, `FileReplacePreview`, `WorkspaceReplaceResponse`, `SingleReplaceRequest`.
  - Implement helper `_compile_search_pattern(query, case_sensitive, whole_word, is_regex)`.
  - Implement helper `_matches_glob_patterns(rel_path, include_pat, exclude_pat)`.
  - Implement file crawler filtering binary files, files > `max_file_size_kb`, and ignored directories.
  - Implement replacement engine with atomic file writes.

- [ ] **Step 4: Run pytest to verify all tests pass**
  - Command: `.\venv\Scripts\python.exe -m pytest backend/tests/test_workspace_search_replace.py -v`
  - Expected: PASS with all green tests.

- [ ] **Step 5: Run full pytest suite**
  - Command: `.\venv\Scripts\python.exe -m pytest tests/`
  - Expected: All tests passing (55+ tests).

---

### Task 2: Frontend API Services & Types
**Files:**
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/types.ts`

**Interfaces:**
- Produces:
  - `searchWorkspaceFiles(payload: WorkspaceSearchRequest): Promise<WorkspaceSearchResponse>`
  - `replaceWorkspaceFiles(payload: WorkspaceReplaceRequest): Promise<WorkspaceReplaceResponse>`
  - `replaceSingleOccurrence(payload: SingleReplaceRequest): Promise<{ success: boolean; modified_content: string }>`

- [ ] **Step 1: Add TypeScript interfaces in `frontend/src/types.ts`**
  - `SearchMatchItem`, `FileSearchResult`, `WorkspaceSearchResponse`, `WorkspaceSearchRequest`.
  - `FileReplacePreview`, `WorkspaceReplaceResponse`, `WorkspaceReplaceRequest`, `SingleReplaceRequest`.

- [ ] **Step 2: Add API service functions in `frontend/src/services/api.ts`**
  - Implement `searchWorkspaceFiles`, `replaceWorkspaceFiles`, `replaceSingleOccurrence` with proper auth headers and error handling.

- [ ] **Step 3: Validate TypeScript compilation**
  - Command: `npx tsc -b`
  - Expected: 0 errors.

---

### Task 3: WorkspaceSearchPanel Component
**Files:**
- Create: `frontend/src/components/WorkspaceSearchPanel.tsx`

**Interfaces:**
- Consumes:
  - `searchWorkspaceFiles`, `replaceWorkspaceFiles`, `replaceSingleOccurrence` from `api.ts`
  - `FileIcon` from `FileIcon.tsx`
- Produces:
  - `WorkspaceSearchPanel` component with:
    - Search input + options (Aa, \b, .*)
    - Replace input + toggle
    - Files to include / exclude collapsible options
    - Collapsible file results groups with match counts
    - Highlighted code snippets
    - Actions per match: jump to file in Monaco, replace occurrence, preview diff
    - Global "Remplacer tout" with confirmation dialog

- [ ] **Step 1: Create `WorkspaceSearchPanel.tsx`**
  - Implement state hooks: query, replaceText, isCaseSensitive, isWholeWord, isRegex, includePattern, excludePattern, isReplaceOpen, isDetailsOpen.
  - Implement search executor with loading spinner and error alerts.
  - Implement collapsible file groups with total match count badges.
  - Implement snippet highlighter rendering matched substring in bold amber.
  - Implement replace single occurrence and replace all in file.
  - Implement replace all in workspace with summary modal.
  - Implement callbacks: `onOpenFile(path, line, col, length)`, `onPreviewDiff(path, original, modified)`.

- [ ] **Step 2: Lint and typecheck**
  - Command: `npx oxlint --deny-warnings src/components/WorkspaceSearchPanel.tsx`
  - Command: `npx tsc -b`
  - Expected: 0 warnings, 0 errors.

---

### Task 3.5: Update Task Tracking File
**Files:**
- Modify: `task.md`
- Add Sprint 13 phase tracking tasks.

---

### Task 4: Integration into WorkspacePanel & App Shortcuts
**Files:**
- Modify: `frontend/src/components/WorkspacePanel.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Extends `RightPanelTab = 'files' | 'search' | 'artifacts' | 'terminal' | 'git' | 'kanban'`.
- Adds `Ctrl+Shift+F` and `Ctrl+Shift+H` global listeners in `App.tsx` and `WorkspacePanel.tsx`.

- [ ] **Step 1: Update `WorkspacePanel.tsx` tab bar and view router**
  - Add `'search'` tab button with `Search` icon next to `Files`.
  - When `activeTab === 'search'`, render `WorkspaceSearchPanel` in the left column (width: 320px–420px) while preserving Monaco Editor tabs on the right.
  - Add handler `handleSelectSearchMatch(path, line, col, length)`:
    - Opens or activates tab in `openTabs`.
    - Uses `monacoEditorRef.current` to `revealPositionInCenter`, `setPosition`, and highlight selection with `setSelection`.
  - Add handler `handlePreviewSearchDiff(filePath, original, modified)`:
    - Calls `onOpenMonacoStudio({ mode: 'diff', filePath, originalContent, modifiedContent })`.
  - Add button in File Tree toolbar: "Recherche globale (Ctrl+Shift+F)" jumping to search tab.

- [ ] **Step 2: Add global shortcuts in `App.tsx`**
  - Listen for `Ctrl+Shift+F` / `Cmd+Shift+F` to open WorkspacePanel with `search` tab.
  - Listen for `Ctrl+Shift+H` / `Cmd+Shift+H` to open WorkspacePanel with `search` tab in replace mode.
  - Listen for custom event `open-workspace-search` with `{ query?: string, mode?: 'find' | 'replace' }`.

- [ ] **Step 3: Quality checks**
  - Command: `npx oxlint --deny-warnings src`
  - Command: `npx tsc -b`
  - Command: `npm run build`
  - Expected: Clean build with 0 errors.

---

### Task 5: Live DevTools Testing, Version Bump & GitHub Release
**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`
- Artifacts: Screenshots, `task.md`, `ROADMAP.md`, `walkthrough.md`

- [ ] **Step 1: Test interactively in Chrome DevTools MCP**
  - Navigate to `http://localhost:8000/`.
  - Switch to Search tab (`Ctrl+Shift+F`).
  - Search for a keyword (e.g. `DEFAULT_WORKSPACE` or `antigravity`).
  - Verify grouped results by file, match badges, highlighted snippets.
  - Click on a match and verify Monaco opens the file and jumps to the exact line/column with selection.
  - Test Replace preview diff in MonacoStudioModal.
  - Capture screenshots of Search and Replace views.

- [ ] **Step 2: Bump version to `0.2.17`**
  - Update `package.json`, `main.py`, `updater.py`, `sw.js`.
  - Rebuild with `npm run build`.

- [ ] **Step 3: Update tracking documents**
  - Update `task.md`, `ROADMAP.md`, `walkthrough.md`.

- [ ] **Step 4: Git commit, tag `v0.2.17` & push to GitHub**
  - `git add -A`
  - `git commit -m "feat: Sprint 13 (v0.2.17) - Workspace Global Search & Replace (Ctrl+Shift+F/H, regex, include/exclude, Monaco Diff preview, atomic batch replace)"`
  - `git tag v0.2.17`
  - `git push origin main --tags`
