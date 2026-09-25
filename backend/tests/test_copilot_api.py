from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.auth import require_auth
from app.main import app

client = TestClient(app)

@pytest.fixture(autouse=True)
def override_auth():
    app.dependency_overrides[require_auth] = lambda: True
    yield
    app.dependency_overrides.pop(require_auth, None)


def test_copilot_status():
    res = client.get("/api/copilot/status")
    assert res.status_code == 200
    data = res.json()
    assert "available" in data
    assert "default_model" in data
    assert "cached_items" in data
    assert isinstance(data["cached_items"], int)


@patch("app.api.copilot._generate_llm_completion")
def test_inline_suggest_success(mock_llm):
    mock_llm.return_value = "def add(a: int, b: int) -> int:\n    return a + b"

    payload = {
        "prefix": "def add(",
        "suffix": "\nprint(add(1, 2))",
        "language": "python",
        "file_path": "math_utils.py",
        "max_tokens": 60,
        "temperature": 0.2
    }
    res = client.post("/api/copilot/inline-suggest", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["suggestion"] == "def add(a: int, b: int) -> int:\n    return a + b"
    assert data["cached"] is False
    assert data["latency_ms"] >= 0


@patch("app.api.copilot._generate_llm_completion")
def test_inline_suggest_cleans_markdown(mock_llm):
    # LLM returned code wrapped in markdown fences
    mock_llm.return_value = "```python\n    return x * 2\n```"

    payload = {
        "prefix": "def double(x):\n",
        "suffix": "",
        "language": "python",
        "file_path": "calc.py"
    }
    res = client.post("/api/copilot/inline-suggest", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert "```" not in data["suggestion"]
    assert "return x * 2" in data["suggestion"]


@patch("app.api.copilot._generate_llm_completion")
def test_inline_suggest_lru_cache(mock_llm):
    mock_llm.return_value = "const PORT = 8080;"

    payload = {
        "prefix": "const PORT = ",
        "suffix": "\napp.listen(PORT);",
        "language": "typescript",
        "file_path": "server.ts"
    }
    # 1st call: Cache Miss
    res1 = client.post("/api/copilot/inline-suggest", json=payload)
    assert res1.status_code == 200
    assert res1.json()["cached"] is False
    assert mock_llm.call_count == 1

    # 2nd call with identical parameters: Cache Hit!
    res2 = client.post("/api/copilot/inline-suggest", json=payload)
    assert res2.status_code == 200
    assert res2.json()["cached"] is True
    assert res2.json()["suggestion"] == "const PORT = 8080;"
    # LLM should not be called again
    assert mock_llm.call_count == 1


def test_inline_suggest_empty_prefix():
    payload = {
        "prefix": "   ",
        "suffix": "",
        "language": "python"
    }
    res = client.post("/api/copilot/inline-suggest", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["suggestion"] == ""


@patch("app.api.copilot._generate_llm_action")
def test_copilot_action_refactor(mock_action):
    mock_action.return_value = {
        "result_code": "const total = items.reduce((acc, i) => acc + i.price, 0);",
        "explanation": "Remplacement de la boucle for par reduce() plus idiomatique."
    }

    payload = {
        "action": "refactor",
        "code": "let total = 0;\nfor (let i = 0; i < items.length; i++) {\n  total += items[i].price;\n}",
        "language": "typescript",
        "file_path": "cart.ts"
    }
    res = client.post("/api/copilot/action", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "refactor"
    assert "reduce" in data["result_code"]
    assert "idiomatique" in data["explanation"]


@patch("app.api.copilot._generate_llm_action")
def test_copilot_action_types(mock_action):
    mock_action.return_value = {
        "result_code": "interface User {\n  id: string;\n  name: string;\n  email: string;\n}",
        "explanation": "Génération de l'interface TypeScript pour l'objet User."
    }

    payload = {
        "action": "types",
        "code": "const user = { id: '123', name: 'Alice', email: 'alice@example.com' };",
        "language": "typescript"
    }
    res = client.post("/api/copilot/action", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "types"
    assert "interface User" in data["result_code"]


@patch("app.api.copilot._generate_llm_action")
def test_copilot_action_docstring(mock_action):
    mock_action.return_value = {
        "result_code": "def fetch_user(user_id: str) -> dict:\n    \"\"\"Récupère les informations d'un utilisateur par son ID.\n\n    Args:\n        user_id (str): L'identifiant unique de l'utilisateur.\n\n    Returns:\n        dict: Le dictionnaire contenant le profil.\n    \"\"\"\n    pass",
        "explanation": "Docstring Google Style ajoutée."
    }

    payload = {
        "action": "docstring",
        "code": "def fetch_user(user_id: str) -> dict:\n    pass",
        "language": "python"
    }
    res = client.post("/api/copilot/action", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "docstring"
    assert "Args:" in data["result_code"]


@patch("app.api.copilot._generate_llm_action")
def test_copilot_action_tests(mock_action):
    mock_action.return_value = {
        "result_code": "def test_sum():\n    assert sum([1, 2]) == 3",
        "explanation": "Génération de test unitaire pytest."
    }

    payload = {
        "action": "tests",
        "code": "def sum(arr):\n    return sum(arr)",
        "language": "python"
    }
    res = client.post("/api/copilot/action", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["action"] == "tests"
    assert "test_sum" in data["result_code"]


def test_copilot_action_invalid():
    payload = {
        "action": "unsupported_action",
        "code": "test()",
        "language": "python"
    }
    res = client.post("/api/copilot/action", json=payload)
    assert res.status_code == 400
    assert "Invalide" in res.json()["detail"] or "action" in res.json()["detail"].lower()
