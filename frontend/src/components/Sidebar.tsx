import React, { useState, useMemo } from 'react';
import { 
  Plus, 
  MessageSquare, 
  FolderGit2, 
  Settings as SettingsIcon, 
  FileText, 
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
  Palette,
  HelpCircle
} from 'lucide-react';
import type { Conversation } from '../types';
import { getStoredTheme, applyAppearance, type ThemeMode } from '../services/theme';
import { AntigravityIcon } from './AntigravityLogo';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';
import type { GoogleAccountInfo } from '../services/api';

function parseSafeDate(dateVal: any): Date {
  if (!dateVal) return new Date();
  if (typeof dateVal === 'string') {
    return new Date(dateVal.replace(' ', 'T'));
  }
  return new Date(dateVal);
}

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
  onOpenLanguages?: () => void;
  onOpenHelp?: () => void;
  onLogout?: () => void;
  onTogglePin?: (id: string, currentPin: boolean) => void;
  onEditSessionMeta?: (conv: Conversation) => void;
  currentWorkspace: string;
  activeModel?: string;
  activeEffort?: string;
  onSearchQuery?: (q: string) => void;
  activeGoogleAccount?: GoogleAccountInfo | null;
  onOpenGoogleAccount?: () => void;
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
  onOpenLanguages,
  onOpenHelp,
  onLogout,
  onTogglePin,
  onEditSessionMeta,
  currentWorkspace,
  activeModel = 'Gemini 3.8 Flash',
  activeEffort,
  onSearchQuery,
  activeGoogleAccount,
  onOpenGoogleAccount
}) => {
  const { lang, t } = useI18n();
  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
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
      const date = parseSafeDate(c.last_modified_time);
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
    <aside
      className="w-80 h-screen border-r flex flex-col shrink-0 select-none transition-colors"
      style={{
        backgroundColor: 'var(--sidebar)',
        borderColor: 'var(--border)',
        color: 'var(--text)',
      }}
    >
      {/* Brand Header */}
      <div
        className="h-14 px-4 border-b flex items-center justify-between transition-colors shrink-0"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: 'var(--surface-subtle)',
        }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shadow-xs p-1 shrink-0 transition-colors"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
            }}
          >
            <AntigravityIcon size={22} />
          </div>
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className="font-bold text-sm tracking-tight truncate font-sans"
              style={{ color: 'var(--strong)' }}
            >
              Antigravity
            </span>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded font-sans font-semibold"
              style={{
                backgroundColor: 'var(--accent-bg)',
                color: 'var(--accent)',
              }}
            >
              WebUI
            </span>
          </div>
        </div>

        <button
          onClick={onNewConversation}
          className="p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center"
          style={{
            backgroundColor: 'var(--accent-bg)',
            borderColor: 'var(--accent)',
            color: 'var(--accent)',
          }}
          title={t('new_session', 'Nouvelle session')}
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Workspace Selector Bar */}
      <div className="p-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={onOpenWorkspaces}
          className="w-full p-2.5 rounded-xl transition-all text-left flex items-center justify-between cursor-pointer group shadow-xs hover:border-sky-500/50"
          style={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <FolderGit2 className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <div className="min-w-0">
              <span className="text-[10px] block uppercase tracking-wider font-semibold" style={{ color: 'var(--muted)' }}>
                Workspace actif
              </span>
              <p className="text-xs truncate font-mono font-medium" style={{ color: 'var(--strong)' }}>
                {currentWorkspace}
              </p>
            </div>
          </div>
          <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform shrink-0" style={{ color: 'var(--muted)' }} />
        </button>
      </div>

      {/* Search Input */}
      <div className="px-3 py-2 border-b space-y-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5" style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            placeholder={t('search_sessions', 'Rechercher sessions & contenu...')}
            value={searchFilter}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="w-full pl-8 pr-7 py-1.5 rounded-lg text-xs placeholder-slate-400 focus:outline-none transition-colors"
            style={{
              backgroundColor: 'var(--input-bg)',
              border: '1px solid var(--border)',
              color: 'var(--text)',
            }}
          />
          {searchFilter && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-2.5 hover:opacity-100 transition-opacity cursor-pointer"
              style={{ color: 'var(--muted)' }}
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
              className="px-2 py-0.5 rounded-full whitespace-nowrap transition-colors cursor-pointer border font-semibold"
              style={{
                backgroundColor: selectedTag === null ? 'var(--accent-bg)' : 'var(--surface)',
                color: selectedTag === null ? 'var(--accent)' : 'var(--muted)',
                borderColor: selectedTag === null ? 'var(--accent)' : 'var(--border)',
              }}
            >
              #tous
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
                className="px-2 py-0.5 rounded-full whitespace-nowrap transition-colors cursor-pointer border"
                style={{
                  backgroundColor: selectedTag === tag ? 'rgba(16, 185, 129, 0.12)' : 'var(--surface)',
                  color: selectedTag === tag ? '#10B981' : 'var(--muted)',
                  borderColor: selectedTag === tag ? '#10B981' : 'var(--border)',
                  fontWeight: selectedTag === tag ? 600 : 400,
                }}
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
                    className="group relative w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1.5 border cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? 'var(--surface)' : 'transparent',
                      borderColor: isSelected ? 'var(--accent)' : 'transparent',
                      color: isSelected ? 'var(--strong)' : 'var(--text)',
                      boxShadow: isSelected ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}
                    onClick={() => onSelectConversation(conv.conversation_id)}
                  >
                    {/* Header line: Project color, icon, title, pin & more */}
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {conv.projectColor ? (
                          <span
                            className="w-2 h-2 rounded-full shrink-0 shadow-xs"
                            style={{ backgroundColor: conv.projectColor }}
                            title={`Projet: ${conv.project || 'Sans nom'}`}
                          />
                        ) : null}

                        {isBranch ? (
                          <span title="Session issue d'une bifurcation (branche)">
                            <GitBranch className="w-3 h-3 text-fuchsia-500 shrink-0" />
                          </span>
                        ) : (
                          <MessageSquare
                            className="w-3.5 h-3.5 shrink-0"
                            style={{ color: isSelected ? 'var(--accent)' : 'var(--muted)' }}
                          />
                        )}

                        <span className="truncate font-medium text-xs" style={{ color: isSelected ? 'var(--strong)' : 'var(--text)' }}>
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
                            className={`p-1 rounded hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer ${
                              isPinned ? 'text-amber-500' : 'opacity-0 group-hover:opacity-100'
                            }`}
                            style={{ color: isPinned ? '#F59E0B' : 'var(--muted)' }}
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
                            className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                            style={{ color: 'var(--muted)' }}
                            title="Gérer les tags, projet et titre"
                          >
                            <MoreVertical className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Search match snippet if any */}
                    {conv.match_snippet && (
                      <p
                        className="text-[10px] italic font-mono truncate pl-4.5 rounded px-1.5 py-0.5"
                        style={{
                          backgroundColor: 'var(--accent-bg)',
                          color: 'var(--accent)',
                        }}
                      >
                        {conv.match_snippet}
                      </p>
                    )}

                    {/* Metadata Sub-row: tags, step count, date */}
                    <div className="flex items-center justify-between text-[10px] pl-4.5 font-mono" style={{ color: 'var(--muted)' }}>
                      <div className="flex items-center gap-1 truncate max-w-[60%]">
                        {conv.project && (
                          <span
                            className="px-1.5 py-0.2 rounded text-[9px] font-sans font-medium"
                            style={{
                              backgroundColor: 'var(--surface-subtle)',
                              border: '1px solid var(--border)',
                              color: 'var(--text)',
                            }}
                          >
                            {conv.project}
                          </span>
                        )}
                        {(conv.tags || []).slice(0, 2).map((t) => (
                          <span key={t} className="text-[9px] text-emerald-500 font-medium">
                            #{t}
                          </span>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {parseSafeDate(conv.last_modified_time).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
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
      <div
        className="p-3 border-t space-y-1 transition-colors shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
        }}
      >
        {onOpenFiles && (
          <button
            onClick={onOpenFiles}
            className="w-full py-1.5 px-2.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
                <HardDrive className="w-3 h-3 text-sky-500" />
              </div>
              <span className="font-medium text-[11px]">{t('workspace_explorer', 'Explorateur Workspace')}</span>
            </div>
            <span className="text-[10px] text-sky-500 group-hover:translate-x-0.5 transition-transform">→</span>
          </button>
        )}

        {onOpenTasks && (
          <button
            onClick={onOpenTasks}
            className="w-full py-1.5 px-2.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--text)' }}
          >
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-md bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                <Activity className="w-3 h-3 text-indigo-500" />
              </div>
              <span className="font-medium text-[11px]">{t('tasks_and_subagents', 'Tâches & Sous-agents')}</span>
            </div>
            <span className="text-[10px] text-indigo-500 group-hover:translate-x-0.5 transition-transform">→</span>
          </button>
        )}

        <button
          onClick={onOpenArtifacts}
          className="w-full py-1.5 px-2.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer group hover:bg-black/5 dark:hover:bg-white/5"
          style={{ color: 'var(--text)' }}
        >
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-3 h-3 text-emerald-500" />
            </div>
            <span className="font-medium text-[11px]">{t('documents_and_artifacts', 'Documents & Artifacts')}</span>
          </div>
          <span className="text-[10px] text-emerald-500 group-hover:translate-x-0.5 transition-transform">→</span>
        </button>

        {/* Google Account Switcher Widget */}
        <button
          onClick={onOpenGoogleAccount || onOpenSettings}
          className="w-full mt-2 p-2 rounded-xl border flex items-center justify-between transition-all group cursor-pointer text-left hover:border-blue-500/40"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
          title={activeGoogleAccount?.email ? `Compte Google actif: ${activeGoogleAccount.email}` : 'Gérer les comptes Google'}
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 bg-white shadow-xs p-0.5">
              <svg viewBox="0 0 24 24" className="w-3.5 h-3.5">
                <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
                <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
                <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
                <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] truncate font-medium" style={{ color: 'var(--muted)' }}>
                Compte Google
              </div>
              <div className="text-[11px] font-mono truncate font-medium" style={{ color: 'var(--text)' }}>
                {activeGoogleAccount?.email || 'Non connecté'}
              </div>
            </div>
          </div>
          <span className="text-[10px] font-medium text-blue-500 opacity-80 group-hover:opacity-100 shrink-0 ml-1">
            Changer
          </span>
        </button>

        {/* Active Model Indicator */}
        <div
          className="pt-2 border-t mt-2 flex items-center justify-between text-[10px] font-mono px-1 shrink-0"
          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
        >
          <span className="truncate">{activeModel}</span>
          {activeEffort && (
            <span
              className="text-[9px] px-1.5 py-0.2 rounded border font-bold uppercase"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
              }}
            >
              {activeEffort}
            </span>
          )}
        </div>

        <div className="pt-1.5 flex items-center justify-between text-xs shrink-0">
          <button
            onClick={onOpenSettings}
            className="p-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
            style={{ color: 'var(--muted)' }}
            title={t('settings', 'Paramètres Antigravity')}
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>
              {t('settings', 'Paramètres')}
            </span>
          </button>

          <div className="flex items-center gap-1">
            {/* 15-Language Selector Button */}
            {onOpenLanguages && (
              <button
                onClick={onOpenLanguages}
                className="p-1.5 rounded-lg transition-colors cursor-pointer flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--muted)' }}
                title={`Langue: ${currentLangObj?.label || 'Français'} (15 langues disponibles)`}
              >
                <span className="text-xs">{currentLangObj?.flag || '🌐'}</span>
                <span className="text-[10px] font-mono uppercase">{lang}</span>
              </button>
            )}

            {/* Help & Shortcuts Button */}
            {onOpenHelp && (
              <button
                onClick={onOpenHelp}
                className="p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--muted)' }}
                title="Aide & Raccourcis (/help)"
              >
                <HelpCircle className="w-4 h-4" />
              </button>
            )}

            <button
              onClick={() => {
                const modes: ThemeMode[] = ['dark', 'light', 'system'];
                const current = getStoredTheme();
                const nextIdx = (modes.indexOf(current) + 1) % modes.length;
                applyAppearance(modes[nextIdx], undefined);
              }}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{ color: 'var(--muted)' }}
              title="Changer rapidement de thème visuel"
            >
              <Palette className="w-4 h-4" />
            </button>

            {onLogout && (
              <button
                onClick={onLogout}
                className="p-1.5 rounded-lg transition-colors cursor-pointer hover:text-rose-500 hover:bg-rose-500/10"
                style={{ color: 'var(--muted)' }}
                title={t('logout', 'Déconnexion')}
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
