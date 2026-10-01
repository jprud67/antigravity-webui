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
  Sparkles,
  Download,
  Copy,
  Files,
  ArrowUpDown,
  ChevronRight,
  Globe,
  Code2,
  FolderGit2,
  Box,
  Cpu,
  ShieldCheck,
  CheckCheck,
  Package,
  PlusCircle,
  FileText,
  Play,
  Home,
  CornerLeftUp,
  ArrowRight,
  FolderOpen,
} from 'lucide-react';
import {
  fetchWorkspaceProjects,
  setDefaultWorkspace,
  addWorkspaceProject,
  removeWorkspaceProject,
  exploreWorkspaceDirectory,
  createNewWorkspaceProject,
  cloneWorkspaceProject,
  runGitQuickAction,
  triggerCoordinatorBatch,
} from '../services/api';
import type { WorkspaceProjectDetail, ProjectRuntimeInfo, BatchCoordinatorAction, CoordinatorBatchResult } from '../types';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';
import { useI18n } from '../services/i18n';

export interface ProjectSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace: string;
  onSelectWorkspace: (path: string) => void;
  onRunTerminalCommand?: (command: string) => void;
  onOpenFiles?: () => void;
  onOpenGit?: () => void;
}

type StudioTab = 'projects' | 'browse' | 'create' | 'health' | 'batch';
type CreateMode = 'existing' | 'new' | 'clone';
type TemplateType = 'empty' | 'node' | 'python' | 'html' | 'readme';

export const ProjectSwitcherModal: React.FC<ProjectSwitcherModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace,
  onSelectWorkspace,
  onRunTerminalCommand,
  onOpenFiles,
  onOpenGit,
}) => {
  const { t } = useI18n();

  // Tab State
  const [activeTab, setActiveTab] = useState<StudioTab>('projects');

  // Projects State
  const [projects, setProjects] = useState<WorkspaceProjectDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'node' | 'python' | 'php' | 'rust' | 'docker' | 'git' | 'warnings' | 'default'>('all');
  const [sortBy, setSortBy] = useState<'name' | 'modified' | 'files' | 'warnings'>('name');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Server Explorer & Browse State
  const [createMode, setCreateMode] = useState<CreateMode>('existing');
  const [existingPath, setExistingPath] = useState('');
  const [suggestedDirs, setSuggestedDirs] = useState<string[]>([]);
  const [explorerCurrentPath, setExplorerCurrentPath] = useState(currentWorkspace || '/root');
  const [manualInputPath, setManualInputPath] = useState(currentWorkspace || '/root');
  const [explorerFilter, setExplorerFilter] = useState('');
  const [explorerParentPath, setExplorerParentPath] = useState<string | null>(null);
  const [explorerEntries, setExplorerEntries] = useState<
    Array<{
      name: string;
      path: string;
      is_dir: boolean;
      size?: number | null;
      has_git?: boolean;
      project_type?: string | null;
    }>
  >([]);
  const [isExploring, setIsExploring] = useState(false);

  // New Project Form
  const [newParentPath, setNewParentPath] = useState('/root');
  const [newFolderName, setNewFolderName] = useState('');
  const [newTemplate, setNewTemplate] = useState<TemplateType>('node');
  const [newInitGit, setNewInitGit] = useState(true);
  const [newError, setNewError] = useState<string | null>(null);

  // Clone Form
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneParentPath, setCloneParentPath] = useState('/root');
  const [cloneFolderName, setCloneFolderName] = useState('');
  const [cloneBranch, setCloneBranch] = useState('');
  const [cloneError, setCloneError] = useState<string | null>(null);

  // Batch Operations State
  const [batchActionRunning, setBatchActionRunning] = useState<BatchCoordinatorAction | null>(null);
  const [batchResult, setBatchResult] = useState<CoordinatorBatchResult | null>(null);

  // Switch workspace
  const handleSwitch = useCallback(
    (path: string) => {
      onSelectWorkspace(path);
      const name = path.split(/[\\/]/).pop() || path;
      showToast(t('workspace_switched_to', 'Workspace actif basculé vers {0}', name), 'success');
      window.dispatchEvent(new CustomEvent('workspace-changed', { detail: { path } }));
      onClose();
    },
    [onSelectWorkspace, onClose, t]
  );

  // Load Projects
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
    loadProjects();
  }, [isOpen, loadProjects]);

  // Load Explorer directory
  const loadExplorerDir = useCallback(async (dirPath: string) => {
    setIsExploring(true);
    try {
      const res = await exploreWorkspaceDirectory(dirPath);
      setExplorerCurrentPath(res.current_path);
      setManualInputPath(res.current_path);
      setExplorerParentPath(res.parent_path);
      setExplorerEntries(res.entries);
    } catch (err: any) {
      showToast(err.message || "Impossible d'accéder à ce répertoire", 'error');
    } finally {
      setIsExploring(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && (activeTab === 'browse' || (activeTab === 'create' && createMode === 'existing'))) {
      loadExplorerDir(explorerCurrentPath || currentWorkspace || '/root');
    }
  }, [isOpen, activeTab, createMode, loadExplorerDir]);

  // Clickable path segments
  const pathSegments = useMemo(() => {
    if (!explorerCurrentPath) return [];
    const parts = explorerCurrentPath.split('/').filter(Boolean);
    const segments: { name: string; fullPath: string }[] = [{ name: 'Racine (/)', fullPath: '/' }];
    let acc = '';
    for (const part of parts) {
      acc += `/${part}`;
      segments.push({ name: part, fullPath: acc });
    }
    return segments;
  }, [explorerCurrentPath]);

  // Select and immediately switch to workspace
  const handleSelectAndSwitch = useCallback(
    async (path: string) => {
      try {
        await addWorkspaceProject(path);
      } catch {
        // ignore if already trusted
      }
      handleSwitch(path);
    },
    [handleSwitch]
  );

  // Add to Studio favorites without switching
  const handleAddAsStudioProject = useCallback(
    async (path: string) => {
      setActionLoading(`add:${path}`);
      try {
        await addWorkspaceProject(path);
        showToast(t('new_project_added_success', 'Dossier ajouté avec succès aux projets'), 'success');
        loadProjects();
      } catch (err: any) {
        showToast(err.message || "Erreur lors de l'ajout", 'error');
      } finally {
        setActionLoading(null);
      }
    },
    [loadProjects, t]
  );

  // Filter & Sort projects
  const filteredProjects = useMemo(() => {
    let list = [...projects];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.path.toLowerCase().includes(q) ||
          p.git.branch?.toLowerCase().includes(q) ||
          p.runtimes.some((r) => r.type.includes(q) || r.frameworks.some((f) => f.includes(q)))
      );
    }

    if (filterType === 'node') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'node'));
    } else if (filterType === 'python') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'python'));
    } else if (filterType === 'php') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'php'));
    } else if (filterType === 'rust') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'rust'));
    } else if (filterType === 'docker') {
      list = list.filter((p) => p.runtimes.some((r) => r.type === 'docker'));
    } else if (filterType === 'git') {
      list = list.filter((p) => p.git.is_repo);
    } else if (filterType === 'warnings') {
      list = list.filter((p) => p.health.warnings.length > 0 || p.git.is_dirty);
    } else if (filterType === 'default') {
      list = list.filter((p) => p.is_default);
    }

    // Sort
    list.sort((a, b) => {
      if (a.is_active && !b.is_active) return -1;
      if (!a.is_active && b.is_active) return 1;

      if (sortBy === 'name') {
        return a.name.localeCompare(b.name);
      } else if (sortBy === 'files') {
        return (b.stats?.file_count || 0) - (a.stats?.file_count || 0);
      } else if (sortBy === 'warnings') {
        return (b.health.warnings.length + (b.git.is_dirty ? 1 : 0)) - (a.health.warnings.length + (a.git.is_dirty ? 1 : 0));
      } else if (sortBy === 'modified') {
        const tA = a.last_modified ? new Date(a.last_modified).getTime() : 0;
        const tB = b.last_modified ? new Date(b.last_modified).getTime() : 0;
        return tB - tA;
      }
      return 0;
    });

    return list;
  }, [projects, searchQuery, filterType, sortBy]);

  // Active project
  const activeProject = useMemo(() => {
    return projects.find((p) => p.is_active || p.path === currentWorkspace) || projects[0];
  }, [projects, currentWorkspace]);

  // Aggregated KPIs
  const kpiStats = useMemo(() => {
    const total = projects.length;
    const gitRepos = projects.filter((p) => p.git.is_repo).length;
    const dirtyRepos = projects.filter((p) => p.git.is_dirty).length;
    const warningsCount = projects.filter((p) => p.health.warnings.length > 0).length;
    return { total, gitRepos, dirtyRepos, warningsCount };
  }, [projects]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen || activeTab !== 'projects') return;

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
      } else if (e.key === 'Enter') {
        if (filteredProjects[selectedIndex]) {
          e.preventDefault();
          handleSwitch(filteredProjects[selectedIndex].path);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, activeTab, filteredProjects, selectedIndex, onClose, handleSwitch]);

  // Set default workspace
  const handleSetDefault = async (path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionLoading(path);
    try {
      await setDefaultWorkspace(path);
      showToast(t('default_workspace_updated', 'Workspace par défaut mis à jour'), 'success');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Impossible de définir comme défaut', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Remove workspace
  const handleRemove = async (path: string, isDef: boolean, e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDef) {
      showToast(t('cannot_remove_default_workspace', 'Impossible de retirer le workspace par défaut'), 'warning');
      return;
    }
    const name = path.split(/[\\/]/).pop() || path;
    const confirmed = await showConfirm(
      t('remove_project_confirm', 'Retirer le projet "{0}" de la liste des workspaces ?', name),
      { destructive: true }
    );
    if (!confirmed) return;

    setActionLoading(path);
    try {
      await removeWorkspaceProject(path);
      showToast(t('workspace_removed_from_list', 'Workspace retiré de la liste'), 'info');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Copy path helper
  const handleCopyPath = (path: string, e: React.MouseEvent, type: 'rel' | 'abs' = 'abs') => {
    e.stopPropagation();
    const textToCopy = type === 'rel' ? path.replace(/^(\/root|\/home\/[^/]+)[\\/]?/, '') || '.' : path;
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast(type === 'rel' ? t('relative_path_copied', 'Chemin relatif copié !') : t('absolute_path_copied', 'Chemin absolu copié !'), 'success');
    }).catch(() => {
      showToast(t('copy_error', 'Erreur de copie'), 'error');
    });
  };

  // Quick Git Action on a project
  const handleQuickGit = async (project: WorkspaceProjectDetail, action: 'fetch' | 'pull' | 'status', e: React.MouseEvent) => {
    e.stopPropagation();
    const actionKey = `${project.path}:${action}`;
    setActionLoading(actionKey);
    try {
      const res = await runGitQuickAction(project.path, action);
      if (res.status === 'ok') {
        showToast(`Git ${action.toUpperCase()} réussi sur ${project.name}`, 'success');
        loadProjects();
      } else {
        showToast(`Git ${action}: ${res.output.slice(0, 100)}`, 'warning');
      }
    } catch (err: any) {
      showToast(err.message || `Erreur Git ${action}`, 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Run Remediation command
  const handleRunRemediation = (project: WorkspaceProjectDetail, command: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (project.path !== currentWorkspace) {
      handleSwitch(project.path);
    }
    if (onRunTerminalCommand) {
      onRunTerminalCommand(command);
      showToast(t('command_injected_terminal', 'Commande injectée dans le terminal : {0}', command), 'success');
      onClose();
    }
  };

  // Add existing workspace folder
  const handleAddExisting = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!existingPath.trim()) return;
    setActionLoading('add-existing');
    try {
      await addWorkspaceProject(existingPath.trim());
      showToast(t('new_project_added_success', 'Nouveau projet ajouté avec succès'), 'success');
      setExistingPath('');
      loadProjects();
      setActiveTab('projects');
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'ajout du workspace", 'error');
    } finally {
      setActionLoading(null);
    }
  };

  // Create brand new project
  const handleCreateNewProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParentPath.trim() || !newFolderName.trim()) return;
    setNewError(null);
    setActionLoading('create-project');
    try {
      const res = await createNewWorkspaceProject({
        parent_path: newParentPath.trim(),
        folder_name: newFolderName.trim(),
        template: newTemplate,
        init_git: newInitGit,
      });
      showToast(t('project_created_success', 'Projet "{0}" créé avec succès', res.name), 'success');
      setNewFolderName('');
      loadProjects();
      handleSwitch(res.path);
    } catch (err: any) {
      setNewError(err.message || 'Erreur lors de la création du projet');
    } finally {
      setActionLoading(null);
    }
  };

  // Clone Git repo
  const handleCloneRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cloneUrl.trim() || !cloneParentPath.trim()) return;
    setCloneError(null);
    setActionLoading('clone-project');
    try {
      const res = await cloneWorkspaceProject({
        repo_url: cloneUrl.trim(),
        parent_path: cloneParentPath.trim(),
        folder_name: cloneFolderName.trim() || undefined,
        branch: cloneBranch.trim() || undefined,
      });
      showToast(t('git_clone_success', 'Dépôt Git cloné avec succès dans "{0}"', res.name), 'success');
      setCloneUrl('');
      setCloneFolderName('');
      setCloneBranch('');
      loadProjects();
      handleSwitch(res.path);
    } catch (err: any) {
      setCloneError(err.message || 'Erreur lors du clonage Git');
    } finally {
      setActionLoading(null);
    }
  };

  // Run Batch Action
  const handleRunBatch = async (action: BatchCoordinatorAction) => {
    setBatchActionRunning(action);
    setBatchResult(null);
    try {
      const res = await triggerCoordinatorBatch(action);
      setBatchResult(res);
      showToast(t('coordinator_batch_success', 'Action par lot "{0}" exécutée sur {1} projets', action, res.processed_count), 'success');
      loadProjects();
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'action par lot", 'error');
    } finally {
      setBatchActionRunning(null);
    }
  };

  // Explore suggestions helper
  const handleExploreInput = async (val: string) => {
    setExistingPath(val);
    if (val.length >= 3) {
      try {
        const res = await exploreWorkspaceDirectory(val);
        const dirs = res.entries.filter((ent) => ent.is_dir).map((ent) => ent.path);
        setSuggestedDirs(dirs.slice(0, 6));
      } catch {
        setSuggestedDirs([]);
      }
    } else {
      setSuggestedDirs([]);
    }
  };

  // Runtime badges helper
  const renderRuntimeBadges = (runtimes: ProjectRuntimeInfo[]) => {
    if (!runtimes || runtimes.length === 0) {
      return (
        <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-[var(--border)] opacity-80" style={{ backgroundColor: 'var(--surface)' }}>
          {t('generic', 'Générique')}
        </span>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        {runtimes.map((rt, idx) => {
          let badgeColor = 'bg-sky-500/10 text-sky-400 border-sky-500/30';
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

  // Runtime icon helper
  const getRuntimeIcon = (runtimes: ProjectRuntimeInfo[]) => {
    const main = runtimes?.[0]?.type;
    if (main === 'node') return <Code2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    if (main === 'python') return <Cpu className="w-4 h-4 text-blue-400 shrink-0" />;
    if (main === 'php') return <Globe className="w-4 h-4 text-indigo-400 shrink-0" />;
    if (main === 'rust') return <Box className="w-4 h-4 text-amber-400 shrink-0" />;
    if (main === 'docker') return <Layers className="w-4 h-4 text-cyan-400 shrink-0" />;
    return <Folder className="w-4 h-4 text-sky-400 shrink-0" />;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-md p-3 sm:p-5 animate-in fade-in duration-200">
      <div
        className="w-full max-w-5xl h-[90vh] rounded-2xl border shadow-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
        role="dialog"
        aria-modal="true"
        aria-label={t('projects_workspace_studio', 'Studio Projets & Workspaces')}
      >
        {/* Modal Top Header (Always visible, guaranteed close button) */}
        <div
          className="flex items-center justify-between px-6 py-4 border-b shrink-0 gap-4"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-xs shrink-0">
              <Layers className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold tracking-tight truncate" style={{ color: 'var(--strong, var(--text))' }}>
                  {t('projects_workspace_studio', 'Studio Projets & Workspaces')}
                </h2>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30 font-mono shrink-0">
                  v2.0 • Studio Hub
                </span>
              </div>
              <p className="text-xs opacity-70 truncate max-w-xl hidden sm:block">
                {t('project_switcher_desc', 'Gérez vos projets, parcourez le serveur, clonez des dépôts et surveillez la santé Git.')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={loadProjects}
              title={t('project_refresh_tooltip', 'Rafraîchir les projets')}
              className="p-2 rounded-xl opacity-75 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10 border border-[var(--border)] transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>

            {/* VERY PROMINENT CLOSE BUTTON IN TOP-RIGHT CORNER */}
            <button
              type="button"
              onClick={onClose}
              title="Fermer le studio (Échap)"
              aria-label="Fermer le studio"
              className="flex items-center justify-center w-9 h-9 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)] hover:text-rose-400 hover:border-rose-500/40 hover:bg-rose-500/10 shadow-xs transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tier 2: Tabs Navigation Sub-Header */}
        <div
          className="flex items-center px-6 py-2.5 border-b overflow-x-auto gap-2 shrink-0 select-none scrollbar-none"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface)',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('projects')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeTab === 'projects'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>{t('tab_projects', 'Mes Workspaces')}</span>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-black/20 dark:bg-white/20">
              {projects.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('browse');
              loadExplorerDir(explorerCurrentPath || currentWorkspace || '/root');
            }}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeTab === 'browse'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5 text-sky-400" />
            <span>🧭 Parcourir le serveur</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('create')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeTab === 'create'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <FolderPlus className="w-3.5 h-3.5" />
            <span>{t('tab_create_clone', 'Nouveau & Cloner')}</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('health')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeTab === 'health'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t('tab_health_audit', 'Santé & Audit')}</span>
            {kpiStats.warningsCount + kpiStats.dirtyRepos > 0 && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-amber-500/30 text-amber-300 font-bold">
                {kpiStats.warningsCount + kpiStats.dirtyRepos}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('batch')}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer shrink-0 ${
              activeTab === 'batch'
                ? 'bg-sky-600 text-white shadow-xs'
                : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <CheckCheck className="w-3.5 h-3.5" />
            <span>{t('tab_batch_actions', 'Actions par lot')}</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* TAB 1: PROJECTS HUB */}
          {activeTab === 'projects' && (
            <>
              {/* Global KPI Metrics Ribbon */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div
                  className="p-3.5 rounded-xl border flex items-center justify-between shadow-2xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <span className="text-[11px] opacity-70 block font-medium">Workspaces totaux</span>
                    <span className="text-xl font-bold">{kpiStats.total}</span>
                  </div>
                  <Folder className="w-6 h-6 text-sky-400 opacity-60" />
                </div>

                <div
                  className="p-3.5 rounded-xl border flex items-center justify-between shadow-2xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <span className="text-[11px] opacity-70 block font-medium">Dépôts Git actifs</span>
                    <span className="text-xl font-bold">{kpiStats.gitRepos}</span>
                  </div>
                  <GitBranch className="w-6 h-6 text-indigo-400 opacity-60" />
                </div>

                <div
                  className="p-3.5 rounded-xl border flex items-center justify-between shadow-2xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <span className="text-[11px] opacity-70 block font-medium">Fichiers modifiés</span>
                    <span className={`text-xl font-bold ${kpiStats.dirtyRepos > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {kpiStats.dirtyRepos}
                    </span>
                  </div>
                  <AlertTriangle className={`w-6 h-6 opacity-60 ${kpiStats.dirtyRepos > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
                </div>

                <div
                  className="p-3.5 rounded-xl border flex items-center justify-between shadow-2xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <span className="text-[11px] opacity-70 block font-medium">Alertes de santé</span>
                    <span className={`text-xl font-bold ${kpiStats.warningsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                      {kpiStats.warningsCount}
                    </span>
                  </div>
                  <ShieldCheck className={`w-6 h-6 opacity-60 ${kpiStats.warningsCount > 0 ? 'text-amber-400' : 'text-emerald-400'}`} />
                </div>
              </div>

              {/* Active Project Hero Banner */}
              {activeProject && (
                <div
                  className="relative overflow-hidden rounded-2xl border p-5 shadow-sm"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'rgba(56, 189, 248, 0.4)',
                  }}
                >
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          {t('active_project_caps', 'PROJET ACTIF')}
                        </span>

                        {activeProject.is_default && (
                          <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-sky-500/15 text-sky-400 border border-sky-500/30">
                            <Star className="w-3 h-3 fill-sky-400" /> {t('default_tag', 'Défaut')}
                          </span>
                        )}

                        <span className="text-xs opacity-70 font-mono">
                          {activeProject.stats?.file_count ? `${activeProject.stats.file_count} fichiers` : ''}
                          {activeProject.stats?.disk_size_mb ? ` • ${activeProject.stats.disk_size_mb} MB` : ''}
                        </span>
                      </div>

                      <h3 className="text-lg font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                        {getRuntimeIcon(activeProject.runtimes)}
                        <span>{activeProject.name}</span>
                      </h3>

                      <div className="flex items-center gap-2 text-xs font-mono opacity-70 truncate max-w-xl">
                        <span className="truncate">{activeProject.path}</span>
                        <button
                          type="button"
                          onClick={(e) => handleCopyPath(activeProject.path, e, 'abs')}
                          className="p-1 hover:opacity-100 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                          title={t('copy_absolute_path', 'Copier le chemin absolu')}
                        >
                          <Copy className="w-3 h-3 text-sky-400" />
                        </button>
                      </div>

                      <div className="pt-1">{renderRuntimeBadges(activeProject.runtimes)}</div>
                    </div>

                    {/* Active Project Telemetry & Actions */}
                    <div className="flex flex-col items-start md:items-end gap-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        {activeProject.git.is_repo ? (
                          <>
                            <span
                              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-mono"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                              }}
                            >
                              <GitBranch className="w-3.5 h-3.5 text-sky-400" />
                              <span className="font-semibold">{activeProject.git.branch || 'detached'}</span>
                              {((activeProject.git.ahead ?? 0) > 0 || (activeProject.git.behind ?? 0) > 0) && (
                                <span className="ml-1 text-[11px] font-bold text-sky-400">
                                  {(activeProject.git.ahead ?? 0) > 0 ? `↑${activeProject.git.ahead}` : ''}
                                  {(activeProject.git.behind ?? 0) > 0 ? `↓${activeProject.git.behind}` : ''}
                                </span>
                              )}
                            </span>

                            {activeProject.git.is_dirty ? (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/15 text-amber-400 border border-amber-500/30 text-xs font-medium">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {activeProject.git.uncommitted_count} modifs
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Clean
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs opacity-60 italic">{t('git_not_git', 'Hors Git')}</span>
                        )}
                      </div>

                      {/* Quick Action Ribbon */}
                      <div className="flex items-center gap-2 pt-1 flex-wrap">
                        <button
                          type="button"
                          onClick={() => {
                            if (onRunTerminalCommand) {
                              onRunTerminalCommand(`cd "${activeProject.path}"`);
                              showToast(t('terminal_synced_folder', 'Terminal synchronisé avec ce dossier'), 'info');
                              onClose();
                            }
                          }}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer shadow-2xs hover:border-sky-500/40"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                          }}
                        >
                          <Terminal className="w-3.5 h-3.5 text-sky-400" />
                          <span>Terminal</span>
                        </button>

                        {onOpenFiles && (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenFiles();
                              onClose();
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer shadow-2xs hover:border-sky-500/40"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                            }}
                          >
                            <Files className="w-3.5 h-3.5 text-emerald-400" />
                            <span>Fichiers</span>
                          </button>
                        )}

                        {onOpenGit && activeProject.git.is_repo && (
                          <button
                            type="button"
                            onClick={() => {
                              onOpenGit();
                              onClose();
                            }}
                            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer shadow-2xs hover:border-sky-500/40"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                            }}
                          >
                            <GitBranch className="w-3.5 h-3.5 text-indigo-400" />
                            <span>Git</span>
                          </button>
                        )}

                        {activeProject.git.is_repo && (
                          <button
                            type="button"
                            onClick={(e) => handleQuickGit(activeProject, 'pull', e)}
                            disabled={actionLoading === `${activeProject.path}:pull`}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer shadow-2xs hover:border-sky-500/40"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                            }}
                            title="Git Pull rapide"
                          >
                            <Download className={`w-3.5 h-3.5 text-sky-400 ${actionLoading === `${activeProject.path}:pull` ? 'animate-bounce' : ''}`} />
                            <span>Pull</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Search, Filter & Sort Toolbar */}
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50" />
                    <input
                      type="text"
                      placeholder={t('project_search_placeholder', 'Rechercher par nom, chemin, branche ou runtime...')}
                      value={searchQuery}
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setSelectedIndex(0);
                      }}
                      className="w-full pl-9 pr-8 py-2 rounded-xl text-xs sm:text-sm border transition-colors focus:outline-none focus:ring-1 focus:ring-sky-500"
                      style={{
                        backgroundColor: 'var(--input-bg, var(--surface))',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 opacity-60 hover:opacity-100"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Sort Selector */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs opacity-60 flex items-center gap-1">
                      <ArrowUpDown className="w-3.5 h-3.5" />
                      Trier :
                    </span>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="px-2.5 py-1.5 rounded-lg text-xs border font-medium cursor-pointer focus:outline-none"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      <option value="name">Nom (A-Z)</option>
                      <option value="modified">Modifiés récemment</option>
                      <option value="files">Nombre de fichiers</option>
                      <option value="warnings">Alertes & Santé</option>
                    </select>

                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('browse');
                        loadExplorerDir(explorerCurrentPath || currentWorkspace || '/root');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border hover:border-sky-500/50 hover:bg-sky-500/10 text-sky-400 transition-colors cursor-pointer"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--surface)',
                      }}
                      title="Parcourir le système de fichiers du serveur pour choisir un dossier"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      <span>Parcourir...</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('create')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white shadow-xs transition-colors cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Nouveau</span>
                    </button>
                  </div>
                </div>

                {/* Filter Chips */}
                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                  {(
                    [
                      { id: 'all', label: t('all', 'Tous') },
                      { id: 'node', label: 'Node.js' },
                      { id: 'python', label: 'Python' },
                      { id: 'php', label: 'PHP' },
                      { id: 'rust', label: 'Rust' },
                      { id: 'docker', label: 'Docker' },
                      { id: 'git', label: t('git_repositories', 'Dépôts Git') },
                      { id: 'warnings', label: t('health_alerts', 'Alertes & Modifs') },
                      { id: 'default', label: t('default', 'Par défaut') },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      onClick={() => {
                        setFilterType(f.id);
                        setSelectedIndex(0);
                      }}
                      className={`px-3 py-1 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                        filterType === f.id
                          ? 'bg-sky-600 text-white shadow-xs font-semibold'
                          : 'opacity-70 hover:opacity-100 border border-[var(--border)] hover:bg-black/5 dark:hover:bg-white/5'
                      }`}
                      style={{
                        backgroundColor: filterType === f.id ? undefined : 'var(--surface)',
                      }}
                    >
                      {f.label}
                    </button>
                  ))}
                  <span className="ml-auto text-[11px] opacity-60 font-mono">
                    {filteredProjects.length} / {projects.length} projets
                  </span>
                </div>
              </div>

              {/* Projects List */}
              <div className="space-y-2.5">
                {loading ? (
                  <div className="py-16 flex flex-col items-center justify-center opacity-70 gap-3">
                    <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
                    <span className="text-xs">{t('project_loading', 'Chargement et analyse des projets...')}</span>
                  </div>
                ) : filteredProjects.length === 0 ? (
                  <div
                    className="py-12 text-center opacity-70 border border-dashed rounded-2xl p-6"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <Folder className="w-10 h-10 mx-auto mb-2 opacity-50 text-sky-400" />
                    <p className="text-sm font-semibold">{t('project_not_found', 'Aucun projet trouvé')}</p>
                    <p className="text-xs mt-1 opacity-80">
                      {t('project_not_found_desc', 'Modifiez vos filtres de recherche ou ajoutez un nouveau projet.')}
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('create')}
                      className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-sky-600 hover:bg-sky-500 text-white transition-colors cursor-pointer"
                    >
                      <FolderPlus className="w-3.5 h-3.5" />
                      <span>Ajouter un projet</span>
                    </button>
                  </div>
                ) : (
                  filteredProjects.map((project, index) => {
                    const isSelected = index === selectedIndex;
                    const isActive = project.is_active || project.path === currentWorkspace;

                    return (
                      <div
                        key={project.path}
                        onClick={() => handleSwitch(project.path)}
                        className={`group relative rounded-xl p-3.5 sm:p-4 border transition-all cursor-pointer ${
                          isActive
                            ? 'border-sky-500/60 shadow-xs'
                            : isSelected
                            ? 'border-sky-400/40 shadow-xs'
                            : 'hover:border-sky-500/30'
                        }`}
                        style={{
                          backgroundColor: isActive
                            ? 'var(--surface-subtle)'
                            : isSelected
                            ? 'var(--surface-subtle)'
                            : 'var(--surface)',
                          borderColor: isActive || isSelected ? undefined : 'var(--border)',
                        }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                          <div className="space-y-1.5 min-w-0 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-sm flex items-center gap-1.5" style={{ color: 'var(--strong, var(--text))' }}>
                                {getRuntimeIcon(project.runtimes)}
                                <span className="group-hover:text-sky-400 transition-colors truncate max-w-xs">{project.name}</span>
                              </span>

                              {isActive && (
                                <span className="text-[10px] font-bold px-2 py-0.2 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                  {t('active_caps', 'ACTIF')}
                                </span>
                              )}

                              {project.is_default && (
                                <span className="text-[10px] font-medium px-2 py-0.2 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/20 flex items-center gap-0.5">
                                  <Star className="w-2.5 h-2.5 fill-sky-400" /> {t('default', 'Défaut')}
                                </span>
                              )}

                              {project.git.is_repo && (
                                <span
                                  className="text-[11px] font-mono opacity-80 px-2 py-0.5 rounded border flex items-center gap-1"
                                  style={{
                                    backgroundColor: 'var(--surface-subtle)',
                                    borderColor: 'var(--border)',
                                  }}
                                >
                                  <GitBranch className="w-3 h-3 text-sky-400" />
                                  <span className="truncate max-w-[120px]">{project.git.branch || 'HEAD'}</span>
                                  {((project.git.ahead ?? 0) > 0 || (project.git.behind ?? 0) > 0) && (
                                    <span className="ml-0.5 font-bold text-sky-400">
                                      {(project.git.ahead ?? 0) > 0 ? `↑${project.git.ahead}` : ''}
                                      {(project.git.behind ?? 0) > 0 ? `↓${project.git.behind}` : ''}
                                    </span>
                                  )}
                                </span>
                              )}

                              {project.git.is_dirty && (
                                <span className="text-[10px] font-medium px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 flex items-center gap-1">
                                  <AlertTriangle className="w-2.5 h-2.5" />
                                  <span>{project.git.uncommitted_count} modifs</span>
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2 text-xs font-mono opacity-70 truncate max-w-xl">
                              <span className="truncate">{project.path}</span>
                              <button
                                type="button"
                                onClick={(e) => handleCopyPath(project.path, e, 'abs')}
                                className="p-0.5 hover:opacity-100 text-sky-400 transition-opacity"
                                title="Copier le chemin absolu"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>

                            <div className="pt-0.5 flex items-center gap-3 flex-wrap">
                              {renderRuntimeBadges(project.runtimes)}
                              <span className="text-[10px] opacity-60 font-mono">
                                {project.stats?.file_count ? `${project.stats.file_count} fichiers` : ''}
                                {project.stats?.disk_size_mb ? ` • ${project.stats.disk_size_mb} MB` : ''}
                              </span>
                            </div>

                            {/* Health Warning & Remediation button */}
                            {project.health.warnings.length > 0 && (
                              <div className="mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 text-xs text-amber-300">
                                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                                  <span className="truncate">{project.health.warnings[0]}</span>
                                </div>

                                {project.health.suggested_action && (
                                  <button
                                    type="button"
                                    onClick={(e) =>
                                      handleRunRemediation(project, project.health.suggested_action!.command, e)
                                    }
                                    className="flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 rounded-md transition-colors cursor-pointer shrink-0"
                                  >
                                    <Wrench className="w-3 h-3" />
                                    <span>{project.health.suggested_action.label}</span>
                                  </button>
                                )}
                              </div>
                            )}
                          </div>

                          {/* Action Buttons */}
                          <div className="flex items-center gap-1 self-end sm:self-center shrink-0">
                            {/* Terminal button */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (onRunTerminalCommand) {
                                  onRunTerminalCommand(`cd "${project.path}"`);
                                  showToast(t('terminal_synced_folder', 'Terminal synchronisé avec ce dossier'), 'info');
                                  onClose();
                                }
                              }}
                              className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 text-sky-400 transition-colors cursor-pointer"
                              title="Ouvrir le terminal dans ce projet"
                            >
                              <Terminal className="w-3.5 h-3.5" />
                            </button>

                            {/* Git Pull quick action */}
                            {project.git.is_repo && (
                              <button
                                type="button"
                                onClick={(e) => handleQuickGit(project, 'pull', e)}
                                disabled={actionLoading === `${project.path}:pull`}
                                className="p-1.5 rounded-lg opacity-70 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10 text-indigo-400 transition-colors cursor-pointer"
                                title="Git Pull"
                              >
                                <Download className={`w-3.5 h-3.5 ${actionLoading === `${project.path}:pull` ? 'animate-bounce' : ''}`} />
                              </button>
                            )}

                            {/* Default Star */}
                            <button
                              type="button"
                              onClick={(e) => handleSetDefault(project.path, e)}
                              disabled={actionLoading === project.path}
                              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                project.is_default
                                  ? 'text-sky-400 bg-sky-500/10'
                                  : 'opacity-60 hover:opacity-100 hover:text-sky-400 hover:bg-black/10 dark:hover:bg-white/10'
                              }`}
                              title={project.is_default ? 'Workspace par défaut' : 'Définir par défaut'}
                            >
                              <Star className={`w-3.5 h-3.5 ${project.is_default ? 'fill-sky-400' : ''}`} />
                            </button>

                            {/* Remove Trash */}
                            <button
                              type="button"
                              onClick={(e) => handleRemove(project.path, project.is_default, e)}
                              disabled={project.is_default || actionLoading === project.path}
                              className={`p-1.5 rounded-lg transition-colors ${
                                project.is_default
                                  ? 'opacity-20 cursor-not-allowed'
                                  : 'opacity-60 hover:opacity-100 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer'
                              }`}
                              title={project.is_default ? 'Impossible de retirer le projet par défaut' : 'Retirer de la liste'}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>

                            {/* Switch button */}
                            <button
                              type="button"
                              onClick={() => handleSwitch(project.path)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all shadow-xs cursor-pointer ${
                                isActive
                                  ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                  : 'bg-sky-600 hover:bg-sky-500 text-white'
                              }`}
                            >
                              {isActive ? (
                                <>
                                  <Check className="w-3.5 h-3.5" />
                                  <span>{t('active', 'Actif')}</span>
                                </>
                              ) : (
                                <>
                                  <ExternalLink className="w-3.5 h-3.5" />
                                  <span>{t('switch', 'Basculer')}</span>
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
            </>
          )}

          {/* TAB: BROWSE SERVER FILESYSTEM */}
          {activeTab === 'browse' && (
            <div className="space-y-4 max-w-4xl mx-auto">
              {/* Quick Jump Shortcuts Bar */}
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs font-medium opacity-60 mr-1 flex items-center gap-1">
                  <Home className="w-3.5 h-3.5" />
                  Raccourcis :
                </span>
                {[
                  { label: '/root', path: '/root', icon: '🏠' },
                  { label: '/home', path: '/home', icon: '📁' },
                  { label: '/var/www', path: '/var/www', icon: '🌐' },
                  { label: '/srv', path: '/srv', icon: '🗄️' },
                  { label: 'Racine (/)', path: '/', icon: '⚡' },
                  ...(currentWorkspace ? [{ label: `Workspace (${currentWorkspace.split(/[\\/]/).pop() || currentWorkspace})`, path: currentWorkspace, icon: '💻' }] : [])
                ].map((sc) => (
                  <button
                    key={sc.path}
                    type="button"
                    onClick={() => {
                      loadExplorerDir(sc.path);
                      setManualInputPath(sc.path);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-mono border transition-all cursor-pointer ${
                      explorerCurrentPath === sc.path
                        ? 'bg-sky-600 text-white border-sky-600 shadow-2xs font-semibold'
                        : 'opacity-75 hover:opacity-100 hover:border-sky-500/40 hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    style={{
                      backgroundColor: explorerCurrentPath === sc.path ? undefined : 'var(--surface)',
                      borderColor: explorerCurrentPath === sc.path ? undefined : 'var(--border)',
                    }}
                  >
                    <span>{sc.icon} {sc.label}</span>
                  </button>
                ))}
              </div>

              {/* Breadcrumb Bar + Direct Input */}
              <div
                className="p-3.5 rounded-xl border space-y-2.5 shadow-2xs"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                {/* Clickable Breadcrumbs */}
                <div className="flex items-center gap-1 overflow-x-auto text-xs font-mono py-0.5 scrollbar-none">
                  {pathSegments.map((seg, sIdx) => {
                    const isLast = sIdx === pathSegments.length - 1;
                    return (
                      <React.Fragment key={seg.fullPath}>
                        <button
                          type="button"
                          onClick={() => {
                            loadExplorerDir(seg.fullPath);
                            setManualInputPath(seg.fullPath);
                          }}
                          className={`px-2 py-1 rounded-md transition-colors cursor-pointer truncate max-w-[160px] ${
                            isLast
                              ? 'bg-sky-500/20 text-sky-400 font-bold border border-sky-500/30'
                              : 'opacity-70 hover:opacity-100 hover:bg-black/10 dark:hover:bg-white/10'
                          }`}
                        >
                          {seg.name}
                        </button>
                        {!isLast && <span className="opacity-40 text-xs">/</span>}
                      </React.Fragment>
                    );
                  })}
                </div>

                {/* Manual Path Input + Aller + Parent button */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Folder className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 opacity-50 text-sky-400" />
                    <input
                      type="text"
                      value={manualInputPath}
                      onChange={(e) => setManualInputPath(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          loadExplorerDir(manualInputPath);
                        }
                      }}
                      placeholder="Tapez ou collez un chemin absolu (ex: /root/mon-projet)..."
                      className="w-full pl-9 pr-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                      style={{
                        backgroundColor: 'var(--input-bg, var(--surface))',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => loadExplorerDir(manualInputPath)}
                    className="px-3.5 py-2 text-xs font-semibold rounded-xl bg-sky-600 hover:bg-sky-500 text-white shadow-2xs transition-colors cursor-pointer shrink-0"
                  >
                    Aller
                  </button>

                  {explorerParentPath && (
                    <button
                      type="button"
                      onClick={() => {
                        loadExplorerDir(explorerParentPath);
                        setManualInputPath(explorerParentPath);
                      }}
                      className="flex items-center gap-1 px-3 py-2 text-xs font-semibold rounded-xl border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer shrink-0"
                      style={{
                        borderColor: 'var(--border)',
                        backgroundColor: 'var(--surface)',
                      }}
                      title="Remonter au dossier parent (..)"
                    >
                      <CornerLeftUp className="w-3.5 h-3.5 text-sky-400" />
                      <span>Parent (..)</span>
                    </button>
                  )}
                </div>
              </div>

              {/* CURRENT DIRECTORY BANNER WITH PROMINENT ACTION BUTTON */}
              <div
                className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'rgba(56, 189, 248, 0.4)',
                }}
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                      DOSSIER SÉLECTIONNÉ
                    </span>
                    <span className="text-xs opacity-60 font-mono">
                      {explorerEntries.filter(e => e.is_dir).length} sous-dossier(s)
                    </span>
                  </div>

                  <h3 className="text-base font-bold flex items-center gap-2 truncate" style={{ color: 'var(--strong, var(--text))' }}>
                    <FolderOpen className="w-5 h-5 text-sky-400 shrink-0" />
                    <span className="truncate">{explorerCurrentPath.split(/[\\/]/).pop() || explorerCurrentPath}</span>
                  </h3>

                  <p className="text-xs opacity-70 font-mono truncate max-w-xl">
                    {explorerCurrentPath}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                  <button
                    type="button"
                    onClick={() => handleAddAsStudioProject(explorerCurrentPath)}
                    disabled={actionLoading === `add:${explorerCurrentPath}`}
                    className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl border text-xs font-semibold hover:border-sky-500/40 hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer"
                    style={{
                      borderColor: 'var(--border)',
                      backgroundColor: 'var(--surface)',
                    }}
                    title="Ajouter aux projets favoris sans basculer immédiatement"
                  >
                    <PlusCircle className="w-3.5 h-3.5 text-sky-400" />
                    <span>Ajouter aux projets</span>
                  </button>

                  {/* Primary Action Button */}
                  <button
                    type="button"
                    onClick={() => handleSelectAndSwitch(explorerCurrentPath)}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs sm:text-sm shadow-md hover:shadow-lg transition-all cursor-pointer active:scale-95"
                  >
                    <Check className="w-4 h-4" />
                    <span>Choisir comme Workspace actif</span>
                  </button>
                </div>
              </div>

              {/* Subdirectories Search Filter & List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-50" />
                    <input
                      type="text"
                      placeholder={`Rechercher un dossier dans ${explorerCurrentPath.split(/[\\/]/).pop() || 'ce répertoire'}...`}
                      value={explorerFilter}
                      onChange={(e) => setExplorerFilter(e.target.value)}
                      className="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                      style={{
                        backgroundColor: 'var(--input-bg, var(--surface))',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>
                  <span className="text-xs opacity-60 font-mono shrink-0">
                    {explorerEntries.filter(e => e.is_dir && (!explorerFilter || e.name.toLowerCase().includes(explorerFilter.toLowerCase()))).length} dossier(s)
                  </span>
                </div>

                <div
                  className="rounded-2xl border divide-y divide-[var(--border)] overflow-hidden max-h-96 overflow-y-auto"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  {isExploring ? (
                    <div className="py-12 flex flex-col items-center justify-center opacity-60 gap-2 text-xs">
                      <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
                      <span>Lecture du répertoire...</span>
                    </div>
                  ) : explorerEntries.filter(e => e.is_dir).length === 0 ? (
                    <div className="py-12 text-center opacity-60 text-xs p-4">
                      <Folder className="w-8 h-8 mx-auto mb-2 opacity-40 text-sky-400" />
                      <p className="font-semibold">Ce dossier ne contient aucun sous-répertoire.</p>
                      <p className="mt-1 opacity-70">Vous pouvez directement sélectionner ce dossier ci-dessus.</p>
                    </div>
                  ) : (
                    explorerEntries
                      .filter(e => e.is_dir && (!explorerFilter || e.name.toLowerCase().includes(explorerFilter.toLowerCase())))
                      .map((ent) => (
                        <div
                          key={ent.path}
                          className="flex items-center justify-between p-3 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group gap-2"
                        >
                          <div
                            onClick={() => {
                              loadExplorerDir(ent.path);
                              setManualInputPath(ent.path);
                            }}
                            className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
                          >
                            <Folder className="w-4 h-4 text-sky-400 shrink-0 group-hover:scale-110 transition-transform" />
                            <div className="min-w-0">
                              <span className="text-xs font-semibold group-hover:text-sky-400 transition-colors truncate block">
                                {ent.name}
                              </span>
                              <span className="text-[10px] font-mono opacity-50 truncate block">
                                {ent.path}
                              </span>
                            </div>

                            {ent.has_git && (
                              <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-indigo-500/15 text-indigo-400 border border-indigo-500/25 shrink-0">
                                GIT
                              </span>
                            )}
                            {ent.project_type && (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 shrink-0">
                                {ent.project_type}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            {/* Ouvrir sous-dossier */}
                            <button
                              type="button"
                              onClick={() => {
                                loadExplorerDir(ent.path);
                                setManualInputPath(ent.path);
                              }}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border opacity-75 hover:opacity-100 hover:border-sky-500/40 hover:bg-black/5 dark:hover:bg-white/5 transition-all cursor-pointer font-medium"
                              style={{ borderColor: 'var(--border)' }}
                              title="Naviguer dans ce dossier"
                            >
                              <span>Ouvrir</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>

                            {/* Choisir comme workspace */}
                            <button
                              type="button"
                              onClick={() => handleSelectAndSwitch(ent.path)}
                              className="flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold transition-all shadow-2xs cursor-pointer"
                              title="Sélectionner ce dossier immédiatement comme workspace actif"
                            >
                              <Check className="w-3 h-3" />
                              <span>Sélectionner</span>
                            </button>
                          </div>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB: CREATE & CLONE */}
          {activeTab === 'create' && (
            <div className="space-y-6 max-w-3xl mx-auto">
              {/* Create Mode Selector */}
              <div
                className="grid grid-cols-3 p-1 rounded-xl border gap-1"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setCreateMode('existing')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    createMode === 'existing'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <Folder className="w-4 h-4" />
                  <span>Dossier existant</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCreateMode('new')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    createMode === 'new'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Nouveau projet</span>
                </button>

                <button
                  type="button"
                  onClick={() => setCreateMode('clone')}
                  className={`flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    createMode === 'clone'
                      ? 'bg-sky-600 text-white shadow-xs'
                      : 'opacity-70 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/5'
                  }`}
                >
                  <FolderGit2 className="w-4 h-4" />
                  <span>Cloner Git</span>
                </button>
              </div>

              {/* Mode 1: Existing Folder */}
              {createMode === 'existing' && (
                <div
                  className="p-5 rounded-2xl border space-y-4"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                      <Folder className="w-4 h-4 text-sky-400" />
                      <span>Ajouter un répertoire de travail existant</span>
                    </h3>
                    <p className="text-xs opacity-70 mt-0.5">
                      Sélectionnez un répertoire sur le système de fichiers pour l'ajouter à vos workspaces de confiance.
                    </p>
                  </div>

                  <form onSubmit={handleAddExisting} className="space-y-3">
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Chemin absolu (ex: /root/mon-projet ou C:\projets\app)"
                        value={existingPath}
                        onChange={(e) => handleExploreInput(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                        style={{
                          backgroundColor: 'var(--input-bg, var(--surface))',
                          borderColor: 'var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>

                    {/* Suggestions */}
                    {suggestedDirs.length > 0 && (
                      <div className="space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">Suggestions de sous-dossiers :</span>
                        <div className="flex flex-wrap gap-1.5">
                          {suggestedDirs.map((dir) => (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => {
                                setExistingPath(dir);
                                loadExplorerDir(dir);
                              }}
                              className="text-[11px] font-mono px-2.5 py-1 rounded-lg border opacity-80 hover:opacity-100 hover:border-sky-500/40 transition-colors truncate max-w-xs cursor-pointer"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                              }}
                            >
                              📁 {dir.split(/[\\/]/).pop()}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Live Explorer browser */}
                    <div
                      className="p-3 rounded-xl border space-y-2"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center justify-between text-xs font-mono opacity-80">
                        <span className="flex items-center gap-1.5 truncate">
                          <Folder className="w-3.5 h-3.5 text-sky-400" />
                          <span className="truncate">{explorerCurrentPath}</span>
                        </span>
                        {explorerParentPath && (
                          <button
                            type="button"
                            onClick={() => {
                              setExistingPath(explorerParentPath);
                              loadExplorerDir(explorerParentPath);
                            }}
                            className="text-[11px] font-sans px-2 py-0.5 rounded border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            ⬆️ Dossier parent
                          </button>
                        )}
                      </div>

                      <div className="max-h-48 overflow-y-auto divide-y divide-black/5 dark:divide-white/5">
                        {isExploring ? (
                          <div className="py-6 flex items-center justify-center opacity-60 gap-2 text-xs">
                            <RefreshCw className="w-4 h-4 animate-spin text-sky-400" />
                            <span>Exploration du répertoire...</span>
                          </div>
                        ) : explorerEntries.filter((e) => e.is_dir).length === 0 ? (
                          <div className="py-4 text-center text-xs opacity-50">Aucun sous-dossier trouvé</div>
                        ) : (
                          explorerEntries
                            .filter((e) => e.is_dir)
                            .map((dir) => (
                              <div
                                key={dir.path}
                                onClick={() => {
                                  setExistingPath(dir.path);
                                  loadExplorerDir(dir.path);
                                }}
                                className="flex items-center justify-between py-1.5 px-2 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg cursor-pointer text-xs font-mono transition-colors"
                              >
                                <span className="flex items-center gap-2 truncate">
                                  <Folder className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                                  <span className="truncate">{dir.name}</span>
                                </span>
                                <ChevronRight className="w-3 h-3 opacity-40" />
                              </div>
                            ))
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        type="submit"
                        disabled={actionLoading === 'add-existing' || !existingPath.trim()}
                        className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {actionLoading === 'add-existing' ? (
                          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Check className="w-3.5 h-3.5" />
                        )}
                        <span>Enregistrer dans le Studio</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Mode 2: New Project */}
              {createMode === 'new' && (
                <form
                  onSubmit={handleCreateNewProject}
                  className="p-5 rounded-2xl border space-y-4"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                      <PlusCircle className="w-4 h-4 text-sky-400" />
                      <span>Initialiser un nouveau projet</span>
                    </h3>
                    <p className="text-xs opacity-70 mt-0.5">
                      Créez un projet prêt à l'emploi avec fichiers types, structure et initialisation Git optionnelle.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium opacity-80">Dossier parent</label>
                      <input
                        type="text"
                        value={newParentPath}
                        onChange={(e) => setNewParentPath(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                        style={{
                          backgroundColor: 'var(--input-bg, var(--surface))',
                          borderColor: 'var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-medium opacity-80">Nom du projet / dossier</label>
                      <input
                        type="text"
                        placeholder="ex: mon-super-projet"
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        className="w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                        style={{
                          backgroundColor: 'var(--input-bg, var(--surface))',
                          borderColor: 'var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>
                  </div>

                  {/* Starter Templates Grid */}
                  <div className="space-y-2">
                    <label className="text-xs font-medium opacity-80">Modèle de démarrage</label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      {[
                        { id: 'node', name: 'Node.js', icon: Code2, desc: 'package.json, script dev, .gitignore', color: 'text-emerald-400' },
                        { id: 'python', name: 'Python', icon: Cpu, desc: 'main.py, requirements.txt, .gitignore', color: 'text-blue-400' },
                        { id: 'html', name: 'HTML5 Web', icon: Globe, desc: 'index.html, style.css moderne', color: 'text-amber-400' },
                        { id: 'empty', name: 'Vierge', icon: Box, desc: 'Répertoire vide avec README.md', color: 'text-sky-400' },
                        { id: 'readme', name: 'README seul', icon: FileText, desc: 'Documentation seule', color: 'text-purple-400' },
                      ].map((tpl) => (
                        <div
                          key={tpl.id}
                          onClick={() => setNewTemplate(tpl.id as any)}
                          className={`p-3 rounded-xl border cursor-pointer transition-all ${
                            newTemplate === tpl.id
                              ? 'border-sky-500 bg-sky-500/10 shadow-xs'
                              : 'border-[var(--border)] hover:border-sky-500/30'
                          }`}
                          style={{
                            backgroundColor: newTemplate === tpl.id ? undefined : 'var(--surface)',
                          }}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <tpl.icon className={`w-4 h-4 ${tpl.color}`} />
                            <span className="text-xs font-bold">{tpl.name}</span>
                          </div>
                          <p className="text-[11px] opacity-70">{tpl.desc}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Git Init Checkbox */}
                  <label className="flex items-center gap-2 text-xs opacity-90 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={newInitGit}
                      onChange={(e) => setNewInitGit(e.target.checked)}
                      className="rounded border-[var(--border)] text-sky-600 focus:ring-sky-500"
                    />
                    <span>Initialiser immédiatement un dépôt Git local (<code className="text-[10px] font-mono">git init</code>)</span>
                  </label>

                  {newError && (
                    <p className="text-xs text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{newError}</span>
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={actionLoading === 'create-project' || !newFolderName.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {actionLoading === 'create-project' ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Check className="w-3.5 h-3.5" />
                      )}
                      <span>Créer le projet et basculer</span>
                    </button>
                  </div>
                </form>
              )}

              {/* Mode 3: Clone Git Repo */}
              {createMode === 'clone' && (
                <form
                  onSubmit={handleCloneRepo}
                  className="p-5 rounded-2xl border space-y-4"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div>
                    <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                      <FolderGit2 className="w-4 h-4 text-sky-400" />
                      <span>Cloner un dépôt Git distant</span>
                    </h3>
                    <p className="text-xs opacity-70 mt-0.5">
                      Clonez un dépôt via HTTPS ou SSH, extrayez l'historique et configurez le workspace automatiquement.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium opacity-80">URL du dépôt Git</label>
                      <input
                        type="text"
                        placeholder="https://github.com/user/projet.git ou git@github.com:user/projet.git"
                        value={cloneUrl}
                        onChange={(e) => {
                          setCloneUrl(e.target.value);
                          const extracted = e.target.value.trim().replace(/\.git$/, '').split('/').pop();
                          if (extracted && !cloneFolderName) {
                            setCloneFolderName(extracted);
                          }
                        }}
                        className="w-full px-3.5 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                        style={{
                          backgroundColor: 'var(--input-bg, var(--surface))',
                          borderColor: 'var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium opacity-80">Dossier parent</label>
                        <input
                          type="text"
                          value={cloneParentPath}
                          onChange={(e) => setCloneParentPath(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                          style={{
                            backgroundColor: 'var(--input-bg, var(--surface))',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium opacity-80">Nom du dossier (optionnel)</label>
                        <input
                          type="text"
                          placeholder="ex: mon-projet"
                          value={cloneFolderName}
                          onChange={(e) => setCloneFolderName(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                          style={{
                            backgroundColor: 'var(--input-bg, var(--surface))',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium opacity-80">Branche (optionnelle)</label>
                        <input
                          type="text"
                          placeholder="ex: main ou develop"
                          value={cloneBranch}
                          onChange={(e) => setCloneBranch(e.target.value)}
                          className="w-full px-3 py-2 text-xs font-mono rounded-xl border focus:outline-none focus:ring-1 focus:ring-sky-500"
                          style={{
                            backgroundColor: 'var(--input-bg, var(--surface))',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>
                    </div>
                  </div>

                  {cloneError && (
                    <p className="text-xs text-rose-400 flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>{cloneError}</span>
                    </p>
                  )}

                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={actionLoading === 'clone-project' || !cloneUrl.trim()}
                      className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {actionLoading === 'clone-project' ? (
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      <span>Cloner le projet et enregistrer</span>
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: HEALTH & AUDIT */}
          {activeTab === 'health' && (
            <div className="space-y-4 max-w-4xl mx-auto">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span>Audit Global de Santé Multi-Workspaces</span>
                  </h3>
                  <p className="text-xs opacity-70">
                    Détection en temps réel des modifications non sauvegardées, conflits Git et dépendances orphelines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadProjects}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Relancer l'audit</span>
                </button>
              </div>

              {projects.filter((p) => p.health.warnings.length > 0 || p.git.is_dirty).length === 0 ? (
                <div
                  className="py-16 text-center rounded-2xl border p-6 space-y-2"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'rgba(34, 197, 94, 0.3)',
                  }}
                >
                  <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-400 opacity-90" />
                  <h4 className="text-base font-bold text-emerald-400">Santé optimale sur tous les projets</h4>
                  <p className="text-xs opacity-70 max-w-md mx-auto">
                    Tous vos dépôts sont propres, sans modification orpheline et leurs dépendances sont intègres.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {projects
                    .filter((p) => p.health.warnings.length > 0 || p.git.is_dirty)
                    .map((project) => (
                      <div
                        key={project.path}
                        className="p-4 rounded-xl border space-y-2"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {getRuntimeIcon(project.runtimes)}
                            <span className="font-bold text-sm">{project.name}</span>
                            <span className="text-xs font-mono opacity-60">({project.path})</span>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleSwitch(project.path)}
                            className="text-xs text-sky-400 hover:underline flex items-center gap-1 cursor-pointer font-medium"
                          >
                            <span>Basculer ici</span>
                            <ChevronRight className="w-3 h-3" />
                          </button>
                        </div>

                        {/* Git uncommitted notice */}
                        {project.git.is_dirty && (
                          <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2 text-xs">
                            <span className="flex items-center gap-1.5 text-amber-300">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-400" />
                              <span>{project.git.uncommitted_count} modification(s) non commitée(s) sur la branche <strong>{project.git.branch}</strong></span>
                            </span>
                            {onOpenGit && (
                              <button
                                type="button"
                                onClick={() => {
                                  handleSwitch(project.path);
                                  onOpenGit();
                                }}
                                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                Ouvrir Git
                              </button>
                            )}
                          </div>
                        )}

                        {/* Health diagnostics warnings */}
                        {project.health.warnings.map((warn, wIdx) => (
                          <div
                            key={wIdx}
                            className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-between gap-2 text-xs"
                          >
                            <span className="flex items-center gap-1.5 text-rose-300">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                              <span>{warn}</span>
                            </span>

                            {project.health.suggested_action && (
                              <button
                                type="button"
                                onClick={(e) =>
                                  handleRunRemediation(project, project.health.suggested_action!.command, e)
                                }
                                className="px-2.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/30 text-[11px] font-medium transition-colors cursor-pointer"
                              >
                                {project.health.suggested_action.label}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: BATCH ACTIONS */}
          {activeTab === 'batch' && (
            <div className="space-y-6 max-w-4xl mx-auto">
              <div>
                <h3 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, var(--text))' }}>
                  <CheckCheck className="w-4 h-4 text-sky-400" />
                  <span>Actions par lot multi-workspaces</span>
                </h3>
                <p className="text-xs opacity-70 mt-0.5">
                  Exécutez des opérations simultanées (fetch Git, installation de dépendances, nettoyage de caches) sur l'ensemble de vos projets.
                </p>
              </div>

              {/* Batch Action Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
                      <RefreshCw className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold">Synchroniser tous les dépôts Git</h4>
                      <p className="text-[11px] opacity-70">Lance <code className="font-mono">git fetch --all</code> sur chaque projet.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRunBatch('git_fetch')}
                    disabled={batchActionRunning !== null}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-sky-600 hover:bg-sky-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {batchActionRunning === 'git_fetch' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3.5 h-3.5" />
                    )}
                    <span>Exécuter Git Fetch All</span>
                  </button>
                </div>

                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400">
                      <Download className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold">Mettre à jour les dépôts Git</h4>
                      <p className="text-[11px] opacity-70">Lance <code className="font-mono">git pull</code> sur tous les dépôts sans modif locale.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRunBatch('git_pull')}
                    disabled={batchActionRunning !== null}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {batchActionRunning === 'git_pull' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    <span>Exécuter Git Pull All</span>
                  </button>
                </div>

                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                      <Package className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold">Installer les dépendances</h4>
                      <p className="text-[11px] opacity-70">Déclenche npm, pip ou composer selon la stack du projet.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRunBatch('install_deps')}
                    disabled={batchActionRunning !== null}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {batchActionRunning === 'install_deps' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Package className="w-3.5 h-3.5" />
                    )}
                    <span>Installer les dépendances</span>
                  </button>
                </div>

                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                      <Play className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold">Lancer les tests partout</h4>
                      <p className="text-[11px] opacity-70">Exécute les suites de tests configurées sur chaque projet.</p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleRunBatch('run_all_tests')}
                    disabled={batchActionRunning !== null}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg bg-amber-600 hover:bg-amber-500 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    {batchActionRunning === 'run_all_tests' ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5" />
                    )}
                    <span>Exécuter tous les tests</span>
                  </button>
                </div>
              </div>

              {/* Batch Results Output */}
              {batchResult && (
                <div
                  className="p-4 rounded-xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>Résultats de l'action ({batchResult.processed_count} projets traités)</span>
                    <span className="text-emerald-400 font-mono">
                      Succès : {batchResult.results.filter((r) => r.status === 'success').length} / {batchResult.processed_count}
                    </span>
                  </div>

                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {batchResult.results.map((res: any, idx: number) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border text-xs space-y-1 font-mono"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: res.status === 'success' ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)',
                        }}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-bold">{res.workspace.split(/[\\/]/).pop()}</span>
                          <span className={res.status === 'success' ? 'text-emerald-400' : 'text-rose-400'}>
                            {res.status.toUpperCase()}
                          </span>
                        </div>
                        {res.output && (
                          <pre className="text-[10px] opacity-70 whitespace-pre-wrap max-h-20 overflow-y-auto">
                            {res.output.trim()}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer shortcuts */}
        <div
          className="flex flex-col sm:flex-row items-center justify-between px-6 py-3 border-t text-xs opacity-70 gap-2 shrink-0"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface-subtle)',
          }}
        >
          <div className="flex items-center gap-4 flex-wrap">
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>↑/↓</kbd>
              <span>{t('navigate', 'Naviguer')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>{t('key_enter', 'Entrée')}</kbd>
              <span>{t('switch', 'Basculer')}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <kbd className="px-1.5 py-0.5 rounded border text-[10px] font-mono" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>Ctrl+Alt+W</kbd>
              <span>{t('quick_switch', 'Bascule rapide')}</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-[11px]">
            <Sparkles className="w-3.5 h-3.5 text-sky-400" />
            <span>Changement de workspace sans coupure de session</span>
          </div>
        </div>
      </div>
    </div>
  );
};

