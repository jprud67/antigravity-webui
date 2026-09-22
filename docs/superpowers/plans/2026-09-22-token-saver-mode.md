# Token Saver Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Intégrer un Mode Éco complet et des garde-fous de tokens dans Antigravity WebUI (Backend & Frontend) pour juguler la surconsommation de tokens dans la boucle agentique.

**Architecture:** Approche full-stack coordonnée : persistance du paramètre `ecoMode`, injection automatique d'un en-tête de directives de sobriété au prompt agy, détection temps-réel des boucles d'erreur côté backend, et contrôles UI (toggle 🍃 dans ChatInput, abaissement automatique de l'effort de réflexion, alertes de fichiers lourds, alerte d'inflation du contexte dans ContextRing et bandeau d'alerte de boucle dans ChatCanvas).

**Tech Stack:** FastAPI, Python 3 (`backend/venv`), React 18, TypeScript, Vite, Tailwind / CSS variables, Lucide Icons.

**Spec:** `docs/superpowers/specs/2026-09-22-token-saver-mode-design.md`

## Global Constraints
- Ne pas casser les contrats d'API ni les arguments passés au CLI `agy`.
- La directive de sobriété injectée au prompt doit rester ultra-compacte pour ne pas surconsommer de tokens d'entrée.
- Le mode Éco doit être facilement débrayable en 1 clic dans `ChatInput` et conservé dans `localStorage` / `settings.json`.
- Utiliser `backend/venv/Scripts/python.exe` pour exécuter les commandes Python et tests backend.

---

### Task 1: Backend — Stockage & Paramètre `ecoMode`

**Files:**
- Modify: `backend/app/services/storage.py:2692-2705`
- Test: `backend/tests/test_eco_mode.py`

**Interfaces:**
- Consumes: `SETTINGS_FILE`, `_settings_lock` dans `storage.py`
- Produces: `get_settings()["ecoMode"] -> bool`, `save_settings({"ecoMode": bool}) -> dict`

- [ ] **Step 1: Écrire le test unitaire pour la persistance de `ecoMode`**

Créer `backend/tests/test_eco_mode.py` :
```python
import unittest
from app.services.storage import get_settings, save_settings

class TestEcoModeStorage(unittest.TestCase):
    def test_default_eco_mode(self):
        settings = get_settings()
        self.assertIn("ecoMode", settings)
        self.assertIsInstance(settings["ecoMode"], bool)

    def test_toggle_eco_mode(self):
        current = get_settings().get("ecoMode", False)
        updated = save_settings({"ecoMode": not current})
        self.assertEqual(updated.get("ecoMode"), not current)
        # Restore
        save_settings({"ecoMode": current})

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Exécuter le test pour vérifier qu'il échoue (absence de `ecoMode` par défaut)**

Run: `.\venv\Scripts\python.exe -m unittest tests/test_eco_mode.py -v` (dans `backend/`)
Expected: FAIL avec `AssertionError: 'ecoMode' not found in ...`

- [ ] **Step 3: Ajouter `ecoMode` dans `storage.py`**

Dans `backend/app/services/storage.py` dans `get_settings()` :
```python
    defaults: dict[str, Any] = {
        "agentMode": "accept-edits",
        "colorScheme": "dark",
        "model": "Gemini 3.8 Flash (High)",
        "trustedWorkspaces": [DEFAULT_WORKSPACE],
        "defaultWorkspace": DEFAULT_WORKSPACE,
        "ecoMode": False,
    }
```

- [ ] **Step 4: Exécuter le test pour vérifier qu'il passe**

Run: `.\venv\Scripts\python.exe -m unittest tests/test_eco_mode.py -v` (dans `backend/`)
Expected: PASS (`Ran 2 tests ... OK`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/storage.py backend/tests/test_eco_mode.py
git commit -m "feat(backend): add ecoMode to settings defaults and persistence"
```

---

### Task 2: Backend — Directives de Sobriété & Détection de Boucles d'Erreurs

**Files:**
- Modify: `backend/app/services/execution_manager.py`
- Test: `backend/tests/test_eco_mode.py`

**Interfaces:**
- Consumes: `get_settings()`, `stream_turn()`
- Produces: Événement WebSocket `loop_warning` : `{"event": "loop_warning", "conversation_id": str, "consecutive_errors": int, "message": str}`
- Produces: Injection de `TOKEN_SAVER_DIRECTIVE` dans le prompt si `eco_mode` est actif.

- [ ] **Step 1: Écrire les tests pour l'injection de la directive et la détection de boucles**

Compléter `backend/tests/test_eco_mode.py` :
```python
    def test_token_saver_prompt_injection(self):
        from app.services.execution_manager import inject_eco_directives
        prompt = "Fais un audit du projet"
        eco_prompt = inject_eco_directives(prompt)
        self.assertIn("CONSIGNE SYSTÈME ÉCONOMIE TOKENS", eco_prompt)
        self.assertTrue(eco_prompt.endswith(prompt))

    def test_consecutive_error_tracking(self):
        from app.services.execution_manager import should_warn_error_loop
        self.assertFalse(should_warn_error_loop(1))
        self.assertFalse(should_warn_error_loop(2))
        self.assertTrue(should_warn_error_loop(3))
        self.assertFalse(should_warn_error_loop(4))  # already warned at 3
```

- [ ] **Step 2: Exécuter le test pour vérifier l'échec**

Run: `.\venv\Scripts\python.exe -m unittest tests/test_eco_mode.py -v` (dans `backend/`)
Expected: FAIL (`ImportError: cannot import name 'inject_eco_directives'`)

- [ ] **Step 3: Implémenter `inject_eco_directives`, `should_warn_error_loop` et intégrer dans `ExecutionSession.run_turn`**

Dans `backend/app/services/execution_manager.py` :
1. Définir :
```python
TOKEN_SAVER_DIRECTIVE = (
    "[CONSIGNE SYSTÈME ÉCONOMIE TOKENS : "
    "1) Commandes terminal : utiliser des modes silencieux (-q, --bail, logs ciblés avec grep/head/pagination). "
    "2) Fichiers : privilégier strictement replace_file_content à write_to_file, et borner view_file avec StartLine/EndLine. "
    "3) Réponses : rester concis, ne pas régurgiter le code existant inchangé.]\n\n"
)

def inject_eco_directives(prompt: str) -> str:
    clean = (prompt or "").strip()
    return f"{TOKEN_SAVER_DIRECTIVE}{clean}" if clean else TOKEN_SAVER_DIRECTIVE.strip()

def should_warn_error_loop(consecutive_errors: int) -> bool:
    return consecutive_errors == 3
```

2. Dans `ExecutionSession.run_turn(params)` :
- Extraire `eco_mode = params.get("eco_mode")` ; si `eco_mode is None`, utiliser `settings.get("ecoMode", False)`.
- Si `eco_mode` est vrai, appliquer `prompt = inject_eco_directives(prompt)`.
- Initialiser `consecutive_errors = 0` avant la boucle d'événements.
- À chaque événement :
  - Si `evt_type == "step_update"` :
    - `su = event.get("step_update", {})`
    - `if su.get("step_type") in ("error", "ERROR_MESSAGE") or su.get("status") == "ERROR":`
      - `consecutive_errors += 1`
      - `if should_warn_error_loop(consecutive_errors):`
        - `await self.broadcast({"event": "loop_warning", "conversation_id": self.conversation_id, "consecutive_errors": consecutive_errors, "message": "Boucle d'erreurs détectée (3 échecs consécutifs). Envisagez d'interrompre ou de réorienter l'agent pour préserver vos tokens."})`
    - `elif su.get("status") in ("COMPLETED", "DONE", "SUCCESS"):`
      - `consecutive_errors = 0`

- [ ] **Step 4: Exécuter les tests backend pour valider le passage**

Run: `.\venv\Scripts\python.exe -m unittest tests/test_eco_mode.py -v` (dans `backend/`)
Expected: PASS (`Ran 4 tests ... OK`)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/execution_manager.py backend/tests/test_eco_mode.py
git commit -m "feat(backend): implement eco prompt directive injection and error loop warning"
```

---

### Task 3: Frontend — Types & Internationalisation (i18n)

**Files:**
- Modify: `frontend/src/types/index.ts:64-75`
- Modify: `frontend/public/locales.json`

**Interfaces:**
- Produces: Propriété `ecoMode?: boolean` sur `AppSettings`
- Produces: Clés de traduction pour `eco_mode_label`, `eco_mode_desc`, `eco_mode_active`, `eco_mode_disabled`, `heavy_file_warning`, `loop_warning_title`, `loop_warning_desc`, `btn_interrupt_loop`, `btn_steer_loop`, `context_heavy_warning`, `btn_new_chat_purge`.

- [ ] **Step 1: Modifier `frontend/src/types/index.ts`**

Ajouter `ecoMode?: boolean;` dans `export interface AppSettings`.

- [ ] **Step 2: Ajouter les clés i18n dans `frontend/public/locales.json`**

Ajouter pour le français (`fr`) et l'anglais (`en`) les clés de localisation appropriées.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/types/index.ts frontend/public/locales.json
git commit -m "feat(frontend): add ecoMode types and i18n translations"
```

---

### Task 4: Frontend — Bouton Mode Éco & Garde-fou Pièces Jointes (`ChatInput.tsx`)

**Files:**
- Modify: `frontend/src/components/ChatInput.tsx`

**Interfaces:**
- Consumes: `Leaf` icon from `lucide-react`, `AppSettings.ecoMode`
- Produces: Bouton toggle Mode Éco dans la barre d'outils, ajustement automatique de `selectedEffort` sur `'low'`/`'medium'`, transmission de `{ eco_mode: isEcoMode }` dans `onSendMessage`.
- Produces: Bannière d'avertissement quand une pièce jointe textuelle dépasse 20 Ko (> 20 000 caractères).

- [ ] **Step 1: Implémenter l'état `isEcoMode` dans `ChatInput.tsx`**

- Initialiser `isEcoMode` à partir de `localStorage.getItem('antigravity_eco_mode') === 'true'`.
- Ajouter la bascule `toggleEcoMode`:
  - Alterne `isEcoMode`.
  - Sauvegarde dans `localStorage`.
  - Si activé : bascule automatiquement `onSelectEffort('low')` (ou `'medium'` si `'low'` n'est pas supporté).
  - Affiche un toast informatif.

- [ ] **Step 2: Insérer le bouton `Leaf` dans la barre de contrôle**

- Placer le bouton à gauche ou à côté du sélecteur d'effort dans `ChatInput`.
- Appliquer un style vert/émeraude lumineux quand actif avec badge `Éco`.

- [ ] **Step 3: Ajouter la détection des pièces jointes lourdes**

- Dans la zone d'affichage des `attachments`, calculer si une pièce jointe dépasse 20 000 caractères.
- Afficher un badge d'avertissement : `⚠️ Fichier volumineux (~X Ko). Pensez à ne transmettre que l'extrait pertinent.`

- [ ] **Step 4: Transmettre `eco_mode` dans `onSendMessage`**

- Mettre à jour l'appel `onSendMessage` dans `handleSubmit` pour inclure `eco_mode: isEcoMode`.

- [ ] **Step 5: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit` (dans `frontend/`)
Expected: Succès sans erreurs de typage.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/ChatInput.tsx
git commit -m "feat(frontend): add eco mode toggle and heavy attachment warning to ChatInput"
```

---

### Task 5: Frontend — Alerte de Boucle d'Erreurs & Alerte de Contexte (`ChatCanvas.tsx`, `ContextRing.tsx`)

**Files:**
- Modify: `frontend/src/components/ChatCanvas.tsx`
- Modify: `frontend/src/components/ContextRing.tsx`

**Interfaces:**
- Consumes: Événement WebSocket `loop_warning`
- Produces: Bandeau flottant d'alerte de boucle d'erreurs avec boutons `Stopper` et `Orienter`
- Produces: Indicateur ambré et bouton `Purger / Nouvelle conversation` dans le popover de `ContextRing.tsx`.

- [ ] **Step 1: Ajouter l'écoute de `loop_warning` et le bandeau d'alerte dans `ChatCanvas.tsx`**

- Dans le gestionnaire d'événements WebSocket ou d'état de session dans `ChatCanvas.tsx`, capturer `event === 'loop_warning'`.
- Stocker `loopWarning: { errorCount: number; message: string } | null`.
- Rendre un bandeau flottant au-dessus du champ de saisie :
  - Style sombre avec bordure ambrée (`border-amber-500/50 bg-amber-950/40`).
  - Texte : « ⚠️ Boucle d'erreurs détectée (3 échecs consécutifs) — L'agent accumule des tokens sans progresser. »
  - Bouton « 🛑 Stopper » qui appelle `onStopStreaming()`.
  - Bouton « 🧭 Réorienter » qui pré-remplit la saisie avec `/steer `.
  - Bouton de fermeture « ✕ ».

- [ ] **Step 2: Ajouter l'alerte d'inflation de contexte dans `ContextRing.tsx`**

- Dans `ContextRing.tsx`, évaluer si `totalInput > 50_000 || percent > 25`.
- Si vrai, afficher une lueur ambrée sur l'icône de jauge.
- Dans le popover de détail des tokens, ajouter un encart avec le bouton « ✨ Démarrer une nouvelle conversation (Purger) » appelant `onNewChat()`.

- [ ] **Step 3: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit` (dans `frontend/`)
Expected: Succès sans erreurs.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/ChatCanvas.tsx frontend/src/components/ContextRing.tsx
git commit -m "feat(frontend): add error loop warning banner and context inflation alerts"
```

---

### Task 6: Frontend — Option Mode Éco par Défaut (`SettingsModal.tsx`)

**Files:**
- Modify: `frontend/src/components/SettingsModal.tsx`

**Interfaces:**
- Consumes: `settings.ecoMode`, `saveSettings()`
- Produces: Switch / Case à cocher pour activer le Mode Éco par défaut dans l'onglet Modèles / Général.

- [ ] **Step 1: Ajouter le contrôle dans `SettingsModal.tsx`**

- Dans l'onglet Modèles ou Préférences générales :
  - Ajouter un bloc de configuration pour `ecoMode`.
  - Libellé : « Mode Éco par défaut ».
  - Description : « Active automatiquement les consignes de sobriété de tokens et règle l'effort de réflexion minimal pour toutes les nouvelles sessions. »
  - Synchronisation avec `saveSettings({ ...settings, ecoMode: e.target.checked })`.

- [ ] **Step 2: Vérifier la compilation TypeScript**

Run: `npx tsc --noEmit` (dans `frontend/`)
Expected: Succès.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/SettingsModal.tsx
git commit -m "feat(frontend): add default eco mode setting toggle in SettingsModal"
```

---

### Task 7: Build Complet & Validation Finale

**Files:**
- Test: `backend/tests/test_eco_mode.py`
- Build: `frontend/`

- [ ] **Step 1: Exécuter tous les tests backend**

Run: `.\venv\Scripts\python.exe -m unittest discover -s tests -p "test_*.py"` (dans `backend/`)
Expected: Tous les tests passent.

- [ ] **Step 2: Exécuter le build de production frontend**

Run: `npm run build` (dans `frontend/`)
Expected: Build Vite réussi avec code de sortie 0.

- [ ] **Step 3: Commit final et validation**

```bash
git status
git commit -m "chore: validate and verify token saver mode build"
```
