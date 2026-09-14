import React, { useState, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  X, 
  FileText, 
  Copy, 
  Check, 
  Download
} from 'lucide-react';
import type { ArtifactItem } from '../types';
import { fetchArtifacts, fetchArtifactContent } from '../services/api';

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
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div className="w-[850px] max-w-full h-full bg-slate-900 border-l border-slate-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="h-14 px-5 border-b border-slate-800 flex items-center justify-between shrink-0 bg-slate-900/80">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">Documents & Artifacts Générés</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Artifacts List Sidebar */}
          <div className="w-64 border-r border-slate-800 overflow-y-auto p-3 space-y-1 shrink-0 bg-slate-950/40">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider px-2 mb-2">
              Fichiers ({artifacts.length})
            </div>
            {artifacts.length === 0 ? (
              <div className="p-4 text-center text-xs text-slate-500">
                Aucun artifact trouvé.
              </div>
            ) : (
              artifacts.map((art) => {
                const isSelected = selectedArtifact?.filename === art.filename && selectedArtifact?.conversation_id === art.conversation_id;
                return (
                  <button
                    key={`${art.conversation_id}-${art.filename}`}
                    onClick={() => selectArtifact(art)}
                    className={`w-full text-left p-2 rounded-lg text-xs transition-colors flex flex-col gap-0.5 border ${
                      isSelected
                        ? 'bg-slate-800 border-emerald-500/40 text-slate-100'
                        : 'border-transparent text-slate-400 hover:bg-slate-800/40 hover:text-slate-200'
                    }`}
                  >
                    <span className="font-mono truncate font-medium">{art.filename}</span>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500">
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
          <div className="flex-1 flex flex-col overflow-hidden bg-[#0b0f19]">
            {selectedArtifact ? (
              <>
                {/* File info bar */}
                <div className="px-5 py-2.5 bg-slate-900/60 border-b border-slate-800 flex items-center justify-between shrink-0 text-xs">
                  <div className="flex items-center gap-2 font-mono text-slate-300">
                    <span className="font-semibold text-emerald-400">{selectedArtifact.filename}</span>
                    <span className="text-slate-600">|</span>
                    <span className="text-[11px] text-slate-500 truncate max-w-xs">{selectedArtifact.relative_path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={copyContent}
                      className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors text-[11px]"
                    >
                      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copied ? 'Copié' : 'Copier'}</span>
                    </button>
                    <button
                      onClick={downloadContent}
                      className="py-1 px-2.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-1.5 transition-colors text-[11px]"
                    >
                      <Download className="w-3 h-3" />
                      <span>Télécharger</span>
                    </button>
                  </div>
                </div>

                {/* Content preview */}
                <div className="flex-1 overflow-y-auto p-6 text-xs leading-relaxed text-slate-200">
                  {loading ? (
                    <div className="flex items-center justify-center h-full text-slate-500">
                      Chargement de l'artifact...
                    </div>
                  ) : selectedArtifact.filename.endsWith('.md') ? (
                    <div className="prose prose-invert prose-xs max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    <pre className="font-mono bg-slate-950 p-4 rounded-xl border border-slate-800 overflow-x-auto whitespace-pre">
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
