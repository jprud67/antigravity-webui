import base64
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.services.google_auth import (
    clear_account_exhaustion,
    get_account_meta_from_token_data,
    get_candidate_accounts,
    is_account_marked_exhausted,
    is_hard_quota_error,
    is_quota_error,
    mark_account_exhausted,
    parse_jwt_claims,
)


class TestGoogleAuthService(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.gemini_dir = Path(self.temp_dir) / "antigravity-cli"
        self.accounts_dir = self.gemini_dir / "accounts"
        self.token_file = self.gemini_dir / "antigravity-oauth-token"
        self.gemini_dir.mkdir(parents=True, exist_ok=True)
        self.accounts_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_parse_jwt_claims(self):
        claims_in = {"email": "dev@test.com", "name": "Dev User", "sub": "12345"}
        payload_bytes = json.dumps(claims_in).encode("utf-8")
        payload_b64 = base64.urlsafe_b64encode(payload_bytes).decode("utf-8").rstrip("=")
        jwt_token = f"eyJhbGciOiJub25lIn0.{payload_b64}."

        claims_out = parse_jwt_claims(jwt_token)
        self.assertEqual(claims_out.get("email"), "dev@test.com")
        self.assertEqual(claims_out.get("name"), "Dev User")
        self.assertEqual(claims_out.get("sub"), "12345")

    def test_parse_jwt_invalid(self):
        self.assertEqual(parse_jwt_claims(""), {})
        self.assertEqual(parse_jwt_claims("not-a-jwt"), {})
        self.assertEqual(parse_jwt_claims(None), {})

    def test_get_account_meta(self):
        claims = {"email": "alice@gmail.com", "sub": "sub_alice"}
        payload_b64 = base64.urlsafe_b64encode(json.dumps(claims).encode("utf-8")).decode("utf-8").rstrip("=")
        jwt_token = f"hdr.{payload_b64}."

        token_data = {
            "id_token": jwt_token,
            "token": {"expiry": "2026-10-01T12:00:00Z"},
            "auth_method": "consumer"
        }
        meta = get_account_meta_from_token_data(token_data)
        self.assertEqual(meta["email"], "alice@gmail.com")
        self.assertEqual(meta["sub"], "sub_alice")
        self.assertEqual(meta["expiry"], "2026-10-01T12:00:00Z")
        self.assertEqual(meta["auth_method"], "consumer")

    def test_quota_error_detection(self):
        self.assertTrue(is_quota_error("Resource has been exhausted (code 429)"))
        self.assertTrue(is_quota_error("Rate limit exceeded. Please try again later."))
        self.assertTrue(is_quota_error("Quota Google épuisé pour ce projet."))
        self.assertFalse(is_quota_error("SyntaxError: unexpected token"))
        self.assertFalse(is_quota_error(""))

    def test_hard_quota_error_detection(self):
        self.assertTrue(is_hard_quota_error("individual quota reached for the day"))
        self.assertTrue(is_hard_quota_error("Your quota exceeded"))
        self.assertFalse(is_hard_quota_error("connection reset by peer"))

    def test_account_exhaustion_tracking(self):
        test_email = "exhausted@test.com"
        clear_account_exhaustion(test_email)
        self.assertFalse(is_account_marked_exhausted(test_email))

        mark_account_exhausted(test_email, duration_seconds=10.0)
        self.assertTrue(is_account_marked_exhausted(test_email))

        clear_account_exhaustion(test_email)
        self.assertFalse(is_account_marked_exhausted(test_email))

    @patch("app.services.google_auth.ACCOUNTS_DIR")
    @patch("app.services.google_auth.GEMINI_DIR")
    def test_candidate_accounts(self, mock_gemini, mock_accounts):
        mock_accounts.glob = lambda pat: [
            Path("user1@gmail.com.json"),
            Path("user2@gmail.com.json"),
            Path("ignore.tmp"),
        ]
        mock_accounts.resolve = lambda: mock_accounts

        clear_account_exhaustion("user1@gmail.com")
        clear_account_exhaustion("user2@gmail.com")

        cands = get_candidate_accounts()
        self.assertIn("user1@gmail.com", cands)
        self.assertIn("user2@gmail.com", cands)
        self.assertNotIn("ignore.tmp", cands)

        # Excluding user1
        cands_ex = get_candidate_accounts(exclude_email="user1@gmail.com")
        self.assertNotIn("user1@gmail.com", cands_ex)
        self.assertIn("user2@gmail.com", cands_ex)


if __name__ == "__main__":
    unittest.main()
