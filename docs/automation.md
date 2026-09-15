# Autonomie d'Antigravity WebUI — crons, tâches & mises à jour

> **Dernière mise à jour** : 2026-09-15
> **Principe directeur** : les tâches planifiées, les tâches (kanban) et le
> système de mise à jour appartiennent **entièrement à Antigravity WebUI**.
> Aucune dépendance à Hermes : stockage, cache et exécution vivent dans le
> dossier de données de l'application (`~/.gemini/antigravity-cli/`, surchargeable
> via `ANTIGRAVITY_DATA_DIR`).

---

## 1. Tâches planifiées (crons) — 100 % internes

| Composant | Emplacement | Rôle |
|---|---|---|
| Store | `backend/app/services/cron_store.py` | Lecture/écriture de `cron/jobs.json`, heartbeat, calcul des prochaines exécutions |
| Ticker | `backend/app/services/cron_ticker.py` | Boucle interne (20 s), exécute les jobs dus via `agy` headless |
| API | `backend/app/api/crons.py` | CRUD + « exécuter maintenant » (UI : *Planificateur de Tâches*) |
| Données | `~/.gemini/antigravity-cli/cron/` | `jobs.json`, `ticker_heartbeat`, `output/<job>_<date>.log` |

**Fonctionnement :**
1. Un job dû (`next_run_at <= maintenant`, état `scheduled`) est lancé par le
   ticker — dans le processus du serveur, démarré avec lui (`lifespan` FastAPI).
2. Exécution via `agy --dangerously-skip-permissions --print-timeout 20m -p "<prompt>"`.
3. La sortie complète est journalisée dans `cron/output/`, puis le job est
   reprogrammé (`next_run_at` recalculé) avec `last_status` / `last_log`.
4. L'UI affiche le statut du ticker via le heartbeat (`Ticker Actif` ≤ 180 s).

**Bascule automatique de compte Google (quota atteint) :**
- Si la sortie d'un job contient une erreur de quota, le ticker bascule vers
  un compte sain (`switch_to_next_healthy_account` — les comptes non épuisés
  sont prioritaires, le compte fautif est mis de côté 30 min) puis **relance
  immédiatement la tâche** (jusqu'à 3 tentatives). Le détail est consigné dans
  le journal du job (`last_failover`).
- La même logique s'applique aux **tours de chat** (voir §4).

## 2. Tâches (kanban) — base propre à l'application

- Base SQLite : `~/.gemini/antigravity-cli/webui_kanban.db`
  (surchargeable via `ANTIGRAVITY_KANBAN_DB`).
- Aucune lecture/écriture dans les données de Hermes.

## 3. Recherche de mise à jour automatique — principe Hermes

Analyse de référence effectuée sur le code de **Hermes Agent** :
- `hermes_cli/banner.py::check_for_updates()` — cache disque
  (`~/.hermes/.update_check`, **TTL 6 h**, invalidé si la révision/version
  change), vérification non bloquante, jamais d'exception ;
- endpoint dashboard `/api/hermes/update/check` — payload
  `{install_method, current_version, behind, update_available, can_apply, commits[]}`,
  paramètre `force` qui court-circuite le cache ;
- `hermes update` — refus si l'arbre est modifié, résolution des conflits
  préservée (stash), **marqueur « update-incomplete »** pour survivre à une
  interruption, puis relance/rechargement.

Implémentation dans Antigravity WebUI (`backend/app/services/updater.py`) :

| Principe Hermes | Équivalent Antigravity WebUI |
|---|---|
| Cache 6 h versionné par commit | `~/.gemini/antigravity-cli/.update_check` (`ts`, `commit`, `payload`) |
| Vérif non bloquante | Thread de prefetch au démarrage + **rafraîchissement périodique 6 h** |
| `force` (bouton « Check now ») | `GET /api/system/update/check?force=true` (onglet *Mises à jour*) |
| Badge « update available » | Badge « MàJ » dans la sidebar + bandeau + comparaison de commits |
| Marqueur anti-interruption | `~/.gemini/antigravity-cli/.update_incomplete` (posé pendant l'apply, retiré après ; avertissement au prochain démarrage si présent) |
| Pull sûr + pas d'état bancal | refus si arbre modifié, `git pull --ff-only`, rebuild, **rollback automatique** si le build échoue |
| Relance du service | `systemctl restart antigravity-webui` (Linux) ; message explicite sous macOS/Windows |

## 4. Bascule de compte Google (chat + jobs)

Dans `backend/app/services/execution_manager.py` (tours de chat) et
`cron_ticker.py` (jobs) :
- détection quota dans les événements d'erreur ET les mises à jour d'étape ;
- `switch_to_next_healthy_account()` : les comptes non épuisés d'abord, le
  compte fautif est marqué épuisé 30 min ;
- **relance immédiate** de la tâche après bascule (jusqu'à 5 tentatives pour
  un tour de chat, 3 pour un job) ; l'UI affiche un toast + une note dans le
  fil de conversation (« Basculement automatique de compte ») ;
- si aucun compte sain n'existe : message clair demandant d'attendre la
  réinitialisation ou d'ajouter un compte.

## 5. Audit autonome du projet (optionnel)

- Script : `scripts/antigravity_audit.sh` (100 % autonome, journaux dans
  `<repo>/logs/`, aucune dépendance Hermes).
- Planification possible via le crontab système :
  `0,30 * * * * /root/antigravity-webui/scripts/antigravity_audit.sh`
- Il lance un cycle d'audit via `agy`, puis build / commit / push
  (auteur `jprud67`, jamais de Co-Authored-By).

## 6. Ce qui reste lié à Hermes (par conception)

- `backend/app/api/rules.py` : lecture des mémoires/journaux Hermes
  (intégration Antigravity ↔ Hermes décrite dans `AGENTS.md`) — c'est un
  **choix d'intégration**, pas une dépendance technique du cron/tâches/updater.
- `backend/app/api/skills.py` : le navigateur de skills affiche aussi les
  skills Hermes (en plus des skills Antigravity).
