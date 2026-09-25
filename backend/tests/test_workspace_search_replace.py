import shutil
import uuid
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import DEFAULT_WORKSPACE
from app.main import app

client = TestClient(app)

TEMP_TEST_DIR = (Path(DEFAULT_WORKSPACE) / f"test_search_replace_{uuid.uuid4().hex[:8]}").resolve()


@pytest.fixture(scope="module", autouse=True)
def setup_test_workspace():
    if TEMP_TEST_DIR.exists():
        shutil.rmtree(TEMP_TEST_DIR)
    TEMP_TEST_DIR.mkdir(parents=True, exist_ok=True)

    # Populate sample files for search and replace tests
    (TEMP_TEST_DIR / "file1.py").write_text(
        "def hello_world():\n    return 'Antigravity Workspace'\n\n# hello again\n",
        encoding="utf-8"
    )
    (TEMP_TEST_DIR / "file2.ts").write_text(
        "export const GREETING = 'Hello World';\nconsole.log(GREETING);\n",
        encoding="utf-8"
    )
    (TEMP_TEST_DIR / "notes.md").write_text(
        "# Notes\nThis is a sample note about antigravity features.\n",
        encoding="utf-8"
    )
    sub = TEMP_TEST_DIR / "sub"
    sub.mkdir()
    (sub / "nested.py").write_text(
        "class WorkspaceRunner:\n    pass\n",
        encoding="utf-8"
    )

    yield

    if TEMP_TEST_DIR.exists():
        shutil.rmtree(TEMP_TEST_DIR)


def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_search_auth_guard():
    res = client.post("/api/files/workspace-search", json={"query": "hello"})
    assert res.status_code in (401, 403)


def test_search_plain_case_insensitive():
    headers = get_auth_headers()
    payload = {
        "query": "hello",
        "workspace": str(TEMP_TEST_DIR),
        "case_sensitive": False
    }
    res = client.post("/api/files/workspace-search", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["query"] == "hello"
    assert data["total_matches"] >= 3
    # file1.py has "hello_world" and "# hello again"
    # file2.ts has "Hello World"
    files = {f["relative_path"]: f for f in data["files"]}
    assert "file1.py" in files or any("file1.py" in k for k in files)


def test_search_case_sensitive():
    headers = get_auth_headers()
    payload = {
        "query": "Hello",
        "workspace": str(TEMP_TEST_DIR),
        "case_sensitive": True
    }
    res = client.post("/api/files/workspace-search", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    # Only file2.ts has capital "Hello"
    for f in data["files"]:
        for m in f["matches"]:
            assert "Hello" in m["match_text"]


def test_search_whole_word():
    headers = get_auth_headers()
    # "hello" as whole word shouldn't match "hello_world"
    payload = {
        "query": "hello",
        "workspace": str(TEMP_TEST_DIR),
        "whole_word": True,
        "case_sensitive": False
    }
    res = client.post("/api/files/workspace-search", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    # file1.py line 4 "# hello again" and file2.ts "Hello World"
    for f in data["files"]:
        for m in f["matches"]:
            assert m["match_text"].lower() == "hello"


def test_search_regex():
    headers = get_auth_headers()
    payload = {
        "query": r"def\s+\w+\(\)",
        "workspace": str(TEMP_TEST_DIR),
        "is_regex": True
    }
    res = client.post("/api/files/workspace-search", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["total_matches"] == 1
    assert data["files"][0]["matches"][0]["match_text"] == "def hello_world()"


def test_search_include_exclude_globs():
    headers = get_auth_headers()
    # Only python files
    payload = {
        "query": "Workspace",
        "workspace": str(TEMP_TEST_DIR),
        "include_pattern": "*.py",
        "exclude_pattern": "nested.py"
    }
    res = client.post("/api/files/workspace-search", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    paths = [f["relative_path"] for f in data["files"]]
    assert any("file1.py" in p for p in paths)
    assert not any("nested.py" in p for p in paths)
    assert not any("notes.md" in p for p in paths)


def test_replace_dry_run_preview():
    headers = get_auth_headers()
    payload = {
        "query": "Antigravity",
        "replace_text": "Supergravity",
        "workspace": str(TEMP_TEST_DIR),
        "dry_run": True
    }
    res = client.post("/api/files/workspace-replace", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dry_run"] is True
    assert data["total_replacements"] >= 2
    assert len(data["previews"]) >= 2
    # Verify file on disk was NOT modified
    content = (TEMP_TEST_DIR / "file1.py").read_text(encoding="utf-8")
    assert "Antigravity Workspace" in content
    assert "Supergravity" not in content


def test_replace_write_atomic():
    headers = get_auth_headers()
    payload = {
        "query": "Antigravity",
        "replace_text": "Hypergravity",
        "workspace": str(TEMP_TEST_DIR),
        "case_sensitive": True,
        "dry_run": False
    }
    res = client.post("/api/files/workspace-replace", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["dry_run"] is False
    assert data["files_modified"] == 1

    # Verify files on disk ARE modified
    content1 = (TEMP_TEST_DIR / "file1.py").read_text(encoding="utf-8")
    assert "Hypergravity Workspace" in content1
    assert "Antigravity" not in content1

    content_notes = (TEMP_TEST_DIR / "notes.md").read_text(encoding="utf-8")
    assert "about antigravity features" in content_notes  # note was lowercase "antigravity"


def test_single_replace():
    headers = get_auth_headers()
    file_path = str(TEMP_TEST_DIR / "file2.ts")
    # file2.ts has:
    # line 1: export const GREETING = 'Hello World';
    # column of 'Hello': index 27 (1-based: 28)
    line1 = (TEMP_TEST_DIR / "file2.ts").read_text(encoding="utf-8").splitlines()[0]
    idx = line1.find("Hello")
    assert idx != -1

    payload = {
        "file_path": file_path,
        "workspace": str(TEMP_TEST_DIR),
        "line_number": 1,
        "column": idx + 1,
        "match_length": len("Hello"),
        "replace_text": "Bonjour",
        "expected_match": "Hello"
    }
    res = client.post("/api/files/single-replace", json=payload, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True

    # Check file content on disk
    new_content = (TEMP_TEST_DIR / "file2.ts").read_text(encoding="utf-8")
    assert "export const GREETING = 'Bonjour World';" in new_content


def test_replace_extensionless_and_dotfile():
    headers = get_auth_headers()
    dockerfile = TEMP_TEST_DIR / "Dockerfile"
    dockerfile.write_text("FROM node:20\nENV APP_ENV=production\n", encoding="utf-8")

    gitignore = TEMP_TEST_DIR / ".gitignore"
    gitignore.write_text("node_modules/\n.cache_old/\n", encoding="utf-8")

    payload = {
        "query": "APP_ENV=production",
        "replace_text": "APP_ENV=staging",
        "workspace": str(TEMP_TEST_DIR),
        "file_paths": [str(dockerfile)],
        "dry_run": False
    }
    res = client.post("/api/files/workspace-replace", json=payload, headers=headers)
    assert res.status_code == 200
    assert dockerfile.exists()
    assert dockerfile.name == "Dockerfile"
    assert "APP_ENV=staging" in dockerfile.read_text(encoding="utf-8")

    # Single replace on dotfile
    line1 = gitignore.read_text(encoding="utf-8").splitlines()[1]
    col = line1.find(".cache_old")
    single_payload = {
        "file_path": str(gitignore),
        "workspace": str(TEMP_TEST_DIR),
        "line_number": 2,
        "column": col + 1,
        "match_length": len(".cache_old"),
        "replace_text": ".cache_new",
        "expected_match": ".cache_old"
    }
    res_single = client.post("/api/files/single-replace", json=single_payload, headers=headers)
    assert res_single.status_code == 200
    assert gitignore.exists()
    assert gitignore.name == ".gitignore"
    assert ".cache_new/" in gitignore.read_text(encoding="utf-8")

    # Assert no temporary files were left in directory
    leftovers = [f.name for f in TEMP_TEST_DIR.iterdir() if ".tmp" in f.name]
    assert len(leftovers) == 0


def test_rebase_helper_sanitizes_message():
    from app.services.git_rebase_helper import _sanitize_rebase_message

    dirty_msg = (
        "feat(core): update core subsystem\n\n"
        "Co-Authored-By: Claude <noreply@anthropic.com>\n"
        "Co-Committer: Claude <claude@anthropic.com>\n"
        "assisted-by: ai\n"
        "Some legitimate body text\n"
    )
    clean = _sanitize_rebase_message(dirty_msg)
    assert "Co-Authored-By" not in clean
    assert "Claude" not in clean
    assert "claude" not in clean
    assert "Some legitimate body text" in clean
    assert "feat(core): update core subsystem" in clean

