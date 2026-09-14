import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings as SettingsIcon, 
  Cpu, 
  Shield, 
  Save, 
  Check, 
  Zap, 
  Terminal, 
  FileEdit, 
  FileText, 
  Globe, 
  Plus, 
  Trash2, 
  SlidersHorizontal,
  Sparkles,
  Lock,
  Unlock,
  Wand2
} from 'lucide-react';
import type { AppSettings, ModelOption } from '../types';
import { fetchSettings, saveSettings } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOption[];
  currentModel: string;
  onModelSaved: (modelId: string) => void;
}

const MODEL_DESCRIPTIONS: Record<string, { desc: string; badge: string; iconColor: string }> = {
  'gemini-3.8-flash': { desc: 'Ultra-rapide, performant et polyvalent. Idéal pour le développement quotidien.', badge: 'Recommandé', iconColor: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  'gemini-3.7-flash': { desc: 'Génération de code rapide et robuste avec bon raisonnement.', badge: 'Rapide', iconColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  'gemini-3.6-flash': { desc: 'Modèle léger et très réactif pour les tâches simples.', badge: 'Léger', iconColor: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
  'gemini-3.1-pro': { desc: 'Raisonnement profond pour architectures complexes et gros refactoring.', badge: 'Expert', iconColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  'claude-sonnet-4-6': { desc: 'Excellence en analyse de code et raisonnement Thinking natif.', badge: 'Thinking', iconColor: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  'claude-opus-4-6-thinking': { desc: 'Capacités maximales de réflexion pour les problèmes algorithmiques pointus.', badge: 'Premium', iconColor: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30' },
  'gpt-oss-120b': { desc: 'Modèle open-weights haute performance 120B.', badge: 'Open-OSS', iconColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  models,
  currentModel,
  onModelSaved,
}) => {
  const [activeTab, setActiveTab] = useState<'models' | 'permissions'>('models');
  const [settings, setSettings] = useState<AppSettings>({});
  const [selectedModelId, setSelectedModelId] = useState(currentModel);
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Permission rules state
  const [allowRules, setAllowRules] = useState<string[]>([]);
  const [newRuleType, setNewRuleType] = useState<string>('command');
  const [newRuleValue, setNewRuleValue] = useState<string>('*');

  useEffect(() => {
    if (isOpen) {
      setSelectedModelId(currentModel);
      fetchSettings().then((s) => {
        setSettings(s);
        if (s.model) {
          const match = models.find(
            (m) =>
              m.name === s.model ||
              m.id === s.model ||
              (s.model ? s.model.includes(m.name) || s.model.includes(m.id) : false)
          );
          if (match) {
            setSelectedModelId(match.id);
            const lower = s.model.toLowerCase();
            if (lower.includes('low')) setSelectedEffort('low');
            else if (lower.includes('medium') || lower.includes('med')) setSelectedEffort('medium');
            else setSelectedEffort((match.default_effort as any) || 'high');
          }
        }
        setAllowRules(s.permissions?.allow || [
          'command(*)',
          'write_file(/)',
          'read_file(/)',
          'read_url(*)'
        ]);
      });
    }
  }, [isOpen, currentModel, models]);

  const currentModelObj = models.find((m) => m.id === selectedModelId) || models[0];
  const supportedEfforts = currentModelObj?.supported_efforts ?? [];

  // Toggle quick presets for permissions
  const applyPreset = (preset: 'dev' | 'workspace' | 'strict') => {
    if (preset === 'dev') {
      setAllowRules([
        'command(*)',
        'write_file(/)',
        'read_file(/)',
        'read_url(*)'
      ]);
    } else if (preset === 'workspace') {
      setAllowRules([
        'command(*)',
        'write_file(/root)',
        'read_file(/)',
        'read_url(*)'
      ]);
    } else if (preset === 'strict') {
      setAllowRules([
        'read_file(/root)',
        'write_file(/root)'
      ]);
    }
  };

  // Toggle a high-level permission switch
  const hasRule = (rulePrefix: string) => allowRules.some((r) => r.startsWith(rulePrefix));

  const toggleHighLevelRule = (type: 'command' | 'write' | 'read' | 'url') => {
    let ruleToToggle = '';
    if (type === 'command') ruleToToggle = 'command(*)';
    if (type === 'write') ruleToToggle = 'write_file(/)';
    if (type === 'read') ruleToToggle = 'read_file(/)';
    if (type === 'url') ruleToToggle = 'read_url(*)';

    if (allowRules.includes(ruleToToggle)) {
      setAllowRules(allowRules.filter((r) => r !== ruleToToggle));
    } else {
      setAllowRules([...allowRules, ruleToToggle]);
    }
  };

  const removeRule = (rule: string) => {
    setAllowRules(allowRules.filter((r) => r !== rule));
  };

  const addCustomRule = () => {
    if (!newRuleValue.trim()) return;
    const ruleString = `${newRuleType}(${newRuleValue.trim()})`;
    if (!allowRules.includes(ruleString)) {
      setAllowRules([...allowRules, ruleString]);
    }
    setNewRuleValue('*');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const match = models.find((m) => m.id === selectedModelId);
      const concreteModelName = match?.name || selectedModelId;

      const updatedSettings = {
        ...settings,
        model: concreteModelName,
        permissions: {
          ...settings.permissions,
          allow: allowRules
        }
      };

      const updated = await saveSettings(updatedSettings);
      setSettings(updated);
      onModelSaved(selectedModelId);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div className="w-[680px] max-w-full max-h-[90vh] bg-[#0b101f] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1426] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Configuration Antigravity</h2>
              <p className="text-[11px] text-slate-400">Modèles d'intelligence et politique de permissions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-[#090d1a] px-6 gap-2 shrink-0">
          <button
            onClick={() => setActiveTab('models')}
            className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'models'
                ? 'border-sky-500 text-sky-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-4 h-4" />
            <span>Modèles & Raisonnement</span>
          </button>

          <button
            onClick={() => setActiveTab('permissions')}
            className={`py-3 px-4 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'permissions'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Shield className="w-4 h-4" />
            <span>Règles de Permissions</span>
            <span className="text-[10px] bg-emerald-950 text-emerald-400 border border-emerald-800/60 px-1.5 py-0.2 rounded-full font-mono">
              {allowRules.length}
            </span>
          </button>
        </div>

        {/* Tab Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs bg-[#080c16]">
          {activeTab === 'models' ? (
            /* TAB 1: MODELS & REASONING */
            <div className="space-y-6">
              {/* Models List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-sky-400" />
                    <span>Choisir le Modèle Principal</span>
                  </label>
                  <span className="text-[11px] text-slate-500">{models.length} modèles disponibles</span>
                </div>

                <div className="space-y-2">
                  {models.map((m) => {
                    const isSelected = m.id === selectedModelId;
                    const meta = MODEL_DESCRIPTIONS[m.id] || {
                      desc: 'Modèle IA autonome pour Antigravity CLI.',
                      badge: 'IA',
                      iconColor: 'text-slate-400 bg-slate-800 border-slate-700'
                    };

                    return (
                      <div
                        key={m.id}
                        onClick={() => {
                          setSelectedModelId(m.id);
                          if (m.supported_efforts.length > 0 && !m.supported_efforts.includes(selectedEffort)) {
                            setSelectedEffort((m.default_effort as any) || (m.supported_efforts[0] as any) || 'high');
                          }
                        }}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                          isSelected
                            ? 'bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border-sky-500/60 shadow-md shadow-sky-500/10'
                            : 'bg-[#0d1322]/70 border-slate-800/80 hover:border-slate-700 hover:bg-[#0f1728]'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-xl border flex items-center justify-center shrink-0 ${meta.iconColor}`}>
                            <Cpu className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-slate-100 text-xs">{m.name}</span>
                              <span className="text-[9px] uppercase tracking-wider font-semibold px-2 py-0.2 rounded-full border border-sky-500/20 bg-sky-500/10 text-sky-300">
                                {meta.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">{meta.desc}</p>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center">
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition-all ${
                            isSelected ? 'border-sky-500 bg-sky-500' : 'border-slate-700 bg-slate-900'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 text-white stroke-[3]" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Default Effort Level */}
              <div className="space-y-2 pt-4 border-t border-slate-800">
                <label className="font-semibold text-slate-200 flex items-center gap-2">
                  <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                  <span>Niveau d'Effort de Raisonnement (Thinking)</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Ajuste la profondeur d'analyse et le temps de réflexion de l'agent avant de répondre.
                </p>

                {supportedEfforts.length > 0 ? (
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'high', label: 'Haut (High)', desc: 'Raisonnement maximal pour les tâches complexes.' },
                      { id: 'medium', label: 'Moyen (Medium)', desc: 'Équilibre parfait vitesse et pertinence.' },
                      { id: 'low', label: 'Faible (Low)', desc: 'Réponse immédiate, idéal pour du code rapide.' }
                    ].filter((opt) => supportedEfforts.includes(opt.id)).map((opt) => {
                      const isEffortActive = selectedEffort === opt.id;
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setSelectedEffort(opt.id as any)}
                          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                            isEffortActive
                              ? 'border-indigo-500/70 bg-indigo-950/30 text-indigo-200 shadow-sm'
                              : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:border-slate-700'
                          }`}
                        >
                          <div className="font-bold text-xs text-slate-200 mb-0.5">{opt.label}</div>
                          <div className="text-[10px] text-slate-400 leading-snug">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="p-3 bg-[#0d1322] border border-slate-800 rounded-xl text-slate-400 text-[11px] flex items-center gap-2">
                    <Zap className="w-4 h-4 text-purple-400 shrink-0" />
                    <span>Le modèle sélectionné ({currentModelObj.name}) utilise un mécanisme de raisonnement thinking natif non configurable.</span>
                  </div>
                )}
              </div>

              {/* Agent Mode */}
              <div className="space-y-2 pt-4 border-t border-slate-800">
                <label className="font-semibold text-slate-200 flex items-center gap-2">
                  <Shield className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Mode d'Exécution de Code</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, agentMode: 'accept-edits' })}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      settings.agentMode === 'accept-edits'
                        ? 'border-sky-500/60 bg-sky-950/30 text-sky-200 shadow-sm'
                        : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-200 mb-0.5">accept-edits (Recommandé)</div>
                    <div className="text-[10px] text-slate-400 leading-snug">Édite et applique directement les modifications de code.</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSettings({ ...settings, agentMode: 'plan' })}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      settings.agentMode === 'plan'
                        ? 'border-sky-500/60 bg-sky-950/30 text-sky-200 shadow-sm'
                        : 'border-slate-800 bg-[#0d1322] text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    <div className="font-bold text-xs text-slate-200 mb-0.5">plan</div>
                    <div className="text-[10px] text-slate-400 leading-snug">Rédige un plan formel avant d'appliquer toute édition.</div>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* TAB 2: PERMISSIONS MANAGEMENT */
            <div className="space-y-6">
              {/* Quick Presets */}
              <div className="space-y-2">
                <label className="font-semibold text-slate-200 flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-emerald-400" />
                  <span>Profils de Permissions Prédéfinis (1 Clic)</span>
                </label>
                <p className="text-[11px] text-slate-400">
                  Sélectionnez un profil pré-configuré adapté à votre mode de travail.
                </p>

                <div className="grid grid-cols-3 gap-3">
                  <button
                    type="button"
                    onClick={() => applyPreset('dev')}
                    className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] hover:border-emerald-500/50 hover:bg-[#0f1828] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-emerald-400 mb-1">
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Full Développeur</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Toutes commandes, écritures, lectures et web autorisés sans confirmation.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset('workspace')}
                    className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] hover:border-amber-500/50 hover:bg-[#0f1828] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-amber-400 mb-1">
                      <Lock className="w-3.5 h-3.5" />
                      <span>Standard Workspace</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Écriture isolée au dossier workspace (/root), lecture globale.
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyPreset('strict')}
                    className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] hover:border-rose-500/50 hover:bg-[#0f1828] text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-1.5 font-bold text-xs text-rose-400 mb-1">
                      <Shield className="w-3.5 h-3.5" />
                      <span>Strict / Isolé</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Commandes bloquées par défaut, accès restreint au workspace.
                    </div>
                  </button>
                </div>
              </div>

              {/* Master Toggles */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <label className="font-semibold text-slate-200 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-sky-400" />
                  <span>Interrupteurs Globaux</span>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  {/* Toggle Command */}
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Terminal className="w-4 h-4 text-amber-400" />
                      <div>
                        <div className="font-semibold text-xs text-slate-200">Exécuter des commandes</div>
                        <div className="text-[10px] text-slate-400">command(*)</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHighLevelRule('command')}
                      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                        hasRule('command') ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        hasRule('command') ? 'left-5' : 'left-1'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle Write */}
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <FileEdit className="w-4 h-4 text-sky-400" />
                      <div>
                        <div className="font-semibold text-xs text-slate-200">Écriture sur disque</div>
                        <div className="text-[10px] text-slate-400">write_file(/)</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHighLevelRule('write')}
                      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                        hasRule('write_file') ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        hasRule('write_file') ? 'left-5' : 'left-1'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle Read */}
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-indigo-400" />
                      <div>
                        <div className="font-semibold text-xs text-slate-200">Lecture sur disque</div>
                        <div className="text-[10px] text-slate-400">read_file(/)</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHighLevelRule('read')}
                      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                        hasRule('read_file') ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        hasRule('read_file') ? 'left-5' : 'left-1'
                      }`} />
                    </button>
                  </div>

                  {/* Toggle URL */}
                  <div className="p-3 rounded-xl border border-slate-800 bg-[#0d1322] flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <Globe className="w-4 h-4 text-teal-400" />
                      <div>
                        <div className="font-semibold text-xs text-slate-200">Accès Internet & Web</div>
                        <div className="text-[10px] text-slate-400">read_url(*)</div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggleHighLevelRule('url')}
                      className={`w-10 h-6 rounded-full transition-colors relative cursor-pointer ${
                        hasRule('read_url') ? 'bg-emerald-500' : 'bg-slate-700'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform absolute top-1 ${
                        hasRule('read_url') ? 'left-5' : 'left-1'
                      }`} />
                    </button>
                  </div>
                </div>
              </div>

              {/* Active Rules List */}
              <div className="space-y-3 pt-4 border-t border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="font-semibold text-slate-200 flex items-center gap-2">
                    <Check className="w-4 h-4 text-emerald-400" />
                    <span>Règles Autorisées Actives ({allowRules.length})</span>
                  </label>
                  <span className="text-[10px] text-slate-500">Sauvegardé dans settings.json</span>
                </div>

                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {allowRules.length === 0 ? (
                    <div className="p-4 rounded-xl border border-dashed border-slate-800 text-center text-slate-500 text-xs">
                      Aucune règle active. L'agent demandera confirmation pour chaque action.
                    </div>
                  ) : (
                    allowRules.map((rule) => (
                      <div
                        key={rule}
                        className="flex items-center justify-between p-2.5 rounded-xl border border-slate-800 bg-[#0d1322] text-xs font-mono group hover:border-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <span className="text-emerald-400 font-bold">✓</span>
                          <span className="text-slate-300 truncate">{rule}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeRule(rule)}
                          className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                          title="Supprimer cette règle"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                {/* Add Custom Rule Form */}
                <div className="pt-2 flex items-center gap-2">
                  <select
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value)}
                    className="bg-[#0d1322] border border-slate-700 rounded-lg px-2.5 py-1.5 text-slate-200 text-xs font-mono outline-none"
                  >
                    <option value="command">command</option>
                    <option value="write_file">write_file</option>
                    <option value="read_file">read_file</option>
                    <option value="read_url">read_url</option>
                  </select>

                  <input
                    type="text"
                    value={newRuleValue}
                    onChange={(e) => setNewRuleValue(e.target.value)}
                    placeholder="* ou chemin/domaine"
                    className="flex-1 bg-[#0d1322] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-mono outline-none placeholder-slate-500 focus:border-sky-500"
                  />

                  <button
                    type="button"
                    onClick={addCustomRule}
                    className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Ajouter</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0e1426] border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs">
            {savedSuccess && (
              <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <Check className="w-4 h-4" /> Paramètres enregistrés avec succès !
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
            >
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="py-2 px-5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-md shadow-sky-500/20 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
