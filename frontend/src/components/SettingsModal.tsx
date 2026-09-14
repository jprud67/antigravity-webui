import React, { useState, useEffect } from 'react';
import { 
  X, 
  Settings as SettingsIcon, 
  Cpu, 
  Shield, 
  Save, 
  Check, 
  Plus, 
  Trash2, 
  Lock, 
  Unlock, 
  Boxes, 
  KeyRound, 
  ShieldCheck, 
  ChevronRight, 
  BookOpen,
  Palette,
  Globe
} from 'lucide-react';
import type { AppSettings, ModelOption } from '../types';
import { fetchSettings, saveSettings, fetchSkills, fetchSkillDetail, updatePassword } from '../services/api';
import { AVAILABLE_THEMES, AVAILABLE_SKINS, getStoredTheme, getStoredSkin, applyAppearance, type ThemeMode } from '../services/theme';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOption[];
  currentModel: string;
  onModelSaved: (modelId: string) => void;
  initialTab?: 'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages';
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
  initialTab,
}) => {
  const { lang, setLanguage } = useI18n();
  const [activeTab, setActiveTab] = useState<'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages'>(initialTab || 'models');
  const [settings, setSettings] = useState<AppSettings>({});
  const [selectedModelId, setSelectedModelId] = useState(currentModel);
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(getStoredTheme());
  const [currentSkin, setCurrentSkin] = useState<string>(getStoredSkin());
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // Permission rules state
  const [allowRules, setAllowRules] = useState<string[]>([]);
  const [newRuleType, setNewRuleType] = useState<string>('command');
  const [newRuleValue, setNewRuleValue] = useState<string>('*');

  // Skills state
  const [skills, setSkills] = useState<any[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // Security state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
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
            const lowerModel = s.model.toLowerCase();
            if (lowerModel.includes('low')) setSelectedEffort('low');
            else if (lowerModel.includes('medium') || lowerModel.includes('med')) setSelectedEffort('medium');
            else setSelectedEffort((match.default_effort as any) || 'high');
          }
        }
        if (s.permissions?.allow) {
          setAllowRules(s.permissions.allow);
        }
      });

      // Load skills
      setSkillsLoading(true);
      fetchSkills()
        .then((items) => setSkills(items))
        .catch((err) => console.error('Error loading skills:', err))
        .finally(() => setSkillsLoading(false));
    }
  }, [isOpen, currentModel, models]);

  const activeModelObj = models.find((m) => m.id === selectedModelId);
  const supportedEfforts = activeModelObj ? activeModelObj.supported_efforts : [];

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    const found = models.find((m) => m.id === modelId);
    if (found && found.default_effort) {
      setSelectedEffort(found.default_effort as any);
    }
  };

  const applyProfile = (profile: 'full' | 'standard' | 'strict') => {
    if (profile === 'full') {
      setAllowRules(['command(*)', 'write_file(/)', 'read_file(/)', 'read_url(*)']);
    } else if (profile === 'standard') {
      setAllowRules(['command(git *)', 'command(npm *)', 'write_file(/root/workspace/*)', 'read_file(/root/*)', 'read_url(*)']);
    } else if (profile === 'strict') {
      setAllowRules(['read_file(/root/*)', 'read_url(*)']);
    }
  };

  const toggleDirectRule = (ruleToToggle: string) => {
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

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwdError('Les mots de passe ne correspondent pas');
      return;
    }
    if (newPassword.length < 4) {
      setPwdError('Le mot de passe doit faire au moins 4 caractères');
      return;
    }

    setPwdLoading(true);
    setPwdError(null);
    try {
      await updatePassword(oldPassword, newPassword);
      setPwdSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPwdSuccess(false), 3000);
    } catch (err: any) {
      setPwdError(err.message || 'Erreur lors du changement de mot de passe');
    } finally {
      setPwdLoading(false);
    }
  };

  const viewSkillDetail = async (skill: any) => {
    try {
      const detail = await fetchSkillDetail(skill.id);
      setSelectedSkill(detail);
    } catch (e) {
      setSelectedSkill(skill);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div className="w-[780px] max-w-full max-h-[90vh] bg-[#0b101f] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1426] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Configuration Antigravity</h2>
              <p className="text-[11px] text-slate-400">Modèles d'intelligence, permissions, skills et sécurité</p>
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
        <div className="flex border-b border-slate-800 bg-[#090d1a] px-6 gap-2 shrink-0 overflow-x-auto">
          <button
            onClick={() => setActiveTab('models')}
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
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
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
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

          <button
            onClick={() => setActiveTab('skills')}
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'skills'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Boxes className="w-4 h-4" />
            <span>Skills ({skills.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('security')}
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'security'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <KeyRound className="w-4 h-4" />
            <span>Sécurité & Accès</span>
          </button>

          <button
            onClick={() => setActiveTab('appearance')}
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'appearance'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-4 h-4" />
            <span>Apparence & Thèmes</span>
          </button>

          <button
            onClick={() => setActiveTab('languages')}
            className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
              activeTab === 'languages'
                ? 'border-cyan-500 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Langues ({SUPPORTED_LANGUAGES.find(l => l.code === lang)?.flag || '🌐'})</span>
          </button>
        </div>

        {/* Tab Content (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-xs bg-[#080c16]">
          {activeTab === 'models' && (
            <div className="space-y-6">
              {/* Models List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                    Modèle d'Intelligence Artificielle
                  </label>
                  <span className="text-[10px] text-slate-500">Sélectionnez la famille de modèle par défaut</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {models.map((m) => {
                    const isSelected = selectedModelId === m.id;
                    const meta = MODEL_DESCRIPTIONS[m.id] || {
                      desc: 'Modèle supporté par Antigravity CLI.',
                      badge: 'Standard',
                      iconColor: 'text-slate-400 bg-slate-800 border-slate-700'
                    };

                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelectModel(m.id)}
                        className={`p-3.5 rounded-2xl border transition-all flex items-start justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-gradient-to-r from-sky-950/40 via-[#0d1629] to-[#0d1629] border-sky-500 shadow-md ring-1 ring-sky-500/30'
                            : 'bg-[#0a0f1d] border-slate-800/80 hover:border-slate-700 hover:bg-[#0d1424]'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 mt-0.5 ${meta.iconColor}`}>
                            <Cpu className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-white text-xs">{m.name}</span>
                              <span className={`text-[9px] px-1.5 py-0.2 rounded border font-mono font-bold ${meta.iconColor}`}>
                                {meta.badge}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-400 mt-1 leading-snug">{meta.desc}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-white">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Effort & Mode settings */}
              {supportedEfforts.length > 0 && (
                <div className="p-4 rounded-2xl bg-[#0a0f1e] border border-slate-800/80 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold text-slate-200">Niveau d'Effort de Raisonnement</span>
                      <p className="text-[10px] text-slate-400">Profondeur de réflexion allouée au modèle sélectionné</p>
                    </div>
                    <div className="flex items-center gap-1.5 bg-[#060a14] p-1 rounded-xl border border-slate-800">
                      {supportedEfforts.map((eff) => (
                        <button
                          key={eff}
                          type="button"
                          onClick={() => setSelectedEffort(eff as any)}
                          className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer ${
                            selectedEffort === eff
                              ? 'bg-sky-500 text-white shadow-sm'
                              : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {eff.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-6">
              {/* 1-Click Profiles */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Profils Rapides en 1 Clic
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => applyProfile('full')}
                    className="p-3 rounded-2xl bg-[#0a0f1d] hover:bg-[#0f172c] border border-slate-800 hover:border-sky-500/50 text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Unlock className="w-3.5 h-3.5 text-sky-400" />
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">Full Développeur</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Accès total : commandes, écriture & lecture partout</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyProfile('standard')}
                    className="p-3 rounded-2xl bg-[#0a0f1d] hover:bg-[#0f172c] border border-slate-800 hover:border-emerald-500/50 text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">Standard Workspace</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Commandes courantes et écriture dans les workspaces</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyProfile('strict')}
                    className="p-3 rounded-2xl bg-[#0a0f1d] hover:bg-[#0f172c] border border-slate-800 hover:border-amber-500/50 text-left transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white">Strict (Lecture Seule)</span>
                    </div>
                    <p className="text-[10px] text-slate-400">Aucune commande terminal, analyse & lecture seule</p>
                  </button>
                </div>
              </div>

              {/* Direct Toggles */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Accès Directs
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Commandes Shell (command(*))', rule: 'command(*)', desc: 'Autoriser l\'agent à exécuter des scripts et commandes' },
                    { label: 'Écriture Fichiers (write_file(/))', rule: 'write_file(/)', desc: 'Autoriser la modification et création de fichiers' },
                    { label: 'Lecture Fichiers (read_file(/))', rule: 'read_file(/)', desc: 'Autoriser la lecture de code et de logs' },
                    { label: 'Requêtes Réseau (read_url(*))', rule: 'read_url(*)', desc: 'Autoriser l\'inspection web et URLs' },
                  ].map((item) => {
                    const active = allowRules.includes(item.rule);
                    return (
                      <div
                        key={item.rule}
                        onClick={() => toggleDirectRule(item.rule)}
                        className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                          active
                            ? 'bg-emerald-950/20 border-emerald-500/40 text-slate-200'
                            : 'bg-[#0a0f1d] border-slate-800 text-slate-400'
                        }`}
                      >
                        <div className="pr-2">
                          <span className={`text-xs font-semibold block ${active ? 'text-emerald-300' : 'text-slate-300'}`}>
                            {item.label}
                          </span>
                          <span className="text-[10px] text-slate-500">{item.desc}</span>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                            active ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-slate-700 bg-slate-800'
                          }`}
                        >
                          {active && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Granular Rules Manager */}
              <div className="p-4 rounded-2xl bg-[#0a0f1e] border border-slate-800/80 space-y-3">
                <span className="font-semibold text-slate-200 block text-xs">Règles Autorisées Actives ({allowRules.length})</span>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                  {allowRules.map((r) => (
                    <span
                      key={r}
                      className="font-mono text-[11px] bg-slate-900 border border-slate-700 text-slate-200 px-2.5 py-1 rounded-lg flex items-center gap-2 shadow-sm"
                    >
                      <span>{r}</span>
                      <button
                        type="button"
                        onClick={() => removeRule(r)}
                        className="text-slate-500 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add rule input */}
                <div className="pt-2 flex items-center gap-2 border-t border-slate-800/80">
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
                    placeholder="* ou chemin"
                    className="flex-1 bg-[#0d1322] border border-slate-700 rounded-lg px-3 py-1.5 text-slate-200 text-xs font-mono outline-none"
                  />

                  <button
                    type="button"
                    onClick={addCustomRule}
                    className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs flex items-center gap-1.5 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Ajouter</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                    Skills Installés & Écosystème
                  </h3>
                  <p className="text-[10px] text-slate-400">Capacités modulaires découvertes automatiquement par Antigravity</p>
                </div>
                <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-400 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  {skills.length} skills disponibles
                </span>
              </div>

              {selectedSkill ? (
                <div className="space-y-3 bg-[#070b16] p-4 rounded-2xl border border-slate-800">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-400" />
                      <span className="font-bold text-slate-100 text-xs">{selectedSkill.name}</span>
                      <span className="text-[9px] bg-slate-800 text-slate-300 px-1.5 py-0.2 rounded font-mono">
                        {selectedSkill.type}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedSkill(null)}
                      className="text-xs text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      ← Revenir à la liste
                    </button>
                  </div>
                  <pre className="p-4 bg-[#050811] rounded-xl text-[11px] font-mono text-slate-300 max-h-[350px] overflow-y-auto whitespace-pre-wrap">
                    {selectedSkill.content}
                  </pre>
                </div>
              ) : skillsLoading ? (
                <div className="p-8 text-center text-slate-500 text-xs">
                  Chargement des skills installés...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      onClick={() => viewSkillDetail(skill)}
                      className="p-3.5 rounded-2xl bg-[#0a0f1d] border border-slate-800 hover:border-slate-700 hover:bg-[#0e162c] transition-all cursor-pointer flex items-start justify-between group"
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0 mt-0.5">
                          <Boxes className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-xs">{skill.name}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                                skill.type === 'builtin'
                                  ? 'bg-sky-500/15 text-sky-400 border border-sky-500/30'
                                  : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              }`}
                            >
                              {skill.type === 'builtin' ? 'Built-in' : 'User Config'}
                            </span>
                            {skill.has_scripts && (
                              <span className="text-[9px] bg-amber-500/15 text-amber-300 border border-amber-500/30 px-1 py-0.2 rounded font-mono">
                                Scripts
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-1 leading-snug">{skill.description}</p>
                          <p className="text-[10px] text-slate-600 font-mono mt-1">{skill.path}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500 group-hover:text-indigo-400 transition-colors flex items-center gap-1">
                          <span>Voir doc</span>
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
                  Sécurité & Mot de Passe d'Accès
                </h3>
                <p className="text-[10px] text-slate-400">
                  Protégez l'accès au cockpit web Antigravity pour sécuriser votre serveur
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-[#0a0f1e] border border-slate-800/80 space-y-4">
                <div className="flex items-center gap-3 text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-500/30 p-3 rounded-xl">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-semibold block">Protection Active</span>
                    <span className="text-[11px] text-slate-400">L'authentification par mot de passe et signature HMAC est activée.</span>
                  </div>
                </div>

                <form onSubmit={handlePasswordChange} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Mot de passe actuel
                    </label>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder="Mot de passe actuel (par défaut : antigravity2026)"
                      className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500/60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Saisissez un nouveau mot de passe fort"
                      className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500/60"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-slate-300 mb-1">
                      Confirmer le nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirmez le nouveau mot de passe"
                      className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-xs text-slate-200 font-mono focus:outline-none focus:border-amber-500/60"
                    />
                  </div>

                  {pwdError && (
                    <div className="text-xs text-rose-400 bg-rose-950/20 border border-rose-500/30 p-2.5 rounded-xl">
                      {pwdError}
                    </div>
                  )}

                  {pwdSuccess && (
                    <div className="text-xs text-emerald-400 bg-emerald-950/20 border border-emerald-500/30 p-2.5 rounded-xl flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>Mot de passe mis à jour avec succès ! Vos sessions ont été renouvelées.</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={pwdLoading || !oldPassword || !newPassword}
                    className="py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{pwdLoading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}</span>
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* TAB 5: APPEARANCE & THEMES (HERMES SYSTEM) */}
          {activeTab === 'appearance' && (
            <div className="p-6 space-y-6">
              {/* Section 1: Mode Thème */}
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Palette className="w-4 h-4 text-amber-400" />
                  <span>Mode d'Affichage (Thème)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mb-3">
                  Détermine le fond, les surfaces et le contraste général. Le mode Système s'adapte en temps réel aux réglages de votre OS.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {AVAILABLE_THEMES.map((th) => {
                    const isSelected = currentTheme === th.id;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => {
                          setCurrentTheme(th.id);
                          applyAppearance(th.id, currentSkin);
                        }}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/10 shadow-md shadow-amber-500/10'
                            : 'border-slate-800 bg-[#0c1222] hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs text-white">{th.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                        </div>
                        <p className="text-[10px] text-slate-400 leading-snug">{th.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Nuances & Accents (Skins Hermes) */}
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Boxes className="w-4 h-4 text-sky-400" />
                  <span>Nuances & Accents Visuels (Skins Hermes)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mb-3">
                  Sélectionnez la palette d'accent et les surfaces spécifiques. Se combine avec le mode clair ou sombre sélectionné ci-dessus.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-96 overflow-y-auto pr-1">
                  {AVAILABLE_SKINS.map((sk) => {
                    const isSelected = currentSkin === sk.id;
                    return (
                      <button
                        key={sk.id}
                        type="button"
                        onClick={() => {
                          setCurrentSkin(sk.id);
                          applyAppearance(currentTheme, sk.id);
                        }}
                        className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'border-amber-400 bg-amber-500/10 shadow-sm'
                            : 'border-slate-800 bg-[#0b101f] hover:border-slate-700'
                        }`}
                      >
                        <div>
                          {/* Color dots preview */}
                          <div className="flex items-center gap-1.5 mb-2">
                            {sk.colors.map((c, i) => (
                              <span
                                key={i}
                                className="w-2.5 h-2.5 rounded-full shadow-sm border border-black/20"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                          <span className="font-bold text-[11px] text-slate-200 block truncate">
                            {sk.name}
                          </span>
                        </div>
                        <p className="text-[9px] text-slate-500 leading-tight mt-1 line-clamp-2">
                          {sk.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'languages' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Globe className="w-4 h-4 text-cyan-400" />
                  <span>Langues de l'interface (15 langues Hermes WebUI)</span>
                </h3>
                <p className="text-[11px] text-slate-400 mb-3">
                  Sélectionnez la langue d'affichage et de synthèse vocale. L'ensemble de la console et des messages est mis à jour instantanément.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                {SUPPORTED_LANGUAGES.map((item) => {
                  const isSelected = lang === item.code;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLanguage(item.code)}
                      className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between ${
                        isSelected
                          ? 'border-cyan-500 bg-cyan-500/10 shadow-md shadow-cyan-500/10'
                          : 'border-slate-800 bg-[#0c1222] hover:border-slate-700 hover:bg-[#111a33]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl leading-none">{item.flag || '🌐'}</span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs text-white">{item.label}</span>
                            <span className="text-[9px] font-mono px-1.5 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                              {item.code}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-500 font-mono">
                            {item.speech}
                          </span>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-cyan-400 shrink-0" />}
                    </button>
                  );
                })}
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
              Fermer
            </button>
            {activeTab !== 'skills' && activeTab !== 'security' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="py-2 px-5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-md shadow-sky-500/20 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
