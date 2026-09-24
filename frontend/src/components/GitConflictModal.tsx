import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  GitMerge,
  Save,
  Loader2,
  AlertTriangle,
  Columns,
  Code2,
  CheckCircle2,
  ArrowDownLeft,
  ArrowUpRight
} from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { fetchConflictFileInfo, resolveGitConflict } from '../services/api';
import type { ConflictFileInfo } from '../types';
import { showToast } from '../services/toast';
import { detectLanguage, getInitialMonacoTheme } from '../utils/editorUtils';
import { FileIcon } from './FileIcon';

interface GitConflictModalProps {
  isOpen: boolean;
  onClose: () => void;
  filePath: string;
  workspace: string;
  onResolved: (filePath: string) => void;
}

export const GitConflictModal: React.FC<GitConflictModalProps> = ({
  isOpen,
  onClose,
  filePath,
  workspace,
  onResolved
}) => {
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [conflictInfo, setConflictInfo] = useState<ConflictFileInfo | null>(null);
  const [activeView, setActiveView] = useState<'editor' | 'diff'>('editor');
  const [editedContent, setEditedContent] = useState('');
  const [monacoTheme, setMonacoTheme] = useState(() => getInitialMonacoTheme());

  const language = useMemo(() => {
    return detectLanguage(filePath);
  }, [filePath]);

  // Sync theme
  useEffect(() => {
    const observer = new MutationObserver(() => {
      const isDark = document.documentElement.classList.contains('dark');
      setMonacoTheme(isDark ? 'vs-dark' : 'light');
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Fetch conflict details
  useEffect(() => {
    if (!isOpen || !filePath) return;
    let cancelled = false;

    fetchConflictFileInfo(filePath, workspace)
      .then((info) => {
        if (!cancelled) {
          setConflictInfo(info);
          setEditedContent(info.current_content || info.ours_content || '');
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          showToast(err.message || 'Impossible de charger les informations de conflit', 'error');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, filePath, workspace]);

  // Handle resolving with specific strategy
  const handleResolve = useCallback(async (resolution: 'ours' | 'theirs' | 'custom') => {
    setResolving(true);
    try {
      await resolveGitConflict({
        workspace,
        path: filePath,
        resolution,
        custom_content: resolution === 'custom' ? editedContent : undefined
      });
      showToast(`Conflit résolu pour ${filePath}`, 'success');
      onResolved(filePath);
      onClose();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la résolution du conflit', 'error');
    } finally {
      setResolving(false);
    }
  }, [workspace, filePath, editedContent, onResolved, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-6xl h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)'
        }}
      >
        {/* Header */}
        <div className="px-5 py-3.5 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center shrink-0 border border-amber-500/20">
              <GitMerge className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <FileIcon filename={filePath} className="w-4 h-4 shrink-0" />
                <h3 className="text-sm font-semibold truncate text-slate-100 font-mono">
                  {filePath}
                </h3>
                <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Conflit Git
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Studio de résolution de conflit : choisissez une branche ou éditez le code final.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* View Mode Toggle */}
            <div className="flex items-center gap-1 p-0.5 rounded-lg border bg-black/20" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setActiveView('editor')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  activeView === 'editor' ? 'bg-sky-500 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Éditeur de code manuel"
              >
                <Code2 className="w-3.5 h-3.5" />
                <span>Éditeur Final</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveView('diff')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer ${
                  activeView === 'diff' ? 'bg-sky-500 text-white shadow-xs' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Comparaison côte-à-côte (Ours vs Leur)"
              >
                <Columns className="w-3.5 h-3.5" />
                <span>Diff (Ours / Leur)</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg border hover:bg-white/5 text-slate-400 hover:text-slate-200 cursor-pointer ml-2"
              style={{ borderColor: 'var(--border)' }}
              title="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Decision Banner */}
        <div className="px-5 py-2.5 bg-black/25 border-b flex flex-wrap items-center justify-between gap-3 shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span className="font-semibold text-slate-200">Actions rapides :</span>
            <span>Résolvez directement en adoptant une version</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={resolving || loading}
              onClick={() => handleResolve('ours')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600/20 text-sky-300 border border-sky-500/40 hover:bg-sky-600/30 transition-colors disabled:opacity-50 cursor-pointer"
              title="Conserver notre version (HEAD / locale)"
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              <span>Garder la nôtre (HEAD / Ours)</span>
            </button>

            <button
              type="button"
              disabled={resolving || loading}
              onClick={() => handleResolve('theirs')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-purple-600/20 text-purple-300 border border-purple-500/40 hover:bg-purple-600/30 transition-colors disabled:opacity-50 cursor-pointer"
              title="Conserver leur version (branche fusionnée / entrante)"
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>Garder la leur (Theirs / Entrante)</span>
            </button>

            <button
              type="button"
              disabled={resolving || loading || !editedContent}
              onClick={() => handleResolve('custom')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-600/20 transition-colors disabled:opacity-50 cursor-pointer"
              title="Valider l'édition manuelle courante et marquer comme résolu"
            >
              {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>Valider l'édition actuelle</span>
            </button>
          </div>
        </div>

        {/* Editor Body */}
        <div className="flex-1 min-h-0 relative">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Loader2 className="w-7 h-7 text-sky-400 animate-spin" />
              <p className="text-xs text-slate-400">Chargement des informations du conflit...</p>
            </div>
          ) : activeView === 'diff' ? (
            <div className="h-full w-full">
              <DiffEditor
                original={conflictInfo?.ours_content || ''}
                modified={conflictInfo?.theirs_content || ''}
                language={language}
                theme={monacoTheme}
                options={{
                  readOnly: true,
                  renderSideBySide: true,
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on'
                }}
              />
            </div>
          ) : (
            <div className="h-full w-full">
              <Editor
                value={editedContent}
                language={language}
                theme={monacoTheme}
                onChange={(val) => setEditedContent(val || '')}
                options={{
                  minimap: { enabled: false },
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  lineNumbers: 'on'
                }}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t flex items-center justify-between text-xs text-slate-400 shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <span>Langage détecté : <strong className="text-slate-200">{language}</strong></span>
            {conflictInfo?.base_content && (
              <span className="text-emerald-400">• Version ancêtre (base) détectée</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded-lg border text-slate-300 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              Fermer
            </button>
            <button
              type="button"
              disabled={resolving || loading || !editedContent}
              onClick={() => handleResolve('custom')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              {resolving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              <span>Marquer comme résolu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
