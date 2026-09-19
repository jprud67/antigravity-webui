/**
 * SSE (Server-Sent Events) client for real-time CLI ↔ WebUI synchronization.
 *
 * Connects to GET /api/events/stream and dispatches:
 *  - "conversations_updated" → refresh sidebar conversation list
 *  - "transcript_updated"    → refresh messages if active conversation matches
 */

type SyncEventType = 'conversations_updated' | 'transcript_updated' | 'artifacts_updated' | 'ping';

interface SyncEvent {
  type: SyncEventType;
  conversation_id?: string;
  filename?: string;
  ts?: number;
}

type SyncCallback = (event: SyncEvent) => void;

class SyncSSEClient {
  private es: EventSource | null = null;
  private listeners: SyncCallback[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 2000;
  private maxReconnectDelay = 30000;
  private hasConnectedOnce = false;

  constructor() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          if (!this.es || this.es.readyState === EventSource.CLOSED) {
            this.reconnect();
          }
        }
      });
    }
  }

  connect() {
    if (this.es && (this.es.readyState === EventSource.OPEN || this.es.readyState === EventSource.CONNECTING)) {
      return;
    }

    const token = localStorage.getItem('antigravity_token');
    const url = `/api/events/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;

    this.es = new EventSource(url);

    this.es.onopen = () => {
      console.log('[SSE] Connected to sync stream');
      if (this.hasConnectedOnce) {
        // Reconnected after drop: notify listeners to immediately refresh conversations
        this.listeners.forEach(cb => cb({ type: 'conversations_updated' }));
      }
      this.hasConnectedOnce = true;
      this.reconnectDelay = 2000; // reset backoff on success
    };

    this.es.onmessage = (e: MessageEvent) => {
      try {
        const event: SyncEvent = JSON.parse(e.data);
        if (event.type === 'ping') return; // keepalive, ignore
        this.listeners.forEach(cb => cb(event));
      } catch (err) {
        console.error('[SSE] Failed to parse event:', err);
      }
    };

    this.es.onerror = () => {
      console.warn('[SSE] Connection lost, reconnecting in', this.reconnectDelay, 'ms');
      this.es?.close();
      this.es = null;
      this._scheduleReconnect();
    };
  }

  private _scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
      // Exponential backoff capped at 30s
      this.reconnectDelay = Math.min(this.reconnectDelay * 1.5, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.es?.close();
    this.es = null;
  }

  reconnect() {
    this.disconnect();
    this.reconnectDelay = 2000;
    this.connect();
  }

  subscribe(cb: SyncCallback): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }
}

export const syncClient = new SyncSSEClient();
