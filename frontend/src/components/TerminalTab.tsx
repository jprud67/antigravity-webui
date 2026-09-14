import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { RefreshCw, Trash2, Terminal as TerminalIcon, ShieldAlert } from 'lucide-react';
import { getAuthToken } from '../services/api';

interface TerminalTabProps {
  currentWorkspace: string;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ currentWorkspace }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectTerminal = () => {
    if (!terminalRef.current) return;

    // Clean up previous
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (e) {}
      wsRef.current = null;
    }
    if (xtermRef.current) {
      try {
        xtermRef.current.dispose();
      } catch (e) {}
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
    } catch (e) {}

    // Connect WebSocket
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const token = getAuthToken() || '';
    const wsUrl = `${protocol}//${host}/ws/terminal?token=${encodeURIComponent(token)}&workspace=${encodeURIComponent(currentWorkspace)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      term.writeln('\x1b[38;5;38m✔ Connecté au terminal Antigravity (' + currentWorkspace + ')\x1b[0m\r\n');
      // Send initial size
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'resize', cols: term.cols, rows: term.rows }));
      }
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        term.write(e.data);
      } else if (e.data instanceof ArrayBuffer) {
        const text = new TextDecoder().decode(e.data);
        term.write(text);
      }
    };

    ws.onclose = (e) => {
      setConnected(false);
      if (e.code === 1008) {
        setError('Session non autorisée. Veuillez vous connecter.');
        term.writeln('\r\n\x1b[31m✖ Erreur : Session non autorisée (403/1008).\x1b[0m\r\n');
      } else {
        term.writeln('\r\n\x1b[33m⚡ Session terminal terminée.\x1b[0m\r\n');
      }
    };

    ws.onerror = () => {
      setConnected(false);
      setError('Erreur de connexion au WebSocket terminal.');
    };

    // Forward terminal input to WebSocket
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });
  };

  useEffect(() => {
    connectTerminal();

    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        try {
          fitAddonRef.current.fit();
          wsRef.current.send(
            JSON.stringify({
              action: 'resize',
              cols: xtermRef.current.cols,
              rows: xtermRef.current.rows,
            })
          );
        } catch (e) {}
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch (e) {}
      }
      if (xtermRef.current) {
        try {
          xtermRef.current.dispose();
        } catch (e) {}
      }
    };
  }, [currentWorkspace]);

  const handleClear = () => {
    if (xtermRef.current) {
      xtermRef.current.clear();
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#060a12] text-slate-200">
      {/* Terminal Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0a101f] border-b border-slate-800/80 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <TerminalIcon className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-slate-300">Terminal PTY</span>
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono border bg-slate-800/60 border-slate-700/60 text-slate-400">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
              }`}
            />
            {connected ? 'En ligne' : 'Déconnecté'}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            title="Effacer le terminal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={connectTerminal}
            title="Relancer le terminal"
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
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
