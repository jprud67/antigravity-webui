type EventCallback = (event: any) => void;
type ConnectionStatusCallback = (status: 'connected' | 'disconnected' | 'reconnecting') => void;

export class ChatWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: EventCallback[] = [];
  private statusListeners: ConnectionStatusCallback[] = [];
  private reconnectTimer: any = null;
  private heartbeatTimer: any = null;
  private heartbeatTimeout: any = null;
  private _status: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private shareToken: string | null = null;
  private currentConversationId: string | null = null;
  private pendingPayloads: any[] = [];
  private reconnectAttempts: number = 0;

  // Heartbeat config
  private static readonly HEARTBEAT_INTERVAL = 5000; // 5s ping
  private static readonly HEARTBEAT_TIMEOUT = 15000;  // 15s before considering dead (resilient to heavy tool executions)

  constructor() {
    // Connect if token exists or will be connected on login
    const token = localStorage.getItem('antigravity_token');
    if (token) {
      this.connect();
    }
  }

  public get connectionStatus() {
    return this._status;
  }

  public setShareToken(token: string | null) {
    if (this.shareToken !== token) {
      this.shareToken = token;
      if (this.ws) {
        this.reconnect();
      } else if (token) {
        this.connect();
      }
    }
  }

  public setCurrentConversation(convId: string | null) {
    this.currentConversationId = convId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.sendAttach(convId);
    }
  }

  private setStatus(status: 'connected' | 'disconnected' | 'reconnecting') {
    if (this._status === status) return;
    this._status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.setStatus('reconnecting');
    const delay = Math.min(15000, Math.round(2000 * Math.pow(1.5, Math.min(this.reconnectAttempts, 8))));
    this.reconnectAttempts++;
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  public connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.setStatus('reconnecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('antigravity_token');
    const shareToken = this.shareToken;

    let protocols: string[] | undefined;
    const baseUrl = `${protocol}//${host}/ws/chat`;
    let wsUrl = baseUrl;

    if (shareToken) {
      wsUrl = `${baseUrl}?share_token=${encodeURIComponent(shareToken)}`;
    } else if (token) {
      try {
        // Safe UTF-8 to base64 encoding avoiding Latin1 DOMException
        const utf8Bytes = encodeURIComponent(token).replace(/%([0-9A-F]{2})/g, (_, p1) =>
          String.fromCharCode(parseInt(p1, 16))
        );
        const safeToken = btoa(utf8Bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        protocols = [`token.${safeToken}`];
      } catch {
        protocols = undefined;
      }
      wsUrl = `${baseUrl}?token=${encodeURIComponent(token)}`;
    }

    try {
      try {
        this.ws = protocols ? new WebSocket(baseUrl, protocols) : new WebSocket(wsUrl);
      } catch (subErr) {
        // Fallback to query param auth if subprotocol constructor rejects it
        console.warn('[WS] Subprotocol connection failed, falling back to query param auth:', subErr);
        this.ws = new WebSocket(wsUrl);
      }

      this.ws.onopen = () => {
        try {
          console.log('[WS] Connected to Antigravity WebUI chat socket');
          this.reconnectAttempts = 0;
          this.setStatus('connected');
          this.startHeartbeat();
          if (this.currentConversationId) {
            this.sendAttach(this.currentConversationId);
          }
          while (this.pendingPayloads.length > 0) {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
              break;
            }
            const item = this.pendingPayloads.shift();
            if (!item) continue;
            // Skip redundant attach payload if we already sent attach
            if (item.action === 'attach' && (item.conversation_id === this.currentConversationId || (!item.conversation_id && !this.currentConversationId))) {
              continue;
            }
            if (!item.conversation_id && this.currentConversationId) {
              item.conversation_id = this.currentConversationId;
            }
            if (item._enqueuedAt) {
              delete item._enqueuedAt;
            }
            try {
              this.ws.send(JSON.stringify(item));
            } catch (e) {
              console.error('[WS] Failed to flush queued payload:', e);
              this.pendingPayloads.unshift(item);
              if (this.pendingPayloads.length > 20) {
                this.pendingPayloads.length = 20;
              }
              break;
            }
          }
        } catch (openErr) {
          console.error('[WS] Error in onopen handler:', openErr);
        }
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          // Pong responses reset the heartbeat timeout (server is alive)
          if (data.event === 'pong') {
            this.resetHeartbeatTimeout();
            // Forward pong telemetry so the application can sync running state and active tasks
            this.listeners.forEach((cb) => cb(data));
            return;
          }
          this.listeners.forEach((cb) => cb(data));
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (${event.code}).`);
        this.stopHeartbeat();
        this.setStatus('disconnected');
        if (event.code === 1008 || event.code === 4403) {
          // Unauthorized or revoked token - do not reconnect automatically
          this.pendingPayloads = [];
          if (event.code === 4403) {
            this.listeners.forEach((cb) => cb({ event: 'share_revoked' }));
          }
          return;
        }
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.error('[WS] Connection exception:', e);
      this.scheduleReconnect();
    }

  }

  // ─── Heartbeat ───────────────────────────────────────────────
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      // Skip heartbeat when page is hidden — avoids spurious timeout reconnects
      // when the OS suspends timers (e.g. laptop sleep, background tab throttling).
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return;
      }
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ 
            action: 'ping',
            conversation_id: this.currentConversationId 
          }));
          // Set timeout — if no pong arrives, consider connection dead
          if (this.heartbeatTimeout) clearTimeout(this.heartbeatTimeout);
          this.heartbeatTimeout = setTimeout(() => {
            console.warn('[WS] Heartbeat timeout — forcing reconnect');
            this.reconnect();
          }, ChatWebSocketClient.HEARTBEAT_TIMEOUT);
        } catch {
          // Send failed, will reconnect via onclose
        }
      }
    }, ChatWebSocketClient.HEARTBEAT_INTERVAL);

    // Resume heartbeat and check connection when tab becomes visible
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
  }

  private _onVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      // Tab is visible again — reset the heartbeat timeout that may have fired while hidden
      this.resetHeartbeatTimeout();
      // Reconnect if disconnected or closing while tab was hidden
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
        this.connect();
      } else if (this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ 
            action: 'ping',
            conversation_id: this.currentConversationId 
          }));
        } catch {}
      }
    }
  };

  private resetHeartbeatTimeout() {
    if (this.heartbeatTimeout) {
      clearTimeout(this.heartbeatTimeout);
      this.heartbeatTimeout = null;
    }
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    this.resetHeartbeatTimeout();
  }

  // ─── Public API ──────────────────────────────────────────────
  public reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = 0;
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.connect();
  }

  public subscribe(cb: EventCallback) {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  public onStatusChange(cb: ConnectionStatusCallback) {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }

  public sendAttach(conversationId?: string | null) {
    const cid = conversationId !== undefined ? conversationId : this.currentConversationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'attach', conversation_id: cid ?? null }));
    }
  }

  public sendPrompt(params: {
    prompt: string;
    conversationId?: string;
    workspacePath?: string;
    model?: string;
    effort?: string;
    autoApprove?: boolean;
    mode?: 'normal' | 'queue' | 'steer';
    eco_mode?: boolean;
  }) {
    const cid = params.conversationId || this.currentConversationId;
    if (cid) {
      this.currentConversationId = cid;
    }

    const payload = {
      action: 'prompt',
      prompt: params.prompt,
      conversation_id: cid,
      workspace_path: params.workspacePath,
      model: params.model,
      effort: params.effort,
      auto_approve: params.autoApprove ?? true,
      mode: params.mode || 'normal',
      eco_mode: params.eco_mode,
    };

    this.queueOrSend(payload);
  }

  private queueOrSend(payload: any) {
    if (!payload || payload.action === 'ping' || payload.action === 'pong') {
      return;
    }

    const isDeduplicable = ['interrupt', 'clear_queue', 'attach'].includes(payload.action);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (payload.action === 'attach') {
        this.pendingPayloads = this.pendingPayloads.filter((p) => p.action !== 'attach');
      } else if (isDeduplicable) {
        this.pendingPayloads = this.pendingPayloads.filter(
          (p) => p.action !== payload.action || p.conversation_id !== payload.conversation_id
        );
      } else if (payload.action === 'prompt') {
        const now = Date.now();
        const isDuplicatePrompt = this.pendingPayloads.some(
          (p) => p.action === 'prompt' &&
                 p.conversation_id === payload.conversation_id &&
                 p.prompt === payload.prompt &&
                 p.mode === payload.mode &&
                 (now - (p._enqueuedAt || 0)) < 1000
        );
        if (isDuplicatePrompt) {
          return;
        }
        payload._enqueuedAt = now;
      }
      this.pendingPayloads.push(payload);
      if (this.pendingPayloads.length > 20) {
        this.pendingPayloads.shift();
      }
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED || this.ws.readyState === WebSocket.CLOSING) {
        this.connect();
      }
      return;
    }

    try {
      this.ws.send(JSON.stringify(payload));
    } catch (err) {
      console.error('[WS] Error sending payload, queueing for reconnect:', err);
      if (payload.action === 'attach') {
        this.pendingPayloads = this.pendingPayloads.filter((p) => p.action !== 'attach');
      } else if (isDeduplicable) {
        this.pendingPayloads = this.pendingPayloads.filter(
          (p) => p.action !== payload.action || p.conversation_id !== payload.conversation_id
        );
      } else if (payload.action === 'prompt') {
        const now = Date.now();
        const isDuplicatePrompt = this.pendingPayloads.some(
          (p) => p.action === 'prompt' &&
                 p.conversation_id === payload.conversation_id &&
                 p.prompt === payload.prompt &&
                 p.mode === payload.mode &&
                 (now - (p._enqueuedAt || 0)) < 1000
        );
        if (isDuplicatePrompt) {
          return;
        }
        payload._enqueuedAt = now;
      }
      this.pendingPayloads.push(payload);
      if (this.pendingPayloads.length > 20) {
        this.pendingPayloads.shift();
      }
    }
  }

  public sendInterrupt(conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    this.queueOrSend({ action: 'interrupt', conversation_id: cid });
  }

  public sendClearQueue(conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    this.queueOrSend({ action: 'clear_queue', conversation_id: cid });
  }

  public sendApproval(decision: 'allow-once' | 'allow-session' | 'always-allow' | 'deny', rule?: string, conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    this.queueOrSend({ action: 'approval', decision, rule, conversation_id: cid });
  }

  public sendInput(text: string, conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    this.queueOrSend({ action: 'input', text, conversation_id: cid });
  }

  public clearPendingPayloads() {
    this.pendingPayloads = [];
  }
}

export const chatSocket = new ChatWebSocketClient();
