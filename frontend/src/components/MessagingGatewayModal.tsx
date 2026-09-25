import React, { useState, useEffect, useCallback } from 'react';
import { 
  MessageSquare, 
  X, 
  RefreshCw, 
  CheckCircle2, 
  Trash2, 
  Key, 
  Send, 
  Check, 
  Loader2, 
  ShieldCheck,
  Smartphone,
  Lock,
  Clock
} from 'lucide-react';
import { 
  fetchGatewayStatus, 
  fetchPendingPairings, 
  fetchApprovedDevices, 
  approvePairingCode, 
  revokeDevice, 
  saveBotConfig 
} from '../services/api';
import type { MessagingGatewayStatus, PairingCodeItem, ApprovedDeviceItem } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface MessagingGatewayModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const getRemainingMinutes = (expiresAt: number): number => {
  return Math.max(0, Math.round((expiresAt - Date.now() / 1000) / 60));
};

export const MessagingGatewayModal: React.FC<MessagingGatewayModalProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const [tab, setTab] = useState<'pairing' | 'telegram' | 'discord'>('pairing');
  const [status, setStatus] = useState<MessagingGatewayStatus | null>(null);
  const [pending, setPending] = useState<PairingCodeItem[]>([]);
  const [approved, setApproved] = useState<ApprovedDeviceItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [manualCode, setManualCode] = useState('');
  const [approving, setApproving] = useState(false);

  // Form states for bot configs
  const [tgToken, setTgToken] = useState('');
  const [tgChatId, setTgChatId] = useState('');
  const [tgNotifyApproval, setTgNotifyApproval] = useState(true);
  const [tgNotifyComplete, setTgNotifyComplete] = useState(true);

  const [dcToken, setDcToken] = useState('');
  const [dcChatId, setDcChatId] = useState('');
  const [dcNotifyApproval, setDcNotifyApproval] = useState(true);
  const [dcNotifyComplete, setDcNotifyComplete] = useState(true);

  const [savingBot, setSavingBot] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [st, p, a] = await Promise.all([
        fetchGatewayStatus(),
        fetchPendingPairings(),
        fetchApprovedDevices()
      ]);
      setStatus(st);
      setPending(p.pending);
      setApproved(a.approved);

      if (st.configs.telegram) {
        setTgChatId(st.configs.telegram.chat_id || '');
        setTgNotifyApproval(st.configs.telegram.notify_on_approval);
        setTgNotifyComplete(st.configs.telegram.notify_on_complete);
      }
      if (st.configs.discord) {
        setDcChatId(st.configs.discord.chat_id || '');
        setDcNotifyApproval(st.configs.discord.notify_on_approval);
        setDcNotifyComplete(st.configs.discord.notify_on_complete);
      }
    } catch {
      showToast(t('messaging_data_load_failed', 'Impossible de charger les données de messagerie'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, loadData]);

  const handleApproveCode = async (codeToApprove: string) => {
    setApproving(true);
    try {
      const res = await approvePairingCode(codeToApprove);
      showToast(res.message, 'success');
      setManualCode('');
      loadData();
    } catch (err: any) {
      showToast(err.message || t('invalid_code', 'Code invalide'), 'error');
    } finally {
      setApproving(false);
    }
  };

  const handleRevoke = async (platform: string, userId: string) => {
    try {
      await revokeDevice(platform, userId);
      showToast(t('device_revoked', 'Appareil révoqué'), 'info');
      loadData();
    } catch (err: any) {
      showToast(err.message || t('revoke_failed', 'Échec de révocation'), 'error');
    }
  };

  const handleSaveTelegram = async () => {
    if (!tgToken && !status?.configs.telegram?.has_token) {
      showToast(t('telegram_token_required', 'Veuillez renseigner le token du Bot Telegram'), 'warning');
      return;
    }
    setSavingBot(true);
    try {
      await saveBotConfig({
        platform: 'telegram',
        bot_token: tgToken || 'PRESERVE_EXISTING',
        chat_id: tgChatId,
        is_active: true,
        notify_on_approval: tgNotifyApproval,
        notify_on_complete: tgNotifyComplete
      });
      showToast(t('telegram_config_saved', 'Configuration Telegram enregistrée avec succès !'), 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || t('save_error', 'Erreur enregistrement'), 'error');
    } finally {
      setSavingBot(false);
    }
  };

  const handleSaveDiscord = async () => {
    if (!dcToken && !status?.configs.discord?.has_token) {
      showToast(t('discord_token_required', 'Veuillez renseigner le token du Bot Discord'), 'warning');
      return;
    }
    setSavingBot(true);
    try {
      await saveBotConfig({
        platform: 'discord',
        bot_token: dcToken || 'PRESERVE_EXISTING',
        chat_id: dcChatId,
        is_active: true,
        notify_on_approval: dcNotifyApproval,
        notify_on_complete: dcNotifyComplete
      });
      showToast(t('discord_config_saved', 'Configuration Discord enregistrée avec succès !'), 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message || t('save_error', 'Erreur enregistrement'), 'error');
    } finally {
      setSavingBot(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div 
        className="w-full max-w-2xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        style={{
          backgroundColor: 'var(--surface, #0f172a)',
          borderColor: 'var(--border, rgba(255,255,255,0.1))',
          color: 'var(--text, #f8fafc)'
        }}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                {t('messaging_gateway_title', 'Passerelle Telegram & Discord')}
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
                  {t('pin_pairing_badge', 'Appairage PIN Sécurisé')}
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('messaging_gateway_desc', 'Appairez vos appareils mobiles par code PIN et pilotez Antigravity à distance.')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border hover:bg-slate-500/10 transition-colors text-slate-400 hover:text-slate-200 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              title={t('refresh', 'Rafraîchir')}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg border hover:bg-slate-500/10 transition-colors text-slate-400 hover:text-slate-200 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-3 border-b flex items-center gap-2 shrink-0 bg-black/10" style={{ borderColor: 'var(--border)' }}>
          {[
            { id: 'pairing', label: t('tab_pin_pairing', 'Appairage PIN ({0})').replace('{0}', String(pending.length)), icon: Key },
            { id: 'telegram', label: t('tab_telegram', 'Bot Telegram'), icon: Send },
            { id: 'discord', label: t('tab_discord', 'Bot Discord'), icon: MessageSquare }
          ].map((tabItem) => {
            const Icon = tabItem.icon;
            const active = tab === tabItem.id;
            return (
              <button
                key={tabItem.id}
                onClick={() => setTab(tabItem.id as any)}
                className={`px-3 py-2 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all cursor-pointer ${
                  active 
                    ? 'border-indigo-500 text-indigo-400' 
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tabItem.label}</span>
              </button>
            );
          })}
        </div>

        {/* Body Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {tab === 'pairing' && (
            <div className="space-y-6">
              {/* Manual Code Input */}
              <div className="p-4 rounded-xl border space-y-3" style={{ backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.02))', borderColor: 'var(--border)' }}>
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <Lock className="w-4 h-4 text-indigo-400" />
                  <span>{t('enter_pairing_code', 'Saisir un code de couplage (8 caractères)')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Ex: 8XF2-K9MQ"
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                    className="flex-1 px-3.5 py-2 rounded-xl text-xs font-mono font-bold tracking-wider focus:outline-none uppercase"
                    style={{
                      backgroundColor: 'var(--input-bg, #0b0f19)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                  <button
                    onClick={() => handleApproveCode(manualCode)}
                    disabled={approving || !manualCode.trim()}
                    className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {approving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <Check className="w-3.5 h-3.5" />
                    <span>{t('validate', 'Valider')}</span>
                  </button>
                </div>
              </div>

              {/* Pending Requests */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                  <span>{t('pending_requests', 'Demandes en attente')} ({pending.length})</span>
                  <span className="text-[10px] text-slate-500">{t('expires_after_1h', 'Expire après 1 heure')}</span>
                </div>

                {pending.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed text-center text-xs text-slate-500" style={{ borderColor: 'var(--border)' }}>
                    {t('no_pending_pairing_codes', 'Aucun code de couplage en attente. Envoyez un premier message au bot Telegram ou Discord pour générer un code.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {pending.map((p) => (
                      <div 
                        key={p.code} 
                        className="p-3.5 rounded-xl border flex items-center justify-between gap-3"
                        style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-mono font-extrabold text-indigo-400 tracking-wider">
                              {p.code}
                            </span>
                            <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-slate-500/15 border border-slate-500/30 text-slate-300">
                              {p.platform}
                            </span>
                          </div>
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-2">
                            <Smartphone className="w-3.5 h-3.5" />
                            <span>{p.user_name || p.user_id}</span>
                            <span className="text-slate-600">•</span>
                            <Clock className="w-3 h-3 text-slate-500" />
                            <span className="text-[11px] text-slate-500">
                              {t('expires_in_minutes', 'expire dans {0} min').replace('{0}', String(getRemainingMinutes(p.expires_at)))}
                            </span>
                          </div>
                        </div>

                        <button
                          onClick={() => handleApproveCode(p.code)}
                          disabled={approving}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{t('approve', 'Approuver')}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Approved Devices */}
              <div className="space-y-2">
                <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t('approved_devices_title', 'Appareils et Utilisateurs Approuvés')} ({approved.length})
                </div>

                {approved.length === 0 ? (
                  <div className="p-4 rounded-xl border border-dashed text-center text-xs text-slate-500" style={{ borderColor: 'var(--border)' }}>
                    {t('no_approved_devices', 'Aucun appareil approuvé pour le moment.')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {approved.map((dev) => (
                      <div 
                        key={`${dev.platform}-${dev.user_id}`}
                        className="p-3 rounded-xl border flex items-center justify-between gap-3"
                        style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-200 truncate">
                              {dev.user_name || dev.user_id}
                            </div>
                            <div className="text-[10px] text-slate-500 font-mono">
                              {dev.platform} • ID: {dev.user_id}
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleRevoke(dev.platform, dev.user_id)}
                          className="p-1.5 rounded-lg border text-rose-400 hover:bg-rose-500/10 border-rose-500/30 transition-colors cursor-pointer"
                          title={t('revoke_device_title', 'Révoquer cet appareil')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {tab === 'telegram' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold block mb-1 text-slate-300">
                    {t('telegram_bot_token_label', 'Token du Bot Telegram (@BotFather) :')}
                  </label>
                  <input
                    type="password"
                    placeholder={status?.configs.telegram?.has_token ? `Actuel : ${status.configs.telegram.masked_token}` : "123456789:ABCdefGhIJKlmNoPQRstuVWXyz"}
                    value={tgToken}
                    onChange={(e) => setTgToken(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-xs font-mono focus:outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg, #0b0f19)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1 text-slate-300">
                    {t('default_chat_id_label', 'Chat ID par défaut (Optionnel) :')}
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: -100123456789 ou votre User ID"
                    value={tgChatId}
                    onChange={(e) => setTgChatId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-xs font-mono focus:outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg, #0b0f19)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={tgNotifyApproval}
                      onChange={(e) => setTgNotifyApproval(e.target.checked)}
                      className="rounded"
                    />
                    <span>{t('tg_notify_approval_label', "Recevoir les demandes d'approbation interactive de commandes sensibles")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={tgNotifyComplete}
                      onChange={(e) => setTgNotifyComplete(e.target.checked)}
                      className="rounded"
                    />
                    <span>{t('tg_notify_complete_label', 'Recevoir une notification à la fin des tâches longues')}</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={handleSaveTelegram}
                  disabled={savingBot}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                >
                  {savingBot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{t('save_telegram', 'Enregistrer Telegram')}</span>
                </button>
              </div>
            </div>
          )}

          {tab === 'discord' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold block mb-1 text-slate-300">
                    {t('discord_bot_token_label', 'Token du Bot Discord (Developer Portal) :')}
                  </label>
                  <input
                    type="password"
                    placeholder={status?.configs.discord?.has_token ? `Actuel : ${status.configs.discord.masked_token}` : "MTAy...YourDiscordToken"}
                    value={dcToken}
                    onChange={(e) => setDcToken(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-xs font-mono focus:outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg, #0b0f19)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1 text-slate-300">
                    {t('discord_channel_id_label', 'Channel ID par défaut :')}
                  </label>
                  <input
                    type="text"
                    placeholder="Ex: 112233445566778899"
                    value={dcChatId}
                    onChange={(e) => setDcChatId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl text-xs font-mono focus:outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg, #0b0f19)',
                      border: '1px solid var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                </div>

                <div className="space-y-2 pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={dcNotifyApproval}
                      onChange={(e) => setDcNotifyApproval(e.target.checked)}
                      className="rounded"
                    />
                    <span>{t('discord_notify_approval_label', "Recevoir les demandes d'approbation avec boutons interactifs")}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={dcNotifyComplete}
                      onChange={(e) => setDcNotifyComplete(e.target.checked)}
                      className="rounded"
                    />
                    <span>{t('discord_notify_complete_label', 'Notifier les fins de tâches autonomes')}</span>
                  </label>
                </div>
              </div>

              <div className="pt-3 border-t flex justify-end" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={handleSaveDiscord}
                  disabled={savingBot}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 cursor-pointer transition-colors shadow-xs"
                >
                  {savingBot && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{t('save_discord', 'Enregistrer Discord')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>{t('security_nist_hint', 'Sécurité NIST SP 800-63-4 avec limitation de taux')}</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium border hover:bg-slate-500/10 transition-colors cursor-pointer text-slate-300"
            style={{ borderColor: 'var(--border)' }}
          >
            {t('close', 'Fermer')}
          </button>
        </div>
      </div>
    </div>
  );
};
