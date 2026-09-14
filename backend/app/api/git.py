import os
import subprocess
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from app.config import DEFAULT_WORKSPACE
from app.api.auth import require_auth

logger = logging.getLogger("antigravity.git")
router = APIRouter(prefix="/api/git", tags=["git"])

GIT_TIMEOUT = 10

def run_git(args: List[str], cwd: Path) -> subprocess.CompletedProcess:
    # Always enforce strict author and committer for jprud67
    base_args = [
        "git",
        "-c", "user.name=jprud67",
        "-c", "user.email=jprud67@gmail.com"
    ] + args
    return subprocess.run(
        base_args,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        timeout=GIT_TIMEOUT
    )

@router.get("/status")
def get_git_status(workspace: Optional[str] = Query(None), _ = Depends(require_auth)):
    target = Path(workspace) if workspace else Path(DEFAULT_WORKSPACE)
    if not target.exists() or not target.is_dir():
        raise HTTPException(status_code=400, detail=f"Dossier invalide : {target}")

    # Check if git repo
    res_repo = run_git(["rev-parse", "--is-inside-work-tree"], target)
    if res_repo.returncode != 0:
        return {
            "is_repo": False,
            "workspace": str(target.resolve()),
            "message": "Ce dossier n'est pas un dépôt Git."
        }

    # Branch and porcelain status
    res_status = run_git(["status", "--porcelain=v1", "-b"], target)
    status_lines = res_status.stdout.strip().split("\n") if res_status.stdout.strip() else []

    branch = "unknown"
    tracking = None
    ahead = 0
    behind = 0

    modified = []
    staged = []
    untracked = []
    deleted = []

    for line in status_lines:
        if line.startswith("## "):
            # Branch info: ## main...origin/main [ahead 1, behind 2]
            header = line[3:].strip()
            parts = header.split("...")
            branch = parts[0].strip()
            if len(parts) > 1:
                track_info = parts[1].strip()
                if "[" in track_info:
                    tracking = track_info.split("[")[0].strip()
                    if "ahead " in track_info:
                        try:
                            ahead = int(track_info.split("ahead ")[1].split("]")[0].split(",")[0])
                        except Exception:
                            pass
                    if "behind " in track_info:
                        try:
                            behind = int(track_info.split("behind ")[1].split("]")[0])
                        except Exception:
                            pass
                else:
                    tracking = track_info
            continue

        if len(line) < 4:
            continue

        x = line[0]
        y = line[1]
        path = line[3:].strip()

        if x == "?" and y == "?":
            untracked.append(path)
        else:
            if x in ["M", "A", "R", "C"]:
                staged.append(path)
            if y == "M":
                modified.append(path)
            elif y == "D" or x == "D":
                deleted.append(path)

    # Last commit
    res_log = run_git(["log", "-1", "--format=%h|%an|%s|%cr"], target)
    last_commit = None
    if res_log.returncode == 0 and res_log.stdout.strip():
        parts = res_log.stdout.strip().split("|")
        if len(parts) >= 4:
            last_commit = {
                "hash": parts[0],
                "author": parts[1],
                "subject": parts[2],
                "time": parts[3]
            }

    return {
        "is_repo": True,
        "workspace": str(target.resolve()),
        "branch": branch,
        "tracking": tracking,
        "ahead": ahead,
        "behind": behind,
        "clean": len(modified) == 0 and len(staged) == 0 and len(untracked) == 0 and len(deleted) == 0,
        "modified": modified,
        "staged": staged,
        "untracked": untracked,
        "deleted": deleted,
        "last_commit": last_commit
    }

@router.get("/diff")
def get_git_diff(
    workspace: Optional[str] = Query(None),
    path: Optional[str] = Query(None),
    staged: bool = Query(False),
    _ = Depends(require_auth)
):
    target = Path(workspace) if workspace else Path(DEFAULT_WORKSPACE)
    args = ["diff"]
    if staged:
        args.append("--cached")
    if path:
        args.extend(["--", path])

    res = run_git(args, target)
    return {
        "workspace": str(target.resolve()),
        "path": path,
        "diff": res.stdout
    }

@router.get("/branches")
def get_branches(workspace: Optional[str] = Query(None), _ = Depends(require_auth)):
    target = Path(workspace) if workspace else Path(DEFAULT_WORKSPACE)
    res = run_git(["branch", "-a"], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail="Impossible de récupérer les branches.")

    branches = []
    current = "main"
    for line in res.stdout.strip().split("\n"):
        clean_line = line.strip()
        if not clean_line:
            continue
        if clean_line.startswith("* "):
            current = clean_line[2:]
            branches.append(current)
        else:
            branches.append(clean_line)

    return {
        "current": current,
        "branches": branches
    }

class CommitRequest(BaseModel):
    workspace: Optional[str] = None
    message: str
    stage_all: bool = True

@router.post("/commit")
def git_commit(req: CommitRequest, _ = Depends(require_auth)):
    target = Path(req.workspace) if req.workspace else Path(DEFAULT_WORKSPACE)
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Le message de commit ne peut être vide.")

    # Never allow Co-Authored-By
    clean_msg = "\n".join([line for line in req.message.strip().split("\n") if "Co-Authored-By" not in line])

    if req.stage_all:
        add_res = run_git(["add", "-A"], target)
        if add_res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Échec du git add : {add_res.stderr}")

    commit_res = run_git(["commit", "-m", clean_msg], target)
    if commit_res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Échec du commit : {commit_res.stderr or commit_res.stdout}")

    return {
        "success": True,
        "output": commit_res.stdout.strip()
    }

class PushRequest(BaseModel):
    workspace: Optional[str] = None
    remote: str = "origin"
    branch: Optional[str] = None

@router.post("/push")
def git_push(req: PushRequest, _ = Depends(require_auth)):
    target = Path(req.workspace) if req.workspace else Path(DEFAULT_WORKSPACE)
    branch = req.branch
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"

    push_res = run_git(["push", req.remote, branch], target)
    if push_res.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Échec du push : {push_res.stderr or push_res.stdout}")

    return {
        "success": True,
        "output": push_res.stdout.strip() or push_res.stderr.strip()
    }
