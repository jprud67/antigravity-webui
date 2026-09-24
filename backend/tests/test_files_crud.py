import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}

def test_unauthenticated_crud():
    res = client.post("/api/files/create", json={"path": "test.txt", "content": "hello"})
    assert res.status_code in (401, 403)
    res = client.post("/api/files/create-dir", json={"path": "testdir"})
    assert res.status_code in (401, 403)
    res = client.post("/api/files/rename", json={"old_path": "a", "new_path": "b"})
    assert res.status_code in (401, 403)
    res = client.post("/api/files/delete", json={"path": "test.txt"})
    assert res.status_code in (401, 403)

import uuid

def test_create_read_rename_delete_cycle(tmp_path):
    headers = get_auth_headers()
    # 1. Create a directory
    uid = uuid.uuid4().hex[:8]
    dir_target = f"test_crud_{uid}"
    create_dir_res = client.post(
        "/api/files/create-dir",
        json={"path": dir_target},
        headers=headers
    )
    assert create_dir_res.status_code == 200
    assert create_dir_res.json()["success"] is True

    # 2. Create a file inside that directory
    file_target = f"{dir_target}/sample_test.py"
    create_file_res = client.post(
        "/api/files/create",
        json={"path": file_target, "content": "# sample code\nprint('hello from crud test')\n"},
        headers=headers
    )
    assert create_file_res.status_code == 200
    assert create_file_res.json()["success"] is True
    assert create_file_res.json()["filename"] == "sample_test.py"

    # 3. Conflict on duplicate create
    conflict_res = client.post(
        "/api/files/create",
        json={"path": file_target, "content": "duplicate"},
        headers=headers
    )
    assert conflict_res.status_code == 409

    # 4. Read file content
    read_res = client.get(f"/api/files/content?path={file_target}", headers=headers)
    assert read_res.status_code == 200
    assert "hello from crud test" in read_res.json()["content"]

    # 5. Search file by name and content
    search_name_res = client.get(f"/api/files/search?q=sample_test&path={dir_target}", headers=headers)
    assert search_name_res.status_code == 200
    assert any("sample_test" in r["name"] for r in search_name_res.json()["results"])

    search_content_res = client.get(f"/api/files/search?q=crud test&path={dir_target}", headers=headers)
    assert search_content_res.status_code == 200
    assert any("sample_test" in r["name"] for r in search_content_res.json()["results"])

    # 6. Rename file
    renamed_target = f"{dir_target}/renamed_sample.py"
    rename_res = client.post(
        "/api/files/rename",
        json={"old_path": file_target, "new_path": renamed_target},
        headers=headers
    )
    assert rename_res.status_code == 200
    assert rename_res.json()["name"] == "renamed_sample.py"

    # 7. Delete file
    del_file_res = client.post(
        "/api/files/delete",
        json={"path": renamed_target},
        headers=headers
    )
    assert del_file_res.status_code == 200
    assert del_file_res.json()["success"] is True

    # 8. Delete directory
    del_dir_res = client.post(
        "/api/files/delete",
        json={"path": dir_target},
        headers=headers
    )
    assert del_dir_res.status_code == 200
    assert del_dir_res.json()["was_dir"] is True

def test_delete_root_is_forbidden():
    headers = get_auth_headers()
    res = client.post("/api/files/delete", json={"path": "."}, headers=headers)
    assert res.status_code in (400, 403)
