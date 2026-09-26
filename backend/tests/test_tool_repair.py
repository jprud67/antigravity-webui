from fastapi.testclient import TestClient

from app.main import app
from app.services.tool_repair import ToolRepairEngine, repair_malformed_json

client = TestClient(app)


def test_repair_malformed_json():
    # 1. Trailing comma
    raw1 = '{"name": "test", "arguments": {"path": "main.py",},}'
    p1 = repair_malformed_json(raw1)
    assert p1 is not None
    assert p1["name"] == "test"
    assert p1["arguments"]["path"] == "main.py"

    # 2. Python booleans
    raw2 = '{"success": True, "active": False, "meta": None}'
    p2 = repair_malformed_json(raw2)
    assert p2 is not None
    assert p2["success"] is True
    assert p2["active"] is False
    assert p2["meta"] is None

    # 3. Unclosed braces/quotes
    raw3 = '{"action": "view_file", "path": "test.txt'
    p3 = repair_malformed_json(raw3)
    assert p3 is not None
    assert p3["action"] == "view_file"
    assert p3["path"] == "test.txt"


def test_repair_and_extract_tool_calls():
    engine = ToolRepairEngine()

    # Case 1: XML tag
    text1 = """Bien sûr, je vais inspecter ce fichier :
<tool_call>
{"name": "view_file", "arguments": {"AbsolutePath": "/workspace/main.py"}}
</tool_call>
Voici ce que nous allons faire ensuite."""

    clean1, calls1, rep1 = engine.repair_and_extract(text1, allowed_tools=["view_file"])
    assert rep1 is True
    assert len(calls1) == 1
    assert calls1[0]["name"] == "view_file"
    assert calls1[0]["arguments"]["AbsolutePath"] == "/workspace/main.py"
    assert "<tool_call>" not in clean1
    assert "Bien sûr" in clean1

    # Case 2: Code block JSON
    text2 = """```json
{
  "action": "run_command",
  "arguments": {
    "CommandLine": "pytest tests"
  }
}
```"""
    _clean2, calls2, rep2 = engine.repair_and_extract(text2, allowed_tools=["run_command"])
    assert rep2 is True
    assert len(calls2) == 1
    assert calls2[0]["name"] == "run_command"
    assert calls2[0]["arguments"]["CommandLine"] == "pytest tests"

    # Case 3: Implicit shell promotion
    text3 = """Exécutons la commande suivante :
```bash
npm run build
```"""
    _clean3, calls3, rep3 = engine.repair_and_extract(text3, allowed_tools=["run_command"], promote_shell=True)
    assert rep3 is True
    assert len(calls3) == 1
    assert calls3[0]["name"] == "run_command"
    assert calls3[0]["arguments"]["CommandLine"] == "npm run build"


def test_tool_repair_api():
    resp = client.post("/api/tools/repair", json={
        "text": '<function=read_file>{"path": "README.md"}</function>',
        "allowed_tools": ["read_file"]
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["was_repaired"] is True
    assert len(data["tool_calls"]) == 1
    assert data["tool_calls"][0]["name"] == "read_file"

    resp_stats = client.get("/api/tools/repair/stats")
    assert resp_stats.status_code == 200
    assert "total_repaired" in resp_stats.json()
