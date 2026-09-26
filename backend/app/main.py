import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.agent_api import router as agent_api_router
from app.api.artifacts import router as art_router
from app.api.auth import router as auth_router
from app.api.canvas_documents import router as canvas_documents_router
from app.api.chat import router as chat_router
from app.api.code_kernel import router as code_kernel_router
from app.api.conversations import router as conv_router
from app.api.copilot import router as copilot_router
from app.api.crons import router as crons_router
from app.api.database_studio import router as database_studio_router
from app.api.docker_studio import router as docker_studio_router
from app.api.doctor import router as doctor_router
from app.api.editor_diagnostics import router as editor_diagnostics_router
from app.api.events import router as events_router
from app.api.files import router as files_router
from app.api.git import router as git_router
from app.api.git_worktree import router as git_worktree_router
from app.api.google_accounts import router as google_router
from app.api.kanban import router as kanban_router
from app.api.link_understanding import router as link_understanding_router
from app.api.mcp_catalog import router as mcp_catalog_router
from app.api.memory import router as memory_router
from app.api.messaging_gateway import router as messaging_gateway_router
from app.api.openai_compat import router as openai_router
from app.api.progress_card import router as progress_card_router
from app.api.prompt import router as prompt_router
from app.api.rules import router as rules_router
from app.api.search import router as search_router
from app.api.settings import router as set_router
from app.api.skills import router as skills_router
from app.api.tailscale import router as tailscale_router
from app.api.tasks import router as tasks_router
from app.api.terminal import close_all_terminal_sessions
from app.api.terminal import router as terminal_router
from app.api.tool_repair import router as tool_repair_router
from app.api.updater import router as updater_router
from app.api.vector_memory import router as vector_memory_router
from app.api.web_push import router as web_push_router
from app.api.workspaces import router as ws_router
from app.config import BRAIN_DIR, CONVERSATION_DB, REPO_ROOT
from app.services.cron_ticker import cron_ticker_loop
from app.services.execution_manager import execution_manager
from app.services.fs_watcher import set_main_loop, watch_filesystem
from app.services.fts_search import ensure_fts_schema
from app.services.google_auth import restore_stashed_token_if_needed
from app.services.link_understanding import ensure_link_cache_schema
from app.services.messaging_gateway import ensure_messaging_gateway_schema
from app.services.progress_card import ensure_progress_card_schema
from app.services.storage import ensure_db_schema
from app.services.updater import prefetch_update_check
from app.services.vector_memory import ensure_vector_memory_schema
from app.services.web_push import ensure_web_push_schema

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
    set_main_loop(asyncio.get_running_loop())
    ensure_db_schema()
    ensure_fts_schema()
    ensure_progress_card_schema()
    ensure_link_cache_schema()
    ensure_web_push_schema()
    ensure_messaging_gateway_schema()
    ensure_vector_memory_schema()
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
        await execution_manager.close_all_sessions()
    except Exception as e:
        logger.debug(f"Erreur arrêt sessions execution: {e}")
    try:
        await close_all_terminal_sessions()
    except Exception as e:
        logger.debug(f"Erreur arrêt sessions terminal: {e}")
    set_main_loop(None)
    logger.info("Filesystem watcher stopped")
    logger.info("Cron ticker stopped")


app = FastAPI(
    title="Antigravity WebUI",
    description="Web Interface to orchestrate Antigravity CLI without touching the terminal",
    version="0.3.0",
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
app.include_router(openai_router)     # OpenAI-compatible API (/v1/chat/completions, /v1/models)
app.include_router(agent_api_router)  # Native Antigravity Agent API (/api/v1/agent/run)
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
app.include_router(updater_router)  # Seamless git update check & apply
app.include_router(prompt_router)
app.include_router(copilot_router)
app.include_router(memory_router)   # Continuous memory & user profile (USER.md / MEMORY.md)
app.include_router(search_router)   # Cross-sessions FTS5 full-text search
app.include_router(tool_repair_router)  # Local models tool-call repair & normalizer
app.include_router(mcp_catalog_router)  # 1-Click MCP Catalog Store
app.include_router(progress_card_router)  # Dynamic Replace-on-Write Progress Card
app.include_router(doctor_router)  # System Health & Auto-Doctor
app.include_router(link_understanding_router)  # Bare URL Readability Extraction
app.include_router(git_worktree_router)  # Subagents Git Worktree Isolation
app.include_router(code_kernel_router)  # Persistent Python Kernel & Tool RPC
app.include_router(tailscale_router)  # Zero-Config Tailscale Remote Access
app.include_router(web_push_router)  # Web Push Notifications
app.include_router(messaging_gateway_router)  # Telegram & Discord Gateway with PIN Pairing
app.include_router(canvas_documents_router)  # Sandboxed Canvas Documents & Widgets
app.include_router(vector_memory_router)  # Vector Memory & Auto-Recall Hook
app.include_router(docker_studio_router)  # Docker & Container Management Studio
app.include_router(database_studio_router)  # Database Explorer & Visual SQL Query Studio
app.include_router(editor_diagnostics_router)  # Live Syntax & Linter Diagnostics Studio


@app.api_route("/api/health", methods=["GET", "HEAD"])
def health_check():
    return {"status": "ok", "service": "antigravity-webui"}

class CacheStaticFiles(StaticFiles):
    """Serveur statique ajoutant des en-têtes de cache long-terme pour les assets immuables Vite."""
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        if response.status_code == 200:
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response


# Frontend SPA serving
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"
if (FRONTEND_DIST / "assets").is_dir():
    app.mount("/assets", CacheStaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

if FRONTEND_DIST.is_dir():
    @app.api_route("/{full_path:path}", methods=["GET", "HEAD"])
    async def serve_frontend(full_path: str):
        if (
            full_path in ("api", "ws", "v1", "docs", "redoc", "openapi.json")
            or full_path.startswith(("api/", "ws/", "v1/", "docs/", "redoc/"))
        ):
            raise HTTPException(status_code=404, detail="API route not found")
        
        index_file = FRONTEND_DIST / "index.html"
        no_cache_headers = {
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
        if not full_path or full_path == "/":
            if index_file.is_file():
                return FileResponse(index_file, headers=no_cache_headers)
            raise HTTPException(status_code=404, detail="Index file not found")

        try:
            dist_resolved = FRONTEND_DIST.resolve()
            file_candidate = (dist_resolved / full_path).resolve()
            if file_candidate.is_relative_to(dist_resolved) and file_candidate.is_file():
                headers = {}
                if full_path.startswith("assets/"):
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                elif (
                    full_path in ("sw.js", "manifest.json", "manifest.webmanifest", "locales.json")
                    or full_path.endswith((".webmanifest", "/sw.js"))
                ):
                    headers = dict(no_cache_headers)
                return FileResponse(file_candidate, headers=headers)
        except (ValueError, TypeError, OSError):
            pass
        if index_file.is_file():
            return FileResponse(index_file, headers=no_cache_headers)
        raise HTTPException(status_code=404, detail="Resource not found")
