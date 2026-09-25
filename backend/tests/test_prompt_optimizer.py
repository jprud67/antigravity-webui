from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)

def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}

def test_analyze_unauthenticated():
    res = client.post("/api/prompt/analyze", json={"prompt": "test"})
    assert res.status_code in (401, 403)

def test_analyze_empty_prompt():
    headers = get_auth_headers()
    res = client.post("/api/prompt/analyze", json={"prompt": ""}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["word_count"] == 0
    assert data["clarity_score"] == 0
    assert len(data["suggestions"]) > 0

def test_analyze_rich_prompt():
    headers = get_auth_headers()
    prompt = "Dans `backend/app/main.py`, corrige l'erreur 500 sur /api/login sans casser les tests existants. Retourne un diff unifié."
    res = client.post("/api/prompt/analyze", json={"prompt": prompt}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["clarity_score"] >= 60
    assert "backend/app/main.py" in data["detected_elements"]["files"]
    assert data["detected_elements"]["has_constraints"] is True
    assert data["breakdown"]["context"] > 0
    assert data["breakdown"]["objective"] > 0
    assert data["breakdown"]["constraints"] > 0
    assert data["breakdown"]["output_format"] > 0

def test_optimize_debug_preset():
    headers = get_auth_headers()
    prompt = "bug sur la route login dans backend/app/api/auth.py"
    res = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "debug"}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "Objectif" in data["optimized"]
    assert "debug" in data["preset"]
    assert data["tokens_optimized"] > data["tokens_original"]
    assert "backend/app/api/auth.py" in data["optimized"]

def test_optimize_plan_preset():
    headers = get_auth_headers()
    prompt = "créer un système d'authentification OAuth pour Google"
    res = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "plan"}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert ("Plan" in data["optimized"] or "Instructions par étapes" in data["optimized"])
    assert "plan" in data["preset"]

def test_optimize_refactor_preset():
    headers = get_auth_headers()
    prompt = "simplifier le composant ChatInput.tsx"
    res = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "refactor"}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "ChatInput.tsx" in data["optimized"]
    assert "refactor" in data["preset"]

def test_optimize_review_preset():
    headers = get_auth_headers()
    prompt = "revoir la sécurité de terminal.py"
    res = client.post("/api/prompt/optimize", json={"prompt": prompt, "preset": "review"}, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert "Sécurité" in data["optimized"] or "Revue" in data["optimized"]
    assert "review" in data["preset"]
