"""
Helper script invoked by Git during interactive rebase:
- As GIT_SEQUENCE_EDITOR to rewrite the git-rebase-todo file according to user-specified actions
- As GIT_EDITOR to automatically supply new commit messages for reword/squash without interactive prompts
"""
import sys
import json
from pathlib import Path


def handle_sequence(config_path: str, todo_path: str):
    todo_file = Path(todo_path)
    inst_file = Path(config_path)
    if not todo_file.exists() or not inst_file.exists():
        return 0

    try:
        with open(inst_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    user_commits = data.get("commits", [])
    
    # Read original todo lines
    try:
        with open(todo_file, "r", encoding="utf-8") as f:
            original_lines = f.readlines()
    except Exception:
        return 0

    # Map commit sha (short & long) to original subject
    commit_subjects = {}
    for line in original_lines:
        sline = line.strip()
        if not sline or sline.startswith("#"):
            continue
        parts = sline.split(maxsplit=2)
        if len(parts) >= 2:
            sha = parts[1]
            subject = parts[2] if len(parts) >= 3 else ""
            commit_subjects[sha] = subject

    new_lines = []
    # Build lines in the exact order requested by user
    for item in user_commits:
        sha = item.get("sha", "").strip()
        action = item.get("action", "pick").strip().lower()
        if action not in ["pick", "reword", "edit", "squash", "fixup", "drop"]:
            action = "pick"
        
        # Match subject from original
        subject = ""
        for k, v in commit_subjects.items():
            if k.startswith(sha) or sha.startswith(k):
                subject = v
                break
        
        new_lines.append(f"{action} {sha} {subject}\n")

    try:
        with open(todo_file, "w", encoding="utf-8") as f:
            f.writelines(new_lines)
    except Exception:
        return 1

    return 0


def handle_editor(config_path: str, msg_path: str):
    msg_file = Path(msg_path)
    inst_file = Path(config_path)
    if not msg_file.exists() or not inst_file.exists():
        return 0

    try:
        with open(inst_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return 0

    pending_messages = data.get("messages", [])
    if not pending_messages:
        return 0

    # Consume first pending message
    next_msg = pending_messages.pop(0)
    data["messages"] = pending_messages
    try:
        with open(inst_file, "w", encoding="utf-8") as f:
            json.dump(data, f)
    except Exception:
        pass

    if next_msg:
        try:
            with open(msg_file, "w", encoding="utf-8") as f:
                f.write(next_msg.strip() + "\n")
        except Exception:
            return 1
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 4:
        sys.exit(0)
    mode = sys.argv[1]
    config_file = sys.argv[2]
    target_file = sys.argv[3]

    if mode == "sequence":
        sys.exit(handle_sequence(config_file, target_file))
    elif mode == "editor":
        sys.exit(handle_editor(config_file, target_file))
    sys.exit(0)
