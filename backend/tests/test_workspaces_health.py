import json
import shutil
import subprocess
import tempfile
from pathlib import Path

import pytest

from app.services.project_detector import (
    clear_detector_cache,
    detect_project_details,
    detect_project_health,
)


@pytest.fixture(autouse=True)
def reset_cache():
    clear_detector_cache()
    yield
    clear_detector_cache()


def test_detect_node_project_with_missing_node_modules():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        pkg_data = {
            "name": "sample-node-app",
            "version": "1.0.0",
            "dependencies": {
                "react": "^18.2.0",
                "vite": "^5.0.0"
            },
            "devDependencies": {
                "typescript": "^5.0.0",
                "tailwindcss": "^3.0.0"
            }
        }
        (tmp_path / "package.json").write_text(json.dumps(pkg_data), encoding="utf-8")

        details = detect_project_details(str(tmp_path))
        assert details["name"] == "sample-node-app"
        assert details["path"] == str(tmp_path.resolve())

        runtimes = details["runtimes"]
        node_rt = next((r for r in runtimes if r["type"] == "node"), None)
        assert node_rt is not None
        assert "react" in node_rt["frameworks"]
        assert "vite" in node_rt["frameworks"]
        assert "tailwindcss" in node_rt["frameworks"]
        assert node_rt["package_manager"] == "npm"

        health = details["health"]
        assert health["dependencies_installed"] is False
        assert health["node_modules_present"] is False
        assert any("node_modules" in w.lower() for w in health["warnings"])
        assert health["suggested_action"] is not None
        assert "npm install" in health["suggested_action"]["command"]


def test_detect_python_project_with_missing_venv():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "requirements.txt").write_text(
            "fastapi>=0.100.0\nuvicorn>=0.23.0\npytest>=7.0.0\n",
            encoding="utf-8"
        )

        details = detect_project_details(str(tmp_path))
        runtimes = details["runtimes"]
        py_rt = next((r for r in runtimes if r["type"] == "python"), None)
        assert py_rt is not None
        assert "fastapi" in py_rt["frameworks"]
        assert "uvicorn" in py_rt["frameworks"]

        health = details["health"]
        assert health["dependencies_installed"] is False
        assert health["venv_present"] is False
        assert any("venv" in w.lower() for w in health["warnings"])
        assert health["suggested_action"] is not None


def test_detect_php_project_with_composer():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        composer_data = {
            "name": "acme/sample-laravel",
            "require": {
                "laravel/framework": "^10.0"
            }
        }
        (tmp_path / "composer.json").write_text(json.dumps(composer_data), encoding="utf-8")

        details = detect_project_details(str(tmp_path))
        assert details["name"] == "sample-laravel"

        runtimes = details["runtimes"]
        php_rt = next((r for r in runtimes if r["type"] == "php"), None)
        assert php_rt is not None
        assert "laravel" in php_rt["frameworks"]
        assert php_rt["package_manager"] == "composer"

        health = details["health"]
        assert health["vendor_present"] is False
        assert any("vendor" in w.lower() for w in health["warnings"])


def test_detect_git_repository_telemetry():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        # Initialize Git repo
        try:
            subprocess.run(["git", "init"], cwd=str(tmp_path), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.name", "Test User"], cwd=str(tmp_path), check=True, capture_output=True)
            subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=str(tmp_path), check=True, capture_output=True)
            test_file = tmp_path / "README.md"
            test_file.write_text("# Test Repo\n", encoding="utf-8")
            subprocess.run(["git", "add", "README.md"], cwd=str(tmp_path), check=True, capture_output=True)
            subprocess.run(["git", "commit", "-m", "initial commit"], cwd=str(tmp_path), check=True, capture_output=True)

            details = detect_project_details(str(tmp_path))
            git_info = details["git"]
            assert git_info["is_repo"] is True
            assert git_info["branch"] in ["main", "master"]
            assert git_info["is_dirty"] is False
            assert git_info["last_commit"] is not None
            assert git_info["last_commit"]["subject"] == "initial commit"
        except FileNotFoundError:
            pytest.skip("Git executable not found in PATH")


def test_detector_caching():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "package.json").write_text('{"name": "cache-test"}', encoding="utf-8")

        first = detect_project_details(str(tmp_path))
        assert first["name"] == "cache-test"

        # Overwrite file on disk
        (tmp_path / "package.json").write_text('{"name": "modified-name"}', encoding="utf-8")

        # Second call within TTL should return cached name
        second = detect_project_details(str(tmp_path))
        assert second["name"] == "cache-test"

        # Clearing cache should return new name
        clear_detector_cache()
        third = detect_project_details(str(tmp_path))
        assert third["name"] == "modified-name"


def test_detect_project_health_standalone():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "package.json").write_text('{"name": "health-check"}', encoding="utf-8")
        health = detect_project_health(str(tmp_path))
        assert "status" in health
        assert "warnings" in health
        assert health["dependencies_installed"] is False


from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_api_get_workspaces_details():
    headers = get_auth_headers()
    res = client.get("/api/workspaces/details", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert isinstance(data, list)
    if data:
        first = data[0]
        assert "path" in first
        assert "name" in first
        assert "is_default" in first
        assert "runtimes" in first
        assert "git" in first
        assert "health" in first


def test_api_get_workspaces_health():
    headers = get_auth_headers()
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        (tmp_path / "package.json").write_text('{"name": "api-health-test"}', encoding="utf-8")

        res = client.get(f"/api/workspaces/health?path={str(tmp_path)}", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert "status" in data
        assert "warnings" in data

    # Invalid path
    res = client.get("/api/workspaces/health?path=C:\\non_existent_folder_xyz_12345", headers=headers)
    assert res.status_code in [400, 404]


def test_api_set_default_workspace():
    headers = get_auth_headers()
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        res = client.post(f"/api/workspaces/default?path={str(tmp_path)}", headers=headers)
        assert res.status_code == 200
        data = res.json()
        assert data.get("status") == "ok"
        assert "default_workspace" in data

