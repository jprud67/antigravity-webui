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
