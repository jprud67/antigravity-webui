import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
   X, 
   Folder, 
   FolderOpen, 
   FileCode, 
   FileText, 
   File, 
   Search, 
   Copy, 
   ClipboardCopy, 
   Check, 
   CornerDownLeft, 
   RefreshCw,
   HardDrive,
   ChevronLeft,
   Upload,
   FolderUp,
   FilePlus,
   FolderPlus,
   Trash2,
   Edit2,
   Download
 } from 'lucide-react';
import { 
  fetchFileTree, 
  fetchFileContent,
  createFile,
  createDirectory,
  renameFile,
  deleteFile,
  uploadWorkspaceFile,
  duplicateWorkspaceFile,
  getAuthToken,
  fetchSettings
} from '../services/api';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { UploadProgressCard, type UploadProgressInfo } from './UploadProgressCard';

interface FileExplorerModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  onInsertPath: (path: string) => void;
}

interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  last_modified: number;
  children?: FileNode[];
}

export const FileExplorerModal: React.FC<FileExplorerModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  onInsertPath,
}) => {
  const { t } = useI18n();
  const [tree, setTree] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  
  // Selected file preview
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [copiedRel, setCopiedRel] = useState(false);
  const [copiedAbs, setCopiedAbs] = useState(false);

  // Upload and file operations state
  const [uploadTargetDir, setUploadTargetDir] = useState<string | null>(null);
  const [creatingType, setCreatingType] = useState<'file' | 'folder' | null>(null);
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamedName, setRenamedName] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [appSettings, setAppSettings] = useState<any>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgressInfo | null>(null);
  const uploadDismissTimeoutRef = useRef<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (uploadDismissTimeoutRef.current) {
        clearTimeout(uploadDismissTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    fetchSettings().then(setAppSettings).catch(console.error);
  }, [isOpen]);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    node: FileNode;
  } | null>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handleClose = () => setContextMenu(null);
    window.addEventListener('click', handleClose);
    window.addEventListener('contextmenu', handleClose);
    return () => {
      window.removeEventListener('click', handleClose);
      window.removeEventListener('contextmenu', handleClose);
    };
  }, [contextMenu]);

  const getRelativePath = useCallback((fullPath: string) => {
    if (!fullPath) return '';
    const normFull = fullPath.replace(/\\/g, '/');
    const normRoot = (currentWorkspace || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (normRoot && normFull.startsWith(normRoot)) {
      const rel = normFull.slice(normRoot.length).replace(/^\/+/, '');
      return rel || '.';
    }
    return normFull;
  }, [currentWorkspace]);

  const isImageFile = useCallback((p?: string | null) => {
    if (!p) return false;
    return /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)$/i.test(p);
  }, []);

  const isBinaryFile = useCallback((p?: string | null) => {
    if (!p) return false;
    return /\.(docx?|pdf|zip|tar|gz|tgz|7z|rar|xlsx?|pptx?|bin|exe|iso)$/i.test(p);
  }, []);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchFileTree(currentWorkspace, 3);
      setTree(data.items || []);
      // Auto-expand root children
      const initialExp: Record<string, boolean> = {};
      (data.items || []).forEach((item: FileNode) => {
        if (item.is_dir) initialExp[item.path] = true;
      });
      setExpandedPaths(initialExp);
    } catch (e) {
      console.error('Error loading file tree:', e);
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!isOpen) return;
    loadTree();
  }, [isOpen, loadTree]);

  // Recursively extract files from DataTransferItems
  const getFilesFromDataTransfer = useCallback(async (dataTransfer: DataTransfer): Promise<Array<{ file: File; relativePath?: string }>> => {
    const results: Array<{ file: File; relativePath?: string }> = [];
    const items = dataTransfer.items;
    if (items && items.length > 0 && typeof (items[0] as any).webkitGetAsEntry === 'function') {
      const traverseEntry = async (entry: any, currentPath = '') => {
        if (!entry) return;
        if (entry.isFile) {
          try {
            const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
            const rel = currentPath ? `${currentPath}/${file.name}` : file.name;
            results.push({ file, relativePath: rel });
          } catch (e) {
            console.error('Failed to read file entry:', e);
          }
        } else if (entry.isDirectory) {
          try {
            const dirReader = entry.createReader();
            const readEntries = async (): Promise<any[]> => {
              return new Promise((resolve, reject) => {
                dirReader.readEntries((ents: any[]) => resolve(ents), reject);
              });
            };
            let ents = await readEntries();
            while (ents.length > 0) {
              for (const sub of ents) {
                await traverseEntry(sub, currentPath ? `${currentPath}/${entry.name}` : entry.name);
              }
              ents = await readEntries();
            }
          } catch (e) {
            console.error('Failed to read directory entry:', e);
          }
        }
      };
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file') {
          const entry = (item as any).webkitGetAsEntry();
          if (entry) {
            await traverseEntry(entry);
          } else {
            const f = item.getAsFile();
            if (f) results.push({ file: f });
          }
        }
      }
      if (results.length > 0) return results;
    }

    if (dataTransfer.files && dataTransfer.files.length > 0) {
      for (let i = 0; i < dataTransfer.files.length; i++) {
        const f = dataTransfer.files[i];
        results.push({ file: f, relativePath: (f as any).webkitRelativePath || undefined });
      }
    }
    return results;
  }, []);

  const handleUploadFiles = useCallback(async (
    files: FileList | File[] | Array<{ file: File; relativePath?: string }>,
    targetFolder?: string
  ) => {
    if (!files || (Array.isArray(files) && files.length === 0) || ('length' in files && files.length === 0)) return;

    const items: Array<{ file: File; relativePath?: string }> = [];
    if (Array.isArray(files)) {
      for (const item of files) {
        if ('file' in (item as any) && (item as any).file instanceof File) {
          items.push({ file: (item as any).file, relativePath: (item as any).relativePath });
        } else if (item instanceof File) {
          items.push({ file: item as File, relativePath: (item as any).webkitRelativePath || undefined });
        }
      }
    } else {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        items.push({ file, relativePath: (file as any).webkitRelativePath || undefined });
      }
    }
    if (items.length === 0) return;

    const destination = targetFolder || (creatingParent && !creatingType ? creatingParent : null) || currentWorkspace || '.';
    let successCount = 0;

    const maxMB = appSettings?.fileManagerMaxUploadSizeMB ?? 50;
    const maxBytes = maxMB * 1024 * 1024;
    const allowedStr = (appSettings?.fileManagerAllowedExtensions || '').trim();
    const blockedStr = (appSettings?.fileManagerBlockedExtensions || '').trim();

    const allowedSet = (allowedStr && allowedStr !== '*')
      ? new Set(allowedStr.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean).map((s: string) => s.startsWith('.') ? s : `.${s}`))
      : null;

    const blockedSet = blockedStr
      ? new Set(blockedStr.split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean).map((s: string) => s.startsWith('.') ? s : `.${s}`))
      : null;

    const validItems: typeof items = [];
    for (const item of items) {
      const ext = ('.' + (item.file.name.split('.').pop() || '')).toLowerCase();
      if (blockedSet && blockedSet.has(ext)) {
        showToast(t('upload_ext_blocked', "L'extension « {0} » est bloquée par vos paramètres.", ext), 'error');
        continue;
      }
      if (allowedSet && !allowedSet.has(ext)) {
        showToast(t('upload_ext_not_allowed', "L'extension « {0} » n'est pas autorisée par vos paramètres.", ext), 'error');
        continue;
      }
      if (item.file.size > maxBytes) {
        showToast(t('upload_size_exceeded', "Le fichier « {0} » ({1} Mo) dépasse la limite configurée de {2} Mo.", item.file.name, (item.file.size / (1024 * 1024)).toFixed(1), maxMB), 'error');
        continue;
      }
      validItems.push(item);
    }

    if (validItems.length === 0) return;

    if (uploadDismissTimeoutRef.current) {
      clearTimeout(uploadDismissTimeoutRef.current);
      uploadDismissTimeoutRef.current = null;
    }

    setUploadProgress({
      totalFiles: validItems.length,
      completedFiles: 0,
      currentFileIndex: 1,
      currentFileName: validItems[0].file.name,
      filePercent: 0,
      fileLoaded: 0,
      fileTotal: validItems[0].file.size,
      status: 'uploading',
    });

    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      setUploadProgress(prev => prev ? ({
        ...prev,
        currentFileIndex: i + 1,
        currentFileName: item.file.name,
        filePercent: 0,
        fileLoaded: 0,
        fileTotal: item.file.size,
      }) : null);

      try {
        const res = await uploadWorkspaceFile(
          item.file,
          destination,
          currentWorkspace,
          item.relativePath,
          (percent, loaded, total) => {
            setUploadProgress(prev => prev ? ({
              ...prev,
              filePercent: percent,
              fileLoaded: loaded,
              fileTotal: total,
            }) : null);
          }
        );
        if (res.success) {
          successCount++;
          setUploadProgress(prev => prev ? ({
            ...prev,
            completedFiles: successCount,
            filePercent: 100,
            fileLoaded: item.file.size,
            fileTotal: item.file.size,
          }) : null);
        }
      } catch (err: any) {
        showToast(t('import_error_for_file', "Erreur d'import pour {0} : {1}", item.file.name, err.message), 'error');
        setUploadProgress(prev => prev ? ({
          ...prev,
          status: 'error',
          errorMessage: err.message || t('import_error', "Erreur d'import"),
        }) : null);
      }
    }

    if (successCount > 0) {
      setUploadProgress(prev => prev ? ({
        ...prev,
        status: 'completed',
        completedFiles: successCount,
        filePercent: 100,
      }) : null);
      showToast(t('files_imported_count_success', '{0} fichier(s) importé(s) avec succès.', successCount), 'success');
      await loadTree();
      uploadDismissTimeoutRef.current = setTimeout(() => {
        setUploadProgress(null);
      }, 2500);
    } else {
      uploadDismissTimeoutRef.current = setTimeout(() => {
        setUploadProgress(null);
      }, 4000);
    }
  }, [appSettings, creatingParent, creatingType, currentWorkspace, loadTree, t]);

  const triggerUploadToFolder = useCallback((folderPath?: string) => {
    setUploadTargetDir(folderPath || null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  }, []);

  const triggerUploadFolderToFolder = useCallback((folderPath?: string) => {
    setUploadTargetDir(folderPath || null);
    if (folderInputRef.current) {
      folderInputRef.current.value = '';
      folderInputRef.current.click();
    }
  }, []);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files, uploadTargetDir || undefined);
      e.target.value = '';
      setUploadTargetDir(null);
    }
  };

  const handleFolderInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleUploadFiles(e.target.files, uploadTargetDir || undefined);
      e.target.value = '';
      setUploadTargetDir(null);
    }
  };

  const handleDropFiles = useCallback(async (e: React.DragEvent, targetFolder?: string) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    setDragOverFolder(null);
    const files = await getFilesFromDataTransfer(e.dataTransfer);
    if (files.length > 0) {
      await handleUploadFiles(files, targetFolder);
    }
  }, [getFilesFromDataTransfer, handleUploadFiles]);

  const handleCreateNewItem = useCallback(async () => {
    if (!newItemName.trim() || !creatingType) return;
    const name = newItemName.trim();
    const base = (creatingParent || currentWorkspace || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const targetPath = base ? `${base}/${name}` : name;

    try {
      if (creatingType === 'file') {
        await createFile(targetPath, '', currentWorkspace);
        showToast(t('file_created_success_named', 'Fichier « {0} » créé avec succès', name), 'success');
      } else {
        await createDirectory(targetPath, currentWorkspace);
        showToast(t('folder_created_success_named', 'Dossier « {0} » créé avec succès', name), 'success');
      }
      setCreatingType(null);
      setNewItemName('');
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création', 'error');
    }
  }, [newItemName, creatingType, creatingParent, currentWorkspace, loadTree, t]);

  const handleRenameItem = useCallback(async () => {
    if (!renamingPath || !renamedName.trim()) return;
    const newName = renamedName.trim();
    const norm = renamingPath.replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = norm.split('/');
    parts.pop();
    const parentDir = parts.join('/');
    const newPath = parentDir ? `${parentDir}/${newName}` : newName;

    try {
      await renameFile(renamingPath, newPath, currentWorkspace);
      showToast(t('renamed_to_named', 'Renommé en « {0} »', newName), 'success');
      setRenamingPath(null);
      setRenamedName('');
      if (selectedFile === renamingPath) {
        setSelectedFile(newPath);
      }
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors du renommage', 'error');
    }
  }, [renamingPath, renamedName, currentWorkspace, selectedFile, loadTree, t]);

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
      if (selectedFile && (selectedFile === path || selectedFile.startsWith(`${path}/`))) {
        setSelectedFile(null);
        setFileContent(null);
      }
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    }
  }, [currentWorkspace, selectedFile, loadTree, t]);

  const handleDuplicateFile = useCallback(async (path: string) => {
    try {
      const res = await duplicateWorkspaceFile(path, currentWorkspace);
      showToast(t('file_duplicated_named', 'Fichier dupliqué : {0}', res.new_name), 'success');
      await loadTree();
    } catch (err: any) {
      showToast(err.message || 'Erreur de duplication', 'error');
    }
  }, [currentWorkspace, loadTree, t]);

  const handleDownloadFile = useCallback((filePath: string) => {
    try {
      const filename = filePath.split(/[/\\]/).pop() || 'file';
      const token = getAuthToken();
      const downloadUrl = `/api/files/download?path=${encodeURIComponent(filePath)}${currentWorkspace ? `&workspace=${encodeURIComponent(currentWorkspace)}` : ''}${token ? `&token=${encodeURIComponent(token)}` : ''}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      showToast(t('download_started_named', 'Téléchargement de « {0} » lancé', filename), 'success');
    } catch (err: any) {
      showToast(t('error_downloading_file', 'Erreur lors du téléchargement : {0}', err.message || err), 'error');
    }
  }, [currentWorkspace, t]);

  const toggleFolder = (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedPaths((prev) => ({ ...prev, [path]: !prev[path] }));
  };

  const handleSelectFile = async (node: FileNode) => {
    if (node.is_dir) {
      setExpandedPaths((prev) => ({ ...prev, [node.path]: !prev[node.path] }));
      return;
    }

    setSelectedFile(node.path);
    if (isImageFile(node.path) || isBinaryFile(node.path)) {
      setFileContent(null);
      setContentLoading(false);
      return;
    }

    setContentLoading(true);
    try {
      const data = await fetchFileContent(node.path);
      setFileContent(data.content);
    } catch (err: any) {
      setFileContent(`// ${t('file_explorer_load_error', 'Unable to load file')}: ${err.message}`);
    } finally {
      setContentLoading(false);
    }
  };

  const copyText = async (text: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      return true;
    } catch {
      return false;
    }
  };

  const copyRelativePath = async (path: string) => {
    const rel = getRelativePath(path);
    const ok = await copyText(rel);
    if (ok) {
      setCopiedRel(true);
      setTimeout(() => setCopiedRel(false), 2000);
    }
  };

  const copyAbsolutePath = async (path: string) => {
    const ok = await copyText(path);
    if (ok) {
      setCopiedAbs(true);
      setTimeout(() => setCopiedAbs(false), 2000);
    }
  };

  const insertAndClose = (path: string) => {
    const rel = getRelativePath(path);
    onInsertPath(`@${rel} `);
    onClose();
  };

  const getFileIcon = (name: string) => {
    if (name.endsWith('.ts') || name.endsWith('.tsx') || name.endsWith('.js') || name.endsWith('.py')) {
      return <FileCode className="w-3.5 h-3.5 text-sky-400 shrink-0" />;
    }
    if (name.endsWith('.md') || name.endsWith('.txt') || name.endsWith('.json')) {
      return <FileText className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
    }
    return <File className="w-3.5 h-3.5 text-slate-500 shrink-0" />;
  };

  const filterNodes = (nodes: FileNode[], query: string): FileNode[] => {
    if (!query.trim()) return nodes;
    const lower = query.toLowerCase();

    return nodes.reduce<FileNode[]>((acc, node) => {
      const matchName = node.name.toLowerCase().includes(lower);
      if (node.is_dir && node.children) {
        const matchingChildren = filterNodes(node.children, query);
        if (matchName || matchingChildren.length > 0) {
          acc.push({ ...node, children: matchingChildren });
        }
      } else if (matchName) {
        acc.push(node);
      }
      return acc;
    }, []);
  };

  const renderTree = (nodes: FileNode[], depth = 0) => {
    return nodes.map((node) => {
      const isExpanded = !!expandedPaths[node.path];
      const isSelected = selectedFile === node.path;
      const isDragTarget = dragOverFolder === node.path;

      return (
        <div key={node.path} className="flex flex-col">
          <div
            onClick={() => handleSelectFile(node)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setContextMenu({
                x: Math.min(e.clientX, window.innerWidth - 220),
                y: Math.min(e.clientY, window.innerHeight - 200),
                node
              });
            }}
            onDragOver={(e) => {
              if (node.is_dir) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolder(node.path);
              }
            }}
            onDragLeave={(e) => {
              if (node.is_dir) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolder(null);
              }
            }}
            onDrop={(e) => {
              if (node.is_dir) {
                e.preventDefault();
                e.stopPropagation();
                setDragOverFolder(null);
                handleDropFiles(e, node.path);
              }
            }}
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            className={`py-1.5 pr-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-colors group ${
              isDragTarget
                ? 'bg-sky-500/30 border-2 border-dashed border-sky-400 text-sky-200'
                : isSelected
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-200 border border-sky-500/30'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
            }`}
          >
            {renamingPath === node.path ? (
              <div className="flex items-center gap-1 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  autoFocus
                  value={renamedName}
                  onChange={(e) => setRenamedName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRenameItem();
                    if (e.key === 'Escape') setRenamingPath(null);
                  }}
                  className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded border border-sky-500 font-mono outline-none"
                  style={{
                    backgroundColor: 'var(--surface)',
                    color: 'var(--text)'
                  }}
                />
                <button
                  type="button"
                  onClick={handleRenameItem}
                  className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                  title="OK"
                >
                  <Check className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => setRenamingPath(null)}
                  className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
                  title="Cancel"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 truncate flex-1 min-w-0 mr-1">
                  {node.is_dir ? (
                    <button
                      onClick={(e) => toggleFolder(node.path, e)}
                      className="p-0.5 hover:text-sky-400 cursor-pointer"
                    >
                      {isExpanded ? (
                        <FolderOpen className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      ) : (
                        <Folder className="w-3.5 h-3.5 text-amber-500/80 shrink-0" />
                      )}
                    </button>
                  ) : (
                    getFileIcon(node.name)
                  )}
                  <span className={`font-mono truncate ${node.is_dir ? 'font-semibold text-slate-300' : ''}`}>
                    {node.name}
                  </span>
                </div>

                <div className="flex items-center gap-0.5 shrink-0">
                  {node.is_dir && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreatingParent(node.path);
                          setCreatingType('file');
                          setExpandedPaths(prev => ({ ...prev, [node.path]: true }));
                        }}
                        title={t('new_file', 'Nouveau fichier')}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-opacity cursor-pointer text-slate-400 hover:text-emerald-400"
                      >
                        <FilePlus className="w-3 h-3" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          triggerUploadToFolder(node.path);
                        }}
                        title={t('upload_files_here', 'Importer des fichiers ici')}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-opacity cursor-pointer text-slate-400 hover:text-sky-400"
                      >
                        <Upload className="w-3 h-3" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyRelativePath(node.path);
                    }}
                    title={t('copy_relative_path', 'Copier le chemin relatif')}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:bg-black/10 dark:hover:bg-white/10 rounded transition-opacity cursor-pointer"
                    style={{ color: 'var(--muted)' }}
                  >
                    <Copy className="w-3 h-3 hover:text-sky-500" />
                  </button>

                  {!node.is_dir && (
                    <span className="text-[10px] text-slate-600 font-mono group-hover:text-slate-400 transition-colors">
                      {(node.size / 1024).toFixed(0)} KB
                    </span>
                  )}
                </div>
              </>
            )}
          </div>

          {node.is_dir && isExpanded && (
            <div>
              {creatingParent === node.path && creatingType && (
                <div
                  style={{ paddingLeft: `${(depth + 1) * 14 + 10}px` }}
                  className="py-1 pr-2.5 flex items-center gap-1.5 animate-fadeIn"
                >
                  {creatingType === 'folder' ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
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
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded border border-sky-500 font-mono outline-none"
                    style={{
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewItem}
                    className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                    title="OK"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingType(null)}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {node.children && renderTree(node.children, depth + 1)}
            </div>
          )}
        </div>
      );
    });
  };

  if (!isOpen) return null;

  const filteredTree = filterNodes(tree, searchQuery);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-2 sm:p-6 animate-fadeIn safe-pt safe-pb">
      <div
        className="w-[1050px] max-w-full h-[92dvh] sm:h-[85vh] border rounded-2xl sm:rounded-3xl flex flex-col shadow-2xl overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="h-14 px-4 sm:px-6 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center">
              <HardDrive className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-xs font-semibold" style={{ color: 'var(--strong)' }}>{t('file_explorer_title', 'Workspace Explorer')}</h2>
              <p className="text-[10px] font-mono truncate max-w-xs sm:max-w-md" style={{ color: 'var(--muted)' }}>{currentWorkspace}</p>
            </div>
          </div>

          <div className="flex items-center gap-1 sm:gap-1.5">
            <button
              onClick={() => {
                setCreatingParent(null);
                setCreatingType('file');
                setNewItemName('');
              }}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-slate-400 hover:text-emerald-400 transition-colors"
              title={t('new_file', 'Nouveau fichier')}
            >
              <FilePlus className="w-4 h-4" />
            </button>
            <button
              onClick={() => {
                setCreatingParent(null);
                setCreatingType('folder');
                setNewItemName('');
              }}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-slate-400 hover:text-amber-400 transition-colors"
              title={t('new_folder', 'Nouveau dossier')}
            >
              <FolderPlus className="w-4 h-4" />
            </button>
            <button
              onClick={() => triggerUploadToFolder()}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-slate-400 hover:text-sky-400 transition-colors"
              title={t('upload_files', 'Importer des fichiers')}
            >
              <Upload className="w-4 h-4" />
            </button>
            <button
              onClick={() => triggerUploadFolderToFolder()}
              className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer text-slate-400 hover:text-violet-400 transition-colors"
              title={t('upload_folder', 'Importer un dossier')}
            >
              <FolderUp className="w-4 h-4" />
            </button>
            <div className="h-4 w-px bg-slate-300 dark:bg-slate-700 mx-1" />
            <button
              onClick={loadTree}
              className="p-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: 'var(--muted)' }}
              title={t('refresh', 'Refresh')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors cursor-pointer"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Hidden File / Folder Upload Inputs */}
        <input
          type="file"
          ref={fileInputRef}
          multiple
          accept={appSettings?.fileManagerAllowedExtensions && appSettings.fileManagerAllowedExtensions !== '*' ? appSettings.fileManagerAllowedExtensions : undefined}
          onChange={handleFileInputChange}
          className="hidden"
        />
        <input
          type="file"
          ref={folderInputRef}
          multiple
          {...({ webkitdirectory: '', directory: '' } as any)}
          onChange={handleFolderInputChange}
          className="hidden"
        />

        {/* Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* File Tree Left Pane */}
          <div
            className={`${selectedFile ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 border-r flex flex-col shrink-0 relative`}
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setIsDraggingOver(false);
              }
            }}
            onDrop={(e) => handleDropFiles(e)}
          >
            {isDraggingOver && (
              <div className="absolute inset-0 z-20 bg-sky-500/15 border-2 border-dashed border-sky-400 flex flex-col items-center justify-center p-4 backdrop-blur-xs pointer-events-none">
                <Upload className="w-8 h-8 text-sky-400 animate-bounce mb-2" />
                <p className="text-xs font-semibold text-sky-300">{t('drop_files_here', 'Déposez vos fichiers ou dossiers ici')}</p>
              </div>
            )}

            {/* Search Input */}
            <div className="p-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder={t('file_explorer_search_placeholder', 'Search a file...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8.5 pr-3 py-1.5 rounded-xl text-xs font-mono border focus:outline-none"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>
            </div>

            {/* Upload Progress Indicator */}
            {uploadProgress && (
              <div className="p-2 border-b shrink-0 animate-fadeIn" style={{ borderColor: 'var(--border)' }}>
                <UploadProgressCard
                  progress={uploadProgress}
                  onDismiss={() => {
                    if (uploadDismissTimeoutRef.current) {
                      clearTimeout(uploadDismissTimeoutRef.current);
                    }
                    setUploadProgress(null);
                  }}
                />
              </div>
            )}

            {/* Tree nodes */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
              {creatingType && !creatingParent && (
                <div className="px-2.5 py-1 mb-1.5 flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/10 animate-fadeIn">
                  {creatingType === 'folder' ? (
                    <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  ) : (
                    <File className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  )}
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
                    className="flex-1 min-w-0 px-1.5 py-0.5 text-xs rounded border border-sky-500 font-mono outline-none"
                    style={{
                      backgroundColor: 'var(--surface)',
                      color: 'var(--text)'
                    }}
                  />
                  <button
                    type="button"
                    onClick={handleCreateNewItem}
                    className="p-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                    title="OK"
                  >
                    <Check className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setCreatingType(null)}
                    className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 cursor-pointer"
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              )}
              {filteredTree.length === 0 ? (
                <div className="p-6 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  {loading ? t('loading', 'Loading...') : t('file_explorer_no_files', 'No files found.')}
                </div>
              ) : (
                renderTree(filteredTree)
              )}
            </div>
          </div>

          {/* File Preview Right Pane */}
          <div
            className={`${!selectedFile ? 'hidden sm:flex' : 'flex'} flex-1 flex flex-col overflow-hidden`}
            style={{ backgroundColor: 'var(--main-bg, var(--surface))' }}
          >
            {selectedFile ? (
              <>
                <div
                  className="px-3 sm:px-5 py-2.5 border-b flex items-center justify-between shrink-0 text-xs gap-2"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)'
                  }}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <button
                      onClick={() => setSelectedFile(null)}
                      className="sm:hidden py-1 px-2 rounded-lg border text-[10px] flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      <span>{t('file_explorer_tree', 'Tree')}</span>
                    </button>
                    <span className="font-mono truncate max-w-[140px] sm:max-w-md font-semibold text-[11px]" style={{ color: 'var(--strong)' }}>
                      {selectedFile}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDownloadFile(selectedFile)}
                      className="py-1 px-2 sm:px-2.5 rounded-lg border text-[10px] flex items-center gap-1.5 transition-colors cursor-pointer font-mono hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                      title={t('download_file', 'Télécharger le fichier')}
                    >
                      <Download className="w-3 h-3 text-slate-400" />
                      <span className="hidden xs:inline">{t('download', 'Télécharger')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyRelativePath(selectedFile)}
                      className="py-1 px-2 sm:px-2.5 rounded-lg border text-[10px] flex items-center gap-1.5 transition-colors cursor-pointer font-mono hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                      title={t('copy_relative_path', 'Copier le chemin relatif')}
                    >
                      {copiedRel ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3 text-sky-500" />}
                      <span className="hidden xs:inline">{copiedRel ? t('copied', 'Copié !') : t('copy_rel_short', 'Relatif')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => copyAbsolutePath(selectedFile)}
                      className="py-1 px-2 sm:px-2.5 rounded-lg border text-[10px] flex items-center gap-1.5 transition-colors cursor-pointer font-mono hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                      title={t('copy_absolute_path', 'Copier le chemin absolu')}
                    >
                      {copiedAbs ? <Check className="w-3 h-3 text-emerald-500" /> : <ClipboardCopy className="w-3 h-3 text-indigo-500" />}
                      <span className="hidden xs:inline">{copiedAbs ? t('copied', 'Copié !') : t('copy_abs_short', 'Absolu')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => insertAndClose(selectedFile)}
                      className="py-1 px-2.5 sm:px-3 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                      title={t('insert_in_prompt', 'Insérer dans le prompt')}
                    >
                      <CornerDownLeft className="w-3 h-3" />
                      <span>{t('insert', 'Insérer')}</span>
                    </button>
                  </div>
                </div>

                <div
                  className="flex-1 overflow-auto p-4"
                  style={{
                    backgroundColor: 'var(--main-bg, var(--surface))',
                    color: 'var(--text)'
                  }}
                >
                  {contentLoading ? (
                    <div className="flex items-center justify-center h-full text-xs font-mono" style={{ color: 'var(--muted)' }}>
                      {t('file_explorer_loading_content', 'Loading content...')}
                    </div>
                  ) : isImageFile(selectedFile) ? (
                    <div className="flex items-center justify-center h-full p-4 overflow-auto">
                      <img
                        src={`/api/files/download?path=${encodeURIComponent(selectedFile)}${getAuthToken() ? `&token=${encodeURIComponent(getAuthToken()!)}` : ''}`}
                        alt={selectedFile}
                        className="max-w-full max-h-full object-contain rounded-lg shadow-sm border"
                        style={{ borderColor: 'var(--border)' }}
                      />
                    </div>
                  ) : isBinaryFile(selectedFile) ? (
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center gap-3">
                      <File className="w-12 h-12 text-slate-500" />
                      <p className="text-xs text-slate-400">{t('binary_file_preview_unavailable', 'Aperçu binaire non disponible')}</p>
                      <button
                        type="button"
                        onClick={() => handleDownloadFile(selectedFile)}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-lg text-xs flex items-center gap-2 cursor-pointer shadow-xs transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>{t('download_file', 'Télécharger le fichier')}</span>
                      </button>
                    </div>
                  ) : (
                    <pre className="font-mono text-[11px] leading-relaxed whitespace-pre" style={{ color: 'var(--text)' }}>
                      {fileContent}
                    </pre>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-xs space-y-2 p-6" style={{ color: 'var(--muted)' }}>
                <FileCode className="w-10 h-10" style={{ color: 'var(--muted)' }} />
                <p>{t('file_explorer_click_to_inspect', 'Click a file in the tree to inspect it')}</p>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{t('file_explorer_insert_hint', 'You can also insert it directly into your prompt with the @ prefix')}</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Context Menu */}
      {contextMenu && (
        <div
          style={{
            top: `${contextMenu.y}px`,
            left: `${contextMenu.x}px`,
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border2, var(--border))',
            color: 'var(--text)'
          }}
          className="fixed z-50 min-w-[210px] py-1.5 rounded-xl border shadow-2xl backdrop-blur-md text-xs font-sans animate-fadeIn select-none"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] font-mono border-b truncate" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            {getRelativePath(contextMenu.node.path)}
          </div>

          {contextMenu.node.is_dir ? (
            <>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  setCreatingParent(p);
                  setCreatingType('file');
                  setExpandedPaths(prev => ({ ...prev, [p]: true }));
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer text-emerald-400"
              >
                <FilePlus className="w-3.5 h-3.5" />
                <span>{t('new_file', 'Nouveau fichier')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  setCreatingParent(p);
                  setCreatingType('folder');
                  setExpandedPaths(prev => ({ ...prev, [p]: true }));
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer text-amber-400"
              >
                <FolderPlus className="w-3.5 h-3.5" />
                <span>{t('new_folder', 'Nouveau dossier')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  triggerUploadToFolder(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer text-sky-400"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>{t('upload_files_here', 'Importer des fichiers ici')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  triggerUploadFolderToFolder(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer text-violet-400"
              >
                <FolderUp className="w-3.5 h-3.5" />
                <span>{t('upload_folder_here', 'Importer un dossier ici')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  handleDownloadFile(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                style={{ color: 'var(--text)' }}
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('download_as_zip', 'Télécharger (.zip)')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  handleDuplicateFile(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                style={{ color: 'var(--text)' }}
              >
                <Copy className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t('duplicate', 'Dupliquer')}</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  insertAndClose(contextMenu.node.path);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer text-sky-500 font-medium"
              >
                <CornerDownLeft className="w-3.5 h-3.5" />
                <span>{t('insert_in_prompt', 'Insérer dans le prompt')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  handleDownloadFile(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                style={{ color: 'var(--text)' }}
              >
                <Download className="w-3.5 h-3.5 text-sky-400" />
                <span>{t('download_file', 'Télécharger le fichier')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const p = contextMenu.node.path;
                  setContextMenu(null);
                  handleDuplicateFile(p);
                }}
                className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
                style={{ color: 'var(--text)' }}
              >
                <Copy className="w-3.5 h-3.5 text-indigo-400" />
                <span>{t('duplicate', 'Dupliquer')}</span>
              </button>
            </>
          )}

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

          <button
            type="button"
            onClick={() => {
              copyRelativePath(contextMenu.node.path);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between transition-colors cursor-pointer"
            style={{ color: 'var(--text)' }}
          >
            <span className="flex items-center gap-2">
              <Copy className="w-3.5 h-3.5 text-sky-500" />
              <span>{t('copy_relative_path', 'Copier le chemin relatif')}</span>
            </span>
            <span className="text-[10px] font-mono opacity-50">rel</span>
          </button>
          <button
            type="button"
            onClick={() => {
              copyAbsolutePath(contextMenu.node.path);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center justify-between transition-colors cursor-pointer"
            style={{ color: 'var(--text)' }}
          >
            <span className="flex items-center gap-2">
              <ClipboardCopy className="w-3.5 h-3.5 text-indigo-500" />
              <span>{t('copy_absolute_path', 'Copier le chemin absolu')}</span>
            </span>
            <span className="text-[10px] font-mono opacity-50">abs</span>
          </button>
          <button
            type="button"
            onClick={() => {
              copyText(contextMenu.node.name);
              setContextMenu(null);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
            style={{ color: 'var(--text)' }}
          >
            <FileText className="w-3.5 h-3.5 text-slate-400" />
            <span>{t('copy_name', 'Copier le nom')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const p = contextMenu.node.path;
              const n = contextMenu.node.name;
              setContextMenu(null);
              setRenamingPath(p);
              setRenamedName(n);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/5 flex items-center gap-2 transition-colors cursor-pointer"
            style={{ color: 'var(--text)' }}
          >
            <Edit2 className="w-3.5 h-3.5 text-amber-400" />
            <span>{t('rename', 'Renommer')}</span>
          </button>

          <div className="h-px bg-slate-200 dark:bg-slate-800 my-1" />

          <button
            type="button"
            onClick={() => {
              const { path, is_dir, name } = contextMenu.node;
              setContextMenu(null);
              handleDeleteItem(path, is_dir, name);
            }}
            className="w-full text-left px-3 py-1.5 hover:bg-red-500/10 text-red-400 flex items-center gap-2 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400" />
            <span>{t('delete', 'Supprimer')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
