import type { DiagnosticItem } from '../types';

/**
 * Maps Antigravity diagnostic severity to Monaco MarkerSeverity enum value.
 */
export function mapDiagnosticSeverityToMonaco(
  monaco: any,
  severity: 'error' | 'warning' | 'info'
): number {
  if (!monaco?.MarkerSeverity) return 1;
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
    default:
      return monaco.MarkerSeverity.Info;
  }
}

/**
 * Applies diagnostic markers directly to the given Monaco editor text model.
 * Renders gutter markers, squiggly underlines, and minimap decorations.
 */
export function applyMonacoDiagnostics(
  monaco: any,
  model: any,
  diagnostics: DiagnosticItem[],
  owner = 'antigravity-lint'
): void {
  if (!monaco?.editor?.setModelMarkers || !model || model.isDisposed?.()) return;

  const markers = diagnostics.map((d) => {
    const startLineNumber = Math.max(1, d.line || 1);
    const startColumn = Math.max(1, d.column || 1);
    const endLineNumber = Math.max(startLineNumber, d.endLine || startLineNumber);
    const endColumn = Math.max(startColumn + 1, d.endColumn || (startColumn + 1));

    const prefix = d.code ? `[${d.source}:${d.code}]` : `[${d.source}]`;

    return {
      severity: mapDiagnosticSeverityToMonaco(monaco, d.severity),
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
      message: `${prefix} ${d.message}`,
      source: `Antigravity (${d.source})`,
      code: d.code || undefined,
    };
  });

  monaco.editor.setModelMarkers(model, owner, markers);
}

/**
 * Clears all diagnostic markers owned by Antigravity for the given model.
 */
export function clearMonacoDiagnostics(
  monaco: any,
  model: any,
  owner = 'antigravity-lint'
): void {
  if (!monaco?.editor?.setModelMarkers || !model || model.isDisposed?.()) return;
  monaco.editor.setModelMarkers(model, owner, []);
}
