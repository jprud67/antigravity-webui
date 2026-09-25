import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient

from app.config import BRAIN_DIR
from app.main import app
from app.services.context_budget import (
    calculate_conversation_context_size,
    get_conversation_context_budget_info,
    enforce_context_budget,
    BASE_SYSTEM_TOKENS,
)
from app.services.storage import atomic_write_jsonl

client = TestClient(app)


class TestContextBudgetService:
    def setup_method(self):
        self.test_cid = "test-budget-conv-12345"
        self.conv_dir = BRAIN_DIR / self.test_cid
        self.logs_dir = self.conv_dir / ".system_generated" / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_file = self.logs_dir / "transcript.jsonl"
        self.transcript_full_file = self.logs_dir / "transcript_full.jsonl"

    def teardown_method(self):
        if self.conv_dir.exists():
            shutil.rmtree(self.conv_dir, ignore_errors=True)

    def test_calculate_conversation_context_size(self):
        steps = [
            {
                "step_index": 0,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "<USER_REQUEST>Bonjour, peux-tu analyser mon projet ?</USER_REQUEST>"
            },
            {
                "step_index": 1,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "thinking": "L'utilisateur demande une analyse. Je vais exécuter git status.",
                "content": "Je regarde l'état de votre projet.",
                "tool_calls": [{"name": "run_command", "args": {"CommandLine": "git status"}}]
            },
            {
                "step_index": 2,
                "source": "MODEL",
                "type": "RUN_COMMAND",
                "content": "Created At: 2026-09-25T10:00:00Z\nOutput:\nOn branch main\nnothing to commit"
            }
        ]

        metrics = calculate_conversation_context_size(steps)
        assert metrics["base_system_tokens"] == BASE_SYSTEM_TOKENS
        assert metrics["total_steps_count"] == 3
        assert metrics["user_turns_count"] == 1
        assert metrics["transcript_tokens"] > 0
        assert metrics["estimated_input_tokens"] > BASE_SYSTEM_TOKENS
        assert metrics["breakdown"]["user_chars"] > 0
        assert metrics["breakdown"]["tool_chars"] > 0
        assert metrics["breakdown"]["thinking_chars"] > 0

    def test_get_conversation_context_budget_info_empty(self):
        info = get_conversation_context_budget_info(self.test_cid, budget_tokens=30000)
        assert info["conversation_id"] == self.test_cid
        assert info["budget_tokens"] == 30000
        assert info["estimated_input_tokens"] == BASE_SYSTEM_TOKENS
        assert info["is_over_budget"] is False
        assert "Contexte optimal" in info["recommendation"]

    def test_enforce_context_budget_already_under_budget(self):
        steps = [
            {
                "step_index": 0,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "Bonjour"
            }
        ]
        atomic_write_jsonl(self.transcript_file, steps)

        res = enforce_context_budget(self.test_cid, max_tokens=35000, preserve_last_n_turns=2)
        assert res["status"] == "ok"
        assert res["action_taken"] is False
        assert res["tokens_saved"] == 0

    def test_enforce_context_budget_multi_stage_compaction(self):
        # Build a 4-turn conversation with massive tool outputs and thinking
        massive_output = "Line of output\n" * 1500  # ~22,500 chars (~6,000 tokens)
        massive_thinking = "Deep reasoning step " * 800  # ~16,000 chars (~4,200 tokens)
        
        steps = [
            # Turn 1
            {
                "step_index": 0,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "Tour 1 : Lance les tests"
            },
            {
                "step_index": 1,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "thinking": massive_thinking,
                "content": "Voici les résultats des tests volumineux."
            },
            {
                "step_index": 2,
                "source": "MODEL",
                "type": "RUN_COMMAND",
                "content": f"Created At: 2026-09-25T10:00:00Z\nOutput:\n{massive_output}"
            },
            # Turn 2
            {
                "step_index": 3,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "Tour 2 : Affiche le diff"
            },
            {
                "step_index": 4,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "thinking": massive_thinking,
                "content": "Voici le diff volumineux."
            },
            {
                "step_index": 5,
                "source": "MODEL",
                "type": "VIEW_FILE",
                "content": f"Created At: 2026-09-25T10:01:00Z\nOutput:\n{massive_output}"
            },
            # Turn 3 (Preserved)
            {
                "step_index": 6,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "Tour 3 : Vérifie le statut"
            },
            {
                "step_index": 7,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "thinking": "Court raisonnement",
                "content": "Statut vérifié."
            },
            # Turn 4 (Preserved)
            {
                "step_index": 8,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": "Tour 4 : Prêt"
            }
        ]
        atomic_write_jsonl(self.transcript_file, steps)

        # Enforce budget of 20,000 tokens (which is smaller than base + 2 massive turns)
        res = enforce_context_budget(self.test_cid, max_tokens=20000, preserve_last_n_turns=2)
        assert res["status"] == "ok"
        assert res["action_taken"] is True
        assert res["tokens_saved"] > 3000
        assert "tool_compaction" in res["stages_applied"]
        assert self.transcript_full_file.exists()

        # Check transcript_full.jsonl preserved full original content
        with open(self.transcript_full_file, "r", encoding="utf-8") as f:
            full_lines = [json.loads(l) for l in f if l.strip()]
        assert len(full_lines) == len(steps)
        # Turn 1 tool output in full file is still massive
        assert len(full_lines[2]["content"]) > 10000

        # Check transcript.jsonl was pruned
        with open(self.transcript_file, "r", encoding="utf-8") as f:
            pruned_lines = [json.loads(l) for l in f if l.strip()]
        assert "[✓ Succès — Sortie archivée dans transcript_full.jsonl" in pruned_lines[2]["content"]

    def test_enforce_context_budget_sliding_window_checkpoint(self):
        # Build an 8-turn conversation that forces Stage 4 (Sliding Window Checkpoint)
        steps = []
        step_idx = 0
        for turn in range(1, 9):
            steps.append({
                "step_index": step_idx,
                "source": "USER_EXPLICIT",
                "type": "USER_INPUT",
                "content": f"Instruction utilisateur pour le tour {turn}"
            })
            step_idx += 1
            steps.append({
                "step_index": step_idx,
                "source": "MODEL",
                "type": "PLANNER_RESPONSE",
                "thinking": "Raisonnement détaillé " * 50,
                "content": f"Réponse assistante détaillée pour le tour {turn}. " * 60
            })
            step_idx += 1
            steps.append({
                "step_index": step_idx,
                "source": "MODEL",
                "type": "TOOL_RESULT",
                "content": f"Sortie d'outil volumineuse pour le tour {turn}: " + ("x" * 1500)
            })
            step_idx += 1

        atomic_write_jsonl(self.transcript_file, steps)

        # Enforce strict budget of 15,000 tokens
        res = enforce_context_budget(self.test_cid, max_tokens=15000, preserve_last_n_turns=2)
        assert res["status"] == "ok"
        assert res["action_taken"] is True
        assert "sliding_window_checkpoint" in res["stages_applied"]

        with open(self.transcript_file, "r", encoding="utf-8") as f:
            compacted_steps = [json.loads(l) for l in f if l.strip()]

        # Verify the presence of the CONTEXT_CHECKPOINT step
        checkpoints = [s for s in compacted_steps if s.get("type") == "CONTEXT_CHECKPOINT"]
        assert len(checkpoints) == 1
        assert "Point d'étape de contexte" in checkpoints[0]["content"]

        # Verify Tour 1 is preserved intact
        assert compacted_steps[0]["content"] == "Instruction utilisateur pour le tour 1"
        # Verify the last 2 user turns are preserved
        user_steps = [s for s in compacted_steps if s.get("type") == "USER_INPUT"]
        assert user_steps[-1]["content"] == "Instruction utilisateur pour le tour 8"
        assert user_steps[-2]["content"] == "Instruction utilisateur pour le tour 7"


class TestContextBudgetAPI:
    def setup_method(self):
        from app.api.auth import require_auth
        app.dependency_overrides[require_auth] = lambda: True
        self.test_cid = "api-budget-test-99999"
        self.conv_dir = BRAIN_DIR / self.test_cid
        self.logs_dir = self.conv_dir / ".system_generated" / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_file = self.logs_dir / "transcript.jsonl"

    def teardown_method(self):
        from app.api.auth import require_auth
        app.dependency_overrides.pop(require_auth, None)
        if self.conv_dir.exists():
            shutil.rmtree(self.conv_dir, ignore_errors=True)

    def test_api_get_context_budget_invalid_id(self):
        from fastapi import HTTPException
        from app.api.conversations import get_session_context_budget
        with pytest.raises(HTTPException) as exc_info:
            get_session_context_budget("../bad..id")
        assert exc_info.value.status_code == 400

    def test_api_get_context_budget_success(self):
        steps = [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Hello"}
        ]
        atomic_write_jsonl(self.transcript_file, steps)

        resp = client.get(f"/api/conversations/{self.test_cid}/context-budget?budget_tokens=32000")
        assert resp.status_code == 200
        data = resp.json()
        assert data["conversation_id"] == self.test_cid
        assert data["budget_tokens"] == 32000
        assert "estimated_input_tokens" in data
        assert "is_over_budget" in data

    def test_api_enforce_context_budget(self):
        steps = [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Tour 1"},
            {"step_index": 1, "source": "MODEL", "type": "RUN_COMMAND", "content": "Created At: 2026-09-25\nOutput:\n" + ("x" * 6000)},
            {"step_index": 2, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Tour 2"},
            {"step_index": 3, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Tour 3"}
        ]
        atomic_write_jsonl(self.transcript_file, steps)

        resp = client.post(
            f"/api/conversations/{self.test_cid}/context-budget/enforce",
            json={"budget_tokens": 14000, "preserve_last_n_turns": 1}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"
        assert data["action_taken"] is True
        assert data["tokens_saved"] > 0
