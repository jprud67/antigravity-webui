# Implémentation du Volet Auxiliaire & Cockpit Façon Antigravity IDE

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter une barre d'activité latérale droite (Auxiliary Bar) et perfectionner le volet auxiliaire multi-vues avec synchronisation réactive en direct, code lenses sur les blocs de code et routage direct des liens de fichiers vers l'éditeur intégré.

**Architecture:** 
- Création du composant `AuxiliaryBar.tsx` pour ancrer les icônes de navigation IDE sur le flanc droit avec badges dynamiques (Git diffs, artéfacts).
- Extension de `WorkspacePanel.tsx` pour réagir aux événements de fin d'outil de l'agent (`agentActivityTimestamp`), actualiser silencieusement le statut git et les artéfacts, et mémoriser l'état d'ouverture et la largeur préférée dans `localStorage`.
- Enrichissement de `ChatCanvas.tsx` avec des Code Lenses au-dessus des blocs de code (exécution terminal, ouverture éditeur) et interception des liens de fichiers locaux `file:///...`.
- Intégration globale dans `App.tsx`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, Lucide icons, Vite.

**Spec:** [docs/superpowers/specs/2026-09-22-ide-auxiliary-pane-design.md](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-22-ide-auxiliary-pane-design.md)

## Global Constraints
- Pas d'impact négatif sur les performances de streaming ou la saisie clavier dans le chat.
- Rétrocompatibilité avec les versions mobiles (tiroir overlay sur petit écran, barre latérale dockée sur `md:`).
- Aucun warning ou erreur de typage TypeScript (`npx tsc --noEmit`) et conformité oxlint (`npm run lint`).

---

### Task 1: Composant `AuxiliaryBar.tsx` et traductions i18n

**Files:**
- Create: `frontend/src/components/AuxiliaryBar.tsx`
- Modify: `frontend/src/services/i18n.ts`

**Interfaces:**
- Produces: `AuxiliaryBarProps`:
  ```typescript
  export interface AuxiliaryBarProps {
    isOpen: boolean;
    activeTab: RightPanelTab;
    onToggleTab: (tab: RightPanelTab) => void;
    changedFilesCount?: number;
    artifactsCount?: number;
    isStreaming?: boolean;
  }
  ```

- [ ] **Step 1: Ajouter les traductions i18n pour la barre auxiliaire dans `frontend/src/services/i18n.ts`**
  - Clés : `aux_bar_files`, `aux_bar_changes`, `aux_bar_artifacts`, `aux_bar_terminal`, `aux_bar_kanban`, `aux_bar_toggle_collapse`.

- [ ] **Step 2: Créer `frontend/src/components/AuxiliaryBar.tsx`**
  - Composant barre verticale étroite (~48px) avec boutons d'icônes (`FolderTree`, `GitBranch`, `FileText`, `TerminalIcon`, `KanbanIcon`).
  - Badges d'alerte pour `changedFilesCount` (>0 en ambre/émeraude) et `artifactsCount`.
  - Bouton inférieur de réduction/agrandissement du volet.

- [ ] **Step 3: Vérifier le typage TypeScript**
  - Exécuter: `npx tsc --noEmit` dans `frontend`.

- [ ] **Step 4: Commit**
  - Exécuter: `git add frontend/src/components/AuxiliaryBar.tsx frontend/src/services/i18n.ts; git commit -m "feat(ui): add IDE AuxiliaryBar component with reactive badges"`

---

### Task 2: Synchronisation Réactive en Direct & Améliorations de `WorkspacePanel.tsx`

**Files:**
- Modify: `frontend/src/components/WorkspacePanel.tsx`

**Interfaces:**
- Consumes: `agentActivityTimestamp?: number`, `onOpenFilePath?: (path: string) => void`.

- [ ] **Step 1: Ajouter la synchronisation réactive sur `agentActivityTimestamp`**
  - `useEffect` surveillant `agentActivityTimestamp` pour recharger discrètement `fetchGitStatus` et `fetchArtifacts`.
  - Si l'onglet actif est `git` ou `artifacts`, actualiser immédiatement les données affichées.

- [ ] **Step 2: Persistance de la largeur et de l'état dans `localStorage`**
  - Clés `antigravity_aux_panel_width` (par défaut 520px) et `antigravity_aux_panel_open`.

- [ ] **Step 3: Support du raccourci clavier global `Ctrl+B` / `Cmd+B`**
  - Écouteur d'événement `keydown` pour basculer le volet latéral.

- [ ] **Step 4: Vérifier le typage TypeScript**
  - Exécuter: `npx tsc --noEmit` dans `frontend`.

- [ ] **Step 5: Commit**
  - Exécuter: `git add frontend/src/components/WorkspacePanel.tsx; git commit -m "feat(ui): enhance WorkspacePanel with live agent sync and persistence"`

---

### Task 3: Code Lenses & Interception des Liens de Fichiers Locaux dans `ChatCanvas.tsx`

**Files:**
- Modify: `frontend/src/components/ChatCanvas.tsx`

**Interfaces:**
- Consumes: `onExecuteTerminalCommand?: (cmd: string) => void`, `onOpenFileInWorkspace?: (path: string) => void`.

- [ ] **Step 1: Ajouter les Code Lenses au-dessus des blocs de code Markdown**
  - Pour les blocs shell (`bash`, `sh`, `powershell`, `cmd`, `shell`, `zsh`) : bouton **`[▶ Exécuter dans le terminal]`**.
  - Pour les blocs avec chemin de fichier détecté : bouton **`[📁 Ouvrir dans l'éditeur]`**.

- [ ] **Step 2: Intercepter les clics sur les liens de fichiers Markdown (`file:///...`)**
  - Dans le renderer de balise `a` de ReactMarkdown : intercepter les URLs `file:///` ou chemins de fichier locaux, extraire le chemin relatif au workspace et invoquer `onOpenFileInWorkspace(relativePath)`.

- [ ] **Step 3: Vérifier le typage TypeScript**
  - Exécuter: `npx tsc --noEmit` dans `frontend`.

- [ ] **Step 4: Commit**
  - Exécuter: `git add frontend/src/components/ChatCanvas.tsx; git commit -m "feat(chat): add IDE code lenses and in-app file link navigation"`

---

### Task 4: Intégration dans `App.tsx` et Assemblage Cockpit

**Files:**
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Connecte `AuxiliaryBar`, `WorkspacePanel`, `ChatCanvas` et les flux WebSocket.

- [ ] **Step 1: Connecter les états `agentActivityTimestamp`, `changedFilesCount`, `artifactsCount`**
  - Incrémentation de `agentActivityTimestamp` lors de la réception d'événements d'étape (`step_update`) et de fin d'outil.
  - Calcul du compte de fichiers modifiés (`gitStatus.modified.length + gitStatus.untracked.length`).
  - Passage de `onOpenFileInWorkspace` et `onExecuteTerminalCommand`.

- [ ] **Step 2: Intégrer `<AuxiliaryBar />` sur le flanc droit**
  - Positionnement flexbox à droite du `<main>` ou à l'intérieur du layout cockpit.

- [ ] **Step 3: Vérifier le typage TypeScript et oxlint**
  - Exécuter: `npx tsc --noEmit` et `npm run lint`.

- [ ] **Step 4: Commit**
  - Exécuter: `git add frontend/src/App.tsx; git commit -m "feat(app): assemble IDE cockpit with AuxiliaryBar and seamless panel coordination"`

---

### Task 5: Validation Complète & Build de Production

**Files:**
- Test: tests automatisés et build

- [ ] **Step 1: Exécuter `npx tsc --noEmit`**
  - Vérifier 0 erreur de typage.

- [ ] **Step 2: Exécuter `npm run lint`**
  - Vérifier 0 warning et 0 erreur avec oxlint.

- [ ] **Step 3: Exécuter `npm run build`**
  - Vérifier la compilation réussie du bundle Vite.

- [ ] **Step 4: Tests unitaires backend de non-régression**
  - Exécuter: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"`.
