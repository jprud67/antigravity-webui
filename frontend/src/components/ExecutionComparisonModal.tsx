import React, { useState, useEffect } from 'react';
import { 
  X, 
  GitCompare, 
  Cpu, 
  CheckCircle2, 
  Loader2, 
  GitBranch, 
  Layers,
  ArrowRight
} from 'lucide-react';
import type { AgentComparisonItem } from '../types';
import { compareExecutionBranches } from '../services/api';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';

interface ExecutionComparisonModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  onSelectAgent?: (agentId: string) => void;
}

export const ExecutionComparisonModal: React.FC<ExecutionComparisonModalProps> = ({
  isOpen,
  onClose,
  conversationId,
  onSelectAgent,
}) => {
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentComparisonItem[]>([]);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    let isCancelled = false;
    Promise.resolve().then(() => {
      if (!isCancelled) setLoading(true);
    });

    compareExecutionBranches(conversationId)
      .then((res) => {
        if (!isCancelled) {
          setAgents(res.agents || []);
          setLoading(false);
        }
      })
      .catch((err: any) => {
        if (!isCancelled) {
          showToast(err?.message || 'Erreur lors du chargement de la comparaison', 'error');
          setLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen, conversationId]);

  if (!isOpen) return null;

  const formatDuration = (ms: number) => {
    if (!ms || ms <= 0) return '0s';
    const s = Math.round(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m ${s % 60}s`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full h-[90vh] max-w-6xl bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <GitCompare className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base text-zinc-100">
                  {t('replay_compare_title', 'Comparaison des Alternatives & Replay Temporel')}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {agents.length} {t('replay_alternatives_count', 'branches comparées')}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                {t('replay_compare_subtitle', "Analyse comparative côte-à-côte des modèles et solutions d'implémentation")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-x-auto overflow-y-auto p-4 md:p-6">
          {loading ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-zinc-500 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <span className="text-xs font-medium">
                {t('replay_loading', 'Extraction des métriques et alternatives...')}
              </span>
            </div>
          ) : agents.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center py-20 text-zinc-500 gap-3 text-center">
              <Layers className="w-12 h-12 text-zinc-600 mb-1" />
              <p className="text-sm font-semibold text-zinc-300">
                {t('replay_no_alternatives_title', 'Aucune branche concurrente détectée')}
              </p>
              <p className="text-xs text-zinc-500 max-w-md">
                {t('replay_no_alternatives_desc', "Utilisez l'action « Bifurquer l'arbre » sur un agent pour générer des solutions concurrentes avec des modèles alternatifs (Gemini, Claude, GPT).")}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((ag) => {
                const isCompleted = ag.status === 'completed';
                const isRunning = ag.status === 'running';

                return (
                  <div
                    key={ag.agent_id}
                    className={`rounded-2xl border p-4 flex flex-col justify-between backdrop-blur-md transition-all shadow-lg ${
                      ag.is_fork
                        ? 'bg-zinc-950/80 border-amber-500/30 hover:border-amber-500/60'
                        : 'bg-zinc-950/80 border-cyan-500/30 hover:border-cyan-500/60'
                    }`}
                  >
                    <div>
                      {/* Top Header Card */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`p-1.5 rounded-lg border ${
                              ag.is_fork
                                ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                                : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-400'
                            }`}
                          >
                            <Cpu className="w-4 h-4" />
                          </span>
                          <div className="min-w-0">
                            <h4 className="font-semibold text-sm text-zinc-100 truncate">
                              {ag.name}
                            </h4>
                            <span className="text-[10px] text-zinc-500 font-mono block truncate">
                              ID: {ag.agent_id}
                            </span>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            isRunning
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : isCompleted
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                              : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                          }`}
                        >
                          {isRunning ? (
                            <>
                              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                              Running
                            </>
                          ) : isCompleted ? (
                            <>
                              <CheckCircle2 className="w-3 h-3 text-blue-400" />
                              Terminé
                            </>
                          ) : (
                            ag.status
                          )}
                        </span>
                      </div>

                      {/* Model & Branch Pill */}
                      <div className="space-y-1.5 mb-3.5">
                        <div className="flex items-center justify-between text-xs p-2 rounded-xl bg-zinc-900/90 border border-zinc-800/80">
                          <span className="text-zinc-500">Modèle</span>
                          <span className="font-medium text-zinc-200">{ag.model || 'Gemini 3.8 Flash (Low)'}</span>
                        </div>

                        {ag.worktree_branch && (
                          <div className="flex items-center justify-between text-xs p-2 rounded-xl bg-zinc-900/90 border border-zinc-800/80">
                            <span className="text-zinc-500 flex items-center gap-1">
                              <GitBranch className="w-3 h-3 text-emerald-400" />
                              Branche
                            </span>
                            <span className="font-mono text-[11px] text-emerald-400 truncate max-w-[160px]">
                              {ag.worktree_branch}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Performance Metrics Bento */}
                      <div className="grid grid-cols-3 gap-2 mb-3.5 text-center">
                        <div className="p-2 rounded-xl bg-zinc-900/60 border border-zinc-800">
                          <span className="text-[10px] text-zinc-500 block">Durée</span>
                          <span className="font-bold text-xs text-zinc-200">
                            {formatDuration(ag.duration_ms)}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-zinc-900/60 border border-zinc-800">
                          <span className="text-[10px] text-zinc-500 block">Outils</span>
                          <span className="font-bold text-xs text-zinc-200">
                            {ag.tool_call_count}
                          </span>
                        </div>
                        <div className="p-2 rounded-xl bg-zinc-900/60 border border-zinc-800">
                          <span className="text-[10px] text-zinc-500 block">Fichiers</span>
                          <span className="font-bold text-xs text-emerald-400">
                            {ag.modified_files_count}
                          </span>
                        </div>
                      </div>

                      {/* Thought / Solution Preview */}
                      {ag.thought_preview && (
                        <div className="mb-3.5 p-2.5 rounded-xl bg-zinc-900/80 border border-zinc-800 text-[11px] text-zinc-400">
                          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1">
                            Aperçu de la démarche
                          </span>
                          <p className="line-clamp-3 italic">
                            "{ag.thought_preview}"
                          </p>
                        </div>
                      )}

                      {/* Modified Files Snippet */}
                      {ag.modified_files.length > 0 && (
                        <div className="mb-3 space-y-1">
                          <span className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block">
                            Fichiers impactés
                          </span>
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {ag.modified_files.slice(0, 5).map((f, idx) => (
                              <span
                                key={idx}
                                className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-zinc-800/90 text-zinc-300 border border-zinc-700/60 truncate max-w-[200px]"
                              >
                                {f.path.split(/[/\\]/).pop()}
                              </span>
                            ))}
                            {ag.modified_files.length > 5 && (
                              <span className="text-[10px] text-zinc-500 self-center">
                                +{ag.modified_files.length - 5} autres
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Bottom Action Deck */}
                    <div className="pt-3 border-t border-zinc-800/80 flex items-center justify-between gap-2 mt-2">
                      <span className="text-[10px] text-zinc-500">
                        {ag.is_fork ? 'Bifurcation' : 'Branche Principale'}
                      </span>
                      {onSelectAgent && (
                        <button
                          type="button"
                          onClick={() => {
                            onSelectAgent(ag.agent_id);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 flex items-center gap-1.5 transition-colors"
                        >
                          {t('replay_inspect_action', 'Inspecter')}
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
