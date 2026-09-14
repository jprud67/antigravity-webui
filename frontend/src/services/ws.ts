type EventCallback = (event: any) => void;

export class ChatWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: EventCallback[] = [];
  private reconnectTimer: any = null;

  constructor() {
    // Connect if token exists or will be connected on login
    const token = localStorage.getItem('antigravity_token');
    if (token) {
      this.connect();
    }
  }

  public connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = localStorage.getItem('antigravity_token');
    const url = `${protocol}//${host}/ws/chat${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[WS] Connected to Antigravity WebUI chat socket');
      };

      this.ws.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          this.listeners.forEach((cb) => cb(data));
        } catch (err) {
          console.error('[WS] Failed to parse message:', err);
        }
      };

      this.ws.onclose = (event) => {
        console.log(`[WS] Disconnected (${event.code}).`);
        if (event.code === 1008) {
          // Unauthorized - do not reconnect automatically
          return;
        }
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.error('[WS] Connection exception:', e);
      if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), 3000);
    }
  }

  public reconnect() {
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
