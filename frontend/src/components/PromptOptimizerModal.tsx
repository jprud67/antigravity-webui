import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Wand2,
  Sparkles,
  Check,
  Copy,
  X,
  RefreshCw,
  Loader2,
  ArrowRight,
  Shield,
  Target,
  FileText,
  Code2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import { analyzePrompt, optimizePrompt } from '../services/api';
import { calculatePromptClarity } from '../utils/promptAnalyzer';
import type { PromptPreset, PromptAnalysisResponse, PromptOptimizationResponse } from '../types';

export interface PromptOptimizerModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialPrompt: string;
  onApplyPrompt: (optimizedPrompt: string) => void;
  activeModel?: string;
}

const PRESET_OPTIONS: { id: PromptPreset; label: string; icon: string; desc: string }[] = [
  { id: 'general', label: 'Général', icon: '✨', desc: 'Structuration claire en Contexte, Objectif et Instructions' },
  { id: 'debug', label: 'Débogage', icon: '🛠️', desc: 'Diagnostic chirurgical, reproduction et correctif minimal' },
  { id: 'plan', label: 'Plan & Tâches', icon: '📋', desc: 'Architecture ciblée, phasage TDD et critères de validation' },
  { id: 'refactor', label: 'Refactoring', icon: '⚡', desc: 'Nettoyage de code, zéro régression et préservation des APIs' },
  { id: 'review', label: 'Revue de Code', icon: '🔍', desc: 'Audit critique : sécurité, performance et typage' },
];

interface PromptOptimizerInnerProps {
  initialPrompt: string;
  onClose: () => void;
  onApplyPrompt: (optimizedPrompt: string) => void;
  activeModel?: string;
}

const PromptOptimizerInner: React.FC<PromptOptimizerInnerProps> = ({
  initialPrompt,
  onClose,
  onApplyPrompt,
  activeModel,
}) => {
  const { t } = useI18n();
  const [draftPrompt, setDraftPrompt] = useState<string>(() => initialPrompt || '');
  const [selectedPreset, setSelectedPreset] = useState<PromptPreset>('general');
  const [optimizedText, setOptimizedText] = useState<string>('');
  const [isOptimizing, setIsOptimizing] = useState<boolean>(() => Boolean(initialPrompt?.trim()));
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(() => Boolean(initialPrompt?.trim()));
  const [backendAnalysis, setBackendAnalysis] = useState<PromptAnalysisResponse | null>(null);
  const [copied, setCopied] = useState<boolean>(false);

  // Instant client-side clarity assessment (0ms feedback)
  const clientClarity = useMemo(() => {
    return calculatePromptClarity(draftPrompt);
  }, [draftPrompt]);

  // Trigger optimization
  const handleOptimize = useCallback(async (textToOptimize: string, preset: PromptPreset) => {
    const trimmed = textToOptimize.trim();
    if (!trimmed) {
      showToast(t('prompt_empty_warning', 'Veuillez saisir un prompt à optimiser'), 'info');
      return;
    }

    setIsOptimizing(true);
    try {
      const res: PromptOptimizationResponse = await optimizePrompt(trimmed, preset, activeModel);
      setOptimizedText(res.optimized);
    } catch (err: any) {
      // Fallback local meta-prompt if backend route fails
      const fallback = `### Contexte\n${trimmed}\n\n### Objectif\nExécuter cette tâche avec précision.\n\n### Instructions par étapes\n1. Analyser le code existant.\n2. Implémenter la solution sans régression.\n3. Valider la conformité des tests.`;
      setOptimizedText(fallback);
      showToast(err.message || 'Optimisation locale effectuée', 'info');
    } finally {
      setIsOptimizing(false);
    }
  }, [activeModel, t]);

  // Trigger backend deep analysis
  const handleAnalyze = useCallback(async (textToAnalyze: string) => {
    const trimmed = textToAnalyze.trim();
    if (!trimmed) return;
    setIsAnalyzing(true);
    try {
      const res = await analyzePrompt(trimmed);
      setBackendAnalysis(res);
    } catch {
      // Silent catch: client-side clarity already acts as primary
    } finally {
      setIsAnalyzing(false);
    }
  }, []);

  // Run initial analysis & optimization asynchronously on mount
  useEffect(() => {
    let cancelled = false;
    const trimmed = initialPrompt?.trim();
    if (trimmed) {
      optimizePrompt(trimmed, selectedPreset, activeModel)
        .then((res) => {
          if (!cancelled) setOptimizedText(res.optimized);
        })
        .catch(() => {
          if (!cancelled) {
            setOptimizedText(
              `### Contexte\n${trimmed}\n\n### Objectif\nExécuter cette tâche avec précision.\n\n### Instructions par étapes\n1. Analyser le code existant.\n2. Implémenter la solution sans régression.\n3. Valider la conformité des tests.`
            );
          }
        })
        .finally(() => {
          if (!cancelled) setIsOptimizing(false);
        });

      analyzePrompt(trimmed)
        .then((res) => {
          if (!cancelled) setBackendAnalysis(res);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setIsAnalyzing(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [initialPrompt, selectedPreset, activeModel]);

  // Handle Preset change
  const handlePresetSelect = (preset: PromptPreset) => {
    setSelectedPreset(preset);
    if (draftPrompt.trim()) {
      handleOptimize(draftPrompt, preset);
    }
  };

  // Keyboard shortcut listener (Escape to close)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Copy optimized prompt
  const handleCopy = () => {
    const textToCopy = optimizedText || draftPrompt;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      showToast(t('prompt_copied', 'Prompt optimisé copié dans le presse-papiers'), 'success');
      setTimeout(() => setCopied(false), 2000);
    });
  };

  // Apply to chat
  const handleApply = () => {
    const finalPrompt = (optimizedText || draftPrompt).trim();
    if (!finalPrompt) return;
    onApplyPrompt(finalPrompt);
    showToast(t('prompt_applied', 'Prompt optimisé injecté dans le chat'), 'success');
    onClose();
  };

  const currentScore = backendAnalysis?.clarity_score ?? clientClarity.score;
  const currentBreakdown = backendAnalysis?.breakdown ?? clientClarity.breakdown;
  const currentSuggestions = backendAnalysis?.suggestions ?? (clientClarity.topSuggestion ? [clientClarity.topSuggestion] : []);

  return (
    <div
      className="w-full max-w-5xl h-[92vh] max-h-[850px] flex flex-col rounded-2xl shadow-2xl border overflow-hidden transition-all"
      style={{
        backgroundColor: 'var(--surface, #09090b)',
        borderColor: 'var(--border, #27272a)',
        color: 'var(--text, #f4f4f5)',
      }}
    >
      {/* Top Header */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle, #18181b)',
          borderColor: 'var(--border, #27272a)',
        }}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500/20 to-purple-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
            <Wand2 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 id="prompt-optimizer-title" className="text-sm font-semibold tracking-tight" style={{ color: 'var(--strong, #ffffff)' }}>
                {t('prompt_optimizer_title', "Studio d'Optimisation de Prompt")}
              </h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                v0.2.14
              </span>
              {activeModel && (
                <span className="text-[11px] font-mono hidden sm:inline" style={{ color: 'var(--muted, #71717a)' }}>
                  • {activeModel}
                </span>
              )}
            </div>
            <p className="text-xs" style={{ color: 'var(--muted, #71717a)' }}>
              {t('prompt_optimizer_subtitle', 'Transformez vos ébauches en instructions agentiques structurées haute précision')}
            </p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 rounded-xl transition-colors cursor-pointer hover:bg-white/5"
          style={{ color: 'var(--muted, #71717a)' }}
          title={t('close', 'Fermer')}
          aria-label={t('close', 'Fermer')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Clarity Score Banner & Gauges Bar */}
      <div
        className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-4 shrink-0 text-xs"
        style={{
          backgroundColor: 'var(--surface, #09090b)',
          borderColor: 'var(--border, #27272a)',
        }}
      >
        {/* Main Score Meter */}
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-xs border"
            style={{
              backgroundColor: clientClarity.badgeBg,
              borderColor: clientClarity.color,
              color: clientClarity.color,
            }}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Score de Clarté : {currentScore}%</span>
          </div>
          <span className="text-[11px] hidden md:inline" style={{ color: 'var(--muted, #71717a)' }}>
            {currentScore >= 75 ? 'Optimal pour Antigravity' : currentScore >= 45 ? 'Compréhensible mais perfectible' : 'Trop vague ou incomplet'}
          </span>
        </div>

        {/* 4 Quality Pill Gauges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium"
            style={{
              backgroundColor: currentBreakdown.context >= 15 ? 'rgba(16, 185, 129, 0.1)' : 'var(--surface-subtle)',
              borderColor: currentBreakdown.context >= 15 ? 'rgba(16, 185, 129, 0.3)' : 'var(--border)',
              color: currentBreakdown.context >= 15 ? '#10b981' : 'var(--muted)',
            }}
            title="Présence de fichiers, snippets de code ou logs d'erreur"
          >
            <FileText className="w-3 h-3" />
            <span>Contexte ({currentBreakdown.context}/25)</span>
          </div>

          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium"
            style={{
              backgroundColor: currentBreakdown.objective >= 15 ? 'rgba(56, 189, 248, 0.1)' : 'var(--surface-subtle)',
              borderColor: currentBreakdown.objective >= 15 ? 'rgba(56, 189, 248, 0.3)' : 'var(--border)',
              color: currentBreakdown.objective >= 15 ? '#38bdf8' : 'var(--muted)',
            }}
            title="Action claire et verbe explicite"
          >
            <Target className="w-3 h-3" />
            <span>Objectif ({currentBreakdown.objective}/25)</span>
          </div>

          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium"
            style={{
              backgroundColor: currentBreakdown.constraints >= 15 ? 'rgba(234, 179, 8, 0.1)' : 'var(--surface-subtle)',
              borderColor: currentBreakdown.constraints >= 15 ? 'rgba(234, 179, 8, 0.3)' : 'var(--border)',
              color: currentBreakdown.constraints >= 15 ? '#eab308' : 'var(--muted)',
            }}
            title="Règles négatives, non-régression et contraintes"
          >
            <Shield className="w-3 h-3" />
            <span>Contraintes ({currentBreakdown.constraints}/25)</span>
          </div>

          <div
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium"
            style={{
              backgroundColor: (('output_format' in currentBreakdown ? (currentBreakdown as any).output_format : (currentBreakdown as any).outputFormat) ?? 0) >= 15 ? 'rgba(168, 85, 247, 0.1)' : 'var(--surface-subtle)',
              borderColor: (('output_format' in currentBreakdown ? (currentBreakdown as any).output_format : (currentBreakdown as any).outputFormat) ?? 0) >= 15 ? 'rgba(168, 85, 247, 0.3)' : 'var(--border)',
              color: (('output_format' in currentBreakdown ? (currentBreakdown as any).output_format : (currentBreakdown as any).outputFormat) ?? 0) >= 15 ? '#a855f7' : 'var(--muted)',
            }}
            title="Format de livrable attendu (diff, étapes, explication)"
          >
            <Code2 className="w-3 h-3" />
            <span>Format ({(('output_format' in currentBreakdown ? (currentBreakdown as any).output_format : (currentBreakdown as any).outputFormat) ?? 0)}/25)</span>
          </div>
        </div>
      </div>

      {/* Suggestion Banner */}
      {currentSuggestions.length > 0 && currentScore < 75 && (
        <div
          className="px-5 py-2 border-b flex items-center gap-2 text-xs"
          style={{
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            borderColor: 'rgba(245, 158, 11, 0.2)',
            color: '#f59e0b',
          }}
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">{currentSuggestions[0]}</span>
        </div>
      )}

      {/* Presets Chips Selector */}
      <div
        className="px-5 py-2.5 border-b flex items-center gap-2 overflow-x-auto shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle, #18181b)',
          borderColor: 'var(--border, #27272a)',
        }}
      >
        <span className="text-[11px] font-medium uppercase tracking-wider mr-1 shrink-0" style={{ color: 'var(--muted, #71717a)' }}>
          Preset :
        </span>
        {PRESET_OPTIONS.map((opt) => {
          const isSelected = selectedPreset === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => handlePresetSelect(opt.id)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-medium transition-all cursor-pointer border shrink-0 ${
                isSelected
                  ? 'bg-sky-500/20 border-sky-500/40 text-sky-300 shadow-sm'
                  : 'border-transparent hover:bg-white/5 text-zinc-400 hover:text-zinc-200'
              }`}
              title={opt.desc}
            >
              <span>{opt.icon}</span>
              <span>{opt.label}</span>
            </button>
          );
        })}
      </div>

      {/* Studio Body: Side-by-Side Comparison */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left Column: Draft Input */}
        <div
          className="flex-1 flex flex-col border-b md:border-b-0 md:border-r min-h-[220px]"
          style={{ borderColor: 'var(--border, #27272a)' }}
        >
          <div
            className="flex items-center justify-between px-4 py-2 border-b text-[11px] font-medium shrink-0"
            style={{
              backgroundColor: 'var(--surface-subtle, #18181b)',
              borderColor: 'var(--border, #27272a)',
              color: 'var(--muted, #71717a)',
            }}
          >
            <span>{t('prompt_original_draft', 'Brouillon Original (modifiable)')}</span>
            <div className="flex items-center gap-2 font-mono text-[10px]">
              <span>{clientClarity.wordCount} mots</span>
              <span>•</span>
              <span>~{clientClarity.estimatedTokens} tokens</span>
            </div>
          </div>

          <textarea
            value={draftPrompt}
            onChange={(e) => {
              setDraftPrompt(e.target.value);
            }}
            placeholder="Saisissez votre prompt ou requête brute ici..."
            className="flex-1 p-4 bg-transparent outline-none resize-none text-xs sm:text-sm font-sans leading-relaxed select-text"
            style={{
              color: 'var(--text, #f4f4f5)',
            }}
            spellCheck={false}
          />

          <div
            className="p-3 border-t flex items-center justify-between shrink-0"
            style={{
              backgroundColor: 'var(--surface, #09090b)',
              borderColor: 'var(--border, #27272a)',
            }}
          >
            <button
              onClick={() => handleOptimize(draftPrompt, selectedPreset)}
              disabled={isOptimizing || !draftPrompt.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white transition-all cursor-pointer shadow-md shadow-sky-600/20"
            >
              {isOptimizing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              <span>{isOptimizing ? 'Optimisation en cours...' : 'Régénérer'}</span>
            </button>

            <button
              onClick={() => handleAnalyze(draftPrompt)}
              disabled={isAnalyzing || !draftPrompt.trim()}
              className="text-xs transition-colors hover:underline cursor-pointer"
              style={{ color: 'var(--muted, #71717a)' }}
            >
              {isAnalyzing ? 'Analyse...' : 'Réanalyser'}
            </button>
          </div>
        </div>

        {/* Right Column: AI-Optimized Meta-Prompt */}
        <div className="flex-1 flex flex-col bg-zinc-950/40 min-h-[220px]">
          <div
            className="flex items-center justify-between px-4 py-2 border-b text-[11px] font-medium shrink-0"
            style={{
              backgroundColor: 'var(--surface-subtle, #18181b)',
              borderColor: 'var(--border, #27272a)',
              color: 'var(--muted, #71717a)',
            }}
          >
            <div className="flex items-center gap-1.5 text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t('prompt_optimized_result', 'Meta-Prompt Optimisé (Agentic)')}</span>
            </div>
            <div className="flex items-center gap-2 font-mono text-[10px]" style={{ color: 'var(--muted, #71717a)' }}>
              <span>{optimizedText ? `${optimizedText.split(/\s+/).length} mots` : '0 mot'}</span>
              <span>•</span>
              <span>~{Math.max(1, Math.ceil(optimizedText.length / 3.8))} tokens</span>
            </div>
          </div>

          <div className="flex-1 p-4 overflow-y-auto font-mono text-xs leading-relaxed select-text whitespace-pre-wrap text-zinc-200">
            {isOptimizing ? (
              <div className="flex flex-col items-center justify-center h-full gap-2 text-zinc-500">
                <Loader2 className="w-6 h-6 animate-spin text-sky-400" />
                <span className="text-xs">Structuration du prompt en cours...</span>
              </div>
            ) : optimizedText ? (
              optimizedText
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-xs gap-2 text-zinc-600">
                <Wand2 className="w-8 h-8 opacity-40 text-purple-400" />
                <span>Cliquez sur "Régénérer" pour structurer votre requête.</span>
              </div>
            )}
          </div>

          <div
            className="p-3 border-t flex items-center justify-between gap-2 shrink-0"
            style={{
              backgroundColor: 'var(--surface, #09090b)',
              borderColor: 'var(--border, #27272a)',
            }}
          >
            <button
              onClick={handleCopy}
              disabled={!optimizedText}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border hover:bg-white/5 transition-all cursor-pointer disabled:opacity-40"
              style={{
                borderColor: 'var(--border, #27272a)',
                color: 'var(--text, #f4f4f5)',
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copié !' : 'Copier'}</span>
            </button>

            <button
              onClick={handleApply}
              disabled={!optimizedText && !draftPrompt.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white transition-all cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <span>Appliquer au chat</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export const PromptOptimizerModal: React.FC<PromptOptimizerModalProps> = ({
  isOpen,
  onClose,
  initialPrompt,
  onApplyPrompt,
  activeModel,
}) => {
  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="prompt-optimizer-title"
    >
      <PromptOptimizerInner
        key={`${initialPrompt || 'new'}-${isOpen}`}
        initialPrompt={initialPrompt}
        onClose={onClose}
        onApplyPrompt={onApplyPrompt}
        activeModel={activeModel}
      />
    </div>
  );
};
