import json
import logging
import os
import re
import shutil
import subprocess
import sys
import time
import unicodedata
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlencode

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE, REPO_ROOT
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

def _normalize_workspace_str(ws: Any) -> str | None:
    if ws is None or not isinstance(ws, str):
        return None
    cleaned = ws.strip()
    if not cleaned:
        return None
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
        default_resolved = Path(DEFAULT_WORKSPACE).resolve()
        if default_resolved.exists() and default_resolved.is_dir():
            logger.warning(f"Workspace introuvable ({resolved}), repli automatique sur le workspace par défaut: {default_resolved}")
            resolved = default_resolved
        else:
            raise HTTPException(status_code=400, detail=f"Dossier introuvable : {resolved}")
        
    settings = get_settings()
    raw_workspaces = settings.get("trustedWorkspaces", [])
    workspaces = list(raw_workspaces) if isinstance(raw_workspaces, list) else []
    # Toujours inclure le workspace par défaut, le répertoire courant, et la racine du dépôt git parent
    allowed_roots = [
        Path(DEFAULT_WORKSPACE).resolve(), 
        Path.cwd().resolve(),
        REPO_ROOT.resolve()
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
        "-c", "core.editor=true",
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
        "GIT_EDITOR": "true",
        "EDITOR": "true",
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
            if x in ["M", "A", "R", "C", "D", "T"]:
                staged.append(path)
            if y in ["M", "T"]:
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
    target = _validate_workspace(workspace if isinstance(workspace, str) else None)
    MAX_DIFF_BYTES = 2 * 1024 * 1024  # 2 Mo
    truncated = False

    path_val = path if isinstance(path, str) else None
    staged_val = staged if isinstance(staged, bool) else False
    commit_val = commit if isinstance(commit, str) else None

    norm_path = None
    if path_val:
        norm_path = _resolve_relative_git_path(path_val, target)

    # Si un commit est spécifié, afficher le diff de ce commit (git show)
    if commit_val:
        clean_commit = commit_val.strip()
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
            "path": norm_path or path_val,
            "commit": clean_commit,
            "diff": _mask_git_output(diff_text),
            "truncated": truncated
        }

    args = ["diff"]
    if staged_val:
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


class GitDiffRangeItem(BaseModel):
    type: str  # "added" | "modified" | "deleted"
    start_line: int
    end_line: int


class GitDiffSummaryItem(BaseModel):
    added_lines: int
    modified_lines: int
    deleted_lines: int
    total_changes: int


class GitDiffRangesResponse(BaseModel):
    file_path: str
    is_tracked: bool
    ranges: list[GitDiffRangeItem]
    summary: GitDiffSummaryItem


_HUNK_HEADER_RE = re.compile(r"^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@")


@router.get("/file-diff-ranges", response_model=GitDiffRangesResponse)
def get_file_diff_ranges(
    filePath: str | None = Query(None, alias="filePath", description="Chemin relatif du fichier"),
    file_path: str | None = Query(None, description="Chemin relatif du fichier (alias snake_case)"),
    path: str | None = Query(None, description="Chemin relatif du fichier (alias path)"),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    """Calcule de manière asynchrone et légère les plages de modifications Git (lignes ajoutées, modifiées, supprimées) pour les décorations de gouttière et minimap."""
    target_path = filePath or file_path or path
    if not target_path:
        raise HTTPException(status_code=422, detail="Paramètre de fichier requis (filePath ou file_path)")
    target = _validate_workspace(workspace)
    norm_path = _resolve_relative_git_path(target_path, target)

    disk_file = target / norm_path

    # Vérifier si le fichier est suivi par Git
    res_tracked = run_git(["ls-files", "--error-unmatch", "--", norm_path], target)
    is_tracked = (res_tracked.returncode == 0)

    ranges: list[GitDiffRangeItem] = []
    added_lines = 0
    modified_lines = 0
    deleted_lines = 0

    if not is_tracked:
        if disk_file.is_file():
            try:
                line_count = len(disk_file.read_text(encoding="utf-8", errors="replace").splitlines())
            except Exception:
                line_count = 0
            if line_count > 0:
                ranges.append(GitDiffRangeItem(type="added", start_line=1, end_line=line_count))
                added_lines = line_count
        return GitDiffRangesResponse(
            file_path=norm_path,
            is_tracked=False,
            ranges=ranges,
            summary=GitDiffSummaryItem(
                added_lines=added_lines,
                modified_lines=0,
                deleted_lines=0,
                total_changes=added_lines
            )
        )

    # Si suivi, exécuter git diff -U0 HEAD -- <norm_path>
    res_diff = run_git(["diff", "-U0", "HEAD", "--", norm_path], target)
    if res_diff.returncode == 0 and res_diff.stdout.strip():
        for line in res_diff.stdout.splitlines():
            m = _HUNK_HEADER_RE.match(line)
            if not m:
                continue
            _old_start = int(m.group(1))
            old_count = int(m.group(2)) if m.group(2) is not None else 1
            new_start = int(m.group(3))
            new_count = int(m.group(4)) if m.group(4) is not None else 1

            if old_count == 0 and new_count > 0:
                # Ajouts purs
                ranges.append(GitDiffRangeItem(
                    type="added",
                    start_line=new_start,
                    end_line=new_start + new_count - 1
                ))
                added_lines += new_count
            elif new_count == 0 and old_count > 0:
                # Suppressions pures
                del_line = max(1, new_start)
                ranges.append(GitDiffRangeItem(
                    type="deleted",
                    start_line=del_line,
                    end_line=del_line
                ))
                deleted_lines += old_count
            else:
                # Modifications
                if new_count == old_count:
                    ranges.append(GitDiffRangeItem(
                        type="modified",
                        start_line=new_start,
                        end_line=new_start + new_count - 1
                    ))
                    modified_lines += new_count
                elif new_count > old_count:
                    ranges.append(GitDiffRangeItem(
                        type="modified",
                        start_line=new_start,
                        end_line=new_start + old_count - 1
                    ))
                    modified_lines += old_count
                    ranges.append(GitDiffRangeItem(
                        type="added",
                        start_line=new_start + old_count,
                        end_line=new_start + new_count - 1
                    ))
                    added_lines += (new_count - old_count)
                else:  # new_count < old_count
                    ranges.append(GitDiffRangeItem(
                        type="modified",
                        start_line=new_start,
                        end_line=new_start + new_count - 1
                    ))
                    modified_lines += new_count
                    deleted_lines += (old_count - new_count)
                    del_line = new_start + new_count - 1
                    ranges.append(GitDiffRangeItem(
                        type="deleted",
                        start_line=max(1, del_line),
                        end_line=max(1, del_line)
                    ))

    total_changes = added_lines + modified_lines + deleted_lines
    return GitDiffRangesResponse(
        file_path=norm_path,
        is_tracked=True,
        ranges=ranges,
        summary=GitDiffSummaryItem(
            added_lines=added_lines,
            modified_lines=modified_lines,
            deleted_lines=deleted_lines,
            total_changes=total_changes
        )
    )



class BranchCheckoutRequest(BaseModel):
    workspace: str | None = None
    branch: str
    create: bool = False
    start_point: str | None = None


class BranchCreateRequest(BaseModel):
    workspace: str | None = None
    name: str
    start_point: str | None = None
    checkout: bool = True


class BranchDeleteRequest(BaseModel):
    workspace: str | None = None
    branch: str
    force: bool = False
    remote: bool = False
    remote_name: str = "origin"


class BranchMergeRequest(BaseModel):
    workspace: str | None = None
    branch: str
    no_ff: bool = False
    message: str | None = None


class BranchRenameRequest(BaseModel):
    workspace: str | None = None
    old_name: str
    new_name: str


@router.get("/branches")
def get_branches(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)
    
    curr_res = run_git(["branch", "--show-current"], target)
    raw_current = curr_res.stdout.strip()
    is_detached = False
    detached_sha = None
    if raw_current:
        current = raw_current
    else:
        head_res = run_git(["rev-parse", "--short=8", "HEAD"], target)
        if head_res.returncode == 0 and head_res.stdout.strip():
            detached_sha = head_res.stdout.strip()
            current = f"HEAD (detached at {detached_sha})"
            is_detached = True
        else:
            current = "main"

    ref_format = "%(refname:short)\t%(refname)\t%(HEAD)\t%(upstream:short)\t%(upstream:track)\t%(objectname:short)\t%(authordate:iso-strict)\t%(subject)"
    res = run_git(["for-each-ref", f"--format={ref_format}", "refs/heads/", "refs/remotes/"], target)
    
    branches = []
    seen = set()

    if res.returncode == 0 and res.stdout.strip():
        for line in res.stdout.strip().split("\n"):
            parts = line.split("\t")
            if len(parts) < 8:
                continue
            short_name, full_ref, head_mark, upstream_short, upstream_track, sha, date, subject = parts[:8]
            if full_ref.endswith("/HEAD"):
                continue

            is_remote = full_ref.startswith("refs/remotes/")
            is_current = False if is_detached else ((head_mark.strip() == "*") or (short_name == current and not is_remote))
            ahead = 0
            behind = 0
            if upstream_track:
                ahead_m = re.search(r'ahead (\d+)', upstream_track)
                behind_m = re.search(r'behind (\d+)', upstream_track)
                if ahead_m:
                    ahead = int(ahead_m.group(1))
                if behind_m:
                    behind = int(behind_m.group(1))

            if short_name not in seen:
                seen.add(short_name)
                branches.append({
                    "name": short_name,
                    "is_current": is_current,
                    "is_remote": is_remote,
                    "upstream": upstream_short or None,
                    "ahead": ahead,
                    "behind": behind,
                    "last_commit_sha": sha or None,
                    "last_commit_date": date or None,
                    "last_commit_subject": subject or None,
                })

    if is_detached:
        branches.insert(0, {
            "name": current,
            "is_current": True,
            "is_remote": False,
            "upstream": None,
            "ahead": 0,
            "behind": 0,
            "last_commit_sha": detached_sha,
            "last_commit_date": None,
            "last_commit_subject": None,
        })

    # Fallback si for-each-ref est vide (dépôt vide ou sans commit)
    if not branches:
        branches.append({
            "name": current,
            "is_current": True,
            "is_remote": False,
            "upstream": None,
            "ahead": 0,
            "behind": 0,
            "last_commit_sha": None,
            "last_commit_date": None,
            "last_commit_subject": None,
        })

    return {
        "current": current,
        "branches": branches
    }


@router.post("/branches/checkout")
def checkout_branch(req: BranchCheckoutRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    branch = req.branch.strip()
    if not branch or branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche invalide.")

    args = ["checkout"]
    if req.create:
        args.append("-b")
        args.append(branch)
        if req.start_point:
            args.append(req.start_point.strip())
    else:
        args.append(branch)

    res = run_git(args, target)
    if res.returncode != 0:
        err = res.stderr or res.stdout or "Erreur inconnue lors du checkout."
        if "overwritten by checkout" in err.lower() or "local changes" in err.lower():
            raise HTTPException(
                status_code=409,
                detail=f"Des modifications locales non enregistrées empêchent la bascule : {_mask_git_output(err)}"
            )
        raise HTTPException(status_code=400, detail=f"Échec de la bascule de branche : {_mask_git_output(err)}")

    return {
        "success": True,
        "branch": branch,
        "output": _mask_git_output(res.stdout or res.stderr)
    }


@router.post("/branches/create")
def create_branch(req: BranchCreateRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    name = req.name.strip()
    if not name or name.startswith("-") or "--" in name or not re.match(r'^[a-zA-Z0-9_\-\./]+$', name):
        raise HTTPException(status_code=400, detail="Nom de branche invalide.")

    # Validation via git check-ref-format
    check_fmt = run_git(["check-ref-format", "--branch", name], target)
    if check_fmt.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Le format du nom de branche '{name}' est invalide selon Git.")

    args = ["checkout", "-b", name] if req.checkout else ["branch", name]
    if req.start_point:
        clean_start = req.start_point.strip()
        if clean_start.startswith("-") or "--" in clean_start or not re.match(r'^[a-zA-Z0-9_\-\./~^]+$', clean_start):
            raise HTTPException(status_code=400, detail="Point de départ invalide.")
        args.append(clean_start)

    res = run_git(args, target)
    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        if "already exists" in err.lower():
            raise HTTPException(status_code=409, detail=f"La branche '{name}' existe déjà.")
        raise HTTPException(status_code=400, detail=f"Échec de création de la branche : {_mask_git_output(err)}")

    return {
        "success": True,
        "name": name,
        "checked_out": req.checkout,
        "output": _mask_git_output(res.stdout or res.stderr)
    }


@router.delete("/branches")
def delete_branch(req: BranchDeleteRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    branch = req.branch.strip()
    if not branch or branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche invalide.")

    # Guard 1: Interdiction de supprimer la branche courante
    curr_res = run_git(["branch", "--show-current"], target)
    current_branch = curr_res.stdout.strip()
    if branch == current_branch:
        raise HTTPException(status_code=400, detail="Impossible de supprimer la branche actuellement active.")

    # Guard 2: Interdiction de supprimer les branches protégées principales
    if branch.lower() in ["main", "master"]:
        raise HTTPException(status_code=400, detail=f"La branche '{branch}' est protégée et ne peut être supprimée.")

    if req.remote:
        remote_name = req.remote_name.strip() if req.remote_name else "origin"
        if remote_name.startswith("-") or "--" in remote_name or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote_name):
            raise HTTPException(status_code=400, detail="Nom de remote invalide.")
        remote_branch = branch.removeprefix(f"{remote_name}/")
        res = run_git(["push", remote_name, "--delete", remote_branch], target, timeout=35)
    else:
        args = ["branch", "-D" if req.force else "-d", branch]
        res = run_git(args, target)

    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        if "not fully merged" in err.lower():
            raise HTTPException(
                status_code=409,
                detail=f"La branche '{branch}' n'est pas complètement fusionnée. Cochez l'option de suppression forcée pour continuer."
            )
        raise HTTPException(status_code=400, detail=f"Échec de la suppression de la branche : {_mask_git_output(err)}")

    return {
        "success": True,
        "branch": branch,
        "remote": req.remote,
        "output": _mask_git_output(res.stdout or res.stderr)
    }


@router.post("/branches/merge")
def merge_branch(req: BranchMergeRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    branch = req.branch.strip()
    if not branch or branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche invalide.")

    args = ["merge"]
    if req.no_ff:
        args.append("--no-ff")
    if req.message:
        clean_msg = _sanitize_git_message(req.message)
        args.extend(["-m", clean_msg])
    args.append(branch)

    res = run_git(args, target, timeout=35)
    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        if "conflict" in err.lower() or "automatic merge failed" in err.lower():
            conf_res = run_git(["diff", "--name-only", "--diff-filter=U"], target)
            conf_files = [f.strip() for f in conf_res.stdout.splitlines() if f.strip()]
            return {
                "success": False,
                "has_conflicts": True,
                "conflicts": conf_files,
                "message": "Des conflits de fusion sont survenus et doivent être résolus."
            }
        raise HTTPException(status_code=400, detail=f"Échec de la fusion : {_mask_git_output(err)}")

    return {
        "success": True,
        "has_conflicts": False,
        "conflicts": [],
        "output": _mask_git_output(res.stdout or res.stderr)
    }


@router.post("/branches/rename")
def rename_branch(req: BranchRenameRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    old_name = req.old_name.strip()
    new_name = req.new_name.strip()
    for n in (old_name, new_name):
        if not n or n.startswith("-") or "--" in n or not re.match(r'^[a-zA-Z0-9_\-\./]+$', n):
            raise HTTPException(status_code=400, detail=f"Nom de branche invalide : '{n}'.")

    check_fmt = run_git(["check-ref-format", "--branch", new_name], target)
    if check_fmt.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Le nouveau nom '{new_name}' n'est pas valide selon Git.")

    res = run_git(["branch", "-m", old_name, new_name], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Échec du renommage : {_mask_git_output(res.stderr or res.stdout)}")

    return {
        "success": True,
        "old_name": old_name,
        "new_name": new_name,
        "output": _mask_git_output(res.stdout or res.stderr)
    }


class RebaseCommitAction(BaseModel):
    sha: str
    action: str = "pick"
    new_message: str | None = None


class RebaseExecuteRequest(BaseModel):
    workspace: str | None = None
    base: str
    commits: list[RebaseCommitAction]


class RebaseActionRequest(BaseModel):
    workspace: str | None = None


REBASE_HELPER_PATH = (Path(__file__).resolve().parent.parent / "services" / "git_rebase_helper.py").resolve()


@router.get("/rebase/todo")
def get_rebase_todo(
    base: str = Query(..., description="Commit de départ ou ref pour le rebase"),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    clean_base = base.strip()
    if clean_base.startswith("-") or "--" in clean_base or not re.match(r'^[a-zA-Z0-9_\-\./~^]+$', clean_base):
        raise HTTPException(status_code=400, detail="Identifiant de commit base invalide.")

    log_format = "%h%x09%H%x09%an%x09%aI%x09%s"
    res = run_git(["log", "--reverse", f"--format={log_format}", f"{clean_base}..HEAD"], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Impossible de récupérer les commits pour le rebase : {_mask_git_output(res.stderr or res.stdout)}")

    commits = []
    if res.stdout.strip():
        for line in res.stdout.strip().split("\n"):
            parts = line.split("\t")
            if len(parts) >= 5:
                commits.append({
                    "sha": parts[0],
                    "full_sha": parts[1],
                    "author": parts[2],
                    "date": parts[3],
                    "subject": parts[4],
                    "action": "pick",
                    "new_message": None,
                })

    return {
        "base": clean_base,
        "commits": commits
    }


@router.get("/rebase/status")
def get_rebase_status(workspace: str | None = Query(None), _ = Depends(require_auth)):
    target = _validate_workspace(workspace)
    rebase_merge = target / ".git" / "rebase-merge"
    rebase_apply = target / ".git" / "rebase-apply"
    
    is_rebasing = rebase_merge.exists() or rebase_apply.exists()
    current_step = 0
    total_steps = 0
    current_commit = None
    conflicts = []

    if is_rebasing:
        active_dir = rebase_merge if rebase_merge.exists() else rebase_apply
        try:
            msgnum_f = active_dir / "msgnum"
            end_f = active_dir / "end"
            if msgnum_f.exists():
                current_step = int(msgnum_f.read_text(encoding="utf-8").strip())
            if end_f.exists():
                total_steps = int(end_f.read_text(encoding="utf-8").strip())
            stopped_f = active_dir / "stopped-sha"
            if stopped_f.exists():
                current_commit = stopped_f.read_text(encoding="utf-8").strip()[:7]
        except Exception:
            pass

        conf_res = run_git(["diff", "--name-only", "--diff-filter=U"], target)
        if conf_res.returncode == 0 and conf_res.stdout.strip():
            conflicts = [f.strip() for f in conf_res.stdout.splitlines() if f.strip()]

    return {
        "is_rebasing": is_rebasing,
        "current_step": current_step,
        "total_steps": total_steps,
        "current_commit": current_commit,
        "conflicted_files": conflicts
    }


@router.post("/rebase/execute")
def execute_rebase(req: RebaseExecuteRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    clean_base = req.base.strip()
    if clean_base.startswith("-") or "--" in clean_base or not re.match(r'^[a-zA-Z0-9_\-\./~^]+$', clean_base):
        raise HTTPException(status_code=400, detail="Identifiant base invalide.")

    if not req.commits:
        raise HTTPException(status_code=400, detail="Aucun commit spécifié pour le rebase.")

    # Vérification de l'arbre de travail
    status_res = run_git(["status", "--porcelain"], target)
    dirty_files = [line.strip() for line in status_res.stdout.splitlines() if line.strip() and not line.startswith("??")]
    if dirty_files:
        raise HTTPException(
            status_code=409,
            detail="Impossible de démarrer un rebase avec des modifications suivies non commitées. Effectuez un stash d'abord."
        )

    # Préparation du fichier d'instructions JSON
    config_file = target / ".git" / "antigravity_rebase_config.json"
    messages_queue = []
    commits_payload = []
    for c in req.commits:
        action = c.action.lower() if c.action else "pick"
        commits_payload.append({"sha": c.sha, "action": action})
        if action in ["reword", "squash"] and c.new_message:
            clean_msg = _sanitize_git_message(c.new_message)
            messages_queue.append(clean_msg)

    config_data = {
        "commits": commits_payload,
        "messages": messages_queue
    }

    try:
        with open(config_file, "w", encoding="utf-8") as f:
            json.dump(config_data, f, ensure_ascii=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'initialisation du rebase : {e!s}")

    python_bin = sys.executable
    helper_script = str(REBASE_HELPER_PATH)
    cfg_str = str(config_file)

    git_env = os.environ.copy()
    git_env["GIT_TERMINAL_PROMPT"] = "0"
    git_env["GIT_SEQUENCE_EDITOR"] = f'"{python_bin}" "{helper_script}" sequence "{cfg_str}"'
    git_env["GIT_EDITOR"] = f'"{python_bin}" "{helper_script}" editor "{cfg_str}"'

    res = run_git(["rebase", "-i", clean_base], target, timeout=45, env=git_env)
    
    # Check if conflicts or in-progress
    rebase_merge = target / ".git" / "rebase-merge"
    rebase_apply = target / ".git" / "rebase-apply"
    if rebase_merge.exists() or rebase_apply.exists():
        conf_res = run_git(["diff", "--name-only", "--diff-filter=U"], target)
        conf_files = [f.strip() for f in conf_res.stdout.splitlines() if f.strip()]
        return {
            "success": False,
            "status": "conflict",
            "conflicts": conf_files,
            "message": "Des conflits sont survenus pendant le rebase."
        }

    # Clean up config file on success or clean termination
    try:
        if config_file.exists():
            config_file.unlink()
    except Exception:
        pass

    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        raise HTTPException(status_code=400, detail=f"Échec du rebase : {_mask_git_output(err)}")

    return {
        "success": True,
        "status": "completed",
        "output": _mask_git_output(res.stdout or res.stderr or "Rebase interactif terminé avec succès.")
    }


@router.post("/rebase/continue")
def continue_rebase(req: RebaseActionRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    config_file = target / ".git" / "antigravity_rebase_config.json"
    
    python_bin = sys.executable
    helper_script = str(REBASE_HELPER_PATH)
    cfg_str = str(config_file)

    git_env = os.environ.copy()
    git_env["GIT_TERMINAL_PROMPT"] = "0"
    git_env["GIT_EDITOR"] = f'"{python_bin}" "{helper_script}" editor "{cfg_str}"'

    res = run_git(["rebase", "--continue"], target, timeout=45, env=git_env)

    rebase_merge = target / ".git" / "rebase-merge"
    rebase_apply = target / ".git" / "rebase-apply"
    if rebase_merge.exists() or rebase_apply.exists():
        conf_res = run_git(["diff", "--name-only", "--diff-filter=U"], target)
        conf_files = [f.strip() for f in conf_res.stdout.splitlines() if f.strip()]
        return {
            "success": False,
            "status": "conflict",
            "conflicts": conf_files,
            "message": "Des conflits subsistent."
        }

    try:
        if config_file.exists():
            config_file.unlink()
    except Exception:
        pass

    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        raise HTTPException(status_code=400, detail=f"Échec du rebase --continue : {_mask_git_output(err)}")

    return {
        "success": True,
        "status": "completed",
        "output": _mask_git_output(res.stdout or res.stderr or "Rebase complété.")
    }


@router.post("/rebase/abort")
def abort_rebase(req: RebaseActionRequest, _ = Depends(require_auth)):
    target = _validate_workspace(req.workspace)
    config_file = target / ".git" / "antigravity_rebase_config.json"

    res = run_git(["rebase", "--abort"], target, timeout=30)
    try:
        if config_file.exists():
            config_file.unlink()
    except Exception:
        pass

    if res.returncode != 0:
        err = res.stderr or res.stdout or ""
        raise HTTPException(status_code=400, detail=f"Échec de l'annulation du rebase : {_mask_git_output(err)}")

    return {
        "success": True,
        "status": "aborted",
        "output": _mask_git_output(res.stdout or res.stderr or "Rebase annulé, état d'origine restauré.")
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
    target = _validate_workspace(req.workspace)
    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or "--" in remote or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip()
        if not branch:
            res_head = run_git(["rev-parse", "--short=8", "HEAD"], target)
            if res_head.returncode == 0 and res_head.stdout.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Impossible d'effectuer le push en mode HEAD détaché. Spécifiez une branche explicitement."
                )
            branch = "main"

    if branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")

    # Préparer l'environnement avec désactivation du prompt interactif
    # Le token peut être injecté via GIT_TOKEN dans l'environnement du serveur,
    # ou le remote peut être préconfiguré avec le token dans son URL.
    git_env = os.environ.copy()
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
    target = _validate_workspace(req.workspace)
    remote = req.remote.strip() if req.remote else "origin"
    if remote.startswith("-") or "--" in remote or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")

    branch = req.branch.strip() if req.branch else None
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip()
        if not branch:
            res_head = run_git(["rev-parse", "--short=8", "HEAD"], target)
            if res_head.returncode == 0 and res_head.stdout.strip():
                raise HTTPException(
                    status_code=400,
                    detail="Impossible d'effectuer le pull en mode HEAD détaché. Spécifiez une branche explicitement."
                )
            branch = "main"

    if branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")

    git_env = os.environ.copy()
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




class TagRequest(BaseModel):
    workspace: str | None = None
    tag: str
    message: str | None = None
    push: bool = False
    remote: str = "origin"


@router.post("/tag")
def create_git_tag(req: TagRequest, _ = Depends(require_auth)):
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
        git_env = os.environ.copy()
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
    index: int = Field(0, ge=0)


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

    stashes: list[dict[str, Any]] = []
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
    index: int | None = Query(None, ge=0),
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
    index: int = Query(0, ge=0),
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
        chk_res = run_git(["checkout", "--ours", "--", norm_path], target)
        if chk_res.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Erreur lors de la résolution (ours) : {_mask_git_output(chk_res.stderr.strip() or chk_res.stdout.strip())}"
            )
    elif req.resolution == "theirs":
        chk_res = run_git(["checkout", "--theirs", "--", norm_path], target)
        if chk_res.returncode != 0:
            raise HTTPException(
                status_code=400,
                detail=f"Erreur lors de la résolution (theirs) : {_mask_git_output(chk_res.stderr.strip() or chk_res.stdout.strip())}"
            )
    elif req.resolution == "custom":
        if req.custom_content is None:
            raise HTTPException(status_code=400, detail="custom_content requis pour une résolution personnalisée.")
        full_path.parent.mkdir(parents=True, exist_ok=True)
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


# -------------------------------------------------------------
# Sprint 19: Git Remote Manager & Interactive Tag Publisher
# -------------------------------------------------------------

class GitRemoteDetail(BaseModel):
    name: str
    fetch_url: str
    push_url: str
    is_default: bool = False
    branches: list[str] = []


class CreateRemoteRequest(BaseModel):
    name: str
    url: str
    workspace: str | None = None


class UpdateRemoteRequest(BaseModel):
    new_name: str | None = None
    new_url: str | None = None
    workspace: str | None = None


class RemoteActionRequest(BaseModel):
    remote: str | None = None
    branch: str | None = None
    set_upstream: bool = False
    prune: bool = True
    force: bool = False
    workspace: str | None = None


class GitTagDetail(BaseModel):
    name: str
    commit_sha: str
    commit_short_sha: str
    commit_date: str
    commit_message: str
    is_annotated: bool
    tagger_name: str | None = None
    tagger_date: str | None = None
    tag_message: str | None = None


class CreateTagRequest(BaseModel):
    name: str
    target_commit: str = "HEAD"
    message: str | None = None
    push_remote: str | None = None
    push: bool = False
    remote: str | None = None
    workspace: str | None = None


class DeleteTagRequest(BaseModel):
    delete_remote: bool = False
    remote_name: str = "origin"
    workspace: str | None = None


class ReleaseNotesResponse(BaseModel):
    tag: str
    from_tag: str | None = None
    previous_tag: str | None = None
    commits_count: int = 0
    commit_count: int = 0
    notes_markdown: str = ""
    changelog_markdown: str = ""
    suggested_title: str
    github_release_url: str | None = None
    has_gh_cli: bool = False


class PublishReleaseRequest(BaseModel):
    tag: str
    title: str
    body: str | None = None
    notes: str | None = None
    draft: bool = False
    prerelease: bool = False
    target_commitish: str | None = None
    workspace: str | None = None


class PublishReleaseResponse(BaseModel):
    success: bool
    method: str = "gh_cli"  # "gh_cli" | "web_url"
    mode: str = "cli"       # "cli" | "web"
    url: str | None = None
    output: str | None = None
    message: str = ""


@router.get("/remotes", response_model=list[GitRemoteDetail])
def get_remotes(
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    res = run_git(["remote", "-v"], target)
    remotes_map: dict[str, dict[str, str]] = {}
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) >= 3:
            name = parts[0]
            url = parts[1]
            url_type = parts[2].strip("()")
            if name not in remotes_map:
                remotes_map[name] = {"fetch": "", "push": ""}
            if url_type == "fetch":
                remotes_map[name]["fetch"] = url
            elif url_type == "push":
                remotes_map[name]["push"] = url

    branches_res = run_git(["branch", "-r"], target)
    remote_branches_map: dict[str, list[str]] = {}
    for line in branches_res.stdout.splitlines():
        b = line.strip()
        if not b or "->" in b:
            continue
        if "/" in b:
            r_name, r_branch = b.split("/", 1)
            remote_branches_map.setdefault(r_name, []).append(r_branch)

    out: list[GitRemoteDetail] = []
    for name, urls in remotes_map.items():
        fetch_url = urls.get("fetch") or urls.get("push") or ""
        push_url = urls.get("push") or urls.get("fetch") or ""
        out.append(GitRemoteDetail(
            name=name,
            fetch_url=fetch_url,
            push_url=push_url,
            is_default=(name == "origin"),
            branches=remote_branches_map.get(name, [])
        ))
    out.sort(key=lambda r: (0 if r.is_default else 1, r.name.lower()))
    return out


@router.post("/remotes", response_model=GitRemoteDetail)
def create_remote(
    req: CreateRemoteRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    clean_name = req.name.strip()
    if not re.match(r"^[a-zA-Z0-9._-]+$", clean_name):
        raise HTTPException(status_code=400, detail="Nom de remote invalide (caractères alphanumériques, '.', '-', '_' uniquement).")
    clean_url = req.url.strip()
    if not clean_url:
        raise HTTPException(status_code=400, detail="URL de remote obligatoire.")

    res = run_git(["remote", "add", clean_name, clean_url], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur lors de l'ajout du remote : {_mask_git_output(res.stderr or res.stdout)}")

    return GitRemoteDetail(
        name=clean_name,
        fetch_url=clean_url,
        push_url=clean_url,
        is_default=(clean_name == "origin"),
        branches=[]
    )


@router.put("/remotes/{name}", response_model=GitRemoteDetail)
def update_remote(
    name: str,
    req: UpdateRemoteRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    current_name = name.strip()
    final_name = current_name
    if req.new_name and req.new_name.strip() != current_name:
        new_name_clean = req.new_name.strip()
        if not re.match(r"^[a-zA-Z0-9._-]+$", new_name_clean):
            raise HTTPException(status_code=400, detail="Nouveau nom de remote invalide.")
        res_rename = run_git(["remote", "rename", current_name, new_name_clean], target)
        if res_rename.returncode != 0:
            raise HTTPException(status_code=400, detail=f"Erreur renommage remote : {_mask_git_output(res_rename.stderr or res_rename.stdout)}")
        final_name = new_name_clean

    if req.new_url and req.new_url.strip():
        new_url_clean = req.new_url.strip()
        res_url = run_git(["remote", "set-url", final_name, new_url_clean], target)
        if res_url.returncode != 0:
            raise HTTPException(status_code=400, detail=f"Erreur modification URL remote : {_mask_git_output(res_url.stderr or res_url.stdout)}")

    res_v = run_git(["remote", "-v"], target)
    fetch_u = ""
    push_u = ""
    for line in res_v.stdout.splitlines():
        parts = line.strip().split()
        if len(parts) >= 3 and parts[0] == final_name:
            if "fetch" in parts[2]:
                fetch_u = parts[1]
            elif "push" in parts[2]:
                push_u = parts[1]

    return GitRemoteDetail(
        name=final_name,
        fetch_url=fetch_u or push_u or (req.new_url or ""),
        push_url=push_u or fetch_u or (req.new_url or ""),
        is_default=(final_name == "origin")
    )


@router.delete("/remotes/{name}")
def delete_remote(
    name: str,
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    res = run_git(["remote", "remove", name.strip()], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur suppression remote : {_mask_git_output(res.stderr or res.stdout)}")
    return {"success": True, "message": f"Remote {name} supprimé avec succès."}


@router.post("/remotes/{name}/test")
def test_remote_connection(
    name: str,
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    start = time.perf_counter()
    res = run_git(["ls-remote", "--heads", name.strip()], target, timeout=10)
    latency_ms = int((time.perf_counter() - start) * 1000)
    if res.returncode == 0:
        return {
            "success": True,
            "latency_ms": latency_ms,
            "output": res.stdout[:500] or "Connexion réussie.",
            "error": None
        }
    else:
        err_msg = _mask_git_output(res.stderr[:500] or res.stdout[:500] or "Inaccessible")
        return {
            "success": False,
            "latency_ms": latency_ms,
            "output": err_msg,
            "error": err_msg
        }


@router.post("/remotes/fetch")
@router.post("/remotes/{name}/fetch")
def fetch_remote(
    name: str | None = None,
    req: RemoteActionRequest | None = None,
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    remote_name = (name or (req.remote if req else None) or "origin").strip()
    ws = req.workspace if (req and req.workspace) else workspace
    target = _validate_workspace(ws)
    args = ["fetch", remote_name]
    if req and req.prune:
        args.append("--prune")
    res = run_git(args, target, timeout=30)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur git fetch : {_mask_git_output(res.stderr or res.stdout)}")
    return {"success": True, "output": res.stdout or res.stderr or "Fetch terminé avec succès."}


@router.post("/remotes/push")
@router.post("/remotes/{name}/push")
def push_remote(
    name: str | None = None,
    req: RemoteActionRequest | None = None,
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    remote_name = (name or (req.remote if req else None) or "origin").strip()
    if remote_name.startswith("-") or "--" in remote_name or not re.match(r'^[a-zA-Z0-9_\-\./]+$', remote_name):
        raise HTTPException(status_code=400, detail="Nom de remote Git invalide.")
    ws = req.workspace if (req and req.workspace) else workspace
    target = _validate_workspace(ws)
    branch = req.branch.strip() if (req and req.branch) else ""
    if not branch:
        res_br = run_git(["branch", "--show-current"], target)
        branch = res_br.stdout.strip() or "main"
    if branch.startswith("-") or "--" in branch or not re.match(r'^[a-zA-Z0-9_\-\./]+$', branch):
        raise HTTPException(status_code=400, detail="Nom de branche Git invalide.")
    args = ["push", remote_name, branch]
    if req and req.set_upstream:
        args.append("-u")
    if req and req.force:
        args.append("-f")
    res = run_git(args, target, timeout=30)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur git push : {_mask_git_output(res.stderr or res.stdout)}")
    return {"success": True, "output": res.stdout or res.stderr or "Push terminé avec succès."}


@router.get("/tags", response_model=list[GitTagDetail])
def get_tags(
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    fmt = "%(refname:strip=2)%09%(objectname)%09%(*objectname)%09%(creatordate:iso8601)%09%(*creatordate:iso8601)%09%(contents:subject)%09%(subject)%09%(taggername)"
    res = run_git(["for-each-ref", "refs/tags", f"--format={fmt}", "--sort=-creatordate"], target)
    out: list[GitTagDetail] = []
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\t")
        while len(parts) < 8:
            parts.append("")
        tag_name, obj_sha, deref_sha, creator_date, deref_date, contents_subj, subj, tagger = parts
        is_annotated = bool(deref_sha.strip())
        commit_sha = deref_sha.strip() if is_annotated else obj_sha.strip()
        commit_short = commit_sha[:7] if commit_sha else ""
        commit_date = deref_date.strip() if is_annotated else creator_date.strip()
        tag_msg = (contents_subj or subj).strip() if is_annotated else None

        commit_msg = ""
        if commit_sha:
            c_res = run_git(["log", "-1", "--format=%s", commit_sha], target)
            commit_msg = c_res.stdout.strip()

        out.append(GitTagDetail(
            name=tag_name,
            commit_sha=commit_sha,
            commit_short_sha=commit_short,
            commit_date=commit_date,
            commit_message=commit_msg,
            is_annotated=is_annotated,
            tagger_name=tagger.strip() if tagger.strip() else None,
            tagger_date=creator_date.strip() if is_annotated else None,
            tag_message=tag_msg
        ))
    return out


@router.post("/tags", response_model=GitTagDetail)
def create_tag(
    req: CreateTagRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    tag_name = req.name.strip()
    if not tag_name or tag_name.startswith("-") or not re.match(r"^[a-zA-Z0-9._/-]+$", tag_name):
        raise HTTPException(status_code=400, detail="Nom de tag invalide.")
    target_commit = (req.target_commit or "HEAD").strip()

    args = ["tag"]
    is_annotated = False
    tag_msg = None
    if req.message and req.message.strip():
        is_annotated = True
        tag_msg = _sanitize_git_message(req.message.strip())
        args.extend(["-a", tag_name, "-m", tag_msg, target_commit])
    else:
        args.extend([tag_name, target_commit])

    res = run_git(args, target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur création tag : {_mask_git_output(res.stderr or res.stdout)}")

    remote_to_push = req.push_remote or (req.remote if req.push else None)
    if remote_to_push:
        rem_clean = remote_to_push.strip()
        if rem_clean.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./]+$", rem_clean):
            raise HTTPException(status_code=400, detail="Nom de remote invalide.")
        run_git(["push", rem_clean, tag_name], target, timeout=30)

    res_commit = run_git(["rev-parse", target_commit], target)
    c_sha = res_commit.stdout.strip() if res_commit.returncode == 0 else ""
    c_date, c_msg = "", ""
    if c_sha:
        c_date_res = run_git(["log", "-1", "--format=%cd|%s", "--date=iso8601", c_sha], target)
        if c_date_res.returncode == 0 and "|" in c_date_res.stdout:
            c_date, c_msg = c_date_res.stdout.strip().split("|", 1)

    return GitTagDetail(
        name=tag_name,
        commit_sha=c_sha,
        commit_short_sha=c_sha[:7],
        commit_date=c_date,
        commit_message=c_msg,
        is_annotated=is_annotated,
        tag_message=tag_msg
    )


@router.delete("/tags/{name}")
def delete_tag(
    name: str,
    delete_remote: bool = Query(False),
    remote_name: str = Query("origin"),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    tag_name = name.strip()
    if not tag_name or tag_name.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./+]+$", tag_name):
        raise HTTPException(status_code=400, detail="Nom de tag invalide.")
    res = run_git(["tag", "-d", tag_name], target)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur suppression tag local : {_mask_git_output(res.stderr or res.stdout)}")
    if delete_remote:
        rem_clean = remote_name.strip()
        if rem_clean.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./]+$", rem_clean):
            raise HTTPException(status_code=400, detail="Nom de remote invalide.")
        run_git(["push", rem_clean, "--delete", tag_name], target, timeout=30)
    return {"success": True, "message": f"Tag {tag_name} supprimé avec succès."}


@router.post("/tags/{name}/push")
def push_tag(
    name: str,
    remote: str = Query("origin"),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    tag_name = name.strip()
    if not tag_name or tag_name.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./+]+$", tag_name):
        raise HTTPException(status_code=400, detail="Nom de tag invalide.")
    rem_clean = remote.strip()
    if rem_clean.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./]+$", rem_clean):
        raise HTTPException(status_code=400, detail="Nom de remote invalide.")
    res = run_git(["push", rem_clean, tag_name], target, timeout=30)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur push tag : {_mask_git_output(res.stderr or res.stdout)}")
    return {"success": True, "output": res.stdout or res.stderr or "Tag poussé avec succès."}


@router.post("/tags/push-all")
def push_all_tags(
    remote: str = Query("origin"),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    rem_clean = remote.strip() if remote else "origin"
    if rem_clean.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./]+$", rem_clean):
        raise HTTPException(status_code=400, detail="Nom de remote invalide.")
    res = run_git(["push", rem_clean, "--tags"], target, timeout=30)
    if res.returncode != 0:
        raise HTTPException(status_code=400, detail=f"Erreur push --tags : {_mask_git_output(res.stderr or res.stdout)}")
    return {"success": True, "output": res.stdout or res.stderr or "Tous les tags ont été poussés avec succès."}


def _build_github_release_url(owner_repo: str, tag: str, title: str, body: str, prerelease: bool = False) -> str:
    # Cap body length so that overall query string stays well within browser and web proxy limits
    max_body_len = 1500
    safe_body = body
    if len(safe_body) > max_body_len:
        safe_body = safe_body[:max_body_len].rstrip() + "\n\n... [Notes tronquées pour la limite d'URL Web GitHub]"
    params = {
        "tag": tag,
        "title": title,
        "body": safe_body,
    }
    if prerelease:
        params["prerelease"] = "1"
    return f"https://github.com/{owner_repo}/releases/new?{urlencode(params)}"


@router.get("/releases/notes", response_model=ReleaseNotesResponse)
def get_release_notes(
    tag: str = Query(...),
    from_tag: str | None = Query(None),
    workspace: str | None = Query(None),
    _ = Depends(require_auth)
):
    target = _validate_workspace(workspace)
    current_tag = tag.strip()
    prev_tag = from_tag.strip() if from_tag else None
    if not prev_tag:
        res_prev = run_git(["describe", "--tags", "--abbrev=0", f"{current_tag}^"], target)
        if res_prev.returncode == 0 and res_prev.stdout.strip():
            prev_tag = res_prev.stdout.strip()

    log_range = f"{prev_tag}..{current_tag}" if prev_tag else current_tag
    res_log = run_git(["log", log_range, "--pretty=format:%H|%h|%an|%s"], target)

    features = []
    fixes = []
    perf = []
    refactor = []
    docs = []
    chores = []

    commits_count = 0
    for line in res_log.stdout.splitlines():
        line = line.strip()
        if not line or "|" not in line:
            continue
        commits_count += 1
        parts = line.split("|", 3)
        _sha = parts[0]
        short_sha = parts[1]
        author = parts[2]
        subject = parts[3]

        item = f"- {subject} (`{short_sha}` par {author})"
        subj_lower = subject.lower()
        if subj_lower.startswith("feat"):
            features.append(item)
        elif subj_lower.startswith("fix"):
            fixes.append(item)
        elif subj_lower.startswith("perf"):
            perf.append(item)
        elif subj_lower.startswith("refactor"):
            refactor.append(item)
        elif subj_lower.startswith("docs"):
            docs.append(item)
        else:
            chores.append(item)

    md_sections = [f"## Release {current_tag}\n"]
    if prev_tag:
        md_sections.append(f"*Changelog des modifications depuis `{prev_tag}`*\n")

    if features:
        md_sections.append("### 🚀 Nouvelles Fonctionnalités\n" + "\n".join(features) + "\n")
    if fixes:
        md_sections.append("### 🐛 Corrections de Bugs\n" + "\n".join(fixes) + "\n")
    if perf:
        md_sections.append("### ⚡ Performances\n" + "\n".join(perf) + "\n")
    if refactor:
        md_sections.append("### ♻️ Refactorisation\n" + "\n".join(refactor) + "\n")
    if docs:
        md_sections.append("### 📚 Documentation\n" + "\n".join(docs) + "\n")
    if chores:
        md_sections.append("### 🔧 Maintenance & Tâches\n" + "\n".join(chores) + "\n")

    if commits_count == 0:
        md_sections.append("*Aucun commit spécifique trouvé pour cette plage.*")

    has_gh_cli = shutil.which("gh") is not None
    res_remote = run_git(["remote", "get-url", "origin"], target)
    origin_url = res_remote.stdout.strip()
    owner_repo = ""
    match = re.search(r"github\.com[:/]([^/]+)/(.+?)(?:\.git)?$", origin_url)
    if match:
        owner_repo = f"{match.group(1)}/{match.group(2)}"

    notes_md = "\n".join(md_sections).strip()
    github_release_url = None
    if owner_repo:
        github_release_url = _build_github_release_url(
            owner_repo=owner_repo,
            tag=current_tag,
            title=f"Release {current_tag}",
            body=notes_md
        )

    return ReleaseNotesResponse(
        tag=current_tag,
        from_tag=prev_tag,
        previous_tag=prev_tag,
        commits_count=commits_count,
        commit_count=commits_count,
        notes_markdown=notes_md,
        changelog_markdown=notes_md,
        suggested_title=f"Release {current_tag}",
        github_release_url=github_release_url,
        has_gh_cli=has_gh_cli
    )


@router.post("/releases/publish", response_model=PublishReleaseResponse)
def publish_release(
    req: PublishReleaseRequest,
    _ = Depends(require_auth)
):
    target = _validate_workspace(req.workspace)
    tag_clean = req.tag.strip()
    if not tag_clean or tag_clean.startswith("-") or "--" in tag_clean or not re.match(r"^[a-zA-Z0-9_\-\./+]+$", tag_clean):
        raise HTTPException(status_code=400, detail="Nom de tag Git invalide.")

    commitish = None
    if req.target_commitish:
        c_clean = req.target_commitish.strip()
        if c_clean.startswith("-") or not re.match(r"^[a-zA-Z0-9_\-\./~^]+$", c_clean):
            raise HTTPException(status_code=400, detail="Cible de commit invalide.")
        commitish = c_clean

    body_text = (req.body or req.notes or "").strip()
    gh_bin = shutil.which("gh")
    if gh_bin:
        args = [gh_bin, "release", "create", tag_clean, "--title", req.title, "--notes", body_text]
        if req.draft:
            args.append("--draft")
        if req.prerelease:
            args.append("--prerelease")
        if commitish:
            args.extend(["--target", commitish])
        try:
            gh_env = {
                **os.environ,
                "GH_PROMPT_DISABLED": "1",
                "GIT_TERMINAL_PROMPT": "0",
                "NO_COLOR": "1",
            }
            res = subprocess.run(args, cwd=str(target), capture_output=True, text=True, timeout=15, env=gh_env)
            if res.returncode == 0:
                created_url = res.stdout.strip()
                return PublishReleaseResponse(
                    success=True,
                    method="gh_cli",
                    mode="cli",
                    url=created_url,
                    output="Release publiée avec succès via GitHub CLI.",
                    message="Release publiée avec succès via GitHub CLI."
                )
            else:
                logger.warning(f"gh release create failed (exit {res.returncode}): {_mask_git_output(res.stderr.strip() or res.stdout.strip())}")
        except Exception as e:
            logger.debug(f"gh release create fallback: {e}")

    # Fallback to web URL
    res_remote = run_git(["remote", "get-url", "origin"], target)
    origin_url = res_remote.stdout.strip()
    owner_repo = ""
    match = re.search(r"github\.com[:/]([^/]+)/(.+?)(?:\.git)?$", origin_url)
    if match:
        owner_repo = f"{match.group(1)}/{match.group(2)}"

    if owner_repo:
        web_url = _build_github_release_url(
            owner_repo=owner_repo,
            tag=tag_clean,
            title=req.title,
            body=body_text,
            prerelease=bool(req.prerelease)
        )
        return PublishReleaseResponse(
            success=True,
            method="web_url",
            mode="web",
            url=web_url,
            output="URL de création de release GitHub générée.",
            message="URL de création de release GitHub générée."
        )

    return PublishReleaseResponse(
        success=True,
        method="web_url",
        mode="web",
        url=None,
        output="Aucun remote GitHub détecté pour la publication automatique.",
        message="Aucun remote GitHub détecté pour la publication automatique."
    )

