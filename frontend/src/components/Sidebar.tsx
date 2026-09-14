import React, { useState } from 'react';
import { 
  Plus, 
  MessageSquare, 
  FolderGit2, 
  Settings as SettingsIcon, 
  FileText, 
  Sparkles,
  ChevronRight,
  Clock,
  Search
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
  activeModel?: string;
  activeEffort?: string;
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
  activeModel = 'Gemini 3.8 Flash',
  activeEffort
}) => {
  const [searchFilter, setSearchFilter] = useState('');

  const filteredConversations = conversations.filter((c) => {
    const titleMatch = (c.title || '').toLowerCase().includes(searchFilter.toLowerCase());
    const previewMatch = (c.preview || '').toLowerCase().includes(searchFilter.toLowerCase());
    return titleMatch || previewMatch;
  });

  return (
    <aside className="w-80 h-screen bg-[#070b14] border-r border-slate-800/70 flex flex-col justify-between shrink-0 select-none">
      {/* Header & Branding */}
      <div className="p-4 border-b border-slate-800/60 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 via-indigo-500 to-fuchsia-500 p-[1px] shadow-lg shadow-sky-500/20">
              <div className="w-full h-full bg-[#090d1a] rounded-[11px] flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-sky-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-sm tracking-tight text-white">Antigravity</h1>
                <span className="text-[10px] bg-sky-500/10 text-sky-400 border border-sky-500/20 px-1.5 py-0.2 rounded font-mono font-medium">UI</span>
              </div>
              <p className="text-[11px] text-slate-400 font-medium">Cockpit de pilotage</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>En ligne</span>
          </div>
        </div>

        {/* New Session Button */}
        <button
          onClick={onNewConversation}
          className="w-full py-2.5 px-3.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-medium text-xs flex items-center justify-between shadow-md shadow-sky-500/15 transition-all duration-200 active:scale-[0.99] group cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <Plus className="w-4 h-4 text-white/90 group-hover:rotate-90 transition-transform duration-200" />
            <span>Nouvelle session</span>
          </div>
          <kbd className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded text-white/90 font-mono">⌘N</kbd>
        </button>

        {/* Current Workspace Pill */}
        <button
          onClick={onOpenWorkspaces}
          className="w-full py-2 px-3 rounded-lg bg-slate-900/80 hover:bg-slate-800/90 border border-slate-800 hover:border-slate-700 text-slate-300 text-xs flex items-center justify-between transition-all group cursor-pointer"
          title={`Workspace actuel: ${currentWorkspace}`}
        >
          <div className="flex items-center gap-2 truncate">
            <FolderGit2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <div className="flex flex-col items-start truncate">
              <span className="text-[9px] uppercase tracking-wider text-slate-400 font-semibold">Workspace</span>
              <span className="truncate text-[11px] font-mono text-slate-200">{currentWorkspace}</span>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-200 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>

        {/* Search input */}
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            placeholder="Rechercher une conversation..."
            className="w-full bg-[#0b101d] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-slate-200 placeholder-slate-400 focus:outline-none focus:border-sky-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Conversations List */}
      <div className="flex-1 overflow-y-auto px-2.5 py-3 space-y-1">
        <div className="flex items-center justify-between px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Historique</span>
          <span className="font-mono bg-slate-800/80 text-slate-400 px-1.5 rounded">{filteredConversations.length}</span>
        </div>

        {filteredConversations.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-400 space-y-1">
            <p>Aucune session trouvée</p>
            {searchFilter && <p className="text-[10px] text-slate-400">Essayez un autre mot-clé.</p>}
          </div>
        ) : (
          filteredConversations.map((c) => {
            const isActive = c.conversation_id === activeConversationId;
            return (
              <button
                key={c.conversation_id}
                onClick={() => onSelectConversation(c.conversation_id)}
                className={`w-full text-left p-3 rounded-xl text-xs transition-all flex flex-col gap-1.5 border relative cursor-pointer ${
                  isActive
                    ? 'bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900/80 border-sky-500/50 text-slate-100 shadow-sm'
                    : 'bg-transparent border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200 hover:border-slate-800/50'
                }`}
              >
                {isActive && (
                  <div className="absolute left-0 top-2 bottom-2 w-1 bg-gradient-to-b from-sky-400 to-indigo-500 rounded-r" />
                )}

                <div className="flex items-center justify-between w-full">
                  <div className="flex items-center gap-2 truncate font-medium">
                    <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-sky-400' : 'text-slate-400'}`} />
                    <span className="truncate font-semibold text-slate-200">
                      {c.title || 'Session sans titre'}
                    </span>
                  </div>
                  {c.step_count > 0 && (
                    <span className="text-[10px] bg-slate-800/80 text-slate-300 px-1.5 py-0.5 rounded-full border border-slate-700/60 shrink-0 font-mono">
                      {c.step_count}
                    </span>
                  )}
                </div>

                {c.preview && (
                  <p className="text-[11px] text-slate-400 line-clamp-1 pl-5">
                    {c.preview}
                  </p>
                )}

                <div className="flex items-center justify-between text-[10px] text-slate-400 pl-5 pt-0.5">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-2.5 h-2.5 text-slate-400" />
                    <span>{new Date(c.last_modified_time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-3 border-t border-slate-800/70 space-y-1.5 bg-[#080c16]/90">
        <button
          onClick={onOpenArtifacts}
          className="w-full py-2 px-3 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <span className="font-medium text-xs">Artifacts & Documents</span>
          </div>
          <span className="text-[10px] text-emerald-400 group-hover:translate-x-0.5 transition-transform">→</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full py-2 px-3 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2.5">
            <div className="w-6 h-6 rounded-md bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <SettingsIcon className="w-3.5 h-3.5 text-sky-400" />
            </div>
            <span className="font-medium text-xs">Configuration & Modèles</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[10px] text-slate-400 truncate max-w-[110px]">
            <span className="truncate">{activeModel.split(' ')[0]}</span>
            {activeEffort && (
              <span className="bg-slate-800 text-sky-400 px-1 rounded text-[9px] uppercase font-bold">
                {activeEffort}
              </span>
            )}
          </div>
        </button>
      </div>
    </aside>
  );
};
