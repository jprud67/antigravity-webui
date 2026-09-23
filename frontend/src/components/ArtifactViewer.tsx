import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  Copy, 
  Check, 
  Download,
  FileCode,
  Sparkles,
  ChevronLeft,
  Layers,
  Search,
  Hash,
  Eye,
  Code,
  FileText
} from 'lucide-react';
import type { ArtifactItem } from '../types';
import { fetchArtifacts, fetchArtifactContent, triggerFileDownload } from '../services/api';
import { useI18n } from '../services/i18n';
import { MermaidRenderer } from './MermaidRenderer';
import { DiffViewer } from './DiffViewer';

interface ArtifactViewerProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId?: string | null;
}

type ArtifactCategory = 'all' | 'markdown' | 'code' | 'plans';

export const ArtifactViewer: React.FC<ArtifactViewerProps> = ({
  isOpen,
  onClose,
  conversationId
}) => {
  const { t } = useI18n();
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [content, setContent] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [showMobileList, setShowMobileList] = useState<boolean>(false);

  // Studio & Explorer Filter States
  const [listFilterQuery, setListFilterQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<ArtifactCategory>('all');
  const [rawMode, setRawMode] = useState<boolean>(false);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(true);
  const [inDocSearchQuery, setInDocSearchQuery] = useState<string>('');

  // Close modal on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Load artifacts on open
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchArtifacts(conversationId || undefined).then((items) => {
      if (active) {
        setArtifacts(items);
        if (items.length > 0) {
          setSelectedArtifact(items[0]);
        } else {
          setSelectedArtifact(null);
        }
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, conversationId]);

  // Fetch content when selected artifact changes
  useEffect(() => {
    let active = true;
    if (selectedArtifact) {
      queueMicrotask(() => {
        if (active) setLoading(true);
      });
      fetchArtifactContent(selectedArtifact.conversation_id, selectedArtifact.relative_path || selectedArtifact.filename)
        .then(res => {
          if (active) {
            setContent(typeof res === 'string' ? res : (res as any).content || '');
            setLoading(false);
          }
        })
        .catch(err => {
          if (active) {
            setContent(`[${t('artifact_load_error', 'Unable to load artifact: {0}').replace('{0}', err?.message || t('read_error', 'Read error'))}]`);
            setLoading(false);
          }
        });
    } else {
      queueMicrotask(() => {
        if (active) setContent('');
      });
    }
    return () => {
      active = false;
    };
  }, [selectedArtifact, t]);

  const selectArtifact = useCallback((art: ArtifactItem) => {
    setSelectedArtifact(art);
    setCopied(false);
    setInDocSearchQuery('');
  }, []);

  const copyContent = useCallback(async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(content);
      } else {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Failed to copy', e);
    }
  }, [content]);

  const downloadContent = useCallback(() => {
    if (!selectedArtifact) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    triggerFileDownload(blob, selectedArtifact.filename);
  }, [content, selectedArtifact]);

  // Filtered artifacts by category and text search
  const filteredArtifacts = useMemo(() => {
    return artifacts.filter((art) => {
      const name = art.filename.toLowerCase();
      if (categoryFilter === 'markdown' && !name.endsWith('.md')) return false;
      if (categoryFilter === 'code') {
        const isCode = /\.(js|ts|tsx|jsx|py|sh|json|yaml|yml|sql|css|html|php|rs|go|c|cpp)$/i.test(name);
        if (!isCode) return false;
      }
      if (categoryFilter === 'plans') {
        const isPlan = name.includes('plan') || name.includes('task') || name.includes('walkthrough') || name.includes('roadmap');
        if (!isPlan) return false;
      }
      if (listFilterQuery.trim()) {
        const q = listFilterQuery.toLowerCase();
        if (!name.includes(q) && !(art.relative_path || '').toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [artifacts, categoryFilter, listFilterQuery]);

  // Document statistics
  const docStats = useMemo(() => {
    if (!content) return { lines: 0, words: 0, chars: 0 };
    const lines = content.split('\n').length;
    const words = content.trim().split(/\s+/).filter(Boolean).length;
    const chars = content.length;
    return { lines, words, chars };
  }, [content]);

  // In-document match count
  const inDocMatchesCount = useMemo(() => {
    if (!inDocSearchQuery.trim() || !content) return 0;
    const q = inDocSearchQuery.toLowerCase();
    const matches = content.toLowerCase().split(q).length - 1;
    return Math.max(0, matches);
  }, [inDocSearchQuery, content]);

  if (!isOpen) return null;

  const isMarkdown = selectedArtifact?.filename.endsWith('.md') ?? false;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-0 sm:p-6 safe-pt safe-pb animate-in fade-in duration-200">
      <div
        className="w-full sm:w-[94vw] sm:max-w-6xl h-full sm:h-[90vh] sm:rounded-2xl flex flex-col shadow-2xl border overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 border-b shrink-0 select-none"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl border shadow-xs" style={{ backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold" style={{ color: 'var(--strong)' }}>{t('generated_artifacts', 'Documents & Artefacts Générés')}</h2>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded-full border bg-black/10 dark:bg-black/20" style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}>
                  {artifacts.length} {t('files', 'fichiers')}
                </span>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{t('generated_artifacts_desc', 'Plans d\'architecture, rapports, walkthroughs et code produit par Antigravity')}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl border transition-all cursor-pointer hover:bg-white/5"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            title={t('close_esc', 'Fermer (Échap)')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Artifacts List Sidebar */}
          <div
            className={`${showMobileList || !selectedArtifact ? 'flex' : 'hidden sm:flex'} w-full sm:w-80 border-r flex-col p-3 shrink-0 touch-scroll`}
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            {/* Real-time search filter input */}
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-muted pointer-events-none" />
              <input
                type="text"
                value={listFilterQuery}
                onChange={(e) => setListFilterQuery(e.target.value)}
                placeholder={t('filter_artifacts_placeholder', 'Filtrer les documents...')}
                className="w-full pl-8 pr-7 py-1.5 rounded-xl border text-xs font-sans outline-hidden bg-black/10 dark:bg-black/20 text-strong placeholder:text-muted/60 transition-colors"
                style={{ borderColor: listFilterQuery ? 'var(--accent)' : 'var(--border)' }}
              />
              {listFilterQuery && (
                <button
                  type="button"
                  onClick={() => setListFilterQuery('')}
                  className="absolute right-2 top-2 text-muted hover:text-strong cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category filter tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 mb-2.5 scrollbar-none text-[11px] select-none">
              {[
                { id: 'all', label: t('all', 'Tous') },
                { id: 'markdown', label: 'Markdown' },
                { id: 'code', label: 'Code' },
                { id: 'plans', label: 'Plans & Tâches' },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id as any)}
                  className={`px-2.5 py-1 rounded-lg border font-medium transition-all shrink-0 cursor-pointer ${
                    categoryFilter === cat.id
                      ? 'bg-accent/15 border-accent text-accent font-semibold shadow-xs'
                      : 'border-transparent text-muted hover:text-strong hover:bg-white/5'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Document list count header */}
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider px-1 mb-2 select-none" style={{ color: 'var(--muted)' }}>
              <span>{t('documents', 'Documents')} ({filteredArtifacts.length})</span>
              {listFilterQuery && (
                <span className="text-accent lowercase font-mono">
                  {filteredArtifacts.length} {t('matches', 'trouvé(s)')}
                </span>
              )}
            </div>

            {/* Document List Items */}
            <div className="flex-1 overflow-y-auto space-y-1 pr-0.5">
              {filteredArtifacts.length === 0 ? (
                <div className="p-8 text-center text-xs space-y-2 select-none" style={{ color: 'var(--muted)' }}>
                  <Sparkles className="w-5 h-5 mx-auto opacity-50" />
                  <p>{t('no_matching_artifacts', 'Aucun document correspondant.')}</p>
                </div>
              ) : (
                filteredArtifacts.map((art) => {
                  const isSelected = selectedArtifact?.filename === art.filename && selectedArtifact?.conversation_id === art.conversation_id;
                  const isMd = art.filename.endsWith('.md');
                  return (
                    <button
                      key={`${art.conversation_id}-${art.filename}`}
                      type="button"
                      onClick={() => {
                        selectArtifact(art);
                        setShowMobileList(false);
                      }}
                      className="w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 border cursor-pointer group shadow-2xs"
                      style={{
                        backgroundColor: isSelected ? 'var(--accent-bg)' : 'transparent',
                        borderColor: isSelected ? 'var(--accent)' : 'transparent',
                        color: isSelected ? 'var(--accent-text)' : 'var(--text)'
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {isMd ? (
                          <FileText className="w-3.5 h-3.5 shrink-0" style={{ color: isSelected ? 'var(--accent)' : '#38bdf8' }} />
                        ) : (
                          <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: isSelected ? 'var(--accent)' : 'var(--muted)' }} />
                        )}
                        <span className="font-mono truncate font-medium" style={{ color: isSelected ? 'var(--accent-text)' : 'var(--strong)' }}>{art.filename}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] pl-5.5 font-mono" style={{ color: 'var(--muted)' }}>
                        <span>{(art.size / 1024).toFixed(1)} Ko</span>
                        <span>•</span>
                        <span>{new Date(art.last_modified).toLocaleDateString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Artifact Preview */}
          <div
            className={`${!showMobileList && selectedArtifact ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden`}
            style={{ backgroundColor: 'var(--main-bg, var(--surface))' }}
          >
            {selectedArtifact ? (
              <>
                {/* File info bar & studio controls */}
                <div
                  className="px-3 sm:px-6 py-2.5 border-b flex flex-wrap items-center justify-between shrink-0 text-xs gap-2 select-none"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)'
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0 font-mono" style={{ color: 'var(--text)' }}>
                    {/* Mobile Back Button */}
                    <button
                      type="button"
                      onClick={() => setShowMobileList(true)}
                      className="sm:hidden p-1 rounded-lg border flex items-center gap-1 text-[11px] font-sans shrink-0 cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--accent-text)'
                      }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>{t('list', 'Liste')}</span>
                    </button>

                    <span className="font-bold text-accent truncate max-w-[140px] sm:max-w-none">{selectedArtifact.filename}</span>
                    <span className="hidden md:inline opacity-30">|</span>
                    <span className="text-[10.5px] truncate max-w-xs hidden md:inline font-mono opacity-70">{selectedArtifact.relative_path}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-black/10 dark:bg-black/20 hidden lg:inline font-mono" style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}>
                      {docStats.lines} l • {docStats.words} mots • {(selectedArtifact.size / 1024).toFixed(1)} Ko
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    {/* Intra-doc search input */}
                    <div
                      className="flex items-center gap-1 px-2 py-1 rounded-lg border text-xs bg-black/10 dark:bg-black/20"
                      style={{ borderColor: inDocSearchQuery ? 'var(--accent)' : 'var(--border-subtle)' }}
                    >
                      <Search className="w-3 h-3 text-muted shrink-0" />
                      <input
                        type="text"
                        value={inDocSearchQuery}
                        onChange={(e) => setInDocSearchQuery(e.target.value)}
                        placeholder={t('search_in_doc', 'Rechercher...')}
                        className="bg-transparent border-none outline-hidden text-[11px] font-mono text-strong placeholder:text-muted/60 w-24 sm:w-32"
                      />
                      {inDocSearchQuery && (
                        <span className="text-[10px] font-mono px-1 rounded bg-accent/20 text-accent font-semibold">
                          {inDocMatchesCount}
                        </span>
                      )}
                    </div>

                    {/* Markdown Rendered / Raw toggle */}
                    {isMarkdown && (
                      <button
                        type="button"
                        onClick={() => setRawMode(!rawMode)}
                        title={rawMode ? t('view_rendered', 'Vue Rendu') : t('view_raw', 'Vue Brute (Source)')}
                        className="py-1 px-2 rounded-lg border flex items-center gap-1 text-[11px] font-medium transition-colors cursor-pointer"
                        style={{
                          backgroundColor: rawMode ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: rawMode ? 'var(--accent)' : 'var(--border)',
                          color: rawMode ? 'var(--accent-text)' : 'var(--text)'
                        }}
                      >
                        {rawMode ? <Eye className="w-3 h-3" /> : <Code className="w-3 h-3" />}
                        <span className="hidden md:inline">{rawMode ? t('rendered', 'Rendu') : t('raw', 'Source')}</span>
                      </button>
                    )}

                    {/* Line numbers toggle */}
                    {(rawMode || !isMarkdown) && (
                      <button
                        type="button"
                        onClick={() => setShowLineNumbers(!showLineNumbers)}
                        title={showLineNumbers ? t('hide_line_numbers', 'Masquer numéros') : t('show_line_numbers', 'Afficher numéros')}
                        className="p-1 rounded-lg border text-[11px] transition-colors cursor-pointer"
                        style={{
                          backgroundColor: showLineNumbers ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: showLineNumbers ? 'var(--accent)' : 'var(--border)',
                          color: showLineNumbers ? 'var(--accent-text)' : 'var(--muted)'
                        }}
                      >
                        <Hash className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Copy */}
                    <button
                      type="button"
                      onClick={copyContent}
                      className="py-1 px-2.5 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer shadow-2xs"
                      style={{
                        backgroundColor: copied ? 'rgba(16, 185, 129, 0.1)' : 'var(--surface)',
                        borderColor: copied ? '#10B981' : 'var(--border)',
                        color: copied ? '#10B981' : 'var(--text)'
                      }}
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      <span className="hidden sm:inline">{copied ? t('copied', 'Copié !') : t('copy', 'Copier')}</span>
                    </button>

                    {/* Download */}
                    <button
                      type="button"
                      onClick={downloadContent}
                      className="py-1 px-2.5 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <Download className="w-3 h-3" />
                      <span className="hidden sm:inline">{t('download', 'Télécharger')}</span>
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                <div
                  className="flex-1 overflow-y-auto p-4 sm:p-6 text-xs leading-relaxed touch-scroll"
                  style={{ color: 'var(--text)' }}
                >
                  {loading ? (
                    <div className="flex items-center justify-center h-full select-none" style={{ color: 'var(--muted)' }}>
                      {t('loading_artifact', 'Chargement du document...')}
                    </div>
                  ) : isMarkdown && !rawMode ? (
                    <div className="markdown-content max-w-none">
                      <ReactMarkdown 
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code: ({ inline, className, children, ...props }: any) => {
                            const match = /language-(\w+)/.exec(className || '');
                            const language = match ? match[1] : '';
                            const codeContent = String(children).replace(/\n$/, '');
                            if (!inline && language === 'mermaid') {
                              return <MermaidRenderer chart={codeContent} />;
                            }
                            if (!inline && language === 'diff') {
                              return <DiffViewer diffText={codeContent} />;
                            }
                            return (
                              <code className={className} {...props}>
                                {children}
                              </code>
                            );
                          }
                        }}
                      >
                        {content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    /* Raw text / code preview with line numbers and search match highlighting */
                    <div className="table w-full font-mono text-[12px] leading-relaxed select-text">
                      {content.split('\n').map((line, idx) => {
                        const isMatch = inDocSearchQuery.trim() && line.toLowerCase().includes(inDocSearchQuery.toLowerCase());
                        return (
                          <div
                            key={idx}
                            className={`table-row transition-colors ${
                              isMatch ? 'bg-amber-500/15' : 'hover:bg-white/[0.02]'
                            }`}
                          >
                            {showLineNumbers && (
                              <div
                                className={`table-cell select-none text-right pr-3.5 pl-2 py-0.5 text-[11px] font-mono border-r align-top shrink-0 w-[46px] ${
                                  isMatch ? 'text-amber-400 font-bold' : 'opacity-40'
                                }`}
                                style={{
                                  borderColor: 'var(--border-subtle)',
                                  color: isMatch ? '#f59e0b' : 'var(--muted)',
                                  fontVariantNumeric: 'tabular-nums'
                                }}
                              >
                                {idx + 1}
                              </div>
                            )}
                            <div
                              className={`table-cell pl-4 pr-4 py-0.5 align-top whitespace-pre-wrap break-all ${
                                isMatch ? 'border-l-2 border-amber-400' : ''
                              }`}
                            >
                              {line || '\u00A0'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Footer Document Status Bar */}
                <div
                  className="px-4 py-2 border-t text-[11px] font-mono flex items-center justify-between shrink-0 select-none"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--muted)'
                  }}
                >
                  <span className="truncate max-w-sm">
                    {selectedArtifact.filename} • {docStats.lines} {t('lines', 'lignes')} • {docStats.words} {t('words', 'mots')}
                  </span>
                  {inDocSearchQuery && (
                    <span className="text-amber-400 font-semibold shrink-0">
                      {inDocMatchesCount} {inDocMatchesCount > 1 ? t('matching_lines', 'occurrences') : t('matching_line', 'occurrence')}
                    </span>
                  )}
                  <span className="opacity-60 hidden sm:inline">
                    {new Date(selectedArtifact.last_modified).toLocaleString()}
                  </span>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs select-none" style={{ color: 'var(--muted)' }}>
                {t('select_doc_view', 'Sélectionnez un document à afficher.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
