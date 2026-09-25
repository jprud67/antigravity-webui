import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Globe,
  RefreshCw,
  Plus,
  Search,
  Zap,
  UploadCloud,
  DownloadCloud,
  Trash2,
  Edit2,
  Copy,
  Check,
  ExternalLink,
  ShieldCheck,
  AlertTriangle,
  X,
  Server
} from 'lucide-react';
import {
  fetchGitRemotes,
  createGitRemote,
  updateGitRemote,
  deleteGitRemote,
  testGitRemoteConnection,
  fetchGitRemote,
  pushGitRemote
} from '../services/api';
import type { GitRemoteDetail } from '../types';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

export interface GitRemotesViewProps {
  workspace: string;
  currentBranch?: string;
  onNotify?: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

interface PingState {
  loading: boolean;
  latency_ms?: number;
  error?: string;
}

export const GitRemotesView: React.FC<GitRemotesViewProps> = ({
  workspace,
  currentBranch = 'main',
  onNotify
}) => {
  const [remotes, setRemotes] = useState<GitRemoteDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [pings, setPings] = useState<Record<string, PingState>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Modal: Add Remote
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addName, setAddName] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [addPushUrl, setAddPushUrl] = useState('');
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Modal: Edit Remote
  const [editingRemote, setEditingRemote] = useState<GitRemoteDetail | null>(null);
  const [editName, setEditName] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editPushUrl, setEditPushUrl] = useState('');
  const [submittingEdit, setSubmittingEdit] = useState(false);

  // Modal: Push to Remote
  const [pushingRemote, setPushingRemote] = useState<GitRemoteDetail | null>(null);
  const [pushBranch, setPushBranch] = useState(currentBranch);
  const [setUpstream, setSetUpstream] = useState(true);
  const [forcePush, setForcePush] = useState(false);
  const [submittingPush, setSubmittingPush] = useState(false);

  const notify = useCallback(
    (msg: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
      if (onNotify) {
        onNotify(msg, type);
      } else {
        showToast(msg, type);
      }
    },
    [onNotify]
  );

  useEffect(() => {
    let cancelled = false;
    fetchGitRemotes(workspace)
      .then((data) => {
        if (!cancelled) {
          setRemotes(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Erreur chargement des remotes';
          notify(message, 'error');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, notify]);

  const loadRemotes = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchGitRemotes(workspace);
      setRemotes(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur chargement des remotes';
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, notify]);

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedUrl(text);
      setTimeout(() => setCopiedUrl(null), 2000);
      notify('URL copiée dans le presse-papiers', 'success');
    } catch {
      notify("Échec de la copie de l'URL", 'error');
    }
  };

  const handlePing = async (remoteName: string) => {
    setPings((prev) => ({ ...prev, [remoteName]: { loading: true } }));
    try {
      const res = await testGitRemoteConnection(remoteName, workspace);
      if (res.success) {
        setPings((prev) => ({
          ...prev,
          [remoteName]: { loading: false, latency_ms: res.latency_ms }
        }));
        notify(`Ping ${remoteName} réussi en ${res.latency_ms} ms`, 'success');
      } else {
        setPings((prev) => ({
          ...prev,
          [remoteName]: { loading: false, error: res.error || 'Échec de connexion' }
        }));
        notify(`Connexion ${remoteName} échouée : ${res.error || 'Erreur'}`, 'error');
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur réseau';
      setPings((prev) => ({
        ...prev,
        [remoteName]: { loading: false, error: errMsg }
      }));
      notify(`Ping ${remoteName} en erreur : ${errMsg}`, 'error');
    }
  };

  const handleFetch = async (remoteName: string) => {
    setActionLoading((prev) => ({ ...prev, [`fetch-${remoteName}`]: true }));
    try {
      const res = await fetchGitRemote({ remote: remoteName, workspace });
      notify(`Fetch ${remoteName} terminé : ${res.output.slice(0, 100)}`, 'success');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors du fetch';
      notify(`Échec du fetch ${remoteName} : ${errMsg}`, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`fetch-${remoteName}`]: false }));
    }
  };

  const handleOpenPush = (remote: GitRemoteDetail) => {
    setPushingRemote(remote);
    setPushBranch(currentBranch);
    setSetUpstream(true);
    setForcePush(false);
  };

  const handleConfirmPush = async () => {
    if (!pushingRemote) return;
    setSubmittingPush(true);
    try {
      const res = await pushGitRemote({
        remote: pushingRemote.name,
        branch: pushBranch.trim() || undefined,
        set_upstream: setUpstream,
        force: forcePush,
        workspace
      });
      notify(`Push vers ${pushingRemote.name} réussi : ${res.output.slice(0, 100)}`, 'success');
      setPushingRemote(null);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors du push';
      notify(`Échec du push vers ${pushingRemote.name} : ${errMsg}`, 'error');
    } finally {
      setSubmittingPush(false);
    }
  };

  const handleOpenAdd = () => {
    setAddName('');
    setAddUrl('');
    setAddPushUrl('');
    setIsAddOpen(true);
  };

  const handleCreateRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = addName.trim();
    const url = addUrl.trim();
    const pushUrl = addPushUrl.trim();

    if (!name || !url) {
      notify('Le nom et l’URL de fetch sont obligatoires', 'warning');
      return;
    }

    setSubmittingAdd(true);
    try {
      await createGitRemote({
        name,
        url,
        push_url: pushUrl || undefined,
        workspace
      });
      notify(`Dépôt distant "${name}" ajouté avec succès`, 'success');
      setIsAddOpen(false);
      await loadRemotes();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors de la création';
      notify(`Impossible d'ajouter le remote : ${errMsg}`, 'error');
    } finally {
      setSubmittingAdd(false);
    }
  };

  const handleOpenEdit = (remote: GitRemoteDetail) => {
    setEditingRemote(remote);
    setEditName(remote.name);
    setEditUrl(remote.fetch_url);
    setEditPushUrl(remote.push_url);
  };

  const handleUpdateRemote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRemote) return;
    const newName = editName.trim();
    const url = editUrl.trim();
    const pushUrl = editPushUrl.trim();

    setSubmittingEdit(true);
    try {
      await updateGitRemote(editingRemote.name, {
        new_name: newName !== editingRemote.name ? newName : undefined,
        url: url !== editingRemote.fetch_url ? url : undefined,
        push_url: pushUrl !== editingRemote.push_url ? pushUrl : undefined,
        workspace
      });
      notify(`Remote "${editingRemote.name}" mis à jour avec succès`, 'success');
      setEditingRemote(null);
      await loadRemotes();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors de la mise à jour';
      notify(`Impossible de modifier le remote : ${errMsg}`, 'error');
    } finally {
      setSubmittingEdit(false);
    }
  };

  const handleDeleteRemote = async (remoteName: string) => {
    const confirmed = await showConfirm(
      `Êtes-vous certain de vouloir supprimer le remote "${remoteName}" ? Cette action est irréversible localement.`,
      {
        title: 'Supprimer le dépôt distant',
        destructive: true,
        confirmLabel: 'Supprimer'
      }
    );
    if (!confirmed) return;

    try {
      await deleteGitRemote(remoteName, workspace);
      notify(`Remote "${remoteName}" supprimé avec succès`, 'success');
      await loadRemotes();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : 'Erreur lors de la suppression';
      notify(`Impossible de supprimer le remote : ${errMsg}`, 'error');
    }
  };

  const filteredRemotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return remotes;
    return remotes.filter(
      (r) =>
        r.name.toLowerCase().includes(query) ||
        r.fetch_url.toLowerCase().includes(query) ||
        r.push_url.toLowerCase().includes(query)
    );
  }, [remotes, searchQuery]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Bar / Actions */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            <Globe className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white tracking-wide">
                Dépôts Distants (Remotes)
              </h2>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                {remotes.length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Gérez les liaisons avec GitHub, GitLab ou vos serveurs distants
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filtrer les remotes..."
              className="pl-9 pr-3 py-1.5 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 w-48 transition-all"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={loadRemotes}
            disabled={loading}
            title="Rafraîchir les remotes"
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* New Remote Button */}
          <button
            onClick={handleOpenAdd}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Nouveau Remote</span>
          </button>
        </div>
      </div>

      {/* Main Content List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading && remotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">Chargement des dépôts distants...</span>
          </div>
        ) : filteredRemotes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/30">
            <div className="p-3 rounded-full bg-slate-800 text-slate-400 mb-3">
              <Server className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200">
              {searchQuery ? 'Aucun remote ne correspond à votre recherche' : 'Aucun dépôt distant configuré'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
              {searchQuery
                ? 'Essayez de modifier votre requête de recherche.'
                : 'Ajoutez un remote pour synchroniser votre code avec GitHub, GitLab ou un dépôt Git distant.'}
            </p>
            {!searchQuery && (
              <button
                onClick={handleOpenAdd}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>Ajouter un remote</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredRemotes.map((remote) => {
              const ping = pings[remote.name];
              const isFetching = !!actionLoading[`fetch-${remote.name}`];
              const isDefault = remote.is_default || remote.name === 'origin';

              return (
                <div
                  key={remote.name}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 hover:border-slate-700/80 transition-all p-4 flex flex-col gap-3 relative overflow-hidden"
                >
                  {/* Decorative glow for default remote */}
                  {isDefault && (
                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-2xl pointer-events-none" />
                  )}

                  {/* Header Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div
                        className={`p-2 rounded-lg ${
                          isDefault
                            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}
                      >
                        <Globe className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-white tracking-wide">
                            {remote.name}
                          </span>
                          {isDefault && (
                            <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                              <ShieldCheck className="w-3 h-3 text-indigo-400" />
                              Défaut
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Connectivity Ping & Action Buttons */}
                    <div className="flex items-center gap-2">
                      {/* Ping Status / Button */}
                      {ping?.loading ? (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-slate-800 text-slate-400 border border-slate-700">
                          <RefreshCw className="w-3 h-3 animate-spin text-indigo-400" />
                          <span>Test en cours...</span>
                        </div>
                      ) : ping?.latency_ms !== undefined ? (
                        <div
                          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-medium rounded-lg border ${
                            ping.latency_ms < 500
                              ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                              : 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                          }`}
                        >
                          <Zap className="w-3 h-3" />
                          <span>{ping.latency_ms} ms</span>
                        </div>
                      ) : ping?.error ? (
                        <div
                          title={ping.error}
                          className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-rose-500/10 text-rose-300 border border-rose-500/30"
                        >
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          <span>Erreur ping</span>
                        </div>
                      ) : null}

                      <button
                        onClick={() => handlePing(remote.name)}
                        disabled={ping?.loading}
                        title="Tester la connectivité (git ls-remote)"
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                      >
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>Tester connexion</span>
                      </button>

                      <button
                        onClick={() => handleFetch(remote.name)}
                        disabled={isFetching}
                        title="Récupérer les branches distantes (Fetch)"
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                      >
                        <DownloadCloud
                          className={`w-3.5 h-3.5 text-sky-400 ${isFetching ? 'animate-bounce' : ''}`}
                        />
                        <span>Fetch</span>
                      </button>

                      <button
                        onClick={() => handleOpenPush(remote)}
                        title="Pousser des branches vers ce remote (Push)"
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white transition-colors"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        <span>Push...</span>
                      </button>

                      <button
                        onClick={() => handleOpenEdit(remote)}
                        title="Modifier le nom ou les URLs"
                        className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        onClick={() => handleDeleteRemote(remote.name)}
                        title="Supprimer ce remote"
                        className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* URLs Details */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs bg-slate-950/60 p-3 rounded-lg border border-slate-800/80">
                    {/* Fetch URL */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Fetch URL
                      </span>
                      <div className="flex items-center gap-1.5 text-slate-200 font-mono text-[11px] bg-slate-900 px-2 py-1.5 rounded border border-slate-800">
                        <span className="truncate flex-1" title={remote.fetch_url}>
                          {remote.fetch_url}
                        </span>
                        <button
                          onClick={() => copyToClipboard(remote.fetch_url)}
                          title="Copier l'URL"
                          className="text-slate-400 hover:text-white p-0.5 transition-colors"
                        >
                          {copiedUrl === remote.fetch_url ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                        {remote.fetch_url.startsWith('http') && (
                          <a
                            href={remote.fetch_url.replace(/\.git$/, '')}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-400 hover:text-white p-0.5 transition-colors"
                            title="Ouvrir dans le navigateur"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Push URL */}
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                        Push URL
                      </span>
                      <div className="flex items-center gap-1.5 text-slate-200 font-mono text-[11px] bg-slate-900 px-2 py-1.5 rounded border border-slate-800">
                        <span className="truncate flex-1" title={remote.push_url}>
                          {remote.push_url}
                        </span>
                        <button
                          onClick={() => copyToClipboard(remote.push_url)}
                          title="Copier l'URL"
                          className="text-slate-400 hover:text-white p-0.5 transition-colors"
                        >
                          {copiedUrl === remote.push_url ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Add Remote */}
      {isAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/40">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">Nouveau Dépôt Distant (Remote)</h3>
              </div>
              <button
                onClick={() => setIsAddOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateRemote} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom du Remote <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: origin, upstream, mirror"
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  URL de Fetch <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="git@github.com:owner/repo.git ou https://github.com/..."
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  URL de Push (Optionnelle, par défaut identique à l’URL de Fetch)
                </label>
                <input
                  type="text"
                  placeholder="Laisser vide pour utiliser la même URL"
                  value={addPushUrl}
                  onChange={(e) => setAddPushUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submittingAdd}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingAdd && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>Ajouter le remote</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Edit Remote */}
      {editingRemote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/40">
              <div className="flex items-center gap-2">
                <Edit2 className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">
                  Modifier le remote {editingRemote.name}
                </h3>
              </div>
              <button
                onClick={() => setEditingRemote(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateRemote} className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Nom du Remote
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  URL de Fetch
                </label>
                <input
                  type="text"
                  required
                  value={editUrl}
                  onChange={(e) => setEditUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  URL de Push
                </label>
                <input
                  type="text"
                  value={editPushUrl}
                  onChange={(e) => setEditPushUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setEditingRemote(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={submittingEdit}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingEdit && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>Enregistrer les modifications</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Push to Remote */}
      {pushingRemote && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/40">
              <div className="flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-semibold text-white">
                  Push vers {pushingRemote.name}
                </h3>
              </div>
              <button
                onClick={() => setPushingRemote(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Branche à pousser
                </label>
                <input
                  type="text"
                  value={pushBranch}
                  onChange={(e) => setPushBranch(e.target.value)}
                  placeholder="ex: main, develop, feature/x"
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="space-y-2 pt-1">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={setUpstream}
                    onChange={(e) => setSetUpstream(e.target.checked)}
                    className="mt-0.5 rounded bg-slate-950 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-slate-200">
                      Définir comme branche amont (-u / --set-upstream)
                    </span>
                    <p className="text-slate-400 text-[11px]">
                      Lie votre branche locale à la branche distante correspondante.
                    </p>
                  </div>
                </label>

                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={forcePush}
                    onChange={(e) => setForcePush(e.target.checked)}
                    className="mt-0.5 rounded bg-slate-950 border-slate-700 text-rose-600 focus:ring-rose-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-rose-300">
                      Forcer la mise à jour protégée (--force-with-lease)
                    </span>
                    <p className="text-slate-400 text-[11px]">
                      Écrase l’historique distant uniquement si aucun tiers n’a poussé de nouveaux commits.
                    </p>
                  </div>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setPushingRemote(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={handleConfirmPush}
                  disabled={submittingPush || !pushBranch.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingPush && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>Confirmer le push</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
