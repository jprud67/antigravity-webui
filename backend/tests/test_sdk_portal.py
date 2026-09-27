"""Tests for SDK Portal API — Antigravity WebUI v0.5.0"""
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_sdk_overview():
    r = client.get("/api/sdk")
    assert r.status_code == 200
    data = r.json()
    assert data["version"] == "0.5.0"
    assert "spec" in data["endpoints"]


def test_sdk_spec():
    r = client.get("/api/sdk/spec")
    assert r.status_code == 200
    data = r.json()
    assert data["info"]["version"] == "0.5.0"
    assert len(data["methods"]) >= 3
    method_names = [m["name"] for m in data["methods"]]
    assert "antigravity.plugins.registerCommand" in method_names
    assert "antigravity.plugins.registerTool" in method_names


def test_sdk_examples():
    r = client.get("/api/sdk/examples")
    assert r.status_code == 200
    data = r.json()
    assert "typescript" in data["examples"]
    assert "python" in data["examples"]


def test_sdk_example_by_lang():
    r = client.get("/api/sdk/examples/typescript")
    assert r.status_code == 200
    assert "code" in r.json()


def test_sdk_example_not_found():
    r = client.get("/api/sdk/examples/cobol")
    assert r.status_code == 404


def test_sdk_guides():
    r = client.get("/api/sdk/guides")
    assert r.status_code == 200
    guides = r.json()["guides"]
    assert len(guides) >= 3
    ids = [g["id"] for g in guides]
    assert "getting-started" in ids
    assert "plugin-lifecycle" in ids


def test_sdk_guide_detail():
    r = client.get("/api/sdk/guides/getting-started")
    assert r.status_code == 200
    data = r.json()
    assert "content" in data
    assert "Antigravity Plugin SDK" in data["content"]


def test_sdk_guide_not_found():
    r = client.get("/api/sdk/guides/nonexistent")
    assert r.status_code == 404


def test_sdk_manifest_schema():
    r = client.get("/api/sdk/manifest-schema")
    assert r.status_code == 200
    schema = r.json()
    assert "properties" in schema
    assert "slug" in schema["properties"]


def test_plugins_api():
    """Basic plugin CRUD via REST."""
    # Register
    r = client.post("/api/plugins", json={
        "slug": "rest-test-plugin",
        "name": "REST Test Plugin",
        "version": "1.0.0",
        "scopes": ["register_command"],
    })
    assert r.status_code == 200
    data = r.json()
    assert data["slug"] == "rest-test-plugin"

    # List
    r = client.get("/api/plugins")
    assert r.status_code == 200
    slugs = [p["slug"] for p in r.json()["plugins"]]
    assert "rest-test-plugin" in slugs

    # Get by slug
    r = client.get("/api/plugins/rest-test-plugin")
    assert r.status_code == 200

    # Invoke
    r = client.post("/api/plugins/rest-test-plugin/invoke", json={"method": "registerCommand"})
    assert r.status_code == 200
    assert r.json()["status"] == "ok"

    # Disable
    r = client.delete("/api/plugins/rest-test-plugin")
    assert r.status_code == 200
    assert r.json()["status"] == "disabled"


def test_watchdog_status():
    r = client.get("/api/watchdog/status")
    assert r.status_code == 200
    assert "running" in r.json()


def test_watchdog_alerts_empty():
    client.delete("/api/watchdog/alerts")
    r = client.get("/api/watchdog/alerts")
    assert r.status_code == 200


def test_sweeps_run_changelog():
    import tempfile, os
    with tempfile.TemporaryDirectory() as tmp:
        r = client.post("/api/sweeps/run", json={
            "workspace_path": tmp,
            "sweep_type": "changelog",
        })
        assert r.status_code == 200
        data = r.json()
        assert data.get("skipped") is True  # No git repo in tmp

def test_sweeps_history():
    r = client.get("/api/sweeps/history")
    assert r.status_code == 200
    assert "history" in r.json()
