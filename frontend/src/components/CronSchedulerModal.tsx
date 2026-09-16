import React, { useState, useEffect } from 'react';
import { 
  X, 
  Clock, 
  Play, 
  Pause, 
  Trash2, 
  Plus, 
  Calendar, 
  RefreshCw,
  Sparkles,
  Timer,
  AlertCircle,
  Pencil,
  Check,
  FileText,
  MessageSquare
} from 'lucide-react';
import type { CronJobItem, CronListResponse } from '../services/api';
import { 
  fetchCronJobs, 
  createCronJob, 
  updateCronJob, 
  deleteCronJob, 
  triggerCronJob,
  fetchCronJobLog
} from '../services/api';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

interface CronSchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecutePrompt?: (prompt: string) => void;
}

const SCHEDULE_PRESETS = [
  { label: 'Toutes les 5 minutes', expr: '*/5 * * * *' },
  { label: 'Toutes les 15 minutes', expr: '*/15 * * * *' },
  { label: 'Toutes les heures', expr: '0 * * * *' },
  { label: 'Tous les jours à 09:00 UTC', expr: '0 9 * * *' },
  { label: 'Tous les lundis à 08:00 UTC', expr: '0 8 * * 1' },
  { label: 'Personnalisé (Cron)', expr: 'custom' },
];

export const CronSchedulerModal: React.FC<CronSchedulerModalProps> = ({
  isOpen,
  onClose,
  onExecutePrompt
}) => {
  const [cronData, setCronData] = useState<CronListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state (création)
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [preset, setPreset] = useState(SCHEDULE_PRESETS[1].expr);
  const [customExpr, setCustomExpr] = useState('*/15 * * * *');
  const [submitting, setSubmitting] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  // Form state (édition)
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPrompt, setEditPrompt] = useState('');
  const [editPreset, setEditPreset] = useState(SCHEDULE_PRESETS[1].expr);
  const [editCustomExpr, setEditCustomExpr] = useState('*/15 * * * *');
  const [editSaving, setEditSaving] = useState(false);

  // Log viewer state
  const [selectedLogJobId, setSelectedLogJobId] = useState<string | null>(null);
  const [selectedLogContent, setSelectedLogContent] = useState<string | null>(null);
  const [loadingLog, setLoadingLog] = useState(false);

  const loadCrons = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCronJobs();
      setCronData(data);
    } catch (e: any) {
      console.error('Failed to load cron jobs', e);
      setError(e.message || 'Erreur lors du chargement des tâches planifiées');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchCronJobs()
      .then((data) => {
        if (active) {
          setCronData(data);
          setLoading(false);
        }
      })
      .catch((e: any) => {
        if (active) {
          console.error('Failed to load cron jobs', e);
          setError(e.message || 'Erreur lors du chargement des tâches planifiées');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    const finalExpr = preset === 'custom' ? customExpr.trim() : preset;
    if (!finalExpr) return;

    setSubmitting(true);
    try {
      await createCronJob({
        name: name.trim(),
        prompt: prompt.trim(),
        schedule: finalExpr,
        deliver: 'local'
      });
      setName('');
      setPrompt('');
      setActionNotice('Tâche planifiée créée avec succès');
      setTimeout(() => setActionNotice(null), 3000);
      await loadCrons();
    } catch (e: any) {
      showToast(e.message || 'Erreur création', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleState = async (job: CronJobItem) => {
    const isCurrentlyActive = job.state === 'scheduled' && (job.enabled !== false);
    const nextState = isCurrentlyActive ? 'paused' : 'scheduled';

    // Optimistic UI update
    setCronData(prev => prev ? ({
      ...prev,
      jobs: prev.jobs.map(j => j.id === job.id ? {
        ...j,
        state: nextState,
        enabled: nextState === 'scheduled',
        next_run_at: nextState === 'paused' ? null : j.next_run_at
      } : j)
    }) : null);

    try {
      await updateCronJob(job.id, { state: nextState });
      showToast(nextState === 'paused' ? 'Tâche mise en pause' : 'Tâche réactivée', 'info');
      await loadCrons();
    } catch (e: any) {
      showToast(e.message || 'Erreur modification statut', 'error');
      await loadCrons();
    }
  };

  const handleDelete = async (jobId: string) => {
    if (!(await showConfirm('Supprimer cette tâche planifiée ?', { destructive: true }))) return;
    try {
      await deleteCronJob(jobId);
      await loadCrons();
    } catch (e: any) {
      showToast(e.message || 'Erreur suppression', 'error');
    }
  };

  const handleTriggerNow = async (job: CronJobItem) => {
    try {
      await triggerCronJob(job.id);
      setActionNotice(`⚡ Exécution en tâche de fond lancée pour "${job.name}"`);
      setTimeout(() => setActionNotice(null), 3500);
      await loadCrons();
    } catch (e: any) {
      showToast(e.message || 'Erreur déclenchement', 'error');
    }
  };

  const handleTestInChat = (job: CronJobItem) => {
    if (onExecutePrompt && job.prompt) {
      onExecutePrompt(`[TEST MANUEL CRON: ${job.name}]\n\n${job.prompt}`);
      onClose();
    }
  };

  const handleToggleLog = async (job: CronJobItem) => {
    if (selectedLogJobId === job.id) {
      setSelectedLogJobId(null);
      setSelectedLogContent(null);
      return;
    }
    setSelectedLogJobId(job.id);
    setLoadingLog(true);
    setSelectedLogContent(null);
    try {
      const res = await fetchCronJobLog(job.id);
      setSelectedLogContent(res.content || 'Aucun contenu de journal disponible.');
    } catch (err: any) {
      setSelectedLogContent(`Erreur lors de la récupération du journal: ${err.message || err}`);
    } finally {
      setLoadingLog(false);
    }
  };

  const handleStartEdit = (job: CronJobItem) => {
    const expr = job.schedule_display || job.schedule?.expr || job.schedule?.display || '';
    const matchedPreset = SCHEDULE_PRESETS.find(p => p.expr !== 'custom' && p.expr === expr);
    setEditingJobId(job.id);
    setEditName(job.name);
    setEditPrompt(job.prompt);
    if (matchedPreset) {
      setEditPreset(matchedPreset.expr);
      setEditCustomExpr(matchedPreset.expr);
    } else {
      setEditPreset('custom');
      setEditCustomExpr(expr);
    }
  };

  const handleCancelEdit = () => {
    setEditingJobId(null);
  };

  const handleSaveEdit = async (jobId: string) => {
    const finalExpr = editPreset === 'custom' ? editCustomExpr.trim() : editPreset;
    if (!editName.trim() || !editPrompt.trim() || !finalExpr) return;
    setEditSaving(true);
    try {
      await updateCronJob(jobId, {
        name: editName.trim(),
        prompt: editPrompt.trim(),
        schedule: finalExpr,
      });
      setEditingJobId(null);
      setActionNotice('Tâche mise à jour avec succès ✓');
      setTimeout(() => setActionNotice(null), 3000);
      await loadCrons();
    } catch (e: any) {
      showToast(e.message || 'Erreur mise à jour', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const formatDateTime = (iso?: string | null) => {
    if (!iso) return 'Non planifié';
    try {
      const d = new Date(iso);
      return d.toLocaleString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-2 sm:p-4 safe-pt safe-pb">
      <div
        className="border rounded-2xl sm:rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[95dvh] sm:max-h-[90vh] animate-fadeIn"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="p-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl border flex items-center justify-center"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent-bg-strong)',
                color: 'var(--accent)'
              }}
            >
              <Clock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                <span>Planificateur de Tâches & Crons Autonomes</span>
                {cronData?.ticker_status === 'active' ? (
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Ticker Actif
                  </span>
                ) : (
                  <span className="text-[10px] font-medium text-amber-500 bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 rounded-full">
                    En veille
                  </span>
                )}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                Orchestrez l'exécution périodique de tâches en arrière-plan, directement via Antigravity
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadCrons}
              disabled={loading}
              className="p-1.5 rounded-lg border transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} style={{ color: loading ? 'var(--accent)' : undefined }} />
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

        {error && (
          <div className="mx-5 mt-4 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg text-xs text-rose-500 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {actionNotice && (
          <div
            className="mx-5 mt-4 p-2.5 rounded-lg text-xs flex items-center gap-2 border"
            style={{
              backgroundColor: 'var(--accent-bg)',
              borderColor: 'var(--accent)',
              color: 'var(--accent-text)'
            }}
          >
            <Sparkles className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
            <span>{actionNotice}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6 scrollbar-thin">
          {/* New Job Form */}
          <div
            className="p-4 rounded-xl border"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            <h3 className="text-xs font-bold uppercase tracking-wider mb-3 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
              <Plus className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              <span>Programmer une nouvelle tâche</span>
            </h3>

            <form onSubmit={handleCreate} className="space-y-3.5">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Nom de la tâche *
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="ex: Vérification des logs et santé système"
                    className="w-full border rounded-lg px-3 py-2 text-xs placeholder-slate-400 focus:outline-none focus:ring-1"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Fréquence d'exécution
                  </label>
                  <select
                    value={preset}
                    onChange={e => {
                      setPreset(e.target.value);
                      if (e.target.value !== 'custom') {
                        setCustomExpr(e.target.value);
                      }
                    }}
                    className="w-full border rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-1 cursor-pointer"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                    {SCHEDULE_PRESETS.map((p, idx) => (
                      <option key={idx} value={p.expr} style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                        {p.label} {p.expr !== 'custom' ? `(${p.expr})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {preset === 'custom' && (
                <div>
                  <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                    Expression Cron (Minute Heure Jour Mois JourSemaine)
                  </label>
                  <input
                    type="text"
                    required
                    value={customExpr}
                    onChange={e => setCustomExpr(e.target.value)}
                    placeholder="*/15 * * * *"
                    className="w-full border rounded-lg px-3 py-2 text-xs font-mono text-amber-500 focus:outline-none focus:border-amber-500"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>
              )}

              <div>
                <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--text)' }}>
                  Prompt d'instructions à exécuter de manière autonome *
                </label>
                <textarea
                  rows={3}
                  required
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  placeholder="ex: Examine les métriques système, vérifie l'absence d'erreurs dans les logs d'aujourd'hui et résume la situation..."
                  className="w-full border rounded-lg p-3 text-xs placeholder-slate-400 focus:outline-none focus:ring-1 font-mono"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting || !name.trim() || !prompt.trim()}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-white text-xs font-semibold shadow-md cursor-pointer transition-all disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{submitting ? 'Création en cours...' : 'Ajouter la tâche au planificateur'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Jobs List */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                <Timer className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span>Tâches planifiées actives ({cronData?.jobs.length || 0})</span>
              </h3>
            </div>

            {loading || cronData === null ? (
              <div
                className="p-8 text-center rounded-xl border flex flex-col items-center justify-center gap-2"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
                <p className="text-xs font-medium" style={{ color: 'var(--muted)' }}>
                  Chargement des tâches planifiées...
                </p>
              </div>
            ) : cronData.jobs.length === 0 ? (
              <div
                className="p-8 text-center rounded-xl border"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <Calendar className="w-8 h-8 mx-auto mb-2 opacity-50" style={{ color: 'var(--muted)' }} />
                <p className="text-xs font-medium" style={{ color: 'var(--strong)' }}>Aucune tâche planifiée configurée</p>
                <p className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
                  Remplissez le formulaire ci-dessus pour automatiser des tâches régulières.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {cronData?.jobs.map(job => {
                  const isScheduled = job.state === 'scheduled' && (job.enabled !== false);
                  return (
                    <div
                      key={job.id}
                      className="p-4 rounded-xl border transition-all shadow-sm"
                      style={{
                        backgroundColor: isScheduled ? 'var(--surface)' : 'var(--surface-subtle)',
                        borderColor: isScheduled ? 'var(--border2)' : 'var(--border)',
                        opacity: isScheduled ? 1 : 0.8
                      }}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-xs truncate max-w-[150px] sm:max-w-[200px]" style={{ color: 'var(--strong)' }} title={job.name}>{job.name}</span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-mono font-medium ${
                                isScheduled
                                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30'
                                  : 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {job.schedule_display || (typeof job.schedule === 'string' ? job.schedule : job.schedule?.display || job.schedule?.expr || 'interval')}
                            </span>
                            {isScheduled ? (
                              <span className="text-[10px] text-emerald-500 font-semibold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                Actif
                              </span>
                            ) : (
                              <span className="text-[10px] text-amber-500 font-semibold">En pause</span>
                            )}
                          </div>
                          <p className="text-[11px] mt-1 line-clamp-2 font-mono" style={{ color: 'var(--muted)' }}>
                            {job.prompt}
                          </p>
                        </div>

                        <div className="flex items-center justify-end gap-1.5 shrink-0 flex-wrap">
                          <button
                            onClick={() => handleTriggerNow(job)}
                            className="p-1.5 rounded-lg border transition-colors cursor-pointer text-xs flex items-center gap-1"
                            style={{
                              backgroundColor: 'var(--accent-bg)',
                              borderColor: 'var(--accent)',
                              color: 'var(--accent-text)'
                            }}
                            title="Lancer en tâche de fond immédiatement"
                          >
                            <Play className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-semibold hidden sm:inline">Exécuter</span>
                          </button>

                          {onExecutePrompt && (
                            <button
                              onClick={() => handleTestInChat(job)}
                              className="p-1.5 rounded-lg border transition-colors cursor-pointer text-xs flex items-center gap-1 hover:opacity-100 opacity-70"
                              style={{
                                backgroundColor: 'var(--surface-subtle)',
                                borderColor: 'var(--border)',
                                color: 'var(--text)'
                              }}
                              title="Tester le prompt dans le chat actif"
                            >
                              <MessageSquare className="w-3.5 h-3.5" />
                              <span className="text-[10px] font-medium hidden md:inline">Tester</span>
                            </button>
                          )}

                          <button
                            onClick={() => handleToggleLog(job)}
                            className="p-1.5 rounded-lg border transition-colors cursor-pointer text-xs flex items-center gap-1 hover:opacity-100 opacity-70"
                            style={{
                              backgroundColor: selectedLogJobId === job.id ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                              borderColor: selectedLogJobId === job.id ? 'var(--accent)' : 'var(--border)',
                              color: selectedLogJobId === job.id ? 'var(--accent)' : 'var(--text)'
                            }}
                            title="Consulter le journal d'exécution"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span className="text-[10px] font-medium hidden md:inline">Logs</span>
                          </button>

                          <button
                            onClick={() => handleToggleState(job)}
                            className="p-1.5 rounded-lg border transition-colors cursor-pointer hover:opacity-100 opacity-70"
                            style={{
                              backgroundColor: 'var(--surface-subtle)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)'
                            }}
                            title={isScheduled ? 'Mettre en pause' : 'Réactiver la tâche'}
                          >
                            {isScheduled ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                          </button>

                          <button
                            onClick={() => editingJobId === job.id ? handleCancelEdit() : handleStartEdit(job)}
                            className="p-1.5 rounded-lg border transition-colors cursor-pointer hover:opacity-100 opacity-70"
                            style={{
                              backgroundColor: editingJobId === job.id ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                              borderColor: editingJobId === job.id ? 'var(--accent)' : 'var(--border)',
                              color: editingJobId === job.id ? 'var(--accent)' : 'var(--text)'
                            }}
                            title={editingJobId === job.id ? 'Annuler l\'édition' : 'Modifier la tâche'}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDelete(job.id)}
                            className="p-1.5 rounded-lg hover:bg-rose-500/20 text-rose-500 transition-colors cursor-pointer"
                            title="Supprimer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div
                        className="flex items-center gap-4 text-[10px] pt-2 border-t flex-wrap"
                        style={{
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)'
                        }}
                      >
                        <span>Prochaine exécution : <strong style={{ color: 'var(--strong)' }}>{!isScheduled ? 'En pause' : formatDateTime(job.next_run_at)}</strong></span>
                        {job.last_run_at && (
                          <span>Dernier passage : <strong style={{ color: 'var(--strong)' }}>{formatDateTime(job.last_run_at)}</strong></span>
                        )}
                        {job.last_status && (
                          <span className="capitalize">Statut : <strong style={{ color: 'var(--accent)' }}>{job.last_status}</strong></span>
                        )}
                        {job.last_duration_seconds != null && (
                          <span>Durée : <strong style={{ color: 'var(--strong)' }}>{job.last_duration_seconds}s</strong></span>
                        )}
                      </div>

                      {/* Affichage du journal d'exécution */}
                      {selectedLogJobId === job.id && (
                        <div
                          className="mt-3 p-3 rounded-xl border text-xs font-mono"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)'
                          }}
                        >
                          <div className="flex items-center justify-between pb-2 mb-2 border-b text-[10px] font-sans" style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}>
                            <span className="font-semibold flex items-center gap-1.5" style={{ color: 'var(--strong)' }}>
                              <FileText className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} /> Journal de la tâche ({job.name})
                            </span>
                            <button
                              onClick={() => setSelectedLogJobId(null)}
                              className="text-[10px] hover:underline cursor-pointer opacity-70 hover:opacity-100"
                            >
                              Fermer
                            </button>
                          </div>
                          {loadingLog ? (
                            <p className="text-muted text-[11px] animate-pulse">Chargement du journal d'exécution...</p>
                          ) : (
                            <pre className="whitespace-pre-wrap overflow-x-auto max-h-52 text-[11px] leading-relaxed select-text p-2 rounded-lg bg-black/20" style={{ color: 'var(--text)' }}>
                              {selectedLogContent}
                            </pre>
                          )}
                        </div>
                      )}

                      {/* Formulaire d'édition inline */}
                      {editingJobId === job.id && (
                        <div
                          className="mt-3 pt-3 border-t space-y-3"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <p className="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
                            <Pencil className="w-3 h-3" /> Modifier la tâche
                          </p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text)' }}>Nom</label>
                              <input
                                type="text"
                                value={editName}
                                onChange={e => setEditName(e.target.value)}
                                className="w-full border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1"
                                style={{
                                  backgroundColor: 'var(--surface)',
                                  borderColor: 'var(--border)',
                                  color: 'var(--text)'
                                }}
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text)' }}>Fréquence</label>
                              <select
                                value={editPreset}
                                onChange={e => {
                                  setEditPreset(e.target.value);
                                  if (e.target.value !== 'custom') setEditCustomExpr(e.target.value);
                                }}
                                className="w-full border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-1 cursor-pointer"
                                style={{
                                  backgroundColor: 'var(--surface)',
                                  borderColor: 'var(--border)',
                                  color: 'var(--text)'
                                }}
                              >
                                {SCHEDULE_PRESETS.map((p, idx) => (
                                  <option key={idx} value={p.expr} style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                                    {p.label} {p.expr !== 'custom' ? `(${p.expr})` : ''}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          {editPreset === 'custom' && (
                            <div>
                              <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text)' }}>Expression Cron personnalisée</label>
                              <input
                                type="text"
                                value={editCustomExpr}
                                onChange={e => setEditCustomExpr(e.target.value)}
                                placeholder="*/15 * * * *"
                                className="w-full border rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none"
                                style={{
                                  backgroundColor: 'var(--surface)',
                                  borderColor: 'var(--border)',
                                  color: 'var(--accent)'
                                }}
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--text)' }}>Prompt</label>
                            <textarea
                              rows={3}
                              value={editPrompt}
                              onChange={e => setEditPrompt(e.target.value)}
                              className="w-full border rounded-lg p-2 text-xs font-mono focus:outline-none focus:ring-1"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                                color: 'var(--text)'
                              }}
                            />
                          </div>

                          <div className="flex justify-end gap-2">
                            <button
                              onClick={handleCancelEdit}
                              className="px-3 py-1.5 rounded-lg border text-xs cursor-pointer hover:opacity-80 transition-opacity"
                              style={{
                                backgroundColor: 'var(--surface-subtle)',
                                borderColor: 'var(--border)',
                                color: 'var(--text)'
                              }}
                            >
                              Annuler
                            </button>
                            <button
                              onClick={() => handleSaveEdit(job.id)}
                              disabled={editSaving || !editName.trim() || !editPrompt.trim()}
                              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-xs font-semibold cursor-pointer transition-all disabled:opacity-50"
                              style={{ backgroundColor: 'var(--accent)' }}
                            >
                              <Check className="w-3.5 h-3.5" />
                              {editSaving ? 'Sauvegarde...' : 'Enregistrer'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
