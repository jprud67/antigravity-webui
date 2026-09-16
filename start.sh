#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PORT="${PORT:-8000}"
HOST="${HOST:-0.0.0.0}"

echo "🛸 Démarrage de Antigravity WebUI..."

# Vérification du venv
if [ ! -d "$SCRIPT_DIR/backend/venv" ]; then
    echo "📦 Création de l'environnement virtuel Python..."
    python3 -m venv "$SCRIPT_DIR/backend/venv"
    "$SCRIPT_DIR/backend/venv/bin/pip" install --upgrade pip
    "$SCRIPT_DIR/backend/venv/bin/pip" install -r "$SCRIPT_DIR/backend/requirements.txt"
fi

# Build frontend si absent
if [ ! -f "$SCRIPT_DIR/frontend/dist/index.html" ]; then
    echo "⚡ Construction du frontend..."
    cd "$SCRIPT_DIR/frontend"
    npm install
    npm run build
    cd "$SCRIPT_DIR"
fi

echo "🚀 Serveur disponible sur http://$HOST:$PORT"
export PYTHONPATH="$SCRIPT_DIR/backend"
exec "$SCRIPT_DIR/backend/venv/bin/uvicorn" app.main:app --host "$HOST" --port "$PORT"
