# Interactive Git Rebase & Visual Branch Manager Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an enterprise-grade visual branch manager and interactive Git rebase studio (`pick`, `squash`, `reword`, `drop`) directly within Antigravity WebUI without requiring terminal commands.

**Architecture:** Extend `backend/app/api/git.py` with full branch lifecycle endpoints and non-interactive `git rebase -i` sequence automation via `GIT_SEQUENCE_EDITOR` script generation. Build `GitRebaseModal.tsx` for visual reordering and commit action assignment, and enrich `GitTab.tsx` with a dedicated "Branches" subtab and rebase in-progress conflict banner.

**Tech Stack:** Python 3.13 / FastAPI, React 19, TypeScript, Monaco Editor, Lucide Icons, Tailwind CSS, Pytest, Vite.

**Spec:** [`docs/superpowers/specs/2026-09-24-git-rebase-branch-studio.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-24-git-rebase-branch-studio.md)

## Global Constraints
- Target version: `0.2.20`
- Zero warnings/errors on `npx oxlint --deny-warnings`
- Zero errors on TypeScript compiler `npx tsc -b`
- 100% backend test suite pass rate on `pytest tests/`
- All commits authored strictly as `jprud67 <jprud67@gmail.com>` with no `Co-Authored-By` trailers
- Strict path containment checks via `is_safe_path` and `_validate_workspace`

---

### Task 1: Backend Branch Management Endpoints & Tests

**Files:**
- Modify: `backend/app/api/git.py`
- Test: `backend/tests/test_git_branch_rebase.py`

**Interfaces:**
- Produces:
  - `GET /api/git/branches`: detailed branches with tracking, ahead/behind, last commit
  - `POST /api/git/branches/checkout`: `{ workspace, branch, create, start_point }`
  - `POST /api/git/branches/create`: `{ workspace, name, start_point, checkout }`
  - `DELETE /api/git/branches`: `{ workspace, branch, force, remote, remote_name }`
  - `POST /api/git/branches/merge`: `{ workspace, branch, no_ff, message }`
  - `POST /api/git/branches/rename`: `{ workspace, old_name, new_name }`

- [ ] **Step 1: Write unit tests for branch management**

Create `backend/tests/test_git_branch_rebase.py` with fixtures creating a temporary git repository and testing:
- Branch creation and listing with upstream info
- Checkout with dirty worktree detection (409)
- Protection against deleting active or protected branches (main)
- Merge with fast-forward and conflict detection
- Branch renaming

- [ ] **Step 2: Run test to verify it fails**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_branch_rebase.py -v`
Expected: FAIL (endpoints missing or 404)

- [ ] **Step 3: Implement branch endpoints in `git.py`**

In `backend/app/api/git.py`:
- Add `BranchCheckoutRequest`, `BranchCreateRequest`, `BranchDeleteRequest`, `BranchMergeRequest`, `BranchRenameRequest`.
- Update `get_git_branches` to run `git for-each-ref` or `git branch -vv --format` extracting branch name, upstream, ahead/behind counts, commit hash, date, subject.
- Implement `@router.post("/branches/checkout")`: check working tree cleanliness, execute `git checkout`.
- Implement `@router.post("/branches/create")`: validate with `git check-ref-format`, execute `git checkout -b` or `git branch`.
- Implement `@router.delete("/branches")`: check if `branch == current_branch` or in `['main', 'master']` (400), execute `git branch -d` (or `-D` if force).
- Implement `@router.post("/branches/merge")`: execute `git merge`, detect conflicts.
- Implement `@router.post("/branches/rename")`: execute `git branch -m`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_branch_rebase.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/git.py backend/tests/test_git_branch_rebase.py
git commit -m "feat(git): add branch management endpoints and unit tests"
```

---

### Task 2: Backend Interactive Rebase Engine & Tests

**Files:**
- Modify: `backend/app/api/git.py`
- Test: `backend/tests/test_git_branch_rebase.py`

**Interfaces:**
- Produces:
  - `GET /api/git/rebase/todo?base=<base>&workspace=<ws>`
  - `POST /api/git/rebase/execute`: `{ workspace, base, commits: [{ sha, action, new_message }] }`
  - `GET /api/git/rebase/status?workspace=<ws>`
  - `POST /api/git/rebase/continue`: `{ workspace }`
  - `POST /api/git/rebase/abort`: `{ workspace }`

- [ ] **Step 1: Write unit tests for interactive rebase**

Add test cases in `backend/tests/test_git_branch_rebase.py`:
- Test `GET /api/git/rebase/todo` returns commit list in chronological order
- Test `POST /api/git/rebase/execute` with `reword` updates commit message
- Test `POST /api/git/rebase/execute` with `squash` merges commits
- Test `POST /api/git/rebase/execute` with `drop` removes commit
- Test conflict during rebase returns `status: "conflict"`
- Test `POST /api/git/rebase/abort` restores branch tip

- [ ] **Step 2: Run test to verify it fails**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_branch_rebase.py -k "test_rebase" -v`
Expected: FAIL

- [ ] **Step 3: Implement interactive rebase engine in `git.py`**

In `backend/app/api/git.py`:
- Implement `GET /api/git/rebase/todo`: runs `git log --reverse --format="%h%x09%H%x09%an%x09%aI%x09%s" <base>..HEAD`.
- Implement `POST /api/git/rebase/execute`:
  - Writes a temporary instruction file containing ordered actions.
  - Prepares helper Python script passed to `GIT_SEQUENCE_EDITOR` which replaces Git's todo list.
  - If any commit has a `new_message`, sets `GIT_EDITOR` script to replace commit messages on reword/squash.
  - Runs `git rebase -i <base>`.
  - Checks if `.git/rebase-merge` or `.git/rebase-apply` exists to report conflict status and files.
- Implement `GET /api/git/rebase/status`: inspects `.git/rebase-merge/` or `.git/rebase-apply/`, extracts current step, total steps, and conflicted files.
- Implement `POST /api/git/rebase/continue`: runs `git rebase --continue`.
- Implement `POST /api/git/rebase/abort`: runs `git rebase --abort`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_branch_rebase.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/git.py backend/tests/test_git_branch_rebase.py
git commit -m "feat(git): implement interactive rebase engine and sequence automation"
```

---

### Task 3: Frontend TypeScript Types & API Client Services

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces:
  - Types: `GitBranchDetail`, `BranchCheckoutRequest`, `BranchCreateRequest`, `BranchDeleteRequest`, `BranchMergeRequest`, `BranchRenameRequest`, `RebaseCommitItem`, `RebaseExecuteRequest`, `RebaseExecuteResponse`, `RebaseStatusResponse`
  - API methods: `fetchGitBranchesDetail`, `checkoutGitBranch`, `createGitBranch`, `deleteGitBranch`, `mergeGitBranch`, `renameGitBranch`, `fetchRebaseTodo`, `executeGitRebase`, `fetchRebaseStatus`, `continueGitRebase`, `abortGitRebase`

- [ ] **Step 1: Add TypeScript interfaces in `frontend/src/types/index.ts`**

Define exact interfaces for branch objects and rebase requests/responses matching the backend schemas.

- [ ] **Step 2: Add API client functions in `frontend/src/services/api.ts`**

Implement strongly-typed fetch wrappers with proper auth headers and error handling for all 11 new endpoints.

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc -b`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(types): add branch management and interactive rebase types and API methods"
```

---

### Task 4: Frontend Visual Branch Manager in `GitTab.tsx`

**Files:**
- Modify: `frontend/src/components/GitTab.tsx`

**Interfaces:**
- Consumes: `fetchGitBranchesDetail`, `checkoutGitBranch`, `createGitBranch`, `deleteGitBranch`, `mergeGitBranch`, `renameGitBranch`

- [ ] **Step 1: Add 'branches' subtab to GitTab header**

In `frontend/src/components/GitTab.tsx`:
- Add `'branches'` to `activeSubTab` union (`'changes' | 'history' | 'stashes' | 'branches'`).
- Add Tab button `Branches` with `GitBranch` icon and branch count badge.

- [ ] **Step 2: Implement Branches subtab view**

- Render Active Branch banner with ahead/behind badges and upstream indicator.
- Add `+ Nouvelle branche` button with modal dialogue (branch name, starting commit, checkout checkbox).
- Add Search/Filter input for branch filtering.
- Render Local Branches cards with:
  - Branch name, last commit date and subject.
  - Actions: `Basculer` (disabled for current), `Fusionner` (with `--no-ff` checkbox), `Renommer`, `Supprimer` (with confirm modal and force `-D` option).
- Render Remote Branches cards with `Créer branche locale` action.

- [ ] **Step 3: Verify Oxlint and TypeScript**

Run: `npx oxlint --deny-warnings` && `npx tsc -b`
Expected: 0 errors, 0 warnings

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GitTab.tsx
git commit -m "feat(git): add visual branch manager subtab in GitTab"
```

---

### Task 5: Frontend Interactive Rebase Studio Modal (`GitRebaseModal.tsx`) & In-Progress Banner

**Files:**
- Create: `frontend/src/components/GitRebaseModal.tsx`
- Modify: `frontend/src/components/GitTab.tsx`

**Interfaces:**
- Consumes: `fetchRebaseTodo`, `executeGitRebase`, `fetchRebaseStatus`, `continueGitRebase`, `abortGitRebase`

- [ ] **Step 1: Create `GitRebaseModal.tsx` component**

- Props: `isOpen`, `baseCommit`, `onClose`, `onSuccess`, `workspace`.
- Load commits between `baseCommit` and `HEAD` via `fetchRebaseTodo`.
- Render draggable and reorderable commit rows with Up/Down buttons.
- Render action toggle per commit (`pick`, `squash`, `reword`, `drop`).
- For `reword` and `squash`, provide inline editable message input.
- Summary bar: count of kept, squashed, and dropped commits.
- "Lancer le rebase" button with loading state.

- [ ] **Step 2: Wire Rebase Modal and Conflict Banner into `GitTab.tsx`**

- Add "Rebase interactif depuis ce commit" button in the commit detail inspector.
- Add "Rebase" button in the GitTab toolbar with presets (5, 10, 15 commits).
- Query `fetchRebaseStatus` on load and after git actions.
- If rebase is in progress, display prominent amber alert banner:
  - "Rebase interactif en cours (étape X/Y)".
  - "Résoudre les conflits" button (opens existing `GitConflictModal`).
  - "Continuer (git rebase --continue)" button.
  - "Annuler (git rebase --abort)" button.

- [ ] **Step 3: Verify Oxlint and TypeScript**

Run: `npx oxlint --deny-warnings` && `npx tsc -b`
Expected: 0 errors, 0 warnings

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/GitRebaseModal.tsx frontend/src/components/GitTab.tsx
git commit -m "feat(git): create GitRebaseModal and rebase conflict in-progress banner"
```

---

### Task 6: End-to-End Validation, Release v0.2.20 & Deployment

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`
- Modify: `task.md`, `ROADMAP.md`, `walkthrough.md`

- [ ] **Step 1: Run full quality gates**

Run:
1. `npx oxlint --deny-warnings` (must be 0/0)
2. `npx tsc -b` (must exit code 0)
3. `.\venv\Scripts\python.exe -m pytest tests/` (all tests passing)
4. `npm run build` (clean Vite production build)

- [ ] **Step 2: Live Chrome DevTools verification**

- Reload `http://localhost:8000/`.
- Open GitTab -> navigate to "Branches" subtab.
- Test branch creation and checkout.
- Open Rebase Studio Modal, test reordering and action selection.
- Capture screenshot `git_rebase_branch_manager.png` and save to brain artifacts.

- [ ] **Step 3: Bump version to `0.2.20`**

Update version strings in `package.json`, `main.py`, `updater.py`, `sw.js`.
Re-run `npm run build`.

- [ ] **Step 4: Update documentation**

Update `task.md`, `ROADMAP.md`, and `walkthrough.md` with Sprint 16 release notes.

- [ ] **Step 5: Git commit, tag `v0.2.20`, and push**

```bash
git add -A
git commit -m "release: v0.2.20 - Interactive Git Rebase & Visual Branch Manager Studio"
git tag -a v0.2.20 -m "Release v0.2.20: Interactive Git Rebase & Visual Branch Manager Studio"
git push origin main --tags
```
