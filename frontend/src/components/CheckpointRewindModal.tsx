import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Clock,
  RotateCcw,
  GitFork,
  Plus,
  Trash2,
  ChevronRight,
  History,
  Zap,
  FileCode,
  Wrench,
  AlertTriangle,
  Check,
  Loader2,
  Tag,
  Package,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import {
  listCheckpoints,
  createCheckpoint,
  getCheckpointDetail,
  restoreCheckpoint,
  forkFromCheckpoint,
  deleteCheckpointApi,
} from '../services/api';
import type { Checkpoint, CheckpointDetail } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface CheckpointRewindModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversationId: string;
  onSelectConversation?: (conversationId: string) => void;
}

export const CheckpointRewindModal: React.FC<CheckpointRewindModalProps> = ({
  isOpen,
  onClose,
  currentConversationId,
  onSelectConversation,
}) => {
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CheckpointDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // Create checkpoint form
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createLabel, setCreateLabel] = useState('');
  const [creating, setCreating] = useState(false);

  // Confirm dialog
  const [confirmAction, setConfirmAction] = useState<'restore' | 'delete' | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fork title input
  const [showForkInput, setShowForkInput] = useState(false);
  const [forkTitle, setForkTitle] = useState('');

  const loadCheckpoints = useCallback(async () => {
    if (!currentConversationId) return;
    setLoading(true);
    try {
      const res = await listCheckpoints(currentConversationId);
      setCheckpoints(res);
    } catch (err: any) {
      showToast(err.message || t('checkpoint_load_error', 'Impossible de charger les checkpoints'), 'error');
    } finally {
      setLoading(false);
    }
  }, [currentConversationId, t]);

  useEffect(() => {
    if (!isOpen || !currentConversationId) return;
    let isCancelled = false;
    listCheckpoints(currentConversationId)
      .then((res) => {
        if (!isCancelled) {
          setCheckpoints(res);
        }
      })
      .catch((err: any) => {
        if (!isCancelled) {
          showToast(err.message || t('checkpoint_load_error', 'Impossible de charger les checkpoints'), 'error');
        }
      });

    return () => {
      isCancelled = true;
      setSelectedId(null);
      setDetail(null);
      setShowCreateForm(false);
      setConfirmAction(null);
      setShowForkInput(false);
    };
  }, [isOpen, currentConversationId, t]);

  // ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (confirmAction) {
          setConfirmAction(null);
          setConfirmTarget(null);
        } else if (showForkInput) {
          setShowForkInput(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, confirmAction, showForkInput]);

  // Load detail
  const handleSelectCheckpoint = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setShowForkInput(false);
    try {
      const d = await getCheckpointDetail(currentConversationId, id);
      setDetail(d);
    } catch (err: any) {
      showToast(err.message || t('checkpoint_detail_error', 'Impossible de charger les détails'), 'error');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, [currentConversationId, t]);

  // Create checkpoint
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await createCheckpoint(currentConversationId, createLabel.trim());
      showToast(t('checkpoint_created', 'Checkpoint créé avec succès'), 'success');
      setCreateLabel('');
      setShowCreateForm(false);
      await loadCheckpoints();
    } catch (err: any) {
      showToast(err.message || t('checkpoint_create_error', 'Erreur lors de la création'), 'error');
    } finally {
      setCreating(false);
    }
  };

  // Restore
  const handleRestore = async () => {
    if (!confirmTarget) return;
    setActionLoading(true);
    try {
      const res = await restoreCheckpoint(currentConversationId, confirmTarget);
      showToast(res.message || t('checkpoint_restored', 'Conversation restaurée avec succès'), 'success');
      setConfirmAction(null);
      setConfirmTarget(null);
      if (onSelectConversation) {
        onSelectConversation(currentConversationId);
      }
      onClose();
    } catch (err: any) {
      showToast(err.message || t('checkpoint_restore_error', 'Erreur lors de la restauration'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Fork
  const handleFork = async () => {
    if (!selectedId) return;
    setActionLoading(true);
    try {
      const res = await forkFromCheckpoint(currentConversationId, selectedId, forkTitle.trim() || undefined);
      showToast(t('checkpoint_forked', 'Bifurcation créée avec succès'), 'success');
      setShowForkInput(false);
      setForkTitle('');
      if (onSelectConversation && res.new_conversation_id) {
        onSelectConversation(res.new_conversation_id);
        onClose();
      }
    } catch (err: any) {
      showToast(err.message || t('checkpoint_fork_error', 'Erreur lors de la bifurcation'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    if (!confirmTarget) return;
    setActionLoading(true);
    try {
      await deleteCheckpointApi(currentConversationId, confirmTarget);
      showToast(t('checkpoint_deleted', 'Checkpoint supprimé'), 'info');
      setConfirmAction(null);
      setConfirmTarget(null);
      if (selectedId === confirmTarget) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadCheckpoints();
    } catch (err: any) {
      showToast(err.message || t('checkpoint_delete_error', 'Erreur lors de la suppression'), 'error');
    } finally {
      setActionLoading(false);
    }
  };

  // Agent state badge
  const agentStateBadge = (state: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      running: { bg: 'rgba(34,197,94,0.1)', text: '#22c55e', border: 'rgba(34,197,94,0.3)' },
      idle: { bg: 'rgba(234,179,8,0.1)', text: '#eab308', border: 'rgba(234,179,8,0.3)' },
      completed: { bg: 'rgba(99,102,241,0.1)', text: '#6366f1', border: 'rgba(99,102,241,0.3)' },
    };
    const c = colors[state] || colors.idle;
    const labels: Record<string, string> = {
      running: t('checkpoint_state_running', 'En cours'),
      idle: t('checkpoint_state_idle', 'Inactif'),
      completed: t('checkpoint_state_completed', 'Terminé'),
    };
    return (
      <span
        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full border"
        style={{ backgroundColor: c.bg, color: c.text, borderColor: c.border }}
      >
        {labels[state] || state}
      </span>
    );
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) +
        ' ' +
        d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return ts;
    }
  };

  const formatTokens = (n: number) => {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn select-none">
      <div
        className="w-full max-w-5xl max-h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-scaleIn"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--strong)' }}>
                  {t('checkpoint_title', 'Checkpoint & Rewind Studio')}
                </h2>
                <span
                  className="text-[11px] font-mono px-2 py-0.5 rounded-full border"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--muted)',
                  }}
                >
                  {checkpoints.length} {checkpoints.length > 1
                    ? t('checkpoint_count_plural', 'checkpoints')
                    : t('checkpoint_count_singular', 'checkpoint')}
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('checkpoint_desc', 'Capturez, restaurez et bifurquez des états d\'exécution de la session')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-105"
              style={{
                backgroundColor: 'rgba(34,197,94,0.1)',
                borderColor: 'rgba(34,197,94,0.3)',
                color: '#22c55e',
              }}
              title={t('checkpoint_create', 'Créer un checkpoint')}
            >
              <Plus className="w-3.5 h-3.5" />
              {t('checkpoint_create', 'Créer un checkpoint')}
            </button>
            <button
              onClick={loadCheckpoints}
              className="p-2 rounded-lg border transition-colors hover:opacity-80"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}
              title={t('checkpoint_refresh', 'Actualiser')}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors hover:opacity-80"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Create Checkpoint Form */}
        {showCreateForm && (
          <div
            className="px-5 py-3 border-b"
            style={{ borderColor: 'var(--border)', backgroundColor: 'rgba(34,197,94,0.03)' }}
          >
            <form onSubmit={handleCreate} className="flex items-center gap-3">
              <Tag className="w-4 h-4 shrink-0" style={{ color: '#22c55e' }} />
              <input
                type="text"
                value={createLabel}
                onChange={(e) => setCreateLabel(e.target.value)}
                placeholder={t('checkpoint_label_placeholder', 'Étiquette du checkpoint (optionnel)...')}
                className="flex-1 text-sm px-3 py-1.5 rounded-lg border bg-transparent outline-none focus:ring-1"
                style={{
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--text)',
                }}
                autoFocus
              />
              <button
                type="submit"
                disabled={creating}
                className="px-4 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-105 disabled:opacity-50"
                style={{
                  backgroundColor: 'rgba(34,197,94,0.15)',
                  borderColor: 'rgba(34,197,94,0.4)',
                  color: '#22c55e',
                }}
              >
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('checkpoint_save', 'Sauvegarder')}
              </button>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="text-xs px-2 py-1.5 rounded-lg hover:opacity-80"
                style={{ color: 'var(--muted)' }}
              >
                {t('checkpoint_cancel', 'Annuler')}
              </button>
            </form>
          </div>
        )}

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left Panel — Timeline */}
          <div
            className="w-[340px] shrink-0 border-r overflow-y-auto"
            style={{ borderColor: 'var(--border)' }}
          >
            {loading ? (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--muted)' }} />
              </div>
            ) : checkpoints.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 gap-3 px-6 text-center">
                <History className="w-8 h-8" style={{ color: 'var(--muted)', opacity: 0.5 }} />
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {t('checkpoint_empty', 'Aucun checkpoint enregistré')}
                </p>
                <p className="text-xs" style={{ color: 'var(--muted)', opacity: 0.7 }}>
                  {t('checkpoint_empty_hint', 'Créez un checkpoint pour sauvegarder l\'état actuel de votre session')}
                </p>
              </div>
            ) : (
              <div className="py-2">
                {checkpoints.map((cp, idx) => {
                  const isSelected = selectedId === cp.id;
                  const isFirst = idx === 0;
                  return (
                    <button
                      key={cp.id}
                      onClick={() => handleSelectCheckpoint(cp.id)}
                      className="w-full text-left px-4 py-3 flex items-start gap-3 transition-all group relative"
                      style={{
                        backgroundColor: isSelected ? 'var(--surface-subtle)' : 'transparent',
                        borderLeft: isSelected ? '3px solid #f59e0b' : '3px solid transparent',
                      }}
                    >
                      {/* Timeline dot */}
                      <div className="flex flex-col items-center shrink-0 mt-1">
                        <div
                          className="w-3 h-3 rounded-full border-2"
                          style={{
                            borderColor: isSelected ? '#f59e0b' : cp.auto_generated ? 'var(--border)' : '#6366f1',
                            backgroundColor: isSelected
                              ? '#f59e0b'
                              : cp.auto_generated
                                ? 'transparent'
                                : 'rgba(99,102,241,0.3)',
                          }}
                        />
                        {idx < checkpoints.length - 1 && (
                          <div
                            className="w-0.5 h-8 mt-1"
                            style={{ backgroundColor: 'var(--border-subtle)' }}
                          />
                        )}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span
                            className="text-sm font-medium truncate"
                            style={{ color: isSelected ? 'var(--strong)' : 'var(--text)' }}
                          >
                            {cp.label}
                          </span>
                          {cp.auto_generated && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded font-mono border"
                              style={{
                                backgroundColor: 'rgba(156,163,175,0.1)',
                                borderColor: 'rgba(156,163,175,0.2)',
                                color: 'var(--muted)',
                              }}
                            >
                              auto
                            </span>
                          )}
                          {isFirst && (
                            <span
                              className="text-[9px] px-1 py-0.5 rounded font-medium border"
                              style={{
                                backgroundColor: 'rgba(245,158,11,0.1)',
                                borderColor: 'rgba(245,158,11,0.3)',
                                color: '#f59e0b',
                              }}
                            >
                              {t('checkpoint_latest', 'dernier')}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
                          <span className="flex items-center gap-0.5">
                            <Clock className="w-3 h-3" />
                            {formatDate(cp.timestamp)}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 mt-1 text-[10px]" style={{ color: 'var(--muted)' }}>
                          <span>step {cp.step_index}</span>
                          <span>·</span>
                          <span>{formatTokens(cp.token_count)} tokens</span>
                          <span>·</span>
                          <span>{cp.message_count} msgs</span>
                        </div>
                      </div>

                      {/* Chevron */}
                      <ChevronRight
                        className="w-4 h-4 shrink-0 mt-1 opacity-0 group-hover:opacity-60 transition-opacity"
                        style={{ color: 'var(--muted)' }}
                      />
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Panel — Detail / Actions */}
          <div className="flex-1 overflow-y-auto">
            {!selectedId ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 px-8 text-center">
                <RotateCcw className="w-10 h-10" style={{ color: 'var(--muted)', opacity: 0.3 }} />
                <p className="text-sm" style={{ color: 'var(--muted)' }}>
                  {t('checkpoint_select_hint', 'Sélectionnez un checkpoint dans la timeline pour voir ses détails')}
                </p>
              </div>
            ) : detailLoading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--muted)' }} />
              </div>
            ) : detail ? (
              <div className="p-5 space-y-5">
                {/* Detail Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-bold" style={{ color: 'var(--strong)' }}>{detail.label}</h3>
                    <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(detail.timestamp)}
                      <span>·</span>
                      {agentStateBadge(detail.agent_state)}
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono" style={{ color: 'var(--muted)' }}>
                    <div>ID: {detail.id}</div>
                    <div>Step: {detail.step_index}</div>
                  </div>
                </div>

                {/* Stats Grid */}
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { icon: Zap, label: t('checkpoint_tokens', 'Tokens'), value: formatTokens(detail.token_count), color: '#f59e0b' },
                    { icon: Cpu, label: t('checkpoint_messages', 'Messages'), value: String(detail.message_count), color: '#6366f1' },
                    { icon: Package, label: t('checkpoint_artifacts', 'Artefacts'), value: String(detail.artifacts_count), color: '#22c55e' },
                    { icon: Wrench, label: t('checkpoint_tools', 'Outils'), value: String(detail.tools_used?.length || 0), color: '#ec4899' },
                  ].map(({ icon: Icon, label, value, color }) => (
                    <div
                      key={label}
                      className="p-3 rounded-xl border text-center"
                      style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-subtle)' }}
                    >
                      <Icon className="w-4 h-4 mx-auto mb-1" style={{ color }} />
                      <div className="text-lg font-bold" style={{ color: 'var(--strong)' }}>{value}</div>
                      <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{label}</div>
                    </div>
                  ))}
                </div>

                {/* Preview Messages */}
                {detail.preview_messages && detail.preview_messages.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
                      {t('checkpoint_preview', 'Aperçu des messages')}
                    </h4>
                    <div
                      className="rounded-xl border divide-y max-h-48 overflow-y-auto"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {detail.preview_messages.map((msg, i) => (
                        <div
                          key={i}
                          className="px-3 py-2 text-xs"
                          style={{
                            borderColor: 'var(--border-subtle)',
                            backgroundColor: msg.role === 'user' ? 'rgba(99,102,241,0.03)' : 'transparent',
                          }}
                        >
                          <span className="font-semibold" style={{ color: msg.role === 'user' ? '#6366f1' : '#22c55e' }}>
                            {msg.role === 'user' ? '👤' : '🤖'}&nbsp;
                          </span>
                          <span style={{ color: 'var(--text)' }}>{msg.content}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Modified Files */}
                {detail.modified_files && detail.modified_files.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
                      {t('checkpoint_files', 'Fichiers modifiés')} ({detail.modified_files.length})
                    </h4>
                    <div
                      className="rounded-xl border max-h-36 overflow-y-auto"
                      style={{ borderColor: 'var(--border-subtle)' }}
                    >
                      {detail.modified_files.map((f, i) => (
                        <div
                          key={i}
                          className="flex items-center gap-2 px-3 py-1.5 text-xs border-b last:border-b-0"
                          style={{ borderColor: 'var(--border-subtle)' }}
                        >
                          <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                          <span className="truncate font-mono" style={{ color: 'var(--text)' }}>
                            {f.path.split(/[/\\]/).pop()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tools Used */}
                {detail.tools_used && detail.tools_used.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
                      {t('checkpoint_tools_used', 'Outils utilisés')}
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {detail.tools_used.map((tool) => (
                        <span
                          key={tool}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                          style={{
                            backgroundColor: 'rgba(236,72,153,0.05)',
                            borderColor: 'rgba(236,72,153,0.2)',
                            color: '#ec4899',
                          }}
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fork Title Input */}
                {showForkInput && (
                  <div
                    className="p-4 rounded-xl border"
                    style={{ borderColor: 'rgba(99,102,241,0.3)', backgroundColor: 'rgba(99,102,241,0.03)' }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <GitFork className="w-4 h-4" style={{ color: '#6366f1' }} />
                      <span className="text-sm font-medium" style={{ color: '#6366f1' }}>
                        {t('checkpoint_fork_title', 'Titre de la bifurcation')}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={forkTitle}
                        onChange={(e) => setForkTitle(e.target.value)}
                        placeholder={t('checkpoint_fork_placeholder', 'Titre (optionnel)...')}
                        className="flex-1 text-sm px-3 py-1.5 rounded-lg border bg-transparent outline-none focus:ring-1"
                        style={{ borderColor: 'var(--border-subtle)', color: 'var(--text)' }}
                        autoFocus
                      />
                      <button
                        onClick={handleFork}
                        disabled={actionLoading}
                        className="px-4 py-1.5 rounded-lg text-xs font-medium border transition-all hover:scale-105 disabled:opacity-50"
                        style={{
                          backgroundColor: 'rgba(99,102,241,0.15)',
                          borderColor: 'rgba(99,102,241,0.4)',
                          color: '#6366f1',
                        }}
                      >
                        {actionLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t('checkpoint_fork_confirm', 'Bifurquer')}
                      </button>
                      <button
                        onClick={() => setShowForkInput(false)}
                        className="text-xs px-2 py-1.5 rounded-lg hover:opacity-80"
                        style={{ color: 'var(--muted)' }}
                      >
                        {t('checkpoint_cancel', 'Annuler')}
                      </button>
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-3 pt-2 border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                  <button
                    onClick={() => { setConfirmAction('restore'); setConfirmTarget(detail.id); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border transition-all hover:scale-105"
                    style={{
                      backgroundColor: 'rgba(245,158,11,0.1)',
                      borderColor: 'rgba(245,158,11,0.3)',
                      color: '#f59e0b',
                    }}
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    {t('checkpoint_restore', 'Restaurer (Rewind)')}
                  </button>
                  <button
                    onClick={() => setShowForkInput(true)}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium border transition-all hover:scale-105"
                    style={{
                      backgroundColor: 'rgba(99,102,241,0.1)',
                      borderColor: 'rgba(99,102,241,0.3)',
                      color: '#6366f1',
                    }}
                  >
                    <GitFork className="w-3.5 h-3.5" />
                    {t('checkpoint_fork', 'Bifurquer (Fork)')}
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => { setConfirmAction('delete'); setConfirmTarget(detail.id); }}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium border transition-all hover:scale-105"
                    style={{
                      backgroundColor: 'rgba(239,68,68,0.05)',
                      borderColor: 'rgba(239,68,68,0.2)',
                      color: '#ef4444',
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t('checkpoint_delete', 'Supprimer')}
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Confirm Dialog Overlay */}
        {confirmAction && confirmTarget && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div
              className="w-full max-w-md p-6 rounded-2xl border shadow-2xl"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: confirmAction === 'delete' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)',
              }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="p-2 rounded-xl border"
                  style={{
                    backgroundColor: confirmAction === 'delete' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                    borderColor: confirmAction === 'delete' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.3)',
                    color: confirmAction === 'delete' ? '#ef4444' : '#f59e0b',
                  }}
                >
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold" style={{ color: 'var(--strong)' }}>
                    {confirmAction === 'delete'
                      ? t('checkpoint_confirm_delete_title', 'Supprimer ce checkpoint ?')
                      : t('checkpoint_confirm_restore_title', 'Restaurer ce checkpoint ?')}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    {confirmAction === 'delete'
                      ? t('checkpoint_confirm_delete_desc', 'Cette action est irréversible.')
                      : t('checkpoint_confirm_restore_desc', 'Tous les messages postérieurs à ce checkpoint seront perdus. Une sauvegarde automatique sera créée.')}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 justify-end">
                <button
                  onClick={() => { setConfirmAction(null); setConfirmTarget(null); }}
                  className="px-4 py-2 rounded-lg text-xs font-medium border hover:opacity-80"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}
                >
                  {t('checkpoint_cancel', 'Annuler')}
                </button>
                <button
                  onClick={confirmAction === 'delete' ? handleDelete : handleRestore}
                  disabled={actionLoading}
                  className="px-4 py-2 rounded-lg text-xs font-medium border transition-all hover:scale-105 disabled:opacity-50"
                  style={{
                    backgroundColor: confirmAction === 'delete' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)',
                    borderColor: confirmAction === 'delete' ? 'rgba(239,68,68,0.4)' : 'rgba(245,158,11,0.4)',
                    color: confirmAction === 'delete' ? '#ef4444' : '#f59e0b',
                  }}
                >
                  {actionLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <>
                      {confirmAction === 'delete' ? <Trash2 className="w-3.5 h-3.5 inline mr-1" /> : <Check className="w-3.5 h-3.5 inline mr-1" />}
                      {confirmAction === 'delete'
                        ? t('checkpoint_confirm_delete_btn', 'Supprimer définitivement')
                        : t('checkpoint_confirm_restore_btn', 'Restaurer maintenant')}
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CheckpointRewindModal;
