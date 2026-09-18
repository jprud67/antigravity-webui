import React, { useState } from 'react';
import { Check, X, ShieldCheck, Lock, AlertTriangle } from 'lucide-react';
import { chatSocket } from '../services/ws';
import { useI18n } from '../services/i18n';

interface ApprovalCardProps {
  toolName: string;
  command?: string;
  path?: string;
  onResolved?: (decision: string) => void;
}

export const ApprovalCard: React.FC<ApprovalCardProps> = ({
  toolName,
  command,
  path,
  onResolved
}) => {
  const { t } = useI18n();
  const [decision, setDecision] = useState<string | null>(null);

  const handleAction = (dec: 'allow-once' | 'allow-session' | 'always-allow' | 'deny') => {
    setDecision(dec);
    // Derive rule to add if permanent
    let rule: string | undefined = undefined;
    if (dec === 'always-allow') {
      if (command) {
        const trimmed = command.trim();
        const firstWord = trimmed.split(/\s+/)[0];
        rule = firstWord ? `command(${firstWord} *)` : `command(${trimmed})`;
      } else if (path) {
        rule = `write_file(${path})`;
      } else if (toolName) {
        rule = `${toolName}(*)`;
      }
    }

    chatSocket.sendApproval(dec, rule);
    if (onResolved) onResolved(dec);
  };

  if (decision) {
    const isAllowed = decision !== 'deny';
    return (
      <div className={`p-3 my-3 rounded-xl border flex items-center justify-between text-xs animate-fadeIn ${
        isAllowed
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
          : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
      }`}>
        <div className="flex items-center gap-2">
          {isAllowed ? <Check className="w-4 h-4 text-emerald-400" /> : <X className="w-4 h-4 text-rose-400" />}
          <span className="font-medium">
            {decision === 'allow-once' && t('approval_allowed_once', 'Action authorized once.')}
            {decision === 'allow-session' && t('approval_allowed_session', 'Action authorized for the whole session.')}
            {decision === 'always-allow' && t('approval_allowed_always', 'Action permanently authorized (rule saved).')}
            {decision === 'deny' && t('approval_denied', 'Action denied by user.')}
          </span>
        </div>
        <span className="text-[10px] font-mono opacity-70 uppercase tracking-wider">{decision}</span>
      </div>
    );
  }

  return (
    <div
      className="my-3 p-4 rounded-2xl border shadow-xl animate-fadeIn"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border2)',
        color: 'var(--text)'
      }}
    >
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-500 shrink-0">
          <AlertTriangle className="w-5 h-5" />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-amber-500">
              <span>{t('approval_security_required', 'Security Confirmation Required')}</span>
            </h4>
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
            >
              {toolName}
            </span>
          </div>

          <p className="text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
            {t('approval_prompt_text', "L'agent sollicite votre approbation pour exécuter cette opération sur le système :")}
          </p>

          {(command || path) && (
            <div
              className="p-2.5 rounded-xl font-mono text-xs break-all select-text border"
              style={{
                backgroundColor: 'var(--code-bg, var(--surface-subtle))',
                borderColor: 'var(--border)',
                color: 'var(--pre-text, var(--text))'
              }}
            >
              <code>{command || path}</code>
            </div>
          )}

          {/* Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleAction('allow-once')}
              className="py-1.5 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-emerald-600/20"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('approval_btn_once', 'Autoriser 1 fois')}</span>
            </button>

            <button
              onClick={() => handleAction('allow-session')}
              className="py-1.5 px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-sky-600/20"
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t('approval_btn_session', 'Pour la session')}</span>
            </button>

            <button
              onClick={() => handleAction('always-allow')}
              className="py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>{t('approval_btn_always', 'Toujours autoriser')}</span>
            </button>

            <button
              onClick={() => handleAction('deny')}
              className="py-1.5 px-3 rounded-lg bg-rose-600/80 hover:bg-rose-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer ml-auto"
            >
              <X className="w-3.5 h-3.5" />
              <span>{t('approval_btn_deny', 'Refuser')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
