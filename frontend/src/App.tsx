import { useState, useEffect } from 'react';
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
  updateConversationMetadata
} from './services/api';
import { chatSocket } from './services/ws';
import { getStoredTheme, applyTheme } from './services/theme';

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState('/root');

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

  // Initialize
  useEffect(() => {
    applyTheme(getStoredTheme());
    loadInitialData();
  }, []);

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

      const [convs, mods, settings] = await Promise.all([
        fetchConversations(50),
        fetchModels(),
        fetchSettings()
      ]);
      setConversations(convs);
      setModels(mods);

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

  // WebSocket event handler
  useEffect(() => {
    const unsubscribe = chatSocket.subscribe((event: any) => {
      if (event.event === 'init') {
        if (event.conversation_id && !activeConversationId) {
          setActiveConversationId(event.conversation_id);
        }
      } else if (event.event === 'step_update') {
        const update = event.step_update;
        if (!update) return;

        if (update.conversation_id && !activeConversationId) {
          setActiveConversationId(update.conversation_id);
        }

        // Live Context & Token Telemetry
        if (update.usage) {
          setTokenUsage({
            inputTokens: update.usage.input_tokens || 0,
            outputTokens: update.usage.output_tokens || 0,
            thinkingTokens: update.usage.thinking_tokens || 0,
            totalTokens: update.usage.total_tokens || 0,
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

        if (update.step_type === 'agent_response' && update.text_delta) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: last.content + update.text_delta }
              ];
            } else {
              return [
                ...prev,
                {
                  id: `stream-${Date.now()}`,
                  role: 'assistant',
                  content: update.text_delta
                }
              ];
            }
          });
        }
      } else if (event.event === 'result') {
        const res = event.result;
        if (res?.usage) {
          setTokenUsage({
            inputTokens: res.usage.input_tokens || 0,
            outputTokens: res.usage.output_tokens || 0,
            thinkingTokens: res.usage.thinking_tokens || 0,
            totalTokens: res.usage.total_tokens || 0,
          });
        }
        if (res?.response) {
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [
                ...prev.slice(0, -1),
                { ...last, content: res.response }
              ];
            }
            return prev;
          });
        }
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
      } else if (event.event === 'queue_cleared') {
        setQueueCount(0);
      } else if (event.event === 'error') {
        setMessages((prev) => [
          ...prev,
          {
            id: `err-${Date.now()}`,
            role: 'assistant',
            content: `⚠️ **Erreur :** ${event.message || 'Une erreur est survenue lors de l\'exécution.'}`
          }
        ]);
        setIsStreaming(false);
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
      }
    });

    return () => unsubscribe();
  }, [activeConversationId]);

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
    setMessages((prev) => [...prev, userMsg]);

    if (mode === 'queue') {
      setQueueCount((prev) => prev + 1);
    } else {
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

  const handleModelSavedFromSettings = (newModelId: string) => {
    setSelectedModel(newModelId);
    const found = models.find((m) => m.id === newModelId);
    if (found?.default_effort) {
      setSelectedEffort(found.default_effort as any);
    }
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

  const activeConv = conversations.find((c) => c.conversation_id === activeConversationId);
  const currentModelObj = models.find((m) => m.id === selectedModel);
  const displayModelName = currentModelObj ? currentModelObj.name : 'Gemini 3.8 Flash';
  const displayEffort = currentModelObj && currentModelObj.supported_efforts.length > 0 ? selectedEffort : undefined;

  return (
    <div className="flex h-screen w-screen bg-[#080c16] text-slate-100 font-sans overflow-hidden antialiased">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
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
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
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
          onSelectModel={setSelectedModel}
          selectedEffort={selectedEffort}
          onSelectEffort={setSelectedEffort}
          initialPrompt={quickPrompt}
          usage={tokenUsage}
          queueCount={queueCount}
          onClearQueue={handleClearQueue}
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
