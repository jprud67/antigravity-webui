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

    import pytest

    from app.services.session_metadata import save_all_session_metadata

    with (
        patch("pathlib.Path.replace", side_effect=OSError("Disk full or permission denied")),
        pytest.raises(OSError),
    ):
        save_all_session_metadata({"test": {"pinned": True}})
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

    import pytest
    from fastapi import HTTPException

    from app.api.rules import SaveRuleRequest, save_rule_content

    # Ensure ENABLE_HERMES_WRITE is not set
    assert os.environ.get("ENABLE_HERMES_WRITE", "0") != "1"

    req_arch = SaveRuleRequest(file_id="hermes_arch", content="# New Arch")
    with pytest.raises(HTTPException) as exc_info:
        save_rule_content(req_arch, _=None)
    assert exc_info.value.status_code == 403

    req_journal = SaveRuleRequest(file_id="hermes_journal", content="# New Journal")
    with pytest.raises(HTTPException) as exc_info2:
        save_rule_content(req_journal, _=None)
    assert exc_info2.value.status_code == 403
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
    print("\nAll unit tests passed successfully!")

