"""Database Explorer & Visual SQL Query Studio Service.

Inspects local SQLite databases in the active workspace and provides secure
schema discovery, SQL query execution, latency telemetry, and exports.
"""

from __future__ import annotations

import csv
import io
import json
import logging
import os
import sqlite3
import time
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.platform_utils import is_blocked_sensitive_path

logger = logging.getLogger("antigravity.database_studio")

IGNORED_DIRS = {
    ".git",
    "node_modules",
    "venv",
    ".venv",
    "__pycache__",
    "dist",
    "build",
    ".gemini",
    ".superpowers",
    ".pytest_cache",
    ".ruff_cache",
}

SQLITE_EXTENSIONS = {".db", ".sqlite", ".sqlite3"}
SQLITE_HEADER = b"SQLite format 3\x00"


class ColumnInfo(BaseModel):
    name: str
    type: str
    primary_key: bool = False
    nullable: bool = True
    default_value: str | None = None


class TableInfo(BaseModel):
    name: str
    is_view: bool = False
    columns: list[ColumnInfo] = Field(default_factory=list)
    row_count_estimate: int | None = None


class DatabaseSchema(BaseModel):
    database_name: str
    dialect: str = "sqlite"
    tables: list[TableInfo] = Field(default_factory=list)


class DatabaseConnectionInfo(BaseModel):
    id: str
    name: str
    dialect: Literal["sqlite", "postgresql", "mysql"] = "sqlite"
    path: str
    size_bytes: int | None = None
    is_workspace_local: bool = True
    table_count: int = 0


class QueryResult(BaseModel):
    columns: list[str] = Field(default_factory=list)
    rows: list[list[Any]] = Field(default_factory=list)
    total_rows: int = 0
    truncated: bool = False
    execution_time_ms: float = 0.0
    error: str | None = None


class QueryRequest(BaseModel):
    db_path: str
    query: str
    limit: int = 500


class ExportRequest(BaseModel):
    db_path: str
    query: str
    format: Literal["csv", "json"] = "csv"


def is_sqlite_file(file_path: Path) -> bool:
    """Checks if a file exists and starts with the SQLite 3 magic header."""
    try:
        if not file_path.is_file():
            return False
        if file_path.suffix.lower() in SQLITE_EXTENSIONS:
            return True
        with open(file_path, "rb") as f:
            header = f.read(16)
            return header == SQLITE_HEADER
    except (OSError, PermissionError):
        return False


def count_sqlite_tables(db_path: str) -> int:
    """Quickly returns the number of tables in an SQLite database."""
    conn = None
    try:
        resolved_uri = Path(db_path).resolve().as_uri() + "?mode=ro"
        conn = sqlite3.connect(resolved_uri, uri=True, timeout=2.0)
        cursor = conn.cursor()
        cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        row = cursor.fetchone()
        return int(row[0]) if row else 0
    except Exception:
        return 0
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception as close_err:
                logger.debug("Failed to close SQLite connection: %s", close_err)


def discover_databases(workspace_path: str, max_depth: int = 4) -> list[DatabaseConnectionInfo]:
    """Scans the active workspace directory for SQLite databases."""
    root = Path(workspace_path).resolve()
    if not root.is_dir() or is_blocked_sensitive_path(str(root)):
        return []

    discovered: list[DatabaseConnectionInfo] = []

    try:
        for current_root, dirs, files in os.walk(str(root)):
            dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".")]

            rel_path = Path(current_root).relative_to(root)
            if len(rel_path.parts) > max_depth:
                dirs.clear()
                continue

            for file in files:
                ext = Path(file).suffix.lower()
                if ext in SQLITE_EXTENSIONS:
                    full_path = Path(current_root) / file
                    if is_blocked_sensitive_path(str(full_path)):
                        continue
                    try:
                        size = full_path.stat().st_size
                        tbl_count = count_sqlite_tables(str(full_path))
                        discovered.append(
                            DatabaseConnectionInfo(
                                id=str(full_path),
                                name=file,
                                dialect="sqlite",
                                path=str(full_path),
                                size_bytes=size,
                                is_workspace_local=True,
                                table_count=tbl_count,
                            )
                        )
                    except (OSError, PermissionError):
                        continue
    except Exception as exc:
        logger.warning("Error scanning workspace for databases: %s", exc)

    # Sort by name
    discovered.sort(key=lambda d: d.name.lower())
    return discovered


def inspect_database_schema(db_path: str) -> DatabaseSchema:
    """Inspects an SQLite database and extracts all tables, views, and column definitions."""
    try:
        p = Path(db_path).resolve()
        clean_path = str(p)
        if is_blocked_sensitive_path(clean_path) or not p.is_file():
            raise ValueError(f"Base de données inaccessible ou introuvable : {db_path}")
    except PermissionError as exc:
        raise PermissionError(f"Accès refusé au fichier de base de données : {exc}") from exc
    except Exception as exc:
        raise ValueError(f"Chemin de base de données invalide : {exc}") from exc

    schema = DatabaseSchema(database_name=p.name, dialect="sqlite")

    conn = None
    try:
        resolved_uri = p.as_uri() + "?mode=ro"
        conn = sqlite3.connect(resolved_uri, uri=True, timeout=5.0)
        cursor = conn.cursor()

        # Query all user tables and views
        cursor.execute("""
            SELECT name, type 
            FROM sqlite_master 
            WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
            ORDER BY type ASC, name ASC
        """)
        entities = cursor.fetchall()

        for name, ent_type in entities:
            is_view = ent_type == "view"

            # Introspect columns via PRAGMA table_info
            try:
                # PRAGMA doesn't accept parameterized table names, but we use strict identifier escaping
                safe_name = name.replace('"', '""')
                cursor.execute(f'PRAGMA table_info("{safe_name}")')  # nosec B608
                cols_raw = cursor.fetchall()
                columns: list[ColumnInfo] = []
                for row in cols_raw:
                    # row: (cid, name, type, notnull, dflt_value, pk)
                    columns.append(
                        ColumnInfo(
                            name=str(row[1]),
                            type=str(row[2]) if row[2] else "ANY",
                            primary_key=bool(row[5]),
                            nullable=not bool(row[3]),
                            default_value=str(row[4]) if row[4] is not None else None,
                        )
                    )
            except Exception as e:
                logger.warning("Failed to get table_info for %s: %s", name, e)
                columns = []

            # Estimate row count
            row_count: int | None = None
            if not is_view:
                try:
                    cursor.execute(f'SELECT count(*) FROM "{safe_name}"')  # nosec B608
                    row_count = cursor.fetchone()[0]
                except Exception:
                    row_count = None

            schema.tables.append(
                TableInfo(
                    name=name,
                    is_view=is_view,
                    columns=columns,
                    row_count_estimate=row_count,
                )
            )
    except Exception as exc:
        raise ValueError(f"Échec de l'inspection de la base : {exc}") from exc
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception as close_err:
                logger.debug("Failed to close SQLite schema connection: %s", close_err)

    return schema


def _serialize_cell(value: Any) -> Any:
    """Serializes bytes or special objects to JSON-friendly primitives."""
    if value is None:
        return None
    if isinstance(value, (bytes, bytearray)):
        try:
            return value.decode("utf-8")
        except UnicodeDecodeError:
            return f"<BLOB {len(value)} bytes: {value[:16].hex()}...>"
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)


def execute_query(db_path: str, query: str, limit: int = 500, timeout_seconds: float = 10.0) -> QueryResult:
    """Executes a SQL query against an SQLite database with timeout and row bounds."""
    clean_path = str(Path(db_path).resolve())
    if is_blocked_sensitive_path(clean_path) or not Path(clean_path).is_file():
        return QueryResult(error=f"Accès refusé ou fichier inexistant: {db_path}")

    if not query or not query.strip():
        return QueryResult(error="Requête SQL vide.")

    limit = max(1, min(limit, 2000))
    start_time = time.perf_counter()

    conn = None
    try:
        conn = sqlite3.connect(str(clean_path), timeout=timeout_seconds)
        cursor = conn.cursor()

        cursor.execute(query)
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)

        # Check if query returns rows (SELECT, PRAGMA, EXPLAIN)
        if cursor.description:
            columns = [desc[0] for desc in cursor.description]
            # Fetch limit + 1 to detect truncation
            raw_rows = cursor.fetchmany(limit + 1)
            truncated = len(raw_rows) > limit
            if truncated:
                raw_rows = raw_rows[:limit]

            serialized_rows = [[_serialize_cell(cell) for cell in row] for row in raw_rows]

            return QueryResult(
                columns=columns,
                rows=serialized_rows,
                total_rows=len(serialized_rows),
                truncated=truncated,
                execution_time_ms=duration_ms,
                error=None,
            )
        else:
            # DDL / DML query (CREATE, UPDATE, DELETE, etc.)
            conn.commit()
            rowcount = cursor.rowcount
            return QueryResult(
                columns=["status", "affected_rows"],
                rows=[["Query executed successfully", max(rowcount, 0)]],
                total_rows=1,
                truncated=False,
                execution_time_ms=duration_ms,
                error=None,
            )
    except Exception as exc:
        duration_ms = round((time.perf_counter() - start_time) * 1000, 2)
        return QueryResult(
            columns=[],
            rows=[],
            total_rows=0,
            truncated=False,
            execution_time_ms=duration_ms,
            error=str(exc),
        )
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception as close_err:
                logger.debug("Failed to close SQLite query connection: %s", close_err)


def export_query_results(db_path: str, query: str, format: str = "csv") -> str:
    """Runs a query and formats results as CSV or JSON string."""
    result = execute_query(db_path, query, limit=5000)
    if result.error:
        raise ValueError(f"Erreur SQL : {result.error}")

    if format == "json":
        records = [dict(zip(result.columns, row)) for row in result.rows]
        return json.dumps(records, ensure_ascii=False, indent=2)

    # Default CSV
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(result.columns)
    for row in result.rows:
        writer.writerow([cell if cell is not None else "" for cell in row])
    return output.getvalue()
