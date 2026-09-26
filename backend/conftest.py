"""
Root Pytest configuration and isolation fixture for Antigravity WebUI test suite.
Ensures all tests execute in a hermetic environment without touching or polluting
the host's ~/.gemini/antigravity-cli configuration or live user data, regardless of
whether pytest runs from root, backend, or specific subdirectories.
"""
import os
import shutil
import sys
from pathlib import Path

_BACKEND_DIR = Path(__file__).resolve().parent
if str(_BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKEND_DIR))

# Setup isolated ANTIGRAVITY_DATA_DIR before any app module import
_TEST_DATA_DIR = _BACKEND_DIR / "tests" / ".test_env_data"
_TEST_DATA_DIR.mkdir(parents=True, exist_ok=True)
os.environ["ANTIGRAVITY_DATA_DIR"] = str(_TEST_DATA_DIR)
os.environ["WEBUI_PASSWORD"] = "antigravity2026"
os.environ["ANTIGRAVITY_TESTING"] = "1"

import pytest

from app.services.auth import (
    DEFAULT_PASSWORD,
    create_access_token,
    hash_password,
    save_auth_config,
)


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Session-level fixture initializing isolated auth and cleaning up afterwards."""
    config = {
        "enabled": True,
        "password": hash_password(DEFAULT_PASSWORD),
        "secret_key": "antigravity-test-secret-key-2026-isolated",
        "api_keys": []
    }
    save_auth_config(config)

    yield

    # Clean up test data directory on session completion
    try:
        shutil.rmtree(_TEST_DATA_DIR, ignore_errors=True)
    except Exception:
        pass


@pytest.fixture
def auth_headers():
    """Provides valid Bearer Authorization headers for tests."""
    token = create_access_token(expires_in_days=1)
    return {"Authorization": f"Bearer {token}"}
