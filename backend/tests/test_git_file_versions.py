from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def test_git_file_versions_unauthenticated():
    response = client.get("/api/git/file-versions?path=backend/app/main.py")
    assert response.status_code in (401, 403)

def test_git_file_versions_authenticated():
    # Login to obtain auth token
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    res = client.get("/api/git/file-versions?path=backend/app/main.py", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "original" in data
    assert "modified" in data
    assert data["path"] == "backend/app/main.py"
    assert data["filename"] == "main.py"
    assert isinstance(data["original"], str)
    assert isinstance(data["modified"], str)
