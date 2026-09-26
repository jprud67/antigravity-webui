"""Unit tests for Git Worktree isolation service."""

import os
import subprocess
from pathlib import Path

import pytest

from app.services.git_worktree import (
    create_subagent_worktree,
    finalize_subagent_worktree,
    list_subagent_worktrees,
    resolve_repo_root,
)


@pytest.fixture
def temp_git_repo(tmp_path: Path):
    """Initializes a temporary git repo with an initial commit."""
    repo = tmp_path / "test_repo"
    repo.mkdir()
    subprocess.run(["git", "init"], cwd=repo, capture_output=True, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, capture_output=True, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, capture_output=True, check=True)

    dummy_file = repo / "README.md"
    dummy_file.write_text("# Test Repo\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=repo, capture_output=True, check=True)
    subprocess.run(["git", "commit", "-m", "Initial commit"], cwd=repo, capture_output=True, check=True)

    return str(repo)


def test_resolve_repo_root(temp_git_repo: str):
    root = resolve_repo_root(temp_git_repo)
    assert root is not None
    assert os.path.samefile(root, temp_git_repo)

    sub = os.path.join(temp_git_repo, "some_dir")
    os.makedirs(sub, exist_ok=True)
    assert resolve_repo_root(sub) == root


def test_create_and_auto_prune_clean_worktree(temp_git_repo: str):
    wt_info = create_subagent_worktree(temp_git_repo, "worker-1")
    assert wt_info is not None
    assert "subagent-worker-1" in wt_info["name"]
    wt_path = wt_info["path"]
    assert os.path.isdir(wt_path)

    # Worktree should appear in list
    active = list_subagent_worktrees(temp_git_repo)
    assert len(active) >= 1
    assert any("worker-1" in a.get("worktree", "") for a in active)

    # Finalize without changes -> should auto-prune
    fin = finalize_subagent_worktree(wt_info, prune=True)
    assert fin["pruned"] is True
    assert fin["retained"] is False
    assert not os.path.exists(wt_path)


def test_finalize_retains_worktree_with_commits(temp_git_repo: str):
    wt_info = create_subagent_worktree(temp_git_repo, "worker-commit")
    assert wt_info is not None
    wt_path = wt_info["path"]

    # Write a new file and commit it in the worktree
    new_file = os.path.join(wt_path, "feature.txt")
    with open(new_file, "w", encoding="utf-8") as f:
        f.write("New subagent feature\n")

    subprocess.run(["git", "add", "feature.txt"], cwd=wt_path, capture_output=True, check=True)
    subprocess.run(["git", "commit", "-m", "Subagent work"], cwd=wt_path, capture_output=True, check=True)

    # Finalize -> should retain worktree because commits == 1
    fin = finalize_subagent_worktree(wt_info, prune=True)
    assert fin["retained"] is True
    assert fin["pruned"] is False
    assert fin["commits"] == 1
    assert os.path.isdir(wt_path)

    # Cleanup manual
    subprocess.run(["git", "worktree", "remove", "--force", wt_path], cwd=temp_git_repo, capture_output=True)
    subprocess.run(["git", "branch", "-D", wt_info["branch"]], cwd=temp_git_repo, capture_output=True)
