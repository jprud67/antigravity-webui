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
  Search,
  HardDrive,
  Activity,
  LogOut
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
  onOpenFiles?: () => void;
  onOpenTasks?: () => void;
  onLogout?: () => void;
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
  onOpenFiles,
  onOpenTasks,
  onLogout,
  currentWorkspace,
  activeModel = 'Gemini 3.8 Flash',
  activeEffort
}) => {
  const [searchFilter, setSearchFilter] = useState('');

  const filtered = conversations.filter((c) => {
    if (!searchFilter) return true;
    const titleMatch = (c.title || '').toLowerCase().includes(searchFilter.toLowerCase());
    const idMatch = c.conversation_id.toLowerCase().includes(searchFilter.toLowerCase());
    return titleMatch || idMatch;
  });

  return (
    <aside className="w-80 h-screen bg-[#070b14] border-r border-slate-800/80 flex flex-col shrink-0 select-none">
      {/* Brand Header */}
      <div className="h-14 px-4 border-b border-slate-800/60 flex items-center justify-between bg-[#0a0f1e]/60">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-indigo-600 flex items-center justify-center shadow-md shadow-sky-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-xs tracking-wide text-white uppercase flex items-center gap-1.5 font-mono">
              Antigravity <span className="text-[9px] bg-sky-500/20 text-sky-400 px-1.5 py-0.2 rounded font-sans font-semibold">WebUI</span>
            </h1>
          </div>
        </div>

        <button
          onClick={onNewConversation}
          className="p-1.5 rounded-lg bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 text-sky-400 hover:text-sky-300 transition-colors cursor-pointer"
          title="Nouvelle session"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Workspace Selector Bar */}
      <div className="p-3 border-b border-slate-800/50">
        <button
          onClick={onOpenWorkspaces}
          className="w-full p-2 rounded-xl bg-[#0d1324] hover:bg-[#111a33] border border-slate-800 hover:border-slate-700 transition-all text-left flex items-center justify-between cursor-pointer group"
        >
          <div className="flex items-center gap-2 min-w-0">
            <FolderGit2 className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <span className="text-[10px] text-slate-500 block uppercase tracking-wider font-semibold">Workspace actif</span>
              <p className="text-xs text-slate-200 truncate font-mono font-medium">{currentWorkspace}</p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 text-slate-500 group-hover:text-slate-300 group-hover:translate-x-0.5 transition-all shrink-0" />
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 py-2 border-b border-slate-800/40">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Filtrer les sessions..."
            value={searchFilter}
            onChange={(e) => setSearchFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-[#0a0f20] border border-slate-800/80 rounded-lg text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
        </div>
      </div>

      {/* Conversation List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        <div className="px-2 py-1 flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
          <span>Historique ({filtered.length})</span>
        </div>

        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            Aucune session trouvée.
          </div>
        ) : (
          filtered.map((conv) => {
            const isSelected = activeConversationId === conv.conversation_id;
            return (
              <button
                key={conv.conversation_id}
                onClick={() => onSelectConversation(conv.conversation_id)}
                className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 border cursor-pointer ${
                  isSelected
                    ? 'bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border-sky-500/50 text-white shadow-sm'
                    : 'border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MessageSquare className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-sky-400' : 'text-slate-500'}`} />
                  <span className="truncate font-medium text-xs">
                    {conv.title || `Session ${conv.conversation_id.substring(0, 8)}`}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-500 pl-5.5 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {new Date(conv.last_modified_time).toLocaleDateString()}
                  </span>
                  <span>{conv.step_count} étapes</span>
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Footer Navigation */}
      <div className="p-3 border-t border-slate-800/70 space-y-1 bg-[#080c16]/90">
        {onOpenFiles && (
          <button
            onClick={onOpenFiles}
            className="w-full py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                <HardDrive className="w-3 h-3 text-sky-400" />
              </div>
              <span className="font-medium text-[11px]">Explorateur Workspace</span>
            </div>
            <span className="text-[10px] text-sky-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </button>
        )}

        {onOpenTasks && (
          <button
            onClick={onOpenTasks}
            className="w-full py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Activity className="w-3 h-3 text-indigo-400" />
              </div>
              <span className="font-medium text-[11px]">Tâches & Sous-Agents</span>
            </div>
            <span className="text-[10px] text-indigo-400 group-hover:translate-x-0.5 transition-transform">→</span>
          </button>
        )}

        <button
          onClick={onOpenArtifacts}
          className="w-full py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-3 h-3 text-emerald-400" />
            </div>
            <span className="font-medium text-[11px]">Artifacts & Documents</span>
          </div>
          <span className="text-[10px] text-emerald-400 group-hover:translate-x-0.5 transition-transform">→</span>
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full py-1.5 px-2.5 rounded-lg text-slate-300 hover:text-slate-100 hover:bg-slate-800/70 text-xs flex items-center justify-between transition-colors cursor-pointer group"
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <SettingsIcon className="w-3 h-3 text-purple-400" />
            </div>
            <span className="font-medium text-[11px]">Réglages & Modèles</span>
          </div>
          <div className="flex items-center gap-1 font-mono text-[9px] text-slate-400 truncate max-w-[95px]">
            <span className="truncate">{activeModel.split(' ')[0]}</span>
            {activeEffort && (
              <span className="bg-slate-800 text-sky-400 px-1 rounded text-[8px] uppercase font-bold">
                {activeEffort}
              </span>
            )}
          </div>
        </button>

        {onLogout && (
          <button
            onClick={onLogout}
            className="w-full py-1.5 px-2.5 rounded-lg text-slate-500 hover:text-rose-300 hover:bg-rose-500/10 text-[11px] flex items-center gap-2 transition-colors cursor-pointer"
            title="Verrouiller la session"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Déconnexion</span>
          </button>
        )}
      </div>
    </aside>
  );
};
