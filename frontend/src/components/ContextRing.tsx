import React, { useState } from 'react';
import { Gauge, Coins, BrainCircuit, ArrowDownRight, ArrowUpRight, Sparkles } from 'lucide-react';

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
}

export const ContextRing: React.FC<ContextRingProps> = ({ 
  usage, 
  modelId = 'gemini-3.8-flash',
  activePrompt = ''
}) => {
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
  const total = usage?.totalTokens && !promptTokens 
    ? usage.totalTokens 
    : (totalInput + rawOutput);

  const percent = Math.min(100, Math.max(0, (total / contextLimit) * 100));
  const displayPercent = percent < 0.1 && total > 0 ? '<0.1%' : `${percent.toFixed(1)}%`;

  // SVG ring parameters
  const radius = 9;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  let ringColor = '#10b981'; // Emerald
  let badgeColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
  if (percent > 80) {
    ringColor = '#f43f5e'; // Rose
    badgeColor = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  } else if (percent > 50) {
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
        title="Télémétrie du contexte et tokens consommés"
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
              className="text-slate-800"
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
          className="absolute bottom-full mb-2 right-0 w-72 p-3.5 bg-[#0c1222] border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 text-xs z-50 animate-fadeIn space-y-3 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Gauge className="w-3.5 h-3.5 text-sky-400" />
              <span>Contexte Consommé</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${isEstimated ? 'bg-sky-500/10 text-sky-300 border border-sky-500/20' : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'}`}>
                {isEstimated ? 'Estimé' : 'API Live'}
              </span>
              <span className="font-mono text-[10px] text-slate-400">
                {displayPercent}
              </span>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
              <div
                style={{ width: `${Math.max(2, percent)}%`, backgroundColor: ringColor }}
                className="h-full rounded-full transition-all duration-300"
              />
            </div>
            <div className="flex justify-between text-[10px] font-mono text-slate-500">
              <span>{formatNum(total)} utilisés</span>
              <span>Max : {formatNum(contextLimit)}</span>
            </div>
          </div>

          {/* Token Breakdown - Exact Mathematical Consistency */}
          <div className="space-y-1.5 text-[11px] font-mono bg-[#070b14] p-2.5 rounded-xl border border-slate-800/60">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowDownRight className="w-3 h-3 text-sky-400" />
                Prompt (Base + Historique) :
              </span>
              <span className="text-slate-200 font-medium">{formatNum(baseInput)}</span>
            </div>

            {promptTokens > 0 && (
              <div className="flex items-center justify-between text-sky-300">
                <span className="flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-sky-400" />
                  + Saisie en cours :
                </span>
                <span className="font-semibold">+{formatNum(promptTokens)}</span>
              </div>
            )}

            {thinking > 0 && (
              <div className="flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-1 text-amber-400/90">
                  <BrainCircuit className="w-3 h-3 text-amber-400" />
                  Réflexion (Thinking) :
                </span>
                <span className="text-amber-300">{formatNum(thinking)}</span>
              </div>
            )}

            {rawOutput > 0 && (
              <div className="flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-1 text-emerald-400/90">
                  <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                  Réponse (Génération) :
                </span>
                <span className="text-slate-200 font-medium">
                  {formatNum(responseTextTokens > 0 ? responseTextTokens : rawOutput)}
                </span>
              </div>
            )}

            <div className="pt-1.5 mt-1 border-t border-slate-800 flex items-center justify-between font-semibold text-slate-200">
              <span className="text-slate-300">Total Contexte Actif :</span>
              <span className="text-white">{formatNum(total)}</span>
            </div>
          </div>

          {/* Cost Estimation */}
          <div className="pt-1 flex items-center justify-between text-[11px]">
            <span className="text-slate-500 flex items-center gap-1">
              <Coins className="w-3.5 h-3.5 text-amber-400" />
              Coût estimé :
            </span>
            <span className="font-mono font-semibold text-emerald-400">
              ${estCost < 0.0001 && estCost > 0 ? '<0.0001' : estCost.toFixed(4)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
