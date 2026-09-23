import json
import shutil
import unittest

from app.config import BRAIN_DIR
from app.services.execution_manager import inject_eco_directives, should_warn_error_loop
from app.services.storage import (
    auto_truncate_transcript,
    compact_conversation_in_place,
    get_settings,
    save_settings,
    truncate_tool_output,
)


class TestEcoModeStorage(unittest.TestCase):
    def test_default_eco_mode(self):
        settings = get_settings()
        self.assertIn("ecoMode", settings)
        self.assertIsInstance(settings["ecoMode"], bool)

    def test_toggle_eco_mode(self):
        current = get_settings().get("ecoMode", False)
        updated = save_settings({"ecoMode": not current})
        self.assertEqual(updated.get("ecoMode"), not current)
        # Restore
        save_settings({"ecoMode": current})

    def test_token_saver_prompt_injection(self):
        prompt = "Fais un audit du projet"
        eco_prompt = inject_eco_directives(prompt)
        self.assertIn("CONSIGNE SYSTÈME ÉCONOMIE TOKENS", eco_prompt)
        self.assertTrue(eco_prompt.endswith(prompt))

    def test_consecutive_error_tracking(self):
        self.assertFalse(should_warn_error_loop(1))
        self.assertFalse(should_warn_error_loop(2))
        self.assertTrue(should_warn_error_loop(3))
        self.assertFalse(should_warn_error_loop(4))


class TestTruncateToolOutput(unittest.TestCase):
    def test_truncate_tool_output_large(self):
        large_content = "\n".join([f"Step log line {i}" for i in range(200)])
        truncated, was_trunc = truncate_tool_output(large_content, max_lines=40, max_chars=2000)
        self.assertTrue(was_trunc)
        self.assertIn("SORTIE TRONQUÉE", truncated)
        self.assertTrue(len(truncated.splitlines()) <= 50)
        self.assertTrue(truncated.startswith("Step log line 0"))
        self.assertTrue(truncated.strip().endswith("Step log line 199"))

    def test_truncate_tool_output_small(self):
        small_content = "Short command output\nAll tests passed\n"
        result, was_trunc = truncate_tool_output(small_content, max_lines=40, max_chars=2000)
        self.assertFalse(was_trunc)
        self.assertEqual(result, small_content)

    def test_truncate_none_and_non_str(self):
        res_none, was_none = truncate_tool_output(None)
        self.assertFalse(was_none)
        self.assertEqual(res_none, "")

        res_num, was_num = truncate_tool_output(12345)
        self.assertFalse(was_num)
        self.assertEqual(res_num, "12345")

    def test_truncate_single_massive_line(self):
        # 20 000 chars on 1 line
        massive = "x" * 20000
        res, was_trunc = truncate_tool_output(massive, max_lines=50, max_chars=3000)
        self.assertTrue(was_trunc)
        self.assertIn("caractères masqués", res)
        self.assertLess(len(res), 5000)
        self.assertTrue(res.startswith("xxxx"))
        self.assertTrue(res.endswith("xxxx"))

    def test_truncate_exact_boundary(self):
        boundary_content = "\n".join([f"Line {i}" for i in range(30)])
        res, was_trunc = truncate_tool_output(boundary_content, max_lines=50, max_chars=5000)
        self.assertFalse(was_trunc)
        self.assertEqual(res, boundary_content)


class TestAutoTruncateTranscript(unittest.TestCase):
    def setUp(self):
        self.test_cid = "test-eco-auto-trunc-session"
        self.conv_dir = BRAIN_DIR / self.test_cid
        self.logs_dir = self.conv_dir / ".system_generated" / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_path = self.logs_dir / "transcript.jsonl"
        self.transcript_full_path = self.logs_dir / "transcript_full.jsonl"

    def tearDown(self):
        if self.conv_dir.exists():
            shutil.rmtree(self.conv_dir, ignore_errors=True)

    def test_auto_truncate_transcript_execution(self):
        # Prepare 4 steps:
        # 0: USER_INPUT (must NOT be truncated)
        # 1: PLANNER_RESPONSE (must NOT be truncated)
        # 2: RUN_COMMAND (500 lines - MUST be truncated)
        # 3: SYSTEM (short - must NOT be truncated)
        user_prompt = "Installe les dépendances du projet"
        big_npm_output = "\n".join([f"npm http fetch GET 200 https://registry.npmjs.org/package-{i}" for i in range(300)])
        steps = [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": user_prompt},
            {"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Je lance npm install."},
            {"step_index": 2, "source": "SYSTEM", "type": "RUN_COMMAND", "content": big_npm_output},
            {"step_index": 3, "source": "SYSTEM", "type": "SYSTEM", "content": "All done in 2.4s"},
        ]
        with open(self.transcript_path, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(s) + "\n" for s in steps)

        res = auto_truncate_transcript(self.test_cid, max_lines=40, max_chars=2000)
        self.assertEqual(res["truncated_steps_count"], 1)
        self.assertGreater(res["chars_saved"], 5000)

        # Verify transcript_full.jsonl has the full 300 lines
        self.assertTrue(self.transcript_full_path.exists())
        with open(self.transcript_full_path, "r", encoding="utf-8") as f:
            full_steps = [json.loads(line) for line in f if line.strip()]
        self.assertEqual(len(full_steps[2]["content"].splitlines()), 300)

        # Verify transcript.jsonl has truncated content
        with open(self.transcript_path, "r", encoding="utf-8") as f:
            trunc_steps = [json.loads(line) for line in f if line.strip()]
        self.assertTrue(trunc_steps[2].get("is_truncated"))
        self.assertIn("SORTIE TRONQUÉE", trunc_steps[2]["content"])
        self.assertLess(len(trunc_steps[2]["content"].splitlines()), 50)

        # Verify user prompt and planner response are 100% untouched
        self.assertEqual(trunc_steps[0]["content"], user_prompt)
        self.assertEqual(trunc_steps[1]["content"], "Je lance npm install.")


class TestCompactConversationInPlace(unittest.TestCase):
    def setUp(self):
        self.test_cid = "test-eco-compact-session"
        self.conv_dir = BRAIN_DIR / self.test_cid
        self.logs_dir = self.conv_dir / ".system_generated" / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_path = self.logs_dir / "transcript.jsonl"
        self.transcript_full_path = self.logs_dir / "transcript_full.jsonl"

    def tearDown(self):
        if self.conv_dir.exists():
            shutil.rmtree(self.conv_dir, ignore_errors=True)

    def test_compact_conversation_multi_turn(self):
        # 4 user turns with intermediate tool steps
        steps = [
            # Turn 1
            {"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Question 1"},
            {"step_index": 1, "type": "RUN_COMMAND", "content": "Huge logs from task 1 " * 50},
            {"step_index": 2, "type": "PLANNER_RESPONSE", "content": "Answer 1"},
            # Turn 2
            {"step_index": 3, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Question 2"},
            {"step_index": 4, "type": "RUN_COMMAND", "content": "Huge logs from task 2 " * 50},
            {"step_index": 5, "type": "PLANNER_RESPONSE", "content": "Answer 2"},
            # Turn 3 (recent)
            {"step_index": 6, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Question 3"},
            {"step_index": 7, "type": "RUN_COMMAND", "content": "Recent task 3 log " * 10},
            {"step_index": 8, "type": "PLANNER_RESPONSE", "content": "Answer 3"},
            # Turn 4 (latest)
            {"step_index": 9, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Question 4"},
            {"step_index": 10, "type": "PLANNER_RESPONSE", "content": "Answer 4"},
        ]
        with open(self.transcript_path, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(s) + "\n" for s in steps)

        # Compact keeping last 2 turns (Turns 3 and 4)
        result = compact_conversation_in_place(self.test_cid, preserve_last_n_turns=2)
        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["compacted_steps"], 2)  # Steps 1 and 4
        self.assertGreater(result["tokens_saved"], 100)

        # Check transcript.jsonl
        with open(self.transcript_path, "r", encoding="utf-8") as f:
            compacted_steps = [json.loads(line) for line in f if line.strip()]

        # Old tool outputs are compacted
        self.assertIn("Résultat d'étape archivé dans transcript_full.jsonl", compacted_steps[1]["content"])
        self.assertIn("Résultat d'étape archivé dans transcript_full.jsonl", compacted_steps[4]["content"])

        # Recent tool output (Step 7) is preserved
        self.assertIn("Recent task 3 log", compacted_steps[7]["content"])

        # All user and model messages are preserved
        self.assertEqual(compacted_steps[0]["content"], "Question 1")
        self.assertEqual(compacted_steps[2]["content"], "Answer 1")
        self.assertEqual(compacted_steps[3]["content"], "Question 2")
        self.assertEqual(compacted_steps[9]["content"], "Question 4")


class TestCompactAPI(unittest.TestCase):
    def setUp(self):
        from fastapi import HTTPException

        from app.api.conversations import CompactRequest, compact_session

        self.compact_session = compact_session
        self.CompactRequest = CompactRequest
        self.HTTPException = HTTPException

        self.test_cid = "test-eco-api-session"
        self.conv_dir = BRAIN_DIR / self.test_cid
        self.logs_dir = self.conv_dir / ".system_generated" / "logs"
        self.logs_dir.mkdir(parents=True, exist_ok=True)
        self.transcript_path = self.logs_dir / "transcript.jsonl"

        steps = [
            {"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Hello"},
            {"step_index": 1, "type": "RUN_COMMAND", "content": "Output log line " * 80},
            {"step_index": 2, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "What's next?"},
            {"step_index": 3, "type": "PLANNER_RESPONSE", "content": "Ready."},
        ]
        with open(self.transcript_path, "w", encoding="utf-8") as f:
            f.writelines(json.dumps(s) + "\n" for s in steps)

    def tearDown(self):
        if self.conv_dir.exists():
            shutil.rmtree(self.conv_dir, ignore_errors=True)

    def test_api_compact_valid_session(self):
        res = self.compact_session(
            self.test_cid,
            self.CompactRequest(preserve_last_n_turns=1),
        )
        self.assertEqual(res["status"], "ok")
        self.assertIn("tokens_saved", res)
        self.assertIn("reduction_pct", res)
        self.assertGreater(res["tokens_saved"], 0)

    def test_api_compact_invalid_cid(self):
        with self.assertRaises(self.HTTPException) as ctx:
            self.compact_session(
                "../../bad_id",
                self.CompactRequest(preserve_last_n_turns=1),
            )
        self.assertEqual(ctx.exception.status_code, 400)

    def test_api_compact_non_existent(self):
        with self.assertRaises(self.HTTPException) as ctx:
            self.compact_session(
                "non-existent-session-12345",
                self.CompactRequest(preserve_last_n_turns=1),
            )
        self.assertEqual(ctx.exception.status_code, 404)


if __name__ == "__main__":
    unittest.main()

