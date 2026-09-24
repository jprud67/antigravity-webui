import io
import uuid
import pytest
from pathlib import Path
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}

def test_unauthenticated_upload_duplicate():
    res = client.post("/api/files/upload", data={"destination_dir": "test"})
    assert res.status_code in (401, 403)
    res = client.post("/api/files/duplicate", json={"path": "test.txt"})
    assert res.status_code in (401, 403)

def test_upload_file_success_and_sanitize():
    headers = get_auth_headers()
    uid = uuid.uuid4().hex[:8]
    test_dir = f"test_upload_{uid}"

    # 1. Create a container folder
    create_dir = client.post("/api/files/create-dir", json={"path": test_dir}, headers=headers)
    assert create_dir.status_code == 200

    try:
        # 2. Upload a simple text file
        file_bytes = b"Hello Antigravity File Upload!"
        file_payload = {
            "file": ("uploaded_note.txt", io.BytesIO(file_bytes), "text/plain")
        }
        data_payload = {
            "destination_dir": test_dir
        }
        upload_res = client.post(
            "/api/files/upload",
            files=file_payload,
            data=data_payload,
            headers=headers
        )
        assert upload_res.status_code == 200
        res_json = upload_res.json()
        assert res_json["success"] is True
        assert res_json["filename"] == "uploaded_note.txt"
        assert res_json["size"] == len(file_bytes)

        # 3. Read uploaded file content
        uploaded_path = res_json["path"]
        read_res = client.get(f"/api/files/content?path={uploaded_path}", headers=headers)
        assert read_res.status_code == 200
        assert "Hello Antigravity File Upload!" in read_res.json()["content"]

        # 4. Traversal attempt in filename should be sanitized to basename
        bad_payload = {
            "file": ("../../evil.txt", io.BytesIO(b"evil"), "text/plain")
        }
        bad_upload = client.post(
            "/api/files/upload",
            files=bad_payload,
            data=data_payload,
            headers=headers
        )
        assert bad_upload.status_code == 200
        assert bad_upload.json()["filename"] == "evil.txt"
        assert test_dir in bad_upload.json()["path"]

    finally:
        # Clean up
        client.post("/api/files/delete", json={"path": test_dir}, headers=headers)

def test_duplicate_file_cycle():
    headers = get_auth_headers()
    uid = uuid.uuid4().hex[:8]
    test_dir = f"test_dup_{uid}"

    # 1. Create directory and initial file
    client.post("/api/files/create-dir", json={"path": test_dir}, headers=headers)
    base_file = f"{test_dir}/script.py"
    client.post("/api/files/create", json={"path": base_file, "content": "print('original')\n"}, headers=headers)

    try:
        # 2. Duplicate file -> should produce script_copy.py
        dup_res = client.post("/api/files/duplicate", json={"path": base_file}, headers=headers)
        assert dup_res.status_code == 200
        dup_json = dup_res.json()
        assert dup_json["success"] is True
        assert "script_copy.py" in dup_json["new_name"]

        # Verify content
        read_dup = client.get(f"/api/files/content?path={dup_json['new_path']}", headers=headers)
        assert read_dup.status_code == 200
        assert "print('original')" in read_dup.json()["content"]

        # 3. Duplicate again -> should produce script_copy_1.py
        dup_res2 = client.post("/api/files/duplicate", json={"path": base_file}, headers=headers)
        assert dup_res2.status_code == 200
        assert "script_copy_1.py" in dup_res2.json()["new_name"]

    finally:
        # Clean up
        client.post("/api/files/delete", json={"path": test_dir}, headers=headers)
