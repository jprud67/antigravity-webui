import React, { useState, useEffect } from 'react';
import type { KanbanTask } from '../services/api';
import { 
  fetchKanbanTasks, 
  createKanbanTask, 
  updateKanbanTask, 
  deleteKanbanTask 
} from '../services/api';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { 
  Plus, 
  RefreshCw, 
  Search, 
  Play, 
  Trash2, 
  Edit3, 
  ChevronLeft, 
  ChevronRight, 
  AlertCircle, 
  CheckCircle2, 
  AlertTriangle,
  X,
  User
} from 'lucide-react';

interface KanbanTabProps {
  currentWorkspace: string;
  onExecutePrompt?: (prompt: string) => void;
}

export const KanbanTab: React.FC<KanbanTabProps> = ({ currentWorkspace, onExecutePrompt }) => {
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [columns, setColumns] = useState<{
    todo: KanbanTask[];
    running: KanbanTask[];
    blocked: KanbanTask[];
    done: KanbanTask[];
  }>({ todo: [], running: [], blocked: [], done: [] });
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Modal create/edit state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<KanbanTask | null>(null);
  const [taskTitle, setTaskTitle] = useState('');
  const [taskBody, setTaskBody] = useState('');
  const [taskPriority, setTaskPriority] = useState<number>(0);
  const [taskAssignee, setTaskAssignee] = useState('antigravity');
  const [taskStatus, setTaskStatus] = useState('todo');
  const [submitting, setSubmitting] = useState(false);

  const loadTasks = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchKanbanTasks();
      setTasks(data.tasks);
      setColumns(data.columns);
    } catch (e: any) {
      console.error('Failed to load kanban tasks', e);
      setError(e.message || 'Erreur de chargement du Kanban');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    fetchKanbanTasks()
      .then((data) => {
        if (active) {
          setTasks(data.tasks);
          setColumns(data.columns);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (active) {
          console.error('Failed to load kanban tasks', e);
          setError(e.message || 'Erreur de chargement du Kanban');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentWorkspace]);

  const openCreateModal = () => {
    setEditingTask(null);
    setTaskTitle('');
    setTaskBody('');
    setTaskPriority(0);
    setTaskAssignee('antigravity');
    setTaskStatus('todo');
    setIsModalOpen(true);
  };

  const openEditModal = (task: KanbanTask) => {
    setEditingTask(task);
    setTaskTitle(task.title);
    setTaskBody(task.body || '');
    setTaskPriority(task.priority || 0);
    setTaskAssignee(task.assignee || 'antigravity');
    setTaskStatus(task.status || 'todo');
    setIsModalOpen(true);
  };

  const handleSaveTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!taskTitle.trim()) return;

    setSubmitting(true);
    try {
      if (editingTask) {
        await updateKanbanTask(editingTask.id, {
          title: taskTitle.trim(),
          body: taskBody.trim(),
          priority: taskPriority,
          assignee: taskAssignee,
          status: taskStatus
        });
      } else {
        await createKanbanTask({
          title: taskTitle.trim(),
          body: taskBody.trim(),
          priority: taskPriority,
          assignee: taskAssignee,
          status: taskStatus,
          workspace_path: currentWorkspace
        });
      }
      setIsModalOpen(false);
      await loadTasks();
    } catch (e: any) {
      showToast(e.message || 'Erreur lors de la sauvegarde', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!(await showConfirm('Supprimer définitivement cette tâche ?', { destructive: true }))) return;
    try {
      await deleteKanbanTask(taskId);
      await loadTasks();
    } catch (e: any) {
      showToast(e.message || 'Erreur suppression', 'error');
    }
  };

  const handleMoveStatus = async (task: KanbanTask, newStatus: string) => {
    try {
      await updateKanbanTask(task.id, { status: newStatus });
      await loadTasks();
    } catch (e: any) {
      console.error('Failed to move task', e);
    }
  };

  const handleExecuteWithAntigravity = (task: KanbanTask) => {
    const prompt = task.body 
      ? `[TÂCHE KANBAN: ${task.title}]\n\n${task.body}`
      : `[TÂCHE KANBAN: ${task.title}]`;
    
    // Automatically advance task to 'running' if it was in 'todo'
    if (task.status === 'todo' || task.status === 'ready') {
      handleMoveStatus(task, 'running');
    }

    if (onExecutePrompt) {
      onExecutePrompt(prompt);
    }
  };

  const getPriorityBadge = (p: number) => {
    if (p >= 2) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-rose-500/20 text-rose-600 dark:text-rose-300 border border-rose-500/30">
          Urgent
        </span>
      );
    }
    if (p === 1) {
      return (
        <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30">
          Prioritaire
        </span>
      );
    }
    return (
      <span
        className="px-1.5 py-0.5 rounded text-[9px] font-medium border"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
          color: 'var(--muted)'
        }}
      >
        Normal
      </span>
    );
  };

  const filterTasks = React.useCallback((taskList: KanbanTask[]) => {
    if (!searchQuery.trim()) return taskList;
    const q = searchQuery.toLowerCase();
    return taskList.filter(
      t => t.title.toLowerCase().includes(q) || (t.body && t.body.toLowerCase().includes(q))
    );
  }, [searchQuery]);

  return (
    <div
      className="flex flex-col h-full"
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text)'
      }}
    >
      {/* Kanban Top Toolbar */}
      <div
        className="p-3 border-b flex items-center justify-between gap-2 shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="relative flex-1 max-w-xs">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Filtrer les tâches..."
            className="w-full border rounded-lg pl-8 pr-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
            style={{
              backgroundColor: 'var(--input-bg)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          />
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono hidden sm:inline" style={{ color: 'var(--muted)' }}>
            {tasks.length} {tasks.length > 1 ? 'tâches' : 'tâche'}
          </span>

          <button
            onClick={loadTasks}
            disabled={loading}
            className="p-1.5 rounded-lg border cursor-pointer transition-colors hover:bg-black/5 dark:hover:bg-white/5"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--muted)'
            }}
            title="Rafraîchir le tableau"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-600/20 cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tâche</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="m-3 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Kanban Board Columns */}
      <div className="flex-1 overflow-x-auto p-3 flex gap-3 scrollbar-thin">
        {/* Column 1: À Faire */}
        <div
          className="flex-1 min-w-[240px] max-w-[320px] flex flex-col border rounded-xl overflow-hidden shadow-xs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div
            className="px-3 py-2.5 border-b flex items-center justify-between"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-sky-400" />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>À faire</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/15 text-sky-600 dark:text-sky-300 border border-sky-500/20">
              {filterTasks(columns.todo).length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2.5 overflow-y-auto scrollbar-thin">
            {filterTasks(columns.todo).map(task => (
              <div
                key={task.id}
                className="group p-3 rounded-lg border transition-all shadow-xs hover:shadow-sm"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)'
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold leading-snug break-words" style={{ color: 'var(--strong)' }}>
                    {task.title}
                  </span>
                  {getPriorityBadge(task.priority)}
                </div>

                {task.body && (
                  <p className="text-[11px] line-clamp-3 mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {task.body}
                  </p>
                )}

                <div
                  className="flex items-center justify-between pt-2 border-t text-[10px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  <div className="flex items-center gap-1.5">
                    <User className="w-3 h-3 opacity-70" />
                    <span className="font-mono">@{task.assignee || 'antigravity'}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExecuteWithAntigravity(task)}
                      className="p-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 transition-colors cursor-pointer"
                      title="Exécuter avec Antigravity"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => openEditModal(task)}
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      style={{ color: 'var(--muted)' }}
                      title="Modifier"
                    >
                      <Edit3 className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleMoveStatus(task, 'running')}
                      className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                      style={{ color: 'var(--muted)' }}
                      title="Déplacer vers En cours"
                    >
                      <ChevronRight className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 2: En cours */}
        <div
          className="flex-1 min-w-[240px] max-w-[320px] flex flex-col border rounded-xl overflow-hidden shadow-xs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div
            className="px-3 py-2.5 border-b flex items-center justify-between"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>En cours</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/20">
              {filterTasks(columns.running).length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2.5 overflow-y-auto scrollbar-thin">
            {filterTasks(columns.running).map(task => (
              <div
                key={task.id}
                className="group p-3 rounded-lg border border-amber-500/30 bg-amber-500/5 dark:bg-amber-500/10 hover:border-amber-500/50 transition-all shadow-xs hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-300 leading-snug break-words">
                    {task.title}
                  </span>
                  {getPriorityBadge(task.priority)}
                </div>

                {task.body && (
                  <p className="text-[11px] line-clamp-3 mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {task.body}
                  </p>
                )}

                <div
                  className="flex items-center justify-between pt-2 border-t text-[10px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  <button
                    onClick={() => handleMoveStatus(task, 'todo')}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                    title="Revenir à Faire"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExecuteWithAntigravity(task)}
                      className="p-1 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 dark:text-amber-400 border border-amber-500/30 transition-colors cursor-pointer"
                      title="Reprendre dans Antigravity"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleMoveStatus(task, 'blocked')}
                      className="p-1 rounded hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 transition-colors cursor-pointer"
                      title="Marquer Bloqué"
                    >
                      <AlertTriangle className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleMoveStatus(task, 'done')}
                      className="p-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-300 transition-colors cursor-pointer"
                      title="Marquer Terminé"
                    >
                      <CheckCircle2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 3: Bloqué */}
        <div
          className="flex-1 min-w-[240px] max-w-[320px] flex flex-col border rounded-xl overflow-hidden shadow-xs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div
            className="px-3 py-2.5 border-b flex items-center justify-between"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-rose-500" />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>Bloqué</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/15 text-rose-600 dark:text-rose-300 border border-rose-500/20">
              {filterTasks(columns.blocked).length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2.5 overflow-y-auto scrollbar-thin">
            {filterTasks(columns.blocked).map(task => (
              <div
                key={task.id}
                className="group p-3 rounded-lg border border-rose-500/30 bg-rose-500/5 dark:bg-rose-500/10 hover:border-rose-500/50 transition-all shadow-xs hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-rose-700 dark:text-rose-300 leading-snug break-words">
                    {task.title}
                  </span>
                  {getPriorityBadge(task.priority)}
                </div>

                {task.body && (
                  <p className="text-[11px] line-clamp-3 mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {task.body}
                  </p>
                )}

                <div
                  className="flex items-center justify-between pt-2 border-t text-[10px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  <button
                    onClick={() => handleMoveStatus(task, 'todo')}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                    title="Débloquer vers À faire"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleExecuteWithAntigravity(task)}
                      className="p-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-600 dark:text-sky-400 border border-sky-500/30 transition-colors cursor-pointer"
                      title="Résoudre le blocage avec Antigravity"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="p-1 rounded hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 transition-colors cursor-pointer"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Column 4: Terminé */}
        <div
          className="flex-1 min-w-[240px] max-w-[320px] flex flex-col border rounded-xl overflow-hidden shadow-xs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div
            className="px-3 py-2.5 border-b flex items-center justify-between"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>Terminé</span>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/20">
              {filterTasks(columns.done).length}
            </span>
          </div>

          <div className="flex-1 p-2 space-y-2.5 overflow-y-auto scrollbar-thin">
            {filterTasks(columns.done).map(task => (
              <div
                key={task.id}
                className="group p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 transition-all shadow-xs opacity-85 hover:opacity-100"
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-300 line-through decoration-emerald-500/60 leading-snug break-words">
                    {task.title}
                  </span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                </div>

                {task.body && (
                  <p className="text-[11px] line-clamp-2 mb-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                    {task.body}
                  </p>
                )}

                <div
                  className="flex items-center justify-between pt-2 border-t text-[10px]"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                >
                  <button
                    onClick={() => handleMoveStatus(task, 'running')}
                    className="p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                    title="Rouvrir la tâche"
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>

                  <button
                    onClick={() => handleDeleteTask(task.id)}
                    className="p-1 rounded hover:bg-rose-500/20 text-rose-500 dark:text-rose-400 transition-colors cursor-pointer"
                    title="Supprimer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create / Edit Task Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div
            className="border rounded-2xl w-full max-w-lg shadow-2xl p-5 animate-fadeIn"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <div
              className="flex items-center justify-between pb-3 border-b"
              style={{ borderColor: 'var(--border)' }}
            >
              <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                {editingTask ? <Edit3 className="w-4 h-4 text-sky-500" /> : <Plus className="w-4 h-4 text-sky-500" />}
                <span>{editingTask ? 'Modifier la tâche' : 'Nouvelle tâche Kanban'}</span>
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="mt-4 space-y-3.5">
              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                  Titre de la tâche *
                </label>
                <input
                  type="text"
                  required
                  value={taskTitle}
                  onChange={e => setTaskTitle(e.target.value)}
                  placeholder="ex: Implémenter l'authentification OAuth2"
                  className="w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                  Description / Instructions pour Antigravity
                </label>
                <textarea
                  rows={4}
                  value={taskBody}
                  onChange={e => setTaskBody(e.target.value)}
                  placeholder="Spécifiez les fichiers à modifier, contraintes techniques ou critères d'acceptation..."
                  className="w-full border rounded-lg p-3 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 font-mono"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Priorité
                  </label>
                  <select
                    value={taskPriority}
                    onChange={e => setTaskPriority(Number(e.target.value))}
                    className="w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value={0}>⚪ Normal</option>
                    <option value={1}>🟡 Prioritaire</option>
                    <option value={2}>🔴 Urgent</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Assigné à
                  </label>
                  <input
                    type="text"
                    value={taskAssignee}
                    onChange={e => setTaskAssignee(e.target.value)}
                    placeholder="antigravity"
                    className="w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500"
                    style={{
                      backgroundColor: 'var(--bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Statut
                  </label>
                  <select
                    value={taskStatus}
                    onChange={e => setTaskStatus(e.target.value)}
                    className="w-full border rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
                    style={{
                      backgroundColor: 'var(--bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value="todo">À faire</option>
                    <option value="running">En cours</option>
                    <option value="blocked">Bloqué</option>
                    <option value="done">Terminé</option>
                  </select>
                </div>
              </div>

              <div
                className="flex items-center justify-end gap-2 pt-3 border-t"
                style={{ borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 text-xs font-medium cursor-pointer transition-colors"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submitting || !taskTitle.trim()}
                  className="px-4 py-1.5 rounded-lg bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white text-xs font-semibold shadow-md shadow-sky-600/30 cursor-pointer transition-all disabled:opacity-50"
                >
                  {submitting ? 'Enregistrement...' : editingTask ? 'Mettre à jour' : 'Créer la tâche'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
