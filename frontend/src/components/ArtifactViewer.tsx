import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  FileText, 
  Copy, 
  Check, 
  Download,
  FileCode,
  Sparkles
} from 'lucide-react';
import type { ArtifactItem } from '../types';
import { fetchArtifacts, fetchArtifactContent } from '../services/api';
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
  conversationId,
}) => {
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadArtifacts();
    }
  }, [isOpen, conversationId]);

  const loadArtifacts = async () => {
    setLoading(true);
    try {
      const items = await fetchArtifacts(conversationId || undefined);
      setArtifacts(items);
      if (items.length > 0) {
        selectArtifact(items[0]);
      } else {
        setSelectedArtifact(null);
        setContent('');
      }
    } finally {
      setLoading(false);
    }
  };

  const selectArtifact = async (art: ArtifactItem) => {
    setSelectedArtifact(art);
    setLoading(true);
    try {
      const text = await fetchArtifactContent(art.conversation_id, art.filename);
      setContent(text);
    } finally {
      setLoading(false);
    }
  };

  const copyContent = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
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
    } catch {
      // Ignore copy error
    }
  };

  const downloadContent = () => {
    if (!selectedArtifact) return;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = selectedArtifact.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-md animate-fadeIn">
      <div
        className="w-[900px] max-w-full h-full border-l flex flex-col shadow-2xl"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="h-14 px-6 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xs font-semibold" style={{ color: 'var(--strong)' }}>Documents & Artifacts Générés</h2>
              <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Plans d'architecture, rapports et code produits par Antigravity</p>
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
          {/* Artifacts List Sidebar */}
          <div
            className="w-72 border-r overflow-y-auto p-3 space-y-1 shrink-0"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider px-2.5 mb-2" style={{ color: 'var(--muted)' }}>
              <span>Fichiers</span>
              <span className="font-mono px-1.5 py-0.2 rounded border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>{artifacts.length}</span>
            </div>

            {artifacts.length === 0 ? (
              <div className="p-6 text-center text-xs space-y-2" style={{ color: 'var(--muted)' }}>
                <Sparkles className="w-5 h-5 mx-auto" style={{ color: 'var(--muted)' }} />
                <p>Aucun artifact trouvé dans cette session.</p>
              </div>
            ) : (
              artifacts.map((art) => {
                const isSelected = selectedArtifact?.filename === art.filename && selectedArtifact?.conversation_id === art.conversation_id;
                return (
                  <button
                    key={`${art.conversation_id}-${art.filename}`}
                    onClick={() => selectArtifact(art)}
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
            className="flex-1 flex flex-col overflow-hidden"
            style={{ backgroundColor: 'var(--main-bg, var(--surface))' }}
          >
            {selectedArtifact ? (
              <>
                {/* File info bar */}
                <div
                  className="px-6 py-2.5 border-b flex items-center justify-between shrink-0 text-xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)'
                  }}
                >
                  <div className="flex items-center gap-2 font-mono" style={{ color: 'var(--text)' }}>
                    <span className="font-semibold text-emerald-500">{selectedArtifact.filename}</span>
                    <span style={{ color: 'var(--border)' }}>|</span>
                    <span className="text-[10px] truncate max-w-sm" style={{ color: 'var(--muted)' }}>{selectedArtifact.relative_path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyContent}
                      className="py-1 px-3 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copié !' : 'Copier'}</span>
                    </button>
                    <button
                      onClick={downloadContent}
                      className="py-1 px-3 rounded-lg border flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Télécharger</span>
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                <div
                  className="flex-1 overflow-y-auto p-8 text-xs leading-relaxed"
                  style={{ color: 'var(--text)' }}
                >
                  {loading ? (
                    <div className="flex items-center justify-center h-full" style={{ color: 'var(--muted)' }}>
                      Chargement de l'artifact...
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
                Sélectionnez un document pour le visualiser.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
