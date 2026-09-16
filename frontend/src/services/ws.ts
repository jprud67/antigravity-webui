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
  private currentConversationId: string | null = null;
  private pendingPayloads: any[] = [];

  // Heartbeat config
  private static readonly HEARTBEAT_INTERVAL = 5000; // 5s ping
  private static readonly HEARTBEAT_TIMEOUT = 10000;  // 10s before considering dead

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
    const url = `${protocol}//${host}/ws/chat${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[WS] Connected to Antigravity WebUI chat socket');
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
          if (!item.conversation_id && this.currentConversationId) {
            item.conversation_id = this.currentConversationId;
          }
          try {
            this.ws.send(JSON.stringify(item));
          } catch (e) {
            console.error('[WS] Failed to flush queued payload:', e);
            this.pendingPayloads.unshift(item);
            break;
          }
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
        if (event.code === 1008) {
          // Unauthorized - do not reconnect automatically
          this.pendingPayloads = [];
          return;
        }
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.setStatus('reconnecting');
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.error('[WS] Connection exception:', e);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.setStatus('reconnecting');
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }

  }

  // ─── Heartbeat ───────────────────────────────────────────────
  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
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
  }

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
    this.resetHeartbeatTimeout();
  }

  // ─── Public API ──────────────────────────────────────────────
  public reconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
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
    };

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingPayloads.push(payload);
      if (this.pendingPayloads.length > 20) {
        this.pendingPayloads.shift();
      }
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  public sendInterrupt(conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'interrupt', conversation_id: cid }));
    }
  }

  public sendClearQueue(conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'clear_queue', conversation_id: cid }));
    }
  }

  public sendApproval(decision: 'allow-once' | 'allow-session' | 'always-allow' | 'deny', rule?: string, conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'approval', decision, rule, conversation_id: cid }));
    }
  }

  public sendInput(text: string, conversationId?: string) {
    const cid = conversationId || this.currentConversationId;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'input', text, conversation_id: cid }));
    }
  }

  public clearPendingPayloads() {
    this.pendingPayloads = [];
  }
}

export const chatSocket = new ChatWebSocketClient();
