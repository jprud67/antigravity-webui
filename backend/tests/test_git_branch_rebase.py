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
    repo_dir = tmp_path / "test_branch_repo"
    repo_dir.mkdir()
    run_git_cmd(["init", "-b", "main"], cwd=repo_dir)

    settings = get_settings()
    workspaces = settings.get("trustedWorkspaces", [])
    str_path = str(repo_dir.resolve())
    if str_path not in workspaces:
        workspaces.append(str_path)
        settings["trustedWorkspaces"] = workspaces
        save_settings(settings)

    file1 = repo_dir / "file1.txt"
    file1.write_text("Hello World\nInitial line\n", encoding="utf-8")
    run_git_cmd(["add", "file1.txt"], cwd=repo_dir)
    run_git_cmd(["commit", "-m", "Initial commit"], cwd=repo_dir)

    yield repo_dir

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


def test_get_branches_detail(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Create an additional branch
    run_git_cmd(["branch", "feature/awesome"], cwd=git_test_repo)

    res = client.get(f"/api/git/branches?workspace={ws}", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "current" in data
    assert data["current"] == "main"
    assert "branches" in data
    assert isinstance(data["branches"], list)
    assert len(data["branches"]) >= 2
    
    # Check enriched structure
    main_br = next(b for b in data["branches"] if b["name"] == "main")
    assert main_br["is_current"] is True
    assert main_br["is_remote"] is False
    assert main_br["last_commit_subject"] == "Initial commit"


def test_create_and_checkout_branch(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Create with checkout=True
    create_res = client.post("/api/git/branches/create", json={
        "workspace": ws,
        "name": "feature/login",
        "checkout": True
    }, headers=auth_headers)
    assert create_res.status_code == 200
    assert create_res.json()["success"] is True

    # Verify active branch is now feature/login
    status_res = client.get(f"/api/git/status?workspace={ws}", headers=auth_headers)
    assert status_res.status_code == 200
    assert status_res.json()["branch"] == "feature/login"

    # Switch back to main via checkout endpoint
    checkout_res = client.post("/api/git/branches/checkout", json={
        "workspace": ws,
        "branch": "main"
    }, headers=auth_headers)
    assert checkout_res.status_code == 200
    assert checkout_res.json()["success"] is True


def test_rename_branch(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    run_git_cmd(["branch", "feature/old-name"], cwd=git_test_repo)

    res = client.post("/api/git/branches/rename", json={
        "workspace": ws,
        "old_name": "feature/old-name",
        "new_name": "feature/new-name"
    }, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["success"] is True

    # Verify branch was renamed
    branches_res = client.get(f"/api/git/branches?workspace={ws}", headers=auth_headers)
    branch_names = [b["name"] for b in branches_res.json()["branches"]]
    assert "feature/new-name" in branch_names
    assert "feature/old-name" not in branch_names


def test_delete_branch_guards(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Trying to delete current active branch (main) must fail with 400
    del_active = client.request("DELETE", "/api/git/branches", json={
        "workspace": ws,
        "branch": "main"
    }, headers=auth_headers)
    assert del_active.status_code == 400

    # Create a feature branch and switch to it
    run_git_cmd(["checkout", "-b", "feature/temp"], cwd=git_test_repo)

    # Trying to delete main (protected) even if not active should fail
    del_main = client.request("DELETE", "/api/git/branches", json={
        "workspace": ws,
        "branch": "main"
    }, headers=auth_headers)
    assert del_main.status_code == 400

    # Switch back to main and delete feature/temp safely
    run_git_cmd(["checkout", "main"], cwd=git_test_repo)
    del_temp = client.request("DELETE", "/api/git/branches", json={
        "workspace": ws,
        "branch": "feature/temp",
        "force": False
    }, headers=auth_headers)
    assert del_temp.status_code == 200
    assert del_temp.json()["success"] is True


def test_merge_branch(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Create branch and commit a new file
    run_git_cmd(["checkout", "-b", "feature/docs"], cwd=git_test_repo)
    doc_file = git_test_repo / "docs.md"
    doc_file.write_text("# Documentation\n", encoding="utf-8")
    run_git_cmd(["add", "docs.md"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "docs: add guide"], cwd=git_test_repo)

    # Switch back to main and merge feature/docs
    run_git_cmd(["checkout", "main"], cwd=git_test_repo)

    merge_res = client.post("/api/git/branches/merge", json={
        "workspace": ws,
        "branch": "feature/docs",
        "no_ff": True,
        "message": "merge: feature/docs into main"
    }, headers=auth_headers)
    assert merge_res.status_code == 200
    assert merge_res.json()["success"] is True
    assert (git_test_repo / "docs.md").exists()


def test_rebase_todo(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Add 2 more commits
    f = git_test_repo / "c1.txt"
    f.write_text("c1\n")
    run_git_cmd(["add", "c1.txt"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "feat: commit one"], cwd=git_test_repo)

    f2 = git_test_repo / "c2.txt"
    f2.write_text("c2\n")
    run_git_cmd(["add", "c2.txt"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "feat: commit two"], cwd=git_test_repo)

    res = client.get(f"/api/git/rebase/todo?base=HEAD~2&workspace={ws}", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "commits" in data
    assert len(data["commits"]) == 2
    assert data["commits"][0]["subject"] == "feat: commit one"
    assert data["commits"][1]["subject"] == "feat: commit two"
    assert data["commits"][0]["action"] == "pick"


def test_rebase_status_when_idle(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    res = client.get(f"/api/git/rebase/status?workspace={ws}", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["is_rebasing"] is False


def test_rebase_execute_reword_and_drop(git_test_repo, auth_headers):
    ws = str(git_test_repo)
    # Add commits
    f1 = git_test_repo / "step1.txt"
    f1.write_text("step1\n")
    run_git_cmd(["add", "step1.txt"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "step 1 initial"], cwd=git_test_repo)

    f2 = git_test_repo / "step2.txt"
    f2.write_text("step2\n")
    run_git_cmd(["add", "step2.txt"], cwd=git_test_repo)
    run_git_cmd(["commit", "-m", "step 2 to drop"], cwd=git_test_repo)

    # Fetch todo
    todo_res = client.get(f"/api/git/rebase/todo?base=HEAD~2&workspace={ws}", headers=auth_headers)
    commits = todo_res.json()["commits"]
    assert len(commits) == 2

    # Action: reword commit 1, drop commit 2
    c1_sha = commits[0]["sha"]
    c2_sha = commits[1]["sha"]

    payload = {
        "workspace": ws,
        "base": "HEAD~2",
        "commits": [
            {"sha": c1_sha, "action": "reword", "new_message": "feat: step 1 reworded"},
            {"sha": c2_sha, "action": "drop"}
        ]
    }
    exec_res = client.post("/api/git/rebase/execute", json=payload, headers=auth_headers)
    assert exec_res.status_code == 200
    assert exec_res.json()["success"] is True

    # Verify commit log: commit 2 dropped, commit 1 has new message
    log_res = client.get(f"/api/git/log?workspace={ws}&limit=5", headers=auth_headers)
    commits_after = log_res.json()["commits"]
    subjects = [c["subject"] for c in commits_after]
    assert "feat: step 1 reworded" in subjects
    assert "step 2 to drop" not in subjects
    assert not (git_test_repo / "step2.txt").exists()
