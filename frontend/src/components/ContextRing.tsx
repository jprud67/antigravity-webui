import React, { useState } from 'react';
import { Gauge, Coins, BrainCircuit, ArrowDownRight, ArrowUpRight, Sparkles, Zap } from 'lucide-react';
import { useI18n } from '../services/i18n';

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  isEstimated?: boolean;
}

interface ContextRingProps {
  usage?: TokenUsageData;
  modelId?: string;
  activePrompt?: string;
  onNewChat?: () => void;
  onCompact?: () => void;
  isCompacting?: boolean;
}

export const ContextRing: React.FC<ContextRingProps> = ({ 
  usage, 
  modelId = 'gemini-3.8-flash',
  activePrompt = '',
  onNewChat,
  onCompact,
  isCompacting
}) => {
  const { t } = useI18n();
  const [showPopover, setShowPopover] = useState(false);

  // Accurate model context limits
  let contextLimit = 1_048_576; // 1M tokens by default
  const lowerModel = (modelId || '').toLowerCase();
  if (lowerModel.includes('gemini-3.1-pro') || lowerModel.includes('pro')) {
    contextLimit = 2_097_152; // 2M tokens for Gemini Pro
  } else if (lowerModel.includes('claude')) {
    contextLimit = 200_000;
  } else if (lowerModel.includes('gpt-oss')) {
    contextLimit = 131_072;
  } else {
    contextLimit = 1_048_576; // 1M for Gemini Flash
  }

  // Active prompt tokens estimated live
  const promptTokens = activePrompt.trim() 
    ? Math.max(1, Math.ceil(activePrompt.trim().length / 3.8)) 
    : 0;

  const baseInput = usage?.inputTokens || 0;
  const rawOutput = usage?.outputTokens || 0;
  const thinking = usage?.thinkingTokens || 0;
  const isEstimated = usage?.isEstimated ?? true;

  // In LLM APIs, outputTokens includes thinking tokens
  const responseTextTokens = Math.max(0, rawOutput - thinking);

  // Total input context currently consumed (base + messages history + active typed prompt)
  const totalInput = baseInput + promptTokens;
  const total = totalInput + rawOutput;

  const percent = Math.min(100, Math.max(0, (total / contextLimit) * 100));
  const displayPercent = percent < 0.1 && total > 0 ? '<0.1%' : `${percent.toFixed(1)}%`;

  // SVG ring parameters
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  const isContextHeavy = totalInput > 50_000 || percent > 25;
  let ringColor = '#10b981'; // Emerald
  let badgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (percent > 80) {
    ringColor = '#f43f5e'; // Rose
    badgeColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  } else if (percent > 50 || isContextHeavy) {
    ringColor = '#f59e0b'; // Amber
    badgeColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
  }

  // Model-specific cost estimation ($)
  let estCost = 0;
  if (lowerModel.includes('claude-opus')) {
    estCost = (totalInput / 1_000_000) * 15.0 + (rawOutput / 1_000_000) * 75.0;
  } else if (lowerModel.includes('claude')) {
    estCost = (totalInput / 1_000_000) * 3.0 + (rawOutput / 1_000_000) * 15.0;
  } else if (lowerModel.includes('gpt-oss')) {
    estCost = (totalInput / 1_000_000) * 0.20 + (rawOutput / 1_000_000) * 0.80;
  } else if (lowerModel.includes('gemini-3.1-pro') || lowerModel.includes('pro')) {
    estCost = (totalInput / 1_000_000) * 1.25 + (rawOutput / 1_000_000) * 5.0;
  } else {
    // Gemini 3.8 / 3.7 Flash
    estCost = (totalInput / 1_000_000) * 0.15 + (rawOutput / 1_000_000) * 0.60;
  }

  const formatNum = (num: number) => {
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(2) + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(1) + 'k';
    return num.toLocaleString();
  };

  return (
    <div className="relative inline-flex items-center">
      {/* Interactive Trigger Button */}
      <button
        type="button"
        onClick={() => setShowPopover(!showPopover)}
        onMouseEnter={() => setShowPopover(true)}
        onMouseLeave={() => setShowPopover(false)}
        className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-mono border transition-all cursor-pointer select-none ${badgeColor}`}
        title={t('context_telemetry', 'Context telemetry and token consumption')}
      >
        {/* Circular SVG Ring */}
        <div className="relative w-5 h-5 flex items-center justify-center">
          <svg className="w-5 h-5 transform -rotate-90" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke="currentColor"
              strokeWidth="2.5"
              fill="transparent"
              className="opacity-20"
            />
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke={ringColor}
              strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="transparent"
              className="transition-all duration-500 ease-out"
            />
          </svg>
        </div>

        <span>{formatNum(total)}</span>
        <span className="text-[9px] opacity-75 font-sans">({displayPercent})</span>
      </button>

      {/* Detail Popover */}
      {showPopover && (
        <div
          onMouseEnter={() => setShowPopover(true)}
          onMouseLeave={() => setShowPopover(false)}
          className="absolute bottom-full mb-2 right-0 w-72 p-3.5 rounded-2xl shadow-2xl text-xs z-50 animate-fadeIn space-y-3 backdrop-blur-xl border"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center gap-1.5 font-semibold" style={{ color: 'var(--strong)' }}>
              <Gauge className="w-3.5 h-3.5 text-sky-500" />
              <span>{t('context_consumed', 'Consumed Context')}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${isEstimated ? 'bg-sky-500/10 text-sky-500 border border-sky-500/20' : 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'}`}>
                {isEstimated ? t('estimated', 'Estimated') : t('api_live', 'API Live')}
              </span>
              <span className="font-mono text-[10px]" style={{ color: 'var(--muted)' }}>
                {displayPercent}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="w-full rounded-full h-1.5 overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
              <div
                style={{ width: `${Math.max(2, percent)}%`, backgroundColor: ringColor }}
                className="h-full rounded-full transition-all duration-300"
              />
            </div>
              <div className="flex justify-between text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                <span>{t('tokens_used', '{0} used').replace('{0}', formatNum(total))}</span>
                <span>{t('tokens_max', 'Max: {0}').replace('{0}', formatNum(contextLimit))}</span>
              </div>
          </div>

          {/* Token Breakdown - Exact Mathematical Consistency */}
          <div
            className="space-y-1.5 text-[11px] font-mono p-2.5 rounded-xl border"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <div className="flex items-center justify-between" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                <ArrowDownRight className="w-3 h-3 text-sky-500" />
                {t('prompt_base_history', 'Prompt (Base + History):')}
              </span>
              <span className="font-medium" style={{ color: 'var(--strong)' }}>{formatNum(baseInput)}</span>
            </div>

            {promptTokens > 0 && (
              <div className="flex items-center justify-between text-sky-500">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-sky-500" />
                  {t('current_input', '+ Current input:')}
                </span>
                <span className="font-semibold">+{formatNum(promptTokens)}</span>
              </div>
            )}

            {thinking > 0 && (
              <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1 text-amber-500">
                  <BrainCircuit className="w-3 h-3 text-amber-500" />
                  {t('thinking', 'Thinking')}:
                </span>
                <span className="text-amber-500 font-medium">{formatNum(thinking)}</span>
              </div>
            )}

            {rawOutput > 0 && (
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1 text-emerald-500">
                  <ArrowUpRight className="w-3 h-3 text-emerald-500" />
                  {t('response', 'Response (Generation):')}
                </span>
                <span className="font-medium" style={{ color: 'var(--strong)' }}>
                  {formatNum(responseTextTokens > 0 ? responseTextTokens : rawOutput)}
                </span>
              </div>
            )}

            <div
              className="pt-1.5 mt-1 border-t flex items-center justify-between font-semibold"
              style={{ borderColor: 'var(--border)', color: 'var(--strong)' }}
            >
              <span style={{ color: 'var(--text)' }}>{t('total_active_context', 'Total Active Context:')}</span>
              <span style={{ color: 'var(--strong)' }}>{formatNum(total)}</span>
            </div>
          </div>

          {/* Cost Estimation */}
          <div className="pt-1 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              {t('estimated_cost', 'Estimated Cost')}:
            </span>
            <span className="font-mono font-semibold text-emerald-400">
              ${estCost < 0.0001 && estCost > 0 ? '<0.0001' : estCost.toFixed(4)}
            </span>
          </div>

          {/* Context Actions (Compaction & Purge) */}
          {(isContextHeavy || onCompact) && (
            <div className="pt-2 mt-2 border-t flex flex-col gap-1.5" style={{ borderColor: 'var(--border)' }}>
              {isContextHeavy && (
                <div className="flex items-start gap-1.5 text-[11px] text-amber-400 font-medium mb-1">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>{t('context_heavy_warning', 'Contexte lourd : les prochains tours réinjecteront un volume élevé de tokens.')}</span>
                </div>
              )}
              {onCompact && (
                <button
                  type="button"
                  disabled={isCompacting}
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPopover(false);
                    onCompact();
                  }}
                  className="w-full py-1.5 px-2 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 border border-emerald-500/30 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                  title="Compresse les sorties d'outils volumineuses des tours passés pour économiser jusqu'à 80% de tokens"
                >
                  <Zap className="w-3 h-3 text-emerald-400" />
                  <span>{isCompacting ? t('compacting', 'Compactage...') : t('btn_compact_context', 'Compacter l\'historique (-80% tokens)')}</span>
                </button>
              )}
              {isContextHeavy && onNewChat && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowPopover(false);
                    onNewChat();
                  }}
                  className="w-full py-1.5 px-2 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span>{t('btn_new_chat_purge', 'Nouvelle conversation (Purger)')}</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
