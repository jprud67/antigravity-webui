import asyncio
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.artifacts import router as art_router
from app.api.auth import router as auth_router
from app.api.chat import router as chat_router
from app.api.conversations import router as conv_router
from app.api.crons import router as crons_router
from app.api.events import router as events_router
from app.api.files import router as files_router
from app.api.git import router as git_router
from app.api.google_accounts import router as google_router
from app.api.kanban import router as kanban_router
from app.api.rules import router as rules_router
from app.api.settings import router as set_router
from app.api.skills import router as skills_router
from app.api.tasks import router as tasks_router
from app.api.terminal import close_all_terminal_sessions
from app.api.terminal import router as terminal_router
from app.api.updater import router as updater_router
from app.api.workspaces import router as ws_router
from app.config import BRAIN_DIR, CONVERSATION_DB
from app.services.cron_ticker import cron_ticker_loop
from app.services.fs_watcher import watch_filesystem
from app.services.google_auth import restore_stashed_token_if_needed
from app.services.storage import ensure_db_schema
from app.services.updater import prefetch_update_check

logger = logging.getLogger("antigravity.main")


def _warn_if_default_password() -> None:
    """Avertit (une fois par démarrage) si le mot de passe WebUI par défaut est encore actif."""
    try:
        from app.services.auth import DEFAULT_PASSWORD, get_auth_config, verify_password
        if get_auth_config().get("enabled", True) and verify_password(DEFAULT_PASSWORD):
            logger.warning(
                "⚠ SÉCURITÉ : le mot de passe WebUI par défaut est actif — "
                "changez-le dès que possible dans les Paramètres de l'interface."
            )
    except Exception as e:
        logger.debug(f"Vérification du mot de passe par défaut impossible : {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Démarre les services d'arrière-plan : watcher FS, ticker des tâches planifiées, prefetch MAJ."""
    ensure_db_schema()
    restore_stashed_token_if_needed()
    prefetch_update_check()
    _warn_if_default_password()
    watcher_task = asyncio.create_task(
        watch_filesystem(BRAIN_DIR, CONVERSATION_DB, poll_interval=1.5),
        name="fs_watcher"
    )
    cron_task = asyncio.create_task(cron_ticker_loop(), name="cron_ticker")
    logger.info("Filesystem watcher started")
    logger.info("Cron ticker started (tâches planifiées propres à l'application)")
    yield
    watcher_task.cancel()
    cron_task.cancel()
    try:
        await watcher_task
    except asyncio.CancelledError:
        pass
    try:
        await cron_task
    except asyncio.CancelledError:
        pass
    try:
        await close_all_terminal_sessions()
    except Exception as e:
        logger.debug(f"Erreur arrêt sessions terminal: {e}")
    logger.info("Filesystem watcher stopped")
    logger.info("Cron ticker stopped")


app = FastAPI(
    title="Antigravity WebUI",
    description="Web Interface to orchestrate Antigravity CLI without touching the terminal",
    version="0.1.32",
    lifespan=lifespan
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
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
        
        if not full_path or full_path == "/":
            return FileResponse(FRONTEND_DIST / "index.html")

        try:
            dist_resolved = FRONTEND_DIST.resolve()
            file_candidate = (dist_resolved / full_path).resolve()
            if file_candidate.is_relative_to(dist_resolved) and file_candidate.is_file():
                return FileResponse(file_candidate)
        except Exception:
            pass
        return FileResponse(FRONTEND_DIST / "index.html")
