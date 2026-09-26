# Implementation Plan: Database Explorer & Visual SQL Query Studio

**Spec**: [`docs/superpowers/specs/2026-09-26-database-studio-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-26-database-studio-design.md)  
**Date**: 2026-09-26  
**Status**: Ready for Execution

---

## Phase 1: Backend Service & API (TDD)

### Task 1.1: Backend Tests (`backend/tests/test_database_studio.py`)
- Write tests for:
  - Database discovery in workspace (detecting `.db`, `.sqlite`, `.sqlite3`, ignoring ignored dirs).
  - Schema introspection (tables, views, columns, types, primary keys).
  - SQL execution (SELECT, execution time, row limits, error reporting on syntax errors).
  - Security checks (path traversal prevention, timeout handling).
  - CSV/JSON export.

### Task 1.2: Backend Service (`backend/app/services/database_studio.py`)
- Define Pydantic models: `DatabaseConnectionInfo`, `ColumnInfo`, `TableInfo`, `DatabaseSchema`, `QueryResult`.
- Implement `discover_databases(workspace_path)`.
- Implement `inspect_database_schema(db_path)`.
- Implement `execute_query(db_path, query, limit, timeout_seconds)`.
- Implement `export_query_results(db_path, query, format)`.

### Task 1.3: Backend Router (`backend/app/api/database_studio.py`)
- Define endpoints:
  - `GET /api/database/discover`
  - `GET /api/database/schema`
  - `POST /api/database/query`
  - `POST /api/database/export`
- Register router in `backend/app/main.py`.

### Task 1.4: Run Pytest
- Run `pytest backend/tests/test_database_studio.py` and ensure 100% pass rate.

---

## Phase 2: Frontend Client & Types

### Task 2.1: Types & API Services
- Update `frontend/src/types.ts` with database studio types.
- Add `databaseApi` methods in `frontend/src/services/api.ts`.

---

## Phase 3: Frontend Visual Studio Component

### Task 3.1: Component `DatabaseStudioModal.tsx`
- Implement:
  - Database discovery selector.
  - Left pane schema tree (tables, columns, types, double click action).
  - Monaco SQL editor with `Ctrl+Enter` execution and SQL keywords autocomplete.
  - Query stats bar (rows count, latency in ms, export CSV/JSON).
  - Interactive data grid with column sorting, responsive pagination, and null/number formatting.
  - Query history dropdown.

### Task 3.2: Integration into App & Slash Commands
- Add modal state to `App.tsx`.
- Register in `Sidebar.tsx` navigation.
- Add slash commands `/db`, `/database`, `/sql` in `ChatInput.tsx` autocompletion.

---

## Phase 4: Internationalization & Build Verification

### Task 4.1: i18n & 15-Language Sync
- Ensure all labels use `t('key', 'default')`.
- Extract keys and inject translations across all 15 languages in `frontend/public/locales.json`.
- Verify 100% parity across all 15 languages.

### Task 4.2: Full Build & Typecheck
- Run `npx tsc -b`.
- Run `npm run build`.
- Run pytest suite.
- Update `ROADMAP.md` and commit.
