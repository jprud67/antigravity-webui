import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Container,
  Play,
  Square,
  RotateCw,
  Trash2,
  Terminal,
  FileCode,
  Layers,
  Activity,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import { dockerApi } from '../services/api';
import { showToast } from '../services/toast';
import type {
  ContainerSummary,
  DockerEngineStatus,
  WorkspaceDockerItem,
  ContainerExecResult
} from '../types';

interface DockerStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace?: string;
}

type TabType = 'containers' | 'compose' | 'logs';

export const DockerStudioModal: React.FC<DockerStudioModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<TabType>('containers');
  const [status, setStatus] = useState<DockerEngineStatus | null>(null);
  const [containers, setContainers] = useState<ContainerSummary[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceDockerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');

  // Logs & Exec State
  const [selectedContainerId, setSelectedContainerId] = useState<string>('');
  const [logsContent, setLogsContent] = useState<string>('');
  const [logsTail, setLogsTail] = useState<number>(200);
  const [logsLoading, setLogsLoading] = useState(false);
  const [execCommand, setExecCommand] = useState('');
  const [execResult, setExecResult] = useState<ContainerExecResult | null>(null);
  const [execRunning, setExecRunning] = useState(false);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, containersRes, filesRes] = await Promise.all([
        dockerApi.getStatus().catch(() => null),
        dockerApi.listContainers(true).catch(() => []),
        dockerApi.scanWorkspace(currentWorkspace).catch(() => [])
      ]);

      if (statusRes) setStatus(statusRes);
      setContainers(containersRes);
      setWorkspaceFiles(filesRes);

      if (containersRes.length > 0) {
        setSelectedContainerId(prev => prev || containersRes[0].id);
      }
    } catch (err: any) {
      showToast(err.message || 'Error loading Docker environment', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        loadData();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadData]);

  // Load logs when selected container changes or logs tab is active
  const loadContainerLogs = useCallback(async (containerId: string, tail: number) => {
    if (!containerId) return;
    setLogsLoading(true);
    try {
      const res = await dockerApi.getLogs(containerId, tail, true);
      setLogsContent(res.logs || '(No logs available)');
    } catch (err: any) {
      setLogsContent(`Error reading logs: ${err.message}`);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && activeTab === 'logs' && selectedContainerId) {
      const timer = setTimeout(() => {
        loadContainerLogs(selectedContainerId, logsTail);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, activeTab, selectedContainerId, logsTail, loadContainerLogs]);

  // Handle container action (start/stop/restart/remove)
  const handleContainerAction = async (containerId: string, action: 'start' | 'stop' | 'restart' | 'remove') => {
    setActionInProgress(`${containerId}-${action}`);
    try {
      await dockerApi.executeAction(containerId, action);
      showToast(`Action ${action} executed successfully`, 'success');
      await loadData();
      if (selectedContainerId === containerId && activeTab === 'logs') {
        loadContainerLogs(containerId, logsTail);
      }
    } catch (err: any) {
      showToast(err.message || `Failed to execute ${action}`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle compose action (up/down/restart)
  const handleComposeAction = async (composePath: string, action: 'up' | 'down' | 'restart') => {
    setActionInProgress(`compose-${action}`);
    try {
      const res = await dockerApi.executeComposeAction(composePath, action);
      showToast(`Compose ${action}: ${res.output || 'success'}`, 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || `Failed compose ${action}`, 'error');
    } finally {
      setActionInProgress(null);
    }
  };

  // Handle Exec in container
  const handleExec = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!selectedContainerId || !execCommand.trim()) return;

    setExecRunning(true);
    setExecResult(null);
    try {
      const res = await dockerApi.execCommand(selectedContainerId, execCommand.trim());
      setExecResult(res);
      if (!res.success) {
        showToast(`Exit code ${res.exit_code}`, 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Execution failed', 'error');
    } finally {
      setExecRunning(false);
    }
  };

  if (!isOpen) return null;

  const filteredContainers = containers.filter(c => {
    if (!searchFilter.trim()) return true;
    const term = searchFilter.toLowerCase();
    return (
      c.names.some(n => n.toLowerCase().includes(term)) ||
      c.image.toLowerCase().includes(term) ||
      c.id.toLowerCase().includes(term) ||
      c.status.toLowerCase().includes(term)
    );
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 safe-pt safe-pb">
      <div
        className="border rounded-2xl sm:rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[94dvh] sm:h-[88vh] animate-fadeIn"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="p-3.5 sm:p-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <Container className="w-4 h-4 sm:w-5 sm:h-5 text-sky-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 truncate" style={{ color: 'var(--strong)' }}>
                <span>{t('docker_studio_title', 'Docker & Container Management Studio')}</span>
                {status?.isAvailable ? (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                    {status.engine.toUpperCase()} {status.version || 'Daemon OK'}
                  </span>
                ) : (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
                    {t('docker_daemon_inactive', 'Daemon Offline')}
                  </span>
                )}
              </h2>
              <p className="text-[10px] sm:text-[11px] truncate hidden sm:block" style={{ color: 'var(--muted)' }}>
                {t('docker_studio_desc', 'Inspect, manage containers, execute commands, view logs, and orchestrate Docker Compose services directly from Antigravity.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer flex items-center gap-1.5 text-xs"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              title={t('docker_refresh', 'Refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{t('docker_refresh', 'Refresh')}</span>
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Daemon Telemetry Banner */}
        <div
          className="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-3 text-xs shrink-0"
          style={{
            backgroundColor: status?.isAvailable ? 'rgba(14, 165, 233, 0.04)' : 'rgba(245, 158, 11, 0.04)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              {status?.isAvailable ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertCircle className="w-4 h-4 text-amber-400" />
              )}
              <span className="font-semibold text-slate-200">
                {status?.isAvailable ? t('docker_daemon_active', 'Docker Daemon Operational') : t('docker_daemon_inactive', 'Docker Daemon Offline / Not Installed')}
              </span>
            </div>
            {status?.isAvailable && (
              <div className="flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                <span>Total: <strong className="text-slate-200">{status.containersCount}</strong></span>
                <span>Active: <strong className="text-emerald-400">{status.runningCount}</strong></span>
              </div>
            )}
          </div>

          {/* Tab Navigation */}
          <div className="flex items-center gap-1 bg-black/20 p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab('containers')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'containers'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('docker_tab_containers', 'Containers ({0})').replace('{0}', String(containers.length))}
            </button>
            <button
              onClick={() => setActiveTab('compose')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'compose'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('docker_tab_compose', 'Compose & Workspace')}
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                activeTab === 'logs'
                  ? 'bg-sky-500/20 text-sky-400 border border-sky-500/30'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {t('docker_tab_logs', 'Logs & Console')}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* TAB 1: CONTAINERS */}
          {activeTab === 'containers' && (
            <div className="space-y-3">
              {/* Search & Filter Bar */}
              <div className="flex items-center gap-2">
                <div
                  className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder={t('docker_filter_placeholder', 'Filter by name, image, status...')}
                    className="w-full bg-transparent focus:outline-hidden text-xs"
                    style={{ color: 'var(--text)' }}
                  />
                  {searchFilter && (
                    <button onClick={() => setSearchFilter('')} className="text-slate-400 hover:text-slate-200">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {filteredContainers.length === 0 ? (
                <div
                  className="p-8 text-center rounded-2xl border flex flex-col items-center justify-center gap-3"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <Container className="w-10 h-10 text-slate-500/40" />
                  <p className="text-sm font-medium text-slate-400">
                    {t('docker_no_containers', 'No Docker containers found.')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {filteredContainers.map((c) => {
                    const isRunning = c.state === 'running';
                    const mainName = c.names[0]?.replace(/^\//, '') || c.id.slice(0, 12);
                    return (
                      <div
                        key={c.id}
                        className="p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-sky-500/40"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)'
                        }}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div
                            className={`w-3 h-3 rounded-full mt-1 shrink-0 ${
                              isRunning ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]' : 'bg-slate-500'
                            }`}
                          />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-xs sm:text-sm text-slate-100 truncate">{mainName}</span>
                              <span
                                className={`text-[10px] px-2 py-0.2 rounded-full font-mono uppercase font-bold border ${
                                  isRunning
                                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                    : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                                }`}
                              >
                                {c.state}
                              </span>
                              <span className="text-[10px] text-slate-500 font-mono">ID: {c.id.slice(0, 12)}</span>
                            </div>
                            <div className="text-[11px] text-slate-400 truncate mt-0.5">
                              Image: <span className="font-mono text-slate-300">{c.image}</span>
                            </div>
                            {c.ports.length > 0 && (
                              <div className="text-[10px] text-sky-400 font-mono mt-0.5 truncate">
                                Ports: {c.ports.join(', ')}
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-1.5 shrink-0 self-end sm:self-center">
                          {isRunning ? (
                            <>
                              <button
                                disabled={actionInProgress === `${c.id}-stop`}
                                onClick={() => handleContainerAction(c.id, 'stop')}
                                className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs flex items-center gap-1 transition-all cursor-pointer"
                                title={t('docker_action_stop', 'Stop')}
                              >
                                <Square className="w-3 h-3" />
                                <span>{t('docker_action_stop', 'Stop')}</span>
                              </button>
                              <button
                                disabled={actionInProgress === `${c.id}-restart`}
                                onClick={() => handleContainerAction(c.id, 'restart')}
                                className="px-2.5 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs flex items-center gap-1 transition-all cursor-pointer"
                                title={t('docker_action_restart', 'Restart')}
                              >
                                <RotateCw className="w-3 h-3" />
                                <span>{t('docker_action_restart', 'Restart')}</span>
                              </button>
                            </>
                          ) : (
                            <button
                              disabled={actionInProgress === `${c.id}-start`}
                              onClick={() => handleContainerAction(c.id, 'start')}
                              className="px-2.5 py-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 text-xs flex items-center gap-1 transition-all cursor-pointer"
                              title={t('docker_action_start', 'Start')}
                            >
                              <Play className="w-3 h-3" />
                              <span>{t('docker_action_start', 'Start')}</span>
                            </button>
                          )}

                          <button
                            onClick={() => {
                              setSelectedContainerId(c.id);
                              setActiveTab('logs');
                            }}
                            className="px-2.5 py-1 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 text-xs flex items-center gap-1 transition-all cursor-pointer"
                            title={t('docker_inspect_logs', 'Inspect logs')}
                          >
                            <Terminal className="w-3 h-3" />
                            <span>{t('logs', 'Logs')}</span>
                          </button>

                          <button
                            disabled={actionInProgress === `${c.id}-remove`}
                            onClick={() => handleContainerAction(c.id, 'remove')}
                            className="p-1 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/20 transition-all cursor-pointer"
                            title={t('docker_action_remove', 'Remove')}
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
          )}

          {/* TAB 2: COMPOSE & WORKSPACE */}
          {activeTab === 'compose' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  {t('docker_detected_files', 'Detected Docker & Compose Configurations')}
                </h3>
                <span className="text-[11px] text-slate-400">
                  Workspace: <code className="text-sky-400">{currentWorkspace || 'Default'}</code>
                </span>
              </div>

              {workspaceFiles.length === 0 ? (
                <div
                  className="p-8 text-center rounded-2xl border flex flex-col items-center justify-center gap-2"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <FileCode className="w-8 h-8 text-slate-500/40" />
                  <p className="text-xs text-slate-400">
                    {t('docker_no_compose_found', 'Aucun fichier Dockerfile ou docker-compose.yml trouvé dans le workspace.')}
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {workspaceFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="p-4 rounded-2xl border space-y-3"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)'
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          {file.kind === 'compose' ? (
                            <Layers className="w-4 h-4 text-sky-400" />
                          ) : (
                            <FileCode className="w-4 h-4 text-emerald-400" />
                          )}
                          <div>
                            <span className="font-semibold text-xs text-slate-200">{file.filename}</span>
                            <span className="text-[10px] text-slate-500 font-mono ml-2">({file.kind})</span>
                          </div>
                        </div>

                        {file.kind === 'compose' && (
                          <div className="flex items-center gap-2">
                            <button
                              disabled={actionInProgress === 'compose-up'}
                              onClick={() => handleComposeAction(file.path, 'up')}
                              className="px-2.5 py-1 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-300 hover:bg-sky-500/20 text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Play className="w-3 h-3" />
                              <span>{t('docker_compose_up_btn', 'Compose Up')}</span>
                            </button>
                            <button
                              disabled={actionInProgress === 'compose-down'}
                              onClick={() => handleComposeAction(file.path, 'down')}
                              className="px-2.5 py-1 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 text-xs flex items-center gap-1.5 transition-all cursor-pointer"
                            >
                              <Square className="w-3 h-3" />
                              <span>{t('docker_compose_down_btn', 'Compose Down')}</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {file.services && file.services.length > 0 && (
                        <div className="bg-black/30 rounded-xl p-3 border border-white/5 space-y-1.5">
                          <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Services ({file.services.length})</span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-1">
                            {file.services.map((svc, sidx) => (
                              <div key={sidx} className="p-2 rounded-lg bg-white/5 border border-white/5 text-xs">
                                <div className="font-semibold text-sky-300">{svc.name}</div>
                                <div className="text-[10px] text-slate-400 font-mono truncate">
                                  {svc.image ? `Image: ${svc.image}` : `Build: ${svc.build || '.'}`}
                                </div>
                                {svc.ports.length > 0 && (
                                  <div className="text-[10px] text-emerald-400 font-mono">
                                    Ports: {svc.ports.join(', ')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 3: LOGS & CONSOLE */}
          {activeTab === 'logs' && (
            <div className="space-y-3 flex flex-col h-full">
              {/* Target Container Selector & Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400 font-medium">Container:</span>
                  <select
                    value={selectedContainerId}
                    onChange={(e) => setSelectedContainerId(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border text-xs bg-slate-900 text-slate-200 border-slate-700 font-mono focus:outline-hidden"
                  >
                    {containers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.names[0]?.replace(/^\//, '') || c.id.slice(0, 12)} ({c.state})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{t('docker_logs_tail_label', 'Tail lines:')}</span>
                  <select
                    value={logsTail}
                    onChange={(e) => setLogsTail(Number(e.target.value))}
                    className="px-2 py-1 rounded-lg border text-xs bg-slate-900 text-slate-200 border-slate-700 font-mono"
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={200}>200</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>

                  <button
                    onClick={() => loadContainerLogs(selectedContainerId, logsTail)}
                    disabled={logsLoading}
                    className="p-1.5 rounded-lg border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 transition-all cursor-pointer"
                    title={t('docker_refresh_logs', 'Refresh logs')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${logsLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Terminal Logs Output */}
              <div
                className="flex-1 min-h-[240px] max-h-[380px] overflow-auto rounded-xl p-3 font-mono text-[11px] leading-relaxed border bg-black/90 text-slate-300 border-slate-800 select-text"
              >
                {logsLoading ? (
                  <div className="flex items-center gap-2 text-slate-500">
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>{t('docker_loading_logs', 'Chargement des logs...')}</span>
                  </div>
                ) : (
                  <pre className="whitespace-pre-wrap">{logsContent}</pre>
                )}
              </div>

              {/* Interactive Exec Command Bar */}
              <form onSubmit={handleExec} className="space-y-2 pt-2 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl border bg-slate-950 border-slate-800 text-xs font-mono">
                    <span className="text-emerald-400">$</span>
                    <input
                      type="text"
                      value={execCommand}
                      onChange={(e) => setExecCommand(e.target.value)}
                      placeholder={t('docker_exec_command_placeholder', 'Command to run (e.g. ls -la, python --version)...')}
                      className="w-full bg-transparent focus:outline-hidden text-slate-200"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={execRunning || !execCommand.trim()}
                    className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-medium text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-md shrink-0"
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>{execRunning ? 'Running...' : t('docker_exec_btn', 'Run Command')}</span>
                  </button>
                </div>

                {execResult && (
                  <div className="p-3 rounded-xl border bg-black/70 border-slate-800 font-mono text-xs space-y-1">
                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span>Exit code: <strong className={execResult.success ? 'text-emerald-400' : 'text-rose-400'}>{execResult.exit_code}</strong></span>
                    </div>
                    {execResult.stdout && <pre className="text-emerald-300 whitespace-pre-wrap">{execResult.stdout}</pre>}
                    {execResult.stderr && <pre className="text-rose-400 whitespace-pre-wrap">{execResult.stderr}</pre>}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-3 border-t flex items-center justify-between text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)'
          }}
        >
          <div className="flex items-center gap-2">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px]">{t('docker_footer_title', 'Antigravity Container Engine & Isolation')}</span>
          </div>
          <span className="text-[10px] font-mono">v0.4.0 Studio</span>
        </div>
      </div>
    </div>
  );
};
