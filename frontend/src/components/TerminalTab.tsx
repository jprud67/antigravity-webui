import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, Trash2, Terminal as TerminalIcon, ShieldAlert } from 'lucide-react';
import { getAuthToken } from '../services/api';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';

interface TerminalTabProps {
  currentWorkspace: string;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ currentWorkspace }) => {
  const { t } = useI18n();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectTerminal = useCallback(() => {
    if (!terminalRef.current) return;

    // Clean up previous
    if (wsRef.current) {
      try {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    if (xtermRef.current) {
      try {
        xtermRef.current.dispose();
      } catch {}
      xtermRef.current = null;
    }

    setError(null);
    setConnected(false);

    // Initialize XTerm
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      theme: {
        background: '#060a12',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        selectionBackground: '#0284c740',
        black: '#0f172a',
        red: '#f43f5e',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#d946ef',
        cyan: '#06b6d4',
        white: '#f8fafc',
        brightBlack: '#475569',
        brightRed: '#fb7185',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#e879f9',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    try {
      fitAddon.fit();
    } catch {}

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getAuthToken() || '';
    let protocols: string[] | undefined;
    if (token) {
      try {
        const utf8Bytes = encodeURIComponent(token).replace(/%([0-9A-F]{2})/g, (_, p1) =>
          String.fromCharCode(parseInt(p1, 16))
        );
        const safeToken = btoa(utf8Bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        protocols = ['terminal', `token.${safeToken}`];
      } catch {
        protocols = undefined;
      }
    }
    const baseUrl = `${protocol}//${host}/ws/terminal?workspace=${encodeURIComponent(currentWorkspace)}`;
    const fallbackUrl = `${baseUrl}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    let ws: WebSocket;
    try {
      ws = protocols ? new WebSocket(baseUrl, protocols) : new WebSocket(fallbackUrl);
    } catch {
      ws = new WebSocket(fallbackUrl);
    }
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      // Send initial terminal dimensions
      if (ws.readyState === WebSocket.OPEN && xtermRef.current && xtermRef.current.cols > 0 && xtermRef.current.rows > 0) {
        ws.send(JSON.stringify({ action: 'resize', cols: xtermRef.current.cols, rows: xtermRef.current.rows }));
      }
    };

    ws.onmessage = (e) => {
      if (!xtermRef.current) return;
      try {
        if (typeof e.data === 'string') {
          xtermRef.current.write(e.data);
        } else if (e.data instanceof ArrayBuffer) {
          xtermRef.current.write(new Uint8Array(e.data));
        }
      } catch (err) {
        console.warn('Terminal write error:', err);
      }
    };

    ws.onclose = (e) => {
      setConnected(false);
      if (!xtermRef.current) return;
      if (e.code === 1008) {
        setError(t('terminal_session_unauthorized', 'Unauthorized session. Please log in.'));
        xtermRef.current.writeln(`\r\n\x1b[31m✖ ${t('error', 'Error')}: ${t('terminal_session_unauthorized', 'Unauthorized session (403/1008).')}\x1b[0m\r\n`);
      } else {
        xtermRef.current.writeln(`\r\n\x1b[33m⚡ ${t('terminal_session_ended', 'Terminal session ended.')}\x1b[0m\r\n`);
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setError(t('terminal_ws_error', 'Terminal WebSocket connection error.'));
    };

    // Forward terminal input to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  }, [currentWorkspace, t]);

  useEffect(() => {
    connectTerminal();

    let lastCols = 0;
    let lastRows = 0;
    let resizeTimer: number | null = null;

    const handleResize = () => {
      if (resizeTimer !== null) {
        cancelAnimationFrame(resizeTimer);
      }
      resizeTimer = requestAnimationFrame(() => {
        resizeTimer = null;
        if (fitAddonRef.current && xtermRef.current && terminalRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          try {
            if (terminalRef.current.clientWidth > 0 && terminalRef.current.clientHeight > 0) {
              fitAddonRef.current.fit();
              const cols = xtermRef.current.cols;
              const rows = xtermRef.current.rows;
              if (cols > 0 && rows > 0 && (cols !== lastCols || rows !== lastRows)) {
                lastCols = cols;
                lastRows = rows;
                wsRef.current.send(
                  JSON.stringify({
                    action: 'resize',
                    cols,
                    rows,
                  })
                );
              }
            }
          } catch {}
        }
      });
    };

    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && terminalRef.current) {
      resizeObserver = new ResizeObserver(() => {
        handleResize();
      });
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      if (resizeTimer !== null) {
        cancelAnimationFrame(resizeTimer);
      }
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (wsRef.current) {
        try {
          wsRef.current.onclose = null;
          wsRef.current.onerror = null;
          wsRef.current.onmessage = null;
          wsRef.current.close();
        } catch {}
        wsRef.current = null;
      }
      if (xtermRef.current) {
        try {
          xtermRef.current.dispose();
        } catch {}
        xtermRef.current = null;
      }
    };
  }, [connectTerminal]);

  useEffect(() => {
    const handleRunCommand = (e: any) => {
      const cmd = e.detail?.command;
      if (cmd && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(cmd.endsWith('\n') ? cmd : cmd + '\n');
      }
    };
    window.addEventListener('terminal-run-command', handleRunCommand);
    return () => window.removeEventListener('terminal-run-command', handleRunCommand);
  }, []);

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  };

  const handleRestartSession = async () => {
    const ok = await showConfirm(t('terminal_reset_confirm', 'Do you want to reset the bash shell (all running processes will be terminated)?'), { destructive: true });
    if (ok) {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ action: 'restart' }));
        if (xtermRef.current) {
          xtermRef.current.clear();
        }
      } else {
        connectTerminal();
      }
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#060a12] text-slate-200">
      {/* Terminal Toolbar */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b text-xs shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-emerald-400" />
          <span className="font-semibold" style={{ color: 'var(--strong)' }}>{t('terminal_pty_title', 'Terminal PTY')}</span>
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border-subtle)',
              color: 'var(--muted)'
            }}
            title={t('terminal_persistent_hint', 'The terminal and background processes remain active even when closing panel')}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            {connected ? t('terminal_persistent_online', 'Persistent (Online)') : t('terminal_disconnected', 'Disconnected')}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            title={t('terminal_clear_title', 'Clear terminal display')}
            className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-100 opacity-70"
            style={{ color: 'var(--muted)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleRestartSession}
            title={t('terminal_restart_title', 'Reset bash interpreter')}
            className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-100 opacity-70 hover:text-amber-400"
            style={{ color: 'var(--muted)' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {error && (
        <div className="p-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 shrink-0">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Terminal Container */}
      <div className="flex-1 relative overflow-hidden p-2">
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  );
};
