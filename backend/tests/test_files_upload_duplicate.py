import io
import uuid

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


def test_upload_fallback_and_relative_path():
    headers = get_auth_headers()
    uid = uuid.uuid4().hex[:8]
    test_dir = f"test_up_rel_{uid}"
    client.post("/api/files/create-dir", json={"path": test_dir}, headers=headers)

    try:
        # Test upload with relative_path creating subdirectories
        file_payload = {
            "file": ("nested.txt", io.BytesIO(b"nested data"), "text/plain")
        }
        res = client.post(
            "/api/files/upload",
            files=file_payload,
            data={"destination_dir": test_dir, "relative_path": "sub/deep/nested.txt"},
            headers=headers
        )
        assert res.status_code == 200
        assert res.json()["success"] is True

        # Test upload with empty destination_dir defaults cleanly to workspace
        empty_dest_res = client.post(
            "/api/files/upload",
            files={"file": (f"empty_dest_{uid}.txt", io.BytesIO(b"root upload"), "text/plain")},
            data={"destination_dir": ""},
            headers=headers
        )
        assert empty_dest_res.status_code == 200
        assert empty_dest_res.json()["success"] is True
        client.post("/api/files/delete", json={"path": empty_dest_res.json()["path"]}, headers=headers)
    finally:
        client.post("/api/files/delete", json={"path": test_dir}, headers=headers)


def test_duplicate_and_download_folder():
    headers = get_auth_headers()
    uid = uuid.uuid4().hex[:8]
    test_dir = f"test_dir_zip_{uid}"
    client.post("/api/files/create-dir", json={"path": test_dir}, headers=headers)
    client.post("/api/files/create", json={"path": f"{test_dir}/hello.txt", "content": "hi"}, headers=headers)

    try:
        # 1. Test folder download as ZIP
        dl_res = client.get(f"/api/files/download?path={test_dir}", headers=headers)
        assert dl_res.status_code == 200
        assert dl_res.headers.get("content-type") == "application/zip"
        assert dl_res.content[:4] == b"PK\x03\x04"  # ZIP magic bytes

        # 2. Test folder duplication
        dup_res = client.post("/api/files/duplicate", json={"path": test_dir}, headers=headers)
        assert dup_res.status_code == 200
        dup_json = dup_res.json()
        assert dup_json["success"] is True
        assert dup_json["is_dir"] is True
        assert f"{test_dir}_copy" in dup_json["new_name"]
        client.post("/api/files/delete", json={"path": dup_json["new_path"]}, headers=headers)
    finally:
        client.post("/api/files/delete", json={"path": test_dir}, headers=headers)


def test_upload_file_manager_settings_validation():
    from app.services.storage import get_settings, save_settings

    headers = get_auth_headers()
    uid = uuid.uuid4().hex[:8]
    test_dir = f"test_settings_val_{uid}"
    client.post("/api/files/create-dir", json={"path": test_dir}, headers=headers)

    original_settings = get_settings()
    try:
        # 1. Test Blocked Extension
        save_settings({"fileManagerBlockedExtensions": ".exe,.sh,.bat"})
        bad_ext_res = client.post(
            "/api/files/upload",
            files={"file": ("malicious.exe", io.BytesIO(b"binary"), "application/octet-stream")},
            data={"destination_dir": test_dir},
            headers=headers
        )
        assert bad_ext_res.status_code == 400
        assert "interdite" in bad_ext_res.json()["detail"]

        # 2. Test Allowed Extension whitelist
        save_settings({
            "fileManagerBlockedExtensions": "",
            "fileManagerAllowedExtensions": ".png,.jpg,.jpeg"
        })
        disallowed_res = client.post(
            "/api/files/upload",
            files={"file": ("code.py", io.BytesIO(b"print(1)"), "text/plain")},
            data={"destination_dir": test_dir},
            headers=headers
        )
        assert disallowed_res.status_code == 400
        assert "non autorisée" in disallowed_res.json()["detail"]

        allowed_res = client.post(
            "/api/files/upload",
            files={"file": ("avatar.png", io.BytesIO(b"\x89PNG\r\n\x1a\n"), "image/png")},
            data={"destination_dir": test_dir},
            headers=headers
        )
        assert allowed_res.status_code == 200
        assert allowed_res.json()["success"] is True

        # 3. Test Max File Size in MB (set to 1 MB and send 2 MB)
        save_settings({
            "fileManagerAllowedExtensions": "",
            "fileManagerBlockedExtensions": "",
            "fileManagerMaxUploadSizeMB": 1
        })
        large_payload = b"0" * (1024 * 1024 + 100)
        too_large_res = client.post(
            "/api/files/upload",
            files={"file": ("too_large.bin", io.BytesIO(large_payload), "application/octet-stream")},
            data={"destination_dir": test_dir},
            headers=headers
        )
        assert too_large_res.status_code == 413
        assert "trop volumineux" in too_large_res.json()["detail"]
    finally:
        save_settings(original_settings)
        client.post("/api/files/delete", json={"path": test_dir}, headers=headers)


