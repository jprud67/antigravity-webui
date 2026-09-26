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

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import REPO_ROOT

logger = logging.getLogger("antigravity.editor_diagnostics")

router = APIRouter(prefix="/api/editor", tags=["Editor Diagnostics"], dependencies=[Depends(require_auth)])


class EditorDiagnosticsRequest(BaseModel):
    content: str = ""
    filePath: str | None = None
    language: str = "text"
    workspace: str | None = None


class DiagnosticItem(BaseModel):
    line: int
    column: int
    endLine: int
    endColumn: int
    message: str
    severity: str  # 'error' | 'warning' | 'info'
    source: str    # 'ruff' | 'oxlint' | 'syntax' | 'json'
    code: str | None = None


class EditorDiagnosticsResponse(BaseModel):
    diagnostics: list[DiagnosticItem]
    duration_ms: float
    total_errors: int
    total_warnings: int
    total_infos: int


def _get_ruff_executable() -> str | None:
    # Check venv Scripts
    scripts_dir = Path(sys.executable).parent
    candidate = scripts_dir / ("ruff.exe" if os.name == "nt" else "ruff")
    if candidate.exists():
        return str(candidate)
    venv_candidate = Path(REPO_ROOT) / "backend" / "venv" / ("Scripts" if os.name == "nt" else "bin") / ("ruff.exe" if os.name == "nt" else "ruff")
    if venv_candidate.exists():
        return str(venv_candidate)
    return shutil.which("ruff")


def _get_oxlint_executable() -> str | None:
    # Check frontend/node_modules/.bin
    candidate = Path(REPO_ROOT) / "frontend" / "node_modules" / ".bin" / ("oxlint.cmd" if os.name == "nt" else "oxlint")
    if candidate.exists():
        return str(candidate)
    return shutil.which("oxlint")


def _lint_python(content: str, file_path: str | None) -> list[DiagnosticItem]:
    diagnostics: list[DiagnosticItem] = []
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
    except ValueError as e:
        has_syntax_error = True
        diagnostics.append(
            DiagnosticItem(
                line=1,
                column=1,
                endLine=1,
                endColumn=2,
                message=str(e),
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
            raw_target = (file_path or "").rstrip("/\\")
            base_name = os.path.basename(raw_target) if raw_target else ""
            stdin_filename = base_name if base_name else "temp_check.py"
            proc = subprocess.run(
                [ruff_bin, "check", "--output-format=json", "--stdin-filename", stdin_filename, "-"],
                input=content.encode("utf-8", errors="replace"),
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


def _lint_javascript(content: str, file_path: str | None, language: str) -> list[DiagnosticItem]:
    diagnostics: list[DiagnosticItem] = []
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
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False, mode="w", encoding="utf-8", errors="replace") as f:
            f.write(content)
            temp_file = f.name

        cmd = [oxlint_bin, "--format", "json", temp_file]
        if os.name == "nt" and oxlint_bin.endswith(".cmd"):
            cmd = ["cmd.exe", "/c", oxlint_bin, "--format", "json", temp_file]

        proc = subprocess.run(
            cmd,
            capture_output=True,
            encoding="utf-8",
            errors="replace",
            timeout=5
        )
        raw_out = (proc.stdout or "").strip()
        if raw_out:
            try:
                # Isolate JSON object or array even if oxlint prepends banners or notices
                s_obj = raw_out.find("{")
                s_arr = raw_out.find("[")
                start_idx = min(idx for idx in (s_obj, s_arr) if idx != -1) if (s_obj != -1 or s_arr != -1) else -1
                e_obj = raw_out.rfind("}")
                e_arr = raw_out.rfind("]")
                end_idx = max(e_obj, e_arr)
                json_str = raw_out[start_idx : end_idx + 1] if (start_idx != -1 and end_idx > start_idx) else raw_out
                parsed = json.loads(json_str)
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
                    span = None
                    if labels and isinstance(labels, list) and len(labels) > 0 and isinstance(labels[0], dict):
                        span = labels[0].get("span")
                    if not span and isinstance(item.get("span"), dict):
                        span = item.get("span")

                    if span and isinstance(span, dict):
                        line = max(1, span.get("line", 1))
                        col = max(1, span.get("column", 1))
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


def _lint_json(content: str) -> list[DiagnosticItem]:
    diagnostics: list[DiagnosticItem] = []
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


def _lint_yaml(content: str) -> list[DiagnosticItem]:
    diagnostics: list[DiagnosticItem] = []
    try:
        import yaml  # type: ignore[import-untyped]
    except (ImportError, ModuleNotFoundError):
        logger.debug("PyYAML is not installed, skipping YAML diagnostics")
        return []

    try:
        list(yaml.safe_load_all(content))
    except Exception as e:
        mark = getattr(e, "problem_mark", None)
        line = (mark.line + 1) if mark and hasattr(mark, "line") else 1
        col = (mark.column + 1) if mark and hasattr(mark, "column") else 1
        msg = str(e)
        if hasattr(e, "problem") and e.problem:
            msg = e.problem
            if hasattr(e, "context") and e.context:
                msg = f"{e.context}: {msg}"
        diagnostics.append(
            DiagnosticItem(
                line=line,
                column=col,
                endLine=line,
                endColumn=col + 1,
                message=msg,
                severity="error",
                source="yaml",
                code="YAMLError"
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

    # Protection against oversized content (>1MB) to prevent thread/subprocess starvation
    if len(content) > 1_000_000:
        return EditorDiagnosticsResponse(
            diagnostics=[
                DiagnosticItem(
                    line=1,
                    column=1,
                    endLine=1,
                    endColumn=1,
                    message="Contenu trop volumineux (>1 Mo) pour l'analyse en temps réel.",
                    severity="info",
                    source="diagnostics",
                    code="OVERSIZED_CONTENT"
                )
            ],
            duration_ms=round((time.perf_counter() - start_time) * 1000, 2),
            total_errors=0,
            total_warnings=0,
            total_infos=1
        )

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
        elif lower_fp.endswith((".yaml", ".yml")):
            language = "yaml"

    diagnostics: list[DiagnosticItem] = []

    if content.strip():
        if language in ("python", "py"):
            diagnostics = _lint_python(content, file_path)
        elif language in ("javascript", "typescript", "javascriptreact", "typescriptreact", "js", "ts", "jsx", "tsx"):
            diagnostics = _lint_javascript(content, file_path, language)
        elif language == "json":
            diagnostics = _lint_json(content)
        elif language in ("yaml", "yml"):
            diagnostics = _lint_yaml(content)

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
