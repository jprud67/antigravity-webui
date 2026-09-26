# Roadmap for Antigravity-webui Improvements

## Overview
This roadmap outlines the strategic direction for **Antigravity‑webui**, the front‑end of the Antigravity IDE. It is derived from recent bug‑fix cycles, user feedback, and the observed pain points in the current chat‑driven workflow. The goal is to turn the web UI into a **premium, highly‑responsive, and extensible developer experience** while keeping the underlying FastAPI backend stable.

---

## High‑Level Objectives
1. **Polish UI/UX** – Deliver a modern, glass‑morphism‑styled interface with smooth micro‑animations and a consistent design system.
2. **Performance & Responsiveness** – Reduce initial load time, improve runtime responsiveness, and optimise network calls.
3. **Feature Completeness** – Close gaps identified during the bulk‑action audit (e.g., bulk delete, export, pinning), add missing shortcuts and keyboard navigation.
4. **Reliability & Test Coverage** – Achieve >90 % UI test coverage, automate end‑to‑end (E2E) tests, and integrate CI/CD pipelines.
5. **Extensibility & Ecosystem** – Introduce a plugin architecture, theming support (dark/light), and internationalisation (i18n).
6. **Documentation & Onboarding** – Provide in‑app tutorials, a searchable Help center, and a developer guide for custom extensions.

---

## Timeline & Milestones
### 📌 Short‑Term (v0.2.5 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **UI Refresh – Core Components** | Redesign buttons, dialogs, and list items using custom design system (CSS variables, glass effect, micro-animations). | Frontend Lead | 2026‑10‑05 | ✅ **Completed** |
| **Bulk‑Action Reliability** | Ensure all bulk actions (delete, export, pin) work consistently; confirmation modals and toast notifications. | QA / Dev | 2026‑10‑07 | ✅ **Completed** |
| **Keyboard Shortcuts** | Implement global shortcuts (Ctrl+K, Ctrl+Shift+N/S/E, Delete in bulk, Escape, ?) and cheat‑sheet. | Frontend | 2026‑10‑09 | ✅ **Completed** |
| **Performance Audit** | Profile bundle size, lazy‑load KanbanTab & GitTab, manualChunks (prismjs, katex), -26% gzip bundle. | DevOps | 2026‑10‑10 | ✅ **Completed** |
| **Accessibility Review** | Add ARIA attributes, focus order, WCAG AA compliance on all skins, prefers-reduced-motion. | UX | 2026‑10‑12 | ✅ **Completed** |
| **Release v0.2.5** | Tag and publish with commit and v0.2.5 git tag pushed to GitHub. | Release Manager | 2026‑10‑15 | ✅ **Completed** |

### 📌 Jalon v0.2.6 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Analytics & Quota Dashboard** | Live gauges per model, token breakdown (input/output/thinking), Google account status, `/analytics` command. | Frontend / API | 2026‑10‑18 | ✅ **Completed** |
| **Advanced Sidebar Filters & Sorting** | Expandable filter drawer with multi-tag selector, date ranges (all/today/7d/30d), project filter, sort order (recent/oldest/A-Z/Z-A). | Frontend | 2026‑10‑20 | ✅ **Completed** |
| **Complete ZIP Archive Export** | Full markdown export in streaming ZIP archive (`/api/conversations/export/zip`), bulk ZIP export & filtered ZIP export. | Backend / Frontend | 2026‑10‑22 | ✅ **Completed** |
| **Release v0.2.6** | Version bump to 0.2.6, zero warnings on Oxlint, verified live in Chrome browser. | Release Manager | 2026‑10‑23 | ✅ **Completed** |

### 📌 Jalon v0.2.7 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Advanced Theme Engine** | 9 preset accent swatches + arbitrary custom hex picker (`<input type="color">`), dynamic CSS variables (`--accent`, `--accent-bg`, `--accent-hover`, `--focus-ring`, `--focus-glow`), local storage persistence. | Frontend | 2026‑10‑24 | ✅ **Completed** |
| **OLED Pure Black Mode** | High-contrast `#000000` pitch black background, `#050505` sidebar, and `#0a0a0a` cards for battery savings and maximum contrast. | Frontend | 2026‑10‑25 | ✅ **Completed** |
| **Quick Theme Popover** | Glassmorphic floating popover from Sidebar Palette icon for instant switching of mode, OLED, accent colors, and font sizes. | Frontend | 2026‑10‑26 | ✅ **Completed** |
| **Saved Filter Views (`SavedFilterView`)** | Save custom combinations of filters (tags, dates, project, sorting, search term) into one-click quick access chips in the Sidebar. | Frontend | 2026‑10‑27 | ✅ **Completed** |
| **Release v0.2.7** | Version bump to 0.2.7, zero warnings on Oxlint, tsc -b passing, verified live in Chrome. | Release Manager | 2026‑10‑28 | ✅ **Completed** |

### 📌 Jalon v0.2.8 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Prompt Snippets & Templates Library** | Quick snippet modal (`/templates` or button in prompt bar) with variable replacement (e.g. `{code}`, `{file}`, `{goal}`) for repetitive prompt workflows. | Frontend / UX | 2026‑11‑01 | ✅ **Completed** |
| **Offline Cache & PWA Service Worker** | Cache static assets, UI icons, and fonts for instant cold starts and partial offline resilience. | DevOps / Web | 2026‑11‑03 | ✅ **Completed** |
| **Release v0.2.8** | Version bump to 0.2.8, zero warnings on Oxlint, live browser verification, Service Worker active. | Release Manager | 2026‑11‑05 | ✅ **Completed** |

### 📌 Jalon v0.2.9 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Interactive Code Block Enhancements** | Fullscreen code reader modal with `createPortal`, intra-code line filtering search, line number and wrap toggles, multi-language direct execution lens (Bash, Python, Node). | Frontend | 2026‑11‑08 | ✅ **Completed** |
| **Transcript Search & Jump-to-Message** | In-conversation floating search overlay (`TranscriptSearchOverlay.tsx`) with `Ctrl+F` shortcut, match counter `x / y`, `Enter`/`Shift+Enter` navigation, and centered smooth scroll jump with active ring highlight. | Frontend | 2026‑11‑10 | ✅ **Completed** |
| **Release v0.2.9** | Version bump to 0.2.9 in frontend and backend, 0 Oxlint warnings, full Vite & TypeScript build passing, verified live in Chrome DevTools. | Release Manager | 2026‑11‑12 | ✅ **Completed** |

### 📌 Jalon v0.2.10 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Enhanced Artifacts Explorer Studio** | Full-featured modal with instant search, category chips (Tous, Markdown, Code, Plans & Tâches), rendered vs raw markdown toggle, line numbers toggle, intra-document text search & counter, and document statistics bar. | Frontend / UX | 2026‑11‑15 | ✅ **Completed** |
| **Live Voice Waveform Studio & Dictation Hub** | 60 FPS canvas-based audio waveform equalizer using `AudioContext` + `AnalyserNode`, floating glassmorphic recording hub, live interim transcript preview, validate/cancel buttons, and Escape key listener. | Frontend / Audio | 2026‑11‑18 | ✅ **Completed** |
| **Release v0.2.10** | Version bump to 0.2.10 across frontend and backend, zero warnings on Oxlint, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑11‑20 | ✅ **Completed** |

### 📌 Jalon v0.2.11 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Workspace Git Visual Graph & Commit Inspector** | Visual git commit timeline graph with interactive node rails, branch/HEAD badges, commit search, 1-click SHA copy, and full commit diff inspector in `GitTab.tsx`. | Frontend / Git | 2026‑11‑25 | ✅ **Completed** |
| **Interactive Context Pruning & Compaction Studio** | Surgical context compactor modal (`ContextCompactorModal.tsx`) with automatic turn-based pruning (1/2/3 turns), selective step pruning, real-time token savings calculation, safety backup to `transcript_full.jsonl`, and `/prune` slash command. | Frontend / AI | 2026‑11‑28 | ✅ **Completed** |
| **Release v0.2.11** | Semantic version bump to 0.2.11 across frontend & backend, 0 Oxlint warnings/errors, tsc -b passing, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑11‑30 | ✅ **Completed** |

### 📌 Jalon v0.2.12 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Multi-Tab Terminal Studio & Shell Selector** | Multi-tab terminal interface (`TerminalTab.tsx`) with dynamic shell detection (`GET /api/terminal/shells` supporting PowerShell, CMD, Git Bash on Windows), per-tab persistent PTY sessions and history, and active shell indicator badge. | DevOps / Web | 2026‑12‑05 | ✅ **Completed** |
| **ANSI Color Theme Synchronisation** | Real-time ANSI palette synchronisation adapting XTerm color schemes on-the-fly (`getXTermTheme`) based on active UI theme changes (Ares, Sienna, Catppuccin, OLED, Dark, Light). | Frontend | 2026‑12‑08 | ✅ **Completed** |
| **Session Branch Visualiser & Context Memory Bookmarks** | Tree genealogy explorer (`SessionBranchModal.tsx`) tracking SQLite parent conversation lineage, interactive fork checkpoints, turn-level context bookmarks (`POST/DELETE /api/conversations/{id}/bookmarks`), and `/branch` / `/bookmark` slash commands. | Frontend / AI | 2026‑12‑10 | ✅ **Completed** |
| **Release v0.2.12** | Version bump to 0.2.12, 0 Oxlint warnings/errors, tsc -b passing, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑12‑12 | ✅ **Completed** |

### 📌 Jalon v0.2.13 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Backend `GET /api/git/file-versions` Endpoint** | Extraction asynchrone des versions HEAD (original) et working tree (modified) pour comparaison sémantique complète et gestion robuste des chemins Windows. | Backend / Git | 2026‑12‑18 | ✅ **Completed** |
| **Monaco Code Lens & Semantic Diff Studio** | Intégration complète de `@monaco-editor/react` isolé en chunk Rollup dédié (`dist/assets/monaco-*.js`), éditeur classique et Diff côte-à-côte avec Code Lens (`⚡ Exécuter`, `💡 Expliquer avec Antigravity`, `💾 Enregistrer`, `📋 Copier`), détection auto 19 langages, word-wrap et minimap. | Frontend | 2026‑12‑22 | ✅ **Completed** |
| **Points d'Intégration UI & Commandes Slash** | Intégration de `/editor`, `/studio`, `/diff`, boutons Studio dans blocs de code chat, volet fichiers, GitTab et en-tête ChatCanvas. | Frontend / UX | 2026‑12‑24 | ✅ **Completed** |
| **Release v0.2.13** | Version bump à 0.2.13, 0 warning/erreur Oxlint, tsc -b passing, 39 tests unitaires pytest backend validés, vérification live Chrome DevTools, commit & tag v0.2.13 poussé vers GitHub. | Release Manager | 2026‑12‑25 | ✅ **Completed** |

### 📌 Jalon v0.2.14 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **AI Prompt Optimizer & Meta-Prompt Studio** | Optimiseur de prompt interactif (`/optimize`, `/metaprompt`), score de clarté heuristique, détection des ambiguïtés, complétion de contexte et enrichissement agentique. | Frontend / AI | 2026‑12‑28 | ✅ **Completed** |
| **Backend File CRUD & Fast Search API** | Endpoints `/api/files/create`, `/create-dir`, `/rename`, `/delete` avec validation stricte de sécurité (anti-traversal, protection racine), et `/api/files/search` optimisé avec filtrage et limitation de profondeur. | Backend | 2026‑12‑30 | ✅ **Completed** |
| **Workspace Monaco File Editor Suite** | Remplacement de `<textarea>` par Monaco Editor (`@monaco-editor/react`) dans `WorkspacePanel`, système d'onglets multiples (`openTabs`), indicateurs dirty (`●`), confirmation fermeture, barre de statut (Lg/Col/Langue/Encodage/Taille/Ctrl+S), formatage du code (`Shift+Alt+F`), breadcrumb de navigation. | Frontend / IDE | 2027‑01‑02 | ✅ **Completed** |
| **File Tree Management Toolbar & Actions** | Barre d'outils arborescence (`+ Fichier`, `+ Dossier`, `Actualiser`, champ de filtrage/recherche temps réel), création et renommage inline, confirmation modale de suppression, actions au survol. | Frontend / UX | 2027‑01‑03 | ✅ **Completed** |
| **Release v0.2.14** | Version bump à 0.2.14, 0 warning/erreur Oxlint, tsc -b passing, 49/49 tests pytest validés, vérification live Chrome DevTools, commit & tag v0.2.14 poussé vers GitHub. | Release Manager | 2027‑01‑04 | ✅ **Completed** |

### 📌 Jalon v0.2.15 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Integrated Terminal Split View** | Vue divisée Monaco Editor + terminal interactif xterm synchronisé (`TerminalTab`) avec le dossier du fichier actif, tiroir inférieur redimensionnable, boutons d'action rapide `Exécuter dans le terminal` (`.py`, `.js`, `.ts`, `.sh`, `.ps1`), `cd ici`, présélections de hauteur (160px/260px/420px) et raccourci global `Ctrl+\``. | Frontend / Terminal | 2027‑01‑06 | ✅ **Completed** |
| **Release v0.2.15** | Version bump à 0.2.15, 0 warning/erreur Oxlint, tsc -b passing, build production optimisé, vérification live Chrome DevTools, commit & tag v0.2.15 poussé vers GitHub. | Release Manager | 2027‑01‑07 | ✅ **Completed** |

### 📌 Jalon v0.2.16 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Suite Fichiers Pro & Productivité** | Palette Quick Open (`Ctrl+P` / `Cmd+P`) avec recherche rapide et navigation clavier, Import/Upload de fichiers par glisser-déposer (`POST /api/files/upload`), Duplication sécurisée de fichiers (`POST /api/files/duplicate`), Menu contextuel des onglets (Fermer autres/droite/enregistrés/tout, Dupliquer, Copier chemin), Annulation/Diff avec la version disque (`Monaco Diff`), et Icônes de fichiers stylisées par extension (`FileIcon.tsx`). | Frontend / IDE | 2027‑01‑10 | ✅ **Completed** |
| **Release v0.2.16** | Version bump à 0.2.16, 0 warning/erreur Oxlint (54 fichiers), tsc -b passing, build production optimisé, 52/52 tests pytest validés, vérification live Chrome DevTools, commit & tag v0.2.16 poussé vers GitHub. | Release Manager | 2027‑01‑11 | ✅ **Completed** |

### 📌 Jalon v0.2.17 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Recherche Globale & Remplacement Workspace** | Moteur de recherche et remplacement multi-fichiers complet : regex, casse sensible (`Aa`), mot entier (`\b`), filtres d'inclusion/exclusion glob, limitation de profondeur et protection junctions Windows. Volet dédié `WorkspaceSearchPanel.tsx` (340px) intégré dans `WorkspacePanel.tsx`, saut direct avec surbrillance dans l'éditeur Monaco, prévisualisation Monaco Diff avant remplacement, remplacement unitaire ou atomique par lot avec dry-run. Raccourcis globaux `Ctrl+Shift+F` et `Ctrl+Shift+H`. | Frontend / IDE | 2027‑01‑15 | ✅ **Completed** |
| **Release v0.2.17** | Version bump à 0.2.17 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (55 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (10.89s), 61/61 tests unitaires pytest backend validés, vérification live Chrome DevTools, commit & tag v0.2.17 poussé vers GitHub. | Release Manager | 2027‑01‑16 | ✅ **Completed** |

### 📌 Jalon v0.2.18 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Git Stash & Interactive Conflict Resolver Studio** | Gestion complète de la pile de stashes Git (`stash save` avec option `-u`, `stash pop`, `stash apply`, `stash drop`, `stash clear`), prévisualisation immédiate du diff complet dans Monaco Diff Studio, studio interactif de résolution 3-way des conflits de fusion (`GitConflictModal.tsx` avec actions "Garder la nôtre", "Garder la leur", édition manuelle et auto-stage `git add`), et Cherry-Pick interactif 1-clic depuis la timeline des commits avec confirmation et gestion des conflits. | Git / IDE | 2027‑01‑22 | ✅ **Completed** |
| **Release v0.2.18** | Version bump à 0.2.18 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (60 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (17.24s), 64/64 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.18 poussé vers GitHub. | Release Manager | 2027‑01‑23 | ✅ **Completed** |

### 📌 Jalon v0.2.19 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **AI Inline Copilot & Ghost Text Actions dans Monaco Studio** | Suggestions de code inline ("ghost text") en temps réel pendant la saisie dans Monaco Editor via backend FIM ultra-rapide (<400ms avec cache LRU 256 entrées), acceptation fluide via touche `Tab` ou rejet via `Échap`, raccourci global `Alt+C` avec persistance `localStorage`, et Studio de Code Actions IA contextuelles (`CopilotActionModal.tsx` avec Refactoriser, Typage strict, Documenter, Générer tests unitaires, et prévisualisation Monaco Diff avant application). Intégré dans Monaco Studio et WorkspacePanel. | AI / IDE | 2027‑01‑28 | ✅ **Completed** |
| **Release v0.2.19** | Version bump à 0.2.19 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (62 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (16.27s), 74/74 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.19 poussé vers GitHub. | Release Manager | 2027‑01‑29 | ✅ **Completed** |

### 📌 Jalon v0.2.20 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Interactive Git Rebase & Visual Branch Manager Studio** | Gestionnaire visuel de branches (sous-onglet dédié `Branches` dans `GitTab.tsx`, télémétrie de la branche active avec upstream et badges ahead/behind, création avec point de départ et checkout immédiat, fusion fast-forward / `--no-ff` avec détection automatique des conflits, suppression sécurisée avec gardes branches actives/protégées et fallback force `-D`, renommage 1-clic). Studio de rebase interactif visuel (`GitRebaseModal.tsx` avec réordonnancement up/down des commits, actions `pick`, `reword` avec édition inline du message, `squash` et `drop`, automatisation `git rebase -i` via script helper sans invite terminal, bannière amber de rebase en cours avec actions `continue` et `abort`). | Git / IDE | 2027‑02‑02 | ✅ **Completed** |
| **Release v0.2.20** | Version bump à 0.2.20 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (63 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (15.74s), 82/82 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.20 poussé vers GitHub. | Release Manager | 2027‑02‑03 | ✅ **Completed** |

### 📌 Jalon v0.2.21 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Multi-Workspace & Project Switcher Studio** | Modal studio universel (`ProjectSwitcherModal.tsx`) accessible via raccourci global `Ctrl+Alt+W`, pill workspace dans `ChatInput`, bouton Sidebar, et commandes `/workspace` / `/project`. Carte Hero du projet actif avec badge pulsation, navigation clavier (`Haut`/`Bas`/`Entrée`/`Échap`), détection automatique des runtimes (Node.js, Python, PHP, Rust, Go, Docker avec support monorepo `frontend/`, `backend/`), extraction des dépendances, package managers et frameworks. Dashboard de diagnostic de santé avec actions 1-clic directes (`npm install`, `python -m venv venv`) transmises au terminal interactif. Bascule de workspace fluide et continue sans interruption du chat actif avec toasts informatifs. | Workspace / Web | 2027‑02‑06 | ✅ **Completed** |
| **Release v0.2.21** | Version bump à 0.2.21 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (64 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (11.35s), 91/91 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.21 poussé vers GitHub. | Release Manager | 2027‑02‑07 | ✅ **Completed** |

### 📌 Jalon v0.2.22 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Monaco Multi-Cursor & Minimap Annotations Studio** | Support complet des curseurs multiples avec raccourcis VS Code étendus (`Alt+Click`, `Ctrl+D` sélection occurrence suivante, `Ctrl+Shift+L` sélection globale, `Ctrl+Alt+Haut/Bas` insertion verticale) et compteur dynamique de curseurs actifs `[ X curseurs ]` dans la barre d'état avec bouton de réinitialisation 1-clic ou `Échap`. Endpoint backend haute performance `GET /api/git/file-diff-ranges` analysant les hunks unifiés `git diff -U0 HEAD` (fichiers modifiés, ajoutés, supprimés et non suivis). Heatmap visuelle en temps réel des lignes Git sur la gouttière (`.monaco-git-gutter-*`), la minimap et la règle d'ensemble (overview ruler). Badge de synthèse Git dans la barre d'état (`+A ~M -D`) avec navigation clavier et boutons (`F7` modification suivante, `Shift+F7` précédente) avec centrage fluide. Intégration unifiée sur l'éditeur embarqué (`WorkspacePanel.tsx`) et le studio plein écran (`MonacoStudioModal.tsx`). | IDE / Web | 2027‑02‑10 | ✅ **Completed** |
| **Release v0.2.22** | Version bump à 0.2.22 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (65 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (36.79s), 95/95 tests unitaires pytest backend validés (100% de réussite), commit & tag v0.2.22 poussé vers GitHub. | Release Manager | 2027‑02‑11 | ✅ **Completed** |

### 📌 Jalon v0.2.23 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Git Remote Manager & Interactive Tag Publisher Studio** | Gestion complète des remotes Git (ajouter, renommer, supprimer, tester la latence et la connectivité `git ls-remote`, changer origin/upstream), synchronisation bidirectionnelle sélective (Fetch / Push avec `--set-upstream` et `--force-with-lease`), studio visuel de gestion de tags (annotés vs légers, création assistée par suggestions SemVer automatiques `Patch` / `Minor` / `Major`, suppression locale et distante, push unitaire ou global `--tags`), et Interactive Release Publisher avec génération automatique de changelog basée sur les Conventional Commits, éditeur/aperçu Markdown et publication dual-mode (`gh` CLI si disponible ou redirection assistée GitHub Web). | Git / Release | 2027‑02‑14 | ✅ **Completed** |
| **Release v0.2.23** | Version bump à 0.2.23 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (68 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 97/97 tests unitaires pytest backend validés (100% de réussite), commit & tag v0.2.23 poussé vers GitHub. | Release Manager | 2027‑02‑15 | ✅ **Completed** |

### 📌 Jalon v0.2.24 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Header Tools Navigation & Quota Analytics Studio** | Refonte ergonomique du header principal et du volet latéral : déplacement des outils généraux (`Éditeur`, `Branches`, `Crons`, `Règles`, `Export`) dans le header du volet latéral avec scroll horizontal fluide, barre de défilement stylisée et boutons fléchés interactifs gauche/droite. Conservation des accès directs essentiels dans le header principal (`Quotas`, `Recherche chat`, `Volet latéral`). Vérification et fiabilisation de l'affichage des quotas Google Cloud/Antigravity en temps réel avec précision décimale, descriptions officielles de quota et formatage localisé des dates de réinitialisation. | UI / UX | 2027‑02‑16 | ✅ **Completed** |
| **Release v0.2.24** | Version bump à 0.2.24 (`package.json`, `package-lock.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (68 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, commit & tag v0.2.24 poussé vers GitHub. | Release Manager | 2027‑02‑16 | ✅ **Completed** |

### 📌 Jalon v0.2.25 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Diagnostic & Résolution de la Surconsommation de Tokens (Parité IDE Antigravity)** | Diagnostic approfondi de l'écart de consommation de tokens entre l'IDE Antigravity et le WebUI : identification des causes racines (effort de réflexion `high` forcé par défaut consommant des dizaines de milliers de tokens CoT cachés même sur des messages courts, absence de compactage proactif automatique réingérant tout l'historique non élagué à chaque tour, `--add-dir` redondant avec `cwd` provoquant une double injection de l'arborescence workspace, et `ecoMode` inactif par défaut). | Core / LLM | 2027‑02‑18 | ✅ **Completed** |
| **Architecture d'Effort Adaptatif & Modèles Économes** | Remplacement de l'effort par défaut forcé à `high` par un effort équilibré `medium` (et `low` pour les requêtes courtes/conversationnelles < 50 caractères telles que "oui", "continue", "1"). Baisse drastique des tokens de réflexion internes (CoT) jusqu'à 80% d'économie sans perte de performance. | Core / LLM | 2027‑02‑18 | ✅ **Completed** |
| **Gestionnaire de Budget de Contexte & Sliding Window Checkpoint** | Moteur multi-étapes `context_budget.py` plafonnant les tokens réingérés à chaque tour (budget par défaut de 35k tokens pour parité IDE). Élagage progressif : 1) sorties d'outils volumineuses archivées dans `transcript_full.jsonl`, 2) blocs de réflexion CoT obsolètes, 3) condensation des réponses verbeuses, 4) sliding window context checkpoint préservant l'objectif du Tour 1 et les N derniers tours utilisateur. | Core / Storage | 2027‑02‑18 | ✅ **Completed** |
| **Télémétrie Context Budget, Anneau ContextRing & Studio d'Élagage** | Affichage de l'anneau de contexte indexé sur le budget cible (`14.2k / 35k`), popover détaillé avec jauge de budget et alertes dynamiques, studio d'élagage avec action 1-clic d'application du budget, paramètres utilisateur configurables et commande rapide `/budget`. | UI / Frontend | 2027‑02‑18 | ✅ **Completed** |
| **Release v0.2.25** | Version bump à 0.2.25 (`package.json`, `package-lock.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (68 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 105/105 tests unitaires pytest backend validés (100% de réussite), commit & tag v0.2.25 poussé vers GitHub. | Release Manager | 2027‑02‑18 | ✅ **Completed** |

### 📌 Jalon v0.2.26 – Terminé
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Passerelle API Universelle pour Applications Externes & Actions Groupées** | Endpoints standard OpenAI `/v1/chat/completions`, `/v1/models` et API Agent native `/api/v1/agent/run` pour connecter Cursor, Continue.dev, LangChain, OpenWebUI. Gestion complète des clés d'API dans les paramètres avec actions groupées (bulk revocation, bulk rotation de clés avec auto-reveal, copie groupée `.env`, export instantané `.env` et `.json`, bascule de visibilité collective, recherche temps réel et filtres Toutes/Utilisées/Inactives). | Core / API | 2027‑02‑20 | ✅ **Completed** |
| **Correctifs de Fiabilité & Service Worker PWA** | Correction de l'erreur 403 Forbidden sur l'accès aux arborescences de fichiers d'espaces de travail sous Windows (normalisation des séparateurs de chemin `/` et `\`). Correction de l'incompatibilité de préchargement `modulePreload` sur le Service Worker PWA éliminant l'avertissement cross-world mismatch. | Web / Core | 2027‑02‑20 | ✅ **Completed** |
| **Release v0.2.26** | Version bump à 0.2.26 (`package.json`, `package-lock.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (68 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 105/105 tests unitaires backend validés (100% de réussite), commit & tag v0.2.26 poussé vers GitHub. | Release Manager | 2027‑02‑20 | ✅ **Completed** |

### 📌 Jalon v0.2.27 – Terminé : Mémoire Continue, Recherche FTS5 & Robustesse des Modèles Locaux
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Mémoire Persistante Curatée & Profil Utilisateur Dynamique (`USER.md` + `MEMORY.md`)** | Architecture de mémoire à deux niveaux inspirée de Agent Antigravity : `USER.md` (profil, préférences et habitudes de code de l'utilisateur) et `MEMORY.md` (connaissances et spécificités techniques apprises par l'agent sur le projet). Injection en snapshot immuable (*frozen snapshot*) au démarrage de session pour préserver intégralement le prompt cache Gemini/Anthropic, outil agent `memory` (add/replace/remove) pour apprentissage autonome en cours de session, et onglet de gestion visuelle dans les Paramètres. | Core / AI | 2027‑02‑23 | ✅ **Completed** |
| **Moteur de Recherche Plein-Texte Cross-Sessions (SQLite FTS5 + Trigram)** | Indexation automatique temps réel de l'intégralité des messages, appels d'outils et résultats dans une base SQLite locale avec extensions FTS5 et tokenizer Trigram. Recherche instantanée ultra-rapide (< 10 ms) à travers toutes les conversations historiques avec surlignage d'extraits (*snippets* contextuels) et filtres par modèle, outil, date et projet. Modal dédiée avec raccourci global `Ctrl+Shift+K` / `Cmd+Shift+K`. | Core / Search | 2027‑02‑25 | ✅ **Completed** |
| **Moteur de Réparation d'Appels d'Outils pour Modèles Locaux (`tool-call-repair`)** | Normaliseur de flux inspiré d'Antigravity Core (`stream-normalizer` & `grammar-repair`) pour fiabiliser les petits modèles et modèles locaux (Ollama, Mistral, Qwen, DeepSeek). Détecte les appels d'outils émis sous forme de blocs markdown bruts ou de JSON tronqué, répare la syntaxe à la volée et les promeut en événements d'exécution d'outils natifs sans interruption. | Core / LLM | 2027‑02‑27 | ✅ **Completed** |
| **Auto-Curator de Compétences & Gestionnaire de Cycle de Vie des Skills** | Orchestrateur de maintenance des compétences inspiré d'Antigravity : suivi d'activité (`last_used_at`, `use_count`), transitions automatiques non-destructives (`active` ➔ `stale` après 14j ➔ `archived` après 30j), audit journalisé `.curator_ledger.jsonl`, protection des skills épinglés (📌) et bouton de sweep dans les Paramètres. | Core / Skills | 2027‑03‑01 | ✅ **Completed** |
| **Release v0.2.27** | Version bump à 0.2.27 (`package.json`, `package-lock.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (70 fichiers), 0 erreur TypeScript, build production Vite optimisé, 120/120 tests unitaires backend validés (100% de réussite). | Release Manager | 2027‑03‑01 | ✅ **Completed** |

### 📌 Jalon v0.2.28 – Terminé : Catalogue MCP 1-Clic, Widget Progress Card & Diagnostics
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Catalogue Visuel de Serveurs MCP Clés en Main (Store 1-Clic)** | Bibliothèque visuelle intégrée de 73 serveurs MCP officiels pré-configurés (GitHub, GitLab, Docker, Supabase, Vercel, Stripe, Linear, Notion, PostgreSQL, Cloudflare, Sentry, Brave Search, etc. issus des manifestes Agent Antigravity). Activation et configuration assistée en 1-clic avec dialogue de variables d'environnement, détection intelligente des transports (`http` / `stdio`), test de connectivité en direct (*ping test* live) et ajout dynamique dans le fichier de configuration sans redémarrage. | Core / MCP | 2027‑03‑04 | ✅ **Completed** |
| **Widget de Progression Dynamique "Sur Place" (`Progress Card` / Replace-on-Write)** | Composant de plan d'action interactif inspiré de l'architecture Antigravity Core (`progress-card-store.ts`, `progress-card-input.ts`). Évite le spam de messages de statut dans le fil de discussion en maintenant un widget unique réactif (*replace-on-write*) persisté en base SQLite (`session_progress_cards`), avec indicateurs d'étapes (en attente, en cours, terminé, erreur) et jauge de progression animée. | UI / Frontend | 2027‑03‑06 | ✅ **Completed** |
| **Centre de Diagnostics Système & Outil de Réparation ("Doctor")** | Tableau de bord de santé unifié accessible depuis la barre latérale et les raccourcis système (inspiré d'Antigravity Core `doctor.ts` et Antigravity `doctor.py`) : surveillance en direct de la RAM, de l'espace disque résiduel, du CPU, de l'environnement Python/Git, de l'intégrité de la base SQLite (`PRAGMA integrity_check`) et de l'index FTS5, avec sondes de latence concurrentes vers Google Cloud, OpenAI, Anthropic et OpenRouter. Outil *Auto-Doctor* pour nettoyage automatique et réindexation en un clic. | DevOps / IDE | 2027‑03‑08 | ✅ **Completed** |
| **Compréhension & Résumé Automatique des Liens Web (`link-understanding`)** | Détection et interception automatique des URLs brutes dans les prompts utilisateur (Antigravity Core + Antigravity). Filtrage SSRF strict (rejet des IP privées et loopback), extraction du contenu principal en arrière-plan sans publicité avec cache SQLite de 24h, et injection instantanée d'un résumé structuré dans le contexte du modèle pour des réponses immédiates sur les pages web et documentations partagées. | Core / Web | 2027‑03‑10 | ✅ **Completed** |
| **Release v0.2.28** | Version bump à 0.2.28 (`package.json`, `package-lock.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (73 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 134/134 tests unitaires backend validés (100% de réussite). | Release Manager | 2027‑03‑10 | ✅ **Completed** |

### 📌 Jalon v0.2.29 : Mobilité, Accès Distant Sécurisé (Tailscale & Web Push) & Isolation Git
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Accès Distant Zéro-Configuration via Tailscale & Web Push PWA** | Intégration native Tailscale MagicDNS (Antigravity Core) permettant d'accéder en toute sécurité à Antigravity WebUI depuis n'importe quel smartphone ou machine distante sans ouvrir de ports de pare-feu. Notifications Web Push natives sur mobile PWA dès qu'un build, test ou analyse se termine. | Core / Net | 2027‑03‑14 | ✅ **Completed** |
| **Passerelle Omnicanale de Messagerie (Bot Telegram & Discord)** | Passerelle de messagerie sécurisée permettant de piloter Antigravity depuis un smartphone via Telegram ou Discord (Antigravity). Appairage d'appareil par code PIN à 8 caractères sans ambiguïté, réception d'alertes en temps réel et approbation interactive à distance de commandes sensibles. | Core / Gateway | 2027‑03‑17 | ✅ **Completed** |
| **Isolation des Sous-Agents par Git Worktrees** | Création automatique d'un répertoire `git worktree` isolé pour chaque sous-agent exécutant une tâche en arrière-plan (Antigravity Core + Antigravity). Protège les fichiers ouverts dans Monaco et auto-nettoyage sélectif des worktrees propres sans commits non fusionnés. | Git / Core | 2027‑03‑20 | ✅ **Completed** |
| **Code Kernel Persistant avec RPC de Tools** | Interpréteur Python persistant interactif permettant à l'agent d'exécuter des pipelines d'automatisation complexes en appelant ses propres outils (`view_file`, `list_dir`, `grep_search`, `tools.call`) directement via RPC local in-process, réduisant la consommation de tokens de 80% sur les tâches de masse (Antigravity). | Core / Runtimes | 2027‑03‑23 | ✅ **Completed** |
| **Release v0.2.29** | Version bump à 0.2.29 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 erreur Oxlint (76 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 145/145 tests unitaires backend validés (100% de réussite). | Release Manager | 2027‑03‑23 | ✅ **Completed** |

### 📌 Jalon v0.3.0 : Canvas Vivant Interactif & Mémoire Vectorielle Embarquée (LanceDB + Auto-Recall)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Canvas Vivant & Documents Interactifs (`Canvas Documents`)** | Architecture complète de materialization de widgets et web apps dynamiques isolés dans des iframes hautement sécurisées (headers CSP stricts, sandbox scripts). Bridge bidirectionnel postMessage synchronisant le thème Antigravity et l'auto-resize réactif du document. Endpoints REST complets de création, listing, suppression, prévisualisation immédiate et distribution statique d'assets. Studio visuel Canvas interactif avec éditeur de code et galerie de documents (Antigravity Core `src/canvas/` & `extensions/canvas/`). | Frontend / UX | 2027‑03‑25 | ✅ **Completed** |
| **Mémoire Vectorielle Embarquée & Hook Auto-Recall (LanceDB-Compatible)** | Système de stockage vectoriel local persistant SQLite avec calcul déterministe d'embeddings par défaut (384 dimensions, zéro dépendance externe) et compatibilité pluggable OpenAI, Ollama et Gemini. Moteur de recherche sémantique par similarité cosinus avec pondération d'importance temporelle. Hook d'auto-recall intelligent filtrant les salutations triviales et injectant automatiquement les top-K souvenirs pertinents dans le bloc `<recalled_memories>` avant chaque tour de modèle. Interface de gestion et simulateur en temps réel (Antigravity Core `extensions/memory-lancedb/` + Antigravity `agent/memory_manager.py`). | Core / AI | 2027‑03‑27 | ✅ **Completed** |
| **Release v0.3.0** | Version bump majeur à 0.3.0 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 erreur Oxlint, 0 erreur TypeScript (`tsc -b`), build production Vite optimisé, 155 tests unitaires backend validés avec 100% de passage. Intégration ergonomique des modals Canvas Studio et Mémoire Vectorielle dans la barre latérale. | Release Manager | 2027‑03‑27 | ✅ **Completed** |

### 📌 Jalon v0.3.1 : Database Explorer & Visual SQL Query Studio (SQLite Studio)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Database Discovery & Schema Introspection** | Service backend FastAPI (`/api/database/discover`, `/schema`) avec détection automatique des bases SQLite dans le workspace, introspection des tables, vues, colonnes, types, clés primaires et estimations de lignes. | Backend / DB | 2027‑03‑28 | ✅ **Completed** |
| **Interactive Monaco SQL Editor & Execution Engine** | Studio modal complet (`DatabaseStudioModal.tsx`) avec éditeur Monaco SQL (`Ctrl+Enter`), exécution sécurisée avec timeout 10s et limitation de lignes, télémétrie en temps réel (durée ms, total lignes), historique persistant des requêtes et modèles de requêtes rapides. | Frontend / IDE | 2027‑03‑28 | ✅ **Completed** |
| **Data Grid & Instant CSV/JSON Export** | Grille de données interactive avec tri multi-colonnes, pagination dynamique, indicateurs de valeurs NULL, et export instantané des résultats de requêtes au format CSV et JSON (`/api/database/export`). | Frontend / UX | 2027‑03‑28 | ✅ **Completed** |
| **Intégration & Internationalisation Complète** | Commandes slash `/db`, `/database`, `/sql`, raccourci studio dans la barre latérale, et couverture i18n intégrale à 100% sur les 15 langues dans `locales.json`. | Release Manager | 2027‑03‑28 | ✅ **Completed** |

### 📌 Jalon v0.3.2 : Docker & Container Management Studio (Docker Studio)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Docker Engine Detection & Workspace Scan** | Détection automatique de Docker / Podman, scan récursif sécurisé des Dockerfiles et docker-compose (.yml, .yaml), validation des chemins workspace. | Backend / DevOps | 2027‑03‑28 | ✅ **Completed** |
| **Container Lifecycle & Interactive Inspection** | Démarrage, arrêt, redémarrage, suppression sécurisée de conteneurs, inspection des stats en temps réel (CPU %, RAM, ports exposés). | Backend / Frontend | 2027‑03‑28 | ✅ **Completed** |
| **Streaming Logs & In-Container Command Execution** | Visualisation et tail paramétrable des journaux conteneurs, exécution de commandes arbitraires avec capture stdout/stderr et code de retour. | Frontend / UX | 2027‑03‑28 | ✅ **Completed** |
| **Docker Studio UI Modal & Compose Controls** | Interface complète glassmorphic (`DockerStudioModal.tsx`), actions compose rapides (up/down/build), bouton studio et intégration barre latérale. | Frontend / UX | 2027‑03‑28 | ✅ **Completed** |

### 📌 Prochaines étapes v0.4 (Cockpit Web IDE & Agentic Workspace)
| Milestone | Description |
|---|---|
| **Terminal Split-View & Multi-Panel Workspace** – Vue scindée multi-terminaux (horizontal/vertical) et dock d'outils intégré. |
| **Monaco Extended Diagnostics & Live Linting** – Analyse syntaxique et diagnostics en temps réel (Python ruff/flake8, JS/TS eslint). |
| **Collaborative Session Sharing & Live Preview** – Partage de session par lien direct, synchronisation WebSocket et inspection conjointe. |
| **Multi-Agent Visual Orchestration Studio** – Visualisation des sous-agents en temps réel, graphe d'exécution et pilotage hiérarchique. |
| **Release v0.4 – Premium Web IDE & Autonomous Agent Cockpit** |





