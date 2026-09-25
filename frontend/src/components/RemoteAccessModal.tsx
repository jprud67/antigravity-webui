import React, { useState, useEffect, useCallback } from 'react';
import { 
  Globe, 
  X, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  ExternalLink, 
  Bell, 
  Send, 
  Copy, 
  Check, 
  Loader2, 
  Smartphone,
  ShieldCheck,
  Radio
} from 'lucide-react';
import { 
  fetchTailscaleStatus, 
  toggleTailscaleServe, 
  fetchVapidPublicKey, 
  subscribeWebPush, 
  sendTestWebPush,
  fetchPushSubscriptions 
} from '../services/api';
import type { TailscaleStatus, WebPushSubscriptionItem } from '../types';
import { showToast } from '../services/toast';

interface RemoteAccessModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RemoteAccessModal: React.FC<RemoteAccessModalProps> = ({ isOpen, onClose }) => {
  const [tailscale, setTailscale] = useState<TailscaleStatus | null>(null);
  const [loadingTailscale, setLoadingTailscale] = useState(false);
  const [togglingServe, setTogglingServe] = useState(false);
  const [pushSupported, setPushSupported] = useState(false);
  const [pushSubscribed, setPushSubscribed] = useState(false);
  const [subscribingPush, setSubscribingPush] = useState(false);
  const [subscriptions, setSubscriptions] = useState<WebPushSubscriptionItem[]>([]);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [testingPush, setTestingPush] = useState(false);

  const loadData = useCallback(async () => {
    setLoadingTailscale(true);
    try {
      const [tsStatus, subs] = await Promise.all([
        fetchTailscaleStatus(),
        fetchPushSubscriptions().catch(() => ({ subscriptions: [], count: 0 }))
      ]);
      setTailscale(tsStatus);
      setSubscriptions(subs.subscriptions);
    } catch {
      showToast('Impossible de charger les statuts distants', 'error');
    } finally {
      setLoadingTailscale(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      loadData();
      if ('serviceWorker' in navigator && 'PushManager' in window) {
        setPushSupported(true);
        navigator.serviceWorker.ready.then(async (reg) => {
          const sub = await reg.pushManager.getSubscription();
          setPushSubscribed(!!sub);
        }).catch(() => {});
      }
    }
  }, [isOpen, loadData]);

  const handleToggleServe = async () => {
    if (!tailscale) return;
    setTogglingServe(true);
    try {
      const willEnable = !tailscale.serve_active;
      const res = await toggleTailscaleServe(willEnable);
      if (res.success) {
        showToast(
          willEnable ? 'Tailscale Serve activé (HTTPS)' : 'Tailscale Serve désactivé',
          'success'
        );
        setTailscale(res.status);
      } else {
        showToast(res.message || 'Erreur Tailscale Serve', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la bascule', 'error');
    } finally {
      setTogglingServe(false);
    }
  };

  const handleSubscribePush = async () => {
    if (!pushSupported) return;
    setSubscribingPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        showToast('Permission de notification refusée par le navigateur', 'warning');
        return;
      }

      const { public_key } = await fetchVapidPublicKey();
      const reg = await navigator.serviceWorker.ready;

      // Convert URL-safe base64 to Uint8Array
      const rawData = window.atob(public_key.replace(/-/g, '+').replace(/_/g, '/'));
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }

      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: outputArray
      });

      const subJson = sub.toJSON();
      await subscribeWebPush({
        endpoint: sub.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh || '',
          auth: subJson.keys?.auth || ''
        }
      });

      setPushSubscribed(true);
      showToast('Notifications Web Push activées sur cet appareil !', 'success');
      loadData();
    } catch (err: any) {
      showToast(`Erreur d'activation push : ${err.message}`, 'error');
    } finally {
      setSubscribingPush(false);
    }
  };

  const handleSendTestPush = async () => {
    setTestingPush(true);
    try {
      const res = await sendTestWebPush(
        'Antigravity Mobile',
        'Connexion distante opérationnelle via PWA Web Push !'
      );
      showToast(res.message || 'Notification test envoyée', 'info');
    } catch {
      showToast('Échec de notification test', 'error');
    } finally {
      setTestingPush(false);
    }
  };

  const handleCopyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
    showToast('Lien copié dans le presse-papiers !', 'success');
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
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-sky-600 flex items-center justify-center text-white shadow-md">
              <Radio className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                Accès Distant & Web Push
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/30">
                  Sprint 25
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Accédez à Antigravity WebUI depuis votre smartphone en toute sécurité sans ouvrir de ports.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={loadData}
              disabled={loadingTailscale}
              className="p-1.5 rounded-lg border hover:bg-slate-500/10 transition-colors text-slate-400 hover:text-slate-200 cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
              title="Rafraîchir"
            >
              <RefreshCw className={`w-4 h-4 ${loadingTailscale ? 'animate-spin' : ''}`} />
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

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6">
          {/* Section 1: Tailscale MagicDNS */}
          <div className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.02))', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Globe className="w-4 h-4 text-teal-400" />
                <span className="font-semibold text-xs tracking-wide uppercase text-slate-400">
                  Réseau Privé Tailscale (MagicDNS)
                </span>
              </div>
              <span className={`text-[11px] font-mono px-2.5 py-0.5 rounded-full border flex items-center gap-1.5 ${
                tailscale?.running
                  ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${tailscale?.running ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
                {tailscale?.running ? 'Connecté au Tailnet' : (tailscale?.installed ? 'Déconnecté' : 'Non installé')}
              </span>
            </div>

            {tailscale?.running ? (
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl border bg-black/20" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-[10px] text-slate-400 uppercase font-mono">Nom d'hôte MagicDNS</div>
                    <div className="text-xs font-mono font-semibold text-teal-400 truncate mt-0.5">
                      {tailscale.magicdns || 'N/A'}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl border bg-black/20" style={{ borderColor: 'var(--border)' }}>
                    <div className="text-[10px] text-slate-400 uppercase font-mono">Adresse IP Tailscale</div>
                    <div className="text-xs font-mono font-semibold text-slate-200 truncate mt-0.5">
                      {tailscale.tailscale_ip || 'N/A'}
                    </div>
                  </div>
                </div>

                {tailscale.serve_url && (
                  <div className="p-3 rounded-xl border border-teal-500/30 bg-teal-500/10 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] text-teal-300 uppercase font-bold tracking-wider">URL HTTPS Sécurisée</div>
                      <a 
                        href={tailscale.serve_url} 
                        target="_blank" 
                        rel="noopener noreferrer" 
                        className="text-xs font-mono text-teal-200 hover:underline truncate block flex items-center gap-1"
                      >
                        {tailscale.serve_url}
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </a>
                    </div>
                    <button
                      onClick={() => handleCopyUrl(tailscale.serve_url!)}
                      className="px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-500 text-white font-medium text-xs flex items-center gap-1.5 shrink-0 cursor-pointer transition-colors shadow-xs"
                    >
                      {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedUrl ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                )}

                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-slate-400">
                    {tailscale.serve_active 
                      ? 'Serveur HTTPS actif sur le port 8000 via Tailscale Serve' 
                      : 'Activer le partage HTTPS chiffré vers les machines de votre Tailnet'}
                  </span>
                  <button
                    onClick={handleToggleServe}
                    disabled={togglingServe}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-all ${
                      tailscale.serve_active
                        ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30 hover:bg-rose-500/25'
                        : 'bg-teal-600 hover:bg-teal-500 text-white shadow-xs'
                    }`}
                  >
                    {togglingServe && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>{tailscale.serve_active ? 'Désactiver Serve' : 'Activer Serve'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
                <div className="leading-relaxed">
                  Tailscale n'est pas actif sur cet ordinateur. Installez Tailscale ou lancez l'application pour profiter du domaine MagicDNS sans configuration réseau.
                </div>
              </div>
            )}
          </div>

          {/* Section 2: PWA Web Push Notifications */}
          <div className="rounded-2xl border p-4 sm:p-5 space-y-4" style={{ backgroundColor: 'var(--surface-subtle, rgba(255,255,255,0.02))', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 text-sky-400" />
                <span className="font-semibold text-xs tracking-wide uppercase text-slate-400">
                  Notifications Web Push Mobiles (PWA)
                </span>
              </div>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-sky-500/15 text-sky-400 border border-sky-500/30">
                {subscriptions.length} appareil{subscriptions.length > 1 ? 's' : ''} enregistré{subscriptions.length > 1 ? 's' : ''}
              </span>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Recevez des notifications système instantanées sur votre téléphone ou tablette dès qu'une tâche longue, une suite de tests ou une demande d'approbation d'outil nécessite votre attention.
            </p>

            <div className="flex items-center justify-between flex-wrap gap-3 pt-2">
              <div className="flex items-center gap-2">
                <Smartphone className="w-4 h-4 text-slate-400" />
                <span className="text-xs font-medium text-slate-200">
                  {pushSubscribed ? 'Notifications activées sur ce navigateur' : 'Non activé sur ce navigateur'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {pushSubscribed && (
                  <button
                    onClick={handleSendTestPush}
                    disabled={testingPush}
                    className="px-3 py-1.5 rounded-xl border text-xs font-medium text-slate-300 hover:bg-slate-500/10 transition-colors flex items-center gap-1.5 cursor-pointer"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {testingPush ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>Tester le Push</span>
                  </button>
                )}
                <button
                  onClick={handleSubscribePush}
                  disabled={subscribingPush || !pushSupported || pushSubscribed}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                    pushSubscribed
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 cursor-default'
                      : 'bg-sky-600 hover:bg-sky-500 text-white shadow-xs cursor-pointer'
                  }`}
                >
                  {subscribingPush && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {pushSubscribed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Bell className="w-3.5 h-3.5" />}
                  <span>{pushSubscribed ? 'Abonné' : 'Activer sur cet appareil'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Chiffrement de bout en bout P-256 et tunnel WireGuard</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl text-xs font-medium border hover:bg-slate-500/10 transition-colors cursor-pointer text-slate-300"
            style={{ borderColor: 'var(--border)' }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};
