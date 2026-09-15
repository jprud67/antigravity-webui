export interface ConfirmRequest {
  id: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface ShowConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export interface ShowConfirmObjectOptions extends ShowConfirmOptions {
  message: string;
  confirmText?: string;
}

type ConfirmListener = (req: ConfirmRequest) => void;
let _pushConfirm: ConfirmListener | null = null;

export function registerConfirmListener(listener: ConfirmListener | null): void {
  _pushConfirm = listener;
}

/**
 * In-app replacement for native `confirm()`.
 * Returns a Promise<boolean> — true if user clicked confirm, false if cancelled.
 *
 * Usage:
 *   if (await showConfirm('Supprimer ?', { destructive: true })) { ... }
 */
export function showConfirm(
  messageOrOpts: string | ShowConfirmObjectOptions,
  opts?: ShowConfirmOptions
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
