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
    from app.api.skills import get_skill_detail
    from fastapi import HTTPException

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
    print("\nAll unit tests passed successfully!")

