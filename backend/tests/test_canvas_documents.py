"""Unit tests for Canvas Documents Service and API."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.canvas_documents import (
    CanvasDocumentCreateInput,
    CanvasDocumentEntrypoint,
    create_canvas_document,
    delete_canvas_document,
    get_canvas_document,
    list_canvas_documents,
    normalize_canvas_document_id,
    normalize_logical_path,
    resolve_canvas_file_path,
    wrap_canvas_html,
)

client = TestClient(app)


def test_normalize_canvas_document_id():
    assert normalize_canvas_document_id("cv_12345") == "cv_12345"
    assert normalize_canvas_document_id("my-chart-v1") == "my-chart-v1"

    with pytest.raises(ValueError):
        normalize_canvas_document_id("../escape")

    with pytest.raises(ValueError):
        normalize_canvas_document_id("foo/bar")

    with pytest.raises(ValueError):
        normalize_canvas_document_id("")


def test_normalize_logical_path():
    assert normalize_logical_path("assets/style.css") == "assets/style.css"
    assert normalize_logical_path("\\assets\\script.js") == "assets/script.js"

    with pytest.raises(ValueError):
        normalize_logical_path("../secret.txt")

    with pytest.raises(ValueError):
        normalize_logical_path("foo/../bar")


def test_wrap_canvas_html():
    raw = "<h1>Interactive Dashboard</h1>"
    wrapped = wrap_canvas_html(raw, "Test Widget")
    assert "<!doctype html>" in wrapped
    assert "Test Widget" in wrapped
    assert "--surface" in wrapped
    assert "canvas:theme" in wrapped
    assert "canvas:resize" in wrapped
    assert "Interactive Dashboard" in wrapped


def test_create_and_delete_canvas_document(tmp_path):
    input_data = CanvasDocumentCreateInput(
        kind="html_bundle",
        title="Test Document",
        entrypoint=CanvasDocumentEntrypoint(
            type="html",
            value="<div id='app'>Hello World</div>"
        ),
        retention_scope="test_scope",
    )

    manifest = create_canvas_document(input_data)
    assert manifest.id.startswith("cv_")
    assert manifest.title == "Test Document"
    assert manifest.kind == "html_bundle"
    assert manifest.local_entrypoint == "index.html"
    assert f"/api/canvas/documents/{manifest.id}/serve/index.html" in manifest.entry_url

    # Check retrieval
    retrieved = get_canvas_document(manifest.id)
    assert retrieved is not None
    assert retrieved.id == manifest.id

    # Check listing
    docs = list_canvas_documents(retention_scope="test_scope")
    assert any(d.id == manifest.id for d in docs)

    # Check resolve file path
    file_path = resolve_canvas_file_path(manifest.id, "index.html")
    assert file_path is not None
    assert file_path.exists()
    content = file_path.read_text(encoding="utf-8")
    assert "Hello World" in content

    # Check delete
    assert delete_canvas_document(manifest.id) is True
    assert get_canvas_document(manifest.id) is None


def test_canvas_api_endpoints(auth_headers):
    # Test unauthenticated access rejected
    assert client.get("/api/canvas/documents").status_code == 401

    # 1. Create document via API
    payload = {
        "kind": "html_bundle",
        "title": "API Chart",
        "preferredHeight": 400,
        "entrypoint": {
            "type": "html",
            "value": "<div class='chart'>Bar Chart</div>"
        },
        "retentionScope": "api_test"
    }
    create_res = client.post("/api/canvas/documents", json=payload, headers=auth_headers)
    assert create_res.status_code == 200
    manifest = create_res.json()
    doc_id = manifest["id"]
    assert doc_id.startswith("cv_")
    assert manifest["title"] == "API Chart"
    assert manifest["preferredHeight"] == 400

    # 2. Get document manifest
    get_res = client.get(f"/api/canvas/documents/{doc_id}", headers=auth_headers)
    assert get_res.status_code == 200
    assert get_res.json()["id"] == doc_id

    # 3. Serve entrypoint and verify CSP headers
    serve_res = client.get(f"/api/canvas/documents/{doc_id}/serve", headers=auth_headers)
    assert serve_res.status_code == 200
    assert "Content-Security-Policy" in serve_res.headers
    assert "sandbox allow-scripts" in serve_res.headers["Content-Security-Policy"]
    assert "Bar Chart" in serve_res.text

    # 4. Preview endpoint
    preview_res = client.post("/api/canvas/preview", json={
        "html": "<p>Instant preview snippet</p>",
        "title": "Quick Preview"
    }, headers=auth_headers)
    assert preview_res.status_code == 200
    assert "Instant preview snippet" in preview_res.text
    assert "Content-Security-Policy" in preview_res.headers

    # 5. List documents
    list_res = client.get("/api/canvas/documents?scope=api_test", headers=auth_headers)
    assert list_res.status_code == 200
    assert any(d["id"] == doc_id for d in list_res.json())

    # 6. Delete document
    del_res = client.delete(f"/api/canvas/documents/{doc_id}", headers=auth_headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "ok"

    # Confirm 404 after deletion
    assert client.get(f"/api/canvas/documents/{doc_id}", headers=auth_headers).status_code == 404
