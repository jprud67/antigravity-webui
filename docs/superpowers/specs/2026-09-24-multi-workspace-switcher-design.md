# Design Spec: Multi-Workspace & Project Switcher Studio

**Sprint :** 17 (v0.2.21)  
**Date :** 24 septembre 2026  
**Auteur :** Antigravity Pair Programmer & jprud67  
**Statut :** Approuvé (Ready for Implementation Plan)

---

## 1. Vue d'Ensemble & Objectifs

Le Sprint 17 introduit le **Multi-Workspace & Project Switcher Studio** dans **Antigravity WebUI**.
Bien que le backend disposait d'une gestion élémentaire des chemins de workspaces (`trustedWorkspaces`), l'interface utilisateur ne proposait aucun sélecteur dédié, obligeant à modifier manuellement les chemins ou la configuration, et n'offrait aucune visibilité sur l'état de santé ou les technologies des projets.

### Objectifs Principaux
1. **Studio Dédié & Ergonomique (`ProjectSwitcherModal.tsx`)** : Une interface visuelle moderne accessible instantanément via `Ctrl+Alt+W`, la pastille du chat, la barre latérale ou la commande `/workspace`.
2. **Détection Automatique des Runtimes & Frameworks** : Inspection ultra-rapide des manifests de projets pour identifier immédiatement Node.js, Python, PHP, Rust, Go, Docker, ainsi que les frameworks majeurs (Vite, Next.js, FastAPI, Laravel, etc.).
3. **Dashboard de Santé & Diagnostics Exploitables** : Détection des anomalies courantes (dépendances manquantes `node_modules`, environnements virtuels `.venv` absents, modifications Git non indexées) avec actions de remédiation en 1-clic injectées directement dans le terminal.
4. **Bascule Instantanée Sans Interruption** : Changement transparent de workspace actif sans détruire le fil de conversation en cours, synchronisant automatiquement l'arborescence des fichiers, l'état Git et le répertoire de travail du terminal.

---

## 2. Architecture Backend & Nouveaux Endpoints

Tous les endpoints sont montés sur `/api/workspaces` dans [`backend/app/api/workspaces.py`](file:///c:/laragon/www/antigravity-webui/backend/app/api/workspaces.py) et protégés par `require_auth`.

### 2.1. Nouveaux Endpoints & Extensions

#### `GET /api/workspaces/details`
- **Objectif** : Retourner la liste de tous les workspaces configurés dans `trustedWorkspaces`, enrichis de leurs métadonnées, télémétrie Git, runtimes et diagnostics de santé.
- **Paramètres** : Aucun (utilise les workspaces enregistrés).
- **Mise en cache** : Cache mémoire thread-safe avec TTL de 5 secondes pour minimiser les accès disque lors des consultations fréquentes.
- **Exemple de Réponse JSON** :
  ```json
  [
    {
      "path": "c:\\laragon\\www\\antigravity-webui",
      "name": "antigravity-webui",
      "is_default": true,
      "is_active": true,
      "last_modified": "2026-09-24T17:55:00Z",
      "stats": {
        "file_count": 482,
        "disk_size_mb": 142.5
      },
      "runtimes": [
        {
          "type": "node",
          "version": "v20.x",
          "frameworks": ["react", "vite", "tailwind"],
          "package_manager": "npm"
        },
        {
          "type": "python",
          "version": "3.12",
          "frameworks": ["fastapi", "uvicorn", "pytest"],
          "package_manager": "pip"
        }
      ],
      "git": {
        "is_repo": true,
        "branch": "main",
        "is_dirty": false,
        "uncommitted_count": 0,
        "remote_url": "https://github.com/jprud67/antigravity-webui.git",
        "ahead": 0,
        "behind": 0,
        "last_commit": {
          "sha": "3c3f2ee",
          "date": "2026-09-24T17:53:12Z",
          "subject": "docs: move ROADMAP.md into docs directory"
        }
      },
      "health": {
        "status": "healthy",
        "dependencies_installed": true,
        "node_modules_present": true,
        "venv_present": true,
        "vendor_present": false,
        "warnings": [],
        "suggested_action": null
      }
    }
  ]
  ```

#### `GET /api/workspaces/health`
- **Objectif** : Diagnostic approfondi à la demande pour un chemin spécifique (ex: lors de l'ajout d'un nouveau projet).
- **Paramètres** : `path: str = Query(...)`
- **Réponse JSON** : Renvoie l'objet `health` et `runtimes` pour le chemin donné.

#### `POST /api/workspaces/default`
- **Objectif** : Définir le workspace spécifié comme projet par défaut (`defaultWorkspace`) dans la configuration globale de l'application.
- **Paramètres** : `path: str = Query(...)`
- **Réponse JSON** : `{"status": "ok", "default_workspace": "<path>"}`

#### `POST /api/workspaces` (Enrichi)
- Valide que le dossier existe, n'est pas un chemin système protégé, ajoute à `trustedWorkspaces`, et renvoie les détails complets du projet créé.

#### `DELETE /api/workspaces`
- Retire un workspace de `trustedWorkspaces` (interdit si correspond à `DEFAULT_WORKSPACE`).

### 2.2. Moteur de Détection de Runtimes & Santé
Un module de service dédié `backend/app/services/project_detector.py` prend en charge l'analyse rapide et sécurisée d'un dossier racine :
* **Node.js** : Présence de `package.json` (analyse des `dependencies`, `devDependencies`, détection de Vite, React, Vue, Next.js, Express, Nuxt, Svelte, Angular, TypeScript).
* **Python** : Présence de `pyproject.toml`, `requirements.txt`, `Pipfile`, `setup.py`, `Pipfile.lock` (détection de FastAPI, Flask, Django, Torch, Pytest).
* **PHP** : Présence de `composer.json` (détection de Laravel, Symfony, WordPress).
* **Rust** : Présence de `Cargo.toml`.
* **Go** : Présence de `go.mod`.
* **Docker** : Présence de `Dockerfile` ou `docker-compose.yml`.
* **Git** : Détection du dossier `.git` et exécution rapide de `git status --porcelain` et `git branch --show-current` avec timeout strict de 1.5s.
* **Diagnostics Santé** :
  * Alerte si `package.json` existe mais `node_modules` est absent (action : `npm install` ou `pnpm install`).
  * Alerte si `requirements.txt` / `pyproject.toml` existe mais `venv` / `.venv` est absent (action : `python -m venv venv`).
  * Alerte si `composer.json` existe mais `vendor` est absent (action : `composer install`).
  * Alerte si le dépôt Git contient des fichiers modifiés non indexés (`is_dirty`).

---

## 3. Modèles TypeScript & Services Frontend

### 3.1. Types TypeScript ([`frontend/src/types/index.ts`](file:///c:/laragon/www/antigravity-webui/frontend/src/types/index.ts))

```typescript
export interface ProjectRuntimeInfo {
  type: 'node' | 'python' | 'php' | 'rust' | 'go' | 'docker' | 'generic';
  version?: string;
  frameworks: string[];
  packageManager?: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'pip' | 'poetry' | 'composer' | 'cargo';
}

export interface ProjectGitStatus {
  isRepo: boolean;
  branch?: string;
  isDirty: boolean;
  uncommittedCount: number;
  remoteUrl?: string;
  ahead?: number;
  behind?: number;
  lastCommit?: {
    sha: string;
    date: string;
    subject: string;
  };
}

export interface ProjectHealthDiagnostic {
  status: 'healthy' | 'warning' | 'error';
  dependenciesInstalled: boolean;
  venvPresent?: boolean;
  nodeModulesPresent?: boolean;
  vendorPresent?: boolean;
  warnings: string[];
  suggestedAction?: {
    label: string;
    command: string;
  } | null;
}

export interface WorkspaceProjectDetail {
  path: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  lastModified?: string;
  stats?: {
    fileCount?: number;
    diskSizeMb?: number;
  };
  runtimes: ProjectRuntimeInfo[];
  git: ProjectGitStatus;
  health: ProjectHealthDiagnostic;
}
```

### 3.2. Méthodes API ([`frontend/src/services/api.ts`](file:///c:/laragon/www/antigravity-webui/frontend/src/services/api.ts))

* `fetchWorkspaceProjects(): Promise<WorkspaceProjectDetail[]>` : Récupère la liste enrichie des workspaces.
* `fetchProjectHealth(path: string): Promise<ProjectHealthDiagnostic>` : Diagnostic de santé à la demande.
* `setDefaultWorkspace(path: string): Promise<{ status: string; default_workspace: string }>` : Fixe le workspace par défaut.
* `addWorkspaceProject(path: string): Promise<{ status: string; workspaces: string[] }>` : Enregistre un nouveau workspace.
* `removeWorkspaceProject(path: string): Promise<{ status: string; workspaces: string[] }>` : Retire un workspace.

---

## 4. Composant UI/UX Studio (`ProjectSwitcherModal.tsx`)

### 4.1. Structure Visuelle
- **Hero Card (Projet Actif)** :
  - Nom du projet mis en valeur avec badge `ACTIF` en vert émeraude.
  - Badges des runtimes avec icônes distinctes et frameworks associés.
  - Statut Git (branche active, indicateur de working tree clean/dirty).
  - Diagnostic de santé global avec bouton d'accès direct au terminal du projet (`cd "<path>"`).
- **Barre d'Outils & Recherche** :
  - Input de recherche instantanée par nom, chemin ou technologie.
  - Filtres par pastilles : `Tous`, `Node`, `Python`, `PHP`, `Git`, `Alertes`.
  - Bouton `+ Ajouter un dossier` avec sélecteur/explorateur de dossiers.
- **Grille de Cartes Projets** :
  - Chaque carte affiche les technologies détectées, le statut par défaut / favori, l'état Git et les alertes.
  - **Bouton d'Action de Remédiation** : Si des dépendances manquent, un bouton d'action directe (ex: `npm install`) permet de déclencher automatiquement la commande dans le terminal xterm et d'ouvrir le tiroir terminal.
  - Boutons d'action : `Basculer` (active le workspace), `Définir par défaut` (icône étoile), `Retirer` (icône corbeille, protégée pour le défaut).

### 4.2. Raccourcis Clavier & Accessibilité
- `Ctrl+Alt+W` (ou `Cmd+Alt+W`) pour ouvrir/fermer le studio.
- Navigation au clavier dans la liste (Flèches `Haut` / `Bas`, `Entrée` pour basculer, `Échap` pour fermer).

---

## 5. Bascule de Contexte Fluide (Seamless Context Switching)

Lorsqu'un utilisateur sélectionne un nouveau workspace dans le studio :
1. `currentWorkspace` est mis à jour dans `App.tsx` et persisté dans `localStorage` sous `antigravity_workspace`.
2. L'événement global `workspace-changed` est émis :
   - `WorkspacePanel` met à jour sa racine et recharge son arborescence de fichiers.
   - `GitTab` recharge instantanément le statut et les commits du nouveau dépôt.
   - `TerminalTab` est notifié pour envoyer un `cd "<nouveau_workspace>"`.
3. Le backend associe le nouveau `workspace_path` à la session de conversation active.
4. Une notification toast annonce la bascule : `"Projet actif : <nom_du_projet>"` avec badge du runtime.

---

## 6. Matrice de Validation & Tests

| Étape | Vérification | Critère de Succès |
|---|---|---|
| **Backend TDD** | `pytest tests/test_workspaces_health.py` | 100% de réussite sur les tests de détection, health check et sécurité anti-traversal |
| **Lint Frontend** | `npx oxlint --deny-warnings` | 0 warning, 0 error sur l'ensemble des fichiers TypeScript |
| **Typage** | `npx tsc -b` | 0 erreur de compilation |
| **Build Vite** | `npm run build` | Build de production propre et optimisé |
| **Suite Globale** | `pytest tests/` | Maintien du taux de réussite 100% sur l'ensemble de la suite backend |
| **Validation Live** | Chrome DevTools MCP | Ouverture via `Ctrl+Alt+W`, détection des runtimes, affichage du Hero Card, bascule de projet et action 1-clic |
| **Déploiement** | Release v0.2.21 | Version bump, commit Git, tag `v0.2.21` et push vers GitHub |
