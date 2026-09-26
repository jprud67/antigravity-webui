import ast
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import REPO_ROOT

logger = logging.getLogger("antigravity.editor_diagnostics")

router = APIRouter(prefix="/api/editor", tags=["Editor Diagnostics"], dependencies=[Depends(require_auth)])


class EditorDiagnosticsRequest(BaseModel):
    content: str = ""
    filePath: Optional[str] = None
    language: str = "text"
    workspace: Optional[str] = None


class DiagnosticItem(BaseModel):
    line: int
    column: int
    endLine: int
    endColumn: int
    message: str
    severity: str  # 'error' | 'warning' | 'info'
    source: str    # 'ruff' | 'oxlint' | 'syntax' | 'json'
    code: Optional[str] = None


class EditorDiagnosticsResponse(BaseModel):
    diagnostics: List[DiagnosticItem]
    duration_ms: float
    total_errors: int
    total_warnings: int
    total_infos: int


def _get_ruff_executable() -> Optional[str]:
    # Check venv Scripts
    scripts_dir = Path(sys.executable).parent
    candidate = scripts_dir / ("ruff.exe" if os.name == "nt" else "ruff")
    if candidate.exists():
        return str(candidate)
    return shutil.which("ruff")


def _get_oxlint_executable() -> Optional[str]:
    # Check frontend/node_modules/.bin
    candidate = Path(REPO_ROOT) / "frontend" / "node_modules" / ".bin" / ("oxlint.cmd" if os.name == "nt" else "oxlint")
    if candidate.exists():
        return str(candidate)
    return shutil.which("oxlint")


def _lint_python(content: str, file_path: Optional[str]) -> List[DiagnosticItem]:
    diagnostics: List[DiagnosticItem] = []
    has_syntax_error = False

    # 1. AST syntax check
    try:
        ast.parse(content, filename=file_path or "<stdin>")
    except SyntaxError as e:
        has_syntax_error = True
        lineno = e.lineno or 1
        col = e.offset or 1
        diagnostics.append(
            DiagnosticItem(
                line=lineno,
                column=col,
                endLine=e.end_lineno or lineno,
                endColumn=e.end_offset or (col + 1),
                message=e.msg or "Syntax error",
                severity="error",
                source="syntax",
                code="E999"
            )
        )
    except Exception as e:
        logger.debug(f"AST parsing exception: {e}")

    # 2. Ruff check
    ruff_bin = _get_ruff_executable()
    if ruff_bin:
        try:
            stdin_filename = file_path or "temp_check.py"
            # If path is outside repo or synthetic, keep just filename
            stdin_filename = os.path.basename(stdin_filename)
            proc = subprocess.run(
                [ruff_bin, "check", "--output-format=json", "--stdin-filename", stdin_filename, "-"],
                input=content.encode("utf-8"),
                capture_output=True,
                timeout=4
            )
            raw_out = proc.stdout.decode("utf-8", errors="ignore").strip()
            if raw_out:
                try:
                    ruff_items = json.loads(raw_out)
                    if isinstance(ruff_items, list):
                        for item in ruff_items:
                            # Skip ruff syntax error if we already captured it via AST
                            code = item.get("code") or ""
                            if has_syntax_error and code in ("E999", "SyntaxError"):
                                continue

                            loc = item.get("location") or {}
                            end_loc = item.get("end_location") or {}
                            row = loc.get("row", 1)
                            col = loc.get("column", 1)
                            end_row = end_loc.get("row", row)
                            end_col = end_loc.get("column", col + 1)

                            # Determine severity
                            raw_sev = str(item.get("severity") or "").lower()
                            if raw_sev == "error" or code.startswith("E9"):
                                sev = "error"
                            elif code.startswith("I") or "info" in raw_sev:
                                sev = "info"
                            else:
                                sev = "warning"

                            diagnostics.append(
                                DiagnosticItem(
                                    line=row,
                                    column=col,
                                    endLine=end_row,
                                    endColumn=end_col,
                                    message=item.get("message") or "Linter warning",
                                    severity=sev,
                                    source="ruff",
                                    code=code or None
                                )
                            )
                except Exception as ex:
                    logger.debug(f"Failed to parse ruff JSON: {ex}")
        except Exception as ex:
            logger.debug(f"Ruff execution failed: {ex}")

    return diagnostics


def _lint_javascript(content: str, file_path: Optional[str], language: str) -> List[DiagnosticItem]:
    diagnostics: List[DiagnosticItem] = []
    oxlint_bin = _get_oxlint_executable()
    if not oxlint_bin:
        return diagnostics

    ext = ".ts"
    if "jsx" in language or (file_path and file_path.endswith(".jsx")):
        ext = ".jsx"
    elif "tsx" in language or (file_path and file_path.endswith(".tsx")):
        ext = ".tsx"
    elif "js" in language or (file_path and file_path.endswith(".js")):
        ext = ".js"

    temp_file = None
    try:
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False, mode="w", encoding="utf-8") as f:
            f.write(content)
            temp_file = f.name

        cmd = [oxlint_bin, "--format", "json", temp_file]
        if os.name == "nt" and oxlint_bin.endswith(".cmd"):
            cmd = ["cmd.exe", "/c", oxlint_bin, "--format", "json", temp_file]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=5
        )
        raw_out = proc.stdout.strip()
        if raw_out:
            try:
                parsed = json.loads(raw_out)
                items = parsed.get("diagnostics", []) if isinstance(parsed, dict) else parsed
                for item in items:
                    msg = item.get("message") or ""
                    code = item.get("code") or ""
                    sev = "warning"
                    if item.get("severity") == "error":
                        sev = "error"

                    labels = item.get("labels", [])
                    line = 1
                    col = 1
                    end_line = 1
                    end_col = 2
                    if labels and isinstance(labels, list):
                        span = labels[0].get("span") or {}
                        line = span.get("line", 1)
                        col = span.get("column", 1)
                        end_line = line
                        end_col = col + max(span.get("length", 1), 1)

                    diagnostics.append(
                        DiagnosticItem(
                            line=line,
                            column=col,
                            endLine=end_line,
                            endColumn=end_col,
                            message=msg,
                            severity=sev,
                            source="oxlint",
                            code=code or None
                        )
                    )
            except Exception as ex:
                logger.debug(f"Failed to parse oxlint output: {ex}")
    except Exception as ex:
        logger.debug(f"Oxlint execution failed: {ex}")
    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.unlink(temp_file)
            except Exception:
                pass

    return diagnostics


def _lint_json(content: str) -> List[DiagnosticItem]:
    diagnostics: List[DiagnosticItem] = []
    try:
        json.loads(content)
    except json.JSONDecodeError as e:
        diagnostics.append(
            DiagnosticItem(
                line=e.lineno,
                column=e.colno,
                endLine=e.lineno,
                endColumn=e.colno + 1,
                message=e.msg,
                severity="error",
                source="json",
                code="JSONDecodeError"
            )
        )
    return diagnostics


@router.post("/diagnostics", response_model=EditorDiagnosticsResponse)
def get_editor_diagnostics(
    req: EditorDiagnosticsRequest
):
    start_time = time.perf_counter()
    content = req.content or ""
    language = (req.language or "text").lower().strip()
    file_path = req.filePath

    # Infer language from file_path if language is generic or missing
    if (language in ("text", "plaintext", "") or not language) and file_path:
        lower_fp = file_path.lower()
        if lower_fp.endswith((".py", ".pyw", ".pyi")):
            language = "python"
        elif lower_fp.endswith(".ts"):
            language = "typescript"
        elif lower_fp.endswith(".tsx"):
            language = "typescriptreact"
        elif lower_fp.endswith(".js"):
            language = "javascript"
        elif lower_fp.endswith(".jsx"):
            language = "javascriptreact"
        elif lower_fp.endswith(".json"):
            language = "json"

    diagnostics: List[DiagnosticItem] = []

    if content.strip():
        if language in ("python", "py"):
            diagnostics = _lint_python(content, file_path)
        elif language in ("javascript", "typescript", "javascriptreact", "typescriptreact", "js", "ts", "jsx", "tsx"):
            diagnostics = _lint_javascript(content, file_path, language)
        elif language == "json":
            diagnostics = _lint_json(content)

    # Sort diagnostics by line, then column
    diagnostics.sort(key=lambda d: (d.line, d.column))

    total_errors = sum(1 for d in diagnostics if d.severity == "error")
    total_warnings = sum(1 for d in diagnostics if d.severity == "warning")
    total_infos = sum(1 for d in diagnostics if d.severity == "info")
    duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

    return EditorDiagnosticsResponse(
        diagnostics=diagnostics,
        duration_ms=duration_ms,
        total_errors=total_errors,
        total_warnings=total_warnings,
        total_infos=total_infos
    )
