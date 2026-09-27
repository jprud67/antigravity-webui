import pytest
from app.services import inline_comments, share_service
from app.services.inline_comments import CommentCreatePayload, CommentUpdatePayload


def test_granular_permissions_lifecycle():
    conv_id = "conv_collab_perm_test"
    link = share_service.create_share_link(conv_id, permission="write", duration_hours=12)
    token = link["token"]

    # Initial default permissions (write=True, terminal=False, approval=True)
    perms = share_service.get_share_permissions(token)
    assert perms is not None
    assert perms["can_write"] is True
    assert perms["can_run_terminal"] is False
    assert perms["requires_approval"] is True

    # Update permissions
    updated = share_service.update_share_permissions(
        token,
        can_write=True,
        can_run_terminal=True,
        requires_approval=False
    )
    assert updated is not None
    assert updated["can_write"] is True
    assert updated["can_run_terminal"] is True
    assert updated["requires_approval"] is False

    # Check retrieval by conv_id also works
    by_conv = share_service.get_share_permissions(conv_id)
    assert by_conv is not None
    assert by_conv["can_run_terminal"] is True


def test_inline_comments_crud_and_steering():
    inline_comments.ensure_comments_schema()
    conv_id = "conv_collab_comm_test"
    file_path = "src/components/App.tsx"

    payload = CommentCreatePayload(
        conversation_id=conv_id,
        file_path=file_path,
        line_number=15,
        author="Alice",
        content="Refactor this hook to prevent rerenders @agent",
    )

    # Create comment
    c1 = inline_comments.create_comment(payload)
    assert c1["id"] is not None
    assert c1["file_path"] == file_path
    assert c1["resolved"] is False
    assert c1["has_agent_mention"] is True

    # Get comments
    all_comments = inline_comments.list_comments(conversation_id=conv_id, file_path=file_path)
    assert len(all_comments) >= 1
    found = [c for c in all_comments if c["id"] == c1["id"]]
    assert len(found) == 1

    # Update comment (resolve it)
    up = inline_comments.update_comment(c1["id"], CommentUpdatePayload(resolved=True))
    assert up is not None
    assert up["resolved"] is True

    # Delete comment
    del_ok = inline_comments.delete_comment(c1["id"])
    assert del_ok is True

    # Verify deleted
    all_after = inline_comments.list_comments(conversation_id=conv_id, file_path=file_path)
    assert not any(c["id"] == c1["id"] for c in all_after)
