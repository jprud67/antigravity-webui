# Monaco Code Lens & Semantic Diff Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a high-fidelity Monaco Editor and Semantic Diff Studio with Code Lens actions, split/inline diffing, file persistence, and full integration into Antigravity WebUI.

**Architecture:** Add `@monaco-editor/react` as an on-demand code-split chunk in Vite, backed by a new FastAPI endpoint `GET /api/git/file-versions` for side-by-side diff extraction. Create `MonacoStudioModal.tsx` offering both single editor mode and split diff mode, wired into `GitTab`, `AdaptiveCodeBlock`, `ChatCanvas`, and `/editor` slash commands.

**Tech Stack:** React 19, TypeScript, `@monaco-editor/react`, Tailwind CSS / CSS variables, FastAPI, Git CLI, Vite 8.

**Spec:** [`docs/superpowers/specs/2026-09-24-monaco-code-lens-diff-studio-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-24-monaco-code-lens-diff-studio-design.md)

## Global Constraints
- Target semantic release version is bounded to `v0.*.*`.
- Strict zero warnings and zero errors across `npx oxlint --deny-warnings src` and `tsc -b`.
- Production bundle must isolate Monaco into an asynchronous chunk to prevent initial cold start regression.
- Atomic file saves using existing `PUT /api/files/content` with path safety validation (`is_safe_path`).

---

### Task 1: Backend Endpoint `GET /api/git/file-versions`

**Files:**
- Create: `backend/tests/test_git_file_versions.py`
- Modify: `backend/app/api/git.py:406-440`

**Interfaces:**
- Consumes: `_validate_workspace`, `run_git`, `_mask_git_output`, `_resolve_relative_git_path`.
- Produces: `GET /api/git/file-versions` returning `{ workspace: str, path: str, filename: str, original: str, modified: str, is_new: bool, is_deleted: bool, staged: bool }`.

- [ ] **Step 1: Write the failing unit test**

Create `backend/tests/test_git_file_versions.py`:
```python
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_git_file_versions_unauthenticated():
    response = client.get("/api/git/file-versions?path=backend/app/main.py")
    assert response.status_code in (401, 403)

def test_git_file_versions_authenticated():
    # Login to obtain auth cookie/header
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    res = client.get("/api/git/file-versions?path=backend/app/main.py", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "original" in data
    assert "modified" in data
    assert data["path"] == "backend/app/main.py"
    assert data["filename"] == "main.py"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_git_file_versions.py -v`  
Expected: FAIL with 404 (endpoint not defined).

- [ ] **Step 3: Implement `GET /api/git/file-versions` in `backend/app/api/git.py`**

Add endpoint in `backend/app/api/git.py`:
```python
@router.get("/file-versions")
def get_git_file_versions(
    path: str = Query(..., description="Chemin relatif du fichier"),
    workspace: str | None = Query(None),
    commit: str | None = Query(None, description="Commit SHA ou HEAD"),
    staged: bool = Query(False, description="Comparer le staged vs HEAD"),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    norm_path = _resolve_relative_git_path(path, target)

    # 1. Determine original content (from git revision)
    git_rev = commit if commit else "HEAD"
    original_text = ""
    is_new = False
    is_deleted = False

    # Check if file exists at revision
    show_target = f"{git_rev}:{norm_path}"
    res_show = run_git(["show", show_target], target)
    if res_show.returncode == 0:
        original_text = res_show.stdout
    else:
        # File did not exist at revision
        is_new = True

    # 2. Determine modified content
    modified_text = ""
    if commit and not staged:
        # If inspecting historical commit, modified is that commit's version
        res_mod = run_git(["show", f"{commit}:{norm_path}"], target)
        if res_mod.returncode == 0:
            modified_text = res_mod.stdout
        else:
            is_deleted = True
    elif staged:
        # Read from git index (staged)
        res_staged = run_git(["show", f":{norm_path}"], target)
        if res_staged.returncode == 0:
            modified_text = res_staged.stdout
        else:
            is_deleted = True
    else:
        # Read current working tree file from disk
        file_disk = target / norm_path
        if file_disk.exists() and file_disk.is_file():
            try:
                modified_text = file_disk.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                logger.error(f"Error reading {file_disk}: {e}")
                modified_text = ""
        else:
            is_deleted = True

    filename = Path(norm_path).name
    return {
        "workspace": str(target.resolve()),
        "path": norm_path,
        "filename": filename,
        "original": _mask_git_output(original_text),
        "modified": _mask_git_output(modified_text),
        "is_new": is_new,
        "is_deleted": is_deleted,
        "staged": staged,
        "commit": commit
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_git_file_versions.py -v`  
Expected: PASS with 2 tests passing.

- [ ] **Step 5: Commit backend changes**

```bash
git add backend/app/api/git.py backend/tests/test_git_file_versions.py
git commit -m "feat(api): add GET /api/git/file-versions endpoint for side-by-side diffs"
```

---

### Task 2: Frontend Dependency Setup & Vite Chunking

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.ts`

**Interfaces:**
- Consumes: `@monaco-editor/react` package.
- Produces: `monaco` manualChunk in `vite.config.ts`.

- [ ] **Step 1: Install `@monaco-editor/react`**

Run: `npm install @monaco-editor/react --save` in `frontend/`.

- [ ] **Step 2: Configure Rollup manualChunks in `frontend/vite.config.ts`**

Update `frontend/vite.config.ts` to include `@monaco-editor/react` in its own manual chunk:
```ts
manualChunks: {
  vendor: ['react', 'react-dom'],
  xterm: ['@xterm/xterm', '@xterm/addon-fit'],
  prism: ['prismjs'],
  mermaid: ['mermaid'],
  monaco: ['@monaco-editor/react']
}
```

- [ ] **Step 3: Verify build compiles and chunk is emitted**

Run: `npm run build` in `frontend/`.  
Expected: Output includes `dist/assets/monaco-*.js`.

- [ ] **Step 4: Commit build configuration**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.ts
git commit -m "build(frontend): add @monaco-editor/react with isolated manualChunk"
```

---

### Task 3: Frontend API Client & Types

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Consumes: `GET /api/git/file-versions`.
- Produces: `GitFileVersionsResponse`, `fetchGitFileVersions()`.

- [ ] **Step 1: Add types in `frontend/src/types/index.ts`**

```ts
export interface GitFileVersionsResponse {
  workspace: string;
  path: string;
  filename: string;
  original: string;
  modified: string;
  is_new: boolean;
  is_deleted: boolean;
  staged: boolean;
  commit?: string;
}

export interface MonacoStudioConfig {
  mode: 'editor' | 'diff';
  title?: string;
  filePath?: string;
  language?: string;
  content?: string;
  originalContent?: string;
  modifiedContent?: string;
  diffText?: string;
  readOnly?: boolean;
}
```

- [ ] **Step 2: Add API function in `frontend/src/services/api.ts`**

```ts
export async function fetchGitFileVersions(
  workspace?: string,
  filePath?: string,
  commit?: string,
  staged?: boolean
): Promise<GitFileVersionsResponse> {
  const params = new URLSearchParams();
  if (filePath) params.set('path', filePath);
  if (workspace) params.set('workspace', workspace);
  if (commit) params.set('commit', commit);
  if (staged) params.set('staged', 'true');

  const res = await authFetch(`/api/git/file-versions?${params.toString()}`);
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Impossible de récupérer les versions du fichier');
  }
  return res.json();
}
```

- [ ] **Step 3: Run linter and typecheck**

Run: `npx oxlint --deny-warnings src && npx tsc -b` in `frontend/`.  
Expected: 0 errors, 0 warnings.

- [ ] **Step 4: Commit type and API changes**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(frontend): add GitFileVersionsResponse and fetchGitFileVersions API client"
```

---

### Task 4: Implement `MonacoStudioModal.tsx`

**Files:**
- Create: `frontend/src/components/MonacoStudioModal.tsx`

**Interfaces:**
- Consumes: `@monaco-editor/react`, `saveFileContent`, `fetchGitFileVersions`, `showToast`, `useI18n`.
- Produces: `MonacoStudioModal` component with Editor, DiffEditor, Code Lens toolbar, and keyboard shortcuts.

- [ ] **Step 1: Write `MonacoStudioModal.tsx`**

Create `frontend/src/components/MonacoStudioModal.tsx` with:
- Top bar: filename badge, language selector (JS, TS, Python, CSS, HTML, JSON, Markdown, YAML, Diff, Bash, SQL, C++), Mode switch (`Éditeur` vs `Diff Sémantique`), Split View toggle (`Côte-à-côte` vs `Unifié`), Close button (<kbd>Échap</kbd>).
- Code Lens action bar:
  - `⚡ Exécuter` (plays code if python/bash/js)
  - `💡 Expliquer avec Antigravity` (triggers `onExplainCode` callback)
  - `💾 Enregistrer` (<kbd>Ctrl+S</kbd> / <kbd>Cmd+S</kbd>, calls `saveFileContent`)
  - `📋 Copier` (copies content to clipboard)
- Editor rendering: `<Editor value={content} language={lang} theme={monacoTheme} options={{ minimap: { enabled: true }, lineNumbers: 'on', wordWrap: 'on' }} />`
- Diff rendering: `<DiffEditor original={original} modified={modified} language={lang} theme={monacoTheme} options={{ renderSideBySide: isSplitView }} />`
- Dynamic theme synchronisation listening to `window.addEventListener('antigravity-appearance-change')`.

- [ ] **Step 2: Run linter and typecheck**

Run: `npx oxlint --deny-warnings src && npx tsc -b` in `frontend/`.  
Expected: 0 errors, 0 warnings.

- [ ] **Step 3: Commit `MonacoStudioModal.tsx`**

```bash
git add frontend/src/components/MonacoStudioModal.tsx
git commit -m "feat(frontend): create MonacoStudioModal component with Editor, Diff, and Code Lens"
```

---

### Task 5: Integration into App, GitTab, CodeBlocks, and Slash Commands

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/GitTab.tsx`
- Modify: `frontend/src/components/AdaptiveCodeBlock.tsx`
- Modify: `frontend/src/components/ChatCanvas.tsx`
- Modify: `frontend/src/components/ChatInput.tsx`
- Modify: `frontend/src/services/commands.ts`

**Interfaces:**
- Consumes: `MonacoStudioModal`, `MonacoStudioConfig`.
- Produces: Seamless modal opening from Git diffs, Code blocks, toolbar buttons, and `/editor` command.

- [ ] **Step 1: Wire modal state and handlers in `frontend/src/App.tsx`**

Add `monacoStudioConfig: MonacoStudioConfig | null` state, `handleOpenMonacoStudio(config)`, and render `MonacoStudioModal` with `React.lazy` and `Suspense`.

- [ ] **Step 2: Add "Ouvrir dans Monaco Studio" in `frontend/src/components/GitTab.tsx`**

Add button in diff header calling `onOpenMonacoStudio` with `filePath`, `workspace`, `commit`, and `staged` props.

- [ ] **Step 3: Add "Éditer dans Studio" in `frontend/src/components/AdaptiveCodeBlock.tsx`**

Add action button in code block header opening the snippet directly in Monaco scratchpad.

- [ ] **Step 4: Register `/editor`, `/studio`, `/diff` slash commands**

Register in `frontend/src/services/commands.ts` and dispatch trigger in `frontend/src/components/ChatInput.tsx`.

- [ ] **Step 5: Run linter and typecheck**

Run: `npx oxlint --deny-warnings src && npx tsc -b` in `frontend/`.  
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Build production bundle**

Run: `npm run build` in `frontend/`.  
Expected: Success with `monaco` chunk generated in `dist/assets/`.

- [ ] **Step 7: Commit integration changes**

```bash
git add frontend/src/App.tsx frontend/src/components/GitTab.tsx frontend/src/components/AdaptiveCodeBlock.tsx frontend/src/components/ChatCanvas.tsx frontend/src/components/ChatInput.tsx frontend/src/services/commands.ts
git commit -m "feat(frontend): wire Monaco Studio into GitTab, AdaptiveCodeBlock, and slash commands"
```

---

### Task 6: End-to-End Live UI Verification & Release

**Files:**
- Modify: `frontend/package.json`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/public/sw.js`

- [ ] **Step 1: Bump version to `0.2.13`**

Update `package.json`, `main.py`, `updater.py`, and `sw.js` to `0.2.13`.

- [ ] **Step 2: Run all backend tests**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests`  
Expected: 39 passed, 0 failed.

- [ ] **Step 3: Live UI verification via Chrome DevTools MCP**

- Open `http://localhost:8000/`.
- Open Git tab, select a file, click "Ouvrir dans Monaco Studio", verify side-by-side diff editor.
- Open chat, run `/editor`, verify Monaco scratchpad with Code Lens action bar, type code, press <kbd>Ctrl+S</kbd> to save.
- Take snapshots and screenshots.

- [ ] **Step 4: Final commit, tag, and push**

```bash
git add .
git commit -m "feat(v0.2.13): monaco code lens and semantic diff studio"
git tag v0.2.13
git push origin main --tags
```
