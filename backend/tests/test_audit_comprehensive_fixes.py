import urllib.error
from unittest.mock import patch

import pytest

from app.services.canvas_documents import (
    CanvasDocumentCreateInput,
    CanvasDocumentEntrypoint,
    create_canvas_document,
)
from app.services.code_kernel import KernelToolProxy
from app.services.docker_studio import execute_compose_action
from app.services.doctor import _check_sqlite_integrity, run_auto_repair
from app.services.fts_search import fts_service, reindex_all_conversations
from app.services.git_worktree import create_subagent_worktree
from app.services.tailscale import toggle_tailscale_serve
from app.services.vector_memory import AutoRecallConfig, compute_embedding
from app.services.web_push import send_web_push_notification


def test_fts_reindex_alias():
    assert hasattr(fts_service, "reindex_all")
    assert fts_service.reindex_all == fts_service.rebuild_all_sessions
    with patch.object(fts_service, "rebuild_all_sessions", return_value={"total_sessions": 0, "indexed_sessions": 0}) as mock_rebuild:
        res = reindex_all_conversations()
        assert res["total_sessions"] == 0
        mock_rebuild.assert_called_once()


def test_doctor_dual_db_check():
    integrity = _check_sqlite_integrity()
    assert "status" in integrity
    assert "size_mb" in integrity
    assert "integrity" in integrity


@pytest.mark.asyncio
async def test_doctor_auto_repair_sqlite():
    with patch("app.services.doctor.reindex_all_conversations", return_value={"total_sessions": 0, "indexed_sessions": 0}):
        res = await run_auto_repair()
        assert res["success"] is True
        assert any("SQLite" in a for a in res["actions_taken"])


def test_canvas_sensitive_path_blocked(tmp_path):
    with pytest.raises(PermissionError):
        create_canvas_document(
            CanvasDocumentCreateInput(
                title="Secret test",
                entrypoint=CanvasDocumentEntrypoint(type="path", value="/etc/passwd")
            ),
            workspace_dir=str(tmp_path)
        )


def test_code_kernel_sensitive_path_blocked(tmp_path):
    proxy = KernelToolProxy(cwd=str(tmp_path))
    with pytest.raises(PermissionError):
        proxy.view_file("/etc/shadow")

    with pytest.raises(PermissionError):
        proxy.list_dir("/root/.ssh")

    with pytest.raises(PermissionError):
        proxy.grep_search("secret", "/etc/sudoers")


def test_docker_compose_security(tmp_path):
    with pytest.raises(PermissionError):
        execute_compose_action("/etc/shadow", "up")

    dummy_txt = tmp_path / "compose.txt"
    dummy_txt.write_text("services: {}")
    with pytest.raises(ValueError):
        execute_compose_action(str(dummy_txt), "up")


def test_git_worktree_traversal_sanitization(tmp_path):
    res = create_subagent_worktree(parent_cwd=str(tmp_path), subagent_id="../../evil")
    assert res is None


def test_tailscale_port_validation():
    with pytest.raises(ValueError):
        toggle_tailscale_serve(True, port=0)

    with pytest.raises(ValueError):
        toggle_tailscale_serve(True, port=70000)


def test_web_push_http_error_prunes_subscription():
    sub = {"endpoint": "https://push.example.com/expired", "keys": {"p256dh": "k", "auth": "a"}}
    with (
        patch("app.services.web_push.list_subscriptions", return_value=[sub]),
        patch("app.services.web_push.remove_subscription") as mock_remove,
        patch("urllib.request.urlopen", side_effect=urllib.error.HTTPError("https://push.example.com/expired", 410, "Gone", {}, None)),
    ):
        res = send_web_push_notification("title", "body")
        assert res["failed"] == 1
        mock_remove.assert_called_with("https://push.example.com/expired")


@pytest.mark.asyncio
async def test_vector_memory_gemini_fallback():
    cfg = AutoRecallConfig(provider="gemini", api_key="invalid-key")
    vec = await compute_embedding("test prompt", cfg)
    assert len(vec) == 384  # Falls back to local 384-dim unit vector
    assert any(x != 0.0 for x in vec)


def test_clean_user_prompt_context_summary_fallback():
    from app.services.storage import clean_user_prompt
    raw = (
        "<CONTEXT_SUMMARY>\nOld conversation summary\n</CONTEXT_SUMMARY>\n"
        "Please fix the bug in server.py"
    )
    cleaned = clean_user_prompt(raw)
    assert cleaned == "Please fix the bug in server.py"
    assert "CONTEXT_SUMMARY" not in cleaned
    assert "Old conversation" not in cleaned


def test_session_metadata_bookmarks_normalization():
    from app.services.session_metadata import _normalize_meta, make_default_meta
    meta = make_default_meta()
    assert "bookmarks" in meta
    assert meta["bookmarks"] == []

    # Non-list bookmarks should be sanitized to []
    norm = _normalize_meta({"bookmarks": "invalid"})
    assert norm["bookmarks"] == []

    # Invalid items inside bookmarks list should be filtered out
    norm2 = _normalize_meta({"bookmarks": [{"id": "b1", "label": "test"}, "not-a-dict", None]})
    assert len(norm2["bookmarks"]) == 1
    assert norm2["bookmarks"][0]["id"] == "b1"


def test_code_kernel_timeout_globals_isolation(tmp_path):
    import time

    from app.services.code_kernel import PersistentPythonKernel
    kernel = PersistentPythonKernel(session_id="test-timeout-kernel", cwd=str(tmp_path))
    kernel.execute("safe_var = 100")
    assert kernel.globals.get("safe_var") == 100

    timeout_code = """
import time
time.sleep(0.3)
safe_var = 999
"""
    res = kernel.execute(timeout_code, timeout=0.05)
    assert res["status"] == "timeout"
    assert "timed out" in res["traceback"]
    # Wait for the background thread to finish its sleep and assignment attempt
    time.sleep(0.35)
    # The kernel globals must retain the original safe_var value
    assert kernel.globals.get("safe_var") == 100


def test_vector_memory_schema_indices():
    from app.services.vector_memory import _get_db, ensure_vector_memory_schema
    ensure_vector_memory_schema()
    with _get_db() as conn:
        cursor = conn.execute("PRAGMA index_list('vector_memories')")
        indices = [row[1] for row in cursor.fetchall()]
        assert "idx_vm_agent" in indices
        assert "idx_vm_created" in indices
        assert "idx_vm_agent_cat" in indices


def test_database_studio_as_uri_schema(tmp_path):
    import sqlite3

    from app.services.database_studio import (
        count_sqlite_tables,
        inspect_database_schema,
    )

    test_db = tmp_path / "test_studio.db"
    conn = sqlite3.connect(str(test_db))
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL)")
    conn.execute("INSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob')")
    conn.commit()
    conn.close()

    count = count_sqlite_tables(str(test_db))
    assert count == 1

    schema = inspect_database_schema(str(test_db))
    assert schema.database_name == "test_studio.db"
    assert len(schema.tables) == 1
    assert schema.tables[0].name == "users"
    assert schema.tables[0].row_count_estimate == 2


@pytest.mark.asyncio
async def test_vector_memory_ollama_provider_integration():
    from unittest.mock import MagicMock, patch

    from app.services.vector_memory import AutoRecallConfig, compute_embedding

    cfg = AutoRecallConfig(provider="ollama", api_base="http://localhost:11434", model="nomic-embed-text")

    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.json.return_value = {"embedding": [0.1, 0.2, 0.3]}

    with patch("httpx.AsyncClient.post", return_value=mock_resp):
        vec = await compute_embedding("test prompt for ollama", cfg=cfg)
        assert vec == [0.1, 0.2, 0.3]


def test_database_studio_execute_query_directory_and_empty_query(tmp_path):
    from app.services.database_studio import execute_query

    # Passing directory must return error
    res_dir = execute_query(str(tmp_path), "SELECT 1;")
    assert res_dir.error is not None
    assert "Accès refusé ou fichier inexistant" in res_dir.error

    # Passing empty or whitespace query must return error
    db_file = tmp_path / "valid.db"
    import sqlite3
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE t (id INT)")
    conn.commit()
    conn.close()

    res_empty = execute_query(str(db_file), "   ")
    assert res_empty.error == "Requête SQL vide."


def test_editor_diagnostics_python_null_byte_syntax_error():
    from app.api.editor_diagnostics import _lint_python

    # Code containing null bytes must be caught and reported
    diags = _lint_python("print('hello\x00world')", None)
    assert len(diags) > 0
    assert any(d.severity == "error" and d.source == "syntax" for d in diags)


def test_vector_memory_request_aliases():
    from app.api.vector_memory import ClearRequest, RecallRequest

    cr = ClearRequest.model_validate({"agentId": "custom_agent"})
    assert cr.agent_id == "custom_agent"

    rr = RecallRequest.model_validate({"prompt": "hello", "agentId": "custom_agent"})
    assert rr.agent_id == "custom_agent"
    assert rr.prompt == "hello"


def test_link_understanding_db_parent_mkdir(tmp_path):
    from unittest.mock import patch

    from app.services.link_understanding import _get_db

    sub_dir = tmp_path / "nested" / "deep"
    test_db = sub_dir / "sessions.db"

    assert not sub_dir.exists()
    with patch("app.services.link_understanding.DB_PATH", test_db), _get_db() as conn:
        assert test_db.exists()
        assert conn is not None


def test_database_studio_query_limit_extended(tmp_path):
    import sqlite3

    from app.services.database_studio import execute_query

    test_db = tmp_path / "large_limit.db"
    conn = sqlite3.connect(str(test_db))
    conn.execute("CREATE TABLE items (id INT)")
    for i in range(2500):
        conn.execute("INSERT INTO items VALUES (?)", (i,))
    conn.commit()
    conn.close()

    res = execute_query(str(test_db), "SELECT * FROM items;", limit=3000)
    assert res.error is None
    assert res.total_rows == 2500
    assert not res.truncated


def test_editor_diagnostics_oxlint_banner_tolerance(monkeypatch, tmp_path):
    from app.api.editor_diagnostics import _lint_javascript

    fake_oxlint = tmp_path / "fake_oxlint.sh"
    fake_oxlint.write_text(
        '#!/bin/sh\n'
        'echo "No files found to lint. Please check your paths and ignore patterns."\n'
        'echo \'{"diagnostics": [{"message": "Unused var", "code": "no-unused-vars", "severity": "warning", "labels": [{"span": {"line": 1, "column": 5, "length": 1}}]}]}\'\n',
        encoding="utf-8"
    )
    fake_oxlint.chmod(0o755)

    monkeypatch.setattr("app.api.editor_diagnostics._get_oxlint_executable", lambda: str(fake_oxlint))
    diags = _lint_javascript("const a = 1;", "test.ts", "typescript")
    assert len(diags) == 1
    assert diags[0].message == "Unused var"
    assert diags[0].code == "no-unused-vars"


def test_code_kernel_stdout_restore_on_timeout():
    import sys

    from app.services.code_kernel import PersistentPythonKernel

    orig_stdout = sys.stdout
    orig_stderr = sys.stderr

    kernel = PersistentPythonKernel("test-timeout-session")
    # Execute a code cell that times out
    res = kernel.execute("import time; time.sleep(2)", timeout=1)
    assert res["status"] == "timeout"
    assert "timed out" in res["traceback"]

    # Verify that sys.stdout and sys.stderr are NOT hijacked
    assert sys.stdout is orig_stdout
    assert sys.stderr is orig_stderr


def test_link_understanding_property_og_description():
    from app.services.link_understanding import _clean_html_to_text

    html_content = """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Article Title</title>
        <meta property="og:description" content="This is an OpenGraph description" />
    </head>
    <body>
        <p>Main body content goes here.</p>
    </body>
    </html>
    """
    title, desc, text = _clean_html_to_text(html_content)
    assert title == "Article Title"
    assert desc == "This is an OpenGraph description"
    assert "Main body content" in text


def test_canvas_documents_url_scheme_security(tmp_path):
    import pytest

    from app.services.canvas_documents import (
        CanvasDocumentCreateInput,
        CanvasDocumentEntrypoint,
        create_canvas_document,
    )

    bad_input = CanvasDocumentCreateInput(
        id="test-xss-doc",
        kind="html_bundle",
        entrypoint=CanvasDocumentEntrypoint(type="url", value="javascript:alert(document.cookie)"),
    )
    with pytest.raises(ValueError, match="URL de schéma non autorisé"):
        create_canvas_document(bad_input, workspace_dir=str(tmp_path))


def test_workspaces_delete_cleans_default_workspace(tmp_path, monkeypatch):
    from pathlib import Path

    from app.api.workspaces import delete_workspace
    from app.config import DEFAULT_WORKSPACE

    ws1 = str(tmp_path / "ws1")
    ws2 = str(tmp_path / "ws2")
    Path(ws1).mkdir()
    Path(ws2).mkdir()

    fake_settings = {
        "trustedWorkspaces": [DEFAULT_WORKSPACE, ws1, ws2],
        "defaultWorkspace": ws1
    }

    monkeypatch.setattr("app.api.workspaces.get_settings", lambda: dict(fake_settings))
    def fake_save(s):
        fake_settings.clear()
        fake_settings.update(s)
        return s
    monkeypatch.setattr("app.api.workspaces.save_settings", fake_save)

    delete_workspace(path=ws1)
    assert ws1 not in fake_settings["trustedWorkspaces"]
    # defaultWorkspace should have been reset to DEFAULT_WORKSPACE
    assert fake_settings["defaultWorkspace"] == DEFAULT_WORKSPACE


def test_project_detector_level2_file_count(tmp_path):
    from app.services.project_detector import _extract_stats

    sub1 = tmp_path / "sub1"
    sub1.mkdir()
    (sub1 / "file1.txt").write_text("hello", encoding="utf-8")
    (sub1 / "file2.py").write_text("world", encoding="utf-8")
    (tmp_path / "root_file.md").write_text("readme", encoding="utf-8")

    stats = _extract_stats(tmp_path)
    # Should count root_file.md (1) + file1.txt (1) + file2.py (1) = 3 files
    assert stats["file_count"] == 3
    assert stats["disk_size_mb"] >= 0.0


def test_fts_rebuild_missing_summaries_table(tmp_path, monkeypatch):
    from app.services.fts_search import fts_service

    test_db = tmp_path / "empty_fts.db"
    monkeypatch.setattr("app.services.fts_search.CONVERSATION_DB", test_db)
    monkeypatch.setattr("app.services.fts_search._fts_initialized", False)

    # Rebuild must not fail even if conversation_summaries table does not exist
    res = fts_service.rebuild_all_sessions()
    assert res["success"] is True
    assert res["total_sessions"] == 0


def test_mcp_catalog_user_agent_version():

    # Inspect module source or test probe
    import inspect

    import app.services.mcp_catalog as mc
    source = inspect.getsource(mc.test_mcp_connection)
    assert "Antigravity-MCP-Probe/0.3.4" in source


def test_editor_diagnostics_react_language_mapping():
    import inspect

    from app.api.editor_diagnostics import _lint_javascript
    source = inspect.getsource(_lint_javascript)
    assert "javascriptreact" in source
    assert "typescriptreact" in source


def test_editor_diagnostics_python_stdin_filename():
    import inspect

    from app.api.editor_diagnostics import _lint_python
    source = inspect.getsource(_lint_python)
    assert 'not base_name.endswith(".py")' in source or "stdin_filename = f\"{base_name}.py\"" in source


def test_canvas_documents_workspace_input():
    from app.services.canvas_documents import (
        CanvasDocumentCreateInput,
        CanvasDocumentEntrypoint,
    )

    inp = CanvasDocumentCreateInput(
        entrypoint=CanvasDocumentEntrypoint(type="html", value="<h1>Hello</h1>"),
        workspace="/custom/workspace/path"
    )
    assert inp.workspace == "/custom/workspace/path"


def test_database_studio_is_sqlite_file_and_thumbs_db(tmp_path):
    import sqlite3

    from app.services.database_studio import discover_databases, is_sqlite_file

    # Thumbs.db must return False
    thumbs = tmp_path / "Thumbs.db"
    thumbs.write_bytes(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 30)
    assert is_sqlite_file(thumbs) is False

    # Fake db without header must return False
    fake_db = tmp_path / "fake.db"
    fake_db.write_bytes(b"NOT_SQLITE_DATA_1234567890")
    assert is_sqlite_file(fake_db) is False

    # Genuine sqlite db must return True
    real_db = tmp_path / "real.sqlite"
    conn = sqlite3.connect(str(real_db))
    conn.execute("CREATE TABLE foo (id INT)")
    conn.commit()
    conn.close()
    assert is_sqlite_file(real_db) is True

    # discover_databases should only discover real.sqlite, ignoring Thumbs.db and fake.db
    discovered = discover_databases(str(tmp_path))
    assert len(discovered) == 1
    assert discovered[0].name == "real.sqlite"


def test_code_kernel_global_execution_lock():
    import threading

    from app.services.code_kernel import _GLOBAL_EXECUTION_LOCK

    assert isinstance(_GLOBAL_EXECUTION_LOCK, type(threading.RLock()))


def test_fts_sync_missing_summaries_table(tmp_path, monkeypatch):
    from app.services.fts_search import fts_service

    test_db = tmp_path / "empty_fts_sync.db"
    monkeypatch.setattr("app.services.fts_search.CONVERSATION_DB", test_db)
    monkeypatch.setattr("app.services.fts_search._fts_initialized", False)

    # sync_all_sessions must not crash even if conversation_summaries table is missing
    res = fts_service.sync_all_sessions()
    assert res["success"] is True
    assert res["total_sessions"] == 0


def test_docker_compose_action_requires_regular_file(tmp_path):
    import pytest

    from app.services.docker_studio import execute_compose_action

    dir_compose = tmp_path / "docker-compose.yml"
    dir_compose.mkdir()

    with pytest.raises(FileNotFoundError, match="introuvable"):
        execute_compose_action(str(dir_compose), "up")


def test_workspaces_add_canonical_deduplication(tmp_path, monkeypatch):
    from app.api.workspaces import add_workspace

    ws_dir = tmp_path / "my_project"
    ws_dir.mkdir()

    fake_settings = {"trustedWorkspaces": [str(ws_dir.resolve())]}
    monkeypatch.setattr("app.api.workspaces.get_settings", lambda: dict(fake_settings))
    def fake_save(s):
        fake_settings.clear()
        fake_settings.update(s)
        return s
    monkeypatch.setattr("app.api.workspaces.save_settings", fake_save)

    # Adding with trailing slash or relative notation should be deduplicated
    res = add_workspace(path=f"{ws_dir}/")
    assert res["status"] == "ok"
    assert len(fake_settings["trustedWorkspaces"]) == 1





