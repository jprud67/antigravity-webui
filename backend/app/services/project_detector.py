import json
import logging
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from app.platform_utils import is_blocked_sensitive_path

logger = logging.getLogger("antigravity.project_detector")

_cache: dict[str, tuple[float, dict[str, Any]]] = {}
_cache_lock = threading.Lock()
CACHE_TTL = 5.0  # seconds


def clear_detector_cache() -> None:
    """Clear all cached project detections."""
    with _cache_lock:
        _cache.clear()


def detect_project_details(
    workspace_path: str, is_default: bool = False, is_active: bool = False
) -> dict[str, Any]:
    """Inspect and return rich metadata, runtimes, git telemetry, and health for a workspace."""
    if not workspace_path or not workspace_path.strip():
        return _empty_project_detail(workspace_path, is_default, is_active)

    try:
        resolved_path = Path(workspace_path.strip()).resolve()
    except Exception as e:
        logger.warning(f"Failed to resolve workspace path '{workspace_path}': {e}")
        return _empty_project_detail(workspace_path, is_default, is_active)

    if is_blocked_sensitive_path(resolved_path) or not resolved_path.is_dir():
        return _empty_project_detail(str(resolved_path), is_default, is_active)

    cache_key = f"{resolved_path!s}::{is_default}::{is_active}"
    now = time.time()
    with _cache_lock:
        if cache_key in _cache:
            ts, val = _cache[cache_key]
            if now - ts < CACHE_TTL:
                return val

    # Run inspection
    detail = _inspect_workspace(resolved_path, is_default, is_active)
    with _cache_lock:
        _cache[cache_key] = (now, detail)
    return detail


def detect_project_health(workspace_path: str) -> dict[str, Any]:
    """Run lightweight health check on a specific workspace path."""
    details = detect_project_details(workspace_path)
    return details.get("health", {
        "status": "healthy",
        "dependencies_installed": True,
        "warnings": [],
        "suggested_action": None
    })


def _empty_project_detail(path_str: str, is_default: bool, is_active: bool) -> dict[str, Any]:
    return {
        "path": path_str,
        "name": Path(path_str).name if path_str else "Inconnu",
        "is_default": is_default,
        "is_active": is_active,
        "last_modified": None,
        "stats": {"file_count": 0, "disk_size_mb": 0.0},
        "runtimes": [],
        "git": {
            "is_repo": False,
            "branch": None,
            "is_dirty": False,
            "uncommitted_count": 0,
            "remote_url": None,
            "ahead": 0,
            "behind": 0,
            "last_commit": None,
        },
        "health": {
            "status": "healthy",
            "dependencies_installed": True,
            "warnings": [],
            "suggested_action": None,
        },
    }


def _inspect_workspace(p: Path, is_default: bool, is_active: bool) -> dict[str, Any]:
    name = p.name
    runtimes, health, project_name = _extract_runtimes_and_health(p)
    if project_name:
        name = project_name

    git_info = _extract_git_info(p)
    if git_info.get("is_dirty") and git_info.get("uncommitted_count", 0) > 0:
        count = git_info["uncommitted_count"]
        health["warnings"].append(f"{count} modification(s) Git non indexée(s)")
        if health["status"] == "healthy":
            health["status"] = "warning"

    stats = _extract_stats(p)

    return {
        "path": str(p),
        "name": name,
        "is_default": is_default,
        "is_active": is_active,
        "last_modified": stats.get("last_modified"),
        "stats": stats,
        "runtimes": runtimes,
        "git": git_info,
        "health": health,
    }


def _extract_runtimes_and_health(p: Path) -> tuple[list[dict[str, Any]], dict[str, Any], str | None]:
    runtimes: list[dict[str, Any]] = []
    warnings: list[str] = []
    suggested_action: dict[str, str] | None = None
    deps_installed = True
    node_modules_present: bool | None = None
    venv_present: bool | None = None
    vendor_present: bool | None = None
    detected_name: str | None = None

    # 1. Node.js detection (root or frontend/client/web subfolder)
    pkg_json_file = p / "package.json"
    node_sub = p
    if not pkg_json_file.is_file():
        for sub in ["frontend", "client", "web"]:
            candidate = p / sub / "package.json"
            if candidate.is_file():
                pkg_json_file = candidate
                node_sub = p / sub
                break

    if pkg_json_file.is_file():
        try:
            pkg_data = json.loads(pkg_json_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(pkg_data, dict):
                raw_name = pkg_data.get("name")
                if raw_name and isinstance(raw_name, str) and raw_name.strip() and not detected_name:
                    detected_name = raw_name.split("/")[-1]

                deps = pkg_data.get("dependencies", {})
                dev_deps = pkg_data.get("devDependencies", {})
                all_deps = {}
                if isinstance(deps, dict):
                    all_deps.update(deps)
                if isinstance(dev_deps, dict):
                    all_deps.update(dev_deps)

                frameworks: list[str] = []
                known_fw = [
                    ("react", "react"),
                    ("vite", "vite"),
                    ("next", "nextjs"),
                    ("vue", "vue"),
                    ("nuxt", "nuxt"),
                    ("svelte", "svelte"),
                    ("@angular/core", "angular"),
                    ("express", "express"),
                    ("fastify", "fastify"),
                    ("@nestjs/core", "nestjs"),
                    ("tailwindcss", "tailwindcss"),
                    ("typescript", "typescript"),
                    ("electron", "electron"),
                ]
                for dep_key, fw_label in known_fw:
                    if dep_key in all_deps:
                        frameworks.append(fw_label)

                # Package manager detection
                pkg_mgr = "npm"
                if (node_sub / "pnpm-lock.yaml").exists() or (p / "pnpm-lock.yaml").exists():
                    pkg_mgr = "pnpm"
                elif (node_sub / "yarn.lock").exists() or (p / "yarn.lock").exists():
                    pkg_mgr = "yarn"
                elif (node_sub / "bun.lockb").exists() or (node_sub / "bun.lock").exists() or (p / "bun.lock").exists():
                    pkg_mgr = "bun"

                runtimes.append({
                    "type": "node",
                    "version": None,
                    "frameworks": frameworks,
                    "package_manager": pkg_mgr,
                })

                # Health check: node_modules
                node_modules_present = (p / "node_modules").is_dir() or (node_sub / "node_modules").is_dir()
                if not node_modules_present:
                    deps_installed = False
                    warnings.append("Dépendances Node.js non installées (node_modules manquant)")
                    if not suggested_action:
                        suggested_action = {
                            "label": f"Installer dépendances ({pkg_mgr})",
                            "command": f"{pkg_mgr} install",
                        }
        except Exception as e:
            logger.debug(f"Error parsing package.json in {pkg_json_file}: {e}")

    # 2. Python detection (root or backend/server/api subfolder)
    py_dir = p
    has_pyproject = (p / "pyproject.toml").is_file()
    has_requirements = (p / "requirements.txt").is_file()
    has_pipfile = (p / "Pipfile").is_file()
    has_setup_py = (p / "setup.py").is_file()

    if not (has_pyproject or has_requirements or has_pipfile or has_setup_py):
        for sub in ["backend", "api", "server"]:
            candidate_dir = p / sub
            if (candidate_dir / "pyproject.toml").is_file() or (candidate_dir / "requirements.txt").is_file():
                py_dir = candidate_dir
                has_pyproject = (candidate_dir / "pyproject.toml").is_file()
                has_requirements = (candidate_dir / "requirements.txt").is_file()
                has_pipfile = (candidate_dir / "Pipfile").is_file()
                has_setup_py = (candidate_dir / "setup.py").is_file()
                break

    if has_pyproject or has_requirements or has_pipfile or has_setup_py:
        py_frameworks: list[str] = []
        py_pkg_mgr = "pip"
        if (py_dir / "poetry.lock").exists() or (p / "poetry.lock").exists():
            py_pkg_mgr = "poetry"
        elif (py_dir / "Pipfile.lock").exists() or (p / "Pipfile.lock").exists():
            py_pkg_mgr = "pipenv"

        # Check content in requirements or pyproject
        content_to_check = ""
        if has_requirements:
            try:
                content_to_check += (py_dir / "requirements.txt").read_text(encoding="utf-8", errors="replace").lower()
            except Exception:
                pass
        if has_pyproject:
            try:
                content_to_check += (py_dir / "pyproject.toml").read_text(encoding="utf-8", errors="replace").lower()
            except Exception:
                pass

        known_py_fw = [
            ("fastapi", "fastapi"),
            ("django", "django"),
            ("flask", "flask"),
            ("uvicorn", "uvicorn"),
            ("pytest", "pytest"),
            ("torch", "pytorch"),
            ("tensorflow", "tensorflow"),
            ("sqlalchemy", "sqlalchemy"),
            ("pydantic", "pydantic"),
        ]
        for key, label in known_py_fw:
            if key in content_to_check:
                py_frameworks.append(label)

        runtimes.append({
            "type": "python",
            "version": None,
            "frameworks": py_frameworks,
            "package_manager": py_pkg_mgr,
        })

        # Health check: venv
        venv_present = any((p / d).is_dir() for d in [".venv", "venv", "env", ".env_py"]) or \
                       any((py_dir / d).is_dir() for d in [".venv", "venv", "env", ".env_py"])
        if not venv_present:
            deps_installed = False
            warnings.append("Environnement virtuel Python (.venv) manquant")
            if not suggested_action:
                suggested_action = {
                    "label": "Créer environnement virtuel",
                    "command": "python -m venv venv",
                }

    # 3. PHP detection
    composer_file = p / "composer.json"
    if composer_file.is_file():
        try:
            comp_data = json.loads(composer_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(comp_data, dict):
                raw_comp_name = comp_data.get("name")
                if raw_comp_name and not detected_name:
                    detected_name = raw_comp_name.split("/")[-1]

                reqs = comp_data.get("require", {})
                php_frameworks: list[str] = []
                if isinstance(reqs, dict):
                    if "laravel/framework" in reqs:
                        php_frameworks.append("laravel")
                    if any("symfony" in k for k in reqs):
                        php_frameworks.append("symfony")
                    if "roots/bedrock" in reqs or "wordpress" in str(reqs):
                        php_frameworks.append("wordpress")

                runtimes.append({
                    "type": "php",
                    "version": None,
                    "frameworks": php_frameworks,
                    "package_manager": "composer",
                })

                vendor_dir = p / "vendor"
                if vendor_dir.is_dir():
                    vendor_present = True
                else:
                    vendor_present = False
                    deps_installed = False
                    warnings.append("Dépendances PHP non installées (vendor manquant)")
                    if not suggested_action:
                        suggested_action = {
                            "label": "Installer dépendances PHP",
                            "command": "composer install",
                        }
        except Exception as e:
            logger.debug(f"Error parsing composer.json in {p}: {e}")

    # 4. Rust detection
    if (p / "Cargo.toml").is_file():
        runtimes.append({
            "type": "rust",
            "version": None,
            "frameworks": [],
            "package_manager": "cargo",
        })

    # 5. Go detection
    if (p / "go.mod").is_file():
        runtimes.append({
            "type": "go",
            "version": None,
            "frameworks": [],
            "package_manager": "go",
        })

    # 6. Docker detection
    if (
        (p / "Dockerfile").is_file()
        or (p / "docker-compose.yml").is_file()
        or (p / "docker-compose.yaml").is_file()
        or (p / "compose.yml").is_file()
        or (p / "compose.yaml").is_file()
    ):
        runtimes.append({
            "type": "docker",
            "version": None,
            "frameworks": [],
            "package_manager": None,
        })

    status = "healthy"
    if warnings:
        status = "warning"

    health = {
        "status": status,
        "dependencies_installed": deps_installed,
        "node_modules_present": node_modules_present,
        "venv_present": venv_present,
        "vendor_present": vendor_present,
        "warnings": warnings,
        "suggested_action": suggested_action,
    }

    return runtimes, health, detected_name


def _extract_git_info(p: Path) -> dict[str, Any]:
    git_dir = p / ".git"
    if not git_dir.exists():
        return {
            "is_repo": False,
            "branch": None,
            "is_dirty": False,
            "uncommitted_count": 0,
            "remote_url": None,
            "ahead": 0,
            "behind": 0,
            "last_commit": None,
        }

    git_bin = shutil.which("git") or "git"
    git_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "",
        "SSH_ASKPASS": "",
    }

    branch: str | None = None
    is_dirty = False
    uncommitted_count = 0
    ahead = 0
    behind = 0

    try:
        res = subprocess.run(
            [git_bin, "status", "--porcelain=v1", "-b", "-uno"],
            cwd=str(p),
            capture_output=True,
            text=True,
            timeout=2.0,
            env=git_env,
        )
        if res.returncode == 0:
            lines = [l for l in res.stdout.splitlines() if l.strip()]
            if lines:
                header = lines[0]
                if header.startswith("## "):
                    h_text = header[3:].strip()
                    if h_text.startswith("No commits yet on "):
                        branch = h_text.removeprefix("No commits yet on ").strip()
                    elif h_text.startswith("HEAD ("):
                        branch = "HEAD (detached)"
                    else:
                        parts = h_text.split("...")
                        branch = parts[0].strip()
                        if len(parts) > 1:
                            track_info = parts[1].strip()
                            if "[" in track_info and "]" in track_info:
                                b_info = track_info.split("[", 1)[1].split("]", 1)[0]
                                if "ahead " in b_info:
                                    try:
                                        ahead = int(b_info.split("ahead ")[1].split(",")[0].split()[0])
                                    except Exception:
                                        pass
                                if "behind " in b_info:
                                    try:
                                        behind = int(b_info.split("behind ")[1].split(",")[0].split()[0])
                                    except Exception:
                                        pass
                dirty_lines = lines[1:]
                if dirty_lines:
                    is_dirty = True
                    uncommitted_count = len(dirty_lines)
    except Exception as e:
        logger.debug(f"Git status check failed for {p}: {e}")

    # Fallback for branch if status didn't parse branch
    if not branch:
        try:
            res_b = subprocess.run(
                [git_bin, "branch", "--show-current"],
                cwd=str(p),
                capture_output=True,
                text=True,
                timeout=1.5,
                env=git_env,
            )
            if res_b.returncode == 0 and res_b.stdout.strip():
                branch = res_b.stdout.strip()
        except Exception:
            pass

    # Remote URL
    remote_url: str | None = None
    try:
        res = subprocess.run(
            [git_bin, "remote", "get-url", "origin"],
            cwd=str(p),
            capture_output=True,
            text=True,
            timeout=1.5,
            env=git_env,
        )
        if res.returncode == 0:
            remote_url = res.stdout.strip()
    except Exception:
        pass

    # Last commit
    last_commit: dict[str, str] | None = None
    try:
        res = subprocess.run(
            [git_bin, "log", "-1", "--format=%h|%cI|%s"],
            cwd=str(p),
            capture_output=True,
            text=True,
            timeout=1.5,
            env=git_env,
        )
        if res.returncode == 0 and res.stdout.strip():
            parts = res.stdout.strip().split("|", 2)
            if len(parts) == 3:
                last_commit = {
                    "sha": parts[0],
                    "date": parts[1],
                    "subject": parts[2],
                }
    except Exception:
        pass

    return {
        "is_repo": True,
        "branch": branch or "HEAD (detached)",
        "is_dirty": is_dirty,
        "uncommitted_count": uncommitted_count,
        "remote_url": remote_url,
        "ahead": ahead,
        "behind": behind,
        "last_commit": last_commit,
    }


def _extract_stats(p: Path) -> dict[str, Any]:
    file_count = 0
    disk_size_mb = 0.0
    last_modified_ts = 0.0

    try:
        mtime = p.stat().st_mtime
        last_modified_ts = mtime
    except Exception:
        pass

    try:
        # Fast shallow inspection up to 2 levels to avoid stalling on huge workspaces
        count = 0
        total_bytes = 0
        for entry in p.iterdir():
            if entry.name.startswith(".") and entry.name not in [".github"]:
                continue
            if entry.name in ["node_modules", "venv", ".venv", "vendor", "dist", "build", "__pycache__"]:
                continue
            try:
                st = entry.stat(follow_symlinks=False)
                last_modified_ts = max(last_modified_ts, st.st_mtime)
                if entry.is_file():
                    total_bytes += st.st_size
                    count += 1
                elif entry.is_dir():
                    for sub in entry.iterdir():
                        if sub.name.startswith(".") and sub.name not in [".github"]:
                            continue
                        if sub.name in ["node_modules", "venv", ".venv", "vendor", "dist", "build", "__pycache__"]:
                            continue
                        try:
                            st_sub = sub.stat(follow_symlinks=False)
                            last_modified_ts = max(last_modified_ts, st_sub.st_mtime)
                            if sub.is_file():
                                total_bytes += st_sub.st_size
                                count += 1
                        except Exception:
                            continue
            except Exception:
                continue
        file_count = count
        disk_size_mb = round(total_bytes / (1024 * 1024), 2)
    except Exception:
        pass

    last_mod_str = None
    if last_modified_ts > 0:
        try:
            last_mod_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(last_modified_ts))
        except Exception:
            pass

    return {
        "file_count": file_count,
        "disk_size_mb": disk_size_mb,
        "last_modified": last_mod_str,
    }
