import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Tag,
  RefreshCw,
  Plus,
  Search,
  UploadCloud,
  Trash2,
  GitCommit,
  Clock,
  Sparkles,
  Rocket,
  X,
  MessageSquare,
  AlertTriangle
} from 'lucide-react';
import {
  fetchGitTags,
  createGitTag,
  deleteGitTag,
  pushGitTag,
  pushAllGitTags
} from '../services/api';
import type { GitTagDetail } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

export interface GitTagsViewProps {
  workspace: string;
  onOpenReleaseModal?: (tag: GitTagDetail) => void;
  onNotify?: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export const GitTagsView: React.FC<GitTagsViewProps> = ({
  workspace,
  onOpenReleaseModal,
  onNotify
}) => {
  const { t } = useI18n();
  const [tags, setTags] = useState<GitTagDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'annotated' | 'lightweight'>('all');
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Modal: Create Tag
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [tagName, setTagName] = useState('');
  const [targetCommit, setTargetCommit] = useState('HEAD');
  const [tagMessage, setTagMessage] = useState('');
  const [pushOnCreate, setPushOnCreate] = useState(false);
  const [remoteName, setRemoteName] = useState('origin');
  const [submittingCreate, setSubmittingCreate] = useState(false);

  // Modal: Delete Tag
  const [deletingTag, setDeletingTag] = useState<GitTagDetail | null>(null);
  const [deleteRemote, setDeleteRemote] = useState(false);
  const [submittingDelete, setSubmittingDelete] = useState(false);

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
    fetchGitTags(workspace)
      .then((data) => {
        if (!cancelled) {
          setTags(data);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('git_error_loading_tags', 'Erreur chargement des tags');
          notify(message, 'error');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [workspace, notify, t]);

  const loadTags = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchGitTags(workspace);
      setTags(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('git_error_loading_tags', 'Erreur chargement des tags');
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [workspace, notify, t]);

  // SemVer Suggestions Calculation
  const semverSuggestions = useMemo(() => {
    let highest: { major: number; minor: number; patch: number; raw: string } | null = null;
    const semverRegex = /^v?(\d+)\.(\d+)\.(\d+)$/;

    for (const tagItem of tags) {
      const match = tagItem.name.match(semverRegex);
      if (match) {
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        const patch = parseInt(match[3], 10);
        if (
          !highest ||
          major > highest.major ||
          (major === highest.major && minor > highest.minor) ||
          (major === highest.major && minor === highest.minor && patch > highest.patch)
        ) {
          highest = { major, minor, patch, raw: tagItem.name };
        }
      }
    }

    const hasVPrefix = highest ? highest.raw.startsWith('v') : true;
    const prefix = hasVPrefix ? 'v' : '';

    if (!highest) {
      return {
        patch: `${prefix}0.1.0`,
        minor: `${prefix}0.2.0`,
        major: `${prefix}1.0.0`
      };
    }

    return {
      patch: `${prefix}${highest.major}.${highest.minor}.${highest.patch + 1}`,
      minor: `${prefix}${highest.major}.${highest.minor + 1}.0`,
      major: `${prefix}${highest.major + 1}.0.0`
    };
  }, [tags]);

  const handlePushTag = async (tag: GitTagDetail) => {
    setActionLoading((prev) => ({ ...prev, [`push-${tag.name}`]: true }));
    try {
      const res = await pushGitTag(tag.name, 'origin', workspace);
      notify(`Tag "${tag.name}" poussé : ${res.output.slice(0, 100)}`, 'success');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('git_error_pushing_tag', 'Erreur lors du push');
      notify(`Échec du push du tag ${tag.name} : ${errMsg}`, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, [`push-${tag.name}`]: false }));
    }
  };

  const handlePushAllTags = async () => {
    setActionLoading((prev) => ({ ...prev, 'push-all': true }));
    try {
      const res = await pushAllGitTags('origin', workspace);
      notify(`Tous les tags ont été poussés : ${res.output.slice(0, 100)}`, 'success');
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('git_error_pushing_all_tags', 'Erreur lors du push --tags');
      notify(`Échec du push de tous les tags : ${errMsg}`, 'error');
    } finally {
      setActionLoading((prev) => ({ ...prev, 'push-all': false }));
    }
  };

  const handleOpenCreate = (suggested?: string) => {
    setTagName(suggested || '');
    setTargetCommit('HEAD');
    setTagMessage('');
    setPushOnCreate(false);
    setRemoteName('origin');
    setIsCreateOpen(true);
  };

  const handleCreateTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = tagName.trim();
    if (!name) {
      notify(t('git_tag_name_required', 'Le nom du tag est obligatoire'), 'warning');
      return;
    }

    setSubmittingCreate(true);
    try {
      await createGitTag({
        name,
        target_commit: targetCommit.trim() || 'HEAD',
        message: tagMessage.trim() || undefined,
        push: pushOnCreate,
        remote: remoteName.trim() || 'origin',
        workspace
      });
      notify(`Tag "${name}" créé avec succès`, 'success');
      setIsCreateOpen(false);
      await loadTags();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('git_error_creating_tag', 'Erreur de création');
      notify(`Impossible de créer le tag : ${errMsg}`, 'error');
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleOpenDelete = (tag: GitTagDetail) => {
    setDeletingTag(tag);
    setDeleteRemote(false);
  };

  const handleConfirmDelete = async () => {
    if (!deletingTag) return;
    setSubmittingDelete(true);
    try {
      await deleteGitTag(deletingTag.name, {
        delete_remote: deleteRemote,
        remote_name: 'origin',
        workspace
      });
      notify(
        `Tag "${deletingTag.name}" supprimé${deleteRemote ? ' (local et distant)' : ''}`,
        'success'
      );
      setDeletingTag(null);
      await loadTags();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('git_error_deleting_tag', 'Erreur de suppression');
      notify(`Impossible de supprimer le tag : ${errMsg}`, 'error');
    } finally {
      setSubmittingDelete(false);
    }
  };

  const filteredTags = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return tags.filter((t) => {
      if (typeFilter === 'annotated' && !t.is_annotated) return false;
      if (typeFilter === 'lightweight' && t.is_annotated) return false;

      if (!query) return true;
      return (
        t.name.toLowerCase().includes(query) ||
        t.commit_short_sha.toLowerCase().includes(query) ||
        t.commit_message.toLowerCase().includes(query) ||
        (t.tag_message && t.tag_message.toLowerCase().includes(query))
      );
    });
  }, [tags, searchQuery, typeFilter]);

  return (
    <div className="flex flex-col h-full bg-slate-950 text-slate-100 overflow-hidden">
      {/* Top Bar / Actions */}
      <div className="p-4 border-b border-slate-800 bg-slate-900/60 backdrop-blur flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
            <Tag className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-white tracking-wide">
                {t('git_tags_title', 'Tags & Releases Git')}
              </h2>
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {tags.length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Jalonnez vos versions logicielles et publiez des releases interactives
            </p>
          </div>
        </div>

        <div className="flex items-center flex-wrap gap-2">
          {/* Type Filter Pills */}
          <div className="flex items-center bg-slate-800/80 p-0.5 rounded-lg border border-slate-700 text-xs">
            <button
              onClick={() => setTypeFilter('all')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'all'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Tous
            </button>
            <button
              onClick={() => setTypeFilter('annotated')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'annotated'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Annotés
            </button>
            <button
              onClick={() => setTypeFilter('lightweight')}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                typeFilter === 'lightweight'
                  ? 'bg-indigo-600 text-white font-medium'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Légers
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('git_filter_tags', 'Filtrer les tags...')}
              className="pl-9 pr-3 py-1.5 text-xs rounded-lg bg-slate-800/80 border border-slate-700 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 w-44 transition-all"
            />
          </div>

          {/* Refresh */}
          <button
            onClick={loadTags}
            disabled={loading}
            title={t('git_refresh_tags', 'Rafraîchir les tags')}
            className="p-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white hover:bg-slate-700 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>

          {/* Push all tags */}
          <button
            onClick={handlePushAllTags}
            disabled={actionLoading['push-all'] || tags.length === 0}
            title={t('git_push_all_tags_tooltip', 'Pousser tous les tags locaux vers origin (--tags)')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <UploadCloud
              className={`w-3.5 h-3.5 text-sky-400 ${
                actionLoading['push-all'] ? 'animate-bounce' : ''
              }`}
            />
            <span>{t('git_push_all', 'Pousser tout')}</span>
          </button>

          {/* New Tag Button */}
          <button
            onClick={() => handleOpenCreate(semverSuggestions.patch)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{t('git_new_tag', 'Nouveau Tag')}</span>
          </button>
        </div>
      </div>

      {/* Tags List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && tags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
            <span className="text-sm">{t('git_loading_tags', 'Chargement des tags Git...')}</span>
          </div>
        ) : filteredTags.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center border-2 border-dashed border-slate-800 rounded-xl bg-slate-900/30">
            <div className="p-3 rounded-full bg-slate-800 text-slate-400 mb-3">
              <Tag className="w-8 h-8" />
            </div>
            <h3 className="text-sm font-semibold text-slate-200">
              {searchQuery ? t('git_no_tags_matched', 'Aucun tag ne correspond à votre filtre') : t('git_no_tags_created', 'Aucun tag Git créé')}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mt-1 mb-4">
              {searchQuery
                ? 'Essayez de réinitialiser la recherche ou de changer le filtre de type.'
                : 'Créez votre première version jalonnée (ex: v0.1.0) pour marquer une étape clé de votre projet.'}
            </p>
            {!searchQuery && (
              <button
                onClick={() => handleOpenCreate('v0.1.0')}
                className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{t('create_tag_v010', 'Créer le tag v0.1.0')}</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {filteredTags.map((tag) => {
              const isPushing = !!actionLoading[`push-${tag.name}`];

              return (
                <div
                  key={tag.name}
                  className="rounded-xl border border-slate-800 bg-slate-900/50 hover:border-slate-700/80 transition-all p-4 flex flex-col gap-2.5 relative overflow-hidden"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    {/* Tag Name & Badges */}
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        <Tag className="w-4 h-4" />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white font-mono tracking-tight">
                          {tag.name}
                        </span>
                        {tag.is_annotated ? (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                            Annoté
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                            Léger
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                      {/* Release Modal Button */}
                      {onOpenReleaseModal && (
                        <button
                          onClick={() => onOpenReleaseModal(tag)}
                          title={t('git_publish_release_tooltip', 'Générer les notes et publier la release')}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm transition-colors"
                        >
                          <Rocket className="w-3.5 h-3.5" />
                          <span>{t('git_publish_release', 'Publier Release')}</span>
                        </button>
                      )}

                      {/* Push single tag */}
                      <button
                        onClick={() => handlePushTag(tag)}
                        disabled={isPushing}
                        title={t('git_push_tag_tooltip', 'Pousser ce tag vers origin')}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors disabled:opacity-50"
                      >
                        <UploadCloud
                          className={`w-3.5 h-3.5 text-sky-400 ${isPushing ? 'animate-bounce' : ''}`}
                        />
                        <span>{t('push', 'Push')}</span>
                      </button>

                      {/* Delete */}
                      <button
                        onClick={() => handleOpenDelete(tag)}
                        title={t('git_delete_tag_tooltip', 'Supprimer ce tag')}
                        className="p-1 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Target Commit details */}
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
                    <div className="flex items-center gap-1.5 font-mono text-slate-300">
                      <GitCommit className="w-3.5 h-3.5 text-indigo-400" />
                      <span className="bg-slate-800 px-1.5 py-0.5 rounded text-[11px] border border-slate-700">
                        {tag.commit_short_sha}
                      </span>
                    </div>

                    {tag.commit_message && (
                      <span className="text-slate-300 truncate max-w-md" title={tag.commit_message}>
                        {tag.commit_message}
                      </span>
                    )}

                    {tag.commit_date && (
                      <div className="flex items-center gap-1 text-slate-500 text-[11px] ml-auto">
                        <Clock className="w-3 h-3" />
                        <span>{tag.commit_date}</span>
                      </div>
                    )}
                  </div>

                  {/* Annotated Message if any */}
                  {tag.tag_message && (
                    <div className="mt-1 p-2.5 rounded-lg bg-slate-950/70 border border-slate-800/80 text-xs text-slate-300 flex items-start gap-2">
                      <MessageSquare className="w-3.5 h-3.5 text-emerald-400 mt-0.5 flex-shrink-0" />
                      <div className="space-y-0.5 overflow-hidden">
                        <div className="font-semibold text-slate-400 text-[10px] uppercase tracking-wider">
                          Message du tag {tag.tagger_name ? `• par ${tag.tagger_name}` : ''}
                        </div>
                        <p className="whitespace-pre-wrap break-words text-slate-200">
                          {tag.tag_message}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Modal: Create Tag */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/40">
              <div className="flex items-center gap-2">
                <Tag className="w-4 h-4 text-emerald-400" />
                <h3 className="text-sm font-semibold text-white">{t('git_new_tag_modal', 'Nouveau Tag Git')}</h3>
              </div>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCreateTag} className="p-4 space-y-4">
              {/* SemVer Quick Pill Suggestions */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                  <span>{t('git_semver_suggestions', 'Suggestions SemVer')}</span>
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setTagName(semverSuggestions.patch)}
                    className="p-1.5 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 flex flex-col items-center justify-center transition-all hover:border-emerald-500/50"
                  >
                    <span className="text-[10px] text-slate-400">{t('git_patch', 'Patch')}</span>
                    <span className="font-mono font-medium text-emerald-400">
                      {semverSuggestions.patch}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagName(semverSuggestions.minor)}
                    className="p-1.5 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 flex flex-col items-center justify-center transition-all hover:border-indigo-500/50"
                  >
                    <span className="text-[10px] text-slate-400">{t('git_minor', 'Mineure')}</span>
                    <span className="font-mono font-medium text-indigo-400">
                      {semverSuggestions.minor}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setTagName(semverSuggestions.major)}
                    className="p-1.5 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-200 flex flex-col items-center justify-center transition-all hover:border-purple-500/50"
                  >
                    <span className="text-[10px] text-slate-400">{t('git_major', 'Majeure')}</span>
                    <span className="font-mono font-medium text-purple-400">
                      {semverSuggestions.major}
                    </span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {t('git_tag_name_label', 'Nom du Tag')} <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: v1.0.0, release-2026-09"
                  value={tagName}
                  onChange={(e) => setTagName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Commit Cible (défaut : HEAD)
                </label>
                <input
                  type="text"
                  placeholder={t('git_tag_target_placeholder', 'HEAD, hash SHA ou nom de branche')}
                  value={targetCommit}
                  onChange={(e) => setTargetCommit(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Message du Tag (Optionnel — crée un tag annoté)
                </label>
                <textarea
                  rows={3}
                  placeholder={t('git_tag_notes_placeholder', 'Description ou notes de version...')}
                  value={tagMessage}
                  onChange={(e) => setTagMessage(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 resize-none"
                />
              </div>

              <div className="space-y-2 pt-1 border-t border-slate-800">
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={pushOnCreate}
                    onChange={(e) => setPushOnCreate(e.target.checked)}
                    className="mt-0.5 rounded bg-slate-950 border-slate-700 text-emerald-600 focus:ring-emerald-500"
                  />
                  <div className="text-xs">
                    <span className="font-medium text-slate-200">
                      {t('git_push_immediately', 'Pousser immédiatement vers le remote')}
                    </span>
                    <p className="text-slate-400 text-[11px]">
                      Exécute `git push origin {tagName || '<tag>'}` à la création.
                    </p>
                  </div>
                </label>

                {pushOnCreate && (
                  <div className="pl-6">
                    <input
                      type="text"
                      placeholder={t('git_remote_name_placeholder', 'Nom du remote (ex: origin)')}
                      value={remoteName}
                      onChange={(e) => setRemoteName(e.target.value)}
                      className="w-full px-2.5 py-1 text-xs rounded bg-slate-950 border border-slate-700 text-slate-200 font-mono"
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  {t('cancel', 'Annuler')}
                </button>
                <button
                  type="submit"
                  disabled={submittingCreate || !tagName.trim()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingCreate && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>{t('git_create_tag_btn', 'Créer le tag')}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Delete Tag */}
      {deletingTag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-slate-900 border border-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleUp">
            <div className="flex items-center justify-between p-4 border-b border-slate-800 bg-slate-800/40">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-400" />
                <h3 className="text-sm font-semibold text-white">{t('git_delete_tag_title', 'Supprimer le Tag')}</h3>
              </div>
              <button
                onClick={() => setDeletingTag(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <p className="text-xs text-slate-300">
                Êtes-vous certain de vouloir supprimer le tag{' '}
                <strong className="text-white font-mono">{deletingTag.name}</strong> ?
              </p>

              <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-lg bg-slate-950 border border-slate-800">
                <input
                  type="checkbox"
                  checked={deleteRemote}
                  onChange={(e) => setDeleteRemote(e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-rose-600 focus:ring-rose-500"
                />
                <div className="text-xs">
                  <span className="font-medium text-rose-300">
                    Supprimer également sur le dépôt distant (origin)
                  </span>
                  <p className="text-slate-400 text-[11px] mt-0.5">
                    Exécute `git push origin --delete {deletingTag.name}`.
                  </p>
                </div>
              </label>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setDeletingTag(null)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                >
                  {t('cancel', 'Annuler')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmDelete}
                  disabled={submittingDelete}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white shadow-sm transition-all disabled:opacity-50"
                >
                  {submittingDelete && <RefreshCw className="w-3 h-3 animate-spin" />}
                  <span>{t('delete_permanently', 'Supprimer définitivement')}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
