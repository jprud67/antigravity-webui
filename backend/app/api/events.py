"""
SSE (Server-Sent Events) endpoint for real-time WebUI ↔ CLI synchronization.

GET /api/events/stream  →  persistent SSE stream
    Events:
      data: {"type": "conversations_updated", "ts": ...}
      data: {"type": "transcript_updated", "conversation_id": "...", "ts": ...}
      data: {"type": "ping"}   (keepalive every 20s)
"""
import asyncio
import json
import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.services.auth import get_auth_config, verify_token_or_api_key
from app.services.fs_watcher import add_subscriber, remove_subscriber

logger = logging.getLogger("antigravity.events")
router = APIRouter(prefix="/api/events", tags=["events"])


async def _sse_generator(request: Request, q: asyncio.Queue):
    """Yield SSE-formatted messages from the subscriber queue."""
    try:
        while True:
            # Check for client disconnect
            if await request.is_disconnected():
                break

            try:
                event = await asyncio.wait_for(q.get(), timeout=20.0)
                try:
                    payload = json.dumps(event)
                    yield f"data: {payload}\n\n"
                finally:
                    q.task_done()
            except asyncio.TimeoutError:
                # Send keepalive ping every 20s to prevent proxy/browser timeout
                yield 'data: {"type":"ping"}\n\n'

    finally:
        remove_subscriber(q)
        logger.debug("SSE client disconnected")


@router.get("/stream")
async def event_stream(
    request: Request,
    token: str | None = None,
    api_key: str | None = None
):
    """
    SSE endpoint that streams filesystem change events to the WebUI.
    The WebUI subscribes on load and receives push notifications whenever
    the CLI creates or updates conversations/transcripts.
    """
    # Auth check (same pattern as other endpoints: token, api_key, Authorization header, X-API-Key)
    config = get_auth_config()
    if config.get("enabled", True):
        raw_token = token or api_key or request.query_params.get("api_key")
        if not raw_token:
            x_api_key = request.headers.get("X-API-Key", "").strip()
            if x_api_key:
                raw_token = x_api_key
            else:
                auth_header = request.headers.get("Authorization", "").strip()
                if auth_header.lower().startswith("bearer "):
                    raw_token = auth_header[7:]
                elif auth_header:
                    raw_token = auth_header
        elif raw_token.strip().lower().startswith("bearer "):
            raw_token = raw_token.strip()[7:]
        clean_token = raw_token.strip() if raw_token else None
        if not clean_token or not verify_token_or_api_key(clean_token):
            raise HTTPException(status_code=401, detail="Non authentifié")

    q: asyncio.Queue = asyncio.Queue(maxsize=50)
    add_subscriber(q)
    logger.debug("New SSE subscriber registered")

    return StreamingResponse(
        _sse_generator(request, q),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",     # disable nginx buffering
            "Connection": "keep-alive",
        }
    )
