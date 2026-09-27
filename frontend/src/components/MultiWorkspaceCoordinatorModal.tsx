import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Boxes,
  Play,
  Square,
  RefreshCw,
  GitBranch,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Terminal,
  Layers,
  Sparkles,
  ChevronRight,
  FolderGit2,
  Wrench,
  ArrowDownCircle,
  Download
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import {
  fetchCoordinatorOverview,
  fetchWorkspacePipelines,
  runCoordinatorPipeline,
  fetchPipelineRunDetails,
  cancelCoordinatorPipeline,
  triggerCoordinatorRemediation,
  triggerCoordinatorBatch
} from '../services/api';
import { showToast } from '../services/toast';
import type {
  MultiWorkspaceOverview,
  WorkspacePipeline,
  PipelineExecutionRun,
  BatchCoordinatorAction,
  CoordinatorBatchResult
} from '../types';

interface MultiWorkspaceCoordinatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeWorkspace: string;
  onSwitchWorkspace?: (wsPath: string) => void;
  onInjectPrompt?: (prompt: string) => void;
}

export const MultiWorkspaceCoordinatorModal: React.FC<MultiWorkspaceCoordinatorModalProps> = ({
  isOpen,
  onClose,
  activeWorkspace,
  onSwitchWorkspace,
  onInjectPrompt
}) => {
  const { t } = useI18n();

  const [activeTab, setActiveTab] = useState<'overview' | 'pipelines' | 'logs'>('overview');
  const [overview, setOverview] = useState<MultiWorkspaceOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedWs, setSelectedWs] = useState<string>(activeWorkspace);
  const [pipelines, setPipelines] = useState<WorkspacePipeline[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(false);

  // Active / selected execution run
  const [activeRun, setActiveRun] = useState<PipelineExecutionRun | null>(null);
  const [batchActionInProgress, setBatchActionInProgress] = useState<string | null>(null);
  const [remediating, setRemediating] = useState(false);
  const logTerminalRef = useRef<HTMLDivElement>(null);

  // Load Overview Data
  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchCoordinatorOverview(selectedWs || activeWorkspace);
      setOverview(data);
      if (!selectedWs && data.active_workspace_path) {
        setSelectedWs(data.active_workspace_path);
      }
    } catch {
      showToast(t('coordinator_load_failed', 'Échec du chargement de la synthèse workspaces'), 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedWs, activeWorkspace, t]);

  // Load Pipelines for selected workspace
  const loadPipelines = useCallback(async (wsPath: string) => {
    if (!wsPath) return;
    setLoadingPipelines(true);
    try {
      const res = await fetchWorkspacePipelines(wsPath);
      setPipelines(res);
    } catch {
      showToast(t('coordinator_pipelines_failed', 'Impossible de détecter les pipelines'), 'error');
    } finally {
      setLoadingPipelines(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        loadOverview();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadOverview]);

  useEffect(() => {
    if (isOpen && selectedWs) {
      const timer = setTimeout(() => {
        loadPipelines(selectedWs);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, selectedWs, loadPipelines]);

  // Poll active run details while running
  useEffect(() => {
    if (!activeRun || activeRun.status !== 'running') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const details = await fetchPipelineRunDetails(activeRun.run_id);
        setActiveRun(details);
        if (details.status !== 'running') {
          loadPipelines(details.workspace_path);
          loadOverview();
        }
      } catch {
        // ignore polling network errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [activeRun, loadPipelines, loadOverview]);

  // Auto-scroll log terminal
  useEffect(() => {
    if (logTerminalRef.current && activeTab === 'logs') {
      logTerminalRef.current.scrollTop = logTerminalRef.current.scrollHeight;
    }
  }, [activeRun, activeTab]);

  // Keyboard shortcut listener (Escape to close)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Actions
  const handleStartPipeline = async (pipelineId: string) => {
    if (!selectedWs) return;
    try {
      const run = await runCoordinatorPipeline(selectedWs, pipelineId);
      setActiveRun(run);
      setActiveTab('logs');
      showToast(t('coordinator_pipeline_started', 'Pipeline lancé avec succès'), 'success');
      loadOverview();
    } catch (err: any) {
      showToast(err.message || t('coordinator_pipeline_run_failed', 'Échec du lancement'), 'error');
    }
  };

  const handleCancelPipeline = async () => {
    if (!activeRun) return;
    try {
      await cancelCoordinatorPipeline(activeRun.run_id);
      showToast(t('coordinator_cancelled', 'Pipeline interrompu'), 'info');
      const details = await fetchPipelineRunDetails(activeRun.run_id);
      setActiveRun(details);
      loadOverview();
    } catch (err: any) {
      showToast(err.message || t('coordinator_cancel_failed', 'Erreur d\'interruption'), 'error');
    }
  };

  const handleBatchAction = async (action: BatchCoordinatorAction) => {
    setBatchActionInProgress(action);
    try {
      const res: CoordinatorBatchResult = await triggerCoordinatorBatch(action);
      showToast(
        t('coordinator_batch_success', 'Action par lot exécutée sur {0} projets').replace(
          '{0}',
          String(res.processed_count)
        ),
        'success'
      );
      loadOverview();
    } catch (err: any) {
      showToast(err.message || t('coordinator_batch_failed', 'Erreur lors de l\'action par lot'), 'error');
    } finally {
      setBatchActionInProgress(null);
    }
  };

  const handleBuildRemediation = async () => {
    if (!activeRun) return;
    const failedStep = activeRun.steps.find((s) => s.status === 'failed');
    if (!failedStep) return;

    setRemediating(true);
    try {
      const context = await triggerCoordinatorRemediation({
        workspace_path: activeRun.workspace_path,
        run_id: activeRun.run_id,
        failed_step_id: failedStep.id,
        step_command: failedStep.command,
        step_output: failedStep.output_preview
      });

      if (onInjectPrompt) {
        onInjectPrompt(context.remediation_prompt);
        onClose();
        showToast(t('coordinator_remediation_injected', 'Diagnostic et consigne de remédiation injectés dans le chat'), 'success');
      }
    } catch (err: any) {
      showToast(err.message || t('coordinator_remediation_failed', 'Erreur de remédiation'), 'error');
    } finally {
      setRemediating(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="coordinator-modal-title"
    >
      <div className="relative w-full max-w-6xl h-[88vh] flex flex-col bg-[var(--bg-panel,#18181b)] border border-[var(--border,#27272a)] rounded-2xl shadow-2xl overflow-hidden text-[var(--fg-primary,#fafafa)]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/50 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 shadow-inner">
              <Boxes className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="coordinator-modal-title" className="text-lg font-bold text-[var(--fg-primary,#fafafa)]">
                  {t('coordinator_title', 'Multi-Workspace Coordinator & Pipeline Studio')}
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-mono font-medium border border-indigo-500/30">
                  Ctrl+Alt+M
                </span>
              </div>
              <p className="text-xs text-[var(--fg-muted,#a1a1aa)]">
                {t('coordinator_subtitle', 'Orchestration multi-projets, détection automatique CI/CD et remédiation autonome')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                loadOverview();
                if (selectedWs) loadPipelines(selectedWs);
              }}
              disabled={loading || loadingPipelines}
              className="p-2 text-[var(--fg-muted,#a1a1aa)] hover:text-[var(--fg-primary,#fafafa)] hover:bg-[var(--bg-card,#27272a)] rounded-lg transition-colors"
              title={t('refresh', 'Actualiser')}
            >
              <RefreshCw className={`w-4 h-4 ${loading || loadingPipelines ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 text-[var(--fg-muted,#a1a1aa)] hover:text-white hover:bg-rose-500/20 rounded-lg transition-colors"
              title={t('close', 'Fermer')}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Telemetry Metrics Ribbon */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-6 py-3 border-b border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/30 text-xs">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)]">
              <Layers className="w-4 h-4 text-indigo-400" />
              <div>
                <span className="text-[var(--fg-muted,#71717a)] block">{t('coordinator_total_workspaces', 'Workspaces')}</span>
                <span className="font-semibold text-sm">{overview.workspaces.length}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)]">
              <AlertCircle
                className={`w-4 h-4 ${
                  overview.global_health === 'healthy'
                    ? 'text-emerald-400'
                    : overview.global_health === 'warning'
                    ? 'text-amber-400'
                    : 'text-rose-400'
                }`}
              />
              <div>
                <span className="text-[var(--fg-muted,#71717a)] block">{t('coordinator_health', 'Santé Globale')}</span>
                <span className="font-semibold uppercase tracking-wider text-xs">
                  {overview.global_health === 'healthy' ? t('healthy', 'Sain') : overview.global_health}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)]">
              <FolderGit2 className="w-4 h-4 text-amber-400" />
              <div>
                <span className="text-[var(--fg-muted,#71717a)] block">{t('coordinator_dirty_repos', 'Git Modifiés')}</span>
                <span className="font-semibold text-sm text-amber-300">{overview.dirty_repos_count}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)]">
              <GitBranch className="w-4 h-4 text-sky-400" />
              <div>
                <span className="text-[var(--fg-muted,#71717a)] block">{t('coordinator_out_of_sync', 'Désynchronisés')}</span>
                <span className="font-semibold text-sm">{overview.out_of_sync_count}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)]">
              <Play className={`w-4 h-4 ${overview.running_pipeline_count > 0 ? 'text-indigo-400 animate-pulse' : 'text-zinc-500'}`} />
              <div>
                <span className="text-[var(--fg-muted,#71717a)] block">{t('coordinator_running', 'En cours')}</span>
                <span className="font-semibold text-sm text-indigo-400">{overview.running_pipeline_count}</span>
              </div>
            </div>
          </div>
        )}

        {/* Modal Navigation Tabs */}
        <div className="flex items-center justify-between px-6 pt-3 border-b border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/20">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`pb-2.5 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'overview'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--fg-muted,#a1a1aa)] hover:text-[var(--fg-primary,#fafafa)]'
              }`}
            >
              <Boxes className="w-4 h-4" />
              {t('coordinator_tab_overview', 'Workspaces & Actions par Lot')}
            </button>
            <button
              onClick={() => setActiveTab('pipelines')}
              className={`pb-2.5 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'pipelines'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--fg-muted,#a1a1aa)] hover:text-[var(--fg-primary,#fafafa)]'
              }`}
            >
              <Wrench className="w-4 h-4" />
              {t('coordinator_tab_pipelines', 'Pipelines Détectés')}
              {pipelines.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] rounded-full bg-zinc-800 text-zinc-300">
                  {pipelines.length}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`pb-2.5 px-3 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${
                activeTab === 'logs'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-[var(--fg-muted,#a1a1aa)] hover:text-[var(--fg-primary,#fafafa)]'
              }`}
            >
              <Terminal className="w-4 h-4" />
              {t('coordinator_tab_logs', 'Console d\'Exécution')}
              {activeRun && activeRun.status === 'running' && (
                <span className="w-2 h-2 rounded-full bg-indigo-500 animate-ping" />
              )}
            </button>
          </div>

          {/* Workspace Switcher Selector */}
          <div className="flex items-center gap-2 pb-2">
            <span className="text-xs text-[var(--fg-muted,#71717a)]">{t('workspace', 'Workspace')} :</span>
            <select
              value={selectedWs}
              onChange={(e) => setSelectedWs(e.target.value)}
              className="text-xs py-1 px-2.5 rounded-lg bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)] text-[var(--fg-primary,#fafafa)] focus:outline-none focus:border-indigo-500"
            >
              {overview?.workspaces.map((ws) => (
                <option key={ws.path} value={ws.path}>
                  {ws.name} {ws.is_active ? '★' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tab Contents */}
        <div className="flex-1 overflow-y-auto p-6">
          {/* TAB 1: OVERVIEW & BATCH ACTIONS */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Batch Actions Deck */}
              <div className="p-4 rounded-xl border border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/40">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-sm font-semibold text-[var(--fg-primary,#fafafa)] flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-indigo-400" />
                      {t('coordinator_batch_actions_title', 'Actions par Lot Multi-Projets')}
                    </h3>
                    <p className="text-xs text-[var(--fg-muted,#71717a)]">
                      {t('coordinator_batch_desc', 'Déclenchez des opérations synchronisées sur l\'ensemble des dépôts configurés.')}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <button
                    onClick={() => handleBatchAction('git_fetch')}
                    disabled={!!batchActionInProgress}
                    className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--bg-card,#18181b)] hover:bg-zinc-800 border border-[var(--border,#27272a)] text-xs font-medium transition-colors"
                  >
                    <Download className={`w-3.5 h-3.5 text-sky-400 ${batchActionInProgress === 'git_fetch' ? 'animate-bounce' : ''}`} />
                    {t('coordinator_batch_fetch', 'Git Fetch All')}
                  </button>

                  <button
                    onClick={() => handleBatchAction('git_pull')}
                    disabled={!!batchActionInProgress}
                    className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--bg-card,#18181b)] hover:bg-zinc-800 border border-[var(--border,#27272a)] text-xs font-medium transition-colors"
                  >
                    <ArrowDownCircle className={`w-3.5 h-3.5 text-emerald-400 ${batchActionInProgress === 'git_pull' ? 'animate-bounce' : ''}`} />
                    {t('coordinator_batch_pull', 'Git Pull All')}
                  </button>

                  <button
                    onClick={() => handleBatchAction('install_deps')}
                    disabled={!!batchActionInProgress}
                    className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--bg-card,#18181b)] hover:bg-zinc-800 border border-[var(--border,#27272a)] text-xs font-medium transition-colors"
                  >
                    <Wrench className={`w-3.5 h-3.5 text-amber-400 ${batchActionInProgress === 'install_deps' ? 'animate-spin' : ''}`} />
                    {t('coordinator_batch_install', 'Installer les Dépendances')}
                  </button>

                  <button
                    onClick={() => handleBatchAction('run_all_tests')}
                    disabled={!!batchActionInProgress}
                    className="flex items-center justify-center gap-2 py-2 px-3 rounded-lg bg-[var(--bg-card,#18181b)] hover:bg-zinc-800 border border-[var(--border,#27272a)] text-xs font-medium transition-colors"
                  >
                    <Play className={`w-3.5 h-3.5 text-indigo-400 ${batchActionInProgress === 'run_all_tests' ? 'animate-pulse' : ''}`} />
                    {t('coordinator_batch_tests', 'Lancer Tous les Tests')}
                  </button>
                </div>
              </div>

              {/* Workspaces Grid */}
              <div>
                <h3 className="text-sm font-semibold mb-3 text-[var(--fg-primary,#fafafa)] flex items-center justify-between">
                  <span>{t('coordinator_workspaces_list', 'Dépôts et Projets Connectés')}</span>
                  <span className="text-xs text-[var(--fg-muted,#71717a)] font-normal">
                    {overview?.workspaces.length || 0} configurés
                  </span>
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {overview?.workspaces.map((ws) => (
                    <div
                      key={ws.path}
                      className={`p-4 rounded-xl border transition-all ${
                        selectedWs === ws.path
                          ? 'border-indigo-500/50 bg-indigo-500/5 shadow-md shadow-indigo-500/10'
                          : 'border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/30 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{ws.name}</span>
                            {ws.is_active && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-indigo-500/20 text-indigo-300 font-medium border border-indigo-500/30">
                                {t('active', 'Actif')}
                              </span>
                            )}
                          </div>
                          <span className="text-xs font-mono text-[var(--fg-muted,#71717a)] block mt-0.5 break-all">
                            {ws.path}
                          </span>
                        </div>

                        {ws.git?.branch && (
                          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-zinc-800/80 border border-zinc-700/50 text-xs font-mono text-zinc-300">
                            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                            <span>{ws.git.branch}</span>
                            {ws.git.is_dirty && (
                              <span className="w-2 h-2 rounded-full bg-amber-400" title="Fichiers modifiés" />
                            )}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between pt-3 border-t border-[var(--border,#27272a)] text-xs">
                        <div className="flex items-center gap-2">
                          {ws.runtime?.stack && (
                            <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 uppercase text-[10px] font-medium">
                              {ws.runtime.stack}
                            </span>
                          )}
                          {ws.runtime?.package_manager && (
                            <span className="text-[var(--fg-muted,#71717a)] text-[10px]">
                              {ws.runtime.package_manager}
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              setSelectedWs(ws.path);
                              setActiveTab('pipelines');
                            }}
                            className="px-2 py-1 rounded bg-indigo-500/10 text-indigo-300 hover:bg-indigo-500/20 transition-colors text-xs flex items-center gap-1"
                          >
                            <span>{t('coordinator_view_pipelines', 'Pipelines')}</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>

                          {onSwitchWorkspace && !ws.is_active && (
                            <button
                              onClick={() => {
                                onSwitchWorkspace(ws.path);
                                showToast(t('workspace_switched', 'Workspace actif mis à jour'), 'success');
                                loadOverview();
                              }}
                              className="px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:text-white hover:bg-zinc-700 transition-colors text-xs"
                            >
                              {t('coordinator_set_active', 'Définir actif')}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PIPELINES STUDIO */}
          {activeTab === 'pipelines' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--fg-primary,#fafafa)] flex items-center gap-2">
                    <Wrench className="w-4 h-4 text-indigo-400" />
                    {t('coordinator_discovered_pipelines', 'Pipelines & Workflows Détectés')}
                  </h3>
                  <p className="text-xs text-[var(--fg-muted,#71717a)]">
                    {t('coordinator_pipelines_desc', 'Pipelines conventionnels déduits des configurations de build, test et packaging.')}
                  </p>
                </div>
              </div>

              {loadingPipelines ? (
                <div className="flex items-center justify-center p-12 text-[var(--fg-muted,#71717a)] gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>{t('coordinator_scanning_pipelines', 'Analyse du workspace en cours...')}</span>
                </div>
              ) : pipelines.length === 0 ? (
                <div className="p-8 text-center border border-dashed border-[var(--border,#27272a)] rounded-xl text-[var(--fg-muted,#71717a)] text-sm">
                  {t('coordinator_no_pipelines', 'Aucun pipeline conventionnel détecté dans ce workspace.')}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {pipelines.map((pipe) => (
                    <div
                      key={pipe.id}
                      className="p-4 rounded-xl border border-[var(--border,#27272a)] bg-[var(--bg-secondary,#09090b)]/30 hover:border-zinc-700 transition-colors"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm text-[var(--fg-primary,#fafafa)]">{pipe.name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-zinc-800 text-zinc-300 uppercase">
                              {pipe.pipeline_type}
                            </span>
                          </div>
                          <p className="text-xs text-[var(--fg-muted,#a1a1aa)] mt-1">{pipe.description}</p>
                        </div>

                        <button
                          onClick={() => handleStartPipeline(pipe.id)}
                          disabled={activeRun?.status === 'running'}
                          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-md shadow-indigo-600/20 transition-all disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>{t('coordinator_run_pipeline', 'Lancer')}</span>
                        </button>
                      </div>

                      {/* Pipeline Steps Sequence */}
                      <div className="mt-4 pt-3 border-t border-[var(--border,#27272a)]">
                        <span className="text-[11px] font-medium text-[var(--fg-muted,#71717a)] uppercase tracking-wider block mb-2">
                          {t('coordinator_steps_sequence', 'Séquence d\'étapes ({0})').replace('{0}', String(pipe.steps.length))} :
                        </span>
                        <div className="flex flex-wrap gap-2">
                          {pipe.steps.map((step, idx) => (
                            <div
                              key={step.id || idx}
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-[var(--bg-card,#18181b)] border border-[var(--border,#27272a)] text-xs font-mono"
                            >
                              <span className="text-zinc-500">{idx + 1}.</span>
                              <span className="font-medium text-zinc-200">{step.name}</span>
                              <span className="text-zinc-500 text-[10px] hidden md:inline">({step.command})</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LOGS & EXECUTION CONSOLE */}
          {activeTab === 'logs' && (
            <div className="space-y-4 flex flex-col h-full">
              {activeRun ? (
                <>
                  <div className="flex items-center justify-between p-3 rounded-xl bg-[var(--bg-secondary,#09090b)]/50 border border-[var(--border,#27272a)]">
                    <div className="flex items-center gap-3">
                      <div
                        className={`p-2 rounded-lg ${
                          activeRun.status === 'running'
                            ? 'bg-indigo-500/10 text-indigo-400'
                            : activeRun.status === 'success'
                            ? 'bg-emerald-500/10 text-emerald-400'
                            : 'bg-rose-500/10 text-rose-400'
                        }`}
                      >
                        {activeRun.status === 'running' ? (
                          <RefreshCw className="w-5 h-5 animate-spin" />
                        ) : activeRun.status === 'success' ? (
                          <CheckCircle2 className="w-5 h-5" />
                        ) : (
                          <AlertTriangle className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-sm">{activeRun.pipeline_name}</span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase font-semibold ${
                              activeRun.status === 'running'
                                ? 'bg-indigo-500/20 text-indigo-300'
                                : activeRun.status === 'success'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-rose-500/20 text-rose-300'
                            }`}
                          >
                            {activeRun.status}
                          </span>
                        </div>
                        <span className="text-xs text-[var(--fg-muted,#71717a)]">
                          Étape {activeRun.current_step_index + 1} / {activeRun.steps.length} • {activeRun.total_duration_ms} ms
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {activeRun.status === 'running' ? (
                        <button
                          onClick={handleCancelPipeline}
                          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 font-medium text-xs border border-rose-500/30 transition-colors"
                        >
                          <Square className="w-3.5 h-3.5 fill-current" />
                          <span>{t('coordinator_cancel', 'Interrompre')}</span>
                        </button>
                      ) : activeRun.status === 'failed' ? (
                        <button
                          onClick={handleBuildRemediation}
                          disabled={remediating}
                          className="flex items-center gap-1.5 py-1.5 px-3 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-medium text-xs shadow-md transition-all disabled:opacity-50"
                        >
                          <Sparkles className={`w-3.5 h-3.5 ${remediating ? 'animate-spin' : ''}`} />
                          <span>{t('coordinator_auto_fix', '⚡ Auto-Fix avec Antigravity')}</span>
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Terminal Log Console */}
                  <div
                    ref={logTerminalRef}
                    className="flex-1 min-h-[350px] p-4 font-mono text-xs rounded-xl bg-black/90 border border-zinc-800 text-zinc-200 overflow-y-auto select-text space-y-3"
                  >
                    {activeRun.steps.map((step, idx) => (
                      <div key={step.id || idx} className="space-y-1">
                        <div className="flex items-center gap-2 text-zinc-400 border-b border-zinc-800/80 pb-1">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              step.status === 'success'
                                ? 'bg-emerald-400'
                                : step.status === 'failed'
                                ? 'bg-rose-400'
                                : step.status === 'running'
                                ? 'bg-indigo-400 animate-pulse'
                                : 'bg-zinc-600'
                            }`}
                          />
                          <span className="font-semibold text-zinc-100">{step.name}</span>
                          <span className="text-zinc-500">[{step.command}]</span>
                          <span className="ml-auto text-[10px] text-zinc-500">
                            {step.duration_ms ? `${step.duration_ms} ms` : ''}
                          </span>
                        </div>

                        {step.output_preview ? (
                          <pre className="text-zinc-300 whitespace-pre-wrap font-mono text-[11px] leading-relaxed p-2 rounded bg-zinc-950/60 border border-zinc-900">
                            {step.output_preview}
                          </pre>
                        ) : step.status === 'running' ? (
                          <div className="text-indigo-400 italic text-[11px] py-1">
                            {t('coordinator_step_executing', 'Exécution en cours...')}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="p-12 text-center border border-dashed border-[var(--border,#27272a)] rounded-xl text-[var(--fg-muted,#71717a)] text-sm">
                  {t('coordinator_no_active_run', 'Aucun pipeline sélectionné ou en cours d\'exécution.')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
