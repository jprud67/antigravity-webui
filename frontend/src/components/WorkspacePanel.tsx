import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
  Check,
  Eye,
  Code,
  Download
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { TerminalTab } from './TerminalTab';
import { GitTab } from './GitTab';
import { KanbanTab } from './KanbanTab';
import { MermaidRenderer } from './MermaidRenderer';
import { DiffViewer } from './DiffViewer';
import { fetchFileTree, fetchFileContent, saveFileContent, fetchArtifacts, fetchArtifactContent, fetchGitStatus, type GitStatusResult, getAuthToken, triggerFileDownload } from '../services/api';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
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

export const WorkspacePanel: React.FC<WorkspacePanelProps> = React.memo(({
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
  const selectedArtifactRef = useRef<ArtifactItem | null>(null);
  useEffect(() => {
    selectedArtifactRef.current = selectedArtifact;
  }, [selectedArtifact]);

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

  // Unsaved changes guard
  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    if (isEditingFile && editedFileContent !== fileContent) {
      return await showConfirm('Vous avez des modifications non enregistrées. Voulez-vous continuer sans sauvegarder ?', {
        title: 'Modifications non enregistrées',
        confirmLabel: 'Abandonner les modifications',
        cancelLabel: 'Continuer l\'édition',
        destructive: true
      });
    }
    return true;
  }, [isEditingFile, editedFileContent, fileContent]);

  const handleClose = useCallback(async () => {
    if (await checkUnsavedChanges()) {
      onClose();
    }
  }, [checkUnsavedChanges, onClose]);

  const handleTabClick = useCallback(async (tab: RightPanelTab) => {
    if (await checkUnsavedChanges()) {
      onTabChange(tab);
    }
  }, [checkUnsavedChanges, onTabChange]);

  const BINARY_EXTENSIONS = useMemo(() => new Set([
    'docx', 'doc', 'pdf', 'zip', 'tar', 'gz', 'tgz', '7z', 'rar',
    'xlsx', 'xls', 'pptx', 'ppt', 'bin', 'exe', 'iso', 'odt', 'ods', 'odp'
  ]), []);

  const isBinaryFile = useCallback((p?: string | null) => {
    if (!p) return false;
    const ext = p.split('.').pop()?.toLowerCase() || '';
    return BINARY_EXTENSIONS.has(ext);
  }, [BINARY_EXTENSIONS]);

  const handleSelectFile = useCallback(async (path: string) => {
    if (!(await checkUnsavedChanges())) return;
    setSelectedFilePath(path);
    setIsEditingFile(false);
    setSaveSuccess(false);

    if (isBinaryFile(path)) {
      setFileContent('');
      setEditedFileContent('');
      setLoadingContent(false);
      return;
    }

    setLoadingContent(true);
    try {
      const res = await fetchFileContent(path);
      setFileContent(res.content);
      setEditedFileContent(res.content);
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (msg.toLowerCase().includes('volumineux') || msg.includes('2 Mo') || msg.toLowerCase().includes('large')) {
        setFileContent('⚠️ Ce fichier dépasse la limite de 2 Mo pour l\'éditeur intégré.\nVeuillez utiliser le bouton « Télécharger » ci-dessus pour le consulter ou le manipuler sur votre machine.');
      } else {
        setFileContent(`Erreur lors du chargement du fichier : ${msg || 'Erreur inconnue'}`);
      }
      setEditedFileContent('');
    } finally {
      setLoadingContent(false);
    }
  }, [checkUnsavedChanges, isBinaryFile]);

  const handleDownloadCurrentFile = useCallback(async () => {
    if (!selectedFilePath) return;
    try {
      const token = getAuthToken();
      const downloadUrl = `/api/files/download?path=${encodeURIComponent(selectedFilePath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      const res = await fetch(downloadUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`Erreur ${res.status}`);
      const blob = await res.blob();
      const filename = selectedFilePath.split(/[/\\]/).pop() || 'fichier';
      triggerFileDownload(blob, filename);
      showToast(`Téléchargement de « ${filename} » terminé`, 'success');
    } catch {
      showToast('Erreur lors du téléchargement du fichier.', 'error');
    }
  }, [selectedFilePath]);

  const handleSaveFile = useCallback(async () => {
    if (!selectedFilePath) return;
    setSavingFile(true);
    try {
      await saveFileContent(selectedFilePath, editedFileContent);
      setFileContent(editedFileContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } catch {
      showToast('Erreur lors de la sauvegarde du fichier.', 'error');
    } finally {
      setSavingFile(false);
    }
  }, [selectedFilePath, editedFileContent]);

  const handleSelectArtifact = useCallback(async (art: ArtifactItem) => {
    setSelectedArtifact(art);
    try {
      const content = await fetchArtifactContent(art.conversation_id, art.relative_path || art.filename);
      setArtifactMarkdown(content);
    } catch {
      setArtifactMarkdown('Impossible de charger le contenu de cet artifact.');
    }
  }, []);

  // Load file tree when files tab is active
  const loadTree = useCallback(async () => {
    setLoadingTree(true);
    try {
      const data = await fetchFileTree(currentWorkspace, 3);
      setFileTree(data);
    } catch (e) {
      console.error('Failed to load file tree', e);
    } finally {
      setLoadingTree(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'files') return;
    let active = true;
    fetchFileTree(currentWorkspace, 3)
      .then((data) => {
        if (active) {
          setFileTree(data);
          setLoadingTree(false);
        }
      })
      .catch((e) => {
        console.error('Failed to load file tree', e);
        if (active) setLoadingTree(false);
      });
    return () => { active = false; };
  }, [isOpen, activeTab, currentWorkspace]);

  // Load artifacts when artifacts tab is active
  const loadArtifactsList = useCallback(async () => {
    setLoadingArtifacts(true);
    try {
      const items = await fetchArtifacts(conversationId);
      setArtifacts(items);
      if (items.length > 0 && !selectedArtifactRef.current) {
        handleSelectArtifact(items[0]);
      }
    } catch (e) {
      console.error('Failed to load artifacts', e);
    } finally {
      setLoadingArtifacts(false);
    }
  }, [conversationId, handleSelectArtifact]);

  useEffect(() => {
    if (!isOpen || activeTab !== 'artifacts') return;
    let active = true;
    fetchArtifacts(conversationId)
      .then((items) => {
        if (active) {
          setArtifacts(items);
          setLoadingArtifacts(false);
          if (items.length > 0 && !selectedArtifactRef.current) {
            handleSelectArtifact(items[0]);
          }
        }
      })
      .catch((e) => {
        console.error('Failed to load artifacts', e);
        if (active) setLoadingArtifacts(false);
      });
    return () => { active = false; };
  }, [isOpen, activeTab, conversationId, handleSelectArtifact]);

  // Git status & preview mode state
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(true);

  // Load git status
  useEffect(() => {
    if (isOpen) {
      fetchGitStatus(currentWorkspace)
        .then(setGitStatus)
        .catch(() => setGitStatus(null));
    }
  }, [isOpen, currentWorkspace]);

  useEffect(() => {
    const handleOpenFile = (e: any) => {
      const path = e.detail?.path;
      if (path) {
        handleSelectFile(path);
      }
    };
    window.addEventListener('open-workspace-file', handleOpenFile);
    return () => window.removeEventListener('open-workspace-file', handleOpenFile);
  }, [handleSelectFile]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };



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
    <>
      {/* Mobile Backdrop Overlay (< md) */}
      {isOpen && (
        <div
          onClick={onClose}
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-xs animate-fadeIn"
        />
      )}

      <aside
        style={{
          width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : `${panelWidth}px`,
          maxWidth: typeof window !== 'undefined' && window.innerWidth < 768 ? '100vw' : '55vw',
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
          display: isOpen ? 'flex' : 'none',
        }}
        className="fixed inset-y-0 right-0 z-50 w-full sm:w-[460px] border-l shadow-2xl flex-col select-none md:relative md:inset-auto md:z-20 md:shadow-none md:shrink-0 transition-all duration-75"
        aria-hidden={!isOpen}
      >
        {/* Left Resize Drag Bar - Desktop Only */}
        <div
          onMouseDown={handleMouseDown}
          className="hidden md:flex absolute top-0 left-0 bottom-0 w-1.5 hover:w-2 hover:bg-sky-500/60 transition-all cursor-col-resize z-50 group items-center justify-center -ml-0.5"
        >
          <div className="h-8 w-0.5 bg-slate-400 dark:bg-slate-600 group-hover:bg-sky-400 rounded-full" />
        </div>

      {/* Panel Master Header */}
      <div
        className="flex items-center justify-between px-3 py-2.5 border-b shrink-0 transition-colors safe-pt gap-1"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Horizontally Scrollable Tab Buttons */}
        <div
          className="flex items-center gap-1 p-0.5 rounded-xl border overflow-x-auto no-scrollbar touch-scroll min-w-0 flex-1"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <button
            onClick={() => handleTabClick('files')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'files'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Fichiers</span>
          </button>

          <button
            onClick={() => handleTabClick('artifacts')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'artifacts'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Artifacts</span>
          </button>

          <button
            onClick={() => handleTabClick('terminal')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'terminal'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
          >
            <TerminalIcon className="w-3.5 h-3.5" />
            <span>Terminal</span>
          </button>

          <button
            onClick={() => handleTabClick('git')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'git'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
          >
            <GitBranch className="w-3.5 h-3.5" />
            <span>Git</span>
          </button>

          <button
            onClick={() => handleTabClick('kanban')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'kanban'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
          >
            <KanbanIcon className="w-3.5 h-3.5" />
            <span>Kanban</span>
          </button>
        </div>

        {/* Header Right Actions: Git Badge & Close */}
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          {gitStatus && gitStatus.is_repo && (
            <div
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono border select-none"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title={`Branche git active : ${gitStatus.branch}`}
            >
              <GitBranch className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="font-semibold truncate max-w-[90px]">{gitStatus.branch}</span>
              {!gitStatus.clean && (
                <span className="text-amber-500 font-bold">
                  ({(gitStatus.modified?.length || 0) + (gitStatus.untracked?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.deleted?.length || 0) + (gitStatus.conflicts?.length || 0)})
                </span>
              )}
            </div>
          )}

          <button
            onClick={handleClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
            title="Fermer le volet latéral"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
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
                      {/* Clickable Breadcrumb */}
                      <div className="flex items-center gap-1 font-mono text-[11px] truncate flex-1 mr-2" style={{ color: 'var(--muted)' }}>
                        {selectedFilePath.split('/').filter(Boolean).map((part, idx, arr) => (
                          <React.Fragment key={idx}>
                            <span
                              className={idx === arr.length - 1 ? 'font-semibold' : 'opacity-70'}
                              style={{ color: idx === arr.length - 1 ? 'var(--strong)' : undefined }}
                            >
                              {part}
                            </span>
                            {idx < arr.length - 1 && <span className="opacity-40">/</span>}
                          </React.Fragment>
                        ))}
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
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
                          type="button"
                          onClick={handleDownloadCurrentFile}
                          className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border hover:opacity-90"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                          title="Télécharger le fichier sur votre appareil"
                        >
                          <Download className="w-2.5 h-2.5" />
                          <span>Télécharger</span>
                        </button>
                        {selectedFilePath.endsWith('.md') && !isEditingFile && (
                          <button
                            type="button"
                            onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border"
                            style={{
                              backgroundColor: showMarkdownPreview ? 'var(--accent-bg)' : 'var(--surface)',
                              borderColor: showMarkdownPreview ? 'var(--accent)' : 'var(--border)',
                              color: showMarkdownPreview ? 'var(--accent)' : 'var(--text)',
                            }}
                            title="Basculer aperçu Markdown"
                          >
                            {showMarkdownPreview ? <Code className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                            <span>{showMarkdownPreview ? 'Source' : 'Aperçu'}</span>
                          </button>
                        )}
                        {!isBinaryFile(selectedFilePath) && (
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
                        )}
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
                      ) : selectedFilePath.match(/\.(png|jpe?g|gif|svg|webp)$/i) ? (
                        <div className="flex-1 flex items-center justify-center p-4">
                          <img
                            src={`/api/files/download?path=${encodeURIComponent(selectedFilePath)}${getAuthToken() ? `&token=${encodeURIComponent(getAuthToken()!)}` : ''}`}
                            alt={selectedFilePath.split('/').pop()}
                            className="max-w-full max-h-full object-contain rounded-lg shadow-sm border"
                            style={{ borderColor: 'var(--border)' }}
                          />
                        </div>
                      ) : isBinaryFile(selectedFilePath) ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center border shadow-sm" style={{ backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent)' }}>
                            <FileText className="w-7 h-7" style={{ color: 'var(--accent)' }} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--strong)' }}>
                              {selectedFilePath.split(/[/\\]/).pop()}
                            </h4>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>
                              Fichier binaire (document bureautique ou archive).
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleDownloadCurrentFile}
                            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold shadow-sm transition-all hover:scale-105 cursor-pointer mt-2"
                            style={{
                              backgroundColor: 'var(--accent)',
                              color: '#fff',
                            }}
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Télécharger le fichier</span>
                          </button>
                        </div>
                      ) : selectedFilePath.endsWith('.md') && showMarkdownPreview ? (
                        <div className="p-3 prose dark:prose-invert max-w-none text-xs leading-relaxed overflow-y-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {fileContent || ''}
                          </ReactMarkdown>
                        </div>
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
                    {/* Render Artifact with full Markdown & Diagram support */}
                    {selectedArtifact.filename.endsWith('.md') ? (
                      <div className="markdown-content max-w-none text-xs leading-relaxed" style={{ color: 'var(--text)' }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code: ({ inline, className, children, ...props }: any) => {
                              const match = /language-(\w+)/.exec(className || '');
                              const language = match ? match[1] : '';
                              const codeContent = String(children).replace(/\n$/, '');
                              if (!inline) {
                                if (language === 'mermaid') {
                                  return <MermaidRenderer chart={codeContent} />;
                                }
                                if (language === 'diff') {
                                  return <DiffViewer diffText={codeContent} />;
                                }
                                return (
                                  <pre className="p-3 my-2 rounded-xl overflow-x-auto text-[11px] font-mono border" style={{ backgroundColor: 'var(--code-bg)', borderColor: 'var(--border)' }}>
                                    <code>{children}</code>
                                  </pre>
                                );
                              }
                              return (
                                <code className="px-1.5 py-0.5 rounded text-[11px] font-mono border" style={{ backgroundColor: 'var(--code-inline-bg)', borderColor: 'var(--border-subtle)', color: 'var(--code-text)' }} {...props}>
                                  {children}
                                </code>
                              );
                            }
                          }}
                        >
                          {artifactMarkdown}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="whitespace-pre-wrap font-mono p-3 rounded-xl border text-xs" style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)', color: 'var(--text)' }}>
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
    </>
  );
});
