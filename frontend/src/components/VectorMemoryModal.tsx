import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Brain, 
  Search, 
  Plus, 
  Trash2, 
  Check, 
  Sliders, 
  Settings2, 
  Zap,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { vectorMemoryApi } from '../services/api';
import type { 
  MemoryEntry, 
  MemorySearchResult, 
  MemoryCategory, 
  AutoRecallConfig,
  RecallHookResult 
} from '../types';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

interface VectorMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: MemoryCategory[] = ['general', 'preference', 'fact', 'core', 'daily', 'convention'];

export const VectorMemoryModal: React.FC<VectorMemoryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'memories' | 'settings'>('memories');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<MemoryCategory | 'all'>('all');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemorySearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // New memory state
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<MemoryCategory>('fact');
  const [newImportance, setNewImportance] = useState(0.8);
  const [addingMemory, setAddingMemory] = useState(false);

  // Config state
  const [config, setConfig] = useState<AutoRecallConfig>({
    enabled: true,
    provider: 'local',
    model: 'text-embedding-3-small',
    maxResults: 3,
    minSimilarity: 0.6,
    maxChars: 2000,
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaved, setConfigSaved] = useState(false);

  // Simulator state
  const [simPrompt, setSimPrompt] = useState('Où se trouve le projet antigravity-webui ?');
  const [simResult, setSimResult] = useState<RecallHookResult | null>(null);
  const [testingSim, setTestingSim] = useState(false);

  // Load memories and configuration
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [mems, cfg] = await Promise.all([
        vectorMemoryApi.listMemories('default', selectedCategory === 'all' ? undefined : selectedCategory),
        vectorMemoryApi.getConfig(),
      ]);
      setMemories(mems);
      setConfig(cfg);
    } catch (err: any) {
      showToast(err.message || 'Error loading vector memory data', 'error');
    } finally {
      setLoading(false);
    }
  }, [selectedCategory]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        loadData();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadData]);

  // Real-time semantic search
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      const timer = setTimeout(() => {
        setSearchResults([]);
      }, 0);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const results = await vectorMemoryApi.searchMemories(query, 10, 0.4, 'default');
        setSearchResults(results);
      } catch (err: any) {
        showToast(err.message || 'Search failed', 'error');
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleAddMemory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) return;

    try {
      setAddingMemory(true);
      await vectorMemoryApi.storeMemory({
        text: newText.trim(),
        category: newCategory,
        importance: newImportance,
        agentId: 'default',
      });
      setNewText('');
      showToast(t('vector_memory_added', 'Souvenir enregistré avec succès !'), 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Failed to add memory', 'error');
    } finally {
      setAddingMemory(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    const confirmed = await showConfirm(t('vector_delete_confirm', 'Supprimer définitivement ce souvenir ?'), { destructive: true });
    if (!confirmed) return;
    try {
      await vectorMemoryApi.deleteMemory(id);
      showToast(t('memory_deleted', 'Souvenir supprimé'), 'info');
      await loadData();
      if (searchQuery.trim()) {
        setSearchResults((prev) => prev.filter((r) => r.entry.id !== id));
      }
    } catch (err: any) {
      showToast(err.message || 'Failed to delete memory', 'error');
    }
  };

  const handleClearMemories = async () => {
    const confirmed = await showConfirm(t('vector_clear_confirm', 'ATTENTION : Effacer TOUS les souvenirs de la mémoire vectorielle ?'), { destructive: true });
    if (!confirmed) return;
    try {
      const res = await vectorMemoryApi.clearMemories('default');
      showToast(`Mémoire réinitialisée (${res.deletedCount} éléments)`, 'info');
      await loadData();
      setSearchResults([]);
    } catch (err: any) {
      showToast(err.message || 'Failed to clear memories', 'error');
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const updated = await vectorMemoryApi.updateConfig(config);
      setConfig(updated);
      setConfigSaved(true);
      showToast(t('vector_config_saved', 'Configuration Enregistrée !'), 'success');
      setTimeout(() => setConfigSaved(false), 2500);
    } catch (err: any) {
      showToast(err.message || 'Failed to save config', 'error');
    } finally {
      setSavingConfig(false);
    }
  };

  const handleTestSimulator = async () => {
    if (!simPrompt.trim()) return;
    try {
      setTestingSim(true);
      const res = await vectorMemoryApi.executeRecall(simPrompt.trim(), 'default');
      setSimResult(res);
    } catch (err: any) {
      showToast(err.message || 'Simulation failed', 'error');
    } finally {
      setTestingSim(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 safe-pt safe-pb animate-fadeIn">
      <div 
        className="border rounded-2xl sm:rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[94dvh] sm:h-[88vh]"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="p-3.5 sm:p-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <Brain className="w-4 h-4 sm:w-5 sm:h-5 text-purple-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 truncate" style={{ color: 'var(--strong)' }}>
                <span>{t('vector_memory_title', 'Mémoire Vectorielle & Auto-Recall Hook')}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border"
                  style={{
                    backgroundColor: 'var(--accent-bg)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent-text)'
                  }}
                >
                  {t('vector_engine_badge', 'Moteur Vectoriel')}
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] truncate hidden sm:block" style={{ color: 'var(--muted)' }}>
                {t('vector_memory_desc', 'Recherche sémantique embarquée et injection automatique des souvenirs pertinents par prompt')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Tab Pill Navigation */}
            <div className="flex items-center gap-1 bg-black/20 dark:bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setActiveTab('memories')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'memories'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('vector_tab_memories', 'Souvenirs ({0})').replace('{0}', String(memories.length))}
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'settings'
                    ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>{t('vector_tab_settings', 'Hook & Embeddings')}</span>
              </button>
            </div>

            <button
              onClick={loadData}
              disabled={loading}
              className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-xs"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
              title={t('refresh', 'Rafraîchir')}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'memories' ? (
            <div className="flex-1 flex flex-col p-4 sm:p-6 overflow-hidden space-y-4">
              {/* Top Controls: Search Bar, Category Filters & Actions */}
              <div className="space-y-3 shrink-0">
                <div className="flex items-center gap-3 justify-between flex-wrap">
                  {/* Search Input */}
                  <div
                    className="flex-1 min-w-[240px] flex items-center gap-2 px-3 py-2 rounded-xl border text-xs"
                    style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                  >
                    <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                    <input
                      type="text"
                      placeholder={t('vector_search_placeholder', 'Test de recherche sémantique en temps réel...')}
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-transparent focus:outline-hidden text-xs"
                      style={{ color: 'var(--text)' }}
                    />
                    {searching && (
                      <span className="text-[10px] text-purple-400 animate-pulse font-mono shrink-0">
                        {t('vector_searching', 'Vectorisation...')}
                      </span>
                    )}
                    {searchQuery && (
                      <button onClick={() => setSearchQuery('')} className="text-slate-400 hover:text-slate-200">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Clear Button */}
                  <button
                    onClick={handleClearMemories}
                    disabled={memories.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-rose-500/30 text-rose-400 text-xs hover:bg-rose-500/10 transition-colors disabled:opacity-40 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t('vector_clear_all', 'Effacer tous les souvenirs')}</span>
                  </button>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                  <button
                    onClick={() => setSelectedCategory('all')}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer ${
                      selectedCategory === 'all'
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold'
                        : 'border border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-slate-400'
                    }`}
                  >
                    {t('vector_all_categories', 'Tous')}
                  </button>
                  {CATEGORIES.map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setSelectedCategory(cat)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize transition-all cursor-pointer ${
                        selectedCategory === cat
                          ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40 font-semibold'
                          : 'border border-transparent hover:bg-black/5 dark:hover:bg-white/5 text-slate-400'
                      }`}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Add Memory Form */}
              <form
                onSubmit={handleAddMemory}
                className="p-3.5 rounded-2xl border flex flex-wrap items-center gap-3 shrink-0"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <input
                  type="text"
                  placeholder={t('vector_new_memory_placeholder', 'Nouveau fait, préférence, ou instruction à mémoriser...')}
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  className="flex-1 min-w-[240px] px-3 py-1.5 rounded-xl text-xs border focus:outline-hidden"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                />

                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="px-2.5 py-1.5 rounded-xl text-xs border focus:outline-hidden cursor-pointer"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="text-[11px]">{t('vector_importance_label', 'Importance:')}</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={newImportance}
                    onChange={(e) => setNewImportance(parseFloat(e.target.value))}
                    className="w-16 accent-purple-500 cursor-pointer"
                  />
                  <span className="font-mono text-[10px] w-8">{(newImportance * 100).toFixed(0)}%</span>
                </div>

                <button
                  type="submit"
                  disabled={addingMemory || !newText.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-sm shrink-0"
                  style={{
                    backgroundColor: 'var(--accent-bg)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent-text)'
                  }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{addingMemory ? 'Mémorisation...' : t('vector_add_btn', 'Mémoriser')}</span>
                </button>
              </form>

              {/* List of Memories or Search Results */}
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1">
                {searchQuery.trim() ? (
                  searchResults.length === 0 ? (
                    <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>
                      {t('vector_no_search_results', 'Aucune correspondance sémantique pour')} &quot;{searchQuery}&quot;
                    </div>
                  ) : (
                    searchResults.map((res) => (
                      <div
                        key={res.entry.id}
                        className="p-3.5 rounded-2xl border transition-all flex items-start justify-between gap-3 hover:border-purple-500/50"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)'
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/15 text-purple-300 border border-purple-500/30 font-mono font-bold">
                              {(res.similarity * 100).toFixed(0)}% match
                            </span>
                            <span
                              className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold border"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                                color: 'var(--muted)'
                              }}
                            >
                              {res.entry.category}
                            </span>
                            <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                              Score: {res.score.toFixed(3)}
                            </span>
                          </div>
                          <p className="text-xs leading-relaxed select-text" style={{ color: 'var(--text)' }}>
                            {res.entry.text}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDeleteMemory(res.entry.id)}
                          className="p-1.5 rounded-lg border border-transparent hover:border-rose-500/30 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer shrink-0"
                          title={t('delete', 'Supprimer')}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )
                ) : memories.length === 0 ? (
                  <div
                    className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed rounded-3xl"
                    style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
                  >
                    <Brain className="w-10 h-10 mb-3 opacity-40 text-purple-400" />
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--strong)' }}>{t('vector_no_memories', 'Aucun souvenir enregistré')}</h3>
                    <p className="text-xs max-w-sm mt-1" style={{ color: 'var(--muted)' }}>
                      Ajoutez votre première règle, habitude ou fait technique dans le formulaire ci-dessus.
                    </p>
                  </div>
                ) : (
                  memories.map((mem) => (
                    <div
                      key={mem.id}
                      className="p-3.5 rounded-2xl border transition-all flex items-start justify-between gap-3 hover:border-purple-500/40"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)'
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-mono uppercase font-semibold border"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                              color: 'var(--accent-text)'
                            }}
                          >
                            {mem.category}
                          </span>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                            {t('vector_importance_label', 'Importance:')} {(mem.importance * 100).toFixed(0)}%
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            {new Date(mem.createdAt * 1000).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs leading-relaxed select-text" style={{ color: 'var(--text)' }}>
                          {mem.text}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="p-1.5 rounded-lg border border-transparent hover:border-rose-500/30 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-all cursor-pointer shrink-0"
                        title={t('delete', 'Supprimer')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* Settings & Simulator Tab */
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              {/* Config Form */}
              <div className="p-4 sm:p-6 overflow-y-auto space-y-4" style={{ backgroundColor: 'var(--surface)' }}>
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                    <Sliders className="w-4 h-4 text-purple-400" />
                    <span>{t('vector_config_title', 'Configuration du Hook Auto-Recall')}</span>
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    {t('vector_config_desc', "Contrôle le filtrage, les seuils de similarité et le modèle d'embeddings")}
                  </p>
                </div>

                <div className="space-y-4 text-xs">
                  {/* Enable Switch */}
                  <label
                    className="flex items-center justify-between p-3.5 rounded-2xl border cursor-pointer"
                    style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                  >
                    <div>
                      <div className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                        {t('vector_enable_auto_recall', "Activer l'Auto-Recall automatique")}
                      </div>
                      <div className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                        {t('vector_enable_auto_recall_desc', 'Injecte les souvenirs pertinents avant chaque prompt LLM')}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={config.enabled}
                      onChange={(e) => setConfig({ ...config, enabled: e.target.checked })}
                      className="w-4 h-4 accent-purple-500 cursor-pointer"
                    />
                  </label>

                  {/* Provider Selection */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                      {t('vector_embedding_provider', "Moteur d'Embeddings")}
                    </label>
                    <select
                      value={config.provider}
                      onChange={(e) => setConfig({ ...config, provider: e.target.value as any })}
                      className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-hidden cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <option value="local">{t('vector_provider_local', 'Local Déterministe (Zéro dépendance, 384d)')}</option>
                      <option value="openai">{t('vector_provider_openai', 'OpenAI (text-embedding-3-small)')}</option>
                      <option value="ollama">{t('vector_provider_ollama', 'Ollama Local (nomic-embed-text)')}</option>
                      <option value="gemini">{t('vector_provider_gemini', 'Google Gemini Embeddings')}</option>
                    </select>
                  </div>

                  {/* Model Name */}
                  <div className="space-y-1.5">
                    <label className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                      {t('vector_embedding_model', "Modèle d'embedding")}
                    </label>
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      placeholder="text-embedding-3-small"
                      className="w-full px-3 py-2 rounded-xl border text-xs focus:outline-hidden"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                  </div>

                  {/* Sliders: Top-K, Min Similarity, Max Chars */}
                  <div className="space-y-3 pt-2">
                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                        <span>{t('vector_max_results', 'Max souvenirs réinjectés (Top-K)')}</span>
                        <span className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{config.maxResults}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={config.maxResults}
                        onChange={(e) => setConfig({ ...config, maxResults: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                        <span>{t('vector_min_similarity', 'Seuil de similarité minimale')}</span>
                        <span className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{(config.minSimilarity * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={config.minSimilarity}
                        onChange={(e) => setConfig({ ...config, minSimilarity: parseFloat(e.target.value) })}
                        className="w-full accent-purple-500 cursor-pointer"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--muted)' }}>
                        <span>{t('vector_max_chars', 'Longueur max du bloc injecté')}</span>
                        <span className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{config.maxChars} chars</span>
                      </div>
                      <input
                        type="range"
                        min="500"
                        max="5000"
                        step="250"
                        value={config.maxChars}
                        onChange={(e) => setConfig({ ...config, maxChars: parseInt(e.target.value) })}
                        className="w-full accent-purple-500 cursor-pointer"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveConfig}
                    disabled={savingConfig}
                    className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-semibold text-xs transition-all cursor-pointer shadow-sm"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    {configSaved ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>{t('vector_config_saved', 'Configuration Enregistrée !')}</span>
                      </>
                    ) : (
                      <span>{savingConfig ? 'Enregistrement...' : 'Sauvegarder les paramètres'}</span>
                    )}
                  </button>
                </div>
              </div>

              {/* Simulator */}
              <div
                className="p-4 sm:p-6 overflow-y-auto space-y-4 flex flex-col"
                style={{ backgroundColor: 'var(--surface-subtle)' }}
              >
                <div>
                  <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                    <Zap className="w-4 h-4 text-amber-400" />
                    <span>{t('vector_sim_title', 'Simulateur Auto-Recall en Direct')}</span>
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                    {t('vector_sim_desc', 'Testez comment le hook analyse un prompt et injecte les souvenirs')}
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={simPrompt}
                    onChange={(e) => setSimPrompt(e.target.value)}
                    placeholder={t('vector_sim_placeholder', 'Entrez un prompt de test...')}
                    className="flex-1 px-3 py-2 rounded-xl border text-xs focus:outline-hidden"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                  />
                  <button
                    onClick={handleTestSimulator}
                    disabled={testingSim}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-sm shrink-0"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    {testingSim ? t('vector_sim_testing', 'Calcul...') : t('vector_sim_btn', 'Tester')}
                  </button>
                </div>

                {simResult && (
                  <div className="flex-1 flex flex-col space-y-3 pt-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold" style={{ color: 'var(--muted)' }}>
                        {t('vector_status_label', 'Statut :')}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono font-medium border ${
                        simResult.shouldInject 
                          ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' 
                          : 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                      }`}>
                        {simResult.shouldInject 
                          ? t('vector_injection_active_count', 'Injection active ({0} souvenirs)', simResult.recalledCount)
                          : t('vector_injection_ignored', 'Prompt ignoré ou aucune correspondance')}
                      </span>
                    </div>

                    {simResult.contextBlock ? (
                      <div className="flex-1 flex flex-col space-y-1">
                        <span className="text-[11px] font-mono" style={{ color: 'var(--muted)' }}>
                          {t('vector_xml_block', 'BLOC XML INJECTÉ DANS LE SYSTÈME :')}
                        </span>
                        <pre
                          className="flex-1 p-3 rounded-2xl border text-[11px] font-mono overflow-auto whitespace-pre-wrap select-text leading-relaxed"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)'
                          }}
                        >
                          {simResult.contextBlock}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-xs italic" style={{ color: 'var(--muted)' }}>
                        {t('vector_sim_no_injection', "Le hook n'a pas injecté de contexte (prompt trivial ou score inférieur au seuil).")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-3 border-t flex items-center justify-between text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)'
          }}
        >
          <div className="flex items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-[11px]">{t('vector_footer_engine', 'Moteur de Mémoire Vectorielle Antigravity')}</span>
          </div>
          <span className="text-[10px] font-mono">{t('vector_footer_active', 'Auto-Recall Actif')}</span>
        </div>
      </div>
    </div>
  );
};

export default VectorMemoryModal;
