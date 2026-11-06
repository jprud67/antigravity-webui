"""Tests for session title auto-generation, prompt cleaning, and title reconciliation."""
import sqlite3
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from app.services.storage import (
    clean_user_prompt,
    derive_session_title,
    reconcile_missing_titles,
    update_conversation_title_if_unset,
)


def test_clean_user_prompt_strips_eco_and_continuous_memory():
    raw_prompt = (
        "[CONSIGNE SYSTÈME ÉCONOMIE TOKENS : 1) Commandes terminal : silencieux. 2) Fichiers : edit_file. 3) Réponses concises.]\n\n"
        "## CONTINUOUS AGENT MEMORY\n"
        "### USER PROFILE (Preferences, Style & Identity)\n"
        "- jprud67 dev PHP/Symfony, FR natif.\n\n\n"
        "pourquoi dans antigravity-webui quand une Nouvelle session est créée ça garde juste le nom 'Nouvelle session' ?"
    )
    cleaned = clean_user_prompt(raw_prompt)
    assert "CONSIGNE SYSTÈME" not in cleaned
    assert "CONTINUOUS AGENT MEMORY" not in cleaned
    assert "USER PROFILE" not in cleaned
    assert "pourquoi dans antigravity-webui quand une Nouvelle session" in cleaned


def test_clean_user_prompt_handles_user_request_xml_wrapper():
    xml_blob = (
        "<USER_REQUEST>\n"
        "[CONSIGNE SYSTÈME ÉCONOMIE TOKENS : silencieux]\n\n"
        "## CONTINUOUS AGENT MEMORY\n- profile\n\n\n"
        "Correction du bug d'affichage de la modal\n"
        "</USER_REQUEST>\n"
        "<ADDITIONAL_METADATA>\ntime: 2026-11-06\n</ADDITIONAL_METADATA>"
    )
    cleaned = clean_user_prompt(xml_blob)
    assert cleaned == "Correction du bug d'affichage de la modal"


def test_derive_session_title_regular_question():
    prompt = "pourquoi dans antigravity-webui quand une Nouvelle session est créée ça garde juste le nom 'Nouvelle session'? analyse et corrige ce problème"
    title = derive_session_title(prompt, max_length=55)
    assert title.startswith("Pourquoi dans antigravity-webui quand une Nouvelle")
    assert not title.startswith("pourquoi")  # Capitalized


def test_derive_session_title_autonomous_cycle():
    cycle_prompt = (
        "[MODE CONTINU NON-STOP - CYCLE #127]\n"
        "--- BILAN & AUTO-CRITIQUE DU CYCLE PRÉCÉDENT ---\n"
        "- [x] Tâche 1\n"
        "--- MISSION PRINCIPALE ---\n"
        "[CONSIGNE SYSTÈME ÉCONOMIE TOKENS : silencieux] Continuer l audit de sécurité et durcissement des imports"
    )
    title = derive_session_title(cycle_prompt)
    assert title.startswith("Cycle #127 — Audit de sécurité")


def test_derive_session_title_fallback_on_empty():
    assert derive_session_title("") == "Nouvelle session"
    assert derive_session_title(None) == "Nouvelle session"
    assert derive_session_title("   \n\t  ") == "Nouvelle session"


def test_update_conversation_title_if_unset():
    with tempfile.NamedTemporaryFile(suffix=".db") as tf:
        db_path = Path(tf.name)
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("""
                CREATE TABLE conversation_summaries (
                    conversation_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    preview TEXT NOT NULL DEFAULT '',
                    last_modified_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title) VALUES ('c1', '')")
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title) VALUES ('c2', 'Nouvelle session')")
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title) VALUES ('c3', 'Titre Personnalisé Existant')")
            conn.commit()

        with patch("app.services.storage.CONVERSATION_DB", db_path), \
             patch("app.services.storage.get_db_connection", lambda: sqlite3.connect(str(db_path))), \
             patch("app.services.storage.get_session_meta", lambda cid: {}), \
             patch("app.services.storage._notify_conversations_changed"):

            assert update_conversation_title_if_unset("c1", "Premier Titre Dérivé") is True
            assert update_conversation_title_if_unset("c2", "Deuxième Titre Dérivé") is True
            # c3 already has custom title, must NOT be updated
            assert update_conversation_title_if_unset("c3", "Tentative Écrasement") is False

            with sqlite3.connect(str(db_path)) as conn:
                r1 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='c1'").fetchone()[0]
                r2 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='c2'").fetchone()[0]
                r3 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='c3'").fetchone()[0]

            assert r1 == "Premier Titre Dérivé"
            assert r2 == "Deuxième Titre Dérivé"
            assert r3 == "Titre Personnalisé Existant"


def test_reconcile_missing_titles():
    with tempfile.NamedTemporaryFile(suffix=".db") as tf, tempfile.TemporaryDirectory() as td:
        db_path = Path(tf.name)
        brain_path = Path(td)
        with sqlite3.connect(str(db_path)) as conn:
            conn.execute("""
                CREATE TABLE conversation_summaries (
                    conversation_id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    preview TEXT NOT NULL DEFAULT '',
                    last_modified_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title, preview) VALUES ('s1', '', 'Ajout de la page Profil utilisateur')")
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title, preview) VALUES ('s2', 'Nouvelle session', 'Refactoring contrôleur d authentification JWT')")
            conn.execute("INSERT INTO conversation_summaries (conversation_id, title, preview) VALUES ('s3', 'Titre Fixé', 'Ignorer ce preview')")
            conn.commit()

        with patch("app.services.storage.CONVERSATION_DB", db_path), \
             patch("app.services.storage.BRAIN_DIR", brain_path), \
             patch("app.services.storage.get_db_connection", lambda: sqlite3.connect(str(db_path))), \
             patch("app.services.storage.get_all_session_metadata", lambda: {}), \
             patch("app.services.storage._notify_conversations_changed"):

            reconciled_count = reconcile_missing_titles(limit=10)
            assert reconciled_count == 2

            with sqlite3.connect(str(db_path)) as conn:
                r1 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='s1'").fetchone()[0]
                r2 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='s2'").fetchone()[0]
                r3 = conn.execute("SELECT title FROM conversation_summaries WHERE conversation_id='s3'").fetchone()[0]

            assert "Profil utilisateur" in r1
            assert "authentification" in r2
            assert r3 == "Titre Fixé"


def test_derive_session_title_autonomous_cycle_from_roadmap_task():
    raw = (
        "[MODE CONTINU NON-STOP - CYCLE #127]\n"
        "--- BILAN & AUTO-CRITIQUE DU CYCLE PRÉCÉDENT ---\n"
        "- **Tâches en cours (Cycle #129)** :\n"
        "  - [ ] PRIORITÉ 1 / FIX CI ACTIONS : Synchroniser composer.lock avec COMPOSER_ALLOW_SUPERUSER=1 composer update --lock --no-install\n"
        "--- CONSIGNES DU CYCLE AUTONOME ---\n"
        "1. Analyse les résultats...\n"
    )
    title = derive_session_title(raw, workspace="/root/jambo-api")
    assert title.startswith("Cycle #127 — ")
    assert "Synchroniser composer.lock" in title
    # Do not cut inside filename composer.lock
    assert "composer" in title and "lock" in title


def test_api_regenerate_title_endpoint():
    from fastapi.testclient import TestClient
    from app.main import app
    from app.api.auth import require_auth

    # Override auth dependency for unit test
    app.dependency_overrides[require_auth] = lambda: {"authenticated": True, "role": "admin"}
    try:
        client = TestClient(app)
        fake_cid = "12345678-1234-5678-1234-567812345678"
        with patch("app.api.conversations.get_conversation_transcript", return_value=[
            {"type": "USER_INPUT", "content": "Ajout de la page Profil utilisateur"}
        ]), patch("app.api.conversations.update_conversation_title", return_value=True):
            res = client.post(f"/api/conversations/{fake_cid}/regenerate-title")
            assert res.status_code == 200
            data = res.json()
            assert data["success"] is True
            assert data["conversation_id"] == fake_cid
            assert "Profil utilisateur" in data["title"]
    finally:
        app.dependency_overrides.pop(require_auth, None)
