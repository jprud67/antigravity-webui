import React, { useState, useEffect, useCallback } from 'react';
import { X, Folder, FolderPlus, Check, ArrowUp, Trash2 } from 'lucide-react';
import type { WorkspaceFolder } from '../types';
import { fetchWorkspaces, exploreDirectory, addWorkspace, deleteWorkspace } from '../services/api';
import { useI18n } from '../services/i18n';

interface WorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  onSelectWorkspace: (path: string) => void;
}

export const WorkspaceModal: React.FC<WorkspaceModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  onSelectWorkspace,
}) => {
  const { t } = useI18n();
  const [trustedList, setTrustedList] = useState<string[]>([]);
  const [browserData, setBrowserData] = useState<WorkspaceFolder | null>(null);
  const [loading, setLoading] = useState(false);

  const loadWorkspaces = useCallback(async () => {
    const list = await fetchWorkspaces();
    setTrustedList(list);
  }, []);

  const explore = useCallback(async (path: string) => {
    setLoading(true);
    try {
      const data = await exploreDirectory(path);
      setBrowserData(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchWorkspaces().then((list) => {
      if (active) setTrustedList(list);
    });
    exploreDirectory(currentWorkspace || '/root').then((data) => {
      if (active) {
        setBrowserData(data);
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [isOpen, currentWorkspace]);

  const handleAddWorkspace = async (pathToAdd: string) => {
    await addWorkspace(pathToAdd);
    await loadWorkspaces();
    onSelectWorkspace(pathToAdd);
  };

  const handleDeleteWorkspace = async (e: React.MouseEvent, pathToDel: string) => {
    e.stopPropagation();
    try {
      const res = await deleteWorkspace(pathToDel);
      if (res?.workspaces) {
        setTrustedList(res.workspaces);
      } else {
        await loadWorkspaces();
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div
        className="w-[620px] max-w-full rounded-3xl shadow-2xl overflow-hidden flex flex-col border"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-5 border-b flex items-center justify-between"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold tracking-tight" style={{ color: 'var(--strong)' }}>{t('workspace_modal_title', 'Workspaces & Projects Management')}</h2>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>{t('workspace_modal_subtitle', 'Define the root directory where Antigravity operates')}</p>
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

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* Active / Trusted Workspaces */}
          <div className="space-y-2">
            <label className="font-semibold" style={{ color: 'var(--strong)' }}>{t('active_trusted_workspaces', 'Active & Authorized Workspaces')}</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {trustedList.map((ws) => {
                const isActive = ws === currentWorkspace;
                return (
                  <div
                    key={ws}
                    className="flex items-center justify-between p-3 rounded-xl border text-xs font-mono transition-all"
                    style={{
                      backgroundColor: isActive ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                      borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                      color: isActive ? 'var(--accent-text)' : 'var(--text)'
                    }}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-4 h-4 shrink-0 text-amber-500" />
                      <span className="truncate text-[11px]">{ws}</span>
                    </div>
                    {isActive ? (
                      <span className="text-[10px] px-2.5 py-0.5 rounded-full border flex items-center gap-1 font-sans font-medium shrink-0" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                        <Check className="w-3 h-3" /> {t('active', 'Active')}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => {
                            onSelectWorkspace(ws);
                            onClose();
                          }}
                          className="text-[11px] px-3 py-1 rounded-lg border transition-colors font-sans font-medium shrink-0 cursor-pointer"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)'
                          }}
                        >
                          {t('select', 'Select')}
                        </button>
                        <button
                          onClick={(e) => handleDeleteWorkspace(e, ws)}
                          title={t('remove_workspace', 'Remove from workspaces')}
                          className="p-1.5 rounded-lg border transition-colors cursor-pointer text-red-400 hover:text-red-300 hover:bg-red-500/10"
                          style={{
                            borderColor: 'var(--border)',
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Directory Navigator */}
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <label className="font-semibold" style={{ color: 'var(--strong)' }}>{t('local_folder_explorer', 'Local folder explorer')}</label>
            {browserData && (
              <div
                className="border rounded-2xl p-4 space-y-2.5 shadow-inner"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <div className="flex items-center justify-between font-mono text-[11px] pb-2.5 border-b" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                  <div className="flex items-center gap-1.5 truncate">
                    <span style={{ color: 'var(--muted)' }}>{t('folder', 'Folder')}:</span>
                    <span className="font-semibold truncate max-w-sm" style={{ color: 'var(--accent)' }}>{browserData.current_path}</span>
                  </div>
                  {browserData.parent_path && (
                    <button
                      onClick={() => explore(browserData.parent_path!)}
                      className="flex items-center gap-1 shrink-0 text-[11px] font-sans font-medium cursor-pointer"
                      style={{ color: 'var(--accent)' }}
                    >
                      <ArrowUp className="w-3 h-3" /> {t('parent_folder', 'Parent folder')}
                    </button>
                  )}
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                  {loading ? (
                    <div className="p-4 text-center" style={{ color: 'var(--muted)' }}>{t('loading', 'Loading...')}</div>
                  ) : (
                    browserData.entries
                      .filter((e) => e.is_dir)
                      .map((dir) => (
                        <div
                          key={dir.path}
                          className="flex items-center justify-between p-2 rounded-xl group transition-all"
                          style={{ color: 'var(--text)' }}
                        >
                          <button
                            onClick={() => explore(dir.path)}
                            className="flex items-center gap-2 font-mono text-[11px] truncate cursor-pointer"
                            style={{ color: 'var(--text)' }}
                          >
                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="truncate">{dir.name}</span>
                          </button>
                          <button
                            onClick={() => handleAddWorkspace(dir.path)}
                            className="text-[10px] font-semibold px-2.5 py-1 rounded-lg border opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 cursor-pointer"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                              color: 'var(--text)'
                            }}
                          >
                            <FolderPlus className="w-3 h-3" /> {t('workspace_use', 'Use')}
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex justify-end"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <button
            onClick={onClose}
            className="py-2 px-5 rounded-xl text-xs font-medium border transition-colors cursor-pointer"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {t('close', 'Close')}
          </button>
        </div>
      </div>
    </div>
  );
};
