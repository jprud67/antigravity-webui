# Design Spec: Interactive Git Rebase & Visual Branch Manager Studio

**Sprint :** 16 (v0.2.20)  
**Date :** 24 septembre 2026  
**Auteur :** Antigravity Pair Programmer & jprud67  
**Statut :** Approuvé (Ready for Implementation Plan)

---

## 1. Vue d'Ensemble & Objectifs

Le Sprint 16 dote **Antigravity WebUI** d'un outillage Git de niveau professionnel, directement intégré dans l'interface graphique :
1. **Visual Branch Manager** : Gestion complète du cycle de vie des branches Git (création, bascule rapide avec détection des modifications non enregistrées, fusion avec ou sans fast-forward, renommage, suppression sécurisée avec protection des branches principales, et synchronisation avec les branches distantes).
2. **Interactive Git Rebase Studio** : Interface visuelle complète pour orchestrer un rebase interactif (`git rebase -i`), permettant de réordonner les commits par glisser-déposer ou boutons de déplacement, d'assigner les actions Git fondamentales (`pick`, `squash`, `reword`, `drop`), d'éditer les messages de commits inline, et de gérer les conflits éventuels de manière transparente grâce à l'intégration directe de notre `GitConflictModal` Monaco Diff.

---

## 2. Architecture Backend & Nouveaux Endpoints Git

Tous les endpoints sont montés sur `/api/git` dans [`backend/app/api/git.py`](file:///c:/laragon/www/antigravity-webui/backend/app/api/git.py) et protégés par `require_auth`.

### 2.1. Gestion Complète des Branches

#### `GET /api/git/branches` (Enrichi)
- **Objectif** : Fournir une vue structurée détaillée de toutes les branches locales et distantes.
- **Paramètres** : `workspace: str | None = None`
- **Réponse JSON** :
  ```json
  {
    "current": "main",
    "branches": [
      {
        "name": "main",
        "is_current": true,
        "is_remote": false,
        "upstream": "origin/main",
        "ahead": 0,
        "behind": 0,
        "last_commit_sha": "3df2a7b",
        "last_commit_date": "2026-09-24T14:05:30Z",
        "last_commit_subject": "feat(copilot): integrate AI Inline Copilot"
      },
      {
        "name": "origin/main",
        "is_current": false,
        "is_remote": true,
        "upstream": null,
        "ahead": 0,
        "behind": 0,
        "last_commit_sha": "3df2a7b",
        "last_commit_date": "2026-09-24T14:05:30Z",
        "last_commit_subject": "feat(copilot): integrate AI Inline Copilot"
      }
    ]
  }
  ```

#### `POST /api/git/branches/checkout`
- **Objectif** : Basculer vers une autre branche en toute sécurité.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "branch": "feature/ui-enhancements",
    "create": false,
    "start_point": null
  }
  ```
- **Validation** :
  - Vérification de l'arbre de travail (`git status --porcelain`). Si des modifications non enregistrées risquent d'entrer en conflit avec la bascule, renvoie un statut `409 Conflict` avec message d'avertissement conseillant un `stash`.
  - Exécute `git checkout <branch>` ou `git checkout -b <branch> [start_point]`.

#### `POST /api/git/branches/create`
- **Objectif** : Créer une nouvelle branche locale.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "name": "feature/login-modal",
    "start_point": "HEAD",
    "checkout": true
  }
  ```
- **Sécurité** :
  - Validation du nom de branche via `git check-ref-format --branch <name>`.
  - Refus des caractères spéciaux interdits, options CLI injectées (ex: `--force`).

#### `DELETE /api/git/branches`
- **Objectif** : Supprimer une branche locale ou distante.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "branch": "feature/old-experiment",
    "force": false,
    "remote": false,
    "remote_name": "origin"
  }
  ```
- **Sécurité** :
  - Interdiction absolue de supprimer la branche courante active (renvoie `400 Bad Request`).
  - Interdiction absolue de supprimer les branches protégées (`main`, `master`).
  - Si la branche locale n'est pas complètement fusionnée et que `force` vaut `false`, `git branch -d` échoue et renvoie un message demandant confirmation explicite pour `force: true` (`git branch -D`).

#### `POST /api/git/branches/merge`
- **Objectif** : Fusionner une branche dans la branche active.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "branch": "feature/copilot",
    "no_ff": false,
    "message": null
  }
  ```
- **Gestion des Conflits** :
  - Si la fusion provoque des conflits, renvoie `has_conflicts: true`, `conflicts: ["file1.ts", "file2.py"]`.

#### `POST /api/git/branches/rename`
- **Objectif** : Renommer une branche locale.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "old_name": "feature/typo",
    "new_name": "feature/fix-typo"
  }
  ```

---

### 2.2. Automate de Rebase Interactif

#### `GET /api/git/rebase/todo`
- **Objectif** : Obtenir la séquence des commits entre `base` et `HEAD` prête pour modification.
- **Paramètres** : `base: str` (ex: `HEAD~5` ou SHA), `workspace: str | None = None`
- **Réponse JSON** :
  ```json
  {
    "base": "HEAD~5",
    "commits": [
      {
        "sha": "9a0b1c2",
        "full_sha": "9a0b1c2d3e4f...",
        "author": "jprud67",
        "date": "2026-09-24T12:00:00Z",
        "subject": "feat: initial stub",
        "action": "pick",
        "new_message": null
      }
    ]
  }
  ```

#### `POST /api/git/rebase/execute`
- **Objectif** : Lancer le rebase interactif non-interactif via `GIT_SEQUENCE_EDITOR`.
- **Payload** :
  ```json
  {
    "workspace": "c:/path/to/repo",
    "base": "HEAD~5",
    "commits": [
      { "sha": "9a0b1c2", "action": "reword", "new_message": "feat: complete stub" },
      { "sha": "3e4f5a6", "action": "squash", "new_message": null },
      { "sha": "7b8c9d0", "action": "drop", "new_message": null },
      { "sha": "1f2e3d4", "action": "pick", "new_message": null }
    ]
  }
  ```
- **Moteur d'Exécution** :
  - Le backend prépare un fichier d'instructions JSON / texte dans un dossier temporaire sécurisé du workspace.
  - Exécute `git rebase -i <base>` en définissant `GIT_SEQUENCE_EDITOR="python <helper_script> <instructions_path>"`.
  - Le helper Python lit les actions prévues et réécrit le fichier todo de Git de manière déterministe.
  - Pour les actions `reword`, un hook `GIT_EDITOR` fournit le nouveau message sans ouvrir d'éditeur interactif.
  - Si le rebase réussit : renvoie `success: true`.
  - Si un conflit survient : Git entre dans son état `.git/rebase-merge/`, l'API renvoie `status: "conflict"`, `conflicts: list[str]`.

#### `GET /api/git/rebase/status`
- **Objectif** : Détecter si un rebase est actuellement en cours.
- **Réponse JSON** :
  ```json
  {
    "is_rebasing": true,
    "current_step": 2,
    "total_steps": 5,
    "current_commit": "3e4f5a6",
    "conflicted_files": ["backend/app/main.py"]
  }
  ```

#### `POST /api/git/rebase/continue` & `POST /api/git/rebase/abort`
- `POST /api/git/rebase/continue` : exécute `git rebase --continue`.
- `POST /api/git/rebase/abort` : exécute `git rebase --abort` et restaure l'arbre d'origine.

---

## 3. Composants Frontend & Expérience Utilisateur

### 3.1. Sous-onglet « Branches » dans [`GitTab.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/GitTab.tsx)
- Barre d'onglets Git mise à jour :
  `[Modifications]` | `[Historique]` | `[Stashes (X)]` | `[Branches (X)]`.
- **En-tête de la vue Branches** :
  - Carte de la branche courante active : nom avec icône `GitBranch`, badge vert `Actuelle`, bouton `Push` / `Pull` avec indication `↑ ahead` / `↓ behind`.
  - Bouton supérieur `+ Nouvelle branche` avec modal : nom, point de départ, case à cocher pour bascule immédiate.
  - Champ de recherche/filtrage en temps réel des branches.
- **Sections distinctes** :
  - *Branches Locales* : liste des branches locales avec actions 1-clic :
    - `Basculer` : checkout instantané avec notification toast.
    - `Fusionner` : dialogue de confirmation avec option `--no-ff`.
    - `Renommer` : édition inline sécurisée.
    - `Supprimer` : confirmation avec alerte si la branche n'est pas fusionnée (`-D`).
  - *Branches Distantes* : liste des branches de remote (`origin/*`) avec bouton `Créer branche locale depuis cette source`.

### 3.2. Studio de Rebase Interactif : [`GitRebaseModal.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/GitRebaseModal.tsx)
- Modale centrée plein écran :
  - **En-tête** : Titre `Studio de Rebase Interactif`, base sélectionnée, sélecteur rapide de profondeur (5, 10, 15, ou SHA spécifique).
  - **Liste Ordonnée Réorganisable** :
    - Boutons flèches Haut / Bas et poignée pour glisser-déposer les commits.
    - Sélecteur d'action par commit avec pastilles colorées :
      - 🟢 `pick` : conserver le commit tel quel.
      - 🟡 `reword` : éditer le message du commit (déploie un champ de saisie inline).
      - 🔵 `squash` : fusionner avec le commit précédent.
      - 🔴 `drop` : supprimer le commit (effet barré et opacité réduite).
  - **Barre de Synthèse** : badge récapitulatif (`3 conservés, 1 fusionné, 1 supprimé`).
  - **Bouton d'Exécution** : bouton principal `« Lancer le rebase »` avec retour visuel d'exécution.

### 3.3. Bandeau de Contrôle « Rebase en cours »
- Si un conflit survient pendant le rebase :
  - Un bandeau d'alerte ambré s'affiche en tête de `GitTab`.
  - Bouton `Résoudre les conflits` : ouvre notre `GitConflictModal` (Monaco Diff 3-way).
  - Bouton `Continuer le rebase` (`git rebase --continue`).
  - Bouton `Annuler le rebase` (`git rebase --abort`).

---

## 4. Matrice de Validation & Portes de Qualité

1. **Tests Unitaires Backend ([`backend/tests/test_git_branch_rebase.py`](file:///c:/laragon/www/antigravity-webui/backend/tests/test_git_branch_rebase.py))** :
   - Dépôt temporaire isolé créé via fixture pytest.
   - Tests de création, checkout, rename, delete (sécurité branche active) et merge.
   - Tests de rebase interactif : `pick`, `reword`, `squash`, `drop`, détection de conflit, abort et continue.
   - 100% de réussite sur la suite complète backend (74 + nouveaux tests).
2. **Qualité Frontend** :
   - `npx oxlint --deny-warnings` : 0 warning, 0 error.
   - `npx tsc -b` : 0 erreur TypeScript.
   - `npm run build` : build Vite propre et optimisé.
3. **Vérification Interactive Live** :
   - Test en direct avec Chrome DevTools MCP : création de branche, bascule, rebase d'un commit avec `reword`, capture d'écran de validation.
4. **Versioning & Release** :
   - Bump de version à `v0.2.20` dans `package.json`, `main.py`, `updater.py`, `sw.js`.
   - Commit Git, tag annoté `v0.2.20`, push sur `origin/main --tags`.
