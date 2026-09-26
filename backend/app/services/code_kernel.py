"""Persistent Python Code Kernel with Tool RPC.
Directly adapted from Hermes Agent (`tools/code_kernel.py` and `tools/code_execution_rpc.py`).

Maintains a persistent Python execution environment where state (variables, imports,
functions, data frames) survives across multiple calls, and provides an integrated
`tools` proxy allowing scripts to invoke Antigravity tools (view_file, list_dir, grep_search)
directly inside the kernel without round-tripping through the LLM.
"""

from __future__ import annotations

import contextlib
import io
import logging
import os
import re
import sys
import threading
import time
import traceback
from typing import Any

from app.platform_utils import is_blocked_sensitive_path

logger = logging.getLogger(__name__)

_MAX_OUTPUT_CHARS = 500_000
_GLOBAL_EXECUTION_LOCK = threading.RLock()


class KernelToolProxy:
    """Tool bridge exposed inside the kernel as `tools`."""

    def __init__(self, cwd: str = "."):
        self.cwd = os.path.abspath(cwd)

    def call(self, tool_name: str, args: dict[str, Any] | None = None) -> Any:
        args = args or {}
        tool_name = tool_name.lower().replace("-", "_")

        if tool_name in ("view_file", "read_file"):
            path = args.get("AbsolutePath") or args.get("path") or ""
            return self.view_file(path, args.get("StartLine"), args.get("EndLine"))
        elif tool_name in ("list_dir", "ls"):
            path = args.get("DirectoryPath") or args.get("path") or "."
            return self.list_dir(path)
        elif tool_name in ("grep_search", "grep"):
            query = args.get("Query") or args.get("query") or ""
            path = args.get("SearchPath") or args.get("path") or "."
            return self.grep_search(query, path, bool(args.get("IsRegex", False)))
        else:
            raise ValueError(f"Outil non supporté dans le kernel RPC : {tool_name}")

    def view_file(
        self,
        path: str,
        start_line: int | None = None,
        end_line: int | None = None
    ) -> str:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        if is_blocked_sensitive_path(full_path):
            raise PermissionError("Accès refusé au fichier sensible")
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"Fichier introuvable : {full_path}")
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()

        try:
            start_idx = max(0, int(start_line) - 1) if start_line is not None else 0
        except (ValueError, TypeError):
            start_idx = 0
        try:
            end_val = int(end_line) if end_line is not None else len(lines)
            end_idx = max(start_idx, min(len(lines), end_val))
        except (ValueError, TypeError):
            end_idx = len(lines)
        return "".join(lines[start_idx:end_idx])

    def list_dir(self, path: str = ".") -> list[dict[str, Any]]:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        if is_blocked_sensitive_path(full_path):
            raise PermissionError("Accès refusé au dossier sensible")
        if not os.path.isdir(full_path):
            raise NotADirectoryError(f"Dossier introuvable : {full_path}")
        
        items = []
        for entry in os.scandir(full_path):
            try:
                if is_blocked_sensitive_path(entry.path):
                    continue
                stat = entry.stat()
                items.append({
                    "name": entry.name,
                    "is_dir": entry.is_dir(),
                    "size": stat.st_size if not entry.is_dir() else None,
                    "mtime": stat.st_mtime
                })
            except Exception:
                continue
        return items

    def grep_search(self, query: str, path: str = ".", is_regex: bool = False) -> list[dict[str, Any]]:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        if is_blocked_sensitive_path(full_path):
            raise PermissionError("Accès refusé au chemin sensible")
        results = []
        pattern = re.compile(query, re.IGNORECASE) if is_regex else None

        if os.path.isfile(full_path):
            files = [full_path]
        else:
            files = []
            for root, _, filenames in os.walk(full_path):
                if is_blocked_sensitive_path(root):
                    continue
                if any(ignored in root for ignored in [".git", "node_modules", "venv", "__pycache__"]):
                    continue
                for fn in filenames:
                    fp = os.path.join(root, fn)
                    if not is_blocked_sensitive_path(fp):
                        files.append(fp)

        for fp in files:
            try:
                with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                    for line_no, line in enumerate(f, 1):
                        match = False
                        if pattern:
                            match = bool(pattern.search(line))
                        else:
                            match = query.lower() in line.lower()
                        if match:
                            results.append({
                                "file": os.path.relpath(fp, self.cwd),
                                "line_number": line_no,
                                "content": line.rstrip()
                            })
                            if len(results) >= 200:
                                return results
            except Exception:
                continue
        return results


class IsolatedStream(io.StringIO):
    """Buffered in-memory stream that can be detached to prevent late/zombie thread leakage."""

    def __init__(self) -> None:
        super().__init__()
        self._active = True
        self._stream_lock = threading.Lock()

    def deactivate(self) -> None:
        with self._stream_lock:
            self._active = False

    def write(self, s: str) -> int:
        with self._stream_lock:
            if not self._active:
                return len(s)
            try:
                return super().write(s)
            except ValueError:
                return len(s)

    def flush(self) -> None:
        with self._stream_lock:
            if self._active:
                try:
                    super().flush()
                except ValueError:
                    pass


class PersistentPythonKernel:
    """Session-persistent Python kernel maintaining active namespace and RPC bridge."""

    def __init__(self, session_id: str = "default", cwd: str = "."):
        self.session_id = session_id
        self.cwd = os.path.abspath(cwd)
        self.execution_count = 0
        self.created_at = time.time()
        self.last_active_at = time.time()
        self.globals: dict[str, Any] = {}
        self.lock = threading.RLock()
        self.tool_proxy = KernelToolProxy(cwd=self.cwd)
        self._init_namespace()

    def _init_namespace(self) -> None:
        self.globals = {
            "__name__": "__main__",
            "__builtins__": __builtins__,
            "tools": self.tool_proxy,
        }

    def reset(self, new_cwd: str | None = None) -> None:
        with self.lock:
            if new_cwd:
                self.cwd = os.path.abspath(new_cwd)
                self.tool_proxy = KernelToolProxy(cwd=self.cwd)
            self._init_namespace()
            self.execution_count = 0
            self.last_active_at = time.time()

    def execute(self, code: str, timeout: int = 30) -> dict[str, Any]:
        """Execute a Python code cell inside the persistent namespace."""
        with _GLOBAL_EXECUTION_LOCK:
            orig_stdout = sys.stdout
            orig_stderr = sys.stderr
            out_buf = IsolatedStream()
            err_buf = IsolatedStream()
            try:
                with self.lock:
                    self.execution_count += 1
                    self.last_active_at = time.time()
                    start_time = time.perf_counter()
                    current_exec_count = self.execution_count

                status = "ok"
                tb = ""
                pre_globals = dict(self.globals)

                def run_code():
                    nonlocal status, tb
                    try:
                        with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
                            compiled = compile(code, f"<cell-{current_exec_count}>", "exec")
                            exec(compiled, self.globals)  # nosec B102
                    except SystemExit as se:
                        status = "exit"
                        tb = f"SystemExit: {se.code}"
                    except BaseException:
                        status = "error"
                        tb = traceback.format_exc()

                t = threading.Thread(target=run_code, daemon=True)
                t.start()
                t.join(timeout=timeout)

                if t.is_alive():
                    status = "timeout"
                    tb = f"Execution timed out after {timeout} seconds."
                    self.globals = pre_globals

                raw_out = out_buf.getvalue()
                raw_err = err_buf.getvalue()

                stdout_clipped = len(raw_out) > _MAX_OUTPUT_CHARS
                stderr_clipped = len(raw_err) > _MAX_OUTPUT_CHARS

                return {
                    "session_id": self.session_id,
                    "execution_count": current_exec_count,
                    "status": status,
                    "stdout": raw_out[:_MAX_OUTPUT_CHARS],
                    "stderr": raw_err[:_MAX_OUTPUT_CHARS],
                    "stdout_clipped": stdout_clipped,
                    "stderr_clipped": stderr_clipped,
                    "traceback": tb,
                    "duration_ms": max(0, int((time.perf_counter() - start_time) * 1000))
                }
            finally:
                out_buf.deactivate()
                err_buf.deactivate()
                if sys.stdout is out_buf:
                    sys.stdout = orig_stdout
                if sys.stderr is err_buf:
                    sys.stderr = orig_stderr


_KERNEL_REGISTRY: dict[str, PersistentPythonKernel] = {}
_REGISTRY_LOCK = threading.Lock()
_MAX_KERNELS = 50
_KERNEL_TTL_SECONDS = 7200  # 2 hours


def _prune_expired_kernels_locked(now: float) -> None:
    # 1. Prune by TTL
    expired = [
        sid for sid, k in _KERNEL_REGISTRY.items()
        if (now - k.last_active_at) > _KERNEL_TTL_SECONDS
    ]
    for sid in expired:
        _KERNEL_REGISTRY.pop(sid, None)

    # 2. Prune by capacity (LRU)
    if len(_KERNEL_REGISTRY) >= _MAX_KERNELS:
        sorted_kernels = sorted(_KERNEL_REGISTRY.items(), key=lambda item: item[1].last_active_at)
        to_evict = len(_KERNEL_REGISTRY) - _MAX_KERNELS + 1
        for sid, _ in sorted_kernels[:to_evict]:
            _KERNEL_REGISTRY.pop(sid, None)


def get_or_create_kernel(session_id: str = "default", cwd: str = ".") -> PersistentPythonKernel:
    with _REGISTRY_LOCK:
        now = time.time()
        _prune_expired_kernels_locked(now)
        if session_id not in _KERNEL_REGISTRY:
            _KERNEL_REGISTRY[session_id] = PersistentPythonKernel(session_id, cwd)
        kernel = _KERNEL_REGISTRY[session_id]
        kernel.last_active_at = now
        return kernel


def stop_kernel(session_id: str) -> bool:
    with _REGISTRY_LOCK:
        if session_id in _KERNEL_REGISTRY:
            del _KERNEL_REGISTRY[session_id]
            return True
        return False


def list_active_kernels() -> list[dict[str, Any]]:
    with _REGISTRY_LOCK:
        return [
            {
                "session_id": k.session_id,
                "cwd": k.cwd,
                "execution_count": k.execution_count,
                "created_at": k.created_at,
                "last_active_at": k.last_active_at,
            }
            for k in _KERNEL_REGISTRY.values()
        ]
