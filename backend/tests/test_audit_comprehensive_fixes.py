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

