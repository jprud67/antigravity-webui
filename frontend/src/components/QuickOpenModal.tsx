import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, Loader2, CornerDownLeft, Sparkles, Folder } from 'lucide-react';
import { searchFiles } from '../services/api';
import { FileIcon } from './FileIcon';
import { useI18n } from '../services/i18n';

export interface QuickOpenModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  onSelectFile: (path: string) => void;
}

export const QuickOpenModal: React.FC<QuickOpenModalProps> = React.memo(({
  isOpen,
  onClose,
  currentWorkspace,
  onSelectFile,
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Focus input upon opening
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    if (!isOpen || !query.trim()) {
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await searchFiles(query.trim(), currentWorkspace, 40);
        setResults(res.results || []);
        setSelectedIndex(0);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, isOpen, currentWorkspace]);

  const activeResults = useMemo(() => {
    return query.trim() ? results : [];
  }, [query, results]);

  // Ensure selected item is scrolled into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.children[selectedIndex] as HTMLElement;
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback((item: any) => {
    if (!item) return;
    onSelectFile(item.path);
    onClose();
  }, [onSelectFile, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }

    if (activeResults.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % activeResults.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + activeResults.length) % activeResults.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = activeResults[selectedIndex];
      if (current) {
        handleSelect(current);
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-xs animate-fadeIn select-none">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={onClose} />

      <div
        className="relative w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col z-10 transition-all duration-150"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Search Header Bar */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <Search className="w-5 h-5 text-sky-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('quick_open_placeholder', 'Rechercher un fichier par nom ou contenu... (ex: .ts, modal, config)')}
            className="flex-1 bg-transparent text-sm outline-none font-mono placeholder:text-slate-500"
            autoComplete="off"
            spellCheck="false"
          />
          {loading && <Loader2 className="w-4 h-4 animate-spin text-sky-400 shrink-0" />}
          {query && !loading && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                setResults([]);
                inputRef.current?.focus();
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-black/10 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono text-slate-400 bg-black/10 dark:bg-white/10 shrink-0">
            Échap
          </kbd>
        </div>

        {/* Results List */}
        <div
          ref={listRef}
          className="max-h-[380px] overflow-y-auto p-2 space-y-1 divide-y divide-transparent select-none"
        >
          {query.trim() === '' ? (
            <div className="py-10 text-center flex flex-col items-center justify-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
              <Sparkles className="w-6 h-6 text-sky-400/60 mb-1" />
              <p className="font-medium text-sm" style={{ color: 'var(--strong)' }}>
                Accès Rapide aux Fichiers (Quick Open)
              </p>
              <p className="max-w-xs text-slate-400">
                Tapez les premières lettres du nom d'un fichier ou d'une fonction pour naviguer instantanément.
              </p>
            </div>
          ) : activeResults.length === 0 && !loading ? (
            <div className="py-10 text-center text-xs" style={{ color: 'var(--muted)' }}>
              Aucun fichier correspondant à « <span className="text-sky-400 font-mono">{query}</span> »
            </div>
          ) : (
            activeResults.map((item, idx) => {
              const isSelected = idx === selectedIndex;
              const normalizedPath = item.path.replace(/\\/g, '/');
              const parts = normalizedPath.split('/');
              const filename = parts.pop() || item.name;
              const parentDir = parts.slice(-3).join('/');

              return (
                <div
                  key={`${item.path}_${idx}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2 rounded-xl text-xs cursor-pointer transition-colors group ${
                    isSelected
                      ? 'bg-sky-500/15 text-sky-300 font-medium border border-sky-500/30'
                      : 'hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-2">
                    <FileIcon
                      filename={filename}
                      isDir={item.is_dir}
                      className="w-4 h-4"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold truncate text-[13px]" style={{ color: isSelected ? 'var(--strong)' : undefined }}>
                          {filename}
                        </span>
                        {item.match_type === 'content' && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            Lg {item.line_number}
                          </span>
                        )}
                        {item.is_dir && (
                          <span className="px-1.5 py-0.2 rounded text-[9px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20 flex items-center gap-1">
                            <Folder className="w-2.5 h-2.5" /> Dossier
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-slate-400 truncate opacity-70">
                        {parentDir ? `${parentDir}/` : ''}
                      </div>
                      {item.snippet && (
                        <div className="mt-0.5 text-[11px] font-mono text-slate-300/80 bg-black/20 px-2 py-0.5 rounded truncate border border-white/5">
                          {item.snippet}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <CornerDownLeft className="w-3.5 h-3.5 text-sky-400" />
                    <span className="text-[10px] text-sky-400 font-mono">{t('open', 'Ouvrir')}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Shortcut Hints */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t text-[10px] font-mono"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)',
          }}
        >
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.2 rounded border bg-black/10 dark:bg-white/10">↑</kbd>
              <kbd className="px-1 py-0.2 rounded border bg-black/10 dark:bg-white/10">↓</kbd>
              <span>{t('navigate', 'Naviguer')}</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1.5 py-0.2 rounded border bg-black/10 dark:bg-white/10">{t('key_enter', 'Entrée')}</kbd>
              <span>{t('open', 'Ouvrir')}</span>
            </span>
          </div>
          <div className="text-slate-400">
            {activeResults.length > 0 && `${activeResults.length} résultat${activeResults.length > 1 ? 's' : ''}`}
          </div>
        </div>
      </div>
    </div>
  );
});

QuickOpenModal.displayName = 'QuickOpenModal';
