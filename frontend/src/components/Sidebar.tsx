import React, { useState, useMemo } from 'react';
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
  LogOut,
  Pin,
  MoreVertical,
  GitBranch,
  X,
  Palette
} from 'lucide-react';
import type { Conversation } from '../types';
import { getStoredTheme, applyTheme, type AppTheme } from '../services/theme';

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
  onTogglePin?: (id: string, currentPin: boolean) => void;
  onEditSessionMeta?: (conv: Conversation) => void;
  currentWorkspace: string;
  activeModel?: string;
  activeEffort?: string;
  onSearchQuery?: (q: string) => void;
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
  onTogglePin,
  onEditSessionMeta,
  currentWorkspace,
  activeModel = 'Gemini 3.8 Flash',
  activeEffort,
  onSearchQuery
}) => {
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagsSet = new Set<string>();
    conversations.forEach((c) => {
      (c.tags || []).forEach((t) => tagsSet.add(t));
    });
    return Array.from(tagsSet);
  }, [conversations]);

  const handleSearchChange = (val: string) => {
    setSearchFilter(val);
    if (onSearchQuery) {
      onSearchQuery(val);
    }
  };

  // Filter conversations
  const filtered = useMemo(() => {
    return conversations.filter((c) => {
      if (selectedTag) {
        const hasTag = (c.tags || []).map((t) => t.toLowerCase()).includes(selectedTag.toLowerCase());
        if (!hasTag) return false;
      }
      if (!searchFilter.trim()) return true;
      const q = searchFilter.toLowerCase();
      const titleMatch = (c.title || '').toLowerCase().includes(q);
      const previewMatch = (c.preview || '').toLowerCase().includes(q);
      const projectMatch = (c.project || '').toLowerCase().includes(q);
      const tagsMatch = (c.tags || []).some((t) => t.toLowerCase().includes(q));
      const snippetMatch = (c.match_snippet || '').toLowerCase().includes(q);
      return titleMatch || previewMatch || projectMatch || tagsMatch || snippetMatch;
    });
  }, [conversations, searchFilter, selectedTag]);

  // Date Grouping logic
  const groupedConversations = useMemo(() => {
    const pinned: Conversation[] = [];
    const today: Conversation[] = [];
    const yesterday: Conversation[] = [];
    const last7Days: Conversation[] = [];
    const last30Days: Conversation[] = [];
    const older: Conversation[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOf7Days = new Date(startOfToday);
    startOf7Days.setDate(startOf7Days.getDate() - 7);
    const startOf30Days = new Date(startOfToday);
    startOf30Days.setDate(startOf30Days.getDate() - 30);

    filtered.forEach((c) => {
      if (c.pinned) {
        pinned.push(c);
        return;
      }
      const date = new Date(c.last_modified_time);
      if (date >= startOfToday) {
        today.push(c);
      } else if (date >= startOfYesterday) {
        yesterday.push(c);
      } else if (date >= startOf7Days) {
        last7Days.push(c);
      } else if (date >= startOf30Days) {
        last30Days.push(c);
      } else {
        older.push(c);
      }
    });

    return [
      { label: '📌 Épinglées', items: pinned },
      { label: '📅 Aujourd\'hui', items: today },
      { label: '📅 Hier', items: yesterday },
      { label: '📅 7 derniers jours', items: last7Days },
      { label: '📅 Ce mois-ci', items: last30Days },
      { label: '🗄️ Plus ancien', items: older },
    ].filter((g) => g.items.length > 0);
  }, [filtered]);

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
      <div className="px-3 py-2 border-b border-slate-800/40 space-y-2">
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Rechercher sessions & contenu..."
            value={searchFilter}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 bg-[#0a0f20] border border-slate-800/80 rounded-lg text-xs text-slate-300 placeholder-slate-500 focus:outline-none focus:border-sky-500/50"
          />
          {searchFilter && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-2.5 text-slate-500 hover:text-slate-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Tag Filter Chips Bar */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none text-[10px] font-mono">
            <button
              onClick={() => setSelectedTag(null)}
              className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-colors cursor-pointer border ${
                selectedTag === null
                  ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 font-semibold'
                  : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
              }`}
            >
              #tous
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className={`px-2 py-0.5 rounded-full whitespace-nowrap transition-colors cursor-pointer border ${
                  selectedTag === tag
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40 font-semibold'
                    : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                }`}
              >
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Grouped Conversation List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-xs text-slate-500">
            {searchFilter || selectedTag ? 'Aucune session ne correspond aux filtres.' : 'Aucune session trouvée.'}
          </div>
        ) : (
          groupedConversations.map((group) => (
            <div key={group.label} className="space-y-1">
              <div className="px-2 py-0.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                {group.label} ({group.items.length})
              </div>

              {group.items.map((conv) => {
                const isSelected = activeConversationId === conv.conversation_id;
                const isPinned = !!conv.pinned;
                const isBranch = !!conv.parent_conversation_id;

                return (
                  <div
                    key={conv.conversation_id}
                    className={`group relative w-full text-left p-2 rounded-xl text-xs transition-all flex flex-col gap-1 border cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border-sky-500/50 text-white shadow-sm'
                        : 'border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                    onClick={() => onSelectConversation(conv.conversation_id)}
                  >
                    {/* Header line: Project color, icon, title, pin & more */}
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {conv.projectColor ? (
                          <span
                            className="w-2 h-2 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: conv.projectColor }}
                            title={`Projet: ${conv.project || 'Sans nom'}`}
                          />
                        ) : null}

                        {isBranch ? (
                          <span title="Session issue d'une bifurcation (branche)">
                            <GitBranch className="w-3 h-3 text-fuchsia-400 shrink-0" />
                          </span>
                        ) : (
                          <MessageSquare className={`w-3 h-3 shrink-0 ${isSelected ? 'text-sky-400' : 'text-slate-500'}`} />
                        )}

                        <span className="truncate font-medium text-xs">
                          {conv.title || `Session ${conv.conversation_id.substring(0, 8)}`}
                        </span>
                      </div>

                      {/* Right hover actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {onTogglePin && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onTogglePin(conv.conversation_id, isPinned);
                            }}
                            className={`p-1 rounded hover:bg-slate-800 transition-colors ${
                              isPinned ? 'text-amber-400' : 'text-slate-600 hover:text-slate-300 opacity-0 group-hover:opacity-100'
                            }`}
                            title={isPinned ? 'Désépingler' : 'Épingler en haut'}
                          >
                            <Pin className={`w-3 h-3 ${isPinned ? 'fill-current' : ''}`} />
                          </button>
                        )}

                        {onEditSessionMeta && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditSessionMeta(conv);
                            }}
                            className="p-1 rounded text-slate-600 hover:text-slate-300 hover:bg-slate-800 transition-colors opacity-0 group-hover:opacity-100"
                            title="Gérer les tags, projet et titre"
                          >
                            <MoreVertical className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Search match snippet if any */}
                    {conv.match_snippet && (
                      <p className="text-[10px] text-sky-400/90 italic font-mono truncate pl-4.5 bg-sky-950/20 rounded px-1 py-0.5">
                        {conv.match_snippet}
                      </p>
                    )}

                    {/* Metadata Sub-row: tags, step count, date */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pl-4.5 font-mono">
                      <div className="flex items-center gap-1 truncate max-w-[60%]">
                        {conv.project && (
                          <span className="px-1.5 py-0.2 rounded bg-slate-800/80 text-slate-300 text-[9px] font-sans">
                            {conv.project}
                          </span>
                        )}
                        {(conv.tags || []).slice(0, 2).map((t) => (
                          <span key={t} className="text-[9px] text-emerald-400/80">
                            #{t}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {new Date(conv.last_modified_time).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                        </span>
                        <span>{conv.step_count}st</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
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
              <span className="font-medium text-[11px]">Tâches & Sous-agents</span>
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
            <span className="font-medium text-[11px]">Documents & Artifacts</span>
          </div>
          <span className="text-[10px] text-emerald-400 group-hover:translate-x-0.5 transition-transform">→</span>
        </button>

        {/* Active Model Indicator */}
        <div className="pt-2 border-t border-slate-800/60 mt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono px-1">
          <span className="truncate">{activeModel}</span>
          {activeEffort && (
            <span className="text-[9px] bg-sky-500/10 text-sky-400 px-1.5 py-0.2 rounded border border-sky-500/20 font-bold uppercase">
              {activeEffort}
            </span>
          )}
        </div>

        <div className="pt-1.5 flex items-center justify-between text-xs">
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Paramètres Antigravity"
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="text-[11px]">Paramètres</span>
          </button>

          <div className="flex items-center gap-1">
            <button
              onClick={() => {
                const themes: AppTheme[] = ['dark', 'oled', 'slate', 'cyberpunk', 'light'];
                const current = getStoredTheme();
                const nextIdx = (themes.indexOf(current) + 1) % themes.length;
                applyTheme(themes[nextIdx]);
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition-colors cursor-pointer"
              title="Changer rapidement de thème visuel"
            >
              <Palette className="w-4 h-4" />
            </button>

            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Déconnexion"
              >
                <LogOut className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
};
