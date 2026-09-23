import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { type ConfirmRequest, registerConfirmListener } from '../services/dialog';

// ─── Confirm Dialog Container (mount once in App.tsx) ────────────
export const ConfirmDialogContainer: React.FC = () => {
  const [queue, setQueue] = useState<ConfirmRequest[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const queueRef = useRef<ConfirmRequest[]>(queue);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  const pushConfirm = useCallback((req: ConfirmRequest) => {
    setQueue((prev) => [...prev, req]);
  }, []);

  useEffect(() => {
    registerConfirmListener(pushConfirm);
    return () => {
      registerConfirmListener(null);
      queueRef.current.forEach((req) => req.resolve(false));
    };
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
      className="ag-dialog-overlay flex items-center justify-center"
      style={{ zIndex: 10000 }}
      onClick={(e) => { if (e.target === overlayRef.current) handleResolve(false); }}
    >
      <div
        className="glass-panel ag-dialog-panel max-w-md w-full mx-4 overflow-hidden"
        style={{
          color: 'var(--text)',
          fontFamily: 'var(--font-ui)',
          boxShadow: 'var(--shadow-xl)',
        }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-desc"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2.5">
            {current.destructive && <AlertTriangle className="w-4 h-4 text-red-500" />}
            <h3 id="confirm-dialog-title" className="text-sm font-semibold">{current.title}</h3>
          </div>
          <button
            onClick={() => handleResolve(false)}
            className="btn-icon"
            aria-label="Fermer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          <p id="confirm-dialog-desc" className="text-sm leading-relaxed" style={{ color: 'var(--text)' }}>
            {current.message}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <button
            onClick={() => handleResolve(false)}
            className="btn btn-secondary btn-sm"
          >
            {current.cancelLabel || 'Annuler'}
          </button>
          <button
            onClick={() => handleResolve(true)}
            className={`btn btn-sm font-medium ${current.destructive ? 'btn-danger' : 'btn-primary'}`}
            autoFocus
          >
            {current.confirmLabel || 'Confirmer'}
          </button>
        </div>
      </div>
    </div>
  );
};
