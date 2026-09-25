import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  Boxes, 
  Search, 
  X, 
  Check, 
  Plus, 
  Trash2, 
  ExternalLink, 
  Activity, 
  ShieldCheck, 
  Loader2,
  RefreshCw,
  Key
} from 'lucide-react';
import { 
  fetchMcpCatalog, 
  installMcpServer, 
  uninstallMcpServer, 
  testMcpServer 
} from '../services/api';
import type { McpCatalogItem, McpTestResult } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface McpCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  'Tous',
  'Database',
  'DevOps & Monitoring',
  'Developer Tools',
  'Cloud & Hosting',
  'Productivité',
  'AI & Machine Learning',
  'Billing & Finance',
  'Integrations & Web'
];

export const McpCatalogModal: React.FC<McpCatalogModalProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useI18n();
  const [items, setItems] = useState<McpCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Tous');

  // Install modal state
  const [installTarget, setInstallTarget] = useState<McpCatalogItem | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [installing, setInstalling] = useState(false);

  // Ping test state
  const [testingSlug, setTestingSlug] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, McpTestResult>>({});

  const loadCatalog = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetchMcpCatalog();
      setItems(res.items);
    } catch (e: any) {
      showToast(e.message || 'Erreur chargement catalogue MCP', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        loadCatalog();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadCatalog]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (selectedCategory !== 'Tous') {
        if (selectedCategory === 'Productivité') {
          if (item.category !== 'Productivity' && item.category !== 'Productivité') return false;
        } else if (item.category.toLowerCase() !== selectedCategory.toLowerCase()) {
          return false;
        }
      }
      if (query.trim()) {
        const q = query.toLowerCase();
        const inName = item.name.toLowerCase().includes(q);
        const inSlug = item.slug.toLowerCase().includes(q);
        const inDesc = item.description.toLowerCase().includes(q);
        const inKeywords = (item.keywords || []).some((k) => k.toLowerCase().includes(q));
        return inName || inSlug || inDesc || inKeywords;
      }
      return true;
    });
  }, [items, selectedCategory, query]);

  const handleTestConnection = async (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setTestingSlug(slug);
      const res = await testMcpServer(slug);
      setTestResults((prev) => ({ ...prev, [slug]: res }));
      if (res.success) {
        showToast(`${slug} en ligne (${res.latency_ms} ms)`, 'success');
      } else {
        showToast(`Échec test ${slug} : ${res.error || 'Inaccessible'}`, 'error');
      }
    } catch (e: any) {
      showToast(e.message || 'Erreur test connexion', 'error');
    } finally {
      setTestingSlug(null);
    }
  };

  const handleOpenInstall = (item: McpCatalogItem) => {
    setInstallTarget(item);
    setApiKeyInput('');
  };

  const handleConfirmInstall = async () => {
    if (!installTarget) return;
    setInstalling(true);
    try {
      await installMcpServer(installTarget.slug, {
        api_key: apiKeyInput.trim() || undefined
      });
      showToast(`Serveur MCP '${installTarget.name}' installé avec succès !`, 'success');
      setItems((prev) =>
        prev.map((i) => (i.slug === installTarget.slug ? { ...i, is_installed: true } : i))
      );
      setInstallTarget(null);
    } catch (e: any) {
      showToast(e.message || 'Erreur installation MCP', 'error');
    } finally {
      setInstalling(false);
    }
  };

  const handleUninstall = async (slug: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await uninstallMcpServer(slug);
      showToast(`Serveur MCP '${slug}' désinstallé.`, 'success');
      setItems((prev) =>
        prev.map((i) => (i.slug === slug ? { ...i, is_installed: false } : i))
      );
    } catch (e: any) {
      showToast(e.message || 'Erreur désinstallation MCP', 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-5xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-400 flex items-center justify-center text-white shadow-md">
                <Boxes className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('mcp_catalog_title', 'Store de Serveurs MCP Clés en Main')}
                  </h2>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-500 border border-emerald-500/30 flex items-center gap-1 font-semibold">
                    <ShieldCheck className="w-3 h-3" /> {t('mcp_official_badge', 'Connecteurs Certifiés')}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('mcp_catalog_desc', "Plus de 70 connecteurs d'outils certifiés prêts à l'emploi en 1 clic")}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={loadCatalog}
                disabled={loading}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer"
                title={t('refresh', 'Actualiser le catalogue')}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Search bar & Category filters */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <input
                type="text"
                placeholder={t('mcp_search_placeholder', 'Rechercher parmi 70+ serveurs MCP (Supabase, Sentry, Stripe, Notion, Docker...)')}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-slate-900 dark:text-slate-100"
              />
              {query && (
                <button
                  onClick={() => setQuery('')}
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Category scrollable pills */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-[11px] font-medium px-3 py-1.5 rounded-xl whitespace-nowrap transition-colors cursor-pointer border ${
                    selectedCategory === cat
                      ? 'bg-indigo-600 text-white border-indigo-600 shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Catalog Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {loading && items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-indigo-500" />
              <p className="text-xs">Chargement du catalogue MCP officiel...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              Aucun serveur MCP ne correspond à votre recherche.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
              {filteredItems.map((item) => {
                const test = testResults[item.slug];
                const isTesting = testingSlug === item.slug;

                return (
                  <div
                    key={item.slug}
                    className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 hover:border-indigo-500/50 dark:hover:border-indigo-500/50 transition-all flex flex-col justify-between group shadow-xs hover:shadow-md"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                            {item.name}
                          </span>
                          <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700">
                            {item.transport.type}
                          </span>
                        </div>

                        {item.is_installed ? (
                          <span className="text-[10px] font-medium text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-full flex items-center gap-1 shrink-0">
                            <Check className="w-3 h-3" /> Actif
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 font-mono shrink-0">
                            {item.category}
                          </span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {item.description}
                      </p>

                      {/* Ping test feedback badge */}
                      {test && (
                        <div className={`p-1.5 rounded-lg text-[10px] font-mono flex items-center justify-between border ${
                          test.success 
                            ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' 
                            : 'bg-rose-500/10 text-rose-500 border-rose-500/30'
                        }`}>
                          <span>Latence : {test.latency_ms} ms</span>
                          <span>{test.success ? 'En ligne' : 'Inaccessible'}</span>
                        </div>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={(e) => handleTestConnection(item.slug, e)}
                          disabled={isTesting}
                          className="py-1 px-2 rounded-lg text-[10px] font-medium border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors flex items-center gap-1 cursor-pointer disabled:opacity-50"
                          title="Tester la connectivité en direct"
                        >
                          <Activity className={`w-3 h-3 text-cyan-500 ${isTesting ? 'animate-pulse' : ''}`} />
                          <span>{isTesting ? 'Test...' : 'Ping'}</span>
                        </button>

                        {item.source && (
                          <a
                            href={item.source}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1 rounded-lg text-slate-400 hover:text-indigo-500 transition-colors"
                            title="Documentation officielle"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        )}
                      </div>

                      {item.is_installed ? (
                        <button
                          type="button"
                          onClick={(e) => handleUninstall(item.slug, e)}
                          className="py-1 px-2.5 rounded-lg text-[11px] font-semibold text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>{t('mcp_uninstall_btn', 'Désinstaller')}</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleOpenInstall(item)}
                          className="py-1 px-3 rounded-lg text-[11px] font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3 h-3" />
                          <span>{t('mcp_install_btn', 'Installer')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Inline Configure / Install */}
        {installTarget && (
          <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div 
              className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b pb-3 border-slate-200 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-indigo-500" />
                  <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                    Configuration de {installTarget.name}
                  </span>
                </div>
                <button onClick={() => setInstallTarget(null)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                {installTarget.description}
              </p>

              {installTarget.auth?.type === 'api_key' || installTarget.auth?.env_var ? (
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <Key className="w-3 h-3 text-amber-500" />
                    <span>Clé d'API ({installTarget.auth?.env_var || 'API_KEY'})</span>
                  </label>
                  <input
                    type="password"
                    placeholder="Saisissez votre clé d'API secrète..."
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[10px] text-slate-400">
                    Stockée de façon chiffrée et injectée automatiquement dans les variables d'environnement de l'agent.
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400">
                  Ce serveur MCP utilise une configuration sans clé d'API (accès direct ou authentification OAuth via navigateur).
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setInstallTarget(null)}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                  {t('cancel', 'Annuler')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmInstall}
                  disabled={installing}
                  className="px-4 py-1.5 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-colors flex items-center gap-1.5 disabled:opacity-50"
                >
                  {installing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  <span>{installing ? t('mcp_installing', 'Installation...') : t('mcp_activate_now', 'Activer maintenant')}</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
