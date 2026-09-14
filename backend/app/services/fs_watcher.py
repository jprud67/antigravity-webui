"""
Filesystem watcher service for real-time sync between CLI and WebUI.

Watches BRAIN_DIR and CONVERSATION_DB for changes made by the `agy` CLI.
Publishes events to SSE subscribers so the WebUI updates without reload.
"""
import asyncio
import logging
import time
from pathlib import Path
from typing import Set, Dict, Any

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
            dead.add(q)
    for q in dead:
        _subscribers.discard(q)

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

    def _scan_transcripts() -> Dict[str, float]:
        result = {}
        if not brain_dir.exists():
            return result
        for transcript in brain_dir.rglob("transcript.jsonl"):
            # Only pick up direct children: brain_dir/<conv_id>/transcript.jsonl
            # conv_id must be a UUID (e.g. 22f8e40b-62a5-4ef7-be65-caa4946d6592)
            conv_id = transcript.parent.name
            if transcript.parent.parent != brain_dir:
                continue  # skip nested paths (like .system_generated/logs/)
            # UUID format validation: 8-4-4-4-12 hex with dashes
            import re as _re
            if not _re.match(
                r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
                conv_id
            ):
                continue
            try:
                result[str(transcript)] = transcript.stat().st_mtime
            except OSError:
                pass
        return result

    # Initial scan
    transcript_mtimes = _scan_transcripts()

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
                    # Extract conversation_id from path
                    p = Path(path)
                    # path structure: brain_dir/<conv_id>/transcript.jsonl
                    conv_id = p.parent.name
                    logger.debug(f"Transcript changed for conv {conv_id} → broadcasting transcript_updated")
                    await _broadcast({
                        "type": "transcript_updated",
                        "conversation_id": conv_id,
                        "ts": time.time()
                    })

            transcript_mtimes = cur_transcripts

        except Exception as e:
            logger.warning(f"Watcher error: {e}")
