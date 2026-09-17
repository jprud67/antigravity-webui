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

  const argsKey = React.useMemo(() => {
    try {
      return JSON.stringify(toolArgs);
    } catch {
      return '';
    }
  }, [toolArgs]);

  const [prevArgsKey, setPrevArgsKey] = useState(argsKey);
  if (argsKey !== prevArgsKey) {
    setPrevArgsKey(argsKey);
    setSelectedAnswers({});
    setCustomInputs({});
    setSubmitted(false);
    setFinalAnswer('');
  }

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
      const chosen = (selectedAnswers[idx] || []).filter((opt) => Boolean(opt && opt.trim()));
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
    <div
      className="w-full my-2 border rounded-2xl p-4 shadow-xl animate-fadeIn"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border2)',
        color: 'var(--text)'
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between pb-3 mb-3 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-xl flex items-center justify-center border"
            style={{
              backgroundColor: 'var(--accent-bg)',
              borderColor: 'var(--accent-bg-strong)',
              color: 'var(--accent)'
            }}
          >
            <HelpCircle className="w-4 h-4 animate-pulse" />
          </div>
          <div>
            <span className="text-xs font-semibold" style={{ color: 'var(--strong)' }}>
              Action Requise : Choix Utilisateur
            </span>
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
              L'agent sollicite vos instructions pour orienter la suite
            </p>
          </div>
        </div>

        {submitted && (
          <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Répondu
          </span>
        )}
      </div>

      {submitted ? (
        <div
          className="p-3 rounded-xl border text-xs flex flex-col gap-1"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <span className="text-[10px] text-emerald-500 font-semibold uppercase tracking-wider">
            Choix transmis à Antigravity :
          </span>
          <p className="font-mono whitespace-pre-wrap" style={{ color: 'var(--text)' }}>
            {finalAnswer}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {questions.map((q, qIdx) => {
            const isMulti = !!q.is_multi_select;
            const currentSelected = selectedAnswers[qIdx] || [];

            return (
              <div key={qIdx} className="space-y-2.5">
                <h4 className="text-xs font-medium leading-snug" style={{ color: 'var(--strong)' }}>
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
                        className="w-full text-left p-2.5 rounded-xl border text-xs transition-all flex items-start gap-2.5 cursor-pointer"
                        style={{
                          backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          color: isSelected ? 'var(--accent-text)' : 'var(--text)'
                        }}
                      >
                        <div
                          className="w-4 h-4 rounded mt-0.5 flex items-center justify-center shrink-0 border transition-all"
                          style={{
                            backgroundColor: isSelected ? 'var(--accent)' : 'var(--surface)',
                            borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                            color: '#ffffff'
                          }}
                        >
                          {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>

                        <div className="flex-1">
                          <span className={isSelected ? 'font-semibold' : ''}>
                            {opt}
                          </span>
                          {isRecommended && !isSelected && (
                            <span className="ml-2 text-[9px] bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30 px-1.5 py-0.2 rounded font-mono">
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
                    className="w-full px-3 py-2 border rounded-xl text-xs placeholder-slate-400 focus:outline-none focus:ring-1 font-mono"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
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
              className="py-2 px-4 rounded-xl text-white font-medium text-xs flex items-center gap-2 shadow-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
              style={{ backgroundColor: 'var(--accent)' }}
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
