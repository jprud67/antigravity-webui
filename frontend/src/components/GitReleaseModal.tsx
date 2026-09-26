import React, { useState, useEffect, useCallback } from 'react';
import {
  Rocket,
  X,
  RefreshCw,
  Copy,
  Check,
  ExternalLink,
  Tag,
  GitCommit,
  Terminal,
  Globe,
  Eye,
  Edit3
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { fetchReleaseNotes, publishGitRelease } from '../services/api';
import type { GitTagDetail, ReleaseNotesResponse } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

export interface GitReleaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  tag: GitTagDetail | null;
  workspace: string;
  onReleasePublished?: () => void;
  onNotify?: (msg: string, type: 'info' | 'success' | 'warning' | 'error') => void;
}

export const GitReleaseModal: React.FC<GitReleaseModalProps> = ({
  isOpen,
  onClose,
  tag,
  workspace,
  onReleasePublished,
  onNotify
}) => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [releaseData, setReleaseData] = useState<ReleaseNotesResponse | null>(null);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [isPrerelease, setIsPrerelease] = useState(false);
  const [activeTab, setActiveTab] = useState<'edit' | 'preview'>('edit');
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

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
    if (!isOpen || !tag) return;
    let cancelled = false;
    fetchReleaseNotes(tag.name, undefined, workspace)
      .then((data) => {
        if (!cancelled) {
          setReleaseData(data);
          setTitle(data.suggested_title);
          setNotes(data.changelog_markdown);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : t('git_error_loading_notes', 'Erreur chargement des notes');
          notify(msg, 'error');
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, tag, workspace, notify]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !tag) return null;

  const handleCopyNotes = async () => {
    try {
      await navigator.clipboard.writeText(notes);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      notify('Notes de version copiées dans le presse-papiers', 'success');
    } catch {
      notify('Impossible de copier les notes', 'error');
    }
  };

  const handlePublish = async () => {
    if (!title.trim()) {
      notify('Le titre de la release est obligatoire', 'warning');
      return;
    }

    setSubmitting(true);
    try {
      const res = await publishGitRelease({
        tag: tag.name,
        title: title.trim(),
        notes: notes.trim(),
        draft: isDraft,
        prerelease: isPrerelease,
        workspace
      });

      if (res.mode === 'cli') {
        notify(`Release ${tag.name} publiée avec succès via GitHub CLI`, 'success');
        if (onReleasePublished) onReleasePublished();
        onClose();
      } else if (res.url) {
        window.open(res.url, '_blank', 'noopener,noreferrer');
        notify(t('release_draft_opened_github', 'Brouillon de release ouvert dans GitHub Web'), 'info');
        if (onReleasePublished) onReleasePublished();
        onClose();
      } else {
        notify(res.message, 'info');
        onClose();
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : t('git_error_publishing', 'Erreur de publication');
      notify(`Échec de publication : ${errMsg}`, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenGitHubWeb = () => {
    if (releaseData?.github_release_url) {
      window.open(releaseData.github_release_url, '_blank', 'noopener,noreferrer');
    } else {
      // Fallback constructed link
      const fallbackUrl = `https://github.com/releases/new?tag=${encodeURIComponent(tag.name)}&title=${encodeURIComponent(title)}&body=${encodeURIComponent(notes)}`;
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-scaleUp">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 bg-slate-800/40 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white tracking-wide">
                  Interactive Release Publisher
                </h3>
                <span className="flex items-center gap-1 px-2 py-0.5 text-xs font-mono font-medium rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                  <Tag className="w-3 h-3" />
                  {tag.name}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Génération automatique du changelog et publication GitHub
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-400" />
            <span className="text-sm">{t('generating_changelog_conventional', 'Génération du changelog avec Conventional Commits...')}</span>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {/* Meta bar: previous tag + commits count + cli status */}
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-slate-300">
                  <GitCommit className="w-3.5 h-3.5 text-indigo-400" />
                  <span>
                    <strong>{releaseData?.commit_count || 0}</strong> {t('commits_included', 'commit(s) inclus')}
                  </span>
                </div>
                {releaseData?.previous_tag && (
                  <div className="text-slate-400">
                    depuis <span className="font-mono text-slate-200">{releaseData.previous_tag}</span>
                  </div>
                )}
              </div>

              {/* GitHub CLI indicator */}
              <div className="flex items-center gap-1.5">
                {releaseData?.has_gh_cli ? (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[11px] font-medium">
                    <Terminal className="w-3 h-3 text-emerald-400" />
                    CLI `gh` détecté
                  </span>
                ) : (
                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px] font-medium">
                    <Globe className="w-3 h-3 text-amber-400" />
                    {t('github_web_publishing', 'Publication Web GitHub')}
                  </span>
                )}
              </div>
            </div>

            {/* Release Title */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {t('release_title_label', 'Titre de la Release')} <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="ex: Release v0.2.23 - Git Remotes & Tags Studio"
                className="w-full px-3 py-2 text-xs rounded-lg bg-slate-950 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 font-medium"
              />
            </div>

            {/* Changelog Editor / Preview with Tabs */}
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/50">
              <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-900/60">
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setActiveTab('edit')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      activeTab === 'edit'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Edit3 className="w-3 h-3" />
                    <span>{t('edit_markdown', 'Éditer Markdown')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('preview')}
                    className={`flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                      activeTab === 'preview'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    <Eye className="w-3 h-3" />
                    <span>{t('preview_rendered', 'Aperçu Rendu')}</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={handleCopyNotes}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span className="text-emerald-300">{t('copied_exclamation', 'Copié !')}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>{t('copy_markdown', 'Copier Markdown')}</span>
                    </>
                  )}
                </button>
              </div>

              {activeTab === 'edit' ? (
                <textarea
                  rows={10}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder={t('release_notes_placeholder', 'Notes de version en Markdown...')}
                  className="w-full p-3 text-xs rounded-b-xl bg-slate-950 border-0 text-slate-200 placeholder-slate-500 focus:outline-none font-mono resize-y leading-relaxed"
                />
              ) : (
                <div className="p-4 max-h-[300px] overflow-y-auto text-xs text-slate-200 prose prose-invert prose-sm max-w-none">
                  {notes ? (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{notes}</ReactMarkdown>
                  ) : (
                    <span className="text-slate-500 italic">{t('no_release_notes', 'Aucune note de version rédigée.')}</span>
                  )}
                </div>
              )}
            </div>

            {/* Options Toggles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isDraft}
                  onChange={(e) => setIsDraft(e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-indigo-500"
                />
                <div className="text-xs">
                  <span className="font-medium text-slate-200">{t('save_as_draft', 'Enregistrer comme brouillon')}</span>
                  <p className="text-slate-400 text-[11px]">
                    {t('save_as_draft_desc', 'Non visible publiquement tant que non validée.')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2.5 rounded-lg bg-slate-950 border border-slate-800/80 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isPrerelease}
                  onChange={(e) => setIsPrerelease(e.target.checked)}
                  className="mt-0.5 rounded bg-slate-900 border-slate-700 text-amber-600 focus:ring-amber-500"
                />
                <div className="text-xs">
                  <span className="font-medium text-amber-300">{t('mark_as_prerelease', 'Marquer comme pré-version')}</span>
                  <p className="text-slate-400 text-[11px]">
                    {t('mark_as_prerelease_desc', 'Indique qu’il s’agit d’une version alpha/bêta/rc.')}
                  </p>
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-800/40 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={handleOpenGitHubWeb}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors disabled:opacity-50"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t('open_on_github_web', 'Ouvrir sur GitHub Web')}</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {t('cancel', 'Annuler')}
            </button>
            <button
              type="button"
              onClick={handlePublish}
              disabled={loading || submitting || !title.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white shadow-md transition-all disabled:opacity-50"
            >
              {submitting ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Rocket className="w-3.5 h-3.5" />
              )}
              <span>
                {releaseData?.has_gh_cli
                  ? t('git_publish_via_cli', 'Publier via GitHub CLI')
                  : t('git_prepare_release_web', 'Préparer la Release (Web)')}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
