"""Unit tests for Database Explorer & Visual SQL Query Studio."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services.database_studio import (
    discover_databases,
    execute_query,
    export_query_results,
    inspect_database_schema,
)

client = TestClient(app)


def _create_sample_sqlite_db(path: Path) -> Path:
    conn = sqlite3.connect(str(path))
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            email TEXT,
            is_active INTEGER DEFAULT 1
        )
    """)
    cursor.execute("""
        CREATE TABLE posts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            title TEXT NOT NULL,
            content TEXT,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)
    cursor.execute("CREATE VIEW active_users_view AS SELECT id, username FROM users WHERE is_active = 1")
    
    # Insert rows
    users = [
        ("alice", "alice@example.com", 1),
        ("bob", "bob@example.com", 1),
        ("charlie", "charlie@example.com", 0),
    ]
    cursor.executemany("INSERT INTO users (username, email, is_active) VALUES (?, ?, ?)", users)
    
    posts = [
        (1, "First Post", "Hello world from Alice"),
        (1, "Second Post", "Deep learning insights"),
        (2, "Bob's Guide", "Python & SQL tips"),
    ]
    cursor.executemany("INSERT INTO posts (user_id, title, content) VALUES (?, ?, ?)", posts)
    
    conn.commit()
    conn.close()
    return path


def test_discover_databases(tmp_path: Path):
    # Create sample databases
    db1 = _create_sample_sqlite_db(tmp_path / "app.db")
    sub_dir = tmp_path / "data"
    sub_dir.mkdir()
    db2 = _create_sample_sqlite_db(sub_dir / "store.sqlite3")
    (tmp_path / "notes.txt").write_text("not a db", encoding="utf-8")

    discovered = discover_databases(str(tmp_path))
    assert len(discovered) >= 2
    paths = [d.path for d in discovered]
    assert str(db1) in paths
    assert str(db2) in paths

    app_db = next(d for d in discovered if d.path == str(db1))
    assert app_db.dialect == "sqlite"
    assert app_db.size_bytes is not None and app_db.size_bytes > 0
    assert app_db.table_count >= 2


def test_inspect_database_schema(tmp_path: Path):
    db_path = _create_sample_sqlite_db(tmp_path / "schema_test.db")
    schema = inspect_database_schema(str(db_path))

    assert schema.dialect == "sqlite"
    table_names = [t.name for t in schema.tables]
    assert "users" in table_names
    assert "posts" in table_names
    assert "active_users_view" in table_names

    users_table = next(t for t in schema.tables if t.name == "users")
    assert users_table.is_view is False
    col_names = [c.name for c in users_table.columns]
    assert "id" in col_names
    assert "username" in col_names
    assert "email" in col_names

    pk_cols = [c.name for c in users_table.columns if c.primary_key]
    assert "id" in pk_cols

    view_item = next(t for t in schema.tables if t.name == "active_users_view")
    assert view_item.is_view is True


def test_execute_query_select(tmp_path: Path):
    db_path = _create_sample_sqlite_db(tmp_path / "query_test.db")
    res = execute_query(str(db_path), "SELECT id, username, email FROM users ORDER BY id ASC")

    assert res.error is None
    assert res.columns == ["id", "username", "email"]
    assert len(res.rows) == 3
    assert res.rows[0][1] == "alice"
    assert res.execution_time_ms >= 0
    assert res.truncated is False


def test_execute_query_limit(tmp_path: Path):
    db_path = _create_sample_sqlite_db(tmp_path / "limit_test.db")
    res = execute_query(str(db_path), "SELECT * FROM users", limit=2)

    assert res.error is None
    assert len(res.rows) == 2
    assert res.truncated is True


def test_execute_query_syntax_error(tmp_path: Path):
    db_path = _create_sample_sqlite_db(tmp_path / "error_test.db")
    res = execute_query(str(db_path), "SELECT * FORM invalid_syntax")

    assert res.error is not None
    assert "syntax error" in res.error.lower() or "near" in res.error.lower()
    assert len(res.rows) == 0


def test_export_query_results_csv_and_json(tmp_path: Path):
    db_path = _create_sample_sqlite_db(tmp_path / "export_test.db")
    csv_data = export_query_results(str(db_path), "SELECT username, email FROM users WHERE id = 1", format="csv")
    assert "username,email" in csv_data
    assert "alice,alice@example.com" in csv_data

    json_data = export_query_results(str(db_path), "SELECT username, email FROM users WHERE id = 1", format="json")
    assert '"username": "alice"' in json_data


def test_api_endpoints(tmp_path: Path, auth_headers: dict):
    db_path = _create_sample_sqlite_db(tmp_path / "api_test.db")

    # Discover
    res_disc = client.get(f"/api/database/discover?workspace={tmp_path}", headers=auth_headers)
    assert res_disc.status_code == 200
    disc_items = res_disc.json()
    assert any(it["path"] == str(db_path) for it in disc_items)

    # Schema
    res_schema = client.get(f"/api/database/schema?db_path={db_path}", headers=auth_headers)
    assert res_schema.status_code == 200
    schema_data = res_schema.json()
    assert any(t["name"] == "users" for t in schema_data["tables"])

    # Query
    res_query = client.post(
        "/api/database/query",
        json={"db_path": str(db_path), "query": "SELECT COUNT(*) FROM posts", "limit": 100},
        headers=auth_headers,
    )
    assert res_query.status_code == 200
    query_data = res_query.json()
    assert query_data["error"] is None
    assert query_data["rows"][0][0] == 3

    # Export
    res_export = client.post(
        "/api/database/export",
        json={"db_path": str(db_path), "query": "SELECT username FROM users", "format": "csv"},
        headers=auth_headers,
    )
    assert res_export.status_code == 200
    assert "alice" in res_export.text


def test_security_path_traversal(auth_headers: dict):
    # Sensitive or blocked paths
    res = client.get("/api/database/schema?db_path=C:/Windows/System32/config/SAM", headers=auth_headers)
    assert res.status_code in (400, 403, 404)
