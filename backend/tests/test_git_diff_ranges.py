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

    test_file = repo_dir / "sample.py"
    test_file.write_text("line 1\nline 2\nline 3\nline 4\nline 5\n", encoding="utf-8")
    run_git_cmd(["add", "sample.py"], cwd=repo_dir)
    run_git_cmd(["commit", "-m", "initial commit"], cwd=repo_dir)

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


def test_file_diff_ranges_clean(temp_git_repo: Path, auth_headers: dict):
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py", "workspace": str(temp_git_repo)}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["file_path"] == "sample.py"
    assert data["is_tracked"] is True
    assert data["ranges"] == []
    assert data["summary"]["total_changes"] == 0


def test_file_diff_ranges_modified_and_added(temp_git_repo: Path, auth_headers: dict):
    sample_file = temp_git_repo / "sample.py"
    # modify line 2 and append lines 6, 7
    sample_file.write_text("line 1\nline 2 modified\nline 3\nline 4\nline 5\nline 6\nline 7\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py", "workspace": str(temp_git_repo)}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["ranges"]) >= 2
    types = [r["type"] for r in data["ranges"]]
    assert "modified" in types or "added" in types
    assert data["summary"]["total_changes"] > 0


def test_file_diff_ranges_deleted(temp_git_repo: Path, auth_headers: dict):
    sample_file = temp_git_repo / "sample.py"
    # delete line 3
    sample_file.write_text("line 1\nline 2\nline 4\nline 5\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "sample.py", "workspace": str(temp_git_repo)}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    types = [r["type"] for r in data["ranges"]]
    assert "deleted" in types
    assert data["summary"]["deleted_lines"] >= 1


def test_file_diff_ranges_untracked(temp_git_repo: Path, auth_headers: dict):
    new_file = temp_git_repo / "brand_new.py"
    new_file.write_text("print('hello')\nprint('world')\n", encoding="utf-8")
    res = client.get("/api/git/file-diff-ranges", params={"file_path": "brand_new.py", "workspace": str(temp_git_repo)}, headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["is_tracked"] is False
    assert len(data["ranges"]) == 1
    assert data["ranges"][0]["type"] == "added"
    assert data["ranges"][0]["start_line"] == 1
    assert data["ranges"][0]["end_line"] == 2
    assert data["summary"]["added_lines"] == 2
