import React, { useState, useEffect } from 'react';
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
  const [activeTab, setActiveTab] = useState<'tasks' | 'subagents' | 'processes'>('tasks');
  const [data, setData] = useState<{ tasks: any[]; subagents: any[]; processes: any[] }>({
    tasks: [],
    subagents: [],
    processes: []
  });
  const [loading, setLoading] = useState(false);
  const [killingPid, setKillingPid] = useState<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, conversationId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchTasksList(conversationId || undefined);
      setData(res);
    } catch (e) {
      console.error('Error fetching tasks list:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleKillProcess = async (pid: number) => {
    if (!confirm(`Confirmer l'arrêt forcé du processus PID ${pid} ?`)) return;
    setKillingPid(pid);
    try {
      await killTask(pid);
      await loadData();
    } catch (err: any) {
      alert(err.message || 'Erreur lors de l\'arrêt du processus');
    } finally {
      setKillingPid(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-6 animate-fadeIn">
      <div className="w-[950px] max-w-full h-[80vh] bg-[#090e1c] border border-slate-800 rounded-3xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-14 px-6 border-b border-slate-800/80 flex items-center justify-between shrink-0 bg-[#0d1428]/80">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
              <Activity className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-slate-100">Supervision & Tâches d'Arrière-Plan</h2>
              <p className="text-[10px] text-slate-400">Monitoring en temps réel des sous-agents, commandes longues et processus</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
              title="Rafraîchir"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Selector */}
        <div className="px-6 border-b border-slate-800 flex items-center gap-4 bg-[#070b16]">
          <button
            onClick={() => setActiveTab('tasks')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === 'tasks'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Tâches Antigravity ({data.tasks.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('subagents')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === 'subagents'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <Bot className="w-3.5 h-3.5" />
            <span>Sous-Agents ({data.subagents.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('processes')}
            className={`py-3 px-2 text-xs font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-2 ${
              activeTab === 'processes'
                ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-semibold'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            <span>Processus CLI Actifs ({data.processes.length})</span>
          </button>
        </div>

        {/* Tab Content */}
        <div className="flex-1 overflow-y-auto p-6 bg-[#080c16]">
          {activeTab === 'tasks' && (
            <div className="space-y-3">
              {data.tasks.length === 0 ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Aucune tâche d'arrière-plan enregistrée.
                </div>
              ) : (
                data.tasks.map((task) => (
                  <div
                    key={task.id}
                    className="p-4 rounded-2xl bg-[#0b1020] border border-slate-800 text-xs flex flex-col gap-2.5 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 font-mono">
                        <Terminal className="w-3.5 h-3.5 text-indigo-400" />
                        <span className="font-semibold text-slate-200">{task.task_id}</span>
                        <span className="text-[10px] text-slate-500">dans conv {task.conversation_id.substring(0, 8)}...</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {task.status === 'completed' ? (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                            <CheckCircle2 className="w-3 h-3" />
                            Terminé
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full animate-pulse">
                            <Clock className="w-3 h-3" />
                            En cours
                          </span>
                        )}
                        <span className="text-[10px] text-slate-500">
                          {new Date(task.last_modified * 1000).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    {task.preview && (
                      <pre className="p-3 bg-[#050811] rounded-xl border border-slate-800/80 text-[10px] font-mono text-slate-400 overflow-x-auto whitespace-pre-wrap max-h-24">
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
                <div className="p-8 text-center text-slate-500 text-xs">
                  Aucun sous-agent délégué actif pour l'instant.
                </div>
              ) : (
                data.subagents.map((sub) => (
                  <div
                    key={sub.id}
                    className="p-4 rounded-2xl bg-[#0b1020] border border-slate-800 text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                        <Bot className="w-4 h-4 text-purple-400" />
                      </div>
                      <div>
                        <span className="font-semibold text-slate-200 font-mono text-xs">{sub.id}</span>
                        <p className="text-[10px] text-slate-500 font-mono truncate max-w-md">{sub.path}</p>
                      </div>
                    </div>
                    <span className="text-[10px] font-semibold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full">
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
                <div className="p-8 text-center text-slate-500 text-xs">
                  Aucun sous-processus Antigravity en cours d'exécution.
                </div>
              ) : (
                data.processes.map((proc) => (
                  <div
                    key={proc.pid}
                    className="p-4 rounded-2xl bg-[#0b1020] border border-slate-800 text-xs flex items-center justify-between"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                        <Cpu className="w-4 h-4 text-amber-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-200 text-xs">{proc.name}</span>
                          <span className="font-mono text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.2 rounded">
                            PID {proc.pid}
                          </span>
                          <span className="text-[10px] text-indigo-400 font-mono">
                            {proc.memory_mb} MB RAM
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-500 font-mono truncate max-w-lg mt-0.5">
                          {proc.cmd}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleKillProcess(proc.pid)}
                      disabled={killingPid === proc.pid}
                      className="py-1.5 px-3 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Square className="w-3 h-3 fill-rose-400" />
                      <span>{killingPid === proc.pid ? 'Arrêt...' : 'Terminer'}</span>
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
