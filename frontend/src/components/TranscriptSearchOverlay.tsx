import React, { useEffect, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, X } from 'lucide-react';
import { useI18n } from '../services/i18n';

export interface TranscriptSearchOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (query: string) => void;
  matchCount: number;
  currentMatchIndex: number; // 0-based
  onPrev: () => void;
  onNext: () => void;
}

export const TranscriptSearchOverlay: React.FC<TranscriptSearchOverlayProps> = ({
  isOpen,
  onClose,
  query,
  onQueryChange,
  matchCount,
  currentMatchIndex,
  onPrev,
  onNext,
}) => {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  const hasQuery = query.trim().length > 0;

  return (
    <div
      className="absolute top-3 right-3 sm:right-6 z-30 flex items-center gap-1.5 p-1.5 rounded-2xl border shadow-xl backdrop-blur-md animate-in slide-in-from-top-2 fade-in duration-150 select-none"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 8px 10px -6px rgba(0, 0, 0, 0.2)',
      }}
      role="search"
      aria-label={t('search_in_conversation', 'Rechercher dans la conversation')}
    >
      {/* Search Input Box */}
      <div className="flex items-center gap-2 pl-2 pr-1 py-1 rounded-xl bg-black/10 dark:bg-black/20 border border-white/5">
        <Search className="w-3.5 h-3.5 text-accent shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search_chat_placeholder', 'Rechercher... (Ctrl+F)')}
          className="bg-transparent border-none outline-hidden text-xs font-sans text-strong placeholder:text-muted/60 w-36 sm:w-56"
        />

        {/* Counter Badge */}
        {hasQuery && (
          <span
            className={`text-[10.5px] font-mono px-2 py-0.5 rounded-full font-semibold shrink-0 transition-colors ${
              matchCount > 0
                ? 'bg-accent/15 text-accent'
                : 'bg-rose-500/15 text-rose-400'
            }`}
          >
            {matchCount > 0 ? `${currentMatchIndex + 1} / ${matchCount}` : '0 / 0'}
          </span>
        )}
      </div>

      {/* Navigation arrows */}
      <div className="flex items-center gap-0.5">
        <button
          type="button"
          onClick={onPrev}
          disabled={matchCount === 0}
          title={t('search_prev', 'Précédent (Shift+Enter)')}
          className="p-1.5 rounded-xl border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text)',
          }}
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={onNext}
          disabled={matchCount === 0}
          title={t('search_next', 'Suivant (Enter)')}
          className="p-1.5 rounded-xl border transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed hover:bg-white/5"
          style={{
            borderColor: 'var(--border-subtle)',
            color: 'var(--text)',
          }}
        >
          <ChevronDown className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        title={t('close', 'Fermer (Esc)')}
        className="p-1.5 rounded-xl border transition-all cursor-pointer text-muted hover:text-strong hover:bg-white/5 ml-0.5"
        style={{
          borderColor: 'var(--border-subtle)',
        }}
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};
