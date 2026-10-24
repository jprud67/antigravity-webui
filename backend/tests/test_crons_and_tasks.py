import os
import shutil
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from app.services.cron_store import (
    compute_next_run,
    load_jobs,
    update_jobs,
)
from app.services.cron_ticker import (
    cancel_running_job,
    get_running_job_ids,
    is_job_running,
)


class TestCronsAndTasks(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.cron_dir = Path(self.temp_dir) / "cron"
        self.cron_dir.mkdir(parents=True, exist_ok=True)
        self.jobs_file = self.cron_dir / "jobs.json"

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_compute_next_run_interval_strings(self):
        self.assertIsNotNone(compute_next_run("every 10m"))
        self.assertIsNotNone(compute_next_run("every 2 hours"))
        self.assertIsNotNone(compute_next_run("every 3 days"))
        self.assertIsNotNone(compute_next_run("every 30 seconds"))

    def test_compute_next_run_french_patterns(self):
        # Masculine plural French
        self.assertIsNotNone(compute_next_run("tous les 3 jours"))
        self.assertIsNotNone(compute_next_run("tous les 2 mois"))
        # Feminine plural French
        self.assertIsNotNone(compute_next_run("toutes les 15 minutes"))
        self.assertIsNotNone(compute_next_run("toutes les 2 heures"))
        # Daily at French
        self.assertIsNotNone(compute_next_run("tous les jours à 14h30"))
        self.assertIsNotNone(compute_next_run("chaque jour à 8h"))

    def test_compute_next_run_daily_ampm(self):
        self.assertIsNotNone(compute_next_run("daily at 9am"))
        self.assertIsNotNone(compute_next_run("daily at 2:30pm"))
        self.assertIsNotNone(compute_next_run("every day at 11pm"))
        self.assertIsNotNone(compute_next_run("every day at 12am"))

    def test_compute_next_run_hourly_at(self):
        self.assertIsNotNone(compute_next_run("hourly at 15"))
        self.assertIsNotNone(compute_next_run("hourly at :45"))
        self.assertIsNotNone(compute_next_run("chaque heure à 30"))

    def test_compute_next_run_cron_aliases(self):
        self.assertIsNotNone(compute_next_run("@hourly"))
        self.assertIsNotNone(compute_next_run("@daily"))
        self.assertIsNotNone(compute_next_run("@midnight"))
        self.assertIsNotNone(compute_next_run("@weekly"))
        self.assertIsNotNone(compute_next_run("@monthly"))
        self.assertIsNotNone(compute_next_run("@yearly"))

    def test_compute_next_run_dict_units(self):
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 10, "unit": "min"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 10, "unit": "m"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 2, "unit": "h"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 3, "unit": "d"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 30, "unit": "s"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 1, "unit": "w"}))
        self.assertIsNotNone(compute_next_run({"kind": "interval", "every": 2, "unit": "mo"}))

    def test_running_job_state_tracking(self):
        job_id = "test_run_123"
        self.assertFalse(is_job_running(job_id))
        self.assertNotIn(job_id, get_running_job_ids())

        import app.services.cron_ticker as ticker
        ticker._running_jobs.add(job_id)
        try:
            self.assertTrue(is_job_running(job_id))
            self.assertIn(job_id, get_running_job_ids())
        finally:
            ticker._running_jobs.discard(job_id)

    @patch("app.services.cron_store.JOBS_FILE")
    @patch("app.services.cron_store.CRON_DIR")
    def test_update_jobs_atomic(self, mock_dir, mock_file):
        import app.services.cron_store as cs
        orig_file = cs.JOBS_FILE
        orig_dir = cs.CRON_DIR
        cs.JOBS_FILE = self.jobs_file
        cs.CRON_DIR = self.cron_dir

        try:
            # Initialize
            def _init(data):
                data["jobs"] = [{"id": "job1", "name": "Test", "enabled": True}]
                return True
            update_jobs(_init)

            # Modify
            def _mod(data):
                data["jobs"][0]["name"] = "Updated"
                return True
            update_jobs(_mod)

            # Check
            data = load_jobs()
            self.assertEqual(len(data["jobs"]), 1)
            self.assertEqual(data["jobs"][0]["name"], "Updated")
        finally:
            cs.JOBS_FILE = orig_file
            cs.CRON_DIR = orig_dir

    def test_continuous_mode_scheduling(self):
        from app.services.cron_ticker import _recompute_job_next_run
        job = {
            "id": "job_cont_1",
            "name": "Continuous Loop",
            "continuous_mode": True,
            "enabled": True,
            "state": "scheduled"
        }
        _recompute_job_next_run(job)
        self.assertIsNotNone(job.get("next_run_at"))
        self.assertEqual(job.get("state"), "scheduled")
        # Ensure scheduled immediately (within ~10s from now)
        next_dt = datetime.fromisoformat(job["next_run_at"])
        delta = (next_dt - datetime.now(timezone.utc)).total_seconds()
        self.assertGreaterEqual(delta, 0)
        self.assertLessEqual(delta, 10)

    def test_log_pruning(self):
        from app.services.cron_ticker import prune_job_logs
        import app.services.cron_ticker as ticker

        orig_out = ticker.OUTPUT_DIR
        test_out = Path(self.temp_dir) / "output"
        test_out.mkdir(parents=True, exist_ok=True)
        ticker.OUTPUT_DIR = test_out

        try:
            job_id = "prune_test"
            # Create 25 dummy log files
            for i in range(25):
                log_file = test_out / f"{job_id}_20261024_{i:02d}0000.log"
                log_file.write_text(f"Run {i}", encoding="utf-8")
                # Set distinct mtimes
                os.utime(log_file, (1000 + i * 10, 1000 + i * 10))

            prune_job_logs(job_id, keep_latest=20)
            remaining = list(test_out.glob(f"{job_id}_*.log"))
            self.assertEqual(len(remaining), 20)
        finally:
            ticker.OUTPUT_DIR = orig_out

    def test_continuous_autonomous_loop_execution(self):
        import asyncio
        from unittest.mock import AsyncMock
        import app.services.cron_ticker as ticker
        import app.services.cron_store as cs

        orig_file = cs.JOBS_FILE
        orig_dir = cs.CRON_DIR
        orig_out = ticker.OUTPUT_DIR
        cs.JOBS_FILE = self.jobs_file
        cs.CRON_DIR = self.cron_dir
        ticker.OUTPUT_DIR = Path(self.temp_dir) / "output"
        ticker.OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        job_id = "test_loop_job"
        test_job = {
            "id": job_id,
            "name": "Autonomous Tester",
            "prompt": "Test code iteratively",
            "continuous_mode": True,
            "cycle_count": 0,
            "roadmap_summary": "",
            "enabled": True,
            "state": "scheduled"
        }

        # Initialize jobs file
        def _init(data):
            data["jobs"] = [dict(test_job)]
            return True
        update_jobs(_init)

        prompts_seen = []
        cycle_counter = [0]

        async def mock_run_job(job_dict):
            cycle_counter[0] += 1
            current_cycle = cycle_counter[0]
            prompts_seen.append(job_dict.get("prompt", ""))

            if current_cycle == 1:
                return {
                    "status": "ok",
                    "attempts": 1,
                    "failovers": [],
                    "output": "Travail cycle 1 achevé avec succès.\n[ROADMAP_UPDATE]\n- [x] Phase 1: Audit initial validé\n- [ ] Phase 2: Refactoring"
                }
            else:
                # Simuler arrêt par l'utilisateur au cycle 2
                def _pause(data):
                    for j in data.get("jobs", []):
                        if j.get("id") == job_id:
                            j["state"] = "paused"
                            j["enabled"] = False
                            return True
                    return False
                update_jobs(_pause)

                return {
                    "status": "ok",
                    "attempts": 1,
                    "failovers": [],
                    "output": "Travail cycle 2 achevé.\n[ROADMAP_UPDATE]\n- [x] Phase 2: Refactoring terminé"
                }

        async def _run_test():
            with patch("app.services.cron_ticker.run_job_with_failover", new=mock_run_job), \
                 patch("asyncio.sleep", new=AsyncMock()):
                await ticker._execute_job(test_job)

        try:
            asyncio.run(_run_test())

            self.assertEqual(cycle_counter[0], 2)
            # Cycle 1 had base prompt wrapped
            self.assertIn("[MODE CONTINU NON-STOP - CYCLE #1]", prompts_seen[0])
            # Cycle 2 received critique prompt with roadmap summary from cycle 1
            self.assertIn("[MODE CONTINU NON-STOP - CYCLE #2]", prompts_seen[1])
            self.assertIn("Phase 1: Audit initial validé", prompts_seen[1])

            # Check jobs.json state after execution
            final_data = load_jobs()
            saved_job = final_data["jobs"][0]
            self.assertEqual(saved_job["cycle_count"], 2)
            self.assertIn("Phase 2: Refactoring terminé", saved_job["roadmap_summary"])
            self.assertEqual(saved_job["state"], "paused")
        finally:
            cs.JOBS_FILE = orig_file
            cs.CRON_DIR = orig_dir
            ticker.OUTPUT_DIR = orig_out

    def test_api_crud_and_continuous_mode_lifecycle(self):
        from fastapi.testclient import TestClient
        from app.main import app
        import app.services.cron_store as cs
        from app.api.auth import require_auth

        orig_file = cs.JOBS_FILE
        orig_dir = cs.CRON_DIR
        cs.JOBS_FILE = self.jobs_file
        cs.CRON_DIR = self.cron_dir

        # Initialize clean empty jobs
        def _init(data):
            data["jobs"] = []
            return True
        update_jobs(_init)

        app.dependency_overrides[require_auth] = lambda: True
        client = TestClient(app)

        try:
            # 1. Create a continuous cron job
            create_payload = {
                "name": "Integration Test Job",
                "prompt": "Run integration tests",
                "schedule": "*/15 * * * *",
                "continuous_mode": True
            }
            res = client.post("/api/crons", json=create_payload)
            self.assertEqual(res.status_code, 200)
            created_job = res.json()["job"]
            job_id = created_job["id"]
            self.assertTrue(created_job["continuous_mode"])
            self.assertEqual(created_job["cycle_count"], 0)
            self.assertEqual(created_job["state"], "scheduled")

            # 2. Get list of cron jobs
            list_res = client.get("/api/crons")
            self.assertEqual(list_res.status_code, 200)
            jobs = list_res.json()["jobs"]
            matching = [j for j in jobs if j["id"] == job_id]
            self.assertEqual(len(matching), 1)
            self.assertTrue(matching[0]["continuous_mode"])
            self.assertFalse(matching[0]["is_running"])

            # 3. Update job: toggle continuous_mode to False
            patch_res = client.patch(f"/api/crons/{job_id}", json={"continuous_mode": False, "name": "Renamed Job"})
            self.assertEqual(patch_res.status_code, 200)
            updated_job = patch_res.json()["job"]
            self.assertFalse(updated_job["continuous_mode"])
            self.assertEqual(updated_job["name"], "Renamed Job")

            # 4. Trigger job immediately
            run_res = client.post(f"/api/crons/{job_id}/run")
            self.assertEqual(run_res.status_code, 200)
            self.assertEqual(run_res.json()["job"]["last_status"], "triggered")

            # 5. Stop job
            stop_res = client.post(f"/api/crons/{job_id}/stop")
            self.assertEqual(stop_res.status_code, 200)
            self.assertTrue(stop_res.json()["success"])
            self.assertEqual(stop_res.json()["job"]["state"], "paused")
            self.assertIsNone(stop_res.json()["job"]["next_run_at"])

            # 6. Delete job
            del_res = client.delete(f"/api/crons/{job_id}")
            self.assertEqual(del_res.status_code, 200)
            self.assertTrue(del_res.json()["success"])

            # Verify gone
            post_del = client.get("/api/crons")
            self.assertEqual(len([j for j in post_del.json()["jobs"] if j["id"] == job_id]), 0)

        finally:
            app.dependency_overrides.pop(require_auth, None)
            cs.JOBS_FILE = orig_file
            cs.CRON_DIR = orig_dir


if __name__ == "__main__":
    unittest.main()
