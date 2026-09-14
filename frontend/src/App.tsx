import { useState, useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { ChatCanvas } from './components/ChatCanvas';
import { ChatInput } from './components/ChatInput';
import { ArtifactViewer } from './components/ArtifactViewer';
import { SettingsModal } from './components/SettingsModal';
import { WorkspaceModal } from './components/WorkspaceModal';
import type { Conversation, ChatMessage, ModelOption } from './types';
import { 
  fetchConversations, 
  fetchConversationTranscript, 
  fetchModels, 
  fetchSettings 
} from './services/api';
import { chatSocket } from './services/ws';

export function App() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentWorkspace, setCurrentWorkspace] = useState('/root');

  const [models, setModels] = useState<ModelOption[]>([]);
  const [selectedModel, setSelectedModel] = useState('gemini-3.8-flash-high');

  // Modals
  const [isArtifactsOpen, setIsArtifactsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isWorkspacesOpen, setIsWorkspacesOpen] = useState(false);

  // Initialize
  useEffect(() => {
    loadInitialData();
  }, []);

  const loadInitialData = async () => {
    try {
      const [convs, mods, settings] = await Promise.all([
        fetchConversations(50),
        fetchModels(),
        fetchSettings()
      ]);
      setConversations(convs);
      setModels(mods);
      if (mods.length > 0) {
        setSelectedModel(mods[0].id);
      }
      if (settings.trustedWorkspaces && settings.trustedWorkspaces.length > 0) {
        setCurrentWorkspace(settings.trustedWorkspaces[0]);
      }
    } catch (e) {
      console.error('Error loading initial data:', e);
    }
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
        setIsStreaming(false);
      }
    });

    return () => unsubscribe();
  }, [activeConversationId]);

  // Send message
  const handleSendMessage = (
    prompt: string,
    options: { model?: string; effort?: string; autoApprove?: boolean }
  ) => {
    // Append user message immediately
    const userMsg: ChatMessage = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMsg]);
    setIsStreaming(true);

    // Send through WebSocket
    chatSocket.sendPrompt({
      prompt,
      conversationId: activeConversationId || undefined,
      workspacePath: currentWorkspace,
      model: options.model,
      effort: options.effort,
      autoApprove: options.autoApprove
    });
  };

  const activeConv = conversations.find((c) => c.conversation_id === activeConversationId);

  return (
    <div className="flex h-screen w-screen bg-[#0b0f19] text-slate-100 font-sans overflow-hidden">
      {/* Sidebar */}
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onSelectConversation={handleSelectConversation}
        onNewConversation={handleNewConversation}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenWorkspaces={() => setIsWorkspacesOpen(true)}
        onOpenArtifacts={() => setIsArtifactsOpen(true)}
        currentWorkspace={currentWorkspace}
      />

      {/* Main Chat Area */}
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        <ChatCanvas
          messages={messages}
          isStreaming={isStreaming}
          conversationTitle={activeConv?.title}
          activeModel={selectedModel}
        />

        <ChatInput
          onSendMessage={handleSendMessage}
          isStreaming={isStreaming}
          onStopStreaming={() => setIsStreaming(false)}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={setSelectedModel}
        />
      </main>

      {/* Modals & Panels */}
      <ArtifactViewer
        isOpen={isArtifactsOpen}
        onClose={() => setIsArtifactsOpen(false)}
        conversationId={activeConversationId}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        models={models}
      />

      <WorkspaceModal
        isOpen={isWorkspacesOpen}
        onClose={() => setIsWorkspacesOpen(false)}
        currentWorkspace={currentWorkspace}
        onSelectWorkspace={(ws) => setCurrentWorkspace(ws)}
      />
    </div>
  );
}

export default App;
