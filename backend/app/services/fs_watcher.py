"""
Filesystem watcher service for real-time sync between CLI and WebUI.

Watches BRAIN_DIR and CONVERSATION_DB for changes made by the `agy` CLI.
Publishes events to SSE subscribers so the WebUI updates without reload.
"""
import asyncio
import logging
import re
import time
from pathlib import Path
from typing import Any

from app.services.storage import is_safe_conversation_id

logger = logging.getLogger("antigravity.fs_watcher")

# Global asyncio queue where all SSE subscribers register themselves
_subscribers: set[asyncio.Queue] = set()

def get_subscribers() -> set[asyncio.Queue]:
    return _subscribers

def add_subscriber(q: asyncio.Queue) -> None:
    _subscribers.add(q)

def remove_subscriber(q: asyncio.Queue) -> None:
    _subscribers.discard(q)

async def _broadcast(event: dict[str, Any]) -> None:
    dead = set()
    for q in list(_subscribers):
        try:
            q.put_nowait(event)
        except asyncio.QueueFull:
            # Drain oldest event to make room for newer state rather than evicting client
            try:
                q.get_nowait()
                q.task_done()
            except (asyncio.QueueEmpty, ValueError):
                pass
            except Exception as e:
                logger.debug(f"SSE queue drain failed: {e}")
            try:
                q.put_nowait(event)
            except Exception:
                dead.add(q)
        except Exception:
            dead.add(q)
    for q in dead:
        _subscribers.discard(q)

_main_loop: asyncio.AbstractEventLoop | None = None

def set_main_loop(loop: asyncio.AbstractEventLoop | None) -> None:
    """Enregistre la boucle d'événements principale du serveur pour les notifications depuis les threads de travail."""
    global _main_loop
    _main_loop = loop

def get_main_loop() -> asyncio.AbstractEventLoop | None:
    return _main_loop

async def broadcast_event(event: dict[str, Any]) -> None:
    """Diffuse de manière asynchrone un événement SSE à tous les abonnés WebUI."""
    await _broadcast(event)

def notify_event_sync(event: dict[str, Any]) -> None:
    """Notifie immédiatement les abonnés SSE depuis un contexte synchrone ou un worker thread."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(_broadcast(event))
        return
    except RuntimeError:
        pass

    if _main_loop is not None and not _main_loop.is_closed():
        try:
            asyncio.run_coroutine_threadsafe(_broadcast(event), _main_loop)
        except Exception as e:
            logger.debug(f"Failed to dispatch event via run_coroutine_threadsafe: {e}")

_UUID_PATTERN = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)

def extract_conv_id(transcript_path: Path, brain_dir: Path | None = None) -> str | None:
    """Extract conversation UUID or safe ID from transcript.jsonl path."""
    p = transcript_path.resolve()
    # Case 1: brain_dir/<conv_id>/.system_generated/logs/transcript.jsonl
    if (
        p.parent.name == "logs"
        and p.parent.parent.name == ".system_generated"
    ):
        cand = p.parent.parent.parent.name
        if _UUID_PATTERN.match(cand) or is_safe_conversation_id(cand):
            if brain_dir is None or p.parent.parent.parent.parent.resolve() == brain_dir.resolve():
                return cand
    # Case 2: brain_dir/<conv_id>/transcript.jsonl (legacy / fallback)
    else:
        cand = p.parent.name
        if _UUID_PATTERN.match(cand) or is_safe_conversation_id(cand):
            if brain_dir is None or p.parent.parent.resolve() == brain_dir.resolve():
                return cand
    return None


def extract_conv_id_from_artifact(artifact_path: Path, brain_dir: Path) -> str | None:
    """Extrait l'identifiant de conversation d'un chemin d'artefact confiné dans brain_dir."""
    try:
        rel = artifact_path.resolve().relative_to(brain_dir.resolve())
        if rel.parts:
            cand = rel.parts[0]
            if _UUID_PATTERN.match(cand) or is_safe_conversation_id(cand):
                return cand
    except Exception as e:
        logger.debug(f"Ignored error: {e}")
    return None


def _resolve_conv_id_for_artifact(p: Path, brain_dir: Path) -> str | None:
    """Résout et valide strictement l'identifiant de conversation associé à un artefact."""
    cid = extract_conv_id_from_artifact(p, brain_dir)
    if not cid:
        cand = p.parent.name
        if _UUID_PATTERN.match(cand) or is_safe_conversation_id(cand):
            cid = cand
    return cid if (cid and is_safe_conversation_id(cid)) else None


async def watch_filesystem(brain_dir: Path, conv_db: Path, poll_interval: float = 1.5) -> None:
    """
    Async polling loop that detects changes in:
    - conversation_summaries.db (new/updated conversations from CLI)
    - BRAIN_DIR/<conv_id>/transcript.jsonl files (live transcript updates)

    Broadcasts SSE events to all connected WebUI clients.
    """
    logger.info(f"Starting filesystem watcher — brain: {brain_dir}, db: {conv_db}, interval: {poll_interval}s")
    global _main_loop
    try:
        _main_loop = asyncio.get_running_loop()
    except RuntimeError:
        pass

    def _get_db_mtime() -> float:
        try:
            m = conv_db.stat().st_mtime if conv_db.exists() else 0.0
            wal = conv_db.with_name(conv_db.name + "-wal")
            if wal.exists():
                m = max(m, wal.stat().st_mtime)
            return m
        except OSError:
            return 0.0

    # Track last-seen mtime for all watched paths (including SQLite WAL file)
    prev_db_mtime: float = _get_db_mtime()
    # transcript path → last mtime
    transcript_mtimes: dict[str, float] = {}
    # artifact path → last mtime
    artifact_mtimes: dict[str, float] = {}
    # directory path → mtime cache to avoid scanning unchanged session directories
    dir_mtimes: dict[str, float] = {}
    dir_artifacts_cache: dict[str, dict[str, float]] = {}

    def _scan_brain() -> tuple[dict[str, float], dict[str, float]]:
        transcripts: dict[str, float] = {}
        artifacts: dict[str, float] = {}
        if not brain_dir.exists():
            return transcripts, artifacts
        seen_dirs: set[str] = set()
        try:
            for child in brain_dir.iterdir():
                if not child.is_dir() or not (_UUID_PATTERN.match(child.name) or is_safe_conversation_id(child.name)):
                    continue
                child_str = str(child)
                seen_dirs.add(child_str)
                try:
                    c_mtime = child.stat().st_mtime
                except OSError:
                    continue

                # Primary Antigravity path: brain_dir/<conv_id>/.system_generated/logs/transcript.jsonl
                t1 = child / ".system_generated" / "logs" / "transcript.jsonl"
                t_full = child / ".system_generated" / "logs" / "transcript_full.jsonl"
                try:
                    mtime_t1 = t1.stat().st_mtime if t1.exists() else None
                    mtime_t_full = t_full.stat().st_mtime if t_full.exists() else None
                    if mtime_t1 is not None or mtime_t_full is not None:
                        transcripts[str(t1)] = max(mtime_t1 or 0.0, mtime_t_full or 0.0)
                    else:
                        t2 = child / "transcript.jsonl"
                        if t2.exists():
                            transcripts[str(t2)] = t2.stat().st_mtime
                except OSError as e:
                    logger.debug(f"transcript scan error on {child.name}: {e}")

                # Artifacts scan (non-system files directly in session folder)
                prev_dmtime = dir_mtimes.get(child_str)
                if prev_dmtime == c_mtime and child_str in dir_artifacts_cache:
                    cached_files = dir_artifacts_cache[child_str]
                    for f_path in cached_files:
                        try:
                            f_mtime = Path(f_path).stat().st_mtime
                            artifacts[f_path] = f_mtime
                            cached_files[f_path] = f_mtime
                        except OSError:
                            pass
                else:
                    dir_mtimes[child_str] = c_mtime
                    child_artifacts: dict[str, float] = {}
                    try:
                        for f in child.iterdir():
                            try:
                                if f.name not in [".system_generated", "scratch"] and f.is_file():
                                    m = f.stat().st_mtime
                                    artifacts[str(f)] = m
                                    child_artifacts[str(f)] = m
                            except OSError:
                                continue
                    except OSError as e:
                        logger.debug(f"artifacts scan error on {child.name}: {e}")
                    dir_artifacts_cache[child_str] = child_artifacts

            # Cleanup stale dirs from cache
            for stale_dir in set(dir_mtimes.keys()) - seen_dirs:
                dir_mtimes.pop(stale_dir, None)
                dir_artifacts_cache.pop(stale_dir, None)
        except OSError as e:
            logger.debug(f"scan des transcripts/artefacts impossible : {e}")
        return transcripts, artifacts

    # Initial scan
    transcript_mtimes, artifact_mtimes = await asyncio.to_thread(_scan_brain)

    while True:
        await asyncio.sleep(poll_interval)

        try:
            # --- 1. Check conversation DB & WAL (new/updated conversations) ---
            cur_db_mtime = _get_db_mtime()
            if cur_db_mtime > 0.0 and cur_db_mtime != prev_db_mtime:
                prev_db_mtime = cur_db_mtime
                logger.debug("conversation_summaries.db changed → broadcasting conversations_updated")
                await _broadcast({
                    "type": "conversations_updated",
                    "ts": time.time()
                })

            # --- 2. Check transcript and artifact files (single traversal) ---
            cur_transcripts, cur_artifacts = await asyncio.to_thread(_scan_brain)

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

            removed_transcripts = set(transcript_mtimes) - set(cur_transcripts)
            if removed_transcripts:
                logger.debug(f"{len(removed_transcripts)} transcript(s) removed from brain_dir")
            transcript_mtimes = cur_transcripts

            # --- 3. Check artifact files (new/updated artifacts) ---
            for a_path, a_mtime in cur_artifacts.items():
                prev = artifact_mtimes.get(a_path, 0.0)
                if a_mtime != prev:
                    p = Path(a_path)
                    conv_id = _resolve_conv_id_for_artifact(p, brain_dir)
                    if conv_id:
                        logger.debug(f"Artifact changed for conv {conv_id} ({p.name}) → broadcasting artifacts_updated")
                        await _broadcast({
                            "type": "artifacts_updated",
                            "conversation_id": conv_id,
                            "filename": p.name,
                            "ts": time.time()
                        })
            # Nettoyer les entrées obsolètes (fichiers supprimés) pour éviter une fuite mémoire
            removed_artifacts = set(artifact_mtimes) - set(cur_artifacts)
            if removed_artifacts:
                if len(removed_artifacts) > 10:
                    # Many files removed at once (e.g. bulk delete): collapse into one event per conv
                    conv_ids_affected = {
                        _resolve_conv_id_for_artifact(Path(old_p), brain_dir)
                        for old_p in removed_artifacts
                    }
                    for cid in conv_ids_affected:
                        if cid:
                            await _broadcast({
                                "type": "artifacts_updated",
                                "conversation_id": cid,
                                "filename": None,
                                "ts": time.time()
                            })
                else:
                    for old_path in removed_artifacts:
                        p = Path(old_path)
                        conv_id = _resolve_conv_id_for_artifact(p, brain_dir)
                        if conv_id:
                            logger.debug(f"Artifact supprimé pour conv {conv_id} ({p.name}) → broadcasting artifacts_updated")
                            await _broadcast({
                                "type": "artifacts_updated",
                                "conversation_id": conv_id,
                                "filename": p.name,
                                "ts": time.time()
                            })
            artifact_mtimes = cur_artifacts


        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning(f"Watcher error: {e}")

