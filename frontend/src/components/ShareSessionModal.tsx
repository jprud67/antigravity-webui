import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Share2,
  Copy,
  Check,
  Lock,
  Unlock,
  Eye,
  Users,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Clock,
  Sparkles,
  Shield,
  Terminal,
  Sliders,
  Edit3
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import { createShareLink, fetchShareLinks, revokeShareLink, updateSharePermissions } from '../services/api';
import { showToast } from '../services/toast';
import { copyText } from '../utils/codeBlockUtils';
import type { ShareLinkItem } from '../types';

interface ShareSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | null;
}

export const ShareSessionModal: React.FC<ShareSessionModalProps> = ({
  isOpen,
  onClose,
  conversationId
}) => {
  const { t } = useI18n();

  // Creation form state
  const [permission, setPermission] = useState<'read' | 'write'>('read');
  const [durationHours, setDurationHours] = useState<number | null>(24);
  const [pinEnabled, setPinEnabled] = useState<boolean>(false);
  const [pinCode, setPinCode] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Newly generated link state
  const [newlyCreatedUrl, setNewlyCreatedUrl] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Active links list
  const [activeLinks, setActiveLinks] = useState<ShareLinkItem[]>([]);
  const [loadingLinks, setLoadingLinks] = useState<boolean>(false);
  const [revokingToken, setRevokingToken] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [expandedPermissionsToken, setExpandedPermissionsToken] = useState<string | null>(null);
  const [updatingPermsToken, setUpdatingPermsToken] = useState<string | null>(null);

  const handleTogglePermission = async (
    token: string,
    key: 'can_write' | 'can_run_terminal' | 'requires_approval',
    currentVal: boolean
  ) => {
    try {
      setUpdatingPermsToken(token);
      const patch = { [key]: !currentVal };
      const updated = await updateSharePermissions(token, patch);
      setActiveLinks((prev) =>
        prev.map((l) =>
          l.token === token
            ? {
                ...l,
                can_write: updated.can_write,
                can_run_terminal: updated.can_run_terminal,
                requires_approval: updated.requires_approval,
              }
            : l
        )
      );
      showToast(t('share_permissions_updated') || 'Permissions mises à jour', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la mise à jour des permissions', 'error');
    } finally {
      setUpdatingPermsToken(null);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const interval = setInterval(() => setNowMs(Date.now()), 30000);
    return () => clearInterval(interval);
  }, [isOpen]);

  const loadLinks = useCallback(async () => {
    if (!conversationId) return;
    try {
      setLoadingLinks(true);
      const res = await fetchShareLinks(conversationId);
      setActiveLinks(res.links || []);
    } catch (err: any) {
      console.error('Failed to load share links:', err);
    } finally {
      setLoadingLinks(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!isOpen || !conversationId) return;
    let isCancelled = false;
    fetchShareLinks(conversationId)
      .then((res) => {
        if (!isCancelled) {
          setActiveLinks(res.links || []);
        }
      })
      .catch((err: any) => {
        console.error('Failed to load share links:', err);
      });

    return () => {
      isCancelled = true;
      setNewlyCreatedUrl(null);
      setCopiedLink(false);
    };
  }, [isOpen, conversationId]);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!conversationId) return;

    if (pinEnabled && pinCode.trim()) {
      const cleanPin = pinCode.trim();
      if (!/^\d{4,8}$/.test(cleanPin)) {
        showToast(t('share_pin_placeholder') || '4-8 digits required', 'warning');
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const payload = {
        conversation_id: conversationId,
        permission,
        duration_hours: durationHours,
        pin_code: pinEnabled && pinCode.trim() ? pinCode.trim() : null
      };

      const res = await createShareLink(payload);
      const shareUrl = `${window.location.origin}/share/${res.token}`;
      setNewlyCreatedUrl(shareUrl);

      // Copy automatically with resilient fallback
      try {
        const copied = await copyText(shareUrl);
        if (copied) {
          setCopiedLink(true);
          showToast(t('share_link_copied') || 'Link copied to clipboard!', 'success');
        }
      } catch {
        // Fallback silently if clipboard unavailable
      }

      // Refresh list
      await loadLinks();
    } catch (err: any) {
      showToast(err.message || 'Error generating link', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRevoke = async (token: string) => {
    setRevokingToken(token);
    try {
      await revokeShareLink(token);
      showToast(t('share_revoked_toast') || 'Link revoked', 'success');
      await loadLinks();
      if (newlyCreatedUrl && newlyCreatedUrl.includes(token)) {
        setNewlyCreatedUrl(null);
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to revoke link', 'error');
    } finally {
      setRevokingToken(null);
    }
  };

  const copyExistingLink = async (token: string) => {
    const url = `${window.location.origin}/share/${token}`;
    const copied = await copyText(url);
    if (copied) {
      showToast(t('share_link_copied') || 'Link copied!', 'success');
    }
  };

  const formatRemainingTime = (expiresAt: string | null) => {
    if (!expiresAt) return t('share_duration_forever');
    const diff = new Date(expiresAt).getTime() - nowMs;
    if (diff <= 0) return 'Expired';
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours > 24) {
      const days = Math.floor(hours / 24);
      return `${days}d ${hours % 24}h`;
    }
    return `${hours}h ${mins}m`;
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-zinc-100"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/80">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <Share2 size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-white flex items-center gap-2">
                {t('share_modal_title') || 'Share Session & Live Collaboration'}
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  Live
                </span>
              </h2>
              <p className="text-xs text-zinc-400">
                {t('share_modal_desc') || 'Generate a secure direct link to share this session.'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
          {/* Section: Mode selection */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-zinc-300 uppercase tracking-wider">
              {t('workspace_permission') || 'Permission & Access Mode'}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Spectator Mode */}
              <div
                onClick={() => setPermission('read')}
                className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                  permission === 'read'
                    ? 'border-cyan-500/50 bg-cyan-500/10 shadow-lg shadow-cyan-950/30'
                    : 'border-zinc-800 bg-zinc-800/40 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-medium text-sm text-cyan-300">
                    <Eye size={16} />
                    {t('share_mode_spectator') || 'Spectator Mode'}
                  </div>
                  {permission === 'read' && (
                    <span className="w-2 h-2 rounded-full bg-cyan-400 shadow-[0_0_8px_#22d3ee]" />
                  )}
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {t('share_mode_spectator_desc') || 'Read-only access. Live stream and artifact inspection.'}
                </p>
              </div>

              {/* Co-Pilot Mode */}
              <div
                onClick={() => setPermission('write')}
                className={`cursor-pointer rounded-xl p-3.5 border transition-all flex flex-col justify-between ${
                  permission === 'write'
                    ? 'border-purple-500/50 bg-purple-500/10 shadow-lg shadow-purple-950/30'
                    : 'border-zinc-800 bg-zinc-800/40 hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2 font-medium text-sm text-purple-300">
                    <Users size={16} />
                    {t('share_mode_copilot') || 'Co-Pilot Mode'}
                  </div>
                  {permission === 'write' && (
                    <span className="w-2 h-2 rounded-full bg-purple-400 shadow-[0_0_8px_#c084fc]" />
                  )}
                </div>
                <p className="text-xs text-zinc-400 leading-relaxed">
                  {t('share_mode_copilot_desc') || 'Interactive collaboration. Can send prompts and steer.'}
                </p>
              </div>
            </div>
          </div>

          {/* Section: Duration and Security */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Expiration */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 uppercase tracking-wider flex items-center gap-1.5">
                <Clock size={14} className="text-zinc-400" />
                {t('share_duration_label') || 'Validity Duration'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 1, label: t('share_duration_1h') || '1h' },
                  { value: 24, label: t('share_duration_24h') || '24h' },
                  { value: 168, label: t('share_duration_7d') || '7d' },
                  { value: null, label: t('share_duration_forever') || 'Forever' }
                ].map((dur) => (
                  <button
                    key={String(dur.value)}
                    type="button"
                    onClick={() => setDurationHours(dur.value)}
                    className={`py-2 px-3 text-xs font-medium rounded-lg border transition text-center truncate ${
                      durationHours === dur.value
                        ? 'border-purple-500 bg-purple-500/20 text-purple-200'
                        : 'border-zinc-800 bg-zinc-800/40 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                    }`}
                  >
                    {dur.label}
                  </button>
                ))}
              </div>
            </div>

            {/* PIN Protection */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-zinc-300 uppercase tracking-wider flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-zinc-400" />
                  {t('share_pin_protect') || 'Protect with PIN'}
                </span>
                <input
                  type="checkbox"
                  checked={pinEnabled}
                  onChange={(e) => setPinEnabled(e.target.checked)}
                  className="rounded border-zinc-700 bg-zinc-800 text-purple-600 focus:ring-purple-500 cursor-pointer"
                />
              </label>
              {pinEnabled ? (
                <div className="relative">
                  <input
                    type="text"
                    maxLength={8}
                    value={pinCode}
                    onChange={(e) => setPinCode(e.target.value.replace(/\D/g, ''))}
                    placeholder={t('share_pin_placeholder') || '4 to 8 digits...'}
                    className="w-full bg-zinc-800/80 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-purple-500 font-mono tracking-widest"
                  />
                  <div className="absolute right-3 top-2.5 text-zinc-400">
                    <Lock size={14} />
                  </div>
                </div>
              ) : (
                <div className="h-[38px] flex items-center px-3 rounded-lg border border-dashed border-zinc-800 text-xs text-zinc-500 bg-zinc-900/30">
                  <Unlock size={13} className="mr-1.5" />
                  Public access via direct link
                </div>
              )}
            </div>
          </div>

          {/* Action: Generate Button */}
          <button
            type="button"
            disabled={isSubmitting || !conversationId}
            onClick={handleCreate}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium text-sm shadow-lg shadow-purple-900/30 hover:shadow-purple-900/50 transition-all disabled:opacity-50"
          >
            <Sparkles size={16} />
            {isSubmitting ? 'Generating...' : t('share_generate_link') || 'Generate Share Link'}
          </button>

          {/* Newly Created Link Feedback */}
          {newlyCreatedUrl && (
            <div className="p-4 rounded-xl bg-purple-500/10 border border-purple-500/30 space-y-2 animate-fade-in">
              <div className="flex items-center justify-between text-xs text-purple-300 font-medium">
                <span className="flex items-center gap-1.5">
                  <Check size={14} className="text-emerald-400" />
                  {t('share_link_copied') || 'Link generated and copied to clipboard!'}
                </span>
                <a
                  href={newlyCreatedUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-purple-400 hover:text-purple-200 transition"
                >
                  <ExternalLink size={12} />
                  {t('share_preview_open_tab') || 'Open'}
                </a>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={newlyCreatedUrl}
                  className="flex-1 bg-zinc-900/80 border border-purple-500/30 rounded-lg px-3 py-1.5 text-xs text-purple-200 font-mono select-all focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    if (newlyCreatedUrl) {
                      const copied = await copyText(newlyCreatedUrl);
                      if (copied) {
                        setCopiedLink(true);
                        setTimeout(() => setCopiedLink(false), 2000);
                      }
                    }
                  }}
                  className="p-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition"
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          {/* Active Links Section */}
          <div className="space-y-3 pt-2 border-t border-zinc-800">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {t('share_active_links') || 'Active Share Links'}
              </h3>
              <span className="text-xs text-zinc-500">
                {activeLinks.length} {t('share_active_links') ? '' : 'links'}
              </span>
            </div>

            {loadingLinks ? (
              <div className="text-center py-6 text-zinc-500 text-xs">Loading active links...</div>
            ) : activeLinks.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-zinc-800/80 rounded-xl text-zinc-500 text-xs">
                {t('share_no_active_links') || 'No active share links for this session'}
              </div>
            ) : (
              <div className="space-y-2">
                {activeLinks.map((link) => (
                  <div
                    key={link.token}
                    className="flex flex-col p-3 rounded-xl bg-zinc-800/30 border border-zinc-800 hover:border-zinc-700 transition"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                      {/* Permission Badge */}
                      <span
                        className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${
                          link.permission === 'write'
                            ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                            : 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30'
                        }`}
                      >
                        {link.permission === 'write'
                          ? t('share_mode_copilot') || 'Co-Pilot'
                          : t('share_mode_spectator') || 'Spectator'}
                      </span>

                      {/* Lock indicator */}
                      {link.has_pin && (
                        <span className="text-amber-400 flex items-center gap-1 text-[11px]" title="PIN Protected">
                          <Lock size={12} />
                          PIN
                        </span>
                      )}

                      {/* Expiration */}
                      <span className="text-xs text-zinc-400 flex items-center gap-1">
                        <Clock size={12} className="text-zinc-500" />
                        {formatRemainingTime(link.expires_at)}
                      </span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPermissionsToken(
                            expandedPermissionsToken === link.token ? null : link.token
                          )
                        }
                        className={`p-1.5 rounded-lg transition ${
                          expandedPermissionsToken === link.token
                            ? 'bg-purple-600/30 text-purple-300'
                            : 'text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                        }`}
                        title="Permissions granulaires (Écriture, Terminal, Approbation)"
                      >
                        <Sliders size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => copyExistingLink(link.token)}
                        className="p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-700/50 transition"
                        title={t('common_copy') || 'Copy Link'}
                      >
                        <Copy size={14} />
                      </button>
                      <button
                        type="button"
                        disabled={revokingToken === link.token}
                        onClick={() => handleRevoke(link.token)}
                        className="p-1.5 text-red-400 hover:text-red-300 rounded-lg hover:bg-red-500/10 transition disabled:opacity-50"
                        title={t('share_revoke') || 'Revoke Link'}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  {expandedPermissionsToken === link.token && (
                    <div className="mt-2.5 pt-2.5 border-t border-zinc-700/60 grid grid-cols-3 gap-2 text-[11px]">
                      <button
                        type="button"
                        disabled={updatingPermsToken === link.token}
                        onClick={() =>
                          handleTogglePermission(
                            link.token,
                            'can_write',
                            link.can_write !== undefined ? link.can_write : link.permission === 'write'
                          )
                        }
                        className={`flex items-center justify-between p-2 rounded-lg border transition ${
                          (link.can_write ?? (link.permission === 'write'))
                            ? 'bg-purple-950/40 border-purple-700/60 text-purple-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500'
                        }`}
                        title="Activer/désactiver les droits d'écriture et de prompt"
                      >
                        <span className="flex items-center gap-1.5">
                          <Edit3 size={12} />
                          Écriture
                        </span>
                        <span className="font-semibold text-[10px]">
                          {(link.can_write ?? (link.permission === 'write')) ? 'OUI' : 'NON'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={updatingPermsToken === link.token}
                        onClick={() =>
                          handleTogglePermission(
                            link.token,
                            'can_run_terminal',
                            Boolean(link.can_run_terminal)
                          )
                        }
                        className={`flex items-center justify-between p-2 rounded-lg border transition ${
                          link.can_run_terminal
                            ? 'bg-emerald-950/40 border-emerald-700/60 text-emerald-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500'
                        }`}
                        title="Activer/bloquer l'exécution de commandes dans le terminal"
                      >
                        <span className="flex items-center gap-1.5">
                          <Terminal size={12} />
                          Terminal
                        </span>
                        <span className="font-semibold text-[10px]">
                          {link.can_run_terminal ? 'ACTIF' : 'BLOQUÉ'}
                        </span>
                      </button>

                      <button
                        type="button"
                        disabled={updatingPermsToken === link.token}
                        onClick={() =>
                          handleTogglePermission(
                            link.token,
                            'requires_approval',
                            link.requires_approval !== undefined ? link.requires_approval : true
                          )
                        }
                        className={`flex items-center justify-between p-2 rounded-lg border transition ${
                          (link.requires_approval ?? true)
                            ? 'bg-amber-950/40 border-amber-700/60 text-amber-200'
                            : 'bg-zinc-900 border-zinc-800 text-zinc-500'
                        }`}
                        title="Exiger l'approbation de l'hôte pour les opérations critiques"
                      >
                        <span className="flex items-center gap-1.5">
                          <Shield size={12} />
                          Approbation
                        </span>
                        <span className="font-semibold text-[10px]">
                          {(link.requires_approval ?? true) ? 'REQUISE' : 'LIBRE'}
                        </span>
                      </button>
                    </div>
                  )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
