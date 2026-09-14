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

  const copyContent = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
      <div className="w-[900px] max-w-full h-full bg-[#090d1a] border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="h-14 px-6 border-b border-slate-800/80 flex items-center justify-between shrink-0 bg-[#0d1324]/80">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center">
              <FileText className="w-4 h-4 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-slate-100">Documents & Artifacts Générés</h2>
              <p className="text-[10px] text-slate-400">Plans d'architecture, rapports et code produits par Antigravity</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Artifacts List Sidebar */}
          <div className="w-72 border-r border-slate-800/70 overflow-y-auto p-3 space-y-1 shrink-0 bg-[#060a14]">
            <div className="flex items-center justify-between text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2.5 mb-2">
              <span>Fichiers</span>
              <span className="font-mono bg-slate-800/60 px-1.5 py-0.2 rounded text-slate-400">{artifacts.length}</span>
            </div>

            {artifacts.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 space-y-2">
                <Sparkles className="w-5 h-5 text-slate-600 mx-auto" />
                <p>Aucun artifact trouvé dans cette session.</p>
              </div>
            ) : (
              artifacts.map((art) => {
                const isSelected = selectedArtifact?.filename === art.filename && selectedArtifact?.conversation_id === art.conversation_id;
                return (
                  <button
                    key={`${art.conversation_id}-${art.filename}`}
                    onClick={() => selectArtifact(art)}
                    className={`w-full text-left p-2.5 rounded-xl text-xs transition-all flex flex-col gap-1 border cursor-pointer ${
                      isSelected
                        ? 'bg-gradient-to-r from-emerald-950/30 via-slate-900 to-slate-900 border-emerald-500/50 text-slate-100 shadow-sm'
                        : 'border-transparent text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <FileCode className={`w-3.5 h-3.5 shrink-0 ${isSelected ? 'text-emerald-400' : 'text-slate-500'}`} />
                      <span className="font-mono truncate font-medium text-slate-200">{art.filename}</span>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 pl-5.5">
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
          <div className="flex-1 flex flex-col overflow-hidden bg-[#080c16]">
            {selectedArtifact ? (
              <>
                {/* File info bar */}
                <div className="px-6 py-2.5 bg-[#0b101f] border-b border-slate-800/80 flex items-center justify-between shrink-0 text-xs">
                  <div className="flex items-center gap-2 font-mono text-slate-300">
                    <span className="font-semibold text-emerald-400">{selectedArtifact.filename}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-[10px] text-slate-500 truncate max-w-sm">{selectedArtifact.relative_path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyContent}
                      className="py-1 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copié !' : 'Copier'}</span>
                    </button>
                    <button
                      onClick={downloadContent}
                      className="py-1 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center gap-1.5 transition-colors text-[11px] font-medium cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Télécharger</span>
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                <div className="flex-1 overflow-y-auto p-8 text-xs leading-relaxed text-slate-200">
                  {loading ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
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
                    <pre className="font-mono bg-[#050811] p-5 rounded-2xl border border-slate-800 text-slate-300 overflow-x-auto whitespace-pre">
                      {content}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-xs">
                Sélectionnez un document pour le visualiser.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
