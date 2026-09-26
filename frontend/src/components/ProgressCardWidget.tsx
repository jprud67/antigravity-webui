import { useI18n } from '../services/i18n';
import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Circle, 
  Loader2, 
  ChevronDown, 
  ChevronUp, 
  ListTodo, 
  X
} from 'lucide-react';
import type { ProgressCardData } from '../types';

interface ProgressCardWidgetProps {
  card: ProgressCardData | null;
  onDismiss?: () => void;
}

export const ProgressCardWidget: React.FC<ProgressCardWidgetProps> = ({
  card,
  onDismiss
}) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(true);

  if (!card || !card.steps || card.steps.length === 0) {
    return null;
  }

  const completedSteps = card.steps.filter((s) => s.status === 'completed').length;
  const inProgressSteps = card.steps.filter((s) => s.status === 'in_progress').length;
  const totalSteps = card.steps.length;
  const percent = card.percent ?? Math.round((completedSteps / totalSteps) * 100);

  return (
    <div className="w-full my-3 animate-in fade-in slide-in-from-top-2 duration-300">
      <div 
        className="rounded-2xl border border-indigo-500/25 dark:border-indigo-500/30 overflow-hidden shadow-lg backdrop-blur-md"
        style={{
          backgroundColor: 'var(--surface, rgba(15, 23, 42, 0.75))',
          boxShadow: '0 8px 32px -4px rgba(99, 102, 241, 0.12)'
        }}
      >
        {/* Header with Title and Overall Gauge */}
        <div className="p-3.5 sm:p-4 flex items-center justify-between border-b border-indigo-500/15">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <ListTodo className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 truncate">
                  {card.title || t('ongoing_action_plan', "Plan d'action en cours")}
                </span>
                <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 border border-indigo-500/30 shrink-0">
                  {percent}%
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {t('completed_steps_progress', '{0} sur {1} terminée(s)').replace('{0}', String(completedSteps)).replace('{1}', String(totalSteps))}
                {inProgressSteps > 0 && ` • ${inProgressSteps} ${t('in_progress_short', 'en cours')}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors cursor-pointer"
              title={expanded ? t('collapse_plan', "Réduire le plan") : t('expand_plan', "Développer le plan")}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="p-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
                title={t('close_card_tooltip', 'Fermer la carte')}
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Dynamic Progress Bar */}
        <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-800/80 overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-emerald-400 transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Steps List & Context (Collapsible) */}
        {expanded && (
          <div className="p-3.5 sm:p-4 space-y-2.5">
            {card.markdown && (
              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed font-sans mb-3">
                {card.markdown}
              </div>
            )}

            <div className="space-y-1.5">
              {card.steps.map((step, idx) => {
                const isCompleted = step.status === 'completed';
                const isInProgress = step.status === 'in_progress';

                return (
                  <div 
                    key={idx}
                    className={`flex items-start gap-2.5 p-2 rounded-xl transition-all ${
                      isInProgress 
                        ? 'bg-amber-500/10 border border-amber-500/30' 
                        : isCompleted
                        ? 'bg-emerald-500/5 dark:bg-emerald-500/10'
                        : 'bg-transparent'
                    }`}
                  >
                    <div className="mt-0.5 shrink-0">
                      {isCompleted ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                      ) : isInProgress ? (
                        <Loader2 className="w-4 h-4 text-amber-500 animate-spin" />
                      ) : (
                        <Circle className="w-4 h-4 text-slate-400/60 dark:text-slate-600" />
                      )}
                    </div>
                    <span 
                      className={`text-xs leading-snug ${
                        isCompleted 
                          ? 'text-slate-400 dark:text-slate-500 line-through' 
                          : isInProgress 
                          ? 'text-amber-700 dark:text-amber-300 font-medium' 
                          : 'text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {step.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
