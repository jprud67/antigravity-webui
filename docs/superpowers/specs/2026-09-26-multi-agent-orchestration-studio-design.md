# Multi-Agent Visual Orchestration Studio — Spécification de Conception

**Date** : 2026-09-26  
**Auteur** : Antigravity Team  
**Statut** : Validé (Ready for Implementation Plan)  
**Jalon Roadmap** : Cockpit Web IDE & Agentic Workspace — Multi-Agent Visual Orchestration Studio  

---

## 1. Contexte & Objectifs

Dans Antigravity WebUI, l'orchestration de sous-agents s'exécute de façon asynchrone (via `invoke_subagent`, `dispatching-parallel-agents`, `manage_task`, ou l'isolation par Git Worktrees). Jusqu'à présent, le suivi de ces agents s'effectuait essentiellement au travers des messages de chat, d'un tableau de bord de tâches basique (`TaskDashboardModal.tsx`), ou de la gestion de branches worktree (`WorktreeDashboardModal.tsx`).

L'objectif de ce jalon est de fournir une interface de supervision et de contrôle visuelle de classe entreprise :
1. **Visualisation en DAG (Graphe Acyclique Dirigé)** : cartographie hiérarchique temps réel des relations parent ➔ sous-agents ➔ sous-agents imbriqués.
2. **Pilotage Hiérarchique en Direct** : injection de consignes prioritaires de guidage (`Steering`), arrêt unitaire immédiat ou arrêt en cascade récursif d'une branche entière d'agents.
3. **Inspection Contextuelle Exhaustive** : pour chaque agent sélectionné, observation en direct du flux de pensée (`thought`), de la timeline chronologique des outils invoqués, et du diff Git des fichiers modifiés dans son worktree isolé.
4. **Intégration Fluide** : modal studio plein écran avec raccourci global `Ctrl+Alt+A`, bouton header dynamique avec badge de statut pulsant (`🤖 X actifs`), commandes slash (`/orchestrator`, `/agents`, `/subagents`), et parité 100% sur 15 langues.

---

## 2. Architecture & Modèle de Données Backend

### 2.1 Nouveau Service : `backend/app/services/agent_orchestrator.py`

Le service agrège les sources de données suivantes pour une session donnée :
- **Transcripts Antigravity Brain** : analyse de `BRAIN_DIR / <conversation_id> / .system_generated / logs / transcript.jsonl` pour repérer les `tool_calls` du type `INVOKE_SUBAGENT`, les affectations d'identifiants (`subagent_id`, `conversation_id` enfant), et les messages d'état.
- **Dossiers de Sessions Enfants** : inspection récursive des répertoires `BRAIN_DIR / <child_subagent_id>` pour identifier les sous-agents de rang 2, 3, etc.
- **Processus Système Actifs** : corrélation avec `psutil` pour détecter les PIDs vivants, la consommation CPU/mémoire et les fichiers de log ouverts.
- **Git Worktrees** : corrélation avec `backend/app/services/git_worktree.py` pour identifier le dossier de travail isolé et la branche Git dédiée à chaque sous-agent.

### 2.2 Modèle de Nœud et Arête (DAG Schema)

```python
class AgentNodeRole(str, Enum):
    ROOT = "root"
    ARCHITECT = "architect"
    CODER = "coder"
    TESTER = "tester"
    REVIEWER = "reviewer"
    EXPLORER = "explorer"
    WORKER = "worker"

class AgentNodeStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

class AgentNodeMetrics(BaseModel):
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    duration_ms: int = 0
    cpu_percent: float = 0.0
    memory_mb: float = 0.0
    tool_call_count: int = 0
    token_count: Optional[int] = None

class AgentNode(BaseModel):
    id: str                               # Identifiant unique de l'agent / session
    name: str                             # Nom descriptif ou spécialisation
    parent_id: Optional[str] = None      # ID de l'agent parent (None pour root)
    depth: int = 0                        # Profondeur hiérarchique (0 = root)
    role: AgentNodeRole = AgentNodeRole.WORKER
    status: AgentNodeStatus = AgentNodeStatus.PENDING
    model: Optional[str] = None           # Modèle LLM employé
    task_summary: str = ""                # Résumé de la mission assignée
    current_activity: Optional[str] = None # Outil en cours ou dernière action
    thought_preview: Optional[str] = None # Dernier extrait de pensée/raisonnement
    pid: Optional[int] = None             # PID système si processus actif
    worktree_path: Optional[str] = None   # Chemin vers worktree isolé
    worktree_branch: Optional[str] = None # Branche Git associée
    metrics: AgentNodeMetrics

class AgentEdge(BaseModel):
    source: str                           # ID parent
    target: str                           # ID enfant
    edge_type: str = "spawns"             # "spawns" | "delegates" | "monitors"

class OrchestratorGraphResponse(BaseModel):
    conversation_id: str
    root_agent_id: str
    active_count: int
    total_count: int
    nodes: list[AgentNode]
    edges: list[AgentEdge]
```

### 2.3 Endpoints API REST : `backend/app/api/orchestrator.py`

1. `GET /api/orchestrator/graph/{conversation_id}`
   - **Protection** : `require_auth`
   - **Description** : Renvoie la structure complète du graphe d'orchestration pour la conversation courante.
2. `POST /api/orchestrator/steer`
   - **Body** : `{ "conversation_id": str, "target_agent_id": str, "instruction": str }`
   - **Description** : Injecte une consigne de guidage prioritaire dans la boîte de réception ou la file de messages du sous-agent cible.
3. `POST /api/orchestrator/terminate`
   - **Body** : `{ "conversation_id": str, "target_agent_id": str, "recursive": bool }`
   - **Description** : Arrête le sous-agent ciblé. Si `recursive` est `true`, arrête immédiatement en cascade tous ses sous-agents enfants et sous-processus actifs.
4. `GET /api/orchestrator/inspect/{agent_id}`
   - **Query Param** : `?conversation_id=...`
   - **Description** : Renvoie le journal détaillé des outils exécutés, le flux de pensées complet et la liste des fichiers modifiés avec leur diff Git dans le worktree associé.

---

## 3. Conception Frontend & Graphe Visuel Nodal

### 3.1 Composant Principal : `frontend/src/components/AgentOrchestrationModal.tsx`

Le modal plein écran (avec support d'échappement, animation d'entrée fluide, et disposition splitée canvas + volet latéral) se compose de :
1. **Barre d'outils supérieure** :
   - Titre avec badge du nombre d'agents actifs (`🤖 2 actifs / 5 total`).
   - Sélecteur d'orientation du graphe : Haut➔Bas (`Vertical`) ou Gauche➔Droite (`Horizontal`).
   - Filtres rapides : `Tous`, `En cours (🟢)`, `Terminés (🔵)`, `Erreurs (🔴)`.
   - Boutons de zoom : `Zoom In (+)`, `Zoom Out (-)`, `Recentrer la vue (100%)`.
   - Bouton de rafraîchissement manuel et bouton d'export de la vue (Mermaid / JSON).
2. **Zone Canvas Graphique (SVG + HTML Interactive Layer)** :
   - Surface infinie avec support du pan (clic-glisser) et zoom (molette de la souris, borné de 0.4x à 2.0x).
   - Calcul des coordonnées nodales avec distribution équilibrée des colonnes/rangs sans chevauchement.
   - Tracé des liens vectoriels en courbes de Bézier cubiques (`<path d="..." />`) avec animation de flux pulsant sur les connexions actives.
   - Nœuds interactifs cliquables avec effet hover, mise en exergue du chemin de descendance, et sélection visuelle franche.
3. **Volet Latéral d'Inspection & Pilotage (Steering Deck - 400px)** :
   - S'ouvre automatiquement au clic sur un nœud.
   - **Onglet Télémétrie** : modèle, PID, métriques de durée, prompt d'origine, worktree et pensée de l'agent en direct (`thought stream`).
   - **Onglet Outils & Timeline** : historique chronologique des outils invoqués, statuts d'exécution et arguments.
   - **Onglet Fichiers & Diff** : fichiers touchés par cet agent avec visionneuse Monaco Diff intégrée.
   - **Deck d'actions** :
     - Champ d'instruction de guidage direct (`⚡ Envoyer une consigne de steering`).
     - Bouton d'arrêt unitaire (`⏹️ Arrêter cet agent`).
     - Bouton d'arrêt en cascade (`🛑 Arrêter toute la branche`).

---

## 4. Intégration Système & Ergonomie

1. **Header Principal & ChatCanvas** :
   - Bouton d'accès rapide dans la barre d'outils du chat avec icône de réseau neuronal / agent et badge numérique.
2. **Sidebar** :
   - Entrée dédiée dans la navigation pour accéder au studio en 1-clic.
3. **Raccourci Clavier Global** :
   - `Ctrl+Alt+A` pour ouvrir/fermer le studio depuis n'importe quel écran.
4. **Commandes Slash du Chat** :
   - `/orchestrator`, `/agents`, `/subagents` dans `commands.ts`.
5. **Internationalisation (15 Langues)** :
   - 35+ clés `orchestrator_*` ajoutées dans `locales.json` avec 100% de parité stricte sur les 15 langues.

---

## 5. Plan de Test & Critères d'Acceptation

1. **Tests Pytest (`backend/tests/test_agent_orchestrator.py`)** :
   - Détection et construction correcte d'un graphe d'agents avec dépendances parent/enfant.
   - Agrégation des métriques d'exécution et statuts.
   - Arrêt unitaire avec arrêt sécurisé des processus psutil.
   - Arrêt récursif en cascade d'une branche entière.
   - Injection de message de steering avec confirmation.
   - Protection de sécurité : vérification de la validité des IDs et isolation des chemins.
2. **Validation TypeScript & Build** :
   - Zéro erreur lors de `npx tsc -b`.
   - Build de production Vite propre (`npm run build`) avec chunk lazy Rollup dédié pour `AgentOrchestrationModal`.
