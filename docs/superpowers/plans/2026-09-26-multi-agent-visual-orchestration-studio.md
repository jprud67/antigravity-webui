# Multi-Agent Visual Orchestration Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le Multi-Agent Visual Orchestration Studio pour Antigravity WebUI : cartographie en DAG temps réel des sous-agents, pilotage hiérarchique (steering prioritaire et arrêt en cascade), inspection conjointe (pensées, outils, diff Git) et intégration complète.

**Architecture:** Moteur d'orchestration hybride combinant l'analyse récursive des transcripts Antigravity Brain (`invoke_subagent`), la corrélation des processus actifs (`psutil`) et des Git worktrees isolés côté backend FastAPI. Côté frontend React/Vite, un canvas nodal SVG haute performance avec algorithme de disposition DAG hiérarchique, un volet latéral de pilotage/inspection (télémétrie, journaux d'outils, Monaco Diff), un modal studio plein écran avec raccourci `Ctrl+Alt+A`, et une parité i18n stricte sur 15 langues.

**Tech Stack:** FastAPI, Python 3.13, Pydantic v2, psutil, React 19, TypeScript, TailwindCSS, Monaco Editor (`@monaco-editor/react`), Lucide React, WebSocket, pytest, Vite.

**Spec:** `docs/superpowers/specs/2026-09-26-multi-agent-orchestration-studio-design.md`

## Global Constraints

- **Python Environment**: exécuter les tests et scripts Python via `backend\venv\Scripts\python.exe` (ou `.\venv\Scripts\python.exe` dans `backend/`).
- **TypeScript**: zéro erreur de compilation (`npx tsc -b`) avec `--noUnusedLocals` et `--noUnusedParameters`.
- **Internationalisation (i18n)**: parité stricte à 100% sur l'ensemble des 15 langues dans `frontend/public/locales.json`.
- **Git & Release**: respect strict de la convention de commits et push systématique sur `origin` avec le tag annoté correspondant.

---

### Task 1: Backend Agent Orchestrator Service & Models

**Files:**
- Create: `backend/app/services/agent_orchestrator.py`
- Test: `backend/tests/test_agent_orchestrator.py`

**Interfaces:**
- Produces:
  - `AgentNodeRole`, `AgentNodeStatus`, `AgentNodeMetrics`, `AgentNode`, `AgentEdge`, `OrchestratorGraphResponse`, `SteerRequest`, `TerminateRequest`
  - `build_orchestrator_graph(conversation_id: str) -> OrchestratorGraphResponse`
  - `steer_agent(conversation_id: str, target_agent_id: str, instruction: str) -> dict[str, Any]`
  - `terminate_agent(conversation_id: str, target_agent_id: str, recursive: bool) -> dict[str, Any]`
  - `get_agent_inspection_details(agent_id: str, conversation_id: str) -> dict[str, Any]`

- [ ] **Step 1: Write failing unit test for graph building and models**

```python
# backend/tests/test_agent_orchestrator.py
import pytest
from app.services.agent_orchestrator import (
    build_orchestrator_graph,
    AgentNodeRole,
    AgentNodeStatus,
)

def test_build_graph_empty_session(tmp_path, monkeypatch):
    # Should create root node even for clean session without subagents
    res = build_orchestrator_graph("test_conv_123")
    assert res.conversation_id == "test_conv_123"
    assert len(res.nodes) >= 1
    assert res.nodes[0].role == AgentNodeRole.ROOT
    assert res.nodes[0].id == "root_test_conv_123"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_agent_orchestrator.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'app.services.agent_orchestrator')

- [ ] **Step 3: Implement `backend/app/services/agent_orchestrator.py`**

Implémenter les modèles Pydantic, l'analyseur récursif de transcripts, la détection des processus psutil et l'extraction des worktrees Git.

- [ ] **Step 4: Run test to verify it passes**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_agent_orchestrator.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/agent_orchestrator.py backend/tests/test_agent_orchestrator.py
git commit -m "feat(orchestrator): implement backend agent orchestrator service and schemas"
```

---

### Task 2: Backend REST Endpoints & Router Registration

**Files:**
- Create: `backend/app/api/orchestrator.py`
- Modify: `backend/app/main.py:140-160`
- Modify: `backend/tests/test_agent_orchestrator.py`

**Interfaces:**
- Consumes: `app.services.agent_orchestrator.*`
- Produces:
  - `GET /api/orchestrator/graph/{conversation_id}`
  - `POST /api/orchestrator/steer`
  - `POST /api/orchestrator/terminate`
  - `GET /api/orchestrator/inspect/{agent_id}`

- [ ] **Step 1: Write integration tests for API endpoints**

Tester l'authentification `require_auth`, la récupération du graphe, l'injection de steering et l'arrêt récursif.

- [ ] **Step 2: Run test to verify failure**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_agent_orchestrator.py -k test_api -v`
Expected: FAIL (404 Not Found)

- [ ] **Step 3: Implement `backend/app/api/orchestrator.py` and register in `backend/app/main.py`**

- [ ] **Step 4: Run tests to verify pass**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_agent_orchestrator.py -v`
Expected: PASS (all tests pass)

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/orchestrator.py backend/app/main.py backend/tests/test_agent_orchestrator.py
git commit -m "feat(orchestrator): implement REST API endpoints for agent orchestration"
```

---

### Task 3: WebSocket Event Streaming for Agent Updates

**Files:**
- Modify: `backend/app/services/execution_manager.py`
- Modify: `backend/app/api/chat.py`

**Interfaces:**
- Consumes: `execution_manager.broadcast_to_session`
- Produces: Événement WebSocket `orchestrator_update` avec payload `{ "type": "orchestrator_update", "conversation_id": str, "event": str, "node": dict }`

- [ ] **Step 1: Add broadcast helper `broadcast_orchestrator_update` in `execution_manager.py`**
- [ ] **Step 2: Trigger broadcast upon subagent invocation and task completion in `chat.py` / `execution_manager.py`**
- [ ] **Step 3: Run backend test suite to ensure zero regressions**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_share_session.py backend/tests/test_agent_orchestrator.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/execution_manager.py backend/app/api/chat.py
git commit -m "feat(orchestrator): add real-time WebSocket broadcast for agent hierarchy updates"
```

---

### Task 4: Frontend Types, API Client & Navigation Registry

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/utils/navigation.ts`

**Interfaces:**
- Produces:
  - Types: `AgentNodeRole`, `AgentNodeStatus`, `AgentNodeMetrics`, `AgentNode`, `AgentEdge`, `OrchestratorGraphResponse`, `SteerRequest`, `AgentInspectionDetails`
  - Fonctions API: `fetchOrchestratorGraph`, `steerAgent`, `terminateAgent`, `fetchAgentInspectionDetails`
  - Navigation: `MODAL_AGENT_ORCHESTRATION` dans `navigation.ts`

- [ ] **Step 1: Add types in `frontend/src/types/index.ts`**
- [ ] **Step 2: Add API methods in `frontend/src/services/api.ts`**
- [ ] **Step 3: Add modal identifier in `frontend/src/utils/navigation.ts`**
- [ ] **Step 4: Run `npx tsc -b` to verify types**

Run: `cd frontend && npx tsc -b`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/utils/navigation.ts
git commit -m "feat(orchestrator): define frontend types, API methods, and navigation keys"
```

---

### Task 5: Full 15-Language i18n Key Parity

**Files:**
- Modify: `frontend/public/locales.json`

**Interfaces:**
- Produces: 35+ nouvelles clés `orchestrator_*` traduites dans 15 langues :
  - Français (`fr`), Anglais (`en`), Allemand (`de`), Espagnol (`es`), Italien (`it`), Portugais (`pt`), Néerlandais (`nl`), Polonais (`pl`), Russe (`ru`), Chinois (`zh`), Japonais (`ja`), Coréen (`ko`), Arabe (`ar`), Turc (`tr`), Hindi (`hi`).

- [ ] **Step 1: Write Python script to inject 35+ keys into all 15 languages in `frontend/public/locales.json`**
- [ ] **Step 2: Run verification script to guarantee 100% key parity across all languages**
- [ ] **Step 3: Commit**

```bash
git add frontend/public/locales.json
git commit -m "feat(i18n): add 15-language parity for multi-agent visual orchestration studio"
```

---

### Task 6: Interactive Nodal DAG Canvas Component

**Files:**
- Create: `frontend/src/components/AgentGraphCanvas.tsx`

**Interfaces:**
- Consumes: `AgentNode`, `AgentEdge`, `useI18n`
- Produces:
  - `<AgentGraphCanvas nodes={nodes} edges={edges} selectedNodeId={selectedId} onSelectNode={handleSelect} orientation={orientation} />`
  - Calcul de disposition hiérarchique automatique (niveaux de profondeur `depth`, espacement dynamique, centrage).
  - Courbes de Bézier cubiques fluides avec surbrillance au survol et animation de flux pulsant sur les connexions actives.
  - Cartes de nœuds riches avec icônes de rôles, badges de statut, métriques CPU/temps, et aperçu de l'outil en cours.
  - Commandes zoom molette (0.4x à 2.0x), pan par drag-and-drop, bouton de recentrage automatique.

- [ ] **Step 1: Implement `AgentGraphCanvas.tsx`**
- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc -b`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AgentGraphCanvas.tsx
git commit -m "feat(orchestrator): implement interactive nodal DAG canvas with auto-layout and zoom-pan"
```

---

### Task 7: Steering Deck & Inspection Drawer Component

**Files:**
- Create: `frontend/src/components/AgentInspectionDrawer.tsx`

**Interfaces:**
- Consumes: `AgentNode`, `AgentInspectionDetails`, `steerAgent`, `terminateAgent`
- Produces:
  - `<AgentInspectionDrawer agentNode={selectedNode} onClose={handleClose} onSteer={handleSteer} onTerminate={handleTerminate} />`
  - 3 onglets d'inspection :
    - Télémétrie & Pensée en direct (`thought stream`)
    - Timeline chronologique des outils invoqués avec arguments et résultats
    - Fichiers modifiés avec visionneuse Monaco Diff intégrée
  - Deck d'actions :
    - Guidage prioritaire (champ de saisie ⚡ `Steering`)
    - Bouton d'arrêt unitaire ⏹️
    - Bouton d'arrêt en cascade récursif de la branche 🛑

- [ ] **Step 1: Implement `AgentInspectionDrawer.tsx`**
- [ ] **Step 2: Verify TypeScript compilation**

Run: `cd frontend && npx tsc -b`
Expected: 0 errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/AgentInspectionDrawer.tsx
git commit -m "feat(orchestrator): implement agent inspection drawer with live thought stream, tool timeline, diff, and steering deck"
```

---

### Task 8: Full Studio Modal & Application Integration

**Files:**
- Create: `frontend/src/components/AgentOrchestrationModal.tsx`
- Modify: `frontend/src/components/ChatCanvas.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Modify: `frontend/src/services/commands.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - Studio Modal plein écran avec raccourci global `Ctrl+Alt+A` / `Cmd+Alt+A`
  - Bouton d'en-tête ChatCanvas avec badge du nombre de sous-agents actifs (`🤖 X actifs`)
  - Entrée dans la barre latérale Sidebar
  - Commandes slash `/orchestrator`, `/agents`, `/subagents` dans `commands.ts`

- [ ] **Step 1: Implement `AgentOrchestrationModal.tsx`**
- [ ] **Step 2: Add header button & active badge in `ChatCanvas.tsx`**
- [ ] **Step 3: Add sidebar entry in `Sidebar.tsx`**
- [ ] **Step 4: Register slash commands in `commands.ts`**
- [ ] **Step 5: Integrate modal with lazy loading in `App.tsx`**
- [ ] **Step 6: Run `npx tsc -b` and `npm run build`**

Run: `cd frontend && npm run build`
Expected: Clean build with lazy chunk `dist/assets/AgentOrchestrationModal-*.js`

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/AgentOrchestrationModal.tsx frontend/src/components/ChatCanvas.tsx frontend/src/components/Sidebar.tsx frontend/src/services/commands.ts frontend/src/App.tsx
git commit -m "feat(orchestrator): integrate AgentOrchestrationModal, header button, shortcuts, and slash commands"
```

---

### Task 9: End-to-End Verification, Version Bump & Release Preparation

**Files:**
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `frontend/package.json`
- Modify: `frontend/public/sw.js`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run full backend test suite**

Run: `backend\venv\Scripts\python.exe -m pytest backend/tests/test_agent_orchestrator.py -v`
Expected: 100% PASS

- [ ] **Step 2: Run frontend production build**

Run: `cd frontend && npm run build`
Expected: 100% PASS, zero errors

- [ ] **Step 3: Bump version to `0.4.1` (or next semver) across the 5 files**
- [ ] **Step 4: Update `docs/ROADMAP.md` marking Jalon v0.4.1 as completed**
- [ ] **Step 5: Commit release, create annotated git tag, and push to GitHub**

```bash
git add backend/app/main.py backend/app/services/updater.py frontend/package.json frontend/public/sw.js docs/ROADMAP.md
git commit -m "feat(release): Release v0.4.1 - Multi-Agent Visual Orchestration Studio & Hierarchical Steering"
git tag -a v0.4.1 -m "Release v0.4.1 - Multi-Agent Visual Orchestration Studio & Hierarchical Steering"
git push origin main
git push origin v0.4.1
```
