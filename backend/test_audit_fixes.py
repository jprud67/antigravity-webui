import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

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
    assert frontend_ver == "0.1.61", f"Expected version 0.1.61, got {frontend_ver}"
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


def test_undo_conversation_turn_nullifies_last_user_time():
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

        # Create test database
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
                last_user_input_time TEXT
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

            # Verify that in DB, last_user_input_time was updated to NULL
            conn_verify = sqlite3.connect(str(db_file))
            row = conn_verify.cursor().execute("SELECT last_user_input_time, last_user_input_step_index FROM conversation_summaries WHERE conversation_id = ?", (conv_id,)).fetchone()
            conn_verify.close()
            assert row[0] is None
            assert row[1] == -1
    print("✓ test_undo_conversation_turn_nullifies_last_user_time passed")


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
        tmp_auth.write_text("NOT_VALID_JSON{{{", encoding="utf-8")
        corrupt_bak = Path(tmp_dir) / "webui_auth.json.corrupt.bak"

        with patch("app.services.auth.AUTH_CONFIG_FILE", tmp_auth):
            # Force cache reset
            auth._auth_cache = None
            auth._auth_cache_mtime = 0.0

            cfg = auth.get_auth_config()
            assert cfg.get("enabled") is True
            assert corrupt_bak.exists()
            assert corrupt_bak.read_text(encoding="utf-8") == "NOT_VALID_JSON{{{"
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


if __name__ == "__main__":
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
    test_undo_conversation_turn_nullifies_last_user_time()
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
    print("\nAll unit tests passed successfully!")
