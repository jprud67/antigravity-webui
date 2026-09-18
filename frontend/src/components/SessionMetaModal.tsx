import React, { useState } from 'react';
import { X, Tag, Folder, Palette, Pin, Check, Trash2, Archive, Download, FileText } from 'lucide-react';
import type { Conversation } from '../types';
import { updateConversationMetadata, deleteConversation, exportConversationMarkdown, exportConversationJSON, triggerFileDownload } from '../services/api';
import { showConfirm } from '../services/dialog';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface SessionMetaModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  onUpdated: () => void;
  onDeleted?: (conversationId: string) => void;
}

const PALETTE = [
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#6366f1', // Indigo
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

export const SessionMetaModal: React.FC<SessionMetaModalProps> = ({
  isOpen,
  onClose,
  conversation,
  onUpdated,
  onDeleted
}) => {
  const { t } = useI18n();
  const [prevConvId, setPrevConvId] = useState<string | null>(null);
  const [prevIsOpen, setPrevIsOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [projectColor, setProjectColor] = useState(PALETTE[0]);
  const [tagsStr, setTagsStr] = useState('');
  const [pinned, setPinned] = useState(false);
  const [archived, setArchived] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isOpen && (!prevIsOpen || (conversation && conversation.conversation_id !== prevConvId))) {
    setPrevIsOpen(true);
    setPrevConvId(conversation ? conversation.conversation_id : null);
    if (conversation) {
      setTitle(conversation.customTitle || conversation.title || '');
      setProject(conversation.project || '');
      setProjectColor(conversation.projectColor || PALETTE[0]);
      setTagsStr((conversation.tags || []).join(', '));
      setPinned(!!conversation.pinned);
      setArchived(!!conversation.archived);
      setError(null);
    }
  } else if (!isOpen && prevIsOpen) {
    setPrevIsOpen(false);
  }

  if (!isOpen || !conversation) return null;

  const handleExport = async (format: 'markdown' | 'json') => {
    try {
      setExporting(true);
      if (format === 'markdown') {
        const blob = await exportConversationMarkdown(conversation.conversation_id);
        triggerFileDownload(blob, `session_${conversation.conversation_id.slice(0, 8)}.md`);
      } else {
        const blob = await exportConversationJSON(conversation.conversation_id);
        triggerFileDownload(blob, `session_${conversation.conversation_id.slice(0, 8)}.json`);
      }
      showToast(t('export_downloaded', `Export ${format.toUpperCase()} downloaded`, format.toUpperCase()), 'success');
    } catch (e: any) {
      showToast(`${t('export_error', 'Export error')}: ${e.message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedTags = tagsStr
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      await updateConversationMetadata(conversation.conversation_id, {
        customTitle: title.trim(),
        project: project.trim(),
        projectColor,
        tags: parsedTags,
        pinned,
        archived
      });
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || t('error_saving_file', 'Error saving'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!(await showConfirm(t('delete_session_confirm', 'Are you sure you want to permanently delete this conversation and its history?'), { destructive: true }))) {
      return;
    }
    setLoading(true);
    try {
      await deleteConversation(conversation.conversation_id);
      if (onDeleted) onDeleted(conversation.conversation_id);
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || t('delete_failed', 'Delete error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div
        className="border rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="p-4 border-b flex items-center justify-between"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold" style={{ color: 'var(--strong)' }}>{t('session_meta_title', 'Session Management & Metadata')}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="font-medium" style={{ color: 'var(--muted)' }}>{t('session_title_label', 'Session Title')}</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('session_title_placeholder', 'e.g. Backend API refactor, Auth bug...')}
              className="w-full px-3 py-2 rounded-xl font-medium text-xs border focus:outline-none"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
            />
          </div>

          {/* Project & Color */}
          <div className="space-y-1.5">
            <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span>{t('session_project_label', 'Project / Category')}</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder={t('session_project_placeholder', 'e.g. Antigravity, LeadForge, Infra...')}
                className="flex-1 px-3 py-2 rounded-xl text-xs border focus:outline-none"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              />
            </div>
          </div>

          {/* Color Picker Palette */}
          <div className="space-y-1.5">
            <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('session_color_label', 'Project color badge')}</span>
            </label>
            <div className="flex items-center gap-2 pt-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setProjectColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full border transition-all cursor-pointer flex items-center justify-center ${
                    projectColor === c ? 'border-white scale-110 shadow-md shadow-black' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  {projectColor === c && <Check className="w-3 h-3 text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="font-medium flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t('session_tags_label', 'Tags (comma-separated)')}</span>
            </label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder={t('session_tags_placeholder', 'e.g. backend, security, refactor, bug')}
              className="w-full px-3 py-2 rounded-xl font-mono text-xs border focus:outline-none"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
            />
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{t('session_tags_hint', 'These tags allow you to filter your sessions with one click in the sidebar.')}</p>
          </div>

          {/* Pin toggle */}
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className="w-full p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors cursor-pointer"
              style={{
                backgroundColor: pinned ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: pinned ? 'var(--accent)' : 'var(--border)',
                color: pinned ? 'var(--accent-text)' : 'var(--text)'
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <Pin className={`w-4 h-4 ${pinned ? 'fill-current text-amber-500' : ''}`} style={{ color: pinned ? undefined : 'var(--muted)' }} />
                <span>{t('pin_session_top', 'Pin this session to top of list')}</span>
              </div>
              <span className="text-[10px] uppercase font-mono">{pinned ? t('active', 'Active') : t('inactive', 'Inactive')}</span>
            </button>

            {/* Archive toggle */}
            <button
              type="button"
              onClick={() => setArchived(!archived)}
              className="w-full p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors cursor-pointer"
              style={{
                backgroundColor: archived ? 'rgba(100, 116, 139, 0.15)' : 'var(--surface-subtle)',
                borderColor: archived ? '#64748B' : 'var(--border)',
                color: archived ? 'var(--strong)' : 'var(--text)'
              }}
            >
              <div className="flex items-center gap-2 font-medium">
                <Archive className="w-4 h-4 text-slate-400" />
                <span>{t('archive_session', 'Archive session')}</span>
              </div>
              <span className="text-[10px] uppercase font-mono">{archived ? t('kanban_status_archived', 'Archived') : t('not_archived', 'Not archived')}</span>
            </button>
          </div>

          {/* Export options */}
          <div className="pt-2 border-t mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
            <label className="text-[11px] font-semibold flex items-center gap-1.5 mb-2" style={{ color: 'var(--muted)' }}>
              <Download className="w-3.5 h-3.5 text-sky-400" />
              <span>{t('export_discussion', 'Export this discussion')}</span>
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExport('markdown')}
                className="flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              >
                <FileText className="w-3.5 h-3.5 text-emerald-400" />
                <span>Markdown (.md)</span>
              </button>
              <button
                type="button"
                disabled={exporting}
                onClick={() => handleExport('json')}
                className="flex-1 py-1.5 px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('export_full_json', 'Full JSON')}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div
          className="p-4 border-t flex items-center justify-between"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-1.5 px-3 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t('delete_session', 'Delete session')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="py-1.5 px-3 rounded-lg text-xs cursor-pointer"
              style={{ color: 'var(--muted)' }}
            >
              {t('cancel', 'Cancel')}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-sky-500/20 cursor-pointer"
            >
              {loading ? t('saving', 'Saving...') : t('save', 'Save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
