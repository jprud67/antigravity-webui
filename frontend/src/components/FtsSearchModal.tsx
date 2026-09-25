import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Search, 
  X, 
  MessageSquare, 
  RefreshCw, 
  Sparkles, 
  ChevronRight, 
  Filter
} from 'lucide-react';
import { searchFts, reindexFts, getFtsStats } from '../services/api';
import type { FtsSearchResultItem, FtsSearchResponse } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface FtsSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectConversation: (sessionId: string) => void;
}

export const FtsSearchModal: React.FC<FtsSearchModalProps> = ({
  isOpen,
  onClose,
  onSelectConversation
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<FtsSearchResponse | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [stats, setStats] = useState<{ total_indexed_rows: number; indexed_sessions: number; engine: string } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<any>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 50);
      getFtsStats().then(setStats).catch(() => {});
    }
  }, [isOpen]);

  const executeSearch = useCallback(async (q: string, role?: string) => {
    if (!q.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const res = await searchFts(q.trim(), role || undefined, undefined, undefined, 50);
      setResults(res);
    } catch (e: any) {
      showToast(e.message || 'Erreur lors de la recherche', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      executeSearch(val, roleFilter);
    }, 200);
  };

  const handleRoleChange = (role: string) => {
    const next = role === roleFilter ? '' : role;
    setRoleFilter(next);
    executeSearch(query, next);
  };

  const handleReindex = async () => {
    try {
      setReindexing(true);
      const res = await reindexFts();
      showToast(`Index FTS reconstruit : ${res.total_messages_indexed} messages indexés (${res.took_ms} ms)`, 'success');
      const newStats = await getFtsStats();
      setStats(newStats);
      if (query) executeSearch(query, roleFilter);
    } catch (e: any) {
      showToast(e.message || 'Erreur réindexation FTS', 'error');
    } finally {
      setReindexing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Search Bar */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-cyan-600 dark:text-cyan-400 font-bold text-sm">
              <Search className="w-4 h-4" />
              <span>{t('fts_search_title', 'Recherche Plein-Texte Cross-Sessions (SQLite FTS5)')}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleReindex}
                disabled={reindexing}
                className="px-2.5 py-1 text-[11px] font-medium text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                title="Reconstruire l'index FTS5 depuis les conversations"
              >
                <RefreshCw className={`w-3 h-3 ${reindexing ? 'animate-spin' : ''}`} />
                <span>{reindexing ? t('fts_reindexing', 'Indexation...') : t('fts_reindex_btn', 'Réindexer')}</span>
              </button>

              <button
                onClick={onClose}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Search Input Box */}
          <div className="relative flex items-center">
            <Search className="absolute left-3.5 w-4 h-4 text-slate-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={t('fts_search_placeholder', "Rechercher du code, des messages, des appels d'outils (ex: FastAPI, git rebase, sqlite)...")}
              className="w-full pl-10 pr-10 py-2.5 bg-slate-50 dark:bg-slate-800/80 border border-slate-300 dark:border-slate-700 rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-cyan-500 transition-all font-mono"
            />
            {query && (
              <button
                onClick={() => handleQueryChange('')}
                className="absolute right-3 p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Role Filter Chips & Stats */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 text-[11px] font-medium mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" /> {t('filter', 'Filtrer :')}
              </span>
              {[
                { id: '', label: t('fts_filter_all', 'Tous les rôles') },
                { id: 'user', label: t('fts_filter_user', 'Utilisateur') },
                { id: 'assistant', label: t('fts_filter_assistant', 'Assistant') },
                { id: 'system', label: t('fts_filter_system', 'Système & Outils') },
              ].map((rf) => (
                <button
                  key={rf.id}
                  onClick={() => handleRoleChange(rf.id)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                    roleFilter === rf.id
                      ? 'bg-cyan-500 text-white font-semibold shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {rf.label}
                </button>
              ))}
            </div>

            {results && (
              <div className="text-[11px] text-slate-400 font-mono">
                {t('fts_results_count', '{0} résultat(s) en {1} ms', results.total_matches, results.took_ms)}
              </div>
            )}
          </div>
        </div>

        {/* Results Area */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-cyan-500" />
              <p className="text-xs">Recherche dans l'index FTS5...</p>
            </div>
          ) : results && results.matches.length > 0 ? (
            <div className="space-y-2.5">
              {results.matches.map((item: FtsSearchResultItem, idx) => (
                <div
                  key={`${item.session_id}_${item.message_id}_${idx}`}
                  onClick={() => {
                    onSelectConversation(item.session_id);
                    onClose();
                  }}
                  className="group p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all cursor-pointer space-y-2"
                >
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-cyan-500 shrink-0" />
                        {item.session_title || item.session_id}
                      </span>
                      {item.project && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          {item.project}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono shrink-0">
                      <span className={`px-1.5 py-0.2 rounded text-[10px] uppercase font-bold ${
                        item.role === 'user' 
                          ? 'bg-blue-500/10 text-blue-500' 
                          : item.role === 'assistant' 
                            ? 'bg-emerald-500/10 text-emerald-500' 
                            : 'bg-purple-500/10 text-purple-500'
                      }`}>
                        {item.role}
                      </span>
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-cyan-500 group-hover:translate-x-0.5 transition-all" />
                    </div>
                  </div>

                  {/* Highlighted Snippet */}
                  <div 
                    className="text-xs text-slate-600 dark:text-slate-300 font-mono leading-relaxed bg-white dark:bg-slate-900 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800/80 [&_mark]:bg-cyan-500/30 [&_mark]:text-cyan-800 dark:[&_mark]:text-cyan-200 [&_mark]:px-1 [&_mark]:rounded"
                    dangerouslySetInnerHTML={{ __html: item.snippet }}
                  />
                </div>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="py-16 text-center text-slate-400 space-y-2">
              <Sparkles className="w-8 h-8 text-slate-500 mx-auto" />
              <p className="text-xs font-medium">{t('fts_no_results', 'Aucun message ne correspond à votre recherche.')}</p>
              <p className="text-[11px] text-slate-500">{t('fts_no_results_hint', 'Essayez un mot-clé différent ou lancez une réindexation.')}</p>
            </div>
          ) : (
            <div className="py-16 text-center text-slate-400 space-y-3">
              <Search className="w-8 h-8 text-cyan-500/40 mx-auto" />
              <p className="text-xs font-medium">{t('fts_empty_prompt', 'Recherche plein-texte ultra-rapide à travers toutes vos conversations.')}</p>
              {stats && (
                <p className="text-[11px] text-slate-500 font-mono">
                  Base FTS : {stats.total_indexed_rows.toLocaleString()} messages indexés dans {stats.indexed_sessions} sessions.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
