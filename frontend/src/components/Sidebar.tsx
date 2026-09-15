import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  PinOff,
  MoreVertical,
  GitBranch,
  X,
  Palette,
  HelpCircle,
  CheckSquare,
  Square,
  Trash2,
  Tag,
  Folder,
  Download, 
  Check, 
  Loader2,
  Upload
} from 'lucide-react';
import type { Conversation } from '../types';
import { getStoredTheme, applyAppearance, type ThemeMode } from '../services/theme';
import { AntigravityIcon } from './AntigravityLogo';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';
import type { GoogleAccountInfo } from '../services/api';
import { bulkConversationAction, bulkConversationExport, importConversation } from '../services/api';
import { showToast } from './Toast';
import { showConfirm } from './AppDialog';

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
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
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
  onRefreshConversations?: () => Promise<void> | void;
  updateAvailable?: boolean;
  onOpenUpdates?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = React.memo(({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  isMobileOpen = false,
  onCloseMobile,
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
  onOpenGoogleAccount,
  onRefreshConversations,
  updateAvailable,
  onOpenUpdates
}) => {
  const { lang, t } = useI18n();
  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
  const [searchFilter, setSearchFilter] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  // Bulk mode states
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedConvIds, setSelectedConvIds] = useState<Set<string>>(new Set());
  const [isBulkLoading, setIsBulkLoading] = useState(false);
  const [showBulkTagModal, setShowBulkTagModal] = useState(false);
  const [bulkTagMode, setBulkTagMode] = useState<'add' | 'replace'>('add');
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [showBulkProjectModal, setShowBulkProjectModal] = useState(false);
  const [bulkProjectInput, setBulkProjectInput] = useState('');
  const [bulkProjectColor, setBulkProjectColor] = useState('#3B82F6');
  const importFileInputRef = useRef<HTMLInputElement>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await importConversation(payload);
      showToast(`Session importée : ${res.title}`, 'success');
      if (onRefreshConversations) {
        await onRefreshConversations();
      }
      onSelectConversation(res.conversation_id);
    } catch (err: any) {
      showToast(`Erreur lors de l'import : ${err.message}`, 'error');
    } finally {
      e.target.value = '';
    }
  };

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
      // Debounce the backend search (deep transcript scan) to avoid a request per keystroke
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = setTimeout(() => {
        onSearchQuery(val);
      }, 350);
    }
  };

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, []);

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
    const archived: Conversation[] = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfYesterday = new Date(startOfToday);
    startOfYesterday.setDate(startOfYesterday.getDate() - 1);
    const startOf7Days = new Date(startOfToday);
    startOf7Days.setDate(startOf7Days.getDate() - 7);
    const startOf30Days = new Date(startOfToday);
    startOf30Days.setDate(startOf30Days.getDate() - 30);

    filtered.forEach((c) => {
      if (c.archived) {
        archived.push(c);
        return;
      }
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
      { label: '📦 Archives', items: archived },
    ].filter((g) => g.items.length > 0);
  }, [filtered]);

  // Bulk selection helpers & handlers
  const isAllSelected = useMemo(() => {
    if (filtered.length === 0) return false;
    return filtered.every((c) => selectedConvIds.has(c.conversation_id));
  }, [filtered, selectedConvIds]);

  const handleToggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedConvIds(new Set());
    } else {
      setSelectedConvIds(new Set(filtered.map((c) => c.conversation_id)));
    }
  };

  const handleToggleCardSelection = (id: string) => {
    setSelectedConvIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleBulkDelete = async () => {
    if (selectedConvIds.size === 0) return;
    const count = selectedConvIds.size;
    if (!(await showConfirm(`Supprimer définitivement ces ${count} session(s) ? Cette action est irréversible.`, { destructive: true }))) {
      return;
    }
    setIsBulkLoading(true);
    try {
      const ids = Array.from(selectedConvIds);
      await bulkConversationAction({
        action: 'delete',
        conversation_ids: ids,
      });
      if (activeConversationId && ids.includes(activeConversationId)) {
        onNewConversation();
      }
      if (onRefreshConversations) {
        await onRefreshConversations();
      }
      setSelectedConvIds(new Set());
      setIsBulkMode(false);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression groupée', 'error');
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkPin = async (pinState: boolean) => {
    if (selectedConvIds.size === 0) return;
    setIsBulkLoading(true);
    try {
      const ids = Array.from(selectedConvIds);
      await bulkConversationAction({
        action: pinState ? 'pin' : 'unpin',
        conversation_ids: ids,
      });
      if (onRefreshConversations) {
        await onRefreshConversations();
      }
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'épinglage groupé", 'error');
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleApplyBulkTags = async () => {
    if (selectedConvIds.size === 0) return;
    const tags = bulkTagInput
      .split(',')
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean);

    setIsBulkLoading(true);
    try {
      await bulkConversationAction({
        action: 'tag',
        conversation_ids: Array.from(selectedConvIds),
        payload: { tags, mode: bulkTagMode },
      });
      if (onRefreshConversations) {
        await onRefreshConversations();
      }
      setShowBulkTagModal(false);
      setBulkTagInput('');
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'application des tags", 'error');
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleApplyBulkProject = async (clear = false) => {
    if (selectedConvIds.size === 0) return;
    setIsBulkLoading(true);
    try {
      await bulkConversationAction({
        action: 'project',
        conversation_ids: Array.from(selectedConvIds),
        payload: {
          project: clear ? '' : bulkProjectInput.trim(),
          projectColor: clear ? '' : bulkProjectColor,
        },
      });
      if (onRefreshConversations) {
        await onRefreshConversations();
      }
      setShowBulkProjectModal(false);
      setBulkProjectInput('');
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'assignation du projet", 'error');
    } finally {
      setIsBulkLoading(false);
    }
  };

  const handleBulkExport = async () => {
    if (selectedConvIds.size === 0) return;
    setIsBulkLoading(true);
    try {
      await bulkConversationExport(Array.from(selectedConvIds));
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'export groupé", 'error');
    } finally {
      setIsBulkLoading(false);
    }
  };

  return (
    <>
      {/* Mobile Drawer Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden animate-fadeIn"
          onClick={onCloseMobile}
          aria-label="Fermer le menu latéral"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[85vw] max-w-[320px] md:static md:w-80 md:z-auto h-full border-r flex flex-col shrink-0 select-none transition-transform duration-300 ease-in-out md:translate-x-0 ${
          isMobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0'
        }`}
        style={{
          backgroundColor: 'var(--sidebar)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Brand Header */}
        <div
          className="h-14 px-4 border-b flex items-center justify-between transition-colors shrink-0 safe-pt"
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

          <div className="flex items-center gap-1.5">
            {/* Multi-selection Toggle Button */}
            <button
              type="button"
              onClick={() => {
                setIsBulkMode((prev) => {
                  if (prev) setSelectedConvIds(new Set());
                  return !prev;
                });
              }}
              className="p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center"
              style={{
                backgroundColor: isBulkMode ? 'var(--accent)' : 'var(--surface)',
                borderColor: isBulkMode ? 'var(--accent)' : 'var(--border)',
                color: isBulkMode ? '#ffffff' : 'var(--muted)',
              }}
              title={isBulkMode ? "Quitter la sélection multiple" : "Sélection multiple & actions groupées"}
            >
              <CheckSquare className="w-4 h-4" />
            </button>

            {/* Import JSON button */}
            <input
              ref={importFileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportJSON}
            />
            <button
              type="button"
              onClick={() => importFileInputRef.current?.click()}
              className="p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center hover:opacity-100 opacity-80"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--muted)',
              }}
              title={t('import_session', 'Importer une session (JSON)')}
            >
              <Upload className="w-4 h-4" />
            </button>

            <a
              href="/"
              onClick={(e) => {
                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                  e.preventDefault();
                  onNewConversation();
                  onCloseMobile?.();
                }
              }}
              className="p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center no-underline"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)',
              }}
              title={t('new_session', 'Nouvelle session')}
            >
              <Plus className="w-4 h-4" />
            </a>

            {/* Mobile Close Drawer Button */}
            {onCloseMobile && (
              <button
                type="button"
                onClick={onCloseMobile}
                className="p-1.5 rounded-lg border md:hidden transition-all cursor-pointer flex items-center justify-center"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
                title="Fermer le menu"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
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

      {/* Conversation List Section Header with Prominent Bulk Action Button */}
      <div
        className="px-3 py-2 flex items-center justify-between shrink-0 border-b select-none transition-colors"
        style={{
          borderColor: 'var(--border)',
          backgroundColor: isBulkMode ? 'var(--accent-bg)' : 'transparent',
        }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <MessageSquare className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="text-[11px] font-semibold uppercase tracking-wider truncate" style={{ color: 'var(--muted)' }}>
            Discussions ({filtered.length})
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setIsBulkMode((prev) => {
              if (prev) setSelectedConvIds(new Set());
              return !prev;
            });
          }}
          className={`px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border shadow-xs ${
            isBulkMode
              ? 'ring-2 ring-sky-500/30'
              : 'hover:border-sky-500/50'
          }`}
          style={{
            backgroundColor: isBulkMode ? 'var(--accent)' : 'var(--surface)',
            borderColor: isBulkMode ? 'var(--accent)' : 'var(--border)',
            color: isBulkMode ? '#ffffff' : 'var(--strong)',
          }}
          title={isBulkMode ? "Quitter le mode sélection" : "Activer la sélection multiple & actions groupées"}
        >
          <CheckSquare className="w-3.5 h-3.5 shrink-0" />
          <span>{isBulkMode ? 'Fermer sélection' : 'Actions groupées'}</span>
          {selectedConvIds.size > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-white/25 text-white font-bold ml-0.5">
              {selectedConvIds.size}
            </span>
          )}
        </button>
      </div>

      {/* Bulk Action Toolbar */}
      {isBulkMode && (
        <div
          className="p-2.5 border-b flex flex-col gap-2 shrink-0 transition-all shadow-xs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          {/* Top row: Select All / Deselect, count, exit */}
          <div className="flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={handleToggleSelectAll}
              className="flex items-center gap-1.5 font-medium px-2 py-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-xs"
              style={{ color: 'var(--strong)' }}
            >
              {isAllSelected ? (
                <CheckSquare className="w-3.5 h-3.5 text-sky-500" />
              ) : (
                <Square className="w-3.5 h-3.5 text-slate-400" />
              )}
              <span>{isAllSelected ? 'Tout désélectionner' : 'Tout sélectionner'}</span>
            </button>

            <div className="flex items-center gap-2">
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-bold"
                style={{
                  backgroundColor: 'var(--accent-bg)',
                  color: 'var(--accent)',
                }}
              >
                {selectedConvIds.size} / {filtered.length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsBulkMode(false);
                  setSelectedConvIds(new Set());
                }}
                className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                title="Quitter la sélection"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Action buttons row */}
          <div className="flex items-center gap-1">
            {/* Pin */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={() => handleBulkPin(true)}
              className="flex-1 py-1.5 px-1 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
              title="Épingler la sélection"
            >
              <Pin className="w-3 h-3 text-amber-500" />
              <span className="hidden sm:inline">Épingler</span>
            </button>

            {/* Unpin */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={() => handleBulkPin(false)}
              className="py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
              title="Désépingler la sélection"
            >
              <PinOff className="w-3 h-3 text-slate-400" />
            </button>

            {/* Tags */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={() => {
                setBulkTagInput('');
                setShowBulkTagModal(true);
              }}
              className="flex-1 py-1.5 px-1 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
              title="Gérer les tags"
            >
              <Tag className="w-3 h-3 text-emerald-500" />
              <span className="hidden sm:inline">Tags</span>
            </button>

            {/* Project */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={() => {
                setBulkProjectInput('');
                setBulkProjectColor('#3B82F6');
                setShowBulkProjectModal(true);
              }}
              className="flex-1 py-1.5 px-1 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
              title="Assigner un projet"
            >
              <Folder className="w-3 h-3 text-indigo-500" />
              <span className="hidden sm:inline">Projet</span>
            </button>

            {/* Export */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={handleBulkExport}
              className="py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                borderColor: 'var(--border)',
                backgroundColor: 'var(--surface)',
                color: 'var(--text)',
              }}
              title="Exporter la sélection en JSON"
            >
              <Download className="w-3 h-3 text-sky-500" />
            </button>

            {/* Delete */}
            <button
              type="button"
              disabled={selectedConvIds.size === 0 || isBulkLoading}
              onClick={handleBulkDelete}
              className="py-1.5 px-2 rounded-lg border text-[11px] font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer hover:bg-red-500/10 text-red-500"
              style={{
                borderColor: 'rgba(239, 68, 68, 0.3)',
                backgroundColor: 'rgba(239, 68, 68, 0.05)',
              }}
              title="Supprimer la sélection"
            >
              {isBulkLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3 text-red-500" />}
            </button>
          </div>

          {/* Helper hint */}
          <div className="text-[10px] text-center pt-0.5" style={{ color: 'var(--muted)' }}>
            {selectedConvIds.size === 0 ? (
              <span className="italic">💡 Cochez les cases des conversations ci-dessous pour appliquer une action.</span>
            ) : (
              <span className="text-sky-500 font-medium">✓ {selectedConvIds.size} conversation(s) sélectionnée(s)</span>
            )}
          </div>
        </div>
      )}

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
                const isBulkSelected = selectedConvIds.has(conv.conversation_id);

                return (
                  <a
                    key={conv.conversation_id}
                    href={`/c/${conv.conversation_id}`}
                    className="group relative w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1.5 border cursor-pointer no-underline block"
                    style={{
                      backgroundColor: isBulkMode
                        ? isBulkSelected
                          ? 'var(--accent-bg)'
                          : 'transparent'
                        : isSelected
                        ? 'var(--surface)'
                        : 'transparent',
                      borderColor: isBulkMode
                        ? isBulkSelected
                          ? 'var(--accent)'
                          : 'transparent'
                        : isSelected
                        ? 'var(--accent)'
                        : 'transparent',
                      color: (isBulkMode ? isBulkSelected : isSelected) ? 'var(--strong)' : 'var(--text)',
                      boxShadow: (isSelected && !isBulkMode) || (isBulkMode && isBulkSelected) ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}
                    onClick={(e) => {
                      if (isBulkMode) {
                        e.preventDefault();
                        e.stopPropagation();
                        handleToggleCardSelection(conv.conversation_id);
                        return;
                      }
                      if (!e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
                        e.preventDefault();
                        onSelectConversation(conv.conversation_id);
                        onCloseMobile?.();
                      }
                    }}
                  >
                    {/* Header line: Checkbox/Project color, icon, title, pin & more */}
                    <div className="flex items-center justify-between gap-1 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isBulkMode ? (
                          <div
                            className="shrink-0 p-0.5 cursor-pointer flex items-center justify-center"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              handleToggleCardSelection(conv.conversation_id);
                            }}
                          >
                            {isBulkSelected ? (
                              <CheckSquare className="w-4 h-4 text-sky-500" />
                            ) : (
                              <Square className="w-4 h-4 text-slate-400 hover:text-sky-500" />
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 shrink-0">
                            {/* Hover Checkbox to instantly start bulk selection */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                setIsBulkMode(true);
                                setSelectedConvIds(new Set([conv.conversation_id]));
                              }}
                              className="w-4 h-4 rounded hidden group-hover:flex items-center justify-center text-slate-400 hover:text-sky-500 transition-colors cursor-pointer"
                              title="Sélectionner pour actions groupées"
                            >
                              <Square className="w-3.5 h-3.5" />
                            </button>

                            {/* Normal icon (hidden on hover) */}
                            {conv.is_running ? (
                              <span className="relative flex h-2.5 w-2.5 shrink-0 group-hover:hidden" title="Tâche en cours d'exécution en arrière-plan...">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                              </span>
                            ) : conv.projectColor ? (
                              <div
                                className="w-2.5 h-2.5 rounded-full shrink-0 group-hover:hidden"
                                style={{ backgroundColor: conv.projectColor }}
                                title={`Projet: ${conv.project || 'Sans nom'}`}
                              />
                            ) : isBranch ? (
                              <span title="Session issue d'une bifurcation (branche)" className="group-hover:hidden">
                                <GitBranch className="w-3 h-3 text-fuchsia-500 shrink-0" />
                              </span>
                            ) : (
                              <MessageSquare
                                className="w-3.5 h-3.5 shrink-0 group-hover:hidden"
                                style={{ color: isSelected ? 'var(--accent)' : 'var(--muted)' }}
                              />
                            )}
                          </div>
                        )}

                        <span className="truncate font-medium text-xs" style={{ color: (isBulkMode ? isBulkSelected : isSelected) ? 'var(--strong)' : 'var(--text)' }}>
                          {conv.title || `Session ${conv.conversation_id.substring(0, 8)}`}
                        </span>
                      </div>

                      {/* Right hover actions (only when not in bulk mode) */}
                      {!isBulkMode && (
                        <div className="flex items-center gap-1 shrink-0">
                          {onTogglePin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
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
                                e.preventDefault();
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
                      )}
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
                  </a>
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
            onClick={updateAvailable && onOpenUpdates ? onOpenUpdates : onOpenSettings}
            className="p-1.5 rounded-lg transition-colors flex items-center gap-1.5 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 relative"
            style={{ color: 'var(--muted)' }}
            title={updateAvailable ? 'Mise à jour disponible ! Cliquez pour voir.' : t('settings', 'Paramètres Antigravity')}
          >
            <SettingsIcon className="w-4 h-4" />
            <span className="text-[11px] font-medium" style={{ color: 'var(--text)' }}>
              {t('settings', 'Paramètres')}
            </span>
            {updateAvailable && (
              <span
                className="ml-0.5 px-1.5 py-0.5 text-[9px] font-bold rounded-full bg-amber-500 text-black leading-none animate-pulse shrink-0"
                title="Mise à jour disponible"
              >
                MàJ
              </span>
            )}
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

      {/* Bulk Tagging Modal */}
      {showBulkTagModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-md rounded-2xl p-5 shadow-2xl border space-y-4 animate-scaleUp"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
                  <Tag className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--strong)' }}>
                    Tags groupés
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    Appliquer aux {selectedConvIds.size} sessions sélectionnées
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBulkTagModal(false)}
                className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text)' }}>
                  Tags (séparés par des virgules) :
                </label>
                <input
                  type="text"
                  placeholder="ex: frontend, release-v2, bugfix"
                  value={bulkTagInput}
                  onChange={(e) => setBulkTagInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--input-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                  autoFocus
                />
              </div>

              {/* Suggestions from existing tags */}
              {allTags.length > 0 && (
                <div>
                  <label className="text-[11px] block mb-1 font-medium" style={{ color: 'var(--muted)' }}>
                    Suggestions existantes :
                  </label>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                    {allTags.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          const current = bulkTagInput.split(',').map((s) => s.trim()).filter(Boolean);
                          if (!current.includes(t)) {
                            setBulkTagInput(current.concat(t).join(', '));
                          }
                        }}
                        className="px-2 py-0.5 rounded-full text-[10px] font-mono border hover:border-emerald-500/50 transition-colors cursor-pointer"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                          color: 'var(--text)',
                        }}
                      >
                        #{t}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mode choice */}
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium block" style={{ color: 'var(--text)' }}>
                  Mode d'application :
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setBulkTagMode('add')}
                    className="p-2 rounded-xl border text-left transition-all cursor-pointer"
                    style={{
                      borderColor: bulkTagMode === 'add' ? 'var(--accent)' : 'var(--border)',
                      backgroundColor: bulkTagMode === 'add' ? 'var(--accent-bg)' : 'transparent',
                      color: bulkTagMode === 'add' ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    <div className="font-semibold text-xs">Ajouter</div>
                    <div className="text-[10px] opacity-80">Conserve les tags actuels</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkTagMode('replace')}
                    className="p-2 rounded-xl border text-left transition-all cursor-pointer"
                    style={{
                      borderColor: bulkTagMode === 'replace' ? 'var(--accent)' : 'var(--border)',
                      backgroundColor: bulkTagMode === 'replace' ? 'var(--accent-bg)' : 'transparent',
                      color: bulkTagMode === 'replace' ? 'var(--accent)' : 'var(--text)',
                    }}
                  >
                    <div className="font-semibold text-xs">Remplacer</div>
                    <div className="text-[10px] opacity-80">Remplace tous les tags</div>
                  </button>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setShowBulkTagModal(false)}
                className="px-3.5 py-1.5 rounded-xl text-xs font-medium border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={isBulkLoading}
                onClick={handleApplyBulkTags}
                className="px-4 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff',
                }}
              >
                {isBulkLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                <span>Appliquer</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Project Assignment Modal */}
      {showBulkProjectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
          <div
            className="w-full max-w-md rounded-2xl p-5 shadow-2xl border space-y-4 animate-scaleUp"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                  <Folder className="w-4 h-4 text-indigo-500" />
                </div>
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--strong)' }}>
                    Assigner un projet
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    Appliquer aux {selectedConvIds.size} sessions sélectionnées
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowBulkProjectModal(false)}
                className="p-1 rounded-md hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium block mb-1" style={{ color: 'var(--text)' }}>
                  Nom du projet :
                </label>
                <input
                  type="text"
                  placeholder="ex: LeadForge, E-Commerce, Refactor"
                  value={bulkProjectInput}
                  onChange={(e) => setBulkProjectInput(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--input-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)',
                  }}
                  autoFocus
                />
              </div>

              {/* Color presets */}
              <div>
                <label className="text-xs font-medium block mb-1.5" style={{ color: 'var(--text)' }}>
                  Couleur du projet :
                </label>
                <div className="flex items-center gap-2">
                  {['#3B82F6', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#EC4899', '#06B6D4', '#64748B'].map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setBulkProjectColor(color)}
                      className={`w-6 h-6 rounded-full transition-transform cursor-pointer flex items-center justify-center shadow-xs ${
                        bulkProjectColor === color ? 'scale-125 ring-2 ring-offset-2 ring-sky-500' : 'hover:scale-110'
                      }`}
                      style={{ backgroundColor: color }}
                    >
                      {bulkProjectColor === color && <Check className="w-3 h-3 text-white" />}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => handleApplyBulkProject(true)}
                disabled={isBulkLoading}
                className="px-3 py-1.5 rounded-xl text-xs font-medium border border-rose-500/20 text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                title="Retirer l'assignation de projet de toutes les sessions sélectionnées"
              >
                Dissocier le projet
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowBulkProjectModal(false)}
                  className="px-3.5 py-1.5 rounded-xl text-xs font-medium border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                >
                  Annuler
                </button>
                <button
                  type="button"
                  disabled={isBulkLoading || !bulkProjectInput.trim()}
                  onClick={() => handleApplyBulkProject(false)}
                  className="px-4 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#ffffff',
                  }}
                >
                  {isBulkLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span>Appliquer</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </aside>
    </>
  );
}, (prev, next) => {
  return prev.conversations === next.conversations && prev.activeConversationId === next.activeConversationId;
});
