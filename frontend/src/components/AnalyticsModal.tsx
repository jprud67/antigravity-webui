import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  X, 
  RefreshCw, 
  BarChart3, 
  Zap, 
  Clock, 
  Brain, 
  Coins,
  CheckCircle, 
  AlertTriangle, 
  AlertCircle,
  Database,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  Sparkles
} from 'lucide-react';
import { fetchUsageQuota, fetchGoogleAccounts } from '../services/api';
import { useI18n } from '../services/i18n';
import type { Conversation } from '../types';
import type { TokenUsageData } from './ContextRing';

interface AnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  tokenUsage?: TokenUsageData | null;
  conversations?: Conversation[];
  activeModel?: string;
}

interface QuotaBucket {
  id?: string;
  remaining_fraction?: number;
  reset_time?: string;
  name?: string;
  description?: string;
  window?: string;
}

interface QuotaGroup {
  name: string;
  description?: string;
  buckets?: QuotaBucket[];
}

export const AnalyticsModal: React.FC<AnalyticsModalProps> = ({
  isOpen,
  onClose,
  tokenUsage,
  conversations = [],
  activeModel,
}) => {
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quotaGroups, setQuotaGroups] = useState<QuotaGroup[]>([]);
  const [activeAccount, setActiveAccount] = useState<any>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageData, accountData] = await Promise.allSettled([
        fetchUsageQuota(),
        fetchGoogleAccounts(),
      ]);

      if (usageData.status === 'fulfilled') {
        const u = usageData.value;
        const cmdData = u?.command?.data || u?.data || u;
        const groups = cmdData?.groups || (Array.isArray(u) ? u : []);
        setQuotaGroups(groups);
      } else {
        setQuotaGroups([]);
      }

      if (accountData.status === 'fulfilled') {
        setActiveAccount(accountData.value?.active_account);
      }

      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err?.message || 'Erreur lors du chargement des données');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      queueMicrotask(() => {
        loadData();
      });
    }
  }, [isOpen, loadData]);

  // Format numbers safely
  const formatNum = (n?: number | null) => (typeof n === 'number' ? n.toLocaleString() : '0');

  // Stats from conversations
  const stats = useMemo(() => {
    const total = conversations.length;
    const pinned = conversations.filter((c) => c.pinned).length;
    const archived = conversations.filter((c) => c.archived).length;
    const projects = new Set(conversations.map((c) => c.project).filter(Boolean)).size;
    const allTags = new Set<string>();
    conversations.forEach((c) => (c.tags || []).forEach((tag) => allTags.add(tag)));

    return { total, pinned, archived, projects, tagsCount: allTags.size };
  }, [conversations]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4 select-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="analytics-modal-title"
    >
      <div
        className="glass-panel w-[880px] max-w-full max-h-[90vh] rounded-3xl shadow-2xl border flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface, #141425)',
          borderColor: 'var(--border, #2A2A45)',
          color: 'var(--text, #E0E0E0)',
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center p-2 border shadow-sm"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--accent)',
              }}
            >
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 id="analytics-modal-title" className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                {t('analytics_dashboard', 'Dashboard Quotas & Analytique')}
                <span className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border"
                  style={{
                    backgroundColor: 'var(--accent-bg)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent)',
                  }}
                >
                  Live
                </span>
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('analytics_subtitle', 'Suivi des quotas IA, tokens consommés et statistiques de session')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              className="btn btn-secondary btn-sm flex items-center gap-1.5 cursor-pointer"
              title={t('refresh', 'Rafraîchir')}
              aria-label={t('refresh', 'Rafraîchir')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span className="text-xs">{t('refresh', 'Rafraîchir')}</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="btn-icon cursor-pointer"
              aria-label={t('close', 'Fermer')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Top Quick Status Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Active Account */}
            <div
              className="p-3.5 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span>{t('active_account', 'Compte Google')}</span>
                <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
              </div>
              <div className="mt-2 truncate font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                {activeAccount?.email || activeAccount?.account || 'Connecté'}
              </div>
              <span className="text-[10px] text-emerald-400 mt-0.5">● {t('status_operational', 'Opérationnel')}</span>
            </div>

            {/* Active Model */}
            <div
              className="p-3.5 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span>{t('active_model', 'Modèle Actif')}</span>
                <Sparkles className="w-3.5 h-3.5 text-sky-400" />
              </div>
              <div className="mt-2 truncate font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                {activeModel || 'Auto (Antigravity)'}
              </div>
              <span className="text-[10px] text-sky-400 mt-0.5">{t('standard_cli', 'Standard CLI')}</span>
            </div>

            {/* Total Sessions */}
            <div
              className="p-3.5 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span>{t('total_sessions', 'Discussions')}</span>
                <Layers className="w-3.5 h-3.5 text-purple-400" />
              </div>
              <div className="mt-2 font-bold text-lg" style={{ color: 'var(--strong)' }}>
                {stats.total}
              </div>
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {stats.pinned} {t('pinned_abbr', 'épinglées')} &bull; {stats.archived} {t('archived_abbr', 'archivées')}
              </div>
            </div>

            {/* Projects & Tags */}
            <div
              className="p-3.5 rounded-2xl border flex flex-col justify-between"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                <span>{t('projects_and_tags', 'Projets & Tags')}</span>
                <Database className="w-3.5 h-3.5 text-amber-400" />
              </div>
              <div className="mt-2 font-bold text-lg" style={{ color: 'var(--strong)' }}>
                {stats.projects} <span className="text-xs font-normal text-slate-400">{t('projects', 'projets')}</span>
              </div>
              <div className="text-[10px]" style={{ color: 'var(--muted)' }}>
                {stats.tagsCount} {t('distinct_tags', 'tags distincts')}
              </div>
            </div>
          </div>

          {/* Section 1: Active Session Token Breakdown */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                <Zap className="w-4 h-4 text-amber-400" />
                {t('active_session_tokens', 'Consommation de la Discussion Active')}
              </h3>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {tokenUsage ? t('live_measurement', 'Mesure en direct') : t('waiting_for_messages', 'En attente de messages')}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {/* Input Tokens */}
              <div
                className="p-4 rounded-2xl border flex flex-col justify-between"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <ArrowDownLeft className="w-3.5 h-3.5 text-sky-400" />
                    {t('input_tokens', 'Entrée (Prompt)')}
                  </span>
                </div>
                <div className="mt-2 text-xl font-extrabold text-sky-400 font-mono">
                  {formatNum(tokenUsage?.inputTokens)}
                </div>
                <span className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>
                  {t('context_and_history_injected', 'Contexte & historique injecté')}
                </span>
              </div>

              {/* Output Tokens */}
              <div
                className="p-4 rounded-2xl border flex flex-col justify-between"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    {t('output_tokens', 'Sortie (Réponse)')}
                  </span>
                </div>
                <div className="mt-2 text-xl font-extrabold text-emerald-400 font-mono">
                  {formatNum(tokenUsage?.outputTokens)}
                </div>
                <span className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>
                  {t('model_generation', 'Génération par le modèle')}
                </span>
              </div>

              {/* Thinking Tokens */}
              <div
                className="p-4 rounded-2xl border flex flex-col justify-between"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <Brain className="w-3.5 h-3.5 text-purple-400" />
                    {t('thinking_tokens', 'Réflexion (CoT)')}
                  </span>
                </div>
                <div className="mt-2 text-xl font-extrabold text-purple-400 font-mono">
                  {formatNum(tokenUsage?.thinkingTokens)}
                </div>
                <span className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>
                  {t('internal_reasoning', 'Raisonnement interne')}
                </span>
              </div>

              {/* Total Tokens */}
              <div
                className="p-4 rounded-2xl border flex flex-col justify-between"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="flex items-center gap-1.5">
                    <Coins className="w-3.5 h-3.5 text-amber-400" />
                    {t('total_tokens', 'Total Tokens')}
                  </span>
                </div>
                <div className="mt-2 text-xl font-extrabold text-amber-400 font-mono">
                  {formatNum(tokenUsage?.totalTokens)}
                </div>
                <span className="text-[10px] mt-1" style={{ color: 'var(--muted)' }}>
                  {t('total_accumulated_volume', 'Volume total cumulé')}
                </span>
              </div>
            </div>
          </div>

          {/* Section 2: Quotas Antigravity & Modèles */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                <Clock className="w-4 h-4 text-sky-400" />
                {t('model_quotas_title', 'Quotas des Modèles (Google Cloud & Antigravity)')}
              </h3>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {t('last_sync_prefix', 'Dernière synchro :')} {lastRefreshed.toLocaleTimeString()}
              </span>
            </div>

            {error && (
              <div className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-xs text-red-400 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {quotaGroups.length === 0 && !loading && (
              <div
                className="p-5 rounded-2xl border text-center text-xs space-y-2"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <AlertTriangle className="w-6 h-6 text-amber-400 mx-auto" />
                <p className="font-semibold text-sm" style={{ color: 'var(--strong)' }}>
                  {t('quota_not_available', 'Quotas temporairement inaccessibles via le CLI')}
                </p>
                <p className="text-[11px] max-w-md mx-auto">
                  {t('antigravity_quota_fallback_desc', "Antigravity gère automatiquement les bascules de quotas en arrière-plan. Dès qu'un compte atteint son quota, un compte relais prend le relais.")}
                </p>
                <button
                  type="button"
                  onClick={loadData}
                  className="btn btn-secondary btn-sm mt-2 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  {t('retry', 'Réessayer')}
                </button>
              </div>
            )}

            {quotaGroups.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {quotaGroups.map((group, gIdx) => {
                  const buckets = group.buckets || [];
                  return (
                    <div
                      key={gIdx}
                      className="p-4 rounded-2xl border space-y-3"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
                        <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>
                          {group.name}
                        </span>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded border" style={{ borderColor: 'var(--border)' }}>
                          {buckets.length} {t('tiers_count', 'palier(s)')}
                        </span>
                      </div>

                      <div className="space-y-3">
                        {buckets.map((b, bIdx) => {
                          const frac = typeof b.remaining_fraction === 'number' ? b.remaining_fraction : 1;
                          const pctRaw = frac * 100;
                          const pctText = frac < 1 && pctRaw > 99 ? pctRaw.toFixed(1) : Math.round(pctRaw).toString();
                          const pctNum = Math.round(pctRaw);
                          const isHigh = pctNum > 50;
                          const isMedium = pctNum > 20 && pctNum <= 50;
                          const colorClass = isHigh
                            ? 'bg-emerald-500 text-emerald-400'
                            : isMedium
                            ? 'bg-amber-500 text-amber-400'
                            : 'bg-rose-500 text-rose-400';

                          const formatResetTime = (iso?: string) => {
                            if (!iso) return '';
                            const d = new Date(iso);
                            const now = new Date();
                            const isToday = d.toDateString() === now.toDateString();
                            return isToday 
                              ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                              : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
                          };

                          return (
                            <div key={bIdx} className="space-y-1.5 p-2 rounded-xl bg-black/10 dark:bg-white/5 border border-white/5">
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-medium" style={{ color: 'var(--text)' }}>
                                  {b.name || t('quota_window', 'Fenêtre de quota')}
                                </span>
                                <span className={`font-mono font-bold ${colorClass.split(' ')[1]}`}>
                                  {pctText}% {t('remaining', 'restant')}
                                </span>
                              </div>

                              {/* Progress meter bar */}
                              <div className="h-2 w-full rounded-full bg-black/20 overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all duration-500 ${colorClass.split(' ')[0]}`}
                                  style={{ width: `${Math.max(5, Math.min(100, pctNum))}%` }}
                                />
                              </div>

                              {b.description && (
                                <p className="text-[10.5px] italic leading-tight" style={{ color: 'var(--muted)' }}>
                                  {b.description}
                                </p>
                              )}

                              {b.reset_time && (
                                <div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--muted)' }}>
                                  <span>{t('reset_prefix', 'Réinitialisation :')}</span>
                                  <span className="font-mono font-medium text-slate-300">
                                    {formatResetTime(b.reset_time)}
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3.5 border-t flex items-center justify-between text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <span>{t('analytics_multi_account', 'Bascule multi-comptes :')}</span>
            <span className="text-emerald-400 font-semibold">{t('active', 'Actif')} (~1s)</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="btn btn-primary btn-sm cursor-pointer"
          >
            {t('close', 'Fermer')}
          </button>
        </div>
      </div>
    </div>
  );
};
