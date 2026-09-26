"""Unit tests for Vector Memory & Auto-Recall Hook."""

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services.vector_memory import (
    AutoRecallConfig,
    MemorySearchInput,
    MemoryStoreInput,
    clear_memories,
    cosine_similarity,
    delete_memory,
    execute_auto_recall_hook,
    generate_local_embedding,
    is_trivial_prompt,
    list_memories,
    search_memories,
    store_memory,
)

client = TestClient(app)


def test_is_trivial_prompt():
    assert is_trivial_prompt("ok") is True
    assert is_trivial_prompt("thanks!") is True
    assert is_trivial_prompt("yes") is True
    assert is_trivial_prompt("hi") is True
    assert is_trivial_prompt("continue") is True
    assert is_trivial_prompt("/goal") is True
    assert is_trivial_prompt("   ") is True

    assert is_trivial_prompt("How do I configure nginx reverse proxy?") is False
    assert is_trivial_prompt("What is my database connection string?") is False
    assert is_trivial_prompt("Deploy to production cluster") is False


def test_embedding_and_cosine_similarity():
    vec1 = generate_local_embedding("The quick brown fox jumps over the lazy dog")
    vec2 = generate_local_embedding("A quick brown fox leaping over lazy dogs")
    vec3 = generate_local_embedding("Completely unrelated astrophysical simulation of black holes")

    assert len(vec1) == 384
    sim_similar = cosine_similarity(vec1, vec2)
    sim_dissimilar = cosine_similarity(vec1, vec3)

    assert sim_similar > sim_dissimilar
    assert cosine_similarity(vec1, vec1) >= 0.99


@pytest.mark.asyncio
async def test_store_and_search_vector_memories():
    clear_memories("test_agent")

    item1 = MemoryStoreInput(
        text="User prefers React with TypeScript and Tailwind CSS.",
        category="preference",
        importance=0.9,
        agentId="test_agent",
    )
    item2 = MemoryStoreInput(
        text="The production PostgreSQL server runs on host 10.0.0.5 port 5432.",
        category="fact",
        importance=0.8,
        agentId="test_agent",
    )

    mem1 = await store_memory(item1)
    mem2 = await store_memory(item2)

    assert mem1.id.startswith("mem_")
    assert mem2.id.startswith("mem_")

    # Search for database
    search_db = await search_memories(
        MemorySearchInput(
            query="Where is the postgres database hosted?",
            agentId="test_agent",
            limit=2,
            minSimilarity=0.1,
        )
    )
    assert len(search_db) >= 1
    assert any("PostgreSQL" in r.entry.text for r in search_db)

    # Search for frontend preferences
    search_fe = await search_memories(
        MemorySearchInput(
            query="What frontend stack does the user like?",
            agentId="test_agent",
            limit=2,
            minSimilarity=0.1,
        )
    )
    assert len(search_fe) >= 1
    assert any("TypeScript" in r.entry.text for r in search_fe)

    # Check listing
    all_mems = list_memories("test_agent")
    assert len(all_mems) == 2

    # Check deletion
    assert delete_memory(mem1.id) is True
    assert len(list_memories("test_agent")) == 1

    clear_memories("test_agent")


@pytest.mark.asyncio
async def test_auto_recall_hook():
    clear_memories("test_recall_agent")

    # 1. Trivial prompt should be skipped
    res_trivial = await execute_auto_recall_hook("ok thanks", agent_id="test_recall_agent")
    assert res_trivial.should_inject is False
    assert res_trivial.recalled_count == 0

    # 2. Add memory
    await store_memory(
        MemoryStoreInput(
            text="Antigravity webui is deployed under C:/laragon/www/antigravity-webui",
            category="fact",
            importance=1.0,
            agentId="test_recall_agent",
        )
    )

    # 3. Informative prompt matching the memory
    cfg = AutoRecallConfig(enabled=True, min_similarity=0.1, max_results=2)
    res_recall = await execute_auto_recall_hook(
        "Where is the antigravity webui project directory?",
        agent_id="test_recall_agent",
        cfg=cfg,
    )
    assert res_recall.should_inject is True
    assert res_recall.recalled_count >= 1
    assert "<recalled_memories>" in res_recall.context_block
    assert "antigravity-webui" in res_recall.context_block

    clear_memories("test_recall_agent")


def test_vector_memory_api():
    # 1. Store memory
    store_res = client.post(
        "/api/memory/vector/store",
        json={
            "text": "Stripe webhook endpoint is /api/webhooks/stripe",
            "category": "fact",
            "importance": 0.8,
            "agentId": "api_test_agent",
        },
    )
    assert store_res.status_code == 200
    mem_id = store_res.json()["id"]

    # 2. List memories
    list_res = client.get("/api/memory/vector/list?agentId=api_test_agent")
    assert list_res.status_code == 200
    assert any(m["id"] == mem_id for m in list_res.json())

    # 3. Search memories
    search_res = client.post(
        "/api/memory/vector/search",
        json={
            "query": "Where is the stripe webhook route?",
            "agentId": "api_test_agent",
            "minSimilarity": 0.1,
        },
    )
    assert search_res.status_code == 200
    assert len(search_res.json()) >= 1

    # 4. Config endpoint
    cfg_res = client.get("/api/memory/vector/config")
    assert cfg_res.status_code == 200
    assert "enabled" in cfg_res.json()

    # 5. Recall endpoint
    recall_res = client.post(
        "/api/memory/vector/recall",
        json={
            "prompt": "ok thanks",
            "agent_id": "api_test_agent",
        },
    )
    assert recall_res.status_code == 200
    assert recall_res.json()["shouldInject"] is False

    # 6. Delete memory
    del_res = client.delete(f"/api/memory/vector/{mem_id}")
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "ok"
