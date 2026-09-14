import React, { useState, useEffect } from 'react';
import { X, Folder, FolderPlus, Check } from 'lucide-react';
import type { WorkspaceFolder } from '../types';
import { fetchWorkspaces, exploreDirectory, addWorkspace } from '../services/api';

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
  const [trustedList, setTrustedList] = useState<string[]>([]);
  const [browserData, setBrowserData] = useState<WorkspaceFolder | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadWorkspaces();
      explore(currentWorkspace || '/root');
    }
  }, [isOpen, currentWorkspace]);

  const loadWorkspaces = async () => {
    const list = await fetchWorkspaces();
    setTrustedList(list);
  };

  const explore = async (path: string) => {
    setLoading(true);
    try {
      const data = await exploreDirectory(path);
      setBrowserData(data);
    } finally {
      setLoading(false);
    }
  };

  const handleAddWorkspace = async (pathToAdd: string) => {
    await addWorkspace(pathToAdd);
    await loadWorkspaces();
    onSelectWorkspace(pathToAdd);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[600px] max-w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
              <Folder className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Workspaces & Projets</h2>
              <p className="text-[11px] text-slate-400">Sélectionnez le répertoire de travail pour vos agents</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs">
          {/* Active / Trusted Workspaces */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-300">Répertoires autorisés</label>
            <div className="space-y-1 max-h-36 overflow-y-auto">
              {trustedList.map((ws) => {
                const isActive = ws === currentWorkspace;
                return (
                  <div
                    key={ws}
                    className={`flex items-center justify-between p-2 rounded-lg border text-xs font-mono transition-colors ${
                      isActive
                        ? 'border-amber-500/50 bg-amber-950/20 text-amber-300'
                        : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <span className="truncate">{ws}</span>
                    {isActive ? (
                      <span className="text-[10px] bg-amber-950 text-amber-400 px-2 py-0.5 rounded border border-amber-800 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Actif
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          onSelectWorkspace(ws);
                          onClose();
                        }}
                        className="text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-2 py-0.5 rounded transition-colors"
                      >
                        Activer
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Directory Navigator */}
          <div className="space-y-2 pt-2 border-t border-slate-800">
            <label className="font-semibold text-slate-300">Explorateur de dossiers locaux</label>
            {browserData && (
              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between text-slate-400 font-mono text-[11px] pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-1.5 truncate">
                    <span>Chemin:</span>
                    <span className="text-slate-200 font-bold">{browserData.current_path}</span>
                  </div>
                  {browserData.parent_path && (
                    <button
                      onClick={() => explore(browserData.parent_path!)}
                      className="text-sky-400 hover:underline shrink-0 text-[10px]"
                    >
                      Dossier parent ↑
                    </button>
                  )}
                </div>

                <div className="max-h-40 overflow-y-auto space-y-0.5">
                  {loading ? (
                    <div className="p-3 text-center text-slate-500">Chargement...</div>
                  ) : (
                    browserData.entries
                      .filter((e) => e.is_dir)
                      .map((dir) => (
                        <div
                          key={dir.path}
                          className="flex items-center justify-between p-1.5 rounded hover:bg-slate-900 group transition-colors"
                        >
                          <button
                            onClick={() => explore(dir.path)}
                            className="flex items-center gap-2 font-mono text-slate-300 text-[11px] hover:text-amber-300 truncate"
                          >
                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="truncate">{dir.name}</span>
                          </button>
                          <button
                            onClick={() => handleAddWorkspace(dir.path)}
                            className="text-[10px] bg-slate-800 text-slate-300 hover:bg-amber-600 hover:text-white px-2 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1"
                          >
                            <FolderPlus className="w-3 h-3" /> Choisir
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
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
