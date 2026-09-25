import React, { useState, useEffect, useCallback } from 'react';
import { 
  GitBranch, 
  X, 
  RefreshCw, 
  CheckCircle2, 
  Trash2, 
  Plus, 
  Loader2, 
  FolderGit2, 
  ShieldCheck
} from 'lucide-react';
import { 
  fetchWorktrees, 
  createWorktree, 
  finalizeWorktree, 
  removeWorktree 
} from '../services/api';
import type { GitWorktreeItem } from '../types';
import { showToast } from '../services/toast';

interface WorktreeDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
}

export const WorktreeDashboardModal: React.FC<WorktreeDashboardModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace
}) => {
  const [worktrees, setWorktrees] = useState<GitWorktreeItem[]>([]);
  const [repoRoot, setRepoRoot] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newSubagentId, setNewSubagentId] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchWorktrees(currentWorkspace);
      setRepoRoot(res.repo_root);
      setWorktrees(res.worktrees);
    } catch {
      showToast('Impossible de charger les worktrees Git', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await createWorktree(currentWorkspace, newSubagentId.trim() || undefined);
      showToast(`Worktree isolé créé : ${res.branch}`, 'success');
      setNewSubagentId('');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Échec de création', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleFinalize = async (wt: GitWorktreeItem) => {
    setActionInProgress(wt.worktree);
    try {
      const res = await finalizeWorktree({
        path: wt.worktree,
        branch: wt.branch,
        repo_root: repoRoot || undefined,
        prune: true
      });
      if (res.pruned) {
        showToast('Worktree nettoyé avec succès (aucun commit, arbre propre)', 'info');
      } else {
        showToast(`Worktree conservé (${res.commits} commits, modifié=${res.dirty})`, 'warning');
      }
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erreur finalisation', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  const handleRemove = async (wt: GitWorktreeItem) => {
    setActionInProgress(wt.worktree);
    try {
      await removeWorktree({
        path: wt.worktree,
        branch: wt.branch,
        repo_root: repoRoot || undefined
      });
      showToast('Worktree supprimé', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || 'Erreur suppression', 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          backgroundColor: 'var(--surface, #0f172a)',
          borderColor: 'var(--border, rgba(255,255,255,0.1))',
          color: 'var(--text, #f8fafc)'
        }}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center text-white shadow-md">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Isolation Git Worktrees
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30">
                  Sprint 25
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Chaque sous-agent opère dans un répertoire isolé sans impacter vos fichiers de travail.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border hover:bg-slate-500/10 transition-colors text-slate-400 hover:text-slate-200 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border hover:bg-slate-500/10 transition-colors text-slate-400 hover:text-slate-200 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* Create new worktree */}
          <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}>
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
              <GitBranch className="w-4 h-4 text-amber-400" />
              <span>Générer un Worktree Isolé pour un Sous-Agent</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                placeholder="ID ou nom de la tâche (ex: refactor-auth, test-runner)"
                value={newSubagentId}
                onChange={(e) => setNewSubagentId(e.target.value)}
                className="flex-1 px-3.5 py-2 rounded-xl text-xs font-mono focus:outline-none"
                style={{
                  backgroundColor: 'var(--input-bg, #0b0f19)',
                  border: '1px solid var(--border)',
                  color: 'var(--text)'
                }}
              />
              <button
                onClick={handleCreate}
                disabled={creating || !repoRoot}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {creating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                <Plus className="w-3.5 h-3.5" />
                <span>Créer</span>
              </button>
            </div>
            {!repoRoot && (
              <p className="text-[11px] text-amber-400/90">
                L'espace de travail actif n'est pas un dépôt Git initialisé.
              </p>
            )}
          </div>

          {/* List of active worktrees */}
          <div className="space-y-3">
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
              <span>Worktrees Détectés ({worktrees.length})</span>
              {repoRoot && <span className="text-[11px] font-mono text-slate-500 truncate max-w-xs">{repoRoot}</span>}
            </div>

            {worktrees.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed text-center text-xs text-slate-500" style={{ borderColor: 'var(--border)' }}>
                Aucun sous-agent n'utilise de worktree actuellement. Les worktrees sont automatiquement créés lors des délégations complexes.
              </div>
            ) : (
              <div className="space-y-2">
                {worktrees.map((wt) => {
                  const isBusy = actionInProgress === wt.worktree;
                  return (
                    <div 
                      key={wt.worktree}
                      className="p-3.5 rounded-xl border flex items-center justify-between gap-3"
                      style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-mono font-bold text-amber-400 truncate">
                            {wt.branch || wt.worktree.split(/[/\\]/).pop()}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            wt.dirty 
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' 
                              : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                          }`}>
                            {wt.dirty ? 'Modifié (dirty)' : 'Propre'}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 font-mono truncate mt-1">
                          {wt.worktree}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleFinalize(wt)}
                          disabled={isBusy}
                          className="px-2.5 py-1.5 rounded-lg border text-xs font-medium text-slate-300 hover:bg-slate-500/10 transition-colors flex items-center gap-1 cursor-pointer"
                          style={{ borderColor: 'var(--border)' }}
                          title="Vérifier et nettoyer si propre"
                        >
                          {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                          <span className="hidden sm:inline">Finaliser</span>
                        </button>
                        <button
                          onClick={() => handleRemove(wt)}
                          disabled={isBusy}
                          className="p-1.5 rounded-lg border text-rose-400 hover:bg-rose-500/10 border-rose-500/30 transition-colors cursor-pointer"
                          title="Supprimer définitivement"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Protection stricte des fichiers et de l'éditeur Monaco</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium border hover:bg-slate-500/10 transition-colors cursor-pointer text-slate-300"
            style={{ borderColor: 'var(--border)' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
