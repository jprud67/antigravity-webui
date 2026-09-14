import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertTriangle, Info, AlertCircle } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

// ─── Global Toast API ────────────────────────────────────────────
let _addToast: ((item: ToastItem) => void) | null = null;

/**
 * Show a transient toast notification (bottom-center, auto-dismiss).
 * Drop-in replacement for `alert()`.
 */
export function showToast(message: string, type: ToastType = 'info', duration = 3000): void {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (_addToast) {
    _addToast({ id, message, type, duration });
  } else {
    // Fallback if ToastContainer not mounted yet (should never happen in practice)
    console.warn('[Toast] container not mounted, message:', message);
  }
}

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
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    timerRef.current = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onDismiss(item.id), 250);
    }, item.duration);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [item.id, item.duration, onDismiss]);

  const Icon = ICON_MAP[item.type];

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-lg backdrop-blur-sm max-w-sm transition-all duration-250 ${BG_MAP[item.type]} ${exiting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'}`}
      style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', borderWidth: 1 }}
      role="alert"
    >
      <Icon className={`w-4 h-4 shrink-0 ${COLOR_MAP[item.type]}`} />
      <span className="text-sm leading-snug flex-1" style={{ fontFamily: 'var(--font-ui)' }}>{item.message}</span>
      <button
        onClick={() => { setExiting(true); setTimeout(() => onDismiss(item.id), 200); }}
        className="shrink-0 p-0.5 rounded hover:bg-white/10 transition-colors"
        style={{ color: 'var(--muted)' }}
        aria-label="Fermer"
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
    _addToast = addToast;
    return () => { _addToast = null; };
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
