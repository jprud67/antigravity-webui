import React, { useState, useEffect, useCallback } from 'react';
import { 
  Brain, 
  User, 
  FolderGit2, 
  Plus, 
  Trash2, 
  Edit3, 
  Check, 
  RefreshCw, 
  Sparkles, 
  Copy, 
  Info,
  Save,
  CheckCircle2
} from 'lucide-react';
import { 
  fetchMemoryStatus, 
  refreshMemorySnapshot, 
  executeMemoryOperation 
} from '../services/api';
import type { ContinuousMemoryStatus } from '../types';
import { showToast } from '../services/toast';
import { copyText } from '../utils/codeBlockUtils';
import { useI18n } from '../services/i18n';

interface ContinuousMemoryStudioProps {
  onSnapshotUpdated?: () => void;
}

export const ContinuousMemoryStudio: React.FC<ContinuousMemoryStudioProps> = ({ onSnapshotUpdated }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<ContinuousMemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTarget, setActiveTarget] = useState<'user' | 'memory'>('user');
  const [viewMode, setViewMode] = useState<'cards' | 'raw'>('cards');
  
  // Adding new entry
  const [newContent, setNewContent] = useState('');
  const [adding, setAdding] = useState(false);

  // Editing existing entry
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Raw markdown editor
  const [rawText, setRawText] = useState('');
  const [savingRaw, setSavingRaw] = useState(false);

  // Snapshot refresh
  const [refreshingSnapshot, setRefreshingSnapshot] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchMemoryStatus();
      setStatus(data);
      if (activeTarget === 'user') {
        setRawText(data.user.raw);
      } else {
        setRawText(data.memory.raw);
      }
    } catch (e: any) {
      showToast(e.message || t('memory_load_failed', 'Erreur lors du chargement de la mémoire'), 'error');
    } finally {
      setLoading(false);
    }
  }, [activeTarget, t]);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    loadStatus();
  }, [loadStatus]);

  const currentTargetData = status ? (activeTarget === 'user' ? status.user : status.memory) : null;

  const handleSwitchTarget = (target: 'user' | 'memory') => {
    setActiveTarget(target);
    setEditingIndex(null);
    setNewContent('');
    if (status) {
      setRawText(target === 'user' ? status.user.raw : status.memory.raw);
    }
  };

  const handleAddEntry = async () => {
    if (!newContent.trim()) return;
    try {
      setAdding(true);
      const res = await executeMemoryOperation({
        target: activeTarget,
        action: 'add',
        content: newContent.trim(),
      });
      showToast(res.message || t('memory_entry_added', 'Entrée ajoutée avec succès !'), 'success');
      setNewContent('');
      await loadStatus();
    } catch (e: any) {
      showToast(e.message || t('memory_add_failed', "Erreur lors de l'ajout"), 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleStartEdit = (index: number, content: string) => {
    setEditingIndex(index);
    setEditContent(content);
  };

  const handleSaveEdit = async (oldText: string) => {
    if (!editContent.trim()) return;
    try {
      setSavingEdit(true);
      const res = await executeMemoryOperation({
        target: activeTarget,
        action: 'replace',
        old_text: oldText,
        new_content: editContent.trim(),
      });
      showToast(res.message || t('memory_entry_updated', 'Entrée mise à jour'), 'success');
      setEditingIndex(null);
      await loadStatus();
    } catch (e: any) {
      showToast(e.message || t('memory_edit_failed', 'Erreur modification'), 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteEntry = async (text: string) => {
    try {
      const res = await executeMemoryOperation({
        target: activeTarget,
        action: 'remove',
        old_text: text,
      });
      showToast(res.message || t('memory_entry_deleted', 'Entrée supprimée'), 'info');
      await loadStatus();
    } catch (e: any) {
      showToast(e.message || t('memory_delete_failed', 'Erreur suppression'), 'error');
    }
  };

  const handleSaveRaw = async () => {
    try {
      setSavingRaw(true);
      const res = await executeMemoryOperation({
        target: activeTarget,
        action: 'save_raw',
        raw_markdown: rawText,
      });
      showToast(res.message || t('memory_raw_saved', 'Fichier brut enregistré'), 'success');
      await loadStatus();
    } catch (e: any) {
      showToast(e.message || t('memory_raw_save_failed', "Erreur d'enregistrement brut"), 'error');
    } finally {
      setSavingRaw(false);
    }
  };

  const handleRefreshSnapshot = async () => {
    try {
      setRefreshingSnapshot(true);
      const res = await refreshMemorySnapshot();
      showToast(res.message || t('memory_snapshot_updated', 'Snapshot gelé mis à jour dans le prompt système'), 'success');
      if (onSnapshotUpdated) onSnapshotUpdated();
    } catch (e: any) {
      showToast(e.message || t('memory_snapshot_update_failed', 'Erreur mise à jour snapshot'), 'error');
    } finally {
      setRefreshingSnapshot(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-400 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-cyan-500" />
        <p className="text-sm font-medium">{t('memory_loading', 'Chargement de la mémoire persistante...')}</p>
      </div>
    );
  }

  const usagePercent = currentTargetData ? currentTargetData.percentage : 0;
  const isNearLimit = usagePercent > 85;

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-gradient-to-r from-cyan-500/10 via-sky-500/5 to-transparent border border-cyan-500/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center text-cyan-400 shrink-0">
            <Brain className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              {t('continuous_memory_title', 'Mémoire Continue Curatée')}
              <span className="text-[10px] font-mono font-bold bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 px-1.5 py-0.5 rounded">
                Persistent Memory
              </span>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t('continuous_memory_desc', 'Connaissances persistantes injectées en snapshot immuable sans rompre le cache de prompt.')}
            </p>
          </div>
        </div>

        <button
          onClick={handleRefreshSnapshot}
          disabled={refreshingSnapshot}
          className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50"
          title="Met à jour le snapshot gelé utilisé pour les prochaines requêtes au modèle"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshingSnapshot ? 'animate-spin' : ''}`} />
          <span>{refreshingSnapshot ? t('memory_refreshing', 'Actualisation...') : t('memory_refresh_snapshot', 'Rafraîchir Snapshot')}</span>
        </button>
      </div>

      {/* Target Selector Tabs */}
      <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleSwitchTarget('user')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTarget === 'user'
                ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <User className="w-3.5 h-3.5" />
            <span>{t('memory_target_user', 'Profil Développeur (USER.md)')}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 font-mono">
              {status?.user.entry_count || 0}
            </span>
          </button>

          <button
            onClick={() => handleSwitchTarget('memory')}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeTarget === 'memory'
                ? 'bg-cyan-500/15 text-cyan-600 dark:text-cyan-400 border border-cyan-500/30 font-bold'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800/60'
            }`}
          >
            <FolderGit2 className="w-3.5 h-3.5" />
            <span>{t('memory_target_workspace', 'Mémoire Workspace (MEMORY.md)')}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-200 dark:bg-slate-800 font-mono">
              {status?.memory.entry_count || 0}
            </span>
          </button>
        </div>

        {/* View mode toggle */}
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
          <button
            onClick={() => setViewMode('cards')}
            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-all ${
              viewMode === 'cards'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t('memory_view_cards', 'Cartes Curatées')} ({currentTargetData?.entry_count || 0})
          </button>
          <button
            onClick={() => setViewMode('raw')}
            className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer transition-all ${
              viewMode === 'raw'
                ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {t('memory_view_raw', 'Markdown Brut')}
          </button>
        </div>
      </div>

      {/* Target Info & Gauge */}
      {currentTargetData && (
        <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-2">
            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="font-semibold text-slate-800 dark:text-slate-100">Fichier :</span>
              <code className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 text-[11px] font-mono text-cyan-600 dark:text-cyan-400 truncate max-w-sm">
                {currentTargetData.path}
              </code>
              {currentTargetData.exists ? (
                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                  <CheckCircle2 className="w-3 h-3" /> Synchronisé
                </span>
              ) : (
                <span className="text-[10px] text-slate-400 bg-slate-500/10 px-1.5 py-0.5 rounded">
                  Non créé
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-slate-600 dark:text-slate-400 font-mono text-xs">
              <span>Budget :</span>
              <span className={`font-bold ${isNearLimit ? 'text-rose-500' : 'text-cyan-600 dark:text-cyan-400'}`}>
                {currentTargetData.char_count.toLocaleString()} / {currentTargetData.char_limit.toLocaleString()} chars
              </span>
              <span>({usagePercent}%)</span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
            <div 
              className={`h-full transition-all duration-300 rounded-full ${
                isNearLimit 
                  ? 'bg-rose-500' 
                  : usagePercent > 60 
                    ? 'bg-amber-500' 
                    : 'bg-cyan-500'
              }`}
              style={{ width: `${Math.min(100, usagePercent)}%` }}
            />
          </div>
        </div>
      )}

      {/* Cards View Mode */}
      {viewMode === 'cards' && (
        <div className="space-y-4">
          {/* Add New Entry Form */}
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 flex gap-2">
            <input
              type="text"
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleAddEntry();
                }
              }}
              placeholder={
                activeTarget === 'user'
                  ? t('memory_placeholder_user', 'Ex: Préfère les fonctions pures, TypeScript strict et les composants modulaires...')
                  : t('memory_placeholder_workspace', 'Ex: Le projet utilise une base SQLite FTS5 et un proxy WebSocket local...')
              }
              className="flex-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-1 focus:ring-cyan-500"
            />
            <button
              onClick={handleAddEntry}
              disabled={adding || !newContent.trim()}
              className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>{adding ? t('adding', 'Ajout...') : t('memory_add_btn', 'Ajouter')}</span>
            </button>
          </div>

          {/* Entry Cards List */}
          {currentTargetData && currentTargetData.entries.length > 0 ? (
            <div className="space-y-2.5">
              {currentTargetData.entries.map((entry, idx) => {
                const isEditing = editingIndex === idx;
                return (
                  <div
                    key={idx}
                    className="group p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/40 transition-all shadow-xs"
                  >
                    {isEditing ? (
                      <div className="space-y-2">
                        <textarea
                          value={editContent}
                          onChange={(e) => setEditContent(e.target.value)}
                          className="w-full p-2.5 text-xs font-mono bg-slate-50 dark:bg-slate-800/80 border border-cyan-500/50 rounded-lg text-slate-900 dark:text-slate-100 focus:outline-hidden"
                          rows={3}
                        />
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="px-2.5 py-1 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
                          >
                            {t('cancel', 'Annuler')}
                          </button>
                          <button
                            onClick={() => handleSaveEdit(entry)}
                            disabled={savingEdit}
                            className="px-3 py-1 bg-cyan-600 hover:bg-cyan-500 text-white rounded-md text-xs font-medium flex items-center gap-1"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{savingEdit ? t('saving', 'Sauvegarde...') : t('save', 'Enregistrer')}</span>
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5 flex-1 min-w-0">
                          <span className="text-cyan-500/70 font-mono text-xs font-bold shrink-0 mt-0.5">
                            #{idx + 1}
                          </span>
                          <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed break-words whitespace-pre-wrap">
                            {entry}
                          </p>
                        </div>

                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100 transition-opacity shrink-0">
                          <button
                            onClick={() => copyText(entry)}
                            className="p-1.5 text-slate-400 hover:text-cyan-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title={t('copy', 'Copier le texte')}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleStartEdit(idx, entry)}
                            className="p-1.5 text-slate-400 hover:text-amber-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title={t('edit', 'Modifier cette entrée')}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDeleteEntry(entry)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                            title={t('delete', 'Supprimer cette entrée')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-xl space-y-2">
              <Sparkles className="w-8 h-8 text-cyan-500/40 mx-auto" />
              <p className="text-xs font-medium">{t('memory_no_entries', 'Aucun souvenir enregistré dans cette catégorie.')}</p>
              <p className="text-[11px] text-slate-500">
                {t('memory_no_entries_hint', "Utilisez le formulaire ci-dessus ou laissez l'agent mémoriser automatiquement via l'outil memory.")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Raw Markdown Mode */}
      {viewMode === 'raw' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1">
              <Info className="w-3.5 h-3.5 text-cyan-500" />
              {t('memory_raw_info', 'Édition directe du fichier markdown. Les entrées sont séparées par § ou puces markdown.')}
            </span>
            <button
              onClick={handleSaveRaw}
              disabled={savingRaw}
              className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{savingRaw ? t('saving', 'Enregistrement...') : t('memory_save_raw', 'Enregistrer le fichier')}</span>
            </button>
          </div>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            className="w-full h-80 p-3.5 font-mono text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-cyan-500 leading-relaxed"
            placeholder="# Titre..."
          />
        </div>
      )}
    </div>
  );
};
