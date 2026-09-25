"""FastAPI router for Link Understanding and Web URL Readability Extraction."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.link_understanding import (
    fetch_and_extract_url,
    extract_bare_urls,
    enrich_user_prompt_with_links
)

router = APIRouter(prefix="/api/links", tags=["Link Understanding"])


class ExtractUrlPayload(BaseModel):
    url: str
    force_refresh: bool = False


class ParsePromptLinksPayload(BaseModel):
    prompt: str


@router.post("/extract")
async def extract_url(payload: ExtractUrlPayload):
    try:
        data = await fetch_and_extract_url(payload.url, force_refresh=payload.force_refresh)
        return data
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/parse-prompt")
async def parse_prompt_urls(payload: ParsePromptLinksPayload):
    urls = extract_bare_urls(payload.prompt)
    enriched_prompt, extracted = await enrich_user_prompt_with_links(payload.prompt)
    return {
        "found_urls": urls,
        "extracted_count": len(extracted),
        "items": extracted,
        "enriched_prompt": enriched_prompt
    }
