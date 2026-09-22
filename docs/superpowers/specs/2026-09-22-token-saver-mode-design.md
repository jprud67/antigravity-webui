# Spécification de Conception : Mode Éco & Garde-fous Tokens dans Antigravity WebUI

**Date** : 2026-09-22  
**Statut** : Validé  
**Portée** : Antigravity WebUI (Backend FastAPI + Frontend React/Vite)

---

## 1. Contexte & Problématique

Dans Antigravity WebUI, l'exécution des tâches s'effectue au sein d'une boucle agentique (*Agentic Loop*). À chaque tour, l'intégralité du contexte (historique de la conversation, outils appelés, sorties de commandes, fichiers inspectés) est réinjectée au modèle.

Sans mécanismes de contrôle au niveau de la WebUI, plusieurs dérives entraînent une explosion de la consommation de tokens :
1. **Sorties massives de commandes** : des commandes de test ou de build non filtrées (`npm install`, `pytest -v`, `git log`) injectent des milliers de lignes de logs répercutées à chaque tour suivant.
2. **Boucles d'essais-erreurs répétées** : l'accumulation d'erreurs et de diffs successifs provoque un effet boule de neige.
3. **Lectures intégrales de fichiers** : utilisation de `view_file` sans bornes `StartLine`/`EndLine`.
4. **Surconsommation de réflexion (Thinking)** : effort fixé par défaut à `high`, générant un volume maximal de tokens de raisonnement.
5. **Réécritures complètes de fichiers** : utilisation de `write_to_file` au lieu de modifications ciblées avec `replace_file_content`.
6. **Pièces jointes trop lourdes** : collage de fichiers entiers sans avertissement préalable.
7. **Inflation de l'historique** : absence d'incitation visuelle à purger ou démarrer un nouveau chat lorsque le contexte devient lourd.

---

## 2. Objectifs

* Fournir un **Mode Éco** activable/désactivable en 1 clic dans l'interface et configurable par défaut dans les paramètres.
* Injecter des **directives de sobriété strictes** au prompt de l'agent lorsque le Mode Éco est actif.
* Détecter en temps réel les **boucles d'erreurs consécutives ($\ge 3$)** et proposer à l'utilisateur d'interrompre ou d'orienter l'agent.
* Avertir l'utilisateur lors de l'ajout de **pièces jointes volumineuses** et lors de l'**engorgement du contexte** (> 50 000 tokens).
* Réduire automatiquement le niveau d'effort de réflexion (`low` ou `medium`) lors de l'activation du Mode Éco.

---

## 3. Architecture & Spécification Détaillée

### 3.1 Backend

#### A. Stockage & Paramètres (`backend/app/services/storage.py`)
* Dans `get_settings()`, ajouter la clé `"ecoMode": False` dans le dictionnaire des valeurs par défaut (`defaults`).
* `save_settings()` persiste automatiquement la clé dans `settings.json`.

#### B. Gestionnaire d'Exécution (`backend/app/services/execution_manager.py`)
1. **Prise en charge du paramètre `eco_mode`** :
   * Dans `ExecutionSession.run_turn(params)` :
     * Récupérer `eco_mode = params.get("eco_mode")` ; si non fourni, utiliser `get_settings().get("ecoMode", False)`.
     * Si `eco_mode` est actif et que l'effort n'a pas été forcé par l'utilisateur, appliquer un effort économique (`low`, ou `medium` si le modèle ne supporte pas `low`).
2. **Injection des Directives de Sobriété** :
   * Si `eco_mode` est vrai, préfixer discrètement le prompt transmis à `stream_turn` :
     ```text
     [CONSIGNE SYSTÈME ÉCONOMIE TOKENS :
     1. Commandes terminal : utiliser systématiquement des modes silencieux (-q, --bail) ou filtrés (grep, head -n 50, git log -n 5). Ne jamais générer de logs verbeux inutiles.
     2. Fichiers : privilégier strictement replace_file_content à write_to_file pour toute modification existante. Pour view_file, restreindre systématiquement avec StartLine et EndLine.
     3. Réponses : être direct et concis ; ne pas régurgiter le code non modifié.]
     ```
3. **Détection de Boucle d'Erreurs Consécutives** :
   * Dans la boucle de consommation d'événements de `run_turn()` :
     * Maintenir une variable `consecutive_errors: int = 0`.
     * À chaque événement `step_update` :
       * Si `status == "ERROR"` ou `step_type in ("error", "ERROR_MESSAGE")` : `consecutive_errors += 1`.
       * Si `status == "COMPLETED"` ou `status == "DONE"` : `consecutive_errors = 0`.
     * Dès que `consecutive_errors >= 3` (et alerté au plus une fois par séquence de 3 erreurs) :
       * Diffuser sur le WebSocket l'événement :
         ```json
         {
           "event": "loop_warning",
           "conversation_id": self.conversation_id,
           "consecutive_errors": consecutive_errors,
           "message": "Boucle d'erreur détectée (3 échecs consécutifs). Envisagez d'interrompre ou de réorienter l'agent pour préserver vos tokens."
         }
         ```

---

### 3.2 Frontend

#### A. Types (`frontend/src/types/index.ts`)
* Étendre `AppSettings` :
  ```typescript
  export interface AppSettings {
    // ...
    ecoMode?: boolean;
  }
  ```

#### B. Barre de Saisie (`frontend/src/components/ChatInput.tsx`)
1. **Bouton Toggle Mode Éco** :
   * Ajout d'un bouton icône `Leaf` (🍃) dans la barre d'outils (à côté du sélecteur de modèle/effort).
   * Clic : bascule l'état local `ecoMode` et persiste dans `localStorage` / `AppSettings`.
   * Feedback visuel : style actif émeraude/vert avec badge discret `Éco`.
   * Effet de bord : bascule automatiquement `selectedEffort` sur `'low'` (ou `'medium'`).
   * Transmission de `eco_mode` dans les options de `onSendMessage(prompt, { ..., eco_mode: isEcoMode })`.
2. **Garde-fou Pièces Jointes** :
   * Si une pièce jointe textuelle dépasse 20 Ko (~20 000 caractères), afficher un avertissement ambré sous la liste des pièces jointes :
     * `⚠️ Fichier lourd (~X Ko / ~Y tokens). Seuls les extraits nécessaires devraient être injectés.`

#### C. Alerte de Boucle d'Erreurs (`frontend/src/components/ChatCanvas.tsx`)
* Écoute de l'événement WebSocket `loop_warning`.
* Affichage d'un bandeau d'alerte flottant animé au-dessus de la zone de saisie :
  * Texte explicatif : `⚠️ Boucle d'erreurs détectée : l'agent a rencontré 3 échecs consécutifs.`
  * Deux boutons d'action immédiate :
    * `[🛑 Stopper]` : appelle `onStopStreaming()` ou émet `/interrupt`.
    * `[🧭 Réorienter]` : insère `/steer ` dans le champ de saisie et donne le focus.
  * Bouton `✕` pour fermer le bandeau.

#### D. Indicateur d'Inflation de Contexte (`frontend/src/components/ContextRing.tsx`)
* Détection de contexte lourd : si `totalInput > 50_000` tokens ou `percent > 25%`.
* L'indicateur affiche une lueur/badge d'attention.
* Dans le menu contextuel/popover :
  * Avertissement : `Contexte volumineux. Les tours suivants consommeront de plus en plus de tokens.`
  * Bouton direct : `[✨ Nouvelle conversation (Purger)]` qui déclenche `onNewChat()`.

#### E. Paramètres Globaux (`frontend/src/components/SettingsModal.tsx`)
* Dans l'onglet Modèles / Préférences :
  * Ajout d'une case à cocher / switch : `Activer le Mode Éco par défaut`.
  * Description : `Applique les consignes d'économie de tokens et règle l'effort de réflexion minimal pour préserver vos quotas.`

#### F. Internationalisation (`frontend/public/locales.json`)
* Ajout des traductions françaises et anglaises pour tous les nouveaux libellés (Mode Éco, avertissements de fichiers lourds, alerte de boucle d'erreurs, purge du contexte).

---

## 4. Plan de Test & Vérification

1. **Test Backend** :
   * Vérifier que `get_settings()` retourne `ecoMode: False` par défaut.
   * Vérifier que `save_settings({"ecoMode": True})` persiste et restitue bien la valeur.
   * Vérifier que `ExecutionSession.run_turn` injecte la consigne de sobriété lorsque `eco_mode=True`.
   * Simuler 3 étapes `ERROR` consécutives et vérifier l'émission de l'événement WebSocket `loop_warning`.
2. **Test Frontend** :
   * Vérifier le basculement du bouton Mode Éco dans `ChatInput`.
   * Vérifier le passage automatique de l'effort à `low` lors de l'activation du Mode Éco.
   * Vérifier l'apparition de l'avertissement lors de l'attachement d'un fichier volumineux (>20 Ko).
   * Vérifier l'affichage du bandeau d'alerte lors de la réception d'un `loop_warning` et le fonctionnement des boutons Stopper / Réorienter.
   * Valider la compilation Vite (`npm run build` ou `tsc --noEmit`).
