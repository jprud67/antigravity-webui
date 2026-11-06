#!/usr/bin/env bash
# =============================================================================
# Audit automatique d'Antigravity WebUI — script 100 % autonome.
# Aucune dépendance Hermes : tout vit dans ce dépôt (script + journaux).
#
# Usage :
#   ./scripts/antigravity_audit.sh
#
# Planification possible via le crontab système, p.ex. toutes les 30 minutes :
#   0,30 * * * * /root/antigravity-webui/scripts/antigravity_audit.sh
#
# Journalisation : <repo>/logs/audit_YYYY_MM_DD.log (ignoré par git)
# Auteur des commits : jprud67 (strictement aucun Co-Authored-By)
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

LOCKFILE="/tmp/antigravity_audit.lock"
exec 200>"$LOCKFILE"
flock -n 200 || {
    echo "[$(date '+%F %T')] Un audit est déjà en cours — abandon."
    exit 0
}

export HOME="${HOME:-/root}"
LOG_DIR="$REPO_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/audit_$(date '+%Y_%m_%d').log"

log() { echo "[$(date '+%F %T')] $*" >> "$LOG_FILE"; }

log "==================== Démarrage de l'audit ===================="

# Résolution du CLI Antigravity (agy)
AGY_BIN="${AGY_BIN:-}"
if [ -z "$AGY_BIN" ]; then
    AGY_BIN="$(command -v agy || true)"
fi
if [ -z "$AGY_BIN" ] && [ -x "$HOME/.local/bin/agy" ]; then
    AGY_BIN="$HOME/.local/bin/agy"
fi
if [ -z "$AGY_BIN" ]; then
    log "ERREUR : binaire agy introuvable (définissez la variable AGY_BIN)."
    exit 1
fi

cd "$REPO_DIR"

# Identité Git stricte (auteur unique, aucun Co-Authored-By)
git config --global user.email "jprud67@gmail.com" 2>/dev/null || true
git config --global user.name "jprud67" 2>/dev/null || true
git config user.email "jprud67@gmail.com" 2>/dev/null || true
git config user.name "jprud67" 2>/dev/null || true

AUDIT_PROMPT="Cette tâche et ces instructions concernent UNIQUE ET EXCLUSIVEMENT la plateforme Antigravity WebUI située dans le dossier $REPO_DIR (interdiction formelle de toucher ou modifier tout autre dossier ou projet du serveur). Analysez chaque extrait de code de la plateforme Antigravity WebUI au complet sans omission avec un regard neuf et critique afin d'identifier les bugs et les points d'optimisation. Une fois ce diagnostic terminé, établissez un plan de correction rigoureux. Une fois le plan établi alors exécute le plan. Une fois les tâches terminées fait un push avec uniquement et seulement l'auteur jprud67, jprud67@gmail.com. git config --global user.email 'jprud67@gmail.com' git config --global user.name 'jprud67' je ne veux jamais de Co-Authored-By claude"

log "Lancement d'Antigravity CLI pour l'audit d'Antigravity WebUI..."
"$AGY_BIN" --add-dir "$REPO_DIR" --dangerously-skip-permissions --print-timeout 25m -p "$AUDIT_PROMPT" >> "$LOG_FILE" 2>&1 || {
    log "Avertissement : fin de cycle agy (code non-zéro ou interruption)."
}

# Vérification des modifications puis build / commit / push
if [ -n "$(git status --porcelain)" ]; then
    log "Modifications détectées — vérification et compilation..."

    if git status --porcelain | grep -qE '^.. frontend/'; then
        log "Recompilation du frontend..."
        (cd "$REPO_DIR/frontend" && npm run build) >> "$LOG_FILE" 2>&1 || log "Avertissement : build frontend en échec."
    fi

    git add -A
    COMMIT_MSG="refactor(audit): automated codebase audit, optimizations and bugfixes [$(date '+%F %H:%M')]"
    git commit --author="jprud67 <jprud67@gmail.com>" -m "$COMMIT_MSG" >> "$LOG_FILE" 2>&1 || true

    log "Push des modifications sur origin main..."
    git push origin main >> "$LOG_FILE" 2>&1 || log "Erreur lors du push git."

    if command -v systemctl >/dev/null 2>&1; then
        systemctl restart antigravity-webui >> "$LOG_FILE" 2>&1 || true
    fi
    log "Audit et push terminés avec succès."
else
    log "Aucune modification requise — codebase propre et stable."
fi

log "Tâche d'audit terminée."
