import React from 'react';
import { 
  Plus, 
  MessageSquare, 
  FolderGit2, 
  Settings as SettingsIcon, 
  FileText, 
  Sparkles,
  ChevronRight,
  Clock
} from 'lucide-react';
import type { Conversation } from '../types';

interface SidebarProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onOpenSettings: () => void;
  onOpenWorkspaces: () => void;
  onOpenArtifacts: () => void;
  currentWorkspace: string;
}

export const Sidebar: React.FC<SidebarProps> = ({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onOpenSettings,
  onOpenWorkspaces,
  onOpenArtifacts,
  currentWorkspace,
}) => {
  return (
    <aside className="w-72 h-screen bg-slate-900 border-r border-slate-800 flex flex-col justify-between shrink-0">
      {/* Header */}
      <div className="p-4 border-b border-slate-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-semibold text-sm tracking-wide text-slate-100">Antigravity</h1>
              <p className="text-[10px] text-sky-400 font-medium tracking-wider uppercase">Web Control</p>
            </div>
          </div>
        </div>

        {/* New Chat Button */}
        <button
          onClick={onNewConversation}
          className="w-full py-2.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs flex items-center justify-center gap-2 shadow-sm transition-all duration-150 active:scale-[0.98]"
        >
          <Plus className="w-4 h-4" />
          <span>Nouvelle session</span>
        </button>

        {/* Current Workspace Selector */}
        <button
          onClick={onOpenWorkspaces}
          className="w-full mt-2 py-1.5 px-2.5 rounded-md bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 text-slate-300 text-xs flex items-center justify-between transition-colors"
          title={`Workspace actuel: ${currentWorkspace}`}
        >
          <div className="flex items-center gap-2 truncate">
            <FolderGit2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate text-[11px] font-mono">{currentWorkspace}</span>
          </div>
          <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
        </button>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
        <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          Sessions récentes ({conversations.length})
        </div>

        {conversations.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-500">
            Aucune session trouvée.
          </div>
        ) : (
          conversations.map((c) => {
            const isActive = c.conversation_id === activeConversationId;
            return (
              <button
                key={c.conversation_id}
                onClick={() => onSelectConversation(c.conversation_id)}
                className={`w-full text-left p-2.5 rounded-lg text-xs transition-all group flex flex-col gap-1 border ${
                  isActive
                    ? 'bg-slate-800 border-sky-500/40 text-slate-100 shadow-sm'
                    : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 truncate font-medium">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-500 group-hover:text-slate-400'}`} />
                    <span className="truncate">{c.title || 'Session sans titre'}</span>
                  </div>
                  {c.step_count > 0 && (
                    <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded border border-slate-700 shrink-0">
                      {c.step_count}
                    </span>
                  )}
                </div>

                {c.preview && (
                  <p className="text-[11px] text-slate-500 truncate pl-5">
                    {c.preview}
                  </p>
                )}

                <div className="flex items-center gap-1.5 text-[10px] text-slate-600 pl-5 pt-0.5">
                  <Clock className="w-2.5 h-2.5" />
                  <span>{new Date(c.last_modified_time).toLocaleDateString()}</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-3 border-t border-slate-800 space-y-1 bg-slate-900/50">
        <button
          onClick={onOpenArtifacts}
          className="w-full py-2 px-2.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 text-xs flex items-center justify-between transition-colors"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-emerald-400" />
            <span>Documents & Artifacts</span>
          </div>
          <span className="text-[10px] bg-emerald-950/60 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-800/40">
            Explorer
          </span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-2.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 text-xs flex items-center gap-2 transition-colors"
        >
          <SettingsIcon className="w-4 h-4 text-slate-400" />
          <span>Paramètres & Modèles</span>
        </button>
      </div>
    </aside>
  );
};
