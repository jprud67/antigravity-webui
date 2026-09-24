import { fetchInlineCompletion } from './api';

export interface CopilotOptions {
  debounceMs?: number;
  maxTokens?: number;
  temperature?: number;
  onStatusChange?: (status: 'idle' | 'generating' | 'suggested' | 'disabled') => void;
}

const COPILOT_ENABLED_KEY = 'antigravity_copilot_enabled';
const DEFAULT_DEBOUNCE_MS = 280;

let isRegistered = false;
let activeAbortController: AbortController | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function isCopilotEnabled(): boolean {
  if (typeof window === 'undefined') return true;
  const stored = localStorage.getItem(COPILOT_ENABLED_KEY);
  return stored !== 'false';
}

export function setCopilotEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(COPILOT_ENABLED_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new CustomEvent('antigravity:copilot-toggle', { detail: { enabled } }));
}

/**
 * Enregistre le fournisseur natif de Ghost Text Monaco (InlineCompletionsProvider).
 * Fonctionne avec tous les langages et s'intègre avec les touches Tab (accepter) et Échap (rejeter).
 */
export function registerMonacoCopilot(monaco: any, options: CopilotOptions = {}): { dispose: () => void } {
  if (!monaco || !monaco.languages) {
    return { dispose: () => {} };
  }

  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const provider = {
    provideInlineCompletions: async (
      model: any,
      position: any,
      _context: any,
      token: any
    ) => {
      // 1. Vérifier si le Copilot est activé
      if (!isCopilotEnabled()) {
        return { items: [] };
      }

      // 2. Annuler toute requête précédente encore en vol
      if (activeAbortController) {
        activeAbortController.abort();
        activeAbortController = null;
      }
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }

      // 3. Récupérer le contexte de code (Prefix & Suffix autour du curseur)
      const lineCount = model.getLineCount();
      const currentLine = position.lineNumber;
      const currentColumn = position.column;

      // Préfixe : jusqu'à 80 lignes au-dessus + début de ligne courante
      const startLine = Math.max(1, currentLine - 80);
      const prefixRange = new monaco.Range(startLine, 1, currentLine, currentColumn);
      const prefix = model.getValueInRange(prefixRange);

      // Si le préfixe est vide ou ne contient que des espaces sans caractère
      if (!prefix || !prefix.trim()) {
        return { items: [] };
      }

      // Suffixe : fin de la ligne courante + jusqu'à 30 lignes en-dessous
      const endLine = Math.min(lineCount, currentLine + 30);
      const endLineMaxCol = model.getLineMaxColumn(endLine);
      const suffixRange = new monaco.Range(currentLine, currentColumn, endLine, endLineMaxCol);
      const suffix = model.getValueInRange(suffixRange);

      const language = model.getLanguageId() || 'text';
      const filePath = model.uri?.path || undefined;

      // 4. Temporisation avec Debounce et CancellationToken
      const abortController = new AbortController();
      activeAbortController = abortController;

      if (token && typeof token.onCancellationRequested === 'function') {
        token.onCancellationRequested(() => {
          abortController.abort();
        });
      }

      try {
        // Attendre le délai de frappe (debounce)
        await new Promise<void>((resolve, reject) => {
          debounceTimer = setTimeout(() => {
            if (token?.isCancellationRequested) {
              reject(new Error('cancelled'));
            } else {
              resolve();
            }
          }, debounceMs);
        });

        if (token?.isCancellationRequested) {
          return { items: [] };
        }

        options.onStatusChange?.('generating');
        window.dispatchEvent(new CustomEvent('antigravity:copilot-status', { detail: { status: 'generating' } }));

        // 5. Appel au backend FastAPI (/api/copilot/inline-suggest)
        const response = await fetchInlineCompletion(
          {
            prefix,
            suffix,
            language,
            file_path: filePath,
            max_tokens: options.maxTokens ?? 120,
            temperature: options.temperature ?? 0.2
          },
          abortController.signal
        );

        if (token?.isCancellationRequested || !response.suggestion) {
          options.onStatusChange?.('idle');
          window.dispatchEvent(new CustomEvent('antigravity:copilot-status', { detail: { status: 'idle' } }));
          return { items: [] };
        }

        options.onStatusChange?.('suggested');
        window.dispatchEvent(
          new CustomEvent('antigravity:copilot-status', {
            detail: {
              status: 'suggested',
              latency: response.latency_ms,
              cached: response.cached
            }
          })
        );

        // 6. Formater le résultat pour Monaco InlineCompletion
        return {
          items: [
            {
              insertText: response.suggestion,
              range: new monaco.Range(currentLine, currentColumn, currentLine, currentColumn)
            }
          ]
        };
      } catch (err: any) {
        if (err?.name === 'AbortError' || err?.message === 'cancelled') {
          return { items: [] };
        }
        options.onStatusChange?.('idle');
        return { items: [] };
      } finally {
        if (activeAbortController === abortController) {
          activeAbortController = null;
        }
      }
    },
    freeInlineCompletions: () => {
      // Nettoyage éventuel
    }
  };

  // Enregistrer le provider pour tous les langages ('*')
  // Note: Monaco supporte '*' pour couvrir tous les fichiers
  if (isRegistered) {
    return { dispose: () => {} };
  }
  const disposable = monaco.languages.registerInlineCompletionsProvider('*', provider);
  isRegistered = true;

  return disposable;
}

export function isCopilotRegistered(): boolean {
  return isRegistered;
}

