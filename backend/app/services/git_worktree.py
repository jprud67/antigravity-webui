"""Git worktree isolation for delegated subagents and autonomous tasks.
Adapted directly from Hermes Agent (`tools/subagent_worktree.py`).

Isolates delegated subagent execution in private worktrees under `<repo>/.worktrees/subagent-<id>`
on a dedicated branch `antigravity-subagent/<id>`.
If the subagent finishes with 0 commits and a clean working tree, the worktree and branch
are automatically pruned. If changes were committed or uncommitted files remain,
the worktree is preserved for inspection or merging.
"""

from __future__ import annotations

import logging
import os
import subprocess
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_GIT_TIMEOUT = 30


def _run_git(args: List[str], cwd: str, timeout: int = _GIT_TIMEOUT) -> subprocess.CompletedProcess[str]:
    """Run git command capturing output without raising on non-zero return codes."""
    env = os.environ.copy()
    env["GIT_TERMINAL_PROMPT"] = "0"
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        stdin=subprocess.DEVNULL,
        env=env,
    )


def resolve_repo_root(path: Optional[str]) -> Optional[str]:
    """Return the git toplevel directory for path, or None if not inside a git repository."""
    candidate = os.path.abspath(os.path.expanduser(str(path))) if path else ""
    if not candidate or not os.path.isdir(candidate):
        return None
    try:
        res = _run_git(["rev-parse", "--show-toplevel"], cwd=candidate)
        if res.returncode == 0:
            top = res.stdout.strip()
            return os.path.normpath(top) if top else None
    except Exception as exc:
        logger.debug("worktree: rev-parse failed: %s", exc)
    return None


def ensure_worktrees_gitignore(repo_root: str) -> None:
    """Keep ``.worktrees/`` out of git status and git tracking."""
    gitignore = Path(repo_root) / ".gitignore"
    try:
        existing = gitignore.read_text(encoding="utf-8-sig", errors="replace") if gitignore.exists() else ""
        lines = [line.strip() for line in existing.splitlines()]
        if ".worktrees/" not in lines and ".worktrees" not in lines:
            with open(gitignore, "a", encoding="utf-8") as f:
                sep = "\n" if existing and not existing.endswith("\n") else ""
                f.write(f"{sep}.worktrees/\n")
    except Exception as exc:
        logger.debug("worktree: could not update .gitignore: %s", exc)


def create_subagent_worktree(
    parent_cwd: Optional[str],
    subagent_id: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    """Create an isolated git worktree for a subagent.
    
    Returns a dictionary with worktree metadata, or None if outside a repo or on error.
    """
    repo_root = resolve_repo_root(parent_cwd)
    if not repo_root:
        return None

    wt_id = (subagent_id or uuid.uuid4().hex[:8]).replace("/", "-").replace("\\", "-")
    wt_name = f"subagent-{wt_id}"
    branch = f"antigravity-subagent/{wt_name}"
    wt_path = Path(repo_root) / ".worktrees" / wt_name

    try:
        wt_path.parent.mkdir(parents=True, exist_ok=True)
        ensure_worktrees_gitignore(repo_root)

        # Get base commit hash
        base = _run_git(["rev-parse", "HEAD"], cwd=repo_root)
        base_commit = base.stdout.strip() if base.returncode == 0 else ""

        # Create worktree with dedicated branch
        result = _run_git(["worktree", "add", str(wt_path), "-b", branch, "HEAD"], cwd=repo_root)
        if result.returncode != 0:
            logger.warning("worktree: git worktree add failed: %s", result.stderr.strip())
            return None

        logger.info("worktree: created %s (branch %s)", wt_path, branch)
        return {
            "id": wt_id,
            "name": wt_name,
            "path": str(wt_path),
            "branch": branch,
            "repo_root": repo_root,
            "base_commit": base_commit,
            "created_at": base_commit
        }
    except Exception as exc:
        logger.warning("worktree: creation exception: %s", exc)
        return None


def finalize_subagent_worktree(
    info: Dict[str, Any],
    *,
    prune: bool = True
) -> Dict[str, Any]:
    """Inspect and finalize a subagent worktree.

    If prune is True and commits == 0 and dirty is False, the worktree and branch
    are cleanly removed. Otherwise, they are retained for manual review.
    """
    path = info.get("path", "")
    branch = info.get("branch", "")
    repo_root = info.get("repo_root", "")
    base_commit = info.get("base_commit", "")

    payload: Dict[str, Any] = {
        "path": path,
        "branch": branch,
        "repo_root": repo_root,
        "commits": 0,
        "dirty": False,
        "pruned": False,
        "retained": False,
    }

    if not path or not os.path.isdir(path):
        payload["pruned"] = True
        return payload

    cwd = repo_root or path

    # Probe commit count and dirty state
    try:
        if base_commit:
            res_commits = _run_git(["rev-list", "--count", f"{base_commit}..HEAD"], cwd=path)
            if res_commits.returncode == 0:
                payload["commits"] = int(res_commits.stdout.strip() or 0)

        res_dirty = _run_git(["status", "--porcelain"], cwd=path)
        if res_dirty.returncode == 0:
            payload["dirty"] = bool(res_dirty.stdout.strip())
    except Exception as exc:
        logger.warning("worktree: inspection error: %s", exc)
        payload["inspection_failed"] = True
        payload["retained"] = True
        return payload

    # If no work was done, prune it cleanly
    if prune and payload["commits"] == 0 and not payload["dirty"]:
        try:
            rm_res = _run_git(["worktree", "remove", "--force", path], cwd=cwd)
            if rm_res.returncode == 0:
                _run_git(["branch", "-D", branch], cwd=cwd)
                payload["pruned"] = True
                logger.info("worktree: pruned cleanly (no commits, no dirty files): %s", path)
            else:
                payload["retained"] = True
        except Exception as exc:
            logger.warning("worktree: prune error: %s", exc)
            payload["retained"] = True
    else:
        payload["retained"] = True
        logger.info(
            "worktree: preserved with work (%d commits, dirty=%s): %s",
            payload["commits"],
            payload["dirty"],
            path
        )

    return payload


def list_subagent_worktrees(repo_root: str) -> List[Dict[str, Any]]:
    """List all active subagent worktrees for a git repository."""
    root = resolve_repo_root(repo_root)
    if not root:
        return []

    res = _run_git(["worktree", "list", "--porcelain"], cwd=root)
    if res.returncode != 0:
        return []

    worktrees: List[Dict[str, Any]] = []
    current_entry: Dict[str, str] = {}

    for line in res.stdout.splitlines():
        line = line.strip()
        if not line:
            if current_entry.get("worktree"):
                wt_p = current_entry["worktree"]
                if ".worktrees" in wt_p:
                    current_entry["dirty"] = False
                    current_entry["commits"] = 0
                    if os.path.isdir(wt_p):
                        st = _run_git(["status", "--porcelain"], cwd=wt_p)
                        if st.returncode == 0:
                            current_entry["dirty"] = bool(st.stdout.strip())
                    worktrees.append(current_entry)
            current_entry = {}
            continue

        if line.startswith("worktree "):
            current_entry["worktree"] = line[9:].strip()
        elif line.startswith("branch "):
            current_entry["branch"] = line[7:].strip()
        elif line.startswith("HEAD "):
            current_entry["head"] = line[5:].strip()

    if current_entry.get("worktree") and ".worktrees" in current_entry["worktree"]:
        wt_p = current_entry["worktree"]
        current_entry["dirty"] = False
        current_entry["commits"] = 0
        if os.path.isdir(wt_p):
            st = _run_git(["status", "--porcelain"], cwd=wt_p)
            if st.returncode == 0:
                current_entry["dirty"] = bool(st.stdout.strip())
        worktrees.append(current_entry)

    return worktrees
