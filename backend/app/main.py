from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from app.api.conversations import router as conv_router
from app.api.artifacts import router as art_router
from app.api.settings import router as set_router
from app.api.workspaces import router as ws_router
from app.api.chat import router as chat_router
from app.api.auth import router as auth_router
from app.api.files import router as files_router
from app.api.tasks import router as tasks_router
from app.api.skills import router as skills_router
from app.api.git import router as git_router
from app.api.terminal import router as terminal_router
from app.api.kanban import router as kanban_router
from app.api.crons import router as crons_router
from app.api.rules import router as rules_router
from app.api.google_accounts import router as google_router
from app.api.events import router as events_router
from app.api.updater import router as updater_router
from app.services.fs_watcher import watch_filesystem
from app.services.updater import prefetch_update_check
from app.config import BRAIN_DIR, CONVERSATION_DB
import asyncio
import logging

logger = logging.getLogger("antigravity.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the filesystem watcher background task on startup and prefetch updates."""
    prefetch_update_check()
    watcher_task = asyncio.create_task(
        watch_filesystem(BRAIN_DIR, CONVERSATION_DB, poll_interval=1.5),
        name="fs_watcher"
    )
    logger.info("Filesystem watcher started")
    yield
    watcher_task.cancel()
    try:
        await watcher_task
    except asyncio.CancelledError:
        pass
    logger.info("Filesystem watcher stopped")


app = FastAPI(
    title="Antigravity WebUI",
    description="Web Interface to orchestrate Antigravity CLI without touching the terminal",
    version="1.0.0",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(conv_router)
app.include_router(art_router)
app.include_router(set_router)
app.include_router(ws_router)
app.include_router(chat_router)
app.include_router(files_router)
app.include_router(tasks_router)
app.include_router(skills_router)
app.include_router(git_router)
app.include_router(terminal_router)
app.include_router(kanban_router)
app.include_router(crons_router)
app.include_router(rules_router)
app.include_router(google_router)
app.include_router(events_router)  # SSE real-time sync CLI ↔ WebUI
app.include_router(updater_router)  # Hermes-style update check & apply


@app.api_route("/api/health", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok", "service": "antigravity-webui"}

# Frontend SPA serving
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_frontend(full_path: str):
        if full_path in ("api", "ws") or full_path.startswith(("api/", "ws/")):
            raise HTTPException(status_code=404, detail="API route not found")
        
        try:
            file_candidate = (FRONTEND_DIST / full_path).resolve()
            if FRONTEND_DIST.resolve() in file_candidate.parents and file_candidate.is_file():
                return FileResponse(file_candidate)
        except Exception:
            pass
        return FileResponse(FRONTEND_DIST / "index.html")
