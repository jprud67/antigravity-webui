import os
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

app = FastAPI(
    title="Antigravity WebUI",
    description="Web Interface to orchestrate Antigravity CLI without touching the terminal",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API routes
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

@app.get("/api/health")
def health_check():
    return {"status": "ok", "service": "antigravity-webui"}

# Frontend SPA serving
FRONTEND_DIST = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            raise HTTPException(status_code=404, detail="API route not found")
        
        try:
            file_candidate = (FRONTEND_DIST / full_path).resolve()
            if FRONTEND_DIST.resolve() in file_candidate.parents and file_candidate.is_file():
                return FileResponse(file_candidate)
        except Exception:
            pass
        return FileResponse(FRONTEND_DIST / "index.html")
