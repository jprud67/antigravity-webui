import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.services.mcp_catalog import (
    list_mcp_catalog,
    get_mcp_catalog_item,
    test_mcp_connection as ping_mcp_server
)

@pytest.mark.asyncio
async def test_mcp_catalog_listing():
    items = await list_mcp_catalog()
    assert len(items) >= 65
    
    # Filter by category
    db_items = await list_mcp_catalog(category="Database")
    assert len(db_items) > 0
    assert all(i["category"] == "Database" for i in db_items)

    # Filter by query
    supabase_matches = await list_mcp_catalog(query="supabase")
    assert len(supabase_matches) >= 1
    assert any(i["slug"] == "supabase" for i in supabase_matches)


@pytest.mark.asyncio
async def test_mcp_catalog_get_and_test():
    item = await get_mcp_catalog_item("supabase")
    assert item is not None
    assert item["slug"] == "supabase"
    assert "transport" in item
    assert item["transport"]["type"] == "http"

    # Test stdio connection check
    test_res = await ping_mcp_server("filesystem")
    assert "latency_ms" in test_res
    assert test_res["transport"] == "stdio"


@pytest.mark.asyncio
async def test_mcp_catalog_api():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/mcp/catalog")
        assert res.status_code == 200
        data = res.json()
        assert "items" in data
        assert data["total"] >= 65

        res_entry = await ac.get("/api/mcp/catalog/supabase")
        assert res_entry.status_code == 200
        assert res_entry.json()["slug"] == "supabase"
