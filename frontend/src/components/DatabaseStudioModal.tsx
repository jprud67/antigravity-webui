import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Database,
  Table,
  Play,
  RefreshCw,
  Search,
  Key,
  Clock,
  FileSpreadsheet,
  FileCode,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { useI18n } from '../services/i18n';
import { databaseApi } from '../services/api';
import { showToast } from '../services/toast';
import type {
  DatabaseConnectionInfo,
  DatabaseSchema,
  TableInfo,
  QueryResult
} from '../types';

interface DatabaseStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace?: string;
  initialQuery?: string;
}

const RECENT_QUERIES_KEY = 'antigravity_db_recent_queries';

export const DatabaseStudioModal: React.FC<DatabaseStudioModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  initialQuery
}) => {
  const { t } = useI18n();

  // Databases & Schema State
  const [databases, setDatabases] = useState<DatabaseConnectionInfo[]>([]);
  const [selectedDbPath, setSelectedDbPath] = useState<string>('');
  const [schema, setSchema] = useState<DatabaseSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState<boolean>(false);
  const [tableSearch, setTableSearch] = useState<string>('');
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});

  // Query & Execution State
  const [sqlQuery, setSqlQuery] = useState<string>(initialQuery || 'SELECT 1;');
  const [queryLimit, setQueryLimit] = useState<number>(500);
  const [executing, setExecuting] = useState<boolean>(false);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_QUERIES_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [pageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [exporting, setExporting] = useState<boolean>(false);

  const editorRef = useRef<any>(null);

  // Sync initialQuery prop if it changes
  useEffect(() => {
    if (initialQuery) {
      const timer = setTimeout(() => {
        setSqlQuery(initialQuery);
        if (editorRef.current) {
          editorRef.current.setValue(initialQuery);
        }
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [initialQuery]);

  const saveRecentQuery = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setRecentQueries(prev => {
      const filtered = prev.filter(q => q !== trimmed);
      const next = [trimmed, ...filtered].slice(0, 15);
      try {
        localStorage.setItem(RECENT_QUERIES_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  }, []);

  // Discover databases in active workspace
  const loadDatabases = useCallback(async () => {
    try {
      const res = await databaseApi.discover(currentWorkspace);
      setDatabases(res);
      if (res.length > 0 && !selectedDbPath) {
        setSelectedDbPath(res[0].path);
      }
    } catch (err: any) {
      showToast(err.message || t('db_discover_error', 'Erreur lors de la détection des bases de données'), 'error');
    }
  }, [currentWorkspace, selectedDbPath, t]);

  // Load Schema when selected database changes
  const loadSchema = useCallback(async (dbPath: string) => {
    if (!dbPath) return;
    setLoadingSchema(true);
    try {
      const res = await databaseApi.getSchema(dbPath);
      setSchema(res);
      if (res.tables.length > 0) {
        setExpandedTables({ [res.tables[0].name]: true });
        setSqlQuery(`SELECT * FROM "${res.tables[0].name}" LIMIT 50;`);
      }
    } catch (err: any) {
      showToast(err.message || t('db_schema_error', 'Échec du chargement du schéma'), 'error');
      setSchema(null);
    } finally {
      setLoadingSchema(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        void loadDatabases();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadDatabases]);

  useEffect(() => {
    if (isOpen && selectedDbPath) {
      const timer = setTimeout(() => {
        void loadSchema(selectedDbPath);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, selectedDbPath, loadSchema]);

  // Execute Query
  const handleExecuteQuery = useCallback(async () => {
    if (!selectedDbPath) {
      showToast(t('db_select_db_first', 'Veuillez d\'abord sélectionner une base de données'), 'warning');
      return;
    }
    const query = sqlQuery.trim();
    if (!query) return;

    setExecuting(true);
    setCurrentPage(1);
    setSortColumn(null);
    try {
      const result = await databaseApi.executeQuery(selectedDbPath, query, queryLimit);
      setQueryResult(result);
      if (!result.error) {
        saveRecentQuery(query);
      }
    } catch (err: any) {
      setQueryResult({
        columns: [],
        rows: [],
        total_rows: 0,
        truncated: false,
        execution_time_ms: 0,
        error: err.message || t('db_query_unknown_error', 'Erreur d\'exécution inconnue')
      });
    } finally {
      setExecuting(false);
    }
  }, [selectedDbPath, sqlQuery, queryLimit, saveRecentQuery, t]);

  const handleExecuteQueryRef = useRef(handleExecuteQuery);
  useEffect(() => {
    handleExecuteQueryRef.current = handleExecuteQuery;
  }, [handleExecuteQuery]);

  // Keydown listener for Ctrl+Enter
  const handleEditorDidMount = (editor: any, monaco: any) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => {
      handleExecuteQueryRef.current();
    });
  };

  // Export Results
  const handleExport = useCallback(async (format: 'csv' | 'json') => {
    if (!selectedDbPath || !sqlQuery.trim()) return;
    setExporting(true);
    try {
      const blob = await databaseApi.exportQuery(selectedDbPath, sqlQuery.trim(), format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `query_export_${Date.now()}.${format}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast(t('db_export_success', 'Exportation réussie'), 'success');
    } catch (err: any) {
      showToast(err.message || t('db_export_error', 'Échec de l\'export'), 'error');
    } finally {
      setExporting(false);
    }
  }, [selectedDbPath, sqlQuery, t]);

  const toggleTableExpand = (tableName: string) => {
    setExpandedTables(prev => ({ ...prev, [tableName]: !prev[tableName] }));
  };

  const handleSelectTableQuickQuery = useCallback(async (table: TableInfo) => {
    if (!selectedDbPath) return;
    const q = `SELECT * FROM "${table.name}" LIMIT 50;`;
    setSqlQuery(q);
    if (editorRef.current) {
      editorRef.current.setValue(q);
    }
    setExecuting(true);
    setCurrentPage(1);
    setSortColumn(null);
    try {
      const res = await databaseApi.executeQuery(selectedDbPath, q, 50);
      setQueryResult(res);
      if (!res.error) {
        saveRecentQuery(q);
      }
    } catch (err: any) {
      setQueryResult({
        columns: [],
        rows: [],
        total_rows: 0,
        truncated: false,
        execution_time_ms: 0,
        error: err.message || t('db_query_unknown_error', "Erreur d'exécution inconnue")
      });
      showToast(err.message || t('db_query_unknown_error', "Erreur d'exécution inconnue"), 'error');
    } finally {
      setExecuting(false);
    }
  }, [selectedDbPath, saveRecentQuery, t]);

  // Filtered Tables
  const filteredTables = useMemo(() => {
    if (!schema?.tables) return [];
    if (!tableSearch.trim()) return schema.tables;
    const term = tableSearch.toLowerCase();
    return schema.tables.filter(tbl =>
      tbl.name.toLowerCase().includes(term) ||
      tbl.columns.some(col => col.name.toLowerCase().includes(term))
    );
  }, [schema, tableSearch]);

  // Sorted and Paginated Rows
  const processedRows = useMemo(() => {
    if (!queryResult || !queryResult.rows) return [];
    let rows = [...queryResult.rows];

    if (sortColumn && queryResult.columns) {
      const colIdx = queryResult.columns.indexOf(sortColumn);
      if (colIdx >= 0) {
        rows.sort((a, b) => {
          const valA = a[colIdx];
          const valB = b[colIdx];
          if (valA === valB) return 0;
          if (valA === null || valA === undefined) return 1;
          if (valB === null || valB === undefined) return -1;
          if (typeof valA === 'number' && typeof valB === 'number') {
            return sortDirection === 'asc' ? valA - valB : valB - valA;
          }
          const strA = String(valA).toLowerCase();
          const strB = String(valB).toLowerCase();
          return sortDirection === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
        });
      }
    }
    return rows;
  }, [queryResult, sortColumn, sortDirection]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedRows.slice(start, start + pageSize);
  }, [processedRows, currentPage, pageSize]);

  const handleHeaderSort = (colName: string) => {
    if (sortColumn === colName) {
      if (sortDirection === 'asc') {
        setSortDirection('desc');
      } else {
        setSortColumn(null);
        setSortDirection('asc');
      }
    } else {
      setSortColumn(colName);
      setSortDirection('asc');
    }
  };

  const formatFileSize = (bytes?: number | null) => {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const selectedDbInfo = databases.find(d => d.path === selectedDbPath);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className="w-full max-w-7xl h-[90vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
      >
        {/* Modal Header */}
        <div
          className="px-5 py-3.5 border-b flex items-center justify-between shrink-0 select-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center shadow-inner"
              style={{
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(37, 99, 235, 0.4))',
                border: '1px solid rgba(59, 130, 246, 0.3)',
                color: 'var(--accent)'
              }}
            >
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--strong)' }}>
                  {t('db_studio_title', 'Database Explorer & SQL Studio')}
                </h2>
                <span
                  className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold border"
                  style={{
                    backgroundColor: 'rgba(59, 130, 246, 0.1)',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                    color: 'var(--accent)'
                  }}
                >
                  v0.4 Studio
                </span>
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {t('db_studio_subtitle', 'Explorateur de données relationnelles, requêtage interactif et export instantané')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadDatabases}
              className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-xs flex items-center gap-1.5"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
              title={t('refresh', 'Actualiser')}
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-colors"
              style={{ color: 'var(--muted)' }}
              title={t('close', 'Fermer')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Modal Body: Split View */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Pane: Database Tree & Schema */}
          <div
            className="w-72 sm:w-80 border-r flex flex-col shrink-0 select-none overflow-hidden"
            style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
          >
            {/* Database Selector */}
            <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <label className="text-[10px] uppercase font-bold tracking-wider block mb-1.5" style={{ color: 'var(--muted)' }}>
                {t('db_active_database', 'Base de données active')}
              </label>
              {databases.length > 0 ? (
                <div className="relative">
                  <select
                    value={selectedDbPath}
                    onChange={(e) => setSelectedDbPath(e.target.value)}
                    className="w-full px-2.5 py-1.5 rounded-xl border text-xs appearance-none font-medium pr-8 focus:outline-none transition-colors"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--strong)'
                    }}
                  >
                    {databases.map(db => (
                      <option key={db.path} value={db.path}>
                        {db.name} ({db.table_count} {t('tables', 'tables')})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--muted)' }} />
                </div>
              ) : (
                <div className="text-xs italic py-1" style={{ color: 'var(--muted)' }}>
                  {t('db_no_databases_found', 'Aucune base SQLite trouvée dans le workspace.')}
                </div>
              )}

              {selectedDbInfo && (
                <div className="flex items-center justify-between text-[10px] mt-2 px-1" style={{ color: 'var(--muted)' }}>
                  <span className="font-mono">{selectedDbInfo.dialect.toUpperCase()}</span>
                  <span>{formatFileSize(selectedDbInfo.size_bytes)}</span>
                </div>
              )}
            </div>

            {/* Table Search Filter */}
            <div className="p-2 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--muted)' }} />
                <input
                  type="text"
                  placeholder={t('db_search_tables', 'Filtrer tables ou colonnes...')}
                  value={tableSearch}
                  onChange={(e) => setTableSearch(e.target.value)}
                  className="w-full pl-8 pr-2.5 py-1.5 text-xs rounded-xl border focus:outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>
            </div>

            {/* Tables & Views Tree */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loadingSchema ? (
                <div className="flex items-center justify-center p-8 text-xs" style={{ color: 'var(--muted)' }}>
                  <RefreshCw className="w-4 h-4 animate-spin mr-2 text-blue-500" />
                  {t('db_loading_schema', 'Inspection du schéma...')}
                </div>
              ) : filteredTables.length > 0 ? (
                filteredTables.map(tbl => {
                  const isExpanded = !!expandedTables[tbl.name];
                  return (
                    <div
                      key={tbl.name}
                      className="rounded-xl border transition-colors overflow-hidden"
                      style={{
                        borderColor: isExpanded ? 'rgba(59, 130, 246, 0.3)' : 'var(--border)',
                        backgroundColor: 'var(--surface)'
                      }}
                    >
                      {/* Table Header Row */}
                      <div
                        className="px-2.5 py-1.5 flex items-center justify-between cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        onClick={() => toggleTableExpand(tbl.name)}
                        onDoubleClick={() => handleSelectTableQuickQuery(tbl)}
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          {isExpanded ? (
                            <ChevronDown className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                          ) : (
                            <ChevronRight className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--muted)' }} />
                          )}
                          <Table className="w-3.5 h-3.5 shrink-0 text-blue-400" />
                          <span className="font-semibold text-xs truncate" style={{ color: 'var(--strong)' }}>
                            {tbl.name}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {tbl.row_count_estimate !== null && (
                            <span className="text-[10px] px-1 rounded bg-black/5 dark:bg-white/5 font-mono" style={{ color: 'var(--muted)' }}>
                              ~{tbl.row_count_estimate}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectTableQuickQuery(tbl);
                            }}
                            className="p-1 rounded hover:bg-blue-500/20 text-blue-400 transition-colors"
                            title={t('db_quick_query_table', 'Générer requête SELECT')}
                          >
                            <Play className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      </div>

                      {/* Expanded Columns List */}
                      {isExpanded && (
                        <div className="px-2.5 py-1.5 border-t space-y-1 bg-black/5 dark:bg-white/5" style={{ borderColor: 'var(--border)' }}>
                          {tbl.columns.map(col => (
                            <div key={col.name} className="flex items-center justify-between text-[11px] py-0.5">
                              <div className="flex items-center gap-1.5 min-w-0">
                                {col.primary_key && (
                                  <span title={t('db_primary_key', 'Clé primaire')} className="inline-flex items-center">
                                    <Key className="w-3 h-3 text-amber-400 shrink-0" />
                                  </span>
                                )}
                                <span className="font-mono text-xs truncate" style={{ color: 'var(--text)' }}>
                                  {col.name}
                                </span>
                              </div>
                              <span className="text-[9px] px-1 py-0.2 rounded font-mono font-medium opacity-80" style={{ backgroundColor: 'var(--surface-subtle)', color: 'var(--muted)' }}>
                                {col.type}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>
                  {tableSearch ? t('db_no_matching_tables', 'Aucune table correspondante.') : t('db_no_tables_in_db', 'Aucune table dans cette base.')}
                </div>
              )}
            </div>
          </div>

          {/* Right Main Area: SQL Editor + Data Grid */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top Toolbar */}
            <div
              className="px-4 py-2 border-b flex flex-wrap items-center justify-between gap-2 shrink-0 select-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExecuteQuery}
                  disabled={executing || !selectedDbPath}
                  className="px-3.5 py-1.5 rounded-xl font-medium text-xs flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#ffffff'
                  }}
                >
                  <Play className={`w-3.5 h-3.5 fill-current ${executing ? 'animate-spin' : ''}`} />
                  <span>{executing ? t('db_running_query', 'Exécution...') : t('db_run_query', 'Exécuter')}</span>
                  <kbd className="hidden sm:inline px-1 rounded bg-white/20 text-[10px] font-mono">Ctrl+↵</kbd>
                </button>

                {/* Templates Selector */}
                <select
                  onChange={(e) => {
                    if (e.target.value) {
                      setSqlQuery(e.target.value);
                      if (editorRef.current) editorRef.current.setValue(e.target.value);
                    }
                  }}
                  defaultValue=""
                  className="px-2.5 py-1.5 rounded-xl border text-xs transition-colors cursor-pointer"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                >
                  <option value="" disabled>{t('db_snippets_dropdown', 'Snippets SQL...')}</option>
                  <option value="SELECT * FROM sqlite_master WHERE type='table';">{t('db_snippet_list_tables', 'Lister tables')}</option>
                  <option value="PRAGMA integrity_check;">{t('db_snippet_integrity_check', 'Intégrité base')}</option>
                  <option value="PRAGMA table_info('nom_table');">{t('db_snippet_column_info', 'Infos colonnes')}</option>
                  <option value="SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL;">{t('db_snippet_view_ddl', 'Voir DDL')}</option>
                </select>

                {/* Recent Queries */}
                {recentQueries.length > 0 && (
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        setSqlQuery(e.target.value);
                        if (editorRef.current) editorRef.current.setValue(e.target.value);
                      }
                    }}
                    defaultValue=""
                    className="px-2.5 py-1.5 rounded-xl border text-xs max-w-[180px] truncate transition-colors cursor-pointer"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value="" disabled>{t('db_history_dropdown', 'Historique récent...')}</option>
                    {recentQueries.map((q, idx) => (
                      <option key={idx} value={q}>
                        {q.slice(0, 35)}...
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Limit & Export Controls */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                  <label className="text-[11px] font-medium">{t('db_limit_label', 'Limite :')}</label>
                  <select
                    value={queryLimit}
                    onChange={(e) => setQueryLimit(Number(e.target.value))}
                    className="px-2 py-1 rounded-lg border text-xs transition-colors cursor-pointer"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  >
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                    <option value={500}>500</option>
                    <option value={1000}>1000</option>
                  </select>
                </div>

                <div className="h-4 w-px bg-border/60 mx-1" />

                <button
                  onClick={() => handleExport('csv')}
                  disabled={exporting || !queryResult || queryResult.rows.length === 0}
                  className="px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  title={t('db_export_csv', 'Exporter en CSV')}
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="hidden sm:inline">CSV</span>
                </button>

                <button
                  onClick={() => handleExport('json')}
                  disabled={exporting || !queryResult || queryResult.rows.length === 0}
                  className="px-2.5 py-1.5 rounded-xl border text-xs flex items-center gap-1.5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40"
                  style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  title={t('db_export_json', 'Exporter en JSON')}
                >
                  <FileCode className="w-3.5 h-3.5 text-amber-500" />
                  <span className="hidden sm:inline">JSON</span>
                </button>
              </div>
            </div>

            {/* Monaco SQL Editor Section */}
            <div className="h-44 border-b shrink-0 relative" style={{ borderColor: 'var(--border)' }}>
              <Editor
                height="100%"
                language="sql"
                theme="vs-dark"
                value={sqlQuery}
                onChange={(val) => setSqlQuery(val || '')}
                onMount={handleEditorDidMount}
                options={{
                  minimap: { enabled: false },
                  fontSize: 13,
                  lineNumbers: 'on',
                  scrollBeyondLastLine: false,
                  wordWrap: 'on',
                  automaticLayout: true,
                  padding: { top: 8, bottom: 8 }
                }}
              />
            </div>

            {/* Query Telemetry / Error Bar */}
            <div
              className="px-4 py-2 border-b flex items-center justify-between text-xs shrink-0 select-none"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
            >
              <div className="flex items-center gap-3">
                {queryResult?.error ? (
                  <div className="flex items-center gap-1.5 text-rose-500 font-medium">
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>{queryResult.error}</span>
                  </div>
                ) : queryResult ? (
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text)' }}>
                    <div className="flex items-center gap-1 text-emerald-500">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span className="font-semibold">{queryResult.total_rows} {t('db_rows_returned', 'lignes retournées')}</span>
                    </div>
                    <div className="flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                      <Clock className="w-3 h-3" />
                      <span>{queryResult.execution_time_ms} ms</span>
                    </div>
                    {queryResult.truncated && (
                      <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 text-[10px]">
                        {t('db_results_truncated', 'Résultats tronqués à la limite')}
                      </span>
                    )}
                  </div>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>
                    {t('db_ready_to_query', 'Prêt à exécuter une requête SQL')}
                  </span>
                )}
              </div>

              {/* Pagination Info */}
              {processedRows.length > pageSize && (
                <div className="flex items-center gap-2">
                  <span style={{ color: 'var(--muted)' }}>
                    {t('db_page_info', 'Page {0} / {1}').replace('{0}', String(currentPage)).replace('{1}', String(totalPages))}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-2 py-0.5 rounded border text-[11px] disabled:opacity-40"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {t('previous', 'Précédent')}
                    </button>
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-2 py-0.5 rounded border text-[11px] disabled:opacity-40"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {t('next', 'Suivant')}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Results Data Grid */}
            <div className="flex-1 overflow-auto bg-black/5 dark:bg-black/20">
              {queryResult && queryResult.columns && queryResult.columns.length > 0 ? (
                <table className="w-full border-collapse text-xs font-mono text-left">
                  <thead className="sticky top-0 z-10 select-none shadow-sm" style={{ backgroundColor: 'var(--surface)' }}>
                    <tr className="border-b" style={{ borderColor: 'var(--border)' }}>
                      <th className="px-3 py-2 text-[11px] font-semibold text-center w-12 border-r" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                        #
                      </th>
                      {queryResult.columns.map((col) => {
                        const isSorted = sortColumn === col;
                        return (
                          <th
                            key={col}
                            onClick={() => handleHeaderSort(col)}
                            className="px-3 py-2 text-[11px] font-semibold tracking-wider cursor-pointer border-r hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                            style={{ borderColor: 'var(--border)', color: isSorted ? 'var(--accent)' : 'var(--strong)' }}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span className="truncate">{col}</span>
                              {isSorted && (
                                <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
                              )}
                            </div>
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedRows.map((row, rIdx) => {
                      const absoluteIndex = (currentPage - 1) * pageSize + rIdx + 1;
                      return (
                        <tr
                          key={rIdx}
                          className="border-b hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          style={{ borderColor: 'var(--border)' }}
                        >
                          <td className="px-3 py-1.5 text-center text-[10px] border-r opacity-60" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                            {absoluteIndex}
                          </td>
                          {row.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className="px-3 py-1.5 border-r truncate max-w-xs"
                              style={{ borderColor: 'var(--border)' }}
                              title={cell !== null ? String(cell) : 'NULL'}
                            >
                              {cell === null ? (
                                <span className="italic opacity-40 font-sans text-[10px] text-amber-500">NULL</span>
                              ) : (
                                <span>{String(cell)}</span>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <div className="h-full flex flex-col items-center justify-center text-center p-8 select-none" style={{ color: 'var(--muted)' }}>
                  <Database className="w-10 h-10 mb-3 opacity-30 text-blue-500" />
                  <p className="text-sm font-medium" style={{ color: 'var(--strong)' }}>
                    {t('db_no_results_yet', 'Aucun résultat de requête à afficher')}
                  </p>
                  <p className="text-xs max-w-sm mt-1">
                    {t('db_no_results_hint', 'Saisissez une requête SQL ci-dessus ou double-cliquez sur une table à gauche pour charger les données.')}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
