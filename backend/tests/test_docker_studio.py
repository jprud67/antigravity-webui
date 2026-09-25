"""Unit tests for Docker & Container Studio service and API."""

from pathlib import Path
from fastapi.testclient import TestClient

from app.main import app
from app.services.docker_studio import (
    get_docker_status,
    scan_workspace_docker_files,
    list_containers,
)

client = TestClient(app)


def test_get_docker_status():
    status = get_docker_status()
    assert hasattr(status, "is_available")
    assert hasattr(status, "engine")
    assert status.engine in ("docker", "podman", "none")


def test_scan_workspace_docker_files(tmp_path: Path):
    # 1. Create sample Dockerfile
    dockerfile = tmp_path / "Dockerfile"
    dockerfile.write_text("FROM python:3.13-slim\nWORKDIR /app\n", encoding="utf-8")

    # 2. Create sample .dockerignore
    dockerignore = tmp_path / ".dockerignore"
    dockerignore.write_text("node_modules\n.git\n", encoding="utf-8")

    # 3. Create sample docker-compose.yml
    compose = tmp_path / "docker-compose.yml"
    compose_content = """
version: '3.8'
services:
  web:
    image: nginx:alpine
    ports:
      - "8080:80"
    environment:
      - NODE_ENV=production
    volumes:
      - ./html:/usr/share/nginx/html
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: testdb
"""
    compose.write_text(compose_content, encoding="utf-8")

    items = scan_workspace_docker_files(str(tmp_path))
    assert len(items) == 3

    kinds = {item.kind for item in items}
    assert "dockerfile" in kinds
    assert "dockerignore" in kinds
    assert "compose" in kinds

    compose_item = next(it for it in items if it.kind == "compose")
    assert compose_item.services is not None
    assert len(compose_item.services) == 2
    service_names = {s.name for s in compose_item.services}
    assert "web" in service_names
    assert "db" in service_names

    web_svc = next(s for s in compose_item.services if s.name == "web")
    assert web_svc.image == "nginx:alpine"
    assert "8080:80" in web_svc.ports


def test_docker_api_status_and_workspace(tmp_path: Path):
    # Status endpoint
    res = client.get("/api/docker/status")
    assert res.status_code == 200
    data = res.json()
    assert "isAvailable" in data
    assert "engine" in data

    # Workspace scan endpoint
    dockerfile = tmp_path / "Dockerfile.prod"
    dockerfile.write_text("FROM node:20-alpine\n", encoding="utf-8")

    res_ws = client.get(f"/api/docker/workspace?workspace={tmp_path}")
    assert res_ws.status_code == 200
    items = res_ws.json()
    assert len(items) >= 1
    assert any(it["filename"] == "Dockerfile.prod" for it in items)

    # Containers endpoint
    res_ct = client.get("/api/docker/containers")
    assert res_ct.status_code == 200
    assert isinstance(res_ct.json(), list)


def test_invalid_container_id_validation():
    # Attempt command injection in container id
    res = client.get("/api/docker/containers/id_with_space%20bad")
    assert res.status_code == 400

    res_action = client.post("/api/docker/containers/id;rm%20-rf/action", json={"action": "start"})
    assert res_action.status_code == 400
