# Collaborative Session Sharing & Live Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement full collaborative session sharing by direct links/tokens, WebSocket real-time presence hub, spectator/co-pilot permission enforcement, and an interactive Live Preview & Inspection drawer.

**Architecture:** A dedicated SQLite table `shared_sessions` and `share_service.py` manage time-limited tokens with optional PIN protection and instant revocation. The existing `ExecutionSession` and `/ws/chat` endpoint are extended to authenticate share tokens, enforce read-only execution for spectators, and broadcast live presence (`presence_update`). The frontend integrates a `ShareSessionModal`, `SharePinModal`, presence counter badge, spectator banners, and a sandboxed `LivePreviewDrawer` with responsive presets.

**Tech Stack:** FastAPI, Python 3.13, SQLite, WebSockets, React 19, TypeScript, Monaco Editor, Tailwind CSS / Vanilla CSS, Vite.

**Spec:** [`docs/superpowers/specs/2026-09-26-collaborative-session-sharing-design.md`](file:///c:/laragon/www/antigravity-webui/docs/superpowers/specs/2026-09-26-collaborative-session-sharing-design.md)

## Global Constraints
- Python 3.13+ compatibility.
- Zero external Python dependencies for crypto (use built-in `secrets`, `hashlib`, `hmac`).
- Constant-time PIN verification using `hmac.compare_digest`.
- Strict read-only enforcement in the backend WebSocket loop (not only in client UI).
- 100% i18n key parity across all 15 languages in `frontend/public/locales.json`.
- Strict TypeScript (`tsc -b`) with no unused variables (`--noUnusedLocals`).
- Do not break existing chat, terminal, or docker WebSocket workflows.

---

### Task 1: Backend SQLite Persistence & `share_service.py`

**Files:**
- Create: `backend/app/services/share_service.py`
- Test: `backend/tests/test_share_session.py`

**Interfaces:**
- Produces:
  - `create_share_link(conversation_id: str, permission: str, duration_hours: int | None = None, pin_code: str | None = None) -> dict[str, Any]`
  - `verify_share_token(token: str, pin_code: str | None = None) -> dict[str, Any]`
  - `list_share_links(conversation_id: str) -> list[dict[str, Any]]`
  - `revoke_share_link(token: str) -> bool`
  - `get_shared_session_info(token: str) -> dict[str, Any] | None`

- [ ] **Step 1: Write the failing tests for `share_service`**

Create `backend/tests/test_share_session.py` testing:
1. Creation of share link with expiration and PIN hashing.
2. Verification of active share link (valid token).
3. Verification failure when token is expired or revoked.
4. Verification with correct PIN vs wrong PIN.
5. Listing links for a conversation and revoking a link.

```python
import pytest
from datetime import datetime, timezone, timedelta
from app.services import share_service

def test_create_and_verify_share_link():
    link = share_service.create_share_link("conv_test_123", permission="read", duration_hours=24)
    assert "token" in link
    assert link["permission"] == "read"
    assert link["conversation_id"] == "conv_test_123"
    
    # Verify without PIN
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is True
    assert res["conversation_id"] == "conv_test_123"
    assert res["permission"] == "read"

def test_pin_protection():
    link = share_service.create_share_link("conv_test_pin", permission="write", pin_code="1234")
    # Verify without pin should report requires_pin
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is False
    assert res["requires_pin"] is True
    
    # Verify with wrong pin
    res_wrong = share_service.verify_share_token(link["token"], pin_code="9999")
    assert res_wrong["valid"] is False
    assert res_wrong.get("reason") == "invalid_pin"
    
    # Verify with correct pin
    res_correct = share_service.verify_share_token(link["token"], pin_code="1234")
    assert res_correct["valid"] is True
    assert res_correct["permission"] == "write"

def test_revocation():
    link = share_service.create_share_link("conv_test_revoke", permission="read")
    revoked = share_service.revoke_share_link(link["token"])
    assert revoked is True
    
    res = share_service.verify_share_token(link["token"])
    assert res["valid"] is False
    assert res.get("reason") == "revoked"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_share_session.py -v`
Expected: FAIL (ModuleNotFoundError: No module named 'app.services.share_service')

- [ ] **Step 3: Implement `backend/app/services/share_service.py`**

Implement database table auto-initialization, cryptographic token generation (`secrets.token_urlsafe(24)`), salted SHA-256 PIN hashing, constant-time verification with `hmac.compare_digest`, expiration calculation via UTC ISO timestamps, and SQLite CRUD queries.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_share_session.py -v`
Expected: PASS (all tests passing)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/share_service.py backend/tests/test_share_session.py
git commit -m "feat(share): implement SQLite shared_sessions persistence and share_service"
```

---

### Task 2: Backend REST Endpoints (`/api/share/*`)

**Files:**
- Create: `backend/app/api/share.py`
- Modify: `backend/app/main.py:50-130`
- Test: `backend/tests/test_share_session.py`

**Interfaces:**
- Endpoints:
  - `POST /api/share/create` (auth required): `ShareCreateRequest` -> `ShareLinkResponse`
  - `GET /api/share/links/{conversation_id}` (auth required) -> `list[ShareLinkResponse]`
  - `POST /api/share/revoke/{token}` (auth required) -> `{"success": bool}`
  - `GET /api/share/verify/{token}` (public) -> `{"valid": bool, "requires_pin": bool, "permission"?: str, "conversation_id"?: str, "title"?: str}`
  - `POST /api/share/unlock/{token}` (public): `{"pin_code": str}` -> `{"valid": bool, "token": str, "permission": str}`
  - `GET /api/share/transcript/{token}` (public, requires valid token or unlocked token) -> conversation transcript data

- [ ] **Step 1: Write tests for `/api/share/*` endpoints in `test_share_session.py`**

Test HTTP responses using `starlette.testclient.TestClient`:
- Create share link returns 200 with token and permission.
- List links for session returns array.
- Public verify endpoint indicates if PIN is required.
- Unlock with PIN succeeds.
- Revoke endpoint invalidates access.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_share_session.py -k "test_api_" -v`
Expected: FAIL with 404 Not Found.

- [ ] **Step 3: Implement `backend/app/api/share.py` and register in `main.py`**

Create Pydantic models:
- `ShareCreateRequest(conversation_id: str, permission: Literal['read', 'write'], duration_hours: int | None = None, pin_code: str | None = None)`
- `ShareUnlockRequest(pin_code: str)`
Implement endpoints with proper error codes (400, 401, 403, 404) and register router in `backend/app/main.py` under prefix `/api/share`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_share_session.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/api/share.py backend/app/main.py backend/tests/test_share_session.py
git commit -m "feat(share): implement REST API endpoints for session sharing and PIN unlock"
```

---

### Task 3: WebSocket Authentication, Role Enforcement & Presence Hub

**Files:**
- Modify: `backend/app/services/execution_manager.py:65-200`
- Modify: `backend/app/api/chat.py:15-120`
- Test: `backend/tests/test_share_session.py`

**Interfaces:**
- Produces:
  - `ExecutionSession.add_subscriber(ws, client_id, role, nickname, avatar_color)`
  - `ExecutionSession.remove_subscriber(ws)`
  - `ExecutionSession.broadcast_presence()`
  - Read-only action blocking for `role == 'spectator'`
  - Eviction of sockets when `share_service.revoke_share_link(token)` is called (code `4403`)

- [ ] **Step 1: Write tests for WebSocket share token auth & read-only enforcement**

Add tests to `test_share_session.py`:
- Connect to `/ws/chat?share_token=<token>` with spectator token.
- Verify that spectator receives `presence_update` event.
- Send prompt payload from spectator socket and assert response is `{"event": "forbidden", ...}`.
- Connect with co-pilot token and verify action is accepted.

- [ ] **Step 2: Run test to verify failure**

Run: `pytest tests/test_share_session.py -k "test_ws_" -v`
Expected: FAIL (connection rejected or actions not blocked)

- [ ] **Step 3: Update `ExecutionSession` and `chat_websocket`**

1. In `execution_manager.py`:
   - Define `SubscriberInfo(ws, client_id, role, nickname, avatar_color, joined_at)`.
   - Update `self.subscribers` to store `dict[WebSocket, SubscriberInfo]`.
   - Add `broadcast_presence()` sending:
     ```json
     {
       "event": "presence_update",
       "count": len(self.subscribers),
       "participants": [...]
     }
     ```
   - Add `disconnect_token(token)` to close sockets attached to a revoked token with code `4403`.
2. In `chat.py`:
   - Check `websocket.query_params.get("share_token")`.
   - If present, validate with `share_service.verify_share_token`.
   - Assign appropriate role (`'spectator'` or `'copilot'`) and random pleasant nickname/color.
   - Guard incoming actions: if `subscriber.role == 'spectator'` and message type is in `('prompt', 'steer', 'approve_tool', 'cancel')`, send `{"event": "forbidden", "message": "..."}` and skip execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_share_session.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/execution_manager.py backend/app/api/chat.py backend/tests/test_share_session.py
git commit -m "feat(share): integrate WebSocket share token auth, spectator role enforcement, and presence hub"
```

---

### Task 4: Frontend Types, API Client & Navigation Updates

**Files:**
- Modify: `frontend/src/types/index.ts`
- Modify: `frontend/src/services/api.ts`
- Modify: `frontend/src/utils/navigation.ts`

**Interfaces:**
- Produces:
  - TypeScript types: `ShareLinkItem`, `ShareLinkCreatePayload`, `ShareVerificationResult`, `PresenceParticipant`, `PresenceUpdateEvent`
  - API functions: `createShareLink`, `fetchShareLinks`, `revokeShareLink`, `verifyShareToken`, `unlockShareToken`, `fetchSharedTranscript`
  - URL helper: `getShareTokenFromUrl() -> string | null`

- [ ] **Step 1: Add types to `frontend/src/types/index.ts`**

Define types for share links, creation payloads, verification results, participant presence, and WebSocket presence updates.

- [ ] **Step 2: Add API functions to `frontend/src/services/api.ts`**

Implement HTTP wrappers calling `/api/share/*` endpoints.

- [ ] **Step 3: Update `frontend/src/utils/navigation.ts`**

Add `getShareTokenFromUrl()` extracting share token from `/share/:token`, `/c/:id?share=:token`, or `?share=:token`.

- [ ] **Step 4: Validate types with `tsc -b`**

Run: `cd frontend && npm run build` (or `npx tsc -b`)
Expected: PASS with 0 errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/api.ts frontend/src/utils/navigation.ts
git commit -m "feat(share): add frontend TypeScript types, API methods, and share URL resolver"
```

---

### Task 5: Full 15-Language i18n Key Parity

**Files:**
- Modify: `frontend/public/locales.json`

**Interfaces:**
- Produces:
  - Complete translations for 24 new `share_*` keys across all 15 languages:
    - `share_session`, `share_modal_title`, `share_modal_desc`, `share_mode_spectator`, `share_mode_spectator_desc`, `share_mode_copilot`, `share_mode_copilot_desc`, `share_duration_label`, `share_duration_1h`, `share_duration_24h`, `share_duration_7d`, `share_duration_forever`, `share_pin_protect`, `share_pin_placeholder`, `share_generate_link`, `share_link_copied`, `share_active_links`, `share_revoke`, `share_revoked_toast`, `share_spectator_banner`, `share_copilot_banner`, `share_presence_connected`, `share_pin_required_title`, `share_pin_submit`, `share_live_preview`, `share_preview_tab_web`, `share_preview_tab_files`, `share_preview_tab_artifacts`

- [ ] **Step 1: Write script to inject keys with exact translations into `frontend/public/locales.json`**

Ensure 100% key parity across all 15 languages (en, fr, es, de, it, pt, ja, ko, zh, ru, ar, hi, tr, pl, nl).

- [ ] **Step 2: Run script and verify key count parity**

Run script to verify all 15 languages have identical key counts.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/locales.json
git commit -m "feat(i18n): add 15-language parity for collaborative session sharing and live preview"
```

---

### Task 6: Share Modal & PIN Unlock Components (`ShareSessionModal.tsx` & `SharePinModal.tsx`)

**Files:**
- Create: `frontend/src/components/ShareSessionModal.tsx`
- Create: `frontend/src/components/SharePinModal.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - `<ShareSessionModal isOpen={...} onClose={...} conversationId={...} />`
  - `<SharePinModal isOpen={...} token={...} onUnlocked={...} />`
  - Chat header Share button (`Share2` icon) opening modal
  - Slash command `/share` handler

- [ ] **Step 1: Implement `frontend/src/components/ShareSessionModal.tsx`**

Include:
- Mode toggle: Spectator vs Co-Pilot.
- Expiration selector: 1h, 24h, 7d, Forever.
- Optional PIN toggle and input.
- Generate link button with instant copy to clipboard (`navigator.clipboard.writeText`) and toast.
- Active links table with time-remaining countdown and instant revoke button.

- [ ] **Step 2: Implement `frontend/src/components/SharePinModal.tsx`**

Glassmorphic card prompting for the PIN code when visiting a protected share link. On submission, calls `unlockShareToken(token, pin)` and triggers session load.

- [ ] **Step 3: Integrate into `frontend/src/App.tsx`**

- Add state `isShareModalOpen`.
- Add Share button in `ChatCanvas` header.
- Intercept URL share tokens on bootstrap and load the shared session.
- Handle slash commands `/share` and `/collaborate`.

- [ ] **Step 4: Verify with `npm run build`**

Run: `cd frontend && npm run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ShareSessionModal.tsx frontend/src/components/SharePinModal.tsx frontend/src/App.tsx
git commit -m "feat(share): implement ShareSessionModal, SharePinModal, and header share integration"
```

---

### Task 7: Live Preview Drawer (`LivePreviewDrawer.tsx`), Spectator Banner & Presence Badge

**Files:**
- Create: `frontend/src/components/LivePreviewDrawer.tsx`
- Modify: `frontend/src/components/ChatCanvas.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Produces:
  - `<LivePreviewDrawer isOpen={...} onClose={...} activeConversationId={...} />`
  - Presence badge in header (`👥 X connectés`) with hover/click attendee popover
  - Persistent spectator banner: `👁️ Mode Spectateur en direct · Lecture seule`
  - Disabled prompt bar in spectator mode with lock icon

- [ ] **Step 1: Implement `frontend/src/components/LivePreviewDrawer.tsx`**

Includes 3 tabs:
1. **Canvas & Web Live**: Sandboxed iframe with responsive resolution presets (Desktop 100%, Tablet 768px, Mobile 375px), reload button, and open in new tab.
2. **Fichiers Modifiés**: Session-touched files list with read-only Monaco editor syntax highlighting.
3. **Artefacts & Plans**: Rendered Markdown and Mermaid diagrams.

- [ ] **Step 2: Update ChatCanvas & App header with Spectator Banner & Presence Badge**

- If `isSharedSession` is true and `sharePermission === 'read'`:
  - Show top sticky banner: `👁️ Mode Spectateur en direct · Lecture seule`.
  - Disable prompt input and display informative lock message.
- If `sharePermission === 'write'`:
  - Show top sticky banner: `🤝 Session Collaborative · Co-Pilote`.
- In header:
  - Show presence badge with connected count and participant avatars.
  - Add Live Preview toggle button (`Eye` icon) or `Ctrl+Shift+P` shortcut.

- [ ] **Step 3: Verify with `npm run build`**

Run: `cd frontend && npm run build`
Expected: PASS with 0 errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/LivePreviewDrawer.tsx frontend/src/components/ChatCanvas.tsx frontend/src/App.tsx
git commit -m "feat(preview): implement LivePreviewDrawer, presence indicator, and spectator mode banners"
```

---

### Task 8: End-to-End Verification, Version Bump & Release Preparation

**Files:**
- Modify: `backend/app/main.py:35`
- Modify: `backend/app/services/updater.py:30`
- Modify: `frontend/package.json:3`
- Modify: `frontend/public/sw.js:2`
- Modify: `docs/ROADMAP.md`

- [ ] **Step 1: Run full backend test suite**

Run: `pytest -v` in `backend`
Expected: All tests pass (including new `test_share_session.py`).

- [ ] **Step 2: Run frontend production build**

Run: `npm run build` in `frontend`
Expected: Clean build in < 15s.

- [ ] **Step 3: Bump semantic version to `0.4.0`**

Update version string in:
- `backend/app/main.py`
- `backend/app/services/updater.py`
- `frontend/package.json`
- `frontend/public/sw.js`
- `docs/ROADMAP.md` (mark milestone completed)

- [ ] **Step 4: Commit release**

```bash
git add backend/app/main.py backend/app/services/updater.py frontend/package.json frontend/public/sw.js docs/ROADMAP.md
git commit -m "feat(release): Release v0.4.0 - Collaborative Session Sharing, Live Preview & WebSocket Presence Hub"
```
