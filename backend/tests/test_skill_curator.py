import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient

from app.main import app
from app.services.skill_curator import SkillCurator, STATE_ACTIVE, STATE_STALE, STATE_ARCHIVED

client = TestClient(app)


def test_skill_curator_lifecycle():
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir)
        curator = SkillCurator(skills_dir=tmp_path)

        # 1. Record skill usage
        rec = curator.record_skill_usage("test-skill-1")
        assert rec["use_count"] == 1
        assert rec["status"] == STATE_ACTIVE
        assert rec["pinned"] is False

        # 2. Re-record usage
        rec2 = curator.record_skill_usage("test-skill-1")
        assert rec2["use_count"] == 2

        # 3. Toggle pin
        pin_res = curator.toggle_pin("test-skill-1")
        assert pin_res["pinned"] is True
        assert curator.get_skill_telemetry("test-skill-1")["pinned"] is True

        # 4. Check ledger
        ledger = curator.get_ledger()
        assert len(ledger) >= 2  # record and pin events
        assert ledger[0]["skill_name"] == "test-skill-1"

        # 5. Lifecycle sweep (pinned skill shouldn't change)
        sweep_res = curator.sweep_lifecycle(stale_days=0, archive_days=0)
        assert sweep_res["transitions_count"] == 0
        assert curator.get_skill_telemetry("test-skill-1")["status"] == STATE_ACTIVE

        # 6. Unpin and simulate old date
        curator.toggle_pin("test-skill-1", pinned=False)
        old_data = curator._load_usage()
        old_data["test-skill-1"]["last_used_at"] = (datetime.now(timezone.utc) - timedelta(days=20)).isoformat()
        curator._save_usage(old_data)

        # Sweep with stale=14, archive=30 -> should transition to stale
        sweep_stale = curator.sweep_lifecycle(stale_days=14, archive_days=30)
        assert sweep_stale["transitions_count"] == 1
        assert curator.get_skill_telemetry("test-skill-1")["status"] == STATE_STALE

        # Now simulate unused for 40 days -> should transition to archived
        old_data["test-skill-1"]["last_used_at"] = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
        curator._save_usage(old_data)
        sweep_archive = curator.sweep_lifecycle(stale_days=14, archive_days=30)
        assert sweep_archive["transitions_count"] == 1
        assert curator.get_skill_telemetry("test-skill-1")["status"] == STATE_ARCHIVED

        # Re-use should reactivate to active
        curator.record_skill_usage("test-skill-1")
        assert curator.get_skill_telemetry("test-skill-1")["status"] == STATE_ACTIVE


def get_auth_headers():
    login_res = client.post("/api/auth/login", json={"password": "antigravity2026"})
    token = login_res.json().get("token")
    return {"Authorization": f"Bearer {token}"} if token else {}


def test_skill_curator_api():
    headers = get_auth_headers()
    # Test GET /api/skills/curator/status
    resp = client.get("/api/skills/curator/status", headers=headers)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)

    # Test POST /api/skills/{skill_id}/pin
    resp_pin = client.post("/api/skills/brainstorming/pin", json={"pinned": True}, headers=headers)
    assert resp_pin.status_code == 200
    assert resp_pin.json()["pinned"] is True

    # Test POST /api/skills/curator/sweep
    resp_sweep = client.post("/api/skills/curator/sweep", params={"stale_days": 14, "archive_days": 30}, headers=headers)
    assert resp_sweep.status_code == 200
    assert resp_sweep.json()["success"] is True

    # Test GET /api/skills/curator/ledger
    resp_ledger = client.get("/api/skills/curator/ledger", headers=headers)
    assert resp_ledger.status_code == 200
    assert isinstance(resp_ledger.json(), list)
