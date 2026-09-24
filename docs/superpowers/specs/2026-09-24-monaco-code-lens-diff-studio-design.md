# Monaco Code Lens & Semantic Diff Studio — Architecture & Design Spec

**Date :** 2026-09-24  
**Sprint :** 9 (v0.2.13) — Sous-projet A  
**Status :** Validated Design  

---

## 1. Executive Summary

This specification defines the architecture, user experience, and technical implementation of the **Monaco Code Lens & Semantic Diff Studio** in Antigravity WebUI.

The goal is to elevate Antigravity WebUI from a passive diff/code viewer into an interactive developer studio featuring:
1. **Semantic Side-by-Side & Inline Diffing:** Full character-level diff highlighting, synchronized scrolling, hunk navigation, and addition/deletion telemetry for Git working tree changes and historical commit patches.
2. **In-App Code Editor & Scratchpad:** Full-featured Monaco editor with multi-cursor support, syntax highlighting for 60+ programming languages, code folding, minimap, search/replace, and direct file persistence to disk.
3. **Integrated Code Lens Action Bar:** Quick-action lens embedded directly above the editor for immediate execution (Node, Python, Bash), AI explanation ("Expliquer avec Antigravity"), formatting, and copying.

---

## 2. Technical Stack & Bundle Optimization

### 2.1 Dependencies
- **Engine:** `@monaco-editor/react` (configured with React 19).
- **Icons:** `lucide-react`.
- **CSS / Themes:** Vanilla CSS variables synced with the Antigravity design system (`vs-dark`, `light`, and custom accent variables).

### 2.2 Bundle Isolation & Lazy Loading Strategy
Monaco Editor contains substantial language worker and syntax grammar definitions. To prevent bundle bloat or slowing down initial cold starts:
1. The component `MonacoStudioModal` is dynamically loaded via `React.lazy()`:
   ```tsx
   const MonacoStudioModal = React.lazy(() =>
     import('./components/MonacoStudioModal').then((m) => ({ default: m.MonacoStudioModal }))
   );
   ```
2. Vite configuration (`vite.config.ts`) isolates Monaco dependencies into a dedicated chunk:
   ```ts
   manualChunks: {
     monaco: ['@monaco-editor/react']
   }
   ```
3. A sleek loading spinner with Antigravity branding is displayed during the initial on-demand chunk download.

---

## 3. UI/UX Component Specifications

### 3.1 Component: `MonacoStudioModal.tsx`
A glassmorphic, responsive, fullscreen-capable modal dialogue offering two operational modes:
- **Editor Mode (`mode = 'editor'`):**
  - Live scratchpad or file editor.
  - Line numbers, minimap, word wrap toggle, indentation controls (2 vs 4 spaces).
  - Language selector dropdown with auto-detection from file extension.
  - Save status indicator (Saved, Modified, Saving...).
  - Keyboard shortcuts: <kbd>Ctrl+S</kbd> / <kbd>Cmd+S</kbd> to save, <kbd>Escape</kbd> to close.
- **Diff Mode (`mode = 'diff'`):**
  - Side-by-side (split view) vs unified (inline) toggle.
  - Character-level change highlights with additions/deletions counter.
  - Synchronized vertical and horizontal scrolling.
  - Original and modified labels with revision badges (e.g., `HEAD` vs `Working Tree`).

### 3.2 Code Lens Action Bar
Positioned seamlessly above the code viewport:
- **`⚡ Exécuter` (Play):** Available for executable languages (Python, Bash, JavaScript, Shell). Sends code to background runner and outputs result.
- **`💡 Expliquer avec Antigravity` (BrainCircuit):** Sends the highlighted code or entire file to the active conversation with a structured prompt requesting review, bug detection, and optimization recommendations.
- **`💾 Enregistrer` (Save):** Active when editing a workspace file. Persists modifications directly to disk via `PUT /api/files/content`.
- **`📋 Copier` (Copy):** Copies current file or patch content to the system clipboard with feedback animation.

---

## 4. Backend Endpoints & Git Services

### 4.1 New Endpoint: `GET /api/git/file-versions`
- **Path:** `/api/git/file-versions`
- **Parameters:**
  - `path: str` (relative file path within workspace)
  - `workspace: str | None` (optional workspace path)
  - `commit: str | None` (optional commit SHA, defaults to `HEAD`)
  - `staged: bool = False` (whether to compare staged vs HEAD)
- **Response Schema:**
  ```json
  {
    "workspace": "C:/laragon/www/antigravity-webui",
    "path": "frontend/src/App.tsx",
    "filename": "App.tsx",
    "original": "...",
    "modified": "...",
    "is_new": false,
    "is_deleted": false
  }
  ```
- **Behavior:**
  - `original` is extracted using `git show <commit>:<path>`. If the file was untracked/new, `original` is an empty string.
  - `modified` is read directly from disk or extracted from the specified commit.
  - Masking is applied to prevent credential leaks.

### 4.2 File Persistence: `PUT /api/files/content`
Existing endpoint validated against workspace path safety constraints (`is_safe_path`), writing UTF-8 encoded files atomically.

---

## 5. Application Integration Points

1. **`GitTab.tsx`:**
   - Adds an "Ouvrir dans Monaco Studio" action button in the diff viewer toolbar for both unstaged/staged file diffs and historical commit diffs.
2. **`AdaptiveCodeBlock.tsx`:**
   - Adds an "Éditer dans Studio" action icon to code block headers, allowing instant scratchpad experimentation with generated code.
3. **`WorkspacePanel.tsx` & `FileExplorerModal.tsx`:**
   - Adds a "Modifier dans l'éditeur" button in file context menus.
4. **`ChatInput.tsx` & `commands.ts`:**
   - Registers `/editor`, `/studio`, and `/diff` slash commands.
5. **`ChatCanvas.tsx`:**
   - Adds an "Éditeur" toolbar icon in the header for 1-click access.

---

## 6. Error Handling & Edge Cases

1. **Large Files:** Files > 2 MB display a warning banner advising that performance may degrade, with an option to load raw text.
2. **Binary Files:** Images, audio, and compiled binaries are detected and rejected from text editing with a friendly message.
3. **Concurrent Edits:** If the file was modified on disk since it was loaded in Monaco, a prompt warns the user before overwriting.
4. **Network / Offline Fallback:** If Monaco chunks fail to load, graceful fallback to standard textarea/diff reader.

---

## 7. Verification & Acceptance Criteria

- **Zero Linter Warnings:** `npx oxlint --deny-warnings src` reports 0 errors and 0 warnings.
- **Strict Typing:** `npx tsc -b` succeeds without any type errors.
- **Production Build:** `npm run build` succeeds, generating a clean `monaco` chunk.
- **Automated Backend Tests:** Pytest test suite and FastAPI `TestClient` suite pass 100%.
- **Live UI Verification:** Chrome DevTools MCP validates opening editor, editing text, saving to disk, switching between side-by-side and inline diffs, and triggering `/editor`.
