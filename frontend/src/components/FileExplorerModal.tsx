import React, { useState, useEffect, useCallback } from 'react';
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
   ChevronLeft
 } from 'lucide-react';
import { fetchFileTree, fetchFileContent } from '../services/api';
import { useI18n } from '../services/i18n';

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
    let active = true;
    fetchFileTree(currentWorkspace, 3)
      .then((data) => {
        if (active) {
          setTree(data.items || []);
          const initialExp: Record<string, boolean> = {};
          (data.items || []).forEach((item: FileNode) => {
            if (item.is_dir) initialExp[item.path] = true;
          });
          setExpandedPaths(initialExp);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) {
          console.error('Error loading file tree:', e);
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, currentWorkspace]);

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
            style={{ paddingLeft: `${depth * 14 + 10}px` }}
            className={`py-1.5 pr-2.5 rounded-lg flex items-center justify-between text-xs cursor-pointer transition-colors group ${
              isSelected
                ? 'bg-sky-500/20 text-sky-600 dark:text-sky-200 border border-sky-500/30'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200/60 dark:hover:bg-slate-800/60'
            }`}
          >
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

            <div className="flex items-center gap-1 shrink-0">
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
          </div>

          {node.is_dir && isExpanded && node.children && (
            <div>{renderTree(node.children, depth + 1)}</div>
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

          <div className="flex items-center gap-2">
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

        {/* Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* File Tree Left Pane */}
          <div
            className={`${selectedFile ? 'hidden sm:flex' : 'flex'} w-full sm:w-80 border-r flex flex-col shrink-0`}
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)'
            }}
          >
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

            {/* Tree nodes */}
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
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
          {!contextMenu.node.is_dir && (
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
          )}
        </div>
      )}
    </div>
  );
};
