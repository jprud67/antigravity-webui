import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  X,
  Search,
  Check,
  Star,
  Trash2,
  Terminal,
  ExternalLink,
  AlertTriangle,
  CheckCircle2,
  Activity,
  FolderPlus,
  GitBranch,
  RefreshCw,
  Folder,
  Layers,
  Wrench,
  Sparkles
} from 'lucide-react';
import {
  fetchWorkspaceProjects,
  setDefaultWorkspace,
  addWorkspaceProject,
  removeWorkspaceProject,
  exploreWorkspaceDirectory
} from '../services/api';
import type { WorkspaceProjectDetail, ProjectRuntimeInfo } from '../types';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

export interface ProjectSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  onSelectWorkspace: (path: string) => void;
  onRunTerminalCommand?: (command: string) => void;
}

export const ProjectSwitcherModal: React.FC<ProjectSwitcherModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  onSelectWorkspace,
  onRunTerminalCommand
}) => {
  const [projects, setProjects] = useState<WorkspaceProjectDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'node' | 'python' | 'php' | 'git' | 'warnings'>('all');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isAdding, setIsAdding] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [suggestedDirs, setSuggestedDirs] = useState<string[]>([]);

  const handleSwitch = useCallback((path: string) => {
    onSelectWorkspace(path);
    showToast(`Workspace actif basculé vers ${path.split(/[\\/]/).pop() || path}`, 'success');
    window.dispatchEvent(new CustomEvent('workspace-changed', { detail: { path } }));
    onClose();
  }, [onSelectWorkspace, onClose]);

  const loadProjects = useCallback(() => {
    setLoading(true);
    fetchWorkspaceProjects(currentWorkspace)
      .then((data) => {
        setProjects(data);
        setLoading(false);
      })
      .catch((err) => {
        showToast(err.message || 'Erreur lors du chargement des projets', 'error');
        setLoading(false);
      });
  }, [currentWorkspace]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchWorkspaceProjects(currentWorkspace)
      .then((data) => {
        if (active) {
          setProjects(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (active) {
          showToast(err.message || 'Erreur lors du chargement des projets', 'error');
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [isOpen, currentWorkspace]);

  // Filter projects
  const filteredProjects = useMemo(() => {
    let list = projects;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.runtimes.some((r) => r.type.includes(q) || r.frameworks.some((f) => f.includes(q)))
      );
    }

    if (filterType === 'node') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'node'));
    } else if (filterType === 'python') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'python'));
    } else if (filterType === 'php') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'php'));
    } else if (filterType === 'git') {
      list = list.filter((p) => p.git.is_repo);
    } else if (filterType === 'warnings') {
      list = list.filter((p) => p.health.warnings.length > 0);
    }

    return list;
  }, [projects, searchQuery, filterType]);

  // Find active project
  const activeProject = useMemo(() => {
    return projects.find((p) => p.is_active || p.path === currentWorkspace) || projects[0];
  }, [projects, currentWorkspace]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev < filteredProjects.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : filteredProjects.length - 1));
      } else if (e.key === 'Enter' && !isAdding) {
        if (filteredProjects[selectedIndex]) {
          e.preventDefault();
          handleSwitch(filteredProjects[selectedIndex].path);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, filteredProjects, selectedIndex, isAdding, onClose, handleSwitch]);


  const handleSetDefault = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(path);
    try {
      await setDefaultWorkspace(path);
      showToast('Workspace par défaut mis à jour', 'success');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Impossible de définir comme défaut', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRemove = async (path: string, isDef: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDef) {
      showToast('Impossible de retirer le workspace par défaut', 'warning');
      return;
    }
    const confirmed = await showConfirm(`Retirer le projet "${path.split(/[\\/]/).pop()}" de la liste des workspaces ?`, { destructive: true });
    if (!confirmed) {
      return;
    }

    setActionLoading(path);
    try {
      await removeWorkspaceProject(path);
      showToast('Workspace retiré de la liste', 'info');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRunRemediation = (project: WorkspaceProjectDetail, command: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.path !== currentWorkspace) {
      handleSwitch(project.path);
    }
    if (onRunTerminalCommand) {
      onRunTerminalCommand(command);
      showToast(`Commande injectée dans le terminal : ${command}`, 'success');
      onClose();
    }
  };

  const handleAddProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPath.trim()) return;
    setAddError(null);
    setActionLoading('add');
    try {
      await addWorkspaceProject(newPath.trim());
      showToast('Nouveau projet ajouté avec succès', 'success');
      setNewPath('');
      setIsAdding(false);
      loadProjects();
    } catch (err: any) {
      setAddError(err.message || "Erreur lors de l'ajout du workspace");
    } finally {
      setActionLoading(null);
    }
  };

  const handleExploreInput = async (val: string) => {
    setNewPath(val);
    if (val.length >= 3) {
      try {
        const res = await exploreWorkspaceDirectory(val);
        const dirs = res.entries.filter((ent) => ent.is_dir).map((ent) => ent.path);
        setSuggestedDirs(dirs.slice(0, 5));
      } catch {
        setSuggestedDirs([]);
      }
    } else {
      setSuggestedDirs([]);
    }
  };

  const renderRuntimeBadges = (runtimes: ProjectRuntimeInfo[]) => {
    if (!runtimes || runtimes.length === 0) {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-2 text-text-muted border border-border">
          Générique
        </span>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {runtimes.map((rt, idx) => {
          let badgeColor = 'bg-surface-2 text-text-muted border-border';
          if (rt.type === 'node') badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
          else if (rt.type === 'python') badgeColor = 'bg-blue-500/10 text-blue-400 border-blue-500/30';
          else if (rt.type === 'php') badgeColor = 'bg-indigo-500/10 text-indigo-400 border-indigo-500/30';
          else if (rt.type === 'rust') badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/30';
          else if (rt.type === 'docker') badgeColor = 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';

          return (
            <span
              key={idx}
              className={`text-[10px] font-medium font-mono px-2 py-0.5 rounded border uppercase tracking-wider ${badgeColor}`}
            >
              {rt.type}
              {rt.package_manager ? ` (${rt.package_manager})` : ''}
              {rt.frameworks.length > 0 && ` • ${rt.frameworks.slice(0, 2).join(', ')}`}
            </span>
          );
        })}
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-4xl max-h-[90vh] bg-surface-1 rounded-2xl border border-border/80 shadow-2xl flex flex-col overflow-hidden text-text-main"
        role="dialog"
        aria-modal="true"
        aria-label="Studio Projets & Workspaces"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/60 bg-surface-0/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/15 border border-accent/30 flex items-center justify-center text-accent shadow-sm">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold tracking-tight text-text-main">
                  Studio Projets & Workspaces
                </h2>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-accent/10 text-accent border border-accent/20">
                  v0.2.21 • Hub
                </span>
              </div>
              <p className="text-xs text-text-muted">
                Basculez instantanément de projet, surveillez la santé de vos dépôts et remédiez aux alertes en 1-clic.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadProjects}
              title="Rafraîchir les projets"
              className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors border border-transparent hover:border-border"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              title="Fermer (Échap)"
              className="p-2 rounded-lg text-text-muted hover:text-text-main hover:bg-surface-2 transition-colors border border-transparent hover:border-border"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Active Project Hero Card */}
          {activeProject && (
            <div className="relative overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-r from-accent/10 via-surface-1 to-surface-0 p-5 shadow-lg">
              <div className="absolute top-0 right-0 transform translate-x-4 -translate-y-4 w-32 h-32 bg-accent/10 rounded-full blur-2xl pointer-events-none" />

              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      PROJET ACTIF
                    </span>
                    {activeProject.is_default && (
                      <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/20 text-sky-400 border border-sky-500/30">
                        <Star className="w-3 h-3 fill-sky-400" /> Par défaut
                      </span>
                    )}
                    <span className="text-xs text-text-muted font-mono">
                      {activeProject.stats?.file_count ? `${activeProject.stats.file_count} fichiers` : ''}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-text-main flex items-center gap-2">
                    {activeProject.name}
                  </h3>
                  <p className="text-xs text-text-muted font-mono truncate max-w-xl">
                    {activeProject.path}
                  </p>

                  <div className="pt-1">
                    {renderRuntimeBadges(activeProject.runtimes)}
                  </div>
                </div>

                {/* Git & Health Telemetry Pills */}
                <div className="flex flex-col items-start md:items-end gap-2.5">
                  {activeProject.git.is_repo ? (
                    <div className="flex items-center gap-2 text-xs">
                      <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface-2 border border-border text-text-main font-mono">
                        <GitBranch className="w-3.5 h-3.5 text-accent" />
                        {activeProject.git.branch || 'detached'}
                        {((activeProject.git.ahead ?? 0) > 0 || (activeProject.git.behind ?? 0) > 0) && (
                          <span className="ml-1 text-[11px] font-semibold text-sky-400">
                            {(activeProject.git.ahead ?? 0) > 0 ? `↑${activeProject.git.ahead}` : ''}
                            {(activeProject.git.behind ?? 0) > 0 ? `↓${activeProject.git.behind}` : ''}
                          </span>
                        )}
                      </span>
                      {activeProject.git.is_dirty ? (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          {activeProject.git.uncommitted_count} modif(s)
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Clean
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-text-muted italic">Hors Git</span>
                  )}

                  {/* Health status badge */}
                  <div className="flex items-center gap-2">
                    {activeProject.health.warnings.length === 0 ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
                        <Check className="w-3.5 h-3.5" /> Santé optimale
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20">
                        <Activity className="w-3.5 h-3.5" /> {activeProject.health.warnings.length} alerte(s) de santé
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={() => {
                        if (onRunTerminalCommand) {
                          onRunTerminalCommand(`cd "${activeProject.path}"`);
                          showToast('Terminal synchronisé avec ce dossier', 'info');
                          onClose();
                        }
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-surface-2 hover:bg-surface-3 text-text-main rounded-lg border border-border transition-colors shadow-sm"
                    >
                      <Terminal className="w-3.5 h-3.5 text-accent" />
                      Terminal ici
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Search, Filter Bar and Add Project Button */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                <input
                  type="text"
                  placeholder="Rechercher par nom, chemin ou technologie..."
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSelectedIndex(0);
                  }}
                  className="w-full pl-9 pr-8 py-2 bg-surface-0 border border-border rounded-xl text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-text-muted hover:text-text-main"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                onClick={() => setIsAdding(!isAdding)}
                className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium rounded-xl border transition-colors ${
                  isAdding
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 hover:bg-surface-3 text-text-main border-border'
                }`}
              >
                <FolderPlus className="w-4 h-4" />
                {isAdding ? 'Fermer ajout' : '+ Ajouter un projet'}
              </button>
            </div>

            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {(
                [
                  { id: 'all', label: 'Tous' },
                  { id: 'node', label: 'Node.js' },
                  { id: 'python', label: 'Python' },
                  { id: 'php', label: 'PHP' },
                  { id: 'git', label: 'Dépôts Git' },
                  { id: 'warnings', label: 'Alertes Santé' }
                ] as const
              ).map((f) => (
                <button
                  key={f.id}
                  onClick={() => {
                    setFilterType(f.id);
                    setSelectedIndex(0);
                  }}
                  className={`px-3 py-1 rounded-lg font-medium transition-all ${
                    filterType === f.id
                      ? 'bg-accent text-white shadow-sm'
                      : 'bg-surface-0 hover:bg-surface-2 text-text-muted hover:text-text-main border border-border/70'
                  }`}
                >
                  {f.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-text-muted font-mono">
                {filteredProjects.length} projet(s)
              </span>
            </div>
          </div>

          {/* Add Project Drawer */}
          {isAdding && (
            <form
              onSubmit={handleAddProject}
              className="p-4 rounded-xl border border-accent/40 bg-surface-0/90 space-y-3 animate-in slide-in-from-top-2 duration-200"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-text-main flex items-center gap-1.5">
                  <FolderPlus className="w-4 h-4 text-accent" />
                  Ajouter un dossier de travail existant
                </span>
                <span className="text-[11px] text-text-muted">
                  Chemin absolu vers le répertoire racine
                </span>
              </div>

              <div className="relative">
                <input
                  type="text"
                  placeholder="ex: c:\laragon\www\mon-autre-projet"
                  value={newPath}
                  onChange={(e) => handleExploreInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs bg-surface-1 border border-border rounded-lg text-text-main font-mono placeholder:text-text-muted focus:outline-none focus:border-accent"
                />
              </div>

              {/* Suggestions */}
              {suggestedDirs.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[10px] text-text-muted uppercase tracking-wider font-semibold">
                    Suggestions de sous-dossiers :
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {suggestedDirs.map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setNewPath(dir)}
                        className="text-[11px] font-mono px-2 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-text-main border border-border transition-colors truncate max-w-xs"
                      >
                        {dir.split(/[\\/]/).pop()}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {addError && (
                <p className="text-xs text-rose-400 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {addError}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1.5 text-xs text-text-muted hover:text-text-main"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={actionLoading === 'add' || !newPath.trim()}
                  className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium bg-accent hover:bg-accent-hover text-white rounded-lg transition-colors shadow disabled:opacity-50"
                >
                  {actionLoading === 'add' ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Check className="w-3.5 h-3.5" />
                  )}
                  Valider et Enregistrer
                </button>
              </div>
            </form>
          )}

          {/* Project Cards Grid */}
          <div className="space-y-3">
            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-text-muted gap-3">
                <RefreshCw className="w-8 h-8 animate-spin text-accent" />
                <span className="text-xs">Chargement et analyse des projets...</span>
              </div>
            ) : filteredProjects.length === 0 ? (
              <div className="py-12 text-center text-text-muted border border-dashed border-border rounded-xl">
                <Folder className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p className="text-sm font-medium">Aucun projet trouvé</p>
                <p className="text-xs mt-1">Modifiez vos filtres ou ajoutez un nouveau dossier.</p>
              </div>
            ) : (
              filteredProjects.map((project, index) => {
                const isSelected = index === selectedIndex;
                const isActive = project.is_active || project.path === currentWorkspace;

                return (
                  <div
                    key={project.path}
                    onClick={() => handleSwitch(project.path)}
                    className={`group relative rounded-xl p-4 border transition-all cursor-pointer ${
                      isActive
                        ? 'bg-surface-0 border-accent/40 shadow-sm'
                        : isSelected
                        ? 'bg-surface-2 border-border shadow-sm'
                        : 'bg-surface-0/60 hover:bg-surface-1 border-border/70 hover:border-border'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-text-main group-hover:text-accent transition-colors flex items-center gap-1.5">
                            <Folder className="w-4 h-4 text-accent/80 flex-shrink-0" />
                            {project.name}
                          </span>

                          {isActive && (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                              ACTIF
                            </span>
                          )}

                          {project.is_default && (
                            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/20 flex items-center gap-0.5">
                              <Star className="w-2.5 h-2.5 fill-sky-400" /> Défaut
                            </span>
                          )}

                          {project.git.is_repo && (
                            <span className="text-[11px] font-mono text-text-muted px-2 py-0.5 rounded bg-surface-2 border border-border flex items-center gap-1">
                              <GitBranch className="w-3 h-3 text-accent" />
                              {project.git.branch || 'HEAD'}
                              {((project.git.ahead ?? 0) > 0 || (project.git.behind ?? 0) > 0) && (
                                <span className="ml-0.5 font-semibold text-sky-400">
                                  {(project.git.ahead ?? 0) > 0 ? `↑${project.git.ahead}` : ''}
                                  {(project.git.behind ?? 0) > 0 ? `↓${project.git.behind}` : ''}
                                </span>
                              )}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-text-muted font-mono truncate max-w-xl">
                          {project.path}
                        </p>

                        <div className="pt-0.5">
                          {renderRuntimeBadges(project.runtimes)}
                        </div>

                        {/* Health Warnings & Remediation Action */}
                        {project.health.warnings.length > 0 && (
                          <div className="mt-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 text-xs text-amber-300">
                              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 text-amber-400" />
                              <span>{project.health.warnings[0]}</span>
                            </div>

                            {project.health.suggested_action && (
                              <button
                                onClick={(e) =>
                                  handleRunRemediation(
                                    project,
                                    project.health.suggested_action!.command,
                                    e
                                  )
                                }
                                className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-md transition-colors"
                              >
                                <Wrench className="w-3 h-3" />
                                {project.health.suggested_action.label}
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5 self-end sm:self-center">
                        <button
                          onClick={(e) => handleSetDefault(project.path, e)}
                          title={project.is_default ? 'Workspace par défaut' : 'Définir comme workspace par défaut'}
                          disabled={actionLoading === project.path}
                          className={`p-2 rounded-lg border transition-colors ${
                            project.is_default
                              ? 'text-sky-400 bg-sky-500/10 border-sky-500/20'
                              : 'text-text-muted hover:text-sky-400 hover:bg-surface-2 border-transparent hover:border-border'
                          }`}
                        >
                          <Star className={`w-4 h-4 ${project.is_default ? 'fill-sky-400' : ''}`} />
                        </button>

                        <button
                          onClick={(e) => handleRemove(project.path, project.is_default, e)}
                          title={project.is_default ? 'Impossible de retirer le projet par défaut' : 'Retirer de la liste'}
                          disabled={project.is_default || actionLoading === project.path}
                          className={`p-2 rounded-lg border transition-colors ${
                            project.is_default
                              ? 'opacity-30 cursor-not-allowed text-text-muted border-transparent'
                              : 'text-text-muted hover:text-rose-400 hover:bg-rose-500/10 border-transparent hover:border-rose-500/20'
                          }`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => handleSwitch(project.path)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors shadow-sm ${
                            isActive
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-accent hover:bg-accent-hover text-white'
                          }`}
                        >
                          {isActive ? (
                            <>
                              <Check className="w-3.5 h-3.5" /> Actif
                            </>
                          ) : (
                            <>
                              <ExternalLink className="w-3.5 h-3.5" /> Basculer
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer shortcuts */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-border/60 bg-surface-0/60 text-xs text-text-muted">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono border border-border">↑/↓</kbd>
              Naviguer
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono border border-border">Entrée</kbd>
              Basculer
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded bg-surface-2 text-[10px] font-mono border border-border">Ctrl+Alt+W</kbd>
              Bascule rapide
            </span>
          </div>

          <div className="flex items-center gap-1 text-[11px] text-text-muted">
            <Sparkles className="w-3.5 h-3.5 text-accent" />
            <span>Changement de workspace sans perte de conversation</span>
          </div>
        </div>
      </div>
    </div>
  );
};
