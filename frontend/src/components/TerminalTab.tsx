import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal as XTerm, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import {
  RefreshCw,
  Trash2,
  Terminal as TerminalIcon,
  ShieldAlert,
  Plus,
  X,
  ChevronDown,
  Square,
  Columns,
  SplitSquareVertical,
} from 'lucide-react';
import { getAuthToken, fetchTerminalShells, deleteTerminalSession, type TerminalShellInfo } from '../services/api';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';

export interface TerminalTabProps {
  currentWorkspace: string;
  onClose?: () => void;
  compact?: boolean;
}

interface TabData {
  id: string;
  sessionId: string;
  title: string;
  shell: string;
  connected: boolean;
  error: string | null;
}

function getXTermTheme(): ITheme {
  if (typeof document === 'undefined') {
    return { background: '#090d16', foreground: '#e2e8f0' };
  }
  const root = document.documentElement;
  const isLight = root.classList.contains('light');
  const isOled = root.classList.contains('theme-oled');
  const computed = window.getComputedStyle(root);
  const accent = computed.getPropertyValue('--accent').trim() || '#38bdf8';

  if (isOled) {
    return {
      background: '#000000',
      foreground: '#f1f5f9',
      cursor: accent,
      cursorAccent: '#000000',
      selectionBackground: `${accent}40`,
      black: '#000000',
      red: '#ef4444',
      green: '#22c55e',
      yellow: '#eab308',
      blue: '#3b82f6',
      magenta: '#a855f7',
      cyan: '#06b6d4',
      white: '#f1f5f9',
      brightBlack: '#475569',
      brightRed: '#f87171',
      brightGreen: '#4ade80',
      brightYellow: '#facc15',
      brightBlue: '#60a5fa',
      brightMagenta: '#c084fc',
      brightCyan: '#38bdf8',
      brightWhite: '#ffffff',
    };
  }

  if (isLight) {
    return {
      background: '#f8fafc',
      foreground: '#0f172a',
      cursor: accent,
      cursorAccent: '#f8fafc',
      selectionBackground: `${accent}33`,
      black: '#0f172a',
      red: '#dc2626',
      green: '#16a34a',
      yellow: '#d97706',
      blue: '#2563eb',
      magenta: '#9333ea',
      cyan: '#0891b2',
      white: '#f8fafc',
      brightBlack: '#64748b',
      brightRed: '#ef4444',
      brightGreen: '#22c55e',
      brightYellow: '#f59e0b',
      brightBlue: '#3b82f6',
      brightMagenta: '#a855f7',
      brightCyan: '#06b6d4',
      brightWhite: '#0f172a',
    };
  }

  // Standard Dark
  return {
    background: '#090d16',
    foreground: '#e2e8f0',
    cursor: accent,
    cursorAccent: '#090d16',
    selectionBackground: `${accent}40`,
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
  };
}

let tabSeed = 0;
function makeTabId(): string {
  tabSeed += 1;
  return `tab_${Date.now()}_${tabSeed}`;
}
function makeSessionId(prefix: string): string {
  tabSeed += 1;
  return `${prefix}_${Date.now().toString(36)}_${tabSeed}`;
}

export const TerminalTab: React.FC<TerminalTabProps> = ({ currentWorkspace, onClose, compact: _compact }) => {
  const { t } = useI18n();

  const [availableShells, setAvailableShells] = useState<TerminalShellInfo[]>([]);
  const [defaultShell, setDefaultShell] = useState<string>('default');
  const [shellMenuOpen, setShellMenuOpen] = useState(false);
  const shellMenuRef = useRef<HTMLDivElement>(null);

  // Workspace-specific session prefix (sanitized)
  const wsPrefix =
    'ws_' +
    currentWorkspace
      .replace(/[^a-zA-Z0-9]/g, '_')
      .slice(-12)
      .toLowerCase();

  const [tabs, setTabs] = useState<TabData[]>(() => [
    {
      id: 'tab-1',
      sessionId: `${'ws_' + currentWorkspace.replace(/[^a-zA-Z0-9]/g, '_').slice(-12).toLowerCase()}_1`,
      title: 'Terminal 1',
      shell: 'default',
      connected: false,
      error: null,
    },
  ]);
  const [activeTabId, setActiveTabId] = useState<string>('tab-1');

  // Split-View Layout State
  const [splitMode, setSplitMode] = useState<'single' | 'horizontal' | 'vertical'>(() => {
    try {
      const saved = localStorage.getItem('antigravity_terminal_split_mode');
      if (saved === 'horizontal' || saved === 'vertical') return saved;
    } catch {}
    return 'single';
  });
  const [secondaryTabId, setSecondaryTabId] = useState<string | null>(null);
  const [focusedPane, setFocusedPane] = useState<'primary' | 'secondary'>('primary');
  const [splitRatio, setSplitRatio] = useState<number>(50); // percentage for primary pane
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Instances reference: tabId -> { term, fitAddon, ws, containerEl }
  const instancesRef = useRef<
    Map<
      string,
      {
        term: XTerm;
        fitAddon: FitAddon;
        ws: WebSocket | null;
        container: HTMLDivElement | null;
        lastCols: number;
        lastRows: number;
      }
    >
  >(new Map());

  // Load available shells from backend
  useEffect(() => {
    let mounted = true;
    fetchTerminalShells()
      .then((res) => {
        if (mounted) {
          setAvailableShells(res.available_shells || []);
          if (res.default_shell) {
            setDefaultShell(res.default_shell);
          }
        }
      })
      .catch((err) => {
        console.warn('Failed to load available shells:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Close shell dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (shellMenuRef.current && !shellMenuRef.current.contains(e.target as Node)) {
        setShellMenuOpen(false);
      }
    };
    if (shellMenuOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [shellMenuOpen]);

  // Synchronize terminal theme on appearance change
  useEffect(() => {
    const handleAppearanceChange = () => {
      const theme = getXTermTheme();
      instancesRef.current.forEach(({ term }) => {
        try {
          term.options.theme = theme;
        } catch {}
      });
    };

    window.addEventListener('antigravity-appearance-change', handleAppearanceChange);
    return () => window.removeEventListener('antigravity-appearance-change', handleAppearanceChange);
  }, []);

  // Connect or reconnect a specific tab
  const connectTab = useCallback(
    (tabId: string, sessionId: string, shellType: string) => {
      const entry = instancesRef.current.get(tabId);
      if (!entry || !entry.container) return;

      // Clean existing ws if open
      if (entry.ws) {
        try {
          entry.ws.onclose = null;
          entry.ws.onerror = null;
          entry.ws.onmessage = null;
          entry.ws.close();
        } catch {}
        entry.ws = null;
      }

      setTabs((prev) =>
        prev.map((tabItem) => (tabItem.id === tabId ? { ...tabItem, connected: false, error: null } : tabItem))
      );

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

      const params = new URLSearchParams({
        workspace: currentWorkspace,
        session_id: sessionId,
        shell: shellType,
      });
      if (token) params.set('token', token);

      const wsUrl = `${protocol}//${host}/ws/terminal?${params.toString()}`;

      let ws: WebSocket;
      try {
        ws = protocols ? new WebSocket(wsUrl, protocols) : new WebSocket(wsUrl);
      } catch {
        ws = new WebSocket(wsUrl);
      }
      ws.binaryType = 'arraybuffer';
      entry.ws = ws;

      ws.onopen = () => {
        setTabs((prev) =>
          prev.map((tabItem) => (tabItem.id === tabId ? { ...tabItem, connected: true, error: null } : tabItem))
        );
        if (ws.readyState === WebSocket.OPEN && entry.term && entry.term.cols > 0 && entry.term.rows > 0) {
          ws.send(JSON.stringify({ action: 'resize', cols: entry.term.cols, rows: entry.term.rows }));
        }
      };

      ws.onmessage = (e) => {
        try {
          if (typeof e.data === 'string') {
            entry.term.write(e.data);
          } else if (e.data instanceof ArrayBuffer) {
            entry.term.write(new Uint8Array(e.data));
          }
        } catch (err) {
          console.warn('Terminal write error:', err);
        }
      };

      ws.onclose = (e) => {
        setTabs((prev) =>
          prev.map((tabItem) => (tabItem.id === tabId ? { ...tabItem, connected: false } : tabItem))
        );
        if (e.code === 1008) {
          const errText = t('terminal_session_unauthorized', 'Session non autorisée. Veuillez vous reconnecter.');
          setTabs((prev) =>
            prev.map((tabItem) => (tabItem.id === tabId ? { ...tabItem, error: errText } : tabItem))
          );
          entry.term.writeln(`\r\n\x1b[31m✖ Erreur : ${errText}\x1b[0m\r\n`);
        } else {
          entry.term.writeln(`\r\n\x1b[33m⚡ ${t('terminal_session_ended', 'Session terminal interrompue.')}\x1b[0m\r\n`);
        }
      };

      ws.onerror = () => {
        setTabs((prev) =>
          prev.map((tabItem) =>
            tabItem.id === tabId
              ? { ...tabItem, connected: false, error: t('terminal_ws_error', 'Erreur de connexion WebSocket') }
              : tabItem
          )
        );
      };
    },
    [currentWorkspace, t]
  );

  // Initialize a tab's xterm instance when its DOM node mounts
  const bindTerminalContainer = useCallback(
    (tabId: string, node: HTMLDivElement | null) => {
      if (!node) return;

      let entry = instancesRef.current.get(tabId);
      if (entry && entry.container === node) return;

      const tab = tabs.find((t) => t.id === tabId);
      if (!tab) return;

      if (!entry) {
        const term = new XTerm({
          cursorBlink: true,
          fontSize: 13,
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
          theme: getXTermTheme(),
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(node);

        entry = {
          term,
          fitAddon,
          ws: null,
          container: node,
          lastCols: 0,
          lastRows: 0,
        };
        instancesRef.current.set(tabId, entry);

        // Forward user key input to WebSocket
        term.onData((data) => {
          const currentEntry = instancesRef.current.get(tabId);
          if (currentEntry?.ws && currentEntry.ws.readyState === WebSocket.OPEN) {
            currentEntry.ws.send(data);
          }
        });

        try {
          fitAddon.fit();
        } catch {}

        connectTab(tab.id, tab.sessionId, tab.shell);
      } else {
        entry.container = node;
        try {
          if (entry.term.element && entry.term.element.parentElement !== node) {
            node.appendChild(entry.term.element);
            entry.fitAddon.fit();
          }
        } catch {}
      }
    },
    [connectTab, tabs]
  );

  // Tab switching and focus: fit active/focused tab and refocus
  useEffect(() => {
    const targetId = (splitMode !== 'single' && focusedPane === 'secondary' && secondaryTabId)
      ? secondaryTabId
      : activeTabId;
    const entry = instancesRef.current.get(targetId);
    if (entry) {
      const raf = requestAnimationFrame(() => {
        try {
          if (entry.container && entry.container.clientWidth > 0 && entry.container.clientHeight > 0) {
            entry.fitAddon.fit();
            entry.term.focus();
            if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
              entry.ws.send(
                JSON.stringify({
                  action: 'resize',
                  cols: entry.term.cols,
                  rows: entry.term.rows,
                })
              );
            }
          }
        } catch {}
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [activeTabId, secondaryTabId, focusedPane, splitMode]);

  // Window resize handler for all visible tabs (primary + secondary)
  useEffect(() => {
    let resizeTimer: number | null = null;
    const handleResize = () => {
      if (resizeTimer !== null) cancelAnimationFrame(resizeTimer);
      resizeTimer = requestAnimationFrame(() => {
        resizeTimer = null;
        instancesRef.current.forEach((entry, tabId) => {
          const isVisible = tabId === activeTabId || (splitMode !== 'single' && tabId === secondaryTabId);
          if (isVisible && entry.container && entry.container.clientWidth > 0 && entry.container.clientHeight > 0) {
            try {
              entry.fitAddon.fit();
              const cols = entry.term.cols;
              const rows = entry.term.rows;
              if (cols > 0 && rows > 0 && (cols !== entry.lastCols || rows !== entry.lastRows)) {
                entry.lastCols = cols;
                entry.lastRows = rows;
                if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
                  entry.ws.send(JSON.stringify({ action: 'resize', cols, rows }));
                }
              }
            } catch {}
          }
        });
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      if (resizeTimer !== null) cancelAnimationFrame(resizeTimer);
      window.removeEventListener('resize', handleResize);
    };
  }, [activeTabId, secondaryTabId, splitMode]);

  // Support terminal-run-command event to send commands to the focused tab
  useEffect(() => {
    const handleRunCommand = (e: any) => {
      const cmd = e.detail?.command;
      if (cmd) {
        const targetTabId = (splitMode !== 'single' && focusedPane === 'secondary' && secondaryTabId)
          ? secondaryTabId
          : activeTabId;
        const entry = instancesRef.current.get(targetTabId);
        if (entry?.ws && entry.ws.readyState === WebSocket.OPEN) {
          entry.ws.send(cmd.endsWith('\n') ? cmd : cmd + '\n');
        }
      }
    };
    window.addEventListener('terminal-run-command', handleRunCommand);
    return () => window.removeEventListener('terminal-run-command', handleRunCommand);
  }, [activeTabId, secondaryTabId, focusedPane, splitMode]);

  // Clean up all instances on unmount
  useEffect(() => {
    const instances = instancesRef.current;
    return () => {
      instances.forEach((entry) => {
        if (entry.ws) {
          try {
            entry.ws.onclose = null;
            entry.ws.onerror = null;
            entry.ws.onmessage = null;
            entry.ws.close();
          } catch {}
        }
        try {
          entry.term.dispose();
        } catch {}
      });
      instances.clear();
    };
  }, []);

  // Create a new tab
  const handleCreateTab = useCallback((requestedShell?: string) => {
    const shellToUse = requestedShell || defaultShell || 'default';
    const nextNum = tabs.length + 1;

    let shellName = 'Terminal';
    const found = availableShells.find((s) => s.id === shellToUse);
    if (found) {
      shellName = found.name;
    } else if (shellToUse === 'powershell') {
      shellName = 'PowerShell';
    } else if (shellToUse === 'cmd') {
      shellName = 'CMD';
    } else if (shellToUse === 'gitbash' || shellToUse === 'bash') {
      shellName = 'Git Bash';
    }

    const newId = makeTabId();
    const newSessionId = makeSessionId(wsPrefix);
    const newTab: TabData = {
      id: newId,
      sessionId: newSessionId,
      title: `${shellName} ${nextNum}`,
      shell: shellToUse,
      connected: false,
      error: null,
    };

    setTabs((prev) => [...prev, newTab]);
    if (splitMode !== 'single' && focusedPane === 'secondary') {
      setSecondaryTabId(newId);
    } else {
      setActiveTabId(newId);
    }
    setShellMenuOpen(false);
  }, [availableShells, defaultShell, focusedPane, splitMode, tabs.length, wsPrefix]);

  // Set split mode (single, horizontal, vertical) and ensure secondary tab exists
  const handleSetSplitMode = useCallback(
    (mode: 'single' | 'horizontal' | 'vertical') => {
      setSplitMode(mode);
      try {
        localStorage.setItem('antigravity_terminal_split_mode', mode);
      } catch {}

      if (mode !== 'single') {
        setTabs((currentTabs) => {
          let secId = secondaryTabId;
          if (!secId || secId === activeTabId || !currentTabs.some((t) => t.id === secId)) {
            const candidate = currentTabs.find((t) => t.id !== activeTabId);
            if (candidate) {
              setSecondaryTabId(candidate.id);
            } else {
              const newId = makeTabId();
              const newSessionId = makeSessionId(wsPrefix);
              const nextNum = currentTabs.length + 1;
              const newTab: TabData = {
                id: newId,
                sessionId: newSessionId,
                title: `Terminal ${nextNum}`,
                shell: defaultShell || 'default',
                connected: false,
                error: null,
              };
              setSecondaryTabId(newId);
              return [...currentTabs, newTab];
            }
          }
          return currentTabs;
        });
      }

      requestAnimationFrame(() => {
        instancesRef.current.forEach((entry) => {
          try {
            if (entry.container && entry.container.clientWidth > 0 && entry.container.clientHeight > 0) {
              entry.fitAddon.fit();
              const cols = entry.term.cols;
              const rows = entry.term.rows;
              if (cols > 0 && rows > 0) {
                entry.lastCols = cols;
                entry.lastRows = rows;
                if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
                  entry.ws.send(JSON.stringify({ action: 'resize', cols, rows }));
                }
              }
            }
          } catch {}
        });
      });
    },
    [activeTabId, defaultShell, secondaryTabId, wsPrefix]
  );

  // Drag divider between split panes
  const handleDividerPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setIsDraggingSplit(true);

      const onPointerMove = (moveEv: PointerEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();

        let ratio: number;
        if (splitMode === 'horizontal') {
          const offset = moveEv.clientX - rect.left;
          ratio = (offset / rect.width) * 100;
        } else {
          const offset = moveEv.clientY - rect.top;
          ratio = (offset / rect.height) * 100;
        }

        const clamped = Math.max(20, Math.min(80, ratio));
        setSplitRatio(clamped);

        requestAnimationFrame(() => {
          instancesRef.current.forEach((entry) => {
            try {
              if (entry.container && entry.container.clientWidth > 0 && entry.container.clientHeight > 0) {
                entry.fitAddon.fit();
                const cols = entry.term.cols;
                const rows = entry.term.rows;
                if (cols > 0 && rows > 0 && (cols !== entry.lastCols || rows !== entry.lastRows)) {
                  entry.lastCols = cols;
                  entry.lastRows = rows;
                  if (entry.ws && entry.ws.readyState === WebSocket.OPEN) {
                    entry.ws.send(JSON.stringify({ action: 'resize', cols, rows }));
                  }
                }
              }
            } catch {}
          });
        });
      };

      const onPointerUp = () => {
        setIsDraggingSplit(false);
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', onPointerUp);
    },
    [splitMode]
  );

  // Close a tab
  const handleCloseTab = useCallback(async (e: React.MouseEvent, tabId: string) => {
    e.stopPropagation();

    if (tabs.length === 1) {
      const ok = await showConfirm(
        t('terminal_reset_last_tab', 'Réinitialiser la console et recommencer ?'),
        { destructive: true }
      );
      if (!ok) return;
    }

    const tabToClose = tabs.find((t) => t.id === tabId);
    const entry = instancesRef.current.get(tabId);

    if (entry) {
      if (entry.ws) {
        try {
          entry.ws.onclose = null;
          entry.ws.onerror = null;
          entry.ws.onmessage = null;
          entry.ws.close();
        } catch {}
      }
      try {
        entry.term.dispose();
      } catch {}
      instancesRef.current.delete(tabId);
    }

    // Call backend delete to kill process
    if (tabToClose) {
      deleteTerminalSession(tabToClose.sessionId).catch(() => {});
    }

    const nextTabs = tabs.filter((t) => t.id !== tabId);

    if (nextTabs.length === 0) {
      const freshId = makeTabId();
      const freshSessionId = makeSessionId(wsPrefix);
      setTabs([
        {
          id: freshId,
          sessionId: freshSessionId,
          title: 'Terminal 1',
          shell: defaultShell,
          connected: false,
          error: null,
        },
      ]);
      setActiveTabId(freshId);
      setSecondaryTabId(null);
      setSplitMode('single');
    } else {
      setTabs(nextTabs);
      if (activeTabId === tabId) {
        const remainingForPrimary = nextTabs.find((t) => t.id !== secondaryTabId) || nextTabs[0];
        setActiveTabId(remainingForPrimary.id);
      }
      if (secondaryTabId === tabId) {
        const remainingForSecondary = nextTabs.find((t) => t.id !== activeTabId);
        if (remainingForSecondary) {
          setSecondaryTabId(remainingForSecondary.id);
        } else {
          setSecondaryTabId(null);
          setSplitMode('single');
        }
      }
    }
  }, [activeTabId, defaultShell, secondaryTabId, t, tabs, wsPrefix]);

  const currentFocusedTabId =
    splitMode !== 'single' && focusedPane === 'secondary' && secondaryTabId
      ? secondaryTabId
      : activeTabId;

  // Clear focused tab
  const handleClear = () => {
    const entry = instancesRef.current.get(currentFocusedTabId);
    if (entry) {
      entry.term.clear();
    }
  };

  // Restart shell in focused tab
  const handleRestartSession = async () => {
    const ok = await showConfirm(
      t('terminal_reset_confirm', 'Voulez-vous réinitialiser ce terminal ? Les processus en cours seront fermés.'),
      { destructive: true }
    );
    if (!ok) return;

    const entry = instancesRef.current.get(currentFocusedTabId);
    const tab = tabs.find((t) => t.id === currentFocusedTabId);
    if (!tab) return;

    if (entry?.ws && entry.ws.readyState === WebSocket.OPEN) {
      entry.ws.send(JSON.stringify({ action: 'restart' }));
      entry.term.clear();
    } else {
      connectTab(tab.id, tab.sessionId, tab.shell);
    }
  };

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const secondaryTab = tabs.find((t) => t.id === secondaryTabId);
  const focusedTab = tabs.find((t) => t.id === currentFocusedTabId);

  const handleTabClick = (tabId: string) => {
    if (splitMode === 'single') {
      setActiveTabId(tabId);
      setFocusedPane('primary');
    } else {
      if (focusedPane === 'primary') {
        if (tabId === secondaryTabId) {
          setFocusedPane('secondary');
        } else {
          setActiveTabId(tabId);
        }
      } else {
        if (tabId === activeTabId) {
          setFocusedPane('primary');
        } else {
          setSecondaryTabId(tabId);
        }
      }
    }
  };

  return (
    <div
      className="flex flex-col h-full select-none"
      style={{
        backgroundColor: 'var(--surface-subtle)',
        color: 'var(--text)',
      }}
    >
      {/* Top Tab Strip & Toolbar */}
      <div
        className="flex items-center justify-between px-2 pt-1 border-b text-xs shrink-0 select-none overflow-x-auto"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Tabs Bar */}
        <div className="flex items-center gap-1 overflow-x-auto py-1 scrollbar-none">
          {tabs.map((tab) => {
            const isPrimary = tab.id === activeTabId;
            const isSecondary = splitMode !== 'single' && tab.id === secondaryTabId;
            const isFocused =
              (focusedPane === 'primary' && isPrimary) ||
              (focusedPane === 'secondary' && isSecondary);

            return (
              <div
                key={tab.id}
                onClick={() => handleTabClick(tab.id)}
                className={`group flex items-center gap-1.5 px-3 py-1.5 rounded-t-md font-mono text-[11px] cursor-pointer transition-all border-b-2 ${
                  isFocused
                    ? 'border-[var(--accent)] font-semibold shadow-sm'
                    : isPrimary || isSecondary
                    ? 'border-slate-500/40 opacity-90'
                    : 'border-transparent opacity-60 hover:opacity-100'
                }`}
                style={{
                  backgroundColor: isFocused || isPrimary || isSecondary ? 'var(--surface-subtle)' : 'transparent',
                  color: isFocused ? 'var(--strong)' : 'var(--muted)',
                }}
              >
                <TerminalIcon className={`w-3.5 h-3.5 ${isFocused ? 'text-[var(--accent)]' : 'text-slate-400'}`} />
                <span className="truncate max-w-[120px]">{tab.title}</span>
                {splitMode !== 'single' && isPrimary && (
                  <span
                    className="px-1 py-0.2 rounded text-[9px] font-bold bg-[var(--accent)]/20 text-[var(--accent)]"
                    title={t('terminal_pane_1', 'Volet 1')}
                  >
                    1
                  </span>
                )}
                {splitMode !== 'single' && isSecondary && (
                  <span
                    className="px-1 py-0.2 rounded text-[9px] font-bold bg-amber-500/20 text-amber-400"
                    title={t('terminal_pane_2', 'Volet 2')}
                  >
                    2
                  </span>
                )}
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    tab.connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-500'
                  }`}
                  title={tab.connected ? t('online', 'En ligne') : t('disconnected', 'Déconnecté')}
                />
                <button
                  type="button"
                  onClick={(e) => handleCloseTab(e, tab.id)}
                  title={t('terminal_close_tooltip', 'Fermer ce terminal')}
                  className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-rose-500/20 hover:text-rose-400 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* New Tab with Shell Selector Dropdown */}
          <div className="relative inline-flex items-center ml-1" ref={shellMenuRef}>
            <button
              type="button"
              onClick={() => handleCreateTab()}
              title={t('terminal_new_tooltip', 'Ouvrir un nouveau terminal')}
              className="flex items-center gap-0.5 px-2 py-1 rounded text-xs transition-colors hover:opacity-100 opacity-75 cursor-pointer"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--text)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{t('terminal_new_tab', 'Nouveau')}</span>
            </button>
            <button
              type="button"
              onClick={() => setShellMenuOpen(!shellMenuOpen)}
              title={t('terminal_select_shell', 'Sélectionner un interpréteur (PowerShell, CMD, Git Bash...)')}
              className="p-1 rounded ml-0.5 text-xs transition-colors hover:opacity-100 opacity-75 cursor-pointer"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                color: 'var(--muted)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <ChevronDown className="w-3 h-3" />
            </button>

            {/* Dropdown Menu */}
            {shellMenuOpen && (
              <div
                className="absolute left-0 top-full mt-1.5 w-52 rounded-lg shadow-2xl border p-1 z-50 backdrop-blur-md"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="px-2 py-1 text-[10px] uppercase font-bold tracking-wider opacity-60">
                  {t('terminal_choose_shell', 'Choisir un interpréteur')}
                </div>
                {availableShells.map((sh) => (
                  <button
                    key={sh.id}
                    type="button"
                    onClick={() => handleCreateTab(sh.id)}
                    className="w-full flex items-center justify-between px-2.5 py-1.5 rounded text-xs text-left cursor-pointer hover:bg-[var(--accent-bg)] transition-colors"
                    style={{ color: 'var(--text)' }}
                  >
                    <div className="flex items-center gap-2">
                      <TerminalIcon className="w-3.5 h-3.5 text-[var(--accent)]" />
                      <span className="font-medium">{sh.name}</span>
                    </div>
                    {sh.id === defaultShell && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        {t('default', 'Défaut')}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right Toolbar Controls */}
        <div className="flex items-center gap-1.5 py-1">
          {/* Split View Layout Selector */}
          <div
            className="flex items-center gap-0.5 p-0.5 rounded-lg border shadow-2xs"
            style={{
              borderColor: 'var(--border-subtle)',
              backgroundColor: 'var(--surface-subtle)',
            }}
          >
            <button
              type="button"
              onClick={() => handleSetSplitMode('single')}
              className={`p-1 rounded-md transition-all cursor-pointer ${
                splitMode === 'single'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={t('terminal_split_single', 'Vue unique (1 volet)')}
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => handleSetSplitMode('horizontal')}
              className={`p-1 rounded-md transition-all cursor-pointer ${
                splitMode === 'horizontal'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={t('terminal_split_horizontal', 'Scinder verticalement (colonnes côte à côte)')}
            >
              <Columns className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={() => handleSetSplitMode('vertical')}
              className={`p-1 rounded-md transition-all cursor-pointer ${
                splitMode === 'vertical'
                  ? 'bg-[var(--accent)] text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              title={t('terminal_split_vertical', 'Scinder horizontalement (lignes empilées)')}
            >
              <SplitSquareVertical className="w-3 h-3" />
            </button>
          </div>

          {focusedTab && (
            <span
              className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border-subtle)',
                color: 'var(--muted)',
              }}
            >
              <span>{focusedTab.shell.toUpperCase()}</span>
            </span>
          )}

          <button
            type="button"
            onClick={handleClear}
            title={t('terminal_clear_title', 'Effacer l’écran')}
            className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-100 opacity-70"
            style={{ color: 'var(--muted)' }}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRestartSession}
            title={t('terminal_restart_title', 'Réinitialiser la session')}
            className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-100 opacity-70 hover:text-amber-400"
            style={{ color: 'var(--muted)' }}
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title={t('close', 'Fermer')}
              className="p-1.5 rounded-md transition-colors cursor-pointer hover:opacity-100 opacity-70 hover:text-rose-400"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Error Banners */}
      {(activeTab?.error || (splitMode !== 'single' && secondaryTab?.error)) && (
        <div className="p-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 shrink-0">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{activeTab?.error || secondaryTab?.error}</span>
        </div>
      )}

      {/* Multi-Pane Terminals Container */}
      <div
        ref={containerRef}
        className={`flex-1 min-h-0 relative overflow-hidden p-1.5 select-text ${
          splitMode === 'horizontal' ? 'flex flex-row gap-0' : splitMode === 'vertical' ? 'flex flex-col gap-0' : ''
        }`}
        style={{
          backgroundColor: 'var(--bg)',
        }}
      >
        {/* Pane 1 (Primary) */}
        <div
          onClick={() => setFocusedPane('primary')}
          className={`relative overflow-hidden rounded-lg transition-all ${
            splitMode === 'single' ? 'h-full w-full' : ''
          } ${
            splitMode !== 'single'
              ? focusedPane === 'primary'
                ? 'ring-1 ring-[var(--accent)] shadow-sm'
                : 'opacity-90 hover:opacity-100 ring-1 ring-white/10 dark:ring-white/5'
              : ''
          }`}
          style={
            splitMode === 'horizontal'
              ? { width: `${splitRatio}%`, height: '100%' }
              : splitMode === 'vertical'
              ? { height: `${splitRatio}%`, width: '100%' }
              : undefined
          }
        >
          {splitMode !== 'single' && (
            <div
              className="absolute top-1.5 right-2 z-10 px-2 py-0.5 rounded text-[10px] font-mono select-none flex items-center gap-1.5 backdrop-blur-md shadow-xs pointer-events-none"
              style={{
                backgroundColor: 'var(--surface)',
                color: focusedPane === 'primary' ? 'var(--accent)' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: focusedPane === 'primary' ? 'var(--accent)' : 'var(--muted)' }}
              />
              <span className="font-semibold">{t('terminal_pane_1', 'Volet 1')}</span>
              <span className="opacity-60 text-[9px]">({activeTab?.shell.toUpperCase() || 'DEFAULT'})</span>
            </div>
          )}
          {tabs.map((tab) => {
            const isVisible = tab.id === activeTabId;
            return (
              <div
                key={`primary_${tab.id}`}
                style={{
                  display: isVisible ? 'block' : 'none',
                  pointerEvents: isDraggingSplit ? 'none' : 'auto',
                }}
                className="h-full w-full relative"
              >
                <div
                  ref={(node) => {
                    if (isVisible) {
                      bindTerminalContainer(tab.id, node);
                    }
                  }}
                  className="h-full w-full"
                />
              </div>
            );
          })}
        </div>

        {/* Draggable Divider */}
        {splitMode !== 'single' && (
          <div
            onPointerDown={handleDividerPointerDown}
            className={`shrink-0 z-20 flex items-center justify-center transition-colors select-none ${
              splitMode === 'horizontal'
                ? 'w-2 cursor-col-resize hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50'
                : 'h-2 cursor-row-resize hover:bg-[var(--accent)]/30 active:bg-[var(--accent)]/50'
            }`}
            style={{
              backgroundColor: isDraggingSplit ? 'var(--accent)' : 'transparent',
            }}
            title={t('terminal_drag_split', 'Glisser pour redimensionner')}
          >
            <div
              className={`rounded-full transition-colors ${
                isDraggingSplit ? 'bg-white' : 'bg-slate-500/40 hover:bg-[var(--accent)]'
              } ${
                splitMode === 'horizontal' ? 'w-1 h-7' : 'h-1 w-7'
              }`}
            />
          </div>
        )}

        {/* Pane 2 (Secondary) */}
        {splitMode !== 'single' && (
          <div
            onClick={() => setFocusedPane('secondary')}
            className={`relative overflow-hidden rounded-lg transition-all ${
              focusedPane === 'secondary'
                ? 'ring-1 ring-[var(--accent)] shadow-sm'
                : 'opacity-90 hover:opacity-100 ring-1 ring-white/10 dark:ring-white/5'
            }`}
            style={
              splitMode === 'horizontal'
                ? { width: `${100 - splitRatio}%`, height: '100%' }
                : { height: `${100 - splitRatio}%`, width: '100%' }
            }
          >
            <div
              className="absolute top-1.5 right-2 z-10 px-2 py-0.5 rounded text-[10px] font-mono select-none flex items-center gap-1.5 backdrop-blur-md shadow-xs pointer-events-none"
              style={{
                backgroundColor: 'var(--surface)',
                color: focusedPane === 'secondary' ? 'var(--accent)' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: focusedPane === 'secondary' ? 'var(--accent)' : 'var(--muted)' }}
              />
              <span className="font-semibold">{t('terminal_pane_2', 'Volet 2')}</span>
              <span className="opacity-60 text-[9px]">({secondaryTab?.shell.toUpperCase() || 'DEFAULT'})</span>
            </div>
            {tabs.map((tab) => {
              const isVisible = tab.id === secondaryTabId;
              return (
                <div
                  key={`secondary_${tab.id}`}
                  style={{
                    display: isVisible ? 'block' : 'none',
                    pointerEvents: isDraggingSplit ? 'none' : 'auto',
                  }}
                  className="h-full w-full relative"
                >
                  <div
                    ref={(node) => {
                      if (isVisible) {
                        bindTerminalContainer(tab.id, node);
                      }
                    }}
                    className="h-full w-full"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
