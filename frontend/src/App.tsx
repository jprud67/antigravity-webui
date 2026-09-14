import React, { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatCanvas } from './components/ChatCanvas';
import { ChatInput } from './components/ChatInput';
import { ArtifactViewer } from './components/ArtifactViewer';
import { SettingsModal } from './components/SettingsModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import { LoginModal } from './components/LoginModal';
import { FileExplorerModal } from './components/FileExplorerModal';
import { TaskDashboardModal } from './components/TaskDashboardModal';
import { WorkspacePanel, type RightPanelTab } from './components/WorkspacePanel';
import { SessionMetaModal } from './components/SessionMetaModal';
import { CronSchedulerModal } from './components/CronSchedulerModal';
import { RulesEditorModal } from './components/RulesEditorModal';
import { HelpModal } from './components/HelpModal';
import type { TokenUsageData } from './components/ContextRing';
import type { Conversation, ChatMessage, ModelOption } from './types';
import { 
  fetchConversations, 
  fetchConversationTranscript, 
  fetchModels, 
  fetchSettings,
  checkAuthStatus,
  clearAuthToken,
  forkConversation,
  updateConversationMetadata,
  fetchGoogleAccounts,
  saveSettings,
  type GoogleAccountInfo
} from './services/api';
import { chatSocket } from './services/ws';
import { syncClient } from './services/sync';
import { getStoredTheme, getStoredSkin, applyAppearance } from './services/theme';

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState('/root');

  // Stable refs — used in effects with empty deps to avoid stale closures
  const activeConversationIdRef = React.useRef<string | null>(null);
  const isStreamingRef = React.useRef<boolean>(false);
  activeConversationIdRef.current = activeConversationId;
  isStreamingRef.current = isStreaming;


  // Telemetry, Queue & Approval States (Phase 2)
  const [tokenUsage, setTokenUsage] = useState<TokenUsageData | undefined>(undefined);
  const [queueCount, setQueueCount] = useState(0);
  const [pendingApproval, setPendingApproval] = useState<{ toolName: string; command?: string; path?: string } | null>(null);

  // Session Metadata Modal (Phase 3)
  const [isSessionMetaOpen, setIsSessionMetaOpen] = useState(false);
  const [metaTargetConversation, setMetaTargetConversation] = useState<Conversation | null>(null);

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash-high');
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [quickPrompt, setQuickPrompt] = useState('');

  // 3-Panel Demand-Driven Workspace Panel
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('files');

  const openRightPanel = (tab: RightPanelTab) => {
    setRightPanelTab(tab);
    setIsRightPanelOpen(true);
  };

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
  const [settingsTab, setSettingsTab] = useState<'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages' | 'google'>('models');
  const [activeGoogleAccount, setActiveGoogleAccount] = useState<GoogleAccountInfo | null>(null);

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

  // Initialize
  useEffect(() => {
    applyAppearance(getStoredTheme(), getStoredSkin());
    loadInitialData();
  }, []);

  // SSE real-time sync: CLI ↔ WebUI
  // Subscribes to filesystem change events pushed by the backend watcher.
  useEffect(() => {
    syncClient.connect();

    const unsubscribe = syncClient.subscribe((event) => {
      if (event.type === 'conversations_updated') {
        // Refresh sidebar without disrupting active chat
        fetchConversations(50).then((c) => setConversations(c)).catch(() => {});
      } else if (event.type === 'transcript_updated' && event.conversation_id) {
        const convId = event.conversation_id;
        // Only reload transcript if it's the active conversation AND we're not streaming
        if (convId === activeConversationIdRef.current && !isStreamingRef.current) {
          fetchConversationTranscript(convId).then((data) => {
            const steps = data.steps || [];
            const chatMsgs: import('./types').ChatMessage[] = [];
            steps.forEach((s: any, idx: number) => {
              const role = s.source === 'USER_EXPLICIT' || s.type === 'USER_INPUT' ? 'user' : 'assistant';
              const content = s.content || '';
              const thought = s.thinking || '';
              const toolCalls = (s.tool_calls || []).map((t: any) => ({
                name: t.name || 'tool',
                args: t.args,
                status: 'done' as const
              }));
              if (content || thought || toolCalls.length > 0) {
                chatMsgs.push({ id: `step-${idx}`, role, content, thought, toolCalls, stepIndex: s.step_index });
              }
            });
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

  const inputTokens = BASE_SYSTEM_TOKENS + pTokens + rTokens;
  const outputTokens = rTokens + tTokens;
  const totalTokens = inputTokens;

  return {
    inputTokens,
    outputTokens,
    thinkingTokens: tTokens,
    totalTokens,
    isEstimated: true
  };
};

  // Switch Conversation
  const handleSelectConversation = async (convId: string) => {
    setActiveConversationId(convId);
    try {
      const data = await fetchConversationTranscript(convId);
      const steps = data.steps || [];
      const chatMsgs: ChatMessage[] = [];

      steps.forEach((s: any, idx: number) => {
        const role = s.source === 'USER_EXPLICIT' || s.type === 'USER_INPUT' ? 'user' : 'assistant';
        const content = s.content || '';
        const thought = s.thinking || '';
        const toolCalls = (s.tool_calls || []).map((t: any) => ({
          name: t.name || 'tool',
          args: t.args,
          status: 'done'
        }));

        if (content || thought || toolCalls.length > 0) {
          chatMsgs.push({
            id: `step-${idx}`,
            role,
            content,
            thought,
            toolCalls,
            stepIndex: s.step_index
          });
        }
      });

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
    } catch (err) {
      console.error('Failed to load transcript:', err);
    }
  };

  const handleNewConversation = () => {
    setActiveConversationId(null);
    setMessages([]);
    setTokenUsage(undefined);
    setQueueCount(0);
    setPendingApproval(null);
  };

  // WebSocket event handler — subscribe once, use ref for conversation id
  useEffect(() => {
    const unsubscribe = chatSocket.subscribe((event: any) => {
      if (event.event === 'init') {
        if (event.conversation_id && !activeConversationIdRef.current) {
          setActiveConversationId(event.conversation_id);
        }
      } else if (event.event === 'step_update') {
        const update = event.step_update;
        if (!update) return;

        if (update.conversation_id && !activeConversationIdRef.current) {
          setActiveConversationId(update.conversation_id);
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
          }
          return prev;
        });
        // Refresh conversations in sidebar
        fetchConversations(50).then((c) => setConversations(c));
      } else if (event.event === 'approval_request') {
        setPendingApproval({
          toolName: event.tool_name || 'Action système',
          command: event.command,
          path: event.path,
        });
      } else if (event.event === 'queued') {
        if (typeof event.queue_size === 'number') {
          setQueueCount(event.queue_size);
        }
      } else if (event.event === 'steered') {
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

    chatSocket.sendPrompt({
      prompt,
      conversationId: activeConversationId || undefined,
      workspacePath: currentWorkspace,
      model: options.model,
      effort: options.effort,
      autoApprove: options.autoApprove,
      mode: options.mode
    });
  };

  const handleStopStreaming = () => {
    chatSocket.sendInterrupt();
    setIsStreaming(false);
    setQueueCount(0);
    setPendingApproval(null);
  };

  const handleClearQueue = () => {
    chatSocket.sendClearQueue();
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
      alert(`Erreur lors de la bifurcation : ${e.message}`);
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

  const handleUndo = () => {
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
  };

  const activeConv = conversations.find((c) => c.conversation_id === activeConversationId);
  const currentModelObj = models.find((m) => m.id === selectedModel);
  const displayModelName = currentModelObj ? currentModelObj.name : 'Gemini 3.8 Flash';
  const displayEffort = currentModelObj && currentModelObj.supported_efforts.length > 0 ? selectedEffort : undefined;

  return (
    <div
      className="flex h-screen w-screen font-sans overflow-hidden antialiased"
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
        currentWorkspace={currentWorkspace}
        activeModel={displayModelName}
        activeEffort={displayEffort}
        activeGoogleAccount={activeGoogleAccount}
        onOpenGoogleAccount={handleOpenGoogleAccount}
      />

      {/* Main Chat Area */}
      <main
        className="flex-1 flex flex-col h-full overflow-hidden relative"
        style={{
          backgroundColor: 'var(--main-bg, var(--bg))',
          color: 'var(--text)'
        }}
      >
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
          onOpenFiles={() => openRightPanel('files')}
          onOpenArtifacts={() => openRightPanel('artifacts')}
          onOpenTerminal={() => openRightPanel('terminal')}
          onOpenGit={() => openRightPanel('git')}
          onOpenKanban={() => openRightPanel('kanban')}
          onOpenCrons={() => setIsCronModalOpen(true)}
          onOpenRules={() => setIsRulesModalOpen(true)}
          onOpenTasks={() => setIsTaskDashboardOpen(true)}
          isRightPanelOpen={isRightPanelOpen}
          activeRightPanelTab={rightPanelTab}
          onToggleRightPanel={() => setIsRightPanelOpen(!isRightPanelOpen)}
          pendingApproval={pendingApproval}
          onApprovalResolved={() => setPendingApproval(null)}
          onForkMessage={handleForkMessage}
          onEditSessionMeta={() => handleEditSessionMeta(activeConv)}
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
              updateConversationMetadata(activeConversationId, { customTitle: newTitle }).then(() => {
                fetchConversations(100).then(setConversations);
              });
            }
          }}
          onRetry={handleRetry}
          onUndo={handleUndo}
          onShowStatus={handleShowStatusCard}
          onOpenGoogleAccount={handleOpenGoogleAccount}
        />
      </main>

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
    </div>
  );
}

export default App;
