import React, { useState } from 'react';
import { Lock, KeyRound, AlertCircle, ArrowRight, X } from 'lucide-react';
import { useI18n } from '../services/i18n';
import { unlockShareToken } from '../services/api';
import type { ShareVerificationResult } from '../types';

interface SharePinModalProps {
  isOpen: boolean;
  token: string;
  onUnlocked: (result: ShareVerificationResult) => void;
  onCancel?: () => void;
}

export const SharePinModal: React.FC<SharePinModalProps> = ({
  isOpen,
  token,
  onUnlocked,
  onCancel
}) => {
  const { t } = useI18n();
  const [pin, setPin] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pin.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const res = await unlockShareToken(token, pin.trim());
      if (res.valid) {
        onUnlocked(res);
      } else {
        setError(res.reason || 'Code PIN incorrect');
      }
    } catch (err: any) {
      setError(err.message || 'Code PIN incorrect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
    >
      <div
        className="relative w-full max-w-sm bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden p-6 text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {onCancel && (
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 p-1 text-zinc-500 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          >
            <X size={16} />
          </button>
        )}

        <div className="flex flex-col items-center text-center space-y-3 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-inner">
            <Lock size={24} />
          </div>
          <h2 className="text-lg font-semibold text-white tracking-tight">
            {t('share_pin_required_title') || 'Protected Session'}
          </h2>
          <p className="text-xs text-zinc-400 max-w-[260px]">
            {t('share_pin_required_desc') || 'This shared session requires a PIN code to access.'}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <div className="relative">
              <input
                type="password"
                autoFocus
                maxLength={8}
                value={pin}
                onChange={(e) => {
                  setPin(e.target.value.replace(/\D/g, ''));
                  setError(null);
                }}
                placeholder={t('share_pin_placeholder') || 'Enter 4 to 8 digits...'}
                className="w-full bg-zinc-800/80 border border-zinc-700/80 rounded-xl px-4 py-2.5 text-center text-base tracking-widest font-mono text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 transition shadow-inner"
              />
              <KeyRound size={16} className="absolute left-3.5 top-3 text-zinc-500" />
            </div>

            {error && (
              <div className="flex items-center gap-1.5 text-xs text-red-400 justify-center pt-1 animate-shake">
                <AlertCircle size={13} />
                <span>{error}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || pin.length < 4}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-purple-900/30"
          >
            <span>{loading ? '...' : t('share_pin_submit') || 'Unlock Session'}</span>
            <ArrowRight size={14} />
          </button>
        </form>
      </div>
    </div>
  );
};
