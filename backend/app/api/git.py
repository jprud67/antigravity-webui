import logging
import os
import re
import subprocess
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_safe_path
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.git")
router = APIRouter(prefix="/api/git", tags=["git"])

GIT_TIMEOUT = 12
_COAUTHOR_RE = re.compile(
    r"(?:co[-_ \t]*author(?:ed)?[-_ \t]*by|co[-_ \t]*author:?|co[-_ \t]*committ(?:er|ed):?|signed[-_ \t]*off[-_ \t]*by|assisted[-_ \t]*by|help[-_ \t]*from|generated[-_ \t]*by|ai[-_ \t]*assisted|claude|anthropic|chatgpt|openai|copilot|github-actions)",
    re.IGNORECASE
)
_URL_CRED_RE = re.compile(r"https?://([^/@:]+):([^/@:]+)@", re.IGNORECASE)
_TOKEN_CRED_RE = re.compile(r"https?://([^/@:]+)@", re.IGNORECASE)
_GIT_CRED_RE = re.compile(r"(?:git(?:\+https?|\+ssh)?|ssh)://(?:[^/@:]+:[^/@:]+@|[^/@:]+@)", re.IGNORECASE)
_RAW_TOKEN_RE = re.compile(r"\b(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}|glpat-[a-zA-Z0-9\-_]{20,})\b")


def _mask_git_output(text: str) -> str:
    """Masque les identifiants ou jetons secrets présents dans les URLs Git ou sorties de commande."""
    if not text:
        return ""
    masked = _URL_CRED_RE.sub(r"https://***:***@", text)
    masked = _TOKEN_CRED_RE.sub(r"https://***@", masked)
    masked = _GIT_CRED_RE.sub(r"git://***@", masked)
    masked = _RAW_TOKEN_RE.sub(r"***", masked)
    return masked


def _sanitize_git_message(msg: str) -> str:
    normalized = msg.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.rstrip() for line in normalized.strip().split("\n") if not _COAUTHOR_RE.search(line)]
    clean = "\n".join(lines).strip()
    clean = re.sub(r'\n{3,}', '\n\n', clean)
    return clean or "chore: update repository"

def _validate_workspace(workspace: str | None) -> Path:
    target = Path(workspace) if workspace else Path(DEFAULT_WORKSPACE)
    try:
        resolved = target.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Chemin de workspace invalide.")
    
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {resolved}")
        
    settings = get_settings()
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []
    allowed_roots = [Path(DEFAULT_WORKSPACE).resolve()]
    for ws in workspaces:
        try:
            allowed_roots.append(Path(ws).resolve())
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    if not is_safe_path(resolved, allowed_roots):
        raise HTTPException(status_code=403, detail="Accès refusé : workspace non autorisé.")

    return resolved

def run_git(args: list[str], cwd: Path, timeout: int = GIT_TIMEOUT, env: dict | None = None) -> subprocess.CompletedProcess:
    base_args = [
        "git",
        "-c", "user.name=jprud67",
        "-c", "user.email=jprud67@gmail.com",
        "-c", "author.name=jprud67",
        "-c", "author.email=jprud67@gmail.com",
        "-c", "committer.name=jprud67",
        "-c", "committer.email=jprud67@gmail.com",
        "-c", "format.signoff=false",
        "-c", "trailer.co-authored-by.key=",
    ] + args
    merged_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
    }
    if env:
        merged_env.update(env)
    # Ensure identity cannot be overridden
    merged_env["GIT_AUTHOR_NAME"] = "jprud67"
    merged_env["GIT_AUTHOR_EMAIL"] = "jprud67@gmail.com"
    merged_env["GIT_COMMITTER_NAME"] = "jprud67"
    merged_env["GIT_COMMITTER_EMAIL"] = "jprud67@gmail.com"
    try:
        return subprocess.run(
            base_args,
            cwd=str(cwd),
            capture_output=True,
            text=True,
            timeout=timeout,
            env=merged_env
        )
    except subprocess.TimeoutExpired:
        logger.warning(f"Git timeout ({timeout}s) for {args} in {cwd}")
        raise HTTPException(status_code=504, detail=f"Délai d'attente Git dépassé ({timeout}s) pour l'opération.")


@router.get("/status")
def get_git_status(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)

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

    conflicts = []
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
                        except Exception as e:
                            logger.debug(f"Ignored error: {e}")
                    if "behind " in track_info:
                        try:
                            behind = int(track_info.split("behind ")[1].split("]")[0].split(",")[0].strip())
                        except Exception as e:
                            logger.debug(f"Ignored error: {e}")
                else:
                    tracking = track_info
            continue

        if len(line) < 4:
            continue

        x = line[0]
        y = line[1]
        raw_path = line[3:].strip()
        # Handle renames: 'old_path -> new_path'
        if " -> " in raw_path:
            path = raw_path.split(" -> ")[1].strip().strip('"')
        else:
            path = raw_path.strip('"')

        if x == "?" and y == "?":
            untracked.append(path)
        elif x == "U" or y == "U" or (x == "A" and y == "A") or (x == "D" and y == "D"):
            conflicts.append(path)
        else:
            if x in ["M", "A", "R", "C", "D"]:
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
        "clean": len(modified) == 0 and len(staged) == 0 and len(untracked) == 0 and len(deleted) == 0 and len(conflicts) == 0,
        "is_clean": len(modified) == 0 and len(staged) == 0 and len(untracked) == 0 and len(deleted) == 0 and len(conflicts) == 0,
        "conflicts": conflicts,
        "modified": modified,
        "staged": staged,
        "untracked": untracked,
        "deleted": deleted,
        "modified_count": len(modified),
        "staged_count": len(staged),
        "untracked_count": len(untracked),
        "deleted_count": len(deleted),
        "last_commit": last_commit
    }

@router.get("/diff")
def get_git_diff(
    workspace: str | None = Query(None),
    path: str | None = Query(None),
    staged: bool = Query(False),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    args = ["diff"]
    if staged:
        args.append("--cached")
    norm_path = None
    if path:
        p = Path(path.strip())
        if p.is_absolute():
            try:
                resolved_p = p.resolve()
                resolved_target = target.resolve()
                clean_rel = str(resolved_p.relative_to(resolved_target)).replace("\\", "/")
            except ValueError:
                # Check if it was passed as a slash-prefixed workspace-relative path (e.g. "/backend/app/main.py")
                clean_str = path.strip().replace("\\", "/").removeprefix("/")
                if not clean_str or ".." in Path(clean_str).parts:
                    raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
                candidate = (target / clean_str).resolve()
                if is_safe_path(candidate, [target]):
                    clean_rel = clean_str
                else:
                    raise HTTPException(status_code=400, detail="Chemin de fichier en dehors de l'espace de travail.")
        else:
            clean_str = path.strip().replace("\\", "/")
            if ".." in Path(clean_str).parts:
                raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
            norm_str = os.path.normpath(clean_str).replace("\\", "/")
            if norm_str == "." or norm_str.startswith(".."):
                raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
            clean_rel = norm_str.removeprefix("./").removeprefix("/")

        file_candidate = (target / clean_rel).resolve()
        if not is_safe_path(file_candidate, [target]):
            raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
        norm_path = clean_rel
        args.extend(["--", norm_path])

    res = run_git(args, target)
    diff_text = res.stdout

    # Fallback pour fichiers indexes, supprimes ou non suivis si aucun diff standard n'est trouve
    if not diff_text and norm_path:
        if not staged:
            # Verifier si un diff indexe (staged) existe pour ce fichier
            cached_res = run_git(["diff", "--cached", "--", norm_path], target)
            if cached_res.stdout:
                diff_text = cached_res.stdout
        # Si toujours vide, verifier par rapport a HEAD (utile pour les fichiers supprimes ou indexes)
        if not diff_text:
            head_res = run_git(["diff", "HEAD", "--", norm_path], target)
            if head_res.stdout:
                diff_text = head_res.stdout
        # Si toujours vide, verifier si c'est un fichier non suivi (untracked) present sur le disque
        if not diff_text:
            file_on_disk = (target / norm_path).resolve()
            if is_safe_path(file_on_disk, [target]) and file_on_disk.is_file():
                devnull_cands = [os.devnull] if os.devnull == "/dev/null" else [os.devnull, "/dev/null"]
                for null_target in devnull_cands:
                    try:
                        untracked_res = run_git(["diff", "--no-index", "--", null_target, norm_path], target)
                        if untracked_res.stdout:
                            diff_text = untracked_res.stdout
                            break
                    except Exception as e:
                        logger.debug(f"Git diff untracked fallback error with {null_target}: {e}")

    MAX_DIFF_BYTES = 2 * 1024 * 1024  # 2 Mo
    truncated = False
    if diff_text and len(diff_text) > MAX_DIFF_BYTES:
        diff_text = diff_text[:MAX_DIFF_BYTES] + "\n\n... [Diff tronqué car supérieur à 2 Mo] ..."
        truncated = True

    return {
        "workspace": str(target),
        "path": norm_path or path,
        "diff": diff_text,
        "truncated": truncated
    }

@router.get("/branches")
def get_branches(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)
    res = run_git(["branch", "-a"], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail="Impossible de récupérer les branches.")

    branches = []
    seen = set()
    current = "main"
    for line in res.stdout.strip().split("\n"):
        clean_line = line.strip()
        if not clean_line or " -> " in clean_line:
            continue
        if clean_line.startswith("* "):
            current = clean_line[2:].strip()
            branch_name = current
        else:
            branch_name = clean_line

        if branch_name not in seen:
            seen.add(branch_name)
            branches.append(branch_name)

    return {
        "current": current,
        "branches": branches
    }

class CommitRequest(BaseModel):
    workspace: str | None = None
    message: str
    stage_all: bool = True

@router.post("/commit")
def git_commit(req: CommitRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="Le message de commit ne peut être vide.")

    # Never allow Co-Authored-By
    clean_msg = _sanitize_git_message(req.message)
    if not clean_msg:
        raise HTTPException(status_code=400, detail="Le message de commit ne peut être vide après nettoyage.")

    if req.stage_all:
        add_res = run_git(["add", "-A"], target)
        if add_res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Échec du git add : {add_res.stderr}")

    commit_res = run_git(["commit", "-m", clean_msg], target)
    if commit_res.returncode != 0:
        err_msg = commit_res.stderr or commit_res.stdout or ""
        if "nothing to commit" in err_msg.lower() or "working tree clean" in err_msg.lower():
            raise HTTPException(status_code=400, detail="Rien à commiter, l'arbre de travail est propre.")
        raise HTTPException(status_code=500, detail=f"Échec du commit : {_mask_git_output(err_msg)}")

    return {
        "success": True,
        "output": commit_res.stdout.strip()
    }

class PushRequest(BaseModel):
    workspace: str | None = None
    remote: str = "origin"
    branch: str | None = None

@router.post("/push")
def git_push(req: PushRequest, _ = Depends(require_auth)):
    import os as _os
    target = _validate_workspace(req.workspace)
    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"

    if branch.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")

    # Préparer l'environnement avec désactivation du prompt interactif
    # Le token peut être injecté via GIT_TOKEN dans l'environnement du serveur,
    # ou le remote peut être préconfiguré avec le token dans son URL.
    git_env = _os.environ.copy()
    git_env["GIT_TERMINAL_PROMPT"] = "0"  # Désactive tout prompt interactif git

    push_res = run_git(["push", remote, branch], target, timeout=35, env=git_env)
    if push_res.returncode != 0:
        err_out = push_res.stderr or push_res.stdout or ""
        if "has no upstream branch" in err_out or "--set-upstream" in err_out:
            push_res = run_git(["push", "-u", remote, branch], target, timeout=35, env=git_env)
        if push_res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Échec du push : {_mask_git_output(push_res.stderr or push_res.stdout)}")

    return {
        "success": True,
        "output": push_res.stdout.strip() or push_res.stderr.strip()
    }


class PullRequest(BaseModel):
    workspace: str | None = None
    remote: str = "origin"
    branch: str | None = None
    rebase: bool = False


@router.post("/pull")
def git_pull(req: PullRequest, _ = Depends(require_auth)):
    import os as _os
    target = _validate_workspace(req.workspace)
    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"

    if branch.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")

    git_env = _os.environ.copy()
    git_env["GIT_TERMINAL_PROMPT"] = "0"

    pull_args = ["pull"]
    if req.rebase:
        pull_args.append("--rebase")
    else:
        pull_args.append("--ff-only")
    pull_args.extend([remote, branch])

    pull_res = run_git(pull_args, target, timeout=35, env=git_env)
    if pull_res.returncode != 0:
        err_out = pull_res.stderr or pull_res.stdout or ""
        # If fast-forward only failed and user did not request rebase, fallback to standard merge pull
        if "--ff-only" in pull_args and ("not possible to fast-forward" in err_out.lower() or "fatal: not possible to fast-forward" in err_out.lower()):
            pull_res = run_git(["pull", remote, branch], target, timeout=35, env=git_env)

        if pull_res.returncode != 0:
            err_msg = pull_res.stderr or pull_res.stdout or "Erreur inconnue lors du pull"
            raise HTTPException(
                status_code=500,
                detail=f"Échec du pull : {_mask_git_output(err_msg.strip())}"
            )

    return {
        "success": True,
        "output": _mask_git_output(pull_res.stdout.strip() or pull_res.stderr.strip() or "Already up to date.")
    }


@router.get("/tags")
def get_git_tags(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)
    res = run_git(["tag", "-l", "--sort=-v:refname"], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail="Impossible de récupérer les tags.")
    tags = [line.strip() for line in res.stdout.strip().split("\n") if line.strip()]
    return {"tags": tags}


class TagRequest(BaseModel):
    workspace: str | None = None
    tag: str
    message: str | None = None
    push: bool = False
    remote: str = "origin"


@router.post("/tag")
def create_git_tag(req: TagRequest, _ = Depends(require_auth)):
    import os as _os
    target = _validate_workspace(req.workspace)
    tag_name = req.tag.strip()
    if not tag_name:
        raise HTTPException(status_code=400, detail="Le nom du tag ne peut être vide.")
    if tag_name.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', tag_name):
        raise HTTPException(status_code=400, detail="Nom de tag Git invalide.")

    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    raw_tag_msg = req.message.strip() if req.message else tag_name
    clean_tag_msg = _sanitize_git_message(raw_tag_msg)
    if not clean_tag_msg:
        clean_tag_msg = tag_name

    tag_args = ["tag", "-a", tag_name, "-m", clean_tag_msg]
    res_tag = run_git(tag_args, target)
    if res_tag.returncode != 0:
        err_out = res_tag.stderr or res_tag.stdout or ""
        if "already exists" in err_out.lower():
            raise HTTPException(status_code=409, detail=f"Le tag '{tag_name}' existe déjà.")
        raise HTTPException(status_code=400, detail=f"Échec de la création du tag : {_mask_git_output(err_out.strip())}")

    push_output = None
    if req.push:
        git_env = _os.environ.copy()
        git_env["GIT_TERMINAL_PROMPT"] = "0"
        push_res = run_git(["push", remote, tag_name], target, timeout=35, env=git_env)
        if push_res.returncode != 0:
            raise HTTPException(status_code=400, detail=f"Tag créé mais échec du push : {_mask_git_output((push_res.stderr or push_res.stdout or '').strip())}")
        push_output = push_res.stdout.strip() or push_res.stderr.strip()

    return {
        "success": True,
        "tag": tag_name,
        "output": res_tag.stdout.strip(),
        "push_output": push_output,
    }

