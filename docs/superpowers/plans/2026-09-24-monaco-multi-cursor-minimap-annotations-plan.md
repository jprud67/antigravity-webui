# Monaco Multi-Cursor & Minimap Annotations Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter l'édition multi-curseurs complète avec raccourcis VS Code étendus (`Ctrl+D`, `Alt+Clic`, `Ctrl+Shift+L`, `Ctrl+Alt+Flèches`) et la heatmap Git dynamique dans le gutter, la minimap et l'overview ruler pour `MonacoStudioModal` et `WorkspacePanel`.

**Architecture:** Un endpoint backend Python `GET /api/git/file-diff-ranges` exécute `git diff -U0 HEAD` et renvoie des tranches compactes d'ajouts, modifications et suppressions. Côté frontend, un service modulaire `monacoAnnotations.ts` centralise la configuration multi-curseurs, la gestion des collections de décorations Monaco à 60 FPS, et la navigation clavier entre changements (`F7` / `Shift+F7`).

**Tech Stack:** Python 3.13, FastAPI, Git CLI, TypeScript, React 19, Monaco Editor (`@monaco-editor/react`), Lucide React, Tailwind CSS / Vanilla CSS.

**Spec:** [`docs/superpowers/specs/2026-09-24-monaco-multi-cursor-minimap-annotations-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-24-monaco-multi-cursor-minimap-annotations-design.md)

## Global Constraints
- Commit author strict : `jprud67 <jprud67@gmail.com>` avec aucun trailer `Co-Authored-By`.
- 0 warning, 0 error sur Oxlint et TypeScript (`tsc -b`).
- 100% de réussite sur la suite backend pytest.
- Éviter toute fuite mémoire Monaco : recycler les `decorationsCollection` à chaque changement de fichier ou de modèle.

---

### Task 1: Backend Endpoint `GET /api/git/file-diff-ranges` & Tests TDD

**Files:**
- Create: `backend/tests/test_git_diff_ranges.py`
- Modify: `backend/app/api/git.py`

**Interfaces:**
- Consumes: `_validate_path_access(file_path)` from `backend/app/api/files.py` or `backend/app/api/git.py`
- Produces: `GET /api/git/file-diff-ranges` returning `GitDiffRangesResponse`

- [ ] **Step 1: Write the failing test in `backend/tests/test_git_diff_ranges.py`**

```python
import pytest
from fastapi.testclient import TestClient
from pathlib import Path
import subprocess
import shutil

from app.main import app

client = TestClient(app)

@pytest.fixture
def temp_git_repo(tmp_path: Path, monkeypatch):
    repo_dir = tmp_path / "test_repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init"], cwd=repo_dir, check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "Test"], cwd=repo_dir, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo_dir, check=True)

    test_file = repo_dir / "sample.py"
    test_file.write_text("line 1\nline 2\nline 3\nline 4\nline 5\n", encoding="utf-8")
    subprocess.run(["git", "add", "sample.py"], cwd=repo_dir, check=True)
    subprocess.run(["git", "commit", "-m", "initial commit"], cwd=repo_dir, check=True)

    # Patch WORKSPACE_ROOT
    from app.config import get_workspace_dir
    monkeypatch.setattr("app.api.git._get_active_workspace_path", lambda: repo_dir)
    return repo_dir

def test_file_diff_ranges_clean(temp_git_repo: Path):
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py"})
    assert res.status_code == 200
    data = res.json()
    assert data["file_path"] == "sample.py"
    assert data["is_tracked"] is True
    assert data["ranges"] == []
    assert data["summary"]["total_changes"] == 0

def test_file_diff_ranges_modified_and_added(temp_git_repo: Path):
    sample_file = temp_git_repo / "sample.py"
    # modify line 2 and append line 6, 7
    sample_file.write_text("line 1\nline 2 modified\nline 3\nline 4\nline 5\nline 6\nline 7\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py"})
    assert res.status_code == 200
    data = res.json()
    assert len(data["ranges"]) >= 2
    types = [r["type"] for r in data["ranges"]]
    assert "modified" in types or "added" in types
    assert data["summary"]["total_changes"] > 0

def test_file_diff_ranges_deleted(temp_git_repo: Path):
    sample_file = temp_git_repo / "sample.py"
    # delete line 3
    sample_file.write_text("line 1\nline 2\nline 4\nline 5\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py"})
    assert res.status_code == 200
    data = res.json()
    types = [r["type"] for r in data["ranges"]]
    assert "deleted" in types

def test_file_diff_ranges_untracked(temp_git_repo: Path):
    new_file = temp_git_repo / "brand_new.py"
    new_file.write_text("print('hello')\nprint('world')\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "brand_new.py"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_tracked"] is False
    assert len(data["ranges"]) == 1
    assert data["ranges"][0]["type"] == "added"
    assert data["ranges"][0]["start_line"] == 1
    assert data["ranges"][0]["end_line"] == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_diff_ranges.py`  
Expected: 404 Not Found on `/api/git/file-diff-ranges`.

- [ ] **Step 3: Implement endpoint in `backend/app/api/git.py`**

Ajouter la fonction `get_file_diff_ranges(file_path: str = Query(...))` :
1. Valider l'accès au chemin du fichier via `_validate_path_access(target_path)`.
2. Vérifier si le fichier est suivi via `git ls-files --error-unmatch -- <rel_path>`.
   - Si non suivi, compter les lignes du fichier et renvoyer une tranche `type: "added"` de 1 à `N`.
3. Si suivi, exécuter `git diff -U0 HEAD -- <rel_path>`.
4. Parser les lignes `@@ -old_start,old_count +new_start,new_count @@`.
5. Calculer le résumé : `added_lines`, `modified_lines`, `deleted_lines`, `total_changes`.
6. Renvoyer le modèle Pydantic `GitDiffRangesResponse`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\venv\Scripts\python.exe -m pytest tests/test_git_diff_ranges.py`  
Expected: 4 passed.

- [ ] **Step 5: Run full pytest suite**

Run: `.\venv\Scripts\python.exe -m pytest tests/`  
Expected: 95 passed (100%).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/git.py backend/tests/test_git_diff_ranges.py
git commit -m "feat(git): add GET /api/git/file-diff-ranges endpoint with TDD tests" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 2: Frontend TypeScript Types & API Client

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces: `GitDiffRange`, `GitDiffSummary`, `GitDiffRangesResponse`, `fetchGitDiffRanges(filePath)`

- [ ] **Step 1: Add types to `frontend/src/types/index.ts`**

```typescript
export type GitDiffRangeType = 'added' | 'modified' | 'deleted';

export interface GitDiffRange {
  type: GitDiffRangeType;
  start_line: number;
  end_line: number;
}

export interface GitDiffSummary {
  added_lines: number;
  modified_lines: number;
  deleted_lines: number;
  total_changes: number;
}

export interface GitDiffRangesResponse {
  file_path: string;
  is_tracked: boolean;
  ranges: GitDiffRange[];
  summary: GitDiffSummary;
}
```

- [ ] **Step 2: Add API function to `frontend/src/services/api.ts`**

```typescript
export async function fetchGitDiffRanges(filePath: string): Promise<GitDiffRangesResponse> {
  const params = new URLSearchParams({ file_path: filePath });
  return apiFetch<GitDiffRangesResponse>(`/api/git/file-diff-ranges?${params.toString()}`);
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `npx tsc -b` in `frontend/`  
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(types): add GitDiffRanges types and API client function" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 3: Centralized Service `monacoAnnotations.ts` & CSS Gutter Styles

**Files:**
- Create: `frontend/src/services/monacoAnnotations.ts`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Produces:
  - `setupMultiCursor(editor, monaco, onCursorCountChange)`
  - `applyGitDecorations(editor, monaco, ranges)`
  - `navigateGitDiff(editor, ranges, direction)`
  - `getMonacoMultiCursorOptions()`

- [ ] **Step 1: Add CSS classes to `frontend/src/index.css`**

```css
/* Monaco Git Gutter & Minimap Annotations */
.monaco-git-gutter-added {
  border-left: 3px solid #10b981 !important;
  margin-left: 2px;
}
.monaco-git-gutter-modified {
  border-left: 3px solid #0ea5e9 !important;
  margin-left: 2px;
}
.monaco-git-gutter-deleted {
  position: relative;
}
.monaco-git-gutter-deleted::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 0;
  height: 0;
  border-top: 4px solid transparent;
  border-bottom: 4px solid transparent;
  border-left: 4px solid #f43f5e;
}
```

- [ ] **Step 2: Implement `frontend/src/services/monacoAnnotations.ts`**

Implémenter :
1. `getMonacoMultiCursorOptions()` : renvoie `{ multiCursorModifier: 'alt', multiCursorMergeOverlapping: true, multiCursorPaste: 'spread' }`.
2. `setupMultiCursor(editor, monaco, onCursorCountChange)` :
   - Écoute `editor.onDidChangeCursorSelection`.
   - Calcule `editor.getSelections()?.length || 1`.
   - Appelle `onCursorCountChange(count)`.
   - Ajoute les actions raccourcis clavier :
     - `Ctrl+D` (`editor.action.addSelectionToNextFindMatch`)
     - `Ctrl+U` (`editor.action.cursorUndo`)
     - `Ctrl+Shift+L` (`editor.action.selectHighlights`)
     - `Ctrl+Alt+Up` (`editor.action.insertCursorAbove`)
     - `Ctrl+Alt+Down` (`editor.action.insertCursorBelow`)
   - Renvoie une fonction de nettoyage pour désabonner les listeners.
3. `applyGitDecorations(editor, monaco, ranges, oldCollection)` :
   - Mappe chaque range en `monaco.editor.IModelDeltaDecoration`.
   - Configure la gouttière (`linesDecorationsClassName`), la minimap (`minimap: { color, position: 2 }`), et l'overview ruler (`overviewRuler: { color, position: 1 }`).
   - Utilise `editor.createDecorationsCollection(decorations)` ou `editor.deltaDecorations(oldIds, decorations)`.
4. `navigateGitDiff(editor, ranges, direction: 'next' | 'prev')` :
   - Récupère la ligne courante du curseur (`editor.getPosition()?.lineNumber || 1`).
   - Trouve la range la plus proche dans la direction donnée (avec rebouclage).
   - Positionne le curseur et appelle `editor.revealLineInCenter(targetLine)`.

- [ ] **Step 3: Verify TypeScript and Oxlint**

Run: `npx oxlint` && `npx tsc -b` in `frontend/`  
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/monacoAnnotations.ts frontend/src/index.css
git commit -m "feat(editor): implement monacoAnnotations service and gutter styles" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 4: Integration in `WorkspacePanel.tsx` (Embedded Editor)

**Files:**
- Modify: `frontend/src/components/WorkspacePanel.tsx`

**Interfaces:**
- Consumes: `setupMultiCursor`, `applyGitDecorations`, `navigateGitDiff`, `getMonacoMultiCursorOptions` from `monacoAnnotations.ts`
- Consumes: `fetchGitDiffRanges` from `api.ts`

- [ ] **Step 1: Wire multi-cursor options and listeners in `WorkspacePanel.tsx`**

1. Injecter `...getMonacoMultiCursorOptions()` dans les options de `<Editor />`.
2. Ajouter l'état `cursorCount: number` (1 par défaut).
3. Dans `onMount`, appeler `setupMultiCursor(editor, monaco, setCursorCount)`.
4. Dans la barre de statut inférieure de l'éditeur (à côté de `Lg X, Col Y`) :
   - Si `cursorCount > 1` : afficher une pastille ambrée `[ 3 curseurs ]` avec bouton croix pour réinitialiser le curseur (ou touche Échap).

- [ ] **Step 2: Fetch and render Git Diff ranges in `WorkspacePanel.tsx`**

1. Ajouter l'état `diffRanges: GitDiffRange[]` et `diffSummary: GitDiffSummary | null`.
2. À l'ouverture d'un fichier ou lors d'un enregistrement réussi (`handleSaveActiveTab`), appeler `fetchGitDiffRanges(activeTabItem.path)`.
3. Appliquer les décorations via `applyGitDecorations(editor, monaco, ranges, currentDecorations)`.
4. Ajouter dans la barre de statut inférieure :
   - Si `diffSummary && diffSummary.total_changes > 0` :
     - Pastille Git cliquable : `+${diffSummary.added_lines} ~${diffSummary.modified_lines} -${diffSummary.deleted_lines}`
     - Boutons de navigation : `[▲ Préc]` (`Shift+F7`) et `[▼ Suiv]` (`F7`) appelant `navigateGitDiff`.
5. Enregistrer le raccourci `F7` et `Shift+F7` dans l'éditeur Monaco.

- [ ] **Step 3: Verify TypeScript and Oxlint**

Run: `npx oxlint` && `npx tsc -b` in `frontend/`  
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/WorkspacePanel.tsx
git commit -m "feat(workspace): integrate multi-cursor and Git minimap decorations in WorkspacePanel" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 5: Integration in `MonacoStudioModal.tsx` (Fullscreen Studio)

**Files:**
- Modify: `frontend/src/components/MonacoStudioModal.tsx`

**Interfaces:**
- Consumes: `setupMultiCursor`, `applyGitDecorations`, `navigateGitDiff`, `getMonacoMultiCursorOptions` from `monacoAnnotations.ts`
- Consumes: `fetchGitDiffRanges` from `api.ts`

- [ ] **Step 1: Wire multi-cursor options and listeners in `MonacoStudioModal.tsx`**

1. Injecter `...getMonacoMultiCursorOptions()` dans les options de `<Editor />` en mode `'editor'`.
2. Ajouter l'état `cursorCount: number`.
3. Dans `onMount`, appeler `setupMultiCursor(editor, monaco, setCursorCount)`.
4. Dans la barre de statut inférieure de la modal :
   - Si `cursorCount > 1` : afficher le badge `[ 3 curseurs ]` avec bouton d'annulation.

- [ ] **Step 2: Fetch and render Git Diff ranges in `MonacoStudioModal.tsx`**

1. Si `config.filePath` est fourni et en mode `'editor'`, appeler `fetchGitDiffRanges(config.filePath)`.
2. Appliquer les décorations de gouttière, minimap et overview ruler.
3. Afficher le badge Git dans la barre inférieure avec les boutons de navigation `[▲]` / `[▼]` (`F7` / `Shift+F7`).
4. Re-calculer les ranges après chaque sauvegarde (`handleSave`).

- [ ] **Step 3: Verify TypeScript and Oxlint**

Run: `npx oxlint` && `npx tsc -b` in `frontend/`  
Expected: 0 warnings, 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/MonacoStudioModal.tsx
git commit -m "feat(studio): integrate multi-cursor and Git minimap annotations in MonacoStudioModal" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 6: Quality Gates, Live Verification & Release v0.2.22

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/public/sw.js`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `docs/ROADMAP.md`
- Modify: `C:\Users\joker\.gemini\antigravity-ide\brain\1f43388c-83b5-4f60-987d-7930239af144\walkthrough.md`
- Modify: `C:\Users\joker\.gemini\antigravity-ide\brain\1f43388c-83b5-4f60-987d-7930239af144\task.md`

- [ ] **Step 1: Run Oxlint strict check**

Run: `npm run lint` in `frontend/`  
Expected: 0 warnings, 0 errors.

- [ ] **Step 2: Run TypeScript strict check**

Run: `npx tsc -b` in `frontend/`  
Expected: 0 errors.

- [ ] **Step 3: Run production Vite build**

Run: `npm run build` in `frontend/`  
Expected: Build success.

- [ ] **Step 4: Run full Pytest suite**

Run: `.\venv\Scripts\python.exe -m pytest tests/` in `backend/`  
Expected: 100% tests passed.

- [ ] **Step 5: Live verification via Chrome DevTools MCP**

1. Ouvrir l'application sur `http://localhost:8000/`.
2. Ouvrir un fichier dans l'éditeur `WorkspacePanel` et tester `Alt+Clic` pour ajouter des curseurs multiples.
3. Vérifier l'apparition du badge de curseurs multiples dans la barre inférieure.
4. Modifier une ligne pour observer la barre verticale verte/bleue dans le gutter et la pastille dans la minimap.
5. Ouvrir `MonacoStudioModal` et vérifier les mêmes fonctionnalités en plein écran.
6. Capturer une capture d'écran et la stocker dans les artefacts : `monaco_multicursor_minimap_studio.png`.

- [ ] **Step 6: Version bump to v0.2.22 & Commit & Tag**

1. Mettre à jour `package.json` (0.2.22), `sw.js` (antigravity-cache-v0.2.22), `main.py` (0.2.22), `updater.py` (0.2.22), `ROADMAP.md`.
2. Mettre à jour `task.md` et `walkthrough.md`.
3. Commiter, tagger `v0.2.22` et pousser sur GitHub :
   ```bash
   git commit -am "chore(release): bump version to v0.2.22 for Monaco Multi-Cursor & Minimap Annotations Studio" --author="jprud67 <jprud67@gmail.com>"
   git tag -a v0.2.22 -m "Release v0.2.22: Monaco Multi-Cursor & Minimap Annotations Studio"
   git push origin main --tags
   ```
