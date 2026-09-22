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

    def test_token_saver_prompt_injection(self):
        from app.services.execution_manager import inject_eco_directives
        prompt = "Fais un audit du projet"
        eco_prompt = inject_eco_directives(prompt)
        self.assertIn("CONSIGNE SYSTÈME ÉCONOMIE TOKENS", eco_prompt)
        self.assertTrue(eco_prompt.endswith(prompt))

    def test_consecutive_error_tracking(self):
        from app.services.execution_manager import should_warn_error_loop
        self.assertFalse(should_warn_error_loop(1))
        self.assertFalse(should_warn_error_loop(2))
        self.assertTrue(should_warn_error_loop(3))
        self.assertFalse(should_warn_error_loop(4))

if __name__ == "__main__":
    unittest.main()
