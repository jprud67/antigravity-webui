import logging
import os
import re
import shutil
import subprocess
import sys
import unicodedata
from pathlib import Path
from urllib.parse import unquote

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_safe_path
from app.services.storage import get_settings

logger = logging.getLogger("antigravity.git")
router = APIRouter(prefix="/api/git", tags=["git"])

GIT_TIMEOUT = 12
GIT_BIN = shutil.which("git") or "git"
_COAUTHOR_RE = re.compile(
    r"(?:co[-_ \t]*author(?:ed)?(?:[-_ \t]*by)?|co[-_ \t]*committ(?:er|ed)?(?:[-_ \t]*by)?|signed[-_ \t]*off[-_ \t]*by|assisted[-_ \t]*by|help[-_ \t]*from|generated[-_ \t]*by|ai[-_ \t]*assisted|claude|anthropic|chatgpt|openai|copilot|github[-_]actions)",
    re.IGNORECASE
)
_URL_CRED_RE = re.compile(r"https?://([^/@:]+):([^/@:]+)@", re.IGNORECASE)
_TOKEN_CRED_RE = re.compile(r"https?://([^/@:]+)@", re.IGNORECASE)
_GIT_CRED_RE = re.compile(r"(?:git(?:\+https?|\+ssh)?|ssh)://(?:[^/@:]+:[^/@:]+@|[^/@:]+@)", re.IGNORECASE)
_RAW_TOKEN_RE = re.compile(
    r"\b(?:ghp_[a-zA-Z0-9]{20,}|github_pat_[a-zA-Z0-9_]{30,}|glpat-[a-zA-Z0-9\-_]{20,}|AIza[0-9A-Za-z\-_]{30,40}|sk-[a-zA-Z0-9_\-]{20,})\b"
)
_SENSITIVE_FILES_RE = re.compile(
    r'(^|/)(?:\.env(?:\.[a-zA-Z0-9_\-]+)?|id_rsa[a-zA-Z0-9_\-]*|id_ed25519[a-zA-Z0-9_\-]*|webui_auth\.json|antigravity-oauth-token.*|google_accounts.*\.json|credentials.*\.json|client_secret.*\.json|.*token.*\.json|session_metadata\.json|.*\.db|.*\.sqlite|.*\.sqlite3|.*\.pem|.*\.key|.*\.cert|.*\.pfx|.*\.pkcs12)$',
    re.IGNORECASE
)



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

def _normalize_workspace_str(ws: str | None) -> str | None:
    if not ws:
        return ws
    cleaned = ws.strip()
    # Normalize URL leading slash for Windows drives: /C:/foo -> C:/foo or /C:\foo -> C:\foo
    if re.match(r"^/[a-zA-Z]:", cleaned):
        cleaned = cleaned[1:]
    # Fix missing slash after drive letter on Windows: C:laragon -> C:/laragon
    if re.match(r"^[a-zA-Z]:[^/\\]", cleaned):
        cleaned = cleaned[:2] + "/" + cleaned[2:]
    return cleaned

def _validate_workspace(workspace: str | None) -> Path:
    ws_norm = _normalize_workspace_str(workspace)
    target = Path(ws_norm) if ws_norm else Path(DEFAULT_WORKSPACE)
    try:
        resolved = target.resolve()
    except Exception:
        raise HTTPException(status_code=400, detail="Chemin de workspace invalide.")
    
    if not resolved.exists() or not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Dossier introuvable : {resolved}")
        
    settings = get_settings()
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []
    # Toujours inclure le workspace par défaut, le répertoire courant, et la racine du dépôt git parent
    allowed_roots = [
        Path(DEFAULT_WORKSPACE).resolve(), 
        Path.cwd().resolve(),
        Path(__file__).resolve().parent.parent.parent.parent
    ]
    for ws in workspaces:
        try:
            ws_n = _normalize_workspace_str(ws)
            if ws_n:
                allowed_roots.append(Path(ws_n).resolve())
        except Exception as e:
            logger.debug(f"Ignored error: {e}")

    if not is_safe_path(resolved, allowed_roots):
        raise HTTPException(status_code=403, detail="Accès refusé : workspace non autorisé.")

    return resolved


def _resolve_relative_git_path(raw_path: str, target: Path) -> str:
    """Valide et normalise un chemin de fichier relatif à l'espace de travail Git."""
    p_str = str(raw_path).strip()
    for _ in range(3):
        next_p = unquote(p_str)
        if next_p == p_str:
            break
        p_str = next_p
    p_str = unicodedata.normalize("NFC", p_str)
    if "\x00" in p_str:
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide : octet nul détecté.")

    # Supprimer les fragments (#L1-L10) et requêtes (?...) issus de liens markdown ou URLs
    if "#" in p_str:
        p_str = p_str.split("#", 1)[0]
    if "?" in p_str:
        p_str = p_str.split("?", 1)[0]
    p_str = p_str.strip()

    if any(ord(c) < 32 or ord(c) == 127 for c in p_str):
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide : caractère de contrôle interdit détecté.")

    p_check = p_str.replace("\\", "/")
    if not p_str or p_check in ("workspace:", "workspace:/", "workspace://", "file:", "file:/", "file://", "file:///", "file:/localhost", "file://localhost", "file://localhost/"):
        raise HTTPException(status_code=400, detail="Chemin de fichier invalide : chemin vide.")

    # Normalisation des schémas d'URI file:// ou workspace://
    if p_str.lower().startswith("workspace:"):
        sub = re.sub(r'^workspace:[/\\]*', '', p_str, flags=re.IGNORECASE)
        if not sub:
            raise HTTPException(status_code=400, detail="Chemin de fichier invalide : chemin vide.")
        candidate_path = target / sub
    elif p_str.lower().startswith("file:"):
        sub = re.sub(r'^file:(?:[/\\]*localhost)?[/\\]*', '', p_str, flags=re.IGNORECASE)
        if not sub:
            raise HTTPException(status_code=400, detail="Chemin de fichier invalide : chemin vide.")
        if os.name == "posix" and re.match(r'^[a-zA-Z]:[/\\]', sub):
            raise HTTPException(status_code=400, detail="Chemin de style Windows non valide sur ce système d'exploitation.")
        win_drive_match = re.match(r'^[/\\]*([a-zA-Z]:.*)', sub)
        if win_drive_match:
            sub = win_drive_match.group(1)
        elif not (len(sub) > 1 and sub[1] == ":") and not sub.startswith(("/", "\\")):
            sub = "/" + sub
        candidate_path = Path(sub)
    else:
        candidate_path = Path(p_str)

    if candidate_path.is_absolute():
        try:
            resolved_p = candidate_path.resolve()
            resolved_target = target.resolve()
            clean_rel = str(resolved_p.relative_to(resolved_target)).replace("\\", "/")
        except ValueError:
            clean_str = p_str.replace("\\", "/").removeprefix("/")
            if not clean_str or ".." in Path(clean_str).parts:
                raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
            candidate = (target / clean_str).resolve()
            if is_safe_path(candidate, [target]):
                clean_rel = clean_str
            else:
                raise HTTPException(status_code=403, detail="Chemin de fichier en dehors de l'espace de travail.")
    else:
        clean_str = p_str.replace("\\", "/")
        if ".." in Path(clean_str).parts:
            raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
        norm_str = os.path.normpath(clean_str).replace("\\", "/")
        if norm_str == "." or norm_str.startswith(".."):
            raise HTTPException(status_code=400, detail="Chemin de fichier invalide.")
        clean_rel = norm_str.removeprefix("./").removeprefix("/")

    file_candidate = (target / clean_rel).resolve()
    if not is_safe_path(file_candidate, [target]):
        raise HTTPException(status_code=403, detail="Chemin de fichier en dehors de l'espace de travail.")
    return clean_rel


def run_git(args: list[str], cwd: Path, timeout: int = GIT_TIMEOUT, env: dict | None = None) -> subprocess.CompletedProcess:
    base_args = [
        GIT_BIN,
        "-c", "user.name=jprud67",
        "-c", "user.email=jprud67@gmail.com",
        "-c", "author.name=jprud67",
        "-c", "author.email=jprud67@gmail.com",
        "-c", "committer.name=jprud67",
        "-c", "committer.email=jprud67@gmail.com",
        "-c", "format.signoff=false",
        "-c", "commit.gpgsign=false",
        "-c", "trailer.co-authored-by.key=",
    ] + args
    merged_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "",
        "SSH_ASKPASS": "",
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
    res_log = run_git(["log", "-1", "--format=%h%x1f%an%x1f%s%x1f%cr"], target)
    last_commit = None
    if res_log.returncode == 0 and res_log.stdout.strip():
        parts = res_log.stdout.strip().split("\x1f")
        if len(parts) >= 4:
            last_commit = {
                "hash": parts[0],
                "author": _mask_git_output(parts[1]),
                "subject": _mask_git_output(_sanitize_git_message(parts[2])),
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
    commit: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    MAX_DIFF_BYTES = 2 * 1024 * 1024  # 2 Mo
    truncated = False

    norm_path = None
    if path:
        norm_path = _resolve_relative_git_path(path, target)

    # Si un commit est spécifié, afficher le diff de ce commit (git show)
    if commit:
        clean_commit = commit.strip()
        if clean_commit.startswith("-") or "--" in clean_commit or not re.match(r'^[a-zA-Z0-9_\-\./~^]+$', clean_commit):
            raise HTTPException(status_code=400, detail="Identifiant de commit Git invalide.")
        show_args = ["show", "--format=", clean_commit]
        if norm_path:
            show_args.extend(["--", norm_path])
        show_res = run_git(show_args, target)
        diff_text = show_res.stdout
        if show_res.returncode != 0 and not diff_text:
            raise HTTPException(status_code=400, detail=f"Impossible d'afficher le diff pour le commit {clean_commit}: {_mask_git_output(show_res.stderr)}")
        if len(diff_text.encode("utf-8", errors="replace")) > MAX_DIFF_BYTES:
            diff_text = diff_text[:MAX_DIFF_BYTES] + "\n\n[Diff volumineux tronqué à 2 Mo]"
            truncated = True
        return {
            "workspace": str(target.resolve()),
            "path": norm_path or path,
            "commit": clean_commit,
            "diff": _mask_git_output(diff_text),
            "truncated": truncated
        }

    args = ["diff"]
    if staged:
        args.append("--cached")
    if norm_path:
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
            if head_res.returncode == 0 and head_res.stdout:
                diff_text = head_res.stdout
        # Si toujours vide, verifier si c'est un fichier non suivi (untracked) present sur le disque
        if not diff_text:
            file_on_disk = (target / norm_path).resolve()
            if is_safe_path(file_on_disk, [target]) and file_on_disk.is_file():
                try:
                    file_size = file_on_disk.stat().st_size
                except OSError:
                    file_size = 0
                if file_size > MAX_DIFF_BYTES:
                    diff_text = f"[Fichier volumineux ({file_size} octets) non affiché]"
                    truncated = True
                else:
                    devnull_cands = [os.devnull, "NUL"] if sys.platform == "win32" else [os.devnull]
                    for null_target in devnull_cands:
                        try:
                            untracked_res = run_git(["diff", "--no-index", "--", null_target, norm_path], target)
                            if untracked_res.stdout:
                                diff_text = untracked_res.stdout
                                break
                        except Exception as e:
                            logger.debug(f"Git diff untracked fallback error with {null_target}: {_mask_git_output(str(e))}")
                    if not diff_text and file_size == 0:
                        diff_text = f"--- /dev/null\n+++ b/{norm_path}\n@@ -0,0 +0,0 @@\n[Nouveau fichier vide]"

    diff_text = _mask_git_output(diff_text or "")
    if diff_text and len(diff_text) > MAX_DIFF_BYTES:
        diff_text = diff_text[:MAX_DIFF_BYTES] + "\n\n... [Diff tronqué car supérieur à 2 Mo] ..."
        truncated = True

    return {
        "workspace": str(target),
        "path": norm_path or path,
        "diff": diff_text,
        "truncated": truncated
    }


@router.get("/file-versions")
def get_git_file_versions(
    path: str = Query(..., description="Chemin relatif du fichier"),
    workspace: str | None = Query(None),
    commit: str | None = Query(None, description="Commit SHA ou HEAD"),
    staged: bool = Query(False, description="Comparer le staged vs HEAD"),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    norm_path = _resolve_relative_git_path(path, target)

    # 1. Determine original content (from git revision)
    git_rev = commit if commit else "HEAD"
    original_text = ""
    is_new = False
    is_deleted = False

    # Check if file exists at revision
    show_target = f"{git_rev}:{norm_path}"
    res_show = run_git(["show", show_target], target)
    if res_show.returncode == 0:
        original_text = res_show.stdout
    else:
        # File did not exist at revision (newly added or untracked)
        is_new = True

    # 2. Determine modified content
    modified_text = ""
    if commit and not staged:
        # If inspecting historical commit, modified is that commit's version
        res_mod = run_git(["show", f"{commit}:{norm_path}"], target)
        if res_mod.returncode == 0:
            modified_text = res_mod.stdout
        else:
            is_deleted = True
    elif staged:
        # Read from git index (staged)
        res_staged = run_git(["show", f":{norm_path}"], target)
        if res_staged.returncode == 0:
            modified_text = res_staged.stdout
        else:
            is_deleted = True
    else:
        # Read current working tree file from disk
        file_disk = target / norm_path
        if file_disk.exists() and file_disk.is_file():
            try:
                modified_text = file_disk.read_text(encoding="utf-8", errors="replace")
            except Exception as e:
                logger.error(f"Error reading {file_disk}: {e}")
                modified_text = ""
        else:
            is_deleted = True

    filename = Path(norm_path).name
    return {
        "workspace": str(target.resolve()),
        "path": norm_path,
        "filename": filename,
        "original": _mask_git_output(original_text),
        "modified": _mask_git_output(modified_text),
        "is_new": is_new,
        "is_deleted": is_deleted,
        "staged": staged,
        "commit": commit
    }


@router.get("/branches")
def get_branches(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)
    res = run_git(["branch", "-a"], target)
    if res.returncode != 0:
        return {"current": "", "branches": []}

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

def _unstage_sensitive_files(target: Path) -> None:
    """Désindexe automatiquement tout fichier sensible non suivi avant commit."""
    staged_files_res = run_git(["diff", "--name-only", "--cached", "-z"], target)
    if staged_files_res.returncode == 0 and staged_files_res.stdout:
        raw_files = staged_files_res.stdout.split("\0") if "\0" in staged_files_res.stdout else staged_files_res.stdout.splitlines()
        for f in raw_files:
            f_clean = f.strip().strip('"')
            if not f_clean:
                continue
            if _SENSITIVE_FILES_RE.search(f_clean):
                check_head = run_git(["rev-parse", "--verify", f"HEAD:{f_clean}"], target)
                if check_head.returncode != 0:
                    reset_res = run_git(["reset", "HEAD", "--", f_clean], target)
                    if reset_res.returncode != 0:
                        run_git(["rm", "--cached", "-f", "--", f_clean], target)
                    logger.warning(f"Fichier sensible désindexé automatiquement du commit : {f_clean}")


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
    clean_msg = _sanitize_git_message(req.message).strip()
    if not clean_msg:
        raise HTTPException(status_code=400, detail="Le message de commit ne peut être vide après nettoyage.")

    if req.stage_all:
        add_res = run_git(["add", "-A"], target)
        if add_res.returncode != 0:
            raise HTTPException(status_code=500, detail=f"Échec du git add : {add_res.stderr}")

    # Protection automatique contre l'indexation accidentelle de fichiers sensibles non suivis (.env, clés privées)
    _unstage_sensitive_files(target)

    commit_res = run_git(["commit", "--no-signoff", "--author=jprud67 <jprud67@gmail.com>", "-m", clean_msg], target)
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
    if remote.startswith("-") or "--" in remote or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"

    if branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
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
            err_msg = _mask_git_output(push_res.stderr or push_res.stdout or "").strip()
            detail = f"Échec du push : {err_msg}" if err_msg else f"Échec du push (code {push_res.returncode})"
            raise HTTPException(status_code=500, detail=detail)

    return {
        "success": True,
        "output": _mask_git_output(push_res.stdout.strip() or push_res.stderr.strip())
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
    if remote.startswith("-") or "--" in remote or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"

    if branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
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
            pull_res = run_git(["pull", "--no-edit", remote, branch], target, timeout=35, env=git_env)

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
        return {"tags": []}
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
    if tag_name.startswith("-") or "--" in tag_name or not re.match(r'^[a-zA-Z0-9_\-\./+]+$', tag_name):
        raise HTTPException(status_code=400, detail="Nom de tag Git invalide.")

    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or "--" in remote or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
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
        "output": _mask_git_output(res_tag.stdout.strip()),
        "push_output": _mask_git_output(push_output) if push_output else None,
    }


@router.get("/log")
def get_git_log(
    workspace: str | None = Query(None),
    limit: int = Query(25, ge=1, le=100),
    skip: int = Query(0, ge=0),
    branch: str | None = Query(None),
    path: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)

    # Check if git repo
    res_repo = run_git(["rev-parse", "--is-inside-work-tree"], target)
    if res_repo.returncode != 0:
        return {
            "is_repo": False,
            "workspace": str(target.resolve()),
            "commits": [],
            "total": 0
        }

    cmd = [
        "log",
        f"-n{limit}",
        f"--skip={skip}",
        "--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%b%x1e",
    ]

    if branch:
        clean_branch = branch.strip()
        if clean_branch.startswith("-") or "--" in clean_branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', clean_branch):
            raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")
        cmd.append(clean_branch)

    norm_path = None
    if path:
        norm_path = _resolve_relative_git_path(path, target)
        cmd.extend(["--", norm_path])

    res = run_git(cmd, target)
    if res.returncode != 0:
        err_msg = (res.stderr or "").lower()
        if "does not have any commits yet" in err_msg or "unknown revision" in err_msg or "bad default revision 'head'" in err_msg:
            return {
                "is_repo": True,
                "workspace": str(target.resolve()),
                "commits": [],
                "total": 0
            }
        raise HTTPException(status_code=400, detail=f"Erreur lors de la récupération de l'historique Git : {_mask_git_output(res.stderr.strip())}")

    raw_output = res.stdout
    commits = []
    if raw_output:
        raw_entries = raw_output.split("\x1e")
        for entry in raw_entries:
            entry_clean = entry.strip()
            if not entry_clean:
                continue
            parts = entry_clean.split("\x1f")
            if len(parts) >= 6:
                commit_hash = parts[0].strip()
                short_hash = parts[1].strip()
                author_name = _mask_git_output(parts[2].strip())
                author_email = _mask_git_output(parts[3].strip())
                try:
                    timestamp = int(parts[4].strip())
                except ValueError:
                    timestamp = 0
                subject = _mask_git_output(_sanitize_git_message(parts[5].strip()))
                body = _mask_git_output(_sanitize_git_message(parts[6].strip())) if len(parts) > 6 else ""

                commits.append({
                    "hash": commit_hash,
                    "short_hash": short_hash,
                    "author": author_name,
                    "email": author_email,
                    "timestamp": timestamp,
                    "subject": subject,
                    "body": body,
                })

    return {
        "is_repo": True,
        "workspace": str(target.resolve()),
        "commits": commits,
        "total": len(commits)
    }


# ==========================================
# Sprint 14: Git Stash & Conflict Resolver
# ==========================================

class StashSaveRequest(BaseModel):
    workspace: str | None = None
    message: str | None = None
    include_untracked: bool = False
    keep_index: bool = False


class StashActionRequest(BaseModel):
    workspace: str | None = None
    index: int = 0


class ResolveConflictRequest(BaseModel):
    workspace: str | None = None
    path: str
    resolution: str  # "ours", "theirs", "custom"
    custom_content: str | None = None


class CherryPickRequest(BaseModel):
    workspace: str | None = None
    commit_hash: str


class AbortOrContinueRequest(BaseModel):
    workspace: str | None = None


@router.get("/stash")
def list_git_stashes(
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
) -> list[dict]:
    target = _validate_workspace(workspace)
    res = run_git(["stash", "list", "--format=%gd%x1f%h%x1f%cr%x1f%gs"], target)
    if res.returncode != 0:
        return []

    stashes = []
    lines = res.stdout.strip().split("\n") if res.stdout.strip() else []
    for line in lines:
        if not line.strip():
            continue
        parts = line.split("\x1f")
        if len(parts) >= 4:
            id_ref = parts[0].strip()  # stash@{0}
            short_h = parts[1].strip()
            rel_time = parts[2].strip()
            msg = _mask_git_output(_sanitize_git_message(parts[3].strip()))
            idx_match = re.search(r'stash@\{(\d+)\}', id_ref)
            idx = int(idx_match.group(1)) if idx_match else len(stashes)
            stashes.append({
                "index": idx,
                "id": id_ref,
                "hash": short_h,
                "relative_time": rel_time,
                "message": msg
            })
    return stashes


@router.post("/stash")
def save_git_stash(
    req: StashSaveRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    args = ["stash", "push"]
    if req.include_untracked:
        args.append("-u")
    if req.keep_index:
        args.append("-k")
    if req.message and req.message.strip():
        args.extend(["-m", _sanitize_git_message(req.message.strip())])

    res = run_git(args, target)
    if res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de la création du stash : {_mask_git_output(res.stderr.strip() or res.stdout.strip())}"
        )
    return {
        "status": "ok",
        "message": _mask_git_output(res.stdout.strip() or "Stash enregistré avec succès.")
    }


@router.post("/stash/pop")
def pop_git_stash(
    req: StashActionRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    res = run_git(["stash", "pop", f"stash@{{{req.index}}}"], target)
    out = _mask_git_output(res.stdout.strip() or res.stderr.strip())
    if res.returncode != 0:
        if "conflict" in out.lower():
            return {
                "status": "conflict",
                "message": out
            }
        raise HTTPException(status_code=400, detail=f"Erreur lors du dépilage du stash : {out}")
    return {
        "status": "ok",
        "message": out or "Stash dépilé avec succès."
    }


@router.post("/stash/apply")
def apply_git_stash(
    req: StashActionRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    res = run_git(["stash", "apply", f"stash@{{{req.index}}}"], target)
    out = _mask_git_output(res.stdout.strip() or res.stderr.strip())
    if res.returncode != 0:
        if "conflict" in out.lower():
            return {
                "status": "conflict",
                "message": out
            }
        raise HTTPException(status_code=400, detail=f"Erreur lors de l'application du stash : {out}")
    return {
        "status": "ok",
        "message": out or "Stash appliqué avec succès."
    }


@router.delete("/stash")
def drop_git_stash(
    workspace: str | None = Query(None),
    index: int | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    if index is not None:
        res = run_git(["stash", "drop", f"stash@{{{index}}}"], target)
    else:
        res = run_git(["stash", "clear"], target)

    if res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de la suppression du stash : {_mask_git_output(res.stderr.strip() or res.stdout.strip())}"
        )
    return {"status": "ok", "message": "Stash supprimé avec succès."}


@router.get("/stash/diff")
def get_git_stash_diff(
    workspace: str | None = Query(None),
    index: int = Query(0),
    path: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    args = ["stash", "show", "-p", f"stash@{{{index}}}"]
    if path:
        norm_p = _resolve_relative_git_path(path, target)
        args.extend(["--", norm_p])

    res = run_git(args, target)
    if res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de l'affichage du diff de stash : {_mask_git_output(res.stderr.strip())}"
        )
    return {
        "diff": _mask_git_output(res.stdout),
        "index": index
    }


@router.get("/conflicts/file")
def get_conflict_file_info(
    workspace: str | None = Query(None),
    path: str = Query(...),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    norm_path = _resolve_relative_git_path(path, target)
    full_path = target / norm_path

    # Extract 3-way stage contents
    res_base = run_git(["show", f":1:{norm_path}"], target)
    base_content = res_base.stdout if res_base.returncode == 0 else ""

    res_ours = run_git(["show", f":2:{norm_path}"], target)
    ours_content = res_ours.stdout if res_ours.returncode == 0 else ""

    res_theirs = run_git(["show", f":3:{norm_path}"], target)
    theirs_content = res_theirs.stdout if res_theirs.returncode == 0 else ""

    # Current working file content
    current_content = ""
    if full_path.exists() and full_path.is_file():
        try:
            current_content = full_path.read_text(encoding="utf-8", errors="replace")
        except Exception as e:
            logger.debug(f"Could not read conflict file on disk: {e}")

    return {
        "file_path": str(full_path.resolve()),
        "relative_path": norm_path,
        "base_content": base_content,
        "ours_content": ours_content,
        "theirs_content": theirs_content,
        "current_content": current_content
    }


@router.post("/conflicts/resolve")
def resolve_conflict(
    req: ResolveConflictRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    norm_path = _resolve_relative_git_path(req.path, target)
    full_path = target / norm_path

    if req.resolution == "ours":
        run_git(["checkout", "--ours", "--", norm_path], target)
    elif req.resolution == "theirs":
        run_git(["checkout", "--theirs", "--", norm_path], target)
    elif req.resolution == "custom":
        if req.custom_content is None:
            raise HTTPException(status_code=400, detail="custom_content requis pour une résolution personnalisée.")
        full_path.write_text(req.custom_content, encoding="utf-8")
    else:
        raise HTTPException(status_code=400, detail=f"Résolution invalide: {req.resolution}")

    # Stage the resolved file
    add_res = run_git(["add", norm_path], target)
    if add_res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de l'ajout du fichier résolu : {_mask_git_output(add_res.stderr.strip())}"
        )

    return {
        "status": "resolved",
        "file_path": norm_path
    }


@router.post("/cherry-pick")
def cherry_pick_commit(
    req: CherryPickRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    clean_hash = req.commit_hash.strip()
    if clean_hash.startswith("-") or "--" in clean_hash or not re.match(r'^[a-zA-Z0-9_\-\./~^]+$', clean_hash):
        raise HTTPException(status_code=400, detail="Hash de commit non valide.")

    res = run_git(["cherry-pick", clean_hash], target)
    if res.returncode == 0:
        return {
            "status": "applied",
            "message": "Commit appliqué avec succès.",
            "conflicts": []
        }

    # Check for conflicts
    st_res = run_git(["status", "--porcelain=v1"], target)
    conflicts = []
    if st_res.returncode == 0:
        for line in st_res.stdout.split("\n"):
            if len(line) >= 4 and (line[:2] in ("UU", "AA", "DD", "AU", "UA", "UD", "DU")):
                conflicts.append(line[3:].strip().strip('"'))

    if conflicts:
        return {
            "status": "conflict",
            "message": "Conflit détecté lors du cherry-pick.",
            "conflicts": conflicts
        }

    raise HTTPException(
        status_code=400,
        detail=f"Erreur lors du cherry-pick : {_mask_git_output(res.stderr.strip() or res.stdout.strip())}"
    )


@router.post("/cherry-pick/abort")
def abort_cherry_pick(
    req: AbortOrContinueRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    res = run_git(["cherry-pick", "--abort"], target)
    if res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de l'annulation du cherry-pick : {_mask_git_output(res.stderr.strip() or res.stdout.strip())}"
        )
    return {"status": "aborted", "message": "Cherry-pick annulé."}


@router.post("/cherry-pick/continue")
def continue_cherry_pick(
    req: AbortOrContinueRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    res = run_git(["cherry-pick", "--continue"], target)
    if res.returncode != 0:
        raise HTTPException(
            status_code=400,
            detail=f"Erreur lors de la poursuite du cherry-pick : {_mask_git_output(res.stderr.strip() or res.stdout.strip())}"
        )
    return {"status": "continued", "message": "Cherry-pick continué avec succès."}
