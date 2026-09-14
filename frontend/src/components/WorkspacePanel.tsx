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
  Kanban as KanbanIcon,
  Edit3,
  Save,
  Check
} from 'lucide-react';
import { TerminalTab } from './TerminalTab';
import { GitTab } from './GitTab';
import { KanbanTab } from './KanbanTab';
import { MermaidRenderer } from './MermaidRenderer';
import { fetchFileTree, fetchFileContent, saveFileContent, fetchArtifacts, fetchArtifactContent } from '../services/api';
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
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editedFileContent, setEditedFileContent] = useState('');
  const [savingFile, setSavingFile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
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
    setIsEditingFile(false);
    setSaveSuccess(false);
    setLoadingContent(true);
    try {
      const res = await fetchFileContent(path);
      setFileContent(res.content);
      setEditedFileContent(res.content);
    } catch (err) {
      setFileContent('Erreur lors du chargement du fichier.');
      setEditedFileContent('');
    } finally {
      setLoadingContent(false);
    }
  };

  const handleSaveFile = async () => {
    if (!selectedFilePath) return;
    setSavingFile(true);
    try {
      await saveFileContent(selectedFilePath, editedFileContent);
      setFileContent(editedFileContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch (err) {
      alert('Erreur lors de la sauvegarde du fichier.');
    } finally {
      setSavingFile(false);
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
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 font-medium border-l-2 border-sky-500'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5'
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
      style={{
        width: `${panelWidth}px`,
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)',
      }}
      className="fixed top-0 right-0 bottom-0 z-40 border-l shadow-2xl flex flex-col transition-all duration-75 select-none"
    >
      {/* Left Resize Drag Bar */}
      <div
        onMouseDown={handleMouseDown}
        className="absolute top-0 left-0 bottom-0 w-1.5 hover:w-2 hover:bg-sky-500/60 transition-all cursor-col-resize z-50 group flex items-center justify-center"
      >
        <div className="h-8 w-0.5 bg-slate-400 dark:bg-slate-600 group-hover:bg-sky-400 rounded-full" />
      </div>

      {/* Panel Master Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b shrink-0 transition-colors"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Tab Buttons */}
        <div
          className="flex items-center gap-1 p-0.5 rounded-xl border"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
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
        <div className={`h-full ${activeTab === 'terminal' ? 'block' : 'hidden'}`}>
          <TerminalTab currentWorkspace={currentWorkspace} />
        </div>

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
            <div
              className="flex items-center justify-between px-3 py-2 border-b text-xs shrink-0"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2 truncate font-mono text-[11px]" style={{ color: 'var(--muted)' }}>
                <span>Racine :</span>
                <strong className="truncate" style={{ color: 'var(--strong)' }}>{currentWorkspace}</strong>
              </div>
              <button
                onClick={loadTree}
                disabled={loadingTree}
                className="p-1 rounded transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--muted)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* File Tree Column */}
              <div
                className="w-1/2 border-r overflow-y-auto p-2"
                style={{
                  backgroundColor: 'var(--sidebar)',
                  borderColor: 'var(--border)',
                }}
              >
                {loadingTree && !fileTree ? (
                  <div className="p-4 text-center text-xs" style={{ color: 'var(--muted)' }}>Chargement...</div>
                ) : fileTree && fileTree.items ? (
                  renderTreeItems(fileTree.items)
                ) : (
                  <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>Aucun fichier</div>
                )}
              </div>

              {/* File Content Preview / Editor Column */}
              <div className="w-1/2 flex flex-col min-h-0" style={{ backgroundColor: 'var(--surface)' }}>
                {selectedFilePath ? (
                  <>
                    <div
                      className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] shrink-0"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--muted)',
                      }}
                    >
                      <span className="font-mono truncate" style={{ color: 'var(--strong)' }}>{selectedFilePath.split('/').pop()}</span>
                      <div className="flex items-center gap-1.5">
                        {onInsertPath && (
                          <button
                            onClick={() => onInsertPath(selectedFilePath)}
                            className="text-[10px] text-sky-500 hover:text-sky-400 font-medium cursor-pointer mr-1"
                            title="Insérer le chemin"
                          >
                            + Insérer
                          </button>
                        )}
                        <button
                          onClick={() => {
                            if (!isEditingFile) {
                              setEditedFileContent(fileContent || '');
                            }
                            setIsEditingFile(!isEditingFile);
                          }}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border"
                          style={{
                            backgroundColor: isEditingFile ? 'var(--accent-bg)' : 'var(--surface)',
                            borderColor: isEditingFile ? 'var(--accent)' : 'var(--border)',
                            color: isEditingFile ? 'var(--accent)' : 'var(--text)',
                          }}
                        >
                          <Edit3 className="w-2.5 h-2.5" />
                          <span>{isEditingFile ? 'Lecture' : 'Éditer'}</span>
                        </button>
                        {isEditingFile && (
                          <button
                            onClick={handleSaveFile}
                            disabled={savingFile}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer bg-sky-600 hover:bg-sky-500 text-white"
                          >
                            {saveSuccess ? <Check className="w-2.5 h-2.5" /> : <Save className="w-2.5 h-2.5" />}
                            <span>{saveSuccess ? 'Enregistré' : savingFile ? '...' : 'Sauvegarder'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                    <div
                      className="flex-1 overflow-auto p-3 font-mono text-xs flex flex-col"
                      style={{
                        backgroundColor: 'var(--code-bg)',
                        color: 'var(--code-text)',
                      }}
                    >
                      {loadingContent ? (
                        <div style={{ color: 'var(--muted)' }}>Chargement du contenu...</div>
                      ) : isEditingFile ? (
                        <textarea
                          value={editedFileContent}
                          onChange={(e) => setEditedFileContent(e.target.value)}
                          className="w-full h-full bg-transparent resize-none outline-none font-mono text-xs leading-relaxed"
                          style={{ color: 'var(--code-text)' }}
                          spellCheck={false}
                        />
                      ) : (
                        <pre className="whitespace-pre-wrap">{fileContent}</pre>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-xs p-4 text-center" style={{ color: 'var(--muted)' }}>
                    Sélectionnez un fichier pour prévisualiser ou éditer son contenu.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ARTIFACTS TAB */}
        {activeTab === 'artifacts' && (
          <div className="flex h-full flex-col">
            <div
              className="flex items-center justify-between px-3 py-2 border-b text-xs shrink-0"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)',
              }}
            >
              <span>Artifacts ({artifacts.length})</span>
              <button
                onClick={loadArtifactsList}
                disabled={loadingArtifacts}
                className="p-1 rounded transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                style={{ color: 'var(--muted)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingArtifacts ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="flex-1 flex min-h-0">
              {/* Artifacts List */}
              <div
                className="w-48 border-r overflow-y-auto p-2 space-y-1"
                style={{
                  backgroundColor: 'var(--sidebar)',
                  borderColor: 'var(--border)',
                }}
              >
                {artifacts.length === 0 ? (
                  <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>Aucun artifact</div>
                ) : (
                  artifacts.map((art) => {
                    const isSelected = selectedArtifact?.filename === art.filename;
                    return (
                      <button
                        key={art.filename}
                        onClick={() => handleSelectArtifact(art)}
                        className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors cursor-pointer truncate border ${
                          isSelected
                            ? 'font-medium shadow-xs'
                            : 'border-transparent hover:bg-black/5 dark:hover:bg-white/5'
                        }`}
                        style={{
                          backgroundColor: isSelected ? 'var(--accent-bg)' : 'transparent',
                          borderColor: isSelected ? 'var(--accent)' : 'transparent',
                          color: isSelected ? 'var(--strong)' : 'var(--text)',
                        }}
                      >
                        <div className="font-medium truncate">{art.filename}</div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>{(art.size / 1024).toFixed(1)} KB</div>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Artifact Markdown / Mermaid Viewer */}
              <div
                className="flex-1 overflow-y-auto p-4 max-w-none text-xs"
                style={{
                  backgroundColor: 'var(--surface)',
                  color: 'var(--text)',
                }}
              >
                {selectedArtifact ? (
                  <div className="space-y-4">
                    <div className="border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                      <h2 className="text-base font-bold mb-1" style={{ color: 'var(--strong)' }}>{selectedArtifact.filename}</h2>
                      <p className="text-xs font-mono" style={{ color: 'var(--muted)' }}>{selectedArtifact.relative_path}</p>
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
                      <pre className="whitespace-pre-wrap font-sans" style={{ color: 'var(--text)' }}>
                        {artifactMarkdown}
                      </pre>
                    )}
                  </div>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
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
