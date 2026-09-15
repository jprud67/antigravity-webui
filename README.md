# 🛸 Antigravity WebUI

> Interface web moderne et **autonome** pour piloter **Google Antigravity CLI (`agy`)** sans jamais toucher au terminal — chat persistant, multi-comptes Google avec bascule automatique, planificateur intégré et mises à jour automatiques.

---

## ✨ Nouveautés

- **🔄 Bascule automatique de compte Google (quota atteint) :**
  - Détection en **~1 seconde** directement dans les journaux d'`agy` (au lieu d'attendre ses retries internes, qui peuvent durer des dizaines de minutes).
  - Bascule immédiate vers un **compte non épuisé** puis **relance automatique de la tâche** — pour le chat **et** les tâches planifiées.
  - Le compte fautif est mis de côté 30 min ; si aucun compte sain n'existe, un message clair vous invite à patienter ou à ajouter un compte.

- **🚀 Recherche de mise à jour automatique (principe Hermes) :**
  - Vérification en arrière-plan (cache 6 h) + bouton « Rechercher les mises à jour » ; badge **« MàJ »** dans la sidebar et onglet dédié dans les Paramètres.
  - Commandes `/update` et `/check-update`.
  - Application en 1 clic : `git pull --ff-only`, rebuild du frontend, **rollback automatique** si le build échoue, puis redémarrage du service. Marqueur anti-interruption inclus.

- **⏰ Planificateur de tâches & crons 100 % intégré :**
  - Ticker interne (20 s) démarré avec le serveur — les jobs sont créés et exécutés **par l'application elle-même** (via `agy` headless), sans dépendance externe.
  - Journal d'exécution par run, statuts détaillés (`ok`, `timeout`, `quota_exhausted`…), bascule quota incluse.
  - Accessible via le **Planificateur de Tâches** ou la commande `/crons`.

- **💻 Multiplateforme — Linux · macOS · Windows :**
  - Backend portable (aucun chemin codé en dur), lancement `./start.sh` (Linux/macOS) ou `start.bat` (Windows), terminal via `pywinpty` sous Windows.
  - Détails : [`docs/platform-support.md`](docs/platform-support.md).

- **💬 Tâches persistantes & fiables :**
  - Les exécutions **continuent même si vous fermez ou rechargez le navigateur** ; resynchronisation d'état en direct à la reconnexion.
  - File d'attente de messages, **guidage en cours d'exécution** (`/steer`), interruption propre (`/interrupt`).
  - Bandeaux d'état : bascule de compte, quota, reconnexion — tout est visible dans le fil.

---

## 🌟 Fonctionnalités Clés

- **💬 Chat Canvas & Streaming Temps Réel :**
  - Streaming token par token via WebSockets ; blocs **« Thinking »** repliables.
  - Cartes d'exécution d'outils interactives (bash, lecture/écriture de fichiers, statuts).
  - Rendu natif des commandes (`/usage`, `/credits`, `/changelog`…) en tableaux et cartes.
  - Mode **Auto-Run** activable pour autoriser l'exécution des outils sans interruption.

- **🔑 Gestion multi-comptes Google :**
  - Onglet **Paramètres → Google** : ajout par flux OAuth, bascule manuelle, suppression.
  - Candidats triés par disponibilité — les comptes non épuisés sont toujours préférés.

- **📁 Workspaces & Explorateur de fichiers :**
  - Changement instantané de répertoire de travail ; explorateur pour ajouter des workspaces.
  - Aperçu des fichiers et navigation directe dans les projets.

- **📑 Visualiseur d'Artifacts :**
  - Volet latéral pour inspecter Markdown, diagrammes Mermaid, diffs et scripts générés.
  - Copie presse-papier et téléchargement en un clic.

- **🖥️ Terminal intégré persistant :**
  - Session PTY conservée (scrollback restauré à la reconnexion), redimensionnement, redémarrage propre.

- **📋 Kanban & Tableau de tâches :**
  - Cartes de tâches (création, assignation, priorités, statuts) dans le panneau latéral.
  - Board d'exécution pour suivre les tâches en cours, bloquées et terminées.

- **🔀 Git & Diffs :**
  - Onglet Git (dépôts, historique) et **DiffViewer** pour relire les modifications.

- **⚙️ Configuration & Modèles :**
  - Détection dynamique des modèles (`gemini-3.8-flash-high`, `gemini-3.1-pro-high`, `claude-sonnet-4-6`, …), niveau d'effort (*low/media/high*), modes (`accept-edits` / `plan`).
  - Onglets de paramètres : modèles, permissions, skills, sécurité, apparence, langues, Google, conversation, **mises à jour**.

- **⚡ Commandes Slash :**
  - Chat : `/goal`, `/plan`, `/browser`, `/schedule`, `/boost`, `/steer`, `/queue`, `/interrupt`…
  - Système : `/update`, `/check-update`, `/usage`, `/credits`, `/changelog`, `/crons`, `/kanban`, `/google`, `/terminal`, `/git`, `/files`, `/workspace`…

- **🧠 Règles & Mémoire :**
  - Éditeur de règles intégré (journal d'architecture, mémoires) synchronisé avec l'environnement de travail.

---

## 🏗️ Architecture

```
antigravity-webui/
├── backend/
│   ├── app/
│   │   ├── api/                  # REST : conversations, artifacts, settings, workspaces,
│   │   │                         #        crons, kanban, terminal, google, updater…
│   │   ├── services/
│   │   │   ├── agy_driver.py         # Spawn agy CLI stream-json (+ supervision quota)
│   │   │   ├── execution_manager.py  # Tours persistants, files d'attente, failover comptes
│   │   │   ├── cron_store.py         # Stockage des tâches planifiées (100 % interne)
│   │   │   ├── cron_ticker.py        # Ticker interne : exécution des jobs + bascule quota
│   │   │   ├── quota_watch.py        # Détection quota en direct dans les journaux agy
│   │   │   ├── updater.py            # Vérification & application des MAJ (principe Hermes)
│   │   │   ├── google_auth.py        # Multi-comptes, bascule atomique, OAuth
│   │   │   ├── storage.py            # SQLite & parser de transcripts ~/.gemini/antigravity-cli/
│   │   │   ├── fs_watcher.py         # Synchronisation temps réel (SSE)
│   │   │   └── platform_utils.py     # Différences Linux / macOS / Windows
│   │   ├── config.py
│   │   └── main.py               # Serveur FastAPI & service SPA
│   ├── requirements.txt
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── components/           # Sidebar, ChatCanvas, ChatInput, ArtifactViewer, Modals…
│   │   ├── services/             # Client REST & WebSocket, i18n, commandes
│   │   └── types/                # Modèles TypeScript
│   ├── package.json
│   └── vite.config.ts
├── scripts/
│   └── antigravity_audit.sh      # Audit automatique autonome (optionnel)
├── docs/
│   ├── automation.md             # Crons, maj, bascule : tout est propre à l'app
│   ├── platform-support.md       # Linux / macOS / Windows
│   └── parity-hermes-webui.md    # Journal de parité & évolutions
├── start.sh                      # Démarrage Linux / macOS
├── start.bat                     # Démarrage Windows
└── README.md
```

**Données de l'application** (100 % locales, aucune dépendance externe) :
`~/.gemini/antigravity-cli/` — jobs planifiés, heartbeat du ticker, journaux d'exécution, base kanban, cache de mise à jour. Surchargeable via `ANTIGRAVITY_DATA_DIR`.

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- Python 3.10+
- Node.js 18+
- Antigravity CLI installé (`agy` dans le PATH ou `AGY_BIN` défini)

> **Plateformes supportées** : Linux, macOS et Windows — voir [`docs/platform-support.md`](docs/platform-support.md).

### 2. Lancement

Exécutez simplement :

```bash
./start.sh      # Linux / macOS
```

```bat
start.bat       :: Windows
```

Le script configure l'environnement virtuel Python, compile le frontend si nécessaire et démarre le serveur web sur **`http://localhost:8000`**.

Pour spécifier un port ou une adresse d'écoute différente :

```bash
HOST=0.0.0.0 PORT=9000 ./start.sh
```

---

## 🤖 Automatisation & Fiabilité

Tout le cycle de vie est géré **par l'application elle-même** (aucune dépendance à un orchestrateur externe) — voir [`docs/automation.md`](docs/automation.md) :

- **Quota Google** : détection en direct (~1 s), bascule de compte, relance de la tâche.
- **Tâches planifiées** : ticker interne, journaux par run, statuts honnêtes (`ok` / `timeout` / `quota_exhausted`).
- **Mises à jour** : vérification automatique (cache 6 h), application sécurisée avec rollback.
- **Audit du code (optionnel)** : `scripts/antigravity_audit.sh`, planifiable via le crontab système.

---

## 🔒 Sécurité & Permissions

- Antigravity WebUI s'intègre nativement avec `~/.gemini/antigravity-cli/settings.json` : permissions d'outils et répertoires de confiance appliqués fidèlement à chaque session.
- Les tokens des comptes Google sont stockés avec des permissions restrictives (`0600`) ; les bascules sont écrites de façon atomique.
- L'accès à l'interface est protégé par mot de passe — **changez le mot de passe par défaut** dès la première connexion (Paramètres → Sécurité).

---

## 👤 Auteur

- **jprud67** (<jprud67@gmail.com>)
