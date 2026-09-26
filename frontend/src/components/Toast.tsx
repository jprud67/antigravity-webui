import { useI18n } from '../services/i18n';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';
import { type ToastType, type ToastItem, registerToastListener } from '../services/toast';

// ─── Icons per type ──────────────────────────────────────────────
const ICON_MAP: Record<ToastType, React.FC<{ className?: string }>> = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLOR_MAP: Record<ToastType, string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-sky-500',
};

const BG_MAP: Record<ToastType, string> = {
  success: 'border-emerald-500/30',
  error: 'border-red-500/30',
  warning: 'border-amber-500/30',
  info: 'border-sky-500/30',
};

// ─── Single Toast ────────────────────────────────────────────────
const ToastEntry: React.FC<{ item: ToastItem; onDismiss: (id: string) => void }> = ({ item, onDismiss }) => {
  const { t } = useI18n();
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedRef = useRef(false);

  const handleDismiss = useCallback(() => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setExiting(true);
    exitTimerRef.current = setTimeout(() => {
      onDismiss(item.id);
    }, 200);
  }, [item.id, onDismiss]);

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      handleDismiss();
    }, item.duration);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [item.duration, handleDismiss]);

  const Icon = ICON_MAP[item.type];

  return (
    <div
      className={`glass-panel flex items-center gap-2.5 px-4 py-2.5 border shadow-lg max-w-sm ${BG_MAP[item.type]}`}
      style={{
        color: 'var(--text)',
        borderWidth: 1,
        animation: exiting
          ? 'ag-toast-out var(--transition-base) var(--ease-out-expo) forwards'
          : 'ag-toast-in var(--transition-base) var(--ease-spring) both',
      }}
      role="alert"
      aria-live="assertive"
    >
      <Icon className={`w-4 h-4 shrink-0 ${COLOR_MAP[item.type]}`} />
      <span className="text-sm leading-snug flex-1" style={{ fontFamily: 'var(--font-ui)' }}>{item.message}</span>
      <button
        onClick={handleDismiss}
        className="btn-icon shrink-0"
        aria-label={t('close_notification', 'Fermer la notification')}
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
};

// ─── Toast Container (mount once in App.tsx) ─────────────────────
export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((item: ToastItem) => {
    setToasts((prev) => [...prev.slice(-4), item]); // Keep max 5
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Register global callback
  useEffect(() => {
    registerToastListener(addToast);
    return () => { registerToastListener(null); };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col-reverse gap-2 pointer-events-auto"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <ToastEntry key={t.id} item={t} onDismiss={removeToast} />
      ))}
    </div>
  );
};
