import React, { useState } from 'react';
import { Gauge, Coins, BrainCircuit, ArrowDownRight, ArrowUpRight } from 'lucide-react';

export interface TokenUsageData {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
}

interface ContextRingProps {
  usage?: TokenUsageData;
  modelId?: string;
}

export const ContextRing: React.FC<ContextRingProps> = ({ usage, modelId = 'gemini-3.8-flash' }) => {
  const [showPopover, setShowPopover] = useState(false);

  // Model context limits
  let contextLimit = 1_048_576; // 1M tokens by default (Gemini 3.8 / 3.7 / 3.6 / 3.1 Pro)
  if (modelId.toLowerCase().includes('claude')) {
    contextLimit = 200_000;
  } else if (modelId.toLowerCase().includes('gpt-oss')) {
    contextLimit = 131_072;
  }

  const total = usage?.totalTokens || 0;
  const input = usage?.inputTokens || 0;
  const thinking = usage?.thinkingTokens || 0;
  const output = usage?.outputTokens || 0;

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

  // Cost estimation ($)
  // Gemini approx: $0.15 / 1M prompt, $0.60 / 1M completion
  // Claude approx: $3.00 / 1M prompt, $15.00 / 1M completion
  let estCost = 0;
  if (modelId.toLowerCase().includes('claude')) {
    estCost = (input / 1_000_000) * 3.0 + (output / 1_000_000) * 15.0;
  } else {
    estCost = (input / 1_000_000) * 0.15 + (output / 1_000_000) * 0.6;
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
        title="Télémétrie du contexte et tokens"
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
          className="absolute bottom-full mb-2 right-0 w-64 p-3 bg-[#0c1222] border border-slate-700/80 rounded-2xl shadow-2xl shadow-black/80 text-xs z-50 animate-fadeIn space-y-2.5 backdrop-blur-xl"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <div className="flex items-center gap-1.5 font-semibold text-slate-200">
              <Gauge className="w-3.5 h-3.5 text-sky-400" />
              <span>Contexte Consommé</span>
            </div>
            <span className="font-mono text-[10px] text-slate-400">
              {displayPercent} de {formatNum(contextLimit)}
            </span>
          </div>

          {/* Progress bar */}
          <div className="w-full bg-slate-800/80 rounded-full h-1.5 overflow-hidden">
            <div
              style={{ width: `${Math.max(2, percent)}%`, backgroundColor: ringColor }}
              className="h-full rounded-full transition-all duration-300"
            />
          </div>

          {/* Token Breakdown */}
          <div className="space-y-1.5 text-[11px] font-mono">
            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1 text-slate-400">
                <ArrowDownRight className="w-3 h-3 text-sky-400" />
                Prompt (Entrée) :
              </span>
              <span className="text-slate-200">{formatNum(input)}</span>
            </div>

            {thinking > 0 && (
              <div className="flex items-center justify-between text-slate-400">
                <span className="flex items-center gap-1 text-amber-400/90">
                  <BrainCircuit className="w-3 h-3 text-amber-400" />
                  Thinking (Réflexion) :
                </span>
                <span className="text-amber-300">{formatNum(thinking)}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-slate-400">
              <span className="flex items-center gap-1 text-emerald-400/90">
                <ArrowUpRight className="w-3 h-3 text-emerald-400" />
                Réponse (Sortie) :
              </span>
              <span className="text-slate-200">{formatNum(output)}</span>
            </div>
          </div>

          {/* Cost Estimation */}
          <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-[10px]">
            <span className="text-slate-500 flex items-center gap-1">
              <Coins className="w-3 h-3 text-amber-400" />
              Coût estimé :
            </span>
            <span className="font-mono font-semibold text-emerald-400">
              ${estCost < 0.001 && estCost > 0 ? '<0.001' : estCost.toFixed(4)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
