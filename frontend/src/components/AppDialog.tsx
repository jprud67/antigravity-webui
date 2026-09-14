import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────
interface ConfirmRequest {
  id: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

// ─── Global Confirm API ──────────────────────────────────────────
let _pushConfirm: ((req: ConfirmRequest) => void) | null = null;

/**
 * In-app replacement for native `confirm()`.
 * Returns a Promise<boolean> — true if user clicked confirm, false if cancelled.
 *
 * Usage:
 *   if (await showConfirm('Supprimer ?', { destructive: true })) { ... }
 */
export function showConfirm(
  messageOrOpts: string | {
    title?: string;
    message: string;
    confirmText?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  },
  opts?: {
    title?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }
): Promise<boolean> {
  const isObj = typeof messageOrOpts === 'object';
  const message = isObj ? messageOrOpts.message : messageOrOpts;
  const title = isObj ? (messageOrOpts.title || 'Confirmation') : (opts?.title || 'Confirmation');
  const confirmLabel = isObj ? (messageOrOpts.confirmLabel || messageOrOpts.confirmText) : opts?.confirmLabel;
  const cancelLabel = isObj ? messageOrOpts.cancelLabel : opts?.cancelLabel;
  const destructive = isObj ? (messageOrOpts.destructive ?? false) : (opts?.destructive ?? false);

  return new Promise<boolean>((resolve) => {
    const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (_pushConfirm) {
      _pushConfirm({
        id,
        title,
        message,
        confirmLabel,
        cancelLabel,
        destructive,
        resolve,
      });
    } else {
      // Fallback if container not mounted
      resolve(window.confirm(message));
    }
  });
}

// ─── Confirm Dialog Container (mount once in App.tsx) ────────────
export const ConfirmDialogContainer: React.FC = () => {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);

  const pushConfirm = useCallback((req: ConfirmRequest) => {
    setQueue((prev) => [...prev, req]);
  }, []);

  useEffect(() => {
    _pushConfirm = pushConfirm;
    return () => { _pushConfirm = null; };
  }, [pushConfirm]);

  const current = queue[0];

  const handleResolve = useCallback((confirmed: boolean) => {
    if (!current) return;
    current.resolve(confirmed);
    setQueue((prev) => prev.slice(1));
  }, [current]);

  // Handle Escape and Enter keys
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleResolve(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleResolve(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [current, handleResolve]);

  if (!current) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[10000] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) handleResolve(false); }}
    >
      <div
        className="rounded-xl border shadow-2xl max-w-md w-full mx-4 overflow-hidden animate-in fade-in zoom-in-95"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            {current.destructive && <AlertTriangle className="w-4 h-4 text-red-500" />}
            <h3 className="text-sm font-semibold">{current.title}</h3>
          </div>
          <button
            onClick={() => handleResolve(false)}
            className="p-1 rounded-lg hover:bg-white/10 transition-colors"
            style={{ color: 'var(--muted)' }}
            aria-label="Fermer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
            {current.message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => handleResolve(false)}
            className="px-4 py-1.5 text-sm rounded-lg border transition-colors hover:opacity-80"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            {current.cancelLabel || 'Annuler'}
          </button>
          <button
            onClick={() => handleResolve(true)}
            className={`px-4 py-1.5 text-sm rounded-lg border transition-colors hover:opacity-90 font-medium ${
              current.destructive
                ? 'bg-red-600 border-red-600 text-white hover:bg-red-700'
                : ''
            }`}
            style={
              current.destructive
                ? undefined
                : {
                    backgroundColor: 'var(--accent)',
                    borderColor: 'var(--accent)',
                    color: '#fff',
                  }
            }
            autoFocus
          >
            {current.confirmLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
};
