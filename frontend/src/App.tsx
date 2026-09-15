import React, { useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatCanvas } from './components/ChatCanvas';
import { ChatInput } from './components/ChatInput';

const ArtifactViewer = lazy(() => import('./components/ArtifactViewer').then(m => ({ default: m.ArtifactViewer })));
const SettingsModal = lazy(() => import('./components/SettingsModal').then(m => ({ default: m.SettingsModal })));
const WorkspaceModal = lazy(() => import('./components/WorkspaceModal').then(m => ({ default: m.WorkspaceModal })));
const LoginModal = lazy(() => import('./components/LoginModal').then(m => ({ default: m.LoginModal })));
const FileExplorerModal = lazy(() => import('./components/FileExplorerModal').then(m => ({ default: m.FileExplorerModal })));
const TaskDashboardModal = lazy(() => import('./components/TaskDashboardModal').then(m => ({ default: m.TaskDashboardModal })));
import type { RightPanelTab } from './components/WorkspacePanel';
const WorkspacePanel = lazy(() => import('./components/WorkspacePanel').then(m => ({ default: m.WorkspacePanel })));
const SessionMetaModal = lazy(() => import('./components/SessionMetaModal').then(m => ({ default: m.SessionMetaModal })));
const CronSchedulerModal = lazy(() => import('./components/CronSchedulerModal').then(m => ({ default: m.CronSchedulerModal })));
const RulesEditorModal = lazy(() => import('./components/RulesEditorModal').then(m => ({ default: m.RulesEditorModal })));
const HelpModal = lazy(() => import('./components/HelpModal').then(m => ({ default: m.HelpModal })));
import type { TokenUsageData } from './components/ContextRing';
import type { Conversation, ChatMessage, ModelOption } from './types';
import { parseStepsToMessages } from './utils/transcriptParser';
import { 
  fetchConversations, 
  fetchConversationTranscript, 
  fetchModels, 
  fetchSettings,
  checkAuthStatus,
  clearAuthToken,
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
  type GoogleAccountInfo,
  type UpdateCheckResult
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
    if (m.role === 'user') {
      promptChars += (m.content || '').length;
    } else {
      responseChars += (m.content || '').length;
      if (m.thought) thinkingChars += m.thought.length;
      if (m.toolCalls && m.toolCalls.length > 0) {
        responseChars += JSON.stringify(m.toolCalls).length;
      }
    }
  }

  const pTokens = Math.max(1, Math.ceil(promptChars / 3.8));
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

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState('/root');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

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

  // WebSocket connection status for reconnection banner
  const [wsStatus, setWsStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>(
    chatSocket.connectionStatus
  );

  // Session Metadata Modal (Phase 3)
  const [isSessionMetaOpen, setIsSessionMetaOpen] = useState(false);
  const [metaTargetConversation, setMetaTargetConversation] = useState<Conversation | null>(null);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash-high');
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [quickPrompt, setQuickPrompt] = useState('');

  // Memoized prompt history of active discussion for terminal-like navigation
  const pastUserPrompts = useMemo(() => {
    return messages
      .filter((m) => m.role === 'user' && m.content)
      .map((m) => {
        let text = m.content;
        text = text.replace(/<\/?USER_REQUEST>/g, '');
        text = text.replace(/^(⚡ \[Guidage\] |📥 \[En attente\] )/, '');
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

  // 3-Panel Demand-Driven Workspace Panel
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('files');

  const openRightPanel = React.useCallback((tab: RightPanelTab) => {
    setRightPanelTab(tab);
    setIsRightPanelOpen(true);
  }, []);

  useEffect(() => {
    const handleOpenFile = () => {
      setIsRightPanelOpen(true);
      setRightPanelTab('files');
    };
    window.addEventListener('open-workspace-file', handleOpenFile);
    return () => window.removeEventListener('open-workspace-file', handleOpenFile);
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
  const [settingsTab, setSettingsTab] = useState<'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages' | 'google' | 'conversation' | 'updates'>('models');
  const [activeGoogleAccount, setActiveGoogleAccount] = useState<GoogleAccountInfo | null>(null);
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckResult | null>(null);

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
    setActiveConversationId(convId);
    chatSocket.setCurrentConversation(convId);
    setPendingApproval(null);
    setQueueCount(0);
    try {
      const data = await fetchConversationTranscript(convId);
      const chatMsgs = parseStepsToMessages(data.steps || []);
      setMessages(chatMsgs);

      // Instantly set accurate token usage for selected conversation
      if (data.usage && data.usage.total_tokens > 0) {
        setTokenUsage({
          inputTokens: data.usage.input_tokens || 0,
          outputTokens: data.usage.output_tokens || 0,
          thinkingTokens: data.usage.thinking_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          isEstimated: data.usage.is_estimated ?? true
        });
      } else {
        setTokenUsage(estimateUsageFromMessages(chatMsgs));
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

      const [convs, mods, settings, googleRes] = await Promise.all([
        fetchConversations(50),
        fetchModels(),
        fetchSettings(),
        fetchGoogleAccounts().catch(() => ({ active_account: null, accounts: [] }))
      ]);
      setConversations(convs);
      setModels(mods);
      if (googleRes?.active_account) {
        setActiveGoogleAccount(googleRes.active_account);
      }

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
          const lowerModel = settings.model.toLowerCase();
          if (lowerModel.includes('low')) {
            setSelectedEffort('low');
          } else if (lowerModel.includes('medium') || lowerModel.includes('med')) {
            setSelectedEffort('medium');
          } else {
            setSelectedEffort((found.default_effort as any) || 'high');
          }
        } else {
          setSelectedModel(mods[0].id);
          setSelectedEffort((mods[0].default_effort as any) || 'high');
        }
      } else if (mods.length > 0) {
        setSelectedModel(mods[0].id);
        setSelectedEffort((mods[0].default_effort as any) || 'high');
      }

      if (settings.trustedWorkspaces && settings.trustedWorkspaces.length > 0) {
        setCurrentWorkspace(settings.trustedWorkspaces[0]);
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

    return () => clearInterval(updateInterval);
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
        fetchConversations(50).then((c) => setConversations(c)).catch(() => {});
      } else if (event.type === 'artifacts_updated') {
        // Dispatch custom event for WorkspacePanel & artifact viewers
        window.dispatchEvent(new CustomEvent('antigravity:artifacts_updated', { detail: event }));
      } else if (event.type === 'transcript_updated' && event.conversation_id) {
        const convId = event.conversation_id;
        // Only reload transcript if it's the active conversation AND we're not streaming
        if (convId === activeConversationIdRef.current && !isStreamingRef.current) {
          fetchConversationTranscript(convId).then((data) => {
            const chatMsgs = parseStepsToMessages(data.steps || []);
            setMessages(chatMsgs);
            if (data.usage && data.usage.total_tokens > 0) {
              setTokenUsage({
                inputTokens: data.usage.input_tokens || 0,
                outputTokens: data.usage.output_tokens || 0,
                thinkingTokens: data.usage.thinking_tokens || 0,
                totalTokens: data.usage.total_tokens || 0,
                isEstimated: data.usage.is_estimated ?? true
              });
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
  }, []);

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
    setActiveConversationId(null);
    chatSocket.setCurrentConversation(null);
    setMessages([]);
    setTokenUsage(undefined);
    setQueueCount(0);
    setPendingApproval(null);
    setIsStreaming(false);
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
              if (live.pending_approval) setPendingApproval(live.pending_approval);
              if (live.usage) setTokenUsage(live.usage);
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
              if (live.pending_approval) setPendingApproval(live.pending_approval);
              if (live.usage) setTokenUsage(live.usage);
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
          setActiveConversationId(event.conversation_id);
          chatSocket.setCurrentConversation(event.conversation_id);
          navigateToConversation(event.conversation_id, true);
        }
      } else if (event.event === 'step_update') {
        const update = event.step_update;
        if (!update) return;

        if (update.conversation_id && !activeConversationIdRef.current) {
          setActiveConversationId(update.conversation_id);
          chatSocket.setCurrentConversation(update.conversation_id);
          navigateToConversation(update.conversation_id, true);
        }

        // Live Context & Token Telemetry
        if (update.usage) {
          const inTokens = update.usage.input_tokens || 0;
          const outTokens = update.usage.output_tokens || 0;
          setTokenUsage({
            inputTokens: inTokens,
            outputTokens: outTokens,
            thinkingTokens: update.usage.thinking_tokens || 0,
            totalTokens: update.usage.total_tokens || (inTokens + outTokens),
            isEstimated: false
          });
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
        const res = event.result;
        if (res?.usage) {
          const inTokens = res.usage.input_tokens || 0;
          const outTokens = res.usage.output_tokens || 0;
          setTokenUsage({
            inputTokens: inTokens,
            outputTokens: outTokens,
            thinkingTokens: res.usage.thinking_tokens || 0,
            totalTokens: res.usage.total_tokens || (inTokens + outTokens),
            isEstimated: false
          });
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
        fetchConversations(50).then((c) => setConversations(c));
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
      } else if (event.event === 'queued') {
        if (typeof event.queue_size === 'number') {
          setQueueCount(event.queue_size);
        }
      } else if (event.event === 'steered') {
        setIsStreaming(true);
      } else if (event.event === 'account_failover') {
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
      } else if (event.event === 'queue_cleared') {
        setQueueCount(0);
      } else if (event.event === 'error') {
        setIsStreaming(false);
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
        if (typeof event.queue_size === 'number') {
          setQueueCount(event.queue_size);
          if (event.queue_size === 0) {
            setIsStreaming(false);
          }
        } else {
          setIsStreaming(false);
        }
        setPendingApproval(null);
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
          if (!event.is_running && isStreamingRef.current === false) {
            setIsStreaming(false);
          }
        }
      }
    });

    return () => unsubscribe();
  }, []);  // ← empty deps: subscribe once, use refs for mutable state

  // Send message
  const handleSendMessage = (
    prompt: string,
    options: {
      model?: string;
      effort?: string;
      autoApprove?: boolean;
      mode?: 'normal' | 'queue' | 'steer';
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

    if (mode === 'queue') {
      setMessages((prev) => [...prev, userMsg]);
      setQueueCount((prev) => prev + 1);
    } else if (mode === 'steer') {
      // Steer mode: cleanly close the previous turn and open a steered assistant bubble
      const liveAssistantMsg: ChatMessage = {
        id: `live-assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        thought: '',
        toolCalls: [],
        isLive: true,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => {
        const finalized = prev.map((m) => (m.isLive ? { ...m, isLive: false } : m));
        return [...finalized, userMsg, liveAssistantMsg];
      });
      setIsStreaming(true);
    } else {
      const liveAssistantMsg: ChatMessage = {
        id: `live-assistant-${Date.now()}`,
        role: 'assistant',
        content: '',
        thought: '',
        toolCalls: [],
        isLive: true,
        timestamp: new Date().toISOString()
      };
      setMessages((prev) => [...prev, userMsg, liveAssistantMsg]);
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
        mode: options.mode
      });
    } catch (e: any) {
      // WebSocket not ready (reconnecting) — inform the user instead of silently losing the prompt
      showToast(e?.message || 'Connexion WebSocket indisponible : message non envoyé.', 'error');
      setIsStreaming(false);
      if (mode === 'queue') {
        setQueueCount((prev) => Math.max(0, prev - 1));
      }
    }
  };

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
      if (found.supported_efforts && found.supported_efforts.length > 0) {
        if (!found.supported_efforts.includes(selectedEffort)) {
          setSelectedEffort((found.default_effort as any) || found.supported_efforts[0]);
        }
      }
      fetchSettings().then((currentSettings) => {
        saveSettings({ ...currentSettings, model: found.name }).catch(console.error);
      }).catch(console.error);
    }
  };

  const handleSelectEffort = (newEffort: 'low' | 'medium' | 'high') => {
    setSelectedEffort(newEffort);
    const currentModelObj = models.find((m) => m.id === selectedModel);
    if (currentModelObj) {
      fetchSettings().then((currentSettings) => {
        saveSettings({ ...currentSettings, model: currentModelObj.name }).catch(console.error);
      }).catch(console.error);
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

  const handleEditSessionMeta = (conv?: Conversation | null) => {
    setMetaTargetConversation(conv || activeConv || null);
    setIsSessionMetaOpen(true);
  };

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

  const handleShowStatusCard = () => {
    const currentModelObj = models.find((m) => m.id === selectedModel);
    const statusContent = [
      '### 📊 État du Serveur Antigravity & Session',
      `- **ID Session :** \`${activeConversationId || 'Session locale / Active'}\``,
      `- **Modèle actif :** **${currentModelObj?.name || selectedModel}**`,
      `- **Effort de réflexion :** \`${selectedEffort}\``,
      `- **Workspace actif :** \`${currentWorkspace || '/root'}\``,
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
      handleSendMessage(lastUserMsg.content, {
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
      if (data.usage && data.usage.total_tokens > 0) {
        setTokenUsage({
          inputTokens: data.usage.input_tokens || 0,
          outputTokens: data.usage.output_tokens || 0,
          thinkingTokens: data.usage.thinking_tokens || 0,
          totalTokens: data.usage.total_tokens || 0,
          isEstimated: data.usage.is_estimated ?? true
        });
      } else {
        setTokenUsage(estimateUsageFromMessages(chatMsgs));
      }
      fetchConversations(50).then((c) => setConversations(c)).catch(() => {});
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

  const activeConv = conversations.find((c) => c.conversation_id === activeConversationId);
  const currentModelObj = models.find((m) => m.id === selectedModel);
  const displayModelName = currentModelObj ? currentModelObj.name : 'Gemini 3.8 Flash';
  const displayEffort = currentModelObj && currentModelObj.supported_efforts.length > 0 ? selectedEffort : undefined;

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
          onQuickPrompt={(p) => setQuickPrompt(p)}
          onAnswerQuestion={(ans) =>
            handleSendMessage(ans, {
              model: selectedModel,
              effort: selectedEffort,
            })
          }
          onOpenFiles={handleOpenFilesPanel}
          onOpenArtifacts={handleOpenArtifactsPanel}
          onOpenTerminal={handleOpenTerminalPanel}
          onOpenGit={handleOpenGitPanel}
          onOpenKanban={handleOpenKanbanPanel}
          onOpenCrons={() => setIsCronModalOpen(true)}
          onOpenRules={() => setIsRulesModalOpen(true)}
          onOpenTasks={() => setIsTaskDashboardOpen(true)}
          isRightPanelOpen={isRightPanelOpen}
          activeRightPanelTab={rightPanelTab}
          onToggleRightPanel={handleToggleRightPanel}
          onToggleMobileSidebar={handleToggleMobileSidebar}
          onNewConversation={handleNewConversation}
          pendingApproval={pendingApproval}
          onApprovalResolved={() => setPendingApproval(null)}
          onForkMessage={handleForkMessage}
          onEditSessionMeta={() => handleEditSessionMeta(activeConv)}
          onRetry={handleRetry}
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
              Promise.all([
                updateConversationMetadata(activeConversationId, { customTitle: newTitle }),
                updateConversationTitle(activeConversationId, newTitle)
              ]).then(() => {
                fetchConversations(100).then(setConversations);
              }).catch((err) => {
                console.error('Failed to sync title:', err);
                fetchConversations(100).then(setConversations);
              });
            }
          }}
          onRetry={handleRetry}
          onUndo={handleUndo}
          onShowStatus={handleShowStatusCard}
          onShowUsage={handleShowUsageCard}
          onOpenGoogleAccount={handleOpenGoogleAccount}
          onOpenUpdates={handleOpenUpdates}
          onShowUpdateCard={handleShowUpdateCard}
        />
      </main>

      <Suspense fallback={null}>
      {/* 3-Panel Demand-Driven Workspace Panel */}
      <WorkspacePanel
        isOpen={isRightPanelOpen}
        onClose={() => setIsRightPanelOpen(false)}
        activeTab={rightPanelTab}
        onTabChange={setRightPanelTab}
        currentWorkspace={currentWorkspace}
        conversationId={activeConversationId || undefined}
        onInsertPath={handleInsertPath}
        onExecutePrompt={(p) => setQuickPrompt(p)}
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
        onGoogleAccountChanged={(acc) => setActiveGoogleAccount(acc)}
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

      <WorkspaceModal
        isOpen={isWorkspacesOpen}
        onClose={() => setIsWorkspacesOpen(false)}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={(ws) => setCurrentWorkspace(ws)}
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
      </Suspense>

      {/* Global Toast & Confirm Dialog containers */}
      <ToastContainer />
      <ConfirmDialogContainer />
    </div>
  );
}

export default App;
