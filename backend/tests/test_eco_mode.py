import unittest
from app.services.storage import get_settings, save_settings

class TestEcoModeStorage(unittest.TestCase):
    def test_default_eco_mode(self):
        settings = get_settings()
        self.assertIn("ecoMode", settings)
        self.assertIsInstance(settings["ecoMode"], bool)

    def test_toggle_eco_mode(self):
        current = get_settings().get("ecoMode", False)
        updated = save_settings({"ecoMode": not current})
        self.assertEqual(updated.get("ecoMode"), not current)
        # Restore
        save_settings({"ecoMode": current})

if __name__ == "__main__":
    unittest.main()
