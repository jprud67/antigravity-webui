# Design Specification: Collaborative Session Sharing & Live Preview

**Date:** 2026-09-26  
**Status:** Approved  
**Milestone:** Jalon v0.4 (Roadmap Antigravity-webui)  
**Author:** Antigravity AI & Lead Developer  

---

## 1. Executive Summary & Objectives

The **Collaborative Session Sharing & Live Preview** subsystem enables Antigravity WebUI users to safely share any active or completed session via direct links or secure tokens.

### Key Capabilities
1. **Configurable Permissions**:
   - **Spectator Mode (Read-Only)**: Real-time observation of agent thoughts, messages, tool calls, and progress cards without execution rights. Zero risk of unauthorized modification or token consumption.
   - **Co-Pilot Mode (Collaborative)**: Full interaction allowing invited participants to send prompts, steer the model mid-run, and approve tool executions.
2. **Access Control & Lifespan**:
   - Time-limited validity: 1 hour, 24 hours (default), 7 days, or indefinite.
   - One-click instant revocation.
   - Optional PIN code protection (4–8 characters) with constant-time cryptographic verification.
3. **Live WebSocket Presence Hub**:
   - Integrated with `/ws/chat` supporting share tokens.
   - Dynamic attendee presence tracking (`👥 X connected`) with colored participant badges.
   - Immediate disconnect on link revocation (`WebSocket close code 4403`).
4. **Live Preview & Inspection Drawer**:
   - Multi-tab inspection panel:
     - **Web & Canvas Live**: Sandboxed iframe preview for interactive HTML documents, widgets, and Canvas Studio artifacts with responsive viewport presets (Desktop, Tablet, Mobile).
     - **Modified Files**: Real-time read-only Monaco inspection of workspace files modified during the session.
     - **Artifacts & Plans**: Live rendering of generated markdown artifacts and mermaid diagrams.
5. **Full Internationalization (15 Languages)**:
   - 100% key parity across all 15 supported languages in `locales.json`.

---

## 2. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                        FastAPI Host                         │
│                                                             │
│   SQLite: shared_sessions table                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │ token | conv_id | permission | pin_hash | expires_at│   │
│   └─────────────────────────────────────────────────────┘   │
│                             ▲                               │
│                             │ verify / create / revoke      │
│                             ▼                               │
│                ┌─────────────────────────┐                  │
│                │   share_service.py      │                  │
│                └─────────────────────────┘                  │
│                             ▲                               │
│              ┌──────────────┴──────────────┐                │
│              ▼                             ▼                │
│   REST API (/api/share/*)      WebSocket (/ws/chat)         │
│   - POST /create               - Authenticates share_token  │
│   - GET /links/{conv_id}       - Enforces 'read' vs 'write' │
│   - POST /revoke/{token}       - Broadcasts presence & live │
│   - GET /verify/{token}          events                     │
│   - POST /unlock/{token}                                    │
└──────────────┬─────────────────────────────┬────────────────┘
               │                             │
               │ HTTP / JSON                 │ WS Event Stream
               ▼                             ▼
   ┌───────────────────────┐     ┌────────────────────────┐
   │ Host Browser          │     │ Spectator / Co-Pilot   │
   │ - ShareSessionModal   │     │ - Direct link /share/:t│
   │ - Presence indicator  │     │ - PIN unlock view      │
   │ - Full controls       │     │ - Live Preview Drawer  │
   └───────────────────────┘     └────────────────────────┘
```

---

## 3. Backend Implementation Details

### 3.1 SQLite Database Schema (`shared_sessions`)
Added to the persistent SQLite storage (`backend/data/conversations.db` or dedicated table):

```sql
CREATE TABLE IF NOT EXISTS shared_sessions (
    token TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    permission TEXT NOT NULL CHECK(permission IN ('read', 'write')),
    pin_hash TEXT,
    expires_at TEXT,
    created_at TEXT NOT NULL,
    created_by TEXT DEFAULT 'host',
    is_revoked INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shared_sessions_conv ON shared_sessions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_shared_sessions_token ON shared_sessions(token);
```

### 3.2 Service Layer (`backend/app/services/share_service.py`)
- `create_share_link(conversation_id: str, permission: str, duration_hours: int | None, pin_code: str | None) -> dict`:
  - Generates a 32-character URL-safe token using `secrets.token_urlsafe(24)`.
  - Calculates UTC `expires_at` timestamp if `duration_hours` is specified.
  - If `pin_code` is provided, computes SHA-256 salted hash.
  - Inserts row and returns full link metadata including `share_url`.
- `verify_share_token(token: str, pin_code: str | None = None) -> dict`:
  - Returns `{ "valid": False, "reason": "not_found" | "revoked" | "expired" | "pin_required" | "invalid_pin" }` or `{ "valid": True, "conversation_id": "...", "permission": "read" | "write" }`.
  - Uses `hmac.compare_digest` for secure timing-attack-resistant PIN comparison.
- `list_share_links(conversation_id: str) -> list[dict]`:
  - Returns all links for a given conversation with their live status (`active`, `expired`, `revoked`).
- `revoke_share_link(token: str) -> bool`:
  - Sets `is_revoked = 1` and notifies `execution_manager` to disconnect matching WebSockets immediately.

### 3.3 REST API Endpoints (`backend/app/api/share.py`)
- `POST /api/share/create` (Host Auth Required): Body: `{ conversation_id, permission, duration_hours?, pin_code? }`.
- `GET /api/share/links/{conversation_id}` (Host Auth Required): Returns active and historical links for the session.
- `POST /api/share/revoke/{token}` (Host Auth Required): Revokes the specified link.
- `GET /api/share/verify/{token}` (Public): Returns `{ valid: bool, requires_pin: bool, permission?: str, title?: str }`.
- `POST /api/share/unlock/{token}` (Public): Body: `{ pin_code: str }`. Returns signed verification token for subsequent WS handshake.
- `GET /api/share/transcript/{token}` (Public with valid token/PIN): Delivers the initial message transcript for spectator hydration.

### 3.4 WebSocket Integration & Presence Hub (`backend/app/api/chat.py` & `execution_manager.py`)
- **Handshake**:
  - Accept query parameter `share_token` or header subprotocol `token.share_<token>`.
  - Look up token in `share_service.verify_share_token(token)`.
  - If valid, accept connection and tag subscriber with `SubscriberInfo(role='spectator'|'copilot', nickname=..., avatar_color=...)`.
- **Enforcement**:
  - In `ExecutionSession.receive_message()`:
    - If `subscriber.role == 'spectator'` and message type in `['prompt', 'steer', 'approve_tool', 'cancel']`:
      - Respond immediately with `{"event": "forbidden", "message": "Action refusée : session partagée en lecture seule"}`.
- **Presence Broadcast**:
  - On subscriber join/leave:
    - Send `{"event": "presence_update", "count": N, "participants": [...]}` to all active subscribers.

---

## 4. Frontend Implementation Details

### 4.1 URL Routing & State Management
- Route patterns supported:
  - `/share/:token` or `/c/:convId?share=:token` or query param `?share=<token>`.
- Client bootstrap in `App.tsx`:
  - Checks URL for share token.
  - If found, calls `verifyShareToken(token)`.
  - If `requires_pin`, displays glassmorphic PIN modal `SharePinModal.tsx`.
  - Once verified, connects chat WebSocket with `share_token` and sets active conversation state without requiring master login.
  - Sets `isSharedSession: true` and `sharePermission: 'read' | 'write'`.

### 4.2 Share Modal (`frontend/src/components/ShareSessionModal.tsx`)
- Permission selector: Spectator (Eye icon) vs Co-Pilot (Users icon).
- Validity duration picker: 1 hour, 24 hours, 7 days, Never.
- Optional PIN toggle with masked input.
- "Generate Link" action with instant clipboard copy (`navigator.clipboard.writeText`) and toast.
- Active links list with live expiration countdown and red "Revoke" button.

### 4.3 Spectator UI & Presence Header
- Distinctive persistent top banner:
  - Spectator: `👁️ Mode Spectateur en direct · Lecture seule`
  - Co-Pilot: `🤝 Session Collaborative · Co-Pilote`
- Presence indicator in Chat header:
  - Pill badge displaying `👥 X connectés` with circular color avatar chips.
  - Hover / click popover showing current participants (Host, Co-pilot, Spectator).
- Prompt Input:
  - In Spectator mode: disabled styling with lock icon and helpful explanation.
  - In Co-Pilot mode: enabled with collaborator identifier badge.

### 4.4 Live Preview Drawer (`frontend/src/components/LivePreviewDrawer.tsx`)
- Toggled via `Eye` icon button in header or `Ctrl+Shift+P` / `/preview`.
- Tab 1: **Canvas & Web Live** (Sandboxed responsive iframe with 100% desktop / 768px tablet / 375px mobile presets).
- Tab 2: **Fichiers Modifiés** (List of session-touched files with read-only Monaco viewer).
- Tab 3: **Artefacts & Plans** (Rendered Markdown and Mermaid diagrams).

---

## 5. Security & Isolation Considerations
1. **Token Entropy**: 32-character base64url strings provide ~192 bits of entropy, immune to brute force.
2. **Timing Attack Protection**: Constant-time verification for PIN codes via `hmac.compare_digest`.
3. **Session Boundary**: A share token grants access solely to the single bound `conversation_id`. It is strictly impossible for a guest to query other conversations, system settings, or master credentials.
4. **Backend-Enforced Read-Only**: Client-side UI disables the input, but the backend rejects any socket messages from read-only subscribers, preventing client-tampering attacks.
5. **Instant WebSocket Eviction**: Revoking a token terminates all related live WebSocket connections immediately with code `4403`.

---

## 6. Testing Strategy
- **Backend (`backend/tests/test_share_session.py`)**:
  - Test link creation, expiration calculation, and PIN hashing.
  - Test verification with valid, expired, and revoked tokens.
  - Test PIN validation (correct, incorrect, locked).
  - Test WebSocket authentication with share tokens.
  - Test spectator action rejection (`forbidden` response).
  - Test co-pilot action acceptance.
  - Test presence updates on connect and disconnect.
- **Frontend**:
  - Strict TypeScript check (`tsc -b`).
  - Production bundle compilation (`npm run build`).
  - Full 15-language translation parity in `locales.json`.
