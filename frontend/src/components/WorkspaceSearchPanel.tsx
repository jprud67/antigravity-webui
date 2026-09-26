import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { 
  Search, 
  X, 
  ChevronRight, 
  ChevronDown, 
  RefreshCw, 
  Loader2, 
  SlidersHorizontal, 
  ChevronsUpDown, 
  Check, 
  AlertCircle,
  FileCode2,
  FileDiff,
  Replace,
  ExternalLink
} from 'lucide-react';
import { 
  searchWorkspaceFiles, 
  replaceWorkspaceFiles, 
  replaceSingleOccurrence 
} from '../services/api';
import type { 
  WorkspaceFileSearchResult, 
  WorkspaceSearchResponse, 
  WorkspaceSearchMatchItem 
} from '../types';
import { FileIcon } from './FileIcon';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';

interface WorkspaceSearchPanelProps {
  currentWorkspace: string;
  initialQuery?: string;
  initialMode?: 'find' | 'replace';
  onSelectMatch: (filePath: string, lineNumber: number, column: number, matchLength: number) => void;
  onPreviewDiff?: (filePath: string, originalContent: string, modifiedContent: string) => void;
  onFileModified?: (filePath: string) => void;
}

export const WorkspaceSearchPanel: React.FC<WorkspaceSearchPanelProps> = ({
  currentWorkspace,
  initialQuery = '',
  initialMode = 'find',
  onSelectMatch,
  onPreviewDiff,
  onFileModified
}) => {
  const { t } = useI18n();
  const [query, setQuery] = useState(initialQuery);
  const [replaceText, setReplaceText] = useState('');
  const [isReplaceOpen, setIsReplaceOpen] = useState(initialMode === 'replace');
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);

  // Search options
  const [isCaseSensitive, setIsCaseSensitive] = useState(false);
  const [isWholeWord, setIsWholeWord] = useState(false);
  const [isRegex, setIsRegex] = useState(false);
  const [includePattern, setIncludePattern] = useState('');
  const [excludePattern, setExcludePattern] = useState('');

  // Search execution state
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [resultsData, setResultsData] = useState<WorkspaceSearchResponse | null>(null);

  // Collapsed files map (relative_path -> boolean)
  const [collapsedFiles, setCollapsedFiles] = useState<Record<string, boolean>>({});

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Handle Search
  const handleExecuteSearch = useCallback(async (searchQuery?: string) => {
    const q = searchQuery !== undefined ? searchQuery : query;
    if (!q.trim()) {
      setResultsData(null);
      return;
    }

    setIsSearching(true);
    setErrorMsg(null);

    try {
      const data = await searchWorkspaceFiles({
        query: q,
        workspace: currentWorkspace,
        case_sensitive: isCaseSensitive,
        whole_word: isWholeWord,
        is_regex: isRegex,
        include_pattern: includePattern.trim() || undefined,
        exclude_pattern: excludePattern.trim() || undefined,
        max_results: 500
      });
      setResultsData(data);
      // Initialize all files as expanded
      setCollapsedFiles({});
    } catch (err: any) {
      setErrorMsg(err.message || 'Erreur lors de la recherche');
    } finally {
      setIsSearching(false);
    }
  }, [query, currentWorkspace, isCaseSensitive, isWholeWord, isRegex, includePattern, excludePattern]);

  const prevInitialQueryRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevInitialQueryRef.current === null) {
      prevInitialQueryRef.current = initialQuery;
      if (initialQuery.trim()) {
        const timer = setTimeout(() => {
          handleExecuteSearch(initialQuery);
        }, 0);
        return () => clearTimeout(timer);
      }
    } else if (initialQuery !== prevInitialQueryRef.current) {
      prevInitialQueryRef.current = initialQuery;
      setQuery(initialQuery);
      if (initialQuery.trim()) {
        const timer = setTimeout(() => {
          handleExecuteSearch(initialQuery);
        }, 0);
        return () => clearTimeout(timer);
      }
    }
  }, [initialQuery, handleExecuteSearch]);

  const prevInitialModeRef = useRef(initialMode);
  useEffect(() => {
    if (initialMode !== prevInitialModeRef.current) {
      prevInitialModeRef.current = initialMode;
      setIsReplaceOpen(initialMode === 'replace');
    }
  }, [initialMode]);

  // Toggle Collapse for a single file
  const toggleFileCollapse = useCallback((relPath: string) => {
    setCollapsedFiles(prev => ({
      ...prev,
      [relPath]: !prev[relPath]
    }));
  }, []);

  // Collapse / Expand All
  const handleToggleExpandAll = useCallback(() => {
    if (!resultsData || resultsData.files.length === 0) return;
    const hasAnyCollapsed = Object.values(collapsedFiles).some(Boolean);
    if (hasAnyCollapsed) {
      setCollapsedFiles({});
    } else {
      const all: Record<string, boolean> = {};
      for (const f of resultsData.files) {
        all[f.relative_path] = true;
      }
      setCollapsedFiles(all);
    }
  }, [resultsData, collapsedFiles]);

  // Replace Single Occurrence
  const handleReplaceSingle = useCallback(async (
    e: React.MouseEvent,
    fileResult: WorkspaceFileSearchResult,
    match: WorkspaceSearchMatchItem
  ) => {
    e.stopPropagation();
    setIsReplacing(true);
    try {
      await replaceSingleOccurrence({
        file_path: fileResult.file_path,
        workspace: currentWorkspace,
        line_number: match.line_number,
        column: match.column,
        match_length: match.match_length,
        replace_text: replaceText,
        expected_match: match.match_text
      });
      showToast(t('match_replaced_success', 'Occurrence remplacée avec succès'), 'success');
      onFileModified?.(fileResult.file_path);
      // Re-run search to update match positions
      await handleExecuteSearch();
    } catch (err: any) {
      showToast(err.message || "Erreur lors du remplacement", 'error');
    } finally {
      setIsReplacing(false);
    }
  }, [currentWorkspace, replaceText, handleExecuteSearch, onFileModified]);

  // Preview Diff Before Replace
  const handlePreviewFileDiff = useCallback(async (e: React.MouseEvent, fileResult: WorkspaceFileSearchResult) => {
    e.stopPropagation();
    if (!onPreviewDiff) return;
    setIsReplacing(true);
    try {
      const preview = await replaceWorkspaceFiles({
        query,
        replace_text: replaceText,
        workspace: currentWorkspace,
        case_sensitive: isCaseSensitive,
        whole_word: isWholeWord,
        is_regex: isRegex,
        file_paths: [fileResult.file_path],
        dry_run: true
      });
      if (preview.previews.length > 0) {
        const item = preview.previews[0];
        onPreviewDiff(item.file_path, item.original_content, item.modified_content);
      } else {
        showToast(t('no_changes_to_preview', 'Aucune modification à prévisualiser'), 'info');
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la prévisualisation', 'error');
    } finally {
      setIsReplacing(false);
    }
  }, [query, replaceText, currentWorkspace, isCaseSensitive, isWholeWord, isRegex, onPreviewDiff]);

  // Replace All in File
  const handleReplaceAllInFile = useCallback(async (e: React.MouseEvent, fileResult: WorkspaceFileSearchResult) => {
    e.stopPropagation();
    const confirmed = await showConfirm(
      `Remplacer toutes les occurrences (${fileResult.matches.length}) dans ${fileResult.relative_path} par "${replaceText}" ?`,
      { title: t('replace_in_this_file', 'Remplacer dans ce fichier'), confirmLabel: t('replace', 'Remplacer') }
    );
    if (!confirmed) return;

    setIsReplacing(true);
    try {
      const res = await replaceWorkspaceFiles({
        query,
        replace_text: replaceText,
        workspace: currentWorkspace,
        case_sensitive: isCaseSensitive,
        whole_word: isWholeWord,
        is_regex: isRegex,
        file_paths: [fileResult.file_path],
        dry_run: false
      });
      showToast(t('replacements_count_success', '{0} remplacement(s) effectué(s)', res.total_replacements), 'success');
      onFileModified?.(fileResult.file_path);
      await handleExecuteSearch();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du remplacement', 'error');
    } finally {
      setIsReplacing(false);
    }
  }, [query, replaceText, currentWorkspace, isCaseSensitive, isWholeWord, isRegex, handleExecuteSearch, onFileModified, t]);

  // Replace All Across Workspace
  const handleReplaceAll = useCallback(async () => {
    if (!resultsData || resultsData.total_matches === 0) return;

    const confirmed = await showConfirm(
      t('confirm_replace_all_workspace', 'Confirmez-vous le remplacement de {0} occurrence(s) réparties sur {1} fichier(s) par "{2}" ?', resultsData.total_matches, resultsData.total_files, replaceText),
      { title: t('replace_all_in_workspace', 'Remplacer tout dans le workspace'), confirmLabel: t('replace_all', 'Tout remplacer'), destructive: true }
    );
    if (!confirmed) return;

    setIsReplacing(true);
    try {
      const res = await replaceWorkspaceFiles({
        query,
        replace_text: replaceText,
        workspace: currentWorkspace,
        case_sensitive: isCaseSensitive,
        whole_word: isWholeWord,
        is_regex: isRegex,
        include_pattern: includePattern.trim() || undefined,
        exclude_pattern: excludePattern.trim() || undefined,
        dry_run: false
      });
      showToast(t('replacements_in_files_success', '{0} remplacement(s) effectué(s) dans {1} fichier(s)', res.total_replacements, res.files_modified), 'success');
      if (res.previews) {
        for (const p of res.previews) {
          onFileModified?.(p.file_path);
        }
      }
      await handleExecuteSearch();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du remplacement global', 'error');
    } finally {
      setIsReplacing(false);
    }
  }, [resultsData, query, replaceText, currentWorkspace, isCaseSensitive, isWholeWord, isRegex, includePattern, excludePattern, handleExecuteSearch, onFileModified]);

  // Format line snippet with highlighted match
  const renderHighlightedSnippet = useMemo(() => {
    return (lineText: string, column: number, length: number) => {
      const colIdx = Math.max(0, column - 1);
      const before = lineText.slice(0, colIdx);
      const match = lineText.slice(colIdx, colIdx + length);
      const after = lineText.slice(colIdx + length);

      return (
        <span className="font-mono text-[11px] leading-tight text-slate-300 break-all select-none">
          <span>{before}</span>
          <span className="bg-amber-500/30 text-amber-200 font-semibold px-0.5 rounded border border-amber-500/40">
            {match}
          </span>
          <span>{after}</span>
        </span>
      );
    };
  }, []);

  return (
    <div className="flex flex-col h-full overflow-hidden select-text text-slate-200" style={{ backgroundColor: 'var(--sidebar)' }}>
      {/* Top Controls Box */}
      <div className="p-2.5 border-b flex flex-col gap-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
        {/* Search Row */}
        <div className="flex items-center gap-1.5">
          <div className="relative flex-1 min-w-0">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleExecuteSearch();
              }}
              placeholder={t('search_files_placeholder', 'Rechercher dans les fichiers...')}
              className="w-full pl-7 pr-7 py-1 text-xs rounded-lg border bg-black/10 dark:bg-white/5 outline-none font-mono text-slate-100 focus:border-sky-500"
              style={{ borderColor: 'var(--border)' }}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setResultsData(null);
                }}
                className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                title={t('search_clear_tooltip', 'Effacer la recherche')}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>

          {/* Search Modifiers */}
          <div className="flex items-center gap-0.5 border rounded-lg p-0.5 shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
            <button
              type="button"
              onClick={() => setIsCaseSensitive(!isCaseSensitive)}
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer ${
                isCaseSensitive ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('search_match_case_tooltip', 'Respecter la casse (Alt+C)')}
            >
              Aa
            </button>
            <button
              type="button"
              onClick={() => setIsWholeWord(!isWholeWord)}
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer ${
                isWholeWord ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('search_whole_word_tooltip', 'Mot entier (Alt+W)')}
            >
              \b
            </button>
            <button
              type="button"
              onClick={() => setIsRegex(!isRegex)}
              className={`px-1.5 py-0.5 text-[10px] font-mono font-bold rounded transition-colors cursor-pointer ${
                isRegex ? 'bg-sky-500 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
              title={t('search_regex_tooltip', 'Expression régulière (Alt+R)')}
            >
              .*
            </button>
          </div>

          <button
            type="button"
            onClick={() => handleExecuteSearch()}
            disabled={isSearching || !query.trim()}
            className="p-1.5 rounded-lg border bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50 cursor-pointer shrink-0"
            title={t('search_run_tooltip', 'Lancer la recherche (Entrée)')}
          >
            {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Replace Row Header Toggle */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => setIsReplaceOpen(!isReplaceOpen)}
            className="flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 cursor-pointer"
          >
            {isReplaceOpen ? <ChevronDown className="w-3 h-3 text-sky-400" /> : <ChevronRight className="w-3 h-3" />}
            <span>{t('search_replace_tab', 'Remplacement')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFiltersOpen(!isFiltersOpen)}
            className={`flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded cursor-pointer transition-colors ${
              isFiltersOpen || includePattern || excludePattern ? 'text-sky-400 bg-sky-500/10' : 'text-slate-400 hover:text-slate-200'
            }`}
            title={t('search_filters_toggle_tooltip', "Filtres d'inclusion et exclusion de fichiers")}
          >
            <SlidersHorizontal className="w-3 h-3" />
            <span>{t('search_filters_label', 'Filtres')}</span>
          </button>
        </div>

        {/* Replace Input Container */}
        {isReplaceOpen && (
          <div className="flex items-center gap-1.5 animate-fadeIn">
            <div className="relative flex-1 min-w-0">
              <Replace className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
              <input
                type="text"
                value={replaceText}
                onChange={(e) => setReplaceText(e.target.value)}
                placeholder={t('search_replace_with_placeholder', 'Remplacer par...')}
                className="w-full pl-7 pr-2 py-1 text-xs rounded-lg border bg-black/10 dark:bg-white/5 outline-none font-mono text-slate-100 focus:border-amber-500"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>

            <button
              type="button"
              onClick={handleReplaceAll}
              disabled={isReplacing || !resultsData || resultsData.total_matches === 0}
              className="flex items-center gap-1 px-2 py-1 rounded-lg border bg-amber-600/80 hover:bg-amber-600 text-white text-[11px] font-medium disabled:opacity-40 cursor-pointer shrink-0"
              title={t('search_replace_all_workspace', 'Remplacer tout dans le workspace')}
            >
              {isReplacing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>{t('search_replace_all_btn', 'Tout remplacer')}</span>
            </button>
          </div>
        )}

        {/* Filters Drawer */}
        {isFiltersOpen && (
          <div className="p-2 rounded-lg border bg-black/5 dark:bg-white/5 flex flex-col gap-1.5 animate-fadeIn text-[11px]" style={{ borderColor: 'var(--border)' }}>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">{t('search_files_to_include', 'Fichiers à inclure (ex: *.ts, src/**) :')}</span>
              <input
                type="text"
                value={includePattern}
                onChange={(e) => setIncludePattern(e.target.value)}
                placeholder="ex: *.py, src/**/*.tsx"
                className="w-full px-2 py-0.5 rounded border bg-transparent font-mono text-slate-200 outline-none text-xs"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="text-[10px] text-slate-400">{t('search_files_to_exclude', 'Fichiers à exclure (ex: node_modules, dist) :')}</span>
              <input
                type="text"
                value={excludePattern}
                onChange={(e) => setExcludePattern(e.target.value)}
                placeholder="ex: *.test.ts, vendor"
                className="w-full px-2 py-0.5 rounded border bg-transparent font-mono text-slate-200 outline-none text-xs"
                style={{ borderColor: 'var(--border)' }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Results Header / Statistics */}
      {resultsData && (
        <div className="px-3 py-1.5 border-b flex items-center justify-between text-[11px] text-slate-400 shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}>
          <div className="flex items-center gap-1.5 truncate">
            <span className="font-semibold text-slate-200">
              {resultsData.total_matches} occurrence{resultsData.total_matches > 1 ? 's' : ''}
            </span>
            <span>{t('in', 'dans')}</span>
            <span className="font-semibold text-slate-200">
              {resultsData.total_files} fichier{resultsData.total_files > 1 ? 's' : ''}
            </span>
            <span className="text-[10px] opacity-70">({resultsData.duration_ms} ms)</span>
            {resultsData.truncated && (
              <span className="text-amber-400 text-[10px] font-medium">• {t('limited', 'Limité')}</span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleToggleExpandAll}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 cursor-pointer"
              title={t('search_toggle_all_expand', 'Tout déplier / replier')}
            >
              <ChevronsUpDown className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => handleExecuteSearch()}
              className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-slate-200 cursor-pointer"
              title={t('search_refresh_tooltip', 'Actualiser la recherche')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      )}

      {/* Error alert */}
      {errorMsg && (
        <div className="p-3 m-2 rounded-lg border border-rose-500/40 bg-rose-500/10 flex items-center gap-2 text-rose-300 text-xs shrink-0">
          <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Results Tree List */}
      <div className="flex-1 overflow-y-auto divide-y divide-white/5">
        {isSearching ? (
          <div className="flex flex-col items-center justify-center p-8 gap-2 text-slate-400 text-xs">
            <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
            <span>{t('search_in_progress', 'Recherche dans les fichiers du workspace...')}</span>
          </div>
        ) : !resultsData ? (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-2 text-slate-500 text-xs">
            <FileCode2 className="w-8 h-8 opacity-40 text-slate-400" />
            <span>{t('search_enter_term_hint', 'Saisissez un terme pour lancer une recherche multi-fichiers.')}</span>
            <span className="text-[10px] text-slate-600">{t('search_shortcut_hint', 'Raccourci : Ctrl+Shift+F')}</span>
          </div>
        ) : resultsData.total_matches === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center gap-2 text-slate-400 text-xs">
            <Search className="w-6 h-6 opacity-40 text-slate-400" />
            <span>{t('search_no_results_for', 'Aucun résultat trouvé pour "{0}".', resultsData.query)}</span>
          </div>
        ) : (
          resultsData.files.map((fileResult) => {
            const isCollapsed = Boolean(collapsedFiles[fileResult.relative_path]);
            return (
              <div key={fileResult.relative_path} className="group/file">
                {/* File Header Row */}
                <div
                  onClick={() => toggleFileCollapse(fileResult.relative_path)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 hover:bg-white/5 cursor-pointer select-none transition-colors border-l-2 border-transparent hover:border-sky-500"
                >
                  <button type="button" className="p-0.5 text-slate-400">
                    {isCollapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                  <FileIcon filename={fileResult.relative_path} className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-xs font-medium text-slate-200 truncate flex-1 font-mono">
                    {fileResult.relative_path}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-sky-500/20 text-sky-300 font-semibold shrink-0">
                    {fileResult.matches.length}
                  </span>

                  {/* Actions on file */}
                  {isReplaceOpen && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover/file:opacity-100 transition-opacity">
                      {onPreviewDiff && (
                        <button
                          type="button"
                          onClick={(e) => handlePreviewFileDiff(e, fileResult)}
                          className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-sky-300 cursor-pointer"
                          title={t('search_preview_diff_file', 'Prévisualiser le diff pour ce fichier')}
                        >
                          <FileDiff className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={(e) => handleReplaceAllInFile(e, fileResult)}
                        className="p-1 rounded hover:bg-white/10 text-slate-400 hover:text-amber-300 cursor-pointer"
                        title={t('search_replace_all_file', 'Remplacer tout dans ce fichier')}
                      >
                        <Replace className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Match Items */}
                {!isCollapsed && (
                  <div className="bg-black/10 dark:bg-white/[0.02] divide-y divide-white/[0.03]">
                    {fileResult.matches.map((match, mIdx) => (
                      <div
                        key={`${match.line_number}-${match.column}-${mIdx}`}
                        onClick={() => onSelectMatch(fileResult.file_path, match.line_number, match.column, match.match_length)}
                        className="group/match flex items-start gap-2 pl-7 pr-2.5 py-1 hover:bg-sky-500/10 cursor-pointer transition-colors"
                      >
                        <span className="text-[10px] font-mono text-slate-400 pt-0.5 shrink-0">
                          {match.line_number}:{match.column}
                        </span>
                        <div className="flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                          {renderHighlightedSnippet(match.line_text, match.column, match.match_length)}
                        </div>

                        {/* Hover Actions on Match */}
                        <div className="flex items-center gap-1 opacity-0 group-hover/match:opacity-100 transition-opacity shrink-0">
                          {isReplaceOpen && (
                            <button
                              type="button"
                              onClick={(e) => handleReplaceSingle(e, fileResult, match)}
                              className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-amber-300 cursor-pointer"
                              title={t('search_replace_this_occurrence', 'Remplacer cette occurrence')}
                            >
                              <Replace className="w-2.5 h-2.5" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelectMatch(fileResult.file_path, match.line_number, match.column, match.match_length);
                            }}
                            className="p-0.5 rounded hover:bg-white/10 text-slate-400 hover:text-sky-300 cursor-pointer"
                            title={t('search_open_in_editor', "Ouvrir dans l'éditeur")}
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
