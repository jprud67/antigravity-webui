# Matrice de Parité : Hermes WebUI → Antigravity WebUI

> **Dernière mise à jour** : 2026-09-15 (ajout Phase H — Auto-Update)
> **Méthode** : analyse et alignement du code source réel (référence `/root/hermes-webui-ref`, cible `/root/antigravity-webui`)
> **Légende** : ✅ Complet | ⚠️ Partiel | ❌ Absent | N/A Non applicable

---

## 1. Synthèse Globale de Parité

| Domaine | Référence Hermes WebUI | État Antigravity WebUI | Statut |
|---|---|---|:---:|
| **Architecture Layout** | 3 panneaux (Sidebar, Chat central, Workspace rétractable) | 3 panneaux identiques avec redimensionnement et persistance | ✅ Complet |
| **Composer Footer** | Attachments fichiers, vocal, sélecteur modèle, jauge ContextRing, Stop/Send | Support complet drag & drop, paperclip, chips, STT vocal, ContextRing, Stop/Send | ✅ Complet |
| **Tour de Chat** | Streaming incrémental, file d'attente, arrêt d'urgence, régénération, retry | WebSocket avec heartbeat 5s, file `queue`/`steer`, stop propre de process group, retry bouton | ✅ Complet |
| **Traces Outils & Activité** | Groupement "Activity : N outils", accordéon, coloration, Mermaid | Accordéon "Activity : N", thinking rétractable, Prism + GFM, diagrammes Mermaid | ✅ Complet |
| **Approbations** | 4 choix (Une fois / Session / Toujours / Refuser), non-bloquant | Carte d'approbation inline non-bloquante avec les 4 décisions | ✅ Complet |
| **Gestion des Sessions** | Recherche titre/contenu, pin, archive, projets colorés, tags, export/import | Filtres instantanés, tags cliquables, pin, archive, export MD/JSON, import JSON complet | ✅ Complet |
| **Workspace (Panneau Droit)** | Arbre, fil d'Ariane, aperçu texte/md/images, dirty guard, badge git, `workspace://` | Arbre interactif, breadcrumbs, aperçu md/images, garde unsaved, badge git, liens `workspace://` | ✅ Complet |
| **Apparence & Thèmes** | 3 thèmes × 15+ skins Hermes × 4 tailles police, zero-flash | Système bi-axial complet, police S/M/L/XL, script inline anti-flash avant premier paint | ✅ Complet |
| **Centre de Contrôle** | Hub unifié à onglets (Conversation, Modèles, Système, Apparence, Préférences) | Modal Settings avec tab Session & Export, Modèles, Sécurité/Système, Apparence, Langues | ✅ Complet |
| **Commandes Slash** | Autocomplétion clavier, built-ins, pass-through agent | Menu flottant dynamique flèches/tab/enter, raccourcis locaux et transmission des inconnues | ✅ Complet |
| **Fiabilité & In-App UI** | Zéro dialogue natif, toasts, modales confirmation in-app, reconnexion auto | Système de Toasts (`showToast`) et Dialogues in-app (`showConfirm`), zéro `alert()`/`confirm()` | ✅ Complet |

---

## 2. Détail par Phase & Vérification

### Phase A — Layout & Design Tokens
- **A1 — 3 panneaux :** `App.tsx` orchestre `Sidebar`, `ChatCanvas` et `WorkspacePanel` (fermé par défaut, ouvert à la demande). ✅
- **A2 & A3 — Panneaux redimensionnables :** Drag bar avec clamp minimum/maximum et persistance dans le `localStorage`. ✅
- **A4 — Composer footer :** Ajout du support drag & drop de fichiers, bouton trombone avec sélecteur natif, bandeau de vignettes/chips détachables, et injection automatique dans le prompt sortant. ✅
- **A5 — Centre de Contrôle :** Modal centralisée avec navigation horizontale scrollable et onglets Session/Export, Modèles, Permissions, Skills, Sécurité/Système, Apparence, Langues, Comptes Google. ✅
- **A7 — Anti-flash pré-render :** Script inline dans `index.html` lisant `localStorage` et appliquant `theme`, `data-skin` et `data-font-size` à `<html>` avant le premier paint CSS. ✅

### Phase B — Tour de Chat (Streaming, File, Stop, Retry, Reconnexion)
- **B1 à B3 — Streaming fluide :** Événements WS NDJSON temps réel, AdaptiveCodeBlock avec coloration Prism et diagrammes Mermaid. ✅
- **B4 & B5 — Heartbeat & Reconnexion :** Heartbeat 5s côté client WS avec intervalle de ping/pong, bannière visuelle de reconnexion automatique en cas de rupture réseau. ✅
- **B6 & B7 — File d'attente & Stop :** Modes `queue` et `steer` dans `ws.ts`, bouton Stop pour interrompre immédiatement le subprocess group de l'agent. ✅
- **B8 & B9 — Fork & Retry :** Bouton `Bifurquer` (fork) par étape et bouton `Réessayer` (`RotateCcw`) sur le dernier tour assistant avec commande `/retry`. ✅
- **B16 à B19 — Activité outils :** Composant `ToolActivityFeed` regroupant les appels sous "Activity : N outils" replié par défaut avec persistance par message. ✅

### Phase C — Approbations
- **C1 & C2 — 4 choix non bloquants :** `ApprovalCard` propose : "Autoriser une fois", "Autoriser pour cette session", "Toujours autoriser" (ajout de règle), "Refuser". Aucune interruption du rendu ou des autres sessions. ✅

### Phase D — Sessions
- **D1 — Groupes de dates :** Aujourd'hui, Hier, 7 derniers jours, Plus tôt, et section dédiée `📦 Archives`. ✅
- **D2 — Recherche complète :** Recherche insensible à la casse sur les titres, métadonnées, projets, tags et extraits de conversations. ✅
- **D3 & D4 — Pin & Archive :** Toggles individuels et actions en lot pour épingler et archiver les sessions. ✅
- **D5 & D6 — Projets & Tags :** Attribution de projets avec palette de 8 couleurs distinctes et filtrage par puces tags cliquables `#tag`. ✅
- **D7 & D8 — Export / Import :**
  - Export unitaire et en lot Markdown (`.md`) et JSON complet (`.json`).
  - Import JSON réversible via `POST /api/conversations/import` compatible avec les exports Antigravity et les formats sessions Hermes. ✅
- **D10 — Titre d'onglet dynamique :** Le titre du document dans le navigateur reflète en permanence le nom de la session active (`${title} · Antigravity`). ✅

### Phase E — Workspace (Panneau Droit)
- **E1 — Arbre de fichiers :** Navigation récursive avec icônes de types et indicateurs de dossiers. ✅
- **E2 — Fil d'Ariane :** Breadcrumb cliquable au sommet de la prévisualisation pour remonter l'arborescence. ✅
- **E3 — Prévisualisation multi-formats :** Texte, code source avec coloration, bascule aperçu Markdown (`Eye`/`Code`), et rendu visuel des images (`.png`, `.jpg`, `.svg`, `.webp`, `.gif`). ✅
- **E6 — Garde modifications non sauvegardées :** `checkUnsavedChanges` avec dialogue in-app (`showConfirm`) lors du changement de fichier, d'onglet ou de fermeture. ✅
- **E7 — Badge Git :** Badge temps réel dans l'en-tête du workspace indiquant la branche active et le nombre de fichiers modifiés/non suivis. ✅
- **E9 — Protocole `workspace://` :** Les liens markdown `workspace://chemin` et les chemins de fichiers dans le chat émettent l'événement `open-workspace-file` qui ouvre automatiquement le panneau droit et charge le fichier. ✅

### Phase F — Apparence & Thèmes
- **F1 & F2 — Thème × Skins :** 3 modes (Système, Sombre, Clair) combinés avec 15+ palettes de skins Hermes (`data-skin`). ✅
- **F5 — Zéro flash :** Application immédiate synchrone dans `index.html`. ✅
- **F6 — Commande `/theme` :** Permet de basculer instantanément le thème ou le skin depuis le chat. ✅
- **F7 & F8 — Échelle typographique :** 4 paliers (Compact 13px, Défaut 14.5px, Confort 16px, Large 18px) pilotés par les variables CSS `--font-ui`, `--font-conversation`, `--font-mono`. ✅

### Phase G — Control Center, Commandes, Notifications & Dialogues
- **G1 à G4 — Hub Control Center :** Modal unifié avec onglet Conversation (métadonnées, export MD/JSON, import JSON, effacement, suppression), Modèles & Raisonnement, Préférences de saisie (Entrée vs Ctrl+Entrée), Système & Sécurité. ✅
- **G5 & G6 — Commandes slash :** Autocomplétion dynamique au clavier (flèches haut/bas, Tab/Entrée, Échap), commandes intégrées et transmission transparente des commandes agent inconnues. ✅
- **G7 & I7 — Zéro dialogue natif :**
  - Composant `Toast.tsx` avec conteneur global et méthode `showToast(message, type, duration)`.
  - Composant `AppDialog.tsx` avec conteneur global et méthode `showConfirm({ title, message, confirmText, destructive })`.
  - Éradication de 100% des 26 appels `alert()` et `confirm()` natifs du projet. ✅

### Phase H — Auto-Update « Hermes » (Système)
- **H1 — Vérification asynchrone :** contrôle non-bloquant au démarrage (thread dédié, cache 1 h dans `~/.gemini/antigravity_update_cache.json`) + vérification périodique côté client (30 min). ✅
- **H2 — Badge & commandes :** badge « MàJ » dans la sidebar, onglet « Mises à jour » des Paramètres (version, commit HEAD, branche, tag, liste des commits en attente) et commandes slash `/update` et `/check-update`. ✅
- **H3 — Application en 1 clic :** `git pull origin main` + rebuild frontend Vite + redémarrage du service systemd, avec confirmation in-app et rechargement automatique. ✅
