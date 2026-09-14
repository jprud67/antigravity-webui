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

  private setStatus(status: 'connected' | 'disconnected' | 'reconnecting') {
    if (this._status === status) return;
    this._status = status;
    this.statusListeners.forEach((cb) => cb(status));
  }

  public connect() {
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
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          // Pong responses reset the heartbeat timeout (server is alive)
          if (data.event === 'pong') {
            this.resetHeartbeatTimeout();
            return; // Don't forward internal pong to app listeners
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
      this.setStatus('disconnected');
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
          this.ws.send(JSON.stringify({ action: 'ping' }));
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
    this.stopHeartbeat();
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
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

  public sendPrompt(params: {
    prompt: string;
    conversationId?: string;
    workspacePath?: string;
    model?: string;
    effort?: string;
    autoApprove?: boolean;
    mode?: 'normal' | 'queue' | 'steer';
  }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.connect();
      throw new Error('Connexion WebSocket en cours de rétablissement. Réessayez dans un instant.');
    }

    const payload = {
      action: 'prompt',
      prompt: params.prompt,
      conversation_id: params.conversationId,
      workspace_path: params.workspacePath,
      model: params.model,
      effort: params.effort,
      auto_approve: params.autoApprove ?? true,
      mode: params.mode || 'normal',
    };

    this.ws.send(JSON.stringify(payload));
  }

  public sendInterrupt() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'interrupt' }));
    }
  }

  public sendClearQueue() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'clear_queue' }));
    }
  }

  public sendApproval(decision: 'allow-once' | 'allow-session' | 'always-allow' | 'deny', rule?: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'approval', decision, rule }));
    }
  }
}

export const chatSocket = new ChatWebSocketClient();
