import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  FolderTree, 
  FileText, 
  Terminal as TerminalIcon, 
  GitBranch, 
  ChevronRight, 
  ChevronDown, 
  Folder, 
  File, 
  RefreshCw, 
  Plus,
  Kanban as KanbanIcon
} from 'lucide-react';
import { TerminalTab } from './TerminalTab';
import { GitTab } from './GitTab';
import { KanbanTab } from './KanbanTab';
import { MermaidRenderer } from './MermaidRenderer';
import { fetchFileTree, fetchFileContent, fetchArtifacts, fetchArtifactContent } from '../services/api';
import type { ArtifactItem } from '../types';

export type RightPanelTab = 'files' | 'artifacts' | 'terminal' | 'git' | 'kanban';

interface WorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  currentWorkspace: string;
  conversationId?: string;
  onInsertPath?: (path: string) => void;
  onExecutePrompt?: (prompt: string) => void;
}

export const WorkspacePanel: React.FC<WorkspacePanelProps> = ({
  isOpen,
  onClose,
  activeTab,
  onTabChange,
  currentWorkspace,
  conversationId,
  onInsertPath,
  onExecutePrompt,
}) => {
  const [panelWidth, setPanelWidth] = useState<number>(540);
  const isResizingRef = useRef(false);

  // Files Tab State
  const [fileTree, setFileTree] = useState<any>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [loadingContent, setLoadingContent] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Artifacts Tab State
  const [artifacts, setArtifacts] = useState<ArtifactItem[]>([]);
  const [selectedArtifact, setSelectedArtifact] = useState<ArtifactItem | null>(null);
  const [artifactMarkdown, setArtifactMarkdown] = useState<string>('');
  const [loadingArtifacts, setLoadingArtifacts] = useState(false);

  // Drag resizing logic
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = window.innerWidth - moveEvent.clientX;
      if (newWidth >= 360 && newWidth <= Math.min(1000, window.innerWidth - 300)) {
        setPanelWidth(newWidth);
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Load file tree when files tab is active
  const loadTree = async () => {
    setLoadingTree(true);
    try {
      const data = await fetchFileTree(currentWorkspace, 3);
      setFileTree(data);
    } catch (e) {
      console.error('Failed to load file tree', e);
    } finally {
      setLoadingTree(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'files') {
      loadTree();
    }
  }, [isOpen, activeTab, currentWorkspace]);

  // Load artifacts when artifacts tab is active
  const loadArtifactsList = async () => {
    setLoadingArtifacts(true);
    try {
      const items = await fetchArtifacts(conversationId);
      setArtifacts(items);
      if (items.length > 0 && !selectedArtifact) {
        handleSelectArtifact(items[0]);
      }
    } catch (e) {
      console.error('Failed to load artifacts', e);
    } finally {
      setLoadingArtifacts(false);
    }
  };

  useEffect(() => {
    if (isOpen && activeTab === 'artifacts') {
      loadArtifactsList();
    }
  }, [isOpen, activeTab, conversationId]);

  const handleSelectFile = async (path: string) => {
    setSelectedFilePath(path);
    setLoadingContent(true);
    try {
      const res = await fetchFileContent(path);
      setFileContent(res.content);
    } catch (err) {
      setFileContent('Erreur lors du chargement du fichier.');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleSelectArtifact = async (art: ArtifactItem) => {
    setSelectedArtifact(art);
    try {
      const content = await fetchArtifactContent(art.conversation_id, art.filename);
      setArtifactMarkdown(content);
    } catch (e) {
      setArtifactMarkdown('Impossible de charger le contenu de cet artifact.');
    }
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };

  if (!isOpen) return null;

  // File Tree Recursive Renderer
  const renderTreeItems = (items: any[], level = 0) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="space-y-0.5">
        {items.map((item: any) => {
          const isDir = item.is_dir;
          const isExpanded = !!expandedFolders[item.path];
          const isSelected = selectedFilePath === item.path;

          return (
            <div key={item.path}>
              <div
                onClick={() => (isDir ? toggleFolder(item.path) : handleSelectFile(item.path))}
                style={{ paddingLeft: `${level * 14 + 10}px` }}
                className={`flex items-center justify-between py-1 pr-2 rounded-lg text-xs cursor-pointer group transition-colors ${
                  isSelected
                    ? 'bg-sky-500/20 text-sky-200 border-l-2 border-sky-400 font-medium'
                    : 'text-slate-300 hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate">
                  {isDir ? (
                    <>
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    </>
                  ) : (
                    <>
                      <span className="w-3.5" />
                      <File className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    </>
                  )}
                  <span className="font-mono truncate">{item.name}</span>
                </div>

                {!isDir && onInsertPath && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onInsertPath(item.path);
                    }}
                    title="Insérer ce chemin dans le prompt"
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300 transition-opacity"
                  >
                    <Plus className="w-3 h-3" />
                  </button>
                )}
              </div>

              {isDir && isExpanded && item.children && (
                <div>{renderTreeItems(item.children, level + 1)}</div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      style={{ width: `${panelWidth}px` }}
      className="fixed top-0 right-0 bottom-0 z-40 bg-[#070b14] border-l border-slate-800 shadow-2xl flex flex-col transition-all duration-75 select-none"
    >
      {/* Left Resize Drag Bar */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 left-0 bottom-0 w-1.5 hover:w-2 hover:bg-sky-500/60 transition-all cursor-col-resize z-50 group flex items-center justify-center"
      >
        <div className="h-8 w-0.5 bg-slate-600 group-hover:bg-sky-400 rounded-full" />
      </div>

      {/* Panel Master Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[#0a101f] border-b border-slate-800 shrink-0">
        {/* Tab Buttons */}
        <div className="flex items-center gap-1 bg-[#050810] p-0.5 rounded-xl border border-slate-800/80">
          <button
            onClick={() => onTabChange('files')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'files'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Fichiers</span>
          </button>

          <button
            onClick={() => onTabChange('artifacts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'artifacts'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Artifacts</span>
          </button>

          <button
            onClick={() => onTabChange('terminal')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'terminal'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => onTabChange('git')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'git'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Git</span>
          </button>

          <button
            onClick={() => onTabChange('kanban')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
              activeTab === 'kanban'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <KanbanIcon className="w-3.5 h-3.5" />
            <span>Kanban</span>
          </button>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Panel Tab Body */}
      <div className="flex-1 min-h-0 overflow-hidden relative select-text">
        {activeTab === 'terminal' && (
          <TerminalTab currentWorkspace={currentWorkspace} />
        )}

        {activeTab === 'git' && (
          <GitTab currentWorkspace={currentWorkspace} />
        )}

        {activeTab === 'kanban' && (
          <KanbanTab 
            currentWorkspace={currentWorkspace} 
            onExecutePrompt={onExecutePrompt}
          />
        )}

        {/* FILES TAB */}
        {activeTab === 'files' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-2 bg-[#090e1a] border-b border-slate-800 text-xs">
              <div className="flex items-center gap-2 truncate text-slate-400 font-mono text-[11px]">
                <span>Racine :</span>
                <strong className="text-slate-200 truncate">{currentWorkspace}</strong>
              </div>
              <button
                onClick={loadTree}
                disabled={loadingTree}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* File Tree Column */}
              <div className="w-1/2 border-r border-slate-800/80 overflow-y-auto p-2 bg-[#060a12]">
                {loadingTree && !fileTree ? (
                  <div className="p-4 text-center text-slate-500 text-xs">Chargement...</div>
                ) : fileTree && fileTree.items ? (
                  renderTreeItems(fileTree.items)
                ) : (
                  <div className="p-4 text-center text-slate-500 text-xs italic">Aucun fichier</div>
                )}
              </div>

              {/* File Content Preview Column */}
              <div className="w-1/2 flex flex-col min-h-0 bg-[#070b14]">
                {selectedFilePath ? (
                  <>
                    <div className="flex items-center justify-between px-3 py-1.5 bg-[#0a101f] border-b border-slate-800 text-[11px] text-slate-400">
                      <span className="font-mono truncate">{selectedFilePath.split('/').pop()}</span>
                      {onInsertPath && (
                        <button
                          onClick={() => onInsertPath(selectedFilePath)}
                          className="text-[10px] text-sky-400 hover:text-sky-300 font-medium cursor-pointer"
                        >
                          + Insérer
                        </button>
                      )}
                    </div>
                    <div className="flex-1 overflow-auto p-3 font-mono text-xs text-slate-300 bg-[#050810]">
                      {loadingContent ? (
                        <div className="text-slate-500">Chargement du contenu...</div>
                      ) : (
                        <pre className="whitespace-pre-wrap">{fileContent}</pre>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-slate-500 text-xs p-4 text-center">
                    Sélectionnez un fichier pour prévisualiser son contenu.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ARTIFACTS TAB */}
        {activeTab === 'artifacts' && (
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-3 py-2 bg-[#090e1a] border-b border-slate-800 text-xs">
              <span className="text-slate-400">Artifacts ({artifacts.length})</span>
              <button
                onClick={loadArtifactsList}
                disabled={loadingArtifacts}
                className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingArtifacts ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Artifacts List */}
              <div className="w-48 border-r border-slate-800/80 overflow-y-auto p-2 bg-[#060a12] space-y-1">
                {artifacts.length === 0 ? (
                  <div className="p-4 text-center text-slate-500 text-xs italic">Aucun artifact</div>
                ) : (
                  artifacts.map((art) => {
                    const isSelected = selectedArtifact?.filename === art.filename;
                    return (
                      <button
                        key={art.filename}
                        onClick={() => handleSelectArtifact(art)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate ${
                          isSelected
                            ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30'
                            : 'text-slate-300 hover:bg-slate-800/50'
                        }`}
                      >
                        <div className="font-medium truncate">{art.filename}</div>
                        <div className="text-[10px] text-slate-500 truncate">{(art.size / 1024).toFixed(1)} KB</div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Artifact Markdown / Mermaid Viewer */}
              <div className="flex-1 overflow-y-auto p-4 bg-[#070b14] prose prose-invert prose-sky max-w-none text-xs">
                {selectedArtifact ? (
                  <div className="space-y-4">
                    <div className="border-b border-slate-800 pb-3">
                      <h2 className="text-base font-bold text-white mb-1">{selectedArtifact.filename}</h2>
                      <p className="text-xs text-slate-400 font-mono">{selectedArtifact.relative_path}</p>
                    </div>
                    {/* Render Mermaid if code block or raw markdown */}
                    {artifactMarkdown.includes('```mermaid') ? (
                      <div>
                        {artifactMarkdown.split('```mermaid').map((chunk, idx) => {
                          if (idx === 0) {
                            return <div key={idx} className="whitespace-pre-wrap">{chunk}</div>;
                          }
                          const parts = chunk.split('```');
                          const chartCode = parts[0];
                          const remainingText = parts.slice(1).join('```');
                          return (
                            <div key={idx} className="my-4">
                              <MermaidRenderer chart={chartCode.trim()} />
                              {remainingText && (
                                <div className="whitespace-pre-wrap mt-4">{remainingText}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans text-slate-300">
                        {artifactMarkdown}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-slate-500 text-xs">
                    Sélectionnez un document à afficher.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
