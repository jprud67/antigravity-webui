import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_diagnostics_auth_guard():
    res = client.post("/api/editor/diagnostics", json={"content": "x = 1", "language": "python"})
    assert res.status_code in (401, 403)


def test_python_clean_code():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "def add(a: int, b: int) -> int:\n    return a + b\n",
        "language": "python"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] == 0
    assert isinstance(data["diagnostics"], list)
    assert "duration_ms" in data


def test_python_syntax_error():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "def broken(\n    return 42\n",
        "language": "python"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] >= 1
    diag = data["diagnostics"][0]
    assert diag["severity"] == "error"
    assert diag["source"] == "syntax"
    assert diag["line"] == 1 or diag["line"] == 2


def test_python_ruff_linter():
    headers = get_auth_headers()
    # Unused import should trigger a ruff diagnostic (e.g. F401)
    res = client.post("/api/editor/diagnostics", json={
        "content": "import math\n\ndef calculate():\n    return 42\n",
        "language": "python",
        "filePath": "test_sample.py"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert len(data["diagnostics"]) >= 1
    ruff_diags = [d for d in data["diagnostics"] if d["source"] == "ruff"]
    assert len(ruff_diags) >= 1
    assert any("math" in d["message"].lower() or d.get("code") == "F401" for d in ruff_diags)


def test_json_clean_and_error():
    headers = get_auth_headers()
    # Clean JSON
    res_clean = client.post("/api/editor/diagnostics", json={
        "content": "{\n  \"name\": \"antigravity\",\n  \"active\": true\n}",
        "language": "json"
    }, headers=headers)
    assert res_clean.status_code == 200
    assert res_clean.json()["total_errors"] == 0

    # Broken JSON
    res_broken = client.post("/api/editor/diagnostics", json={
        "content": "{\n  \"name\": \"antigravity\",\n",
        "language": "json"
    }, headers=headers)
    assert res_broken.status_code == 200
    data = res_broken.json()
    assert data["total_errors"] >= 1
    assert data["diagnostics"][0]["source"] == "json"


def test_empty_content_graceful():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "",
        "language": "python"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] == 0
    assert len(data["diagnostics"]) == 0


def test_typescript_clean_code():
    headers = get_auth_headers()
    res = client.post("/api/editor/diagnostics", json={
        "content": "export function greet(name: string): string {\n    return `Hello, ${name}!`;\n}\n",
        "language": "typescript",
        "filePath": "greet.ts"
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_errors"] == 0

