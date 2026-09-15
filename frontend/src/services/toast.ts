export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

type ToastListener = (item: ToastItem) => void;
let _listener: ToastListener | null = null;

export function registerToastListener(listener: ToastListener | null): void {
  _listener = listener;
}

/**
 * Show a transient toast notification (bottom-center, auto-dismiss).
 * Drop-in replacement for `alert()`.
 */
export function showToast(message: string, type: ToastType = 'info', duration = 3000): void {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  if (_listener) {
    _listener({ id, message, type, duration });
  } else {
    console.warn('[Toast] container not mounted, message:', message);
  }
}
