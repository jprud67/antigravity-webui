"""API router for subagent Git Worktree isolation."""

from typing import Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.services.git_worktree import (
    resolve_repo_root,
    create_subagent_worktree,
    finalize_subagent_worktree,
    list_subagent_worktrees,
    _run_git
)

router = APIRouter(prefix="/api/worktrees", tags=["worktrees"])


class CreateWorktreeRequest(BaseModel):
    cwd: Optional[str] = None
    subagent_id: Optional[str] = None


class FinalizeWorktreeRequest(BaseModel):
    path: str
    branch: Optional[str] = None
    repo_root: Optional[str] = None
    base_commit: Optional[str] = None
    prune: bool = True


class RemoveWorktreeRequest(BaseModel):
    path: str
    branch: Optional[str] = None
    repo_root: Optional[str] = None


@router.get("")
def get_worktrees(cwd: Optional[str] = Query(None)):
    """List all active subagent worktrees for the repository containing cwd."""
    root = resolve_repo_root(cwd or ".")
    if not root:
        return {"repo_root": None, "worktrees": []}
    items = list_subagent_worktrees(root)
    return {"repo_root": root, "worktrees": items}


@router.post("/create")
def api_create_worktree(req: CreateWorktreeRequest):
    """Create an isolated worktree for subagent execution."""
    res = create_subagent_worktree(req.cwd or ".", req.subagent_id)
    if not res:
        raise HTTPException(
            status_code=400,
            detail="Impossible de créer le worktree Git (dossier hors repo Git ou HEAD inexistant)"
        )
    return res


@router.post("/finalize")
def api_finalize_worktree(req: FinalizeWorktreeRequest):
    """Inspect and finalize a worktree (auto-prune if clean & zero commits, otherwise retain)."""
    res = finalize_subagent_worktree(req.model_dump(), prune=req.prune)
    return res


@router.delete("")
def api_remove_worktree(req: RemoveWorktreeRequest):
    """Manually force-remove a subagent worktree and its branch."""
    path = req.path
    repo_root = req.repo_root or resolve_repo_root(path)
    if not repo_root:
        raise HTTPException(status_code=400, detail="Repo root introuvable")

    rm_res = _run_git(["worktree", "remove", "--force", path], cwd=repo_root)
    branch_deleted = False
    if req.branch:
        b_res = _run_git(["branch", "-D", req.branch], cwd=repo_root)
        branch_deleted = b_res.returncode == 0

    return {
        "success": rm_res.returncode == 0,
        "removed_path": path,
        "branch_deleted": branch_deleted,
        "stderr": rm_res.stderr.strip()
    }
