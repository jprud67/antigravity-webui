# Design Specification — Monaco Multi-Cursor & Minimap Annotations Studio

**Date** : 2026-09-24  
**Sprint** : Sprint 18 (v0.2.22)  
**Status** : Approved  
**Author** : jprud67 <jprud67@gmail.com>

---

## 1. Overview & Objectives

Dans Antigravity WebUI, les développeurs passent une part importante de leur temps dans l'éditeur de code intégré Monaco, que ce soit au sein de l'explorateur de fichiers de l'espace de travail ([`WorkspacePanel.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/WorkspacePanel.tsx)) ou dans le studio de code plein écran ([`MonacoStudioModal.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/MonacoStudioModal.tsx)).

Bien que Monaco intègre des capacités d'édition avancées, deux fonctionnalités indispensables de productivité manquaient :
1. **Édition multi-curseurs complète et intuitive** : Ajout de curseurs secondaires via `Alt + Clic`, sélection progressive d'occurrences via `Ctrl + D`, sélection globale via `Ctrl + Shift + L`, annulation progressive de curseur via `Ctrl + U`, et ajout vertical de curseurs via `Ctrl + Alt + Flèches Haut/Bas`, accompagnés d'un indicateur de statut dynamique dans la barre inférieure de l'éditeur.
2. **Heatmap Git et annotations visuelles dans la gouttière (Gutter), la Minimap et l'Overview Ruler** : Repères visuels en temps réel indiquant les lignes ajoutées (`added`), modifiées (`modified`) ou supprimées (`deleted`) par rapport à `HEAD`, avec navigation rapide de modification en modification (`F7` / `Shift + F7`) et pastille de résumé Git (`+4 ~1 -2`).

Le but du Sprint 18 est de concevoir et implémenter ces capacités sous une architecture modulaire, unifiée et hautement performante (60 FPS, zéro latence de saisie).

---

## 2. Architecture & Composants

```
┌─────────────────────────────────────────────────────────────┐
│                    FastAPI Backend                          │
│                                                             │
│   GET /api/git/file-diff-ranges?file_path=...               │
│   └── async git diff -U0 HEAD -- <file>                     │
│   └── Parse hunks: added, modified, deleted line ranges     │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON (ranges, summary)
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Frontend Architecture                       │
│                                                             │
│   frontend/src/services/monacoAnnotations.ts                │
│   ├── configureMultiCursor(editor, monaco, onCountChange)   │
│   ├── applyGitGutterAndMinimapDecorations(editor, ranges)   │
│   ├── navigateNextDiff(editor, ranges) / navigatePrevDiff   │
│   └── setupMultiCursorKeybindings(editor, monaco)           │
│                                                             │
│         ▲                                       ▲           │
│         │                                       │           │
│   ┌─────┴──────────────────┐             ┌──────┴─────────┐ │
│   │  WorkspacePanel.tsx    │             │ MonacoStudio   │ │
│   │  (Embedded Editor)     │             │ Modal.tsx      │ │
│   │  - Multi-cursor badge  │             │ - Multi-cursor │ │
│   │  - Git summary badge   │             │   badge        │ │
│   │  - F7 navigation       │             │ - Git summary  │ │
│   └────────────────────────┘             └────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Backend Specification

### 3.1 Endpoint `GET /api/git/file-diff-ranges`

- **Fichier** : [`backend/app/api/git.py`](file:///c:/laragon/www/antigravity-webui/backend/app/api/git.py)
- **Requête** :
  - Paramètre de requête : `file_path: str`
  - Exemple : `GET /api/git/file-diff-ranges?file_path=frontend/src/App.tsx`
- **Sécurité & Validation** :
  - Validation du chemin d'accès via `_validate_path_access(file_path)` pour interdire le path traversal.
  - Vérification de l'existence du fichier. Si le fichier est nouveau et non suivi, toutes ses lignes sont marquées comme `added`.
- **Logique d'exécution Git** :
  - Lancement asynchrone : `git diff -U0 HEAD -- <normalized_rel_path>`.
  - Analyse des en-têtes de fragments (hunks) du format unified diff :
    - `@@ -old_start,old_count +new_start,new_count @@` ou `@@ -old_start +new_start @@`.
    - Si `old_count == 0` : lignes ajoutées (`added`) de `new_start` à `new_start + new_count - 1`.
    - Si `new_count == 0` : ligne de suppression (`deleted`) à `new_start` (ou `new_start + 1`).
    - Si `old_count > 0` et `new_count > 0` : lignes modifiées (`modified`) de `new_start` à `new_start + new_count - 1`.
- **Schéma de Réponse (`GitDiffRangesResponse`)** :
  ```json
  {
    "file_path": "frontend/src/App.tsx",
    "is_tracked": true,
    "ranges": [
      { "type": "added", "start_line": 15, "end_line": 18 },
      { "type": "modified", "start_line": 42, "end_line": 44 },
      { "type": "deleted", "start_line": 90, "end_line": 90 }
    ],
    "summary": {
      "added_lines": 4,
      "modified_lines": 3,
      "deleted_lines": 1,
      "total_changes": 8
    }
  }
  ```

---

## 4. Frontend Specification

### 4.1 Types TypeScript (`frontend/src/types/index.ts`)

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

### 4.2 API Client (`frontend/src/services/api.ts`)

```typescript
export async function fetchGitDiffRanges(filePath: string): Promise<GitDiffRangesResponse> {
  const params = new URLSearchParams({ file_path: filePath });
  return apiFetch<GitDiffRangesResponse>(`/api/git/file-diff-ranges?${params.toString()}`);
}
```

### 4.3 Service Centralisé `frontend/src/services/monacoAnnotations.ts`

Ce module fournit :
1. **`setupMultiCursor(editor, monaco, onSelectionCountChange)`** :
   - Écoute `editor.onDidChangeCursorSelection`.
   - Calcule `editor.getSelections().length`.
   - Notifie le callback avec le nombre de curseurs et la position principale.
   - Enregistre les raccourcis étendus :
     - `Ctrl+D` : `editor.action.addSelectionToNextFindMatch`
     - `Ctrl+U` : `editor.action.cursorUndo`
     - `Ctrl+Shift+L` : `editor.action.selectHighlights`
     - `Ctrl+Alt+Up` : `editor.action.insertCursorAbove`
     - `Ctrl+Alt+Down` : `editor.action.insertCursorBelow`
2. **`applyGitDecorations(editor, monaco, ranges)`** :
   - Transforme chaque `GitDiffRange` en décorations Monaco :
     - `added` :
       - `linesDecorationsClassName`: `'monaco-git-gutter-added'` (barre émeraude `#10b981`)
       - `minimap`: `{ color: '#10b981aa', position: monaco.editor.MinimapPosition.Gutter }`
       - `overviewRuler`: `{ color: '#10b981dd', position: monaco.editor.OverviewRulerLane.Left }`
     - `modified` :
       - `linesDecorationsClassName`: `'monaco-git-gutter-modified'` (barre cyan `#0ea5e9`)
       - `minimap`: `{ color: '#0ea5e9aa', position: monaco.editor.MinimapPosition.Gutter }`
       - `overviewRuler`: `{ color: '#0ea5e9dd', position: monaco.editor.OverviewRulerLane.Left }`
     - `deleted` :
       - `linesDecorationsClassName`: `'monaco-git-gutter-deleted'` (triangle rouge `#f43f5e`)
       - `overviewRuler`: `{ color: '#f43f5edd', position: monaco.editor.OverviewRulerLane.Left }`
   - Gère le cycle de vie via `decorationsCollection` ou `deltaDecorations` pour éviter toute fuite mémoire.
3. **`navigateGitDiff(editor, ranges, direction: 'next' | 'prev')`** :
   - Trouve la prochaine ou précédente plage de modifications par rapport à la position actuelle du curseur.
   - Utilise `editor.revealLineInCenter(targetLine)` et `editor.setPosition({ lineNumber: targetLine, column: 1 })`.

---

## 5. Intégration Visuelle et Barres de Statut

### 5.1 Barres de Statut ([`WorkspacePanel.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/WorkspacePanel.tsx) & [`MonacoStudioModal.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/MonacoStudioModal.tsx))

1. **Badge Multi-Curseurs** :
   - Invisible quand il n'y a qu'un seul curseur (zéro pollution visuelle).
   - Dès que `cursorCount > 1` : badge ambré/violet élégant `[ 3 curseurs ]` avec bouton croix ou clic pour réinitialiser à un curseur unique (`Échap`).
2. **Badge Git Diff & Navigation** :
   - Pastille informative : `+4 ~2 -1` (cliquable pour basculer vers la prochaine modification).
   - Boutons discrets `[▲]` / `[▼]` pour naviguer entre les changements (`Shift+F7` / `F7`).

### 5.2 Styles CSS des Gouttières Monaco

Injectés dans `index.css` :
```css
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

---

## 6. Plan de Test & Critères de Réussite

1. **Tests Backend (Pytest)** :
   - Fichier test `backend/tests/test_git_diff_ranges.py`.
   - Vérification sur fichier inchangé (`ranges: []`).
   - Vérification avec ajouts stricts.
   - Vérification avec modifications de blocs.
   - Vérification avec suppressions.
   - Vérification de la sécurité (path traversal, fichier inexistant).
2. **Qualité Frontend** :
   - 0 avertissement, 0 erreur Oxlint.
   - 0 erreur TypeScript (`tsc -b`).
   - Build de production Vite propre et optimisé.
3. **Validation Live Chrome DevTools MCP** :
   - Éditeur WorkspacePanel et MonacoStudioModal testés en direct sur `http://localhost:8000/`.
   - Ajout de curseurs multiples avec `Alt + Clic` et `Ctrl + D`, observation du badge de statut.
   - Modification de lignes et observation des décorations de gouttière verte/bleue et de la minimap.
   - Navigation avec `F7` et boutons de navigation.
   - Capture d'écran enregistrée dans les artefacts.
