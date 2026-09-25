# Git Remote Manager & Interactive Tag Publisher Studio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter le studio de gestion des dépôts distants (Git Remotes) et des tags avec générateur intelligent de notes de version et publication de releases GitHub dans Antigravity WebUI.

**Architecture:** Architecture modulaire composant par composant : endpoints backend REST robustes avec exécution asynchrone sécurisée de Git et tests TDD pytest, types TypeScript stricts, composants modulaires dédiés dans `frontend/src/components/git/` (`GitRemotesView`, `GitTagsView`, `GitReleaseModal`) intégrés en sous-onglets dans `GitTab.tsx`.

**Tech Stack:** FastAPI (Python 3.13), Git CLI, Pytest, React 19, TypeScript, Tailwind CSS, Lucide Icons, Vite.

**Spec:** [`docs/superpowers/specs/2026-09-25-git-remote-manager-tag-publisher-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-25-git-remote-manager-tag-publisher-design.md)

## Global Constraints

- 0 warning, 0 error sur Oxlint strict (`npx oxlint --deny-warnings`).
- 0 erreur sur le compilateur TypeScript (`npx tsc -b`).
- 100% de réussite sur la suite de tests backend pytest.
- Auteur strict pour tous les commits : `jprud67 <jprud67@gmail.com>`.
- Ne pas inclure de trailer `Co-Authored-By`.
- Sécurisation absolue contre l'injection de commandes shell (arguments passés sous forme de liste `list[str]` à `run_git`, jamais de `shell=True`).
- Timeouts réseau stricts (5s pour les tests de connectivité, 30s pour fetch/push).

---

### Task 1: Backend Remote & Tag Endpoints with TDD Unit Tests

**Files:**
- Create: `backend/tests/test_git_remotes_tags.py`
- Modify: `backend/app/api/git.py`

**Interfaces:**
- Consumes: `run_git`, `_validate_workspace`, `require_auth` from `backend/app/api/git.py`
- Produces:
  - `GET /api/git/remotes` -> `list[GitRemoteDetail]`
  - `POST /api/git/remotes` -> `GitRemoteDetail`
  - `PUT /api/git/remotes/{name}` -> `GitRemoteDetail`
  - `DELETE /api/git/remotes/{name}` -> `{"success": bool}`
  - `POST /api/git/remotes/{name}/test` -> `{"success": bool, "latency_ms": int, "output": str}`
  - `POST /api/git/remotes/{name}/fetch` -> `{"success": bool, "output": str}`
  - `POST /api/git/remotes/{name}/push` -> `{"success": bool, "output": str}`
  - `GET /api/git/tags` -> `list[GitTagDetail]`
  - `POST /api/git/tags` -> `GitTagDetail`
  - `DELETE /api/git/tags/{name}` -> `{"success": bool}`
  - `POST /api/git/tags/{name}/push` -> `{"success": bool, "output": str}`
  - `POST /api/git/tags/push-all` -> `{"success": bool, "output": str}`
  - `GET /api/git/releases/notes` -> `ReleaseNotesResponse`
  - `POST /api/git/releases/publish` -> `PublishReleaseResponse`

- [ ] **Step 1: Write the failing TDD test suite in `backend/tests/test_git_remotes_tags.py`**

```python
import os
import shutil
import subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.storage import get_settings, save_settings

client = TestClient(app)

def run_git_cmd(args: list[str], cwd: Path):
    cmd = [
        shutil.which("git") or "git",
        "-c", "user.name=TestUser",
        "-c", "user.email=test@example.com",
        "-c", "commit.gpgsign=false"
    ] + args
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)
    return res.stdout.strip()

@pytest.fixture
def temp_git_repo(tmp_path: Path):
    repo_dir = tmp_path / "test_repo"
    repo_dir.mkdir()
    run_git_cmd(["init", "-b", "main"], cwd=repo_dir)

    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    str_path = str(repo_dir.resolve())
    if str_path not in workspaces:
        workspaces.append(str_path)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)

    test_file = repo_dir / "sample.txt"
    test_file.write_text("initial line", encoding="utf-8")
    run_git_cmd(["add", "sample.txt"], cwd=repo_dir)
    run_git_cmd(["commit", "-m", "chore: initial commit"], cwd=repo_dir)

    # Secondary commit for Conventional Commits changelog test
    test_file.write_text("initial line\nfeat line", encoding="utf-8")
    run_git_cmd(["add", "sample.txt"], cwd=repo_dir)
    run_git_cmd(["commit", "-m", "feat: add super feature"], cwd=repo_dir)

    # Remote mock repository
    remote_dir = tmp_path / "remote_repo"
    remote_dir.mkdir()
    run_git_cmd(["init", "--bare", "-b", "main"], cwd=remote_dir)

    yield repo_dir, remote_dir

    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    if str_path in workspaces:
        workspaces.remove(str_path)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)

@pytest.fixture
def auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    if login_res.status_code == 200:
        token = login_res.json().get("token")
        return {"Authorization": f"Bearer {token}"}
    return {}

def test_remotes_crud(temp_git_repo, auth_headers):
    repo_dir, remote_dir = temp_git_repo
    ws = str(repo_dir)
    remote_url = str(remote_dir)

    # 1. Add remote
    res = client.post("/api/git/remotes", json={"name": "upstream", "url": remote_url, "workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "upstream"
    assert data["fetch_url"] == remote_url

    # 2. List remotes
    res = client.get("/api/git/remotes", params={"workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    remotes = res.json()
    assert any(r["name"] == "upstream" for r in remotes)

    # 3. Rename remote
    res = client.put("/api/git/remotes/upstream", json={"new_name": "origin", "workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["name"] == "origin"

    # 4. Test remote connection
    res = client.post("/api/git/remotes/origin/test", params={"workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["success"] is True

    # 5. Delete remote
    res = client.delete("/api/git/remotes/origin", params={"workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["success"] is True

def test_tags_and_releases(temp_git_repo, auth_headers):
    repo_dir, _ = temp_git_repo
    ws = str(repo_dir)

    # 1. Create lightweight tag v0.1.0
    res = client.post("/api/git/tags", json={"name": "v0.1.0", "target_commit": "HEAD~1", "workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "v0.1.0"
    assert data["is_annotated"] is False

    # 2. Create annotated tag v0.2.0
    res = client.post("/api/git/tags", json={"name": "v0.2.0", "target_commit": "HEAD", "message": "Sprint release v0.2.0", "workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["name"] == "v0.2.0"
    assert data["is_annotated"] is True
    assert data["tag_message"] == "Sprint release v0.2.0"

    # 3. List tags
    res = client.get("/api/git/tags", params={"workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    tags = res.json()
    assert len(tags) >= 2

    # 4. Release notes generation
    res = client.get("/api/git/releases/notes", params={"tag": "v0.2.0", "workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    notes = res.json()
    assert notes["tag"] == "v0.2.0"
    assert "Features" in notes["notes_markdown"] or "Nouvelles" in notes["notes_markdown"] or "feat" in notes["notes_markdown"]

    # 5. Delete tag
    res = client.delete("/api/git/tags/v0.1.0", params={"workspace": ws}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["success"] is True
```

- [ ] **Step 2: Run pytest to verify test collection fails before implementation**

Run: `pytest tests/test_git_remotes_tags.py`
Expected: 404 Not Found on the new endpoints.

- [ ] **Step 3: Implement remote & tag endpoints in `backend/app/api/git.py`**

Implement Pydantic models and routes:
- `GitRemoteDetail`, `CreateRemoteRequest`, `UpdateRemoteRequest`, `RemoteActionRequest`
- `GitTagDetail`, `CreateTagRequest`, `DeleteTagRequest`
- `ReleaseNotesResponse`, `PublishReleaseRequest`, `PublishReleaseResponse`
- Endpoints under `/api/git/remotes` and `/api/git/tags` and `/api/git/releases`
- Secure execution of `git remote`, `git tag`, `git ls-remote`, `git log`, `gh release create`.

- [ ] **Step 4: Run pytest to verify all tests pass**

Run: `pytest tests/test_git_remotes_tags.py`
Expected: 2 passed in ~2s.
Run full suite: `pytest tests/`
Expected: 97 passed (100%).

- [ ] **Step 5: Commit Task 1**

```bash
git add backend/app/api/git.py backend/tests/test_git_remotes_tags.py
git commit -m "feat(git): add REST endpoints and TDD tests for remotes, tags, and releases" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 2: Frontend Types & API Client Services

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`

**Interfaces:**
- Produces in `frontend/src/types/index.ts`:
  - `GitRemoteDetail`, `CreateRemotePayload`, `UpdateRemotePayload`, `RemoteActionPayload`
  - `GitTagDetail`, `CreateTagPayload`, `DeleteTagPayload`
  - `ReleaseNotesResponse`, `PublishReleasePayload`, `PublishReleaseResponse`
- Produces in `frontend/src/services/api.ts`:
  - `fetchGitRemotes(workspace?)`
  - `createGitRemote(payload, workspace?)`
  - `updateGitRemote(name, payload, workspace?)`
  - `deleteGitRemote(name, workspace?)`
  - `testGitRemoteConnection(name, workspace?)`
  - `fetchGitRemote(name, prune?, workspace?)`
  - `pushGitRemote(name, branch?, setUpstream?, workspace?)`
  - `fetchGitTags(workspace?)`
  - `createGitTag(payload, workspace?)`
  - `deleteGitTag(name, deleteRemote?, remoteName?, workspace?)`
  - `pushGitTag(name, remote?, workspace?)`
  - `pushAllGitTags(remote?, workspace?)`
  - `fetchReleaseNotes(tag, fromTag?, workspace?)`
  - `publishGitRelease(payload, workspace?)`

- [ ] **Step 1: Add TypeScript interfaces to `frontend/src/types/index.ts`**
- [ ] **Step 2: Add API service methods to `frontend/src/services/api.ts`**
- [ ] **Step 3: Verify TypeScript compiler and Oxlint**

Run: `npx oxlint --deny-warnings src/types/index.ts src/services/api.ts`
Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 4: Commit Task 2**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts
git commit -m "feat(git): add frontend types and API client functions for remotes and tags" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 3: Git Remotes View Component (`GitRemotesView.tsx`)

**Files:**
- Create: `frontend/src/components/git/GitRemotesView.tsx`

**Features:**
- List of configured remotes with names, fetch and push URLs, default origin badge.
- 1-click connectivity ping (`Test Connection`) displaying status indicator (online with latency vs offline).
- `Fetch` button and `Push` button with branch selection.
- `+ Ajouter un Remote` modal with input validation.
- Edit remote modal (rename / set-url).
- Delete remote confirmation dialog.
- Responsive layout, search/filtering, and dark theme support.

- [ ] **Step 1: Implement `frontend/src/components/git/GitRemotesView.tsx`**
- [ ] **Step 2: Verify Oxlint and TypeScript**

Run: `npx oxlint --deny-warnings src/components/git/GitRemotesView.tsx`
Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 3: Commit Task 3**

```bash
git add frontend/src/components/git/GitRemotesView.tsx
git commit -m "feat(git): create GitRemotesView component with connectivity tests and CRUD" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 4: Git Tags View Component (`GitTagsView.tsx`)

**Files:**
- Create: `frontend/src/components/git/GitTagsView.tsx`

**Features:**
- List of Git tags sorted by commit date / version descending.
- Tags displayed with badges (annotated vs lightweight), target commit SHA, author date, and expandable message.
- Search filter by tag name, commit SHA, or message.
- Modal `CreateTagModal` with SemVer auto-suggestion, commit selection, annotated message, and immediate push checkbox.
- Single tag push (`git push <remote> <tag>`) and push all (`git push <remote> --tags`).
- Delete tag with optional remote deletion checkbox.
- "Créer une Release" action triggering release publisher modal.

- [ ] **Step 1: Implement `frontend/src/components/git/GitTagsView.tsx`**
- [ ] **Step 2: Verify Oxlint and TypeScript**

Run: `npx oxlint --deny-warnings src/components/git/GitTagsView.tsx`
Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 3: Commit Task 4**

```bash
git add frontend/src/components/git/GitTagsView.tsx
git commit -m "feat(git): create GitTagsView component with SemVer suggestions and tag actions" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 5: Interactive Release Publisher Modal (`GitReleaseModal.tsx`)

**Files:**
- Create: `frontend/src/components/git/GitReleaseModal.tsx`

**Features:**
- Modal header with tag name and detected GitHub repo link.
- Release title input prefilled with clean format.
- Automated release notes generator loading changelog from `GET /api/git/releases/notes`.
- Split edit / preview markdown viewer for release notes.
- Checkboxes: `Pré-version (Prerelease)` et `Brouillon (Draft)`.
- Publish action:
  - If `gh` CLI available, calls `POST /api/git/releases/publish` and shows success toast + link.
  - If fallback, opens pre-filled GitHub Releases URL (`https://github.com/.../releases/new?...`) in default browser.
- "Copier les notes" button for instant markdown clipboard copy.

- [ ] **Step 1: Implement `frontend/src/components/git/GitReleaseModal.tsx`**
- [ ] **Step 2: Verify Oxlint and TypeScript**

Run: `npx oxlint --deny-warnings src/components/git/GitReleaseModal.tsx`
Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 3: Commit Task 5**

```bash
git add frontend/src/components/git/GitReleaseModal.tsx
git commit -m "feat(git): create GitReleaseModal for automated changelog and GitHub releases" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 6: Integration into `GitTab.tsx` & Quality Gates

**Files:**
- Modify: `frontend/src/components/GitTab.tsx`

**Features:**
- Extend `viewMode` with `'remotes'` and `'tags'`.
- Add tab buttons with `Globe` and `Tag` icons, and dynamic count badges.
- Render `GitRemotesView` and `GitTagsView`.
- Wire `GitReleaseModal` state (`selectedTagForRelease`, `isReleaseModalOpen`).
- Ensure seamless transitions and toasts.

- [ ] **Step 1: Update `GitTab.tsx` to include `Remotes` and `Tags` sub-tabs**
- [ ] **Step 2: Verify Oxlint strict across all files**

Run: `npm run lint`
Expected: 0 warnings, 0 errors.

- [ ] **Step 3: Verify TypeScript compiler**

Run: `npx tsc -b`
Expected: 0 errors.

- [ ] **Step 4: Verify full backend test suite**

Run: `pytest tests/` in backend directory
Expected: 100% pass rate.

- [ ] **Step 5: Run production build**

Run: `npm run build` in frontend directory
Expected: Build succeeds cleanly.

- [ ] **Step 6: Commit Task 6**

```bash
git add frontend/src/components/GitTab.tsx
git commit -m "feat(git): integrate Remotes and Tags studios into GitTab" --author="jprud67 <jprud67@gmail.com>"
```

---

### Task 7: Release v0.2.23 & Deployment

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/public/sw.js`
- Modify: `backend/app/main.py`
- Modify: `backend/app/services/updater.py`
- Modify: `docs/ROADMAP.md`
- Modify: `task.md`
- Modify: `walkthrough.md`

- [ ] **Step 1: Bump version to `0.2.23` across all metadata files**
- [ ] **Step 2: Update `ROADMAP.md`, `task.md`, and `walkthrough.md`**
- [ ] **Step 3: Run final production build (`npm run build`)**
- [ ] **Step 4: Commit release bump**

```bash
git commit -am "chore(release): bump version to v0.2.23 for Git Remote Manager & Interactive Tag Publisher Studio" --author="jprud67 <jprud67@gmail.com>"
```

- [ ] **Step 5: Tag release `v0.2.23` and push to GitHub**

```bash
git tag -a v0.2.23 -m "Release v0.2.23: Git Remote Manager & Interactive Tag Publisher Studio"
git push origin main --tags
```
