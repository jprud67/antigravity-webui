import json
import logging
from typing import Dict, Any, Optional
from app.config import SESSION_METADATA_FILE

logger = logging.getLogger("antigravity-webui.session_metadata")

def get_all_session_metadata() -> Dict[str, Dict[str, Any]]:
    if not SESSION_METADATA_FILE.exists():
        return {}
    try:
        return json.loads(SESSION_METADATA_FILE.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error(f"Failed to read session metadata: {e}")
        return {}

def save_all_session_metadata(metadata: Dict[str, Dict[str, Any]]) -> None:
    try:
        SESSION_METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp_file = SESSION_METADATA_FILE.with_suffix(".tmp")
        tmp_file.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp_file.replace(SESSION_METADATA_FILE)
    except Exception as e:
        logger.error(f"Failed to write session metadata: {e}")

def get_session_meta(conversation_id: str) -> Dict[str, Any]:
    all_meta = get_all_session_metadata()
    return all_meta.get(conversation_id, {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "",
        "projectColor": "",
        "customTitle": ""
    })

def update_session_meta(conversation_id: str, updates: Dict[str, Any]) -> Dict[str, Any]:
    all_meta = get_all_session_metadata()
    current = all_meta.get(conversation_id, {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "",
        "projectColor": "",
        "customTitle": ""
    })
    current.update(updates)
    all_meta[conversation_id] = current
    save_all_session_metadata(all_meta)
    return current

def delete_session_meta(conversation_id: str) -> None:
    all_meta = get_all_session_metadata()
    if conversation_id in all_meta:
        del all_meta[conversation_id]
        save_all_session_metadata(all_meta)
