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

    # Remote mock repository (bare)
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

    # 6. Publish release URL generation
    res = client.post(
        "/api/git/releases/publish",
        json={"tag": "v0.2.0", "title": "Release v0.2.0", "body": "Changelog test", "workspace": ws},
        headers=auth_headers
    )
    assert res.status_code == 200
    pub = res.json()
    assert pub["success"] is True
    assert pub["method"] in ["gh_cli", "web_url"]
