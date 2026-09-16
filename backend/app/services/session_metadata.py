import copy
import json
import logging
import threading
import uuid
from typing import Any

from app.config import SESSION_METADATA_FILE

logger = logging.getLogger("antigravity-webui.session_metadata")

# Verrou réentrant protégeant l'accès concurrent en lecture/écriture au fichier session_metadata.json
_meta_lock = threading.RLock()


_cached_meta: dict[str, dict[str, Any]] = {}
_cached_mtime: float = 0.0

def get_all_session_metadata() -> dict[str, dict[str, Any]]:
    global _cached_meta, _cached_mtime
    with _meta_lock:
        if not SESSION_METADATA_FILE.exists():
            return {}
        try:
            mtime = SESSION_METADATA_FILE.stat().st_mtime
            if mtime <= _cached_mtime and _cached_meta:
                return copy.deepcopy(_cached_meta)
            
            content = SESSION_METADATA_FILE.read_text(encoding="utf-8")
            if not content.strip():
                _cached_meta = {}
                _cached_mtime = mtime
                return {}
            data = json.loads(content)
            _cached_meta = data if isinstance(data, dict) else {}
            _cached_mtime = mtime
            return copy.deepcopy(_cached_meta)
        except Exception as e:
            logger.error(f"Failed to read session metadata: {e}")
            return {}

def save_all_session_metadata(metadata: dict[str, dict[str, Any]]) -> None:
    global _cached_meta, _cached_mtime
    with _meta_lock:
        tmp_file = None
        try:
            SESSION_METADATA_FILE.parent.mkdir(parents=True, exist_ok=True)
            tmp_file = SESSION_METADATA_FILE.parent / f"{SESSION_METADATA_FILE.name}.tmp.{uuid.uuid4().hex[:8]}"
            tmp_file.write_text(json.dumps(metadata, indent=2, ensure_ascii=False), encoding="utf-8")
            tmp_file.replace(SESSION_METADATA_FILE)
            _cached_meta = copy.deepcopy(metadata)
            _cached_mtime = SESSION_METADATA_FILE.stat().st_mtime
        except Exception as e:
            logger.error(f"Failed to write session metadata: {e}")
            if tmp_file and tmp_file.exists():
                try:
                    tmp_file.unlink()
                except Exception as clean_err:
                    logger.debug(f"Ignored cleanup error: {clean_err}")
            raise

def make_default_meta() -> dict[str, Any]:
    return {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "",
        "projectColor": "",
        "customTitle": ""
    }

def get_session_meta(conversation_id: str) -> dict[str, Any]:
    all_meta = get_all_session_metadata()
    existing = all_meta.get(conversation_id)
    merged = make_default_meta()
    if isinstance(existing, dict):
        merged.update(existing)
    merged["tags"] = list(merged.get("tags") or []) if isinstance(merged.get("tags"), list) else []
    return merged

def update_session_meta(conversation_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    return bulk_update_session_meta([conversation_id], updates)[conversation_id]

def bulk_update_session_meta(conversation_ids: list[str], updates: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return bulk_update_session_meta_batch({cid: updates for cid in conversation_ids})

def bulk_update_session_meta_batch(updates_per_id: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    with _meta_lock:
        all_meta = get_all_session_metadata()
        results = {}
        for cid, updates in updates_per_id.items():
            current = make_default_meta()
            existing = all_meta.get(cid)
            if isinstance(existing, dict):
                current.update(existing)
            current.update(updates)
            current["tags"] = list(current.get("tags") or []) if isinstance(current.get("tags"), list) else []
            all_meta[cid] = current
            results[cid] = current
        if updates_per_id:
            save_all_session_metadata(all_meta)
    return results

def delete_session_meta(conversation_id: str) -> None:
    bulk_delete_session_meta([conversation_id])

def bulk_delete_session_meta(conversation_ids: list[str]) -> None:
    with _meta_lock:
        all_meta = get_all_session_metadata()
        changed = False
        for cid in conversation_ids:
            if cid in all_meta:
                del all_meta[cid]
                changed = True
        if changed:
            save_all_session_metadata(all_meta)

