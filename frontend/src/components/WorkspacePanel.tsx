import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  X, 
  FolderTree, 
  FileText, 
  Terminal as TerminalIcon, 
  GitBranch, 
  ChevronRight, 
  ChevronLeft,
  ChevronDown,
RefreshCw, 
  Plus,
  Kanban as KanbanIcon,
  Edit2,
  Save,
  Check,
  Eye,
  Code,
  Code2,
  Download,
  FilePlus,
  FolderPlus,
  Trash2,
  Search,
  WrapText,
  Columns,
  Sparkles,
Loader2,
  Play,
  Upload,
  Copy,
  RotateCcw,
  SplitSquareVertical,
  SlidersHorizontal,
  ChevronUp,
  Layers,
  Clock,
  ShieldCheck,
  Globe,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  Info,
} from 'lucide-react';
import { FileIcon } from './FileIcon';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Editor from '@monaco-editor/react';
import { TerminalTab } from './TerminalTab';
import { MermaidRenderer } from './MermaidRenderer';
import { DiffViewer } from './DiffViewer';
import { WorkspaceSearchPanel } from './WorkspaceSearchPanel';
import { registerMonacoCopilot, isCopilotEnabled, setCopilotEnabled } from '../services/copilot';
import { CopilotActionModal } from './CopilotActionModal';

const GitTab = React.lazy(() => import('./GitTab').then(m => ({ default: m.GitTab })));
const KanbanTab = React.lazy(() => import('./KanbanTab').then(m => ({ default: m.KanbanTab })));
import { 
  fetchFileTree, 
  fetchFileContent, 
  saveFileContent, 
  createFile, 
  createDirectory, 
  renameFile, 
  deleteFile, 
  fetchArtifacts, 
  fetchArtifactContent, 
  fetchGitStatus, 
  type GitStatusResult, 
  getAuthToken, 
  triggerFileDownload,
  uploadWorkspaceFile,
  duplicateWorkspaceFile,
  fetchGitDiffRanges,
  getExportHtmlUrl,
  getExportMarkdownUrl,
  getExportJsonUrl,
  fetchEditorDiagnostics
} from '../services/api';
import { detectLanguage, getInitialMonacoTheme } from '../utils/editorUtils';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';
import {
  getMonacoMultiCursorOptions,
  setupMultiCursor,
  applyGitDecorations,
  navigateGitDiff
} from '../services/monacoAnnotations';
import { applyMonacoDiagnostics, clearMonacoDiagnostics } from '../services/monacoDiagnostics';
import type { ArtifactItem, MonacoStudioConfig, GitDiffRange, GitDiffSummary, DiagnosticItem } from '../types';

export type RightPanelTab = 'files' | 'search' | 'artifacts' | 'terminal' | 'git' | 'kanban';

export interface EditorTabItem {
  path: string;
  name: string;
  content: string;
  originalContent: string;
  isDirty: boolean;
  language: string;
  size?: number;
  isBinary?: boolean;
}

function filterTreeItems(items: any[], query: string): any[] {
  if (!query.trim()) return items;
  const lower = query.toLowerCase();
  return items.reduce<any[]>((acc, item) => {
    const match = item.name.toLowerCase().includes(lower);
    if (item.is_dir && item.children) {
      const matchingKids = filterTreeItems(item.children, query);
      if (match || matchingKids.length > 0) {
        acc.push({ ...item, children: matchingKids });
      }
    } else if (match) {
      acc.push(item);
    }
    return acc;
  }, []);
}

export interface WorkspacePanelProps {
  isOpen: boolean;
  onClose: () => void;
  activeTab: RightPanelTab;
  onTabChange: (tab: RightPanelTab) => void;
  currentWorkspace: string;
  conversationId?: string;
  onInsertPath?: (path: string) => void;
  onExecutePrompt?: (prompt: string) => void;
  initialFilePath?: string | null;
  onClearInitialFilePath?: () => void;
  initialSearchQuery?: string;
  initialSearchMode?: 'find' | 'replace';
  agentActivityTimestamp?: number;
  onGitStatusChanged?: (status: GitStatusResult | null) => void;
  onArtifactsCountChanged?: (count: number) => void;
  onOpenMonacoStudio?: (config: MonacoStudioConfig) => void;
  onOpenCrons?: () => void;
  onOpenRules?: () => void;
  onOpenAnalytics?: () => void;
  onOpenBranchTree?: () => void;
  onToggleChatSearch?: () => void;
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
  initialFilePath,
  onClearInitialFilePath,
  initialSearchQuery,
  initialSearchMode,
  agentActivityTimestamp,
  onGitStatusChanged,
  onArtifactsCountChanged,
  onOpenMonacoStudio,
  onOpenCrons,
  onOpenRules,
  onOpenAnalytics: _onOpenAnalytics,
  onOpenBranchTree,
  onToggleChatSearch: _onToggleChatSearch,
}) => {
  const { t } = useI18n();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [panelWidth, setPanelWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('antigravity_aux_panel_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 360 && parsed <= 1200) return parsed;
      }
    } catch {}
    return 600;
  });
  const isResizingRef = useRef(false);

  // Horizontal Header Scroll State & Handlers
  const headerScrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const updateScrollButtons = useCallback(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 4);
  }, []);

  useEffect(() => {
    const el = headerScrollRef.current;
    if (!el) return;
    updateScrollButtons();
    el.addEventListener('scroll', updateScrollButtons, { passive: true });
    window.addEventListener('resize', updateScrollButtons);
    const timer = setTimeout(updateScrollButtons, 300);
    return () => {
      el.removeEventListener('scroll', updateScrollButtons);
      window.removeEventListener('resize', updateScrollButtons);
      clearTimeout(timer);
    };
  }, [updateScrollButtons, isOpen, panelWidth]);

  const handleHeaderScroll = (direction: 'left' | 'right') => {
    if (headerScrollRef.current) {
      const delta = direction === 'left' ? -200 : 200;
      headerScrollRef.current.scrollBy({ left: delta, behavior: 'smooth' });
    }
  };

  // Files Tab State
  const [fileTree, setFileTree] = useState<any>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [treeSearch, setTreeSearch] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Multi-Tabs State
  const [openTabs, setOpenTabs] = useState<EditorTabItem[]>([]);
  const [activeTabIndex, setActiveTabIndex] = useState<number>(-1);
  const [loadingContent, setLoadingContent] = useState(false);
  const [savingFile, setSavingFile] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Monaco Editor Options in Panel
  const [isWordWrap, setIsWordWrap] = useState(true);
  const [isMinimap, setIsMinimap] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [monacoTheme, setMonacoTheme] = useState<'vs-dark' | 'light'>(getInitialMonacoTheme);
  const monacoEditorRef = useRef<any>(null);
  const monacoInstanceRef = useRef<any>(null);

  // Monaco Multi-Cursor & Git Diff Annotations State
  const [cursorCount, setCursorCount] = useState<number>(1);
  const [diffRanges, setDiffRanges] = useState<GitDiffRange[]>([]);
  const [diffSummary, setDiffSummary] = useState<GitDiffSummary | null>(null);
  const gitDecorationsRef = useRef<string[]>([]);
  const multiCursorControllerRef = useRef<any>(null);
  const diffRangesRef = useRef<GitDiffRange[]>([]);

  useEffect(() => {
    diffRangesRef.current = diffRanges;
  }, [diffRanges]);

  // Monaco Copilot State
  const [copilotActive, setCopilotActive] = useState<boolean>(isCopilotEnabled());
  const [isCopilotActionOpen, setIsCopilotActionOpen] = useState<boolean>(false);
  const [copilotStatus, setCopilotStatus] = useState<'idle' | 'generating' | 'suggested' | 'disabled'>('idle');

  // Creation & Renaming State
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamedName, setRenamedName] = useState('');

  // Upload & Drag-and-Drop State
  const [isDraggingOverTree, setIsDraggingOverTree] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Tab Context Menu State
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabIndex: number } | null>(null);

  useEffect(() => {
    if (!tabContextMenu) return;
    const handleCloseMenu = () => setTabContextMenu(null);
    window.addEventListener('click', handleCloseMenu);
    return () => window.removeEventListener('click', handleCloseMenu);
  }, [tabContextMenu]);

  // Sync Monaco Theme
  useEffect(() => {
    const handleThemeChange = () => setMonacoTheme(getInitialMonacoTheme());
    window.addEventListener('antigravity-appearance-change', handleThemeChange);
    return () => window.removeEventListener('antigravity-appearance-change', handleThemeChange);
  }, []);

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
      if (newWidth >= 360 && newWidth <= Math.min(1100, window.innerWidth - 300)) {
        setPanelWidth(newWidth);
        try {
          localStorage.setItem('antigravity_aux_panel_width', String(newWidth));
        } catch {}
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

  const activeTabItem = activeTabIndex >= 0 && activeTabIndex < openTabs.length ? openTabs[activeTabIndex] : null;
  const selectedFilePath = activeTabItem ? activeTabItem.path : null;

  // Unsaved changes guard
  const checkUnsavedChanges = useCallback(async (): Promise<boolean> => {
    const dirtyTabs = openTabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
      return await showConfirm(
        t('unsaved_changes_message', 'Des fichiers comportent des modifications non enregistrées. Voulez-vous continuer sans sauvegarder ?'), 
        {
          title: t('unsaved_changes_title', 'Modifications non enregistrées'),
          confirmLabel: t('discard_changes', 'Abandonner'),
          cancelLabel: t('continue_editing', 'Continuer l\'édition'),
          destructive: true
        }
      );
    }
    return true;
  }, [openTabs, t]);

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

  // Integrated Terminal Split View State
  const [isTerminalSplitOpen, setIsTerminalSplitOpen] = useState(false);
  const [terminalSplitHeight, setTerminalSplitHeight] = useState(260);
  const isDraggingSplitRef = useRef(false);
  const startDragYRef = useRef(0);
  const startHeightRef = useRef(260);

  const handleSplitResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingSplitRef.current = true;
    startDragYRef.current = e.clientY;
    startHeightRef.current = terminalSplitHeight;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingSplitRef.current) return;
      const deltaY = startDragYRef.current - moveEvent.clientY;
      const newHeight = Math.max(140, Math.min(650, startHeightRef.current + deltaY));
      setTerminalSplitHeight(newHeight);
    };

    const handleMouseUp = () => {
      isDraggingSplitRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.dispatchEvent(new Event('resize'));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [terminalSplitHeight]);

  // Global Ctrl+` shortcut to toggle split terminal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault();
        setIsTerminalSplitOpen(prev => {
          const next = !prev;
          setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const activeFileFolder = useMemo(() => {
    if (!selectedFilePath) return currentWorkspace;
    const normalized = selectedFilePath.replace(/\\/g, '/');
    const idx = normalized.lastIndexOf('/');
    return idx !== -1 ? normalized.slice(0, idx) : currentWorkspace;
  }, [selectedFilePath, currentWorkspace]);

  const isExecutableFile = useMemo(() => {
    if (!selectedFilePath) return false;
    return /\.(py|js|ts|sh|bash|ps1|bat|cmd)$/i.test(selectedFilePath);
  }, [selectedFilePath]);

  const handleRunInTerminal = useCallback(() => {
    if (!selectedFilePath) return;
    if (!isTerminalSplitOpen) {
      setIsTerminalSplitOpen(true);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }

    const ext = selectedFilePath.split('.').pop()?.toLowerCase();
    const filePath = `"${selectedFilePath}"`;
    let cmd = filePath;

    switch (ext) {
      case 'py':
        cmd = `python ${filePath}`;
        break;
      case 'js':
        cmd = `node ${filePath}`;
        break;
      case 'ts':
        cmd = `npx tsx ${filePath}`;
        break;
      case 'sh':
      case 'bash':
        cmd = `bash ${filePath}`;
        break;
      case 'ps1':
        cmd = `powershell -ExecutionPolicy Bypass -File ${filePath}`;
        break;
    }

    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('terminal-run-command', {
          detail: { command: cmd }
        })
      );
      showToast(t('execution_cmd_toast', 'Exécution : {0}', cmd), 'info');
    }, 150);
  }, [selectedFilePath, isTerminalSplitOpen, t]);

  const handleCdToActiveFolder = useCallback(() => {
    if (!activeFileFolder) return;
    if (!isTerminalSplitOpen) {
      setIsTerminalSplitOpen(true);
      setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    }
    setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('terminal-run-command', {
          detail: { command: `cd "${activeFileFolder}"` }
        })
      );
      showToast(t('terminal_cd_folder', 'cd "{0}"', activeFileFolder), 'info');
    }, 150);
  }, [activeFileFolder, isTerminalSplitOpen, t]);

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
    const existingIdx = openTabs.findIndex(t => t.path === path);
    if (existingIdx !== -1) {
      setActiveTabIndex(existingIdx);
      return;
    }

    const filename = path.split(/[/\\]/).pop() || 'file';

    if (isBinaryFile(path)) {
      const newTab: EditorTabItem = {
        path,
        name: filename,
        content: '',
        originalContent: '',
        isDirty: false,
        language: 'plaintext',
        isBinary: true,
      };
      setOpenTabs(prev => [...prev, newTab]);
      setActiveTabIndex(openTabs.length);
      return;
    }

    setLoadingContent(true);
    try {
      const res = await fetchFileContent(path, currentWorkspace);
      const newTab: EditorTabItem = {
        path,
        name: filename,
        content: res.content,
        originalContent: res.content,
        isDirty: false,
        language: detectLanguage(path),
        size: res.size,
        isBinary: false,
      };
      setOpenTabs(prev => {
        const found = prev.findIndex(t => t.path === path);
        if (found !== -1) return prev;
        return [...prev, newTab];
      });
      setActiveTabIndex(openTabs.length);
    } catch (err: any) {
      const msg = String(err?.message || '');
      showToast(`${t('error', 'Erreur')}: ${msg || t('error', 'Erreur de chargement')}`, 'error');
    } finally {
      setLoadingContent(false);
    }
  }, [openTabs, currentWorkspace, isBinaryFile, t]);

  const handleCloseTab = useCallback(async (indexToClose: number, e?: React.MouseEvent) => {
    e?.stopPropagation();
    const tabToClose = openTabs[indexToClose];
    if (!tabToClose) return;

    if (tabToClose.isDirty) {
      const discard = await showConfirm(
        t('unsaved_changes_confirm', 'Le fichier « {0} » a des modifications non enregistrées. Fermer quand même ?', tabToClose.name),
        {
          title: t('unsaved_changes', 'Modifications non enregistrées'),
          confirmLabel: t('close_without_saving', 'Fermer sans enregistrer'),
          cancelLabel: t('cancel', 'Annuler'),
          destructive: true
        }
      );
      if (!discard) return;
    }

    setOpenTabs(prev => prev.filter((_, i) => i !== indexToClose));
    setActiveTabIndex(prev => {
      if (prev > indexToClose) return prev - 1;
      if (prev === indexToClose) return Math.max(0, openTabs.length - 2);
      return prev;
    });
  }, [openTabs, t]);

  const handleCloseOtherTabs = useCallback(async (keepIndex: number) => {
    const otherTabs = openTabs.filter((_, i) => i !== keepIndex);
    const dirtyOthers = otherTabs.filter(t => t.isDirty);
    if (dirtyOthers.length > 0) {
      const discard = await showConfirm(
        t('close_other_tabs_confirm', 'Certains onglets comportent des modifications non enregistrées. Fermer les autres onglets quand même ?'),
        {
          title: t('close_other_tabs', 'Fermer les autres onglets'),
          confirmLabel: t('close_without_saving', 'Fermer sans enregistrer'),
          cancelLabel: t('cancel', 'Annuler'),
          destructive: true
        }
      );
      if (!discard) return;
    }
    const kept = openTabs[keepIndex];
    if (kept) {
      setOpenTabs([kept]);
      setActiveTabIndex(0);
    }
    setTabContextMenu(null);
  }, [openTabs, t]);

  const handleCloseTabsToRight = useCallback(async (fromIndex: number) => {
    const rightTabs = openTabs.filter((_, i) => i > fromIndex);
    const dirtyRight = rightTabs.filter(t => t.isDirty);
    if (dirtyRight.length > 0) {
      const discard = await showConfirm(
        t('close_tabs_right_confirm', 'Certains onglets à droite comportent des modifications non enregistrées. Les fermer quand même ?'),
        {
          title: t('close_tabs_to_right', 'Fermer les onglets à droite'),
          confirmLabel: t('close_without_saving', 'Fermer sans enregistrer'),
          cancelLabel: t('cancel', 'Annuler'),
          destructive: true
        }
      );
      if (!discard) return;
    }
    setOpenTabs(prev => prev.slice(0, fromIndex + 1));
    setActiveTabIndex(prev => Math.min(prev, fromIndex));
    setTabContextMenu(null);
  }, [openTabs, t]);

  const handleCloseSavedTabs = useCallback(() => {
    const dirtyOnly = openTabs.filter(t => t.isDirty);
    setOpenTabs(dirtyOnly);
    setActiveTabIndex(dirtyOnly.length > 0 ? 0 : -1);
    setTabContextMenu(null);
  }, [openTabs]);

  const handleCloseAllTabs = useCallback(async () => {
    const dirtyTabs = openTabs.filter(t => t.isDirty);
    if (dirtyTabs.length > 0) {
      const discard = await showConfirm(
        t('close_all_tabs_confirm', 'Plusieurs onglets comportent des modifications non enregistrées. Tout fermer quand même ?'),
        {
          title: t('close_all', 'Tout fermer'),
          confirmLabel: t('close_without_saving', 'Fermer sans enregistrer'),
          cancelLabel: t('cancel', 'Annuler'),
          destructive: true
        }
      );
      if (!discard) return;
    }
    setOpenTabs([]);
    setActiveTabIndex(-1);
    setTabContextMenu(null);
  }, [openTabs, t]);

  const handleRevertActiveTab = useCallback(async () => {
    if (!activeTabItem || !activeTabItem.isDirty) return;
    const confirmed = await showConfirm(
      t('revert_tab_confirm', 'Voulez-vous annuler toutes les modifications non enregistrées pour « {0} » et rétablir le contenu du disque ?', activeTabItem.name),
      {
        title: t('revert_changes', 'Annuler les modifications'),
        confirmLabel: t('revert_to_disk', 'Rétablir la version disque'),
        cancelLabel: t('continue_editing', 'Continuer l\'édition'),
        destructive: true
      }
    );
    if (!confirmed) return;
    setOpenTabs(prev => {
      const updated = [...prev];
      if (updated[activeTabIndex]) {
        updated[activeTabIndex] = {
          ...updated[activeTabIndex],
          content: updated[activeTabIndex].originalContent,
          isDirty: false
        };
      }
      return updated;
    });
    showToast(t('changes_reverted', 'Modifications annulées'), 'info');
  }, [activeTabItem, activeTabIndex, t]);

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

  const handleUploadFiles = useCallback(async (files: FileList | File[], targetFolder?: string) => {
    if (!files || files.length === 0) return;
    const fileArray = Array.from(files);
    const destination = targetFolder || creatingParent || currentWorkspace;
    let successCount = 0;
    let lastUploadedPath = '';

    for (const file of fileArray) {
      try {
        const res = await uploadWorkspaceFile(file, destination, currentWorkspace);
        if (res.success) {
          successCount++;
          lastUploadedPath = res.path;
        }
      } catch (err: any) {
        showToast(t('import_error_for_file', "Erreur d'import pour {0} : {1}", file.name, err.message), 'error');
      }
    }

    if (successCount > 0) {
      showToast(t('files_imported_count_success', '{0} fichier(s) importé(s) avec succès.', successCount), 'success');
      await loadTree();
      if (lastUploadedPath) {
        handleSelectFile(lastUploadedPath);
      }
    }
  }, [creatingParent, currentWorkspace, loadTree, handleSelectFile, t]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files);
      e.target.value = '';
    }
  };

  const handleDuplicateFile = useCallback(async (path: string) => {
    try {
      const res = await duplicateWorkspaceFile(path, currentWorkspace);
      showToast(t('file_duplicated_named', 'Fichier dupliqué : {0}', res.new_name), 'success');
      await loadTree();
      handleSelectFile(res.new_path);
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la duplication', 'error');
    }
  }, [currentWorkspace, loadTree, handleSelectFile, t]);

  const handleSelectSearchMatch = useCallback(async (
    filePath: string,
    lineNumber: number,
    column: number,
    matchLength: number
  ) => {
    await handleSelectFile(filePath);
    setTimeout(() => {
      if (monacoEditorRef.current) {
        monacoEditorRef.current.revealPositionInCenter({ lineNumber, column });
        monacoEditorRef.current.setPosition({ lineNumber, column });
        if (matchLength > 0) {
          monacoEditorRef.current.setSelection({
            startLineNumber: lineNumber,
            startColumn: column,
            endLineNumber: lineNumber,
            endColumn: column + matchLength
          });
        }
        monacoEditorRef.current.focus();
      }
    }, 120);
  }, [handleSelectFile]);

  const handlePreviewSearchDiff = useCallback((
    filePath: string,
    originalContent: string,
    modifiedContent: string
  ) => {
    if (onOpenMonacoStudio) {
      onOpenMonacoStudio({
        mode: 'diff',
        filePath,
        originalContent,
        modifiedContent,
        workspace: currentWorkspace,
        readOnly: true
      });
    }
  }, [onOpenMonacoStudio, currentWorkspace]);

  const handleSearchFileModified = useCallback(async (filePath: string) => {
    const tabIndex = openTabs.findIndex(t => t.path === filePath);
    if (tabIndex !== -1) {
      try {
        const res = await fetchFileContent(filePath, currentWorkspace);
        setOpenTabs(prev => prev.map((t, idx) => idx === tabIndex ? {
          ...t,
          content: res.content,
          originalContent: res.content,
          isDirty: false
        } : t));
      } catch {}
    }
    loadTree();
  }, [openTabs, currentWorkspace, loadTree]);

  const handleTabContextMenu = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    e.stopPropagation();
    setTabContextMenu({
      x: e.clientX,
      y: e.clientY,
      tabIndex: index
    });
  };

  const handleEditorChange = useCallback((newVal: string) => {
    if (activeTabIndex < 0 || activeTabIndex >= openTabs.length) return;
    setOpenTabs(prev => {
      const cur = prev[activeTabIndex];
      if (!cur) return prev;
      const updated = [...prev];
      updated[activeTabIndex] = {
        ...cur,
        content: newVal,
        isDirty: newVal !== cur.originalContent,
      };
      return updated;
    });
  }, [activeTabIndex, openTabs.length]);

  const loadGitDiffRanges = useCallback(async (filePath?: string) => {
    const targetPath = filePath || activeTabItem?.path;
    if (!targetPath) return;
    try {
      const res = await fetchGitDiffRanges(targetPath, currentWorkspace);
      setDiffRanges(res.ranges || []);
      setDiffSummary(res.summary || null);
      if (monacoEditorRef.current && monacoInstanceRef.current) {
        gitDecorationsRef.current = applyGitDecorations(
          monacoEditorRef.current,
          monacoInstanceRef.current,
          res.ranges || [],
          gitDecorationsRef.current
        );
      }
    } catch {
      setDiffRanges([]);
      setDiffSummary(null);
      if (monacoEditorRef.current && monacoInstanceRef.current) {
        gitDecorationsRef.current = applyGitDecorations(
          monacoEditorRef.current,
          monacoInstanceRef.current,
          [],
          gitDecorationsRef.current
        );
      }
    }
  }, [activeTabItem?.path, currentWorkspace]);

  const activePath = activeTabItem?.path;
  const isBinaryTab = Boolean(activeTabItem?.isBinary);

  useEffect(() => {
    if (!activePath || isBinaryTab) return;
    let isCancelled = false;
    fetchGitDiffRanges(activePath, currentWorkspace)
      .then((res) => {
        if (!isCancelled) {
          setDiffRanges(res.ranges || []);
          setDiffSummary(res.summary || null);
          if (monacoEditorRef.current && monacoInstanceRef.current) {
            gitDecorationsRef.current = applyGitDecorations(
              monacoEditorRef.current,
              monacoInstanceRef.current,
              res.ranges || [],
              gitDecorationsRef.current
            );
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setDiffRanges([]);
          setDiffSummary(null);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [activePath, isBinaryTab, currentWorkspace]);

  // Live Diagnostics state for active tab in WorkspacePanel
  const [diagnostics, setDiagnostics] = useState<DiagnosticItem[]>([]);
  const [isLinting, setIsLinting] = useState<boolean>(false);
  const [isProblemsOpen, setIsProblemsOpen] = useState<boolean>(false);

  const loadDiagnostics = useCallback(
    async (codeToLint: string, langToLint: string, path?: string) => {
      if (!codeToLint.trim()) {
        setDiagnostics([]);
        if (monacoEditorRef.current && monacoInstanceRef.current) {
          clearMonacoDiagnostics(monacoInstanceRef.current, monacoEditorRef.current.getModel());
        }
        return;
      }
      setIsLinting(true);
      try {
        const res = await fetchEditorDiagnostics({
          content: codeToLint,
          language: langToLint,
          filePath: path,
          workspace: currentWorkspace,
        });
        setDiagnostics(res.diagnostics || []);
        if (monacoEditorRef.current && monacoInstanceRef.current) {
          applyMonacoDiagnostics(
            monacoInstanceRef.current,
            monacoEditorRef.current.getModel(),
            res.diagnostics || []
          );
        }
      } catch {
        // Ignore linting errors gracefully
      } finally {
        setIsLinting(false);
      }
    },
    [currentWorkspace]
  );

  // Tab switch effect: immediately clear and start linting new file
  useEffect(() => {
    if (!activeTabItem || isBinaryTab) {
      setDiagnostics([]);
      if (monacoEditorRef.current && monacoInstanceRef.current) {
        clearMonacoDiagnostics(monacoInstanceRef.current, monacoEditorRef.current.getModel());
      }
      return;
    }
    setDiagnostics([]);
    if (monacoEditorRef.current && monacoInstanceRef.current) {
      clearMonacoDiagnostics(monacoInstanceRef.current, monacoEditorRef.current.getModel());
    }
    loadDiagnostics(activeTabItem.content, activeTabItem.language, activeTabItem.path);
  }, [activeTabItem?.path, isBinaryTab, loadDiagnostics]);

  // Content change debounce effect: re-lint on keystroke without flickering or clearing markers prematurely
  useEffect(() => {
    if (!activeTabItem || isBinaryTab || !activeTabItem.path) return;
    const timer = setTimeout(() => {
      loadDiagnostics(activeTabItem.content, activeTabItem.language, activeTabItem.path);
    }, 450);
    return () => clearTimeout(timer);
  }, [activeTabItem?.content, activeTabItem?.language, isBinaryTab, loadDiagnostics]);

  const handleJumpToProblem = useCallback((item: DiagnosticItem) => {
    if (!monacoEditorRef.current) return;
    const line = item.line || 1;
    const col = item.column || 1;
    monacoEditorRef.current.revealPositionInCenter({ lineNumber: line, column: col });
    monacoEditorRef.current.setPosition({ lineNumber: line, column: col });
    monacoEditorRef.current.focus();
  }, []);

  const totalErrors = useMemo(() => diagnostics.filter((d) => d.severity === 'error').length, [diagnostics]);
  const totalWarnings = useMemo(() => diagnostics.filter((d) => d.severity === 'warning').length, [diagnostics]);



  const handleSaveActiveTab = useCallback(async () => {
    if (!activeTabItem || activeTabItem.isBinary) return;
    setSavingFile(true);
    try {
      await saveFileContent(activeTabItem.path, activeTabItem.content, currentWorkspace);
      loadGitDiffRanges(activeTabItem.path);
      setOpenTabs(prev => {
        const updated = [...prev];
        if (updated[activeTabIndex]) {
          updated[activeTabIndex] = {
            ...updated[activeTabIndex],
            originalContent: activeTabItem.content,
            isDirty: false,
          };
        }
        return updated;
      });
      setSaveSuccess(true);
      showToast(t('editor_file_saved', 'Fichier enregistré avec succès.'), 'success');
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err: any) {
      showToast(err.message || t('error_saving_file', 'Erreur lors de la sauvegarde du fichier.'), 'error');
    } finally {
      setSavingFile(false);
    }
  }, [activeTabItem, activeTabIndex, currentWorkspace, loadGitDiffRanges, t]);


  const handleFormatCode = useCallback(() => {
    if (monacoEditorRef.current) {
      monacoEditorRef.current.getAction('editor.action.formatDocument')?.run();
      showToast(t('document_formatted', 'Document formaté'), 'info');
    }
  }, [t]);
  const handleSelectArtifact = useCallback(async (art: ArtifactItem) => {
    setSelectedArtifact(art);
    try {
      const content = await fetchArtifactContent(art.conversation_id, art.relative_path || art.filename);
      setArtifactMarkdown(content);
    } catch {
      setArtifactMarkdown(t('error_loading_file', 'Unable to load artifact content.'));
    }
  }, [t]);

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

  // Live Artifacts Synchronization
  useEffect(() => {
    let active = true;
    fetchArtifacts(conversationId)
      .then((items) => {
        if (!active) return;
        onArtifactsCountChanged?.(items.length);
        if (isOpen && activeTab === 'artifacts') {
          setArtifacts(items);
          setLoadingArtifacts(false);
          if (items.length > 0 && !selectedArtifactRef.current) {
            handleSelectArtifact(items[0]);
          } else if (selectedArtifactRef.current) {
            // Live refresh active artifact if modified
            const activeArt = selectedArtifactRef.current;
            fetchArtifactContent(activeArt.conversation_id, activeArt.relative_path || activeArt.filename)
              .then((content) => {
                if (active) setArtifactMarkdown(content);
              })
              .catch(() => {});
          }
        }
      })
      .catch((e) => {
        console.error('Failed to load artifacts', e);
        if (active) {
          setLoadingArtifacts(false);
          onArtifactsCountChanged?.(0);
        }
      });
    return () => { active = false; };
  }, [isOpen, activeTab, conversationId, agentActivityTimestamp, handleSelectArtifact, onArtifactsCountChanged]);

  // Git status & preview mode state
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null);
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(true);

  // Live Git Status Synchronization (always tracked for activity bar badge)
  useEffect(() => {
    let active = true;
    fetchGitStatus(currentWorkspace)
      .then((st) => {
        if (active) {
          setGitStatus(st);
          onGitStatusChanged?.(st);
        }
      })
      .catch(() => {
        if (active) {
          setGitStatus(null);
          onGitStatusChanged?.(null);
        }
      });
    return () => { active = false; };
  }, [currentWorkspace, agentActivityTimestamp, onGitStatusChanged]);

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

  useEffect(() => {
    if (initialFilePath && isOpen) {
      queueMicrotask(() => {
        handleSelectFile(initialFilePath);
        onClearInitialFilePath?.();
      });
    }
  }, [initialFilePath, isOpen, handleSelectFile, onClearInitialFilePath]);

  const handleDownloadCurrentFile = useCallback(async () => {
    if (!selectedFilePath) return;
    try {
      const token = getAuthToken();
      const downloadUrl = `/api/files/download?path=${encodeURIComponent(selectedFilePath)}`;
      const res = await fetch(downloadUrl, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const blob = await res.blob();
      const filename = selectedFilePath.split(/[/\\]/).pop() || 'file';
      triggerFileDownload(blob, filename);
      showToast(`${t('download', 'Téléchargement')} « ${filename} » ${t('done', 'terminé')}`, 'success');
    } catch {
      showToast(t('error_downloading_file', 'Erreur lors du téléchargement du fichier.'), 'error');
    }
  }, [selectedFilePath, t]);

  const handleCreateNewItem = useCallback(async () => {
    if (!newItemName.trim() || !creatingType) return;
    const name = newItemName.trim();
    const base = creatingParent || currentWorkspace;
    const targetPath = `${base}/${name}`;

    try {
      if (creatingType === 'file') {
        await createFile(targetPath, '', currentWorkspace);
        showToast(t('file_created_success_named', 'Fichier « {0} » créé avec succès', name), 'success');
        setCreatingType(null);
        setNewItemName('');
        await loadTree();
        handleSelectFile(targetPath);
      } else {
        await createDirectory(targetPath, currentWorkspace);
        showToast(t('folder_created_success_named', 'Dossier « {0} » créé avec succès', name), 'success');
        setCreatingType(null);
        setNewItemName('');
        await loadTree();
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création', 'error');
    }
  }, [newItemName, creatingType, creatingParent, currentWorkspace, loadTree, handleSelectFile, t]);

  const handleRenameItem = useCallback(async () => {
    if (!renamingPath || !renamedName.trim()) return;
    const newName = renamedName.trim();
    const parts = renamingPath.replace(/\\/g, '/').split('/');
    parts.pop();
    const parentDir = parts.join('/');
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    try {
      await renameFile(renamingPath, newPath, currentWorkspace);
      showToast(t('renamed_to_named', 'Renommé en « {0} »', newName), 'success');
      setRenamingPath(null);
      setRenamedName('');
      // Update any open tab with old path
      setOpenTabs(prev => prev.map(t => t.path === renamingPath ? { ...t, path: newPath, name: newName } : t));
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du renommage', 'error');
    }
  }, [renamingPath, renamedName, currentWorkspace, loadTree, t]);

  const handleDeleteItem = useCallback(async (path: string, isDir: boolean, name: string) => {
    const confirmed = await showConfirm(
      t('delete_item_confirm', 'Êtes-vous sûr de vouloir supprimer {0} « {1} » ? Cette action est irréversible.', isDir ? t('the_folder', 'le dossier') : t('the_file', 'le fichier'), name),
      {
        title: t('delete_confirmation_title', 'Confirmation de suppression'),
        confirmLabel: t('delete_permanently', 'Supprimer définitivement'),
        cancelLabel: t('cancel', 'Annuler'),
        destructive: true
      }
    );
    if (!confirmed) return;

    try {
      await deleteFile(path, currentWorkspace);
      showToast(t('item_deleted_named', '« {0} » supprimé', name), 'info');
      // If open in tabs, close it
      setOpenTabs(prev => prev.filter(t => !t.path.startsWith(path)));
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    }
  }, [currentWorkspace, loadTree, t]);

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders((prev) => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };

  // File Tree Recursive Renderer with full actions
  const renderTreeItems = (items: any[], level = 0) => {
    if (!items || items.length === 0) return null;

    return (
      <div className="space-y-0.5">
        {items.map((item: any) => {
          const isDir = item.is_dir;
          const isExpanded = !!expandedFolders[item.path];
          const isSelected = selectedFilePath === item.path;
          const isItemRenaming = renamingPath === item.path;

          if (isItemRenaming) {
            return (
              <div key={item.path} style={{ paddingLeft: `${level * 14 + 10}px` }} className="py-1 pr-2 flex items-center gap-1.5">
                <input
                  type="text"
                  autoFocus
                  value={renamedName}
                  onChange={(e) => setRenamedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameItem();
                    if (e.key === 'Escape') setRenamingPath(null);
                  }}
                  className="flex-1 px-2 py-0.5 text-xs rounded border border-sky-500 bg-zinc-900 text-zinc-100 outline-none"
                />
                <button
                  type="button"
                  onClick={handleRenameItem}
                  className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                  title={t('confirm', 'Valider')}
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingPath(null)}
                  className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 cursor-pointer"
                  title={t('cancel', 'Annuler')}
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          }

          return (
            <div key={item.path}>
              <div
                onClick={() => (isDir ? toggleFolder(item.path) : handleSelectFile(item.path))}
                style={{ paddingLeft: `${level * 14 + 10}px` }}
                className={`flex items-center justify-between py-1 pr-1.5 rounded-lg text-xs cursor-pointer group transition-colors ${
                  isSelected
                    ? 'bg-sky-500/15 text-sky-600 dark:text-sky-300 font-medium border-l-2 border-sky-500'
                    : 'text-slate-700 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/5'
                }`}
              >
                <div className="flex items-center gap-1.5 truncate flex-1 min-w-0 mr-1">
                  {isDir ? (
                    <>
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      )}
                      <FileIcon filename={item.name} isDir={true} isExpanded={isExpanded} className="w-3.5 h-3.5 shrink-0" />
                    </>
                  ) : (
                    <>
                      <span className="w-3.5" />
                      <FileIcon filename={item.name} isDir={false} className="w-3.5 h-3.5 shrink-0" />
                    </>
                  )}
                  <span className="font-mono truncate">{item.name}</span>
                </div>

                {/* Hover Quick Action Buttons */}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 transition-opacity">
                  {isDir && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreatingParent(item.path);
                          setCreatingType('file');
                          setNewItemName('');
                        }}
                        title={t('new_file_here', 'Nouveau fichier ici')}
                        className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300"
                      >
                        <FilePlus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreatingParent(item.path);
                          setCreatingType('folder');
                          setNewItemName('');
                        }}
                        title={t('new_folder_here', 'Nouveau dossier ici')}
                        className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300"
                      >
                        <FolderPlus className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  {!isDir && onOpenMonacoStudio && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenMonacoStudio({
                          mode: 'editor',
                          filePath: item.path,
                          workspace: currentWorkspace,
                          openFiles: openTabs.map(t => ({ path: t.path, name: t.name, content: t.content })),
                        });
                      }}
                      title={t('open_in_monaco_studio', 'Ouvrir dans Monaco Studio')}
                      className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300"
                    >
                      <Code2 className="w-3 h-3" />
                    </button>
                  )}
                  {!isDir && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDuplicateFile(item.path);
                      }}
                      title={t('duplicate_file', 'Dupliquer le fichier')}
                      className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300 cursor-pointer"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRenamingPath(item.path);
                      setRenamedName(item.name);
                    }}
                    title={t('rename', 'Renommer')}
                    className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-amber-300"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteItem(item.path, isDir, item.name);
                    }}
                    title={t('delete', 'Supprimer')}
                    className="p-1 hover:bg-rose-500/20 rounded text-slate-400 hover:text-rose-400"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                  {!isDir && onInsertPath && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onInsertPath(item.path);
                      }}
                      title={t('insert_path_in_prompt', 'Insérer le chemin')}
                      className="p-1 hover:bg-slate-700/60 rounded text-slate-400 hover:text-sky-300"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  )}
                </div>
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
        {/* Horizontally Scrollable Tab Buttons & Actions with Controls */}
        <div className="relative flex items-center min-w-0 flex-1 group">
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => handleHeaderScroll('left')}
              className="absolute left-0 z-30 h-7 w-6 rounded-l-lg flex items-center justify-center transition-all cursor-pointer shadow-md border border-r-0"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border2)',
                color: 'var(--accent-text)',
              }}
              title={t('scroll_left', 'Défiler vers la gauche')}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          )}

          <div
            ref={headerScrollRef}
            onWheel={(e) => {
              if (e.deltaY !== 0) {
                e.currentTarget.scrollLeft += e.deltaY;
              }
            }}
            className="flex items-center gap-1.5 p-1 pb-2 rounded-xl border workspace-header-scroll touch-scroll min-w-0 flex-1 whitespace-nowrap"
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
            <span>{t('files', 'Files')}</span>
          </button>

          <button
            onClick={() => handleTabClick('search')}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 ${
              activeTab === 'search'
                ? 'bg-sky-500 text-white shadow-md shadow-sky-500/20 font-semibold'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50'
            }`}
            title={t('workspace_search_global_tooltip', 'Recherche globale dans le workspace (Ctrl+Shift+F)')}
          >
            <Search className="w-3.5 h-3.5" />
            <span>{t('search', 'Recherche')}</span>
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
            <span>{t('artifacts', 'Artifacts')}</span>
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
            <span>{t('terminal', 'Terminal')}</span>
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
            <span>{t('git', 'Git')}</span>
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
            <span>{t('kanban', 'Kanban')}</span>
          </button>

          {/* Divider between Workspace Tabs & General Tools */}
          <div className="w-px h-4 mx-1 shrink-0" style={{ backgroundColor: 'var(--border)' }} />

          {/* Éditeur Monaco Studio */}
          {onOpenMonacoStudio && (
            <button
              type="button"
              onClick={() => onOpenMonacoStudio({ mode: 'editor', initialValue: '', readOnly: false })}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50"
              title={t('monaco_code_studio_tooltip', 'Monaco Code Studio (/editor)')}
            >
              <Code2 className="w-3.5 h-3.5 text-sky-400" />
              <span>{t('editor', 'Éditeur')}</span>
            </button>
          )}

          {/* Branches Studio */}
          {onOpenBranchTree && (
            <button
              type="button"
              onClick={onOpenBranchTree}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50"
              title={t("session_branches_tooltip", "Arbre des branches et signets mémoire (/branch)")}
            >
              <GitBranch className="w-3.5 h-3.5 text-purple-400" />
              <span>{t('branches', 'Branches')}</span>
            </button>
          )}

          {/* Crons Scheduler */}
          {onOpenCrons && (
            <button
              type="button"
              onClick={onOpenCrons}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50"
              title={t("task_cron_scheduler", "Task & Cron Scheduler (/crons)")}
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{t('crons', 'Crons')}</span>
            </button>
          )}

          {/* System Rules */}
          {onOpenRules && (
            <button
              type="button"
              onClick={onOpenRules}
              className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer shrink-0 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50"
              title={t("system_rules_memory", "System Rules & AGENTS.md Memory (/rules)")}
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t("rules", "Règles")}</span>
            </button>
          )}

          {/* Export Dropdown */}
          {conversationId && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/50"
                title={t("export_session_title", "Export session to HTML, Markdown or JSON")}
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>{t("export", "Export")}</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {showExportMenu && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-52 rounded-xl shadow-2xl z-50 p-1.5 space-y-1 text-xs animate-fadeIn backdrop-blur-xl border"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border2)'
                  }}
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <a
                    href={getExportHtmlUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--text)' }}
                  >
                    <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">{t('standalone_html', 'HTML Autonome')}</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>{t("offline_styled", "Complete & styled offline")}</span>
                    </div>
                  </a>

                  <a
                    href={getExportMarkdownUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--text)' }}
                  >
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">Markdown (.md)</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>{t("github_structured", "GitHub structured format")}</span>
                    </div>
                  </a>

                  <a
                    href={getExportJsonUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors cursor-pointer"
                    style={{ color: 'var(--text)' }}
                  >
                    <Code2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">{t("json_data", "JSON Data (.json)")}</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>{t('raw_transcript_full', 'Transcript brut complet')}</span>
                    </div>
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        {canScrollRight && (
          <button
            type="button"
            onClick={() => handleHeaderScroll('right')}
            className="absolute right-0 z-30 h-7 w-6 rounded-r-lg flex items-center justify-center transition-all cursor-pointer shadow-md border border-l-0"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border2)',
              color: 'var(--accent-text)',
            }}
            title={t('scroll_right', 'Défiler vers la droite')}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        )}
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
              title={t('active_git_branch', 'Active git branch: {0}').replace('{0}', gitStatus.branch)}
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
            title={t('close_side_panel', 'Close side panel')}
            aria-label={t('close_side_panel', 'Close side panel')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Panel Tab Body */}
      <div className="flex-1 min-h-0 overflow-hidden relative select-text">
        <div className={`h-full ${activeTab === 'terminal' ? 'block' : 'hidden'}`}>
          <TerminalTab key={currentWorkspace} currentWorkspace={currentWorkspace} />
        </div>

        {activeTab === 'git' && (
          <React.Suspense
            fallback={
              <div className="flex flex-col items-center justify-center h-full text-xs gap-2" style={{ color: 'var(--muted)' }}>
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
                <span>{t('loading_git', 'Loading Git status...')}</span>
              </div>
            }
          >
            <GitTab currentWorkspace={currentWorkspace} onOpenMonacoStudio={onOpenMonacoStudio} />
          </React.Suspense>
        )}

        {activeTab === 'kanban' && (
          <React.Suspense
            fallback={
              <div className="flex flex-col items-center justify-center h-full text-xs gap-2" style={{ color: 'var(--muted)' }}>
                <RefreshCw className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
                <span>{t('loading_kanban', 'Loading Kanban...')}</span>
              </div>
            }
          >
            <KanbanTab 
              currentWorkspace={currentWorkspace} 
              onExecutePrompt={onExecutePrompt}
            />
          </React.Suspense>
        )}

        {/* FILES OR SEARCH TAB */}
        {(activeTab === 'files' || activeTab === 'search') && (
          <div className="flex h-full flex-col">
            <div className="flex-1 flex min-h-0">
              {/* Left Column: Search Panel or File Tree Column */}
              {activeTab === 'search' ? (
                <div
                  className="w-[340px] min-w-[280px] max-w-[440px] border-r flex flex-col shrink-0 relative overflow-hidden"
                  style={{
                    backgroundColor: 'var(--sidebar)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <WorkspaceSearchPanel
                    currentWorkspace={currentWorkspace}
                    initialQuery={initialSearchQuery}
                    initialMode={initialSearchMode}
                    onSelectMatch={handleSelectSearchMatch}
                    onPreviewDiff={handlePreviewSearchDiff}
                    onFileModified={handleSearchFileModified}
                  />
                </div>
              ) : (
                /* File Tree Column */
                <div
                  onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOverTree(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                    setIsDraggingOverTree(false);
                  }
                }}
                onDrop={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingOverTree(false);
                  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    await handleUploadFiles(e.dataTransfer.files);
                  }
                }}
                className="w-[260px] min-w-[220px] max-w-[340px] border-r flex flex-col shrink-0 relative"
                style={{
                  backgroundColor: 'var(--sidebar)',
                  borderColor: 'var(--border)',
                }}
              >
                {/* Drag and drop overlay */}
                {isDraggingOverTree && (
                  <div className="absolute inset-0 z-30 bg-sky-500/20 backdrop-blur-xs border-2 border-dashed border-sky-400 rounded-lg flex flex-col items-center justify-center p-4 text-center pointer-events-none animate-fadeIn">
                    <Upload className="w-8 h-8 text-sky-300 animate-bounce mb-2" />
                    <p className="text-xs font-semibold text-white drop-shadow-sm">
                      {t('drop_files_here', 'Déposez vos fichiers ici')}
                    </p>
                    <p className="text-[10px] text-sky-200 opacity-80 mt-0.5">
                      {t('direct_import_workspace', 'Importation directe dans le workspace')}
                    </p>
                  </div>
                )}

                {/* Hidden File Input for Native File Picker */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileInputChange}
                  className="hidden"
                />

                {/* File Tree Toolbar */}
                <div className="p-2 border-b flex items-center gap-1.5 shrink-0" style={{ borderColor: 'var(--border)' }}>
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-3 h-3 absolute left-2 top-2 text-slate-400" />
                    <input
                      type="text"
                      value={treeSearch}
                      onChange={(e) => setTreeSearch(e.target.value)}
                      placeholder={t('filter_ellipsis', 'Filtrer...')}
                      className="w-full pl-6 pr-5 py-1 text-xs rounded-lg border bg-black/5 dark:bg-white/5 outline-none font-mono text-slate-200 focus:border-sky-500"
                      style={{ borderColor: 'var(--border)' }}
                    />
                    {treeSearch && (
                      <button
                        type="button"
                        onClick={() => setTreeSearch('')}
                        className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-200 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => window.dispatchEvent(new CustomEvent('open-quick-open'))}
                    title={t('quick_file_search_tooltip', 'Recherche rapide de fichiers (Ctrl+P)')}
                    className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-sky-400 cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleTabClick('search')}
                    title={t('search_replace_global_tooltip', 'Recherche & Remplacement global dans le workspace (Ctrl+Shift+F)')}
                    className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-amber-400 cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    title={t('upload_files_tooltip', 'Importer des fichiers depuis votre ordinateur')}
                    className="p-1.5 rounded-lg border hover:bg-emerald-500/10 text-emerald-400 border-emerald-500/30 cursor-pointer shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCreatingParent(null);
                      setCreatingType('file');
                      setNewItemName('');
                    }}
                    title={t('new_file_root', 'Nouveau fichier à la racine')}
                    className="p-1.5 rounded-lg border hover:bg-sky-500/10 text-sky-400 border-sky-500/30 cursor-pointer shrink-0"
                  >
                    <FilePlus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCreatingParent(null);
                      setCreatingType('folder');
                      setNewItemName('');
                    }}
                    title={t('new_folder_root', 'Nouveau dossier à la racine')}
                    className="p-1.5 rounded-lg border hover:bg-sky-500/10 text-sky-400 border-sky-500/30 cursor-pointer shrink-0"
                  >
                    <FolderPlus className="w-3.5 h-3.5" />
                  </button>

                  <button
                    type="button"
                    onClick={loadTree}
                    disabled={loadingTree}
                    title={t('refresh', 'Actualiser')}
                    className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-200 cursor-pointer shrink-0"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTree ? 'animate-spin' : ''}`} />
                  </button>
                </div>

                {/* Inline Creation Row */}
                {creatingType && (
                  <div className="p-2 border-b bg-sky-500/10 flex items-center gap-1.5 shrink-0" style={{ borderColor: 'var(--border)' }}>
                    <span className="text-[11px] font-semibold text-sky-400 shrink-0">
                      {creatingType === 'file' ? t('plus_file', '+ Fichier') : t('plus_folder', '+ Dossier')}
                    </span>
                    <input
                      type="text"
                      autoFocus
                      value={newItemName}
                      onChange={(e) => setNewItemName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateNewItem();
                        if (e.key === 'Escape') setCreatingType(null);
                      }}
                      placeholder={creatingType === 'file' ? t('file_name_placeholder', 'nom.ts') : t('folder_name_placeholder', 'dossier')}
                      className="flex-1 min-w-0 px-2 py-0.5 text-xs rounded border border-sky-500 bg-zinc-950 text-zinc-100 outline-none font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleCreateNewItem}
                      className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                      title={t('create_enter_tooltip', 'Créer (Entrée)')}
                    >
                      <Check className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCreatingType(null)}
                      className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 cursor-pointer"
                      title={t('cancel_escape_tooltip', 'Annuler (Échap)')}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}

                {/* Tree Item List */}
                <div className="flex-1 overflow-y-auto p-2">
                  {loadingTree && !fileTree ? (
                    <div className="p-4 text-center text-xs flex items-center justify-center gap-2" style={{ color: 'var(--muted)' }}>
                      <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                      <span>{t('loading', 'Chargement...')}</span>
                    </div>
                  ) : fileTree && fileTree.items ? (
                    renderTreeItems(filterTreeItems(fileTree.items, treeSearch))
                  ) : (
                    <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>{t('no_files', 'Aucun fichier')}</div>
                  )}
                </div>
              </div>
            )}

              {/* File Content Preview / Monaco Editor Column */}
              <div className="flex-1 flex flex-col min-h-0 min-w-0" style={{ backgroundColor: 'var(--surface)' }}>
                {/* Multi-Tabs Bar */}
                {openTabs.length > 0 && (
                  <div
                    className="flex items-center gap-1 border-b px-1.5 py-1 overflow-x-auto no-scrollbar shrink-0 select-none relative"
                    style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                  >
                    {openTabs.map((tab, idx) => {
                      const isActive = activeTabIndex === idx;
                      return (
                        <div
                          key={tab.path}
                          onClick={() => setActiveTabIndex(idx)}
                          onContextMenu={(e) => handleTabContextMenu(e, idx)}
                          className={`group flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono cursor-pointer border transition-colors shrink-0 max-w-[170px] ${
                            isActive
                              ? 'bg-sky-500/15 border-sky-500/40 text-sky-400 font-semibold'
                              : 'bg-transparent border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-200'
                          }`}
                          title={`${tab.path} (clic droit pour plus d'options)`}
                        >
                          <FileIcon filename={tab.name} isDir={false} className="w-3 h-3 shrink-0" />
                          <span className="truncate flex-1 text-[11px]">{tab.name}</span>
                          {tab.isDirty && (
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" title={t('unsaved_changes', 'Modifications non enregistrées')} />
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleCloseTab(idx, e)}
                            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-black/20 text-slate-400 hover:text-slate-200 cursor-pointer"
                            title={t('close_tab', "Fermer l'onglet")}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}

                    {/* Floating Tab Context Menu */}
                    {tabContextMenu && (
                      <div
                        style={{
                          top: `${tabContextMenu.y}px`,
                          left: `${Math.min(tabContextMenu.x, window.innerWidth - 220)}px`,
                          backgroundColor: 'var(--surface)',
                          borderColor: 'var(--border)',
                        }}
                        className="fixed z-50 min-w-[210px] py-1.5 rounded-xl border shadow-2xl backdrop-blur-md text-xs font-sans animate-fadeIn select-none"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="px-3 py-1 text-[10px] font-mono text-slate-400 border-b border-white/5 truncate max-w-[210px]">
                          {openTabs[tabContextMenu.tabIndex]?.name}
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCloseTab(tabContextMenu.tabIndex)}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('close', 'Fermer')}</span>
                          <span className="text-[10px] text-slate-500 font-mono">{t('close_tab', 'Fermer onglet')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCloseOtherTabs(tabContextMenu.tabIndex)}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('close_others', 'Fermer les autres')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleCloseTabsToRight(tabContextMenu.tabIndex)}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('close_to_the_right', 'Fermer à droite')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCloseSavedTabs}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('close_saved_tabs', 'Fermer les onglets enregistrés')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={handleCloseAllTabs}
                          className="w-full text-left px-3 py-1.5 hover:bg-rose-500/10 flex items-center justify-between text-rose-400 hover:text-rose-300 cursor-pointer"
                        >
                          <span>{t('close_all', 'Tout fermer')}</span>
                        </button>

                        <div className="my-1 border-t border-white/5" />

                        <button
                          type="button"
                          onClick={() => {
                            const tab = openTabs[tabContextMenu.tabIndex];
                            if (tab) handleDuplicateFile(tab.path);
                            setTabContextMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('duplicate_this_file', 'Dupliquer ce fichier')}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            const tab = openTabs[tabContextMenu.tabIndex];
                            if (tab) {
                              navigator.clipboard.writeText(tab.path);
                              showToast(t('absolute_path_copied', 'Chemin absolu copié'), 'info');
                            }
                            setTabContextMenu(null);
                          }}
                          className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between text-slate-300 hover:text-white cursor-pointer"
                        >
                          <span>{t('copy_absolute_path', 'Copier le chemin absolu')}</span>
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {activeTabItem ? (
                  <>
                    {/* Editor Action Header Bar */}
                    <div
                      className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] shrink-0 gap-2"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--muted)',
                      }}
                    >
                      {/* Breadcrumb */}
                      <div className="flex items-center gap-1 font-mono text-[11px] truncate flex-1 min-w-0" style={{ color: 'var(--muted)' }}>
                        {activeTabItem.path.split(/[/\\]/).filter(Boolean).map((part, idx, arr) => (
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
                        {activeTabItem.isDirty && (
                          <span className="text-amber-400 font-bold ml-1 text-xs">•</span>
                        )}
                      </div>

                      {/* Header Actions */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        {onInsertPath && (
                          <button
                            onClick={() => onInsertPath(activeTabItem.path)}
                            className="text-[10px] text-sky-500 hover:text-sky-400 font-medium cursor-pointer mr-1"
                            title={t('insert_path_in_prompt', 'Insérer le chemin')}
                          >
                            + {t('insert_path', 'Insérer')}
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
                          title={t('download_file_to_device', 'Télécharger le fichier')}
                        >
                          <Download className="w-2.5 h-2.5" />
                          <span>{t('download', 'Télécharger')}</span>
                        </button>

                        {activeTabItem.path.endsWith('.md') && (
                          <button
                            type="button"
                            onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border"
                            style={{
                              backgroundColor: showMarkdownPreview ? 'var(--accent-bg)' : 'var(--surface)',
                              borderColor: showMarkdownPreview ? 'var(--accent)' : 'var(--border)',
                              color: showMarkdownPreview ? 'var(--accent)' : 'var(--text)',
                            }}
                            title={t('toggle_markdown_preview', 'Bascule Aperçu Markdown')}
                          >
                            {showMarkdownPreview ? <Code className="w-2.5 h-2.5" /> : <Eye className="w-2.5 h-2.5" />}
                            <span>{showMarkdownPreview ? t('source', 'Source') : t('preview', 'Aperçu')}</span>
                          </button>
                        )}

                        {!activeTabItem.isBinary && (
                          <>
                            <button
                              type="button"
                              onClick={handleFormatCode}
                              className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border hover:text-emerald-400 hover:border-emerald-500/40"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                                color: 'var(--text)',
                              }}
                              title={t('format_code_tooltip', 'Formater le code (Shift+Alt+F)')}
                            >
                              <Sparkles className="w-2.5 h-2.5 text-emerald-400" />
                              <span>{t('format', 'Format')}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => setIsWordWrap(!isWordWrap)}
                              className={`p-1 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                                isWordWrap ? 'bg-sky-500/20 text-sky-400 border-sky-500/40' : 'hover:bg-black/5 dark:hover:bg-white/5'
                              }`}
                              style={{ borderColor: isWordWrap ? undefined : 'var(--border)' }}
                              title={t('word_wrap_toggle', 'Retour à la ligne automatique')}
                            >
                              <WrapText className="w-2.5 h-2.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => setIsMinimap(!isMinimap)}
                              className={`p-1 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                                isMinimap ? 'bg-sky-500/20 text-sky-400 border-sky-500/40' : 'hover:bg-black/5 dark:hover:bg-white/5'
                              }`}
                              style={{ borderColor: isMinimap ? undefined : 'var(--border)' }}
                              title={t('minimap_monaco', 'Minimap Monaco')}
                            >
                              <Columns className="w-2.5 h-2.5" />
                            </button>
                          </>
                        )}

                        {onOpenMonacoStudio && !activeTabItem.isBinary && (
                          <button
                            type="button"
                            onClick={() => onOpenMonacoStudio({
                              mode: 'editor',
                              filePath: activeTabItem.path,
                              initialValue: activeTabItem.content,
                              content: activeTabItem.content,
                              workspace: currentWorkspace,
                              readOnly: false,
                              openFiles: openTabs.map(t => ({ path: t.path, name: t.name, content: t.content })),
                            })}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border hover:bg-sky-500/10 text-sky-400 border-sky-500/30"
                            title={t('open_in_monaco_studio_fullscreen', 'Ouvrir dans Monaco Studio plein écran')}
                          >
                            <Code2 className="w-2.5 h-2.5" />
                            <span>{t('studio', 'Studio')}</span>
                          </button>
                        )}

                        {/* Run in Integrated Terminal button */}
                        {isExecutableFile && (
                          <button
                            type="button"
                            onClick={handleRunInTerminal}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30"
                            title={t('run_in_terminal_tooltip', 'Exécuter dans le terminal intégré')}
                          >
                            <Play className="w-2.5 h-2.5 fill-amber-300" />
                            <span>{t('run', 'Exécuter')}</span>
                          </button>
                        )}

                        {/* Toggle Integrated Terminal button */}
                        <button
                          type="button"
                          onClick={() => {
                            setIsTerminalSplitOpen(prev => {
                              const next = !prev;
                              setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                              return next;
                            });
                          }}
                          className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border ${
                            isTerminalSplitOpen
                              ? 'bg-sky-500/20 text-sky-400 border-sky-500/40'
                              : 'hover:bg-black/5 dark:hover:bg-white/5 border-transparent text-slate-400 hover:text-slate-200'
                          }`}
                          style={{ borderColor: isTerminalSplitOpen ? undefined : 'var(--border)' }}
                          title={t('toggle_terminal_tooltip', 'Basculer le terminal intégré (Ctrl+`)')}
                        >
                          <TerminalIcon className="w-2.5 h-2.5" />
                          <span>{t('terminal', 'Terminal')}</span>
                        </button>

                        {/* Diff with disk */}
                        {activeTabItem.isDirty && onOpenMonacoStudio && (
                          <button
                            type="button"
                            onClick={() => onOpenMonacoStudio({
                              mode: 'diff',
                              filePath: activeTabItem.path,
                              originalContent: activeTabItem.originalContent,
                              modifiedContent: activeTabItem.content,
                              workspace: currentWorkspace,
                            })}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border-amber-500/30"
                            title={t('diff_compare_tooltip', 'Comparer les modifications avec la version enregistrée sur disque')}
                          >
                            <SplitSquareVertical className="w-2.5 h-2.5" />
                            <span>{t('diff', 'Diff')}</span>
                          </button>
                        )}

                        {/* AI Code Actions Studio */}
                        {!activeTabItem.isBinary && (
                          <button
                            type="button"
                            onClick={() => setIsCopilotActionOpen(true)}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border-indigo-500/30"
                            title={t('ai_actions_tooltip', 'Actions de Code IA (Refactor, Typage, Docs, Tests)')}
                          >
                            <Sparkles className="w-2.5 h-2.5 text-indigo-400" />
                            <span>{t('ai_actions', 'Actions IA')}</span>
                          </button>
                        )}

                        {/* Revert changes */}
                        {activeTabItem.isDirty && (
                          <button
                            type="button"
                            onClick={handleRevertActiveTab}
                            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer border hover:bg-rose-500/10 text-rose-400 border-rose-500/30"
                            title={t('discard_unsaved_tooltip', 'Annuler toutes les modifications non enregistrées')}
                          >
                            <RotateCcw className="w-2.5 h-2.5" />
                            <span>{t('cancel', 'Annuler')}</span>
                          </button>
                        )}

                        {!activeTabItem.isBinary && (
                          <button
                            type="button"
                            onClick={handleSaveActiveTab}
                            disabled={savingFile}
                            className="flex items-center gap-1 px-2.5 py-0.5 rounded text-[10px] font-semibold transition-colors cursor-pointer bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
                            title={t('save_ctrl_s_tooltip', 'Enregistrer (Ctrl+S)')}
                          >
                            {saveSuccess ? <Check className="w-2.5 h-2.5" /> : savingFile ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />}
                            <span>{saveSuccess ? t('saved', 'Enregistré') : savingFile ? '...' : t('save', 'Enregistrer')}</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Editor Viewport */}
                    <div className="flex-1 relative overflow-hidden bg-zinc-950 flex flex-col min-h-0">
                      {loadingContent ? (
                        <div className="flex-1 flex items-center justify-center gap-2 text-xs text-zinc-400">
                          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
                          <span>{t('loading_content', 'Chargement du contenu...')}</span>
                        </div>
                      ) : activeTabItem.path.match(/\.(png|jpe?g|gif|svg|webp)$/i) ? (
                        <div className="flex-1 flex items-center justify-center p-4 overflow-auto">
                          <img
                            src={`/api/files/download?path=${encodeURIComponent(activeTabItem.path)}${getAuthToken() ? `&token=${encodeURIComponent(getAuthToken()!)}` : ''}`}
                            alt={activeTabItem.name}
                            className="max-w-full max-h-full object-contain rounded-lg shadow-sm border border-zinc-800"
                          />
                        </div>
                      ) : activeTabItem.isBinary ? (
                        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-3">
                          <div className="w-14 h-14 rounded-2xl flex items-center justify-center border shadow-sm" style={{ backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent)' }}>
                            <FileText className="w-7 h-7" style={{ color: 'var(--accent)' }} />
                          </div>
                          <div>
                            <h4 className="text-sm font-semibold mb-1" style={{ color: 'var(--strong)' }}>
                              {activeTabItem.name}
                            </h4>
                            <p className="text-xs" style={{ color: 'var(--muted)' }}>
                              {t('binary_file_desc', 'Fichier binaire (document ou archive).')}
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
                            <span>{t('download_file', 'Télécharger le fichier')}</span>
                          </button>
                        </div>
                      ) : activeTabItem.path.endsWith('.md') && showMarkdownPreview ? (
                        <div className="flex-1 p-4 prose dark:prose-invert max-w-none text-xs leading-relaxed overflow-y-auto">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {activeTabItem.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <Editor
                          height="100%"
                          language={activeTabItem.language}
                          value={activeTabItem.content}
                          theme={monacoTheme}
                          onChange={(val) => handleEditorChange(val || '')}
                          onMount={(editor, monaco) => {
                            monacoEditorRef.current = editor;
                            monacoInstanceRef.current = monaco;
                            registerMonacoCopilot(monaco, {
                              onStatusChange: (s) => setCopilotStatus(s)
                            });
                            editor.onDidChangeCursorPosition((e) => {
                              setCursorPos({ line: e.position.lineNumber, col: e.position.column });
                            });
                            editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
                              handleSaveActiveTab();
                            });
                            editor.addCommand(monaco.KeyCode.F7, () => {
                              navigateGitDiff(editor, diffRangesRef.current, 'next');
                            });
                            editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => {
                              navigateGitDiff(editor, diffRangesRef.current, 'prev');
                            });
                            const multiCtrl = setupMultiCursor(editor, monaco, (count) => {
                              setCursorCount(count);
                            });
                            multiCursorControllerRef.current = multiCtrl;
                            loadGitDiffRanges(activeTabItem.path);
                            loadDiagnostics(activeTabItem.content, activeTabItem.language, activeTabItem.path);
                          }}
                          options={{
                            ...getMonacoMultiCursorOptions(),
                            fontSize: 12,
                            lineNumbers: 'on',
                            minimap: { enabled: isMinimap },
                            wordWrap: isWordWrap ? 'on' : 'off',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            tabSize: 2,
                            smoothScrolling: true,
                            fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                            padding: { top: 8, bottom: 8 },
                            inlineSuggest: {
                              enabled: copilotActive,
                              mode: 'subwordSmart',
                              showToolbar: 'always',
                            },
                          }}
                          loading={
                            <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
                              <Loader2 className="w-5 h-5 animate-spin text-sky-400" />
                              <span className="text-xs">{t('monaco_loading_editor', 'Chargement de Monaco Editor...')}</span>
                            </div>
                          }
                        />
                      )}
                    </div>

                    {/* Collapsible Problems Drawer in WorkspacePanel */}
                    {isProblemsOpen && (
                      <div className="flex flex-col max-h-40 min-h-[100px] border-t text-[11px] font-mono shrink-0 select-none" style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}>
                        <div className="flex items-center justify-between px-3 py-1 border-b" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold flex items-center gap-1 text-[11px]">
                              <AlertCircle className="w-3 h-3 text-rose-400" />
                              <span>{t('editor_diagnostics_problems', 'Problèmes')}</span>
                            </span>
                            <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-black/10 dark:bg-white/10">
                              {diagnostics.length}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => loadDiagnostics(activeTabItem.content, activeTabItem.language, activeTabItem.path)}
                              disabled={isLinting}
                              className="p-0.5 rounded hover:text-zinc-200 transition-colors cursor-pointer"
                              title={t('editor_diagnostics_refresh', 'Actualiser les diagnostics')}
                            >
                              <RotateCw className={`w-3 h-3 ${isLinting ? 'animate-spin text-emerald-400' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setIsProblemsOpen(false)}
                              className="p-0.5 rounded hover:text-zinc-200 transition-colors cursor-pointer"
                              title={t('close', 'Fermer')}
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <div className="flex-1 overflow-y-auto divide-y divide-zinc-800/40 p-1">
                          {diagnostics.length === 0 ? (
                            <div className="flex items-center justify-center py-4 text-zinc-500 gap-1.5 text-[11px]">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                              <span>{t('editor_diagnostics_no_problems', 'Aucun problème détecté')}</span>
                            </div>
                          ) : (
                            diagnostics.map((item, idx) => (
                              <div
                                key={`${item.line}-${item.column}-${idx}`}
                                onClick={() => handleJumpToProblem(item)}
                                className="flex items-center justify-between gap-2 px-2 py-1 hover:bg-black/10 dark:hover:bg-white/5 cursor-pointer rounded transition-colors group"
                              >
                                <div className="flex items-center gap-1.5 min-w-0">
                                  {item.severity === 'error' ? (
                                    <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                                  ) : item.severity === 'warning' ? (
                                    <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                                  ) : (
                                    <Info className="w-3 h-3 text-sky-400 shrink-0" />
                                  )}
                                  <span className="truncate text-[10px] group-hover:text-emerald-400">
                                    {item.message}
                                  </span>
                                  {item.code && (
                                    <span className="px-1 py-0.2 rounded text-[8px] bg-black/15 dark:bg-white/10 shrink-0 opacity-70">
                                      {item.source}:{item.code}
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] opacity-60 shrink-0">
                                  Ln {item.line}, Col {item.column}
                                </span>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                    {/* Editor Status Bar */}
                    <div
                      className="flex items-center justify-between px-3 py-1 border-t text-[10px] font-mono shrink-0 select-none gap-2"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--muted)',
                      }}
                    >
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span>{t('line_col_format', 'Lg {0}, Col {1}', cursorPos.line, cursorPos.col)}</span>
                        {cursorCount > 1 && (
                          <>
                            <span>•</span>
                            <button
                              type="button"
                              onClick={() => multiCursorControllerRef.current?.resetToSingleCursor()}
                              className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[9px] hover:bg-amber-500/25 transition-colors cursor-pointer"
                              title={t('multiple_cursors_tooltip', 'Curseurs multiples actifs. Cliquez pour réinitialiser à un seul curseur (ou Échap).')}
                            >
                              <Layers className="w-2.5 h-2.5" />
                              <span>{t('cursors_count', '{0} curseurs', cursorCount)}</span>
                              <X className="w-2.5 h-2.5 opacity-60 hover:opacity-100" />
                            </button>
                          </>
                        )}
                        <span>•</span>
                        <span className="uppercase text-sky-400">{activeTabItem.language}</span>
                        <span>•</span>
                        {/* Problems Badge in Embedded Status Bar */}
                        <button
                          type="button"
                          onClick={() => setIsProblemsOpen(!isProblemsOpen)}
                          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] border transition-colors cursor-pointer ${
                            isProblemsOpen
                              ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
                              : totalErrors > 0
                              ? 'bg-rose-500/15 text-rose-400 border-rose-500/30 hover:bg-rose-500/25'
                              : totalWarnings > 0
                              ? 'bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25'
                              : 'text-zinc-500 hover:text-zinc-300 border-transparent hover:border-zinc-700'
                          }`}
                          title={t('editor_diagnostics_toggle_drawer', 'Afficher/Masquer le panneau des problèmes')}
                        >
                          {isLinting ? (
                            <RotateCw className="w-2.5 h-2.5 animate-spin text-emerald-400" />
                          ) : totalErrors > 0 ? (
                            <AlertCircle className="w-2.5 h-2.5 text-rose-400" />
                          ) : totalWarnings > 0 ? (
                            <AlertTriangle className="w-2.5 h-2.5 text-amber-400" />
                          ) : (
                            <CheckCircle2 className="w-2.5 h-2.5 text-emerald-400" />
                          )}
                          <span>
                            {diagnostics.length > 0
                              ? `${totalErrors > 0 ? `❌ ${totalErrors}` : ''} ${totalWarnings > 0 ? `⚠️ ${totalWarnings}` : ''}`.trim()
                              : t('editor_diagnostics_problems', 'Problèmes')}
                          </span>
                          <span className="opacity-70 text-[8px]">({diagnostics.length})</span>
                        </button>
                        <span>•</span>
                        <span>UTF-8</span>
                      </div>

                      <div className="flex items-center gap-2.5 flex-wrap">
                        {diffSummary && diffSummary.total_changes > 0 && (
                          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/20 dark:bg-white/5 border border-zinc-700/50 text-[9px]">
                            <span
                              onClick={() => navigateGitDiff(monacoEditorRef.current, diffRangesRef.current, 'next')}
                              className="cursor-pointer hover:underline flex items-center gap-1 font-semibold"
                              title={t('git_next_change_hint', 'Modifications Git. Cliquez pour aller à la modification suivante (F7).')}
                            >
                              <span className="text-emerald-400">+{diffSummary.added_lines}</span>
                              <span className="text-sky-400">~{diffSummary.modified_lines}</span>
                              <span className="text-rose-400">-{diffSummary.deleted_lines}</span>
                            </span>
                            <div className="flex items-center border-l border-zinc-700/60 pl-1 ml-0.5 gap-0.5">
                              <button
                                type="button"
                                onClick={() => navigateGitDiff(monacoEditorRef.current, diffRangesRef.current, 'prev')}
                                className="p-0.5 hover:text-zinc-100 rounded cursor-pointer"
                                title={t('git_prev_change_hint', 'Modification précédente (Shift+F7)')}
                              >
                                <ChevronUp className="w-2.5 h-2.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => navigateGitDiff(monacoEditorRef.current, diffRangesRef.current, 'next')}
                                className="p-0.5 hover:text-zinc-100 rounded cursor-pointer"
                                title={t('git_next_change_f7', 'Modification suivante (F7)')}
                              >
                                <ChevronDown className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          </div>
                        )}
                        <span>•</span>
                        <span>{t('char_count_abbr', '{0} car.', activeTabItem.content.length)}</span>
                        <span>•</span>
                        <kbd className="px-1 py-0.2 rounded border bg-black/10 dark:bg-white/10 text-[9px]">Ctrl+S</kbd>
                        <span>•</span>
                        <button
                          type="button"
                          onClick={() => {
                            const next = !copilotActive;
                            setCopilotActive(next);
                            setCopilotEnabled(next);
                          }}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded border text-[9px] font-mono cursor-pointer transition-colors"
                          style={{
                            backgroundColor: copilotActive ? 'rgba(16, 185, 129, 0.1)' : 'rgba(113, 113, 122, 0.1)',
                            borderColor: copilotActive ? 'rgba(16, 185, 129, 0.3)' : 'rgba(113, 113, 122, 0.3)',
                            color: copilotActive ? '#34d399' : '#a1a1aa'
                          }}
                          title={t('toggle_copilot_tooltip', 'Activer/Désactiver AI Copilot Inline')}
                        >
                          {copilotStatus === 'generating' ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin text-amber-400" />
                          ) : (
                            <Sparkles className="w-2.5 h-2.5" />
                          )}
                          <span>{copilotActive ? t('copilot_on', 'Copilot On') : t('copilot_off', 'Copilot Off')}</span>
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-xs p-8 text-center gap-3" style={{ color: 'var(--muted)' }}>
                    <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                      <Code2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm mb-1" style={{ color: 'var(--strong)' }}>
                        {t('editor_title_antigravity', 'Éditeur de fichiers Antigravity')}
                      </h4>
                      <p className="text-xs max-w-sm">
                        {t('editor_welcome_hint', "Sélectionnez un fichier dans l'arborescence à gauche ou créez un nouveau fichier pour commencer l'édition avec coloration syntaxique et raccourcis IDE.")}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingParent(null);
                          setCreatingType('file');
                          setNewItemName('');
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white cursor-pointer shadow-sm transition-all"
                      >
                        <FilePlus className="w-3.5 h-3.5" />
                        <span>{t('new_file', 'Nouveau fichier')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setIsTerminalSplitOpen(prev => {
                            const next = !prev;
                            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                            return next;
                          });
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-black/5 dark:hover:bg-white/5 text-slate-300 cursor-pointer shadow-sm transition-all"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <TerminalIcon className="w-3.5 h-3.5 text-sky-400" />
                        <span>{t('terminal_ctrl_backquote', 'Terminal (Ctrl+`)')}</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Integrated Terminal Split Drawer */}
                {isTerminalSplitOpen && (
                  <div
                    className="flex flex-col border-t shrink-0 relative"
                    style={{
                      height: `${terminalSplitHeight}px`,
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--surface)',
                    }}
                  >
                    {/* Drag Resize Handle */}
                    <div
                      onMouseDown={handleSplitResizeMouseDown}
                      className="h-1.5 w-full cursor-row-resize hover:bg-sky-500/50 transition-colors flex items-center justify-center group relative -top-0.5 z-10 select-none"
                      title={t('resize_terminal_tooltip', 'Glisser pour redimensionner le terminal (double-clic pour réinitialiser)')}
                      onDoubleClick={() => {
                        setTerminalSplitHeight(260);
                        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                      }}
                    >
                      <div className="w-12 h-1 rounded-full bg-slate-600/40 group-hover:bg-sky-400 transition-colors" />
                    </div>

                    {/* Split Terminal Header */}
                    <div
                      className="flex items-center justify-between px-3 py-1 border-b text-xs shrink-0 select-none"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="flex items-center gap-1.5 text-sky-400 font-semibold text-[11px]">
                          <TerminalIcon className="w-3.5 h-3.5" />
                          <span>{t('integrated_terminal', 'Terminal Intégré')}</span>
                        </div>
                        <span className="text-slate-500 text-[10px]">•</span>
                        <span
                          className="font-mono text-[10px] truncate max-w-[240px] px-1.5 py-0.5 rounded border"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--muted)',
                          }}
                          title={activeFileFolder}
                        >
                          📂 {activeFileFolder}
                        </span>
                        {activeFileFolder && (
                          <button
                            type="button"
                            onClick={handleCdToActiveFolder}
                            className="px-1.5 py-0.5 text-[10px] rounded hover:bg-sky-500/10 text-sky-400 border border-sky-500/30 transition-colors cursor-pointer"
                            title={t('send_cd_folder_terminal', 'Envoyer cd "{0}" dans le terminal', activeFileFolder)}
                          >
                            {t('cd_here', 'cd ici')}
                          </button>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* Height Presets */}
                        <div className="flex items-center border rounded-md overflow-hidden text-[9px] font-mono" style={{ borderColor: 'var(--border)' }}>
                          <button
                            type="button"
                            onClick={() => {
                              setTerminalSplitHeight(160);
                              setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                            }}
                            className={`px-1.5 py-0.5 transition-colors cursor-pointer ${terminalSplitHeight === 160 ? 'bg-sky-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                            title={t('compact_height_tooltip', 'Hauteur compacte (160px)')}
                          >
                            160
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTerminalSplitHeight(260);
                              setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                            }}
                            className={`px-1.5 py-0.5 transition-colors cursor-pointer border-l ${terminalSplitHeight === 260 ? 'bg-sky-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                            style={{ borderColor: 'var(--border)' }}
                            title={t('standard_height_tooltip', 'Hauteur standard (260px)')}
                          >
                            260
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setTerminalSplitHeight(420);
                              setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                            }}
                            className={`px-1.5 py-0.5 transition-colors cursor-pointer border-l ${terminalSplitHeight === 420 ? 'bg-sky-500 text-white' : 'hover:bg-black/5 dark:hover:bg-white/5'}`}
                            style={{ borderColor: 'var(--border)' }}
                            title={t('tall_height_tooltip', 'Hauteur haute (420px)')}
                          >
                            420
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setIsTerminalSplitOpen(false);
                            setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                          }}
                          className="p-1 rounded hover:bg-rose-500/20 hover:text-rose-400 text-slate-400 transition-colors cursor-pointer"
                          title={t('hide_terminal_shortcut', 'Masquer le terminal (Ctrl+`)')}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Terminal Body */}
                    <div className="flex-1 min-h-0 relative overflow-hidden">
                      <TerminalTab
                        key={`split-${currentWorkspace}`}
                        currentWorkspace={currentWorkspace}
                        compact={true}
                        onClose={() => {
                          setIsTerminalSplitOpen(false);
                          setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                        }}
                      />
                    </div>
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
              <span>{t('artifacts_count', 'Artifacts ({0})', artifacts.length)}</span>
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
                  <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>{t('no_artifacts', 'No artifacts')}</div>
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
                              const isBlock = Boolean(match) || (typeof inline === 'boolean' ? !inline : String(children).includes('\n'));
                              if (isBlock) {
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
                    {t('select_document_to_view', 'Select a document to display.')}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>

    {/* Copilot Action Modal for Workspace Panel */}
    {activeTabItem && !activeTabItem.isBinary && (
      <CopilotActionModal
        isOpen={isCopilotActionOpen}
        code={activeTabItem.content}
        language={activeTabItem.language}
        filePath={activeTabItem.path}
        theme={monacoTheme}
        onClose={() => setIsCopilotActionOpen(false)}
        onApply={(newCode) => {
          handleEditorChange(newCode);
          if (monacoEditorRef.current && typeof monacoEditorRef.current.setValue === 'function') {
            monacoEditorRef.current.setValue(newCode);
          }
        }}
      />
    )}
    </>
  );
});
