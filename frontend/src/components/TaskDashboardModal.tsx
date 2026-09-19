import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Activity, 
  Bot, 
  Terminal, 
  Cpu, 
  RefreshCw, 
  Square, 
  CheckCircle2, 
  Clock 
} from 'lucide-react';
import { fetchTasksList, killTask } from '../services/api';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';

interface TaskDashboardModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string | null;
}

export const TaskDashboardModal: React.FC<TaskDashboardModalProps> = ({
  isOpen,
  onClose,
  conversationId,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'tasks' | 'subagents' | 'processes'>('tasks');
  const [data, setData] = useState<{ tasks: any[]; subagents: any[]; processes: any[] }>({
    tasks: [],
    subagents: [],
    processes: []
  });
  const [loading, setLoading] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);
  const [killingTaskId, setKillingTaskId] = useState<string | null>(null);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchTasksList(conversationId || undefined);
      setData(res);
    } catch (e) {
      console.error('Error fetching tasks list:', e);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    fetchTasksList(conversationId || undefined)
      .then((res) => {
        if (active) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error('Error fetching tasks list:', e);
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, conversationId]);

  const handleKillProcess = async (pid: number) => {
    if (!(await showConfirm(t('task_kill_confirm', 'Confirm forced stop of process PID {0}?', pid), { destructive: true }))) return;
    setKillingPid(pid);
    try {
      await killTask(pid);
      await refreshData();
    } catch (err: any) {
      showToast(err.message || t('task_kill_error', 'Error stopping process'), 'error');
    } finally {
      setKillingPid(null);
    }
  };

  const handleKillTask = async (taskId: string) => {
    if (!(await showConfirm(t('task_kill_confirm', 'Confirm forced stop of task {0}?', taskId), { destructive: true }))) return;
    setKillingTaskId(taskId);
    try {
      await killTask(undefined, taskId);
      await refreshData();
    } catch (err: any) {
      showToast(err.message || t('task_kill_error', 'Error stopping task'), 'error');
    } finally {
      setKillingTaskId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6 animate-fadeIn safe-pt safe-pb">
      <div
        className="w-[950px] max-w-full h-[90dvh] sm:h-[80vh] border rounded-2xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="h-14 px-4 sm:px-6 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-7 h-7 rounded-lg border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent-bg-strong)',
                color: 'var(--accent)'
              }}
            >
              <Activity className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs font-semibold truncate" style={{ color: 'var(--strong)' }}>{t('task_dashboard_title', 'Supervision & Background Tasks')}</h2>
              <p className="text-[10px] truncate hidden sm:block" style={{ color: 'var(--muted)' }}>{t('task_dashboard_subtitle', 'Real-time monitoring of subagents, long commands, and processes')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={refreshData}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{ color: 'var(--muted)' }}
              title={t('refresh', 'Refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} style={{ color: loading ? 'var(--accent)' : undefined }} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div
          className="px-3 sm:px-6 border-b flex items-center gap-2 sm:gap-4 overflow-x-auto no-scrollbar touch-scroll"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'tasks'
                ? 'border-sky-500 font-semibold text-sky-600 dark:text-sky-400'
                : 'border-transparent opacity-70 hover:opacity-100'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>{t('tasks', 'Tasks')} ({data.tasks.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('subagents')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'subagents'
                ? 'border-sky-500 font-semibold text-sky-600 dark:text-sky-400'
                : 'border-transparent opacity-70 hover:opacity-100'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>{t('subagents', 'Subagents')} ({data.subagents.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('processes')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 shrink-0 whitespace-nowrap ${
              activeTab === 'processes'
                ? 'border-sky-500 font-semibold text-sky-600 dark:text-sky-400'
                : 'border-transparent opacity-70 hover:opacity-100'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>{t('cli_processes', 'CLI Processes')} ({data.processes.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        <div
          className="flex-1 overflow-y-auto p-3 sm:p-6"
          style={{ backgroundColor: 'var(--surface)' }}
        >
          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {data.tasks.length === 0 ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  {t('no_background_tasks', 'No background tasks registered.')}
                </div>
              ) : (
                data.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-4 rounded-2xl border text-xs flex flex-col gap-2.5 shadow-sm"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)'
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono">
                        <Terminal className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span className="font-semibold" style={{ color: 'var(--strong)' }}>{task.task_id}</span>
                        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                          conv {task.conversation_id.substring(0, 8)}...
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {task.status === 'completed' ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            {t('done', 'Done')}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="flex items-center gap-1 text-[10px] font-bold text-amber-500 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
                              <Clock className="w-3 h-3" />
                              {t('in_progress', 'In progress')}
                            </span>
                            <button
                              onClick={() => handleKillTask(task.task_id)}
                              disabled={killingTaskId === task.task_id}
                              className="py-0.5 px-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-500 text-[10px] font-medium flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                              title={t('terminate', 'Terminate')}
                            >
                              <Square className="w-2.5 h-2.5 fill-rose-500" />
                              <span>{killingTaskId === task.task_id ? t('stopping', 'Stopping...') : t('terminate', 'Terminate')}</span>
                            </button>
                          </div>
                        )}
                        <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                          {new Date(task.last_modified * 1000).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {task.preview && (
                      <pre
                        className="p-3 rounded-xl border text-[10px] font-mono overflow-x-auto whitespace-pre-wrap max-h-24"
                        style={{
                          backgroundColor: 'var(--code-bg, var(--surface))',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)'
                        }}
                      >
                        {task.preview}
                      </pre>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'subagents' && (
            <div className="space-y-3">
              {data.subagents.length === 0 ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  {t('no_active_subagents', 'No active delegated subagents at this time.')}
                </div>
              ) : (
                data.subagents.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-4 rounded-2xl border text-xs flex items-center justify-between"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)'
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <span className="font-semibold font-mono text-xs" style={{ color: 'var(--strong)' }}>{sub.id}</span>
                        <p className="text-[10px] font-mono truncate max-w-md" style={{ color: 'var(--muted)' }}>{sub.path}</p>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-semibold px-2.5 py-1 rounded-full border"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--muted)'
                      }}
                    >
                      {sub.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'processes' && (
            <div className="space-y-3">
              {data.processes.length === 0 ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  {t('no_cli_processes', 'No Antigravity CLI subprocesses currently running.')}
                </div>
              ) : (
                data.processes.map((proc) => (
                  <div
                    key={proc.pid}
                    className="p-4 rounded-2xl border text-xs flex items-center justify-between"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)'
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <Cpu className="w-4 h-4 text-amber-500" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>{proc.name}</span>
                          <span
                            className="font-mono text-[10px] px-1.5 py-0.2 rounded border"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border-subtle)',
                              color: 'var(--muted)'
                            }}
                          >
                            PID {proc.pid}
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--accent)' }}>
                            {proc.memory_mb} MB RAM
                          </span>
                        </div>
                        <p className="text-[10px] font-mono truncate max-w-lg mt-0.5" style={{ color: 'var(--muted)' }}>
                          {proc.cmd}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleKillProcess(proc.pid)}
                      disabled={killingPid === proc.pid}
                      className="py-1.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-500 text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Square className="w-3 h-3 fill-rose-500" />
                      <span>{killingPid === proc.pid ? t('stopping', 'Stopping...') : t('terminate', 'Terminate')}</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
