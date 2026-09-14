import React, { useState, useEffect } from 'react';
import { X, Folder, FolderPlus, Check, ArrowUp } from 'lucide-react';
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div className="w-[620px] max-w-full bg-[#0b101f] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1426]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
              <Folder className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Gestion des Workspaces & Projets</h2>
              <p className="text-[11px] text-slate-400">Définissez l'espace racine sur lequel Antigravity intervient</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5 text-xs bg-[#080c16]">
          {/* Active / Trusted Workspaces */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-200">Workspaces Actifs & Autorisés</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {trustedList.map((ws) => {
                const isActive = ws === currentWorkspace;
                return (
                  <div
                    key={ws}
                    className={`flex items-center justify-between p-3 rounded-xl border text-xs font-mono transition-all ${
                      isActive
                        ? 'border-amber-500/60 bg-amber-950/20 text-amber-300 shadow-sm'
                        : 'border-slate-800/90 bg-[#0d1322]/80 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className={`w-4 h-4 shrink-0 ${isActive ? 'text-amber-400' : 'text-slate-500'}`} />
                      <span className="truncate text-[11px]">{ws}</span>
                    </div>
                    {isActive ? (
                      <span className="text-[10px] bg-amber-500/10 text-amber-400 px-2.5 py-0.5 rounded-full border border-amber-500/30 flex items-center gap-1 font-sans font-medium shrink-0">
                        <Check className="w-3 h-3" /> Actif
                      </span>
                    ) : (
                      <button
                        onClick={() => {
                          onSelectWorkspace(ws);
                          onClose();
                        }}
                        className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-1 rounded-lg transition-colors font-sans font-medium shrink-0 cursor-pointer"
                      >
                        Sélectionner
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Directory Navigator */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <label className="font-semibold text-slate-200">Explorateur de dossiers locaux</label>
            {browserData && (
              <div className="bg-[#050811] border border-slate-800/90 rounded-2xl p-4 space-y-2.5 shadow-inner">
                <div className="flex items-center justify-between text-slate-400 font-mono text-[11px] pb-2.5 border-b border-slate-800/80">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-slate-500">Dossier:</span>
                    <span className="text-sky-300 font-semibold truncate max-w-sm">{browserData.current_path}</span>
                  </div>
                  {browserData.parent_path && (
                    <button
                      onClick={() => explore(browserData.parent_path!)}
                      className="text-sky-400 hover:text-sky-300 flex items-center gap-1 shrink-0 text-[11px] font-sans font-medium cursor-pointer"
                    >
                      <ArrowUp className="w-3 h-3" /> Dossier parent
                    </button>
                  )}
                </div>

                <div className="max-h-44 overflow-y-auto space-y-1 pr-1">
                  {loading ? (
                    <div className="p-4 text-center text-slate-500">Chargement...</div>
                  ) : (
                    browserData.entries
                      .filter((e) => e.is_dir)
                      .map((dir) => (
                        <div
                          key={dir.path}
                          className="flex items-center justify-between p-2 rounded-xl hover:bg-slate-900/80 group transition-all"
                        >
                          <button
                            onClick={() => explore(dir.path)}
                            className="flex items-center gap-2 font-mono text-slate-300 text-[11px] hover:text-amber-300 truncate cursor-pointer"
                          >
                            <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                            <span className="truncate">{dir.name}</span>
                          </button>
                          <button
                            onClick={() => handleAddWorkspace(dir.path)}
                            className="text-[10px] bg-slate-800/80 text-slate-300 hover:bg-amber-500 hover:text-black font-semibold px-2.5 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition-all flex items-center gap-1 cursor-pointer"
                          >
                            <FolderPlus className="w-3 h-3" /> Utiliser
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
        <div className="px-6 py-4 bg-[#0b101f] border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="py-2 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors cursor-pointer"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
