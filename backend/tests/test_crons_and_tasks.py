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


if __name__ == "__main__":
    unittest.main()
