import React, { useState, useEffect } from 'react';
import {
  X,
  GitBranch,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Edit2,
  Trash2,
  Layers,
  Check,
  AlertTriangle,
  Play,
  RotateCcw
} from 'lucide-react';
import { fetchRebaseTodo, executeGitRebase } from '../services/api';
import type { RebaseCommitItem } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface GitRebaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  workspace: string;
  initialBaseRef?: string;
  onRebaseCompleted: () => void;
  onRebaseConflict?: () => void;
}

export const GitRebaseModal: React.FC<GitRebaseModalProps> = ({
  isOpen,
  onClose,
  workspace,
  initialBaseRef = 'HEAD~5',
  onRebaseCompleted,
  onRebaseConflict
}) => {
  const { t } = useI18n();
  const [baseRef, setBaseRef] = useState(initialBaseRef);
  const [commits, setCommits] = useState<RebaseCommitItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch commits for base
  useEffect(() => {
    if (!isOpen || !baseRef.trim()) return;
    let cancelled = false;

    fetchRebaseTodo(baseRef.trim(), workspace)
      .then((res) => {
        if (!cancelled) {
          setCommits(res.commits);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!cancelled) {
          setError(err.message || 'Impossible de charger la liste des commits.');
          setCommits([]);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, baseRef, workspace]);

  const handleManualReload = () => {
    if (!baseRef.trim()) return;
    setLoading(true);
    setError(null);
    fetchRebaseTodo(baseRef.trim(), workspace)
      .then((res) => {
        setCommits(res.commits);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err.message || 'Impossible de charger la liste des commits.');
        setCommits([]);
        setLoading(false);
      });
  };

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && !executing) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, executing, onClose]);

  const moveCommit = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= commits.length) return;
    const updated = [...commits];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);
    setCommits(updated);
  };

  const updateAction = (index: number, action: 'pick' | 'reword' | 'squash' | 'drop') => {
    const updated = [...commits];
    const item = { ...updated[index], action };
    if ((action === 'reword' || action === 'squash') && !item.new_message) {
      item.new_message = item.subject;
    }
    updated[index] = item;
    setCommits(updated);
  };

  const updateMessage = (index: number, message: string) => {
    const updated = [...commits];
    updated[index] = { ...updated[index], new_message: message };
    setCommits(updated);
  };

  const handleExecute = async () => {
    if (commits.length === 0) return;
    setExecuting(true);
    setError(null);
    try {
      const payload = {
        workspace,
        base: baseRef.trim(),
        commits: commits.map((c) => ({
          sha: c.sha,
          action: c.action,
          new_message: (c.action === 'reword' || c.action === 'squash') ? c.new_message || c.subject : null
        }))
      };

      const res = await executeGitRebase(payload);
      if (res.status === 'completed') {
        showToast(t('git_rebase_interactive_success', 'Rebase interactif terminé avec succès !'), 'success');
        onClose();
        onRebaseCompleted();
      } else if (res.status === 'conflict') {
        showToast(t('git_rebase_conflicts_detected', 'Conflits détectés pendant le rebase. Résolvez-les pour continuer.'), 'error');
        onClose();
        if (onRebaseConflict) {
          onRebaseConflict();
        } else {
          onRebaseCompleted();
        }
      } else {
        showToast(res.message || t('git_rebase_stopped', 'Rebase arrêté.'), 'info');
        onClose();
        onRebaseCompleted();
      }
    } catch (err: any) {
      setError(err.message || 'Échec du rebase.');
      showToast(err.message || 'Échec du rebase interactif.', 'error');
    } finally {
      setExecuting(false);
    }
  };

  if (!isOpen) return null;

  const pickCount = commits.filter((c) => c.action === 'pick').length;
  const rewordCount = commits.filter((c) => c.action === 'reword').length;
  const squashCount = commits.filter((c) => c.action === 'squash').length;
  const dropCount = commits.filter((c) => c.action === 'drop').length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
      >
        {/* Modal Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
              <GitBranch className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold" style={{ color: 'var(--strong)' }}>
                {t('rebase_studio_title', 'Studio de Rebase Interactif')}
              </h3>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('rebase_studio_subtitle', 'Réordonnez, reformulez, fusionnez ou supprimez vos commits non poussés')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={executing}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Base Ref Selector & Presets Toolbar */}
        <div
          className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2 flex-1 min-w-[280px]">
            <span className="font-medium shrink-0" style={{ color: 'var(--muted)' }}>
              {t('rebase_start_base', 'Base de départ :')}
            </span>
            <input
              type="text"
              value={baseRef}
              onChange={(e) => setBaseRef(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleManualReload();
              }}
              placeholder={t('git_rebase_base_placeholder', 'ex: HEAD~5, main, origin/main, or sha...')}
              className="flex-1 px-3 py-1.5 rounded-lg border font-mono text-xs outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500/30"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
            />
            <button
              type="button"
              onClick={handleManualReload}
              disabled={loading || executing}
              className="px-3 py-1.5 rounded-lg border flex items-center gap-1 font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)'
              }}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
              <span>{t('load', 'Charger')}</span>
            </button>
          </div>

          {/* Quick Presets */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px]" style={{ color: 'var(--muted)' }}>{t('presets', 'Presets :')}</span>
            {['HEAD~3', 'HEAD~5', 'HEAD~10'].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBaseRef(preset)}
                disabled={loading || executing}
                className={`px-2 py-1 rounded text-[11px] font-mono border transition-colors cursor-pointer ${
                  baseRef === preset
                    ? 'bg-sky-500/20 text-sky-400 border-sky-500/40 font-semibold'
                    : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                }`}
                style={{ color: baseRef === preset ? undefined : 'var(--muted)' }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-5 mt-3 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span className="break-all">{error}</span>
          </div>
        )}

        {/* Commits List Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5 min-h-[240px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 text-xs gap-2" style={{ color: 'var(--muted)' }}>
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span>{t('analyzing_commits_rebase', 'Analyse des commits pour le rebase...')}</span>
            </div>
          ) : commits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-xs text-center space-y-2" style={{ color: 'var(--muted)' }}>
              <RotateCcw className="w-8 h-8 opacity-40 mx-auto" />
              <p className="font-medium">{t('git_rebase_no_commits', 'Aucun commit à rebaser sur cette base.')}</p>
              <p className="text-[11px] opacity-75">
                {t('git_rebase_check_ref_hint', 'Vérifiez la référence de base choisie (ex: HEAD~3 pour les 3 derniers commits).')}
              </p>
            </div>
          ) : (
            commits.map((c, index) => {
              const isDrop = c.action === 'drop';
              const isReword = c.action === 'reword';
              const isSquash = c.action === 'squash';

              return (
                <div
                  key={`${c.sha}-${index}`}
                  className={`p-3 rounded-xl border transition-all ${
                    isDrop
                      ? 'opacity-40 bg-rose-500/5 border-rose-500/20 line-through'
                      : isSquash
                      ? 'bg-purple-500/5 border-purple-500/30'
                      : isReword
                      ? 'bg-sky-500/5 border-sky-500/30'
                      : 'bg-black/5 dark:bg-white/5'
                  }`}
                  style={{ borderColor: isDrop || isSquash || isReword ? undefined : 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* Left: Reorder arrows & SHA */}
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          onClick={() => moveCommit(index, 'up')}
                          disabled={index === 0 || executing}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                          title={t('git_move_up_tooltip', 'Déplacer vers le haut (appliqué plus tôt)')}
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveCommit(index, 'down')}
                          disabled={index === commits.length - 1 || executing}
                          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 disabled:opacity-20 cursor-pointer disabled:cursor-not-allowed"
                          title={t('git_move_down_tooltip', 'Déplacer vers le bas (appliqué plus tard)')}
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-500/15 text-sky-400 font-semibold">
                        {c.sha}
                      </span>
                    </div>

                    {/* Middle: Subject or Edit Box */}
                    <div className="flex-1 min-w-0">
                      {(isReword || isSquash) ? (
                        <div className="space-y-1">
                          <input
                            type="text"
                            value={c.new_message || ''}
                            onChange={(e) => updateMessage(index, e.target.value)}
                            placeholder={t('git_new_commit_msg_placeholder', 'Nouveau message de commit...')}
                            className="w-full px-2.5 py-1 text-xs rounded-lg border outline-none font-medium focus:border-sky-500"
                            style={{
                              backgroundColor: 'var(--bg)',
                              borderColor: 'var(--border)',
                              color: 'var(--strong)'
                            }}
                          />
                          <p className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>
                            Original : {c.subject} • {c.author}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="text-xs font-medium truncate" style={{ color: 'var(--strong)' }}>
                            {c.subject}
                          </p>
                          <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            {c.author}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Right: Action Selector */}
                    <div className="flex items-center gap-1 shrink-0">
                      {/* Pick */}
                      <button
                        type="button"
                        onClick={() => updateAction(index, 'pick')}
                        disabled={executing}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 transition-colors cursor-pointer ${
                          c.action === 'pick'
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40 font-semibold'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 opacity-60'
                        }`}
                        title={t('git_pick_commit_tooltip', 'Conserver le commit tel quel')}
                      >
                        <Check className="w-3 h-3" />
                        <span>pick</span>
                      </button>

                      {/* Reword */}
                      <button
                        type="button"
                        onClick={() => updateAction(index, 'reword')}
                        disabled={executing}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 transition-colors cursor-pointer ${
                          c.action === 'reword'
                            ? 'bg-sky-500/20 text-sky-400 border-sky-500/40 font-semibold'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 opacity-60'
                        }`}
                        title={t("git_reword_commit_tooltip", "Modifier le message du commit")}
                      >
                        <Edit2 className="w-3 h-3" />
                        <span>reword</span>
                      </button>

                      {/* Squash */}
                      <button
                        type="button"
                        onClick={() => updateAction(index, 'squash')}
                        disabled={index === 0 || executing}
                        className={`px-2 py-1 rounded-md text-[11px] font-medium border flex items-center gap-1 transition-colors cursor-pointer ${
                          c.action === 'squash'
                            ? 'bg-purple-500/20 text-purple-400 border-purple-500/40 font-semibold'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 opacity-60 disabled:opacity-20'
                        }`}
                        title={index === 0 ? t("git_cannot_squash_first", "Le premier commit ne peut pas être squashé") : t("git_squash_commit_tooltip", "Fusionner dans le commit précédent")}
                      >
                        <Layers className="w-3 h-3" />
                        <span>squash</span>
                      </button>

                      {/* Drop */}
                      <button
                        type="button"
                        onClick={() => updateAction(index, isDrop ? 'pick' : 'drop')}
                        disabled={executing}
                        className={`p-1.5 rounded-md text-[11px] font-medium border transition-colors cursor-pointer ${
                          isDrop
                            ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-rose-400 opacity-60'
                        }`}
                        title={isDrop ? t("git_restore_commit", "Restaurer le commit") : t("git_drop_commit_tooltip", "Supprimer ce commit")}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div
          className="px-5 py-4 border-t flex flex-wrap items-center justify-between gap-3 shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          {/* Summary Pills */}
          <div className="flex items-center gap-2 text-xs">
            <span className="font-semibold" style={{ color: 'var(--strong)' }}>
              {commits.length} commit(s) :
            </span>
            {pickCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px]">
                {pickCount} pick
              </span>
            )}
            {rewordCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-mono text-[10px]">
                {rewordCount} reword
              </span>
            )}
            {squashCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 font-mono text-[10px]">
                {squashCount} squash
              </span>
            )}
            {dropCount > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-400 font-mono text-[10px]">
                {dropCount} drop
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={executing}
              className="px-4 py-2 rounded-xl border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)'
              }}
            >
              {t('cancel', 'Annuler')}
            </button>

            <button
              type="button"
              onClick={handleExecute}
              disabled={executing || commits.length === 0 || loading}
              className="px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {executing ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{t('rebase_in_progress', 'Rebase en cours...')}</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{t('git_execute_rebase', 'Exécuter le Rebase')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
