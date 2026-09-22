import React from 'react';
import { 
  FolderTree, 
  GitBranch, 
  FileText, 
  Terminal as TerminalIcon, 
  Kanban as KanbanIcon,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import type { RightPanelTab } from './WorkspacePanel';

export interface AuxiliaryBarProps {
  isOpen: boolean;
  activeTab: RightPanelTab;
  onToggleTab: (tab: RightPanelTab) => void;
  onToggleOpen: () => void;
  changedFilesCount?: number;
  artifactsCount?: number;
  isStreaming?: boolean;
}

interface TabDef {
  id: RightPanelTab;
  labelKey: string;
  defaultLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeColor?: string;
  streamingPulse?: boolean;
}

export const AuxiliaryBar: React.FC<AuxiliaryBarProps> = React.memo(({
  isOpen,
  activeTab,
  onToggleTab,
  onToggleOpen,
  changedFilesCount = 0,
  artifactsCount = 0,
  isStreaming = false,
}) => {
  const { t } = useI18n();

  const tabs: TabDef[] = [
    {
      id: 'files',
      labelKey: 'aux_bar_files',
      defaultLabel: 'Explorateur & Fichiers',
      icon: FolderTree,
    },
    {
      id: 'git',
      labelKey: 'aux_bar_changes',
      defaultLabel: 'Modifications & Diffs',
      icon: GitBranch,
      badge: changedFilesCount > 0 ? changedFilesCount : undefined,
      badgeColor: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    },
    {
      id: 'artifacts',
      labelKey: 'aux_bar_artifacts',
      defaultLabel: 'Artéfacts en direct',
      icon: FileText,
      badge: artifactsCount > 0 ? artifactsCount : undefined,
      badgeColor: 'bg-sky-500/20 text-sky-400 border-sky-500/30',
    },
    {
      id: 'terminal',
      labelKey: 'aux_bar_terminal',
      defaultLabel: 'Terminal intégré',
      icon: TerminalIcon,
      streamingPulse: isStreaming,
    },
    {
      id: 'kanban',
      labelKey: 'aux_bar_kanban',
      defaultLabel: 'Kanban des tâches',
      icon: KanbanIcon,
    },
  ];

  return (
    <aside
      className="hidden md:flex flex-col items-center justify-between w-12 shrink-0 border-l select-none py-2.5 z-20 transition-colors"
      style={{
        backgroundColor: 'var(--surface-subtle, var(--surface))',
        borderColor: 'var(--border)',
      }}
      aria-label="Auxiliary Activity Bar"
    >
      {/* Top Main Navigation Icons */}
      <div className="flex flex-col items-center gap-1.5 w-full">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = isOpen && activeTab === tab.id;
          const label = t(tab.labelKey, tab.defaultLabel);

          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onToggleTab(tab.id)}
              className={`relative group w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer ${
                isActive
                  ? 'bg-sky-500/15 text-sky-400 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/5'
              }`}
              style={{
                color: isActive ? 'var(--accent, #38bdf8)' : undefined,
                backgroundColor: isActive ? 'var(--accent-bg, rgba(56, 189, 248, 0.12))' : undefined,
              }}
              title={label}
              aria-label={label}
              aria-pressed={isActive}
            >
              {/* Active Indicator Bar on right edge */}
              {isActive && (
                <div
                  className="absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l-full bg-sky-400"
                  style={{ backgroundColor: 'var(--accent, #38bdf8)' }}
                />
              )}

              <Icon className="w-4 h-4 transition-transform group-hover:scale-105" />

              {/* Streaming Activity Dot */}
              {tab.streamingPulse && !isActive && (
                <span className="absolute top-1 right-1 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-sky-500"></span>
                </span>
              )}

              {/* Counter Badge */}
              {tab.badge !== undefined && (
                <span
                  className={`absolute -top-1 -right-1 px-1.5 min-w-[16px] h-4 rounded-full text-[9px] font-mono font-bold flex items-center justify-center border shadow-xs ${
                    tab.badgeColor || 'bg-slate-700 text-slate-200 border-slate-600'
                  }`}
                >
                  {tab.badge > 99 ? '99+' : tab.badge}
                </span>
              )}

              {/* Hover Tooltip (Left Pop) */}
              <div className="absolute right-full mr-2.5 px-2.5 py-1 rounded-lg bg-slate-900/95 border border-slate-700/80 text-white text-[11px] font-medium whitespace-nowrap shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 backdrop-blur-md">
                <span>{label}</span>
                {tab.badge !== undefined && (
                  <span className="ml-1.5 opacity-70 font-mono">({tab.badge})</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Bottom Controls: Toggle Panel Collapse & Short Guide */}
      <div className="flex flex-col items-center gap-1.5 w-full pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
        <button
          type="button"
          onClick={onToggleOpen}
          className="group relative w-9 h-9 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-100 hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
          title={t('aux_bar_toggle_collapse', 'Basculer le volet auxiliaire (Ctrl+B)')}
          aria-label={t('aux_bar_toggle_collapse', 'Basculer le volet auxiliaire (Ctrl+B)')}
        >
          {isOpen ? (
            <PanelRightClose className="w-4 h-4 transition-transform group-hover:scale-105" />
          ) : (
            <PanelRightOpen className="w-4 h-4 transition-transform group-hover:scale-105" />
          )}

          {/* Hover Tooltip */}
          <div className="absolute right-full mr-2.5 px-2.5 py-1 rounded-lg bg-slate-900/95 border border-slate-700/80 text-white text-[11px] font-medium whitespace-nowrap shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 backdrop-blur-md">
            <span>{isOpen ? t('close_side_panel', 'Fermer le volet') : t('open_side_panel', 'Ouvrir le volet')}</span>
            <kbd className="ml-2 px-1 py-0.5 rounded bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300">Ctrl+B</kbd>
          </div>
        </button>
      </div>
    </aside>
  );
});
