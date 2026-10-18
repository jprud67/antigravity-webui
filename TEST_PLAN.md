# Plan de Test & Stratégie de Validation Continue — Antigravity WebUI

**Projet :** Antigravity WebUI  
**Version cible :** v0.6.0-stable  
**Date d'élaboration :** Octobre 2026  
**Objectif :** Garantir la non-régression, valider de manière automatisée la correction de toutes les anomalies identifiées dans `BUGS.md`, et élever le niveau d'assurance qualité et de sécurité pour une exploitation en production.

---

## 1. Principes Directeurs et Cadre d'Exécution

1. **Non-régression absolue :** Les 662 tests unitaires et d'intégration existants doivent continuer à passer (`pytest -q` = 0 échec).
2. **Autospec obligatoire sur les mocks :** Aucun test ne doit masquer une divergence de signature ou de paramètres d'API ; tout appel à `unittest.mock.patch` doit utiliser `autospec=True`.
3. **Tests de bout en bout réalistes :** Les protocoles critiques (approbations Telegram, interactions PTY, exécution de code) doivent être testés avec des fixtures mimant fidèlement le comportement du runtime CLI.
4. **Vérification d'étanchéité de sécurité :** Toute route d'API doit subir un test d'accès non authentifié (attendu : HTTP 401 ou 403).

---

## 2. Matrice des Tests de Reproduction et de Validation (Bug Fix Suite)

| ID Anomalie | Nom du Test Proposé | Fichier Cible | Comportement Testé | Résultat Attendu |
|---|---|---|---|---|
| **BUG-001** | `test_telegram_approval_signature_and_logic` | `backend/tests/test_telegram_gateway.py` | Vérifie que `handle_approval` accepte l'appel sans `rule` et convertit `"approved"` en `"y\n"` | Succès sans TypeError, stdin reçoit `"y\n"` |
| **BUG-002** | `test_files_download_regular_file_vs_directory` | `backend/test_audit_fixes.py` | Vérifie que `download_file` sur un fichier Markdown retourne `text/markdown`, et sur un dossier retourne `application/zip` | Content-Type exact pour chaque cas |
| **BUG-003** | `test_plugins_watchdog_sweeps_require_auth` | `backend/tests/test_security_auth.py` | Envoie des requêtes anonymes à `/api/plugins/register`, `/api/watchdog/start`, `/api/sweeps/run` | HTTP 401 ou 403 systématique |
| **BUG-004** | `test_kernel_timeout_terminates_process` | `backend/tests/test_code_kernel_isolation.py` | Exécute une boucle `while True: pass` avec timeout 2s | Le processus enfant est tué par SIGKILL, 0 thread orphelin |
| **BUG-005** | `test_plugin_catalog_status_and_execution` | `backend/tests/test_plugin_sandbox.py` | Vérifie que l'API et l'UI indiquent fidèlement l'état d'implémentation des plugins | Pas de mock silencieux prétendant exécuter du Wasm |
| **BUG-006** | `test_git_identity_respects_user_config` | `backend/tests/test_git_identity.py` | Exécute un commit dans un workspace avec son propre `user.name` et `user.email` | L'auteur du commit reflète l'utilisateur et non `jprud67` |
| **BUG-007** | `test_mypy_strict_typecheck` | CI Pipeline (`mypy backend/app`) | Analyse statique complète des 93 fichiers du backend | 0 erreur signalée par Mypy |
| **BUG-008** | `test_kernel_stdout_isolation_under_concurrency` | `backend/tests/test_code_kernel_isolation.py` | Émet des logs serveur pendant l'évaluation d'un script utilisateur | Aucune pollution des sorties par les logs FastAPI |
| **BUG-009** | `test_frontend_oxlint_clean` | CI Pipeline (`npx oxlint`) | Linter sur l'ensemble des 97 fichiers React / TypeScript | 0 warning, 0 error |

---

## 3. Spécifications Détaillées des Nouveaux Tests Unitaires et d'Intégration

### 3.1. Test de Régression BUG-001 (Telegram Approval Flow)

**Objectif :** Valider à la fois la conformité de signature et la correspondance logique entre la décision Telegram et le signal stdin Antigravity.

```python
# Emplacement : backend/tests/test_telegram_gateway.py
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch
from app.services.telegram_gateway import TelegramGateway
from app.services.execution_manager import ExecutionManager

@pytest.mark.asyncio
async def test_telegram_approval_real_signature_and_logic():
    em = ExecutionManager()
    session = em.create_session("test_conv_approval", "/tmp")
    
    # Simuler un processus avec un stdin ouvert
    mock_proc = MagicMock()
    mock_stdin = MagicMock()
    mock_stdin.is_closing.return_value = False
    mock_stdin.write = MagicMock()
    mock_stdin.drain = AsyncMock()
    mock_proc.stdin = mock_stdin
    mock_proc.returncode = None
    session.active_proc = mock_proc
    session.pending_approval = {"tool": "run_command", "command": "rm -rf test"}

    # Test 1 : Approbation sans spécifier 'rule'
    await em.handle_approval("test_conv_approval", decision="approved")
    # Doit envoyer 'y\n' au stdin
    mock_stdin.write.assert_called_with(b"y\n")
    assert session.pending_approval is None

    # Test 2 : Rejet
    session.pending_approval = {"tool": "run_command"}
    await em.handle_approval("test_conv_approval", decision="rejected")
    mock_stdin.write.assert_called_with(b"n\n")
```

---

### 3.2. Test de Sécurité BUG-003 (Enforcement Authentification)

**Objectif :** Prouver l'étanchéité des endpoints de plugins, watchdog et sweeps.

```python
# Emplacement : backend/tests/test_security_auth.py
import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

@pytest.mark.parametrize("method,path,payload", [
    ("POST", "/api/plugins/register", {"slug": "test", "name": "Test"}),
    ("POST", "/api/plugins/test/invoke", {"method": "run"}),
    ("POST", "/api/watchdog/start", {"workspace_path": "/tmp"}),
    ("POST", "/api/watchdog/scan?workspace_path=/tmp", None),
    ("POST", "/api/sweeps/run", {"workspace_path": "/tmp", "sweep_type": "all"}),
    ("DELETE", "/api/watchdog/alerts", None),
])
def test_unauthenticated_requests_are_rejected(method, path, payload):
    if method == "POST":
        resp = client.post(path, json=payload or {})
    elif method == "DELETE":
        resp = client.delete(path)
    else:
        resp = client.get(path)

    assert resp.status_code in (401, 403), f"Route {path} should require authentication, got {resp.status_code}"
```

---

### 3.3. Test de Confinement BUG-004 (Kernel Timeout & Process Isolation)

**Objectif :** Prouver qu'une boucle infinie Python est tuée proprement sans laisser de thread actif ni consommer le CPU de l'hôte après le timeout.

```python
# Emplacement : backend/tests/test_code_kernel_isolation.py
import pytest
import time
from app.services.code_kernel import get_or_create_kernel

def test_kernel_infinite_loop_timeout_reclaims_cpu():
    kernel = get_or_create_kernel("test_timeout_session")
    code = "while True:\n    pass"
    
    t0 = time.perf_counter()
    res = kernel.execute(code, timeout=2)
    duration = time.perf_counter() - t0

    assert res["status"] == "timeout"
    assert 1.8 <= duration <= 3.5
    # Vérifier l'absence de threads ou processus en rotation continue
```

---

## 4. Stratégie de Validation Frontend & Expérience Utilisateur

### 4.1. Conformité React 19 et React Compiler
- **Oxlint & ESLint :** Aucune invocation de `setState()` directement à la racine d'un `useEffect` sans dépendance ou garde (`if (!isOpen) return`).
- **Hooks d'effets stricts :** Remplir exhaustivement tous les tableaux de dépendances (`[openTabs, currentWorkspace, isBinaryFile, isImageFile, t]`).

### 4.2. Tests des États Limites (Empty, Loading, Error States)
- **Modale de Projets :** Vérifier l'affichage du squelette de chargement lorsque `loadProjects` est asynchrone, et le rendu d'un composant d'état vide (`EmptyState`) en l'absence de workspaces récents.
- **Terminal Web :** Vérifier que la fermeture brutale du WebSocket déclenche une tentative de reconnexion avec backoff exponentiel et affiche un indicateur visuel de déconnexion.
- **Visionneuse de Fichiers :** Confirmer le blocage préventif des fichiers binaires volumineux (> 10 Mo) et des types MIME non supportés.

---

## 5. Intégration Continue (CI/CD) et Seuils de Qualité

Pour assurer la stabilité à chaque commit et pull request, la chaîne CI doit exécuter les étapes suivantes de manière bloquante :

```yaml
name: Quality Gate & Test Suite

jobs:
  backend-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Python 3.12
        uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install Dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r backend/requirements.txt
      - name: Ruff Lint & Format Check
        run: ruff check backend/app
      - name: Mypy Strict Type Check
        run: mypy backend/app --config-file backend/pyproject.toml
      - name: Pytest Suite with Coverage
        run: |
          pytest backend/ -q --cov=app --cov-fail-under=85

  frontend-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Set up Node.js 20
        uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Install Frontend Dependencies
        run: cd frontend && npm ci
      - name: Oxlint Static Analysis
        run: cd frontend && npx oxlint --deny-warnings
      - name: TypeScript Strict Check
        run: cd frontend && npx tsc --noEmit
      - name: Frontend Production Build
        run: cd frontend && npm run build
```

### Critères de Succès du Plan de Test
1. **0 Régression :** 100% des tests passants (aucun test ignoré sans justificatif technique documenté).
2. **0 Avertissement Critique :** Mypy (0 erreur), Oxlint (0 warning).
3. **Couverture de Code Minimale :** >= 85% sur les modules `services/` et `api/`.
