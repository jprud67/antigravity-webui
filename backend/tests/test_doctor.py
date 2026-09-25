import pytest
from httpx import ASGITransport, AsyncClient
from app.main import app
from app.services.doctor import run_system_diagnostics, run_auto_repair

@pytest.mark.asyncio
async def test_doctor_diagnostics_service():
    report = await run_system_diagnostics()
    assert "health_status" in report
    assert report["health_status"] in ("healthy", "warning", "critical")
    assert "system" in report
    assert "ram" in report["system"]
    assert "disk" in report["system"]
    assert "runtimes" in report
    assert "database" in report
    assert "llm_connectivity" in report
    assert len(report["llm_connectivity"]) == 4


@pytest.mark.asyncio
async def test_doctor_auto_repair():
    repair_res = await run_auto_repair()
    assert repair_res["success"] is True
    assert "actions_taken" in repair_res
    assert len(repair_res["actions_taken"]) >= 1
    assert "post_repair_diagnostics" in repair_res


@pytest.mark.asyncio
async def test_doctor_api():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        res = await ac.get("/api/doctor/diagnose")
        assert res.status_code == 200
        data = res.json()
        assert "health_status" in data
        assert "system" in data

        res_repair = await ac.post("/api/doctor/repair")
        assert res_repair.status_code == 200
        rep_data = res_repair.json()
        assert rep_data["success"] is True
