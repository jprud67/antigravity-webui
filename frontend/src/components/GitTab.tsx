import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  GitBranch, 
  RefreshCw, 
  GitCommit, 
  UploadCloud, 
  DownloadCloud,
  FileCode, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileDiff,
  ShieldAlert,
  Search,
  Copy,
  Check,
  User,
  GitMerge,
  History,
  X,
  Code2,
  Archive,
  Layers,
  Plus,
  Trash2,
  ArrowUpRight,
  Save,
  ArrowRight,
  Edit3,
  Globe,
  Tag,
  Play,
  RotateCcw,
  AlertTriangle
} from 'lucide-react';
import type { MonacoStudioConfig, GitStashItem, GitBranchDetail, RebaseStatusResponse, GitTagDetail } from '../types';
import { 
  fetchGitStatus, 
  fetchGitDiff, 
  gitCommit, 
  gitPush, 
  gitPull, 
  fetchGitLog,
  fetchGitStashes,
  saveGitStash,
  popGitStash,
  applyGitStash,
  dropGitStash,
  fetchGitStashDiff,
  cherryPickCommit,
  fetchGitBranches,
  checkoutGitBranch,
  createGitBranch,
  deleteGitBranch,
  mergeGitBranch,
  renameGitBranch,
  fetchRebaseStatus,
  continueGitRebase,
  abortGitRebase,
  type GitStatusResult,
  type GitCommitItem
} from '../services/api';
import { DiffViewer } from './DiffViewer';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { GitConflictModal } from './GitConflictModal';
import { GitRebaseModal } from './GitRebaseModal';
import { GitRemotesView } from './GitRemotesView';
import { GitTagsView } from './GitTagsView';
import { GitReleaseModal } from './GitReleaseModal';

interface GitTabProps {
  currentWorkspace: string;
  onOpenMonacoStudio?: (config: MonacoStudioConfig) => void;
}

export const GitTab: React.FC<GitTabProps> = ({ currentWorkspace, onOpenMonacoStudio }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // View Mode: 'changes' vs 'history' vs 'stashes' vs 'branches' vs 'remotes' vs 'tags'
  const [viewMode, setViewMode] = useState<'changes' | 'history' | 'stashes' | 'branches' | 'remotes' | 'tags'>('changes');

  // Release Modal states
  const [releaseModalTag, setReleaseModalTag] = useState<GitTagDetail | null>(null);
  const [isReleaseModalOpen, setIsReleaseModalOpen] = useState(false);

  // Branch management states
  const [branches, setBranches] = useState<GitBranchDetail[]>([]);
  const [loadingBranches, setLoadingBranches] = useState(false);
  const [branchSearch, setBranchSearch] = useState('');
  const [branchFilter, setBranchFilter] = useState<'all' | 'local' | 'remote'>('all');
  
  // Create branch modal/form state
  const [isCreateBranchOpen, setIsCreateBranchOpen] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [newBranchStartPoint, setNewBranchStartPoint] = useState('');
  const [newBranchCheckout, setNewBranchCheckout] = useState(true);
  const [creatingBranch, setCreatingBranch] = useState(false);

  // Rename branch state
  const [renamingBranch, setRenamingBranch] = useState<GitBranchDetail | null>(null);
  const [newRenameName, setNewRenameName] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Merge branch state
  const [mergingBranch, setMergingBranch] = useState<GitBranchDetail | null>(null);
  const [mergeNoFF, setMergeNoFF] = useState(false);
  const [mergeMessage, setMergeMessage] = useState('');
  const [merging, setMerging] = useState(false);

  // Rebase states
  const [isRebaseModalOpen, setIsRebaseModalOpen] = useState(false);
  const [rebaseBaseRef, setRebaseBaseRef] = useState('HEAD~5');
  const [rebaseStatus, setRebaseStatus] = useState<RebaseStatusResponse | null>(null);
  const [continuingRebase, setContinuingRebase] = useState(false);
  const [abortingRebase, setAbortingRebase] = useState(false);

  // Stash states
  const [stashes, setStashes] = useState<GitStashItem[]>([]);
  const [loadingStashes, setLoadingStashes] = useState(false);
  const [isCreateStashOpen, setIsCreateStashOpen] = useState(false);
  const [newStashMessage, setNewStashMessage] = useState('');
  const [newStashUntracked, setNewStashUntracked] = useState(false);
  const [savingStash, setSavingStash] = useState(false);

  // Active Conflict File for modal
  const [activeConflictFile, setActiveConflictFile] = useState<string | null>(null);

  // Selected file for working tree diff
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isDiffStaged, setIsDiffStaged] = useState<boolean>(false);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Commit & Push states
  const [commitMessage, setCommitMessage] = useState('');
  const [stageAll, setStageAll] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  // History & Graph states
  const [commits, setCommits] = useState<GitCommitItem[]>([]);
  const [loadingCommits, setLoadingCommits] = useState(false);
  const [commitSearch, setCommitSearch] = useState('');
  const [selectedCommit, setSelectedCommit] = useState<GitCommitItem | null>(null);
  const [commitDiff, setCommitDiff] = useState<string | null>(null);
  const [loadingCommitDiff, setLoadingCommitDiff] = useState(false);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const diffRequestIdRef = React.useRef(0);
  const commitDiffRequestIdRef = React.useRef(0);
  const selectedFileRef = React.useRef<string | null>(null);

  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const handleSelectFile = useCallback(async (filePath: string, staged: boolean = false) => {
    setSelectedFile(filePath);
    setIsDiffStaged(staged);
    setLoadingDiff(true);
    const reqId = ++diffRequestIdRef.current;
    try {
      const res = await fetchGitDiff(currentWorkspace, filePath, staged);
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(res.diff);
      }
    } catch {
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(null);
      }
    } finally {
      if (reqId === diffRequestIdRef.current) {
        setLoadingDiff(false);
      }
    }
  }, [currentWorkspace]);

  const handleSelectCommit = useCallback(async (commit: GitCommitItem) => {
    setSelectedCommit(commit);
    setLoadingCommitDiff(true);
    const reqId = ++commitDiffRequestIdRef.current;
    try {
      const res = await fetchGitDiff(currentWorkspace, undefined, false, commit.hash);
      if (reqId === commitDiffRequestIdRef.current) {
        setCommitDiff(res.diff);
      }
    } catch {
      if (reqId === commitDiffRequestIdRef.current) {
        setCommitDiff(null);
      }
    } finally {
      if (reqId === commitDiffRequestIdRef.current) {
        setLoadingCommitDiff(false);
      }
    }
  }, [currentWorkspace]);

  const loadStatus = useCallback(async (autoSelect: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGitStatus(currentWorkspace);
      setStatus(data);
      if (autoSelect || !selectedFileRef.current) {
        if (data.conflicts && data.conflicts.length > 0) {
          handleSelectFile(data.conflicts[0], false);
        } else if (data.modified.length > 0) {
          handleSelectFile(data.modified[0], false);
        } else if (data.staged.length > 0) {
          handleSelectFile(data.staged[0], true);
        } else if (data.untracked.length > 0) {
          handleSelectFile(data.untracked[0], false);
        }
      }
      return data;
    } catch (err: any) {
      setError(err.message || t('git_cannot_get_status', 'Cannot get Git status'));
      return null;
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, handleSelectFile, t]);

  const loadHistory = useCallback(async (autoSelectFirst = true) => {
    setLoadingCommits(true);
    try {
      const data = await fetchGitLog(currentWorkspace, 50);
      const list = data.commits || [];
      setCommits(list);
      if (autoSelectFirst && list.length > 0) {
        handleSelectCommit(list[0]);
      }
    } catch (err: any) {
      console.error('Failed to load git log:', err);
    } finally {
      setLoadingCommits(false);
    }
  }, [currentWorkspace, handleSelectCommit]);

  const loadStashes = useCallback(async () => {
    setLoadingStashes(true);
    try {
      const data = await fetchGitStashes(currentWorkspace);
      setStashes(data);
    } catch {
      setStashes([]);
    } finally {
      setLoadingStashes(false);
    }
  }, [currentWorkspace]);

  const loadBranches = useCallback(async () => {
    setLoadingBranches(true);
    try {
      const data = await fetchGitBranches(currentWorkspace);
      setBranches(data.branches || []);
    } catch (err: any) {
      console.error('Failed to load branches:', err);
    } finally {
      setLoadingBranches(false);
    }
  }, [currentWorkspace]);

  const loadRebaseStatus = useCallback(async () => {
    try {
      const res = await fetchRebaseStatus(currentWorkspace);
      setRebaseStatus(res);
    } catch {
      setRebaseStatus(null);
    }
  }, [currentWorkspace]);

  const handleCreateStash = useCallback(async () => {
    setSavingStash(true);
    try {
      await saveGitStash({
        workspace: currentWorkspace,
        message: newStashMessage.trim() || undefined,
        include_untracked: newStashUntracked
      });
      showToast(t('stash_saved_success', 'Stash enregistré avec succès !'), 'success');
      setIsCreateStashOpen(false);
      setNewStashMessage('');
      setNewStashUntracked(false);
      await loadStashes();
      await loadStatus();
    } catch (err: any) {
      showToast(err.message || t('stash_create_error', 'Erreur lors de la création du stash'), 'error');
    } finally {
      setSavingStash(false);
    }
  }, [currentWorkspace, newStashMessage, newStashUntracked, loadStashes, loadStatus, t]);

  const handlePopStash = useCallback(async (index: number) => {
    try {
      const res = await popGitStash({ workspace: currentWorkspace, index });
      if (res.status === 'conflict') {
        showToast(t('stash_pop_conflicts', 'Stash dépilé avec des conflits: {0}', res.message), 'error');
      } else {
        showToast(t('stash_popped_success', 'Stash dépilé et appliqué !'), 'success');
      }
      await loadStashes();
      await loadStatus();
      setViewMode('changes');
    } catch (err: any) {
      showToast(err.message || t('stash_pop_error', 'Erreur lors du dépilage du stash'), 'error');
    }
  }, [currentWorkspace, loadStashes, loadStatus, t]);

  const handleApplyStash = useCallback(async (index: number) => {
    try {
      const res = await applyGitStash({ workspace: currentWorkspace, index });
      if (res.status === 'conflict') {
        showToast(t('stash_apply_conflicts', 'Stash appliqué avec des conflits: {0}', res.message), 'error');
      } else {
        showToast(t('stash_applied_success', 'Stash appliqué avec succès !'), 'success');
      }
      await loadStatus();
      setViewMode('changes');
    } catch (err: any) {
      showToast(err.message || t('stash_apply_error', "Erreur lors de l'application du stash"), 'error');
    }
  }, [currentWorkspace, loadStatus, t]);

  const handleDropStash = useCallback(async (index: number) => {
    const confirmed = await showConfirm(t('confirm_delete_stash_idx', 'Voulez-vous vraiment supprimer le stash@{0} ?', index), {
      title: t('delete_stash', 'Supprimer le stash'),
      confirmLabel: t('delete', 'Supprimer'),
      cancelLabel: t('cancel', 'Annuler'),
      destructive: true
    });
    if (!confirmed) return;
    try {
      await dropGitStash(currentWorkspace, index);
      showToast(t('stash_deleted', 'Stash supprimé.'), 'info');
      await loadStashes();
    } catch (err: any) {
      showToast(err.message || t('stash_delete_error', 'Erreur lors de la suppression du stash'), 'error');
    }
  }, [currentWorkspace, loadStashes, t]);

  const handleClearAllStashes = useCallback(async () => {
    const confirmed = await showConfirm(t('confirm_clear_all_stashes', 'Voulez-vous supprimer TOUS les stashes ? Cette action est irréversible.'), {
      title: t('clear_all_stashes', 'Vider tous les stashes'),
      confirmLabel: t('delete_all', 'Tout supprimer'),
      cancelLabel: t('cancel', 'Annuler'),
      destructive: true
    });
    if (!confirmed) return;
    try {
      await dropGitStash(currentWorkspace);
      showToast(t('all_stashes_cleared', 'Tous les stashes ont été supprimés.'), 'info');
      await loadStashes();
    } catch (err: any) {
      showToast(err.message || t('stash_clear_error', 'Erreur lors du vidage des stashes'), 'error');
    }
  }, [currentWorkspace, loadStashes, t]);

  const handlePreviewStashDiff = useCallback(async (stash: GitStashItem) => {
    if (!onOpenMonacoStudio) return;
    try {
      const res = await fetchGitStashDiff(currentWorkspace, stash.index);
      onOpenMonacoStudio({
        mode: 'diff',
        title: `Diff ${stash.id} (${stash.hash})`,
        diffText: res.diff,
        originalContent: '',
        modifiedContent: res.diff,
        readOnly: true,
        workspace: currentWorkspace
      });
    } catch (err: any) {
      showToast(err.message || 'Impossible de charger le diff du stash', 'error');
    }
  }, [onOpenMonacoStudio, currentWorkspace]);

  const handleCherryPick = useCallback(async (commit: GitCommitItem) => {
    const confirmed = await showConfirm(
      t('confirm_cherry_pick_commit', 'Voulez-vous appliquer le commit « {0} : {1} » sur la branche active ?', commit.short_hash, commit.subject),
      {
        title: t('cherry_pick_title', 'Cherry-pick commit'),
        confirmLabel: t('cherry_pick_btn', 'Appliquer (Cherry-pick)'),
        cancelLabel: t('cancel', 'Annuler')
      }
    );
    if (!confirmed) return;
    try {
      const res = await cherryPickCommit({ workspace: currentWorkspace, commit_hash: commit.hash });
      if (res.status === 'applied') {
        showToast(t('cherry_pick_success', 'Commit appliqué avec succès via Cherry-pick !'), 'success');
        await loadStatus();
        await loadHistory(true);
      } else if (res.status === 'conflict') {
        showToast(t('cherry_pick_conflict_msg', 'Conflit lors du cherry-pick: {0}', res.message), 'error');
        await loadStatus();
        setViewMode('changes');
      }
    } catch (err: any) {
      showToast(err.message || t('cherry_pick_error', 'Erreur lors du cherry-pick'), 'error');
    }
  }, [currentWorkspace, loadStatus, loadHistory, t]);

  const handleCheckoutBranch = useCallback(async (branchName: string) => {
    try {
      const res = await checkoutGitBranch({
        workspace: currentWorkspace,
        branch: branchName
      });
      showToast(t('switched_branch_success', "Bascule réussie sur '{0}'", res.branch || branchName), 'success');
      await loadStatus();
      await loadBranches();
      if (commits.length > 0) {
        await loadHistory(true);
      }
    } catch (err: any) {
      showToast(err.message || t('switch_branch_error', 'Erreur lors de la bascule de branche'), 'error');
    }
  }, [currentWorkspace, loadStatus, loadBranches, commits.length, loadHistory, t]);

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    setCreatingBranch(true);
    try {
      const res = await createGitBranch({
        workspace: currentWorkspace,
        name: newBranchName.trim(),
        start_point: newBranchStartPoint.trim() || undefined,
        checkout: newBranchCheckout
      });
      showToast(t('branch_created_success_named', "Branche '{0}' créée avec succès !", res.name || newBranchName.trim()), 'success');
      setIsCreateBranchOpen(false);
      setNewBranchName('');
      setNewBranchStartPoint('');
      setNewBranchCheckout(true);
      await loadBranches();
      await loadStatus();
      if (commits.length > 0) {
        await loadHistory(true);
      }
    } catch (err: any) {
      showToast(err.message || t('branch_create_error', 'Erreur lors de la création de la branche'), 'error');
    } finally {
      setCreatingBranch(false);
    }
  }, [currentWorkspace, newBranchName, newBranchStartPoint, newBranchCheckout, loadBranches, loadStatus, commits.length, loadHistory, t]);

  const handleDeleteBranch = useCallback(async (branch: GitBranchDetail) => {
    const isRemote = branch.is_remote;
    const confirmMessage = isRemote
      ? t('confirm_delete_remote_branch', "Voulez-vous vraiment supprimer la branche distante '{0}' sur le remote ?", branch.name)
      : t('confirm_delete_local_branch', "Voulez-vous vraiment supprimer la branche locale '{0}' ?", branch.name);

    const confirmed = await showConfirm(confirmMessage, {
      title: t('delete_branch', 'Supprimer la branche'),
      confirmLabel: t('delete', 'Supprimer'),
      cancelLabel: t('cancel', 'Annuler'),
      destructive: true
    });
    if (!confirmed) return;

    try {
      await deleteGitBranch({
        workspace: currentWorkspace,
        branch: branch.name,
        force: false,
        remote: isRemote
      });
      showToast(t('branch_deleted_success_named', "Branche '{0}' supprimée avec succès.", branch.name), 'info');
      await loadBranches();
    } catch (err: any) {
      const msg = err.message || '';
      if (msg.includes('non complètement fusionnée') || msg.includes('not fully merged')) {
        const forceConfirm = await showConfirm(
          t('branch_not_merged_force_confirm', "La branche '{0}' n'est pas complètement fusionnée. Souhaitez-vous forcer la suppression (-D) ?", branch.name),
          {
            title: t('force_delete_title', 'Forcer la suppression'),
            confirmLabel: t('force_delete_btn', 'Supprimer de force (-D)'),
            cancelLabel: t('cancel', 'Annuler'),
            destructive: true
          }
        );
        if (forceConfirm) {
          try {
            await deleteGitBranch({
              workspace: currentWorkspace,
              branch: branch.name,
              force: true,
              remote: isRemote
            });
            showToast(t('branch_force_deleted_named', "Branche '{0}' supprimée de force.", branch.name), 'info');
            await loadBranches();
          } catch (forceErr: any) {
            showToast(forceErr.message || t('force_delete_failed', 'Échec de la suppression forcée'), 'error');
          }
        }
      } else {
        showToast(msg || t('branch_delete_error', 'Erreur lors de la suppression de la branche'), 'error');
      }
    }
  }, [currentWorkspace, loadBranches, t]);

  const handleMergeBranch = useCallback(async () => {
    if (!mergingBranch) return;
    setMerging(true);
    try {
      const res = await mergeGitBranch({
        workspace: currentWorkspace,
        branch: mergingBranch.name,
        no_ff: mergeNoFF,
        message: mergeMessage.trim() || undefined
      });
      if (res.has_conflicts) {
        showToast(t('merge_conflicts_occurred', "Conflits survenus lors de la fusion de '{0}'", mergingBranch.name), 'error');
        setMergingBranch(null);
        await loadStatus();
        if (res.conflicts && res.conflicts.length > 0) {
          setActiveConflictFile(res.conflicts[0]);
        }
      } else {
        showToast(t('branch_merged_success_named', "Branche '{0}' fusionnée avec succès !", mergingBranch.name), 'success');
        setMergingBranch(null);
        setMergeMessage('');
        setMergeNoFF(false);
        await loadStatus();
        await loadBranches();
        if (commits.length > 0) {
          await loadHistory(true);
        }
      }
    } catch (err: any) {
      showToast(err.message || t('branch_merge_error', 'Erreur lors de la fusion'), 'error');
    } finally {
      setMerging(false);
    }
  }, [currentWorkspace, mergingBranch, mergeNoFF, mergeMessage, loadStatus, loadBranches, commits.length, loadHistory, t]);

  const handleRenameBranch = useCallback(async () => {
    if (!renamingBranch || !newRenameName.trim()) return;
    setRenaming(true);
    try {
      const res = await renameGitBranch({
        workspace: currentWorkspace,
        old_name: renamingBranch.name,
        new_name: newRenameName.trim()
      });
      showToast(t('branch_renamed_success_named', "Branche renommée en '{0}' avec succès !", res.new_name || newRenameName.trim()), 'success');
      setRenamingBranch(null);
      setNewRenameName('');
      await loadBranches();
      await loadStatus();
    } catch (err: any) {
      showToast(err.message || t('branch_rename_error', 'Erreur lors du renommage'), 'error');
    } finally {
      setRenaming(false);
    }
  }, [currentWorkspace, renamingBranch, newRenameName, loadBranches, loadStatus, t]);

  const handleContinueRebase = useCallback(async () => {
    setContinuingRebase(true);
    try {
      const res = await continueGitRebase(currentWorkspace);
      if (res.status === 'completed') {
        showToast(t('rebase_finished_success', 'Rebase terminé avec succès !'), 'success');
        await loadStatus();
        await loadRebaseStatus();
        await loadBranches();
        if (commits.length > 0) {
          await loadHistory(true);
        }
      } else if (res.status === 'conflict') {
        showToast(t('rebase_conflicts_remaining', 'Conflits subsistants. Résolvez-les avant de poursuivre.'), 'error');
        await loadStatus();
        await loadRebaseStatus();
        if (res.conflicts && res.conflicts.length > 0) {
          setActiveConflictFile(res.conflicts[0]);
        }
      }
    } catch (err: any) {
      showToast(err.message || t('rebase_continue_error', 'Erreur lors de la poursuite du rebase'), 'error');
    } finally {
      setContinuingRebase(false);
    }
  }, [currentWorkspace, loadStatus, loadRebaseStatus, loadBranches, commits.length, loadHistory, t]);

  const handleAbortRebase = useCallback(async () => {
    const confirmed = await showConfirm(
      t('confirm_abort_rebase', 'Voulez-vous abandonner le rebase en cours et restaurer la branche dans son état initial ?'),
      {
        title: t('abort_rebase_title', 'Abandonner le Rebase'),
        confirmLabel: t('abort_rebase_btn', 'Abandonner (git rebase --abort)'),
        cancelLabel: t('continue_rebase_btn', 'Continuer le rebase'),
        destructive: true
      }
    );
    if (!confirmed) return;

    setAbortingRebase(true);
    try {
      await abortGitRebase(currentWorkspace);
      showToast(t('rebase_aborted_restored', 'Rebase annulé, état initial restauré.'), 'info');
      await loadStatus();
      await loadRebaseStatus();
      await loadBranches();
      if (commits.length > 0) {
        await loadHistory(true);
      }
    } catch (err: any) {
      showToast(err.message || t('rebase_abort_error', "Erreur lors de l'abandon du rebase"), 'error');
    } finally {
      setAbortingRebase(false);
    }
  }, [currentWorkspace, loadStatus, loadRebaseStatus, loadBranches, commits.length, loadHistory, t]);

  const handleOpenRebase = useCallback((base: string = 'HEAD~5') => {
    setRebaseBaseRef(base);
    setIsRebaseModalOpen(true);
  }, []);

  const activeBranchDetail = useMemo(() => {
    return branches.find((b) => b.is_current) || null;
  }, [branches]);

  const filteredBranches = useMemo(() => {
    return branches.filter((b) => {
      if (branchFilter === 'local' && b.is_remote) return false;
      if (branchFilter === 'remote' && !b.is_remote) return false;
      if (branchSearch.trim()) {
        const q = branchSearch.toLowerCase().trim();
        return b.name.toLowerCase().includes(q) || (b.upstream && b.upstream.toLowerCase().includes(q));
      }
      return true;
    });
  }, [branches, branchFilter, branchSearch]);

  const localBranchesCount = useMemo(() => branches.filter((b) => !b.is_remote).length, [branches]);
  const remoteBranchesCount = useMemo(() => branches.filter((b) => b.is_remote).length, [branches]);

  useEffect(() => {
    let active = true;
    fetchGitStatus(currentWorkspace)
      .then((data) => {
        if (active) {
          setStatus(data);
          if (!selectedFileRef.current) {
            if (data.conflicts && data.conflicts.length > 0) {
              handleSelectFile(data.conflicts[0], false);
            } else if (data.modified.length > 0) {
              handleSelectFile(data.modified[0], false);
            } else if (data.staged.length > 0) {
              handleSelectFile(data.staged[0], true);
            } else if (data.untracked.length > 0) {
              handleSelectFile(data.untracked[0], false);
            }
          }
        }
      })
      .catch((err: any) => {
        if (active) {
          setError(err.message || t('git_cannot_get_status', 'Cannot get Git status'));
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    fetchRebaseStatus(currentWorkspace)
      .then((res) => {
        if (active) setRebaseStatus(res);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [currentWorkspace, handleSelectFile, t]);

  // Load history automatically when user clicks History tab if empty
  useEffect(() => {
    if (viewMode === 'history' && commits.length === 0) {
      queueMicrotask(() => {
        void loadHistory(true);
      });
    }
  }, [viewMode, commits.length, loadHistory]);

  // Load branches automatically when user clicks Branches tab if empty
  useEffect(() => {
    if (viewMode === 'branches' && branches.length === 0) {
      queueMicrotask(() => {
        void loadBranches();
      });
    }
  }, [viewMode, branches.length, loadBranches]);

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;
    setCommitting(true);
    setActionSuccess(null);
    setError(null);
    try {
      const res = await gitCommit(commitMessage.trim(), currentWorkspace, stageAll);
      setActionSuccess(`${t('git_commit_success', 'Committed successfully')}: ${res.output || commitMessage}`);
      setCommitMessage('');
      await loadStatus(true);
      if (commits.length > 0) {
        loadHistory(true);
      }
    } catch (err: any) {
      setError(err.message || t('git_commit_error', 'Error during commit'));
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setActionSuccess(null);
    setError(null);
    try {
      await gitPush(currentWorkspace);
      setActionSuccess(`${t('git_push_success', 'Changes pushed successfully to origin')}/${status?.branch || 'main'}`);
      await loadStatus();
      if (commits.length > 0) {
        loadHistory(false);
      }
    } catch (err: any) {
      setError(err.message || t('git_push_error', 'Error during push'));
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setActionSuccess(null);
    setError(null);
    try {
      const res = await gitPull(currentWorkspace);
      setActionSuccess(`${t('git_pull_success', 'Changes pulled successfully from origin')}/${status?.branch || 'main'}: ${res.output || 'Up to date'}`);
      await loadStatus();
      setActiveDiff(null);
      setSelectedFile(null);
      if (commits.length > 0) {
        loadHistory(true);
      }
    } catch (err: any) {
      setError(err.message || t('git_pull_error', 'Error during pull'));
    } finally {
      setPulling(false);
    }
  };

  const handleCopyHash = (hash: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    navigator.clipboard.writeText(hash).then(() => {
      setCopiedHash(hash);
      setTimeout(() => setCopiedHash(null), 2000);
    }).catch(() => {});
  };

  const allChangedFiles = useMemo(() => {
    if (!status) return [];
    const map = new Map<string, { path: string; type: string }>();
    (status.conflicts || []).forEach((f) => map.set(f, { path: f, type: 'U' }));
    (status.staged || []).forEach((f) => {
      if (!map.has(f)) map.set(f, { path: f, type: 'S' });
    });
    (status.modified || []).forEach((f) => {
      const existing = map.get(f);
      if (existing) {
        if (existing.type === 'S') existing.type = 'S+M';
      } else {
        map.set(f, { path: f, type: 'M' });
      }
    });
    (status.deleted || []).forEach((f) => {
      if (!map.has(f)) map.set(f, { path: f, type: 'D' });
    });
    (status.untracked || []).forEach((f) => {
      if (!map.has(f)) {
        map.set(f, { path: f, type: '?' });
      }
    });
    return Array.from(map.values());
  }, [status]);

  const filteredCommits = useMemo(() => {
    if (!commitSearch.trim()) return commits;
    const q = commitSearch.toLowerCase().trim();
    return commits.filter((c) => 
      c.subject.toLowerCase().includes(q) ||
      c.author.toLowerCase().includes(q) ||
      c.short_hash.toLowerCase().includes(q) ||
      c.body.toLowerCase().includes(q)
    );
  }, [commits, commitSearch]);

  const formatCommitTime = (timestamp: number) => {
    if (!timestamp) return '';
    try {
      const date = new Date(timestamp * 1000);
      return date.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } catch {
      return '';
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-xs">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-sky-400" />
        {t('git_checking_repo', 'Checking Git repository...')}
      </div>
    );
  }

  if (status && !status.is_repo) {
    return (
      <div className="p-8 text-center text-slate-400 space-y-3">
        <GitBranch className="w-10 h-10 mx-auto text-slate-600" />
        <p className="text-sm font-medium text-slate-300">{t('git_no_repo', 'No Git repository detected')}</p>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          {t('git_no_repo_desc', 'The directory {0} is not initialized under Git.').replace('{0}', '')}
          <code className="text-sky-400 bg-slate-800/80 px-1 py-0.5 rounded">{currentWorkspace}</code>
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full"
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text)'
      }}
    >
      {/* Top Git Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b text-xs shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold font-mono" style={{ color: 'var(--strong)' }}>{status?.branch || 'main'}</span>
          {status?.tracking && (
            <span className="text-[10px] font-mono hidden sm:inline" style={{ color: 'var(--muted)' }}>
              ({status.tracking})
            </span>
          )}
          {status?.clean ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" /> {t('git_clean', 'Clean')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> {t('git_files_changed', '{0} file(s) changed').replace('{0}', String(allChangedFiles.length))}
            </span>
          )}
          {status && status.ahead > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full border border-sky-500/20" title={t('git_ahead', '{0} commit(s) ahead of remote').replace('{0}', String(status.ahead))}>
              ↑ {status.ahead}
            </span>
          )}
          {status && status.behind > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-full border border-rose-500/20" title={t('git_behind', '{0} commit(s) behind remote').replace('{0}', String(status.behind))}>
              ↓ {status.behind}
            </span>
          )}
        </div>

        <button
          onClick={() => { 
            void loadStatus(); 
            if (viewMode === 'history') {
              void loadHistory(false);
            }
          }}
          disabled={loading || loadingCommits}
          title={t('refresh', 'Refresh')}
          className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          style={{ color: 'var(--muted)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading || loadingCommits ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Sub-Tabs: Changements vs Historique & Graphe */}
      <div 
        className="flex items-center border-b px-2 shrink-0 gap-1 text-xs"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)'
        }}
      >
        <button
          type="button"
          onClick={() => setViewMode('changes')}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'changes'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'changes' ? undefined : 'var(--text)' }}
        >
          <FileCode className="w-3.5 h-3.5" />
          <span>{t('git_tab_changes', 'Changements')}</span>
          {allChangedFiles.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/20 text-amber-500 font-mono">
              {allChangedFiles.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('history');
            if (commits.length === 0) {
              void loadHistory(true);
            }
          }}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'history'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'history' ? undefined : 'var(--text)' }}
        >
          <GitMerge className="w-3.5 h-3.5" />
          <span>{t('git_tab_history', 'Historique & Graphe')}</span>
          {commits.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-sky-500/20 text-sky-400 font-mono">
              {commits.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('stashes');
            void loadStashes();
          }}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'stashes'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'stashes' ? undefined : 'var(--text)' }}
        >
          <Archive className="w-3.5 h-3.5" />
          <span>{t('stashes', 'Stashes')}</span>
          {stashes.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-purple-500/20 text-purple-400 font-mono">
              {stashes.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setViewMode('branches');
            void loadBranches();
          }}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'branches'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'branches' ? undefined : 'var(--text)' }}
        >
          <GitBranch className="w-3.5 h-3.5" />
          <span>{t('git_tab_branches', 'Branches')}</span>
          {branches.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-500/20 text-emerald-400 font-mono">
              {branches.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setViewMode('remotes')}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'remotes'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'remotes' ? undefined : 'var(--text)' }}
        >
          <Globe className="w-3.5 h-3.5" />
          <span>{t('remotes', 'Remotes')}</span>
        </button>

        <button
          type="button"
          onClick={() => setViewMode('tags')}
          className={`flex items-center gap-1.5 px-3 py-2 border-b-2 font-medium transition-colors cursor-pointer ${
            viewMode === 'tags'
              ? 'border-sky-500 text-sky-500 font-semibold'
              : 'border-transparent hover:opacity-100 opacity-70'
          }`}
          style={{ color: viewMode === 'tags' ? undefined : 'var(--text)' }}
        >
          <Tag className="w-3.5 h-3.5" />
          <span>{t('tags_and_releases', 'Tags & Releases')}</span>
        </button>
      </div>

      {/* In-Progress Rebase Amber Banner */}
      {rebaseStatus?.is_rebasing && (
        <div className="p-3 bg-amber-500/15 border-b border-amber-500/40 text-amber-300 text-xs flex flex-col gap-2 shrink-0 font-medium">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-amber-400 animate-spin" />
              <span className="font-semibold text-amber-200">
                Rebase interactif en cours
                {rebaseStatus.total_steps > 0 ? ` : étape ${rebaseStatus.current_step}/${rebaseStatus.total_steps}` : ''}
                {rebaseStatus.current_commit ? ` (commit ${rebaseStatus.current_commit})` : ''}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleContinueRebase}
                disabled={continuingRebase || abortingRebase}
                className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                title={t('git_rebase_continue_tooltip', 'Poursuivre le rebase (git rebase --continue)')}
              >
                {continuingRebase ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Play className="w-3 h-3 fill-current" />}
                <span>{t('continue', 'Continuer')}</span>
              </button>
              <button
                type="button"
                onClick={handleAbortRebase}
                disabled={continuingRebase || abortingRebase}
                className="px-2.5 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 font-medium flex items-center gap-1 cursor-pointer transition-colors"
                title={t('git_rebase_abort_tooltip', 'Abandonner le rebase (git rebase --abort)')}
              >
                {abortingRebase ? <RefreshCw className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                <span>{t('abort', 'Abandonner')}</span>
              </button>
            </div>
          </div>
          {rebaseStatus.conflicted_files.length > 0 && (
            <div className="flex flex-col gap-1 mt-1">
              <span className="text-[11px] text-amber-200/90 font-medium">
                Fichiers en conflit nécessitant une résolution :
              </span>
              <div className="flex flex-wrap gap-1.5">
                {rebaseStatus.conflicted_files.map((cf) => (
                  <button
                    key={cf}
                    type="button"
                    onClick={() => setActiveConflictFile(cf)}
                    className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 font-mono text-[10px] flex items-center gap-1 cursor-pointer"
                  >
                    <span>{cf}</span>
                    <AlertTriangle className="w-3 h-3 text-rose-400" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            <span className="truncate">{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-xs hover:opacity-80 p-0.5 rounded cursor-pointer shrink-0"
            title={t('close', 'Close')}
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="p-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
            <span className="break-all">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs hover:opacity-80 p-0.5 rounded cursor-pointer shrink-0"
            title={t('close', 'Close')}
          >
            ✕
          </button>
        </div>
      )}

      {status?.conflicts && status.conflicts.length > 0 && (
        <div className="p-3 bg-rose-500/15 border-b border-rose-500/40 text-rose-300 text-xs flex flex-col gap-2 shrink-0 font-medium">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-rose-400 animate-pulse" />
              <span className="font-semibold text-rose-200">
                {t('git_conflict_warning', '{0} conflit(s) de fusion non résolu(s).').replace('{0}', String(status.conflicts.length))}
              </span>
            </div>
            <span className="text-[10px] text-rose-400/80">{t('action_required', 'Action requise')}</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {status.conflicts.map((confFile) => (
              <div key={confFile} className="flex items-center justify-between p-2 rounded-lg bg-black/25 border border-rose-500/30 text-xs">
                <span className="font-mono text-rose-200 truncate">{confFile}</span>
                <button
                  type="button"
                  onClick={() => setActiveConflictFile(confFile)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-medium text-[11px] cursor-pointer shadow-xs transition-colors shrink-0"
                >
                  <GitMerge className="w-3 h-3" />
                  <span>{t('resolve_conflict', 'Résoudre le conflit')}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* VIEW MODE 1: WORKING TREE CHANGES */}
      {viewMode === 'changes' && (
        <>
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
            {/* Changed Files Section */}
            <div
              className="p-3 border-b shrink-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div
                className="text-[11px] font-semibold uppercase tracking-wider mb-2 flex items-center justify-between"
                style={{ color: 'var(--muted)' }}
              >
                <span>{t('git_changed_files', 'Changed files')} ({allChangedFiles.length})</span>
                {allChangedFiles.length > 0 && (
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{t('git_click_for_diff', 'Click to view diff')}</span>
                )}
              </div>

              {allChangedFiles.length === 0 ? (
                <div className="text-xs py-3 text-center italic" style={{ color: 'var(--muted)' }}>
                  {t('git_no_changes', 'No uncommitted changes in working tree.')}
                </div>
              ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                  {allChangedFiles.map((file) => {
                    const isSelected = selectedFile === file.path;
                    let badgeColor = 'bg-slate-500/20 text-slate-400';
                    if (file.type === 'M') badgeColor = 'bg-amber-500/20 text-amber-500';
                    if (file.type === 'S') badgeColor = 'bg-emerald-500/20 text-emerald-500';
                    if (file.type === 'S+M') badgeColor = 'bg-sky-500/20 text-sky-400';
                    if (file.type === '?') badgeColor = 'bg-slate-500/20 text-slate-400';
                    if (file.type === 'D') badgeColor = 'bg-rose-500/20 text-rose-500';
                    if (file.type === 'U') badgeColor = 'bg-red-500/30 text-red-500 font-bold';

                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => handleSelectFile(file.path, file.type === 'S')}
                        className={`w-full text-left px-2 py-1.5 rounded-lg text-xs flex items-center justify-between transition-colors cursor-pointer border ${
                          isSelected
                            ? 'border-sky-500/50 bg-sky-500/10'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                          <span className="font-mono truncate" style={{ color: 'var(--text)' }}>
                            {file.path}
                          </span>
                        </div>
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-semibold shrink-0 ml-2 ${badgeColor}`}
                        >
                          {file.type}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Diff Preview Section */}
            {selectedFile && (
              <div
                className="flex-1 flex flex-col min-h-0 border-b"
                style={{ borderColor: 'var(--border)' }}
              >
                <div
                  className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] shrink-0"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--muted)'
                  }}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono flex items-center gap-1.5">
                      <FileDiff className="w-3.5 h-3.5 text-sky-500" />
                      Diff : <strong style={{ color: 'var(--strong)' }}>{selectedFile}</strong>
                    </span>
                    {isDiffStaged ? (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold">
                        {t('git_diff_staged', 'Staged')}
                      </span>
                    ) : (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-600 dark:text-slate-400">
                        {t('git_diff_unstaged', 'Unstaged')}
                      </span>
                    )}
                    {allChangedFiles.find((f) => f.path === selectedFile)?.type === 'S+M' && (
                      <div className="flex items-center gap-1 ml-1.5">
                        <button
                          type="button"
                          onClick={() => handleSelectFile(selectedFile, false)}
                          className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer ${!isDiffStaged ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`}
                        >
                          {t('git_diff_unstaged', 'Unstaged')}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSelectFile(selectedFile, true)}
                          className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer ${isDiffStaged ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`}
                        >
                          {t('git_diff_staged', 'Staged')}
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {onOpenMonacoStudio && selectedFile && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenMonacoStudio({
                            mode: 'diff',
                            filePath: selectedFile,
                            diffText: activeDiff || undefined,
                          })
                        }
                        className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 border border-emerald-500/30 transition-colors cursor-pointer"
                        title={t('open_in_monaco_diff_tooltip', 'Ouvrir dans le studio de diff sémantique Monaco')}
                      >
                        <Code2 className="w-3 h-3" />
                        <span>{t('monaco_studio', 'Monaco Studio')}</span>
                      </button>
                    )}
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="text-[10px] hover:underline cursor-pointer"
                      style={{ color: 'var(--muted)' }}
                    >
                      {t('git_close_diff', 'Close diff')}
                    </button>
                  </div>
                </div>
                <div
                  className="flex-1 overflow-auto p-2"
                  style={{ backgroundColor: 'var(--code-bg)' }}
                >
                  {loadingDiff ? (
                    <div className="p-4 text-center text-xs" style={{ color: 'var(--muted)' }}>{t('git_loading_diff', 'Loading diff...')}</div>
                  ) : activeDiff ? (
                    <DiffViewer diffText={activeDiff} filename={selectedFile} />
                  ) : (
                    <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>
                      {t('git_no_diff', 'No textual diff available for this file.')}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Last Commit Info */}
            {status?.last_commit && (
              <div
                className="p-3 border-b text-xs shrink-0"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)'
                }}
              >
                <div
                  className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1"
                  style={{ color: 'var(--muted)' }}
                >
                  <Clock className="w-3 h-3" />
                  {t('git_last_commit', 'Last commit')} ({status.last_commit.time})
                </div>
                <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text)' }}>
                  <span className="text-sky-500 font-bold mr-2">{status.last_commit.hash}</span>
                  {status.last_commit.subject}
                </div>
              </div>
            )}
          </div>

          {/* Bottom Commit & Push Toolbar */}
          <div
            className="p-3 border-t shrink-0 space-y-2.5"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            <form onSubmit={handleCommit} className="space-y-2">
              <input
                type="text"
                value={commitMessage}
                onChange={(e) => setCommitMessage(e.target.value)}
                placeholder={t('git_commit_placeholder', 'Commit message (e.g. Add feature X)...')}
                disabled={committing || allChangedFiles.length === 0}
                className="w-full px-3 py-2 border rounded-xl text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              />

              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: 'var(--muted)' }}>
                  <input
                    type="checkbox"
                    checked={stageAll}
                    onChange={(e) => setStageAll(e.target.checked)}
                    className="rounded border-slate-400 dark:border-slate-700 text-sky-500 focus:ring-0"
                  />
                  <span>{t('git_stage_all', 'Stage all files (`git add -A`)')}</span>
                </label>

                <button
                  type="submit"
                  disabled={committing || !commitMessage.trim() || allChangedFiles.length === 0}
                  className="py-1.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-md shadow-sky-500/20"
                >
                  <GitCommit className="w-3.5 h-3.5" />
                  <span>{committing ? t('committing', 'Committing...') : t('commit', 'Commit')}</span>
                </button>
              </div>
            </form>

            <div
              className="pt-2 border-t flex items-center justify-between"
              style={{ borderColor: 'var(--border)' }}
            >
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {t('git_author', 'Author:')} <code style={{ color: 'var(--strong)' }}>jprud67 &lt;jprud67@gmail.com&gt;</code>
              </span>

              <div className="flex items-center gap-2">
                <button
                  onClick={handlePull}
                  disabled={pulling || committing}
                  className="py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                  title={t('git_pull_title', 'Pull commits from remote repository (git pull)')}
                >
                  <DownloadCloud className={`w-3.5 h-3.5 ${pulling ? 'animate-bounce text-sky-500' : ''}`} />
                  <span>{pulling ? t('pulling', 'Pulling...') : t('git_pull', 'Pull')}</span>
                </button>

                <button
                  onClick={handlePush}
                  disabled={pushing || committing}
                  className="py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                  title={t('git_push_title', 'Push commits to remote repository (git push)')}
                >
                  <UploadCloud className={`w-3.5 h-3.5 ${pushing ? 'animate-bounce text-sky-500' : ''}`} />
                  <span>{pushing ? t('pushing', 'Pushing...') : t('git_push', 'Push')}</span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* VIEW MODE 2: VISUAL COMMIT HISTORY & GRAPH */}
      {viewMode === 'history' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Commit Search & Controls */}
          <div 
            className="p-2.5 border-b flex items-center gap-2 shrink-0"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={commitSearch}
                onChange={(e) => setCommitSearch(e.target.value)}
                placeholder={t('git_search_commits', 'Filtrer les commits (message, auteur, SHA)...')}
                className="w-full pl-8 pr-7 py-1.5 rounded-lg border text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                style={{
                  backgroundColor: 'var(--bg)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              />
              {commitSearch && (
                <button
                  type="button"
                  onClick={() => setCommitSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => { void loadHistory(false); }}
              disabled={loadingCommits}
              className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-xs"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title={t('refresh', 'Actualiser l\'historique')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingCommits ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Timeline & Detail Split */}
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            {/* Left Column: Visual Commit Timeline */}
            <div 
              className="w-full md:w-5/12 border-b md:border-b-0 md:border-r overflow-y-auto flex flex-col shrink-0"
              style={{ borderColor: 'var(--border)' }}
            >
              <div 
                className="px-3 py-1.5 text-[10px] uppercase font-semibold tracking-wider flex items-center justify-between border-b shrink-0"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)'
                }}
              >
                <span className="flex items-center gap-1.5">
                  <History className="w-3 h-3 text-sky-500" />
                  {t('git_commits_timeline', 'Timeline des Commits')} ({filteredCommits.length})
                </span>
                <span className="font-mono text-[9px]">{status?.branch || 'main'}</span>
              </div>

              {loadingCommits && commits.length === 0 ? (
                <div className="p-8 text-center text-xs flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
                  <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                  <span>{t('git_loading_history', 'Chargement de l\'historique Git...')}</span>
                </div>
              ) : filteredCommits.length === 0 ? (
                <div className="p-8 text-center text-xs italic" style={{ color: 'var(--muted)' }}>
                  {commitSearch ? t('git_no_matching_commits', 'Aucun commit ne correspond à la recherche.') : t('git_no_commits', 'Aucun commit enregistré.')}
                </div>
              ) : (
                <div className="p-2 space-y-1">
                  {filteredCommits.map((c, idx) => {
                    const isSelected = selectedCommit?.hash === c.hash;
                    const isHead = idx === 0 && !commitSearch.trim();

                    return (
                      <div
                        key={c.hash}
                        onClick={() => handleSelectCommit(c)}
                        className={`group relative pl-6 pr-2 py-2 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-sky-500/10 border-sky-500/40 shadow-sm'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                      >
                        {/* Visual Timeline Rail & Node */}
                        <div 
                          className="absolute left-2.5 top-0 bottom-0 w-0.5"
                          style={{
                            backgroundColor: idx === filteredCommits.length - 1 ? 'transparent' : 'var(--border)'
                          }}
                        />
                        <div 
                          className={`absolute left-1.5 top-3 w-2.5 h-2.5 rounded-full border-2 transition-all ${
                            isSelected 
                              ? 'bg-sky-500 border-white dark:border-slate-900 ring-2 ring-sky-500/30' 
                              : isHead 
                              ? 'bg-emerald-500 border-white dark:border-slate-900' 
                              : 'bg-slate-400 border-white dark:border-slate-900 group-hover:bg-sky-400'
                          }`}
                        />

                        {/* Commit Card Content */}
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-1">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span 
                                onClick={(e) => handleCopyHash(c.hash, e)}
                                title={t('click_copy_sha', 'Cliquer pour copier le SHA')}
                                className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-500/15 hover:bg-slate-500/25 text-sky-400 font-semibold flex items-center gap-1 shrink-0"
                              >
                                {copiedHash === c.hash ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : null}
                                <span>{c.short_hash}</span>
                              </span>
                              {isHead && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  HEAD
                                </span>
                              )}
                            </div>
                            <span className="text-[10px] whitespace-nowrap" style={{ color: 'var(--muted)' }}>
                              {formatCommitTime(c.timestamp)}
                            </span>
                          </div>

                          <div 
                            className="font-medium truncate text-[11px]" 
                            style={{ color: isSelected ? 'var(--strong)' : 'var(--text)' }}
                            title={c.subject}
                          >
                            {c.subject}
                          </div>

                          <div className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                            <User className="w-2.5 h-2.5 opacity-60" />
                            <span className="truncate">{c.author}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Column: Commit Inspector & Full Diff */}
            <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
              {selectedCommit ? (
                <>
                  {/* Selected Commit Header */}
                  <div 
                    className="p-3 border-b shrink-0 space-y-1.5"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)'
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-0.5 min-w-0">
                        <h4 className="text-xs font-semibold" style={{ color: 'var(--strong)' }}>
                          {selectedCommit.subject}
                        </h4>
                        <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--muted)' }}>
                          <span>{t('by', 'Par')} <strong style={{ color: 'var(--text)' }}>{selectedCommit.author}</strong> &lt;{selectedCommit.email}&gt;</span>
                          <span>•</span>
                          <span>{formatCommitTime(selectedCommit.timestamp)}</span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleCopyHash(selectedCommit.hash)}
                        className="px-2 py-1 rounded-md border text-[10px] font-mono flex items-center gap-1 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                          color: 'var(--text)'
                        }}
                        title={t('copy_full_commit_hash', 'Copier le hash complet du commit')}
                      >
                        {copiedHash === selectedCommit.hash ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>{t('copied', 'Copié')}</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3 text-slate-400" />
                            <span>{selectedCommit.short_hash}</span>
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCherryPick(selectedCommit)}
                        className="px-2 py-1 rounded-md border text-[10px] font-semibold flex items-center gap-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/30 transition-colors cursor-pointer shrink-0"
                        title={t('cherry_pick_tooltip', 'Appliquer ce commit sur la branche courante (git cherry-pick)')}
                      >
                        <GitMerge className="w-3 h-3 text-amber-400" />
                        <span>Cherry-pick</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenRebase(selectedCommit.hash)}
                        className="px-2 py-1 rounded-md border text-[10px] font-semibold flex items-center gap-1 bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border-sky-500/30 transition-colors cursor-pointer shrink-0"
                        title={t('start_rebase_tooltip', 'Démarrer un rebase interactif depuis ce commit (git rebase -i)')}
                      >
                        <RotateCcw className="w-3 h-3 text-sky-400" />
                        <span>{t('rebase', 'Rebase')}</span>
                      </button>
                      {onOpenMonacoStudio && commitDiff && (
                        <button
                          type="button"
                          onClick={() =>
                            onOpenMonacoStudio({
                              mode: 'diff',
                              title: `Commit ${selectedCommit.short_hash}`,
                              diffText: commitDiff,
                            })
                          }
                          className="px-2 py-1 rounded-md border text-[10px] font-medium flex items-center gap-1 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/25 transition-colors cursor-pointer shrink-0"
                          title={t('inspect_patch_tooltip', 'Inspecter le patch dans Monaco Studio')}
                        >
                          <Code2 className="w-3 h-3" />
                          <span>{t('monaco_studio', 'Monaco Studio')}</span>
                        </button>
                      )}
                    </div>

                    {selectedCommit.body && (
                      <div 
                        className="p-2 rounded-lg text-[11px] font-mono whitespace-pre-wrap max-h-24 overflow-y-auto border"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                          color: 'var(--text)'
                        }}
                      >
                        {selectedCommit.body}
                      </div>
                    )}
                  </div>

                  {/* Diff Viewer for the Commit */}
                  <div 
                    className="flex-1 overflow-auto p-2"
                    style={{ backgroundColor: 'var(--code-bg)' }}
                  >
                    {loadingCommitDiff ? (
                      <div className="p-8 text-center text-xs flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
                        <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                        <span>{t('git_loading_diff', 'Chargement du patch complet du commit...')}</span>
                      </div>
                    ) : commitDiff ? (
                      <DiffViewer diffText={commitDiff} filename={`Commit ${selectedCommit.short_hash}`} />
                    ) : (
                      <div className="p-8 text-center text-xs italic" style={{ color: 'var(--muted)' }}>
                        {t('git_no_diff', 'Aucune modification de fichier textuel dans ce commit.')}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-slate-400 text-xs space-y-2">
                  <GitCommit className="w-8 h-8 opacity-40" />
                  <p>{t('git_select_commit_prompt', 'Sélectionnez un commit dans la liste pour inspecter son diff complet.')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* VIEW MODE 3: STASH MANAGER */}
      {viewMode === 'stashes' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Stash Header Action Bar */}
          <div className="flex items-center justify-between gap-2 p-2 rounded-xl bg-black/10 dark:bg-white/5 border" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-2 text-xs">
              <Archive className="w-4 h-4 text-purple-400" />
              <span className="font-semibold text-slate-200">{t('stash_stack', 'Stash Stack')}</span>
              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-purple-500/20 text-purple-300 font-mono">
                {stashes.length}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setIsCreateStashOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer shadow-xs"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('git_new_stash', 'Nouveau Stash')}</span>
              </button>

              {stashes.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAllStashes}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 text-xs cursor-pointer"
                  title={t('git_clear_all_stashes_tooltip', 'Supprimer tous les stashes (`git stash clear`)')}
                >
                  <Trash2 className="w-3 h-3" />
                  <span>{t('clear_all', 'Tout vider')}</span>
                </button>
              )}
            </div>
          </div>

          {/* Create Stash Inline Card */}
          {isCreateStashOpen && (
            <div className="p-3 rounded-xl border border-sky-500/30 bg-sky-500/5 space-y-2.5 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-semibold text-sky-400">
                <span>{t('git_create_new_stash', 'Créer un nouveau stash')}</span>
                <button type="button" onClick={() => setIsCreateStashOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <input
                type="text"
                value={newStashMessage}
                onChange={(e) => setNewStashMessage(e.target.value)}
                placeholder={t('stash_message_placeholder', 'Message du stash (optionnel)...')}
                className="w-full px-3 py-1.5 border rounded-lg text-xs outline-none bg-black/20 focus:border-sky-500 text-slate-100"
                style={{ borderColor: 'var(--border)' }}
              />
              <div className="flex items-center justify-between text-xs">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-[11px]">
                  <input
                    type="checkbox"
                    checked={newStashUntracked}
                    onChange={(e) => setNewStashUntracked(e.target.checked)}
                    className="rounded text-sky-500"
                  />
                  <span>{t('git_include_untracked', 'Inclure les fichiers non suivis (-u)')}</span>
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateStashOpen(false)}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200"
                  >
                    {t('cancel', 'Annuler')}
                  </button>
                  <button
                    type="button"
                    disabled={savingStash}
                    onClick={handleCreateStash}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {savingStash ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    <span>{t('git_save_stash', 'Enregistrer le Stash')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Stash List */}
          {loadingStashes && stashes.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
              <span>{t('git_loading_stashes', 'Chargement des stashes...')}</span>
            </div>
          ) : stashes.length === 0 ? (
            <div className="p-8 text-center text-xs italic text-slate-500 space-y-1">
              <Archive className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p>{t('git_no_stashes_in_stack', 'Aucun stash dans la pile.')}</p>
              <p className="text-[11px] text-slate-600">{t('git_use_new_stash_hint', 'Utilisez « Nouveau Stash » pour remiser vos modifications courantes.')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stashes.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-xl border bg-black/10 dark:bg-white/5 space-y-2 hover:border-purple-500/40 transition-colors"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30 shrink-0">
                        {s.id}
                      </span>
                      <span className="font-mono text-[10px] text-slate-400">{s.hash}</span>
                      <span className="text-[11px] text-slate-400">• {s.relative_time}</span>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handlePreviewStashDiff(s)}
                        className="px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                        title={t('git_view_stash_diff_tooltip', 'Voir le diff complet du stash')}
                      >
                        <FileDiff className="w-3 h-3" />
                        <span>{t('diff', 'Diff')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleApplyStash(s.index)}
                        className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                        title={t('git_stash_apply_tooltip', 'Appliquer les modifications sans supprimer le stash (git stash apply)')}
                      >
                        <Layers className="w-3 h-3" />
                        <span>{t('apply', 'Appliquer')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePopStash(s.index)}
                        className="px-2 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                        title={t('git_stash_pop_tooltip', 'Appliquer et dépiler le stash (git stash pop)')}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                        <span>{t('git_stash_pop', 'Dépiler')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDropStash(s.index)}
                        className="p-1 rounded text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                        title={t('git_stash_drop_tooltip', 'Supprimer ce stash (`git stash drop`)')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <p className="text-xs text-slate-200 font-medium break-all">
                    {s.message}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* VIEW MODE 4: BRANCH MANAGER */}
      {viewMode === 'branches' && (
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto p-3 space-y-3">
          {/* Active Branch Telemetry Card */}
          {activeBranchDetail && (
            <div
              className="p-3.5 rounded-xl border bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent space-y-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 rounded-lg bg-sky-500/20 text-sky-400">
                    <GitBranch className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-sky-400 truncate">
                        {activeBranchDetail.name}
                      </span>
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                        Active
                      </span>
                      {activeBranchDetail.upstream && (
                        <span className="text-[10px] font-mono opacity-70" style={{ color: 'var(--muted)' }}>
                          → {activeBranchDetail.upstream}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {activeBranchDetail.ahead > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      ↑ {activeBranchDetail.ahead} en avance
                    </span>
                  )}
                  {activeBranchDetail.behind > 0 && (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-rose-500/15 text-rose-400 border border-rose-500/30">
                      ↓ {activeBranchDetail.behind} en retard
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleOpenRebase('HEAD~5')}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer shadow-xs transition-colors"
                    title={t('git_interactive_rebase_tooltip', 'Lancer un rebase interactif sur les derniers commits')}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{t('git_interactive_rebase', 'Rebase Interactif')}</span>
                  </button>
                </div>
              </div>

              {activeBranchDetail.last_commit_subject && (
                <div className="text-[11px] truncate flex items-center gap-1.5 pt-1 border-t border-black/5 dark:border-white/5" style={{ color: 'var(--muted)' }}>
                  <span className="font-mono text-sky-400 shrink-0">{activeBranchDetail.last_commit_sha}</span>
                  <span className="truncate">{activeBranchDetail.last_commit_subject}</span>
                </div>
              )}
            </div>
          )}

          {/* Action Bar: Search, Filters, New Branch */}
          <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-xl bg-black/10 dark:bg-white/5 border" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
              <Search className="w-3.5 h-3.5 opacity-50 shrink-0" />
              <input
                type="text"
                value={branchSearch}
                onChange={(e) => setBranchSearch(e.target.value)}
                placeholder={t('git_filter_branches_placeholder', 'Filtrer les branches...')}
                className="w-full bg-transparent text-xs outline-none"
                style={{ color: 'var(--text)' }}
              />
              {branchSearch && (
                <button type="button" onClick={() => setBranchSearch('')} className="text-slate-400 hover:text-white p-0.5">
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {/* Filter tabs */}
              <div className="flex items-center p-0.5 rounded-lg border text-[11px]" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                <button
                  type="button"
                  onClick={() => setBranchFilter('all')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                    branchFilter === 'all' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  Toutes ({branches.length})
                </button>
                <button
                  type="button"
                  onClick={() => setBranchFilter('local')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                    branchFilter === 'local' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  Locales ({localBranchesCount})
                </button>
                <button
                  type="button"
                  onClick={() => setBranchFilter('remote')}
                  className={`px-2 py-0.5 rounded font-medium transition-colors cursor-pointer ${
                    branchFilter === 'remote' ? 'bg-sky-500/20 text-sky-400 font-semibold' : 'opacity-60 hover:opacity-100'
                  }`}
                >
                  Distantes ({remoteBranchesCount})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsCreateBranchOpen(true)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-medium cursor-pointer shadow-xs transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t('git_new_branch', 'Nouvelle branche')}</span>
              </button>
            </div>
          </div>

          {/* Create Branch Card / Modal Form */}
          {isCreateBranchOpen && (
            <div className="p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/5 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between text-xs font-semibold text-sky-400">
                <span>{t('git_create_new_branch', 'Créer une nouvelle branche')}</span>
                <button type="button" onClick={() => setIsCreateBranchOpen(false)} className="text-slate-400 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Nom de la branche *
                  </label>
                  <input
                    type="text"
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder="ex: feature/mon-module"
                    className="w-full px-3 py-1.5 border rounded-lg text-xs outline-none bg-black/20 focus:border-sky-500 text-slate-100 font-mono"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--muted)' }}>
                    Point de départ (optionnel)
                  </label>
                  <input
                    type="text"
                    value={newBranchStartPoint}
                    onChange={(e) => setNewBranchStartPoint(e.target.value)}
                    placeholder={t('git_start_point_placeholder', 'ex: main, HEAD, or sha (default: current)')}
                    className="w-full px-3 py-1.5 border rounded-lg text-xs outline-none bg-black/20 focus:border-sky-500 text-slate-100 font-mono"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between text-xs pt-1">
                <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-[11px]">
                  <input
                    type="checkbox"
                    checked={newBranchCheckout}
                    onChange={(e) => setNewBranchCheckout(e.target.checked)}
                    className="rounded text-sky-500"
                  />
                  <span>{t('git_switch_branch_immediately', 'Basculer immédiatement sur cette branche (-b)')}</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsCreateBranchOpen(false)}
                    className="px-2.5 py-1 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    {t('cancel', 'Annuler')}
                  </button>
                  <button
                    type="button"
                    disabled={creatingBranch || !newBranchName.trim()}
                    onClick={handleCreateBranch}
                    className="flex items-center gap-1 px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                  >
                    {creatingBranch ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{t('git_create_branch', 'Créer la branche')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Branch List */}
          {loadingBranches && branches.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
              <span>{t('git_loading_branches', 'Chargement des branches...')}</span>
            </div>
          ) : filteredBranches.length === 0 ? (
            <div className="p-8 text-center text-xs italic text-slate-500 space-y-1">
              <GitBranch className="w-8 h-8 mx-auto text-slate-600 mb-2" />
              <p>{t('git_no_branches_found', 'Aucune branche trouvée.')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredBranches.map((b) => {
                const isCurrent = b.is_current;
                const isProtected = ['main', 'master'].includes(b.name.toLowerCase());

                return (
                  <div
                    key={b.name}
                    className={`p-3 rounded-xl border bg-black/10 dark:bg-white/5 space-y-2 transition-all ${
                      isCurrent
                        ? 'border-sky-500/40 bg-sky-500/5 ring-1 ring-sky-500/20'
                        : 'hover:border-slate-500/40'
                    }`}
                    style={{ borderColor: isCurrent ? undefined : 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {b.is_remote ? (
                          <Globe className="w-4 h-4 text-purple-400 shrink-0" />
                        ) : (
                          <GitBranch className={`w-4 h-4 shrink-0 ${isCurrent ? 'text-sky-400' : 'text-slate-400'}`} />
                        )}
                        <span className="font-mono text-xs font-semibold truncate" style={{ color: isCurrent ? 'var(--strong)' : 'var(--text)' }}>
                          {b.name}
                        </span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                            Courante
                          </span>
                        )}
                        {b.is_remote && (
                          <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono shrink-0">
                            remote
                          </span>
                        )}
                        {b.upstream && (
                          <span className="text-[10px] font-mono text-slate-400 truncate hidden sm:inline">
                            [{b.upstream}]
                          </span>
                        )}
                        {b.ahead > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-sky-500/20 text-sky-400 shrink-0">
                            ↑{b.ahead}
                          </span>
                        )}
                        {b.behind > 0 && (
                          <span className="px-1.5 py-0.5 rounded-full text-[9px] bg-rose-500/20 text-rose-400 shrink-0">
                            ↓{b.behind}
                          </span>
                        )}
                      </div>

                      {/* Branch Actions */}
                      <div className="flex items-center gap-1 shrink-0">
                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleCheckoutBranch(b.name)}
                            className="px-2 py-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                            title={t('git_checkout_tooltip', 'Basculer sur cette branche (git checkout)')}
                          >
                            <ArrowRight className="w-3 h-3" />
                            <span>{t('git_checkout', 'Bascule')}</span>
                          </button>
                        )}

                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => {
                              setMergingBranch(b);
                              setMergeMessage(`Merge branch '${b.name}' into ${status?.branch || 'main'}`);
                            }}
                            className="px-2 py-1 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                            title={t('git_merge_tooltip', 'Fusionner cette branche dans la branche active (git merge)')}
                          >
                            <GitMerge className="w-3 h-3" />
                            <span>{t('git_merge', 'Fusionner')}</span>
                          </button>
                        )}

                        {!b.is_remote && (
                          <button
                            type="button"
                            onClick={() => handleOpenRebase(b.name)}
                            className="px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[11px] font-medium flex items-center gap-1 cursor-pointer transition-colors"
                            title={t('git_rebase_branch_tooltip', 'Rebase interactif sur la base de cette branche')}
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>{t('rebase', 'Rebase')}</span>
                          </button>
                        )}

                        {!b.is_remote && (
                          <button
                            type="button"
                            onClick={() => {
                              setRenamingBranch(b);
                              setNewRenameName(b.name);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 transition-colors cursor-pointer"
                            title={`${t('git_rename_branch', 'Renommer la branche')} (git branch -m)`}
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {!isCurrent && (
                          <button
                            type="button"
                            onClick={() => handleDeleteBranch(b)}
                            disabled={isProtected}
                            className={`p-1 rounded transition-colors cursor-pointer ${
                              isProtected
                                ? 'text-slate-600 cursor-not-allowed'
                                : 'text-slate-400 hover:text-rose-400 hover:bg-rose-500/10'
                            }`}
                            title={isProtected ? 'Branche protégée' : 'Supprimer cette branche'}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {b.last_commit_subject && (
                      <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1 border-t border-black/5 dark:border-white/5">
                        <span className="truncate pr-2">{b.last_commit_subject}</span>
                        {b.last_commit_sha && (
                          <span className="font-mono text-sky-400 shrink-0 text-[10px]">
                            {b.last_commit_sha}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Merge Branch Inline Modal */}
          {mergingBranch && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div
                className="w-full max-w-md p-4 rounded-2xl border shadow-2xl space-y-3"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-400">
                    <GitMerge className="w-4 h-4" />
                    <span>{t('git_merge_branch', 'Fusionner la branche')}</span>
                  </div>
                  <button type="button" onClick={() => setMergingBranch(null)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-xs text-slate-300">
                  Fusion de <strong className="text-emerald-400 font-mono">{mergingBranch.name}</strong> {t('git_into_current_branch', 'dans la branche courante')} <strong className="text-sky-400 font-mono">{status?.branch}</strong>.
                </p>

                <div className="space-y-2 text-xs">
                  <label className="block text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                    {t('merge_commit_message_label', 'Message de commit de fusion')}
                  </label>
                  <input
                    type="text"
                    value={mergeMessage}
                    onChange={(e) => setMergeMessage(e.target.value)}
                    placeholder={t('merge_message_placeholder', 'Message de merge...')}
                    className="w-full px-3 py-1.5 border rounded-lg text-xs outline-none bg-black/20 focus:border-emerald-500 text-slate-100 font-mono"
                    style={{ borderColor: 'var(--border)' }}
                  />

                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 text-[11px] pt-1">
                    <input
                      type="checkbox"
                      checked={mergeNoFF}
                      onChange={(e) => setMergeNoFF(e.target.checked)}
                      className="rounded text-emerald-500"
                    />
                    <span>{t('force_merge_commit_noff', 'Forcer un commit de fusion (--no-ff)')}</span>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setMergingBranch(null)}
                    disabled={merging}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleMergeBranch}
                    disabled={merging}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer shadow-md"
                  >
                    {merging ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <GitMerge className="w-3.5 h-3.5" />}
                    <span>{t('git_confirm_merge', 'Confirmer la fusion')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Rename Branch Inline Modal */}
          {renamingBranch && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
              <div
                className="w-full max-w-md p-4 rounded-2xl border shadow-2xl space-y-3"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-xs font-semibold text-sky-400">
                    <Edit3 className="w-4 h-4" />
                    <span>{t('git_rename_branch', 'Renommer la branche')}</span>
                  </div>
                  <button type="button" onClick={() => setRenamingBranch(null)} className="text-slate-400 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1 text-xs">
                  <label className="block text-[11px] font-medium" style={{ color: 'var(--muted)' }}>
                    Nouveau nom pour &apos;{renamingBranch.name}&apos;
                  </label>
                  <input
                    type="text"
                    value={newRenameName}
                    onChange={(e) => setNewRenameName(e.target.value)}
                    placeholder={t('git_new_name_placeholder', 'Nouveau nom...')}
                    className="w-full px-3 py-1.5 border rounded-lg text-xs outline-none bg-black/20 focus:border-sky-500 text-slate-100 font-mono"
                    style={{ borderColor: 'var(--border)' }}
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setRenamingBranch(null)}
                    disabled={renaming}
                    className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                  >
                    Annuler
                  </button>
                  <button
                    type="button"
                    onClick={handleRenameBranch}
                    disabled={renaming || !newRenameName.trim() || newRenameName.trim() === renamingBranch.name}
                    className="flex items-center gap-1 px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold cursor-pointer shadow-md disabled:opacity-50"
                  >
                    {renaming ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>{t('rename', 'Renommer')}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Git Remotes Studio View */}
      {viewMode === 'remotes' && (
        <div className="flex-1 overflow-hidden">
          <GitRemotesView
            workspace={currentWorkspace}
            currentBranch={status?.branch || 'main'}
            onNotify={(msg, type) => showToast(msg, type)}
          />
        </div>
      )}

      {/* Git Tags & Releases Studio View */}
      {viewMode === 'tags' && (
        <div className="flex-1 overflow-hidden">
          <GitTagsView
            workspace={currentWorkspace}
            onOpenReleaseModal={(tag) => {
              setReleaseModalTag(tag);
              setIsReleaseModalOpen(true);
            }}
            onNotify={(msg, type) => showToast(msg, type)}
          />
        </div>
      )}

      {/* Git Rebase Studio Modal */}
      <GitRebaseModal
        key={`rebase-${rebaseBaseRef}-${isRebaseModalOpen}`}
        isOpen={isRebaseModalOpen}
        onClose={() => setIsRebaseModalOpen(false)}
        workspace={currentWorkspace}
        initialBaseRef={rebaseBaseRef}
        onRebaseCompleted={() => {
          void loadStatus();
          void loadBranches();
          void loadRebaseStatus();
          if (commits.length > 0) {
            void loadHistory(true);
          }
        }}
        onRebaseConflict={() => {
          void loadStatus();
          void loadRebaseStatus();
        }}
      />

      {/* Git Conflict Modal */}
      {activeConflictFile && (
        <GitConflictModal
          isOpen={true}
          filePath={activeConflictFile}
          workspace={currentWorkspace}
          onClose={() => setActiveConflictFile(null)}
          onResolved={() => {
            setActiveConflictFile(null);
            void loadStatus();
          }}
        />
      )}

      {/* Git Release Publisher Modal */}
      <GitReleaseModal
        isOpen={isReleaseModalOpen}
        onClose={() => {
          setIsReleaseModalOpen(false);
          setReleaseModalTag(null);
        }}
        tag={releaseModalTag}
        workspace={currentWorkspace}
        onReleasePublished={() => {
          void loadStatus();
        }}
        onNotify={(msg, type) => showToast(msg, type)}
      />
    </div>
  );
};
