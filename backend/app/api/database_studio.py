"""Database Studio API Router.

REST endpoints for database discovery, schema introspection,
SQL query execution, and data exports.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.platform_utils import is_blocked_sensitive_path
from app.services.database_studio import (
    DatabaseConnectionInfo,
    DatabaseSchema,
    ExportRequest,
    QueryRequest,
    QueryResult,
    discover_databases,
    execute_query,
    export_query_results,
    inspect_database_schema,
)

router = APIRouter(prefix="/api/database", tags=["Database Studio"], dependencies=[Depends(require_auth)])


@router.get("/discover", response_model=list[DatabaseConnectionInfo])
def api_discover_databases(
    workspace: str | None = Query(None, description="Workspace root directory to scan"),
):
    """Scans the active workspace for SQLite database files."""
    ws = workspace or DEFAULT_WORKSPACE
    if is_blocked_sensitive_path(ws):
        raise HTTPException(status_code=403, detail="Accès au répertoire interdit.")
    return discover_databases(ws)


@router.get("/schema", response_model=DatabaseSchema)
def api_get_database_schema(
    db_path: str = Query(..., description="Path to SQLite database file"),
):
    """Introspects schema (tables, views, columns) of a database."""
    if is_blocked_sensitive_path(db_path):
        raise HTTPException(status_code=403, detail="Accès au fichier de base de données interdit.")
    try:
        return inspect_database_schema(db_path)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except (ValueError, FileNotFoundError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'introspection : {e}")


@router.post("/query", response_model=QueryResult)
def api_execute_query(payload: QueryRequest):
    """Executes a SQL query with timeout and row bounds."""
    if is_blocked_sensitive_path(payload.db_path):
        raise HTTPException(status_code=403, detail="Accès au fichier de base de données interdit.")
    return execute_query(payload.db_path, payload.query, limit=payload.limit)


@router.post("/export")
def api_export_query(payload: ExportRequest):
    """Executes query and streams exported CSV or JSON."""
    if is_blocked_sensitive_path(payload.db_path):
        raise HTTPException(status_code=403, detail="Accès au fichier de base de données interdit.")
    try:
        clean_fmt = (payload.format or "csv").strip().lower()
        content = export_query_results(payload.db_path, payload.query, format=clean_fmt)
        media_type = "text/csv" if clean_fmt == "csv" else "application/json"
        filename = f"export_{clean_fmt}.{clean_fmt}"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur d'export : {e}")
