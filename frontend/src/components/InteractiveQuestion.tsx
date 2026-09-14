import React, { useState } from 'react';
import { HelpCircle, CheckCircle2, Send, Check } from 'lucide-react';

export interface QuestionItem {
  question: string;
  options: string[];
  is_multi_select?: boolean;
}

interface InteractiveQuestionProps {
  toolArgs: any;
  onAnswer: (answer: string) => void;
  disabled?: boolean;
}

export const InteractiveQuestion: React.FC<InteractiveQuestionProps> = ({
  toolArgs,
  onAnswer,
  disabled = false,
}) => {
  const questions: QuestionItem[] = Array.isArray(toolArgs?.questions)
    ? toolArgs.questions
    : toolArgs?.question
    ? [{ question: toolArgs.question, options: toolArgs.options || [], is_multi_select: toolArgs.is_multi_select }]
    : [];

  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string[]>>({});
  const [customInputs, setCustomInputs] = useState<Record<number, string>>({});
  const [submitted, setSubmitted] = useState(false);
  const [finalAnswer, setFinalAnswer] = useState<string>('');

  React.useEffect(() => {
    setSelectedAnswers({});
    setCustomInputs({});
    setSubmitted(false);
    setFinalAnswer('');
  }, [toolArgs]);

  if (questions.length === 0) return null;

  const handleOptionToggle = (qIdx: number, opt: string, isMulti: boolean) => {
    if (submitted || disabled) return;

    setSelectedAnswers((prev) => {
      const current = prev[qIdx] || [];
      if (isMulti) {
        if (current.includes(opt)) {
          return { ...prev, [qIdx]: current.filter((o) => o !== opt) };
        } else {
          return { ...prev, [qIdx]: [...current, opt] };
        }
      } else {
        return { ...prev, [qIdx]: [opt] };
      }
    });
  };

  const handleSubmit = () => {
    if (submitted || disabled) return;

    const summaryParts: string[] = [];
    questions.forEach((_q, idx) => {
      const chosen = selectedAnswers[idx] || [];
      const custom = customInputs[idx]?.trim();
      const allForQ = [...chosen];
      if (custom) allForQ.push(custom);

      if (allForQ.length > 0) {
        summaryParts.push(allForQ.join(', '));
      }
    });

    const fullAnswer = summaryParts.join('\n');
    if (!fullAnswer.trim()) return;

    setSubmitted(true);
    setFinalAnswer(fullAnswer);
    onAnswer(fullAnswer);
  };

  return (
    <div className="w-full my-2 bg-gradient-to-br from-[#0c1426] via-[#090e1c] to-[#070a14] border border-sky-500/40 rounded-2xl p-4 shadow-xl shadow-sky-500/10 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-sky-500/20">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-xl bg-sky-500/20 border border-sky-500/30 flex items-center justify-center">
            <HelpCircle className="w-4 h-4 text-sky-400 animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-semibold text-slate-100">Action Requise : Choix Utilisateur</span>
            <p className="text-[10px] text-slate-400">L'agent sollicite vos instructions pour orienter la suite</p>
          </div>
        </div>

        {submitted && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Répondu
          </span>
        )}
      </div>

      {submitted ? (
        <div className="p-3 rounded-xl bg-emerald-950/30 border border-emerald-500/30 text-emerald-200 text-xs flex flex-col gap-1">
          <span className="text-[10px] text-emerald-400 font-semibold uppercase tracking-wider">Choix transmis à Antigravity :</span>
          <p className="font-mono whitespace-pre-wrap">{finalAnswer}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, qIdx) => {
            const isMulti = !!q.is_multi_select;
            const currentSelected = selectedAnswers[qIdx] || [];

            return (
              <div key={qIdx} className="space-y-2.5">
                <h4 className="text-xs font-medium text-slate-200 leading-snug">
                  {q.question}
                </h4>

                {/* Options List */}
                <div className="grid grid-cols-1 gap-2">
                  {(q.options || []).map((opt, optIdx) => {
                    const isSelected = currentSelected.includes(opt);
                    const isRecommended = opt.toLowerCase().includes('(recommended)');

                    return (
                      <button
                        key={optIdx}
                        type="button"
                        onClick={() => handleOptionToggle(qIdx, opt, isMulti)}
                        disabled={disabled}
                        className={`w-full text-left p-2.5 rounded-xl border text-xs transition-all flex items-start gap-2.5 cursor-pointer ${
                          isSelected
                            ? 'bg-sky-500/20 border-sky-400 text-white shadow-sm ring-1 ring-sky-400/40'
                            : 'bg-[#080d1a] border-slate-800 text-slate-300 hover:border-slate-700 hover:bg-slate-900/80'
                        }`}
                      >
                        <div
                          className={`w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border transition-all ${
                            isSelected
                              ? 'bg-sky-500 border-sky-400 text-white'
                              : 'border-slate-600 bg-slate-800/50'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        <div className="flex-1">
                          <span className={isSelected ? 'font-semibold text-sky-200' : ''}>
                            {opt}
                          </span>
                          {isRecommended && !isSelected && (
                            <span className="ml-2 text-[9px] bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded font-mono">
                              Recommandé
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {/* Custom write-in input */}
                <div className="pt-1">
                  <input
                    type="text"
                    placeholder="Ou saisissez une réponse personnalisée..."
                    value={customInputs[qIdx] || ''}
                    onChange={(e) =>
                      setCustomInputs((prev) => ({ ...prev, [qIdx]: e.target.value }))
                    }
                    disabled={disabled}
                    className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500/60 font-mono"
                  />
                </div>
              </div>
            );
          })}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                disabled ||
                (Object.values(selectedAnswers).every((arr) => arr.length === 0) &&
                  Object.values(customInputs).every((s) => !s?.trim()))
              }
              className="py-2 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-medium text-xs flex items-center gap-2 shadow-lg shadow-sky-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Valider le choix</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
