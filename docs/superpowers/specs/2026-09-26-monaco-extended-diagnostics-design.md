# Design Spec: Monaco Extended Diagnostics & Live Linting

**Author**: Antigravity Assistant & User  
**Date**: 2026-09-26  
**Status**: Approved (Brainstorming Complete)  
**Milestone**: Jalon v0.3.4 (Roadmap v0.4)  

---

## 1. Executive Summary

Antigravity WebUI provides a complete Monaco Editor environment for editing files, browsing workspace code, and reviewing diffs. However, syntax errors and linting issues are currently only surfaced when tests or terminal commands are run manually.

This specification defines the **Monaco Extended Diagnostics & Live Linting** subsystem. It delivers real-time, non-blocking code inspection for Python (`ruff` + AST), JavaScript/TypeScript (`oxlint`), and JSON. It renders standard Monaco squiggly underlines (`monaco.editor.setModelMarkers`), updates a status bar problem counter (`❌ Errors / ⚠️ Warnings`), and provides a collapsible Problems Drawer with 1-click navigation to problem locations.

---

## 2. Architecture & Components

```
┌─────────────────────────────────────────────────────────────┐
│                       Frontend                              │
│                                                             │
│  Monaco Editor (WorkspacePanel.tsx / MonacoStudioModal.tsx) │
│       │                                                     │
│       ├─ Debounced Change Listener (400ms)                  │
│       │       │                                             │
│       │       ▼                                             │
│       │  fetchEditorDiagnostics(content, filePath, lang)    │
│       │       │                                             │
│       ▼       ▼                                             │
│  monaco.editor.setModelMarkers(model, 'antigravity-lint')   │
│       │                                                     │
│       ├─ Native Gutter & Squiggly Highlights                │
│       ├─ Status Bar Problem Badges (Errors / Warnings)      │
│       └─ Collapsible Problems Drawer (Click -> Jump to Line)│
└───────────────────────┬─────────────────────────────────────┘
                        │ POST /api/editor/diagnostics
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                       Backend                               │
│                                                             │
│  FastAPI Router: backend/app/api/editor_diagnostics.py      │
│       │                                                     │
│       ├─ Language Dispatcher (Python, JS/TS, JSON)          │
│       ├─ Python Engine:                                     │
│       │    1. ast.parse() (zero-latency syntax errors)      │
│       │    2. ruff check --output-format=json (stdin/file)  │
│       ├─ JS/TS Engine:                                      │
│       │    oxlint --format json (stdin/temp)                │
│       └─ JSON Engine:                                       │
│            json.loads() syntax parsing with line/col offset │
│                                                             │
│  Unified Response Schema: List[DiagnosticItem]              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data Contracts & Interfaces

### 3.1 Backend Request / Response Schema

**Endpoint**: `POST /api/editor/diagnostics`

**Request Body (`EditorDiagnosticsRequest`)**:
```python
class EditorDiagnosticsRequest(BaseModel):
    content: str
    filePath: Optional[str] = None
    language: str  # 'python', 'javascript', 'typescript', 'typescriptreact', 'json'
    workspace: Optional[str] = None
```

**Diagnostic Item Schema (`DiagnosticItem`)**:
```python
class DiagnosticItem(BaseModel):
    line: int              # 1-indexed start line
    column: int            # 1-indexed start column
    endLine: int           # 1-indexed end line
    endColumn: int         # 1-indexed end column
    message: str           # Human-readable message
    severity: str          # 'error' | 'warning' | 'info'
    source: str            # 'ruff' | 'oxlint' | 'syntax' | 'json'
    code: Optional[str]    # Rule code (e.g., 'E501', 'F401', 'no-unused-vars')
```

**Response Body (`EditorDiagnosticsResponse`)**:
```python
class EditorDiagnosticsResponse(BaseModel):
    diagnostics: List[DiagnosticItem]
    duration_ms: float
    total_errors: int
    total_warnings: int
    total_infos: int
```

---

## 4. Execution Engines

### 4.1 Python Diagnostics
1. **Syntax Check**: Run `ast.parse(content, filename=filePath or '<editor>')`.
   - If `SyntaxError` raised: immediately capture `lineno`, `offset`, and exception `msg` as an `error`.
2. **Ruff Linter**:
   - Execute `ruff check --output-format=json --stdin-filename <filePath>` passing content via `stdin`.
   - Parse JSON output:
     - `message`, `code`, `location.row`, `location.column`, `end_location.row`, `end_location.column`.
     - Severity mapping: errors vs warnings based on rule prefix.

### 4.2 JavaScript / TypeScript Diagnostics
1. **Oxlint**:
   - Run `oxlint --format json` on a temporary file or workspace context.
   - Parse JSON diagnostics array into unified `DiagnosticItem` objects.
   - Fallback if oxlint binary unavailable: basic balanced bracket/brace syntax verification.

### 4.3 JSON Diagnostics
1. **JSON Parser**:
   - `json.loads(content)`.
   - On `json.JSONDecodeError`: capture `lineno`, `colno`, and error message.

---

## 5. Frontend Monaco Integration

1. **Debounced Linting Hook (`useMonacoDiagnostics`)**:
   - Debounce interval: 400ms after last content edit.
   - Cancels pending requests when user continues typing.
2. **Monaco Markers Mapping**:
   ```typescript
   const severityMap = {
     error: monaco.MarkerSeverity.Error,
     warning: monaco.MarkerSeverity.Warning,
     info: monaco.MarkerSeverity.Info,
   };
   monaco.editor.setModelMarkers(model, 'antigravity-lint', markers);
   ```
3. **Status Bar Problem Badge**:
   - Renders in the editor bottom status bar:
     - `[ ❌ {totalErrors}  ⚠️ {totalWarnings} ]`
   - Click opens or closes the Problems Drawer.
4. **Collapsible Problems Drawer**:
   - Renders at the bottom of the editor container with adjustable or compact height.
   - Lists problems sorted by line number.
   - Shows badge with rule code and source (`ruff:F401`, `oxlint:no-unused-vars`).
   - Clicking an item centers and highlights the position in the Monaco model:
     `editor.revealPositionInCenter({ lineNumber, column }); editor.setPosition({ lineNumber, column });`

---

## 6. Internationalization (i18n)

All user-facing strings must have entries in `frontend/public/locales.json` across all 15 supported languages:
- `editor_diagnostics_problems`: "Problèmes" / "Problems"
- `editor_diagnostics_no_problems`: "Aucun problème détecté" / "No problems detected"
- `editor_diagnostics_linting`: "Analyse en cours..." / "Analyzing..."
- `editor_diagnostics_error`: "Erreur" / "Error"
- `editor_diagnostics_warning`: "Avertissement" / "Warning"
- `editor_diagnostics_info`: "Info" / "Info"
- `editor_diagnostics_toggle_drawer`: "Afficher/Masquer le panneau des problèmes" / "Toggle Problems panel"
- `editor_diagnostics_clear`: "Effacer les diagnostics" / "Clear diagnostics"

---

## 7. Testing & Quality Assurance

1. **Backend Tests (`backend/tests/test_editor_diagnostics.py`)**:
   - Python valid code returns 0 errors.
   - Python syntax error returns correct line and error message.
   - Python unused import returns `ruff` warning (`F401`).
   - JSON syntax error returns correct line and column.
   - Security: prevents path traversal and handles empty content gracefully.
2. **Frontend Build & Typings**:
   - `tsc -b` must exit with 0 errors.
   - `npm run build` must complete cleanly.
3. **Regression Tests**:
   - All existing pytest test suite must pass without regressions.
