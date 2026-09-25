# Spécification de Conception — Git Remote Manager & Interactive Tag Publisher Studio

**Date :** 2026-09-25  
**Auteur :** Antigravity Agent & jprud67  
**Sprint :** 19 (v0.2.23)  
**Statut :** Validé  

---

## 1. Vue d'Ensemble & Objectifs

Le cockpit Git d'Antigravity WebUI offre déjà une gestion complète des modifications, de l'historique des commits, des stashes et des branches avec rebase interactif.
Le **Sprint 19** introduit la pièce manquante du cycle de vie du code :
1. **Git Remote Manager Studio** : Inspection visuelle des dépôts distants (`remotes`), tests de connectivité 1-clic, synchronisation sélective (`fetch`, `push` avec tracking upstream), et gestion CRUD (ajout, renommage, mise à jour d'URL, suppression sécurisée).
2. **Interactive Tag & Release Publisher Studio** : Gestion des tags Git locaux et distants (création légère/annotée, suppression, push), couplée à un générateur intelligent de notes de version (changelog catégorisé selon Conventional Commits) et publication directe de releases GitHub (via `gh` CLI ou URL pré-remplie).

---

## 2. Principes Directeurs & Non-Objectifs

### Principes Directeurs
- **Intégration Unifiée dans [`GitTab.tsx`](file:///c:/laragon/www/antigravity-webui/frontend/src/components/GitTab.tsx)** : Accessible directement aux côtés des onglets existants (`Modifications`, `Historique`, `Stashes`, `Branches`) via deux nouveaux sous-onglets : `Remotes` et `Tags`.
- **Modularité & Maintenabilité** : Isolation des interfaces dans des composants dédiés sous `frontend/src/components/git/` (`GitRemotesView.tsx`, `GitTagsView.tsx`, `GitReleaseModal.tsx`) pour préserver la lisibilité de `GitTab.tsx`.
- **Zéro Dépendance Bloquante pour les Releases** : Support natif de GitHub CLI (`gh`) s'il est installé, avec fallback universel instantané vers l'URL officielle de publication GitHub Releases pré-remplie.
- **Sécurité Stricte** : Validation des noms de remotes et de tags (aucun caractère shell dangereux), sanitization des chemins de dépôt et délais d'expiration (timeouts) stricts sur toutes les commandes réseau.

### Non-Objectifs
- Support de protocoles exotiques autres que HTTPS et SSH (standard Git).
- Gestionnaire de clés SSH ou d'identifiants Git globaux (délégué au système de l'utilisateur).

---

## 3. Architecture Technique & Modèles de Données

### 3.1. Modèles Pydantic Backend (`backend/app/api/git.py`)

```python
class GitRemoteDetail(BaseModel):
    name: str
    fetch_url: str
    push_url: str
    is_default: bool = False  # True si name == "origin"
    branches: list[str] = []

class CreateRemoteRequest(BaseModel):
    name: str
    url: str
    workspace: str | None = None

class UpdateRemoteRequest(BaseModel):
    new_name: str | None = None
    new_url: str | None = None
    workspace: str | None = None

class RemoteActionRequest(BaseModel):
    branch: str | None = None
    set_upstream: bool = False
    prune: bool = True
    workspace: str | None = None

class GitTagDetail(BaseModel):
    name: str
    commit_sha: str
    commit_short_sha: str
    commit_date: str
    commit_message: str
    is_annotated: bool
    tagger_name: str | None = None
    tagger_date: str | None = None
    tag_message: str | None = None

class CreateTagRequest(BaseModel):
    name: str
    target_commit: str = "HEAD"
    message: str | None = None  # Si renseigné => tag annoté (-a -m), sinon tag léger
    push_remote: str | None = None  # Si spécifié, push automatique vers ce remote après création
    workspace: str | None = None

class DeleteTagRequest(BaseModel):
    delete_remote: bool = False
    remote_name: str = "origin"
    workspace: str | None = None

class ReleaseNotesRequest(BaseModel):
    tag: str
    from_tag: str | None = None  # Si None, calculé automatiquement (tag précédent)
    workspace: str | None = None

class ReleaseNotesResponse(BaseModel):
    tag: str
    from_tag: str | None = None
    commits_count: int
    notes_markdown: str
    suggested_title: str

class PublishReleaseRequest(BaseModel):
    tag: str
    title: str
    body: str
    draft: bool = False
    prerelease: bool = False
    target_commitish: str | None = None
    workspace: str | None = None

class PublishReleaseResponse(BaseModel):
    success: bool
    method: str  # "gh_cli" | "web_url"
    url: str | None = None
    output: str | None = None
```

---

### 3.2. Endpoints Backend REST

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/git/remotes` | Liste de tous les remotes configurés avec fetch/push URLs |
| `POST` | `/api/git/remotes` | Ajoute un nouveau remote (`git remote add <name> <url>`) |
| `PUT` | `/api/git/remotes/{name}` | Met à jour le nom (`rename`) et/ou l'URL (`set-url`) |
| `DELETE` | `/api/git/remotes/{name}` | Supprime un remote (`git remote remove <name>`) |
| `POST` | `/api/git/remotes/{name}/test` | Teste la connectivité du remote via `git ls-remote --heads` |
| `POST` | `/api/git/remotes/{name}/fetch` | Récupère les références distantes (`git fetch <name> --prune`) |
| `POST` | `/api/git/remotes/{name}/push` | Pousse une branche vers le remote (`git push <name> <branch>`) |
| `GET` | `/api/git/tags` | Liste de tous les tags avec métadonnées complètes |
| `POST` | `/api/git/tags` | Crée un tag léger ou annoté, avec option de push immédiat |
| `DELETE` | `/api/git/tags/{name}` | Supprime un tag localement et optionnellement sur le remote |
| `POST` | `/api/git/tags/{name}/push` | Pousse un tag spécifique vers le remote |
| `POST` | `/api/git/tags/push-all` | Pousse tous les tags vers le remote (`git push <remote> --tags`) |
| `GET` | `/api/git/releases/notes` | Génère les notes de version Markdown structurées par Conventional Commits |
| `POST` | `/api/git/releases/publish` | Publie via `gh` CLI ou génère l'URL Web GitHub pré-remplie |

---

## 4. Composants Frontend & Expérience Utilisateur

### 4.1. Navigation dans `GitTab.tsx`
Le sélecteur de vue supporte désormais 6 onglets cohérents :
`'changes' | 'history' | 'stashes' | 'branches' | 'remotes' | 'tags'`
- **Onglet Remotes** : Icône `Globe`, badge indiquant le nombre de remotes configurés.
- **Onglet Tags** : Icône `Tag`, badge indiquant le nombre de tags existants.

### 4.2. `GitRemotesView.tsx` (`frontend/src/components/git/GitRemotesView.tsx`)
- **Barre d'outils** : Bouton `+ Ajouter un Remote`, bouton `Tout Synchroniser` (`fetch --all --prune`), champ de filtrage textuel.
- **Cartes de Remotes** :
  - Nom du remote avec badge `Default (origin)`.
  - URLs de Fetch et de Push avec bouton de copie rapide.
  - Indicateur de statut interactif : bouton `Tester` affichant une pastille verte (`Connecté`) ou rouge (`Inaccessible`) après ping réseau rapide.
  - Actions rapides : `Fetch`, `Push...` (choix de la branche courante et option `-u`), `Modifier`, `Supprimer`.
- **Dialogue Ajout/Édition** : Modal permettant de saisir/modifier le nom du remote et son URL avec validation de format (`https://` ou `git@`).

### 4.3. `GitTagsView.tsx` (`frontend/src/components/git/GitTagsView.tsx`)
- **Barre d'outils** : Recherche en temps réel (par nom, commit ou message), bouton `+ Créer un Tag`, bouton `Pousser tous les tags`.
- **Liste des Tags** :
  - Badge de nom de tag mis en valeur (`v0.2.22`).
  - Badge de type : `Annoté` ou `Léger`.
  - SHA court du commit avec bouton de copie, date de création, et message de tag (extensible).
  - Actions par tag :
    - 🚀 **`Créer une Release`** : Ouvre le studio de publication pré-rempli.
    - ⬆️ **`Pousser vers le remote`** : Pousse le tag unitaire.
    - 🗑️ **`Supprimer`** : Suppression locale avec case à cocher pour supprimer aussi sur le remote.
- **Dialogue de Création de Tag** :
  - Suggestion intelligente du prochain numéro de version selon SemVer.
  - Sélection du commit cible (`HEAD` par défaut, ou SHA personnalisé).
  - Bascule `Tag Annoté` vs `Tag Léger`.
  - Champ message du tag.
  - Option *"Pousser immédiatement vers origin"*.

### 4.4. `GitReleaseModal.tsx` (`frontend/src/components/git/GitReleaseModal.tsx`)
- Détection automatique du repository GitHub à partir du remote `origin`.
- Titre de la release pré-rempli et éditable.
- Notes de version générées automatiquement par analyse de commits Conventional Commits.
- Double vue : `Édition Markdown` et `Prévisualisation HTML`.
- Options : `Brouillon (Draft)`, `Pré-version (Prerelease)`.
- Action de publication : exécution automatique `gh` CLI si disponible ou ouverture immédiate dans le navigateur par défaut de l'URL GitHub Releases pré-remplie.

---

## 5. Algorithme de Génération de Changelog

1. Récupération du tag précédent via `git describe --tags --abbrev=0 <tag>^` (ou commit initial si premier tag).
2. Extraction des commits via `git log <previous>..<tag> --pretty=format:"%H|%h|%an|%s"`.
3. Tri et groupement des commits :
   - `feat:` / `feat(...)` ➔ `### 🚀 Nouvelles Fonctionnalités`
   - `fix:` / `fix(...)` ➔ `### 🐛 Corrections de Bugs`
   - `perf:` ➔ `### ⚡ Performances & Optimisations`
   - `refactor:` ➔ `### ♻️ Refactorisation`
   - `docs:` ➔ `### 📚 Documentation`
   - `chore:` / autres ➔ `### 🔧 Maintenance & Dépendances`
4. Ajout des liens GitHub automatiques pour chaque SHA de commit si le remote est GitHub.

---

## 6. Plan de Test & Validation (TDD)

1. **Pytest Backend (`backend/tests/test_git_remotes_tags.py`)** :
   - Tests CRUD remotes (add, list, update, delete).
   - Test ping connectivité (`test_connection`).
   - Tests tags légers et annotés (create, list, delete).
   - Test de génération de notes de version (Conventional Commits Markdown).
   - Test de génération de l'URL GitHub Releases.
2. **Qualité Frontend** :
   - Strict Oxlint : 0 warning, 0 error sur l'ensemble des fichiers.
   - TypeScript : `npx tsc -b` avec 0 erreur.
   - Build Vite : `npm run build` réussi sans erreur.
3. **Tests Live & E2E** :
   - Ajout d'un remote de test, test de connectivité, création d'un tag de test, génération du changelog de release.

---

## 7. Critères de Réussite & Release v0.2.23
- Tous les endpoints backend documentés et validés par tests unitaires.
- Les onglets `Remotes` et `Tags` s'affichent et fonctionnent sans régression dans `GitTab`.
- Génération et publication de release opérationnelles.
- Bump de version vers `0.2.23`, mise à jour de la `ROADMAP.md`, tag Git et push GitHub.
