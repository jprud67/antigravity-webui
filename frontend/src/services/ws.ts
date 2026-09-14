type EventCallback = (event: any) => void;

export class ChatWebSocketClient {
  private ws: WebSocket | null = null;
  private listeners: EventCallback[] = [];

  constructor() {
    this.connect();
  }

  private connect() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/ws/chat`;

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

      this.ws.onclose = () => {
        console.log('[WS] Disconnected. Reconnecting in 2s...');
        setTimeout(() => this.connect(), 2000);
      };

      this.ws.onerror = (err) => {
        console.error('[WS] Error:', err);
      };
    } catch (e) {
      console.error('[WS] Connection exception:', e);
      setTimeout(() => this.connect(), 3000);
    }
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
  }) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    const payload = {
      action: 'prompt',
      prompt: params.prompt,
      conversation_id: params.conversationId,
      workspace_path: params.workspacePath,
      model: params.model,
      effort: params.effort,
      auto_approve: params.autoApprove ?? true,
    };

    this.ws.send(JSON.stringify(payload));
  }
}

export const chatSocket = new ChatWebSocketClient();
