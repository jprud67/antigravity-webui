"""
Tests unitaires pour Checkpoint & Rewind Service (v0.4.2)
"""
import pytest
import json
import shutil
from pathlib import Path
from unittest.mock import patch

from app.services.checkpoint_service import (
    create_checkpoint,
    list_checkpoints,
    get_checkpoint_detail,
    restore_checkpoint,
    fork_from_checkpoint,
    delete_checkpoint,
)

@pytest.fixture
def mock_brain_dir(tmp_path):
    with patch("app.services.checkpoint_service.BRAIN_DIR", tmp_path), \
         patch("app.services.storage.BRAIN_DIR", tmp_path):
        yield tmp_path

def test_checkpoint_lifecycle(mock_brain_dir):
    conv_id = "test-conv-123"
    conv_dir = mock_brain_dir / conv_id
    sys_dir = conv_dir / ".system_generated" / "logs"
    sys_dir.mkdir(parents=True, exist_ok=True)

    # 1. Create a dummy transcript
    transcript_file = sys_dir / "transcript.jsonl"
    steps = [
        {"step_index": 0, "type": "USER_INPUT", "content": "Bonjour", "timestamp": "2026-09-27T01:00:00Z"},
        {"step_index": 1, "type": "PLANNER_RESPONSE", "content": "Salut !", "timestamp": "2026-09-27T01:01:00Z"},
        {"step_index": 2, "type": "USER_INPUT", "content": "Crée un fichier", "timestamp": "2026-09-27T01:02:00Z"},
        {"step_index": 3, "type": "PLANNER_RESPONSE", "content": "Fichier créé.", "timestamp": "2026-09-27T01:03:00Z"}
    ]
    with open(transcript_file, "w", encoding="utf-8") as f:
        for s in steps:
            f.write(json.dumps(s) + "\n")

    # 2. Create checkpoint
    chk = create_checkpoint(conv_id, label="Étape 3 - Fichier créé")
    assert chk is not None
    assert chk["label"] == "Étape 3 - Fichier créé"
    assert chk["step_index"] == 3
    assert chk["message_count"] == 4
    chk_id = chk["id"]

    # 3. List checkpoints
    chks = list_checkpoints(conv_id)
    assert len(chks) == 1
    assert chks[0]["id"] == chk_id

    # 4. Detail checkpoint
    detail = get_checkpoint_detail(conv_id, chk_id)
    assert detail["id"] == chk_id
    assert len(detail["preview_messages"]) == 4

    # 5. Add more steps to conversation
    new_steps = [
        {"step_index": 4, "type": "USER_INPUT", "content": "Suite erronée", "timestamp": "2026-09-27T01:04:00Z"},
        {"step_index": 5, "type": "PLANNER_RESPONSE", "content": "Erreur produite", "timestamp": "2026-09-27T01:05:00Z"}
    ]
    with open(transcript_file, "a", encoding="utf-8") as f:
        for s in new_steps:
            f.write(json.dumps(s) + "\n")

    # 6. Rewind / Restore to checkpoint
    restore_res = restore_checkpoint(conv_id, chk_id)
    assert restore_res["success"] is True
    assert restore_res["restored_step_index"] == 3

    # Check transcript was truncated back to step 3
    with open(transcript_file, "r", encoding="utf-8") as f:
        lines = [json.loads(l) for l in f if l.strip()]
    assert len(lines) == 4
    assert lines[-1]["step_index"] == 3

    # 7. Fork from checkpoint
    fork_res = fork_from_checkpoint(conv_id, chk_id, new_title="Bifurcation v1")
    assert fork_res["success"] is True
    new_conv_id = fork_res["new_conversation_id"]
    assert new_conv_id != conv_id

    # Check new conversation exists and has 4 steps
    new_transcript = mock_brain_dir / new_conv_id / ".system_generated" / "logs" / "transcript.jsonl"
    assert new_transcript.exists()
    with open(new_transcript, "r", encoding="utf-8") as f:
        fork_lines = [json.loads(l) for l in f if l.strip()]
    assert len(fork_lines) == 4

    # 8. Delete checkpoint
    del_res = delete_checkpoint(conv_id, chk_id)
    assert del_res["success"] is True
    assert del_res["deleted_checkpoint_id"] == chk_id

    remaining = list_checkpoints(conv_id)
    # Le checkpoint spécifique a bien été supprimé (le backup auto avant restauration subsiste)
    assert all(c["id"] != chk_id for c in remaining)
