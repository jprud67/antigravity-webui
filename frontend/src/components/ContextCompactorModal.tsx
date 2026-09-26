import React, { useState, useEffect, useMemo } from 'react';
import { 
  Scissors, 
  X, 
  Layers, 
  Zap, 
  CheckCircle2, 
  AlertCircle, 
  Terminal, 
  FileText, 
  Search, 
  Gauge
} from 'lucide-react';
import { 
  fetchConversationTranscript, 
  pruneConversation, 
  getContextBudget, 
  enforceContextBudget, 
  type PruneResult,
  type ContextBudgetInfo
} from '../services/api';
import { useI18n } from '../services/i18n';
import type { TokenUsageData } from './ContextRing';

interface ContextCompactorModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | null;
  activeModel?: string;
  usage?: TokenUsageData;
  onPruneSuccess?: (result: PruneResult) => void;
}

interface StepItem {
  step_index: number;
  type: string;
  content: string;
  is_truncated?: boolean;
  status?: string;
  approxTokens: number;
  chars: number;
  source?: string;
  role?: string;
}

export const ContextCompactorModal: React.FC<ContextCompactorModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  activeModel = 'gemini',
  usage,
  onPruneSuccess
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState<boolean>(false);
  const [pruning, setPruning] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [successResult, setSuccessResult] = useState<PruneResult | null>(null);
  const [budgetInfo, setBudgetInfo] = useState<ContextBudgetInfo | null>(null);

  const [steps, setSteps] = useState<StepItem[]>([]);
  const [mode, setMode] = useState<'turn' | 'selective'>('turn');
  const [preserveTurns, setPreserveTurns] = useState<number>(2);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !pruning) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, pruning]);

  // Load conversation transcript steps
  const [reloadKey, setReloadKey] = useState<number>(0);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setLoading(true);
        setError(null);
        setSuccessResult(null);
      }
    });

    fetchConversationTranscript(conversationId)
      .then((data) => {
        if (!active) return;
        const rawSteps: any[] = Array.isArray(data) ? data : (data?.steps || []);
        const parsed: StepItem[] = rawSteps.map((s, idx) => {
          const contentStr = typeof s.content === 'string'
            ? s.content
            : (s.content ? JSON.stringify(s.content) : '');
          const chars = contentStr.length;
          const approxTokens = Math.max(1, Math.round(chars / 3.8));
          return {
            step_index: s.step_index !== undefined ? s.step_index : idx,
            type: s.type || s.role || 'step',
            content: contentStr,
            is_truncated: !!s.is_truncated,
            status: s.status,
            approxTokens,
            chars,
            source: s.source,
            role: s.role
          };
        });

        setSteps(parsed);
        const initialSelected = new Set<number>();
        parsed.forEach((item) => {
          if (!item.is_truncated && item.chars > 300) {
            initialSelected.add(item.step_index);
          }
        });
        setSelectedIndices(initialSelected);
      })
      .catch((err: any) => {
        if (!active) return;
        setError(err?.message || t('failed_load_transcript', 'Impossible de charger l\'historique de la session.'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    getContextBudget(conversationId)
      .then((b) => {
        if (active) setBudgetInfo(b);
      })
      .catch((e) => console.debug("Error loading context budget:", e));

    return () => {
      active = false;
    };
  }, [isOpen, conversationId, reloadKey, t]);

  const handleApplyBudget = async () => {
    if (!conversationId) return;
    setPruning(true);
    setError(null);
    try {
      const res = await enforceContextBudget(conversationId);
      if (res.action_taken && res.tokens_saved > 0) {
        const dummyResult: PruneResult = {
          status: 'ok',
          conversation_id: conversationId,
          pruned_steps: res.compacted_steps,
          chars_saved: 0,
          tokens_saved: res.tokens_saved,
          reduction_pct: res.reduction_pct
        };
        setSuccessResult(dummyResult);
        if (onPruneSuccess) {
          onPruneSuccess(dummyResult);
        }
      } else {
        setError(t('budget_already_optimal', 'Le contexte respecte déjà le budget configuré. Aucun compactage supplémentaire requis.'));
      }
      setTimeout(() => {
        setReloadKey((k) => k + 1);
      }, 300);
    } catch (e: any) {
      setError(e.message || "Échec de l'application du budget");
    } finally {
      setPruning(false);
    }
  };

  // Model context limit estimation
  const contextMaxTokens = useMemo(() => {
    const id = activeModel.toLowerCase();
    if (id.includes('1.5-pro') || id.includes('2.0-pro') || id.includes('gemini')) return 1000000;
    if (id.includes('claude-3-5') || id.includes('claude-3-7')) return 200000;
    if (id.includes('gpt-4o')) return 128000;
    return 200000;
  }, [activeModel]);

  const currentTokens = usage?.totalTokens || steps.reduce((acc, s) => acc + s.approxTokens, 0);
  const contextPct = Math.min(100, Math.round((currentTokens / contextMaxTokens) * 100));

  // Prunable steps (tools, outputs, large blocks)
  const prunableSteps = useMemo(() => {
    return steps.filter((s) => !s.is_truncated && s.chars > 120);
  }, [steps]);

  // Turn-based boundary preview
  const turnPrunableIndices = useMemo(() => {
    const userIndices = steps
      .filter((s) => s.type?.toUpperCase() === 'USER_INPUT' || s.source?.toUpperCase() === 'USER_EXPLICIT' || s.role?.toLowerCase() === 'user')
      .map((s) => s.step_index);

    let boundary = 0;
    if (userIndices.length > preserveTurns) {
      boundary = userIndices[userIndices.length - preserveTurns];
    }

    const indices = new Set<number>();
    steps.forEach((s) => {
      if (s.step_index < boundary && !s.is_truncated && s.chars > 120) {
        indices.add(s.step_index);
      }
    });
    return indices;
  }, [steps, preserveTurns]);

  // Calculate tokens to be saved based on active mode
  const estimatedSavings = useMemo(() => {
    const targetSet = mode === 'turn' ? turnPrunableIndices : selectedIndices;
    let chars = 0;
    steps.forEach((s) => {
      if (targetSet.has(s.step_index)) {
        chars += Math.max(0, s.chars - 90);
      }
    });
    const tokens = Math.round(chars / 3.8);
    const pct = currentTokens > 0 ? Math.min(100, Math.round((tokens / currentTokens) * 100)) : 0;
    return { chars, tokens, pct, count: targetSet.size };
  }, [mode, turnPrunableIndices, selectedIndices, steps, currentTokens]);

  const toggleSelectStep = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const selectAllPrunable = () => {
    setSelectedIndices(new Set(prunableSteps.map((s) => s.step_index)));
  };

  const deselectAll = () => {
    setSelectedIndices(new Set());
  };

  const handleApplyPrune = async () => {
    if (!conversationId) return;
    setPruning(true);
    setError(null);

    try {
      const stepIndices = mode === 'selective' ? Array.from(selectedIndices) : undefined;
      const res = await pruneConversation(
        conversationId,
        stepIndices,
        mode === 'turn' ? preserveTurns : undefined
      );

      setSuccessResult(res);
      if (onPruneSuccess) {
        onPruneSuccess(res);
      }
      setTimeout(() => {
        setReloadKey((k) => k + 1);
      }, 300);
    } catch (err: any) {
      setError(err?.message || t('prune_failed', 'Échec de l\'opération d\'élagage de contexte.'));
    } finally {
      setPruning(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-md animate-fadeIn">
      <div
        className="w-full max-w-3xl max-h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden text-slate-100"
        style={{
          backgroundColor: 'var(--surface, #0f172a)',
          borderColor: 'var(--border2, #334155)',
          color: 'var(--text, #f8fafc)'
        }}
      >
        {/* Header */}
        <div
          className="px-5 py-4 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border, #1e293b)' }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Scissors className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold tracking-tight">
                  {t('context_compactor_title', 'Assistant d\'Élagage & Compactage de Contexte')}
                </h3>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 font-mono font-medium border border-sky-500/30">
                  Optimiseur LLM
                </span>
              </div>
              <p className="text-xs opacity-70">
                {t('context_compactor_desc', 'Allégez le contexte en compressant les sorties d\'outils volumineuses sans altérer vos consignes.')}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={pruning}
            className="p-1.5 rounded-lg border hover:bg-white/10 transition-colors opacity-70 hover:opacity-100 cursor-pointer"
            style={{ borderColor: 'var(--border, #334155)' }}
            title={t('close_esc', 'Fermer (Échap)')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Feedback / Alert */}
        {error && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {successResult && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {t(
                  'prune_success_message',
                  'Élagage réussi ! {0} étapes allégées, ~{1} tokens économisés (-{2}%).'
                )
                  .replace('{0}', String(successResult.pruned_steps))
                  .replace('{1}', String(successResult.tokens_saved.toLocaleString()))
                  .replace('{2}', String(successResult.reduction_pct))}
              </span>
            </div>
            <span className="text-[10px] opacity-75 font-mono">{t('transcript_full_preserved', 'transcript_full.jsonl conservé')}</span>
          </div>
        )}

        {/* Context Usage Gauge Card */}
        <div className="px-5 pt-4 shrink-0">
          <div
            className="p-3.5 rounded-xl border flex flex-col gap-2"
            style={{
              backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.03))',
              borderColor: 'var(--border, #1e293b)'
            }}
          >
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <Gauge className="w-3.5 h-3.5 text-sky-400" />
                <span className="font-semibold">{t('context_budget_ceiling', 'Budget de Contexte par Tour (Parité IDE)')}</span>
              </div>
              <div className="font-mono text-xs">
                <span className={`font-bold ${budgetInfo?.is_over_budget ? 'text-rose-400' : 'text-sky-400'}`}>
                  ~{(budgetInfo?.estimated_input_tokens || currentTokens).toLocaleString()}
                </span>
                <span className="opacity-60"> / {(budgetInfo?.budget_tokens || 35000).toLocaleString()} tokens ({budgetInfo ? `${budgetInfo.budget_usage_pct}%` : `${contextPct}%`})</span>
              </div>
            </div>

            {/* Visual Gauge Bar */}
            <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden relative">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  (budgetInfo?.budget_usage_pct ?? 0) > 100 || contextPct > 80 ? 'bg-rose-500' : (budgetInfo?.budget_usage_pct ?? 0) > 75 ? 'bg-amber-400' : 'bg-sky-400'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, budgetInfo?.budget_usage_pct || contextPct))}%` }}
              />
            </div>

            <div className="flex items-center justify-between text-[11px] opacity-70 font-sans">
              <span>{steps.length} {t('total_steps', 'étapes enregistrées')}</span>
              <span>{prunableSteps.length} {t('prunable_steps', 'étapes volumineuses (> 120 car.)')}</span>
            </div>
          </div>
        </div>

        {/* Mode Selector Tabs */}
        <div className="px-5 pt-3 shrink-0 flex items-center justify-between gap-3">
          <div
            className="flex items-center p-1 rounded-xl border text-xs"
            style={{
              backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.03))',
              borderColor: 'var(--border, #1e293b)'
            }}
          >
            <button
              type="button"
              onClick={() => setMode('turn')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                mode === 'turn'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'opacity-70 hover:opacity-100 text-slate-300'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>{t('turn_mode', 'Mode Automatique (par tours)')}</span>
            </button>
            <button
              type="button"
              onClick={() => setMode('selective')}
              className={`px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer flex items-center gap-1.5 ${
                mode === 'selective'
                  ? 'bg-amber-500 text-white shadow-sm'
                  : 'opacity-70 hover:opacity-100 text-slate-300'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>{t('selective_mode', 'Sélection Chirurgicale')}</span>
            </button>
          </div>

          {mode === 'selective' && (
            <div className="flex items-center gap-2 text-xs">
              <button
                type="button"
                onClick={selectAllPrunable}
                className="px-2 py-1 rounded-lg border border-slate-700 hover:bg-white/5 opacity-80 hover:opacity-100 transition-colors cursor-pointer text-[11px]"
              >
                {t('select_all', 'Tout sélectionner')}
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="px-2 py-1 rounded-lg border border-slate-700 hover:bg-white/5 opacity-80 hover:opacity-100 transition-colors cursor-pointer text-[11px]"
              >
                {t('deselect_all', 'Désélectionner')}
              </button>
            </div>
          )}
        </div>

        {/* Content Area */}
        <div className="px-5 py-3 flex-1 overflow-y-auto space-y-3 min-h-[220px]">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-400">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">{t('analyzing_context', 'Analyse du contexte de la session...')}</span>
            </div>
          ) : mode === 'turn' ? (
            <div
              className="p-4 rounded-xl border flex flex-col gap-3"
              style={{
                backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.02))',
                borderColor: 'var(--border, #1e293b)'
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold">{t('turns_to_preserve', 'Tours récents à préserver intacts :')}</span>
                <span className="text-xs font-bold text-amber-400 font-mono">
                  {preserveTurns} {preserveTurns > 1 ? 'derniers tours' : 'dernier tour'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {[1, 2, 3].map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setPreserveTurns(val)}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all cursor-pointer flex flex-col items-center gap-1 ${
                      preserveTurns === val
                        ? 'bg-amber-500/20 border-amber-500 text-amber-400 shadow-sm'
                        : 'border-slate-800 hover:border-slate-700 opacity-70 hover:opacity-100'
                    }`}
                  >
                    <span className="font-bold">{val} {val > 1 ? 'tours' : 'tour'}</span>
                    <span className="text-[10px] opacity-75 font-sans">
                      {val === 1 ? 'Élagage maximal' : val === 2 ? 'Équilibre recommandé' : 'Sécurité maximale'}
                    </span>
                  </button>
                ))}
              </div>

              <p className="text-xs opacity-75 leading-relaxed pt-1">
                {t(
                  'turn_mode_explanation',
                  'Toutes les sorties d\'outils et logs volumineux situés avant les {0} derniers tours seront condensés en un résumé d\'une ligne. L\'historique textuel intégral reste conservé dans transcript_full.jsonl.'
                ).replace('{0}', String(preserveTurns))}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {prunableSteps.length === 0 ? (
                <div className="text-center py-8 text-xs opacity-60">
                  {t('no_prunable_steps', 'Aucune étape volumineuse à élaguer dans cette conversation.')}
                </div>
              ) : (
                prunableSteps.map((step) => {
                  const isSelected = selectedIndices.has(step.step_index);
                  return (
                    <div
                      key={step.step_index}
                      onClick={() => toggleSelectStep(step.step_index)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-3 text-xs transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-amber-500/10 border-amber-500/40 text-slate-100'
                          : 'border-slate-800/80 hover:border-slate-700 bg-slate-900/40 opacity-75 hover:opacity-100'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}} // handled by row container
                          className="w-4 h-4 rounded text-amber-500 bg-slate-800 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />

                        {step.type.toLowerCase().includes('command') ? (
                          <Terminal className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        ) : step.type.toLowerCase().includes('search') ? (
                          <Search className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                        ) : (
                          <FileText className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                        )}

                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] opacity-60">#{step.step_index}</span>
                            <span className="font-semibold text-xs truncate">{step.type}</span>
                            {step.status && (
                              <span
                                className={`text-[9px] px-1.5 py-0.2 rounded font-mono ${
                                  step.status === 'ERROR' ? 'bg-red-500/20 text-red-400' : 'bg-emerald-500/20 text-emerald-400'
                                }`}
                              >
                                {step.status}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] opacity-60 truncate font-mono mt-0.5">
                            {step.content.slice(0, 80).replace(/\s+/g, ' ')}...
                          </p>
                        </div>
                      </div>

                      <div className="text-right shrink-0 font-mono text-[11px]">
                        <span className="text-amber-400 font-bold">~{step.approxTokens.toLocaleString()}</span>
                        <span className="opacity-50"> tok</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer Toolbar */}
        <div
          className="px-5 py-3.5 border-t flex items-center justify-between shrink-0 bg-slate-950/40"
          style={{ borderColor: 'var(--border, #1e293b)' }}
        >
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            <div className="text-xs">
              <span className="opacity-70">{t('estimated_savings', 'Économie estimée : ')}</span>
              <span className="font-bold text-emerald-400 font-mono">
                ~{estimatedSavings.tokens.toLocaleString()} tokens
              </span>
              {estimatedSavings.pct > 0 && (
                <span className="ml-1 text-[11px] font-mono opacity-75 text-emerald-400">
                  (-{estimatedSavings.pct}%)
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pruning}
              className="px-3 py-1.5 rounded-xl border border-slate-700 hover:bg-white/5 text-xs font-medium transition-colors cursor-pointer"
            >
              {t('cancel', 'Annuler')}
            </button>

            <button
              type="button"
              onClick={handleApplyBudget}
              disabled={pruning}
              className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
              title={t('auto_compact_tooltip', 'Plafonne et compresse automatiquement le contexte selon le budget configuré (Parité IDE)')}
            >
              <Zap className="w-3.5 h-3.5" />
              <span>{t('apply_budget_manager', 'Appliquer le Budget')}</span>
            </button>

            <button
              type="button"
              onClick={handleApplyPrune}
              disabled={pruning || estimatedSavings.count === 0}
              className="px-4 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
            >
              {pruning ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>{t('pruning_active', 'Élagage en cours...')}</span>
                </>
              ) : (
                <>
                  <Scissors className="w-3.5 h-3.5" />
                  <span>{t('apply_prune', 'Appliquer l\'élagage')}</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
