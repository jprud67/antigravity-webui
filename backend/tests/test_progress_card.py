import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.services.progress_card import (
    save_progress_card,
    get_progress_card,
    delete_progress_card,
    normalize_progress_card_input
)

def test_progress_card_normalization():
    raw = {
        "title": "Build Test Feature",
        "markdown": "Currently working on tests",
        "plan": [
            {"label": "Step 1", "status": "completed"},
            {"label": "Step 2", "status": "in_progress"},
            {"label": "Step 3", "status": "pending"},
            {"label": "Step 4", "status": "invalid_status"}
        ]
    }
    norm = normalize_progress_card_input(raw)
    assert norm["title"] == "Build Test Feature"
    assert norm["percent"] == 25  # 1 out of 4 completed
    assert len(norm["steps"]) == 4
    assert norm["steps"][3]["status"] == "pending"  # fallback from invalid


def test_progress_card_persistence():
    session_id = "test-session-progress-123"
    try:
        saved = save_progress_card(session_id, {
            "title": "Migrate DB",
            "plan": [
                {"label": "Schema create", "status": "completed"},
                {"label": "Data migrate", "status": "completed"}
            ]
        })
        assert saved["percent"] == 100

        retrieved = get_progress_card(session_id)
        assert retrieved is not None
        assert retrieved["title"] == "Migrate DB"
        assert retrieved["percent"] == 100
        assert len(retrieved["steps"]) == 2
    finally:
        delete_progress_card(session_id)
        assert get_progress_card(session_id) is None


@pytest.mark.asyncio
async def test_progress_card_api():
    session_id = "test-api-progress-conv-456"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Initial check
        res0 = await ac.get(f"/api/conversations/{session_id}/progress-card")
        assert res0.status_code == 200
        assert res0.json()["exists"] is False

        # Post update
        res1 = await ac.post(
            f"/api/conversations/{session_id}/progress-card",
            json={
                "title": "Sprint 24 Plan",
                "markdown": "In progress",
                "plan": [
                    {"label": "Step A", "status": "completed"},
                    {"label": "Step B", "status": "in_progress"}
                ]
            }
        )
        assert res1.status_code == 200
        data1 = res1.json()
        assert data1["success"] is True
        assert data1["card"]["percent"] == 50

        # Get updated
        res2 = await ac.get(f"/api/conversations/{session_id}/progress-card")
        assert res2.status_code == 200
        assert res2.json()["exists"] is True
        assert res2.json()["card"]["title"] == "Sprint 24 Plan"

        # Cleanup
        del_res = await ac.delete(f"/api/conversations/{session_id}/progress-card")
        assert del_res.status_code == 200
        assert del_res.json()["success"] is True
