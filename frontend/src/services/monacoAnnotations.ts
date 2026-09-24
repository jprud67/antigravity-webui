import type { GitDiffRange } from '../types';

/**
 * Options par défaut pour activer l'expérience multi-curseurs native dans Monaco Editor.
 */
export function getMonacoMultiCursorOptions() {
  return {
    multiCursorModifier: 'alt' as const,
    multiCursorMergeOverlapping: true,
    multiCursorPaste: 'spread' as const,
  };
}

export interface MultiCursorController {
  dispose: () => void;
  resetToSingleCursor: () => void;
}

/**
 * Configure les écouteurs de curseur et les raccourcis clavier multi-curseurs sur une instance Monaco.
 *
 * @param editor Instance de l'éditeur Monaco (IStandaloneCodeEditor)
 * @param monaco Instance du namespace monaco
 * @param onCursorCountChange Callback notifié du nombre de curseurs actifs
 */
export function setupMultiCursor(
  editor: any,
  monaco: any,
  onCursorCountChange: (count: number) => void
): MultiCursorController {
  if (!editor || !monaco) {
    return {
      dispose: () => {},
      resetToSingleCursor: () => {},
    };
  }

  // Écouter les sélections multiples
  const selectionListener = editor.onDidChangeCursorSelection(() => {
    const selections = editor.getSelections();
    const count = Array.isArray(selections) && selections.length > 0 ? selections.length : 1;
    onCursorCountChange(count);
  });

  // Raccourcis complémentaires compatibles VS Code
  // Ctrl + D : ajouter l'occurrence suivante à la sélection
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyD, () => {
    editor.getAction('editor.action.addSelectionToNextFindMatch')?.run();
  });

  // Ctrl + U : annuler la dernière sélection de curseur
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyU, () => {
    editor.getAction('cursorUndo')?.run();
  });

  // Ctrl + Shift + L : sélectionner toutes les occurrences
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyL, () => {
    editor.getAction('editor.action.selectHighlights')?.run();
  });

  // Ctrl + Alt + Haut : insérer un curseur au-dessus
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.UpArrow, () => {
    editor.getAction('editor.action.insertCursorAbove')?.run();
  });

  // Ctrl + Alt + Bas : insérer un curseur en dessous
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.DownArrow, () => {
    editor.getAction('editor.action.insertCursorBelow')?.run();
  });

  const resetToSingleCursor = () => {
    try {
      const pos = editor.getPosition();
      if (pos && monaco?.Selection) {
        editor.setSelection(new monaco.Selection(pos.lineNumber, pos.column, pos.lineNumber, pos.column));
      }
    } catch {
      // Ignorer silencieusement si l'éditeur a été démonté
    }
  };

  return {
    dispose: () => {
      selectionListener?.dispose();
    },
    resetToSingleCursor,
  };
}

/**
 * Applique les décorations visuelles Git dans la gouttière (Gutter), la minimap et l'overview ruler.
 *
 * @param editor Instance de l'éditeur Monaco
 * @param monaco Instance du namespace monaco
 * @param ranges Liste des plages de modifications Git
 * @param oldDecorations Identifiants des décorations précédentes pour deltaDecorations
 * @returns Nouveaux identifiants de décorations
 */
export function applyGitDecorations(
  editor: any,
  monaco: any,
  ranges: GitDiffRange[],
  oldDecorations: string[] = []
): string[] {
  if (!editor || !monaco || !monaco.Range) {
    return oldDecorations;
  }

  const model = editor.getModel();
  if (!model) return oldDecorations;

  const lineCount = model.getLineCount() || 1;

  const newDecorations = ranges.map((r) => {
    const isDeleted = r.type === 'deleted';
    const isAdded = r.type === 'added';

    const startLine = Math.min(Math.max(1, r.start_line), lineCount);
    const endLine = Math.min(Math.max(startLine, r.end_line), lineCount);

    const className = isDeleted
      ? 'monaco-git-gutter-deleted'
      : isAdded
      ? 'monaco-git-gutter-added'
      : 'monaco-git-gutter-modified';

    const minimapColor = isDeleted
      ? undefined
      : isAdded
      ? '#10b981aa'
      : '#0ea5e9aa';

    const overviewRulerColor = isDeleted
      ? '#f43f5edd'
      : isAdded
      ? '#10b981dd'
      : '#0ea5e9dd';

    return {
      range: new monaco.Range(startLine, 1, endLine, 1),
      options: {
        isWholeLine: true,
        linesDecorationsClassName: className,
        ...(minimapColor
          ? {
              minimap: {
                color: minimapColor,
                position: 2, // Gutter
              },
            }
          : {}),
        overviewRuler: {
          color: overviewRulerColor,
          position: 1, // Left lane
        },
      },
    };
  });

  try {
    return editor.deltaDecorations(oldDecorations, newDecorations);
  } catch (err) {
    console.debug('Failed to update Monaco git decorations:', err);
    return [];
  }
}

/**
 * Navigue vers la prochaine ou précédente modification Git par rapport à la position courante du curseur.
 *
 * @param editor Instance de l'éditeur Monaco
 * @param ranges Liste des plages de modifications Git
 * @param direction 'next' pour suivant, 'prev' pour précédent
 */
export function navigateGitDiff(
  editor: any,
  ranges: GitDiffRange[],
  direction: 'next' | 'prev' = 'next'
): void {
  if (!editor || !ranges || ranges.length === 0) return;

  const currentLine = editor.getPosition()?.lineNumber || 1;
  const sorted = [...ranges].sort((a, b) => a.start_line - b.start_line);

  let target: GitDiffRange | undefined;

  if (direction === 'next') {
    target = sorted.find((r) => r.start_line > currentLine);
    if (!target) {
      target = sorted[0]; // Reboucler au début
    }
  } else {
    for (let i = sorted.length - 1; i >= 0; i--) {
      if (sorted[i].start_line < currentLine) {
        target = sorted[i];
        break;
      }
    }
    if (!target) {
      target = sorted[sorted.length - 1]; // Reboucler à la fin
    }
  }

  if (target) {
    editor.setPosition({ lineNumber: target.start_line, column: 1 });
    editor.revealLineInCenter(target.start_line);
    editor.focus();
  }
}
