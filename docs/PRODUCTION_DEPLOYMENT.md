# Guide de Déploiement en Production — Antigravity WebUI v0.6.0-stable

Ce document décrit les procédures de déploiement, de durcissement de la sécurité et d'exploitation en production pour **Antigravity WebUI v0.6.0-stable**.

---

## 1. Architecture Système & Prérequis

Antigravity WebUI orchestre l'agent d'ingénierie logicielle autonome Google Antigravity CLI (`agy`) à travers une interface web moderne et des passerelles d'automatisation.

### Matrice des Dépendances
- **Système d'exploitation :** Linux (Debian 12+, Ubuntu 22.04+, RHEL 9+), macOS 13+, ou Windows 11.
- **Python :** Version 3.11 ou 3.12 (recommandé).
- **Node.js :** Version 20 LTS (pour la compilation des assets statiques via Vite).
- **Antigravity CLI :** Binaire officiel `agy` installé et accessible dans le `PATH` (ou configuré via `AGY_BIN`).
- **Base de données :** SQLite 3.37+ avec extensions FTS5 et mode WAL activé.

---

## 2. Variables d'Environnement et Configuration

Les paramètres d'exécution peuvent être configurés via des variables d'environnement système ou un fichier `.env` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `HOST` | `127.0.0.1` | Adresse d'écoute IP (`0.0.0.0` pour exposition réseau/reverse proxy). |
| `PORT` | `8000` | Port d'écoute HTTP / WebSocket. |
| `AGY_BIN` | Détection automatique | Chemin absolu vers l'exécutable `agy`. |
| `WEBUI_PASSWORD` | Optionnel | Mot de passe de verrouillage de session WebUI. |
| `JWT_SECRET` | Aléatoire sécurisé | Clé secrète de signature des jetons de session. |
| `TELEGRAM_BOT_TOKEN` | Optionnel | Jeton API du bot Telegram pour la passerelle de supervision et d'approbation. |

---

## 3. Durcissement de la Sécurité en Production

### 3.1. Contrôle d'Accès et Protection des Endpoints
- **Authentification systématique :** Tous les modules d'administration, d'orchestration (`/api/plugins`, `/api/watchdog`, `/api/sweeps`) et d'opérations Git sont verrouillés par authentification stricte (`require_auth`).
- **Filtrage des chemins système (`is_blocked_sensitive_path`) :**
  L'application interdit formellement tout accès ou traversée vers les dossiers système sensibles (`/etc`, `/proc`, `/sys`, `~/.ssh`, `~/.aws`, `~/.gnupg`).
- **Confinement des Workspaces (`is_safe_path`) :**
  Seuls les dossiers expressément enregistrés comme racines de workspaces autorisées peuvent être manipulés par l'agent ou téléchargés via l'API de fichiers.

### 3.2. Confinement Runtime et Ségrégation des Flux
- **Isolation du Kernel Python :**
  L'exécution de blocs de code Python est protégée par un timeout strict, avec redirection thread-local (`SafeStreamRedirect`) pour empêcher la contamination des flux logs système du serveur.
- **Identité Git Décentralisée :**
  La signature des commits s'appuie dynamiquement sur la configuration du workspace local ou du compte utilisateur (`git config`), sans aucune identité globale forcée en dur.

---

## 4. Persistance des Données & SQLite WAL

La base de données principale `conversation_summaries.db` stocke :
- L'historique et les résumés des conversations.
- L'index vectoriel et sémantique de mémoire (`vector_memories`).
- L'historique des audits de maintenance (`maintenance_history`).
- Le registre des alertes du Watchdog Sentinel (`watchdog_alerts`).

### Bonnes Pratiques SQLite en Production
1. **Mode WAL :** Le serveur active automatiquement `PRAGMA journal_mode=WAL` et `PRAGMA synchronous=NORMAL` pour un débit d'écriture concurrent optimal.
2. **Gestion des verrous :** Un timeout de verrouillage `PRAGMA busy_timeout=5000` (5 secondes) est appliqué sur l'ensemble des connexions.
3. **Sauvegarde à chaud :** Utiliser l'utilitaire SQLite officiel pour créer des sauvegardes consistantes sans arrêt de service :
   ```bash
   sqlite3 /root/.gemini/antigravity-cli/conversation_summaries.db ".backup /backup/antigravity_backup_$(date +%F).db"
   ```

---

## 5. Déploiement en Service Système (Systemd)

Pour une haute disponibilité sur un serveur Linux, déployez Antigravity WebUI sous forme de service systemd :

```ini
# /etc/systemd/system/antigravity-webui.service
[Unit]
Description=Antigravity WebUI Service
After=network.target

[Service]
Type=simple
User=antigravity
WorkingDirectory=/opt/antigravity-webui
ExecStart=/opt/antigravity-webui/start.sh
Restart=always
RestartSec=5
Environment=HOST=127.0.0.1
Environment=PORT=8000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Activation et démarrage du service :
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now antigravity-webui
sudo systemctl status antigravity-webui
```

---

## 6. Pipeline CI & Validation Avant Déploiement

Avant chaque mise en production, l'intégrité globale doit être validée localement ou via la CI GitHub Actions :

1. **Vérification de la qualité du code Python (Ruff) :**
   ```bash
   backend/venv/bin/ruff check backend
   ```
2. **Exécution intégrale de la suite de tests (Pytest) :**
   ```bash
   backend/venv/bin/pytest -q
   ```
3. **Contrôle qualité Frontend (Oxlint) :**
   ```bash
   cd frontend && npx oxlint
   ```
4. **Compilation Frontend de production (Vite) :**
   ```bash
   cd frontend && npm run build
   ```

---

## 7. Mises à Jour et Rollback Automatique

Le service Updater intégré (`/api/updater`) permet l'application des correctifs en un clic :
- Vérification des commits sur la branche amont `main` via `git pull --ff-only`.
- Recompilation automatique des assets frontend.
- **Rollback automatique :** Si la compilation échoue, l'Updater restaure immédiatement le commit précédent pour garantir la continuité de service.
