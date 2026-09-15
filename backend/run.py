import os

import uvicorn

if __name__ == "__main__":
    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8000"))
    # reload=True est réservé au développement ; désactivé par défaut en production.
    # Définir UVICORN_RELOAD=true pour l'activer explicitement.
    reload = os.environ.get("UVICORN_RELOAD", "false").lower() in ("1", "true", "yes")
    uvicorn.run("app.main:app", host=host, port=port, reload=reload)
