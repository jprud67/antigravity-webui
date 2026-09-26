import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Eye,
  RefreshCw,
  ExternalLink,
  Monitor,
  Tablet,
  Smartphone,
  FileCode2,
  Layers
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useI18n } from '../services/i18n';
import { fetchGitStatus, fetchFileContent, fetchArtifacts, fetchArtifactContent } from '../services/api';

interface LivePreviewDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  activeConversationId?: string | null;
  currentWorkspace?: string;
}

type PreviewTab = 'web' | 'files' | 'artifacts';
type ViewportPreset = 'desktop' | 'tablet' | 'mobile';

interface ArtifactEntry {
  name: string;
  path: string;
  conversation_id?: string;
  content?: string;
}

export const LivePreviewDrawer: React.FC<LivePreviewDrawerProps> = ({
  isOpen,
  onClose,
  activeConversationId,
  currentWorkspace
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<PreviewTab>('web');

  // Web & Canvas Live Preview State
  const [previewUrl, setPreviewUrl] = useState<string>('http://localhost:5173/');
  const [iframeSrc, setIframeSrc] = useState<string>('http://localhost:5173/');
  const [viewportPreset, setViewportPreset] = useState<ViewportPreset>('desktop');
  const [iframeKey, setIframeKey] = useState<number>(0);
  const [iframeLoading, setIframeLoading] = useState<boolean>(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Modified Files Inspection State
  const [modifiedFiles, setModifiedFiles] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>('');
  const [loadingFiles, setLoadingFiles] = useState<boolean>(false);
  const [loadingContent, setLoadingContent] = useState<boolean>(false);

  // Artifacts State
  const [artifacts, setArtifacts] = useState<ArtifactEntry[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactEntry | null>(null);

  // Load modified files and artifacts when drawer is open
  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    setLoadingFiles(true);

    // Fetch git status to get modified files in workspace
    fetchGitStatus(currentWorkspace)
      .then((status) => {
        if (!isMounted) return;
        const allModified = [
          ...(status.modified || []),
          ...(status.staged || []),
          ...(status.untracked || [])
        ];
        // Deduplicate
        const unique = Array.from(new Set(allModified));
        setModifiedFiles(unique);
        if (unique.length > 0 && !selectedFile) {
          setSelectedFile(unique[0]);
        }
      })
      .catch((err) => {
        console.warn('Could not fetch git modified files:', err);
      })
      .finally(() => {
        if (isMounted) setLoadingFiles(false);
      });

    // Fetch artifacts for the current conversation
    if (activeConversationId) {
      fetchArtifacts(activeConversationId)
        .then((items) => {
          if (!isMounted) return;
          const mapped: ArtifactEntry[] = (items || []).map((i) => ({
            name: i.filename,
            path: i.filename,
            conversation_id: i.conversation_id
          }));
          setArtifacts(mapped);
          if (mapped.length > 0 && !selectedArtifact) {
            setSelectedArtifact(mapped[0]);
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [isOpen, currentWorkspace, activeConversationId]);

  // Load file content when selectedFile changes
  useEffect(() => {
    if (!selectedFile) {
      setFileContent('');
      return;
    }
    let isMounted = true;
    setLoadingContent(true);
    fetchFileContent(selectedFile, currentWorkspace)
      .then((res) => {
        if (isMounted) {
          setFileContent(res.content || '');
        }
      })
      .catch((err) => {
        if (isMounted) {
          setFileContent(`// Error reading file: ${err.message}`);
        }
      })
      .finally(() => {
        if (isMounted) setLoadingContent(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedFile, currentWorkspace]);

  // Load artifact content when selectedArtifact changes
  useEffect(() => {
    if (!selectedArtifact || selectedArtifact.content) return;
    let isMounted = true;
    if (activeConversationId && selectedArtifact.name) {
      fetchArtifactContent(activeConversationId, selectedArtifact.name)
        .then((content) => {
          if (isMounted) {
            setSelectedArtifact((prev) => (prev ? { ...prev, content } : null));
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
    };
  }, [selectedArtifact, activeConversationId]);

  if (!isOpen) return null;

  const handleReload = () => {
    setIframeLoading(true);
    setIframeKey((prev) => prev + 1);
  };

  const handleApplyUrl = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    let url = previewUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      url = `http://${url}`;
    }
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return;
      }
      setIframeSrc(parsed.href);
      setIframeKey((prev) => prev + 1);
    } catch {
      // Invalid URL syntax
    }
  };

  const getViewportWidth = () => {
    switch (viewportPreset) {
      case 'mobile':
        return '375px';
      case 'tablet':
        return '768px';
      case 'desktop':
      default:
        return '100%';
    }
  };

  const detectLanguage = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'ts':
      case 'tsx':
        return 'typescript';
      case 'js':
      case 'jsx':
        return 'javascript';
      case 'py':
        return 'python';
      case 'json':
        return 'json';
      case 'html':
        return 'html';
      case 'css':
        return 'css';
      case 'md':
        return 'markdown';
      case 'sql':
        return 'sql';
      default:
        return 'plaintext';
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-y-0 right-0 z-50 flex flex-col w-full max-w-4xl bg-zinc-950/95 border-l border-zinc-800 shadow-2xl backdrop-blur-xl text-zinc-100 animate-slide-left"
    >
      {/* Drawer Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-900/80 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
            <Eye size={18} />
          </div>
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
              {t('share_live_preview') || 'Live Preview & Joint Inspection'}
              <span className="text-[10px] font-normal px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                Synced
              </span>
            </h2>
            <p className="text-xs text-zinc-400">
              Responsive iframe sandboxing, modified files & generated artifacts
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setActiveTab('web')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === 'web'
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Monitor size={14} />
            {t('share_preview_tab_web') || 'Web & Canvas'}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('files')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === 'files'
                ? 'bg-purple-500/20 text-purple-200 border border-purple-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <FileCode2 size={14} />
            {t('share_preview_tab_files') || 'Modified Files'}
            {modifiedFiles.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-300 font-mono">
                {modifiedFiles.length}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('artifacts')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition flex items-center gap-1.5 ${
              activeTab === 'artifacts'
                ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40 shadow-sm'
                : 'text-zinc-400 hover:text-white'
            }`}
          >
            <Layers size={14} />
            {t('share_preview_tab_artifacts') || 'Artifacts & Plans'}
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
        >
          <X size={18} />
        </button>
      </div>

      {/* Tab 1: Web & Canvas Live Preview */}
      {activeTab === 'web' && (
        <div className="flex-1 flex flex-col overflow-hidden bg-zinc-950">
          {/* Subheader: URL input and Viewport Switcher */}
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-zinc-800/80 bg-zinc-900/40 shrink-0">
            {/* Viewport Presets */}
            <div className="flex items-center gap-1 bg-zinc-900/80 border border-zinc-800 rounded-lg p-0.5">
              <button
                type="button"
                onClick={() => setViewportPreset('desktop')}
                className={`p-1.5 rounded-md transition ${
                  viewportPreset === 'desktop'
                    ? 'bg-zinc-800 text-cyan-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={t('share_preview_responsive_desktop') || 'Desktop (100%)'}
              >
                <Monitor size={15} />
              </button>
              <button
                type="button"
                onClick={() => setViewportPreset('tablet')}
                className={`p-1.5 rounded-md transition ${
                  viewportPreset === 'tablet'
                    ? 'bg-zinc-800 text-cyan-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={t('share_preview_responsive_tablet') || 'Tablet (768px)'}
              >
                <Tablet size={15} />
              </button>
              <button
                type="button"
                onClick={() => setViewportPreset('mobile')}
                className={`p-1.5 rounded-md transition ${
                  viewportPreset === 'mobile'
                    ? 'bg-zinc-800 text-cyan-300'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
                title={t('share_preview_responsive_mobile') || 'Mobile (375px)'}
              >
                <Smartphone size={15} />
              </button>
            </div>

            {/* URL input */}
            <form onSubmit={handleApplyUrl} className="flex-1 max-w-lg flex items-center gap-2">
              <input
                type="text"
                value={previewUrl}
                onChange={(e) => setPreviewUrl(e.target.value)}
                placeholder="http://localhost:5173/..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 font-mono focus:outline-none focus:border-cyan-500"
              />
              <button
                type="button"
                onClick={handleReload}
                className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
                title={t('share_preview_reload') || 'Reload Preview'}
              >
                <RefreshCw size={15} className={iframeLoading ? 'animate-spin' : ''} />
              </button>
              <a
                href={iframeSrc}
                target="_blank"
                rel="noreferrer"
                className="p-1.5 text-zinc-400 hover:text-cyan-300 rounded-lg hover:bg-zinc-800 transition"
                title={t('share_preview_open_tab') || 'Open in New Tab'}
              >
                <ExternalLink size={15} />
              </a>
            </form>
          </div>

          {/* Iframe Viewport Area */}
          <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-zinc-950/80">
            <div
              className="h-full bg-white rounded-xl shadow-2xl overflow-hidden border border-zinc-800/80 transition-all duration-300 relative flex flex-col"
              style={{ width: getViewportWidth(), maxWidth: '100%' }}
            >
              <iframe
                key={iframeKey}
                ref={iframeRef}
                src={iframeSrc}
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                className="w-full h-full border-0"
                onLoad={() => setIframeLoading(false)}
                onError={() => setIframeLoading(false)}
                title="Live Sandboxed Preview"
              />
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Modified Files Inspection */}
      {activeTab === 'files' && (
        <div className="flex-1 flex overflow-hidden bg-zinc-950">
          {/* File sidebar list */}
          <div className="w-64 border-r border-zinc-800 flex flex-col bg-zinc-900/30 shrink-0">
            <div className="px-4 py-2.5 border-b border-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('share_preview_tab_files') || 'Files'}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{modifiedFiles.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {loadingFiles ? (
                <div className="text-center py-6 text-zinc-500 text-xs">Scanning modified files...</div>
              ) : modifiedFiles.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-xs">No modified files detected</div>
              ) : (
                modifiedFiles.map((file) => (
                  <button
                    key={file}
                    type="button"
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-mono truncate transition flex items-center gap-2 ${
                      selectedFile === file
                        ? 'bg-purple-500/20 text-purple-200 border border-purple-500/30'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                    }`}
                  >
                    <FileCode2 size={13} className="shrink-0 text-zinc-500" />
                    <span className="truncate">{file}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Monaco Editor Viewer */}
          <div className="flex-1 flex flex-col overflow-hidden bg-zinc-900/50">
            {selectedFile ? (
              <>
                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/60 text-xs text-zinc-400 font-mono">
                  <span className="truncate">{selectedFile}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                    Read-Only
                  </span>
                </div>
                <div className="flex-1 relative">
                  {loadingContent ? (
                    <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                      Loading content...
                    </div>
                  ) : (
                    <Editor
                      height="100%"
                      language={detectLanguage(selectedFile)}
                      value={fileContent}
                      theme="vs-dark"
                      options={{
                        readOnly: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        fontSize: 12,
                        automaticLayout: true,
                        fontFamily: 'JetBrains Mono, Fira Code, monospace'
                      }}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-zinc-500 text-xs">
                Select a file to inspect code
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Artifacts & Plans */}
      {activeTab === 'artifacts' && (
        <div className="flex-1 flex overflow-hidden bg-zinc-950">
          {/* Artifacts sidebar */}
          <div className="w-64 border-r border-zinc-800 flex flex-col bg-zinc-900/30 shrink-0">
            <div className="px-4 py-2.5 border-b border-zinc-800 text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center justify-between">
              <span>{t('share_preview_tab_artifacts') || 'Plans & Artifacts'}</span>
              <span className="text-[10px] text-zinc-500 font-mono">{artifacts.length}</span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {artifacts.length === 0 ? (
                <div className="text-center py-6 text-zinc-500 text-xs">No artifacts found</div>
              ) : (
                artifacts.map((art) => (
                  <button
                    key={art.path}
                    type="button"
                    onClick={() => setSelectedArtifact(art)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium truncate transition flex items-center gap-2 ${
                      selectedArtifact?.path === art.path
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/30'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/40'
                    }`}
                  >
                    <Layers size={13} className="shrink-0 text-amber-400" />
                    <span className="truncate">{art.name}</span>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Rendered Markdown Area */}
          <div className="flex-1 overflow-y-auto p-6 bg-zinc-900/30 custom-scrollbar prose prose-invert max-w-none">
            {selectedArtifact ? (
              <div className="space-y-4">
                <h3 className="text-base font-semibold text-white border-b border-zinc-800 pb-2">
                  {selectedArtifact.name}
                </h3>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedArtifact.content || '*Chargement du contenu...*'}
                </ReactMarkdown>
              </div>
            ) : (
              <div className="text-center py-12 text-zinc-500 text-xs">
                Select an artifact or implementation plan to inspect
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
