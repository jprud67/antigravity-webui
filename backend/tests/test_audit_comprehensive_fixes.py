from pathlib import Path
import sys
import urllib.error
import uuid
from unittest.mock import patch

import pytest

from app.services.canvas_documents import (
    CanvasDocumentCreateInput,
    CanvasDocumentEntrypoint,
    create_canvas_document,
)
from app.services.code_kernel import (
    IsolatedStream,
    KernelToolProxy,
    get_or_create_kernel,
)
from app.services.database_studio import execute_query
from app.services.docker_studio import execute_compose_action
from app.services.doctor import _check_sqlite_integrity, run_auto_repair
from app.services.fts_search import fts_service, reindex_all_conversations
from app.services.git_worktree import create_subagent_worktree
from app.services.messaging_gateway import approve_pairing_code, request_pairing, reset_approval_rate_limits
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


def test_editor_diagnostics_toml_linting():
    from app.api.editor_diagnostics import (
        EditorDiagnosticsRequest,
        _lint_toml,
        get_editor_diagnostics,
    )

    valid_toml = """
[package]
name = "my-tool"
version = "0.1.0"
edition = "2021"
"""
    diags = _lint_toml(valid_toml)
    assert len(diags) == 0

    invalid_toml = """
[package]
name = "my-tool"
version = 
"""
    diags_invalid = _lint_toml(invalid_toml)
    assert len(diags_invalid) > 0
    assert diags_invalid[0].source == "toml"
    assert diags_invalid[0].severity == "error"
    assert diags_invalid[0].line >= 1

    # Test endpoint language auto-detection for .toml
    res = get_editor_diagnostics(EditorDiagnosticsRequest(
        content=invalid_toml,
        filePath="Cargo.toml",
    ))
    assert res.total_errors > 0
    assert res.diagnostics[0].source == "toml"


def test_database_studio_non_sqlite_rejection(tmp_path):
    from app.services.database_studio import execute_query, inspect_database_schema

    dummy_file = tmp_path / "fake.db"
    dummy_file.write_text("This is definitely not a sqlite database header.")

    with pytest.raises(ValueError, match="pas une base de données SQLite valide"):
        inspect_database_schema(str(dummy_file))

    res = execute_query(str(dummy_file), "SELECT 1")
    assert res.error is not None
    assert "pas une base de données SQLite valide" in res.error


def test_canvas_protocol_relative_url_rejection(tmp_path):
    from app.services.canvas_documents import (
        CanvasDocumentCreateInput,
        CanvasDocumentEntrypoint,
        create_canvas_document,
    )

    with pytest.raises(ValueError, match="URL de schéma non autorisé"):
        create_canvas_document(
            CanvasDocumentCreateInput(
                title="Protocol relative test",
                entrypoint=CanvasDocumentEntrypoint(type="url", value="//evil.com/phishing")
            ),
            workspace_dir=str(tmp_path)
        )


def test_code_kernel_stdout_stderr_restoration(tmp_path):
    kernel = get_or_create_kernel("test-stream-restore", cwd=str(tmp_path))
    orig_stdout = sys.stdout
    orig_stderr = sys.stderr

    res = kernel.execute("print('hello world')")
    assert res["status"] == "ok"
    assert "hello world" in res["stdout"]
    assert sys.stdout is orig_stdout
    assert sys.stderr is orig_stderr


def test_isolated_stream_detachment():
    stream = IsolatedStream()
    stream.write("first write\n")
    assert "first write" in stream.getvalue()

    stream.deactivate()
    # Writes after deactivate are discarded without raising error
    written = stream.write("second write\n")
    assert written == len("second write\n")
    assert "second write" not in stream.getvalue()
    stream.flush()


def test_database_studio_query_timeout(tmp_path):
    import sqlite3
    db_file = tmp_path / "timeout_test.db"
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE items (id INTEGER PRIMARY KEY, val TEXT);")
    conn.commit()
    conn.close()

    # Normal quick query succeeds
    res_ok = execute_query(str(db_file), "SELECT * FROM items;", limit=50, timeout_seconds=2.0)
    assert res_ok.error is None

    # Query with tiny timeout on recursive loop triggers interruption
    runaway_sql = "WITH RECURSIVE cnt(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM cnt) SELECT count(*) FROM cnt;"
    res_timeout = execute_query(str(db_file), runaway_sql, limit=50, timeout_seconds=0.2)
    assert res_timeout.error is not None
    assert "interrompue" in res_timeout.error.lower() or "délai" in res_timeout.error.lower()


def test_messaging_gateway_pin_rate_limiting():
    reset_approval_rate_limits()
    try:
        user_id = f"user_{uuid.uuid4().hex}"
        # 1. Generate valid pairing code
        ok, _msg, code = request_pairing("telegram", user_id, "RateTester")
        assert ok is True
        assert code is not None

        # 2. Enter 5 invalid codes
        for _ in range(5):
            approved, _err_msg, dev = approve_pairing_code("INVALID-CODE-99")
            assert approved is False
            assert dev is None

        # 3. Next attempt is locked out
        locked, lock_msg, _ = approve_pairing_code(code)
        assert locked is False
        assert "Trop de tentatives" in lock_msg
    finally:
        reset_approval_rate_limits()


def test_safe_stream_redirect_prevents_zombie_clobber():
    from app.services.code_kernel import SafeStreamRedirect
    orig = sys.stdout
    buf1 = IsolatedStream()
    buf2 = IsolatedStream()

    # Enter redirect 1
    redir1 = SafeStreamRedirect("stdout", buf1)
    redir1.__enter__()
    assert sys.stdout is buf1

    # In the meantime, another execution attaches buf2
    sys.stdout = buf2

    # When zombie redirect 1 exits, it should NOT overwrite buf2 with orig!
    redir1.__exit__(None, None, None)
    assert sys.stdout is buf2

    # Clean up
    sys.stdout = orig


def test_kernel_grep_search_regex_error_handling(tmp_path):
    proxy = KernelToolProxy(cwd=str(tmp_path))
    test_file = tmp_path / "sample.txt"
    test_file.write_text("Hello world", encoding="utf-8")

    # Invalid regex syntax should raise a clear ValueError, not unhandled re.error
    with pytest.raises(ValueError) as exc_info:
        proxy.grep_search("[unclosed-regex", is_regex=True)
    assert "Expression régulière invalide" in str(exc_info.value)


def test_messaging_gateway_preserve_token_on_update():
    from app.services.messaging_gateway import get_gateway_configs, save_gateway_config

    secret_token = f"actual_bot_secret_{uuid.uuid4().hex}"
    platform = "telegram"

    # 1. Initial save with secret token
    save_gateway_config(platform=platform, bot_token=secret_token, chat_id="12345", is_active=True)
    cfg1 = get_gateway_configs().get(platform)
    assert cfg1 is not None
    assert cfg1["has_token"] is True

    # 2. Update config sending "PRESERVE_EXISTING" (as sent by UI)
    save_gateway_config(platform=platform, bot_token="PRESERVE_EXISTING", chat_id="67890", is_active=True)

    # 3. Verify in DB that actual token was preserved and NOT overwritten by "PRESERVE_EXISTING"
    from app.services.messaging_gateway import _get_db
    with _get_db() as conn:
        row = conn.execute("SELECT bot_token, chat_id FROM messaging_gateway_configs WHERE platform = ?", (platform,)).fetchone()
        assert row["bot_token"] == secret_token
        assert row["chat_id"] == "67890"

    # 4. Update config sending empty string
    save_gateway_config(platform=platform, bot_token="", chat_id="99999", is_active=True)
    with _get_db() as conn:
        row = conn.execute("SELECT bot_token, chat_id FROM messaging_gateway_configs WHERE platform = ?", (platform,)).fetchone()
        assert row["bot_token"] == secret_token
        assert row["chat_id"] == "99999"


def test_database_studio_export_validation(tmp_path):
    import sqlite3
    from app.services.database_studio import export_query_results

    db_file = tmp_path / "export_test.db"
    conn = sqlite3.connect(str(db_file))
    conn.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT);")
    conn.execute("INSERT INTO users (name) VALUES ('Alice'), ('Bob');")
    conn.commit()
    conn.close()

    # Valid CSV (case-insensitive)
    csv_out = export_query_results(str(db_file), "SELECT * FROM users;", format="CSV")
    assert "Alice" in csv_out
    assert "Bob" in csv_out

    # Valid JSON (case-insensitive)
    json_out = export_query_results(str(db_file), "SELECT * FROM users;", format="JSON")
    assert '"name": "Alice"' in json_out

    # Unsupported format raises ValueError
    with pytest.raises(ValueError) as exc_info:
        export_query_results(str(db_file), "SELECT * FROM users;", format="xml")
    assert "Format d'exportation non supporté" in str(exc_info.value)


def test_git_worktree_stale_branch_cleanup(tmp_path):
    import subprocess
    repo_dir = tmp_path / "repo"
    repo_dir.mkdir()
    subprocess.run(["git", "init"], cwd=str(repo_dir), check=True, capture_output=True)
    subprocess.run(["git", "config", "user.name", "jprud67"], cwd=str(repo_dir), check=True)
    subprocess.run(["git", "config", "user.email", "jprud67@gmail.com"], cwd=str(repo_dir), check=True)
    (repo_dir / "README.md").write_text("initial commit\n")
    subprocess.run(["git", "add", "README.md"], cwd=str(repo_dir), check=True)
    subprocess.run(["git", "commit", "-m", "initial"], cwd=str(repo_dir), check=True)

    # Pre-create a stale subagent branch
    stale_branch = "antigravity-subagent/subagent-teststale"
    subprocess.run(["git", "branch", stale_branch], cwd=str(repo_dir), check=True)

    # Creating worktree with same subagent ID should clean up stale branch and succeed
    wt_info = create_subagent_worktree(str(repo_dir), subagent_id="teststale")
    assert wt_info is not None
    assert wt_info["branch"] == stale_branch
    assert Path(wt_info["path"]).exists()

