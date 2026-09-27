import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CheckCircle, Download, Package,
  RefreshCw, Shield, Trash2, X, Zap
} from 'lucide-react';
import type { Plugin, PluginScope } from '../types';
import { disablePlugin, fetchPlugins, registerPlugin } from '../services/api';

interface PluginCatalogModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SCOPE_LABELS: Record<PluginScope, string> = {
  register_command: 'Commandes',
  register_tool: 'Outils Agent',
  register_view: 'Vues UI',
  read_workspace: 'Lire WS',
  write_workspace: 'Écrire WS',
  run_terminal: 'Terminal',
  chat_access: 'Chat',
};

const SCOPE_COLORS: Record<PluginScope, string> = {
  register_command: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  register_tool: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  register_view: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  read_workspace: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  write_workspace: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  run_terminal: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  chat_access: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
};

// Catalogue communautaire intégré
const COMMUNITY_PLUGINS: Omit<Plugin, 'id' | 'is_active' | 'installed_at' | 'last_invoked_at'>[] = [
  {
    slug: 'prettier-format',
    name: 'Prettier Format',
    version: '2.0.0',
    description: 'Formate le code en utilisant Prettier. Ajoute /format et /prettify.',
    scopes: ['register_command', 'write_workspace'],
    author: 'community',
    homepage: 'https://prettier.io',
  },
  {
    slug: 'git-lens',
    name: 'Git Lens',
    version: '1.2.0',
    description: 'Visualisez l\'historique Git, les blame et les comparaisons inter-branches.',
    scopes: ['register_view', 'read_workspace'],
    author: 'community',
  },
  {
    slug: 'ai-docgen',
    name: 'AI DocGen',
    version: '1.0.0',
    description: 'Génère automatiquement la documentation JSDoc/PyDoc pour vos fonctions.',
    scopes: ['register_command', 'register_tool', 'read_workspace', 'write_workspace'],
    author: 'community',
  },
  {
    slug: 'security-scanner',
    name: 'Security Scanner',
    version: '1.1.0',
    description: 'Scan SAST léger pour détecter les vulnérabilités dans le code source.',
    scopes: ['register_command', 'read_workspace'],
    author: 'community',
  },
];

export default function PluginCatalogModal({ isOpen, onClose }: PluginCatalogModalProps) {
  const [installedPlugins, setInstalledPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);
  const [installLoading, setInstallLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'catalog' | 'installed'>('catalog');
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const loadInstalled = useCallback(async () => {
    setLoading(true);
    try {
      const plugins = await fetchPlugins(false);
      setInstalledPlugins(plugins);
    } catch {
      setError('Impossible de charger les plugins installés.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect
    if (isOpen) loadInstalled();
  }, [isOpen, loadInstalled]);

  const installedSlugs = new Set(installedPlugins.filter(p => p.is_active).map(p => p.slug));

  const handleInstall = async (p: (typeof COMMUNITY_PLUGINS)[0]) => {
    setInstallLoading(p.slug);
    setError(null);
    try {
      await registerPlugin({ ...p, scopes: p.scopes as string[] });
      await loadInstalled();
      setSuccessMsg(`✓ ${p.name} installé avec succès`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur lors de l\'installation');
    } finally {
      setInstallLoading(null);
    }
  };

  const handleDisable = async (slug: string, name: string) => {
    if (!confirm(`Désinstaller le plugin "${name}" ?`)) return;
    setError(null);
    try {
      await disablePlugin(slug);
      await loadInstalled();
      setSuccessMsg(`✓ ${name} désinstallé`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch {
      setError('Erreur lors de la désinstallation');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col w-full max-w-2xl mx-4 max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <Package className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Catalogue de Plugins</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Étendez Antigravity avec des plugins sandboxés Wasm</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-6 pt-3">
          {(['catalog', 'installed'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                activeTab === tab
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300'
                  : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              {tab === 'catalog' ? '🛍️ Catalogue' : `📦 Installés (${installedPlugins.filter(p => p.is_active).length})`}
            </button>
          ))}
          <button
            onClick={loadInstalled}
            disabled={loading}
            className="ml-auto p-1.5 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            title="Actualiser"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Alerts */}
        <div className="px-6 pt-2">
          {error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 rounded-lg text-sm">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-center gap-2 px-3 py-2 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 rounded-lg text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-3">
          {activeTab === 'catalog' ? (
            COMMUNITY_PLUGINS.map(plugin => {
              const isInstalled = installedSlugs.has(plugin.slug);
              return (
                <div key={plugin.slug} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-purple-300 dark:hover:border-purple-700 transition-colors">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-400 to-indigo-600 flex items-center justify-center text-white text-xl shrink-0">
                        {plugin.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h3 className="font-medium text-gray-900 dark:text-white text-sm">{plugin.name}</h3>
                          <span className="text-xs text-gray-500 dark:text-gray-400">v{plugin.version}</span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{plugin.description}</p>
                        <div className="flex flex-wrap gap-1 mt-2">
                          {plugin.scopes.map(scope => (
                            <span key={scope} className={`text-xs px-2 py-0.5 rounded-full font-medium ${SCOPE_COLORS[scope]}`}>
                              {SCOPE_LABELS[scope]}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      {isInstalled ? (
                        <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400 text-xs font-medium">
                          <CheckCircle className="w-4 h-4" />
                          Installé
                        </div>
                      ) : (
                        <button
                          onClick={() => handleInstall(plugin)}
                          disabled={installLoading === plugin.slug}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white text-xs rounded-lg transition-colors"
                        >
                          {installLoading === plugin.slug ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Download className="w-3.5 h-3.5" />
                          )}
                          Installer
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            installedPlugins.filter(p => p.is_active).length === 0 ? (
              <div className="text-center py-12 text-gray-400 dark:text-gray-500">
                <Package className="w-12 h-12 mx-auto mb-3 opacity-40" />
                <p className="text-sm">Aucun plugin installé</p>
                <p className="text-xs mt-1">Explorez le catalogue pour en installer</p>
              </div>
            ) : (
              installedPlugins.filter(p => p.is_active).map(plugin => (
                <div key={plugin.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-purple-400 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shrink-0">
                        {plugin.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-gray-900 dark:text-white text-sm">{plugin.name}</span>
                          <span className="text-xs text-gray-500 dark:text-gray-400">v{plugin.version}</span>
                        </div>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {plugin.scopes.map(scope => (
                            <span key={scope} className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${SCOPE_COLORS[scope as PluginScope] || 'bg-gray-100 text-gray-600'}`}>
                              {SCOPE_LABELS[scope as PluginScope] || scope}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDisable(plugin.slug, plugin.name)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title="Désinstaller"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <Shield className="w-3.5 h-3.5" />
          <span>Tous les plugins s'exécutent dans un sandbox isolé avec permissions explicites</span>
          <div className="ml-auto flex items-center gap-1">
            <Zap className="w-3.5 h-3.5 text-yellow-500" />
            <span>Wasm Sandbox v0.5.0</span>
          </div>
        </div>
      </div>
    </div>
  );
}
