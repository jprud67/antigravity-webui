"""Link Understanding & Automatic URL Readability Extraction Service.

Directly adapted from Antigravity Core (src/gateway/link-understanding.product.test.ts,
src/agents/tools/web-fetch.ts) and Agent Antigravity (tools/web_tools_extract.py).
Intercepts bare URLs in chat, fetches clean readability content in background,
applies SSRF safety filtering, and enriches prompt context without clutter.
"""

from __future__ import annotations

import html
import ipaddress
import logging
import re
import socket
import sqlite3
import time
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlparse

import httpx

from app.config import SESSIONS_DB

logger = logging.getLogger(__name__)

DB_PATH = SESSIONS_DB
CACHE_TTL_SECONDS = 86400  # 24 hours
MAX_CONTENT_CHARS = 1800


@contextmanager
def _get_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=15.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA busy_timeout=5000")
    try:
        with conn:
            yield conn
    finally:
        try:
            conn.close()
        except Exception as e:
            logger.debug("Failed to close link understanding connection: %s", e)


def ensure_link_cache_schema():
    with _get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS link_understanding_cache (
                url TEXT PRIMARY KEY,
                title TEXT,
                description TEXT,
                content TEXT NOT NULL,
                cached_at REAL NOT NULL
            )
        """)
        conn.commit()


def is_safe_public_url(url: str) -> bool:
    """SSRF Guard adapted from Antigravity Core fetch-guard."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False

        hostname = (parsed.hostname or "").lower()
        if not hostname:
            return False

        # Disallow loopback / special names
        if hostname in ("localhost", "local", "invalid", "test"):
            return False

        # Check if direct IP
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                return False
        except ValueError:
            # Domain name: resolve DNS and check IP
            try:
                resolved_ip = socket.gethostbyname(hostname)
                ip = ipaddress.ip_address(resolved_ip)
                if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                    return False
            except Exception:
                return False

        return True
    except Exception:
        return False


def extract_bare_urls(text: str) -> list[str]:
    """Finds bare URLs, ignoring those already formatted as markdown links [label](url)."""
    if not text:
        return []

    # Strip markdown link destinations [label](url) so they aren't parsed as bare links
    cleaned = re.sub(r'\[[^\]]*\]\((https?://[^\s\)]+)\)', '', text)

    # Match URLs
    pattern = r'https?://[^\s<>"\'`()]+'
    found = re.findall(pattern, cleaned)

    valid_urls: list[str] = []
    seen = set()
    for u in found:
        # Strip trailing punctuation commonly typed at end of sentence
        u_clean = u.rstrip(".,;:!?)]}")
        if u_clean not in seen and is_safe_public_url(u_clean):
            seen.add(u_clean)
            valid_urls.append(u_clean)

    return valid_urls


def _clean_html_to_text(raw_html: str) -> tuple[str, str, str]:
    """Extracts title, meta description, and clean readability text from HTML."""
    title = ""
    description = ""

    # 1. Title
    title_match = re.search(r'<title[^>]*>(.*?)</title>', raw_html, re.IGNORECASE | re.DOTALL)
    if title_match:
        title = html.unescape(title_match.group(1).strip())

    # 2. Meta description (supports name="description" and property="og:description")
    meta_desc_match = re.search(r'<meta[^>]*(?:name|property)=["\'](?:description|og:description)["\'][^>]*content=["\'](.*?)["\']', raw_html, re.IGNORECASE)
    if not meta_desc_match:
        meta_desc_match = re.search(r'<meta[^>]*content=["\'](.*?)["\'][^>]*(?:name|property)=["\'](?:description|og:description)["\']', raw_html, re.IGNORECASE)
    if meta_desc_match:
        description = html.unescape(meta_desc_match.group(1).strip())

    # 3. Strip non-content tags
    text = re.sub(r'<(script|style|nav|footer|header|aside|noscript|iframe|svg)[^>]*>.*?</\1>', ' ', raw_html, flags=re.IGNORECASE | re.DOTALL)
    text = re.sub(r'<!--.*?-->', ' ', text, flags=re.DOTALL)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)

    # 4. Collapse whitespace
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    cleaned_text = "\n".join(lines)
    cleaned_text = re.sub(r'[ \t]+', ' ', cleaned_text)

    if len(cleaned_text) > MAX_CONTENT_CHARS:
        cleaned_text = cleaned_text[:MAX_CONTENT_CHARS] + "..."

    return title or "Page Web", description, cleaned_text


async def fetch_and_extract_url(url: str, force_refresh: bool = False) -> dict[str, Any]:
    """Fetches URL, parses readability contents, and caches in SQLite."""
    ensure_link_cache_schema()

    if not is_safe_public_url(url):
        raise ValueError(f"URL non autorisée par la politique de sécurité (SSRF) : {url}")

    now = time.time()

    # Check cache
    if not force_refresh:
        with _get_db() as conn:
            row = conn.execute(
                "SELECT * FROM link_understanding_cache WHERE url = ?",
                (url,)
            ).fetchone()
            if row and (now - row["cached_at"]) < CACHE_TTL_SECONDS:
                return {
                    "url": row["url"],
                    "title": row["title"],
                    "description": row["description"],
                    "content": row["content"],
                    "cached": True,
                    "cached_at": row["cached_at"]
                }

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Antigravity-LinkUnderstanding/0.2.28",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8"
    }

    def _validate_redirect(response: httpx.Response):
        if response.is_redirect:
            loc = response.headers.get("location")
            if loc:
                target_url = str(response.url.join(loc))
                if not is_safe_public_url(target_url):
                    raise ValueError(f"Redirection vers une URL non autorisée (SSRF) : {target_url}")

    async with httpx.AsyncClient(
        timeout=6.0,
        follow_redirects=True,
        verify=True,
        event_hooks={"response": [_validate_redirect]}
    ) as client:
        resp = await client.get(url, headers=headers)
        if resp.status_code >= 400:
            raise RuntimeError(f"Échec HTTP {resp.status_code} lors de la lecture du lien.")
        
        raw_html = resp.text
        title, description, content = _clean_html_to_text(raw_html)

    # Persist in cache
    with _get_db() as conn:
        conn.execute("""
            INSERT INTO link_understanding_cache (url, title, description, content, cached_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(url) DO UPDATE SET
                title = excluded.title,
                description = excluded.description,
                content = excluded.content,
                cached_at = excluded.cached_at
        """, (url, title, description, content, now))
        conn.commit()

    return {
        "url": url,
        "title": title,
        "description": description,
        "content": content,
        "cached": False,
        "cached_at": now
    }


async def enrich_user_prompt_with_links(prompt: str) -> tuple[str, list[dict[str, Any]]]:
    """Detects bare URLs in prompt, extracts summary, and enriches agent context."""
    urls = extract_bare_urls(prompt)
    if not urls:
        return prompt, []

    extracted: list[dict[str, Any]] = []
    blocks: list[str] = []

    for u in urls[:3]:  # Limit to 3 links per turn to protect context
        try:
            info = await fetch_and_extract_url(u)
            extracted.append(info)
            snippet = info["content"]
            if info.get("description") and info["description"] not in snippet:
                snippet = f"Description: {info['description']}\n\n{snippet}"
            blocks.append(f"--- [Contenu extrait du lien : {info['title']} ({u})] ---\n{snippet}")
        except Exception as e:
            logger.debug(f"Failed to extract link {u}: {e}")

    if not blocks:
        return prompt, []

    context_injection = "\n\n".join(blocks)
    enriched_prompt = f"{prompt}\n\n[Contexte web automatiquement extrait pour information] :\n{context_injection}"
    return enriched_prompt, extracted
