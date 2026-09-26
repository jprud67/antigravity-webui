from fastapi.testclient import TestClient

from app.main import app
from app.services.fts_search import TranscriptFtsService, clean_search_query

client = TestClient(app)


def test_clean_search_query():
    assert clean_search_query("hello") == '"hello"*'
    assert clean_search_query('"exact phrase"') == '"exact phrase"'
    assert "antigravity" in clean_search_query("antigravity python")


def test_fts_service_crud_and_search():
    service = TranscriptFtsService()

    # Index sample messages
    session_id = "test_fts_session_123"
    service.index_message(
        session_id=session_id,
        message_id="step_1",
        role="user",
        text="Comment configurer le moteur SQLite WAL mode dans FastAPI ?",
        project="antigravity",
    )
    service.index_message(
        session_id=session_id,
        message_id="step_2",
        role="assistant",
        text="Pour activer WAL mode, exécutez PRAGMA journal_mode=WAL après connexion.",
        project="antigravity",
    )

    # Search for WAL mode
    results = service.search("WAL mode")
    assert results["total_matches"] >= 1
    first_match = next((m for m in results["matches"] if m["session_id"] == session_id), None)
    assert first_match is not None
    assert "fts-match" in first_match["snippet"]
    assert first_match["project"] == "antigravity"

    # Search with role filter
    res_user = service.search("FastAPI", role="user")
    assert any(m["role"] == "user" for m in res_user["matches"])


def test_fts_api_endpoints():
    # Test GET /api/search/fts
    resp = client.get("/api/search/fts", params={"q": "FastAPI"})
    assert resp.status_code == 200
    data = resp.json()
    assert "matches" in data
    assert "took_ms" in data

    # Test GET /api/search/fts/stats
    resp_stats = client.get("/api/search/fts/stats")
    assert resp_stats.status_code == 200
    stats = resp_stats.json()
    assert "total_indexed_rows" in stats
    assert stats["engine"] == "sqlite_fts5"
