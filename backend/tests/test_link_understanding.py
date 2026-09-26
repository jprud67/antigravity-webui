from unittest.mock import MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.services.link_understanding import (
    _clean_html_to_text,
    enrich_user_prompt_with_links,
    extract_bare_urls,
    is_safe_public_url,
)


def test_is_safe_public_url_ssrf():
    # Dangerous / local URLs must be rejected
    assert is_safe_public_url("http://localhost:8000") is False
    assert is_safe_public_url("http://127.0.0.1/admin") is False
    assert is_safe_public_url("http://0.0.0.0:3000") is False
    assert is_safe_public_url("http://192.168.1.1/router") is False
    assert is_safe_public_url("http://10.0.0.1/secret") is False
    assert is_safe_public_url("ftp://example.com/file") is False

    # Safe public URLs
    assert is_safe_public_url("https://github.com/astral-sh/uv") is True
    assert is_safe_public_url("https://docs.python.org/3/") is True


def test_extract_bare_urls():
    text = (
        "Check this bare link https://github.com/astral-sh/uv and here is a "
        "markdown link [Documentation](https://docs.python.org/3/) which should be ignored."
    )
    bare = extract_bare_urls(text)
    assert len(bare) == 1
    assert bare[0] == "https://github.com/astral-sh/uv"


def test_clean_html_to_text():
    html_doc = """
    <!DOCTYPE html>
    <html>
    <head>
      <title>Sample Technical Documentation</title>
      <meta name="description" content="A guide to modern agentic coding.">
      <style>body { background: #000; }</style>
      <script>console.log('ad tracker');</script>
    </head>
    <body>
      <nav><a href="/">Home</a></nav>
      <h1>Getting Started</h1>
      <p>This is the core content describing the feature.</p>
      <footer>Copyright 2027</footer>
    </body>
    </html>
    """
    title, desc, content = _clean_html_to_text(html_doc)
    assert title == "Sample Technical Documentation"
    assert desc == "A guide to modern agentic coding."
    assert "ad tracker" not in content
    assert "core content describing the feature" in content


@pytest.mark.asyncio
async def test_enrich_user_prompt_with_links():
    fake_html = "<html><head><title>Mocked Issue #42</title></head><body>Bug details here</body></html>"
    mock_resp = MagicMock()
    mock_resp.status_code = 200
    mock_resp.text = fake_html

    with patch("httpx.AsyncClient.get", return_value=mock_resp):
        prompt = "Regarde ce rapport https://example.com/issue/42 s'il te plaît."
        enriched, extracted = await enrich_user_prompt_with_links(prompt)
        assert len(extracted) == 1
        assert extracted[0]["title"] == "Mocked Issue #42"
        assert "[Contexte web automatiquement extrait" in enriched
        assert "Mocked Issue #42" in enriched


@pytest.mark.asyncio
async def test_link_understanding_api(auth_headers: dict):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        unauth_res = await ac.post("/api/links/parse-prompt", json={
            "prompt": "Regarde https://github.com/astral-sh/uv pour comprendre"
        })
        assert unauth_res.status_code == 401

        res = await ac.post("/api/links/parse-prompt", json={
            "prompt": "Regarde https://github.com/astral-sh/uv pour comprendre"
        }, headers=auth_headers)
        assert res.status_code == 200
        data = res.json()
        assert "found_urls" in data
        assert len(data["found_urls"]) == 1
