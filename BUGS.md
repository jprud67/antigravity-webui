# Catalogue Rigoureux des Bugs et Vulnérabilités — Antigravity WebUI

**Projet :** Antigravity WebUI (`jprud67/antigravity-webui`)  
**Branche auditée :** `main` (commit `98bb4ad`)  
**Environnement de test :** Python 3.12.3 (FastAPI 0.115+, Pytest 9.1+, Mypy 1.15+, Ruff 0.9+) & Node.js 20+ (React 19, TypeScript 5.7+, Vite 6+, Oxlint 0.15+)  
**Date d'audit :** Octobre 2026  

---

## Synthèse du Registre des Anomalies

| ID | Sévérité | Domaine | Titre synthétique | Statut |
|---|---|---|---|---|
| **BUG-001** | **CRITIQUE** | Runtime / Logique | Crash `TypeError` et inversion d'approbation dans Telegram Gateway | Confirmé & Prouvé |
| **BUG-002** | **CONFIRMÉ** | Tests / API Fichiers | Échec unitaire et masquage d'archivage dans `download_file` | Confirmé (`pytest`) |
| **BUG-003** | **ÉLEVÉ** | Sécurité / RBAC | Routes d'administration et de maintenance non authentifiées | Confirmé & Reproductible |
| **BUG-004** | **ÉLEVÉ** | Architecture / Stabilité | Exécution Python in-process non isolée et threads zombies infinis | Confirmé |
| **BUG-005** | **MOYEN** | Fonctionnel / Fictif | Sandbox Plugin Wasm simulée / Réponse factice en production | Confirmé (Mock en prod) |
| **BUG-006** | **MOYEN** | Confidentialité / Git | Identité Git auteur/commiteur codée en dur forçant `jprud67` | Confirmé |
| **BUG-007** | **MOYEN** | Typage / Concurrence | Incompatibilité de protocole `TelegramSessionSubscriber` et 11 erreurs Mypy | Confirmé (`mypy`) |
| **BUG-008** | **MOYEN** | Stabilité / Concurrence | Verrou global monolithique `PersistentPythonKernel` et dérive de stdout | Confirmé |
| **BUG-009** | **FAIBLE** | Frontend / Rendu | Cascades de re-renders et dépendances de hooks manquantes (React 19) | Confirmé (`oxlint`) |
| **BUG-010** | **FAIBLE** | Qualité / Hygiène | 29 imports et variables orphelines dans l'API backend | Confirmé (`ruff`) |
| **BUG-011** | **FAIBLE** | Persistance / Audit | Perte d'historique de maintenance et alertes au redémarrage serveur | Confirmé |

---

## Fiches Détaillées des Anomalies

### BUG-001 — Crash TypeError et Inversion de Logique dans l'Approbation Telegram

- **Sévérité :** **CRITIQUE**
- **Composants :** `backend/app/services/telegram_gateway.py`, `backend/app/services/execution_manager.py`
- **Fichiers & Lignes :**
  - [telegram_gateway.py:602, 610, 743](file:///root/antigravity-webui/backend/app/services/telegram_gateway.py#L602-L610)
  - [execution_manager.py:1374, 1407](file:///root/antigravity-webui/backend/app/services/execution_manager.py#L1374-L1410)
  - [test_telegram_gateway.py:112](file:///root/antigravity-webui/backend/tests/test_telegram_gateway.py#L112)

#### 1. Description et Cause Racine
Deux anomalies majeures se cumulent dans le flux d'approbation d'actions critiques via Telegram :
1. **Signature incompatible (`TypeError`) :** La méthode `handle_approval` dans `ExecutionManager` est définie comme suit :
   ```python
   async def handle_approval(self, conversation_id: str | None, decision: str, rule: str | None):
   ```
   L'argument `rule` est un paramètre positionnel obligatoire (sans valeur par défaut). Cependant, dans `telegram_gateway.py` (lignes 602, 610 et 743), l'appel est effectué sans fournir `rule` :
   ```python
   await execution_manager.handle_approval(conv_id, decision="approved")
   ```
   À l'exécution réelle, Python lève une exception `TypeError: ExecutionManager.handle_approval() missing 1 required positional argument: 'rule'`.
2. **Inversion logique complète du choix utilisateur :**
   Dans `execution_manager.py:1407`, le caractère transmis au processus CLI sur son stdin est déterminé par :
   ```python
   input_char = "y\n" if decision in ["allow-once", "allow-session", "always-allow"] else "n\n"
   ```
   Or la passerelle Telegram transmet `decision="approved"`. La chaîne `"approved"` n'appartenant pas à la liste autorisée, l'évaluation bascule systématiquement sur la branche `else`, soit `"n\n"` !
   L'opérateur Telegram reçoit le message `✅ Action validée et exécutée par Antigravity.` alors que le serveur envoie en réalité un refus (`n\n`) au sous-processus CLI !
3. **Masquage par test unitaire défectueux :**
   Dans `test_telegram_gateway.py:112`, le test patche `handle_approval` avec `new_callable=AsyncMock` sans `autospec=True`. Le mock a absorbé les arguments invalides sans vérifier la signature réelle, créant un faux sentiment de couverture.

#### 2. Preuve Concrète & Reproduction
```bash
python3 -c '
from app.services.execution_manager import ExecutionManager
em = ExecutionManager()
import inspect
sig = inspect.signature(em.handle_approval)
print("Signature:", sig)
'
# Output: Signature: (conversation_id: str | None, decision: str, rule: str | None)
```
Rapport Mypy :
```
backend/app/services/telegram_gateway.py:602: error: Missing positional argument "rule" in call to "handle_approval" of "ExecutionManager"
backend/app/services/telegram_gateway.py:610: error: Missing positional argument "rule" in call to "handle_approval" of "ExecutionManager"
backend/app/services/telegram_gateway.py:743: error: Missing positional argument "rule" in call to "handle_approval" of "ExecutionManager"
```

#### 3. Impact
- Impossibilité pour un administrateur d'approuver ou rejeter une commande via Telegram.
- Si le `TypeError` est contourné sans corriger la logique, une action approuvée est en fait avortée silencieusement tout en mentant à l'utilisateur sur son exécution.

#### 4. Remédiation Recommandée
1. Ajouter une valeur par défaut `rule: str | None = None` dans `handle_approval`.
2. Aligner les constantes de décision : normaliser `"approved"` comme équivalent de `"allow-once"`, et `"rejected"` comme `"n\n"`.
3. Mettre à jour `test_telegram_gateway.py` avec `autospec=True` pour empêcher toute future dérive de signature.

---

### BUG-002 — Échec de Test et Effet de Bord dans `download_file`

- **Sévérité :** **CONFIRMÉ (Échec de suite Pytest)**
- **Composants :** `backend/app/api/files.py`, `backend/test_audit_fixes.py`
- **Fichiers & Lignes :**
  - [files.py:596-620](file:///root/antigravity-webui/backend/app/api/files.py#L596-L620)
  - [test_audit_fixes.py:5835](file:///root/antigravity-webui/backend/test_audit_fixes.py#L5835)

#### 1. Description et Cause Racine
Lors du commit `f46b22a`, le support du téléchargement automatique d'un dossier sous forme d'archive zip à la volée a été introduit :
```python
if resolved_path.is_dir():
    # Zip directory on the fly and stream
    ...
    return FileResponse(..., media_type="application/zip")
```
Dans le test unitaire `test_files_download_known_developer_mime_types` :
```python
mock_path = MagicMock()
mock_path.exists.return_value = True
mock_path.is_file.return_value = True
mock_path.name = "README.md"
mock_path.suffix = ".md"
```
L'attribut `mock_path.is_dir` n'ayant pas été configuré explicitement, l'appel `mock_path.is_dir()` retourne un nouvel objet `MagicMock()`, qui est évalué comme vrai en booléen Python (`bool(MagicMock()) is True`).
Le code bascule donc dans la branche dossier zip au lieu de servir le fichier Markdown.
De plus, dans le code de production de `download_file`, il n'y a aucune vérification `elif not resolved_path.is_file(): raise HTTPException(400, "Not a regular file")`. Si un chemin pointe vers un périphérique, une socket ou un tube nommé (FIFO), Starlette tente de l'ouvrir directement comme fichier standard.

#### 2. Preuve Concrète
Exécution de la suite pytest :
```
FAILED backend/test_audit_fixes.py::test_files_download_known_developer_mime_types
AssertionError: assert 'application/zip' == 'text/markdown; charset=utf-8'
- text/markdown; charset=utf-8
+ application/zip
```

#### 3. Impact
- Régression de la suite de tests d'intégration.
- Fragilité du routage MIME lors des opérations sur les fichiers.

#### 4. Remédiation Recommandée
1. Dans `backend/app/api/files.py:596`, s'assurer que le routage distingue explicitement `is_dir()` et `is_file()` avec rejet des types non réguliers.
2. Dans le test `test_audit_fixes.py:5835`, positionner `mock_path.is_dir.return_value = False`.

---

### BUG-003 — Absence d'Authentification sur les Modules Plugins, Watchdog et Sweeps

- **Sévérité :** **ÉLEVÉ (Vulnérabilité Sécurité)**
- **Composants :** `backend/app/api/plugins.py`
- **Fichiers & Lignes :**
  - [plugins.py:44-46](file:///root/antigravity-webui/backend/app/api/plugins.py#L44-L46)
  - [plugins.py:75-125](file:///root/antigravity-webui/backend/app/api/plugins.py#L75-L125) (Plugins endpoints)
  - [plugins.py:138-185](file:///root/antigravity-webui/backend/app/api/plugins.py#L138-L185) (Watchdog endpoints)
  - [plugins.py:195-217](file:///root/antigravity-webui/backend/app/api/plugins.py#L195-L217) (Maintenance Sweeps endpoints)
  - [maintenance_sweeps.py:62-100](file:///root/antigravity-webui/backend/app/services/maintenance_sweeps.py#L62-L100)

#### 1. Description et Cause Racine
Alors que la majorité des routeurs sensibles de l'application déclarent `dependencies=[Depends(require_auth)]` (comme `database_studio`, `docker_studio`, `worktrees`, `coordinator`), les trois routeurs déclarés dans `plugins.py` omettent totalement cette dépendance :
```python
router = APIRouter(prefix="/api/plugins", tags=["plugins"])
watchdog_router = APIRouter(prefix="/api/watchdog", tags=["watchdog"])
sweeps_router = APIRouter(prefix="/api/sweeps", tags=["sweeps"])
```
Aucun des endpoints (`/api/sweeps/run`, `/api/watchdog/start`, `/api/watchdog/scan`, `/api/plugins/register`, `/api/plugins/{slug}/invoke`) ne requiert d'authentification.
Pire : l'endpoint `/api/sweeps/run` accepte un paramètre `workspace_path` non assaini et exécute en sous-processus `npm audit` ou le binaire Python situé dans `workspace_path/backend/venv/bin/pip` via `subprocess.run(..., cwd=workspace_path)`.

#### 2. Preuve Concrète
Vérification des dépendances FastAPI :
```python
from app.api.plugins import router, watchdog_router, sweeps_router
assert len(router.dependencies) == 0
assert len(watchdog_router.dependencies) == 0
assert len(sweeps_router.dependencies) == 0
```
Un appel HTTP non authentifié `POST /api/sweeps/run` avec un payload JSON `{ "workspace_path": "/root", "sweep_type": "branches" }` est accepté et exécuté sans aucun jeton Bearer ni clé d'API.

#### 3. Impact
- Contournement complet du mécanisme d'authentification pour toute instance exposée sur le réseau local ou via reverse-proxy.
- Risque d'exécution de code ou déni de service par déclenchement intempestif de scans et de commandes shell sur des chemins arbitraires.

#### 4. Remédiation Recommandée
1. Configurer `dependencies=[Depends(require_auth)]` directement au niveau de chacun des trois `APIRouter`.
2. Valider strictement `workspace_path` dans `watchdog_sentinel.py` et `maintenance_sweeps.py` via `is_safe_path(ws, get_allowed_workspace_roots())` et `is_blocked_sensitive_path(ws)`.

---

### BUG-004 — Exécution Python In-Process Non Isolée et Risque de Threads Zombies

- **Sévérité :** **ÉLEVÉ (Architecture & Déni de Service)**
- **Composants :** `backend/app/services/code_kernel.py`
- **Fichiers & Lignes :**
  - [code_kernel.py:221-225](file:///root/antigravity-webui/backend/app/services/code_kernel.py#L221-L225)
  - [code_kernel.py:254-275](file:///root/antigravity-webui/backend/app/services/code_kernel.py#L254-L275)

#### 1. Description et Cause Racine
`PersistentPythonKernel` est conçu pour exécuter des cellules de code Python soumises par l'utilisateur. Cependant :
1. **Exécution dans le processus hôte FastAPI :** Le code est compilé et évalué via `exec(compiled, self.globals)` directement au sein de l'interpréteur principal du serveur Web. `self.globals` injecte l'intégralité de `__builtins__`.
2. **Impossibilité de tuer les threads en boucle infinie :** Le mécanisme de timeout repose sur `threading.Thread(target=run_code, daemon=True)` suivi de `t.join(timeout=timeout)`. En Python CPython, un thread daemon ne peut pas être préempté ni interrompu depuis un autre thread. Si l'utilisateur exécute `while True: pass`, la méthode `execute()` rend la main après 30 secondes avec `status = "timeout"`, mais le thread continue de tourner indéfiniment en consommant 100% d'un cœur CPU. L'accumulation de quelques cellules en boucle infinie sature l'ensemble des cœurs de la machine hôte.
3. **Instabilité fatale en cas de crash C / `sys.exit` :** Tout appel direct à une bibliothèque native provoquant un segfault ou un `os._exit(0)` coupe instantanément le serveur Antigravity WebUI.

#### 2. Preuve Concrète
Dans `code_kernel.py:267-275` :
```python
t = threading.Thread(target=run_code, daemon=True)
t.start()
t.join(timeout=timeout)

if t.is_alive():
    status = "timeout"
    tb = f"Execution timed out after {timeout} seconds."
    self.globals = pre_globals
```
Le thread `t` reste vivant (`t.is_alive() == True`) et ne s'arrête jamais tant que le processus FastAPI vit.

#### 3. Impact
- Sévère déni de service CPU en cas de script accidentellement infini.
- Manque total de confinement mémoire et sécurité.

#### 4. Remédiation Recommandée
- Migrer l'exécution du noyau Python vers des sous-processus dédiés (`multiprocessing.Process` ou protocole Jupyter `ipykernel`), pouvant être interrompus par signal OS (`SIGTERM` / `SIGKILL`) dès l'expiration du timeout.

---

### BUG-005 — Sandbox Plugins Simulée Masquée en Fonctionnalité Opérationnelle

- **Sévérité :** **MOYEN (Fonctionnalité Fictive)**
- **Composants :** `backend/app/services/plugin_sandbox.py`, `frontend/src/components/PluginCatalogModal.tsx`
- **Fichiers & Lignes :**
  - [plugin_sandbox.py:155-181](file:///root/antigravity-webui/backend/app/services/plugin_sandbox.py#L155-L181)
  - [PluginCatalogModal.tsx:35-69](file:///root/antigravity-webui/frontend/src/components/PluginCatalogModal.tsx#L35-L69)

#### 1. Description et Cause Racine
Le panneau utilisateur `PluginCatalogModal` met en avant quatre plugins officiels : *Prettier Format*, *Git Lens*, *AI DocGen*, et *Security Scanner*, dotés de permissions (scopes) comme `write_workspace` ou `register_command`.
Cependant, l'analyse du backend révèle que l'installation ne fait qu'enregistrer une métadonnée dans une table SQLite locale, et la méthode `invoke_plugin` renvoie un simple dictionnaire statique :
```python
def invoke_plugin(slug: str, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    """Simulate invoking a plugin method (sandbox stub).
    In production this would dispatch to a Wasm Worker / Web Worker process.
    """
    ...
    return {
        "status": "ok",
        "result": {"sandbox": "wasm-worker", "message": f"Method '{method}' dispatched to sandbox"},
        "invoked_at": now,
    }
```
Aucun moteur d'exécution WebAssembly (Wasmtime, Wasmer), aucun Worker Node.js et aucun interpréteur de plugin n'est présent. Les plugins annoncés ne réalisent aucune des actions promises.

#### 2. Preuve Concrète
Recherche de dépendances WebAssembly ou runtime JS dans `backend/pyproject.toml` : aucune dépendance `wasmtime`, `wasmer` ou équivalent n'est installée.

#### 3. Impact
- Tromperie fonctionnelle pour l'utilisateur final qui s'attend à ce que le plugin *Security Scanner* ou *Prettier* agisse réellement sur son projet.

#### 4. Remédiation Recommandée
1. Identifier explicitement dans l'UI les plugins comme "Bêta / Spécification API en cours".
2. Soit intégrer un exécuteur de commandes CLI réelles pour Prettier et SAST, soit implémenter le composant d'exécution sandboxed via Web Workers dans le frontend.

---

### BUG-006 — Identité Git Auteur et Commiteur Codée en Dur

- **Sévérité :** **MOYEN (Confidentialité & Traçabilité)**
- **Composants :** `backend/app/api/git.py`, `backend/app/services/updater.py`
- **Fichiers & Lignes :**
  - [git.py:196-220](file:///root/antigravity-webui/backend/app/api/git.py#L196-L220)
  - [updater.py:59-79](file:///root/antigravity-webui/backend/app/services/updater.py#L59-L79)

#### 1. Description et Cause Racine
Lors de chaque invocation de `run_git` dans `git.py` ou de `_git_cmd` dans `updater.py`, l'identité de l'auteur et du commiteur est injectée en dur via arguments de ligne de commande et variables d'environnement prioritaires :
```python
"-c", "user.name=jprud67",
"-c", "user.email=jprud67@gmail.com",
"-c", "author.name=jprud67",
"-c", "author.email=jprud67@gmail.com",
"-c", "committer.name=jprud67",
"-c", "committer.email=jprud67@gmail.com",
```
```python
# Ensure identity cannot be overridden
merged_env["GIT_AUTHOR_NAME"] = "jprud67"
merged_env["GIT_AUTHOR_EMAIL"] = "jprud67@gmail.com"
merged_env["GIT_COMMITTER_NAME"] = "jprud67"
merged_env["GIT_COMMITTER_EMAIL"] = "jprud67@gmail.com"
```
Cette configuration écrase la configuration Git de l'utilisateur (`~/.gitconfig` ou `.git/config` local du workspace).

#### 2. Preuve Concrète
Tout commit réalisé depuis l'interface WebUI reçoit l'identité `jprud67 <jprud67@gmail.com>` quel que soit le développeur utilisant l'outil.

#### 3. Impact
- Violation de la traçabilité des commits dans les équipes de développement.
- Impossibilité pour un utilisateur tiers de signer ses commits sous son propre nom.

#### 4. Remédiation Recommandée
1. Supprimer l'écrasement obligatoire de `GIT_AUTHOR_*` et `GIT_COMMITTER_*`.
2. Résoudre l'identité dynamique : d'abord la configuration locale du dépôt (`git config user.name`), puis les paramètres configurables de l'application WebUI, avec repli générique (`Antigravity WebUI <bot@antigravity>`).

---

### BUG-007 — Incompatibilité de Protocole `TelegramSessionSubscriber` et Erreurs Mypy

- **Sévérité :** **MOYEN (Qualité & Stabilité Typage)**
- **Composants :** `backend/app/services/telegram_gateway.py`, `backend/app/services/workspace_coordinator.py`, `backend/app/api/kanban.py`
- **Fichiers & Lignes :**
  - [telegram_gateway.py:168, 769](file:///root/antigravity-webui/backend/app/services/telegram_gateway.py#L168)
  - [execution_manager.py:96](file:///root/antigravity-webui/backend/app/services/execution_manager.py#L96)
  - [workspace_coordinator.py:887](file:///root/antigravity-webui/backend/app/services/workspace_coordinator.py#L887)
  - [kanban.py:310, 313, 317, 320, 324](file:///root/antigravity-webui/backend/app/api/kanban.py#L310-L325)

#### 1. Description et Cause Racine
1. **Contrat de souscription rompu :** `ExecutionSession.add_subscriber` est typé comme `def add_subscriber(self, ws: WebSocket | None)`. Or, `TelegramGateway` passe une instance de `TelegramSessionSubscriber`. Celle-ci n'hérite pas de `starlette.websockets.WebSocket`. Bien que le runtime utilise le duck-typing (en appelant `send_json`), le système de typage strict rejette cette affectation.
2. **Incompatibilités de types dans `kanban.py` et `workspace_coordinator.py` :**
   - Dans `kanban.py:305`, `st_params = [new_st]` infère un type `list[str]`. Les instructions suivantes y ajoutent des entiers d'horodatage (`now: int`) et `None`, provoquant des erreurs de typage répétées.
   - Dans `workspace_coordinator.py:887`, un float (`duration_ms`) est inséré dans un dictionnaire typé pour n'accepter que `str | int | None`.

#### 2. Preuve Concrète
Exécution de `mypy backend/app` :
```
backend/app/services/telegram_gateway.py:168: error: Argument 1 to "remove_subscriber" of "ExecutionSession" has incompatible type "TelegramSessionSubscriber"; expected "WebSocket[State] | None"
backend/app/services/telegram_gateway.py:769: error: Argument 1 to "add_subscriber" of "ExecutionSession" has incompatible type "TelegramSessionSubscriber"; expected "WebSocket[State] | None"
backend/app/services/workspace_coordinator.py:887: error: Dict entry 4 has incompatible type "str": "float"; expected "str": "str | int | None"
backend/app/api/kanban.py:310: error: Argument 1 to "append" of "list" has incompatible type "int"; expected "str"
```

#### 3. Remédiation Recommandée
1. Définir un protocole `typing.Protocol` pour les souscripteurs d'exécution :
   ```python
   class SubscriberProtocol(Protocol):
       async def send_json(self, data: dict[str, Any]) -> None: ...
   ```
2. Annoter `st_params: list[Any] = [new_st]` dans `kanban.py`.
3. Élargir l'annotation de `results` dans `workspace_coordinator.py` à `list[dict[str, Any]]`.

---

### BUG-008 — Verrou Global Monolithique et Fuite de Redirection `stdout` dans le Kernel

- **Sévérité :** **MOYEN (Concurrence & Fiabilité)**
- **Composants :** `backend/app/services/code_kernel.py`
- **Fichiers & Lignes :**
  - [code_kernel.py:238-243](file:///root/antigravity-webui/backend/app/services/code_kernel.py#L238-L243)
  - [code_kernel.py:257](file:///root/antigravity-webui/backend/app/services/code_kernel.py#L257)

#### 1. Description et Cause Racine
Pour capturer la sortie d'un bloc de code, `PersistentPythonKernel.execute` utilise un verrou global de module `_GLOBAL_EXECUTION_LOCK` et détourne temporairement `sys.stdout` et `sys.stderr` :
```python
with _GLOBAL_EXECUTION_LOCK:
    with SafeStreamRedirect("stdout", out_buf), SafeStreamRedirect("stderr", err_buf):
        ...
```
Ce mécanisme présente deux défauts majeurs :
1. **Sérialisation totale inter-sessions :** Deux utilisateurs ou deux onglets différents exécutant du code ne peuvent pas s'exécuter en parallèle, même sur des noyaux indépendants.
2. **Pollution croisée des logs :** Tout log du serveur (FastAPI, Uvicorn, Uvicorn access log) émis sur stdout par un autre thread asynchrone pendant cette fraction de seconde est détourné et capturé dans la réponse de la cellule de code utilisateur !

#### 2. Impact
- Perte de logs système dans la console serveur.
- Latence induite par la sérialisation des cellules de code.

---

### BUG-009 — Avertissements de Rendu Frontend et Dépendances Manquantes (React 19)

- **Sévérité :** **FAIBLE (Performance UX)**
- **Composants :** `frontend/src/components/WorkspacePanel.tsx`, `frontend/src/components/ProjectSwitcherModal.tsx`, `frontend/src/components/FileExplorerModal.tsx`
- **Fichiers & Lignes :**
  - [WorkspacePanel.tsx:766, 1643](file:///root/antigravity-webui/frontend/src/components/WorkspacePanel.tsx#L766)
  - [ProjectSwitcherModal.tsx:160, 181, 183](file:///root/antigravity-webui/frontend/src/components/ProjectSwitcherModal.tsx#L160)
  - [FileExplorerModal.tsx:164](file:///root/antigravity-webui/frontend/src/components/FileExplorerModal.tsx#L164)

#### 1. Description
L'analyse statique React via `oxlint` signale 6 anomalies :
- Appels directs à `setState` (`setExpandedFolders`, `loadProjects`, `loadTree`) à l'intérieur de `useEffect` sans synchronisation avec un système externe, déclenchant des cascades de rendus immédiats sous React 19.
- Omission de `isImageFile` dans le tableau de dépendances de `useCallback` (`WorkspacePanel.tsx:766`).
- Omission de `explorerCurrentPath` et `currentWorkspace` dans `useEffect` (`ProjectSwitcherModal.tsx:183`).

#### 2. Impact
- Re-renders inutiles affectant la fluidité lors de l'ouverture des modales et l'exploration de gros arborescences de fichiers.

---

### BUG-010 — Imports Inutilisés et Variables Orphelines (Ruff Lint)

- **Sévérité :** **FAIBLE (Hygiène de Code)**
- **Composants :** `backend/app/api/git.py`, `backend/app/api/copilot.py`, `backend/app/api/mcp_catalog.py`, `backend/app/api/openai_compat.py`
- **Nombre d'occurrences :** 29 violations `F401` et `F841` confirmées par `ruff check`.

#### 1. Description
Des modules tels que `json`, `shutil`, `re` ou `datetime` sont importés sans être exploités, et certaines variables intermédiaires sont assignées sans utilisation.

---

### BUG-011 — Volatilité de l'Historique de Maintenance et des Alertes Sentinel

- **Sévérité :** **FAIBLE (Persistance)**
- **Composants :** `backend/app/services/maintenance_sweeps.py`, `backend/app/services/watchdog_sentinel.py`
- **Fichiers & Lignes :**
  - [maintenance_sweeps.py:23, 30-41](file:///root/antigravity-webui/backend/app/services/maintenance_sweeps.py#L23)

#### 1. Description
L'historique des scans (`_sweep_history = []`) et les alertes non résolues du Watchdog sont stockés exclusivement dans des listes Python en mémoire (ring buffer de 50 éléments).
Tout redémarrage de l'application ou mise à jour par l'Updater efface l'intégralité des alertes de sécurité et des rapports de vulnérabilités passés.

#### 2. Remédiation Recommandée
Persister ces événements dans la base SQLite locale `conversation_summaries.db` via une table dédiée `maintenance_records`.
