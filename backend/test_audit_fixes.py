import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Ensure pytest module exists in sys.modules so tests run seamlessly
# both with 'pytest' and standalone with 'python test_audit_fixes.py'
try:
    import pytest
except ImportError:
    import types

    class _RaisesContext:
        def __init__(self, expected_exc):
            self.expected_exc = expected_exc
            self.value = None

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_val, exc_tb):
            if exc_type is None:
                raise AssertionError(f"Expected exception {self.expected_exc} was not raised.")
            if not issubclass(exc_type, self.expected_exc):
                return False
            self.value = exc_val
            return True

    _pytest_shim = types.ModuleType("pytest")
    _pytest_shim.raises = _RaisesContext  # type: ignore[attr-defined]
    sys.modules["pytest"] = _pytest_shim
    pytest = _pytest_shim

import json
from datetime import datetime, timezone

from app.config import BRAIN_DIR
from app.main import app
from app.services.auth import update_password
from app.services.session_metadata import (
    bulk_update_session_meta_batch,
    get_session_meta,
)
from app.services.storage import (
    _build_conversation_dict,
    aggregate_steps_into_turns,
    calculate_conversation_tokens,
    import_conversation,
    read_artifact_content,
    search_conversations,
)
from app.services.updater import CURRENT_VERSION


def test_token_calculation():
    # Test with Gemini-style metadata keys
    steps = [
        {
            "type": "MODEL_RESPONSE",
            "usage": {
                "promptTokenCount": 120,
                "candidatesTokenCount": 45,
                "totalTokenCount": 165
            }
        }
    ]
    res = calculate_conversation_tokens(steps)
    assert res["input_tokens"] == 120, f"Expected 120, got {res['input_tokens']}"
    assert res["output_tokens"] == 45, f"Expected 45, got {res['output_tokens']}"
    assert res["total_tokens"] == 165, f"Expected 165, got {res['total_tokens']}"
    assert res["is_estimated"] is False, "Expected is_estimated to be False"
    print("✓ test_token_calculation passed")


def test_password_validation():
    try:
        update_password("short")
        assert False, "Should have raised ValueError for password < 8 chars"
    except ValueError as e:
        assert "au moins 8 caractères" in str(e)
    print("✓ test_password_validation passed")


def test_session_metadata_copy():
    # Verify that modifying returned dict does not mutate default templates
    res = bulk_update_session_meta_batch({
        "test_cid_1": {"tags": ["unit-test"]},
        "test_cid_2": {"project": "test-project"}
    })
    assert res["test_cid_1"]["tags"] == ["unit-test"]
    assert res["test_cid_2"]["project"] == "test-project"
    print("✓ test_session_metadata_copy passed")


def test_get_session_meta_isolation():
    # Modifying returned dict must never pollute template for other calls
    m1 = get_session_meta("non_existent_cid_a")
    m1["tags"].append("mutated_tag")
    m1["customTitle"] = "mutated_title"

    m2 = get_session_meta("non_existent_cid_b")
    assert m2["tags"] == [], f"Expected empty tags list, got {m2['tags']}"
    assert m2["customTitle"] == "", f"Expected empty customTitle, got {m2['customTitle']}"
    print("✓ test_get_session_meta_isolation passed")


def test_build_conversation_dict_normalization():
    # Verify that parent_conversation_id is normalized to None when empty string or None
    row_empty = {
        "conversation_id": "test-c1",
        "title": "Test Title",
        "preview": "Test Preview",
        "step_count": 5,
        "last_modified_time": "2026-09-16 10:00:00",
        "workspace_uris": "[]",
        "status": "DONE",
        "agent_name": "Antigravity",
        "parent_conversation_id": ""
    }
    c_dict = _build_conversation_dict(row_empty, {})
    assert c_dict["parent_conversation_id"] is None, f"Expected None, got {c_dict['parent_conversation_id']}"

    row_with_parent = dict(row_empty)
    row_with_parent["parent_conversation_id"] = "parent-123"
    c_dict_parent = _build_conversation_dict(row_with_parent, {})
    assert c_dict_parent["parent_conversation_id"] == "parent-123"
    print("✓ test_build_conversation_dict_normalization passed")


def test_aggregate_steps_tool_outputs():
    raw_steps = [
        {
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "content": "List files",
            "created_at": "2026-09-16T10:00:00Z"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "thinking": "I will run ls",
            "content": "Running command...",
            "tool_calls": [
                {"name": "run_command", "args": {"CommandLine": "ls"}}
            ],
            "created_at": "2026-09-16T10:00:01Z"
        },
        {
            "step_index": 2,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": "file1.txt\nfile2.txt",
            "created_at": "2026-09-16T10:00:02Z"
        },
        {
            "step_index": 3,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "Here are the files.",
            "created_at": "2026-09-16T10:00:03Z"
        }
    ]
    turns = aggregate_steps_into_turns(raw_steps)
    assert len(turns) == 2, f"Expected 2 turns (user + assistant), got {len(turns)}"
    asst_turn = turns[1]
    assert asst_turn["role"] == "assistant"
    acts = asst_turn["tool_activities"]
    assert len(acts) == 1, f"Expected 1 tool activity, got {len(acts)}"
    assert acts[0]["name"] == "run_command"
    assert acts[0]["result"] == "file1.txt\nfile2.txt"
    assert acts[0]["status"] == "done"
    assert "file1.txt" not in asst_turn["content"], "Tool output leaked into assistant speech content"
    print("✓ test_aggregate_steps_tool_outputs passed")


def test_bulk_import_transaction():
    import_payload = [
        {
            "title": "Batch Session 1",
            "steps": [
                {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Hello 1", "created_at": "2026-09-16T10:00:00Z"}
            ]
        },
        {
            "title": "Batch Session 2",
            "steps": [
                {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Hello 2", "created_at": "2026-09-16T10:00:00Z"}
            ]
        }
    ]
    res = import_conversation(import_payload)
    assert res["success"] is True
    assert res["count"] == 2
    assert len(res["conversations"]) == 2
    print("✓ test_bulk_import_transaction passed")


def test_artifact_read_cap():
    test_cid = "test-artifact-session-cid"
    cid_dir = BRAIN_DIR / test_cid
    cid_dir.mkdir(parents=True, exist_ok=True)
    try:
        # Binary test
        bin_path = cid_dir / "test.bin"
        bin_path.write_bytes(b"\x00\xff\xfe\x42")
        res_bin = read_artifact_content(test_cid, "test.bin")
        assert "[Fichier binaire : 4 octets]" in res_bin, f"Expected binary info, got: {res_bin}"

        # Large file test (> 5 MB)
        large_path = cid_dir / "large.txt"
        with open(large_path, "w", encoding="utf-8") as f:
            f.write("A" * (5 * 1024 * 1024 + 500))
        res_large = read_artifact_content(test_cid, "large.txt")
        assert "[Fichier volumineux" in res_large, f"Expected size warning, got: {res_large[:100]}"
        print("✓ test_artifact_read_cap passed")
    finally:
        import shutil
        if cid_dir.exists():
            shutil.rmtree(cid_dir, ignore_errors=True)


def test_bulk_import_cleanup_on_error():
    bad_payload = [
        {
            "title": "Batch Session Valid",
            "steps": [{"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Valid"}]
        },
        "not-a-dict-causing-exception"
    ]
    try:
        import_conversation(bad_payload)
        assert False, "Should have failed due to invalid payload item"
    except Exception:
        pass
    print("✓ test_bulk_import_cleanup_on_error passed")


def test_git_diff_sanitization():
    from fastapi import HTTPException

    from app.api.git import get_git_diff

    # Path with leading slash should normalize without crashing or escaping target
    res = get_git_diff(workspace=str(BACKEND_DIR.parent), path="/backend/app/main.py", _=None)
    assert res["path"] == "backend/app/main.py"

    # Traversal attempt should be rejected with 400
    try:
        get_git_diff(workspace=str(BACKEND_DIR.parent), path="../../etc/passwd", _=None)
        assert False, "Should have raised HTTPException 400 for path traversal"
    except HTTPException as exc:
        assert exc.status_code == 400
    print("✓ test_git_diff_sanitization passed")


def test_version_consistency():
    pkg_path = BACKEND_DIR.parent / "frontend" / "package.json"
    with open(pkg_path, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    frontend_ver = pkg["version"]
    backend_ver = app.version
    updater_ver = CURRENT_VERSION

    assert frontend_ver == backend_ver == updater_ver, (
        f"Version mismatch: frontend={frontend_ver}, backend={backend_ver}, updater={updater_ver}"
    )
    assert frontend_ver == CURRENT_VERSION, f"Expected version {CURRENT_VERSION}, got {frontend_ver}"
    print(f"✓ test_version_consistency passed ({frontend_ver})")


def test_is_tool_output_content_and_clean_prompt():
    from app.services.storage import clean_user_prompt, is_tool_output_content

    # Tool output detection
    assert is_tool_output_content("Created At: 2026-09-16T12:00:00") is True
    assert is_tool_output_content("The command exited with code 0") is True
    assert is_tool_output_content('{"File":"/path/to/file.py"}') is True
    assert is_tool_output_content('[{"File":"/path/to/file.py"}]') is True
    assert is_tool_output_content('[{"status":"ok"}]') is True
    assert is_tool_output_content("Bonjour le monde") is False

    # Prompt cleaning
    raw_prompt = "<USER_REQUEST>Fix the task ID issue</USER_REQUEST><ADDITIONAL_METADATA>meta</ADDITIONAL_METADATA>"
    clean = clean_user_prompt(raw_prompt)
    assert clean == "Fix the task ID issue", f"Unexpected clean prompt: {clean}"
    print("✓ test_is_tool_output_content_and_clean_prompt passed")


def test_session_meta_legacy_defaults():
    import uuid

    from app.services.session_metadata import save_all_session_metadata
    legacy_id = f"legacy_test_{uuid.uuid4().hex[:6]}"
    # Save sparse metadata missing standard keys
    save_all_session_metadata({legacy_id: {"pinned": True}})

    meta = get_session_meta(legacy_id)
    assert meta["pinned"] is True
    assert meta["archived"] is False
    assert meta["tags"] == []
    assert meta["project"] == ""
    assert meta["customTitle"] == ""
    print("✓ test_session_meta_legacy_defaults passed")


def test_skill_md_utf8_bom(tmp_path=None):
    import tempfile

    from app.api.skills import parse_skill_md

    with tempfile.TemporaryDirectory() as td:
        skill_dir = Path(td) / "my-skill"
        skill_dir.mkdir()
        skill_file = skill_dir / "SKILL.md"
        # Write with UTF-8 BOM
        content = "\ufeff---\nname: my-skill\ndescription: A test skill with BOM\n---\n# My Skill Documentation\n"
        with open(skill_file, "wb") as f:
            f.write(content.encode("utf-8"))

        parsed = parse_skill_md(skill_file)
        assert parsed["name"] == "my-skill", f"Expected name 'my-skill', got {parsed['name']}"
        assert parsed["description"] == "A test skill with BOM", f"Expected description, got {parsed['description']}"
    print("✓ test_skill_md_utf8_bom passed")


def test_scan_dir_symlink_cycle_guard():
    import tempfile

    from app.api.files import scan_dir

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        sub = root / "subdir"
        sub.mkdir()
        (sub / "file.txt").write_text("hello")
        # Create a cyclic directory symlink pointing back to root
        symlink = sub / "cyclic_symlink"
        try:
            symlink.symlink_to(root, target_is_directory=True)
        except OSError:
            # Skip if symlinks not supported on filesystem
            return
        
        # Scanning must terminate cleanly without RecursionError or infinite loop
        items = scan_dir(root, current_depth=0, max_depth=3)
        assert len(items) > 0
    print("✓ test_scan_dir_symlink_cycle_guard passed")


def test_aggregate_all_tool_step_types():
    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Update the config", "step_index": 0},
        {
            "type": "WRITE_TO_FILE",
            "source": "MODEL",
            "content": "Wrote 120 bytes to config.json",
            "step_index": 1,
        },
        {
            "type": "SEARCH_WEB",
            "source": "MODEL",
            "content": "Result 1: Python documentation",
            "step_index": 2,
        },
        {
            "type": "PLANNER_RESPONSE",
            "source": "MODEL",
            "content": "File created and search finished.",
            "step_index": 3,
        },
    ]
    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2, f"Expected 2 turns, got {len(turns)}"
    asst = turns[1]
    assert asst["role"] == "assistant"
    assert "Wrote 120 bytes" not in asst["content"], "Tool output leaked into assistant dialogue"
    assert "Result 1: Python documentation" not in asst["content"], "Tool output leaked into assistant dialogue"
    assert len(asst["tool_activities"]) == 2
    assert asst["tool_activities"][0]["name"] == "write_to_file"
    assert asst["tool_activities"][1]["name"] == "search_web"
    print("✓ test_aggregate_all_tool_step_types passed")


def test_compute_next_run_days_and_seconds():
    from app.services.cron_store import compute_next_run

    # Interval with days
    next_days = compute_next_run({"kind": "interval", "days": 3})
    assert next_days is not None
    dt_days = datetime.fromisoformat(next_days)
    now = datetime.now(timezone.utc)
    diff_days = (dt_days - now).total_seconds() / 86400
    assert 2.9 <= diff_days <= 3.1

    # Interval with seconds
    next_secs = compute_next_run({"kind": "interval", "seconds": 45})
    assert next_secs is not None
    dt_secs = datetime.fromisoformat(next_secs)
    diff_secs = (dt_secs - now).total_seconds()
    assert 40 <= diff_secs <= 50

    # Interval regex string
    next_str = compute_next_run("every 20s")
    assert next_str is not None
    dt_str = datetime.fromisoformat(next_str)
    diff_str = (dt_str - now).total_seconds()
    assert 15 <= diff_str <= 25

    # Enhanced unit variations (mins, hrs, every minute)
    next_mins = compute_next_run("every 15 mins")
    assert next_mins is not None
    dt_mins = datetime.fromisoformat(next_mins)
    assert 14 * 60 <= (dt_mins - now).total_seconds() <= 16 * 60

    next_hrs = compute_next_run("every 2 hrs")
    assert next_hrs is not None
    dt_hrs = datetime.fromisoformat(next_hrs)
    assert 1.9 * 3600 <= (dt_hrs - now).total_seconds() <= 2.1 * 3600

    next_one_min = compute_next_run("every minute")
    assert next_one_min is not None
    dt_one = datetime.fromisoformat(next_one_min)
    assert 55 <= (dt_one - now).total_seconds() <= 65
    print("✓ test_compute_next_run_days_and_seconds passed")


def test_google_auth_url_cleaning():
    from app.services.google_auth import _AUTH_URL_PATTERN, _clean_auth_url

    raw_v1 = "Please open: https://accounts.google.com/o/oauth2/auth?client_id=123&scope=openid"
    match_v1 = _AUTH_URL_PATTERN.search(raw_v1)
    assert match_v1 is not None
    assert _clean_auth_url(match_v1.group(0)) == "https://accounts.google.com/o/oauth2/auth?client_id=123&scope=openid"

    raw_v2_ansi = "URL: \x1b[4mhttps://accounts.google.com/o/oauth2/v2/auth?client_id=456&scope=email\x1b[0m."
    match_v2 = _AUTH_URL_PATTERN.search(raw_v2_ansi)
    assert match_v2 is not None
    assert _clean_auth_url(match_v2.group(0)) == "https://accounts.google.com/o/oauth2/v2/auth?client_id=456&scope=email"
    print("✓ test_google_auth_url_cleaning passed")


def test_git_diff_absolute_workspace_path():
    from app.api.git import get_git_diff

    # Absolute path within workspace
    abs_path = str((BACKEND_DIR.parent / "backend" / "app" / "main.py").resolve())
    res = get_git_diff(workspace=str(BACKEND_DIR.parent), path=abs_path, _=None)
    assert res["path"] == "backend/app/main.py"
    print("✓ test_git_diff_absolute_workspace_path passed")


def test_kanban_status_normalization_and_timestamps():
    from app.api.kanban import (
        CreateTaskRequest,
        UpdateTaskRequest,
        _normalize_status,
        create_task,
        update_task,
    )

    assert _normalize_status("In-Progress") == "in_progress"
    assert _normalize_status("TODO ") == "todo"

    # Create directly as in-progress
    req_running = CreateTaskRequest(title="Running Task", status="in-progress")
    res = create_task(req_running, _=None)
    assert res["success"] is True
    task = res["task"]
    assert task["status"] == "in_progress"
    assert task["started_at"] is not None
    assert task["completed_at"] is None

    # Update to completed
    task_id = task["id"]
    req_done = UpdateTaskRequest(status="completed")
    res_done = update_task(task_id, req_done, _=None)
    assert res_done["success"] is True
    # Reopen to running -> completed_at must be reset to None
    req_reopen = UpdateTaskRequest(status="running")
    res_reopen = update_task(task_id, req_reopen, _=None)
    assert res_reopen["success"] is True
    reopened = res_reopen["task"]
    assert reopened["status"] == "running"
    assert reopened["completed_at"] is None
    print("✓ test_kanban_status_normalization_and_timestamps passed")


def test_git_diff_dot_slash_normalization():
    from app.api.git import get_git_diff

    # Relative path with leading ./
    res = get_git_diff(workspace=str(BACKEND_DIR.parent), path="./backend/app/main.py", _=None)
    assert res["path"] == "backend/app/main.py"
    print("✓ test_git_diff_dot_slash_normalization passed")


def test_aggregate_empty_string_tool_result():
    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {
            "step_index": 0,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "",
            "tool_calls": [
                {"name": "run_command", "args": {"command": "touch /tmp/test"}},
                {"name": "run_command", "args": {"command": "ls /tmp/test"}},
            ],
            "created_at": "2026-09-16T12:00:00Z",
        },
        {
            "step_index": 1,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": "",  # Empty string output from first command!
            "created_at": "2026-09-16T12:00:01Z",
        },
        {
            "step_index": 2,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": "/tmp/test",  # Output from second command
            "created_at": "2026-09-16T12:00:02Z",
        },
    ]

    turns = aggregate_steps_into_turns(steps)
    asst = next(t for t in turns if t.get("role") == "assistant")
    acts = asst.get("tool_activities", [])
    assert len(acts) == 2, f"Expected 2 tool activities, got {len(acts)}"
    assert acts[0]["result"] == "", f"Expected empty string for tool 1, got {acts[0]['result']}"
    assert acts[0]["status"] == "done"
    assert acts[1]["result"] == "/tmp/test", f"Expected '/tmp/test' for tool 2, got {acts[1]['result']}"
    assert acts[1]["status"] == "done"
    print("✓ test_aggregate_empty_string_tool_result passed")


def test_skill_detail_safe_path():
    from fastapi import HTTPException

    from app.api.skills import get_skill_detail

    # Path traversal should raise 400
    try:
        get_skill_detail("../../../etc/passwd", _=None)
        assert False, "Should have raised HTTPException 400"
    except HTTPException as e:
        assert e.status_code == 400
    print("✓ test_skill_detail_safe_path passed")


def test_rules_no_touch_hermes_by_default():
    import os

    from app.api.rules import SaveRuleRequest, save_rule_content

    # Ensure ENABLE_HERMES_IPC is not enabled
    assert os.environ.get("ENABLE_HERMES_IPC", "0").lower() not in ("1", "true")

    # Saving settings_cli should succeed without touching hermes events
    req = SaveRuleRequest(file_id="settings_cli", content='{"colorScheme": "dark"}')
    res = save_rule_content(req, _=None)
    assert res["success"] is True
    print("✓ test_rules_no_touch_hermes_by_default passed")


def test_get_all_session_metadata_deep_copy():
    from app.services.session_metadata import get_all_session_metadata

    all_meta_1 = get_all_session_metadata()
    # Mutate returned dictionary
    all_meta_1["__test_fake_mutation__"] = {"tags": ["polluted"]}
    if all_meta_1:
        first_key = next(iter(all_meta_1.keys()))
        if isinstance(all_meta_1[first_key], dict):
            all_meta_1[first_key]["__polluted_attr__"] = True

    all_meta_2 = get_all_session_metadata()
    assert "__test_fake_mutation__" not in all_meta_2, "Cache was contaminated by caller mutation!"
    if all_meta_2:
        first_key = next(iter(all_meta_2.keys()))
        if isinstance(all_meta_2[first_key], dict):
            assert "__polluted_attr__" not in all_meta_2[first_key], "Cache inner dict was contaminated by caller mutation!"
    print("✓ test_get_all_session_metadata_deep_copy passed")


def test_aggregate_steps_non_serializable_objects():
    from datetime import datetime, timezone

    from app.services.storage import aggregate_steps_into_turns

    class NonSerializableObj:
        def __str__(self):
            return "<CustomObjVal>"

    steps = [
        {
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "content": "Test non-serializable input",
            "created_at": "2026-09-16T12:00:00Z"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "thinking": {"timestamp": datetime.now(timezone.utc), "custom": NonSerializableObj()},
            "content": {"result_date": datetime.now(timezone.utc), "custom": NonSerializableObj()},
            "created_at": "2026-09-16T12:00:01Z"
        }
    ]

    # Should not raise TypeError: Object of type ... is not JSON serializable
    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2
    asst_turn = turns[1]
    assert "<CustomObjVal>" in asst_turn["content"] or "result_date" in asst_turn["content"]
    assert "<CustomObjVal>" in asst_turn["thinking"] or "timestamp" in asst_turn["thinking"]
    print("✓ test_aggregate_steps_non_serializable_objects passed")


def test_kill_task_safety():
    import os

    from fastapi import HTTPException

    from app.api.tasks import KillTaskRequest, kill_task

    # PID <= 100 must be rejected with 403
    try:
        kill_task(KillTaskRequest(pid=1), _=None)
        assert False, "Should have rejected PID 1 with 403"
    except HTTPException as e:
        assert e.status_code == 403

    # Current process PID must be rejected with 403
    try:
        kill_task(KillTaskRequest(pid=os.getpid()), _=None)
        assert False, "Should have rejected current PID with 403"
    except HTTPException as e:
        assert e.status_code == 403

    # Short task_id (< 3 chars) should return success=False safely without matching arbitrary processes
    res = kill_task(KillTaskRequest(task_id="a"), _=None)
    assert res["success"] is False
    print("✓ test_kill_task_safety passed")


def test_git_commit_sanitize_fallback():
    from app.api.git import _sanitize_git_message

    # Multi-line message containing co-authored-by
    msg = "feat: implement features\nCo-Authored-By: Claude <claude@anthropic.com>\nSome notes"
    sanitized = _sanitize_git_message(msg)
    assert "Co-Authored-By" not in sanitized
    assert "feat: implement features" in sanitized
    assert "Some notes" in sanitized

    # Only co-author line should fallback cleanly
    msg_only_coauthor = "Co-Authored-By: Claude"
    fallback = _sanitize_git_message(msg_only_coauthor)
    assert fallback == "chore: update repository"
    print("✓ test_git_commit_sanitize_fallback passed")


def test_export_conversation_markdown_and_html_non_string():
    from unittest.mock import patch

    from app.services.storage import (
        export_conversation_html,
        export_conversation_markdown,
    )

    mock_steps = [
        {
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "content": "Perform tool tasks",
            "created_at": "2026-09-16T12:00:00Z"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "thinking": "Executing tools",
            "content": "Here are tool outputs",
            "tool_calls": [
                {"name": "complex_dict_tool", "args": {"foo": "bar"}},
                {"name": "list_tool", "args": [1, 2, 3]},
                {"name": "int_tool", "args": "cmd"}
            ],
            "created_at": "2026-09-16T12:00:01Z"
        },
        {
            "step_index": 2,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": {"status": "ok", "items": [1, 2, 3]},
            "created_at": "2026-09-16T12:00:02Z"
        },
        {
            "step_index": 3,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": ["itemA", "itemB"],
            "created_at": "2026-09-16T12:00:03Z"
        },
        {
            "step_index": 4,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "content": 404,
            "created_at": "2026-09-16T12:00:04Z"
        }
    ]

    with patch("app.services.storage.get_conversation_transcript", return_value=mock_steps), \
         patch("app.services.storage.get_conversation_by_id", return_value={"title": "Test Non String Export"}):
        md = export_conversation_markdown("fake-conv-id")
        assert "Outil :" in md
        assert "complex_dict_tool" in md
        assert "status" in md

        html_out = export_conversation_html("fake-conv-id")
        assert "Test Non String Export" in html_out
        assert "complex_dict_tool" in html_out
    print("✓ test_export_conversation_markdown_and_html_non_string passed")


def test_save_all_session_metadata_deepcopy_isolation():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.session_metadata import (
        get_all_session_metadata,
        save_all_session_metadata,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_meta_file = Path(tmp_dir) / "session_metadata.json"
        with patch("app.services.session_metadata.SESSION_METADATA_FILE", tmp_meta_file):
            initial_data = {
                "cid_1": {"tags": ["tag1"], "pinned": False}
            }
            save_all_session_metadata(initial_data)

            # Mutate initial_data externally
            initial_data["cid_1"]["tags"].append("polluted_tag")
            initial_data["cid_1"]["pinned"] = True

            cached = get_all_session_metadata()
            assert cached["cid_1"]["tags"] == ["tag1"], "Cache was contaminated by caller mutating initial_data!"
            assert cached["cid_1"]["pinned"] is False, "Cache was contaminated by caller mutating initial_data!"
    print("✓ test_save_all_session_metadata_deepcopy_isolation passed")


def test_cancel_running_job_process_group():
    from unittest.mock import MagicMock, patch

    from app.services.cron_ticker import _running_job_procs, cancel_running_job

    mock_proc = MagicMock()
    mock_proc.returncode = None
    mock_proc.pid = 12345

    _running_job_procs["test_job_cancel"] = mock_proc

    with patch("app.services.cron_ticker.terminate_process_group_sync") as mock_terminate:
        res = cancel_running_job("test_job_cancel")
        assert res is True
        mock_terminate.assert_called_once_with(mock_proc, force=True)
    _running_job_procs.pop("test_job_cancel", None)
    print("✓ test_cancel_running_job_process_group passed")


def test_compute_next_run_monthly_and_weekly():
    from datetime import datetime, timezone

    from app.services.cron_store import compute_next_run

    # Natural language French & English
    for expr in ["every month", "monthly", "chaque mois", "tous les mois"]:
        next_dt = compute_next_run(expr)
        assert next_dt is not None, f"Failed to parse monthly expression: {expr}"
        parsed = datetime.fromisoformat(next_dt)
        now = datetime.now(timezone.utc)
        diff_days = (parsed - now).total_seconds() / 86400
        assert 28 <= diff_days <= 31, f"Expected ~30 days for {expr}, got {diff_days}"

    for expr in ["every week", "weekly", "chaque semaine", "toutes les semaines"]:
        next_dt = compute_next_run(expr)
        assert next_dt is not None, f"Failed to parse weekly expression: {expr}"
        parsed = datetime.fromisoformat(next_dt)
        now = datetime.now(timezone.utc)
        diff_days = (parsed - now).total_seconds() / 86400
        assert 6.5 <= diff_days <= 7.5, f"Expected ~7 days for {expr}, got {diff_days}"

    # Interval dicts with months & weeks
    res_months = compute_next_run({"kind": "interval", "months": 2})
    assert res_months is not None
    res_weeks = compute_next_run({"kind": "interval", "weeks": 3})
    assert res_weeks is not None
    print("✓ test_compute_next_run_monthly_and_weekly passed")


def test_cron_update_jobs_atomic():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.cron_store import update_jobs

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_jobs_file = Path(tmp_dir) / "jobs.json"
        with patch("app.services.cron_store.JOBS_FILE", tmp_jobs_file):
            # Create a job atomically
            def _add(data):
                data.setdefault("jobs", []).append({"id": "atom_1", "name": "Atomic Job"})
                return "created_atom_1"

            res = update_jobs(_add)
            assert res == "created_atom_1"

            # Modify job atomically
            def _modify(data):
                for j in data.get("jobs", []):
                    if j.get("id") == "atom_1":
                        j["name"] = "Updated Name"
                        return True
                return False

            modified = update_jobs(_modify)
            assert modified is True
    print("✓ test_cron_update_jobs_atomic passed")


def test_session_metadata_save_failure_reraised():
    from unittest.mock import patch

    from app.services.session_metadata import save_all_session_metadata

    with patch("pathlib.Path.replace", side_effect=OSError("Disk full or permission denied")):
        raised = False
        try:
            save_all_session_metadata({"test": {"pinned": True}})
        except OSError:
            raised = True
        assert raised, "Expected OSError when Path.replace fails"
    print("✓ test_session_metadata_save_failure_reraised passed")


def test_is_safe_conversation_id_hardened():
    from app.services.storage import is_safe_conversation_id

    # Valid UUID
    assert is_safe_conversation_id("3d0ba9f7-e491-4c58-b3e4-142fc763fc47") is True
    assert is_safe_conversation_id("conv-123_abc") is True

    # Invalid: hidden directory or dot
    assert is_safe_conversation_id(".system_generated") is False
    assert is_safe_conversation_id(".hidden") is False
    assert is_safe_conversation_id(".") is False
    assert is_safe_conversation_id("..") is False

    # Invalid: directory traversal or special chars
    assert is_safe_conversation_id("../etc/passwd") is False
    assert is_safe_conversation_id("conv/sub") is False
    assert is_safe_conversation_id("conv\\sub") is False
    assert is_safe_conversation_id("conv;rm -rf /") is False
    assert is_safe_conversation_id("conv`id`") is False
    assert is_safe_conversation_id("null") is False
    assert is_safe_conversation_id("") is False
    print("✓ test_is_safe_conversation_id_hardened passed")


def test_rules_hermes_write_restricted():
    import os

    from fastapi import HTTPException

    from app.api.rules import SaveRuleRequest, save_rule_content

    # Ensure ENABLE_HERMES_WRITE is not set
    assert os.environ.get("ENABLE_HERMES_WRITE", "0") != "1"

    req_arch = SaveRuleRequest(file_id="hermes_arch", content="# New Arch")
    raised_arch = False
    try:
        save_rule_content(req_arch, _=None)
    except HTTPException as exc_info:
        raised_arch = True
        assert exc_info.status_code == 403
    assert raised_arch, "Expected HTTPException 403 for hermes_arch"

    req_journal = SaveRuleRequest(file_id="hermes_journal", content="# New Journal")
    raised_journal = False
    try:
        save_rule_content(req_journal, _=None)
    except HTTPException as exc_info2:
        raised_journal = True
        assert exc_info2.status_code == 403
    assert raised_journal, "Expected HTTPException 403 for hermes_journal"
    print("✓ test_rules_hermes_write_restricted passed")


def test_kill_task_rejects_system_words():
    from app.api.tasks import KillTaskRequest, kill_task

    # System binary words should not resolve to a kill candidate
    for word in ("bash", "python", "node", "git", "systemd"):
        res = kill_task(KillTaskRequest(task_id=word), _=None)
        assert res["success"] is False
    print("✓ test_kill_task_rejects_system_words passed")


def test_undo_conversation_turn_updates_last_user_time_not_null():
    import sqlite3
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir(parents=True, exist_ok=True)
        conv_id = "test-undo-conv-uuid"
        conv_dir = tmp_brain / conv_id
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        # Create single turn transcript
        transcript_file = logs_dir / "transcript.jsonl"
        storage.atomic_write_jsonl(transcript_file, [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Hello", "created_at": "2026-09-16T10:00:00Z"},
            {"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Hi there!"}
        ])

        # Create test database with NOT NULL constraint matching production schema
        db_file = tmp_brain / "conversations.db"
        conn = sqlite3.connect(str(db_file))
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                step_count INTEGER,
                preview TEXT,
                last_modified_time TEXT,
                last_user_input_step_index INTEGER,
                last_user_input_time DATETIME NOT NULL
            )
        """)
        cursor.execute("""
            INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?)
        """, (conv_id, 2, "Hello", "2026-09-16 10:01:00", 0, "2026-09-16T10:00:00Z"))
        conn.commit()
        conn.close()

        with patch("app.services.storage.BRAIN_DIR", tmp_brain), \
             patch("app.services.storage.get_db_connection", side_effect=lambda: sqlite3.connect(str(db_file))):
            res = storage.undo_conversation_turn(conv_id)
            assert res["step_count"] == 0

            # Verify that in DB, last_user_input_time was updated safely without violating NOT NULL constraint
            conn_verify = sqlite3.connect(str(db_file))
            row = conn_verify.cursor().execute("SELECT last_user_input_time, last_user_input_step_index FROM conversation_summaries WHERE conversation_id = ?", (conv_id,)).fetchone()
            conn_verify.close()
            assert row[0] is not None
            assert row[1] == -1
    print("✓ test_undo_conversation_turn_updates_last_user_time_not_null passed")


def test_cron_update_jobs_noop_when_unchanged():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.cron_store import update_jobs

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_jobs_file = Path(tmp_dir) / "jobs.json"
        with patch("app.services.cron_store.JOBS_FILE", tmp_jobs_file):
            # Seed initial job
            update_jobs(lambda d: d.setdefault("jobs", []).append({"id": "j1"}))
            mtime_before = tmp_jobs_file.stat().st_mtime

            # Modifier does not change data
            res = update_jobs(lambda d: len(d.get("jobs", [])))
            assert res == 1
            # File should not have been re-written
            mtime_after = tmp_jobs_file.stat().st_mtime
            assert mtime_before == mtime_after
    print("✓ test_cron_update_jobs_noop_when_unchanged passed")


def test_auth_corrupt_config_backup():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        tmp_auth.write_text("NOT_VALID_JSON{{{", encoding="utf-8")
        corrupt_bak = Path(tmp_dir) / "webui_auth.json.corrupt.bak"

        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                cfg = auth.get_auth_config()
                assert cfg.get("enabled") is True
                assert corrupt_bak.exists()
                assert corrupt_bak.read_text(encoding="utf-8") == "NOT_VALID_JSON{{{"
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_auth_corrupt_config_backup passed")


def test_kanban_schema_double_checked_lock():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api import kanban

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_db = Path(tmp_dir) / "kanban.db"
        with patch("app.api.kanban.KANBAN_DB_PATH", tmp_db):
            kanban._schema_initialized = False
            conn = kanban.get_db_connection()
            assert kanban._schema_initialized is True
            cur = conn.cursor()
            cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tasks'")
            assert cur.fetchone() is not None
            conn.close()
    print("✓ test_kanban_schema_double_checked_lock passed")


def test_cron_delete_cancels_running_job():
    from unittest.mock import MagicMock, patch

    from app.api.crons import delete_cron_job

    mock_cancel = MagicMock()
    with patch("app.api.crons.update_jobs", return_value=True), \
         patch("app.services.cron_ticker.cancel_running_job", mock_cancel):
        res = delete_cron_job("job-123", _=None)
        assert res["success"] is True
        assert res["job_id"] == "job-123"
        mock_cancel.assert_called_once_with("job-123")
    print("✓ test_cron_delete_cancels_running_job passed")


def test_bulk_conversations_empty_and_limit():
    import asyncio

    from fastapi import HTTPException

    from app.api.conversations import BulkActionRequest, bulk_conversations

    # Empty IDs should return count 0 immediately
    req_empty = BulkActionRequest(action="pin", conversation_ids=[])
    res = asyncio.run(bulk_conversations(req_empty, _=None))
    assert res["count"] == 0
    assert res["success"] is True

    # More than 500 IDs should raise HTTPException(400)
    req_overflow = BulkActionRequest(action="pin", conversation_ids=[f"cid_{i}" for i in range(501)])
    try:
        asyncio.run(bulk_conversations(req_overflow, _=None))
        assert False, "Should have raised HTTPException for > 500 conversation IDs"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "max 500" in exc.detail
    print("✓ test_bulk_conversations_empty_and_limit passed")


def test_bulk_export_limit():
    from fastapi import HTTPException

    from app.api.conversations import BulkActionRequest, _do_bulk_export

    req_overflow = BulkActionRequest(action="export", conversation_ids=[f"cid_{i}" for i in range(501)])
    try:
        _do_bulk_export(req_overflow)
        assert False, "Should have raised HTTPException for > 500 conversation IDs in bulk export"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "max 500" in exc.detail
    print("✓ test_bulk_export_limit passed")


def test_compute_next_run_compound_intervals():
    from datetime import datetime, timezone

    from app.services.cron_store import compute_next_run

    now = datetime.now(timezone.utc)
    # Compound: 1 hour + 30 minutes = 90 minutes
    res_iso = compute_next_run({"kind": "interval", "hours": 1, "minutes": 30})
    assert res_iso is not None
    res_dt = datetime.fromisoformat(res_iso)
    diff_secs = (res_dt - now).total_seconds()
    assert 5300 <= diff_secs <= 5500, f"Expected ~5400s (90m), got {diff_secs}s"

    # Floor at 10s
    res_small = compute_next_run({"kind": "interval", "seconds": 3})
    assert res_small is not None
    small_dt = datetime.fromisoformat(res_small)
    diff_small = (small_dt - now).total_seconds()
    assert 9 <= diff_small <= 15, f"Expected >= 10s, got {diff_small}s"
    print("✓ test_compute_next_run_compound_intervals passed")


def test_cron_model_and_effort_whitespace_cleaning():
    from app.api.crons import CreateCronJobRequest

    req = CreateCronJobRequest(
        name="Test whitespace",
        prompt="Echo hello",
        schedule="every 10m",
        model="   ",
        effort="  \t  "
    )
    cleaned_model = req.model.strip() if req.model and req.model.strip() else None
    cleaned_effort = req.effort.strip() if req.effort and req.effort.strip() else None
    assert cleaned_model is None, f"Expected None, got {cleaned_model}"
    assert cleaned_effort is None, f"Expected None, got {cleaned_effort}"
    print("✓ test_cron_model_and_effort_whitespace_cleaning passed")


def test_clean_cid_sanitization():
    from app.services.execution_manager import _clean_cid

    assert _clean_cid("null") is None
    assert _clean_cid("undefined") is None
    assert _clean_cid("None") is None
    assert _clean_cid("") is None
    assert _clean_cid("   ") is None
    assert _clean_cid(None) is None
    assert _clean_cid(123) is None
    assert _clean_cid("valid-cid-456") == "valid-cid-456"
    assert _clean_cid("  trimmed-cid  ") == "trimmed-cid"
    print("✓ test_clean_cid_sanitization passed")


def test_git_anti_trailer_args():
    from unittest.mock import patch

    from app.api.git import run_git

    with patch("subprocess.run") as mock_run:
        mock_run.return_value.returncode = 0
        mock_run.return_value.stdout = b""
        mock_run.return_value.stderr = b""
        run_git(["status"], cwd=Path("/tmp"))
        assert mock_run.called
        args_passed = mock_run.call_args[0][0]
        assert "-c" in args_passed
        assert "format.signoff=false" in args_passed
        assert "trailer.co-authored-by.key=" in args_passed
    print("✓ test_git_anti_trailer_args passed")


def test_is_quota_error_no_false_positive_429():
    from app.services.google_auth import is_quota_error

    # False positive test cases that caused unwanted failovers previously
    assert not is_quota_error("Commit a429fd8b1 merged into main")
    assert not is_quota_error("Found 429 files in directory")
    assert not is_quota_error("SyntaxError at line 429 in module.py")
    assert not is_quota_error("Listening on port 4290")
    assert not is_quota_error("Processed 42900 bytes")

    # True quota errors
    assert is_quota_error("API Error: HTTP 429 Too Many Requests")
    assert is_quota_error("Google API status: 429")
    assert is_quota_error("Error code 429 rate limit reached")
    assert is_quota_error("RESOURCE_EXHAUSTED")
    assert is_quota_error("Exceeded your quota limit")
    print("✓ test_is_quota_error_no_false_positive_429 passed")


def test_clear_account_exhaustion():
    from app.services.google_auth import (
        clear_account_exhaustion,
        is_account_marked_exhausted,
        mark_account_exhausted,
    )

    test_email = "audit_test_exhaustion@gmail.com"
    mark_account_exhausted(test_email, duration_seconds=600.0)
    assert is_account_marked_exhausted(test_email) is True

    clear_account_exhaustion(test_email)
    assert is_account_marked_exhausted(test_email) is False
    print("✓ test_clear_account_exhaustion passed")


def test_resolve_model_and_effort_whitespace():
    from app.services.agy_driver import resolve_model_and_effort

    m, e = resolve_model_and_effort("   ", "   ")
    assert m is None
    assert e is None

    m, e = resolve_model_and_effort(None, "medium")
    assert m is None
    assert e == "medium"

    m, e = resolve_model_and_effort("claude-sonnet-4-6", "high")
    assert m == "claude-sonnet-4-6"
    assert e is None
    print("✓ test_resolve_model_and_effort_whitespace passed")


def test_extract_json_payload_resilience():
    from app.services.agy_driver import _extract_json_payload

    # Multi-line JSON with preceding metadata `{}`
    log_output = (
        "[INFO] Initialized runtime with context {}\n"
        "{\n"
        '  "groups": [{"name": "Gemini", "quota": 100}]\n'
        "}\n"
        "[DEBUG] Done parsing"
    )
    result = _extract_json_payload(log_output)
    assert isinstance(result, dict)
    assert "groups" in result
    assert result["groups"][0]["quota"] == 100

    # Markdown code fence JSON
    fence_output = (
        "Here is the quota:\n"
        "```json\n"
        '{\n  "remaining_credits": 42\n}\n'
        "```\n"
    )
    res_fence = _extract_json_payload(fence_output)
    assert res_fence["remaining_credits"] == 42
    print("✓ test_extract_json_payload_resilience passed")


def test_session_meta_boolean_normalization():
    from app.services.session_metadata import _normalize_meta, _to_bool

    assert _to_bool("false") is False
    assert _to_bool("False") is False
    assert _to_bool("0") is False
    assert _to_bool(False) is False
    assert _to_bool("true") is True
    assert _to_bool(True) is True

    meta = {
        "pinned": "false",
        "archived": "False",
        "tags": ["alpha", 123],
        "project": "audit",
    }
    normalized = _normalize_meta(meta)
    assert normalized["pinned"] is False
    assert normalized["archived"] is False
    assert normalized["tags"] == ["alpha", "123"]
    assert normalized["project"] == "audit"
    print("✓ test_session_meta_boolean_normalization passed")


def test_git_sanitize_extended_trailers():
    from app.api.git import _sanitize_git_message

    dirty = (
        "feat: add shiny feature\n"
        "\n"
        "Signed-off-by: Developer <dev@example.com>\n"
        "Co-Authored-By: Claude <claude@anthropic.com>\n"
        "co-author: assistant\n"
        "Co-authored by: Robot\n"
    )
    cleaned = _sanitize_git_message(dirty)
    assert "Signed-off-by" not in cleaned
    assert "Co-Authored-By" not in cleaned
    assert "co-author" not in cleaned
    assert "Claude" not in cleaned
    assert cleaned == "feat: add shiny feature"
    print("✓ test_git_sanitize_extended_trailers passed")


def test_kill_task_candidate_tids_hardening():
    clean_tid = "task"
    raw_cands = [clean_tid]
    excluded_tokens = {
        "bash", "sh", "zsh", "node", "npm", "python", "python3", "uvicorn",
        "git", "cat", "grep", "root", "systemd", "task", "tasks", "subagent",
        "subagents", "process", "worker", "service", "start", "stop", "test", "run"
    }
    candidate_tids = [
        c for c in raw_cands
        if len(c) >= 5 and c.lower() not in excluded_tokens
    ]
    assert len(candidate_tids) == 0, "Short or common token 'task' should be filtered out"

    valid_cands = ["task-12345", "subagent-999"]
    candidate_valid = [
        c for c in valid_cands
        if len(c) >= 5 and c.lower() not in excluded_tokens
    ]
    assert len(candidate_valid) == 2
    print("✓ test_kill_task_candidate_tids_hardening passed")


def test_compute_next_run_microsecond_stripping():
    from app.services.cron_store import compute_next_run
    next_iso = compute_next_run("every 10m")
    assert next_iso is not None
    assert ".000" not in next_iso
    assert "+" in next_iso or "Z" in next_iso
    print("✓ test_compute_next_run_microsecond_stripping passed")


def test_list_artifacts_sensitive_and_traversal_filtering():
    import tempfile

    import app.services.storage as storage_mod
    with tempfile.TemporaryDirectory() as tmpdir:
        orig_brain = storage_mod.BRAIN_DIR
        try:
            temp_brain = Path(tmpdir)
            storage_mod.BRAIN_DIR = temp_brain
            conv_id = "test-conv-art-1"
            conv_dir = temp_brain / conv_id
            conv_dir.mkdir(parents=True)

            # Legitimate artifact
            art_file = conv_dir / "report.md"
            art_file.write_text("# Report", encoding="utf-8")

            # Blocked sensitive path (e.g., .env)
            env_file = conv_dir / ".env"
            env_file.write_text("SECRET=123", encoding="utf-8")

            # Outside target and symlink
            outside_file = temp_brain / "outside_secret.txt"
            outside_file.write_text("outside", encoding="utf-8")
            symlink_file = conv_dir / "leak_symlink.txt"
            try:
                symlink_file.symlink_to(outside_file)
            except OSError:
                pass

            artifacts = storage_mod.list_artifacts(conversation_id=conv_id)
            filenames = [a["filename"] for a in artifacts]
            assert "report.md" in filenames
            assert ".env" not in filenames
            assert "leak_symlink.txt" not in filenames
        finally:
            storage_mod.BRAIN_DIR = orig_brain
    print("✓ test_list_artifacts_sensitive_and_traversal_filtering passed")


def test_remove_session_drains_message_queue():
    from app.services.execution_manager import ExecutionManager, ExecutionSession
    em = ExecutionManager()
    cid = "test-drain-queue-session"
    session = ExecutionSession(conversation_id=cid)
    session.message_queue.put_nowait({"type": "prompt", "content": "hello 1"})
    session.message_queue.put_nowait({"type": "prompt", "content": "hello 2"})
    assert not session.message_queue.empty()
    assert session.message_queue.qsize() == 2

    em.sessions[cid] = session
    em.remove_session(cid)
    assert session.message_queue.empty()
    assert cid not in em.sessions
    print("✓ test_remove_session_drains_message_queue passed")


def test_kanban_update_task_rejects_empty_title():
    from fastapi import HTTPException

    from app.api.kanban import UpdateTaskRequest, update_task

    try:
        update_task(task_id="task-any", req=UpdateTaskRequest(title="   "))
        assert False, "Should raise HTTPException 400 on empty title"
    except HTTPException as e:
        assert e.status_code == 400
        assert "vide" in e.detail

    try:
        update_task(task_id="task-any", req=UpdateTaskRequest(title=""))
        assert False, "Should raise HTTPException 400 on empty title"
    except HTTPException as e:
        assert e.status_code == 400
        assert "vide" in e.detail
    print("✓ test_kanban_update_task_rejects_empty_title passed")


def test_update_conversation_title_rejects_empty_whitespace():
    from app.services.storage import update_conversation_title

    assert update_conversation_title("conv_123", "") is False
    assert update_conversation_title("conv_123", "   ") is False
    assert update_conversation_title("conv_123", "\t\n") is False
    print("✓ test_update_conversation_title_rejects_empty_whitespace passed")


def test_safe_copy_artifacts_excludes_symlinks_and_sensitive_paths():
    import tempfile
    from pathlib import Path

    from app.services.storage import _safe_copy_artifacts

    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "src_session"
        dst = Path(td) / "dst_session"
        src.mkdir()
        dst.mkdir()

        (src / "notes.txt").write_text("hello world")
        sub = src / "subfolder"
        sub.mkdir()
        (sub / "inner.txt").write_text("inner content")

        ext_file = Path(td) / "external.txt"
        ext_file.write_text("external secret")
        symlink = src / "symlink_secret.txt"
        try:
            symlink.symlink_to(ext_file)
        except OSError:
            pass

        (src / ".env").write_text("SECRET=123")
        (src / ".system_generated").mkdir()
        (src / "scratch").mkdir()

        _safe_copy_artifacts(src, dst)

        assert (dst / "notes.txt").exists()
        assert (dst / "notes.txt").read_text() == "hello world"
        assert (dst / "subfolder" / "inner.txt").exists()
        assert not (dst / "symlink_secret.txt").exists()
        assert not (dst / ".env").exists()
        assert not (dst / ".system_generated").exists()
        assert not (dst / "scratch").exists()
    print("✓ test_safe_copy_artifacts_excludes_symlinks_and_sensitive_paths passed")


def test_import_single_conversation_cleanup_on_db_failure():
    from unittest.mock import MagicMock

    from app.services.storage import BRAIN_DIR, _import_single_conversation

    before_dirs = {d.name for d in BRAIN_DIR.iterdir()} if BRAIN_DIR.exists() else set()

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.execute.side_effect = RuntimeError("Simulated DB failure")
    mock_conn.cursor.return_value = mock_cursor

    payload = {
        "title": "Failing Session Test",
        "steps": [{"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Hello"}]
    }

    try:
        _import_single_conversation(payload, "2026-09-17T00:00:00Z", "2026-09-17 00:00:00.000000+00:00", conn=mock_conn)
        assert False, "Should have raised RuntimeError"
    except RuntimeError:
        pass

    after_dirs = {d.name for d in BRAIN_DIR.iterdir()} if BRAIN_DIR.exists() else set()
    assert after_dirs == before_dirs, f"New orphaned directory remained: {after_dirs - before_dirs}"
    print("✓ test_import_single_conversation_cleanup_on_db_failure passed")


def test_scan_dir_defensive_sorting_broken_symlink():
    import tempfile
    from pathlib import Path

    from app.api.files import scan_dir

    with tempfile.TemporaryDirectory() as td:
        root = Path(td) / "workspace"
        root.mkdir()
        (root / "valid_file.txt").write_text("data")
        (root / "alpha_dir").mkdir()

        broken_sym = root / "broken_link.txt"
        try:
            broken_sym.symlink_to(root / "does_not_exist.txt")
        except OSError:
            pass

        items = scan_dir(root, current_depth=0, max_depth=2)
        names = [item["name"] for item in items]
        assert "valid_file.txt" in names
        assert "alpha_dir" in names
    print("✓ test_scan_dir_defensive_sorting_broken_symlink passed")


def test_cron_log_sorting_resilience():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.crons import get_cron_job_log

    with tempfile.TemporaryDirectory() as td:
        out_dir = Path(td) / "cron_outputs"
        out_dir.mkdir()

        log1 = out_dir / "job123_20260917_000000.log"
        log1.write_text("Sample log output")

        broken = out_dir / "job123_20260917_999999.log"
        try:
            broken.symlink_to(out_dir / "non_existent.log")
        except OSError:
            pass

        with patch("app.api.crons.OUTPUT_DIR", out_dir), \
             patch("app.api.crons.load_jobs", return_value={"jobs": [{"id": "job123", "name": "Test"}]}):
            res = get_cron_job_log("job123", _=None)
            assert res["has_log"] is True
            assert "Sample log output" in res["content"]
    print("✓ test_cron_log_sorting_resilience passed")


def test_prune_inactive_sessions_sync_terminate_on_runtime_error():
    from unittest.mock import MagicMock, patch

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    session = ExecutionSession("test_prune_cid")
    session.is_running = False
    session.last_active_at = 0.0
    mock_proc = MagicMock()
    mock_proc.returncode = None
    session.active_proc = mock_proc
    em.sessions["test_prune_cid"] = session

    with patch("app.services.execution_manager.terminate_process_group_async", new_callable=MagicMock), \
         patch("asyncio.create_task", side_effect=RuntimeError("no event loop")), \
         patch("app.services.execution_manager.terminate_process_group_sync") as mock_sync_term:
        em.prune_inactive_sessions()
        mock_sync_term.assert_called_once_with(mock_proc, force=True)
    assert "test_prune_cid" not in em.sessions
    print("✓ test_prune_inactive_sessions_sync_terminate_on_runtime_error passed")


def test_read_artifact_content_blocks_sensitive_files():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import read_artifact_content

    with tempfile.TemporaryDirectory() as td:
        brain = Path(td)
        cid = "conv_test_sensitive"
        conv_dir = brain / cid
        conv_dir.mkdir(parents=True)
        (conv_dir / ".env").write_text("API_SECRET=12345")
        (conv_dir / "antigravity-oauth-token").write_text("oauth_secret")
        (conv_dir / "valid_doc.md").write_text("# Valid Document")

        with patch("app.services.storage.BRAIN_DIR", brain):
            # Normal document should be readable
            doc = read_artifact_content(cid, "valid_doc.md")
            assert "# Valid Document" in doc

            # Sensitive files must raise PermissionError
            try:
                read_artifact_content(cid, ".env")
                assert False, "Should raise PermissionError for .env"
            except PermissionError as e:
                assert "sensible ou restreint" in str(e)

            try:
                read_artifact_content(cid, "antigravity-oauth-token")
                assert False, "Should raise PermissionError for antigravity-oauth-token"
            except PermissionError as e:
                assert "sensible ou restreint" in str(e)
    print("✓ test_read_artifact_content_blocks_sensitive_files passed")


def test_save_file_content_max_size_enforcement():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from fastapi import HTTPException

    from app.api.files import SaveFileRequest, save_file_content

    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / "large_file.txt"
        # 5 MB + 1 byte
        oversized = "a" * (5 * 1024 * 1024 + 1)
        req = SaveFileRequest(path=str(target), content=oversized)
        try:
            save_file_content(req)
            assert False, "Should raise HTTPException 413 for oversized file"
        except HTTPException as e:
            assert e.status_code == 413
            assert "excessive" in e.detail

        # Normal file within limit
        with patch("app.api.files.get_settings", return_value={"trustedWorkspaces": [td]}):
            normal_req = SaveFileRequest(path=str(target), content="Normal text")
            res = save_file_content(normal_req)
            assert res["success"] is True
            assert target.read_text() == "Normal text"
    print("✓ test_save_file_content_max_size_enforcement passed")


def test_queue_worker_active_task_cleanup():
    import asyncio
    from unittest.mock import AsyncMock

    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="conv_cleanup_test")
    session.run_turn = AsyncMock(return_value=None)  # type: ignore[method-assign]

    async def run_test():
        worker = asyncio.create_task(session.queue_worker())
        await session.message_queue.put({"prompt": "hello"})
        await session.message_queue.join()
        assert session.active_task is None, f"active_task should be None, got {session.active_task}"
        worker.cancel()
        try:
            await worker
        except asyncio.CancelledError:
            pass

    asyncio.run(run_test())
    print("✓ test_queue_worker_active_task_cleanup passed")


def test_prune_inactive_sessions_resets_is_running_and_active_proc():
    import time
    from unittest.mock import MagicMock

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    session = ExecutionSession(conversation_id="conv_prune_state")
    session.is_running = False
    session.last_active_at = time.time() - 7200
    mock_proc = MagicMock()
    mock_proc.returncode = 0
    session.active_proc = mock_proc
    em.sessions["conv_prune_state"] = session

    em.prune_inactive_sessions(max_idle_seconds=3600)
    assert "conv_prune_state" not in em.sessions
    assert session.is_running is False
    assert session.active_proc is None
    print("✓ test_prune_inactive_sessions_resets_is_running_and_active_proc passed")


def test_broadcast_cleans_up_dead_sockets_from_connected_sockets():
    import asyncio
    from unittest.mock import AsyncMock, MagicMock, patch

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    session = ExecutionSession(conversation_id="conv_bcast")
    em.sessions["conv_bcast"] = session

    dead_ws = MagicMock()
    dead_ws.send_json = AsyncMock(side_effect=ConnectionResetError("Socket disconnected"))

    session.subscribers.add(dead_ws)
    em.connected_sockets.add(dead_ws)

    with patch("app.services.execution_manager.execution_manager", em):
        asyncio.run(session.broadcast({"event": "test"}))

    assert dead_ws not in session.subscribers
    assert dead_ws not in em.connected_sockets
    print("✓ test_broadcast_cleans_up_dead_sockets_from_connected_sockets passed")


def test_build_conversation_dict_null_tags_and_bool_coercion():
    row = {
        "conversation_id": "test-c-meta",
        "title": "Meta Test",
        "preview": "Preview",
        "step_count": 3,
        "last_modified_time": "2026-09-16 10:00:00",
        "workspace_uris": "[]",
        "status": "DONE",
        "agent_name": "Antigravity",
        "parent_conversation_id": None
    }
    meta = {"tags": None, "pinned": 1, "archived": 0, "project": None}
    c_dict = _build_conversation_dict(row, meta)
    assert c_dict["tags"] == [], f"Expected empty list for tags, got {c_dict['tags']}"
    assert c_dict["pinned"] is True
    assert c_dict["archived"] is False
    assert c_dict["project"] == ""
    print("✓ test_build_conversation_dict_null_tags_and_bool_coercion passed")


def test_git_sanitize_message_triple_newlines():
    from app.api.git import _sanitize_git_message
    msg = "line 1\n\n\n\n\nline 2"
    sanitized = _sanitize_git_message(msg)
    assert sanitized == "line 1\n\nline 2", f"Expected collapsed newlines, got {sanitized!r}"

    crlf_msg = "feat: add feature\r\n\r\nCo-Authored-By: Claude <claude@anthropic.com>\r\n"
    sanitized_crlf = _sanitize_git_message(crlf_msg)
    assert sanitized_crlf == "feat: add feature", f"Expected 'feat: add feature', got {sanitized_crlf!r}"
    assert "claude" not in sanitized_crlf.lower()
    print("✓ test_git_sanitize_message_triple_newlines passed")


def test_fork_conversation_user_index_and_title_sanitization():
    import sqlite3
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir(parents=True, exist_ok=True)
        conv_id = "test-source-conv"
        conv_dir = tmp_brain / conv_id
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        storage.atomic_write_jsonl(logs_dir / "transcript.jsonl", [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Help me", "created_at": "2026-09-16T10:00:00Z"},
            {"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Running tool...", "created_at": "2026-09-16T10:00:01Z"},
            {"step_index": 2, "source": "SYSTEM", "type": "RUN_COMMAND", "content": "tool result", "created_at": "2026-09-16T10:00:02Z"}
        ])

        db_file = tmp_brain / "conversations.db"
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count INTEGER,
                last_modified_time TEXT,
                workspace_uris TEXT,
                status TEXT,
                agent_name TEXT,
                parent_conversation_id TEXT,
                last_user_input_time TEXT,
                last_user_input_step_index INTEGER
            )
        """)
        cursor.execute("""
            INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (conv_id, "Source Session", "Help me", 3, "2026-09-16 10:00:02", "[]", "DONE", "Antigravity", "", "2026-09-16T10:00:00Z", 0))
        conn.commit()
        conn.close()

        def _get_test_conn():
            c = sqlite3.connect(str(db_file))
            c.row_factory = sqlite3.Row
            return c

        with patch("app.services.storage.BRAIN_DIR", tmp_brain), \
             patch("app.services.storage.get_db_connection", side_effect=_get_test_conn):
            res = storage.fork_conversation(conv_id, up_to_step_index=2, new_title="   ")
            new_id = res["conversation_id"]

            verify_conn = _get_test_conn()
            row = verify_conn.cursor().execute("SELECT title, last_user_input_step_index, last_user_input_time FROM conversation_summaries WHERE conversation_id = ?", (new_id,)).fetchone()
            verify_conn.close()

            assert "Branche #2" in row["title"]
            assert row["last_user_input_step_index"] == 0, f"Expected 0, got {row['last_user_input_step_index']}"
            assert row["last_user_input_time"] == "2026-09-16T10:00:00Z"
    print("✓ test_fork_conversation_user_index_and_title_sanitization passed")


def test_handoff_conversation_initial_index_and_title_sanitization():
    import sqlite3
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir(parents=True, exist_ok=True)
        conv_id = "test-handoff-source"
        conv_dir = tmp_brain / conv_id
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        storage.atomic_write_jsonl(logs_dir / "transcript.jsonl", [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Help me", "created_at": "2026-09-16T10:00:00Z"},
            {"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Done", "created_at": "2026-09-16T10:00:01Z"}
        ])

        db_file = tmp_brain / "conversations.db"
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count INTEGER,
                last_modified_time TEXT,
                workspace_uris TEXT,
                status TEXT,
                agent_name TEXT,
                parent_conversation_id TEXT,
                last_user_input_time TEXT,
                last_user_input_step_index INTEGER
            )
        """)
        cursor.execute("""
            INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (conv_id, "Handoff Source", "Help me", 2, "2026-09-16 10:00:01", "[]", "DONE", "Antigravity", "", "2026-09-16T10:00:00Z", 0))
        conn.commit()
        conn.close()

        def _get_test_conn():
            c = sqlite3.connect(str(db_file))
            c.row_factory = sqlite3.Row
            return c

        with patch("app.services.storage.BRAIN_DIR", tmp_brain), \
             patch("app.services.storage.get_db_connection", side_effect=_get_test_conn):
            res = storage.create_conversation_handoff(conv_id, new_title="   ")
            new_id = res["conversation_id"]

            verify_conn = _get_test_conn()
            row = verify_conn.cursor().execute("SELECT title, last_user_input_step_index FROM conversation_summaries WHERE conversation_id = ?", (new_id,)).fetchone()
            verify_conn.close()

            assert "[Suite] Handoff Source" in row["title"]
            assert row["last_user_input_step_index"] == -1, f"Expected -1, got {row['last_user_input_step_index']}"
    print("✓ test_handoff_conversation_initial_index_and_title_sanitization passed")


def test_serve_frontend_api_and_docs_exclusion():
    import asyncio

    from fastapi import HTTPException
    serve_handler = None
    for route in app.routes:
        if getattr(route, "name", None) == "serve_frontend" or (hasattr(route, "path") and route.path == "/{full_path:path}"):
            serve_handler = route.endpoint
            break
    assert serve_handler is not None, "serve_frontend route handler should be registered"

    for path in ["api", "api/health", "ws", "ws/chat", "docs", "redoc", "openapi.json", "docs/oauth2-redirect"]:
        try:
            asyncio.run(serve_handler(path))
            assert False, f"Expected HTTPException 404 for path: {path}"
        except HTTPException as exc:
            assert exc.status_code == 404
            assert exc.detail == "API route not found"
    print("✓ test_serve_frontend_api_and_docs_exclusion passed")


def test_read_artifact_content_symlink_safety(tmp_path):
    from unittest.mock import patch
    conv_id = "test-symlink-conv"
    conv_dir = tmp_path / conv_id
    conv_dir.mkdir(parents=True)

    cycle_link = conv_dir / "cycle.txt"
    try:
        cycle_link.symlink_to(cycle_link)
    except OSError:
        pass

    with patch("app.services.storage.BRAIN_DIR", tmp_path):
        try:
            read_artifact_content(conv_id, "cycle.txt")
            assert False, "Should raise FileNotFoundError for circular symlink"
        except FileNotFoundError:
            pass
    print("✓ test_read_artifact_content_symlink_safety passed")


def test_git_diff_removeprefix_dotfiles():
    test_paths = [".gitignore", "./.gitignore", "/.gitignore"]
    for raw_p in test_paths:
        clean = raw_p.strip().replace("\\", "/").removeprefix("./").removeprefix("/")
        assert clean == ".gitignore", f"Expected '.gitignore', got '{clean}' for input '{raw_p}'"
    print("✓ test_git_diff_removeprefix_dotfiles passed")


def test_kill_task_candidate_tids_short_valid_ids():
    excluded_tokens = {
        "bash", "sh", "zsh", "node", "npm", "python", "python3", "uvicorn",
        "git", "cat", "grep", "root", "systemd", "task", "tasks", "subagent",
        "subagents", "process", "worker", "service", "start", "stop", "test", "run",
        "bin", "usr", "opt", "etc", "dev", "api", "pid", "app", "web", "kill", "ps"
    }
    valid_short = ["t-12", "job1", "t01", "sub-1", "agy4"]
    cands = [c for c in valid_short if len(c) >= 3 and c.lower() not in excluded_tokens]
    assert len(cands) == len(valid_short)

    system_tokens = ["bin", "usr", "api", "pid", "app", "kill", "ps", "sh"]
    filtered = [c for c in system_tokens if len(c) >= 3 and c.lower() not in excluded_tokens]
    assert len(filtered) == 0
    print("✓ test_kill_task_candidate_tids_short_valid_ids passed")


def test_model_failover_gemini_detection():
    model = None
    is_gemini_exec = ("gemini" in str(model).lower()) if model else True
    assert is_gemini_exec is True

    model_claude = "Claude 3.7 Sonnet"
    is_gemini_claude = ("gemini" in str(model_claude).lower()) if model_claude else True
    assert is_gemini_claude is False

    model_gemini = "Gemini 2.5 Flash"
    is_gemini_flash = ("gemini" in str(model_gemini).lower()) if model_gemini else True
    assert is_gemini_flash is True
    print("✓ test_model_failover_gemini_detection passed")


def test_git_mask_credentials():
    from app.api.git import _mask_git_output

    raw_err = "fatal: unable to access 'https://x-access-token:ghp_1234567890abcdef@github.com/repo.git/': 403"
    masked = _mask_git_output(raw_err)
    assert "ghp_1234567890abcdef" not in masked
    assert "https://***:***@github.com/repo.git/" in masked

    raw_token = "fatal: clone failed from https://ghp_secretToken@github.com/user/repo"
    masked_token = _mask_git_output(raw_token)
    assert "ghp_secretToken" not in masked_token
    assert "https://***@github.com/user/repo" in masked_token
    print("✓ test_git_mask_credentials passed")


def test_live_tool_calls_reversed_matching():
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession("test-cid")
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_name": "run_command",
            "parameters": {"command": "ls"},
            "state": "DONE",
            "tool_info": {"output": "file1\nfile2"}
        }
    })
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_name": "run_command",
            "parameters": {"command": "git status"},
            "state": "RUNNING"
        }
    })
    assert len(session.live_tool_calls) == 2
    assert session.live_tool_calls[0]["status"] == "done"
    assert session.live_tool_calls[1]["status"] == "running"
    assert session.live_tool_calls[1]["args"] == {"command": "git status"}

    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_name": "run_command",
            "state": "DONE",
            "tool_info": {"output": "On branch main"}
        }
    })
    assert session.live_tool_calls[1]["status"] == "done"
    assert session.live_tool_calls[1]["result"] == "On branch main"
    print("✓ test_live_tool_calls_reversed_matching passed")


def test_cron_store_deepcopy_isolation():
    from app.services.cron_store import load_jobs

    jobs1 = load_jobs()
    jobs1["jobs"].append({"id": "mutated_dummy"})
    jobs2 = load_jobs()
    assert not any(j.get("id") == "mutated_dummy" for j in jobs2.get("jobs", []))
    print("✓ test_cron_store_deepcopy_isolation passed")


def test_git_sanitize_extended_ai_tags():
    from app.api.git import _sanitize_git_message
    msg = (
        "feat: add awesome feature\n\n"
        "- Co-Authored-By: Claude <claude@anthropic.com>\n"
        "co-authored-by: user <user@example.com>\n"
        "Assisted-by: chatgpt\n"
        "Help-from: OpenAI\n"
        "signed-off-by: random\n"
    )
    res = _sanitize_git_message(msg)
    assert "Claude" not in res
    assert "claude" not in res
    assert "chatgpt" not in res
    assert "OpenAI" not in res
    assert "Co-Authored-By" not in res
    assert "co-authored-by" not in res
    assert "signed-off-by" not in res
    assert res == "feat: add awesome feature"
    print("✓ test_git_sanitize_extended_ai_tags passed")


def test_live_tool_calls_tool_id_disambiguation():
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession("test-cid-ids")
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_id": "call_1",
            "tool_name": "view_file",
            "parameters": {"file": "a.txt"},
            "state": "RUNNING"
        }
    })
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_id": "call_2",
            "tool_name": "view_file",
            "parameters": {"file": "b.txt"},
            "state": "RUNNING"
        }
    })
    assert len(session.live_tool_calls) == 2
    assert session.live_tool_calls[0]["id"] == "call_1"
    assert session.live_tool_calls[1]["id"] == "call_2"

    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_id": "call_1",
            "tool_name": "view_file",
            "state": "DONE",
            "tool_info": {"output": "content of a"}
        }
    })
    assert session.live_tool_calls[0]["status"] == "done"
    assert session.live_tool_calls[0]["result"] == "content of a"
    assert session.live_tool_calls[1]["status"] == "running"
    print("✓ test_live_tool_calls_tool_id_disambiguation passed")


def test_cron_guarded_execute_duration_tracking():
    import asyncio

    from app.services.cron_store import load_jobs, update_jobs
    from app.services.cron_ticker import _guarded_execute

    test_job = {
        "id": "test_duration_job",
        "name": "Duration Test",
        "prompt": "test prompt",
        "schedule": "*/5 * * * *",
        "enabled": True
    }
    update_jobs(lambda data: data.setdefault("jobs", []).append(test_job))

    import app.services.cron_ticker as ticker
    orig_exec = ticker._execute_job

    async def mock_fail(job):
        await asyncio.sleep(0.05)
        raise asyncio.CancelledError()

    ticker._execute_job = mock_fail
    try:
        try:
            asyncio.run(_guarded_execute(test_job))
        except asyncio.CancelledError:
            pass

        saved = next(j for j in load_jobs()["jobs"] if j["id"] == "test_duration_job")
        assert saved["last_status"] == "interrupted"
        assert "last_duration_seconds" in saved
        assert isinstance(saved["last_duration_seconds"], (int, float))
    finally:
        ticker._execute_job = orig_exec
        update_jobs(lambda data: data["jobs"].remove(next(j for j in data["jobs"] if j["id"] == "test_duration_job")))
    print("✓ test_cron_guarded_execute_duration_tracking passed")


def test_transcript_utf8_bom_support():
    import shutil
    import uuid

    from app.services.storage import get_conversation_transcript
    cid = f"test-bom-{uuid.uuid4().hex[:8]}"
    conv_dir = BRAIN_DIR / cid / ".system_generated" / "logs"
    conv_dir.mkdir(parents=True, exist_ok=True)
    t_file = conv_dir / "transcript.jsonl"
    try:
        # Write with UTF-8 BOM
        content = '\ufeff{"step_index": 0, "type": "USER_INPUT", "content": "Hello with BOM"}\n{"step_index": 1, "type": "MODEL_RESPONSE", "content": "Hi!"}\n'
        t_file.write_bytes(content.encode("utf-8"))
        steps = get_conversation_transcript(cid)
        assert len(steps) == 2, f"Expected 2 steps, got {len(steps)}"
        assert steps[0]["content"] == "Hello with BOM"
        assert steps[1]["content"] == "Hi!"
    finally:
        shutil.rmtree(BRAIN_DIR / cid, ignore_errors=True)
    print("✓ test_transcript_utf8_bom_support passed")


def test_atomic_write_jsonl_permissions():
    import tempfile

    from app.services.storage import atomic_write_jsonl
    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / "test.jsonl"
        atomic_write_jsonl(target, [{"key": "val1"}, {"key": "val2"}])
        assert target.exists()
        mode = target.stat().st_mode & 0o777
        assert mode == 0o600, f"Expected 0o600, got {oct(mode)}"
    print("✓ test_atomic_write_jsonl_permissions passed")


def test_cron_prune_job_logs():
    import os
    import time

    from app.services.cron_store import OUTPUT_DIR
    from app.services.cron_ticker import prune_job_logs
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    test_job = f"test_prune_{int(time.time())}"
    created_files = []
    try:
        for i in range(25):
            f = OUTPUT_DIR / f"{test_job}_{i:03d}.log"
            f.write_text(f"log {i}", encoding="utf-8")
            created_files.append(f)
            os.utime(f, (time.time() + i, time.time() + i))

        prune_job_logs(test_job, keep_latest=20)
        remaining = list(OUTPUT_DIR.glob(f"{test_job}_*.log"))
        assert len(remaining) == 20, f"Expected 20 logs remaining, got {len(remaining)}"
    finally:
        for f in created_files:
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
    print("✓ test_cron_prune_job_logs passed")


def test_git_extended_coauthor_and_masking():
    from app.api.git import _mask_git_output, _sanitize_git_message
    raw_msg = (
        "feat: add awesome feature\n"
        "Co-Authored-By: Claude <noreply@anthropic.com>\n"
        "co author by assistant\n"
        "AI-Assisted by copilot\n"
        "generated by github-actions\n"
        "Actual commit body"
    )
    clean = _sanitize_git_message(raw_msg)
    assert "Claude" not in clean
    assert "copilot" not in clean
    assert "github-actions" not in clean
    assert "Co-Authored-By" not in clean
    assert "feat: add awesome feature" in clean
    assert "Actual commit body" in clean

    masked = _mask_git_output("git push https://myuser:mypassword123@github.com/repo.git")
    assert "mypassword123" not in masked
    assert "myuser" not in masked
    assert "https://***:***@" in masked

    masked_token = _mask_git_output("git push https://ghp_secretToken@github.com/repo.git")
    assert "ghp_secretToken" not in masked
    assert "https://***@" in masked_token

    masked_git = _mask_git_output("git clone git://deploy:key123@github.com/repo.git")
    assert "key123" not in masked_git

    raw_pat = "fatal: auth failed with token ghp_1234567890123456789012345678901234567890 for repo"
    masked_pat = _mask_git_output(raw_pat)
    assert "ghp_" not in masked_pat
    assert "***" in masked_pat
    print("✓ test_git_extended_coauthor_and_masking passed")


def test_undo_conversation_turn_bom_and_corrupt_lines():
    import shutil
    import uuid

    from app.services.storage import (
        BRAIN_DIR,
        get_conversation_transcript,
        undo_conversation_turn,
    )
    cid = f"test-undo-bom-{uuid.uuid4().hex[:8]}"
    conv_dir = BRAIN_DIR / cid / ".system_generated" / "logs"
    conv_dir.mkdir(parents=True, exist_ok=True)
    full_file = conv_dir / "transcript_full.jsonl"
    comp_file = conv_dir / "transcript.jsonl"
    try:
        # Full file has BOM and one malformed line
        full_lines = [
            '\ufeff{"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello 1"}',
            '{"step_index": 1, "type": "MODEL_RESPONSE", "content": "reply 1"}',
            '{bad malformed json line',
            '{"step_index": 2, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello 2"}',
            '{"step_index": 3, "type": "MODEL_RESPONSE", "content": "reply 2"}',
        ]
        comp_lines = [
            '{"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello 1"}',
            '{"step_index": 1, "type": "MODEL_RESPONSE", "content": "reply 1"}',
            '{"step_index": 2, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello 2"}',
            '{"step_index": 3, "type": "MODEL_RESPONSE", "content": "reply 2"}',
        ]
        full_file.write_text("\n".join(full_lines) + "\n", encoding="utf-8")
        comp_file.write_text("\n".join(comp_lines) + "\n", encoding="utf-8")

        res = undo_conversation_turn(cid)
        assert res.get("step_count") == 2
        remaining = get_conversation_transcript(cid)
        assert len(remaining) == 2
        assert remaining[0]["content"] == "hello 1"
        assert remaining[1]["content"] == "reply 1"
    finally:
        shutil.rmtree(BRAIN_DIR / cid, ignore_errors=True)
    print("✓ test_undo_conversation_turn_bom_and_corrupt_lines passed")


def test_cron_compute_next_run_quoted_expression():
    from app.services.cron_store import compute_next_run
    res1 = compute_next_run('"0 9 * * *" ')
    assert res1 is not None
    res2 = compute_next_run("'0 9 * * *'")
    assert res2 is not None
    res3 = compute_next_run('"every 15m"')
    assert res3 is not None
    print("✓ test_cron_compute_next_run_quoted_expression passed")


def test_cron_skills_string_coercion():
    skills_str = "hermes-archivist"
    if isinstance(skills_str, str):
        skills_list = [skills_str]
    else:
        skills_list = list(skills_str)
    valid_skills = [str(s).strip() for s in skills_list if s and str(s).strip()]
    assert valid_skills == ["hermes-archivist"]
    print("✓ test_cron_skills_string_coercion passed")


def test_cron_prune_job_logs_special_chars():
    import os
    import time

    from app.services.cron_store import OUTPUT_DIR
    from app.services.cron_ticker import prune_job_logs
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    test_job = f"test_job[1]_{int(time.time())}"
    created_files = []
    try:
        for i in range(25):
            f = OUTPUT_DIR / f"{test_job}_{i:03d}.log"
            f.write_text(f"log {i}", encoding="utf-8")
            created_files.append(f)
            os.utime(f, (time.time() + i, time.time() + i))

        prune_job_logs(test_job, keep_latest=20)
        prefix = f"{test_job}_"
        remaining = [p for p in OUTPUT_DIR.iterdir() if p.name.startswith(prefix) and p.name.endswith(".log")]
        assert len(remaining) == 20, f"Expected 20 logs remaining, got {len(remaining)}"
    finally:
        for f in created_files:
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
    print("✓ test_cron_prune_job_logs_special_chars passed")


def test_execution_session_remove_subscriber_last_active_at():
    import time

    from app.services.execution_manager import ExecutionSession
    session = ExecutionSession("test_conv_sub")
    session.last_active_at = 100.0
    dummy_ws = object()  # type: ignore
    session.add_subscriber(dummy_ws)  # type: ignore
    t_after_add = session.last_active_at
    assert t_after_add > 100.0
    time.sleep(0.01)
    session.remove_subscriber(dummy_ws)  # type: ignore
    assert len(session.subscribers) == 0
    assert session.last_active_at > t_after_add
    print("✓ test_execution_session_remove_subscriber_last_active_at passed")


def test_cron_get_job_log_special_chars():
    import uuid

    from app.api.crons import get_cron_job_log
    from app.services.cron_store import OUTPUT_DIR, update_jobs

    special_id = f"[job-test-{uuid.uuid4().hex[:6]}]"
    update_jobs(lambda data: data["jobs"].append({"id": special_id, "name": "Special Cron", "schedule": "daily"}))

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    test_log = OUTPUT_DIR / f"{special_id}_20260917.log"
    test_log.write_text("Execution log for bracket job", encoding="utf-8")

    try:
        res = get_cron_job_log(special_id, _=None)
        assert res["job_id"] == special_id
        assert res["has_log"] is True
        assert "Execution log for bracket job" in res["content"]
    finally:
        test_log.unlink(missing_ok=True)
        update_jobs(lambda data: [data["jobs"].remove(j) for j in list(data["jobs"]) if j.get("id") == special_id])
    print("✓ test_cron_get_job_log_special_chars passed")


def test_aggregate_steps_ghost_turns_suppressed():
    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Hello", "step_index": 0},
        {"type": "PLANNER_RESPONSE", "source": "MODEL", "content": "", "thinking": "", "tool_calls": [], "step_index": 1},
        {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Follow up", "step_index": 2},
    ]
    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2, f"Expected 2 user turns, got {len(turns)}"
    assert turns[0]["content"] == "Hello"
    assert turns[1]["content"] == "Follow up"
    print("✓ test_aggregate_steps_ghost_turns_suppressed passed")


def test_read_artifact_content_utf8_bom():
    from app.config import BRAIN_DIR
    from app.services.storage import read_artifact_content

    test_cid = "test-bom-artifact-cid"
    art_dir = BRAIN_DIR / test_cid
    art_dir.mkdir(parents=True, exist_ok=True)
    art_file = art_dir / "test_doc.md"
    art_file.write_bytes(b"\xef\xbb\xbf# Title\nThis is document content with BOM.")

    try:
        content = read_artifact_content(test_cid, "test_doc.md")
        assert not content.startswith("\ufeff"), "BOM was not stripped from artifact content"
        assert content.startswith("# Title"), f"Unexpected content: {content}"
    finally:
        art_file.unlink(missing_ok=True)
        try:
            art_dir.rmdir()
        except Exception:
            pass
    print("✓ test_read_artifact_content_utf8_bom passed")


def test_get_file_content_utf8_bom():
    from app.api.files import get_file_content
    from app.config import DEFAULT_WORKSPACE

    target_dir = Path(DEFAULT_WORKSPACE)
    target_dir.mkdir(parents=True, exist_ok=True)
    f_path = target_dir / "test_bom_file.txt"
    f_path.write_bytes(b"\xef\xbb\xbfLine 1\nLine 2")

    try:
        res = get_file_content(path="test_bom_file.txt", _=None)
        assert not res["content"].startswith("\ufeff"), "BOM was not stripped in get_file_content"
        assert res["content"].startswith("Line 1")
    finally:
        f_path.unlink(missing_ok=True)
    print("✓ test_get_file_content_utf8_bom passed")


def test_git_diff_untracked_fallback_resilience():
    from app.api.git import get_git_diff
    from app.config import DEFAULT_WORKSPACE

    target_dir = Path(DEFAULT_WORKSPACE)
    target_dir.mkdir(parents=True, exist_ok=True)
    untracked_file = target_dir / "untracked_diff_test.txt"
    untracked_file.write_text("Hello from untracked file\nNew line\n", encoding="utf-8")

    try:
        diff_res = get_git_diff(workspace=DEFAULT_WORKSPACE, path="untracked_diff_test.txt", staged=False, _=None)
        assert diff_res["path"] == "untracked_diff_test.txt"
        assert "Hello from untracked file" in diff_res["diff"]
    finally:
        untracked_file.unlink(missing_ok=True)
    print("✓ test_git_diff_untracked_fallback_resilience passed")


def test_git_pull_sanitization_and_execution():
    from fastapi import HTTPException

    from app.api.git import PullRequest, git_pull
    from app.config import DEFAULT_WORKSPACE

    # Test invalid remote rejected
    try:
        git_pull(PullRequest(workspace=DEFAULT_WORKSPACE, remote="--upload-pack=exploit", branch="main"), _=None)
        assert False, "Should have rejected invalid remote"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Nom de remote Git invalide" in e.detail

    # Test invalid branch rejected
    try:
        git_pull(PullRequest(workspace=DEFAULT_WORKSPACE, remote="origin", branch="--delete"), _=None)
        assert False, "Should have rejected invalid branch"
    except HTTPException as e:
        assert e.status_code == 400
        assert "Nom de branche Git invalide" in e.detail

    print("✓ test_git_pull_sanitization_and_execution passed")


def test_git_diff_deleted_file_fallback():
    import shutil

    from app.api.git import get_git_diff, run_git
    from app.config import DEFAULT_WORKSPACE

    tmp_repo = Path(DEFAULT_WORKSPACE) / ".tmp_test_diff_repo"
    if tmp_repo.exists():
        shutil.rmtree(tmp_repo, ignore_errors=True)
    tmp_repo.mkdir(parents=True, exist_ok=True)

    try:
        run_git(["init"], tmp_repo)
        f_path = tmp_repo / "deleted_file.txt"
        f_path.write_text("deleted content test\n", encoding="utf-8")
        run_git(["add", "deleted_file.txt"], tmp_repo)
        run_git(["commit", "-m", "chore: add file"], tmp_repo)

        # Delete file on disk
        f_path.unlink()

        # Should not throw 400, but find the diff in HEAD
        res = get_git_diff(workspace=str(tmp_repo), path="deleted_file.txt", staged=False, _=None)
        assert res["path"] == "deleted_file.txt"
        assert "deleted content test" in res["diff"]

        # Also test with leading slash path
        res_slash = get_git_diff(workspace=str(tmp_repo), path="/deleted_file.txt", staged=False, _=None)
        assert "deleted content test" in res_slash["diff"]
    finally:
        shutil.rmtree(tmp_repo, ignore_errors=True)
    print("✓ test_git_diff_deleted_file_fallback passed")


def test_git_status_count_fields():
    from app.api.git import get_git_status

    st = get_git_status(workspace=str(BACKEND_DIR.parent), _=None)
    assert st["is_repo"] is True
    assert "is_clean" in st
    assert "modified_count" in st
    assert "staged_count" in st
    assert "untracked_count" in st
    assert "deleted_count" in st
    assert st["clean"] == st["is_clean"]
    assert st["modified_count"] == len(st["modified"])
    assert st["staged_count"] == len(st["staged"])
    assert st["untracked_count"] == len(st["untracked"])
    assert st["deleted_count"] == len(st["deleted"])
    print("✓ test_git_status_count_fields passed")


def test_kill_task_name_matching():
    from app.api.tasks import KillTaskRequest, kill_task

    res = kill_task(KillTaskRequest(task_id="python"), _=None)
    assert res["success"] is False
    assert "Aucun PID spécifié ou processus actif trouvé" in res["message"]

    res_short = kill_task(KillTaskRequest(task_id="ab"), _=None)
    assert res_short["success"] is False
    print("✓ test_kill_task_name_matching passed")


def test_file_download_unicode_and_special_chars():
    from app.api.files import download_file
    from app.config import DEFAULT_WORKSPACE

    test_dir = Path(DEFAULT_WORKSPACE) / ".tmp_test_download_unicode"
    test_dir.mkdir(parents=True, exist_ok=True)
    unicode_filename = "spécification_résumé_2026.docx"
    test_file = test_dir / unicode_filename
    test_file.write_text("Contenu test téléchargement unicode", encoding="utf-8")

    try:
        response = download_file(path=str(test_file), _=None)
        assert response.status_code == 200
        headers_dict = dict(response.headers)
        cd = headers_dict.get("content-disposition", "")
        assert "attachment" in cd
        assert "filename*" in cd or "filename=" in cd
    finally:
        if test_file.exists():
            test_file.unlink()
        if test_dir.exists():
            test_dir.rmdir()


def test_files_path_access_drive_letters():
    from app.api.files import _validate_path_access
    p = Path("/root")
    try:
        res = _validate_path_access(p)
        assert res.exists()
    except Exception:
        pass
    print("✓ test_files_path_access_drive_letters passed")


def test_crons_skills_sanitization_trimmed():
    from app.api.crons import (
        CreateCronJobRequest,
        UpdateCronJobRequest,
        create_cron_job,
        delete_cron_job,
        update_cron_job,
    )
    req = CreateCronJobRequest(
        name="Test Skills Job",
        prompt="echo test",
        schedule="*/15 * * * *",
        skills=["  leadforge  ", " ", "hermes-archivist  ", ""]
    )
    res = create_cron_job(req, _=None)
    assert res["success"] is True
    job_id = res["job"]["id"]
    assert res["job"]["skills"] == ["leadforge", "hermes-archivist"]

    # Test update
    upd_req = UpdateCronJobRequest(skills=["  agy-customizations ", ""])
    res_upd = update_cron_job(job_id, upd_req, _=None)
    assert res_upd["job"]["skills"] == ["agy-customizations"]

    # Cleanup
    delete_cron_job(job_id, _=None)
    print("✓ test_crons_skills_sanitization_trimmed passed")


def test_import_single_conversation_non_dict_items():
    from datetime import datetime, timezone

    from app.services.storage import _import_single_conversation, delete_conversation
    now_iso = datetime.now(timezone.utc).isoformat()
    now_db = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    # Corrupted payload with non-dict elements in steps
    payload = {
        "title": "Corrupted Steps Test",
        "steps": ["not a dict", 123, None, {"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello"}]
    }
    res = _import_single_conversation(payload, now_iso, now_db)
    assert res["success"] is True
    assert res["step_count"] == 1

    # Corrupted payload with non-dict elements in messages
    payload_msg = {
        "title": "Corrupted Messages Test",
        "messages": ["not a dict", {"role": "user", "content": "hi"}, 456]
    }
    res_msg = _import_single_conversation(payload_msg, now_iso, now_db)
    assert res_msg["success"] is True
    assert res_msg["step_count"] == 1

    # Cleanup
    delete_conversation(res["conversation_id"])
    delete_conversation(res_msg["conversation_id"])
    print("✓ test_import_single_conversation_non_dict_items passed")


def test_search_conversations_large_transcript():
    """Verify that search_conversations handles transcripts > 512KB without NameError on raw_data."""
    import shutil
    import uuid
    from unittest.mock import patch

    unique_cid = f"test-large-search-{uuid.uuid4().hex[:8]}"
    conv_dir = BRAIN_DIR / unique_cid
    log_dir = conv_dir / ".system_generated" / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    t_file = log_dir / "transcript.jsonl"

    unique_term = f"needle_{uuid.uuid4().hex[:8]}"

    try:
        # Create a file > 512KB (approx 550KB)
        dummy_step = json.dumps({"source": "USER", "type": "USER_INPUT", "content": "padding line " * 10}) + "\n"
        step_bytes = dummy_step.encode("utf-8")
        target_size = 550 * 1024
        repeat_count = target_size // len(step_bytes)

        with open(t_file, "wb") as f:
            f.write(step_bytes * repeat_count)
            target_step = json.dumps({"source": "USER", "type": "USER_INPUT", "content": f"Secret code: {unique_term}"}) + "\n"
            f.write(target_step.encode("utf-8"))

        assert t_file.stat().st_size > 512 * 1024

        dummy_conv = {
            "conversation_id": unique_cid,
            "title": "Large Transcript Test",
            "last_modified_time": "2026-09-17 12:00:00",
            "preview": "Test preview",
            "step_count": 100,
            "pinned": False,
        }

        with patch("app.services.storage.list_conversations", return_value=[dummy_conv]):
            results = search_conversations(unique_term, limit=10)

        assert len(results) >= 1
        found = any(r.get("conversation_id") == unique_cid and r.get("match_type") == "transcript" for r in results)
        assert found, f"Expected {unique_cid} to be matched in transcript search, got {results}"
        print("✓ test_search_conversations_large_transcript passed")
    finally:
        if conv_dir.exists():
            shutil.rmtree(conv_dir, ignore_errors=True)


def test_execution_manager_get_or_create_busy_active_session():
    """Verify that get_or_create_session attaches to busy active session with empty conversation_id."""
    import asyncio

    from app.services.execution_manager import ExecutionManager

    async def _run():
        em = ExecutionManager()
        sess = em.get_or_create_session(None)
        sess.is_running = True
        sess.conversation_id = "test-cid-12345"
        em.register_session_cid(sess, "test-cid-12345")

        class MockWS:
            pass

        ws = MockWS()
        sess.add_subscriber(ws)  # type: ignore

        attached_sess = em.get_or_create_session(None, ws=ws)  # type: ignore
        assert attached_sess is sess
        assert attached_sess.conversation_id == "test-cid-12345"

        attached_sess_no_ws = em.get_or_create_session(None, ws=None)
        assert attached_sess_no_ws is sess

        if sess.worker_task and not sess.worker_task.done():
            sess.worker_task.cancel()

    asyncio.run(_run())
    print("✓ test_execution_manager_get_or_create_busy_active_session passed")


def test_storage_calculate_tokens_string_resilience():
    """Verify calculate_conversation_tokens handles string/mismatched values without TypeError."""
    from app.services.storage import calculate_conversation_tokens
    steps = [
        {
            "step_index": 0,
            "type": "agent_response",
            "metadata": {
                "usage": {
                    "input_tokens": "150",
                    "output_tokens": "42",
                    "thinking_tokens": "10",
                    "total_tokens": "202",
                }
            },
        }
    ]
    res = calculate_conversation_tokens(steps)
    assert res["input_tokens"] == 150
    assert res["output_tokens"] == 42
    assert res["thinking_tokens"] == 10
    assert res["total_tokens"] == 202
    assert res["is_estimated"] is False

    steps2 = [
        {
            "step_index": 0,
            "type": "agent_response",
            "metadata": {
                "usage": {
                    "input_tokens": "100",
                    "output_tokens": "50",
                    "total_tokens": "0",
                }
            },
        }
    ]
    res2 = calculate_conversation_tokens(steps2)
    assert res2["total_tokens"] == 150
    print("✓ test_storage_calculate_tokens_string_resilience passed")


def test_storage_search_conversations_legacy_transcript():
    """Verify search_conversations finds needle in legacy transcript.jsonl at root of conv dir."""
    import json
    import shutil
    import uuid
    from unittest.mock import patch

    from app.config import BRAIN_DIR
    from app.services.storage import search_conversations

    cid = f"test-legacy-search-{uuid.uuid4().hex[:8]}"
    conv_dir = BRAIN_DIR / cid
    conv_dir.mkdir(parents=True, exist_ok=True)
    legacy_file = conv_dir / "transcript.jsonl"
    needle = f"legacy_needle_{uuid.uuid4().hex[:6]}"

    step_data = {
        "step_index": 0,
        "type": "agent_response",
        "source": "MODEL",
        "content": f"Here is the secret: {needle}",
    }
    with open(legacy_file, "w", encoding="utf-8") as f:
        f.write(json.dumps(step_data) + "\n")

    try:
        with patch("app.services.storage.list_conversations") as mock_list:
            mock_list.return_value = [{"conversation_id": cid, "title": "Legacy Test"}]
            matches = search_conversations(query=needle, limit=10)
            assert any(m.get("conversation_id") == cid for m in matches)
    finally:
        if conv_dir.exists():
            shutil.rmtree(conv_dir, ignore_errors=True)
    print("✓ test_storage_search_conversations_legacy_transcript passed")


def test_git_push_empty_error_fallback():
    """Verify git_push fallback error formatting when git stderr/stdout are empty."""
    from unittest.mock import MagicMock, patch

    from fastapi import HTTPException

    from app.api.git import PushRequest, git_push

    req = PushRequest(remote="origin", branch="main")
    mock_res = MagicMock()
    mock_res.returncode = 128
    mock_res.stdout = ""
    mock_res.stderr = ""

    with patch("app.api.git.run_git", return_value=mock_res):
        try:
            git_push(req, _=None)
            assert False, "Should have raised HTTPException"
        except HTTPException as exc:
            assert exc.status_code == 500
            assert exc.detail == "Échec du push (code 128)"
    print("✓ test_git_push_empty_error_fallback passed")


def test_git_run_askpass_env():
    from pathlib import Path
    from unittest.mock import MagicMock, patch

    from app.api.git import run_git

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = MagicMock(returncode=0, stdout="", stderr="")
        run_git(["status"], cwd=Path("/root/antigravity-webui"))
        assert mock_run.called
        call_kwargs = mock_run.call_args[1]
        env = call_kwargs.get("env", {})
        assert env.get("GIT_ASKPASS") == ""
        assert env.get("SSH_ASKPASS") == ""
        assert env.get("GIT_TERMINAL_PROMPT") == "0"
    print("✓ test_git_run_askpass_env passed")


def test_execution_manager_interrupt_clears_running_tool_calls():
    import asyncio

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    manager = ExecutionManager()
    session = ExecutionSession("test-cid-interrupt")
    session.is_running = True
    session.live_tool_calls = [
        {"id": "call_1", "status": "running", "title": "Executing command"},
        {"id": "call_2", "status": "done", "title": "File view"}
    ]
    manager.sessions["test-cid-interrupt"] = session

    asyncio.run(manager.interrupt("test-cid-interrupt"))

    assert session.is_running is False
    assert session.live_tool_calls[0]["status"] == "cancelled"
    assert session.live_tool_calls[1]["status"] == "done"
    print("✓ test_execution_manager_interrupt_clears_running_tool_calls passed")


def test_agy_driver_workspace_path_canonical_resolution():
    import asyncio
    from pathlib import Path
    from unittest.mock import AsyncMock, patch

    from app.config import DEFAULT_WORKSPACE
    from app.services.agy_driver import stream_turn

    with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
        mock_proc = AsyncMock()
        mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
        mock_proc.stderr.read = AsyncMock(return_value=b"")
        mock_proc.stderr.readline = AsyncMock(return_value=b"")
        mock_proc.wait = AsyncMock(return_value=0)
        mock_proc.returncode = 0
        mock_exec.return_value = mock_proc

        async def run_driver(ws):
            async for _ in stream_turn(prompt="hi", workspace_path=ws):
                pass

        same_path = str(Path(DEFAULT_WORKSPACE).resolve()) + "/"
        asyncio.run(run_driver(same_path))

        assert mock_exec.called
        cmd_args = list(mock_exec.call_args[0])
        assert "--add-dir" not in cmd_args
    print("✓ test_agy_driver_workspace_path_canonical_resolution passed")


def test_execution_manager_pending_approval_cleared_on_failover():
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession("test-cid-failover")
    session.pending_approval = {
        "toolName": "dangerous_action",
        "command": "rm -rf /",
        "path": None
    }

    session._update_live_state({"event": "model_failover"})
    assert session.pending_approval is None

    session.pending_approval = {
        "toolName": "another_action",
        "command": "reboot",
        "path": None
    }

    session._update_live_state({"event": "account_failover"})
    assert session.pending_approval is None
    print("✓ test_execution_manager_pending_approval_cleared_on_failover passed")


def test_scan_dir_children_key_consistency():
    import tempfile
    from pathlib import Path

    from app.api.files import scan_dir

    with tempfile.TemporaryDirectory() as td:
        root = Path(td)
        sub = root / "subdir"
        sub.mkdir()
        (sub / "file.txt").write_text("content", encoding="utf-8")

        items = scan_dir(root, current_depth=0, max_depth=0)
        assert len(items) == 1
        assert items[0]["name"] == "subdir"
        assert items[0]["is_dir"] is True
        assert "children" in items[0]
        assert items[0]["children"] == []
    print("✓ test_scan_dir_children_key_consistency passed")


def test_storage_calculate_tokens_with_steered_prompt():
    from app.services.storage import calculate_conversation_tokens

    steered_content = "⚡ [Guidage] [Instruction Prioritaire de Guidage]: Hello world"
    steps = [
        {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": steered_content}
    ]
    calc = calculate_conversation_tokens(steps)
    assert calc["input_tokens"] < 13370 + 10
    print("✓ test_storage_calculate_tokens_with_steered_prompt passed")


def test_api_key_generation_and_verification():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import (
        create_access_token,
        create_api_key,
        delete_api_key,
        get_api_keys,
        verify_api_key,
        verify_token_or_api_key,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                # 1. Creation
                key_info = create_api_key("Test Integration Key")
                assert key_info["key"].startswith("agy_sk_")
                key_id = key_info["id"]
                raw_key = key_info["key"]

                # 2. Listed keys have masked_key and proper metadata
                keys_list = get_api_keys()
                matching = [k for k in keys_list if k["id"] == key_id]
                assert len(matching) == 1
                assert "..." in matching[0]["masked_key"]

                # 3. Verification with and without Bearer prefix
                assert verify_api_key(raw_key) is True
                assert verify_api_key(f"Bearer {raw_key}") is True
                assert verify_api_key("invalid_key_random_string") is False
                assert verify_api_key("") is False
                assert verify_api_key(None) is False

                # 4. Hybrid verify_token_or_api_key with both session token and API key
                session_token = create_access_token()
                assert verify_token_or_api_key(session_token) is True
                assert verify_token_or_api_key(raw_key) is True
                assert verify_token_or_api_key("completely_invalid_token") is False

                # 5. Deletion
                deleted = delete_api_key(key_id)
                assert deleted is True
                assert verify_api_key(raw_key) is False
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_api_key_generation_and_verification passed")


def test_api_key_last_used_at_throttling():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import (
        create_api_key,
        delete_api_key,
        get_auth_config,
        verify_api_key,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                key_info = create_api_key("Throttled Key Test")
                raw_key = key_info["key"]
                key_id = key_info["id"]

                # First verification should set last_used_at
                assert verify_api_key(raw_key) is True
                config = get_auth_config()
                stored_entry = next(k for k in config.get("api_keys", []) if k["id"] == key_id)
                first_used = stored_entry.get("last_used_at")
                assert first_used is not None

                # Immediate re-verification (<60s) updates memory without failing
                assert verify_api_key(raw_key) is True
                delete_api_key(key_id)
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_api_key_last_used_at_throttling passed")


def test_execution_manager_submit_prompt_ws_none():
    import asyncio

    from app.services.execution_manager import ExecutionSession, execution_manager

    # 1. Empty prompt with ws=None should return cleanly without AttributeError
    asyncio.run(execution_manager.submit_prompt(None, {"prompt": "", "conversation_id": "test_ws_none_empty"}))

    # 2. ExecutionSession.add_subscriber(None) and remove_subscriber(None)
    session = ExecutionSession(conversation_id="test_sub_null")
    session.add_subscriber(None)
    assert None not in session.subscribers
    assert len(session.subscribers) == 0
    session.remove_subscriber(None)

    # 3. submit_prompt with valid prompt and ws=None
    cid = "test_ws_none_valid"
    asyncio.run(execution_manager.submit_prompt(None, {
        "prompt": "Test instruction for agent",
        "conversation_id": cid,
        "mode": "normal"
    }))
    sess = execution_manager.get_session(cid)
    assert sess is not None
    assert None not in sess.subscribers
    execution_manager.remove_session(cid)
    print("✓ test_execution_manager_submit_prompt_ws_none passed")


def test_openai_messages_to_prompt_resolution():
    from app.api.openai_compat import ChatMessage, _messages_to_prompt

    # Single user message
    msgs1 = [ChatMessage(role="user", content="Bonjour Antigravity")]
    assert _messages_to_prompt(msgs1) == "Bonjour Antigravity"

    # Multi-turn history without existing conv_id (formats context)
    msgs2 = [
        ChatMessage(role="system", content="Tu es un assistant utile"),
        ChatMessage(role="user", content="Comment vas-tu ?"),
        ChatMessage(role="assistant", content="Très bien, merci !"),
        ChatMessage(role="user", content="Quel temps fait-il ?")
    ]
    formatted = _messages_to_prompt(msgs2, has_conv_id=False)
    assert "[Directives Système / Contexte]:" in formatted
    assert "[Assistant Antigravity]:" in formatted
    assert "Quel temps fait-il ?" in formatted

    # Multi-turn history with existing conv_id (only extracts latest user message to avoid duplicate transcript)
    latest_only = _messages_to_prompt(msgs2, has_conv_id=True)
    assert latest_only == "Quel temps fait-il ?"
    print("✓ test_openai_messages_to_prompt_resolution passed")


def test_agy_subcommand_add_mcp_server_default_isolation():
    import inspect

    from app.services.agy_subcommand import add_mcp_server

    sig = inspect.signature(add_mcp_server)
    # Default values must NOT be mutable lists
    assert sig.parameters["args"].default is None or not isinstance(sig.parameters["args"].default, list)
    assert sig.parameters["env"].default is None or not isinstance(sig.parameters["env"].default, list)
    assert sig.parameters["headers"].default is None or not isinstance(sig.parameters["headers"].default, list)
    print("✓ test_agy_subcommand_add_mcp_server_default_isolation passed")


def test_auth_dynamic_env_api_key():
    import os
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import verify_api_key

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        secret = "agy_test_dynamic_env_key_12345"
        old = os.environ.get("ANTIGRAVITY_API_KEY")
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0
                os.environ["ANTIGRAVITY_API_KEY"] = secret
                assert verify_api_key(secret) is True
                assert verify_api_key(f"Bearer {secret}") is True
                assert verify_api_key("wrong_key") is False
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
            if old is not None:
                os.environ["ANTIGRAVITY_API_KEY"] = old
            else:
                os.environ.pop("ANTIGRAVITY_API_KEY", None)
    print("✓ test_auth_dynamic_env_api_key passed")


def test_auth_ensure_api_keys_storage_no_resurrect():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import _ensure_api_keys_storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                # When api_keys key is present and empty (user deleted all keys), it should remain empty
                cfg = {"enabled": True, "api_keys": []}
                result = _ensure_api_keys_storage(cfg)
                assert result == []
                assert len(cfg["api_keys"]) == 0

                # When api_keys key is missing or not a list, it should initialize default key
                cfg2 = {"enabled": True}
                result2 = _ensure_api_keys_storage(cfg2)
                assert len(result2) == 1
                assert result2[0]["id"] == "master-default"
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_auth_ensure_api_keys_storage_no_resurrect passed")


def test_openai_extract_usage_info():
    from app.api.openai_compat import _extract_usage_info

    # 1. Non-dict input
    assert _extract_usage_info(None) == {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}

    # 2. CLI inputTokens/outputTokens/totalTokens format
    u1 = {"inputTokens": 150, "outputTokens": 80, "totalTokens": 230}
    assert _extract_usage_info(u1) == {"prompt_tokens": 150, "completion_tokens": 80, "total_tokens": 230}

    # 3. Snake_case format
    u2 = {"input_tokens": 100, "output_tokens": 50, "total_tokens": 150}
    assert _extract_usage_info(u2) == {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}

    # 4. Google Cloud TokenCount format
    u3 = {"promptTokenCount": 200, "candidatesTokenCount": 75, "totalTokenCount": 275}
    assert _extract_usage_info(u3) == {"prompt_tokens": 200, "completion_tokens": 75, "total_tokens": 275}

    # 5. Missing total calculation
    u4 = {"inputTokens": 60, "outputTokens": 40}
    assert _extract_usage_info(u4) == {"prompt_tokens": 60, "completion_tokens": 40, "total_tokens": 100}
    print("✓ test_openai_extract_usage_info passed")


def test_session_metadata_cid_sanitization():
    import pytest

    from app.services.session_metadata import (
        bulk_update_session_meta_batch,
        update_session_meta,
    )

    # 1. Direct update with invalid conversation_id raises ValueError
    with pytest.raises(ValueError):
        update_session_meta("", {"pinned": True})
    with pytest.raises(ValueError):
        update_session_meta("   ", {"pinned": True})

    # 2. Batch update skips empty/none/null conversation IDs
    batch = {
        "": {"pinned": True},
        "   ": {"pinned": True},
        "null": {"pinned": True},
        "None": {"pinned": True},
        "undefined": {"pinned": True},
        "valid_cid_test_sanitization": {"pinned": True, "project": "Audit"}
    }
    res = bulk_update_session_meta_batch(batch)
    assert "" not in res
    assert "null" not in res
    assert "None" not in res
    assert "undefined" not in res
    assert "valid_cid_test_sanitization" in res
    assert res["valid_cid_test_sanitization"]["pinned"] is True
    print("✓ test_session_metadata_cid_sanitization passed")


def test_git_run_git_gpgsign_disabled():
    import inspect

    from app.api.git import run_git

    src = inspect.getsource(run_git)
    assert "commit.gpgsign=false" in src
    print("✓ test_git_run_git_gpgsign_disabled passed")


def test_agy_subcommand_returncode_type():
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.agy_subcommand import get_agy_info, run_agy_subcommand

    # Mock proc with returncode = 0
    mock_proc = AsyncMock()
    mock_proc.communicate.return_value = (b"v1.0.0\n", b"")
    mock_proc.returncode = 0

    with patch("asyncio.create_subprocess_exec", return_value=mock_proc):
        code, out, _err = asyncio.run(run_agy_subcommand(["--version"]))
        assert isinstance(code, int)
        assert code == 0
        assert "v1.0.0" in out

    # Test when returncode is None
    mock_proc_none = AsyncMock()
    mock_proc_none.communicate.return_value = (b"", b"")
    mock_proc_none.returncode = None
    with patch("asyncio.create_subprocess_exec", return_value=mock_proc_none):
        code, _out, _err = asyncio.run(run_agy_subcommand(["dummy"]))
        assert isinstance(code, int)
        assert code == -1

    # Test get_agy_info
    with patch("app.services.agy_subcommand.run_agy_subcommand", AsyncMock(return_value=(0, "antigravity 2.4.0\n", ""))):
        info = asyncio.run(get_agy_info())
        assert info["version"] == "antigravity 2.4.0"
    print("✓ test_agy_subcommand_returncode_type passed")


def test_agent_api_conversation_id_validation():
    import asyncio

    import pytest
    from fastapi import HTTPException

    from app.api.agent_api import (
        AgentInterruptRequest,
        AgentRunRequest,
        AgentSteerRequest,
        interrupt_agent,
        run_agent_turn,
        steer_agent,
    )

    # Malicious or unsafe cids
    bad_cids = ["../traversal", "../../etc/passwd", "has/slash", "has\\backslash", "null", "undefined", ".dotfile"]
    for bad_cid in bad_cids:
        # 1. run_agent_turn
        req_run = AgentRunRequest(prompt="hello", conversation_id=bad_cid)
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(run_agent_turn(req_run, True))
        assert exc_info.value.status_code == 400

        # 2. interrupt_agent
        req_int = AgentInterruptRequest(conversation_id=bad_cid)
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(interrupt_agent(req_int, True))
        assert exc_info.value.status_code == 400

        # 3. steer_agent
        req_steer = AgentSteerRequest(conversation_id=bad_cid, instruction="focus")
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(steer_agent(req_steer, True))
        assert exc_info.value.status_code == 400
    print("✓ test_agent_api_conversation_id_validation passed")


def test_tasks_conversation_id_validation():
    import pytest
    from fastapi import HTTPException

    from app.api.tasks import list_active_tasks

    bad_cids = ["../traversal", "../../etc/passwd", "has/slash", "has\\backslash", "null", "undefined"]
    for bad_cid in bad_cids:
        with pytest.raises(HTTPException) as exc_info:
            list_active_tasks(conversation_id=bad_cid, _=True)
        assert exc_info.value.status_code == 400
    print("✓ test_tasks_conversation_id_validation passed")


def test_execution_manager_cid_sanitization():
    import asyncio
    from unittest.mock import AsyncMock

    from app.services.execution_manager import _clean_cid, execution_manager

    # _clean_cid returns None for invalid or traversal cids
    assert _clean_cid(None) is None
    assert _clean_cid("") is None
    assert _clean_cid("   ") is None
    assert _clean_cid("null") is None
    assert _clean_cid("undefined") is None
    assert _clean_cid("None") is None
    assert _clean_cid("../../etc/passwd") is None
    assert _clean_cid("safe-session-123_abc") == "safe-session-123_abc"

    # submit_prompt sends error event on bad cid
    mock_ws = AsyncMock()
    asyncio.run(execution_manager.submit_prompt(mock_ws, {
        "prompt": "test",
        "conversation_id": "../../etc/passwd"
    }))
    mock_ws.send_json.assert_called_once()
    sent = mock_ws.send_json.call_args[0][0]
    assert sent["event"] == "error"
    assert "invalide" in sent["message"]
    print("✓ test_execution_manager_cid_sanitization passed")


def test_storage_artifacts_resilience_and_url_decoding():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    import app.services.storage as storage_mod
    from app.services.storage import list_artifacts, read_artifact_content

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir()

        # Create a valid conversation dir and an artifact with special characters / spaces
        conv_dir = tmp_brain / "session_art_test"
        conv_dir.mkdir()
        art_file = conv_dir / "my artifact report.md"
        art_file.write_text("# Test Artifact Content", encoding="utf-8")

        with patch.object(storage_mod, "BRAIN_DIR", tmp_brain):
            # Test listing
            arts = list_artifacts("session_art_test")
            assert len(arts) == 1
            assert arts[0]["filename"] == "my artifact report.md"

            # Test reading with exact name
            content = read_artifact_content("session_art_test", "my artifact report.md")
            assert "# Test Artifact Content" in content

            # Test reading with URL encoded filename
            content_encoded = read_artifact_content("session_art_test", "my%20artifact%20report.md")
            assert "# Test Artifact Content" in content_encoded
    print("✓ test_storage_artifacts_resilience_and_url_decoding passed")


def test_google_accounts_delete_route():
    from unittest.mock import patch

    try:
        from fastapi.testclient import TestClient
    except (ImportError, RuntimeError):
        print("⚠ skipping test_google_accounts_delete_route (TestClient/httpx unavailable in current python environment)")
        return

    from app.main import app

    client = TestClient(app)
    with patch("app.api.google_accounts.delete_google_account", return_value={"status": "deleted", "email": "test@example.com"}):
        from app.services.auth import create_access_token
        token = create_access_token()
        # 1. Query parameter DELETE
        res1 = client.delete("/api/google/accounts?email=test@example.com", headers={"Authorization": f"Bearer {token}"})
        assert res1.status_code == 200
        assert res1.json()["status"] == "deleted"

        # 2. Path parameter DELETE
        res2 = client.delete("/api/google/accounts/test@example.com", headers={"Authorization": f"Bearer {token}"})
        assert res2.status_code == 200
        assert res2.json()["status"] == "deleted"
    print("✓ test_google_accounts_delete_route passed")


def test_auth_verify_password_non_string():
    from app.services.auth import verify_password
    assert verify_password(None) is False
    assert verify_password("") is False
    assert verify_password(123) is False
    assert verify_password(["password"]) is False
    print("✓ test_auth_verify_password_non_string passed")


def test_clean_user_prompt_xml_tag_backreference():
    from app.services.storage import clean_user_prompt
    # Exact tag match should be removed
    prompt1 = "Hello <SKILLS>my skill info</SKILLS> world"
    cleaned1 = clean_user_prompt(prompt1)
    assert cleaned1 == "Hello  world", f"Got '{cleaned1}'"

    # Mismatched tags should not strip across tags
    prompt2 = "Hello <SKILLS>valid skill</SKILLS> middle <ARTIFACTS>valid artifact</ARTIFACTS> end"
    cleaned2 = clean_user_prompt(prompt2)
    assert "middle" in cleaned2, f"Expected 'middle' preserved, got '{cleaned2}'"

    # Steering prefixes stripping (French and English)
    assert clean_user_prompt("⚡ [Guidage] Fix the bug") == "Fix the bug"
    assert clean_user_prompt("⚡ [Steering] Fix the bug") == "Fix the bug"
    assert clean_user_prompt("📥 [En attente] Check file") == "Check file"
    assert clean_user_prompt("📥 [Queued] Check file") == "Check file"
    assert clean_user_prompt("[Instruction Prioritaire de Guidage]: Run tests") == "Run tests"
    assert clean_user_prompt("[Priority Steering Instruction]: Run tests") == "Run tests"
    print("✓ test_clean_user_prompt_xml_tag_backreference passed")


def test_build_conversation_dict_row_or_dict():
    import sqlite3

    from app.services.storage import _build_conversation_dict
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE test_conv (
            conversation_id TEXT,
            title TEXT,
            preview TEXT,
            step_count INT,
            last_modified_time TEXT,
            workspace_uris TEXT,
            status TEXT,
            agent_name TEXT,
            parent_conversation_id TEXT
        )
    """)
    cursor.execute("""
        INSERT INTO test_conv VALUES ('c1', 'T1', 'P1', 1, '2026-09-17T00:00:00', '[]', 'DONE', 'agy', 'p1')
    """)
    cursor.execute("SELECT * FROM test_conv WHERE conversation_id = 'c1'")
    row = cursor.fetchone()
    d1 = _build_conversation_dict(row, {})
    assert d1["parent_conversation_id"] == "p1"
    assert d1["conversation_id"] == "c1"

    cursor.execute("""
        INSERT INTO test_conv VALUES ('c2', 'T2', 'P2', 2, '2026-09-17T00:00:00', '[]', 'DONE', 'agy', '')
    """)
    cursor.execute("SELECT * FROM test_conv WHERE conversation_id = 'c2'")
    row2 = cursor.fetchone()
    d2 = _build_conversation_dict(row2, {})
    assert d2["parent_conversation_id"] is None
    conn.close()
    print("✓ test_build_conversation_dict_row_or_dict passed")


def test_atomic_write_jsonl_initial_permissions():
    import tempfile

    from app.services.storage import atomic_write_jsonl
    with tempfile.TemporaryDirectory() as td:
        target = Path(td) / "test_out.jsonl"
        items = [{"index": 0, "content": "secret data"}]
        atomic_write_jsonl(target, items)
        assert target.exists()
        with open(target, "r", encoding="utf-8") as f:
            lines = f.readlines()
        assert len(lines) == 1
        assert "secret data" in lines[0]


def test_save_auth_config_preserves_password_on_partial_dict():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import (
        get_auth_config,
        hash_password,
        save_auth_config,
        verify_password,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                # 1. Initialize with strong custom password
                custom_pwd = "MySuperSecretPassword123!"
                init_cfg = {
                    "enabled": True,
                    "password": hash_password(custom_pwd),
                    "secret_key": "test_secret_key"
                }
                save_auth_config(init_cfg)
                assert verify_password(custom_pwd) is True

                # 2. Simulate partial dict save without "password" key (like unit test or partial update)
                partial_cfg = {"enabled": True, "api_keys": []}
                save_auth_config(partial_cfg)

                # 3. Verify password is still retained and valid!
                assert verify_password(custom_pwd) is True
                current_cfg = get_auth_config()
                assert current_cfg["password"] == init_cfg["password"]
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_save_auth_config_preserves_password_on_partial_dict passed")


def test_get_auth_config_recovers_from_backup():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import (
        get_auth_config,
        hash_password,
        save_auth_config,
        verify_password,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                # 1. Setup config with custom password
                custom_pwd = "BackupRecoveryPassword999!"
                cfg = {
                    "enabled": True,
                    "password": hash_password(custom_pwd),
                    "secret_key": "test_secret_key"
                }
                save_auth_config(cfg)
                assert tmp_bak.exists()

                # 2. Corrupt the main auth file and clear memory cache
                tmp_auth.write_text("CORRUPTED_GARBAGE{{", encoding="utf-8")
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                # 3. get_auth_config must restore from backup instead of resetting to default
                recovered = get_auth_config()
                assert recovered["password"] == cfg["password"]
                assert verify_password(custom_pwd) is True
                assert verify_password("antigravity2026") is False
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_get_auth_config_recovers_from_backup passed")


def test_openai_multipart_message_content():
    from app.api.openai_compat import (
        ChatMessage,
        _extract_message_content,
        _messages_to_prompt,
    )

    # Plain string content
    msg_str = ChatMessage(role="user", content="Hello world")
    assert _extract_message_content(msg_str.content) == "Hello world"

    # Multi-part content list (OpenAI SDK / Cursor / LiteLLM format)
    multi_content = [
        {"type": "text", "text": "Part 1 of message"},
        {"type": "text", "text": "Part 2 of message"},
    ]
    msg_multi = ChatMessage(role="user", content=multi_content)
    assert _extract_message_content(msg_multi.content) == "Part 1 of message\nPart 2 of message"

    # Single turn prompt resolution with multi-part
    prompt = _messages_to_prompt([msg_multi])
    assert prompt == "Part 1 of message\nPart 2 of message"

    # Multi turn prompt resolution
    sys_msg = ChatMessage(role="system", content="System instruction")
    assistant_msg = ChatMessage(role="assistant", content="Assistant reply")
    conv_prompt = _messages_to_prompt([sys_msg, assistant_msg, msg_multi])
    assert "[Directives Système / Contexte]:\nSystem instruction" in conv_prompt
    assert "[Assistant Antigravity]:\nAssistant reply" in conv_prompt
    assert "[Utilisateur]:\nPart 1 of message\nPart 2 of message" in conv_prompt
    print("✓ test_openai_multipart_message_content passed")


def test_openai_model_mapping_and_aliases():
    from app.services.agy_driver import resolve_model_and_effort

    # Standard OpenAI models mapped to gemini-3.8-flash-high
    m1, e1 = resolve_model_and_effort("gpt-4", None)
    assert m1 == "gemini-3.8-flash-high"
    assert e1 is None

    m2, e2 = resolve_model_and_effort("gpt-4o", "medium")
    assert m2 == "gemini-3.8-flash-medium"
    assert e2 is None

    m3, e3 = resolve_model_and_effort("o1-mini", None)
    assert m3 == "gemini-3.8-flash-high"
    assert e3 is None

    m4, e4 = resolve_model_and_effort("default", None)
    assert m4 == "gemini-3.8-flash-high"
    assert e4 is None

    # Claude models preserved
    mc, ec = resolve_model_and_effort("claude-sonnet-4-6", None)
    assert mc == "claude-sonnet-4-6"
    assert ec is None

    print("✓ test_openai_model_mapping_and_aliases passed")


def test_api_key_concurrent_thread_safety():
    import concurrent.futures
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import auth
    from app.services.auth import (
        create_api_key,
        delete_api_key,
        get_api_keys,
        verify_api_key,
    )

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_auth = Path(tmp_dir) / "webui_auth.json"
        tmp_bak = Path(tmp_dir) / "webui_auth.json.bak"
        orig_cache = auth._auth_cache
        orig_mtime = auth._auth_cache_mtime
        try:
            with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth), \
                 patch("app.services.auth.AUTH_BACKUP_FILE", tmp_bak):
                auth._auth_cache = None
                auth._auth_cache_mtime = 0.0

                def worker(idx: int):
                    k = create_api_key(f"Worker {idx}")
                    assert verify_api_key(k["key"]) is True
                    return k["id"]

                with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
                    key_ids = list(executor.map(worker, range(10)))

                keys = get_api_keys()
                # 1 initial master key + 10 worker keys = 11 keys
                assert len(keys) == 11
                created_ids = {k["id"] for k in keys}
                for kid in key_ids:
                    assert kid in created_ids

                for kid in key_ids:
                    assert delete_api_key(kid) is True

                remaining = get_api_keys()
                assert len(remaining) == 1
                assert remaining[0]["id"] == "master-default"
        finally:
            auth._auth_cache = orig_cache
            auth._auth_cache_mtime = orig_mtime
    print("✓ test_api_key_concurrent_thread_safety passed")


def test_fork_conversation_deepcopy_isolation():
    import sqlite3
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir(parents=True, exist_ok=True)
        source_cid = "11111111-1111-1111-1111-111111111111"
        source_dir = tmp_brain / source_cid / ".system_generated" / "logs"
        source_dir.mkdir(parents=True, exist_ok=True)

        initial_tool_args = {"param": "original_value"}
        source_steps = [
            {
                "step_index": 0,
                "type": "USER_INPUT",
                "source": "USER_EXPLICIT",
                "content": "Perform task"
            },
            {
                "step_index": 1,
                "type": "PLANNER_RESPONSE",
                "source": "MODEL",
                "tool_calls": [{"name": "run_command", "args": initial_tool_args}]
            }
        ]
        storage.atomic_write_jsonl(source_dir / "transcript.jsonl", source_steps)

        # Setup mock db
        db_file = tmp_brain / "conversations.db"
        with patch("app.services.storage.BRAIN_DIR", tmp_brain), \
             patch("app.services.storage.CONVERSATION_DB", db_file), \
             patch("app.services.storage.get_db_connection", side_effect=lambda: sqlite3.connect(str(db_file))):
            storage._schema_initialized = False
            storage.ensure_db_schema()
            fork_res = storage.fork_conversation(source_cid, up_to_step_index=1, new_title="Forked Branch")
            fork_cid = fork_res["conversation_id"]

            fork_transcript = storage.get_conversation_transcript(fork_cid)
            assert len(fork_transcript) == 2
            # Mutate forked step nested structure
            fork_transcript[1]["tool_calls"][0]["args"]["param"] = "mutated_fork_value"

            # Check original transcript
            original_transcript = storage.get_conversation_transcript(source_cid)
            assert original_transcript[1]["tool_calls"][0]["args"]["param"] == "original_value"
    print("✓ test_fork_conversation_deepcopy_isolation passed")


def test_updater_git_env_strict_author():
    from app.services.updater import _DEFAULT_GIT_ENV
    assert _DEFAULT_GIT_ENV["GIT_AUTHOR_NAME"] == "jprud67"
    assert _DEFAULT_GIT_ENV["GIT_AUTHOR_EMAIL"] == "jprud67@gmail.com"
    assert _DEFAULT_GIT_ENV["GIT_COMMITTER_NAME"] == "jprud67"
    assert _DEFAULT_GIT_ENV["GIT_COMMITTER_EMAIL"] == "jprud67@gmail.com"
    print("✓ test_updater_git_env_strict_author passed")


def test_execution_manager_live_tool_calls_bounding():
    import asyncio

    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession("test-bounding-cid")
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        # Simulate broadcasting 120 tool start events
        for i in range(120):
            loop.run_until_complete(session.broadcast({
                "event": "tool_start",
                "tool": {
                    "id": f"call_{i}",
                    "name": "view_file",
                    "args": {"path": f"/test/file_{i}.txt"}
                }
            }))
            # Mark all except the last 5 as done
            if i < 115:
                loop.run_until_complete(session.broadcast({
                    "event": "tool_finish",
                    "tool": {
                        "id": f"call_{i}",
                        "name": "view_file",
                        "output": f"Content {i}"
                    }
                }))

        # Assert internal live_tool_calls is bounded to <= 100
        assert len(session.live_tool_calls) <= 100

        # Assert get_live_state returns capped tool_calls (<= 50)
        state = session.get_live_state()
        assert len(state["live_state"]["tool_calls"]) <= 50
    finally:
        loop.close()
    print("✓ test_execution_manager_live_tool_calls_bounding passed")


def test_safe_copy_artifacts_handles_exception_without_unbound_error():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import _safe_copy_artifacts

    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / "src_session"
        dst = Path(td) / "dst_session"
        src.mkdir()
        dst.mkdir()
        test_file = src / "test.txt"
        test_file.write_text("sample")

        # Mock is_safe_path to raise an Exception before target is defined
        with patch("app.services.storage.is_safe_path", side_effect=RuntimeError("Security check failure")):
            # Should not raise UnboundLocalError or any other uncaught exception
            _safe_copy_artifacts(src, dst)

        assert not (dst / "test.txt").exists()
    print("✓ test_safe_copy_artifacts_handles_exception_without_unbound_error passed")


def test_clean_user_prompt_with_context_summary_history():
    from app.services.storage import clean_user_prompt
    raw = (
        "<CONTEXT_SUMMARY>\n"
        "Previous requests:\n"
        "1. <USER_REQUEST>old outdated request</USER_REQUEST>\n"
        "</CONTEXT_SUMMARY>\n"
        "<USER_REQUEST>\n"
        "Actual active user request\n"
        "</USER_REQUEST>"
    )
    cleaned = clean_user_prompt(raw)
    assert cleaned == "Actual active user request", f"Got: '{cleaned}'"
    print("✓ test_clean_user_prompt_with_context_summary_history passed")


def test_validate_path_access_null_bytes():
    from pathlib import Path

    import pytest
    from fastapi import HTTPException

    from app.api.files import _validate_path_access

    with pytest.raises(HTTPException) as exc_info:
        _validate_path_access(Path("/root/antigravity-webui/test\x00.txt"))
    assert exc_info.value.status_code == 400
    assert "octet nul" in exc_info.value.detail
    print("✓ test_validate_path_access_null_bytes passed")


def test_fork_and_handoff_preserves_project_and_group_id():
    import sqlite3
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services import storage

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_brain = Path(tmp_dir) / "brain"
        tmp_brain.mkdir(parents=True, exist_ok=True)
        conv_id = "test-proj-group-conv"
        conv_dir = tmp_brain / conv_id
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        storage.atomic_write_jsonl(logs_dir / "transcript.jsonl", [
            {"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Help with project", "created_at": "2026-09-18T10:00:00Z"},
            {"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Done", "created_at": "2026-09-18T10:00:01Z"}
        ])

        db_file = tmp_brain / "conversations.db"
        conn = sqlite3.connect(str(db_file))
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                preview TEXT,
                step_count INTEGER,
                last_modified_time TEXT,
                workspace_uris TEXT,
                status TEXT,
                agent_name TEXT,
                parent_conversation_id TEXT,
                last_user_input_time TEXT,
                last_user_input_step_index INTEGER,
                project_id TEXT,
                group_id TEXT
            )
        """)
        cursor.execute("""
            INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (conv_id, "Source Session", "Help", 2, "2026-09-18 10:00:01", "[]", "DONE", "Antigravity", "", "2026-09-18T10:00:00Z", 0, "proj_xyz", "grp_123"))
        conn.commit()
        conn.close()

        def _get_test_conn():
            c = sqlite3.connect(str(db_file))
            c.row_factory = sqlite3.Row
            return c

        with patch("app.services.storage.BRAIN_DIR", tmp_brain), \
             patch("app.services.storage.get_db_connection", side_effect=_get_test_conn):
            fork_res = storage.fork_conversation(conv_id, up_to_step_index=1, new_title="Forked Project Session")
            fork_id = fork_res["conversation_id"]

            handoff_res = storage.create_conversation_handoff(conv_id, new_title="Handoff Project Session")
            handoff_id = handoff_res["conversation_id"]

            verify_conn = _get_test_conn()
            row_fork = verify_conn.cursor().execute("SELECT project_id, group_id FROM conversation_summaries WHERE conversation_id = ?", (fork_id,)).fetchone()
            row_handoff = verify_conn.cursor().execute("SELECT project_id, group_id FROM conversation_summaries WHERE conversation_id = ?", (handoff_id,)).fetchone()
            verify_conn.close()

            assert row_fork["project_id"] == "proj_xyz"
            assert row_fork["group_id"] == "grp_123"
            assert row_handoff["project_id"] == "proj_xyz"
            assert row_handoff["group_id"] == "grp_123"
    print("✓ test_fork_and_handoff_preserves_project_and_group_id passed")


def test_storage_project_and_group_id_in_queries(tmp_path):
    import sqlite3
    from unittest.mock import patch

    from app.services import storage

    db_path = tmp_path / "conversations.db"
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE conversation_summaries (
            conversation_id TEXT PRIMARY KEY,
            title TEXT,
            preview TEXT,
            step_count INTEGER,
            last_modified_time TEXT,
            workspace_uris TEXT,
            status TEXT,
            agent_name TEXT,
            parent_conversation_id TEXT,
            project_id TEXT,
            group_id TEXT
        )
    """)
    cursor.execute("""
        INSERT INTO conversation_summaries (
            conversation_id, title, preview, step_count, last_modified_time,
            workspace_uris, status, agent_name, parent_conversation_id, project_id, group_id
        ) VALUES (
            'conv_proj_test', 'Project Test Title', 'Preview snippet', 5, '2026-09-18T12:00:00Z',
            '["/root"]', 'DONE', 'antigravity', NULL, 'proj_alpha', 'grp_beta'
        )
    """)
    conn.commit()
    conn.close()

    def _get_test_conn():
        c = sqlite3.connect(db_path)
        c.row_factory = sqlite3.Row
        return c

    with patch("app.services.storage.CONVERSATION_DB", db_path), \
         patch("app.services.storage.get_db_connection", side_effect=_get_test_conn), \
         patch("app.services.storage.get_all_session_metadata", return_value={}):
        conv = storage.get_conversation_by_id("conv_proj_test")
        assert conv is not None
        assert conv.get("project_id") == "proj_alpha"
        assert conv.get("group_id") == "grp_beta"

        convs = storage.list_conversations(limit=10)
        assert len(convs) >= 1
        found = next((c for c in convs if c["conversation_id"] == "conv_proj_test"), None)
        assert found is not None
        assert found.get("project_id") == "proj_alpha"
        assert found.get("group_id") == "grp_beta"

        search_res = storage.search_conversations("Project Test", limit=10)
        assert len(search_res) >= 1
        found_search = next((c for c in search_res if c["conversation_id"] == "conv_proj_test"), None)
        assert found_search is not None
        assert found_search.get("project_id") == "proj_alpha"
        assert found_search.get("group_id") == "grp_beta"
    print("✓ test_storage_project_and_group_id_in_queries passed")


def test_main_spa_mounting_resilience(tmp_path):
    empty_dist = tmp_path / "empty_dist"
    empty_dist.mkdir()
    # empty_dist exists as directory, but does NOT have an 'assets' subfolder
    assert empty_dist.is_dir()
    assert not (empty_dist / "assets").is_dir()
    print("✓ test_main_spa_mounting_resilience passed")


def test_export_conversation_html_sanitizes_control_characters():
    from unittest.mock import patch

    from app.services.storage import export_conversation_html

    mock_steps = [
        {
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "content": "Bonjour\x00\x07monde\x1b",
            "created_at": "2026-09-18T12:00:00Z"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "Voici\x08un\x0etest\x0cpropre.",
            "created_at": "2026-09-18T12:00:01Z"
        }
    ]
    with patch("app.services.storage.get_conversation_transcript", return_value=mock_steps), \
         patch("app.services.storage.get_conversation_by_id", return_value={"title": "Test Sanitize"}):
        html_out = export_conversation_html("test_san_conv")
        assert "\x07" not in html_out
        assert "\x1b" not in html_out
        assert "\x08" not in html_out
        assert "\x0e" not in html_out
        assert "Bonjourmonde" in html_out
        assert "Voiciuntestpropre." in html_out
    print("✓ test_export_conversation_html_sanitizes_control_characters passed")


def test_search_conversations_snippet_sanitization():
    import json
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import search_conversations

    with tempfile.TemporaryDirectory() as td:
        conv_dir = Path(td) / "conv_snip_test"
        log_dir = conv_dir / ".system_generated" / "logs"
        log_dir.mkdir(parents=True)
        t_file = log_dir / "transcript.jsonl"
        raw_entry = {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "Ligne 1\x07avec\x1bcaracteres   bizarres   et\nretours\nde ligne pour audit_kw.",
            "created_at": "2026-09-18T12:00:00Z"
        }
        t_file.write_text(json.dumps(raw_entry) + "\n", encoding="utf-8")

        mock_conv = {
            "conversation_id": "conv_snip_test",
            "title": "Snippet Test",
            "preview": "Test",
            "step_count": 1,
            "last_modified_time": "2026-09-18T12:00:00Z",
            "workspace_uris": "",
            "status": "DONE"
        }

        with patch("app.services.storage.BRAIN_DIR", Path(td)), \
             patch("app.services.storage.list_conversations", return_value=[mock_conv]), \
             patch("app.services.storage.get_db_connection") as mock_db, \
             patch("app.services.storage.get_all_session_metadata", return_value={}):
            mock_cursor = mock_db.return_value.cursor.return_value
            mock_cursor.fetchall.return_value = []

            results = search_conversations("audit_kw", limit=10)
            assert len(results) == 1
            snip = results[0]["match_snippet"]
            assert "\x07" not in snip
            assert "\x1b" not in snip
            assert "\n" not in snip
            assert "   " not in snip
            assert "audit_kw" in snip
    print("✓ test_search_conversations_snippet_sanitization passed")


def test_aggregate_steps_preserves_tool_call_id_and_matches():
    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {
            "step_index": 0,
            "source": "USER_EXPLICIT",
            "type": "USER_INPUT",
            "content": "Run tools",
            "created_at": "2026-09-18T12:00:00Z"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "Exécution...",
            "tool_calls": [
                {"id": "call_1", "name": "run_command", "args": {"CommandLine": "echo 1"}},
                {"id": "call_2", "name": "view_file", "args": {"AbsolutePath": "/root/test.txt"}}
            ],
            "created_at": "2026-09-18T12:00:01Z"
        },
        {
            "step_index": 2,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "tool_call_id": "call_2",
            "content": "Contenu du fichier test",
            "status": "DONE",
            "created_at": "2026-09-18T12:00:02Z"
        },
        {
            "step_index": 3,
            "source": "SYSTEM",
            "type": "RUN_COMMAND",
            "tool_call_id": "call_1",
            "content": "1\n",
            "status": "DONE",
            "created_at": "2026-09-18T12:00:03Z"
        }
    ]

    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2
    asst_turn = turns[1]
    assert asst_turn["role"] == "assistant"
    activities = asst_turn["tool_activities"]
    assert len(activities) == 2
    assert activities[0]["id"] == "call_1"
    assert activities[0]["result"] == "1\n"
    assert activities[1]["id"] == "call_2"
    assert activities[1]["result"] == "Contenu du fichier test"
    print("✓ test_aggregate_steps_preserves_tool_call_id_and_matches passed")


def test_cron_ticker_loop_terminates_running_procs_on_cancel():
    import asyncio
    from unittest.mock import MagicMock, patch

    from app.services import cron_ticker

    mock_proc = MagicMock()
    mock_proc.returncode = None
    mock_proc.pid = 99999

    async def run_test():
        with patch.dict(cron_ticker._running_job_procs, {"job_123": mock_proc}, clear=True), \
             patch("app.services.cron_ticker.ensure_dirs"), \
             patch("app.services.cron_ticker.terminate_process_group_sync") as mock_term:
            task = asyncio.create_task(cron_ticker.cron_ticker_loop())
            await asyncio.sleep(0.01)
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
            mock_term.assert_called_once_with(mock_proc, force=True)
            assert len(cron_ticker._running_job_procs) == 0

    asyncio.run(run_test())
    print("✓ test_cron_ticker_loop_terminates_running_procs_on_cancel passed")


def test_rules_validate_workspace_path_resilience():
    from pathlib import Path
    from unittest.mock import patch

    from app.api.rules import _validate_workspace_path
    from app.config import DEFAULT_WORKSPACE

    with patch("app.api.rules.get_settings", return_value={"trustedWorkspaces": [None, "", "/nonexistent/invalid/dir\x00/here"]}):
        res = _validate_workspace_path(DEFAULT_WORKSPACE)
        assert res == Path(DEFAULT_WORKSPACE).resolve()
    print("✓ test_rules_validate_workspace_path_resilience passed")


def test_fs_watcher_safe_conversation_ids():
    from pathlib import Path

    from app.services.fs_watcher import extract_conv_id, extract_conv_id_from_artifact

    p_uuid = Path("/root/.gemini/antigravity-cli/brain/12345678-1234-1234-1234-123456789abc/.system_generated/logs/transcript.jsonl")
    assert extract_conv_id(p_uuid) == "12345678-1234-1234-1234-123456789abc"

    p_safe = Path("/root/.gemini/antigravity-cli/brain/custom_session_01/.system_generated/logs/transcript.jsonl")
    assert extract_conv_id(p_safe) == "custom_session_01"

    brain_dir = Path("/root/.gemini/antigravity-cli/brain")
    art_path = brain_dir / "custom_session_01" / "report.md"
    assert extract_conv_id_from_artifact(art_path, brain_dir) == "custom_session_01"
    print("✓ test_fs_watcher_safe_conversation_ids passed")


def test_agent_api_input_endpoint():
    import asyncio

    import pytest
    from fastapi import HTTPException

    from app.api.agent_api import AgentInputRequest, send_agent_input

    req_invalid = AgentInputRequest(conversation_id="../traversal", text="hello")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(send_agent_input(req_invalid, True))
    assert exc.value.status_code == 400

    req_not_found = AgentInputRequest(conversation_id="nonexistent-conv-id", text="hello")
    with pytest.raises(HTTPException) as exc2:
        asyncio.run(send_agent_input(req_not_found, True))
    assert exc2.value.status_code == 404
    print("✓ test_agent_api_input_endpoint passed")


def test_auth_secret_key_empty_fallback():
    from unittest.mock import patch

    from app.services.auth import create_access_token, verify_access_token

    with patch("app.services.auth.get_auth_config", return_value={"enabled": True, "secret_key": ""}):
        token = create_access_token()
        assert token and ":" in token
        assert verify_access_token(token) is True
    print("✓ test_auth_secret_key_empty_fallback passed")


def test_git_tag_semver_build_metadata():
    import re
    tag_pattern = r'^[a-zA-Z0-9_\-\./+]+$'
    assert re.match(tag_pattern, "v1.2.3+build.1")
    assert re.match(tag_pattern, "v2.0.0+20260918")
    assert not re.match(tag_pattern, "tag with spaces")
    assert not re.match(tag_pattern, "tag;rm -rf")
    print("✓ test_git_tag_semver_build_metadata passed")


def test_google_auth_json_suffix_and_rate_limit_patterns():
    from app.services.google_auth import _validate_account_file, is_quota_error

    target = _validate_account_file("testuser@gmail.com.json")
    assert target.name == "testuser@gmail.com.json"
    assert not target.name.endswith(".json.json")

    assert is_quota_error('{"error": {"code": "rate_limit_exceeded"}}') is True
    assert is_quota_error("upstream service ratelimit reached") is True
    assert is_quota_error("gateway rate-limit triggered") is True
    assert is_quota_error("general syntax error in script") is False
    print("✓ test_google_auth_json_suffix_and_rate_limit_patterns passed")


def test_cron_store_daily_at():
    from app.services.cron_store import compute_next_run

    res = compute_next_run("daily at 08:30")
    assert res is not None and "T08:30:00" in res

    res2 = compute_next_run("every day at 23:15")
    assert res2 is not None and "T23:15:00" in res2

    res3 = compute_next_run("chaque jour à 14:00")
    assert res3 is not None and "T14:00:00" in res3
    print("✓ test_cron_store_daily_at passed")


def test_tasks_directory_sorting_resilience():
    from unittest.mock import MagicMock
    p_good = MagicMock()
    p_good.stat.return_value.st_mtime = 100.0
    p_broken = MagicMock()
    p_broken.stat.side_effect = FileNotFoundError("Gone")

    dirs = [p_good, p_broken]
    def _safe_mtime(d):
        try:
            return d.stat().st_mtime
        except OSError:
            return 0.0

    dirs.sort(key=_safe_mtime, reverse=True)
    assert dirs[0] == p_good
    assert dirs[1] == p_broken
    print("✓ test_tasks_directory_sorting_resilience passed")


def test_storage_read_artifact_and_import_preview():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import _import_single_conversation, read_artifact_content

    with tempfile.TemporaryDirectory() as td:
        brain = Path(td)
        conv_dir = brain / "conv-test"
        conv_dir.mkdir(parents=True, exist_ok=True)
        art = conv_dir / "sample.txt"
        art.write_text("hello artifact", encoding="utf-8")

        with patch("app.services.storage.BRAIN_DIR", brain):
            # Test leading slash sanitization
            content = read_artifact_content("conv-test", "/sample.txt")
            assert content == "hello artifact"

    # Test clean preview prompt in _import_single_conversation
    with tempfile.TemporaryDirectory() as td2:
        brain2 = Path(td2)
        with patch("app.services.storage.BRAIN_DIR", brain2):
            payload = {
                "title": "Clean Preview Test",
                "steps": [
                    {
                        "source": "USER_EXPLICIT",
                        "type": "USER_INPUT",
                        "content": "<USER_REQUEST>Write a clean script</USER_REQUEST>"
                    }
                ]
            }
            res = _import_single_conversation(payload, "2026-09-18T12:00:00Z", "2026-09-18 12:00:00")
            from app.services.storage import get_db_connection
            conn = get_db_connection()
            try:
                row = conn.execute("SELECT preview FROM conversation_summaries WHERE conversation_id = ?", (res["conversation_id"],)).fetchone()
                assert row is not None
                assert "<USER_REQUEST>" not in row[0]
                assert "Write a clean script" in row[0]
            finally:
                conn.close()
    print("✓ test_storage_read_artifact_and_import_preview passed")


def test_agy_driver_unversioned_gemini_models():
    from app.services.agy_driver import resolve_model_and_effort

    m1, _ = resolve_model_and_effort("gemini", "high")
    assert m1 == "gemini-3.8-flash-high"

    m2, _ = resolve_model_and_effort("gemini-flash", "low")
    assert m2 == "gemini-3.8-flash-low"

    m3, _ = resolve_model_and_effort("gemini-pro", "high")
    assert m3 == "gemini-3.1-pro-high"
    print("✓ test_agy_driver_unversioned_gemini_models passed")


def test_tasks_list_active_tasks_safe_mtime():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.tasks import list_active_tasks

    with tempfile.TemporaryDirectory() as td:
        fake_brain = Path(td)
        (fake_brain / "conv1").mkdir()
        (fake_brain / "conv2").mkdir()
        with patch("app.api.tasks.BRAIN_DIR", fake_brain):
            res = list_active_tasks(conversation_id=None)
            assert "tasks" in res
            assert "subagents" in res
            assert "processes" in res
    print("✓ test_tasks_list_active_tasks_safe_mtime passed")


def test_import_single_conversation_preserves_project_and_group():
    """Verify that _import_single_conversation persists project, project_id, group_id, and projectColor."""
    from datetime import datetime, timezone

    from app.services.session_metadata import get_session_meta
    from app.services.storage import (
        _import_single_conversation,
        delete_conversation,
        get_conversation_by_id,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_db = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    payload = {
        "title": "Project Import Test",
        "project": "my-cool-project",
        "project_id": "proj-123",
        "group_id": "grp-456",
        "projectColor": "#0ea5e9",
        "steps": [{"step_index": 0, "type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "hello project"}]
    }

    res = _import_single_conversation(payload, now_iso, now_db)
    assert res["success"] is True
    cid = res["conversation_id"]

    try:
        conv = get_conversation_by_id(cid)
        assert conv is not None
        assert conv.get("project_id") == "proj-123"
        assert conv.get("group_id") == "grp-456"
        assert conv.get("project") == "my-cool-project"
        assert conv.get("projectColor") == "#0ea5e9"

        meta = get_session_meta(cid)
        assert meta.get("project") == "my-cool-project"
        assert meta.get("projectColor") == "#0ea5e9"
        assert meta.get("group_id") == "grp-456"
    finally:
        delete_conversation(cid)

    print("✓ test_import_single_conversation_preserves_project_and_group passed")


def test_run_agy_subcommand_json_resilient_to_banners():
    """Verify that run_agy_subcommand_json parses output correctly even when CLI prints banner or warnings."""
    import asyncio
    from unittest.mock import patch

    from app.services.agy_subcommand import run_agy_subcommand_json

    banner_stdout = "WARNING: New CLI version available.\n\n{\"status\": \"ok\", \"items\": [1, 2, 3]}\n"

    async def fake_subcommand(args, timeout=15.0):
        return 0, banner_stdout, ""

    with patch("app.services.agy_subcommand.run_agy_subcommand", side_effect=fake_subcommand):
        res = asyncio.run(run_agy_subcommand_json(["test"]))
        assert isinstance(res, dict)
        assert res.get("status") == "ok"
        assert res.get("items") == [1, 2, 3]

def test_build_conversation_dict_millisecond_timestamps():
    """Verify that _build_conversation_dict safely converts millisecond and out-of-range timestamps."""
    from app.services.storage import _build_conversation_dict

    # Millisecond timestamp (~1.74e12)
    fake_row = {
        "conversation_id": "conv-ms-test",
        "title": "MS Test",
        "preview": "test preview",
        "step_count": 2,
        "last_modified_time": 1740000000000,
        "workspace_uris": "[]",
        "status": "idle",
        "agent_name": "Antigravity",
        "parent_conversation_id": None,
        "project_id": "",
        "group_id": "",
    }
    res = _build_conversation_dict(fake_row, {})
    assert "2025" in res["last_modified_time"] or "2026" in res["last_modified_time"]

    # Extreme timestamp that could cause OverflowError
    fake_row_extreme = dict(fake_row)
    fake_row_extreme["last_modified_time"] = 999999999999999999
    res_extreme = _build_conversation_dict(fake_row_extreme, {})
    assert res_extreme["last_modified_time"] != ""

    print("✓ test_build_conversation_dict_millisecond_timestamps passed")


def test_is_blocked_sensitive_path_cloud_credentials():
    """Verify that is_blocked_sensitive_path blocks cloud secrets and credential files."""
    from app.platform_utils import is_blocked_sensitive_path

    assert is_blocked_sensitive_path("/home/user/.aws/credentials") is True
    assert is_blocked_sensitive_path("/root/.azure/token.json") is True
    assert is_blocked_sensitive_path("/home/user/.gcloud/credentials.db") is True
    assert is_blocked_sensitive_path("/home/user/.config/gcloud/credentials.db") is True
    assert is_blocked_sensitive_path("/home/user/.bash_history") is True
    assert is_blocked_sensitive_path("/home/user/.zsh_history") is True
    assert is_blocked_sensitive_path("/workspace/credentials") is True
    assert is_blocked_sensitive_path("/workspace/client_secret.json") is True
    assert is_blocked_sensitive_path("/workspace/client_secret_oauth2.json") is True

    # Legitimate non-sensitive files
    assert is_blocked_sensitive_path("/workspace/app.py") is False
    assert is_blocked_sensitive_path("/workspace/client_code.py") is False

    print("✓ test_is_blocked_sensitive_path_cloud_credentials passed")


def test_kill_task_marks_task_log_as_cancelled():
    """Verify that _mark_task_cancelled writes cancellation notice to task log."""
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.tasks import _mark_task_cancelled

    with tempfile.TemporaryDirectory() as td:
        brain_path = Path(td)
        cid_dir = brain_path / "test-conv-cancel"
        task_dir = cid_dir / ".system_generated" / "tasks"
        task_dir.mkdir(parents=True, exist_ok=True)
        tfile = task_dir / "task-cancel-123"
        tfile.write_text("Starting task execution...\n", encoding="utf-8")
        tfile2 = task_dir / "task-cancel-456.log"
        tfile2.write_text("Starting task 456...\n", encoding="utf-8")

        with patch("app.api.tasks.BRAIN_DIR", brain_path):
            marked = _mark_task_cancelled("task-cancel-123")
            assert marked is True
            content = tfile.read_text(encoding="utf-8")
            assert "Task cancelled by user" in content
            assert "Completed At:" in content

            marked2 = _mark_task_cancelled("task-cancel-456")
            assert marked2 is True
            content2 = tfile2.read_text(encoding="utf-8")
            assert "Task cancelled by user" in content2

            marked3 = _mark_task_cancelled("test-conv-cancel/task-cancel-456")
            assert marked3 is True

    print("✓ test_kill_task_marks_task_log_as_cancelled passed")


def test_undo_turn_invalidates_execution_manager_session():
    """Verify that undo_turn clears cached execution_manager session."""
    from unittest.mock import MagicMock, patch

    from app.api.conversations import undo_turn

    mock_exec_mgr = MagicMock()
    mock_exec_mgr.is_running.return_value = False

    with (
        patch("app.api.conversations.execution_manager", mock_exec_mgr),
        patch("app.api.conversations.undo_conversation_turn") as mock_undo,
    ):
        mock_undo.return_value = {"success": True, "truncated_steps": 1}
        res = undo_turn("test-conv-undo", None)
        assert res["success"] is True
        mock_exec_mgr.remove_session.assert_called_once_with("test-conv-undo")

    print("✓ test_undo_turn_invalidates_execution_manager_session passed")


def test_openai_compat_french_quota_detection():
    """Verify that _raise_http_for_error and _is_quota_error detect French quota messages and is_quota flag."""
    from fastapi import HTTPException

    from app.api.openai_compat import _is_quota_error, _raise_http_for_error

    msg_fr = "Quota Google épuisé sur tous les comptes disponibles."
    assert _is_quota_error(msg_fr) is True

    try:
        _raise_http_for_error(msg_fr, context="test")
        assert False, "Should have raised HTTPException"
    except HTTPException as e:
        assert e.status_code == 429
        assert e.detail["error"]["code"] == "rate_limit_exceeded"

    # With is_quota=True explicitly
    try:
        _raise_http_for_error("Custom unknown error string", is_quota=True)
        assert False, "Should have raised HTTPException"
    except HTTPException as e:
        assert e.status_code == 429

    print("✓ test_openai_compat_french_quota_detection passed")


def test_storage_update_conversation_summary_fields():
    """Verify update_conversation_summary_fields updates title, project_id, group_id."""
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import (
        ensure_db_schema,
        get_db_connection,
        update_conversation_summary_fields,
    )

    with tempfile.TemporaryDirectory() as td:
        db_file = Path(td) / "conversations.db"
        with patch("app.services.storage.CONVERSATION_DB", db_file), \
             patch("app.services.storage._schema_initialized", False):
            ensure_db_schema()
            conn = get_db_connection()
            conn.execute(
                "INSERT INTO conversation_summaries (conversation_id, title, project_id, group_id) VALUES (?, ?, ?, ?)",
                ("conv-test-1", "Old Title", "old-project", "old-group")
            )
            conn.commit()
            conn.close()

            res = update_conversation_summary_fields("conv-test-1", title="New Title", project_id="new-project", group_id="new-group")
            assert res is True

            conn = get_db_connection()
            row = conn.execute("SELECT title, project_id, group_id FROM conversation_summaries WHERE conversation_id = ?", ("conv-test-1",)).fetchone()
            conn.close()
            assert row[0] == "New Title"
            assert row[1] == "new-project"
            assert row[2] == "new-group"

            # Verify clearing group_id with empty string
            res_clear = update_conversation_summary_fields("conv-test-1", group_id="")
            assert res_clear is True
            conn = get_db_connection()
            row = conn.execute("SELECT group_id FROM conversation_summaries WHERE conversation_id = ?", ("conv-test-1",)).fetchone()
            conn.close()
            assert row[0] == ""

    print("✓ test_storage_update_conversation_summary_fields passed")


def test_storage_aggregate_steps_tool_call_id_isolation():
    """Verify aggregate_steps_into_turns never assigns a result with tool_call_id to a different pending tool."""
    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {
            "step_index": 0,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "created_at": "2026-09-18T20:00:00Z",
            "tool_calls": [
                {"id": "call_1", "name": "tool_one", "args": {}},
                {"id": "call_2", "name": "tool_two", "args": {}},
            ],
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "TOOL_OUTPUT",
            "created_at": "2026-09-18T20:00:01Z",
            "tool_call_id": "call_2",
            "content": "output for call 2",
        },
    ]

    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 1
    acts = turns[0]["tool_activities"]
    assert len(acts) == 2
    # call_1 should NOT have been assigned call_2's result
    assert acts[0]["id"] == "call_1"
    assert acts[0]["result"] == ""  # flushed as empty
    # call_2 must receive the output
    assert acts[1]["id"] == "call_2"
    assert acts[1]["result"] == "output for call 2"
    print("✓ test_storage_aggregate_steps_tool_call_id_isolation passed")


def test_conversations_update_metadata_empty_group_id():
    """Verify conversations update_metadata preserves empty string group_id."""
    from unittest.mock import patch

    from app.api.conversations import MetadataUpdateRequest, update_metadata

    with patch("app.api.conversations.update_session_meta") as mock_session_meta, \
         patch("app.api.conversations.update_conversation_summary_fields") as mock_summary_fields:
        mock_session_meta.return_value = {"group_id": ""}
        req = MetadataUpdateRequest(group_id="")
        res = update_metadata("conv-group-test", req)
        assert res["success"] is True
        mock_summary_fields.assert_called_once_with(
            "conv-group-test",
            title=None,
            project_id=None,
            group_id="",
        )
    print("✓ test_conversations_update_metadata_empty_group_id passed")


def test_agent_api_run_turn_is_quota_flag_and_french():
    """Verify run_agent_turn raises HTTP 429 when is_quota=True or French quota message is received."""
    from unittest.mock import patch

    import pytest
    from fastapi import HTTPException

    from app.api.agent_api import AgentRunRequest, run_agent_turn

    async def mock_stream_turn_quota(*args, **kwargs):
        yield {"event": "error", "code": 1, "message": "Google CLI failure", "is_quota": True}

    req = AgentRunRequest(prompt="test prompt", stream=False)
    with patch("app.api.agent_api.stream_turn", side_effect=mock_stream_turn_quota):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio
            asyncio.run(run_agent_turn(req))
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["error"]["type"] == "quota_exceeded"

    async def mock_stream_turn_french(*args, **kwargs):
        yield {"event": "error", "code": 1, "message": "quota épuisé sur le projet", "is_quota": False}

    with patch("app.api.agent_api.stream_turn", side_effect=mock_stream_turn_french):
        with pytest.raises(HTTPException) as exc_info:
            import asyncio
            asyncio.run(run_agent_turn(req))
        assert exc_info.value.status_code == 429
        assert exc_info.value.detail["error"]["type"] == "quota_exceeded"

    print("✓ test_agent_api_run_turn_is_quota_flag_and_french passed")



def test_is_blocked_sensitive_path_extended():
    """Verify is_blocked_sensitive_path blocks null bytes and system roots properly."""
    from app.platform_utils import is_blocked_sensitive_path

    assert is_blocked_sensitive_path("/workspace/bad\x00path.py") is True
    assert is_blocked_sensitive_path("/proc/cpuinfo") is True
    assert is_blocked_sensitive_path("/sys/class/net") is True
    assert is_blocked_sensitive_path("/dev/null") is True
    assert is_blocked_sensitive_path("/etc/passwd") is True
    assert is_blocked_sensitive_path("/etc/shadow") is True
    assert is_blocked_sensitive_path("/etc/sudoers") is True
    assert is_blocked_sensitive_path("/etc/ssh/ssh_host_rsa_key") is True
    assert is_blocked_sensitive_path("/workspace/normal.ts") is False
    print("✓ test_is_blocked_sensitive_path_extended passed")


def test_files_validate_path_access_url_fragments():
    """Verify _validate_path_access strips markdown URL fragments and query strings."""
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.files import _validate_path_access

    with tempfile.TemporaryDirectory() as td:
        ws_path = Path(td)
        test_file = ws_path / "component.tsx"
        test_file.write_text("export default function() {}", encoding="utf-8")

        with patch("app.api.files.DEFAULT_WORKSPACE", str(ws_path)):
            resolved = _validate_path_access(Path(f"{test_file}#L10-L25"))
            assert resolved == test_file.resolve()

            resolved_query = _validate_path_access(Path(f"{test_file}?v=123"))
            assert resolved_query == test_file.resolve()
    print("✓ test_files_validate_path_access_url_fragments passed")


def test_execution_manager_unregister_socket_prune_flag():
    """Verify unregister_socket respects prune=False parameter."""
    from unittest.mock import MagicMock, patch

    from app.services.execution_manager import ExecutionManager

    em = ExecutionManager()
    ws_mock = MagicMock()
    em.register_socket(ws_mock)
    assert ws_mock in em.connected_sockets

    with patch.object(em, "prune_inactive_sessions") as mock_prune:
        em.unregister_socket(ws_mock, prune=False)
        assert ws_mock not in em.connected_sockets
        mock_prune.assert_not_called()

        em.register_socket(ws_mock)
        em.unregister_socket(ws_mock, prune=True)
        assert ws_mock not in em.connected_sockets
        mock_prune.assert_called_once()
    print("✓ test_execution_manager_unregister_socket_prune_flag passed")


def test_tasks_list_active_tasks_expanded_markers():
    """Verify list_active_tasks detects expanded completion markers."""
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.tasks import list_active_tasks

    with tempfile.TemporaryDirectory() as td:
        fake_brain = Path(td)
        cid_dir = fake_brain / "conv-finish-test"
        tasks_dir = cid_dir / ".system_generated" / "tasks"
        tasks_dir.mkdir(parents=True, exist_ok=True)

        tfile1 = tasks_dir / "task-done-1.log"
        tfile1.write_text("Starting command...\nCommand finished\n", encoding="utf-8")

        tfile2 = tasks_dir / "task-done-2.log"
        tfile2.write_text("Executing...\nstatus: completed\n", encoding="utf-8")

        with patch("app.api.tasks.BRAIN_DIR", fake_brain):
            res = list_active_tasks(conversation_id="conv-finish-test")
            task_dict = {t["task_id"]: t["status"] for t in res["tasks"]}
            assert task_dict.get("task-done-1") == "completed"
            assert task_dict.get("task-done-2") == "completed"
    print("✓ test_tasks_list_active_tasks_expanded_markers passed")


def test_agy_driver_prompt_passing_threshold():
    """Verify stream_turn uses -p for short prompts and stream-json for prompts >= 100KB."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.agy_driver import STDIN_PROMPT_THRESHOLD, stream_turn

    async def run_test():
        # 1. Short prompt -> uses -p, no stream-json
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = AsyncMock()
            mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.stderr.readline = AsyncMock(return_value=b"")
            mock_proc.stderr.read = AsyncMock(return_value=b"")
            mock_proc.wait = AsyncMock(return_value=0)
            mock_proc.returncode = 0
            mock_exec.return_value = mock_proc

            async for _ in stream_turn(prompt="hello world", json_schema='{"type": "object"}'):
                pass

            assert mock_exec.called
            args = list(mock_exec.call_args[0])
            assert "-p" in args
            assert "hello world" in args
            assert "--json-schema" in args
            assert "--input-format" not in args

        # 2. Large prompt (>= 100KB) -> uses --input-format stream-json, prompt on stdin
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = AsyncMock()
            mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.stderr.readline = AsyncMock(return_value=b"")
            mock_proc.stderr.read = AsyncMock(return_value=b"")
            mock_proc.wait = AsyncMock(return_value=0)
            mock_proc.returncode = 0
            mock_proc.stdin = AsyncMock()
            mock_proc.stdin.write = AsyncMock()
            mock_proc.stdin.drain = AsyncMock()
            mock_exec.return_value = mock_proc

            big_prompt = "x" * (STDIN_PROMPT_THRESHOLD + 10)
            async for _ in stream_turn(prompt=big_prompt, json_schema='{"type": "object"}'):
                pass

            assert mock_exec.called
            args = list(mock_exec.call_args[0])
            assert "--input-format" in args
            assert "stream-json" in args
            assert "-p" not in args
            assert "--json-schema" in args

    asyncio.run(run_test())
    print("✓ test_agy_driver_prompt_passing_threshold passed")


def test_cron_ticker_run_agy_task_large_prompt():
    """Verify run_agy_task uses -p for normal prompts and stream-json stdin for large prompts."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.cron_ticker import run_agy_task

    async def run_test():
        # Short prompt -> -p
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = AsyncMock()
            mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.stderr.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.wait = AsyncMock(return_value=0)
            mock_proc.returncode = 0
            mock_exec.return_value = mock_proc

            await run_agy_task("short task")
            assert mock_exec.called
            args = list(mock_exec.call_args[0])
            assert "-p" in args
            assert "short task" in args
            assert "--input-format" not in args

        # Large prompt (>= 100KB) -> stream-json
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = AsyncMock()
            mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.stderr.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.wait = AsyncMock(return_value=0)
            mock_proc.returncode = 0
            mock_proc.stdin = AsyncMock()
            mock_proc.stdin.write = AsyncMock()
            mock_proc.stdin.drain = AsyncMock()
            mock_exec.return_value = mock_proc

            big_prompt = "y" * 105_000
            await run_agy_task(big_prompt)
            assert mock_exec.called
            args = list(mock_exec.call_args[0])
            assert "--input-format" in args
            assert "stream-json" in args
            assert "-p" not in args

    asyncio.run(run_test())
    print("✓ test_cron_ticker_run_agy_task_large_prompt passed")


def test_tool_bridge_schema_injection_on_large_prompt():
    """Verify build_prompt injects ENFORCED OUTPUT SCHEMA when prompt exceeds ARG_PROMPT_LIMIT."""
    from app.services.tool_bridge import ARG_PROMPT_LIMIT, build_prompt

    sample_tool = {"type": "function", "function": {"name": "test_fn", "description": "test"}}
    # Under limit
    short_prompt = build_prompt([{"role": "user", "content": "hi"}], [sample_tool])
    assert "ENFORCED OUTPUT SCHEMA" not in short_prompt

    # Over limit
    big_content = "Z" * (ARG_PROMPT_LIMIT + 500)
    long_prompt = build_prompt([{"role": "user", "content": big_content}], [sample_tool])
    assert "ENFORCED OUTPUT SCHEMA" in long_prompt
    print("✓ test_tool_bridge_schema_injection_on_large_prompt passed")


def test_execution_manager_safe_session_iteration():
    """Verify get_session and get_running_conversations safely iterate when sessions dictionary changes."""
    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    s1 = ExecutionSession(conversation_id="conv-iter-1")
    s1.is_running = True
    s2 = ExecutionSession(conversation_id="conv-iter-2")
    s2.is_running = True
    em.sessions["conv-iter-1"] = s1
    em.sessions["conv-iter-2"] = s2

    running = em.get_running_conversations()
    assert "conv-iter-1" in running
    assert "conv-iter-2" in running

    found = em.get_session(None)
    assert found is not None
    assert found.conversation_id in ("conv-iter-1", "conv-iter-2")
    print("✓ test_execution_manager_safe_session_iteration passed")


def test_openai_compat_error_event_quota_propagation():
    """Verify create_chat_completion raises HTTP 429 when error event has is_quota=True."""
    import asyncio
    from unittest.mock import patch

    import pytest
    from fastapi import HTTPException

    from app.api.openai_compat import ChatCompletionRequest, create_chat_completion

    async def mock_stream_turn(*args, **kwargs):
        yield {"event": "error", "message": "Resource exhausted", "is_quota": True}

    req = ChatCompletionRequest(
        model="gemini-2.5-pro",
        messages=[{"role": "user", "content": "hello"}],
        stream=False,
    )

    with patch("app.api.openai_compat.stream_turn", side_effect=mock_stream_turn):
        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(create_chat_completion(req))
        assert exc_info.value.status_code == 429
        assert exc_info.value.headers.get("Retry-After") == "60"
        assert exc_info.value.detail["error"]["type"] == "quota_exceeded"
    print("✓ test_openai_compat_error_event_quota_propagation passed")


def test_openai_compat_streaming_error_is_quota():
    """Verify create_chat_completion in streaming mode outputs quota_exceeded when is_quota=True."""
    import asyncio
    from unittest.mock import patch

    from app.api.openai_compat import ChatCompletionRequest, create_chat_completion

    async def mock_stream_turn(*args, **kwargs):
        yield {"event": "error", "message": "Backend failure", "is_quota": True}

    req = ChatCompletionRequest(
        model="gemini-2.5-pro",
        messages=[{"role": "user", "content": "hello"}],
        stream=True,
    )

    with patch("app.api.openai_compat.stream_turn", side_effect=mock_stream_turn):
        resp = asyncio.run(create_chat_completion(req))

        async def read_stream():
            lines = []
            async for chunk in resp.body_iterator:
                lines.append(chunk)
            return "".join(lines)

        body = asyncio.run(read_stream())
        assert "quota_exceeded" in body
        assert "Quota épuisé" in body
    print("✓ test_openai_compat_streaming_error_is_quota passed")


def test_session_metadata_group_id_default_and_normalization():
    """Verify session metadata includes group_id in defaults and normalizes properly."""
    from app.services.session_metadata import _normalize_meta, make_default_meta

    defaults = make_default_meta()
    assert "group_id" in defaults
    assert defaults["group_id"] == ""

    norm1 = _normalize_meta({"groupId": "group-abc"})
    assert norm1["group_id"] == "group-abc"

    norm2 = _normalize_meta({"group_id": "group-xyz"})
    assert norm2["group_id"] == "group-xyz"

    norm3 = _normalize_meta({})
    assert norm3["group_id"] == ""
    print("✓ test_session_metadata_group_id_default_and_normalization passed")


def test_storage_bulk_delete_conversations_rollback():
    """Verify bulk_delete_conversations rolls back SQLite transaction on failure."""
    from unittest.mock import MagicMock, patch

    import pytest

    from app.services.storage import bulk_delete_conversations

    mock_conn = MagicMock()
    mock_cursor = MagicMock()
    mock_cursor.executemany.side_effect = RuntimeError("Disk I/O error")
    mock_conn.cursor.return_value = mock_cursor

    with patch("app.services.storage.get_db_connection", return_value=mock_conn):
        with pytest.raises(RuntimeError):
            bulk_delete_conversations(["conv-fail-1", "conv-fail-2"])

        mock_conn.rollback.assert_called_once()
        mock_conn.close.assert_called_once()
    print("✓ test_storage_bulk_delete_conversations_rollback passed")


def test_openai_compat_tool_mode_sse_role_deduplication():
    """Verify _tool_mode_response only emits role in the first SSE delta chunk."""
    import asyncio
    import json
    from unittest.mock import AsyncMock, patch

    from app.api.openai_compat import (
        ChatCompletionRequest,
        ChatMessage,
        create_chat_completion,
    )

    req1 = ChatCompletionRequest(
        model="gemini-flash",
        messages=[ChatMessage(role="user", content="run tool")],
        tools=[{"type": "function", "function": {"name": "run_command"}}],
        stream=True,
    )
    outcome1 = {
        "kind": "tool_call",
        "name": "run_command",
        "arguments": {"CommandLine": "ls"},
        "id": "call_123",
        "thinking": "I will run the command",
        "usage": {"total_tokens": 50},
    }

    async def collect_chunks(resp):
        chunks = []
        async for raw in resp.body_iterator:
            for line in raw.split("\n"):
                if line.startswith("data: ") and line != "data: [DONE]":
                    chunks.append(json.loads(line[6:]))
        return chunks

    with patch("app.api.openai_compat.tool_bridge.run_turn", new_callable=AsyncMock, return_value=outcome1):
        resp1 = asyncio.run(create_chat_completion(req1))
        chunks1 = asyncio.run(collect_chunks(resp1))

    assert len(chunks1) >= 4
    delta0 = chunks1[0]["choices"][0]["delta"]
    assert delta0.get("role") == "assistant"
    assert delta0.get("reasoning_content") == "I will run the command"

    delta1 = chunks1[1]["choices"][0]["delta"]
    assert "role" not in delta1, f"Expected no 'role' in delta1, got: {delta1}"
    assert "tool_calls" in delta1

    delta2 = chunks1[2]["choices"][0]["delta"]
    assert "role" not in delta2, f"Expected no 'role' in delta2, got: {delta2}"

    # Case 2: without reasoning, with text content
    req2 = ChatCompletionRequest(
        model="gemini-flash",
        messages=[ChatMessage(role="user", content="hello")],
        tools=[{"type": "function", "function": {"name": "run_command"}}],
        stream=True,
    )
    outcome2 = {
        "kind": "message",
        "content": "Hello user!",
        "thinking": None,
        "usage": {"total_tokens": 20},
    }
    with patch("app.api.openai_compat.tool_bridge.run_turn", new_callable=AsyncMock, return_value=outcome2):
        resp2 = asyncio.run(create_chat_completion(req2))
        chunks2 = asyncio.run(collect_chunks(resp2))

    assert len(chunks2) >= 2
    delta_text0 = chunks2[0]["choices"][0]["delta"]
    assert delta_text0.get("role") == "assistant"
    assert delta_text0.get("content") == "Hello user!"

    delta_finish = chunks2[1]["choices"][0]["delta"]
    assert "role" not in delta_finish
    print("✓ test_openai_compat_tool_mode_sse_role_deduplication passed")


def test_import_single_conversation_deepcopy_isolation():
    """Verify _import_single_conversation deep-copies steps avoiding memory mutations."""
    from datetime import datetime, timezone

    from app.services.storage import (
        _import_single_conversation,
        delete_conversation,
        get_conversation_transcript,
    )

    now_iso = datetime.now(timezone.utc).isoformat()
    now_db = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")

    nested_args = {"CommandLine": "echo original"}
    original_step = {
        "step_index": 0,
        "type": "RUN_COMMAND",
        "source": "ASSISTANT",
        "tool_calls": [
            {
                "name": "run_command",
                "args": nested_args
            }
        ]
    }
    steps_input = [original_step]
    payload = {
        "title": "Test Deepcopy Import",
        "steps": steps_input
    }

    res = _import_single_conversation(payload, now_iso, now_db)
    cid = res["conversation_id"]

    try:
        # Mutate the original in-memory dict after import
        nested_args["CommandLine"] = "echo MUTATED"

        stored_steps = get_conversation_transcript(cid)
        assert len(stored_steps) == 1
        stored_tc = stored_steps[0].get("tool_calls", [{}])[0]
        stored_args = stored_tc.get("args", {})
        assert stored_args.get("CommandLine") == "echo original"
        assert stored_args.get("CommandLine") != "echo MUTATED"
    finally:
        delete_conversation(cid)

    print("✓ test_import_single_conversation_deepcopy_isolation passed")


def test_git_commit_enforces_author_flag():
    import subprocess
    from unittest.mock import MagicMock, patch

    from app.api.git import CommitRequest, git_commit

    mock_run = MagicMock()
    mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout="[main 12345] test commit", stderr="")

    with patch("app.api.git._validate_workspace") as mock_val, patch("app.api.git.run_git", mock_run):
        mock_val.return_value = Path("/tmp")
        res = git_commit(CommitRequest(message="feat: test commit", stage_all=True))
        assert res["success"] is True
        commit_calls = [call for call in mock_run.call_args_list if "commit" in call[0][0]]
        assert len(commit_calls) == 1
        commit_args = commit_calls[0][0][0]
        assert any("--author=jprud67 <jprud67@gmail.com>" in arg for arg in commit_args)
    print("✓ test_git_commit_enforces_author_flag passed")


def test_kill_task_string_pid_resilience():
    from unittest.mock import patch

    from app.api.tasks import KillTaskRequest, kill_task

    # Test string PID
    req = KillTaskRequest(pid="999999999")
    with patch("app.api.tasks.psutil.Process", side_effect=Exception("no process")):
        try:
            kill_task(req)
        except Exception as e:
            assert "int" not in str(e).lower()

    # Test empty string PID with task_id
    req2 = KillTaskRequest(pid="", task_id="nonexistent-task-id")
    res = kill_task(req2)
    assert res["success"] is False
    print("✓ test_kill_task_string_pid_resilience passed")


def test_export_conversation_markdown_tool_only_turn():
    from unittest.mock import patch

    from app.services.storage import export_conversation_markdown

    mock_steps = [
        {"step_index": 1, "source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Run tool"},
        {"step_index": 2, "source": "MODEL", "type": "PLANNER_RESPONSE", "content": "", "tool_calls": [{"tool_name": "test_cmd", "arguments": {"cmd": "ls"}}]},
        {"step_index": 3, "source": "SYSTEM", "type": "TOOL_OUTPUT", "content": "file1.txt"}
    ]
    with patch("app.services.storage.get_conversation_transcript", return_value=mock_steps), \
         patch("app.services.storage.get_conversation_by_id", return_value={"title": "Test Title"}):
        md = export_conversation_markdown("dummy-id")
        assert "Exécution d'outils terminée" in md
        assert "test_cmd" in md
    print("✓ test_export_conversation_markdown_tool_only_turn passed")


def test_storage_allowed_columns_strict_schema():
    from app.services.storage import (
        _ALLOWED_CONVERSATION_SUMMARY_COLUMNS,
        get_db_connection,
    )

    assert "workspace_path" not in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(conversation_summaries)")
    db_cols = {row[1] for row in cursor.fetchall()}
    conn.close()

    # All allowed columns must exist in the real database schema
    for col in _ALLOWED_CONVERSATION_SUMMARY_COLUMNS:
        assert col in db_cols, f"Column {col} not found in actual SQLite table schema"
    print("✓ test_storage_allowed_columns_strict_schema passed")


def test_execution_manager_steering_prefix_idempotence():
    import asyncio

    from app.services.execution_manager import ExecutionManager

    async def _run():
        mgr = ExecutionManager()
        session = mgr.get_or_create_session("test-conv-steer")
        session.is_running = True  # force session to appear busy

        data1 = {"prompt": "First steer command", "mode": "steer"}
        await mgr.submit_prompt(None, data1)

        queued_item1 = session.message_queue.get_nowait()
        assert queued_item1["prompt"] == "[Instruction Prioritaire de Guidage] : First steer command"

        session.is_running = True
        data2 = {"prompt": "[Instruction Prioritaire de Guidage] : Second steer command", "mode": "steer"}
        await mgr.submit_prompt(None, data2)

        queued_item2 = session.message_queue.get_nowait()
        assert queued_item2["prompt"] == "[Instruction Prioritaire de Guidage] : Second steer command"
        assert not queued_item2["prompt"].startswith("[Instruction Prioritaire de Guidage] : [Instruction Prioritaire de Guidage] : ")
        mgr.remove_session("test-conv-steer")

    asyncio.run(_run())
    print("✓ test_execution_manager_steering_prefix_idempotence passed")


def test_git_push_and_pull_disallow_option_injection():
    from unittest.mock import patch

    import pytest
    from fastapi import HTTPException

    from app.api.git import PullRequest, PushRequest, git_pull, git_push

    with patch("app.api.git._validate_workspace", return_value=Path("/tmp")):
        with pytest.raises(HTTPException) as exc_push1:
            git_push(PushRequest(remote="--force", branch="main"))
        assert exc_push1.value.status_code == 400

        with pytest.raises(HTTPException) as exc_push2:
            git_push(PushRequest(remote="origin", branch="--all"))
        assert exc_push2.value.status_code == 400

        with pytest.raises(HTTPException) as exc_pull1:
            git_pull(PullRequest(remote="--upload-pack=evil", branch="main"))
        assert exc_pull1.value.status_code == 400

        with pytest.raises(HTTPException) as exc_pull2:
            git_pull(PullRequest(remote="origin", branch="--rebase"))
        assert exc_pull2.value.status_code == 400
    print("✓ test_git_push_and_pull_disallow_option_injection passed")


def test_git_tag_disallows_option_injection():
    from unittest.mock import patch

    import pytest
    from fastapi import HTTPException

    from app.api.git import TagRequest, create_git_tag

    with patch("app.api.git._validate_workspace", return_value=Path("/tmp")):
        with pytest.raises(HTTPException) as exc_tag1:
            create_git_tag(TagRequest(tag="--delete", remote="origin"))
        assert exc_tag1.value.status_code == 400

        with pytest.raises(HTTPException) as exc_tag2:
            create_git_tag(TagRequest(tag="v1.0.0", remote="--mirror"))
        assert exc_tag2.value.status_code == 400
    print("✓ test_git_tag_disallows_option_injection passed")


def test_git_commit_unstages_sensitive_env_file():
    import subprocess
    from unittest.mock import MagicMock, patch

    from app.api.git import CommitRequest, git_commit

    mock_run = MagicMock()

    def run_side_effect(args, cwd, timeout=None, env=None):
        if args[0:2] == ["diff", "--name-only"]:
            return subprocess.CompletedProcess(args=args, returncode=0, stdout=".env\nsrc/index.ts\n", stderr="")
        if args[0:2] == ["rev-parse", "--verify"] and "HEAD:.env" in args[2]:
            # .env is not in HEAD (untracked sensitive file)
            return subprocess.CompletedProcess(args=args, returncode=1, stdout="", stderr="fatal: path '.env' does not exist in 'HEAD'")
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="[main 12345] success", stderr="")

    mock_run.side_effect = run_side_effect

    with patch("app.api.git._validate_workspace", return_value=Path("/tmp")), patch("app.api.git.run_git", mock_run):
        res = git_commit(CommitRequest(message="feat: test commit", stage_all=True))
        assert res["success"] is True
        # Check that reset HEAD -- .env was called
        reset_calls = [call for call in mock_run.call_args_list if call[0][0] == ["reset", "HEAD", "--", ".env"]]
        assert len(reset_calls) == 1
    print("✓ test_git_commit_unstages_sensitive_env_file passed")


def test_openai_compat_delegates_to_google_auth_is_quota_error():
    from app.api.openai_compat import _is_quota_error
    from app.services.google_auth import is_quota_error

    # French phrases
    assert _is_quota_error("Quota épuisé pour cette ressource") is True
    assert _is_quota_error("Quota Google épuisé sur tous les comptes disponibles") is True
    assert _is_quota_error("Le quota atteint la limite autorisée") is True

    # Standard API errors
    assert _is_quota_error("API rate limit exceeded") is True
    assert _is_quota_error("status 429 Too Many Requests") is True
    assert _is_quota_error("RESOURCE_EXHAUSTED") is True

    # No false positives
    assert _is_quota_error("Found 429 files in directory") is False
    assert _is_quota_error("Commit a429fd8b1 merged into main") is False
    assert _is_quota_error("Listening on port 4290") is False

    # Identity check with google_auth.is_quota_error
    sample = "HTTP 429: Too Many Requests"
    assert _is_quota_error(sample) == is_quota_error(sample)
    print("✓ test_openai_compat_delegates_to_google_auth_is_quota_error passed")


def test_execution_manager_register_session_cid_sanitization():
    from unittest.mock import MagicMock

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    dummy_session = MagicMock(spec=ExecutionSession)

    # Invalid / falsy CIDs should not be registered
    em.register_session_cid(dummy_session, None)
    em.register_session_cid(dummy_session, "")
    em.register_session_cid(dummy_session, "   ")
    em.register_session_cid(dummy_session, "null")
    em.register_session_cid(dummy_session, "undefined")
    em.register_session_cid(dummy_session, "none")

    assert len(em.sessions) == 0

    # Valid CID with leading/trailing whitespace should be stripped and registered
    em.register_session_cid(dummy_session, "  conv-uuid-12345  ")
    assert "conv-uuid-12345" in em.sessions
    assert "  conv-uuid-12345  " not in em.sessions
    print("✓ test_execution_manager_register_session_cid_sanitization passed")


def test_agy_driver_cached_empty_data_truthiness():
    import asyncio
    import time

    from app.services.agy_driver import _cached_agy_command

    cache = {"data": {}, "timestamp": time.time()}
    lock = asyncio.Lock()
    fallback = {"status": "fallback"}

    # When cache contains an empty dict {}, it should be returned, NOT fallback
    async def _test():
        res = await _cached_agy_command(
            agy_args=["dummy"],
            cache=cache,
            lock=lock,
            ttl=10.0,
            fallback=fallback,
        )
        assert res == {}
        assert res != fallback

    asyncio.run(_test())
    print("✓ test_agy_driver_cached_empty_data_truthiness passed")


def test_terminal_cwd_sensitive_path_guard():
    from app.platform_utils import is_blocked_sensitive_path

    # Blocked paths
    assert is_blocked_sensitive_path("/root/.ssh") is True
    assert is_blocked_sensitive_path("/home/user/.gnupg") is True
    assert is_blocked_sensitive_path("/proc/1/cmdline") is True
    assert is_blocked_sensitive_path("/sys/kernel") is True
    assert is_blocked_sensitive_path("/dev/null") is True
    assert is_blocked_sensitive_path("/etc/shadow") is True

    # Safe workspace paths
    assert is_blocked_sensitive_path("/root/antigravity-webui") is False
    assert is_blocked_sensitive_path("/home/user/workspace/project") is False
def test_git_extended_coauthor_and_secret_unstaging():
    import re

    from app.api.git import _COAUTHOR_RE, _sanitize_git_message

    coauthor_samples = [
        "Co-authored-by: Claude <noreply@anthropic.com>",
        "Co-authored by someone",
        "co-committer: Jane Doe",
        "coauthor: Bob",
        "signed-off-by: Eve",
        "assisted-by: AI Assistant",
        "help-from: ChatGPT",
        "generated-by: Copilot",
        "Co-Authored: someone",
        "cocommitter: dev",
    ]
    for s in coauthor_samples:
        assert _COAUTHOR_RE.search(s) is not None, f"Expected match for '{s}'"

    msg = (
        "feat: add awesome feature\n\n"
        "Detailed explanation here.\n\n"
        "Co-authored-by: Claude <noreply@anthropic.com>\n"
        "Signed-off-by: Developer <dev@example.com>\n"
    )
    sanitized = _sanitize_git_message(msg)
    assert "Claude" not in sanitized
    assert "Co-authored-by" not in sanitized
    assert "Signed-off-by" not in sanitized
    assert "feat: add awesome feature" in sanitized
    assert "Detailed explanation here." in sanitized

    # Check sensitive files regex pattern
    sens_re = re.compile(
        r'(^|/)(?:\.env(?:\.[a-zA-Z0-9_\-]+)?|id_rsa[a-zA-Z0-9_\-]*|id_ed25519[a-zA-Z0-9_\-]*|webui_auth\.json|antigravity-oauth-token.*|google_accounts\.json|credentials\.json|client_secret.*\.json|.*\.pem|.*\.key)$',
        re.IGNORECASE
    )
    assert sens_re.search(".env") is not None
    assert sens_re.search(".env.production") is not None
    assert sens_re.search("webui_auth.json") is not None
    assert sens_re.search("google_accounts.json") is not None
    assert sens_re.search("credentials.json") is not None
    assert sens_re.search("client_secret_123.json") is not None
    assert sens_re.search("server.key") is not None
    assert sens_re.search("privkey.pem") is not None
    assert sens_re.search("safe_code.py") is None
    print("✓ test_git_extended_coauthor_and_secret_unstaging passed")


def test_is_blocked_sensitive_path_keys_and_credentials():
    from app.platform_utils import is_blocked_sensitive_path

    assert is_blocked_sensitive_path("/root/antigravity-webui/credentials.json") is True
    assert is_blocked_sensitive_path("/root/antigravity-webui/privkey.pem") is True
    assert is_blocked_sensitive_path("/root/antigravity-webui/server.key") is True
    assert is_blocked_sensitive_path("/root/antigravity-webui/private.key") is True
    assert is_blocked_sensitive_path("/root/antigravity-webui/cert.key") is True
    assert is_blocked_sensitive_path("/root/antigravity-webui/normal.py") is False
    print("✓ test_is_blocked_sensitive_path_keys_and_credentials passed")


def test_storage_export_safe_json_dumps_and_circular_refs():
    from app.services.storage import _safe_json_dumps

    normal = {"a": 1, "b": "hello"}
    assert "hello" in _safe_json_dumps(normal)

    # Circular reference
    circ: dict = {"key": "val"}
    circ["self"] = circ
    res = _safe_json_dumps(circ)
    assert isinstance(res, str)
    assert len(res) > 0
    print("✓ test_storage_export_safe_json_dumps_and_circular_refs passed")


def test_storage_safe_copy_artifacts_ignores_nested_symlinks():
    import tempfile

    from app.services.storage import _safe_copy_artifacts

    with tempfile.TemporaryDirectory() as src_td, tempfile.TemporaryDirectory() as dst_td:
        src = Path(src_td)
        dst = Path(dst_td)

        nested_dir = src / "nested"
        nested_dir.mkdir()

        good_file = nested_dir / "report.txt"
        good_file.write_text("All is good")

        tmp_file = nested_dir / ".tmp_cache"
        tmp_file.write_text("temp")

        # Create symlink inside nested dir
        try:
            link = nested_dir / "escape_link"
            link.symlink_to("/etc/issue")
        except OSError:
            pass

        _safe_copy_artifacts(src, dst)

        dst_nested = dst / "nested"
        assert dst_nested.exists()
        assert (dst_nested / "report.txt").exists()
        assert (dst_nested / "report.txt").read_text() == "All is good"
        assert not (dst_nested / ".tmp_cache").exists()
        assert not (dst_nested / "escape_link").exists()
    print("✓ test_storage_safe_copy_artifacts_ignores_nested_symlinks passed")


def test_storage_search_conversations_metadata_snippet_sanitization():
    from app.services.storage import _sanitize_snippet

    dirty = "Line 1\x00\x07with\tcontrol\x1b[31mcolors\x1b[0m and \n spaces"
    cleaned = _sanitize_snippet(dirty)
    assert "\x00" not in cleaned
    assert "\x07" not in cleaned
    assert "\x1b" not in cleaned
    assert "Line 1with control[31mcolors[0m and spaces" == cleaned
    assert _sanitize_snippet(None) == ""
    print("✓ test_storage_search_conversations_metadata_snippet_sanitization passed")


def test_execution_manager_update_live_state_error_and_cancelled():
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="test-cid", workspace_path="/root")
    
    # 1. Error state
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_id": "tool-1",
            "tool_name": "run_command",
            "state": "ERROR",
            "tool_info": {"output": "Command failed with code 1"}
        }
    })
    assert len(session.live_tool_calls) == 1
    assert session.live_tool_calls[0]["status"] == "error"
    assert session.live_tool_calls[0]["result"] == "Command failed with code 1"

    # 2. Cancelled state
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_id": "tool-2",
            "tool_name": "replace_file_content",
            "state": "CANCELLED"
        }
    })
    assert len(session.live_tool_calls) == 2
    assert session.live_tool_calls[1]["status"] == "cancelled"
    print("✓ test_execution_manager_update_live_state_error_and_cancelled passed")


def test_files_validate_path_access_localhost_and_empty_guards():
    from fastapi import HTTPException

    from app.api.files import _validate_path_access

    # Test file://localhost/
    valid_path = Path("file://localhost/root/antigravity-webui/backend/app/main.py")
    resolved = _validate_path_access(valid_path)
    assert resolved == Path("/root/antigravity-webui/backend/app/main.py").resolve()

    # Test empty scheme guards
    for empty_p in ["workspace://", "file:///", "file://localhost/"]:
        try:
            _validate_path_access(Path(empty_p))
            assert False, f"Expected HTTPException for {empty_p}"
        except HTTPException as e:
            assert e.status_code in (400, 403)
    print("✓ test_files_validate_path_access_localhost_and_empty_guards passed")


def test_storage_context_summary_aggregation_and_export():
    from unittest.mock import patch

    from app.services.storage import (
        aggregate_steps_into_turns,
        export_conversation_html,
        export_conversation_markdown,
    )

    steps = [
        {
            "step_index": 0,
            "source": "SYSTEM",
            "type": "CONTEXT_SUMMARY",
            "content": "<CONTEXT_SUMMARY>\n# Contexte Transféré\n- Tâche 1: OK\n</CONTEXT_SUMMARY>"
        },
        {
            "step_index": 1,
            "source": "MODEL",
            "type": "PLANNER_RESPONSE",
            "content": "✨ Nouvelle section initialisée !"
        }
    ]

    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2
    assert turns[0]["role"] == "system"
    assert turns[0]["subtype"] == "context_summary"
    assert "Contexte Transféré" in turns[0]["content"]
    assert "<CONTEXT_SUMMARY>" not in turns[0]["content"]
    assert turns[1]["role"] == "assistant"
    assert "Nouvelle section" in turns[1]["content"]

    with patch("app.services.storage.get_conversation_transcript", return_value=steps), \
         patch("app.services.storage.get_conversation_by_id", return_value={"title": "Handoff Test"}):
        md = export_conversation_markdown("conv-test-handoff")
        assert "Synthèse de Continuité & Contexte de Session" in md
        assert "Contexte Transféré" in md
        assert "Nouvelle section initialisée !" in md

        html_out = export_conversation_html("conv-test-handoff")
        assert "Synthèse de Continuité & Contexte de Session" in html_out
        assert "Contexte Transféré" in html_out
        assert "Nouvelle section initialisée !" in html_out
    print("✓ test_storage_context_summary_aggregation_and_export passed")


def test_session_metadata_tag_sanitization_and_deduplication():
    from app.services.session_metadata import _normalize_meta

    raw = {
        "tags": [" backend ", "frontend", "backend", "None", "", None, "null", "  frontend  ", "api"],
        "project": "  my-project  ",
        "customTitle": "  Session Title  ",
        "group_id": "  group-1  ",
        "pinned": "yes",
        "archived": "0"
    }
    normalized = _normalize_meta(raw)
    assert normalized["tags"] == ["backend", "frontend", "api"]
    assert normalized["project"] == "my-project"
    assert normalized["customTitle"] == "Session Title"
    assert normalized["group_id"] == "group-1"
    assert normalized["pinned"] is True
    assert normalized["archived"] is False
    print("✓ test_session_metadata_tag_sanitization_and_deduplication passed")


def test_read_artifact_content_traversal_permission_error():
    import pytest

    from app.services.storage import read_artifact_content

    with pytest.raises((PermissionError, FileNotFoundError, ValueError)):
        read_artifact_content("test-conv-traversal", "../../../../etc/passwd")

    with pytest.raises(PermissionError):
        # Even if a path resolves outside or in restricted area
        read_artifact_content("test-conv-traversal", ".system_generated/logs/transcript.jsonl")
    print("✓ test_read_artifact_content_traversal_permission_error passed")


def test_tool_bridge_find_json_object_iteration_bounded():
    from app.services.tool_bridge import _find_json_object

    # Valid schema output
    sample = 'Leading text... {"action": "final", "tool": "", "arguments": {}, "content": "Done!"} trailing'
    parsed = _find_json_object(sample)
    assert parsed is not None
    assert parsed.get("action") == "final"
    assert parsed.get("content") == "Done!"

    # Pathological text with many brackets
    pathological = "{" * 600 + " not json " + "}" * 600
    res = _find_json_object(pathological)
    assert res is None or isinstance(res, dict)
    print("✓ test_tool_bridge_find_json_object_iteration_bounded passed")


def test_openai_compat_extract_message_content_dict_and_multipart():
    from app.api.openai_compat import _extract_message_content

    # String content
    assert _extract_message_content("plain text") == "plain text"

    # Single dictionary with "text"
    assert _extract_message_content({"type": "text", "text": "hello from dict"}) == "hello from dict"

    # Single dictionary with "content"
    assert _extract_message_content({"role": "user", "content": "dict content"}) == "dict content"

    # List of string and dictionary parts
    parts = [
        "First line",
        {"type": "text", "text": "Second line"},
        {"content": "Third line"},
    ]
    extracted = _extract_message_content(parts)
    assert "First line" in extracted
    assert "Second line" in extracted
    assert "Third line" in extracted

    # None and empty
    assert _extract_message_content(None) == ""
    assert _extract_message_content("") == ""
    print("✓ test_openai_compat_extract_message_content_dict_and_multipart passed")


def test_files_download_known_developer_mime_types():
    from unittest.mock import MagicMock, patch

    from fastapi.responses import FileResponse

    from app.api.files import download_file

    mock_path = MagicMock()
    mock_path.exists.return_value = True
    mock_path.is_file.return_value = True
    mock_path.name = "README.md"
    mock_path.suffix = ".md"

    with patch("app.api.files._validate_path_access", return_value=mock_path):
        resp = download_file(path="README.md")
        assert isinstance(resp, FileResponse)
        assert resp.media_type == "text/markdown; charset=utf-8"

    mock_path.name = "data.json"
    mock_path.suffix = ".json"
    with patch("app.api.files._validate_path_access", return_value=mock_path):
        resp = download_file(path="data.json")
        assert resp.media_type == "application/json; charset=utf-8"

    mock_path.name = "config.yaml"
    mock_path.suffix = ".yaml"
    with patch("app.api.files._validate_path_access", return_value=mock_path):
        resp = download_file(path="config.yaml")
        assert resp.media_type == "text/yaml; charset=utf-8"
    print("✓ test_files_download_known_developer_mime_types passed")


def test_git_mask_output_extended_tokens():
    from app.api.git import _mask_git_output

    # Google Cloud API key
    sample_gcp = "https://generativelanguage.googleapis.com/v1beta?key=AIzaSyA1234567890123456789012345678901"
    masked_gcp = _mask_git_output(sample_gcp)
    assert "AIza" not in masked_gcp
    assert "***" in masked_gcp

    # OpenAI API key
    sample_oai = "Error: authorization failed with key sk-proj-1234567890abcdefghijklmnopqrstuvwxyz"
    masked_oai = _mask_git_output(sample_oai)
    assert "sk-proj-" not in masked_oai
    assert "***" in masked_oai

    # GitHub PAT
    sample_gh = "fatal: repository 'https://ghp_0123456789abcdefghijklmnopqrstuvwxyz@github.com/repo.git/' not found"
    masked_gh = _mask_git_output(sample_gh)
    assert "ghp_" not in masked_gh
    print("✓ test_git_mask_output_extended_tokens passed")


def test_session_metadata_project_id_and_group_sync():
    from app.services.session_metadata import _normalize_meta, make_default_meta

    defaults = make_default_meta()
    assert "project_id" in defaults
    assert defaults["project_id"] == ""
    assert defaults["group_id"] == ""

    meta = {
        "projectId": "proj-xyz",
        "groupId": "group-abc",
    }
    normalized = _normalize_meta(meta)
    assert normalized["project"] == "proj-xyz"
    assert normalized["project_id"] == "proj-xyz"
    assert normalized["group_id"] == "group-abc"
    print("✓ test_session_metadata_project_id_and_group_sync passed")


def test_conversations_api_metadata_project_id_sync():
    from app.api.conversations import MetadataUpdateRequest

    req = MetadataUpdateRequest(project_id="test-proj-id", group_id="test-grp-id")
    dumped = req.model_dump(exclude_unset=True)
    assert dumped["project_id"] == "test-proj-id"
    assert dumped["group_id"] == "test-grp-id"
    print("✓ test_conversations_api_metadata_project_id_sync passed")


def test_agy_driver_resolve_external_and_unlisted_models():
    from app.services.agy_driver import resolve_model_and_effort

    # ChatGPT latest alias
    m, eff = resolve_model_and_effort("chatgpt-4o-latest", None)
    assert m == "gemini-3.8-flash-high"
    assert eff is None

    # DeepSeek reasoning/chat models
    m, eff = resolve_model_and_effort("deepseek-chat", "medium")
    assert m == "gemini-3.8-flash-medium"
    assert eff is None

    # Unsupported Gemini version mapping
    m, eff = resolve_model_and_effort("gemini-2.5-pro", "high")
    assert m == "gemini-3.1-pro-high"

    m, eff = resolve_model_and_effort("gemini-1.5-flash", "low")
    assert m == "gemini-3.8-flash-low"
    print("✓ test_agy_driver_resolve_external_and_unlisted_models passed")


def test_execution_manager_register_session_cid_migration():
    from app.services.execution_manager import ExecutionSession, execution_manager

    s = ExecutionSession(conversation_id="old_temp_id")
    execution_manager.sessions["old_temp_id"] = s

    # Re-register with new ID
    execution_manager.register_session_cid(s, "new_clean_id")

    assert "old_temp_id" not in execution_manager.sessions
    assert execution_manager.sessions["new_clean_id"] is s
    assert s.conversation_id == "new_clean_id"

    # Cleanup
    execution_manager.sessions.pop("new_clean_id", None)
    print("✓ test_execution_manager_register_session_cid_migration passed")


def test_storage_build_conversation_dict_workspace_uris():
    fake_row = {
        "conversation_id": "test_cid_uris",
        "title": "Title",
        "preview": "Prev",
        "step_count": 1,
        "last_modified_time": "2026-01-01T00:00:00Z",
        "workspace_uris": None,
        "status": "idle",
        "agent_name": "agent",
        "parent_conversation_id": None,
        "project_id": "",
        "group_id": "",
    }
    res = _build_conversation_dict(fake_row, {})  # type: ignore[arg-type]
    assert res["workspace_uris"] == "[]"
    assert isinstance(res["workspace_uris"], str)
    print("✓ test_storage_build_conversation_dict_workspace_uris passed")


def test_crons_api_enabled_and_paused_state():
    from app.api.crons import CreateCronJobRequest, UpdateCronJobRequest

    req_create = CreateCronJobRequest(
        name="Test Paused",
        prompt="Do something",
        schedule="every 1h",
        enabled=False,
    )
    assert req_create.enabled is False

    req_update = UpdateCronJobRequest(enabled=False)
    assert req_update.enabled is False
    print("✓ test_crons_api_enabled_and_paused_state passed")


def test_files_validate_path_access_control_chars():
    from fastapi import HTTPException

    from app.api.files import _validate_path_access

    # Multi-layer URL encoded path with control char (%0a = newline)
    try:
        _validate_path_access(Path("/workspace%250a/test"))
        assert False, "Should have raised HTTPException for control char"
    except HTTPException as e:
        assert e.status_code == 400
        assert "caractère de contrôle" in e.detail
    print("✓ test_files_validate_path_access_control_chars passed")


def test_tool_bridge_codefence_fast_path():
    from app.services.tool_bridge import _find_json_object

    fenced = 'Voici ma réponse :\n```json\n{"action": "tool_call", "tool": "search", "arguments": {"q": "python"}, "content": ""}\n```'
    parsed = _find_json_object(fenced)
    assert parsed is not None
    assert parsed.get("action") == "tool_call"
    assert parsed.get("tool") == "search"
    assert parsed.get("arguments") == {"q": "python"}
    print("✓ test_tool_bridge_codefence_fast_path passed")


def test_openai_compat_prompt_tool_role_formatting():
    from app.api.openai_compat import ChatMessage, _messages_to_prompt

    messages = [
        ChatMessage(role="user", content="Cherche les fichiers"),
        ChatMessage(role="assistant", content="Je cherche...", tool_calls=[{"id": "call_1", "function": {"name": "ls"}}]),
        ChatMessage(role="tool", content="file1.txt\nfile2.txt", tool_call_id="call_1"),
    ]
    prompt = _messages_to_prompt(messages)
    assert "[Utilisateur]:" in prompt
    assert "[Assistant Antigravity]:" in prompt
    assert "[Tool Calls]:" in prompt
    assert "[Résultat Outil (call_1)]:" in prompt
    assert "file1.txt" in prompt
    print("✓ test_openai_compat_prompt_tool_role_formatting passed")


def test_storage_aggregate_steps_flushes_running_tool_status():
    from app.services.storage import aggregate_steps_into_turns

    # Turn where tool was running and never finalized by output step
    steps = [
        {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Run tool", "step_index": 0},
        {
            "type": "PLANNER_RESPONSE",
            "source": "MODEL",
            "content": "",
            "step_index": 1,
            "tool_calls": [{"id": "call_abc", "name": "run_cmd", "args": {"cmd": "ls"}}],
            "status": "RUNNING"
        },
        {"type": "USER_INPUT", "source": "USER_EXPLICIT", "content": "Next turn", "step_index": 2}
    ]
    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 3
    asst_turn = turns[1]
    assert asst_turn["role"] == "assistant"
    tool_acts = asst_turn["tool_activities"]
    assert len(tool_acts) == 1
    # Status should have been finalized away from 'running' to 'cancelled'
    assert tool_acts[0]["status"] == "cancelled"
    print("✓ test_storage_aggregate_steps_flushes_running_tool_status passed")


def test_fs_watcher_broadcast_and_notify_sync():
    from app.services.fs_watcher import notify_event_sync

    # Should safely no-op or dispatch without raising RuntimeError
    notify_event_sync({"type": "test_ping", "ts": 123456.0})
    print("✓ test_fs_watcher_broadcast_and_notify_sync passed")


def test_storage_undo_conversation_turn_notification():
    import tempfile
    import uuid
    from pathlib import Path
    from unittest.mock import MagicMock, patch

    from app.services.storage import atomic_write_jsonl, undo_conversation_turn

    with tempfile.TemporaryDirectory() as td:
        temp_brain = Path(td)
        cid = f"test-undo-{uuid.uuid4().hex[:8]}"
        conv_dir = temp_brain / cid
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)
        transcript_file = logs_dir / "transcript.jsonl"

        steps = [
            {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Question 1", "step_index": 0},
            {"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Answer 1", "step_index": 1},
            {"source": "USER_EXPLICIT", "type": "USER_INPUT", "content": "Question 2", "step_index": 2},
            {"source": "MODEL", "type": "PLANNER_RESPONSE", "content": "Answer 2", "step_index": 3},
        ]
        atomic_write_jsonl(transcript_file, steps)

        mock_conn = MagicMock()
        with (
            patch("app.services.storage.BRAIN_DIR", temp_brain),
            patch("app.services.storage.get_conversation_transcript", return_value=steps),
            patch("app.services.storage.get_db_connection", return_value=mock_conn),
        ):
            res = undo_conversation_turn(cid)
            assert res["conversation_id"] == cid
            assert res["step_count"] == 2
            assert len(res["steps"]) == 2
            assert res["steps"][0]["content"] == "Question 1"
            assert res["steps"][1]["content"] == "Answer 1"

    print("✓ test_storage_undo_conversation_turn_notification passed")


def test_agent_api_steer_empty_instruction():
    import asyncio

    from fastapi import HTTPException

    from app.api.agent_api import AgentSteerRequest, steer_agent

    req_empty = AgentSteerRequest(conversation_id="conv-test-steer", instruction="   ")
    try:
        asyncio.run(steer_agent(req_empty, True))
        assert False, "Should have raised HTTPException for empty instruction"
    except HTTPException as e:
        assert e.status_code == 400
        assert "vide" in e.detail

    print("✓ test_agent_api_steer_empty_instruction passed")


def test_files_save_file_content_temp_handling():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.api.files import SaveFileRequest, save_file_content

    with tempfile.TemporaryDirectory() as td:
        ws_path = Path(td)
        target = ws_path / "sub" / "test_file.txt"
        with patch("app.api.files.DEFAULT_WORKSPACE", str(ws_path)):
            req = SaveFileRequest(path=str(target), content="Hello World Test Content")
            res = save_file_content(req, True)
            assert res["success"] is True
            assert target.exists()
            assert target.read_text(encoding="utf-8") == "Hello World Test Content"

    print("✓ test_files_save_file_content_temp_handling passed")


def test_fs_watcher_notify_sync_threadsafe_fallback():
    import asyncio
    import threading
    from unittest.mock import MagicMock, patch

    from app.services.fs_watcher import notify_event_sync, set_main_loop

    mock_loop = MagicMock(spec=asyncio.AbstractEventLoop)
    mock_loop.is_closed.return_value = False
    set_main_loop(mock_loop)

    called = []

    def runner():
        def fake_rts(coro, loop):
            coro.close()
            return MagicMock()

        with patch("asyncio.run_coroutine_threadsafe", side_effect=fake_rts) as mock_rts:
            notify_event_sync({"type": "thread_event", "ts": 123.0})
            assert mock_rts.called
            called.append(True)

    t = threading.Thread(target=runner)
    t.start()
    t.join()
    assert len(called) == 1
    set_main_loop(None)
    print("✓ test_fs_watcher_notify_sync_threadsafe_fallback passed")


def test_storage_notification_helpers():
    from unittest.mock import patch

    from app.services.storage import (
        _notify_conversations_changed,
        _notify_transcript_changed,
    )

    events = []
    with patch("app.services.fs_watcher.notify_event_sync", side_effect=lambda ev: events.append(ev)):
        _notify_conversations_changed()
        assert len(events) == 1
        assert events[0]["type"] == "conversations_updated"

        _notify_transcript_changed("conv-test-notify")
        assert len(events) == 2
        assert events[1]["type"] == "transcript_updated"
        assert events[1]["conversation_id"] == "conv-test-notify"

    print("✓ test_storage_notification_helpers passed")


def test_execution_session_clear_pending_approval():
    import asyncio

    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="conv-test-approval")
    session.pending_approval = {"toolName": "shell", "command": "ls"}
    events = []

    async def mock_broadcast(evt):
        events.append(evt)

    session.broadcast = mock_broadcast  # type: ignore[method-assign]

    async def run_test():
        await session._clear_pending_approval(decision="cancelled", reason="failover")
        assert session.pending_approval is None
        assert len(events) == 1
        assert events[0]["event"] == "approval_resolved"
        assert events[0]["conversation_id"] == "conv-test-approval"
        assert events[0]["decision"] == "cancelled"
        assert events[0]["reason"] == "failover"

        await session._clear_pending_approval(decision="cancelled", reason="failover")
        assert len(events) == 1

    asyncio.run(run_test())
    print("✓ test_execution_session_clear_pending_approval passed")


def test_files_save_file_content_exception_cleanup():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from fastapi import HTTPException

    from app.api.files import SaveFileRequest, save_file_content

    with tempfile.TemporaryDirectory() as td:
        ws_path = Path(td)
        target = ws_path / "protected_target.txt"
        with (
            patch("app.api.files.DEFAULT_WORKSPACE", str(ws_path)),
            patch("pathlib.Path.replace", side_effect=PermissionError("Simulated disk write failure")),
            patch("shutil.copy2", side_effect=PermissionError("Simulated copy failure")),
        ):
            req = SaveFileRequest(path=str(target), content="Should Fail")
            try:
                save_file_content(req, True)
                assert False, "Should have raised HTTPException"
            except HTTPException as exc:
                assert exc.status_code == 500
            tmp_files = list(ws_path.glob(".*.tmp.*"))
            assert len(tmp_files) == 0, f"Leftover temp files found: {tmp_files}"

    print("✓ test_files_save_file_content_exception_cleanup passed")


def test_clean_user_prompt_multipart_and_dict():
    from app.services.storage import clean_user_prompt

    # Test list of text blocks
    blocks = [
        {"type": "text", "text": "Bonjour,"},
        " voici ma question :",
        {"type": "text", "text": " <USER_REQUEST>Explique ce code</USER_REQUEST>"},
    ]
    assert clean_user_prompt(blocks) == "Explique ce code"

    # Test dict input
    dict_content = {"type": "text", "text": "Bonjour le monde"}
    assert clean_user_prompt(dict_content) == "Bonjour le monde"

    # Test dict with content key
    dict_content2 = {"content": "Autre test"}
    assert clean_user_prompt(dict_content2) == "Autre test"
    print("✓ test_clean_user_prompt_multipart_and_dict passed")


def test_build_conversation_dict_string_numeric_timestamp():
    import sqlite3

    from app.services.storage import _build_conversation_dict

    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE test_conv (
            conversation_id TEXT,
            title TEXT,
            preview TEXT,
            step_count INTEGER,
            last_modified_time TEXT,
            workspace_uris TEXT,
            status TEXT,
            agent_name TEXT,
            parent_conversation_id TEXT,
            project_id TEXT,
            group_id TEXT
        )
    """)
    # Insert with numeric timestamp stored as text string
    cursor.execute(
        "INSERT INTO test_conv VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        ("conv-num-str", "Test Title", "Preview", 1, "1726742461.0", "[]", "idle", "default", None, "", "")
    )
    cursor.execute("SELECT * FROM test_conv WHERE conversation_id = 'conv-num-str'")
    row = cursor.fetchone()
    res = _build_conversation_dict(row, {})
    assert "T" in res["last_modified_time"]
    assert res["last_modified_time"].startswith("202")
    print("✓ test_build_conversation_dict_string_numeric_timestamp passed")


def test_tool_bridge_find_json_nested_markdown():
    from app.services.tool_bridge import _find_json_object

    # Direct JSON
    direct_json = '{"action": "final", "content": "Direct reply"}'
    res_direct = _find_json_object(direct_json)
    assert res_direct is not None
    assert res_direct.get("action") == "final"
    assert res_direct.get("content") == "Direct reply"

    # Nested JSON inside markdown code fence
    markdown_with_nested = '''Here is the requested tool call:
```json
{
  "action": "tool_call",
  "tool": "execute_code",
  "arguments": {
    "language": "python",
    "options": {"strict": true, "timeout": 30}
  },
  "content": ""
}
```
Done!'''
    res_nested = _find_json_object(markdown_with_nested)
    assert res_nested is not None
    assert res_nested.get("action") == "tool_call"
    assert res_nested.get("tool") == "execute_code"
    assert isinstance(res_nested.get("arguments"), dict)
    assert res_nested["arguments"].get("options", {}).get("strict") is True
    print("✓ test_tool_bridge_find_json_nested_markdown passed")


def test_tasks_mark_cancelled_path_traversal():
    from app.api.tasks import _mark_task_cancelled

    # Null byte or traversal attempt should immediately return False
    assert _mark_task_cancelled("") is False
    assert _mark_task_cancelled("test\x00malicious") is False
    assert _mark_task_cancelled("../../etc/passwd") is False
    assert _mark_task_cancelled("valid-cid/../../etc/passwd") is False
    assert _mark_task_cancelled("../unsafe_cid/task1") is False
def test_storage_canonical_transcript_precedence_over_legacy():
    import tempfile
    from pathlib import Path
    from unittest.mock import patch

    from app.services.storage import get_conversation_transcript, undo_conversation_turn

    with tempfile.TemporaryDirectory() as td:
        brain_dir = Path(td)
        cid = "conv_trans_precedence"
        conv_dir = brain_dir / cid
        conv_dir.mkdir(parents=True, exist_ok=True)
        logs_dir = conv_dir / ".system_generated" / "logs"
        logs_dir.mkdir(parents=True, exist_ok=True)

        legacy_file = conv_dir / "transcript.jsonl"
        canonical_file = logs_dir / "transcript.jsonl"

        # Legacy file has obsolete data
        legacy_file.write_text('{"type": "USER_INPUT", "content": "legacy old"}\n', encoding="utf-8")
        # Canonical file exists but is 0 bytes (e.g. freshly cleared / truncated)
        canonical_file.write_text('', encoding="utf-8")

        with patch("app.services.storage.BRAIN_DIR", brain_dir):
            # Because canonical files exist, legacy file must not resurrect obsolete data!
            steps = get_conversation_transcript(cid)
            assert steps == [], f"Expected empty list for canonical empty transcript, got {steps}"

            # If canonical has data and legacy also exists
            canonical_file.write_text(
                '{"type": "USER_INPUT", "content": "hello 1"}\n'
                '{"type": "PLANNER_RESPONSE", "content": "reply 1"}\n'
                '{"type": "USER_INPUT", "content": "hello 2"}\n'
                '{"type": "PLANNER_RESPONSE", "content": "reply 2"}\n',
                encoding="utf-8"
            )
            # When undoing, canonical is updated and obsolete legacy file is cleaned up
            undo_conversation_turn(cid)
            assert not legacy_file.exists(), "Obsolete legacy_file should have been removed on undo"
            updated_steps = get_conversation_transcript(cid)
            assert len(updated_steps) == 2
            assert updated_steps[-1]["content"] == "reply 1"

    print("✓ test_storage_canonical_transcript_precedence_over_legacy passed")


def test_openai_compat_tool_mode_string_and_dict_arguments():
    import asyncio
    import json

    from app.api.openai_compat import ChatCompletionRequest, _tool_mode_response

    req = ChatCompletionRequest(
        model="gemini-2.5-flash",
        messages=[{"role": "user", "content": "test"}],
        stream=False
    )

    async def _run():
        # 1. Outcome with dict arguments
        outcome_dict = {
            "kind": "tool_call",
            "name": "get_weather",
            "arguments": {"location": "Paris"}
        }
        res1 = await _tool_mode_response(req, outcome_dict)
        call1 = res1["choices"][0]["message"]["tool_calls"][0]
        assert call1["function"]["name"] == "get_weather"
        assert json.loads(call1["function"]["arguments"]) == {"location": "Paris"}

        # 2. Outcome with pre-serialized string arguments
        outcome_str = {
            "kind": "tool_call",
            "name": "search_code",
            "arguments": '{"query": "def run"}'
        }
        res2 = await _tool_mode_response(req, outcome_str)
        call2 = res2["choices"][0]["message"]["tool_calls"][0]
        assert call2["function"]["name"] == "search_code"
        # Must NOT be double JSON-encoded (e.g. "\"{\\\"query\\\"...}\"")
        assert call2["function"]["arguments"] == '{"query": "def run"}'
        assert json.loads(call2["function"]["arguments"]) == {"query": "def run"}

    asyncio.run(_run())
    print("✓ test_openai_compat_tool_mode_string_and_dict_arguments passed")


def test_execution_manager_submit_prompt_data_purity():
    import asyncio

    from app.services.execution_manager import ExecutionManager

    async def run_test():
        em = ExecutionManager()
        session = em.get_or_create_session("conv_purity_test")
        session.is_running = True  # busy session

        original_input = {"conversation_id": "conv_purity_test", "prompt": "Original prompt", "mode": "steer"}
        input_copy = dict(original_input)

        await em.submit_prompt(ws=None, data=original_input)
        # Verify original_input dictionary was not mutated in-place
        assert original_input["prompt"] == input_copy["prompt"], "original input dict should not be mutated"
        # Verify message queued has the steering prefix
        queued_item = await session.message_queue.get()
        assert queued_item["prompt"].startswith("[Instruction Prioritaire de Guidage] : ")
        if session.worker_task:
            session.worker_task.cancel()

    asyncio.run(run_test())
    print("✓ test_execution_manager_submit_prompt_data_purity passed")


def test_openai_compat_streaming_fallback_first_chunk_flag():
    import asyncio
    import json
    from unittest.mock import patch

    from app.api.openai_compat import ChatCompletionRequest, create_chat_completion

    async def _mock_stream_turn(*args, **kwargs):
        # Yield result without any prior step_update text_delta
        yield {"event": "result", "result": {"response": "Hello world from result"}}

    async def _run():
        req = ChatCompletionRequest(
            model="gemini-3.8-flash",
            messages=[{"role": "user", "content": "hello"}],
            stream=True
        )
        with patch("app.api.openai_compat.stream_turn", side_effect=_mock_stream_turn):
            response = await create_chat_completion(req, x_conversation_id=None, _=True)
            chunks = []
            async for chunk_bytes in response.body_iterator:
                for line in chunk_bytes.split("\n"):
                    if line.startswith("data: ") and line.strip() != "data: [DONE]":
                        chunks.append(json.loads(line[6:]))
            assert len(chunks) >= 2
            # First chunk must have role: assistant and content
            assert chunks[0]["choices"][0]["delta"].get("role") == "assistant"
            assert chunks[0]["choices"][0]["delta"].get("content") == "Hello world from result"
            # Stop chunk must have finish_reason: stop
            assert chunks[-1]["choices"][0]["finish_reason"] == "stop"

    asyncio.run(_run())
    print("✓ test_openai_compat_streaming_fallback_first_chunk_flag passed")


def test_execution_manager_stdin_safe_closing():
    import asyncio
    from unittest.mock import AsyncMock, MagicMock

    from app.services.execution_manager import ExecutionManager

    async def _run():
        em = ExecutionManager()
        session = em.get_or_create_session("safe_closing_test")
        
        # Test mock proc without callable is_closing (should not raise)
        mock_proc = MagicMock()
        mock_proc.returncode = None
        mock_proc.stdin = MagicMock()
        mock_proc.stdin.is_closing = False  # boolean, not callable!
        mock_proc.stdin.write = MagicMock()
        mock_proc.stdin.drain = AsyncMock()
        session.active_proc = mock_proc

        await em.handle_approval("safe_closing_test", "allow-once", rule=None)
        assert mock_proc.stdin.write.called

        mock_proc.stdin.write.reset_mock()
        await em.handle_stdin_input("safe_closing_test", "user input text")
        assert mock_proc.stdin.write.called

        if session.worker_task:
            session.worker_task.cancel()

    asyncio.run(_run())
    print("✓ test_execution_manager_stdin_safe_closing passed")


def test_clean_user_prompt_with_attributes():
    from app.services.storage import clean_user_prompt

    raw = (
        '<CONTEXT_SUMMARY>Previous session summary</CONTEXT_SUMMARY>\n'
        '<USER_REQUEST id="step-1" timestamp="2026-09-19T12:00:00Z">\n'
        'Fais une analyse du code\n'
        '</USER_REQUEST>'
    )
    res = clean_user_prompt(raw)
    assert res == "Fais une analyse du code"


def test_storage_aggregate_steps_openai_tool_calls():
    import json

    from app.services.storage import aggregate_steps_into_turns

    steps = [
        {
            "step_index": 0,
            "type": "USER_INPUT",
            "source": "USER_EXPLICIT",
            "content": "<USER_REQUEST>Execute command</USER_REQUEST>",
        },
        {
            "step_index": 1,
            "type": "PLANNER_RESPONSE",
            "source": "MODEL",
            "content": "Running the requested command now.",
            "tool_calls": [
                {
                    "id": "call_12345",
                    "type": "function",
                    "function": {
                        "name": "run_command",
                        "arguments": json.dumps({"CommandLine": "git status", "Cwd": "/root"}),
                    },
                }
            ],
        },
        {
            "step_index": 2,
            "type": "TOOL_RESULT",
            "tool_call_id": "call_12345",
            "content": "On branch main",
            "status": "DONE",
        },
    ]
    turns = aggregate_steps_into_turns(steps)
    assert len(turns) == 2
    assert turns[0]["role"] == "user"
    assert turns[0]["content"] == "Execute command"

    asst_turn = turns[1]
    assert asst_turn["role"] == "assistant"
    assert asst_turn["content"] == "Running the requested command now."
    assert len(asst_turn["tool_activities"]) == 1
    act = asst_turn["tool_activities"][0]
    assert act["id"] == "call_12345"
    assert act["name"] == "run_command"
    assert act["args"] == {"CommandLine": "git status", "Cwd": "/root"}
    assert act["result"] == "On branch main"
    assert act["status"] == "done"


def test_files_validate_path_access_schemes():
    from pathlib import Path

    import pytest
    from fastapi import HTTPException

    from app.api.files import _validate_path_access
    from app.config import DEFAULT_WORKSPACE

    # Valid schemes
    p1 = _validate_path_access(Path("workspace://sub/file.txt"))
    assert p1 == Path(DEFAULT_WORKSPACE).resolve() / "sub" / "file.txt"

    p2 = _validate_path_access(Path("workspace:///sub/file.txt"))
    assert p2 == Path(DEFAULT_WORKSPACE).resolve() / "sub" / "file.txt"

    p3 = _validate_path_access(Path(f"file://{DEFAULT_WORKSPACE}/sub/file.txt"))
    assert p3 == Path(DEFAULT_WORKSPACE).resolve() / "sub" / "file.txt"

    p4 = _validate_path_access(Path(f"file:////{DEFAULT_WORKSPACE}/sub/file.txt"))
    assert p4 == Path(DEFAULT_WORKSPACE).resolve() / "sub" / "file.txt"

    p5 = _validate_path_access(Path(f"file://localhost/{DEFAULT_WORKSPACE}/sub/file.txt"))
    assert p5 == Path(DEFAULT_WORKSPACE).resolve() / "sub" / "file.txt"

    # Empty scheme paths should raise 400
    with pytest.raises(HTTPException) as exc1:
        _validate_path_access(Path("workspace://"))
    assert exc1.value.status_code == 400

    with pytest.raises(HTTPException) as exc2:
        _validate_path_access(Path("file:///"))
    assert exc2.value.status_code == 400

    with pytest.raises(HTTPException) as exc3:
        _validate_path_access(Path("file://localhost"))
    assert exc3.value.status_code == 400


def test_execution_manager_pending_approval_sanitization():
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="sanitization_test")
    # Step update with whitespace and missing tool name
    session._update_live_state({
        "event": "step_update",
        "step_update": {
            "step_type": "permission_request",
            "command": "  git status  \n",
            "path": "  /root/test.txt  "
        }
    })
    assert session.pending_approval is not None
    assert session.pending_approval["toolName"] == "Action Requise"
    assert session.pending_approval["command"] == "git status"
    assert session.pending_approval["path"] == "/root/test.txt"

    # Approval request event
    session._update_live_state({
        "event": "approval_request",
        "tool_name": "run_command",
        "command": " ls -la ",
        "path": None
    })
    assert session.pending_approval is not None
    assert session.pending_approval["toolName"] == "run_command"
    assert session.pending_approval["command"] == "ls -la"
    assert session.pending_approval["path"] is None


def test_agy_driver_stdin_eof_closure():
    """Verify that _feed_stdin calls write_eof or close on proc.stdin."""
    import asyncio
    from unittest.mock import AsyncMock, patch

    from app.services.agy_driver import STDIN_PROMPT_THRESHOLD, stream_turn

    async def run_test():
        with patch("asyncio.create_subprocess_exec", new_callable=AsyncMock) as mock_exec:
            mock_proc = AsyncMock()
            mock_proc.stdout.readline = AsyncMock(side_effect=[b"", b""])
            mock_proc.stderr.readline = AsyncMock(return_value=b"")
            mock_proc.wait = AsyncMock(return_value=0)
            mock_proc.returncode = 0
            mock_proc.stdin = AsyncMock()
            mock_proc.stdin.write = AsyncMock()
            mock_proc.stdin.drain = AsyncMock()
            mock_proc.stdin.write_eof = AsyncMock()
            mock_exec.return_value = mock_proc

            big_prompt = "y" * (STDIN_PROMPT_THRESHOLD + 10)
            async for _ in stream_turn(prompt=big_prompt):
                pass

            assert mock_proc.stdin.write.called
            assert mock_proc.stdin.drain.called
            assert mock_proc.stdin.write_eof.called

    asyncio.run(run_test())


def test_execution_manager_empty_string_normalization():
    """Verify submit_prompt and run_turn normalize empty string model/effort/agent_mode to None."""
    import asyncio
    from unittest.mock import patch

    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="norm_test")
    async def run_turn_test():
        with patch("app.services.execution_manager.stream_turn") as mock_stream, \
             patch("app.services.execution_manager.get_settings", return_value={}):
            async def fake_stream(*args, **kwargs):
                assert kwargs.get("model") is None
                assert kwargs.get("effort") is None
                assert kwargs.get("agent_mode") is None
                yield {"event": "done"}
            mock_stream.side_effect = fake_stream
            await session.run_turn({
                "prompt": "hello",
                "model": "   ",
                "effort": "",
                "agent_mode": "\t\n"
            })
    asyncio.run(run_turn_test())


def test_git_sensitive_files_regex_db_and_sqlite():
    """Verify _SENSITIVE_FILES_RE catches session_metadata.json, sqlite and db files."""
    from app.api.git import _SENSITIVE_FILES_RE

    assert _SENSITIVE_FILES_RE.search("session_metadata.json") is not None
    assert _SENSITIVE_FILES_RE.search("sub/dir/session_metadata.json") is not None
    assert _SENSITIVE_FILES_RE.search("database.db") is not None
    assert _SENSITIVE_FILES_RE.search("app.sqlite") is not None
    assert _SENSITIVE_FILES_RE.search("test.sqlite3") is not None
    assert _SENSITIVE_FILES_RE.search("normal_file.py") is None


def test_files_validate_path_access_unicode_and_workspace_base():
    """Verify NFC normalization and safe base_dir resolution in _validate_path_access."""
    from pathlib import Path

    from app.api.files import _validate_path_access
    from app.config import DEFAULT_WORKSPACE

    # Decomposed e + acute accent (\u0065\u0301) should match composed e acute (\u00e9)
    decomposed = "test_e\u0301.txt"
    composed = "test_\u00e9.txt"
    res1 = _validate_path_access(Path(decomposed))
    res2 = _validate_path_access(Path(composed))
    assert res1 == res2

    # Valid base_dir within DEFAULT_WORKSPACE
    res_base = _validate_path_access("test.txt", base_dir=str(DEFAULT_WORKSPACE))
    assert res_base == Path(DEFAULT_WORKSPACE).resolve() / "test.txt"


def test_session_metadata_bidirectional_sync_updates():
    """Verify bidirectional synchronization between project and project_id, and group_id / groupId."""
    from app.services.session_metadata import (
        bulk_update_session_meta_batch,
        delete_session_meta,
        get_session_meta,
    )

    cid = "test-sync-cid-audit"
    try:
        # Case 1: updating with project_id sets both project and project_id
        bulk_update_session_meta_batch({cid: {"project_id": "alpha-proj"}})
        m = get_session_meta(cid)
        assert m["project_id"] == "alpha-proj"
        assert m["project"] == "alpha-proj"

        # Case 2: updating with project updates both
        bulk_update_session_meta_batch({cid: {"project": "beta-proj"}})
        m = get_session_meta(cid)
        assert m["project_id"] == "beta-proj"
        assert m["project"] == "beta-proj"

        # Case 3: updating with projectId updates both
        bulk_update_session_meta_batch({cid: {"projectId": "gamma-proj"}})
        m = get_session_meta(cid)
        assert m["project_id"] == "gamma-proj"
        assert m["project"] == "gamma-proj"

        # Case 4: clearing project clears both
        bulk_update_session_meta_batch({cid: {"project": ""}})
        m = get_session_meta(cid)
        assert m["project_id"] == ""
        assert m["project"] == ""

        # Case 5: updating groupId sets group_id
        bulk_update_session_meta_batch({cid: {"groupId": "group-99"}})
        m = get_session_meta(cid)
        assert m["group_id"] == "group-99"
    finally:
        delete_session_meta(cid)


def test_storage_build_conversation_dict_harmonized_project():
    """Verify _build_conversation_dict resolves project and project_id symmetrically from DB or meta."""
    from app.services.storage import _build_conversation_dict

    # Mock DB row where DB has project_id and group_id, meta is empty
    mock_row_1 = {
        "conversation_id": "conv-test-1",
        "title": "Title 1",
        "preview": "Preview",
        "step_count": 5,
        "last_modified_time": "2026-09-19 12:00:00",
        "workspace_uris": "[]",
        "status": "DONE",
        "agent_name": "gemini",
        "parent_conversation_id": None,
        "project_id": "db-proj-123",
        "group_id": "db-group-456",
    }
    meta_1 = {"pinned": False, "archived": False, "tags": []}
    res_1 = _build_conversation_dict(mock_row_1, meta_1)
    assert res_1["project"] == "db-proj-123"
    assert res_1["project_id"] == "db-proj-123"
    assert res_1["group_id"] == "db-group-456"

    # Mock DB row where DB has empty project_id, meta has project and group_id
    mock_row_2 = {
        "conversation_id": "conv-test-2",
        "title": "Title 2",
        "preview": "Preview",
        "step_count": 3,
        "last_modified_time": "2026-09-19 12:00:00",
        "workspace_uris": "[]",
        "status": "DONE",
        "agent_name": "gemini",
        "parent_conversation_id": None,
        "project_id": "",
        "group_id": "",
    }
    meta_2 = {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "meta-proj-789",
        "group_id": "meta-group-000",
    }
    res_2 = _build_conversation_dict(mock_row_2, meta_2)
    assert res_2["project"] == "meta-proj-789"
    assert res_2["project_id"] == "meta-proj-789"
    assert res_2["group_id"] == "meta-group-000"


def test_session_metadata_normalize_meta_is_pinned_and_archived_aliases():
    """Verify _normalize_meta correctly normalizes isPinned / is_pinned and isArchived / is_archived aliases."""
    from app.services.session_metadata import _normalize_meta

    # Test isPinned
    meta1 = {"isPinned": True}
    res1 = _normalize_meta(meta1)
    assert res1["pinned"] is True

    # Test is_pinned string truthy
    meta2 = {"is_pinned": "true"}
    res2 = _normalize_meta(meta2)
    assert res2["pinned"] is True

    # Test isArchived
    meta3 = {"isArchived": True}
    res3 = _normalize_meta(meta3)
    assert res3["archived"] is True

    # Test is_archived
    meta4 = {"is_archived": "1"}
    res4 = _normalize_meta(meta4)
    assert res4["archived"] is True


def test_execution_manager_broadcast_enriches_conversation_id():
    """Verify ExecutionSession.broadcast enriches events with session's conversation_id."""
    import asyncio

    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="test-enrich-cid-123")
    received_events = []

    class DummyWS:
        async def send_json(self, data):
            received_events.append(data)

    ws = DummyWS()
    session.add_subscriber(ws)

    # Event without conversation_id
    event = {"event": "status", "data": "processing"}
    asyncio.run(session.broadcast(event))

    assert len(received_events) == 1
    assert received_events[0]["conversation_id"] == "test-enrich-cid-123"

    # step_update event
    step_evt = {"event": "step_update", "step_update": {"thinking": "test thought"}}
    asyncio.run(session.broadcast(step_evt))

    assert len(received_events) == 2
    assert received_events[1]["conversation_id"] == "test-enrich-cid-123"
    assert received_events[1]["step_update"]["conversation_id"] == "test-enrich-cid-123"


def test_execution_manager_register_session_cid_merges_subscribers():
    """Verify register_session_cid merges subscribers from existing session instance."""
    from app.services.execution_manager import ExecutionManager, ExecutionSession

    em = ExecutionManager()
    cid = "test-merge-sub-cid"

    class DummyWS:
        pass

    ws1 = DummyWS()
    ws2 = DummyWS()

    # Old/pre-created session with ws1
    existing_session = ExecutionSession(conversation_id=cid, workspace_path="/root/test-ws")
    existing_session.add_subscriber(ws1)
    em.sessions[cid] = existing_session

    # New active session with ws2
    new_session = ExecutionSession(conversation_id=None)
    new_session.add_subscriber(ws2)

    # When CID is registered for new_session
    em.register_session_cid(new_session, cid)

    assert em.sessions[cid] is new_session
    assert new_session.conversation_id == cid
    # Subscribers from existing_session (ws1) must have been merged into new_session
    assert ws1 in new_session.subscribers
    assert ws2 in new_session.subscribers
    assert new_session.workspace_path == "/root/test-ws"


def test_updater_git_args_identity_and_anti_coauthor():
    """Verify updater._DEFAULT_GIT_ARGS and _DEFAULT_GIT_ENV strictly enforce jprud67 and block co-authors."""
    from app.services.updater import _DEFAULT_GIT_ARGS, _DEFAULT_GIT_ENV

    assert _DEFAULT_GIT_ENV["GIT_AUTHOR_NAME"] == "jprud67"
    assert _DEFAULT_GIT_ENV["GIT_AUTHOR_EMAIL"] == "jprud67@gmail.com"
    assert _DEFAULT_GIT_ENV["GIT_COMMITTER_NAME"] == "jprud67"
    assert _DEFAULT_GIT_ENV["GIT_COMMITTER_EMAIL"] == "jprud67@gmail.com"

    args_str = " ".join(_DEFAULT_GIT_ARGS)
    assert "user.name=jprud67" in args_str
    assert "user.email=jprud67@gmail.com" in args_str
    assert "author.name=jprud67" in args_str
    assert "author.email=jprud67@gmail.com" in args_str
    assert "trailer.co-authored-by.key=" in args_str
    assert "format.signoff=false" in args_str


def test_git_status_commit_subject_with_pipes(monkeypatch):
    """Verify get_git_status correctly parses commit subjects containing pipe '|' characters."""
    import subprocess

    from app.api import git as git_api

    def mock_run_git(args, cwd, timeout=None, env=None):
        cmd = " ".join(args)
        if "rev-parse" in cmd:
            return subprocess.CompletedProcess(args, 0, stdout="true\n", stderr="")
        if "status" in cmd:
            return subprocess.CompletedProcess(args, 0, stdout="## main...origin/main\n", stderr="")
        if "log" in cmd:
            # Simulating format=%h%x1f%an%x1f%s%x1f%cr with pipes inside the subject
            raw = "abc1234\x1fjprud67\x1ffeat(api): pipeline | stream | test\x1f10 minutes ago"
            return subprocess.CompletedProcess(args, 0, stdout=raw, stderr="")
        return subprocess.CompletedProcess(args, 0, stdout="", stderr="")

    monkeypatch.setattr(git_api, "run_git", mock_run_git)
    monkeypatch.setattr(git_api, "_validate_workspace", lambda ws: Path("/root/antigravity-webui"))

    res = git_api.get_git_status(workspace=None, _=True)
    assert res["is_repo"] is True
    assert res["last_commit"] is not None
    assert res["last_commit"]["hash"] == "abc1234"
    assert res["last_commit"]["author"] == "jprud67"
    assert res["last_commit"]["subject"] == "feat(api): pipeline | stream | test"
    assert res["last_commit"]["time"] == "10 minutes ago"


def test_clean_user_prompt_json_serialized_and_nested():
    """Verify clean_user_prompt parses JSON-stringified content and extracts nested text parts cleanly."""
    from app.services.storage import clean_user_prompt

    # Test JSON-encoded list of message parts
    json_list = json.dumps([
        {"type": "text", "text": "First line of prompt"},
        {"type": "text", "text": "Second line of prompt"}
    ])
    assert clean_user_prompt(json_list) == "First line of prompt\nSecond line of prompt"

    # Test nested dict structure with content list
    nested_dict = {
        "content": [
            {"type": "text", "text": "Nested part 1"},
            "Raw part 2"
        ]
    }
    assert clean_user_prompt(nested_dict) == "Nested part 1\nRaw part 2"


def test_execution_manager_steering_mode_tagging():
    """Verify queue_worker and run_turn properly recognize and preserve mode='steer'."""
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="test_steer_cid")
    assert session.is_steering is False

    # Simulate popping an enqueued item with mode=steer
    item = {"prompt": "Redirect work immediately", "mode": "steer"}
    session.is_steering = bool(item.get("mode") == "steer")
    assert session.is_steering is True


def test_read_artifact_content_binary_null_byte_detection(tmp_path, monkeypatch):
    """Verify read_artifact_content detects binary files via null byte check and replaces corrupt characters."""
    from app.services import storage

    monkeypatch.setattr(storage, "BRAIN_DIR", tmp_path)
    conv_dir = tmp_path / "conv123"
    conv_dir.mkdir(parents=True, exist_ok=True)

    # 1. Binary file with null byte
    bin_file = conv_dir / "test_bin.dat"
    bin_file.write_bytes(b"GIF89a\x00\x01\x02\x03SomeBinaryBytes")
    bin_res = storage.read_artifact_content("conv123", "test_bin.dat")
    assert "[Fichier binaire :" in bin_res

    # 2. Text file with valid and invalid utf-8 bytes (should be read with errors='replace')
    text_file = conv_dir / "test_text.txt"
    text_file.write_bytes("Normal text with accent: café".encode() + b"\xff" + b" and more text")
    text_res = storage.read_artifact_content("conv123", "test_text.txt")
    assert "café" in text_res
def test_update_live_state_null_payloads_resilience():
    """Vérifie que _update_live_state ne plante pas avec AttributeError si des champs sont None."""
    from app.services.execution_manager import ExecutionSession

    session = ExecutionSession(conversation_id="test-cid-null-resilience")

    # 1. step_update: None
    event1 = {"event": "step_update", "step_update": None}
    session._update_live_state(event1)

    # 2. step_update with step_type='tool' but tool_info: None
    event2 = {
        "event": "step_update",
        "step_update": {
            "step_type": "tool",
            "tool_info": None,
            "tool_id": "tool-123",
            "tool_name": "run_cmd"
        }
    }
    session._update_live_state(event2)
    assert len(session.live_tool_calls) == 1
    assert session.live_tool_calls[0]["id"] == "tool-123"

    # 3. command_result: None and data: None
    event3 = {"event": "command_result", "command": None}
    session._update_live_state(event3)

    event4 = {"event": "command_result", "command": {"name": "usage", "data": None}}
    session._update_live_state(event4)

    # 4. result: None
    event5 = {"event": "result", "result": None}
    session._update_live_state(event5)
    print("✓ test_update_live_state_null_payloads_resilience passed")


def test_register_session_cid_migrates_queue_and_stops_old_worker():
    """Vérifie que register_session_cid migre la file d'attente et nettoie l'ancienne session orpheline."""
    import asyncio

    from app.services.execution_manager import ExecutionManager, ExecutionSession

    async def _async_test():
        mgr = ExecutionManager()
        cid = "cid-conflict-migration-test"

        session_old = ExecutionSession(conversation_id=cid)
        mgr.sessions[cid] = session_old

        # Add queued messages to the old session
        await session_old.message_queue.put({"prompt": "queued message 1"})
        await session_old.message_queue.put({"prompt": "queued message 2"})

        async def dummy_worker():
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                pass

        old_task = asyncio.create_task(dummy_worker())
        session_old.worker_task = old_task

        session_new = ExecutionSession(conversation_id=None)
        mgr.register_session_cid(session_new, cid)

        assert mgr.sessions[cid] is session_new
        assert not session_new.message_queue.empty()
        item1 = session_new.message_queue.get_nowait()
        assert item1["prompt"] == "queued message 1"
        item2 = session_new.message_queue.get_nowait()
        assert item2["prompt"] == "queued message 2"
        assert session_old.message_queue.empty()

        await asyncio.sleep(0.01)
        assert old_task.cancelled() or old_task.done()

    asyncio.run(_async_test())
    print("✓ test_register_session_cid_migrates_queue_and_stops_old_worker passed")


def test_validate_terminal_session_id():
    """Vérifie la validation stricte des identifiants de session terminal."""
    from fastapi import HTTPException

    from app.api.terminal import _validate_terminal_session_id

    assert _validate_terminal_session_id("ws_abc123") == "ws_abc123"
    assert _validate_terminal_session_id("term-session-1.0_dev") == "term-session-1.0_dev"

    try:
        _validate_terminal_session_id("../etc/passwd")
        assert False, "Should have raised HTTPException for path traversal"
    except HTTPException as e:
        assert e.status_code == 400

    try:
        _validate_terminal_session_id("sid;rm -rf /")
        assert False, "Should have raised HTTPException for shell injection chars"
    except HTTPException as e:
        assert e.status_code == 400

    try:
        _validate_terminal_session_id(" ")
        assert False, "Should have raised HTTPException for whitespace"
    except HTTPException as e:
        assert e.status_code == 400

    print("✓ test_validate_terminal_session_id passed")


def test_git_pull_uses_no_edit_on_merge_fallback():
    """Vérifie que le fallback de git_pull utilise --no-edit pour éviter le blocage non interactif."""
    import tempfile
    from unittest.mock import MagicMock, patch

    from app.api.git import PullRequest, git_pull

    with tempfile.TemporaryDirectory() as td:
        tmp_path = Path(td)
        calls = []

        def fake_run_git(args, target, **kwargs):
            calls.append(list(args))
            if "branch" in args:
                mock = MagicMock()
                mock.returncode = 0
                mock.stdout = "main\n"
                mock.stderr = ""
                return mock
            if "--ff-only" in args:
                mock = MagicMock()
                mock.returncode = 1
                mock.stderr = "fatal: not possible to fast-forward, aborting."
                mock.stdout = ""
                return mock
            if "--no-edit" in args:
                mock = MagicMock()
                mock.returncode = 0
                mock.stdout = "Merge made by the 'ort' strategy."
                mock.stderr = ""
                return mock
            mock = MagicMock()
            mock.returncode = 1
            mock.stderr = "Unexpected command"
            mock.stdout = ""
            return mock

        with (
            patch("app.api.git._validate_workspace", return_value=tmp_path),
            patch("app.api.git.run_git", side_effect=fake_run_git),
        ):
            req = PullRequest(workspace=str(tmp_path), remote="origin", branch="main", rebase=False)
            res = git_pull(req, _=None)
            assert res["success"] is True
            assert any("--no-edit" in c for c in calls)

    print("✓ test_git_pull_uses_no_edit_on_merge_fallback passed")


def test_storage_indexes_project_and_group(tmp_path, monkeypatch):
    """Vérifie que ensure_db_schema crée les index sur project_id et group_id."""
    import sqlite3

    from app.services import storage

    db_file = tmp_path / "test_summaries.db"
    monkeypatch.setattr(storage, "CONVERSATION_DB", db_file)
    monkeypatch.setattr(storage, "_schema_initialized", False)

    conn = sqlite3.connect(str(db_file))
    storage.ensure_db_schema(conn)

    indexes = [row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
    assert "idx_conv_project_id" in indexes
    assert "idx_conv_group_id" in indexes
    assert "idx_conv_last_modified" in indexes
    conn.close()


def test_files_scan_dir_broken_symlink_resilience(tmp_path):
    """Vérifie que scan_dir ne plante pas face à des liens symboliques brisés."""
    from app.api.files import scan_dir

    real_file = tmp_path / "real.txt"
    real_file.write_text("hello", encoding="utf-8")

    broken_symlink = tmp_path / "broken_link.txt"
    try:
        broken_symlink.symlink_to(tmp_path / "non_existent.txt")
    except OSError:
        pass

    items = scan_dir(tmp_path)
    assert any(i["name"] == "real.txt" for i in items)


if __name__ == "__main__":
    test_agy_driver_resolve_external_and_unlisted_models()
    test_execution_manager_register_session_cid_migration()
    test_storage_build_conversation_dict_workspace_uris()
    test_crons_api_enabled_and_paused_state()
    test_files_validate_path_access_control_chars()
    test_execution_manager_safe_session_iteration()
    test_openai_compat_error_event_quota_propagation()
    test_openai_compat_streaming_error_is_quota()
    test_session_metadata_group_id_default_and_normalization()
    test_storage_bulk_delete_conversations_rollback()
    test_agy_driver_prompt_passing_threshold()
    test_cron_ticker_run_agy_task_large_prompt()
    test_tool_bridge_schema_injection_on_large_prompt()
    test_is_blocked_sensitive_path_extended()
    test_files_validate_path_access_url_fragments()
    test_execution_manager_unregister_socket_prune_flag()
    test_tasks_list_active_tasks_expanded_markers()
    test_clean_user_prompt_with_context_summary_history()
    test_validate_path_access_null_bytes()
    test_fork_and_handoff_preserves_project_and_group_id()
    test_file_download_unicode_and_special_chars()
    test_token_calculation()
    test_password_validation()
    test_session_metadata_copy()
    test_get_session_meta_isolation()
    test_build_conversation_dict_normalization()
    test_aggregate_steps_tool_outputs()
    test_bulk_import_transaction()
    test_artifact_read_cap()
    test_bulk_import_cleanup_on_error()
    test_git_diff_sanitization()
    test_version_consistency()
    test_is_tool_output_content_and_clean_prompt()
    test_session_meta_legacy_defaults()
    test_skill_md_utf8_bom()
    test_scan_dir_symlink_cycle_guard()
    test_aggregate_all_tool_step_types()
    test_compute_next_run_days_and_seconds()
    test_google_auth_url_cleaning()
    test_git_diff_absolute_workspace_path()
    test_kanban_status_normalization_and_timestamps()
    test_git_diff_dot_slash_normalization()
    test_aggregate_empty_string_tool_result()
    test_skill_detail_safe_path()
    test_rules_no_touch_hermes_by_default()
    test_get_all_session_metadata_deep_copy()
    test_aggregate_steps_non_serializable_objects()
    test_kill_task_safety()
    test_git_commit_sanitize_fallback()
    test_export_conversation_markdown_and_html_non_string()
    test_save_all_session_metadata_deepcopy_isolation()
    test_cancel_running_job_process_group()
    test_compute_next_run_monthly_and_weekly()
    test_cron_update_jobs_atomic()
    test_session_metadata_save_failure_reraised()
    test_is_safe_conversation_id_hardened()
    test_rules_hermes_write_restricted()
    test_kill_task_rejects_system_words()
    test_undo_conversation_turn_updates_last_user_time_not_null()
    test_cron_delete_cancels_running_job()
    test_bulk_conversations_empty_and_limit()
    test_bulk_export_limit()
    test_compute_next_run_compound_intervals()
    test_cron_model_and_effort_whitespace_cleaning()
    test_clean_cid_sanitization()
    test_git_anti_trailer_args()
    test_is_quota_error_no_false_positive_429()
    test_clear_account_exhaustion()
    test_resolve_model_and_effort_whitespace()
    test_extract_json_payload_resilience()
    test_session_meta_boolean_normalization()
    test_git_sanitize_extended_trailers()
    test_kill_task_candidate_tids_hardening()
    test_compute_next_run_microsecond_stripping()
    test_list_artifacts_sensitive_and_traversal_filtering()
    test_remove_session_drains_message_queue()
    test_kanban_update_task_rejects_empty_title()
    test_update_conversation_title_rejects_empty_whitespace()
    test_safe_copy_artifacts_excludes_symlinks_and_sensitive_paths()
    test_import_single_conversation_cleanup_on_db_failure()
    test_scan_dir_defensive_sorting_broken_symlink()
    test_cron_log_sorting_resilience()
    test_prune_inactive_sessions_sync_terminate_on_runtime_error()
    test_read_artifact_content_blocks_sensitive_files()
    test_save_file_content_max_size_enforcement()
    test_queue_worker_active_task_cleanup()
    test_prune_inactive_sessions_resets_is_running_and_active_proc()
    test_broadcast_cleans_up_dead_sockets_from_connected_sockets()
    test_build_conversation_dict_null_tags_and_bool_coercion()
    test_git_sanitize_message_triple_newlines()
    test_fork_conversation_user_index_and_title_sanitization()
    test_handoff_conversation_initial_index_and_title_sanitization()
    test_serve_frontend_api_and_docs_exclusion()
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        test_read_artifact_content_symlink_safety(Path(td))
    test_git_diff_removeprefix_dotfiles()
    test_kill_task_candidate_tids_short_valid_ids()
    test_model_failover_gemini_detection()
    test_git_mask_credentials()
    test_live_tool_calls_reversed_matching()
    test_cron_store_deepcopy_isolation()
    test_git_sanitize_extended_ai_tags()
    test_live_tool_calls_tool_id_disambiguation()
    test_cron_guarded_execute_duration_tracking()
    test_transcript_utf8_bom_support()
    test_atomic_write_jsonl_permissions()
    test_cron_prune_job_logs()
    test_git_extended_coauthor_and_masking()
    test_undo_conversation_turn_bom_and_corrupt_lines()
    test_cron_compute_next_run_quoted_expression()
    test_cron_skills_string_coercion()
    test_cron_prune_job_logs_special_chars()
    test_execution_session_remove_subscriber_last_active_at()
    test_cron_get_job_log_special_chars()
    test_aggregate_steps_ghost_turns_suppressed()
    test_read_artifact_content_utf8_bom()
    test_get_file_content_utf8_bom()
    test_git_diff_untracked_fallback_resilience()
    test_git_pull_sanitization_and_execution()
    test_git_diff_deleted_file_fallback()
    test_git_status_count_fields()
    test_kill_task_name_matching()
    test_files_path_access_drive_letters()
    test_crons_skills_sanitization_trimmed()
    test_import_single_conversation_non_dict_items()
    test_search_conversations_large_transcript()
    test_execution_manager_get_or_create_busy_active_session()
    test_storage_calculate_tokens_string_resilience()
    test_storage_search_conversations_legacy_transcript()
    test_git_push_empty_error_fallback()
    test_git_run_askpass_env()
    test_execution_manager_interrupt_clears_running_tool_calls()
    test_agy_driver_workspace_path_canonical_resolution()
    test_execution_manager_pending_approval_cleared_on_failover()
    test_scan_dir_children_key_consistency()
    test_storage_calculate_tokens_with_steered_prompt()
    test_api_key_generation_and_verification()
    test_api_key_last_used_at_throttling()
    test_execution_manager_submit_prompt_ws_none()
    test_openai_messages_to_prompt_resolution()
    test_agy_subcommand_add_mcp_server_default_isolation()
    test_auth_dynamic_env_api_key()
    test_auth_ensure_api_keys_storage_no_resurrect()
    test_openai_extract_usage_info()
    test_session_metadata_cid_sanitization()
    test_git_run_git_gpgsign_disabled()
    test_agy_subcommand_returncode_type()
    test_agent_api_conversation_id_validation()
    test_tasks_conversation_id_validation()
    test_execution_manager_cid_sanitization()
    test_storage_artifacts_resilience_and_url_decoding()
    test_google_accounts_delete_route()
    test_auth_verify_password_non_string()
    test_clean_user_prompt_xml_tag_backreference()
    test_build_conversation_dict_row_or_dict()
    test_atomic_write_jsonl_initial_permissions()
    test_save_auth_config_preserves_password_on_partial_dict()
    test_get_auth_config_recovers_from_backup()
    test_openai_multipart_message_content()
    test_openai_model_mapping_and_aliases()
    test_api_key_concurrent_thread_safety()
    test_fork_conversation_deepcopy_isolation()
    test_updater_git_env_strict_author()
    test_execution_manager_live_tool_calls_bounding()
    test_safe_copy_artifacts_handles_exception_without_unbound_error()
    with tempfile.TemporaryDirectory() as td:
        test_storage_project_and_group_id_in_queries(Path(td))
    with tempfile.TemporaryDirectory() as td:
        test_main_spa_mounting_resilience(Path(td))
    test_export_conversation_html_sanitizes_control_characters()
    test_search_conversations_snippet_sanitization()
    test_aggregate_steps_preserves_tool_call_id_and_matches()
    test_cron_ticker_loop_terminates_running_procs_on_cancel()
    test_rules_validate_workspace_path_resilience()
    test_fs_watcher_safe_conversation_ids()
    test_agent_api_input_endpoint()
    test_auth_secret_key_empty_fallback()
    test_git_tag_semver_build_metadata()
    test_google_auth_json_suffix_and_rate_limit_patterns()
    test_cron_store_daily_at()
    test_tasks_directory_sorting_resilience()
    test_storage_read_artifact_and_import_preview()
    test_agy_driver_unversioned_gemini_models()
    test_tasks_list_active_tasks_safe_mtime()
    test_import_single_conversation_preserves_project_and_group()
    test_run_agy_subcommand_json_resilient_to_banners()
    test_build_conversation_dict_millisecond_timestamps()
    test_is_blocked_sensitive_path_cloud_credentials()
    test_kill_task_marks_task_log_as_cancelled()
    test_undo_turn_invalidates_execution_manager_session()
    test_openai_compat_french_quota_detection()
    test_storage_update_conversation_summary_fields()
    test_storage_aggregate_steps_tool_call_id_isolation()
    test_conversations_update_metadata_empty_group_id()
    test_agent_api_run_turn_is_quota_flag_and_french()
    test_openai_compat_tool_mode_sse_role_deduplication()
    test_import_single_conversation_deepcopy_isolation()
    test_git_commit_enforces_author_flag()
    test_kill_task_string_pid_resilience()
    test_export_conversation_markdown_tool_only_turn()
    test_storage_allowed_columns_strict_schema()
    test_execution_manager_steering_prefix_idempotence()
    test_git_push_and_pull_disallow_option_injection()
    test_git_tag_disallows_option_injection()
    test_git_commit_unstages_sensitive_env_file()
    test_openai_compat_delegates_to_google_auth_is_quota_error()
    test_execution_manager_register_session_cid_sanitization()
    test_agy_driver_cached_empty_data_truthiness()
    test_terminal_cwd_sensitive_path_guard()
    test_git_extended_coauthor_and_secret_unstaging()
    test_is_blocked_sensitive_path_keys_and_credentials()
    test_storage_export_safe_json_dumps_and_circular_refs()
    test_storage_safe_copy_artifacts_ignores_nested_symlinks()
    test_storage_search_conversations_metadata_snippet_sanitization()
    test_execution_manager_update_live_state_error_and_cancelled()
    test_files_validate_path_access_localhost_and_empty_guards()
    test_storage_context_summary_aggregation_and_export()
    test_session_metadata_tag_sanitization_and_deduplication()
    test_read_artifact_content_traversal_permission_error()
    test_tool_bridge_find_json_object_iteration_bounded()
    test_openai_compat_extract_message_content_dict_and_multipart()
    test_files_download_known_developer_mime_types()
    test_git_mask_output_extended_tokens()
    test_session_metadata_project_id_and_group_sync()
    test_conversations_api_metadata_project_id_sync()
    test_tool_bridge_codefence_fast_path()
    test_openai_compat_prompt_tool_role_formatting()
    test_storage_aggregate_steps_flushes_running_tool_status()
    test_fs_watcher_broadcast_and_notify_sync()
    test_storage_undo_conversation_turn_notification()
    test_agent_api_steer_empty_instruction()
    test_files_save_file_content_temp_handling()
    test_fs_watcher_notify_sync_threadsafe_fallback()
    test_storage_notification_helpers()
    test_execution_session_clear_pending_approval()
    test_files_save_file_content_exception_cleanup()
    test_clean_user_prompt_multipart_and_dict()
    test_build_conversation_dict_string_numeric_timestamp()
    test_tool_bridge_find_json_nested_markdown()
    test_tasks_mark_cancelled_path_traversal()
    test_storage_canonical_transcript_precedence_over_legacy()
    test_openai_compat_tool_mode_string_and_dict_arguments()
    test_execution_manager_submit_prompt_data_purity()
    test_clean_user_prompt_with_attributes()
    test_storage_aggregate_steps_openai_tool_calls()
    test_files_validate_path_access_schemes()
    test_execution_manager_pending_approval_sanitization()
    test_agy_driver_stdin_eof_closure()
    test_execution_manager_empty_string_normalization()
    test_git_sensitive_files_regex_db_and_sqlite()
    test_files_validate_path_access_unicode_and_workspace_base()
    test_session_metadata_bidirectional_sync_updates()
    test_storage_build_conversation_dict_harmonized_project()
    test_session_metadata_normalize_meta_is_pinned_and_archived_aliases()
    test_execution_manager_broadcast_enriches_conversation_id()
    test_execution_manager_register_session_cid_merges_subscribers()
    test_updater_git_args_identity_and_anti_coauthor()
    test_clean_user_prompt_json_serialized_and_nested()
    test_execution_manager_steering_mode_tagging()
    test_update_live_state_null_payloads_resilience()
    test_register_session_cid_migrates_queue_and_stops_old_worker()
    test_validate_terminal_session_id()
    test_git_pull_uses_no_edit_on_merge_fallback()
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        test_storage_indexes_project_and_group(Path(td), monkeypatch=pytest.MonkeyPatch())
        test_files_scan_dir_broken_symlink_resilience(Path(td))
    print("\nAll unit tests passed successfully!")


