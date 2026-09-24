# AI Prompt Optimizer & Meta-Prompt Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an active AI prompt doctor with real-time heuristic clarity scoring, token estimation, and a 1-click meta-prompt studio to restructure rough user drafts into high-precision agentic prompts.

**Architecture:** A FastAPI backend module (`backend/app/api/prompt.py`) providing `/api/prompt/analyze` and `/api/prompt/optimize`, a client-side real-time scoring engine (`frontend/src/utils/promptAnalyzer.ts`), an interactive studio modal (`frontend/src/components/PromptOptimizerModal.tsx`), and triggers in `ChatInput.tsx`, slash commands, and keyboard shortcut `Ctrl+Shift+O`.

**Tech Stack:** Python 3.13, FastAPI, Pydantic, Pytest, React 19, TypeScript, Lucide React, Vite, Oxlint.

**Spec:** `docs/superpowers/specs/2026-09-24-ai-prompt-optimizer-studio-design.md`

## Global Constraints
- Target semantic version strictly constrained to `v0.2.14`.
- Zero warnings, zero errors on `npx oxlint --deny-warnings src` and `npx tsc -b`.
- All backend tests passing 100% on `python -m pytest tests`.
- Full production bundle must succeed on `npm run build`.
- Live visual and functional verification in Chrome DevTools MCP on `http://localhost:8000/`.

---

### Task 1: Backend Heuristic Analyzer & Optimizer Endpoints (`/api/prompt/analyze`, `/api/prompt/optimize`)

**Files:**
- Create: `backend/app/api/prompt.py`
- Modify: `backend/app/main.py:20-50`
- Test: `backend/tests/test_prompt_optimizer.py`

**Interfaces:**
- Consumes: `require_auth` from `app.api.auth`
- Produces:
  - `POST /api/prompt/analyze` -> `PromptAnalysisResponse`
  - `POST /api/prompt/optimize` -> `PromptOptimizationResponse`

- [ ] **Step 1: Write failing pytest tests for prompt analysis and optimization**

```python
# backend/tests/test_prompt_optimizer.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_analyze_empty_prompt():
    response = client.post("/api/prompt/analyze", json={"prompt": ""})
    assert response.status_code == 200
    data = response.json()
    assert data["word_count"] == 0
    assert data["clarity_score"] == 0
    assert len(data["suggestions"]) > 0

def test_analyze_rich_prompt():
    prompt = "Dans `backend/app/main.py`, corrige l'erreur 500 sur /api/login sans casser les tests existants. Retourne un diff unifié."
    response = client.post("/api/prompt/analyze", json={"prompt": prompt})
    assert response.status_code == 200
    data = response.json()
    assert data["clarity_score"] >= 70
    assert data["detected_elements"]["files"] == ["backend/app/main.py"]
    assert data["detected_elements"]["has_constraints"] is True
    assert data["breakdown"]["context"] > 10

def test_optimize_debug_preset():
    prompt = "bug sur la route login"
    response = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "debug"})
    assert response.status_code == 200
    data = response.json()
    assert "Objectif" in data["optimized"]
    assert "debug" in data["preset"]
    assert data["tokens_optimized"] > data["tokens_original"]

def test_optimize_plan_preset():
    prompt = "créer un système d'authentification OAuth"
    response = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "plan"})
    assert response.status_code == 200
    data = response.json()
    assert "Plan d'implémentation" in data["optimized"] or "Instructions par étapes" in data["optimized"]
```

- [ ] **Step 2: Run pytest to verify test failures**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_prompt_optimizer.py`
Expected: FAIL (404 Not Found on `/api/prompt/analyze`)

- [ ] **Step 3: Implement `backend/app/api/prompt.py` and register in `backend/app/main.py`**

Implement `analyze_prompt`, `optimize_prompt`, heuristic regex matchers, token estimation, and preset generators. Register `prompt_router` in `main.py`.

- [ ] **Step 4: Run pytest to verify all tests pass**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_prompt_optimizer.py`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/api/prompt.py backend/app/main.py backend/tests/test_prompt_optimizer.py
git commit -m "feat(prompt): add prompt analysis and optimization endpoints"
```

---

### Task 2: Frontend Types, API Client & Client-Side Analyzer

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/utils/promptAnalyzer.ts`

**Interfaces:**
- Consumes: `apiClient` from `frontend/src/services/api`
- Produces:
  - Types `PromptAnalysisResponse`, `PromptOptimizationResponse`, `PromptPreset`
  - Functions `analyzePrompt(prompt: string)`, `optimizePrompt(prompt: string, preset?: string, model?: string)`
  - Function `calculatePromptClarity(prompt: string): { score: number; level: 'low' | 'medium' | 'high'; breakdown: any }`

- [ ] **Step 1: Add types in `frontend/src/types/index.ts`**

Define `PromptAnalysisResponse`, `PromptOptimizationResponse`, `PromptPreset`.

- [ ] **Step 2: Implement API client methods in `frontend/src/services/api.ts`**

Add `analyzePrompt` and `optimizePrompt`.

- [ ] **Step 3: Create `frontend/src/utils/promptAnalyzer.ts`**

Implement client-side instant scoring function for real-time input feedback with zero network delay.

- [ ] **Step 4: Verify with Oxlint & TypeScript compiler**

Run: `npx oxlint --deny-warnings src` and `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 5: Commit Task 2**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/utils/promptAnalyzer.ts
git commit -m "feat(prompt): add frontend prompt types, api methods and client-side analyzer"
```

---

### Task 3: PromptOptimizerModal Studio Component

**Files:**
- Create: `frontend/src/components/PromptOptimizerModal.tsx`

**Interfaces:**
- Consumes: `PromptAnalysisResponse`, `PromptOptimizationResponse` from types, `analyzePrompt`, `optimizePrompt` from `api`
- Produces: `<PromptOptimizerModal isOpen={boolean} onClose={() => void} initialPrompt={string} onApplyPrompt={(optimized: string) => void} activeModel?: string />`

- [ ] **Step 1: Build `PromptOptimizerModal.tsx`**

Implement:
- Modal shell (`role="dialog"`, `Escape` listener, animated backdrop).
- Top clarity bar with Score meter (0-100%) and 4 quality pill gauges (Context, Objective, Constraints, Format).
- Preset chips selector (`Général`, `Débogage`, `Plan`, `Refactoring`, `Revue de code`).
- Side-by-side or tabbed Before/After editor:
  - Left: Original raw prompt with word/token stats.
  - Right: AI-optimized meta-prompt with copy and apply buttons.
- Actions footer:
  - "Appliquer au chat" (`Check` icon, inserts directly into chat input and closes modal).
  - "Copier le prompt" (`Copy` icon).
  - "Fermer" (`X` icon).

- [ ] **Step 2: Verify with Oxlint & TypeScript compiler**

Run: `npx oxlint --deny-warnings src` and `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 3: Commit Task 3**

```bash
git add frontend/src/components/PromptOptimizerModal.tsx
git commit -m "feat(prompt): create PromptOptimizerModal studio component"
```

---

### Task 4: UI Integrations (ChatInput Wand Trigger, Slash Commands & Keyboard Shortcuts)

**Files:**
- Modify: `frontend/src/services/commands.ts`
- Modify: `frontend/src/components/ChatInput.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `PromptOptimizerModal`, `calculatePromptClarity`
- Produces:
  - Slash commands `/optimize` and `/metaprompt`
  - Wand button in `ChatInput` with clarity indicator dot/badge
  - Shortcut `Ctrl+Shift+O` inside chat textarea

- [ ] **Step 1: Register commands in `frontend/src/services/commands.ts`**

Add `/optimize` and `/metaprompt` with `Wand2` icon and description.

- [ ] **Step 2: Wire Wand button and shortcuts in `frontend/src/components/ChatInput.tsx`**

- Use `calculatePromptClarity(prompt)` to show subtle color dot on Wand button (amber if <40%, green if >75%).
- On click, open `isPromptOptimizerOpen`.
- Listen to `Ctrl+Shift+O` to open optimizer with current draft.
- Handle `/optimize` and `/metaprompt` execution.

- [ ] **Step 3: Wire modal in `frontend/src/App.tsx`**

- Lazy-load `PromptOptimizerModal`.
- Manage state and pass handler down to `ChatInput`.

- [ ] **Step 4: Verify with Oxlint & TypeScript compiler**

Run: `npx oxlint --deny-warnings src` and `npx tsc -b`
Expected: 0 warnings, 0 errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add frontend/src/services/commands.ts frontend/src/components/ChatInput.tsx frontend/src/App.tsx
git commit -m "feat(prompt): integrate prompt optimizer into chat input, slash commands and app"
```

---

### Task 5: Version Bump, Backend Tests & Live Browser Verification (v0.2.14)

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`

- [ ] **Step 1: Bump version to `0.2.14` across the 4 files**
- [ ] **Step 2: Build production frontend bundle (`npm run build`)**
- [ ] **Step 3: Run complete backend pytest suite (`pytest tests`)**
- [ ] **Step 4: Live verification via Chrome DevTools MCP on `http://localhost:8000/`**
  - Verify Wand button and clarity score pill in ChatInput.
  - Test `/optimize` command.
  - Test opening `PromptOptimizerModal`, switching presets (Debug, Plan, Refactor), and clicking "Appliquer au chat".
  - Capture verification screenshots.
- [ ] **Step 5: Git commit, tag `v0.2.14`, and push to `origin/main --tags`**
- [ ] **Step 6: Update `task.md`, `ROADMAP.md`, `walkthrough.md`**
