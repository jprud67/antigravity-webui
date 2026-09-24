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

### 📌 Sprint 2 (v0.2.6 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Analytics & Quota Dashboard** | Live gauges per model, token breakdown (input/output/thinking), Google account status, `/analytics` command. | Frontend / API | 2026‑10‑18 | ✅ **Completed** |
| **Advanced Sidebar Filters & Sorting** | Expandable filter drawer with multi-tag selector, date ranges (all/today/7d/30d), project filter, sort order (recent/oldest/A-Z/Z-A). | Frontend | 2026‑10‑20 | ✅ **Completed** |
| **Complete ZIP Archive Export** | Full markdown export in streaming ZIP archive (`/api/conversations/export/zip`), bulk ZIP export & filtered ZIP export. | Backend / Frontend | 2026‑10‑22 | ✅ **Completed** |
| **Release v0.2.6** | Version bump to 0.2.6, zero warnings on Oxlint, verified live in Chrome browser. | Release Manager | 2026‑10‑23 | ✅ **Completed** |

### 📌 Sprint 3 (v0.2.7 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Advanced Theme Engine** | 9 preset accent swatches + arbitrary custom hex picker (`<input type="color">`), dynamic CSS variables (`--accent`, `--accent-bg`, `--accent-hover`, `--focus-ring`, `--focus-glow`), local storage persistence. | Frontend | 2026‑10‑24 | ✅ **Completed** |
| **OLED Pure Black Mode** | High-contrast `#000000` pitch black background, `#050505` sidebar, and `#0a0a0a` cards for battery savings and maximum contrast. | Frontend | 2026‑10‑25 | ✅ **Completed** |
| **Quick Theme Popover** | Glassmorphic floating popover from Sidebar Palette icon for instant switching of mode, OLED, accent colors, and font sizes. | Frontend | 2026‑10‑26 | ✅ **Completed** |
| **Saved Filter Views (`SavedFilterView`)** | Save custom combinations of filters (tags, dates, project, sorting, search term) into one-click quick access chips in the Sidebar. | Frontend | 2026‑10‑27 | ✅ **Completed** |
| **Release v0.2.7** | Version bump to 0.2.7, zero warnings on Oxlint, tsc -b passing, verified live in Chrome. | Release Manager | 2026‑10‑28 | ✅ **Completed** |

### 📌 Sprint 4 (v0.2.8 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Prompt Snippets & Templates Library** | Quick snippet modal (`/templates` or button in prompt bar) with variable replacement (e.g. `{code}`, `{file}`, `{goal}`) for repetitive prompt workflows. | Frontend / UX | 2026‑11‑01 | ✅ **Completed** |
| **Offline Cache & PWA Service Worker** | Cache static assets, UI icons, and fonts for instant cold starts and partial offline resilience. | DevOps / Web | 2026‑11‑03 | ✅ **Completed** |
| **Release v0.2.8** | Version bump to 0.2.8, zero warnings on Oxlint, live browser verification, Service Worker active. | Release Manager | 2026‑11‑05 | ✅ **Completed** |

### 📌 Sprint 5 (v0.2.9 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Interactive Code Block Enhancements** | Fullscreen code reader modal with `createPortal`, intra-code line filtering search, line number and wrap toggles, multi-language direct execution lens (Bash, Python, Node). | Frontend | 2026‑11‑08 | ✅ **Completed** |
| **Transcript Search & Jump-to-Message** | In-conversation floating search overlay (`TranscriptSearchOverlay.tsx`) with `Ctrl+F` shortcut, match counter `x / y`, `Enter`/`Shift+Enter` navigation, and centered smooth scroll jump with active ring highlight. | Frontend | 2026‑11‑10 | ✅ **Completed** |
| **Release v0.2.9** | Version bump to 0.2.9 in frontend and backend, 0 Oxlint warnings, full Vite & TypeScript build passing, verified live in Chrome DevTools. | Release Manager | 2026‑11‑12 | ✅ **Completed** |

### 📌 Sprint 6 (v0.2.10 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Enhanced Artifacts Explorer Studio** | Full-featured modal with instant search, category chips (Tous, Markdown, Code, Plans & Tâches), rendered vs raw markdown toggle, line numbers toggle, intra-document text search & counter, and document statistics bar. | Frontend / UX | 2026‑11‑15 | ✅ **Completed** |
| **Live Voice Waveform Studio & Dictation Hub** | 60 FPS canvas-based audio waveform equalizer using `AudioContext` + `AnalyserNode`, floating glassmorphic recording hub, live interim transcript preview, validate/cancel buttons, and Escape key listener. | Frontend / Audio | 2026‑11‑18 | ✅ **Completed** |
| **Release v0.2.10** | Version bump to 0.2.10 across frontend and backend, zero warnings on Oxlint, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑11‑20 | ✅ **Completed** |

### 📌 Sprint 7 (v0.2.11 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Workspace Git Visual Graph & Commit Inspector** | Visual git commit timeline graph with interactive node rails, branch/HEAD badges, commit search, 1-click SHA copy, and full commit diff inspector in `GitTab.tsx`. | Frontend / Git | 2026‑11‑25 | ✅ **Completed** |
| **Interactive Context Pruning & Compaction Studio** | Surgical context compactor modal (`ContextCompactorModal.tsx`) with automatic turn-based pruning (1/2/3 turns), selective step pruning, real-time token savings calculation, safety backup to `transcript_full.jsonl`, and `/prune` slash command. | Frontend / AI | 2026‑11‑28 | ✅ **Completed** |
| **Release v0.2.11** | Semantic version bump to 0.2.11 across frontend & backend, 0 Oxlint warnings/errors, tsc -b passing, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑11‑30 | ✅ **Completed** |

### 📌 Sprint 8 (v0.2.12 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Multi-Tab Terminal Studio & Shell Selector** | Multi-tab terminal interface (`TerminalTab.tsx`) with dynamic shell detection (`GET /api/terminal/shells` supporting PowerShell, CMD, Git Bash on Windows), per-tab persistent PTY sessions and history, and active shell indicator badge. | DevOps / Web | 2026‑12‑05 | ✅ **Completed** |
| **ANSI Color Theme Synchronisation** | Real-time ANSI palette synchronisation adapting XTerm color schemes on-the-fly (`getXTermTheme`) based on active UI theme changes (Ares, Sienna, Catppuccin, OLED, Dark, Light). | Frontend | 2026‑12‑08 | ✅ **Completed** |
| **Session Branch Visualiser & Context Memory Bookmarks** | Tree genealogy explorer (`SessionBranchModal.tsx`) tracking SQLite parent conversation lineage, interactive fork checkpoints, turn-level context bookmarks (`POST/DELETE /api/conversations/{id}/bookmarks`), and `/branch` / `/bookmark` slash commands. | Frontend / AI | 2026‑12‑10 | ✅ **Completed** |
| **Release v0.2.12** | Version bump to 0.2.12, 0 Oxlint warnings/errors, tsc -b passing, full production build, live browser verification via Chrome DevTools. | Release Manager | 2026‑12‑12 | ✅ **Completed** |

### 📌 Sprint 9 (v0.2.13 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Backend `GET /api/git/file-versions` Endpoint** | Extraction asynchrone des versions HEAD (original) et working tree (modified) pour comparaison sémantique complète et gestion robuste des chemins Windows. | Backend / Git | 2026‑12‑18 | ✅ **Completed** |
| **Monaco Code Lens & Semantic Diff Studio** | Intégration complète de `@monaco-editor/react` isolé en chunk Rollup dédié (`dist/assets/monaco-*.js`), éditeur classique et Diff côte-à-côte avec Code Lens (`⚡ Exécuter`, `💡 Expliquer avec Antigravity`, `💾 Enregistrer`, `📋 Copier`), détection auto 19 langages, word-wrap et minimap. | Frontend | 2026‑12‑22 | ✅ **Completed** |
| **Points d'Intégration UI & Commandes Slash** | Intégration de `/editor`, `/studio`, `/diff`, boutons Studio dans blocs de code chat, volet fichiers, GitTab et en-tête ChatCanvas. | Frontend / UX | 2026‑12‑24 | ✅ **Completed** |
| **Release v0.2.13** | Version bump à 0.2.13, 0 warning/erreur Oxlint, tsc -b passing, 39 tests unitaires pytest backend validés, vérification live Chrome DevTools, commit & tag v0.2.13 poussé vers GitHub. | Release Manager | 2026‑12‑25 | ✅ **Completed** |

### 📌 Sprint 10 (v0.2.14 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **AI Prompt Optimizer & Meta-Prompt Studio** | Optimiseur de prompt interactif (`/optimize`, `/metaprompt`), score de clarté heuristique, détection des ambiguïtés, complétion de contexte et enrichissement agentique. | Frontend / AI | 2026‑12‑28 | ✅ **Completed** |
| **Backend File CRUD & Fast Search API** | Endpoints `/api/files/create`, `/create-dir`, `/rename`, `/delete` avec validation stricte de sécurité (anti-traversal, protection racine), et `/api/files/search` optimisé avec filtrage et limitation de profondeur. | Backend | 2026‑12‑30 | ✅ **Completed** |
| **Workspace Monaco File Editor Suite** | Remplacement de `<textarea>` par Monaco Editor (`@monaco-editor/react`) dans `WorkspacePanel`, système d'onglets multiples (`openTabs`), indicateurs dirty (`●`), confirmation fermeture, barre de statut (Lg/Col/Langue/Encodage/Taille/Ctrl+S), formatage du code (`Shift+Alt+F`), breadcrumb de navigation. | Frontend / IDE | 2027‑01‑02 | ✅ **Completed** |
| **File Tree Management Toolbar & Actions** | Barre d'outils arborescence (`+ Fichier`, `+ Dossier`, `Actualiser`, champ de filtrage/recherche temps réel), création et renommage inline, confirmation modale de suppression, actions au survol. | Frontend / UX | 2027‑01‑03 | ✅ **Completed** |
| **Release v0.2.14** | Version bump à 0.2.14, 0 warning/erreur Oxlint, tsc -b passing, 49/49 tests pytest validés, vérification live Chrome DevTools, commit & tag v0.2.14 poussé vers GitHub. | Release Manager | 2027‑01‑04 | ✅ **Completed** |

### 📌 Sprint 11 (v0.2.15 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Integrated Terminal Split View** | Vue divisée Monaco Editor + terminal interactif xterm synchronisé (`TerminalTab`) avec le dossier du fichier actif, tiroir inférieur redimensionnable, boutons d'action rapide `Exécuter dans le terminal` (`.py`, `.js`, `.ts`, `.sh`, `.ps1`), `cd ici`, présélections de hauteur (160px/260px/420px) et raccourci global `Ctrl+\``. | Frontend / Terminal | 2027‑01‑06 | ✅ **Completed** |
| **Release v0.2.15** | Version bump à 0.2.15, 0 warning/erreur Oxlint, tsc -b passing, build production optimisé, vérification live Chrome DevTools, commit & tag v0.2.15 poussé vers GitHub. | Release Manager | 2027‑01‑07 | ✅ **Completed** |

### 📌 Sprint 12 (v0.2.16 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Suite Fichiers Pro & Productivité** | Palette Quick Open (`Ctrl+P` / `Cmd+P`) avec recherche rapide et navigation clavier, Import/Upload de fichiers par glisser-déposer (`POST /api/files/upload`), Duplication sécurisée de fichiers (`POST /api/files/duplicate`), Menu contextuel des onglets (Fermer autres/droite/enregistrés/tout, Dupliquer, Copier chemin), Annulation/Diff avec la version disque (`Monaco Diff`), et Icônes de fichiers stylisées par extension (`FileIcon.tsx`). | Frontend / IDE | 2027‑01‑10 | ✅ **Completed** |
| **Release v0.2.16** | Version bump à 0.2.16, 0 warning/erreur Oxlint (54 fichiers), tsc -b passing, build production optimisé, 52/52 tests pytest validés, vérification live Chrome DevTools, commit & tag v0.2.16 poussé vers GitHub. | Release Manager | 2027‑01‑11 | ✅ **Completed** |

### 📌 Sprint 13 (v0.2.17 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Recherche Globale & Remplacement Workspace** | Moteur de recherche et remplacement multi-fichiers complet : regex, casse sensible (`Aa`), mot entier (`\b`), filtres d'inclusion/exclusion glob, limitation de profondeur et protection junctions Windows. Volet dédié `WorkspaceSearchPanel.tsx` (340px) intégré dans `WorkspacePanel.tsx`, saut direct avec surbrillance dans l'éditeur Monaco, prévisualisation Monaco Diff avant remplacement, remplacement unitaire ou atomique par lot avec dry-run. Raccourcis globaux `Ctrl+Shift+F` et `Ctrl+Shift+H`. | Frontend / IDE | 2027‑01‑15 | ✅ **Completed** |
| **Release v0.2.17** | Version bump à 0.2.17 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (55 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (10.89s), 61/61 tests unitaires pytest backend validés, vérification live Chrome DevTools, commit & tag v0.2.17 poussé vers GitHub. | Release Manager | 2027‑01‑16 | ✅ **Completed** |

### 📌 Sprint 14 (v0.2.18 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Git Stash & Interactive Conflict Resolver Studio** | Gestion complète de la pile de stashes Git (`stash save` avec option `-u`, `stash pop`, `stash apply`, `stash drop`, `stash clear`), prévisualisation immédiate du diff complet dans Monaco Diff Studio, studio interactif de résolution 3-way des conflits de fusion (`GitConflictModal.tsx` avec actions "Garder la nôtre", "Garder la leur", édition manuelle et auto-stage `git add`), et Cherry-Pick interactif 1-clic depuis la timeline des commits avec confirmation et gestion des conflits. | Git / IDE | 2027‑01‑22 | ✅ **Completed** |
| **Release v0.2.18** | Version bump à 0.2.18 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (60 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (17.24s), 64/64 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.18 poussé vers GitHub. | Release Manager | 2027‑01‑23 | ✅ **Completed** |

### 📌 Sprint 15 (v0.2.19 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **AI Inline Copilot & Ghost Text Actions dans Monaco Studio** | Suggestions de code inline ("ghost text") en temps réel pendant la saisie dans Monaco Editor via backend FIM ultra-rapide (<400ms avec cache LRU 256 entrées), acceptation fluide via touche `Tab` ou rejet via `Échap`, raccourci global `Alt+C` avec persistance `localStorage`, et Studio de Code Actions IA contextuelles (`CopilotActionModal.tsx` avec Refactoriser, Typage strict, Documenter, Générer tests unitaires, et prévisualisation Monaco Diff avant application). Intégré dans Monaco Studio et WorkspacePanel. | AI / IDE | 2027‑01‑28 | ✅ **Completed** |
| **Release v0.2.19** | Version bump à 0.2.19 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (62 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (16.27s), 74/74 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.19 poussé vers GitHub. | Release Manager | 2027‑01‑29 | ✅ **Completed** |

### 📌 Sprint 16 (v0.2.20 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Interactive Git Rebase & Visual Branch Manager Studio** | Gestionnaire visuel de branches (sous-onglet dédié `Branches` dans `GitTab.tsx`, télémétrie de la branche active avec upstream et badges ahead/behind, création avec point de départ et checkout immédiat, fusion fast-forward / `--no-ff` avec détection automatique des conflits, suppression sécurisée avec gardes branches actives/protégées et fallback force `-D`, renommage 1-clic). Studio de rebase interactif visuel (`GitRebaseModal.tsx` avec réordonnancement up/down des commits, actions `pick`, `reword` avec édition inline du message, `squash` et `drop`, automatisation `git rebase -i` via script helper sans invite terminal, bannière amber de rebase en cours avec actions `continue` et `abort`). | Git / IDE | 2027‑02‑02 | ✅ **Completed** |
| **Release v0.2.20** | Version bump à 0.2.20 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (63 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (15.74s), 82/82 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.20 poussé vers GitHub. | Release Manager | 2027‑02‑03 | ✅ **Completed** |

### 📌 Sprint 17 (v0.2.21 – Terminé)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Multi-Workspace & Project Switcher Studio** | Modal studio universel (`ProjectSwitcherModal.tsx`) accessible via raccourci global `Ctrl+Alt+W`, pill workspace dans `ChatInput`, bouton Sidebar, et commandes `/workspace` / `/project`. Carte Hero du projet actif avec badge pulsation, navigation clavier (`Haut`/`Bas`/`Entrée`/`Échap`), détection automatique des runtimes (Node.js, Python, PHP, Rust, Go, Docker avec support monorepo `frontend/`, `backend/`), extraction des dépendances, package managers et frameworks. Dashboard de diagnostic de santé avec actions 1-clic directes (`npm install`, `python -m venv venv`) transmises au terminal interactif. Bascule de workspace fluide et continue sans interruption du chat actif avec toasts informatifs. | Workspace / Web | 2027‑02‑06 | ✅ **Completed** |
| **Release v0.2.21** | Version bump à 0.2.21 (`package.json`, `main.py`, `updater.py`, `sw.js`), 0 warning/erreur Oxlint (64 fichiers), 0 erreur TypeScript (`tsc -b`), build production Vite optimisé (11.35s), 91/91 tests unitaires pytest backend validés (100% de réussite), vérification live Chrome DevTools, commit & tag v0.2.21 poussé vers GitHub. | Release Manager | 2027‑02‑07 | ✅ **Completed** |

### 📌 Sprint 18 (v0.2.22 – Prochaine étape)
| Milestone | Description | Owner | Target | Status |
|---|---|---|---|---|
| **Option A : Monaco Multi-Cursor & Minimap Annotations Studio** *(Recommandé)* | Support des curseurs multiples avec raccourcis VS Code étendus (`Ctrl+D`, `Alt+Click`), annotations de diagnostic en marge et minimap enrichie avec heatmap des modifications Git. | IDE / Web | 2027‑02‑10 | ⏳ Planned |
| **Option B : Git Remote Manager & Interactive Tag Publisher Studio** | Gestion des remotes Git (add, remove, rename, set-url), push/fetch sélectifs, création et signature de tags avec publication GitHub Releases 1-clic. | Git / Release | 2027‑02‑13 | ⏳ Planned |
| **Option C : Integrated Docker & Container Management Studio** | Détection automatique des `Dockerfile` et `docker-compose.yml`, inspection de l'état des conteneurs, logs en streaming et contrôles start/stop/restart. | DevOps / IDE | 2027‑02‑16 | ⏳ Planned |

### 📌 Long‑Term (v0.4 – 3‑6 months)
| Milestone | Description |
|---|---|
| **Full IDE Integration** – Embed code editor (Monaco) with live linting, file explorer, and terminal view. |
| **Collaborative Editing** – Real‑time shared sessions via WebSocket + CRDT. |
| **Marketplace** – Allow community‑built plugins/themes to be published and installed from within the UI. |
| **AI‑Assisted Coding** – Deep integration with Antigravity’s LLM back‑end for code suggestions, refactoring, and documentation generation. |
| **Enterprise Security** – SSO, granular permissions, audit logs. |
| **Release v0.4 – Premium‑grade Web IDE** |


