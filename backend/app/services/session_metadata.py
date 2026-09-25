import copy
import json
import logging
import threading
import time
import uuid
from typing import Any

from app.config import SESSION_METADATA_FILE
from app.platform_utils import restrict_file_permissions

logger = logging.getLogger("antigravity-webui.session_metadata")

# Verrou réentrant protégeant l'accès concurrent en lecture/écriture au fichier session_metadata.json
_meta_lock = threading.RLock()


_cached_meta: dict[str, dict[str, Any]] | None = None
_cached_mtime: float = -1.0

def get_all_session_metadata() -> dict[str, dict[str, Any]]:
    global _cached_meta, _cached_mtime
    with _meta_lock:
        if not SESSION_METADATA_FILE.exists():
            return {}
        try:
            mtime = SESSION_METADATA_FILE.stat().st_mtime
            if _cached_meta is not None and mtime <= _cached_mtime:
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
            serialized = json.dumps(metadata, indent=2, ensure_ascii=False)
            tmp_file.write_text(serialized, encoding="utf-8")
            restrict_file_permissions(tmp_file)

            replace_ok = False
            last_err = None
            for attempt in range(5):
                try:
                    tmp_file.replace(SESSION_METADATA_FILE)
                    replace_ok = True
                    break
                except (PermissionError, OSError) as pe:
                    last_err = pe
                    time.sleep(0.02 * (attempt + 1))

            if not replace_ok and last_err:
                raise last_err



            restrict_file_permissions(SESSION_METADATA_FILE)
            _cached_meta = copy.deepcopy(metadata)
            _cached_mtime = SESSION_METADATA_FILE.stat().st_mtime
            try:
                from app.services.fs_watcher import notify_event_sync
                notify_event_sync({"type": "conversations_updated", "ts": time.time()})
            except Exception as notify_err:
                logger.debug(f"Failed to notify conversations_updated on metadata save: {notify_err}")
        except Exception as e:
            logger.error(f"Failed to write session metadata: {e}")
            if tmp_file and tmp_file.exists():
                try:
                    tmp_file.unlink()
                except Exception as clean_err:
                    logger.debug(f"Ignored cleanup error: {clean_err}")
            raise

def _to_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("true", "1", "yes")
    return bool(val)


def _normalize_meta(meta: dict[str, Any]) -> dict[str, Any]:
    if "isPinned" in meta and "pinned" not in meta:
        meta["pinned"] = meta["isPinned"]
    if "is_pinned" in meta and "pinned" not in meta:
        meta["pinned"] = meta["is_pinned"]
    if "isArchived" in meta and "archived" not in meta:
        meta["archived"] = meta["isArchived"]
    if "is_archived" in meta and "archived" not in meta:
        meta["archived"] = meta["is_archived"]
    meta["pinned"] = _to_bool(meta.get("pinned", False))
    meta["archived"] = _to_bool(meta.get("archived", False))
    raw_tags = meta.get("tags")
    if isinstance(raw_tags, list):
        seen_tags = set()
        cleaned_tags = []
        for t in raw_tags:
            if t is None:
                continue
            s = str(t).strip()
            if s and s.lower() not in ("none", "null", "undefined") and s not in seen_tags:
                seen_tags.add(s)
                cleaned_tags.append(s)
        meta["tags"] = cleaned_tags
    else:
        meta["tags"] = []
    if "projectId" in meta:
        if not meta.get("project_id"):
            meta["project_id"] = meta["projectId"]
        del meta["projectId"]
    if "groupId" in meta:
        if not meta.get("group_id"):
            meta["group_id"] = meta["groupId"]
        del meta["groupId"]

    raw_project = str(meta.get("project") or "").strip()
    raw_project_id = str(meta.get("project_id") or "").strip()
    meta["project"] = raw_project or raw_project_id
    meta["projectColor"] = str(meta.get("projectColor") or "").strip()
    raw_custom_title = str(meta.get("customTitle") or meta.get("custom_title") or "").strip()
    meta["customTitle"] = raw_custom_title
    meta["custom_title"] = raw_custom_title
    meta["group_id"] = str(meta.get("group_id") or "").strip()
    meta["project_id"] = raw_project_id or raw_project
    return meta


def make_default_meta() -> dict[str, Any]:
    return {
        "pinned": False,
        "archived": False,
        "tags": [],
        "project": "",
        "projectColor": "",
        "customTitle": "",
        "group_id": "",
        "project_id": "",
    }

def get_session_meta(conversation_id: str) -> dict[str, Any]:
    cleaned_cid = (conversation_id or "").strip()
    all_meta = get_all_session_metadata()
    existing = all_meta.get(cleaned_cid) if cleaned_cid else None
    merged = make_default_meta()
    if isinstance(existing, dict):
        merged.update(existing)
    return _normalize_meta(merged)

def update_session_meta(conversation_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    if not conversation_id or not isinstance(conversation_id, str) or not conversation_id.strip():
        raise ValueError("Invalid conversation_id")
    cleaned_cid = conversation_id.strip()
    res = bulk_update_session_meta([cleaned_cid], updates)
    return res.get(cleaned_cid, make_default_meta())

def bulk_update_session_meta(conversation_ids: list[str], updates: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return bulk_update_session_meta_batch({cid: updates for cid in conversation_ids if cid and isinstance(cid, str) and cid.strip()})

def bulk_update_session_meta_batch(updates_per_id: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    with _meta_lock:
        all_meta = get_all_session_metadata()
        results = {}
        changed = False
        for cid, updates in updates_per_id.items():
            if not cid or not isinstance(cid, str):
                continue
            clean_cid = cid.strip()
            if not clean_cid or clean_cid.lower() in ("none", "null", "undefined"):
                continue
            if not isinstance(updates, dict):
                continue
            current = make_default_meta()
            existing = all_meta.get(clean_cid)
            if isinstance(existing, dict):
                current.update(existing)
            norm_updates = dict(updates)
            if "projectId" in norm_updates:
                if "project_id" not in norm_updates:
                    norm_updates["project_id"] = norm_updates["projectId"]
                del norm_updates["projectId"]
            if "groupId" in norm_updates:
                if "group_id" not in norm_updates:
                    norm_updates["group_id"] = norm_updates["groupId"]
                del norm_updates["groupId"]

            if "project" in norm_updates and "project_id" not in norm_updates:
                norm_updates["project_id"] = norm_updates["project"]
            elif "project_id" in norm_updates and "project" not in norm_updates:
                norm_updates["project"] = norm_updates["project_id"]

            current.update(norm_updates)
            current = _normalize_meta(current)
            all_meta[clean_cid] = current
            results[clean_cid] = current
            changed = True
        if changed:
            save_all_session_metadata(all_meta)
    return results

def delete_session_meta(conversation_id: str) -> None:
    bulk_delete_session_meta([conversation_id])

def bulk_delete_session_meta(conversation_ids: list[str]) -> None:
    with _meta_lock:
        all_meta = get_all_session_metadata()
        changed = False
        for cid in conversation_ids:
            if not cid or not isinstance(cid, str):
                continue
            clean_cid = cid.strip()
            if clean_cid in all_meta:
                del all_meta[clean_cid]
                changed = True
        if changed:
            save_all_session_metadata(all_meta)

