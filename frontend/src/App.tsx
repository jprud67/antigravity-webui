import React, { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatCanvas } from './components/ChatCanvas';
import { ChatInput } from './components/ChatInput';

const ArtifactViewer = lazy(() => import('./components/ArtifactViewer').then(m => ({ default: m.ArtifactViewer })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
import type { SettingsTab } from './components/SettingsModal';
const ProjectSwitcherModal = lazy(() => import('./components/ProjectSwitcherModal').then(m => ({ default: m.ProjectSwitcherModal })));
const LoginModal = lazy(() => import('./components/LoginModal').then(m => ({ default: m.LoginModal })));
const FileExplorerModal = lazy(() => import('./components/FileExplorerModal').then(m => ({ default: m.FileExplorerModal })));
const TaskDashboardModal = lazy(() => import('./components/TaskDashboardModal').then(m => ({ default: m.TaskDashboardModal })));
import type { RightPanelTab } from './components/WorkspacePanel';
const WorkspacePanel = lazy(() => import('./components/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })));
const SessionMetaModal = lazy(() => import('./components/SessionMetaModal').then(m => ({ default: m.SessionMetaModal })));
const CronSchedulerModal = lazy(() => import('./components/CronSchedulerModal').then(m => ({ default: m.CronSchedulerModal })));
const RulesEditorModal = lazy(() => import('./components/RulesEditorModal').then(m => ({ default: m.RulesEditorModal })));
const HelpModal = lazy(() => import('./components/HelpModal').then(m => ({ default: m.HelpModal })));
const AnalyticsModal = lazy(() => import('./components/AnalyticsModal').then(m => ({ default: m.AnalyticsModal })));
const ContextCompactorModal = lazy(() => import('./components/ContextCompactorModal').then(m => ({ default: m.ContextCompactorModal })));
const SessionBranchModal = lazy(() => import('./components/SessionBranchModal').then(m => ({ default: m.SessionBranchModal })));
const MonacoStudioModal = lazy(() => import('./components/MonacoStudioModal').then(m => ({ default: m.MonacoStudioModal })));
const QuickOpenModal = lazy(() => import('./components/QuickOpenModal').then(m => ({ default: m.QuickOpenModal })));
const FtsSearchModal = lazy(() => import('./components/FtsSearchModal').then(m => ({ default: m.FtsSearchModal })));
const McpCatalogModal = lazy(() => import('./components/McpCatalogModal').then(m => ({ default: m.McpCatalogModal })));
const SystemDoctorModal = lazy(() => import('./components/SystemDoctorModal').then(m => ({ default: m.SystemDoctorModal })));
const RemoteAccessModal = lazy(() => import('./components/RemoteAccessModal').then(m => ({ default: m.RemoteAccessModal })));
const MessagingGatewayModal = lazy(() => import('./components/MessagingGatewayModal').then(m => ({ default: m.MessagingGatewayModal })));
const WorktreeDashboardModal = lazy(() => import('./components/WorktreeDashboardModal').then(m => ({ default: m.WorktreeDashboardModal })));
const CanvasStudioModal = lazy(() => import('./components/CanvasStudioModal').then(m => ({ default: m.CanvasStudioModal })));
const VectorMemoryModal = lazy(() => import('./components/VectorMemoryModal').then(m => ({ default: m.VectorMemoryModal })));

import type { TokenUsageData } from './components/ContextRing';
import type { Conversation, ChatMessage, ModelOption, BookmarkItem, MonacoStudioConfig, AppSettings, ProgressCardData } from './types';
import { parseStepsToMessages, cleanUserPrompt } from './utils/transcriptParser';
import { 
  fetchConversations, 
  fetchConversationTranscript, 
  fetchModels, 
  fetchSettings,
  fetchProgressCard,
  checkAuthStatus,
  clearAuthToken,
  enforceContextBudget,
  forkConversation,
  updateConversationMetadata,
  updateConversationTitle,
  undoConversationTurn,
  fetchGoogleAccounts,
  saveSettings,
  fetchUsageQuota,
  fetchCredits,
  fetchChangelog,
  checkSystemUpdate,
  addConversationBookmark,
  removeConversationBookmark,
  type GoogleAccountInfo,
  type UpdateCheckResult,
  type PruneResult
} from './services/api';
import { chatSocket } from './services/ws';
import { syncClient } from './services/sync';
import { getStoredTheme, getStoredSkin, applyAppearance } from './services/theme';
import { ToastContainer } from './components/Toast';
import { showToast } from './services/toast';
import { ConfirmDialogContainer } from './components/AppDialog';
import { getConvIdFromPath, navigateToConversation } from './utils/navigation';

const estimateUsageFromMessages = (msgs: ChatMessage[]): TokenUsageData => {
  if (!msgs || msgs.length === 0) {
    return {
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      isEstimated: true
    };
  }

  // Antigravity base system context (system prompt, tools schemas, skills)
  const BASE_SYSTEM_TOKENS = 13370;
  let promptChars = 0;
  let responseChars = 0;
  let thinkingChars = 0;

  for (const m of msgs) {
    if (m.role === 'user' || m.role === 'system') {
      promptChars += (m.content || '').length;
    } else {
      responseChars += (m.content || '').length;
      if (m.thought) thinkingChars += m.thought.length;
      if (m.toolCalls && m.toolCalls.length > 0) {
        for (const tc of m.toolCalls) {
          responseChars += (tc.name || '').length + JSON.stringify(tc.args || {}).length;
          if (tc.result) {
            promptChars += typeof tc.result === 'string' ? tc.result.length : JSON.stringify(tc.result).length;
          }
        }
      }
    }
  }

  const pTokens = promptChars > 0 ? Math.max(1, Math.ceil(promptChars / 3.8)) : 0;
  const rTokens = Math.max(0, Math.ceil(responseChars / 3.8));
  const tTokens = Math.max(0, Math.ceil(thinkingChars / 3.8));

  const inputTokens = BASE_SYSTEM_TOKENS + pTokens;
  const outputTokens = rTokens + tTokens;
  const totalTokens = inputTokens + outputTokens;

  return {
    inputTokens,
    outputTokens,
    thinkingTokens: tTokens,
    totalTokens,
    isEstimated: true
  };
};

const normalizeUsage = (raw: any): TokenUsageData | undefined => {
  if (!raw || typeof raw !== 'object') return undefined;
  const inputTokens = Number(raw.inputTokens ?? raw.input_tokens ?? raw.prompt_tokens ?? raw.promptTokenCount ?? 0) || 0;
  const outputTokens = Number(raw.outputTokens ?? raw.output_tokens ?? raw.completion_tokens ?? raw.candidatesTokenCount ?? 0) || 0;
  const thinkingTokens = Number(raw.thinkingTokens ?? raw.thinking_tokens ?? raw.reasoning_tokens ?? raw.thinkingTokenCount ?? 0) || 0;
  let totalTokens = Number(raw.totalTokens ?? raw.total_tokens ?? raw.totalTokenCount ?? 0) || 0;
  if (totalTokens === 0 && (inputTokens > 0 || outputTokens > 0 || thinkingTokens > 0)) {
    totalTokens = inputTokens + outputTokens + thinkingTokens;
  }
  const isEstimated = typeof raw.isEstimated === 'boolean' ? raw.isEstimated : (typeof raw.is_estimated === 'boolean' ? raw.is_estimated : false);
  return {
    inputTokens,
    outputTokens,
    thinkingTokens,
    totalTokens,
    isEstimated
  };
};

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('antigravity_workspace');
      if (saved && saved.trim()) return saved.trim();
    } catch {
      // localStorage may fail in restricted sandboxes
    }
    return '';
  });
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const handleSelectWorkspace = useCallback((ws: string) => {
    setCurrentWorkspace(ws);
    try {
      localStorage.setItem('antigravity_workspace', ws);
    } catch {
      // ignore
    }
  }, []);

  const activeConv = useMemo(
    () => conversations.find((c) => c.conversation_id === activeConversationId),
    [conversations, activeConversationId]
  );

  // Stable refs — used in effects with empty deps to avoid stale closures
  const activeConversationIdRef = React.useRef<string | null>(null);
  const isStreamingRef = React.useRef<boolean>(false);

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
    isStreamingRef.current = isStreaming;
  }, [activeConversationId, isStreaming]);


  // Telemetry, Queue & Approval States (Phase 2)
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | undefined>(undefined);
  const [queueCount, setQueueCount] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<{ toolName: string; command?: string; path?: string } | null>(null);
  const [loopWarning, setLoopWarning] = useState<{ errorCount: number; message: string } | null>(null);

  // WebSocket connection status for reconnection banner
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>(
    chatSocket.connectionStatus
  );

  // Session Metadata Modal (Phase 3)
  const [isSessionMetaOpen, setIsSessionMetaOpen] = useState(false);
  const [metaTargetConversation, setMetaTargetConversation] = useState<Conversation | null>(null);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash');
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('medium');
  const [quickPrompt, setQuickPrompt] = useState('');

  // Memoized prompt history of active discussion for terminal-like navigation
  const pastUserPrompts = useMemo(() => {
    return messages
      .filter((m) => m.role === 'user' && m.content)
      .map((m) => {
        let text = cleanUserPrompt(m.content);
        text = text.replace(/^(?:⚡\s*\[Guidage\]\s*|📥\s*\[En attente\]\s*|\[Instruction Prioritaire de Guidage\]\s*:?\s*)+/, '');
        if (text.includes('\n\n[Image attachée :')) {
          text = text.split('\n\n[Image attachée :')[0];
        }
        if (text.includes('\n\n[Fichier attaché :')) {
          text = text.split('\n\n[Fichier attaché :')[0];
        }
        return text.trim();
      })
      .filter(Boolean);
  }, [messages]);

  // Workspace Panel (Drawer on demand)
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('files');
  const [agentActivityTimestamp, setAgentActivityTimestamp] = useState<number>(() => Date.now());

  const openRightPanel = React.useCallback((tab: RightPanelTab) => {
    setRightPanelTab(tab);
    setIsRightPanelOpen(true);
  }, []);

  const [pendingOpenFile, setPendingOpenFile] = useState<string | null>(null);
  const [isQuickOpenOpen, setIsQuickOpenOpen] = useState(false);
  const [workspaceSearchQuery, setWorkspaceSearchQuery] = useState('');
  const [workspaceSearchMode, setWorkspaceSearchMode] = useState<'find' | 'replace'>('find');

  useEffect(() => {
    const handleOpenFile = (e: any) => {
      setIsRightPanelOpen(true);
      setRightPanelTab('files');
      if (e?.detail?.path) {
        setPendingOpenFile(e.detail.path);
      }
    };
    const handleRunTerminal = () => {
      setIsRightPanelOpen(true);
      setRightPanelTab('terminal');
    };
    const handleQuickOpen = () => {
      setIsQuickOpenOpen(true);
    };
    const handleWorkspaceSearch = (e: any) => {
      setIsRightPanelOpen(true);
      setRightPanelTab('search');
      if (e?.detail?.query) {
        setWorkspaceSearchQuery(e.detail.query);
      }
      if (e?.detail?.mode) {
        setWorkspaceSearchMode(e.detail.mode);
      }
    };
    window.addEventListener('open-workspace-file', handleOpenFile);
    window.addEventListener('terminal-run-command', handleRunTerminal);
    window.addEventListener('open-quick-open', handleQuickOpen);
    window.addEventListener('open-workspace-search', handleWorkspaceSearch);
    return () => {
      window.removeEventListener('open-workspace-file', handleOpenFile);
      window.removeEventListener('terminal-run-command', handleRunTerminal);
      window.removeEventListener('open-quick-open', handleQuickOpen);
      window.removeEventListener('open-workspace-search', handleWorkspaceSearch);
    };
  }, []);

  // Authentication & Modals State
  const [isAuthenticated, setIsAuthenticated] = useState(true);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isArtifactsOpen, setIsArtifactsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(false);
  const [isFileExplorerOpen, setIsFileExplorerOpen] = useState(false);
  const [isTaskDashboardOpen, setIsTaskDashboardOpen] = useState(false);
  const [isCronModalOpen, setIsCronModalOpen] = useState(false);
  const [isRulesModalOpen, setIsRulesModalOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isAnalyticsOpen, setIsAnalyticsOpen] = useState(false);
  const [isContextCompactorOpen, setIsContextCompactorOpen] = useState(false);
  const [isBranchModalOpen, setIsBranchModalOpen] = useState(false);
  const [isMonacoStudioOpen, setIsMonacoStudioOpen] = useState(false);
  const [monacoStudioConfig, setMonacoStudioConfig] = useState<MonacoStudioConfig>({ mode: 'editor' });
  const [isFtsSearchOpen, setIsFtsSearchOpen] = useState(false);
  const [isMcpCatalogOpen, setIsMcpCatalogOpen] = useState(false);
  const [isDoctorOpen, setIsDoctorOpen] = useState(false);
  const [isRemoteAccessOpen, setIsRemoteAccessOpen] = useState(false);
  const [isGatewayOpen, setIsGatewayOpen] = useState(false);
  const [isWorktreeOpen, setIsWorktreeOpen] = useState(false);
  const [isCanvasStudioOpen, setIsCanvasStudioOpen] = useState(false);
  const [isVectorMemoryOpen, setIsVectorMemoryOpen] = useState(false);
  const [activeProgressCard, setActiveProgressCard] = useState<ProgressCardData | null>(null);

  // Global FTS search shortcut (Ctrl+Shift+K or Cmd+Shift+K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key.toLowerCase() === 'k' || e.key.toLowerCase() === 'f')) {
        e.preventDefault();
        setIsFtsSearchOpen((prev) => !prev);
      }
    };
    const handleOpenFts = () => setIsFtsSearchOpen(true);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('open-fts-search', handleOpenFts);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('open-fts-search', handleOpenFts);
    };
  }, []);

  const [sessionBookmarks, setSessionBookmarks] = useState<BookmarkItem[]>([]);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('models');
  const [activeGoogleAccount, setActiveGoogleAccount] = useState<GoogleAccountInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings>({});

  const handleGoogleAccountChanged = useCallback((acc: GoogleAccountInfo | null) => {
    setActiveGoogleAccount(acc);
  }, []);

  const handleOpenSkills = () => {
    setSettingsTab('skills');
    setIsSettingsOpen(true);
  };

  const handleOpenLanguages = () => {
    setSettingsTab('languages');
    setIsSettingsOpen(true);
  };

  const handleOpenGoogleAccount = () => {
    setSettingsTab('google');
    setIsSettingsOpen(true);
  };

  const handleOpenUpdates = () => {
    setSettingsTab('updates');
    setIsSettingsOpen(true);
  };

  // Switch Conversation
  const handleSelectConversation = async (convId: string, updateUrl = true) => {
    setIsMobileSidebarOpen(false);
    if (updateUrl) {
      navigateToConversation(convId);
    }
    activeConversationIdRef.current = convId;
    setActiveConversationId(convId);
    chatSocket.setCurrentConversation(convId);
    setPendingApproval(null);
    setQueueCount(0);
    setActiveProgressCard(null);
    try {
      // Load any active progress card for this conversation
      fetchProgressCard(convId).then((res) => {
        if (activeConversationIdRef.current === convId) {
          setActiveProgressCard(res?.card || null);
        }
      }).catch(() => {});

      const data = await fetchConversationTranscript(convId);
      
      // Prevent race conditions from rapid clicking
      if (activeConversationIdRef.current !== convId) return;
      
      const chatMsgs = parseStepsToMessages(data.steps || []);
      setMessages(chatMsgs);

      // Instantly set accurate token usage for selected conversation
      const normUsage = normalizeUsage(data.usage);
      if (normUsage && normUsage.totalTokens > 0) {
        setTokenUsage(normUsage);
      } else {
        setTokenUsage(estimateUsageFromMessages(chatMsgs));
      }

      // Initialize session bookmarks
      const bms = (data as any)?.meta?.bookmarks || (data as any)?.bookmarks || activeConv?.bookmarks || [];
      setSessionBookmarks(Array.isArray(bms) ? bms : []);

      // Automatically synchronize workspace to active conversation if available
      const rawWs = (data as any)?.workspace_uris || data.meta?.workspace_uris || activeConv?.workspace_uris;
      if (rawWs) {
        try {
          const parsed = typeof rawWs === 'string' ? JSON.parse(rawWs) : rawWs;
          const firstUri = Array.isArray(parsed) && parsed.length > 0 ? parsed[0] : (typeof parsed === 'string' ? parsed : null);
          if (firstUri && typeof firstUri === 'string') {
            const cleanWs = firstUri.replace(/^file:\/\//, '').trim();
            if (cleanWs && cleanWs.startsWith('/') && cleanWs !== currentWorkspace) {
              setCurrentWorkspace(cleanWs);
              try {
                localStorage.setItem('antigravity_workspace', cleanWs);
              } catch {}
            }
          }
        } catch {
          // ignore parsing error
        }
      }

      // Check if task is actively running in background on server
      if ((data as any).is_running) {
        setIsStreaming(true);
        chatSocket.sendAttach(convId);
      } else {
        setIsStreaming(false);
      }
    } catch (err) {
      console.error('Failed to load transcript:', err);
      setTokenUsage(undefined);
      setIsStreaming(false);
    }
  };

  const loadInitialData = async () => {
    try {
      const auth = await checkAuthStatus();
      if (auth.enabled && !auth.authenticated) {
        setIsAuthenticated(false);
        setIsAuthModalOpen(true);
        return;
      }
      setIsAuthenticated(true);
      setIsAuthModalOpen(false);
      chatSocket.connect();

      const [convs, mods, settings, googleRes] = await Promise.all([
        fetchConversations(100),
        fetchModels(),
        fetchSettings(),
        fetchGoogleAccounts().catch(() => ({ active_account: null, accounts: [] }))
      ]);
      setConversations(convs);
      setModels(mods);
      if (googleRes?.active_account) {
        setActiveGoogleAccount(googleRes.active_account);
      }
      setAppSettings(settings);

      // Harmonize model selection from settings
      if (settings.model && mods.length > 0) {
        const found = mods.find(
          (m) =>
            m.name === settings.model ||
            m.id === settings.model ||
            (settings.model ? settings.model.includes(m.name) || settings.model.includes(m.id) : false)
        );
        if (found) {
          setSelectedModel(found.id);
          if (settings.effort && ['low', 'medium', 'high'].includes(settings.effort)) {
            setSelectedEffort(settings.effort as any);
          } else {
            const lowerModel = settings.model.toLowerCase();
            if (lowerModel.includes('low')) {
              setSelectedEffort('low');
            } else if (lowerModel.includes('medium') || lowerModel.includes('med')) {
              setSelectedEffort('medium');
            } else {
              setSelectedEffort((found.default_effort as any) || 'medium');
            }
          }
        } else {
          setSelectedModel(mods[0].id);
          setSelectedEffort((mods[0].default_effort as any) || 'medium');
        }
      } else if (mods.length > 0) {
        setSelectedModel(mods[0].id);
        setSelectedEffort((mods[0].default_effort as any) || 'medium');
      }

      const savedWorkspace = (() => {
        try {
          return localStorage.getItem('antigravity_workspace');
        } catch {
          return null;
        }
      })();
      const defaultWs = settings.defaultWorkspace || (settings.trustedWorkspaces && settings.trustedWorkspaces[0]) || '';
      if (!savedWorkspace && defaultWs) {
        setCurrentWorkspace(defaultWs);
      } else if (savedWorkspace) {
        setCurrentWorkspace(savedWorkspace);
      }

      // Check if URL matches a conversation route (/c/:id or /chat/:id)
      const routeConvId = getConvIdFromPath(window.location.pathname);
      if (routeConvId) {
        await handleSelectConversation(routeConvId, false);
      }
    } catch (e) {
      console.error('Error loading initial data:', e);
    }
  };

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
    setIsAuthModalOpen(false);
    loadInitialData();
  };

  const handleLogout = () => {
    clearAuthToken();
    syncClient.disconnect();
    chatSocket.reconnect();
    setIsAuthenticated(false);
    setIsAuthModalOpen(true);
  };

  // Initialize
  useEffect(() => {
    applyAppearance(getStoredTheme(), getStoredSkin());
    Promise.resolve().then(() => {
      loadInitialData();
    });

    // Hermes background update check pattern: non-blocking, cached
    checkSystemUpdate(false).then((res) => {
      setUpdateInfo(res);
    }).catch(() => {});

    // Periodic check every 30 minutes
    const updateInterval = setInterval(() => {
      checkSystemUpdate(false).then((res) => {
        setUpdateInfo(res);
      }).catch(() => {});
    }, 30 * 60 * 1000);

    // Network resilience: online/offline detection
    const handleOnline = () => {
      showToast('Connexion rétablie — Antigravity en ligne', 'success');
      loadInitialData();
    };
    const handleOffline = () => {
      showToast('Mode hors-ligne — Connexion réseau indisponible', 'error');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      clearInterval(updateInterval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for session expiration or 401 Unauthorized across all API calls
  useEffect(() => {
    const handleUnauthorized = () => {
      setIsAuthenticated(false);
      setIsAuthModalOpen(true);
    };
    window.addEventListener('antigravity:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('antigravity:unauthorized', handleUnauthorized);
    };
  }, []);

  // Track WebSocket connection status for reconnection banner
  useEffect(() => {
    return chatSocket.onStatusChange(setWsStatus);
  }, []);

  // SSE real-time sync: CLI ↔ WebUI
  // Subscribes to filesystem change events pushed by the backend watcher.
  useEffect(() => {
    syncClient.connect();

    const unsubscribe = syncClient.subscribe((event) => {
      if (event.type === 'conversations_updated') {
        // Refresh sidebar without disrupting active chat
        fetchConversations(100).then((c) => setConversations(c)).catch(() => {});
      } else if (event.type === 'artifacts_updated') {
        // Dispatch custom event for WorkspacePanel & artifact viewers
        window.dispatchEvent(new CustomEvent('antigravity:artifacts_updated', { detail: event }));
      } else if (event.type === 'transcript_updated' && event.conversation_id) {
        const convId = event.conversation_id;
        // Only reload transcript if it's the active conversation AND we're not streaming
        if (convId === activeConversationIdRef.current && !isStreamingRef.current) {
          fetchConversationTranscript(convId).then((data) => {
            if (activeConversationIdRef.current !== convId) return;
            const chatMsgs = parseStepsToMessages(data.steps || []);
            setMessages(chatMsgs);
            const normUsage = normalizeUsage(data.usage);
            if (normUsage && normUsage.totalTokens > 0) {
              setTokenUsage(normUsage);
            } else {
              setTokenUsage(estimateUsageFromMessages(chatMsgs));
            }
          }).catch(() => {});
        }
      }
    });

    return () => {
      unsubscribe();
      syncClient.disconnect();
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Browser History Back / Forward navigation (popstate)
  useEffect(() => {
    const handlePopState = () => {
      const convId = getConvIdFromPath(window.location.pathname);
      if (convId) {
        handleSelectConversation(convId, false);
      } else {
        setActiveConversationId(null);
        setMessages([]);
        setTokenUsage(undefined);
        setQueueCount(0);
        setPendingApproval(null);
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Synchronize browser tab title with active conversation
  useEffect(() => {
    const activeConv = conversations.find((c) => c.conversation_id === activeConversationId);
    const title = activeConv?.customTitle || activeConv?.title;
    if (title) {
      document.title = `${title} · Antigravity`;
    } else {
      document.title = 'Antigravity WebUI';
    }
  }, [activeConversationId, conversations]);


  const handleNewConversation = () => {
    setIsMobileSidebarOpen(false);
    navigateToConversation(null);
    activeConversationIdRef.current = null;
    setActiveConversationId(null);
    chatSocket.setCurrentConversation(null);
    setMessages([]);
    setTokenUsage(undefined);
    setQueueCount(0);
    setPendingApproval(null);
    setIsStreaming(false);
    setActiveProgressCard(null);
  };

  // WebSocket event handler — subscribe once, use ref for conversation id
  useEffect(() => {
    const unsubscribe = chatSocket.subscribe((event: any) => {
      // 0. Handshake / Re-attachment upon connection
      if (event.event === 'connected') {
        if (event.active_conversations && Array.isArray(event.active_conversations)) {
          const runningSet = new Set(event.active_conversations);
          setConversations((prev) =>
            prev.map((c) => ({ ...c, is_running: runningSet.has(c.conversation_id) }))
          );
        }
        if (event.active_turn && event.active_turn.is_running) {
          const turnCid = event.active_turn.conversation_id;
          if (!activeConversationIdRef.current && turnCid) {
            activeConversationIdRef.current = turnCid;
            setActiveConversationId(turnCid);
            chatSocket.setCurrentConversation(turnCid);
            navigateToConversation(turnCid, true);
          }
          if (!activeConversationIdRef.current || activeConversationIdRef.current === turnCid) {
            setIsStreaming(true);
            if (typeof event.active_turn.queue_size === 'number') {
              setQueueCount(event.active_turn.queue_size);
            }
            const live = event.active_turn.live_state;
            if (live) {
              if (live.progress_card !== undefined) setActiveProgressCard(live.progress_card);
              if (live.pending_approval) setPendingApproval(live.pending_approval);
              if (live.usage) {
                const norm = normalizeUsage(live.usage);
                if (norm) setTokenUsage(norm);
              }
              const hasContent = live.content || live.thought || (live.tool_calls && live.tool_calls.length > 0);
              if (hasContent) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'assistant') {
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...last,
                        thought: live.thought || last.thought,
                        content: live.content || last.content,
                        toolCalls: (live.tool_calls && live.tool_calls.length > 0) ? live.tool_calls : last.toolCalls,
                        isLive: true
                      }
                    ];
                  } else {
                    return [
                      ...prev,
                      {
                        id: `live-assistant-${Date.now()}`,
                        role: 'assistant',
                        content: live.content || '',
                        thought: live.thought || '',
                        toolCalls: live.tool_calls || [],
                        isLive: true,
                        timestamp: new Date().toISOString()
                      }
                    ];
                  }
                });
              }
            }
            if (turnCid) {
              chatSocket.sendAttach(turnCid);
            }
          }
        }
      } else if (event.event === 'attached') {
        const attachedCid = event.conversation_id;
        if (!activeConversationIdRef.current || activeConversationIdRef.current === attachedCid) {
          if (event.is_running) {
            setIsStreaming(true);
            if (typeof event.queue_size === 'number') {
              setQueueCount(event.queue_size);
            }
            const live = event.live_state;
            if (live) {
              if (live.progress_card !== undefined) setActiveProgressCard(live.progress_card);
              if (live.pending_approval) setPendingApproval(live.pending_approval);
              if (live.usage) {
                const norm = normalizeUsage(live.usage);
                if (norm) setTokenUsage(norm);
              }
              const hasContent = live.content || live.thought || (live.tool_calls && live.tool_calls.length > 0);
              if (hasContent) {
                setMessages((prev) => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'assistant') {
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...last,
                        thought: live.thought || last.thought,
                        content: live.content || last.content,
                        toolCalls: (live.tool_calls && live.tool_calls.length > 0) ? live.tool_calls : last.toolCalls,
                        isLive: true
                      }
                    ];
                  } else {
                    return [
                      ...prev,
                      {
                        id: `live-assistant-${Date.now()}`,
                        role: 'assistant',
                        content: live.content || '',
                        thought: live.thought || '',
                        toolCalls: live.tool_calls || [],
                        isLive: true,
                        timestamp: new Date().toISOString()
                      }
                    ];
                  }
                });
              }
            }
          } else {
            setIsStreaming(false);
          }
        }
      } else if (event.event === 'init') {
        if (event.conversation_id && !activeConversationIdRef.current) {
          activeConversationIdRef.current = event.conversation_id;
          setActiveConversationId(event.conversation_id);
          chatSocket.setCurrentConversation(event.conversation_id);
          navigateToConversation(event.conversation_id, true);
        }
      } else if (event.event === 'step_update') {
        const update = event.step_update;
        if (!update) return;
        setAgentActivityTimestamp(Date.now());

        if (update.conversation_id && !activeConversationIdRef.current) {
          activeConversationIdRef.current = update.conversation_id;
          setActiveConversationId(update.conversation_id);
          chatSocket.setCurrentConversation(update.conversation_id);
          navigateToConversation(update.conversation_id, true);
        } else if (update.conversation_id && activeConversationIdRef.current && update.conversation_id !== activeConversationIdRef.current) {
          return;
        }

        // Live Context & Token Telemetry
        if (update.usage) {
          const norm = normalizeUsage(update.usage);
          if (norm) setTokenUsage(norm);
        }

        // Approval requested via tool step
        if (update.step_type === 'permission_request' || update.step_type === 'ask_permission') {
          setPendingApproval({
            toolName: update.tool_name || 'Action Requise',
            command: update.command,
            path: update.path,
          });
        }

        // 1. Tool Call real-time updates (ACTIVE / DONE)
        if (update.step_type === 'tool') {
          const toolName = update.tool_name || update.tool_info?.name || 'tool';
          const toolArgs = update.tool_info?.parameters || update.parameters;
          const toolOutput = update.tool_info?.output;
          const isDone = update.state === 'DONE';

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') {
              return [
                ...prev,
                {
                  id: `live-assistant-${Date.now()}`,
                  role: 'assistant',
                  content: '',
                  thought: '',
                  toolCalls: [{
                    name: toolName,
                    args: toolArgs,
                    result: toolOutput,
                    status: isDone ? 'done' : 'running'
                  }],
                  isLive: true,
                  timestamp: new Date().toISOString()
                }
              ];
            }

            const currentTools = [...(last.toolCalls || [])];
            const runningIdx = currentTools.findIndex(
              (t) => t.name === toolName && t.status === 'running'
            );

            if (isDone) {
              if (runningIdx >= 0) {
                currentTools[runningIdx] = {
                  ...currentTools[runningIdx],
                  status: 'done',
                  result: toolOutput
                };
              } else {
                currentTools.push({
                  name: toolName,
                  args: toolArgs,
                  result: toolOutput,
                  status: 'done'
                });
              }
            } else {
              // ACTIVE tool
              if (runningIdx === -1) {
                currentTools.push({
                  name: toolName,
                  args: toolArgs,
                  status: 'running'
                });
              }
            }

            return [
              ...prev.slice(0, -1),
              {
                ...last,
                toolCalls: currentTools,
                isLive: true
              }
            ];
          });
        }

        // 2. Thinking / Planner real-time updates
        if (update.thinking) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                thought: (last.thought || '') + update.thinking,
                isLive: true
              }
            ];
          });
        }

        // 3. Agent response real-time text streaming
        if (update.step_type === 'agent_response' && update.text_delta) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + update.text_delta, isLive: true }
              ];
            } else {
              return [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: 'assistant',
                  content: update.text_delta,
                  thought: '',
                  toolCalls: [],
                  isLive: true,
                  timestamp: new Date().toISOString()
                }
              ];
            }
          });
        }
      } else if (event.event === 'result') {
        setAgentActivityTimestamp(Date.now());
        const res = event.result;
        if (res?.usage) {
          const norm = normalizeUsage(res.usage);
          if (norm) setTokenUsage(norm);
        }
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: (res?.response && res.response.trim().length > 0) ? res.response : last.content,
                isLive: false
              }
            ];
          } else {
            return [
              ...prev,
              {
                id: `res-${Date.now()}`,
                role: 'assistant',
                content: res?.response || '',
                thought: '',
                toolCalls: [],
                isLive: false,
                timestamp: new Date().toISOString()
              }
            ];
          }
        });
        // Refresh conversations in sidebar
        fetchConversations(100).then((c) => setConversations(c));
      } else if (event.event === 'command_result') {
        const cmd = event.command || {};
        const cName = cmd.name;
        const cData = cmd.data || {};
        let formatted = '';

        if (cName === 'usage') {
          const lines = ['### 📊 Quotas & Limites Antigravity (Google Cloud)\n'];
          if (cData.description) lines.push(`> ${cData.description}\n`);
          for (const g of cData.groups || []) {
            lines.push(`#### ${g.name || 'Groupe'}`);
            lines.push('| Limite | Restant | Réinitialisation |');
            lines.push('| :--- | :---: | :--- |');
            for (const b of g.buckets || []) {
              const pct = Math.round((b.remaining_fraction || 0) * 100);
              lines.push(`| **${b.name || 'Quota'}** | \`${pct}%\` | \`${b.reset_time || 'N/A'}\` |`);
            }
            lines.push('');
          }
          formatted = lines.join('\n');
        } else if (cName === 'credits') {
          const rem = cData.remaining_credits ?? 0;
          const uri = cData.upgrade_uri || 'https://antigravity.google/g1-upgrade';
          formatted = `### 💳 Crédits Antigravity G1\n\n- **Crédits restants :** \`${rem}\`\n- **Lien de recharge :** [Portail G1](${uri})`;
        } else if (cName === 'changelog') {
          formatted = `### 📜 Journal des Modifications\n\n${cData.changelog || 'Aucun journal disponible.'}`;
        } else {
          formatted = `\`\`\`json\n${JSON.stringify(cmd, null, 2)}\n\`\`\``;
        }

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              { ...last, content: formatted, isLive: false }
            ];
          } else {
            return [
              ...prev,
              {
                id: `cmd-${Date.now()}`,
                role: 'assistant',
                content: formatted,
                thought: '',
                toolCalls: [],
                isLive: false,
                timestamp: new Date().toISOString()
              }
            ];
          }
        });
      } else if (event.event === 'approval_request') {
        if (!event.conversation_id || !activeConversationIdRef.current || event.conversation_id === activeConversationIdRef.current) {
          setPendingApproval({
            toolName: event.tool_name || 'Action système',
            command: event.command,
            path: event.path,
          });
        }
      } else if (event.event === 'approval_resolved') {
        if (!event.conversation_id || !activeConversationIdRef.current || event.conversation_id === activeConversationIdRef.current) {
          setPendingApproval(null);
        }
      } else if (event.event === 'progress_card') {
        if (!event.conversation_id || !activeConversationIdRef.current || event.conversation_id === activeConversationIdRef.current) {
          setActiveProgressCard(event.card || null);
        }
      } else if (event.event === 'queued') {
        if (typeof event.queue_size === 'number') {
          setQueueCount(event.queue_size);
        }
      } else if (event.event === 'steered') {
        setIsStreaming(true);
      } else if (event.event === 'model_failover') {
        setPendingApproval(null);
        showToast(
          `🔄 Quota atteint avec ${event.previous_model}. Basculement automatique sur ${event.new_model} et relance...`,
          'info'
        );
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            const notice = `\n\n> 🔄 **Basculement automatique de modèle :** Quota atteint avec \`${event.previous_model}\`. Poursuite immédiate de l'exécution avec \`${event.new_model}\`...\n\n`;
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: '',
                toolCalls: [],
                thought: (last.thought || '') + notice,
                isLive: true
              }
            ];
          }
          return prev;
        });
        setIsStreaming(true);
      } else if (event.event === 'account_failover') {
        setPendingApproval(null);
        showToast(
          `🔄 Quota atteint sur ${event.previous_account}. Basculement automatique sur ${event.new_account} et relance...`,
          'info'
        );
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            const notice = `\n\n> 🔄 **Basculement automatique de compte :** Quota atteint sur \`${event.previous_account}\`. Poursuite immédiate de l'exécution avec \`${event.new_account}\`...\n\n`;
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: '',
                toolCalls: [],
                thought: (last.thought || '') + notice,
                isLive: true
              }
            ];
          }
          return prev;
        });
        setIsStreaming(true);
      } else if (event.event === 'interrupted') {
        setIsStreaming(false);
        setQueueCount(0);
        setPendingApproval(null);
        setLoopWarning(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.isLive) {
            return [
              ...prev.slice(0, -1),
              { ...last, isLive: false }
            ];
          }
          return prev;
        });
      } else if (event.event === 'loop_warning') {
        setLoopWarning({
          errorCount: event.consecutive_errors || 3,
          message: event.message || "Boucle d'erreurs détectée (3 échecs consécutifs)."
        });
      } else if (event.event === 'queue_cleared') {
        setQueueCount(0);
      } else if (event.event === 'error') {
        if (event.conversation_id && activeConversationIdRef.current && event.conversation_id !== activeConversationIdRef.current) {
          return;
        }
        setIsStreaming(false);
        setPendingApproval(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [
              ...prev.slice(0, -1),
              {
                ...last,
                content: last.content
                  ? `${last.content}\n\n⚠️ **Erreur :** ${event.message || 'Une erreur est survenue.'}`
                  : `⚠️ **Erreur :** ${event.message || 'Une erreur est survenue.'}`,
                isLive: false
              }
            ];
          }
          return [
            ...prev,
            {
              id: `err-${Date.now()}`,
              role: 'assistant',
              content: `⚠️ **Erreur :** ${event.message || 'Une erreur est survenue.'}`,
              isLive: false
            }
          ];
        });
      } else if (event.event === 'done') {
        if (event.conversation_id && activeConversationIdRef.current && event.conversation_id !== activeConversationIdRef.current) {
          return;
        }
        if (typeof event.queue_size === 'number') {
          setQueueCount(event.queue_size);
          if (event.queue_size === 0) {
            setIsStreaming(false);
          }
        } else {
          setIsStreaming(false);
        }
        setPendingApproval(null);
        setLoopWarning(null);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && last.isLive) {
            return [
              ...prev.slice(0, -1),
              { ...last, isLive: false }
            ];
          }
          return prev;
        });
      } else if (event.event === 'pong') {
        if (event.active_conversations && Array.isArray(event.active_conversations)) {
          const runningSet = new Set(event.active_conversations);
          setConversations((prev) =>
            prev.map((c) => ({ ...c, is_running: runningSet.has(c.conversation_id) }))
          );
        }
        if (typeof event.queue_size === 'number' && event.conversation_id === activeConversationIdRef.current) {
          setQueueCount(event.queue_size);
        }
        if (typeof event.is_running === 'boolean' && event.conversation_id === activeConversationIdRef.current) {
          if (!event.is_running && isStreamingRef.current) {
            setIsStreaming(false);
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);  // ← empty deps: subscribe once, use refs for mutable state

  // Send message
  const handleSendMessage = useCallback((
    prompt: string,
    options: {
      model?: string;
      effort?: string;
      autoApprove?: boolean;
      mode?: 'normal' | 'queue' | 'steer';
      eco_mode?: boolean;
    }
  ) => {
    const mode = options.mode || 'normal';
    const displayPrefix =
      mode === 'steer' ? '⚡ [Guidage] ' : mode === 'queue' ? '📥 [En attente] ' : '';

    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: `${displayPrefix}${prompt}`,
      timestamp: new Date().toISOString()
    };

    const liveMsgId = mode !== 'queue' ? `live-assistant-${Date.now()}` : null;
    const liveAssistantMsg: ChatMessage | null = liveMsgId ? {
      id: liveMsgId,
      role: 'assistant',
      content: '',
      thought: '',
      toolCalls: [],
      isLive: true,
      timestamp: new Date().toISOString()
    } : null;

    if (mode === 'queue') {
      setMessages((prev) => [...prev, userMsg]);
      setQueueCount((prev) => prev + 1);
    } else if (mode === 'steer') {
      // Steer mode: cleanly close the previous turn and open a steered assistant bubble
      setMessages((prev) => {
        const finalized = prev.map((m) => (m.isLive ? { ...m, isLive: false } : m));
        return liveAssistantMsg ? [...finalized, userMsg, liveAssistantMsg] : [...finalized, userMsg];
      });
      setIsStreaming(true);
    } else {
      setMessages((prev) => (liveAssistantMsg ? [...prev, userMsg, liveAssistantMsg] : [...prev, userMsg]));
      setIsStreaming(true);
    }

    try {
      chatSocket.sendPrompt({
        prompt,
        conversationId: activeConversationId || undefined,
        workspacePath: currentWorkspace,
        model: options.model,
        effort: options.effort,
        autoApprove: options.autoApprove,
        mode: options.mode,
        eco_mode: options.eco_mode
      });
    } catch (e: any) {
      // WebSocket not ready (reconnecting) — inform the user instead of silently losing the prompt
      showToast(e?.message || 'Connexion WebSocket indisponible : message non envoyé.', 'error');
      setIsStreaming(false);
      if (liveMsgId) {
        setMessages((prev) => prev.filter((m) => m.id !== liveMsgId));
      }
      if (mode === 'queue') {
        setQueueCount((prev) => Math.max(0, prev - 1));
      }
    }
  }, [activeConversationId, currentWorkspace]);

  const handleStopStreaming = () => {
    chatSocket.sendInterrupt(activeConversationId || undefined);
    setIsStreaming(false);
    setQueueCount(0);
    setPendingApproval(null);
  };

  const handleClearQueue = () => {
    chatSocket.sendClearQueue(activeConversationId || undefined);
    setQueueCount(0);
  };

  const handleSelectModel = (newModelId: string) => {
    setSelectedModel(newModelId);
    const found = models.find((m) => m.id === newModelId);
    if (found) {
      let nextEffort = selectedEffort;
      if (found.supported_efforts && found.supported_efforts.length > 0) {
        if (!found.supported_efforts.includes(selectedEffort)) {
          nextEffort = (found.default_effort as any) || found.supported_efforts[0];
          setSelectedEffort(nextEffort);
        }
      }
      fetchSettings().then((currentSettings) => {
        saveSettings({ ...currentSettings, model: found.name, effort: nextEffort }).catch((err) => {
          console.error("Failed to save model settings:", err);
          showToast('Erreur lors de la sauvegarde du modèle', 'error');
        });
      }).catch((err) => {
        console.error("Failed to fetch settings for model change:", err);
        showToast('Erreur lors de la récupération des paramètres', 'error');
      });
    }
  };

  const handleSelectEffort = (newEffort: 'low' | 'medium' | 'high') => {
    setSelectedEffort(newEffort);
    const currentModelObj = models.find((m) => m.id === selectedModel) ||
      models.find((m) => selectedModel.startsWith(m.id)) ||
      models[0];
    if (currentModelObj) {
      fetchSettings().then((currentSettings) => {
        saveSettings({ ...currentSettings, model: currentModelObj.name, effort: newEffort }).catch((err) => {
          console.error("Failed to save effort settings:", err);
          showToast("Erreur lors de la sauvegarde de l'effort de réflexion", 'error');
        });
      }).catch((err) => {
        console.error("Failed to fetch settings for effort change:", err);
        showToast('Erreur lors de la récupération des paramètres', 'error');
      });
    }
  };

  const handleModelSavedFromSettings = (newModelId: string) => {
    handleSelectModel(newModelId);
  };

  const handleInsertPath = (pathWithPrefix: string) => {
    setQuickPrompt((prev) => (prev ? `${prev} ${pathWithPrefix}` : pathWithPrefix));
  };

  // Stable panel-opening callbacks (keeps ChatCanvas markdown components memoized)
  const handleOpenFilesPanel = React.useCallback(() => openRightPanel('files'), [openRightPanel]);
  const handleOpenArtifactsPanel = React.useCallback(() => openRightPanel('artifacts'), [openRightPanel]);
  const handleOpenTerminalPanel = React.useCallback(() => openRightPanel('terminal'), [openRightPanel]);
  const handleOpenGitPanel = React.useCallback(() => openRightPanel('git'), [openRightPanel]);
  const handleOpenKanbanPanel = React.useCallback(() => openRightPanel('kanban'), [openRightPanel]);
  const handleToggleRightPanel = React.useCallback(() => setIsRightPanelOpen((prev) => !prev), []);
  const handleToggleMobileSidebar = React.useCallback(() => setIsMobileSidebarOpen((prev) => !prev), []);

  // ── Global Keyboard Shortcuts ──────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Ctrl+K — Focus search / quick prompt
      if (mod && e.key === 'k') {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('[data-shortcut="search"]');
        if (searchInput) {
          searchInput.focus();
          searchInput.select();
        }
        return;
      }

      // Ctrl+P — Quick Open files palette
      if (mod && !shift && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setIsQuickOpenOpen((prev) => !prev);
        return;
      }

      // Ctrl+Shift+N — New conversation
      if (mod && shift && e.key === 'N') {
        e.preventDefault();
        handleNewConversation();
        return;
      }

      // Ctrl+Shift+S — Open settings
      if (mod && shift && e.key === 'S') {
        e.preventDefault();
        setSettingsTab('models');
        setIsSettingsOpen((prev) => !prev);
        return;
      }

      // Ctrl+Shift+E — Toggle workspace panel
      if (mod && shift && e.key === 'E') {
        e.preventDefault();
        setIsRightPanelOpen((prev) => !prev);
        return;
      }

      // Ctrl+Shift+F — Global Search in Workspace
      if (mod && shift && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        setIsRightPanelOpen(true);
        setRightPanelTab('search');
        setWorkspaceSearchMode('find');
        return;
      }

      // Ctrl+Shift+H — Global Replace in Workspace
      if (mod && shift && (e.key === 'H' || e.key === 'h')) {
        e.preventDefault();
        setIsRightPanelOpen(true);
        setRightPanelTab('search');
        setWorkspaceSearchMode('replace');
        return;
      }

      // Ctrl+Alt+W — Project Switcher Studio
      if (mod && e.altKey && (e.key === 'w' || e.key === 'W')) {
        e.preventDefault();
        setIsWorkspacesOpen((prev) => !prev);
        return;
      }

      // Escape — Close active modal
      if (e.key === 'Escape') {
        if (isQuickOpenOpen) { setIsQuickOpenOpen(false); return; }
        if (isSettingsOpen) { setIsSettingsOpen(false); return; }
        if (isAnalyticsOpen) { setIsAnalyticsOpen(false); return; }
        if (isHelpOpen) { setIsHelpOpen(false); return; }
        if (isArtifactsOpen) { setIsArtifactsOpen(false); return; }
        if (isWorkspacesOpen) { setIsWorkspacesOpen(false); return; }
        if (isFileExplorerOpen) { setIsFileExplorerOpen(false); return; }
        if (isTaskDashboardOpen) { setIsTaskDashboardOpen(false); return; }
        if (isCronModalOpen) { setIsCronModalOpen(false); return; }
        if (isRulesModalOpen) { setIsRulesModalOpen(false); return; }
        if (isSessionMetaOpen) { setIsSessionMetaOpen(false); return; }
        if (isBranchModalOpen) { setIsBranchModalOpen(false); return; }
        if (isMcpCatalogOpen) { setIsMcpCatalogOpen(false); return; }
        if (isDoctorOpen) { setIsDoctorOpen(false); return; }
        if (isRemoteAccessOpen) { setIsRemoteAccessOpen(false); return; }
        if (isGatewayOpen) { setIsGatewayOpen(false); return; }
        if (isWorktreeOpen) { setIsWorktreeOpen(false); return; }
        if (isRightPanelOpen) { setIsRightPanelOpen(false); return; }
        if (isMobileSidebarOpen) { setIsMobileSidebarOpen(false); return; }
        return;
      }

      // ? — Toggle help (only when not typing)
      if (e.key === '?' && !isInput && !mod) {
        e.preventDefault();
        setIsHelpOpen((prev) => !prev);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    isSettingsOpen, isAnalyticsOpen, isHelpOpen, isArtifactsOpen, isWorkspacesOpen,
    isFileExplorerOpen, isTaskDashboardOpen, isCronModalOpen, isRulesModalOpen,
    isSessionMetaOpen, isBranchModalOpen, isRightPanelOpen, isMobileSidebarOpen,
    isQuickOpenOpen, isMcpCatalogOpen, isDoctorOpen,
    isRemoteAccessOpen, isGatewayOpen, isWorktreeOpen,
  ]);

  // Phase 3 Session Handlers (Fork, Pin, Tags, Project, Search)
  const handleTogglePin = async (convId: string, currentPin: boolean) => {
    try {
      await updateConversationMetadata(convId, { pinned: !currentPin });
      setConversations((prev) =>
        prev.map((c) => (c.conversation_id === convId ? { ...c, pinned: !currentPin } : c))
      );
      const convs = await fetchConversations(100);
      setConversations(convs);
    } catch (e) {
      console.error('Failed to toggle pin:', e);
    }
  };

  const handleEditSessionMeta = useCallback((conv?: Conversation | null) => {
    setMetaTargetConversation(conv || activeConv || null);
    setIsSessionMetaOpen(true);
  }, [activeConv]);

  const handleAddBookmark = useCallback(async (stepIndex: number, label: string, preview?: string) => {
    if (!activeConversationId) return;
    try {
      const res = await addConversationBookmark(activeConversationId, stepIndex, label, preview);
      setSessionBookmarks(res.bookmarks);
      showToast('Signet enregistré avec succès', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l’enregistrement du signet', 'error');
    }
  }, [activeConversationId]);

  const handleRemoveBookmark = useCallback(async (bookmarkId: string) => {
    if (!activeConversationId) return;
    try {
      const res = await removeConversationBookmark(activeConversationId, bookmarkId);
      setSessionBookmarks(res.bookmarks);
      showToast('Signet supprimé', 'info');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression du signet', 'error');
    }
  }, [activeConversationId]);

  const handleForkMessage = async (stepIndex: number) => {
    if (!activeConversationId) return;
    try {
      setIsStreaming(true);
      const res = await forkConversation(activeConversationId, stepIndex);
      const convs = await fetchConversations(100);
      setConversations(convs);
      await handleSelectConversation(res.conversation_id);
    } catch (e: any) {
      showToast(`Erreur lors de la bifurcation : ${e.message}`, 'error');
    } finally {
      setIsStreaming(false);
    }
  };

  const handleSearchQuery = async (query: string) => {
    try {
      const results = await fetchConversations(100, query);
      setConversations(results);
    } catch (e) {
      console.error('Failed to search conversations:', e);
    }
  };

  const [isCompacting, setIsCompacting] = useState(false);

  const handleCompactConversation = React.useCallback(async () => {
    if (!activeConversationId) {
      showToast('Aucune conversation active à compacter.', 'warning');
      return;
    }
    try {
      setIsCompacting(true);
      const res = await enforceContextBudget(
        activeConversationId,
        appSettings.contextBudgetTokens,
        appSettings.preserveLastNTurns
      );
      if (res.action_taken && res.tokens_saved > 0) {
        showToast(`Budget de contexte appliqué : -${res.tokens_saved.toLocaleString()} tokens (-${res.reduction_pct}%) !`, 'success');
      } else {
        showToast("Le contexte respecte déjà le budget configuré. Historique optimal.", 'info');
      }
      const freshData = await fetchConversationTranscript(activeConversationId);
      const parsed = parseStepsToMessages(freshData?.steps || []);
      setMessages(parsed);
      const normUsage = normalizeUsage(freshData?.usage);
      if (normUsage && normUsage.totalTokens > 0) {
        setTokenUsage(normUsage);
      } else {
        setTokenUsage(estimateUsageFromMessages(parsed));
      }
    } catch (e: any) {
      showToast(e.message || 'Échec du compactage', 'error');
    } finally {
      setIsCompacting(false);
    }
  }, [activeConversationId, appSettings.contextBudgetTokens, appSettings.preserveLastNTurns]);

  const handlePruneSuccess = useCallback(async (result: PruneResult) => {
    if (!activeConversationId) return;
    showToast(`Contexte élagué : -${result.tokens_saved.toLocaleString()} tokens (-${result.reduction_pct}%) !`, 'success');
    try {
      const freshData = await fetchConversationTranscript(activeConversationId);
      const parsed = parseStepsToMessages(freshData?.steps || []);
      setMessages(parsed);
      const normUsage = normalizeUsage(freshData?.usage);
      if (normUsage && normUsage.totalTokens > 0) {
        setTokenUsage(normUsage);
      } else {
        setTokenUsage(estimateUsageFromMessages(parsed));
      }
    } catch (err) {
      console.error('Failed to reload transcript after pruning:', err);
    }
  }, [activeConversationId]);

  const handleShowStatusCard = () => {
    const currentModelObj = models.find((m) => m.id === selectedModel) ||
      models.find((m) => selectedModel.startsWith(m.id)) ||
      models[0];
    const statusContent = [
      '### 📊 État du Serveur Antigravity & Session',
      `- **ID Session :** \`${activeConversationId || 'Session locale / Active'}\``,
      `- **Modèle actif :** **${currentModelObj?.name || selectedModel}**`,
      `- **Effort de réflexion :** \`${selectedEffort}\``,
      `- **Workspace actif :** \`${currentWorkspace || 'Défaut serveur'}\``,
      `- **Tokens estimés :** ${tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : '0'} tokens (${tokenUsage?.inputTokens ? tokenUsage.inputTokens.toLocaleString() : 0} in / ${tokenUsage?.outputTokens ? tokenUsage.outputTokens.toLocaleString() : 0} out)`,
      `- **Messages :** ${messages.length}`,
      `- **Statut d'exécution :** ${isStreaming ? '⚡ **En cours de streaming**' : '🟢 **Prêt / En attente**'}`
    ].join('\n');

    const statusMsg: ChatMessage = {
      id: `status-${Date.now()}`,
      role: 'assistant',
      content: statusContent,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, statusMsg]);
  };

  const handleShowUsageCard = async (type: 'usage' | 'quota' | 'credits' | 'changelog' = 'usage') => {
    const userCmd = type === 'credits' ? '/credits' : type === 'changelog' ? '/changelog' : '/usage';
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: userCmd,
      timestamp: new Date().toISOString()
    };

    const loadingId = `usage-${Date.now()}`;
    const loadingMsg: ChatMessage = {
      id: loadingId,
      role: 'assistant',
      content: '⏳ **Interrogation des quotas et métriques Antigravity en temps réel...**',
      isLive: true,
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);

    try {
      if (type === 'credits') {
        const data = await fetchCredits();
        const rem = data?.command?.data?.remaining_credits ?? 0;
        const uri = data?.command?.data?.upgrade_uri ?? 'https://antigravity.google/g1-upgrade';
        const content = [
          '### 💳 Crédits Antigravity G1',
          `- **Crédits disponibles :** \`${rem}\``,
          `- **Lien de souscription / recharge :** [Accéder au portail de recharge G1](${uri})`,
          '',
          '> Les crédits G1 vous permettent d’exécuter des requêtes à haute puissance même lorsque les quotas standard sont temporairement épuisés.'
        ].join('\n');

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? { ...m, content, isLive: false } : m))
        );
        return;
      }

      if (type === 'changelog') {
        const data = await fetchChangelog();
        const raw = data?.response || data?.command?.data?.changelog || 'Aucune note de version disponible.';
        const parts = raw.split(/^##\s+/m);
        const excerpt = parts.slice(0, 4).join('## ');
        const content = [
          '### 📜 Journal des Modifications Antigravity CLI',
          excerpt.trim(),
          '',
          '*Pour consulter l’historique complet, exécutez `agy changelog` dans le terminal.*'
        ].join('\n');

        setMessages((prev) =>
          prev.map((m) => (m.id === loadingId ? { ...m, content, isLive: false } : m))
        );
        return;
      }

      // Default: /usage or /quota
      const data = await fetchUsageQuota();
      const cmdData = data?.command?.data;
      const groups = cmdData?.groups || [];

      const totalTok = tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : '0';
      const inTok = tokenUsage?.inputTokens ? tokenUsage.inputTokens.toLocaleString() : '0';
      const outTok = tokenUsage?.outputTokens ? tokenUsage.outputTokens.toLocaleString() : '0';
      const thinkTok = tokenUsage?.thinkingTokens ? tokenUsage.thinkingTokens.toLocaleString() : '0';

      const lines: string[] = ['### 📊 Quotas Antigravity & Consommation de Tokens\n'];

      lines.push('#### 💬 Consommation de la Discussion Active');
      lines.push(`- **Total Tokens consommés :** **${totalTok}** tokens`);
      lines.push(`- **Entrée (Prompts & Contexte) :** \`${inTok}\` tokens`);
      lines.push(`- **Sortie (Réponses de l'IA) :** \`${outTok}\` tokens`);
      if (tokenUsage?.thinkingTokens) {
        lines.push(`- **Réflexion (Thinking CoT) :** \`${thinkTok}\` tokens`);
      }
      lines.push('');

      if (groups.length > 0) {
        lines.push('#### 🌐 Quotas Globaux des Modèles (Google Cloud)');
        if (cmdData?.description) {
          lines.push(`> ${cmdData.description}\n`);
        }
        for (const g of groups) {
          lines.push(`##### ${g.name}`);
          lines.push('| Fenêtre de Quota | Restant | Prochaine Réinitialisation |');
          lines.push('| :--- | :---: | :--- |');
          for (const b of g.buckets || []) {
            const pct = Math.round((b.remaining_fraction || 0) * 100);
            const resetTime = b.reset_time ? new Date(b.reset_time).toLocaleString() : 'N/A';
            const statusIcon = pct > 50 ? '🟢' : pct > 20 ? '🟡' : '🔴';
            lines.push(`| **${b.name}** | ${statusIcon} **${pct}%** | \`${resetTime}\` |`);
          }
          lines.push('');
        }
      } else if (data?.response) {
        lines.push('#### 🌐 Quotas Antigravity');
        lines.push('```\n' + data.response + '\n```');
      }

      const content = lines.join('\n');
      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { ...m, content, isLive: false } : m))
      );
    } catch {
      const totalTok = tokenUsage?.totalTokens ? tokenUsage.totalTokens.toLocaleString() : '0';
      const inTok = tokenUsage?.inputTokens ? tokenUsage.inputTokens.toLocaleString() : '0';
      const outTok = tokenUsage?.outputTokens ? tokenUsage.outputTokens.toLocaleString() : '0';

      const fallbackContent = [
        '### 📊 Métriques de Consommation de Tokens',
        `- **Total Tokens :** **${totalTok}** tokens`,
        `- **Entrée :** \`${inTok}\` tokens`,
        `- **Sortie :** \`${outTok}\` tokens`,
        '',
        '> ℹ️ *Les quotas globaux de modèles distants n\'ont pas pu être rechargés à cet instant.*'
      ].join('\n');

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { ...m, content: fallbackContent, isLive: false } : m))
      );
    }
  };

  const handleShowUpdateCard = async () => {
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: '/update',
      timestamp: new Date().toISOString()
    };

    const loadingId = `upd-${Date.now()}`;
    const loadingMsg: ChatMessage = {
      id: loadingId,
      role: 'assistant',
      content: '🔄 **Recherche de mises à jour Antigravity WebUI (Protocole Git Hermes)...**',
      isLive: true,
      timestamp: new Date().toISOString()
    };

    setMessages((prev) => [...prev, userMsg, loadingMsg]);

    try {
      const data = await checkSystemUpdate(true);
      setUpdateInfo(data);

      const lines: string[] = ['### 🔄 État des Mises à Jour Antigravity WebUI\n'];
      lines.push(`- **Version locale :** \`${data.current_version}\` (\`${data.current_commit}\` sur \`${data.branch}\`)`);
      lines.push(`- **Tag Git :** \`${data.tag || 'aucun'}\``);
      lines.push(`- **Dépôt local :** Git Clone (\`main\`)`);
      lines.push(`- **Dernière vérification :** ${new Date(data.checked_at * 1000).toLocaleTimeString()}`);
      lines.push('');

      if (data.update_available && data.behind > 0) {
        lines.push(`> 🚀 **${data.behind} nouvelle(s) mise(s) à jour disponible(s)** sur le dépôt officiel (\`origin/${data.branch}\`) !\n`);
        lines.push('#### 📦 Commits en attente :');
        data.commits.forEach((c) => {
          const dateStr = c.timestamp ? new Date(c.timestamp * 1000).toLocaleDateString() : '';
          lines.push(`- \`${c.sha}\` **${c.summary}** *(par ${c.author}${dateStr ? ' le ' + dateStr : ''})*`);
        });
        lines.push('');
        lines.push('👉 *Pour appliquer la mise à jour en un clic, ouvrez les **Paramètres > Mises à jour** ou cliquez sur le badge dans la barre latérale.*');
      } else {
        lines.push('✅ **Antigravity WebUI est parfaitement à jour.** Tous les derniers correctifs, optimisations et fonctionnalités sont appliqués.');
      }

      setMessages((prev) =>
        prev.map((m) => (m.id === loadingId ? { ...m, content: lines.join('\n'), isLive: false } : m))
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === loadingId
            ? {
                ...m,
                content: `⚠️ **Échec de la recherche de mise à jour :** ${err.message || 'Erreur inconnue'}`,
                isLive: false
              }
            : m
        )
      );
    }
  };

  const handleRetry = () => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (lastUserMsg && lastUserMsg.content) {
      let content = cleanUserPrompt(lastUserMsg.content);
      content = content.replace(/^(?:⚡\s*\[Guidage\]\s*|📥\s*\[En attente\]\s*|\[Instruction Prioritaire de Guidage\]\s*:?\s*)+/, '');
      if (content.includes('\n\n[Image attachée :')) {
        content = content.split('\n\n[Image attachée :')[0];
      }
      if (content.includes('\n\n[Fichier attaché :')) {
        content = content.split('\n\n[Fichier attaché :')[0];
      }
      handleSendMessage(content.trim(), {
        model: selectedModel,
        effort: selectedEffort,
        autoApprove: true,
        mode: 'normal'
      });
    }
  };

  const handleUndo = async () => {
    if (!activeConversationId) {
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        if (next[next.length - 1]?.role === 'assistant') {
          next.pop();
        }
        if (next.length > 0 && next[next.length - 1]?.role === 'user') {
          next.pop();
        }
        return next;
      });
      return;
    }

    try {
      const data = await undoConversationTurn(activeConversationId);
      const chatMsgs = parseStepsToMessages(data.steps || []);
      setMessages(chatMsgs);
      const normUsage = normalizeUsage(data.usage);
      if (normUsage && normUsage.totalTokens > 0) {
        setTokenUsage(normUsage);
      } else {
        setTokenUsage(estimateUsageFromMessages(chatMsgs));
      }
      fetchConversations(100).then((c) => setConversations(c)).catch(() => {});
    } catch (e) {
      console.error('Failed to undo turn on backend:', e);
      setMessages((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        if (next[next.length - 1]?.role === 'assistant') {
          next.pop();
        }
        if (next.length > 0 && next[next.length - 1]?.role === 'user') {
          next.pop();
        }
        return next;
      });
    }
  };

  const currentModelObj = models.find((m) => m.id === selectedModel) ||
    models.find((m) => selectedModel.startsWith(m.id)) ||
    models[0];
  const displayModelName = currentModelObj ? currentModelObj.name : 'Gemini 3.8 Flash';
  const displayEffort = currentModelObj && currentModelObj.supported_efforts?.length > 0 ? selectedEffort : undefined;

  const stableOpenCrons = useCallback(() => setIsCronModalOpen(true), []);
  const stableOpenRules = useCallback(() => setIsRulesModalOpen(true), []);
  const stableOpenTasks = useCallback(() => setIsTaskDashboardOpen(true), []);
  const stableOpenAnalytics = useCallback(() => setIsAnalyticsOpen(true), []);
  const stableApprovalResolved = useCallback(() => setPendingApproval(null), []);
  
  const stableAnswerQuestion = useCallback((ans: string) => {
    if (isStreamingRef.current) {
      chatSocket.sendInput(ans, activeConversationIdRef.current || undefined);
      const userMsg: ChatMessage = {
        id: `usr-${Date.now()}`,
        role: 'user',
        content: ans,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, userMsg]);
      return;
    }
    handleSendMessage(ans, {
      model: selectedModel,
      effort: selectedEffort,
    });
  }, [selectedModel, selectedEffort, handleSendMessage]);

  const stableEditSessionMeta = useCallback(() => {
    handleEditSessionMeta(activeConv);
  }, [activeConv, handleEditSessionMeta]);

  const handleOpenMonacoStudio = useCallback((config: MonacoStudioConfig) => {
    setMonacoStudioConfig(config);
    setIsMonacoStudioOpen(true);
  }, []);

  const handleCloseMonacoStudio = useCallback(() => {
    setIsMonacoStudioOpen(false);
  }, []);

  const handleExplainCode = useCallback((code: string, language?: string, filePath?: string) => {
    setIsMonacoStudioOpen(false);
    const prompt = filePath 
      ? `Explique et analyse ce code issu de \`${filePath}\` (${language || 'code'}) :\n\`\`\`${language || ''}\n${code}\n\`\`\``
      : `Explique et analyse ce code (${language || 'code'}) :\n\`\`\`${language || ''}\n${code}\n\`\`\``;
    handleSendMessage(prompt, {
      model: selectedModel,
      effort: selectedEffort
    });
  }, [handleSendMessage, selectedModel, selectedEffort]);

  return (
    <div
      className="flex h-[100dvh] w-screen font-sans overflow-hidden antialiased"
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text)'
      }}
    >
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        isMobileOpen={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        onOpenSettings={() => {
          setSettingsTab('models');
          setIsSettingsOpen(true);
        }}
        onOpenLanguages={handleOpenLanguages}
        onOpenHelp={() => setIsHelpOpen(true)}
        onOpenWorkspaces={() => setIsWorkspacesOpen(true)}
        onOpenArtifacts={() => openRightPanel('artifacts')}
        onOpenFiles={() => openRightPanel('files')}
        onOpenTasks={() => setIsTaskDashboardOpen(true)}
        onOpenAnalytics={stableOpenAnalytics}
        onLogout={handleLogout}
        onTogglePin={handleTogglePin}
        onEditSessionMeta={handleEditSessionMeta}
        onSearchQuery={handleSearchQuery}
        onRefreshConversations={async () => {
          const convs = await fetchConversations(100);
          setConversations(convs);
        }}
        currentWorkspace={currentWorkspace}
        activeModel={displayModelName}
        activeEffort={displayEffort}
        activeGoogleAccount={activeGoogleAccount}
        onOpenGoogleAccount={handleOpenGoogleAccount}
        updateAvailable={!!updateInfo?.update_available}
        onOpenUpdates={handleOpenUpdates}
        onOpenFtsSearch={() => setIsFtsSearchOpen(true)}
        onOpenMcpCatalog={() => setIsMcpCatalogOpen(true)}
        onOpenDoctor={() => setIsDoctorOpen(true)}
        onOpenRemoteAccess={() => setIsRemoteAccessOpen(true)}
        onOpenGateway={() => setIsGatewayOpen(true)}
        onOpenWorktreeDashboard={() => setIsWorktreeOpen(true)}
        onOpenCanvasStudio={() => setIsCanvasStudioOpen(true)}
        onOpenVectorMemory={() => setIsVectorMemoryOpen(true)}
      />

      {/* Main Chat Area */}
      <main
        className="flex-1 min-w-0 flex flex-col h-full overflow-hidden relative"
        style={{
          backgroundColor: 'var(--main-bg, var(--bg))',
          color: 'var(--text)'
        }}
      >
        {/* Reconnection Banner */}
        {wsStatus !== 'connected' && (
          <div
            className="flex items-center justify-center gap-2 py-1.5 px-4 text-xs font-medium z-30 shrink-0"
            style={{
              backgroundColor: wsStatus === 'reconnecting' ? 'var(--accent-bg-strong)' : 'rgba(239,68,68,0.15)',
              color: wsStatus === 'reconnecting' ? 'var(--accent-text)' : '#ef4444',
              borderBottom: '1px solid var(--border)',
            }}
          >
            <span className={wsStatus === 'reconnecting' ? 'animate-pulse' : ''}>
              {wsStatus === 'reconnecting' ? '⟳ Reconnexion en cours…' : '⚠ Connexion perdue'}
            </span>
            <button
              onClick={() => chatSocket.reconnect()}
              className="underline hover:opacity-80 transition-opacity"
            >
              Reconnecter
            </button>
          </div>
        )}

        <ChatCanvas
          messages={messages}
          isStreaming={isStreaming}
          conversationId={activeConversationId}
          conversationTitle={activeConv?.title}
          activeModel={displayModelName}
          activeEffort={displayEffort}
          project={activeConv?.project}
          projectColor={activeConv?.projectColor}
          tags={activeConv?.tags}
          parentConversationId={activeConv?.parent_conversation_id}
          onQuickPrompt={setQuickPrompt}
          onAnswerQuestion={stableAnswerQuestion}
          onOpenFiles={handleOpenFilesPanel}
          onOpenArtifacts={handleOpenArtifactsPanel}
          onOpenTerminal={handleOpenTerminalPanel}
          onOpenGit={handleOpenGitPanel}
          onOpenKanban={handleOpenKanbanPanel}
          onOpenCrons={stableOpenCrons}
          onOpenRules={stableOpenRules}
          onOpenTasks={stableOpenTasks}
          onOpenAnalytics={stableOpenAnalytics}
          onOpenBranchTree={() => setIsBranchModalOpen(true)}
          bookmarks={sessionBookmarks}
          onAddBookmark={handleAddBookmark}
          onRemoveBookmark={handleRemoveBookmark}
          isRightPanelOpen={isRightPanelOpen}
          activeRightPanelTab={rightPanelTab}
          onToggleRightPanel={handleToggleRightPanel}
          onToggleMobileSidebar={handleToggleMobileSidebar}
          onNewConversation={handleNewConversation}
          pendingApproval={pendingApproval}
          onApprovalResolved={stableApprovalResolved}
          onForkMessage={handleForkMessage}
          onEditSessionMeta={stableEditSessionMeta}
          onRetry={handleRetry}
          loopWarning={loopWarning}
          onDismissLoopWarning={() => setLoopWarning(null)}
          onStopStreaming={handleStopStreaming}
          onOpenMonacoStudio={handleOpenMonacoStudio}
          progressCard={activeProgressCard}
          onDismissProgressCard={() => setActiveProgressCard(null)}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          isStreaming={isStreaming}
          onStopStreaming={handleStopStreaming}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          selectedEffort={selectedEffort}
          onSelectEffort={handleSelectEffort}
          initialPrompt={quickPrompt}
          pastUserPrompts={pastUserPrompts}
          usage={tokenUsage}
          queueCount={queueCount}
          onClearQueue={handleClearQueue}
          currentWorkspace={currentWorkspace}
          onClearChat={() => setMessages([])}
          onNewChat={handleNewConversation}
          onCompact={handleCompactConversation}
          onOpenCompactor={() => setIsContextCompactorOpen(true)}
          isCompacting={isCompacting}
          contextBudgetTokens={appSettings.contextBudgetTokens}
          onOpenBranchTree={() => setIsBranchModalOpen(true)}
          onAddBookmark={(label) => {
            const lastStep = messages.length > 0 ? (messages[messages.length - 1].stepIndex ?? messages.length - 1) : 0;
            const lastContent = messages.length > 0 ? messages[messages.length - 1].content : '';
            handleAddBookmark(lastStep, label || `Étape #${lastStep}`, lastContent?.slice(0, 150));
          }}
          onOpenTerminal={() => openRightPanel('terminal')}
          onOpenGit={() => openRightPanel('git')}
          onOpenKanban={() => openRightPanel('kanban')}
          onOpenCrons={() => setIsCronModalOpen(true)}
          onOpenRules={() => setIsRulesModalOpen(true)}
          onOpenSkills={handleOpenSkills}
          onOpenTasks={() => setIsTaskDashboardOpen(true)}
          onOpenLanguages={handleOpenLanguages}
          onOpenFileExplorer={() => setIsFileExplorerOpen(true)}
          onOpenWorkspace={() => setIsWorkspacesOpen(true)}
          onOpenExport={() => setIsArtifactsOpen(true)}
          onOpenHelp={() => setIsHelpOpen(true)}
          onForkMessage={() => handleForkMessage(messages.length > 0 ? messages.length - 1 : 0)}
          onRenameTitle={(newTitle) => {
            if (activeConversationId) {
              updateConversationTitle(activeConversationId, newTitle)
                .then(() => {
                  fetchConversations(100).then(setConversations);
                })
                .catch((err) => {
                  console.error('Failed to sync title:', err);
                  fetchConversations(100).then(setConversations);
                });
            }
          }}
          onRetry={handleRetry}
          onUndo={handleUndo}
          onShowStatus={handleShowStatusCard}
          onShowUsage={handleShowUsageCard}
          onOpenAnalytics={stableOpenAnalytics}
          onOpenGoogleAccount={handleOpenGoogleAccount}
          onOpenUpdates={handleOpenUpdates}
          onShowUpdateCard={handleShowUpdateCard}
          onOpenMonacoStudio={handleOpenMonacoStudio}
        />
      </main>

      <Suspense fallback={null}>
      {/* Workspace Panel (Drawer on demand) */}
      <WorkspacePanel
        isOpen={isRightPanelOpen}
        onClose={() => setIsRightPanelOpen(false)}
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        currentWorkspace={currentWorkspace}
        conversationId={activeConversationId || undefined}
        onInsertPath={handleInsertPath}
        onExecutePrompt={(p) => setQuickPrompt(p)}
        initialFilePath={pendingOpenFile}
        onClearInitialFilePath={() => setPendingOpenFile(null)}
        initialSearchQuery={workspaceSearchQuery}
        initialSearchMode={workspaceSearchMode}
        agentActivityTimestamp={agentActivityTimestamp}
        onOpenMonacoStudio={handleOpenMonacoStudio}
        onOpenCrons={() => setIsCronModalOpen(true)}
        onOpenRules={() => setIsRulesModalOpen(true)}
        onOpenAnalytics={stableOpenAnalytics}
        onOpenBranchTree={() => setIsBranchModalOpen(true)}
      />

      {/* Modals & Panels */}
      <LoginModal
        isOpen={isAuthModalOpen || !isAuthenticated}
        onSuccess={handleLoginSuccess}
      />

      <FileExplorerModal
        isOpen={isFileExplorerOpen}
        onClose={() => setIsFileExplorerOpen(false)}
        currentWorkspace={currentWorkspace}
        onInsertPath={handleInsertPath}
      />

      <TaskDashboardModal
        isOpen={isTaskDashboardOpen}
        onClose={() => setIsTaskDashboardOpen(false)}
        conversationId={activeConversationId}
      />

      <ArtifactViewer
        isOpen={isArtifactsOpen}
        onClose={() => setIsArtifactsOpen(false)}
        conversationId={activeConversationId}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        models={models}
        currentModel={selectedModel}
        onModelSaved={handleModelSavedFromSettings}
        initialTab={settingsTab}
        onGoogleAccountChanged={handleGoogleAccountChanged}
        activeConversation={activeConv}
        onClearHistory={() => setMessages([])}
        onDeleteConversation={(deletedId) => {
          if (activeConversationId === deletedId) {
            handleNewConversation();
          }
        }}
        onConversationUpdated={async () => {
          const convs = await fetchConversations(100);
          setConversations(convs);
        }}
      />

      <HelpModal
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
        onExecuteCommand={(cmd) => setQuickPrompt(cmd)}
      />

      <AnalyticsModal
        isOpen={isAnalyticsOpen}
        onClose={() => setIsAnalyticsOpen(false)}
        tokenUsage={tokenUsage}
        conversations={conversations}
        activeModel={displayModelName}
      />

      <ContextCompactorModal
        isOpen={isContextCompactorOpen}
        onClose={() => setIsContextCompactorOpen(false)}
        conversationId={activeConversationId}
        activeModel={selectedModel}
        usage={tokenUsage}
        onPruneSuccess={handlePruneSuccess}
      />

      <MonacoStudioModal
        isOpen={isMonacoStudioOpen}
        onClose={handleCloseMonacoStudio}
        config={monacoStudioConfig}
        onExplainCode={handleExplainCode}
        currentWorkspace={currentWorkspace}
      />

      {isBranchModalOpen && activeConversationId && (
        <SessionBranchModal
          isOpen={isBranchModalOpen}
          onClose={() => setIsBranchModalOpen(false)}
          currentConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onForkConversation={handleForkMessage}
        />
      )}

      <ProjectSwitcherModal
        isOpen={isWorkspacesOpen}
        onClose={() => setIsWorkspacesOpen(false)}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={handleSelectWorkspace}
        onRunTerminalCommand={(cmd) => {
          openRightPanel('terminal');
          window.dispatchEvent(new CustomEvent('terminal-run-command', { detail: { command: cmd } }));
        }}
      />

      <SessionMetaModal
        isOpen={isSessionMetaOpen}
        onClose={() => setIsSessionMetaOpen(false)}
        conversation={metaTargetConversation}
        onUpdated={async () => {
          const convs = await fetchConversations(100);
          setConversations(convs);
        }}
        onDeleted={(deletedId) => {
          if (activeConversationId === deletedId) {
            handleNewConversation();
          }
        }}
      />

      <CronSchedulerModal
        isOpen={isCronModalOpen}
        onClose={() => setIsCronModalOpen(false)}
        onExecutePrompt={(p) => {
          setQuickPrompt(p);
          setIsCronModalOpen(false);
        }}
      />

      <RulesEditorModal
        isOpen={isRulesModalOpen}
        onClose={() => setIsRulesModalOpen(false)}
        currentWorkspace={currentWorkspace}
      />

      {isQuickOpenOpen && (
        <QuickOpenModal
          isOpen={isQuickOpenOpen}
          onClose={() => setIsQuickOpenOpen(false)}
          currentWorkspace={currentWorkspace}
          onSelectFile={(filePath) => {
            setIsRightPanelOpen(true);
            setRightPanelTab('files');
            setPendingOpenFile(filePath);
            window.dispatchEvent(new CustomEvent('open-workspace-file', { detail: { path: filePath } }));
          }}
        />
      )}

      {isFtsSearchOpen && (
        <FtsSearchModal
          isOpen={isFtsSearchOpen}
          onClose={() => setIsFtsSearchOpen(false)}
          onSelectConversation={(sessionId) => {
            handleSelectConversation(sessionId);
            setIsFtsSearchOpen(false);
          }}
        />
      )}

      {isMcpCatalogOpen && (
        <McpCatalogModal
          isOpen={isMcpCatalogOpen}
          onClose={() => setIsMcpCatalogOpen(false)}
        />
      )}

      {isDoctorOpen && (
        <SystemDoctorModal
          isOpen={isDoctorOpen}
          onClose={() => setIsDoctorOpen(false)}
        />
      )}

      {isRemoteAccessOpen && (
        <RemoteAccessModal
          isOpen={isRemoteAccessOpen}
          onClose={() => setIsRemoteAccessOpen(false)}
        />
      )}

      {isGatewayOpen && (
        <MessagingGatewayModal
          isOpen={isGatewayOpen}
          onClose={() => setIsGatewayOpen(false)}
        />
      )}

      {isWorktreeOpen && (
        <WorktreeDashboardModal
          isOpen={isWorktreeOpen}
          onClose={() => setIsWorktreeOpen(false)}
          currentWorkspace={currentWorkspace}
        />
      )}

      {isCanvasStudioOpen && (
        <CanvasStudioModal
          isOpen={isCanvasStudioOpen}
          onClose={() => setIsCanvasStudioOpen(false)}
        />
      )}

      {isVectorMemoryOpen && (
        <VectorMemoryModal
          isOpen={isVectorMemoryOpen}
          onClose={() => setIsVectorMemoryOpen(false)}
        />
      )}
      </Suspense>

      {/* Global Toast & Confirm Dialog containers */}
      <ToastContainer />
      <ConfirmDialogContainer />
    </div>
  );
}

export default App;
