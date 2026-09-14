# 🛸 Antigravity WebUI

> Interface web moderne et autonome pour piloter **Google Antigravity CLI (`agy`)** sans jamais toucher au terminal.

---

## 🌟 Fonctionnalités Clés

- **💬 Chat Canvas & Streaming Temps Réel :**
  - Streaming token par token via WebSockets.
  - Blocs **"Thinking / Processus de raisonnement"** repliables pour suivre la logique interne de l'agent sans surcharger la vue.
  - Cartes d'exécution d'outils interactives (commandes bash, lecture de fichiers, modifications avec statut).
  - Mode **Auto-Run** activable pour autoriser l'exécution des outils sans interruption.

- **📁 Explorateur de Workspaces & Projets :**
  - Changement instantané de répertoire de travail (`/root`, projets spécifiques).
  - Explorateur de fichiers sur le serveur pour ajouter de nouveaux workspaces autorisés.

- **📑 Visualiseur d'Artifacts & Documents :**
  - Volet latéral dédié pour inspecter les documents Markdown, diagrammes Mermaid, plans et scripts générés par l'agent.
  - Copie dans le presse-papier et téléchargement direct en un clic.

- **⚙️ Configuration & Sélection de Modèles :**
  - Détection dynamique des modèles supportés (`gemini-3.8-flash-high`, `gemini-3.1-pro-high`, `claude-sonnet-4-6`, etc.).
  - Réglage du niveau d'effort de raisonnement (*low*, *medium*, *high*).
  - Bascule du mode d'exécution (`accept-edits` ou `plan`).

- **⚡ Raccourcis de Commandes Slash :**
  - Menu interactif intégré pour insérer les commandes `/goal`, `/plan`, `/grill-me`, `/browser`, `/schedule`, `/boost`.

---

## 🏗️ Architecture

```
antigravity-webui/
├── backend/
│   ├── app/
│   │   ├── api/             # Endpoints REST (conversations, artifacts, settings, workspaces)
│   │   ├── services/
│   │   │   ├── agy_driver.py # Spawner agy CLI stream-json & WebSocket streaming
│   │   │   └── storage.py    # SQLite & parser de transcripts ~/.gemini/antigravity-cli/
│   │   ├── config.py
│   │   └── main.py          # Serveur FastAPI & service SPA
│   ├── requirements.txt
│   └── run.py
├── frontend/
│   ├── src/
│   │   ├── components/      # Sidebar, ChatCanvas, ChatInput, ArtifactViewer, Modals
│   │   ├── services/        # Client REST & WebSocket
│   │   └── types/           # Modèles TypeScript
│   ├── package.json
│   └── vite.config.ts
├── start.sh                 # Script de démarrage unifié
└── README.md
```

---

## 🚀 Démarrage Rapide

### 1. Prérequis
- Python 3.10+
- Node.js 18+
- Antigravity CLI installé (`agy` dans le PATH ou `/root/.local/bin/agy`)

### 2. Lancement

Exécutez simplement :

```bash
./start.sh
```

Le script configure l'environnement virtuel Python, compile le frontend si nécessaire et démarre le serveur web sur **`http://localhost:8000`**.

Pour spécifier un port ou une adresse d'écoute différente :

```bash
HOST=0.0.0.0 PORT=9000 ./start.sh
```

---

## 🔒 Sécurité & Permissions

Antigravity WebUI s'intègre nativement avec votre configuration locale `~/.gemini/antigravity-cli/settings.json`. Les permissions d'outils et répertoires de confiance sont appliqués fidèlement à chaque session.

---

## 👤 Auteur

- **jprud67** (<jprud67@gmail.com>)
