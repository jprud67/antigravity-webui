import asyncio
import logging
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

import pytest

from app.services.cron_ticker import run_job_with_failover

logging.basicConfig(level=logging.WARNING)


@pytest.mark.asyncio
async def test_cron_failover():
    print("Testing Cron Failover Logic...")
    job = {
        "id": "test_job_123",
        "name": "Test Quota",
        "prompt": "Fais moi un poème",
        "model": "gemini-3.8-flash",
        "effort": "high"
    }

    # We mock run_agy_task to always return a quota error.
    import app.services.cron_ticker as ticker
    
    original_run = ticker.run_agy_task
    
    async def mock_run(prompt, skills=None, model=None, effort=None, *args, **kwargs):
        print(f"--> [Mock] Running task with model: {model}")
        return "", "[quota] RESOURCE_EXHAUSTED", -1
        
    ticker.run_agy_task = mock_run

    # Patch switch_to_next_healthy_account to return a mock account
    import app.services.google_auth as auth
    orig_switch = auth.switch_to_next_healthy_account
    def mock_switch(exclude_email=None, model=None):
        print(f"--> [Mock] Switching account away from {exclude_email}")
        return "mocked_new_account@gmail.com"
        
    auth.switch_to_next_healthy_account = mock_switch

    try:
        res = await run_job_with_failover(job)
        assert res is not None
        assert res.get("status") == "quota_exhausted"
        assert res.get("attempts") == 5
        assert len(res.get("failovers", [])) > 0
    finally:
        ticker.run_agy_task = original_run
        auth.switch_to_next_healthy_account = orig_switch

if __name__ == "__main__":
    asyncio.run(test_cron_failover())
