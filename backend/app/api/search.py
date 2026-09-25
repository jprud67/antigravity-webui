"""
backend/app/api/search.py — Endpoints API pour la recherche plein-texte FTS5 cross-sessions.
"""

from typing import Any, Dict, Optional
from fastapi import APIRouter, Query

from app.services.fts_search import fts_service

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("/fts")
def search_fts(
    q: str = Query(..., description="Terme ou expression de recherche"),
    role: Optional[str] = Query(None, description="Filtrer par rôle (user, assistant, system)"),
    session_id: Optional[str] = Query(None, description="Filtrer par identifiant de conversation"),
    project: Optional[str] = Query(None, description="Filtrer par projet"),
    limit: int = Query(50, ge=1, le=200, description="Nombre maximum de résultats"),
) -> Dict[str, Any]:
    """Recherche plein-texte ultra-rapide (<10ms) sur l'ensemble des historiques de conversations."""
    return fts_service.search(query=q, role=role, session_id=session_id, project=project, limit=limit)


@router.post("/fts/reindex")
def reindex_fts() -> Dict[str, Any]:
    """Reconstruit intégralement l'index SQLite FTS5 à partir de toutes les conversations."""
    return fts_service.rebuild_all_sessions()


@router.get("/fts/stats")
def get_fts_stats() -> Dict[str, Any]:
    """Renvoie les métriques et statistiques d'indexation de la table FTS5."""
    return fts_service.get_stats()
