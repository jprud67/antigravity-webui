import React, { useState, useEffect, useCallback } from 'react';
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
  Layers
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-0 sm:p-6 safe-pt safe-pb">
      <div
        className="w-full sm:w-[90vw] sm:max-w-6xl h-full sm:h-[90vh] sm:rounded-2xl flex flex-col shadow-2xl border"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 sm:px-6 py-3 border-b shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent)' }}>
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xs font-semibold" style={{ color: 'var(--strong)' }}>{t('generated_artifacts', 'Generated Documents & Artifacts')}</h2>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{t('generated_artifacts_desc', 'Architecture plans, reports, and code produced by Antigravity')}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Artifacts List Sidebar - Toggleable on mobile */}
          <div
            className={`${showMobileList || !selectedArtifact ? 'flex' : 'hidden sm:flex'} w-full sm:w-72 border-r flex-col overflow-y-auto p-3 space-y-1 shrink-0 touch-scroll`}
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider px-2.5 mb-2" style={{ color: 'var(--muted)' }}>
              <span>{t('documents', 'Documents')} ({artifacts.length})</span>
              <span className="font-mono px-1.5 py-0.2 rounded border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>{artifacts.length}</span>
            </div>

            {artifacts.length === 0 ? (
              <div className="p-6 text-center text-xs space-y-2" style={{ color: 'var(--muted)' }}>
                <Sparkles className="w-5 h-5 mx-auto" style={{ color: 'var(--muted)' }} />
                <p>{t('no_artifacts', 'No artifacts found.')}</p>
              </div>
            ) : (
              artifacts.map((art) => {
                const isSelected = selectedArtifact?.filename === art.filename && selectedArtifact?.conversation_id === art.conversation_id;
                return (
                  <button
                    key={`${art.conversation_id}-${art.filename}`}
                    onClick={() => {
                      selectArtifact(art);
                      setShowMobileList(false);
                    }}
                    className="w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 border cursor-pointer"
                    style={{
                      backgroundColor: isSelected ? 'var(--accent-bg)' : 'transparent',
                      borderColor: isSelected ? 'var(--accent)' : 'transparent',
                      color: isSelected ? 'var(--accent-text)' : 'var(--text)'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <FileCode className="w-3.5 h-3.5 shrink-0" style={{ color: isSelected ? 'var(--accent)' : 'var(--muted)' }} />
                      <span className="font-mono truncate font-medium" style={{ color: isSelected ? 'var(--accent-text)' : 'var(--strong)' }}>{art.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] pl-5.5" style={{ color: 'var(--muted)' }}>
                      <span>{(art.size / 1024).toFixed(1)} KB</span>
                      <span>•</span>
                      <span>{new Date(art.last_modified).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Artifact Preview */}
          <div
            className={`${!showMobileList && selectedArtifact ? 'flex' : 'hidden sm:flex'} flex-1 flex-col overflow-hidden`}
            style={{ backgroundColor: 'var(--main-bg, var(--surface))' }}
          >
            {selectedArtifact ? (
              <>
                {/* File info bar */}
                <div
                  className="px-3 sm:px-6 py-2.5 border-b flex items-center justify-between shrink-0 text-xs gap-2"
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
                      <span>{t('list', 'List')}</span>
                    </button>

                    <span className="font-semibold text-emerald-500 truncate max-w-[120px] sm:max-w-none">{selectedArtifact.filename}</span>
                    <span className="hidden sm:inline" style={{ color: 'var(--border)' }}>|</span>
                    <span className="text-[10px] truncate max-w-sm hidden sm:inline" style={{ color: 'var(--muted)' }}>{selectedArtifact.relative_path}</span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={copyContent}
                      className="py-1 px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span className="hidden sm:inline">{copied ? t('copied', 'Copied!') : t('copy', 'Copy')}</span>
                    </button>
                    <button
                      onClick={downloadContent}
                      className="py-1 px-2.5 sm:px-3 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">{t('download', 'Download')}</span>
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                <div
                  className="flex-1 overflow-y-auto p-3.5 sm:p-8 text-xs leading-relaxed touch-scroll"
                  style={{ color: 'var(--text)' }}
                >
                  {loading ? (
                    <div className="flex items-center justify-center h-full" style={{ color: 'var(--muted)' }}>
                      {t('loading_artifact', 'Loading artifact...')}
                    </div>
                  ) : selectedArtifact.filename.endsWith('.md') ? (
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
                    <pre
                      className="font-mono p-5 rounded-2xl border overflow-x-auto whitespace-pre"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      {content}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
                {t('select_doc_view', 'Select a document to view.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
