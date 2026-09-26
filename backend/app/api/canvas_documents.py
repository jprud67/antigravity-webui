"""Canvas Documents API router.

Exposes REST endpoints to create, list, inspect, delete, and securely serve
sandboxed Canvas documents with CSP headers.
"""

from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from app.api.auth import require_auth
from app.config import DEFAULT_WORKSPACE
from app.services.canvas_documents import (
    CanvasDocumentCreateInput,
    CanvasDocumentKind,
    CanvasDocumentManifest,
    create_canvas_document,
    delete_canvas_document,
    get_canvas_document,
    list_canvas_documents,
    resolve_canvas_file_path,
    wrap_canvas_html,
)

router = APIRouter(prefix="/api/canvas", tags=["Canvas Documents"])

# Standard CSP header for sandboxed interactive widgets (excluding allow-same-origin to prevent sandbox escape)
CANVAS_CSP_HEADER = "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' https:; sandbox allow-scripts allow-forms;"


class PreviewRequest(BaseModel):
    html: str
    title: str | None = "Live Preview"
    wrap_with_theme: bool = True


@router.post("/documents", response_model=CanvasDocumentManifest)
def create_document(payload: CanvasDocumentCreateInput, _ = Depends(require_auth)):
    """Creates a new Canvas document."""
    try:
        ws = payload.workspace or DEFAULT_WORKSPACE
        manifest = create_canvas_document(payload, workspace_dir=ws)
        return manifest
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create canvas document: {e}")


@router.get("/documents", response_model=list[CanvasDocumentManifest])
def list_documents(
    scope: str | None = Query(None, description="Filter by retention scope"),
    kind: CanvasDocumentKind | None = Query(None, description="Filter by kind"),
    limit: int = Query(50, ge=1, le=200, description="Max documents to return"),
    _ = Depends(require_auth),
):
    """Lists saved Canvas documents."""
    return list_canvas_documents(retention_scope=scope, kind=kind, limit=limit)


@router.get("/documents/{doc_id}", response_model=CanvasDocumentManifest)
def get_document(doc_id: str, _ = Depends(require_auth)):
    """Retrieves a single Canvas document manifest."""
    manifest = get_canvas_document(doc_id)
    if not manifest:
        raise HTTPException(status_code=404, detail=f"Canvas document not found: {doc_id}")
    return manifest


@router.delete("/documents/{doc_id}")
def delete_document(doc_id: str, _ = Depends(require_auth)):
    """Deletes a Canvas document and all its assets."""
    success = delete_canvas_document(doc_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Canvas document not found or could not be deleted: {doc_id}")
    return {"status": "ok", "deleted": doc_id}


@router.get("/documents/{doc_id}/serve")
def serve_document_entrypoint(doc_id: str):
    """
    Serves the default entrypoint of a Canvas document with
    sandbox Content-Security-Policy headers.
    """
    manifest = get_canvas_document(doc_id)
    if not manifest:
        raise HTTPException(status_code=404, detail="Document not found")

    file_path = resolve_canvas_file_path(doc_id, manifest.local_entrypoint or "index.html")
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Document entrypoint not found on disk")

    content_type, _ = mimetypes.guess_type(str(file_path))
    content_type = content_type or "text/html; charset=utf-8"

    response = FileResponse(file_path, media_type=content_type)
    response.headers["Content-Security-Policy"] = CANVAS_CSP_HEADER
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


@router.get("/documents/{doc_id}/serve/{filename:path}")
def serve_document_asset(doc_id: str, filename: str):
    """
    Serves an asset from within a Canvas document directory with
    proper content-type and security isolation headers.
    """
    file_path = resolve_canvas_file_path(doc_id, filename)
    if not file_path or not file_path.exists():
        raise HTTPException(status_code=404, detail="Asset not found")

    content_type, _ = mimetypes.guess_type(str(file_path))
    content_type = content_type or "application/octet-stream"

    response = FileResponse(file_path, media_type=content_type)
    response.headers["Content-Security-Policy"] = CANVAS_CSP_HEADER
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    return response


@router.post("/preview")
def preview_canvas_html(payload: PreviewRequest, _ = Depends(require_auth)):
    """
    Returns an instant wrapped HTML preview for rendering in an iframe srcDoc.
    """
    wrapped = wrap_canvas_html(payload.html, payload.title) if payload.wrap_with_theme else payload.html
    return HTMLResponse(content=wrapped, headers={
        "Content-Security-Policy": CANVAS_CSP_HEADER,
        "X-Frame-Options": "SAMEORIGIN",
    })
