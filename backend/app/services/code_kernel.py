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
import threading
import time
import traceback
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_MAX_OUTPUT_CHARS = 500_000


class KernelToolProxy:
    """Tool bridge exposed inside the kernel as `tools`."""

    def __init__(self, cwd: str = "."):
        self.cwd = os.path.abspath(cwd)

    def call(self, tool_name: str, args: Optional[Dict[str, Any]] = None) -> Any:
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
        start_line: Optional[int] = None,
        end_line: Optional[int] = None
    ) -> str:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        if not os.path.isfile(full_path):
            raise FileNotFoundError(f"Fichier introuvable : {full_path}")
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            lines = f.readlines()
        
        start = max(1, start_line) - 1 if start_line else 0
        end = min(len(lines), end_line) if end_line else len(lines)
        return "".join(lines[start:end])

    def list_dir(self, path: str = ".") -> List[Dict[str, Any]]:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        if not os.path.isdir(full_path):
            raise NotADirectoryError(f"Dossier introuvable : {full_path}")
        
        items = []
        for entry in os.scandir(full_path):
            try:
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

    def grep_search(self, query: str, path: str = ".", is_regex: bool = False) -> List[Dict[str, Any]]:
        full_path = os.path.normpath(os.path.join(self.cwd, path)) if not os.path.isabs(path) else path
        results = []
        pattern = re.compile(query, re.IGNORECASE) if is_regex else None

        if os.path.isfile(full_path):
            files = [full_path]
        else:
            files = []
            for root, _, filenames in os.walk(full_path):
                if any(ignored in root for ignored in [".git", "node_modules", "venv", "__pycache__"]):
                    continue
                for fn in filenames:
                    files.append(os.path.join(root, fn))

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


class PersistentPythonKernel:
    """Session-persistent Python kernel maintaining active namespace and RPC bridge."""

    def __init__(self, session_id: str = "default", cwd: str = "."):
        self.session_id = session_id
        self.cwd = os.path.abspath(cwd)
        self.execution_count = 0
        self.created_at = time.time()
        self.last_active_at = time.time()
        self.globals: Dict[str, Any] = {}
        self.lock = threading.RLock()
        self.tool_proxy = KernelToolProxy(cwd=self.cwd)
        self._init_namespace()

    def _init_namespace(self) -> None:
        self.globals = {
            "__name__": "__main__",
            "__builtins__": __builtins__,
            "tools": self.tool_proxy,
        }

    def reset(self, new_cwd: Optional[str] = None) -> None:
        with self.lock:
            if new_cwd:
                self.cwd = os.path.abspath(new_cwd)
                self.tool_proxy = KernelToolProxy(cwd=self.cwd)
            self._init_namespace()
            self.execution_count = 0
            self.last_active_at = time.time()

    def execute(self, code: str, timeout: int = 30) -> Dict[str, Any]:
        """Execute a Python code cell inside the persistent namespace."""
        with self.lock:
            self.execution_count += 1
            self.last_active_at = time.time()
            current_exec_count = self.execution_count

            out_buf = io.StringIO()
            err_buf = io.StringIO()
            status = "ok"
            tb = ""

            def run_code():
                nonlocal status, tb
                try:
                    with contextlib.redirect_stdout(out_buf), contextlib.redirect_stderr(err_buf):
                        compiled = compile(code, f"<cell-{current_exec_count}>", "exec")
                        exec(compiled, self.globals)  # nosec B102
                except SystemExit as se:
                    status = "exit"
                    tb = f"SystemExit: {se.code}"
                except Exception:
                    status = "error"
                    tb = traceback.format_exc()

            t = threading.Thread(target=run_code, daemon=True)
            t.start()
            t.join(timeout=timeout)

            if t.is_alive():
                status = "timeout"
                tb = f"Execution timed out after {timeout} seconds."

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
                "duration_ms": int((time.time() - self.last_active_at) * 1000)
            }


_KERNEL_REGISTRY: Dict[str, PersistentPythonKernel] = {}
_REGISTRY_LOCK = threading.Lock()


def get_or_create_kernel(session_id: str = "default", cwd: str = ".") -> PersistentPythonKernel:
    with _REGISTRY_LOCK:
        if session_id not in _KERNEL_REGISTRY:
            _KERNEL_REGISTRY[session_id] = PersistentPythonKernel(session_id, cwd)
        return _KERNEL_REGISTRY[session_id]


def stop_kernel(session_id: str) -> bool:
    with _REGISTRY_LOCK:
        if session_id in _KERNEL_REGISTRY:
            del _KERNEL_REGISTRY[session_id]
            return True
        return False


def list_active_kernels() -> List[Dict[str, Any]]:
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
