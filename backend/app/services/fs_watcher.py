"""
Filesystem watcher service for real-time sync between CLI and WebUI.

Watches BRAIN_DIR and CONVERSATION_DB for changes made by the `agy` CLI.
Publishes events to SSE subscribers so the WebUI updates without reload.
"""
import asyncio
import logging
import time
import re
from pathlib import Path
from typing import Set, Dict, Any, Optional

logger = logging.getLogger("antigravity.fs_watcher")

# Global asyncio queue where all SSE subscribers register themselves
_subscribers: Set[asyncio.Queue] = set()

def get_subscribers() -> Set[asyncio.Queue]:
    return _subscribers

def add_subscriber(q: asyncio.Queue) -> None:
    _subscribers.add(q)

def remove_subscriber(q: asyncio.Queue) -> None:
    _subscribers.discard(q)

async def _broadcast(event: Dict[str, Any]) -> None:
    dead = set()
    for q in _subscribers:
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # Drain oldest event to make room for newer state rather than evicting client
            try:
                q.get_nowait()
                q.task_done()
            except Exception:
                pass
            try:
                q.put_nowait(event)
            except Exception:
                dead.add(q)
    for q in dead:
        _subscribers.discard(q)

_UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

def extract_conv_id(transcript_path: Path, brain_dir: Optional[Path] = None) -> Optional[str]:
    """Extract conversation UUID from transcript.jsonl path."""
    p = transcript_path.resolve()
    # Case 1: brain_dir/<conv_id>/.system_generated/logs/transcript.jsonl
    if (
        p.parent.name == "logs"
        and p.parent.parent.name == ".system_generated"
    ):
        cand = p.parent.parent.parent.name
        if _UUID_PATTERN.match(cand):
            if brain_dir is None or p.parent.parent.parent.parent.resolve() == brain_dir.resolve():
                return cand
    # Case 2: brain_dir/<conv_id>/transcript.jsonl (legacy / fallback)
    else:
        cand = p.parent.name
        if _UUID_PATTERN.match(cand):
            if brain_dir is None or p.parent.parent.resolve() == brain_dir.resolve():
                return cand
    return None

async def watch_filesystem(brain_dir: Path, conv_db: Path, poll_interval: float = 1.5) -> None:
    """
    Async polling loop that detects changes in:
    - conversation_summaries.db (new/updated conversations from CLI)
    - BRAIN_DIR/<conv_id>/transcript.jsonl files (live transcript updates)

    Broadcasts SSE events to all connected WebUI clients.
    """
    logger.info(f"Starting filesystem watcher — brain: {brain_dir}, db: {conv_db}, interval: {poll_interval}s")

    # Track last-seen mtime for all watched paths
    prev_db_mtime: float = conv_db.stat().st_mtime if conv_db.exists() else 0.0
    # transcript path → last mtime
    transcript_mtimes: Dict[str, float] = {}
    # artifact path → last mtime
    artifact_mtimes: Dict[str, float] = {}

    def _scan_transcripts() -> Dict[str, float]:
        result = {}
        if not brain_dir.exists():
            return result
        try:
            for child in brain_dir.iterdir():
                if not child.is_dir() or not _UUID_PATTERN.match(child.name):
                    continue
                # Primary Antigravity path: brain_dir/<conv_id>/.system_generated/logs/transcript.jsonl
                t1 = child / ".system_generated" / "logs" / "transcript.jsonl"
                try:
                    if t1.exists():
                        result[str(t1)] = t1.stat().st_mtime
                        continue
                except OSError:
                    pass
                # Fallback path: brain_dir/<conv_id>/transcript.jsonl
                t2 = child / "transcript.jsonl"
                try:
                    if t2.exists():
                        result[str(t2)] = t2.stat().st_mtime
                except OSError:
                    pass
        except OSError:
            pass
        return result

    def _scan_artifacts() -> Dict[str, float]:
        result = {}
        if not brain_dir.exists():
            return result
        try:
            for child in brain_dir.iterdir():
                if not child.is_dir() or not _UUID_PATTERN.match(child.name):
                    continue
                for f in child.iterdir():
                    try:
                        if f.name not in [".system_generated", "scratch"] and f.is_file():
                            result[str(f)] = f.stat().st_mtime
                    except OSError:
                        continue
        except OSError:
            pass
        return result

    # Initial scan
    transcript_mtimes = _scan_transcripts()
    artifact_mtimes = _scan_artifacts()

    while True:
        await asyncio.sleep(poll_interval)

        try:
            # --- 1. Check conversation DB (new/updated conversations) ---
            if conv_db.exists():
                cur_db_mtime = conv_db.stat().st_mtime
                if cur_db_mtime != prev_db_mtime:
                    prev_db_mtime = cur_db_mtime
                    logger.debug("conversation_summaries.db changed → broadcasting conversations_updated")
                    await _broadcast({
                        "type": "conversations_updated",
                        "ts": time.time()
                    })

            # --- 2. Check transcript files (ongoing turns from CLI) ---
            cur_transcripts = _scan_transcripts()

            # New or modified transcripts
            for path, mtime in cur_transcripts.items():
                prev = transcript_mtimes.get(path, 0.0)
                if mtime != prev:
                    p = Path(path)
                    conv_id = extract_conv_id(p, brain_dir)
                    if not conv_id:
                        continue
                    logger.debug(f"Transcript changed for conv {conv_id} → broadcasting transcript_updated")
                    await _broadcast({
                        "type": "transcript_updated",
                        "conversation_id": conv_id,
                        "ts": time.time()
                    })

            transcript_mtimes = cur_transcripts

            # --- 3. Check artifact files (new/updated artifacts) ---
            cur_artifacts = _scan_artifacts()
            for a_path, a_mtime in cur_artifacts.items():
                prev = artifact_mtimes.get(a_path, 0.0)
                if a_mtime != prev:
                    p = Path(a_path)
                    conv_id = p.parent.name
                    logger.debug(f"Artifact changed for conv {conv_id} ({p.name}) → broadcasting artifacts_updated")
                    await _broadcast({
                        "type": "artifacts_updated",
                        "conversation_id": conv_id,
                        "filename": p.name,
                        "ts": time.time()
                    })
            artifact_mtimes = cur_artifacts

        except Exception as e:
            logger.warning(f"Watcher error: {e}")
