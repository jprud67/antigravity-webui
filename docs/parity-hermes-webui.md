# Matrice de Parité : Hermes WebUI → Antigravity WebUI

> **Date d'audit** : 2026-09-14
> **Méthode** : analyse du code source réel des deux côtés (référence `/root/hermes-webui-ref`, cible `/root/antigravity-webui`)
> **Légende** : ✅ Complet | ⚠️ Partiel | ❌ Absent | N/A Non applicable

---

## Phase A — Layout & Design Tokens

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| A1 | 3 panneaux : sidebar / chat / workspace (fermé par défaut) | ✅ `App.tsx` : Sidebar + ChatCanvas + WorkspacePanel (fermé par défaut, ouvert à la demande) | Aucun | — |
| A2 | Sidebar resizable via drag handle, min/max clampé, persisté localStorage | ⚠️ WorkspacePanel resizable (drag bar), mais sidebar non resizable | Sidebar non redimensionnable | P2 |
| A3 | Workspace panel resizable + persisté localStorage | ✅ Drag bar présent dans WorkspacePanel, resize fonctionnel | Aucun | — |
| A4 | Composer footer : pièces jointes, micro, modèle, jauge contexte circulaire, Stop/Send | ⚠️ ChatInput a : modèle (sélecteur), ContextRing, Stop/Send. Micro (SpeechRecognition) présent. Pièces jointes = ❌ absent | Pas de pièces jointes fichier (attach), pas de saved prompts | P1 |
| A5 | Control Center : modal à onglets (Conversation / Préférences / Système) | ⚠️ SettingsModal avec onglets : models, google, permissions, skills, security, appearance, languages. Pas de tab « Conversation » (export/import/clear) ni « Système » (version, password) | Structure d'onglets différente, pas de Conversation/Système | P1 |
| A6 | Navigation rail vertical (icônes latérales pour Chat/Tasks/Kanban/Skills etc.) | ❌ Absent. Sidebar a des sections mais pas de rail d'icônes persistant | Manque le rail de navigation | P2 |
| A7 | Pas de flash au chargement (inline script applique thème avant CSS) | ⚠️ `applyAppearance()` appelé dans useEffect (React), pas en inline script head | Flash possible au premier render | P2 |
| A8 | Splitter drag : `body.resizing` + désactivation sélection texte | ⚠️ `document.body.style.cursor = 'col-resize'` dans WorkspacePanel mais pas de classe body ni blocage sélection | Mineure UX | P3 |

## Phase B — Tour de Chat (Streaming, File, Stop, Outils, Reconnexion)

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| B1 | Envoi → affichage immédiat message user + indicateur activité + saisie verrouillée | ✅ Implémenté dans ChatCanvas/ChatInput (isStreaming lock) | Aucun | — |
| B2 | Flux streaming continu : token, tool, approval, done, error | ✅ WS events: `token`, `tool_call`, `tool_result`, `approval_request`, `question`, `queued`, `steered`, `interrupted`, `done`, `error` | Aucun écart majeur | — |
| B3 | Rendu incrémental rAF-throttled, markdown vivant, coloration syntaxique | ⚠️ Rendu incrémental présent. AdaptiveCodeBlock + Prism syntax highlighting récemment ajouté. Pas de throttle rAF explicite | Pas de throttle rAF | P2 |
| B4 | Reprise après coupure : événements identifiés + curseur + reconnexion auto sans perte | ⚠️ WS reconnect auto (2-3s timer), mais pas de curseur de reprise ni replay d'événements manqués | **Écart majeur** : pas de resume cursor | P1 |
| B5 | Heartbeat régulier (~5s) | ❌ Absent côté WS | Heartbeat absent | P1 |
| B6 | Message pendant tour en cours → file d'attente (compteur visible) | ✅ `mode: 'queue' | 'steer'` dans ws.ts, `queueCount` dans App.tsx, `clear_queue` action | Fonctionnel | — |
| B7 | Stop interrompt proprement l'agent | ✅ `chatSocket.send({ action: 'stop' })` + backend process group kill | Aucun | — |
| B8 | Éditer message passé + régénérer depuis ce point | ⚠️ `forkConversation` dans api.ts (fork = régénérer depuis un point). Édition inline du texte = probablement partiel | Fork ok, édition inline message user à vérifier | P2 |
| B9 | Retry dernière réponse | ⚠️ `/retry` dans commands.ts, mais pas de bouton UI dédié visible dans ChatCanvas | Bouton retry manquant dans UI | P2 |
| B10 | Horodatage des messages | ⚠️ À vérifier dans le rendu ChatCanvas | Probablement partiel | P3 |
| B11 | Copie code blocks (« Copied! ») | ✅ `copyTextToClipboard` + feedback visuel Check icon | Aucun | — |
| B12 | Cartes sous-agents indentées | ⚠️ Pas de rendu spécifique sous-agent visible dans ChatCanvas | Absent | P2 |
| B13 | Blocs thinking/reasoning repliables | ✅ `expandedThoughts` state, accordion reasoning dans ChatCanvas | Aucun | — |
| B14 | Mermaid inline | ✅ MermaidRenderer.tsx présent et utilisé | Aucun | — |
| B15 | Pièces jointes persistantes après reload | ❌ Pas de système de pièces jointes | Absent (lié à A4) | P1 |

## Phase B2 — Cartes Outils / Activity

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| B16 | Multi-outils groupés en « Activity : N outils » replié par défaut | ✅ `ToolActivityFeed` composant avec groupement et accordion | Aucun | — |
| B17 | État ouvert/fermé persisté par tour | ✅ `expandedTools` state par message ID, live = ouvert | Aucun | — |
| B18 | Tool card = ligne discrète (icône, nom, cible, statut) | ✅ Rendu compact de tool cards dans ToolActivityFeed | Aucun | — |
| B19 | Arguments/résultats derrière expansion | ✅ Expansion pour détails | Aucun | — |
| B20 | Compression contexte = séparateur discret centré | ⚠️ À vérifier si implémenté comme séparateur ou comme carte | Potentiellement absent | P2 |
| B21 | 3 modes d'affichage (compact_worklog, transparent_stream, hide_all) | ❌ Un seul mode d'affichage | Absent | P2 |

## Phase C — Approbations

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| C1 | 4 choix : une fois / session / toujours / refuser | ✅ ApprovalCard avec `sendApproval(dec, rule)` — 4 choix | Aucun | — |
| C2 | Carte inline dans le flux, non bloquante | ✅ ApprovalCard rendu dans le flux chat | Aucun | — |
| C3 | Polling fallback (1500ms) si SSE/WS manque | ❌ Pas de polling fallback visible | Absent | P2 |
| C4 | YOLO mode (skip all approvals) | ❌ Pas de pill YOLO visible | Absent | P3 |

## Phase D — Sessions

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| D1 | Groupes de dates repliables (Aujourd'hui/Hier/Plus tôt) | ✅ `groupedConversations` avec pinned + date groups dans Sidebar | Aucun | — |
| D2 | Recherche titre ET contenu | ✅ `searchFilter` filtre titre, preview, project, tags, snippet | Aucun | — |
| D3 | Pin (épinglage gold) | ✅ `pinned` dans Conversation, bulk pin, section « Épinglées » | Aucun | — |
| D4 | Archive | ⚠️ Bulk actions incluent probablement archive, mais à vérifier si toggle archive individuel existe | À vérifier | P2 |
| D5 | Projets nommés avec couleur | ✅ `project`, `projectColor` dans bulk actions et SessionMetaModal | Aucun | — |
| D6 | Tags #tag (puces cliquables filtrantes) | ✅ `tags` extraction, `selectedTag` filter, puces dans Sidebar | Aucun | — |
| D7 | Export transcript MD / JSON complet | ✅ `bulkConversationExport` dans Sidebar, `/export` commande | Aucun | — |
| D8 | Import JSON | ⚠️ À vérifier si endpoint import existe | Probablement absent | P2 |
| D9 | Lien de partage public (lecture seule) | ❌ Absent | Absent | P3 |
| D10 | Titre onglet navigateur = titre session active | ⚠️ À vérifier dans App.tsx | Probablement absent | P2 |
| D11 | Pont CLI : sessions terminal dans sidebar avec badge | ⚠️ syncClient.ts existe (sync CLI↔WebUI via SSE + filesystem watcher), mais badge CLI à vérifier | Partiel | P2 |
| D12 | Compteur tokens/coût par conversation | ✅ `tokenUsage` state, ContextRing composant | Aucun | — |
| D13 | Menu ⋯ par session (pin, projet, archiver, dupliquer, supprimer, renommer) | ⚠️ SessionMetaModal permet certaines actions. Menu contextuel ⋯ individuel à vérifier | Probablement partiel | P2 |

## Phase E — Workspace (Panneau Droit)

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| E1 | Arbre expand/collapse | ✅ WorkspacePanel avec arbre de fichiers | Aucun | — |
| E2 | Fil d'Ariane cliquable | ⚠️ À vérifier dans WorkspacePanel | Probablement absent | P2 |
| E3 | Aperçu inline (texte, code, markdown rendu, images) | ⚠️ Aperçu texte/code OK, markdown rendu et images à vérifier | Partiel | P2 |
| E4 | Édition / Création / Suppression / Renommage fichiers | ⚠️ Édition OK (`isEditingFile`), création/suppression/renommage à vérifier | Partiel | P2 |
| E5 | Téléchargement binaires | ❌ Probablement absent | Absent | P3 |
| E6 | Garde « modifications non sauvegardées » | ❌ Pas de dirty guard visible | Absent | P2 |
| E7 | Badge git (branche + fichiers modifiés) | ⚠️ GitTab existe mais badge dans le workspace panel header à vérifier | Partiel | P2 |
| E8 | Panneau redimensionnable | ✅ Drag bar dans WorkspacePanel | Aucun | — |
| E9 | Liens `workspace://` dans le chat ouvrent le fichier | ❌ Pas de handler workspace:// visible | Absent | P1 |

## Phase F — Apparence & Thèmes

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| F1 | 2 axes indépendants : theme (system/dark/light) × skin | ✅ `theme.ts` : ThemeMode + AVAILABLE_SKINS | Aucun | — |
| F2 | 12 skins de référence | ⚠️ 15+ skins (default, ares, mono, graphite, github, codex, terracotta, slate, poseidon, sisyphus, charizard, sienna, catppuccin, nous, geist-contrast…). Skins supplémentaires (graphite, github, codex, terracotta). Skin `zeus` de la référence potentiellement manquant | Quasi complet, vérifier zeus | P3 |
| F3 | Preview instantané | ✅ `applyAppearance()` applique immédiatement | Aucun | — |
| F4 | Persistance localStorage + serveur | ⚠️ localStorage oui, synchro serveur via `saveSettings` | Aucun | — |
| F5 | Aucun flash au premier paint | ⚠️ Pas d'inline script head — flash possible | Inline script manquant | P2 |
| F6 | Commande `/theme` | ✅ `applyTheme()` dans theme.ts, `/theme` dans commands.ts | Aucun | — |
| F7 | Taille police Small / Default / Large | ⚠️ À vérifier dans SettingsModal appearance tab | Probablement partiel ou absent | P2 |
| F8 | Tokens typographiques `--font-ui` / `--font-conversation` / `--font-mono` | ⚠️ CSS variables présentes dans index.css à vérifier | Probablement partiel | P3 |

## Phase G — Control Center, Commandes, Notifications

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| G1 | Control Center unifié à onglets | ⚠️ SettingsModal avec 7 onglets (models, google, permissions, skills, security, appearance, languages) — pas la structure Conversation/Préférences/Système de la référence | Structure différente | P1 |
| G2 | Onglet Conversation (export/import/effacer) | ❌ Actions dispersées, pas de tab dédiée | Absent en tant que tab | P1 |
| G3 | Onglet Préférences (modèle, touche envoi, thème, langue, toggles) | ⚠️ Dispersé entre models, appearance, languages tabs | Dispersé | P2 |
| G4 | Onglet Système (version, mot de passe) | ⚠️ Tab security existe | Partiel | P2 |
| G5 | Commandes slash avec autocomplétion (/ → dropdown, flèches, Tab/Enter, Échap) | ⚠️ `commands.ts` définit ~25 commandes. ChatInput a un handler `/`. Autocomplétion dropdown à vérifier | Probablement partiel | P1 |
| G6 | Pass-through commandes inconnues à l'agent | ⚠️ À vérifier dans ChatInput | Probablement absent | P2 |
| G7 | Toasts (fin cron, etc.) | ❌ Pas de système de toast. Utilise `alert()` natif à la place | **Écart majeur** : alert() natif partout | P1 |
| G8 | Badges non-lus | ❌ Absent | Absent | P2 |
| G9 | Bannière erreur sessions arrière-plan | ⚠️ Error banner dans ChatCanvas pour le tour en cours | Partiel | P2 |
| G10 | Web Notifications API pour alertes background | ❌ Absent | Absent | P3 |

## Phase H — Voix

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| H1 | Micro Web Speech API | ✅ SpeechRecognition dans ChatInput | Aucun | — |
| H2 | Transcription intermédiaire dans le textarea | ⚠️ À vérifier | Probablement absent | P2 |
| H3 | Arrêt auto après ~2s silence | ⚠️ À vérifier | Probablement absent | P2 |
| H4 | Ajout au texte existant (append) | ⚠️ À vérifier | Probablement absent | P3 |
| H5 | Bouton masqué si API non supportée | ⚠️ Vérifie SpeechRecognition support | Probablement OK | P3 |
| H6 | Fallback serveur STT | ❌ Absent | Absent | P3 |

## Phase I — Mobile & Fiabilité

| # | Comportement (Référence) | État actuel (Antigravity) | Écart | Priorité |
|---|---|---|---|---|
| I1 | < 640px : sidebar en overlay (hamburger) | ✅ `isMobileSidebarOpen` dans App.tsx, toggle mobile | Aucun | — |
| I2 | Panneau workspace en slide-over mobile | ⚠️ À vérifier dans WorkspacePanel responsive | Probablement partiel | P2 |
| I3 | Cibles tactiles ≥ 44px | ⚠️ Non vérifié systématiquement | À auditer | P2 |
| I4 | Changement session pendant tour → aucune fuite d'état | ⚠️ `activeConversationIdRef` utilisé pour guard, mais pas de INFLIGHT state | Partiel | P1 |
| I5 | Messages assistants vides jamais rendus | ⚠️ À vérifier dans ChatCanvas | Probablement absent | P2 |
| I6 | Suppression session ≠ création implicite | ⚠️ À vérifier | Probablement OK | P3 |
| I7 | **Zéro** `confirm()`/`prompt()` natifs → modales in-app | ❌ **22+ usages de `alert()`, `confirm()`, `window.confirm()`** dans Sidebar, SettingsModal, TerminalTab, ChatCanvas, SessionMetaModal, CronSchedulerModal, KanbanTab, RulesEditorModal, WorkspacePanel | **Écart critique** | P1 |

---

## Résumé des Écarts Critiques (P1)

| # | Domaine | Écart |
|---|---|---|
| A4 | Composer | Pas de pièces jointes fichier |
| A5/G1/G2 | Control Center | Structure d'onglets non conforme, pas de tab Conversation |
| B4 | Reconnexion | Pas de curseur de reprise / replay événements |
| B5 | Heartbeat | Absent |
| B15 | Pièces jointes | Système absent |
| E9 | Workspace | Liens `workspace://` non gérés |
| G5 | Commandes | Autocomplétion dropdown clavier à implémenter |
| G7 | Toasts | Utilise `alert()` natif partout |
| I4 | Fiabilité | Fuite d'état potentielle lors de changement de session pendant un tour |
| I7 | Dialogues natifs | 22+ `alert()`/`confirm()` à remplacer par modales in-app |

## Ordre d'Implémentation Proposé

1. **Phase 1** — Système de toasts + modales in-app (remplacer tous les `alert()`/`confirm()`)
2. **Phase 2** — Layout : composer footer (pièces jointes, aligner sur la référence)
3. **Phase 3** — Tour de chat : heartbeat WS, curseur de reprise, reconnexion robuste
4. **Phase 4** — Sessions : import JSON, titre onglet, menu ⋯ individuel, archive toggle
5. **Phase 5** — Workspace : liens `workspace://`, fil d'Ariane, garde unsaved, badge git inline
6. **Phase 6** — Control Center : restructurer onglets (Conversation/Préférences/Système)
7. **Phase 7** — Commandes slash : dropdown autocomplétion clavier + pass-through
8. **Phase 8** — Apparence : anti-flash inline, taille police S/M/L, 3 modes activity display
9. **Phase 9** — Voix : transcription intermédiaire, arrêt auto silence, append, fallback hide
10. **Phase 10** — Mobile : audit cibles 44px, slide-over workspace, fiabilité changement session
