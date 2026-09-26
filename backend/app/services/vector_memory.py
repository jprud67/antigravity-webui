"""Vector Memory & Auto-Recall Hook Service.

Implements embedded semantic vector memory, local fallback vectorizer,
configurable embedding providers (local hash/n-gram, OpenAI, Ollama),
and the auto-recall prompt hook (inspired by Antigravity Core extensions/memory-lancedb
and Agent Antigravity/memory_manager.py).
"""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
import sqlite3
import time
import uuid
from typing import Any, Literal

import httpx
from pydantic import AliasChoices, BaseModel, ConfigDict, Field

from app.config import CONVERSATION_DB, SETTINGS_FILE

logger = logging.getLogger("antigravity.vector_memory")

MemoryCategory = Literal["core", "daily", "preference", "fact", "convention", "general"]
EmbeddingProvider = Literal["local", "openai", "ollama", "gemini"]

# Trivial prompts regex adapted from Agent Antigravity/memory_provider.py
TRIVIAL_PROMPT_RE = re.compile(
    r"^(yes|no|ok|okay|sure|thanks|thank you|y|n|yep|nope|yeah|nah|"
    r"hi|hey|hello|yo|sup|"
    r"continue|go ahead|do it|proceed|got it|cool|nice|great|done|next|lgtm|k)"
    r"[\s!?.:;,'\"~\u2018\u2019\u201c\u201d\u2014\u2013\u2026()\[\]{}<>*&^%$#@!+=`\xa0]*$",
    re.IGNORECASE,
)


def is_trivial_prompt(text: str | None) -> bool:
    """True for empty input, slash commands, or bare greetings/acknowledgements."""
    stripped = (text or "").strip()
    if not stripped or stripped.startswith("/"):
        return True
    return bool(TRIVIAL_PROMPT_RE.match(stripped))


class MemoryEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    id: str
    text: str
    category: MemoryCategory = "general"
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    agent_id: str = Field(default="default", validation_alias=AliasChoices("agentId", "agent_id"), serialization_alias="agentId")
    created_at: float = Field(default_factory=time.time, validation_alias=AliasChoices("createdAt", "created_at"), serialization_alias="createdAt")
    metadata: dict[str, Any] = Field(default_factory=dict)
    vector: list[float] | None = None


class MemoryStoreInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    text: str
    category: MemoryCategory = "general"
    importance: float = Field(default=0.5, ge=0.0, le=1.0)
    agent_id: str = Field(default="default", validation_alias=AliasChoices("agentId", "agent_id"), serialization_alias="agentId")
    metadata: dict[str, Any] | None = None


class MemorySearchInput(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    query: str
    agent_id: str = Field(default="default", validation_alias=AliasChoices("agentId", "agent_id"), serialization_alias="agentId")
    category: MemoryCategory | None = None
    limit: int = Field(default=5, ge=1, le=50)
    min_similarity: float = Field(default=0.5, ge=0.0, le=1.0, validation_alias=AliasChoices("minSimilarity", "min_similarity"), serialization_alias="minSimilarity")


class MemorySearchResult(BaseModel):
    entry: MemoryEntry
    score: float
    similarity: float


class AutoRecallConfig(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    enabled: bool = True
    provider: EmbeddingProvider = "local"
    model: str = "text-embedding-3-small"
    api_key: str | None = Field(default=None, validation_alias=AliasChoices("apiKey", "api_key"), serialization_alias="apiKey")
    api_base: str | None = Field(default=None, validation_alias=AliasChoices("apiBase", "api_base"), serialization_alias="apiBase")
    max_results: int = Field(default=3, ge=1, le=10, validation_alias=AliasChoices("maxResults", "max_results"), serialization_alias="maxResults")
    min_similarity: float = Field(default=0.60, ge=0.0, le=1.0, validation_alias=AliasChoices("minSimilarity", "min_similarity"), serialization_alias="minSimilarity")
    max_chars: int = Field(default=2000, ge=200, le=10000, validation_alias=AliasChoices("maxChars", "max_chars"), serialization_alias="maxChars")


class RecallHookResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    should_inject: bool = Field(..., validation_alias=AliasChoices("shouldInject", "should_inject"), serialization_alias="shouldInject")
    recalled_count: int = Field(default=0, validation_alias=AliasChoices("recalledCount", "recalled_count"), serialization_alias="recalledCount")
    context_block: str = Field(default="", validation_alias=AliasChoices("contextBlock", "context_block"), serialization_alias="contextBlock")
    memories: list[MemorySearchResult] = Field(default_factory=list)


def _get_db() -> sqlite3.Connection:
    CONVERSATION_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(CONVERSATION_DB), timeout=15.0)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    return conn


def ensure_vector_memory_schema() -> None:
    """Creates the SQLite vector memory table if missing."""
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS vector_memories (
                id TEXT PRIMARY KEY,
                agent_id TEXT NOT NULL DEFAULT 'default',
                text TEXT NOT NULL,
                vector TEXT NOT NULL,
                importance REAL NOT NULL DEFAULT 0.5,
                category TEXT NOT NULL DEFAULT 'general',
                created_at REAL NOT NULL,
                metadata TEXT
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vm_agent ON vector_memories(agent_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vm_created ON vector_memories(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vm_agent_cat ON vector_memories(agent_id, category)")
        conn.commit()


def get_auto_recall_config() -> AutoRecallConfig:
    """Read AutoRecallConfig from settings or defaults."""
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            mem_cfg = data.get("vector_memory", {})
            return AutoRecallConfig(**mem_cfg)
        except Exception as e:
            logger.debug(f"Failed to read vector memory config: {e}")
    return AutoRecallConfig()


def save_auto_recall_config(cfg: AutoRecallConfig) -> None:
    """Save AutoRecallConfig into settings."""
    data: dict[str, Any] = {}
    if SETTINGS_FILE.exists():
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
        except Exception:
            data = {}
    data["vector_memory"] = cfg.model_dump(by_alias=True)
    SETTINGS_FILE.parent.mkdir(parents=True, exist_ok=True)
    SETTINGS_FILE.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def generate_local_embedding(text: str, dim: int = 384) -> list[float]:
    """
    Deterministic zero-dependency character n-gram + word hash embedding.
    Maps arbitrary text to a normalized unit vector in R^dim.
    Semantic similarity approximates token / character overlapping semantics.
    """
    vec = [0.0] * dim
    clean_text = text.lower().strip()
    words = re.findall(r"\w+", clean_text)
    
    # 1. Word hashing
    for word in words:
        h = int(hashlib.md5(word.encode("utf-8"), usedforsecurity=False).hexdigest(), 16)
        idx = h % dim
        sign = 1.0 if ((h >> 8) & 1) else -1.0
        vec[idx] += sign * 1.5

    # 2. Character 3-grams
    if len(clean_text) >= 3:
        for i in range(len(clean_text) - 2):
            trigram = clean_text[i : i + 3]
            h = int(hashlib.md5(trigram.encode("utf-8"), usedforsecurity=False).hexdigest(), 16)
            idx = h % dim
            sign = 1.0 if ((h >> 8) & 1) else -1.0
            vec[idx] += sign * 0.5

    # Normalize to unit vector
    norm = math.sqrt(sum(x * x for x in vec))
    if norm > 0:
        vec = [round(x / norm, 6) for x in vec]
    else:
        vec[0] = 1.0
    return vec


async def compute_embedding(text: str, cfg: AutoRecallConfig | None = None) -> list[float]:
    """Compute embedding using configured provider with automatic fallback to local."""
    config = cfg or get_auto_recall_config()

    if config.provider == "openai" and config.api_key:
        api_key = config.api_key.strip()
        api_base = (config.api_base.strip() if config.api_base else "https://api.openai.com/v1").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    f"{api_base}/embeddings",
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={"model": config.model, "input": text},
                )
                if res.status_code == 200:
                    data = res.json()
                    return data["data"][0]["embedding"]
        except Exception as e:
            logger.warning(f"OpenAI embedding call failed, falling back to local: {e}")

    elif config.provider == "gemini" and config.api_key:
        api_key = config.api_key.strip()
        api_base = (config.api_base.strip() if config.api_base else "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
        model = config.model if config.model and "embedding" in config.model else "text-embedding-004"
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    f"{api_base}/models/{model}:embedContent",
                    headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                    json={"content": {"parts": [{"text": text}]}},
                )
                if res.status_code == 200:
                    data = res.json()
                    embedding_data = data.get("embedding", {})
                    if "values" in embedding_data:
                        return embedding_data["values"]
        except Exception as e:
            logger.warning(f"Gemini embedding call failed, falling back to local: {e}")

    # Default zero-dependency local embedding
    return generate_local_embedding(text)


def cosine_similarity(v1: list[float], v2: list[float]) -> float:
    """Calculates cosine similarity between two float vectors."""
    if len(v1) != len(v2):
        min_len = min(len(v1), len(v2))
        v1 = v1[:min_len]
        v2 = v2[:min_len]

    dot = sum(a * b for a, b in zip(v1, v2))
    norm1 = math.sqrt(sum(a * a for a in v1))
    norm2 = math.sqrt(sum(b * b for b in v2))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return max(-1.0, min(1.0, dot / (norm1 * norm2)))


async def store_memory(
    item: MemoryStoreInput,
    cfg: AutoRecallConfig | None = None,
) -> MemoryEntry:
    """Stores a memory entry with computed vector embedding."""
    ensure_vector_memory_schema()
    doc_id = f"mem_{uuid.uuid4().hex[:12]}"
    now = time.time()
    vector = await compute_embedding(item.text, cfg)
    metadata = item.metadata or {}

    with _get_db() as conn:
        conn.execute(
            """
            INSERT INTO vector_memories (id, agent_id, text, vector, importance, category, created_at, metadata)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                doc_id,
                item.agent_id,
                item.text,
                json.dumps(vector),
                float(item.importance),
                item.category,
                now,
                json.dumps(metadata),
            ),
        )
        conn.commit()

    return MemoryEntry(
        id=doc_id,
        text=item.text,
        category=item.category,
        importance=item.importance,
        agent_id=item.agent_id,
        created_at=now,
        metadata=metadata,
        vector=vector,
    )


async def search_memories(
    item: MemorySearchInput,
    cfg: AutoRecallConfig | None = None,
) -> list[MemorySearchResult]:
    """Performs semantic vector search over memories."""
    ensure_vector_memory_schema()
    query_vector = await compute_embedding(item.query, cfg)

    with _get_db() as conn:
        conn.row_factory = sqlite3.Row
        sql = "SELECT id, agent_id, text, vector, importance, category, created_at, metadata FROM vector_memories WHERE agent_id = ?"
        params: list[Any] = [item.agent_id]
        if item.category:
            sql += " AND category = ?"
            params.append(item.category)

        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()

    results: list[MemorySearchResult] = []
    for row in rows:
        try:
            vec = json.loads(row["vector"])
            sim = cosine_similarity(query_vector, vec)
            if sim < item.min_similarity:
                continue
            # Weighted score incorporating importance
            importance = float(row["importance"])
            score = sim * (0.8 + 0.2 * importance)
            entry = MemoryEntry(
                id=row["id"],
                text=row["text"],
                category=row["category"],
                importance=importance,
                agent_id=row["agent_id"],
                created_at=float(row["created_at"]),
                metadata=json.loads(row["metadata"]) if row["metadata"] else {},
            )
            results.append(MemorySearchResult(entry=entry, score=score, similarity=sim))
        except Exception as e:
            logger.debug(f"Failed to process memory row {row['id']}: {e}")

    results.sort(key=lambda r: r.score, reverse=True)
    return results[: item.limit]


def list_memories(
    agent_id: str = "default",
    category: MemoryCategory | None = None,
    limit: int = 50,
) -> list[MemoryEntry]:
    """Lists stored memories for an agent."""
    ensure_vector_memory_schema()
    with _get_db() as conn:
        conn.row_factory = sqlite3.Row
        sql = "SELECT id, agent_id, text, importance, category, created_at, metadata FROM vector_memories WHERE agent_id = ?"
        params: list[Any] = [agent_id]
        if category:
            sql += " AND category = ?"
            params.append(category)
        sql += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        cursor = conn.execute(sql, params)
        rows = cursor.fetchall()

    entries = []
    for r in rows:
        entries.append(
            MemoryEntry(
                id=r["id"],
                text=r["text"],
                category=r["category"],
                importance=float(r["importance"]),
                agent_id=r["agent_id"],
                created_at=float(r["created_at"]),
                metadata=json.loads(r["metadata"]) if r["metadata"] else {},
            )
        )
    return entries


def delete_memory(memory_id: str) -> bool:
    """Deletes a memory by ID."""
    ensure_vector_memory_schema()
    with _get_db() as conn:
        cursor = conn.execute("DELETE FROM vector_memories WHERE id = ?", (memory_id,))
        conn.commit()
        return cursor.rowcount > 0


def clear_memories(agent_id: str = "default") -> int:
    """Clears all memories for an agent."""
    ensure_vector_memory_schema()
    with _get_db() as conn:
        cursor = conn.execute("DELETE FROM vector_memories WHERE agent_id = ?", (agent_id,))
        conn.commit()
        return cursor.rowcount


def format_recalled_memories_context(memories: list[MemorySearchResult], max_chars: int = 2000) -> str:
    """Formats top-K memories into prompt-injected system instructions."""
    if not memories:
        return ""

    lines = ["<recalled_memories>"]
    lines.append("The following relevant user memories and project facts were automatically retrieved:")
    current_len = sum(len(line_str) for line_str in lines)

    for i, mem in enumerate(memories, 1):
        rel_pct = int(mem.similarity * 100)
        category_tag = mem.entry.category
        line = f"- [Memory #{i} | {category_tag} | {rel_pct}% match]: {mem.entry.text}"
        if current_len + len(line) + 25 > max_chars:
            lines.append("... [additional memories omitted for brevity]")
            break
        lines.append(line)
        current_len += len(line)

    lines.append("</recalled_memories>")
    return "\n".join(lines)


async def execute_auto_recall_hook(
    prompt: str,
    agent_id: str = "default",
    cfg: AutoRecallConfig | None = None,
) -> RecallHookResult:
    """
    Executes the auto-recall hook for an upcoming user prompt.
    Checks prompt triviality, executes vector search, formats recalled memories,
    and returns context block to inject into the LLM system/user turn.
    """
    config = cfg or get_auto_recall_config()
    if not config.enabled:
        return RecallHookResult(should_inject=False, recalled_count=0, context_block="", memories=[])

    if is_trivial_prompt(prompt):
        logger.debug(f"Skipping auto-recall for trivial prompt: {prompt[:30]!r}")
        return RecallHookResult(should_inject=False, recalled_count=0, context_block="", memories=[])

    search_input = MemorySearchInput(
        query=prompt,
        agent_id=agent_id,
        limit=config.max_results,
        min_similarity=config.min_similarity,
    )
    matches = await search_memories(search_input, config)
    if not matches:
        return RecallHookResult(should_inject=False, recalled_count=0, context_block="", memories=[])

    context_block = format_recalled_memories_context(matches, config.max_chars)
    return RecallHookResult(
        should_inject=True,
        recalled_count=len(matches),
        context_block=context_block,
        memories=matches,
    )
