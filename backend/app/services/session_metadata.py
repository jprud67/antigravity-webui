import json
import logging
import uuid
from typing import Any

from app.config import SESSION_METADATA_FILE

logger = logging.getLogger("antigravity-webui.session_metadata")

def get_all_session_metadata() -> dict[str, dict[str, Any]]:
    if not SESSION_METADATA_FILE.exists():
        return {}
    try:
        return json.loads(SESSION_METADATA_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to read session metadata: {e}")
        return {}

def save_all_session_metadata(metadata: dict[str, dict[str, Any]]) -> None:
    tmp_file = None
    try:
        SESSION_METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = SESSION_METADATA_FILE.parent / f"{SESSION_METADATA_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
        tmp_file.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_file.replace(SESSION_METADATA_FILE)
    except Exception as e:
        logger.error(f"Failed to write session metadata: {e}")
        if tmp_file and tmp_file.exists():
            try:
                tmp_file.unlink()
            except Exception:
                pass

def get_session_meta(conversation_id: str) -> dict[str, Any]:
    all_meta = get_all_session_metadata()
    return all_meta.get(conversation_id, {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "",
        "projectColor": "",
        "customTitle": ""
    })

def update_session_meta(conversation_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    return bulk_update_session_meta([conversation_id], updates)[conversation_id]

def bulk_update_session_meta(conversation_ids: list[str], updates: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return bulk_update_session_meta_batch({cid: updates for cid in conversation_ids})

def bulk_update_session_meta_batch(updates_per_id: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    all_meta = get_all_session_metadata()
    results = {}
    for cid, updates in updates_per_id.items():
        current = all_meta.get(cid, {
            "pinned": False,
            "archived": False,
            "tags": [],
            "project": "",
            "projectColor": "",
            "customTitle": ""
        })
        current.update(updates)
        all_meta[cid] = current
        results[cid] = current
    if updates_per_id:
        save_all_session_metadata(all_meta)
    return results

def delete_session_meta(conversation_id: str) -> None:
    bulk_delete_session_meta([conversation_id])

def bulk_delete_session_meta(conversation_ids: list[str]) -> None:
    all_meta = get_all_session_metadata()
    changed = False
    for cid in conversation_ids:
        if cid in all_meta:
            del all_meta[cid]
            changed = True
    if changed:
        save_all_session_metadata(all_meta)
