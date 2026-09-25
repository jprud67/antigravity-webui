import React, { useState, useEffect } from 'react';
import { 
  X, 
  Brain, 
  Search, 
  Plus, 
  Trash2, 
  Check, 
  Sliders, 
  Settings2, 
  Zap
} from 'lucide-react';
import { vectorMemoryApi } from '../services/api';
import type { 
  MemoryEntry, 
  MemorySearchResult, 
  MemoryCategory, 
  AutoRecallConfig,
  RecallHookResult 
} from '../types';

interface VectorMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const CATEGORIES: MemoryCategory[] = ['general', 'preference', 'fact', 'core', 'daily', 'convention'];

export const VectorMemoryModal: React.FC<VectorMemoryModalProps> = ({
  isOpen,
  onClose,
}) => {
  const [activeTab, setActiveTab] = useState<'memories' | 'settings'>('memories');
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [_loading, setLoading] = useState(false);
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
  const loadData = async () => {
    try {
      setLoading(true);
      const [mems, cfg] = await Promise.all([
        vectorMemoryApi.listMemories('default', selectedCategory === 'all' ? undefined : selectedCategory),
        vectorMemoryApi.getConfig(),
      ]);
      setMemories(mems);
      setConfig(cfg);
    } catch (err) {
      console.error('Failed to load memory data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
  }, [isOpen, selectedCategory]);

  // Real-time semantic search
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const results = await vectorMemoryApi.searchMemories(
          query,
          8,
          0.1,
          'default',
          selectedCategory === 'all' ? undefined : selectedCategory
        );
        setSearchResults(results);
      } catch (err) {
        console.error('Semantic search error:', err);
      } finally {
        setSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery, selectedCategory]);

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
      await loadData();
    } catch (err) {
      console.error('Failed to store memory:', err);
    } finally {
      setAddingMemory(false);
    }
  };

  const handleDeleteMemory = async (id: string) => {
    try {
      await vectorMemoryApi.deleteMemory(id);
      setMemories((prev) => prev.filter((m) => m.id !== id));
      setSearchResults((prev) => prev.filter((r) => r.entry.id !== id));
    } catch (err) {
      console.error('Failed to delete memory:', err);
    }
  };

  const handleClearMemories = async () => {
    if (!window.confirm('Effacer tous les souvenirs de la mémoire vectorielle ?')) return;
    try {
      await vectorMemoryApi.clearMemories('default');
      setMemories([]);
      setSearchResults([]);
    } catch (err) {
      console.error('Failed to clear memories:', err);
    }
  };

  const handleSaveConfig = async () => {
    try {
      setSavingConfig(true);
      const updated = await vectorMemoryApi.updateConfig(config);
      setConfig(updated);
      setConfigSaved(true);
      setTimeout(() => setConfigSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save memory config:', err);
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
    } catch (err) {
      console.error('Auto-recall simulation failed:', err);
    } finally {
      setTestingSim(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-5xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/15 text-purple-400">
              <Brain className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                Mémoire Vectorielle & Auto-Recall Hook
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-normal">
                  LanceDB Compatible
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Recherche sémantique embarquée et injection automatique des souvenirs pertinents par prompt
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-muted/60 p-1 rounded-xl text-xs font-medium">
              <button
                onClick={() => setActiveTab('memories')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'memories'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Souvenirs ({memories.length})
              </button>
              <button
                onClick={() => setActiveTab('settings')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'settings'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Settings2 className="w-3.5 h-3.5" />
                Hook & Embeddings
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'memories' ? (
            <div className="flex-1 flex flex-col p-6 overflow-hidden">
              {/* Top Controls: Search Bar & Add Form */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
                {/* Search & Semantic Match */}
                <div className="md:col-span-2 flex flex-col gap-2">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Test de recherche sémantique en temps réel..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                    {searching && (
                      <span className="absolute right-3 top-2.5 text-[10px] text-purple-400 animate-pulse font-mono">
                        Vectorisation...
                      </span>
                    )}
                  </div>

                  {/* Category Pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                    <button
                      onClick={() => setSelectedCategory('all')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                        selectedCategory === 'all'
                          ? 'bg-purple-500 text-white'
                          : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      Tous
                    </button>
                    {CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium capitalize transition-colors ${
                          selectedCategory === cat
                            ? 'bg-purple-500 text-white'
                            : 'bg-muted/60 text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Clear Button */}
                <div className="flex items-start justify-end">
                  <button
                    onClick={handleClearMemories}
                    disabled={memories.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-destructive/30 text-destructive text-xs hover:bg-destructive/10 transition-colors disabled:opacity-40"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Effacer tous les souvenirs
                  </button>
                </div>
              </div>

              {/* Add Memory Form */}
              <form onSubmit={handleAddMemory} className="p-3.5 bg-muted/20 border border-border/80 rounded-xl mb-4 flex flex-wrap items-center gap-3">
                <input
                  type="text"
                  placeholder="Nouveau fait, préférence, ou instruction à mémoriser..."
                  value={newText}
                  onChange={(e) => setNewText(e.target.value)}
                  className="flex-1 min-w-[260px] px-3 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                />

                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as MemoryCategory)}
                  className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="text-[11px]">Importance:</span>
                  <input
                    type="range"
                    min="0.1"
                    max="1.0"
                    step="0.1"
                    value={newImportance}
                    onChange={(e) => setNewImportance(parseFloat(e.target.value))}
                    className="w-16 accent-purple-500"
                  />
                  <span className="font-mono text-[10px] w-6">{(newImportance * 100).toFixed(0)}%</span>
                </div>

                <button
                  type="submit"
                  disabled={addingMemory || !newText.trim()}
                  className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 transition-colors disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Mémoriser
                </button>
              </form>

              {/* List of Memories or Search Results */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {searchQuery.trim() ? (
                  searchResults.length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted-foreground">
                      Aucune correspondance sémantique pour &quot;{searchQuery}&quot;
                    </div>
                  ) : (
                    searchResults.map((res) => (
                      <div
                        key={res.entry.id}
                        className="p-3 bg-card border border-purple-500/30 rounded-xl flex items-start justify-between gap-3 shadow-sm hover:border-purple-500 transition-colors"
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="px-2 py-0.5 rounded-full text-[10px] bg-purple-500/15 text-purple-400 font-mono font-semibold">
                              {(res.similarity * 100).toFixed(0)}% match
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono uppercase">
                              {res.entry.category}
                            </span>
                            <span className="text-[10px] text-muted-foreground">
                              Score: {res.score.toFixed(3)}
                            </span>
                          </div>
                          <p className="text-xs text-foreground leading-relaxed">{res.entry.text}</p>
                        </div>
                        <button
                          onClick={() => handleDeleteMemory(res.entry.id)}
                          className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                          title="Supprimer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )
                ) : memories.length === 0 ? (
                  <div className="text-center py-12 text-xs text-muted-foreground">
                    <Brain className="w-8 h-8 text-muted-foreground/40 mx-auto mb-2" />
                    Aucun souvenir enregistré. Ajoutez votre première instruction ci-dessus.
                  </div>
                ) : (
                  memories.map((mem) => (
                    <div
                      key={mem.id}
                      className="p-3 bg-card border border-border/70 rounded-xl flex items-start justify-between gap-3 hover:border-border transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="px-2 py-0.5 rounded text-[10px] bg-muted text-muted-foreground font-mono uppercase">
                            {mem.category}
                          </span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            Importance: {(mem.importance * 100).toFixed(0)}%
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(mem.createdAt * 1000).toLocaleDateString()}
                          </span>
                        </div>
                        <p className="text-xs text-foreground leading-relaxed">{mem.text}</p>
                      </div>
                      <button
                        onClick={() => handleDeleteMemory(mem.id)}
                        className="p-1 text-muted-foreground hover:text-destructive transition-colors"
                        title="Supprimer"
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
            <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border overflow-hidden">
              {/* Config Form */}
              <div className="p-6 overflow-y-auto space-y-5 bg-card">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-purple-400" />
                    Configuration du Hook Auto-Recall
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Contrôle le filtrage, les seuils de similarité et le modèle d'embeddings
                  </p>
                </div>

                <div className="space-y-4 text-xs">
                  {/* Enable Switch */}
                  <label className="flex items-center justify-between p-3 rounded-xl bg-muted/20 border border-border cursor-pointer">
                    <div>
                      <div className="font-medium text-foreground">Activer l'Auto-Recall automatique</div>
                      <div className="text-[11px] text-muted-foreground">Injecte les souvenirs pertinents avant chaque prompt LLM</div>
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
                    <label className="text-muted-foreground font-medium">Moteur d'Embeddings</label>
                    <select
                      value={config.provider}
                      onChange={(e) => setConfig({ ...config, provider: e.target.value as any })}
                      className="w-full px-3 py-2 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                    >
                      <option value="local">Local Déterministe (Zéro dépendance, 384d)</option>
                      <option value="openai">OpenAI (text-embedding-3-small)</option>
                      <option value="ollama">Ollama Local (nomic-embed-text)</option>
                      <option value="gemini">Google Gemini Embeddings</option>
                    </select>
                  </div>

                  {/* Model Name */}
                  <div className="space-y-1.5">
                    <label className="text-muted-foreground font-medium">Modèle d'embedding</label>
                    <input
                      type="text"
                      value={config.model}
                      onChange={(e) => setConfig({ ...config, model: e.target.value })}
                      placeholder="text-embedding-3-small"
                      className="w-full px-3 py-2 bg-background border border-border rounded-xl text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                    />
                  </div>

                  {/* Sliders: Top-K, Min Similarity, Max Chars */}
                  <div className="space-y-3 pt-2">
                    <div>
                      <div className="flex justify-between text-muted-foreground mb-1">
                        <span>Max souvenirs réinjectés (Top-K)</span>
                        <span className="font-mono text-foreground">{config.maxResults}</span>
                      </div>
                      <input
                        type="range"
                        min="1"
                        max="10"
                        value={config.maxResults}
                        onChange={(e) => setConfig({ ...config, maxResults: parseInt(e.target.value) })}
                        className="w-full accent-purple-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-muted-foreground mb-1">
                        <span>Seuil de similarité minimale</span>
                        <span className="font-mono text-foreground">{(config.minSimilarity * 100).toFixed(0)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.1"
                        max="0.9"
                        step="0.05"
                        value={config.minSimilarity}
                        onChange={(e) => setConfig({ ...config, minSimilarity: parseFloat(e.target.value) })}
                        className="w-full accent-purple-500"
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-muted-foreground mb-1">
                        <span>Longueur max du bloc injecté</span>
                        <span className="font-mono text-foreground">{config.maxChars} chars</span>
                      </div>
                      <input
                        type="range"
                        min="500"
                        max="5000"
                        step="250"
                        value={config.maxChars}
                        onChange={(e) => setConfig({ ...config, maxChars: parseInt(e.target.value) })}
                        className="w-full accent-purple-500"
                      />
                    </div>
                  </div>

                  <button
                    onClick={handleSaveConfig}
                    disabled={savingConfig}
                    className="w-full mt-4 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-purple-600 text-white font-semibold hover:bg-purple-500 transition-colors disabled:opacity-50"
                  >
                    {configSaved ? (
                      <>
                        <Check className="w-4 h-4" />
                        Configuration Enregistrée !
                      </>
                    ) : (
                      'Sauvegarder les paramètres'
                    )}
                  </button>
                </div>
              </div>

              {/* Simulator */}
              <div className="p-6 overflow-y-auto space-y-4 bg-muted/10 flex flex-col">
                <div>
                  <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                    <Zap className="w-4 h-4 text-amber-400" />
                    Simulateur Auto-Recall en Direct
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Testez comment le hook analyse un prompt et injecte les souvenirs
                  </p>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={simPrompt}
                    onChange={(e) => setSimPrompt(e.target.value)}
                    placeholder="Entrez un prompt de test..."
                    className="flex-1 px-3 py-2 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-purple-500"
                  />
                  <button
                    onClick={handleTestSimulator}
                    disabled={testingSim}
                    className="px-4 py-2 rounded-xl bg-purple-600 text-white text-xs font-semibold hover:bg-purple-500 transition-colors disabled:opacity-50"
                  >
                    {testingSim ? 'Calcul...' : 'Tester'}
                  </button>
                </div>

                {simResult && (
                  <div className="flex-1 flex flex-col space-y-3 pt-2">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-muted-foreground">Statut :</span>
                      <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        simResult.shouldInject ? 'bg-green-500/15 text-green-400' : 'bg-amber-500/15 text-amber-400'
                      }`}>
                        {simResult.shouldInject ? `Injection active (${simResult.recalledCount} souvenirs)` : 'Prompt ignoré ou aucune correspondance'}
                      </span>
                    </div>

                    {simResult.contextBlock ? (
                      <div className="flex-1 flex flex-col">
                        <span className="text-[11px] text-muted-foreground font-mono mb-1">
                          BLOC XML INJECTÉ DANS LE SYSTÈME :
                        </span>
                        <pre className="flex-1 p-3 bg-neutral-950 text-neutral-200 border border-border rounded-xl text-xs font-mono overflow-auto whitespace-pre-wrap select-text">
                          {simResult.contextBlock}
                        </pre>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        Le hook n'a pas injecté de contexte (prompt trivial ou score inférieur au seuil).
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VectorMemoryModal;
