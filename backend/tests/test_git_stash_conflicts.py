import os
import shutil
import subprocess
from pathlib import Path
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.storage import get_settings, save_settings

client = TestClient(app)

GIT_BIN = shutil.which("git") or "git"

def run_git_cmd(args: list[str], cwd: Path):
    cmd = [
        GIT_BIN,
        "-c", "user.name=TestUser",
        "-c", "user.email=test@example.com",
        "-c", "commit.gpgsign=false"
    ] + args
    res = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, check=True)
    return res.stdout.strip()


@pytest.fixture
def git_test_repo(tmp_path: Path):
    repo_dir = tmp_path / "test_repo"
    repo_dir.mkdir()
    run_git_cmd(["init", "-b", "main"], cwd=repo_dir)

    # Add to trusted workspaces so _validate_workspace accepts it
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    str_path = str(repo_dir.resolve())
    if str_path not in workspaces:
        workspaces.append(str_path)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)

    # Initial commit
    file1 = repo_dir / "file1.txt"
    file1.write_text("Hello World\nInitial line\n", encoding="utf-8")
    run_git_cmd(["add", "file1.txt"], cwd=repo_dir)
    run_git_cmd(["commit", "-m", "Initial commit"], cwd=repo_dir)

    yield repo_dir

    # Cleanup trustedWorkspaces
    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    if str_path in workspaces:
        workspaces.remove(str_path)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)


@pytest.fixture
def auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_stash_lifecycle(git_test_repo: Path, auth_headers: dict):
    # 1. Modify file1.txt
    file1 = git_test_repo / "file1.txt"
    file1.write_text("Hello World\nModified for stash\n", encoding="utf-8")

    # Untracked file
    untracked = git_test_repo / "untracked.txt"
    untracked.write_text("I am untracked\n", encoding="utf-8")

    ws = str(git_test_repo)

    # List stashes initially - should be empty
    res = client.get(f"/api/git/stash?workspace={ws}", headers=auth_headers)
    assert res.status_code == 200
    assert res.json() == []

    # 2. Push stash with include_untracked=True
    push_res = client.post("/api/git/stash", json={
        "workspace": ws,
        "message": "WIP work on feature",
        "include_untracked": True
    }, headers=auth_headers)
    assert push_res.status_code == 200
    push_data = push_res.json()
    assert push_data["status"] == "ok"

    # Working dir should now be clean
    assert "Modified for stash" not in file1.read_text(encoding="utf-8")
    assert not untracked.exists()

    # 3. List stashes - should have 1 entry
    list_res = client.get(f"/api/git/stash?workspace={ws}", headers=auth_headers)
    assert list_res.status_code == 200
    stashes = list_res.json()
    assert len(stashes) == 1
    assert stashes[0]["index"] == 0
    assert "WIP work on feature" in stashes[0]["message"]

    # 4. View diff of stash@{0}
    diff_res = client.get(f"/api/git/stash/diff?workspace={ws}&index=0", headers=auth_headers)
    assert diff_res.status_code == 200
    diff_data = diff_res.json()
    assert "Modified for stash" in diff_data["diff"]

    # 5. Apply stash (should restore changes but keep stash in stack)
    apply_res = client.post("/api/git/stash/apply", json={
        "workspace": ws,
        "index": 0
    }, headers=auth_headers)
    assert apply_res.status_code == 200
    assert "Modified for stash" in file1.read_text(encoding="utf-8")

    # Stash should still be in stack
    list_res2 = client.get(f"/api/git/stash?workspace={ws}", headers=auth_headers)
    assert len(list_res2.json()) == 1

    # 6. Drop stash
    drop_res = client.delete(f"/api/git/stash?workspace={ws}&index=0", headers=auth_headers)
    assert drop_res.status_code == 200
    list_res3 = client.get(f"/api/git/stash?workspace={ws}", headers=auth_headers)
    assert len(list_res3.json()) == 0


def test_conflict_detection_and_resolution(git_test_repo: Path, auth_headers: dict):
    ws = str(git_test_repo)
    file1 = git_test_repo / "file1.txt"

    # Create branch 'feature'
    run_git_cmd(["checkout", "-b", "feature"], cwd=git_test_repo)
    file1.write_text("Hello World\nLine from FEATURE branch\n", encoding="utf-8")
    run_git_cmd(["commit", "-am", "Change in feature"], cwd=git_test_repo)

    # Checkout 'main' and make conflicting change
    run_git_cmd(["checkout", "main"], cwd=git_test_repo)
    file1.write_text("Hello World\nLine from MAIN branch\n", encoding="utf-8")
    run_git_cmd(["commit", "-am", "Change in main"], cwd=git_test_repo)

    # Attempt merge - will fail with conflict
    merge_proc = subprocess.run([GIT_BIN, "merge", "feature"], cwd=git_test_repo, capture_output=True, text=True)
    assert merge_proc.returncode != 0

    # Status should report conflict
    status_res = client.get(f"/api/git/status?workspace={ws}", headers=auth_headers)
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert "file1.txt" in status_data.get("conflicts", [])

    # 1. Fetch conflict file 3-way contents
    conf_res = client.get(f"/api/git/conflicts/file?workspace={ws}&path=file1.txt", headers=auth_headers)
    assert conf_res.status_code == 200
    conf_data = conf_res.json()
    assert "Initial line" in conf_data["base_content"]
    assert "Line from MAIN branch" in conf_data["ours_content"]
    assert "Line from FEATURE branch" in conf_data["theirs_content"]
    assert "<<<<<<<" in conf_data["current_content"]

    # 2. Resolve conflict with 'theirs'
    res_resolve = client.post("/api/git/conflicts/resolve", json={
        "workspace": ws,
        "path": "file1.txt",
        "resolution": "theirs"
    }, headers=auth_headers)
    assert res_resolve.status_code == 200
    assert res_resolve.json()["status"] == "resolved"

    # File content should now match 'theirs'
    assert "Line from FEATURE branch" in file1.read_text(encoding="utf-8")

    # Status should no longer report conflict
    status_after = client.get(f"/api/git/status?workspace={ws}", headers=auth_headers)
    assert "file1.txt" not in status_after.json().get("conflicts", [])


def test_cherry_pick(git_test_repo: Path, auth_headers: dict):
    ws = str(git_test_repo)

    # Create new branch and commit a new file
    run_git_cmd(["checkout", "-b", "topic"], cwd=git_test_repo)
    new_f = git_test_repo / "cherry.txt"
    new_f.write_text("Cherry picked content\n", encoding="utf-8")
    run_git_cmd(["add", "cherry.txt"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "Add cherry file"], cwd=git_test_repo)

    topic_hash = run_git_cmd(["rev-parse", "HEAD"], cwd=git_test_repo)

    # Switch back to main
    run_git_cmd(["checkout", "main"], cwd=git_test_repo)
    assert not new_f.exists()

    # Cherry-pick the topic commit into main via API
    cp_res = client.post("/api/git/cherry-pick", json={
        "workspace": ws,
        "commit_hash": topic_hash
    }, headers=auth_headers)
    assert cp_res.status_code == 200
    assert cp_res.json()["status"] == "applied"
    assert new_f.exists()
    assert "Cherry picked content" in new_f.read_text(encoding="utf-8")
