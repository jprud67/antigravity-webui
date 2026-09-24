# AI Inline Copilot & Ghost Text Actions dans Monaco Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intégrer un système de complétion IA inline "Ghost Text" en temps réel (Fill-In-The-Middle) et des Code Actions contextuelles (Refactor, Types, Docs, Tests) dans Monaco Editor pour Antigravity WebUI.

**Architecture:** Backend FastAPI ultra-rapide avec FIM prompt Gemini Flash et cache LRU en mémoire (`/api/copilot/inline-suggest`, `/api/copilot/action`). Frontend avec `InlineCompletionsProvider` natif Monaco, debounce 280ms, gestion d'annulation (`CancellationToken`), et barre Code Actions avec prévisualisation Diff.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic, Monaco Editor (`@monaco-editor/react`), React 18, TypeScript, Tailwind CSS / Vanilla CSS variables.

**Spec:** [`docs/superpowers/specs/2026-09-24-ai-copilot-inline-studio.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-24-ai-copilot-inline-studio.md)

## Global Constraints

- Version cible du sprint : `v0.2.19` synchronisée sur frontend et backend.
- Zéro avertissement, zéro erreur Oxlint (`npx oxlint --deny-warnings`).
- Compilation TypeScript stricte sans erreur (`npx tsc -b`).
- 100% de succès sur la suite de tests backend (`pytest tests/`).
- Aucune régression sur les fonctionnalités existantes de Monaco (Diff, Split, Breadcrumb, Multi-tabs).

---

### Task 1: Backend Fast FIM Engine & Endpoints

**Files:**
- Create: `backend/app/api/copilot.py`
- Modify: `backend/app/main.py:40-70`
- Test: `backend/tests/test_copilot_api.py`

**Interfaces:**
- Consumes: `require_auth` from `app.api.auth`, `get_active_account` from `app.services.google_auth`
- Produces: `POST /api/copilot/inline-suggest`, `POST /api/copilot/action`, `GET /api/copilot/status`

- [ ] **Step 1: Write the failing tests for copilot endpoints**

Create `backend/tests/test_copilot_api.py` covering:
- `POST /api/copilot/inline-suggest` returns clean code suggestion without markdown backticks.
- Cache LRU hit on identical prefix/suffix/language.
- `POST /api/copilot/action` with actions `refactor`, `types`, `docstring`, `tests`.
- `GET /api/copilot/status`.

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_copilot_api.py -v`
Expected: FAIL (404 or ModuleNotFoundError)

- [ ] **Step 3: Implement `backend/app/api/copilot.py`**

Implement router with:
- Models: `InlineSuggestRequest`, `InlineSuggestResponse`, `CopilotActionRequest`, `CopilotActionResponse`, `CopilotStatusResponse`.
- LRU cache dictionary with maxsize=256 and lock.
- Clean response helper removing leading/trailing ``` markdown wrappers.
- Route handlers.
- Mount router in `backend/app/main.py`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_copilot_api.py -v`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit backend changes**

```bash
git add backend/app/api/copilot.py backend/app/main.py backend/tests/test_copilot_api.py
git commit -m "feat(api): add copilot inline-suggest and action endpoints with LRU cache"
```

---

### Task 2: Frontend Copilot Types, API Client & Inline Provider

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/services/copilot.ts`

**Interfaces:**
- Consumes: `/api/copilot/*` endpoints
- Produces: `fetchInlineCompletion`, `executeCopilotAction`, `registerCopilotInlineProvider`

- [ ] **Step 1: Add TypeScript interfaces in `frontend/src/types/index.ts`**

Define `InlineSuggestRequest`, `InlineSuggestResponse`, `CopilotActionRequest`, `CopilotActionResponse`, `CopilotStatusResponse`.

- [ ] **Step 2: Add API client functions in `frontend/src/services/api.ts`**

Implement `fetchInlineCompletion`, `executeCopilotAction`, and `fetchCopilotStatus`.

- [ ] **Step 3: Create `frontend/src/services/copilot.ts`**

Implement:
- `registerCopilotInlineProvider(monaco, options)` using `monaco.languages.registerInlineCompletionsProvider`.
- Debounce 280ms logic with `AbortController` cancellation token.
- Context validation (skips inside multi-line comments or long closed strings unless directive comment present).
- Preferences loader/saver for `isCopilotEnabled` in `localStorage`.

- [ ] **Step 4: Verify types with TypeScript compiler**

Run: `npx tsc -b`
Expected: 0 errors

- [ ] **Step 5: Commit frontend services**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/services/copilot.ts
git commit -m "feat(frontend): create copilot service and Monaco inline completions provider"
```

---

### Task 3: UI Integration in MonacoStudioModal & WorkspacePanel

**Files:**
- Modify: `frontend/src/components/MonacoStudioModal.tsx`
- Modify: `frontend/src/components/WorkspacePanel.tsx`

**Interfaces:**
- Consumes: `registerCopilotInlineProvider`, `isCopilotEnabled` toggle
- Produces: Copilot status pill, keyboard toggle (`Alt+C`), Monaco `inlineSuggest` options

- [ ] **Step 1: Configure Monaco inlineSuggest options in `MonacoStudioModal.tsx`**

Enable `inlineSuggest: { enabled: true, mode: 'subsequent' }` and wire `registerCopilotInlineProvider` in `onMount`.
Add Copilot status button in header: `⚡ Copilot: Actif` / `En pause`.

- [ ] **Step 2: Configure Monaco inlineSuggest in `WorkspacePanel.tsx`**

Register the inline completions provider on editor mount in `WorkspacePanel.tsx`.
Add status badge in IDE footer: `⚡ Copilot`.

- [ ] **Step 3: Lint check and TypeScript build**

Run: `npx oxlint --deny-warnings` and `npx tsc -b`
Expected: 0 warnings, 0 errors

- [ ] **Step 4: Commit UI integration**

```bash
git add frontend/src/components/MonacoStudioModal.tsx frontend/src/components/WorkspacePanel.tsx
git commit -m "feat(studio): wire copilot ghost text and status pill into Monaco Studio and Workspace"
```

---

### Task 4: Quick Code Actions Studio (Refactor, Types, Docs, Tests)

**Files:**
- Create: `frontend/src/components/CopilotActionModal.tsx`
- Modify: `frontend/src/components/MonacoStudioModal.tsx`
- Modify: `frontend/src/components/WorkspacePanel.tsx`

**Interfaces:**
- Consumes: `executeCopilotAction`
- Produces: Interactive modal with Monaco Diff preview comparing original vs AI generated code before applying changes

- [ ] **Step 1: Create `frontend/src/components/CopilotActionModal.tsx`**

Modal with:
- Selector for action: `Refactoriser`, `Types TypeScript`, `Documentation`, `Tests Unitaires`.
- Optional custom instruction input.
- Execution button with animated spinner.
- Side-by-side Monaco Diff preview showing suggested transformation.
- "Appliquer les modifications" button replacing the selection/file content.

- [ ] **Step 2: Wire Code Actions trigger in `MonacoStudioModal.tsx` & `WorkspacePanel.tsx`**

Add "⚡ Actions IA" button in editor action bars.
Open `CopilotActionModal` with current selection or full file.

- [ ] **Step 3: Lint check & TypeScript check**

Run: `npx oxlint --deny-warnings` and `npx tsc -b`
Expected: 0 warnings, 0 errors

- [ ] **Step 4: Commit Code Actions**

```bash
git add frontend/src/components/CopilotActionModal.tsx frontend/src/components/MonacoStudioModal.tsx frontend/src/components/WorkspacePanel.tsx
git commit -m "feat(copilot): add AI Code Actions studio with Monaco Diff preview"
```

---

### Task 5: Quality Gates, MCP Live Validation & Release v0.2.19

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`
- Modify: `task.md`, `ROADMAP.md`, `walkthrough.md`

- [ ] **Step 1: Bump version to `0.2.19`**
- [ ] **Step 2: Run full backend test suite (`pytest tests/`)**
- [ ] **Step 3: Run Oxlint & Vite production build (`npm run build`)**
- [ ] **Step 4: Interactive verification via Chrome DevTools MCP**
- [ ] **Step 5: Git commit, tag `v0.2.19` & push to GitHub**
