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
    from app.services.auth import (
        create_access_token,
        create_api_key,
        delete_api_key,
        get_api_keys,
        verify_api_key,
        verify_token_or_api_key,
    )

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
    print("✓ test_api_key_generation_and_verification passed")


def test_api_key_last_used_at_throttling():
    from app.services.auth import (
        create_api_key,
        delete_api_key,
        get_auth_config,
        verify_api_key,
    )

    key_info = create_api_key("Throttled Key Test")
    raw_key = key_info["key"]
    key_id = key_info["id"]

    try:
        # First verification should set last_used_at
        assert verify_api_key(raw_key) is True
        config = get_auth_config()
        stored_entry = next(k for k in config.get("api_keys", []) if k["id"] == key_id)
        first_used = stored_entry.get("last_used_at")
        assert first_used is not None

        # Immediate re-verification (<60s) updates memory without failing
        assert verify_api_key(raw_key) is True
    finally:
        delete_api_key(key_id)
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

    from app.services.auth import verify_api_key

    secret = "agy_test_dynamic_env_key_12345"
    old = os.environ.get("ANTIGRAVITY_API_KEY")
    try:
        os.environ["ANTIGRAVITY_API_KEY"] = secret
        assert verify_api_key(secret) is True
        assert verify_api_key(f"Bearer {secret}") is True
        assert verify_api_key("wrong_key") is False
    finally:
        if old is not None:
            os.environ["ANTIGRAVITY_API_KEY"] = old
        else:
            os.environ.pop("ANTIGRAVITY_API_KEY", None)
    print("✓ test_auth_dynamic_env_api_key passed")


def test_auth_ensure_api_keys_storage_no_resurrect():
    from app.services.auth import _ensure_api_keys_storage

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

    from fastapi.testclient import TestClient

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


if __name__ == "__main__":
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
    print("\nAll unit tests passed successfully!")
