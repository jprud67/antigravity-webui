# Monaco Extended Diagnostics & Live Linting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement real-time syntax checking and live linting in Monaco Editor powered by Python (`ruff` + AST), JS/TS (`oxlint`), and JSON diagnostics, complete with Monaco model markers, status bar badges, and an interactive Problems Drawer.

**Architecture:** A FastAPI endpoint `POST /api/editor/diagnostics` executes ultra-fast non-blocking analysis (Python AST + `ruff --output-format=json`, `oxlint --format json`, JSON parse) and returns normalized `DiagnosticItem` objects. Frontend debounces editor changes by 400ms, renders native Monaco squigglies (`setModelMarkers`), shows error/warning counts in the status bar, and provides a collapsible Problems Drawer with 1-click line navigation.

**Tech Stack:** Python 3.13, FastAPI, ruff 0.16.8, oxlint 1.82.0, React 19, TypeScript, Monaco Editor (`@monaco-editor/react`), Tailwind CSS, Lucide icons.

**Spec:** `docs/superpowers/specs/2026-09-26-monaco-extended-diagnostics-design.md`

## Global Constraints

- Never block Monaco typing or UI rendering; all lint executions must be debounced (400ms) and asynchronous.
- Strict 15-language key parity in `frontend/public/locales.json` with 0 missing translations.
- All backend tests in `backend/tests` must pass with 100% success.
- Frontend must pass `tsc -b` with 0 errors and bundle cleanly via `npm run build`.
- Release tag `v0.3.4` must be created and pushed along with commits to `origin/main`.

---

### Task 1: Backend Diagnostics Engine & FastAPI Endpoint

**Files:**
- Create: `backend/app/api/editor_diagnostics.py`
- Modify: `backend/app/main.py`
- Test: `backend/tests/test_editor_diagnostics.py`

**Interfaces:**
- Produces: `POST /api/editor/diagnostics` accepting `EditorDiagnosticsRequest(content, filePath, language, workspace)` and returning `EditorDiagnosticsResponse(diagnostics, duration_ms, total_errors, total_warnings, total_infos)`.
- Diagnostic Item Schema:
  ```python
  class DiagnosticItem(BaseModel):
      line: int
      column: int
      endLine: int
      endColumn: int
      message: str
      severity: str  # 'error' | 'warning' | 'info'
      source: str    # 'ruff' | 'oxlint' | 'syntax' | 'json'
      code: Optional[str] = None
  ```

- [x] **Step 1: Write the failing tests**

```python
# backend/tests/test_editor_diagnostics.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def get_auth_headers():
    res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}

def test_diagnostics_auth_guard():
    res = client.post("/api/editor/diagnostics", json={"content": "x = 1", "language": "python"})
    assert res.status_code in (401, 403)

def test_python_clean_code():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "def add(a: int, b: int) -> int:\n    return a + b\n",
        "language": "python"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] == 0

def test_python_syntax_error():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "def broken(\n    return 42\n",
        "language": "python"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] >= 1
    diag = data["diagnostics"][0]
    assert diag["severity"] == "error"
    assert diag["source"] == "syntax"

def test_json_syntax_error():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "{\n  \"key\": \"value\",\n}",
        "language": "json"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] >= 1
    assert data["diagnostics"][0]["source"] == "json"
```

- [x] **Step 2: Run test to verify it fails**

Run: `backend\venv\Scripts\pytest.exe backend\tests\test_editor_diagnostics.py -v`
Expected: FAIL with 404 Not Found (endpoint not registered)

- [x] **Step 3: Implement `backend/app/api/editor_diagnostics.py` and register router in `main.py`**

- Handle Python AST syntax checking.
- Call `backend\venv\Scripts\ruff.exe check --output-format=json --stdin-filename <filename>` via stdin.
- Call `oxlint --format json` on JS/TS/JSX/TSX.
- Handle JSON parsing with `json.loads`.
- Register router with `/api/editor` prefix in `backend/app/main.py`.

- [x] **Step 4: Run tests to verify they pass**

Run: `backend\venv\Scripts\pytest.exe backend\tests\test_editor_diagnostics.py -v`
Expected: PASS

- [x] **Step 5: Commit backend endpoint**

```bash
git add backend/app/api/editor_diagnostics.py backend/app/main.py backend/tests/test_editor_diagnostics.py
git commit -m "feat(diagnostics): implement real-time AST, ruff, oxlint and JSON diagnostics endpoint"
```

---

### Task 2: Frontend Diagnostics Service & Types

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/services/api.ts`
- Create: `frontend/src/services/monacoDiagnostics.ts`

**Interfaces:**
- `DiagnosticItem` interface matching backend.
- `fetchEditorDiagnostics(content, filePath, language, workspace)` function in `api.ts`.
- `applyMonacoDiagnostics(monaco, model, diagnostics)` and `clearMonacoDiagnostics(monaco, model)` helpers in `monacoDiagnostics.ts`.

- [x] **Step 1: Update `frontend/src/types.ts` with diagnostic models**

```typescript
export interface DiagnosticItem {
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  message: string;
  severity: 'error' | 'warning' | 'info';
  source: 'ruff' | 'oxlint' | 'syntax' | 'json';
  code?: string;
}

export interface EditorDiagnosticsResponse {
  diagnostics: DiagnosticItem[];
  duration_ms: number;
  total_errors: number;
  total_warnings: number;
  total_infos: number;
}
```

- [x] **Step 2: Add `fetchEditorDiagnostics` to `frontend/src/services/api.ts`**

- [x] **Step 3: Create `frontend/src/services/monacoDiagnostics.ts`**

- Implements `applyMonacoDiagnostics(monaco, model, diagnostics, owner = 'antigravity-lint')`.
- Maps severity to `monaco.MarkerSeverity.Error | Warning | Info`.
- Implements `clearMonacoDiagnostics(monaco, model, owner)`.

- [x] **Step 4: Verify TypeScript compilation**

Run: `npx --prefix frontend tsc -b`
Expected: PASS with 0 errors.

- [x] **Step 5: Commit frontend types & service**

```bash
git add frontend/src/types.ts frontend/src/services/api.ts frontend/src/services/monacoDiagnostics.ts
git commit -m "feat(diagnostics): add frontend diagnostics types, API client, and Monaco marker manager"
```

---

### Task 3: Full 15-Language i18n Key Parity

**Files:**
- Modify: `frontend/public/locales.json`

**Keys:**
- `editor_diagnostics_problems`: "Problèmes" / "Problems"
- `editor_diagnostics_no_problems`: "Aucun problème détecté" / "No problems detected"
- `editor_diagnostics_linting`: "Analyse en cours..." / "Analyzing..."
- `editor_diagnostics_error`: "Erreur" / "Error"
- `editor_diagnostics_warning`: "Avertissement" / "Warning"
- `editor_diagnostics_info`: "Info" / "Info"
- `editor_diagnostics_toggle_drawer`: "Afficher/Masquer le panneau des problèmes" / "Toggle Problems panel"
- `editor_diagnostics_auto_lint`: "Lint automatique" / "Auto-lint"
- `editor_diagnostics_refresh`: "Actualiser les diagnostics" / "Refresh diagnostics"

- [x] **Step 1: Write python injection script and run it**
- [x] **Step 2: Verify 15-language key count parity**
- [x] **Step 3: Commit i18n updates**

```bash
git add frontend/public/locales.json
git commit -m "feat(i18n): add 15-language parity for Monaco diagnostics and problems drawer"
```

---

### Task 4: Monaco Studio Modal Diagnostics Integration & Problems Drawer

**Files:**
- Modify: `frontend/src/components/MonacoStudioModal.tsx`

**Features:**
- Add debounced diagnostics trigger (400ms) on content change.
- Status bar problems badge showing `❌ {errors} ⚠️ {warnings}` with pulsing dot when linting.
- Collapsible bottom Problems Drawer with problem list sorted by line.
- Click problem -> calls `editor.revealPositionInCenter({ lineNumber, column })` and `editor.setPosition({ lineNumber, column })`.
- Auto-lint toggle & refresh button in status bar / drawer header.

- [x] **Step 1: Integrate diagnostic state and debounced hook in `MonacoStudioModal.tsx`**
- [x] **Step 2: Render status bar problem counter and toggleable Problems Drawer**
- [x] **Step 3: Test click-to-line navigation and Monaco marker updates**
- [x] **Step 4: Verify with `tsc -b` and `npm run build`**
- [x] **Step 5: Commit MonacoStudioModal changes**

```bash
git add frontend/src/components/MonacoStudioModal.tsx
git commit -m "feat(studio): integrate live diagnostics, markers, and Problems Drawer into MonacoStudioModal"
```

---

### Task 5: WorkspacePanel Embedded Monaco Editor Diagnostics Integration

**Files:**
- Modify: `frontend/src/components/WorkspacePanel.tsx`

**Features:**
- Add debounced diagnostics trigger for active workspace file.
- Status bar problems badge in WorkspacePanel status bar.
- Jump to problem line when problem badge or drawer item is selected.
- Synchronized Monaco markers for active open tab.

- [x] **Step 1: Integrate diagnostics in `WorkspacePanel.tsx`**
- [x] **Step 2: Verify `tsc -b` and production bundle**
- [x] **Step 3: Commit WorkspacePanel changes**

```bash
git add frontend/src/components/WorkspacePanel.tsx
git commit -m "feat(workspace): integrate live diagnostics and problem counter into WorkspacePanel editor"
```

---

### Task 6: Verification, Roadmap Documentation & Git Release Tag `v0.3.4`

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `frontend/package.json`, `backend/app/main.py`, `backend/app/services/updater.py`, `frontend/public/sw.js` (bump version to `0.3.4`)

- [x] **Step 1: Run full pytest backend test suite**
- [x] **Step 2: Run frontend production build**
- [x] **Step 3: Update `docs/ROADMAP.md` to document Jalon v0.3.4 as completed**
- [x] **Step 4: Commit changes and create annotated tag `v0.3.4`**
- [x] **Step 5: Push commit and tag `v0.3.4` to `origin/main`**
