import React, { useState, useEffect } from 'react';
import { X, Settings as SettingsIcon, Cpu, Shield, Save, Check } from 'lucide-react';
import type { AppSettings, ModelOption } from '../types';
import { fetchSettings, saveSettings } from '../services/api';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOption[];
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  models,
}) => {
  const [settings, setSettings] = useState<AppSettings>({});
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSettings().then((s) => setSettings(s));
    }
  }, [isOpen]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await saveSettings(settings);
      setSettings(updated);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div className="w-[560px] max-w-full bg-[#0b101f] border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1426]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Paramètres Antigravity</h2>
              <p className="text-[11px] text-slate-400">Configuration globale du moteur et des permissions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-6 text-xs bg-[#080c16]">
          {/* Default Model */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-200 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-sky-400" />
              <span>Modèle d'IA Principal</span>
            </label>
            <p className="text-[11px] text-slate-400">Sélectionnez le modèle Gemini ou compatible pour vos sessions autonomes.</p>
            <select
              value={settings.model || ''}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              className="w-full bg-[#0d1322] border border-slate-700/80 rounded-xl p-3 text-slate-200 font-mono text-xs focus:border-sky-500 outline-none transition-colors"
            >
              {models.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
          </div>

          {/* Agent Mode */}
          <div className="space-y-2">
            <label className="font-semibold text-slate-200 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mode d'Exécution de l'Agent</span>
            </label>
            <p className="text-[11px] text-slate-400">Contrôle la manière dont les modifications de code sont appliquées.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, agentMode: 'accept-edits' })}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  settings.agentMode === 'accept-edits'
                    ? 'border-sky-500/60 bg-sky-950/30 text-sky-200 shadow-sm'
                    : 'border-slate-800 bg-[#0d1322]/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold mb-1 text-xs">accept-edits</div>
                <div className="text-[11px] text-slate-400 leading-snug">Applique et sauvegarde directement les éditions de code.</div>
              </button>

              <button
                type="button"
                onClick={() => setSettings({ ...settings, agentMode: 'plan' })}
                className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
                  settings.agentMode === 'plan'
                    ? 'border-sky-500/60 bg-sky-950/30 text-sky-200 shadow-sm'
                    : 'border-slate-800 bg-[#0d1322]/60 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-bold mb-1 text-xs">plan</div>
                <div className="text-[11px] text-slate-400 leading-snug">Rédige d'abord un plan complet avant de modifier les fichiers.</div>
              </button>
            </div>
          </div>

          {/* Permissions Summary */}
          <div className="space-y-2 pt-2 border-t border-slate-800/80">
            <label className="font-semibold text-slate-300">Règles de permissions système</label>
            <div className="bg-[#050811] rounded-xl p-3.5 border border-slate-800/80 font-mono text-[11px] text-slate-400 space-y-1.5">
              {settings.permissions?.allow?.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span className="text-slate-300">allow:</span>
                  <span className="text-sky-300">{p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-[#0b101f] border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs">
            {savedSuccess && (
              <span className="text-emerald-400 flex items-center gap-1.5 font-medium">
                <Check className="w-4 h-4" /> Paramètres mis à jour !
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
            <button
              onClick={handleSave}
              disabled={saving}
              className="py-2 px-5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-md shadow-sky-500/20 disabled:opacity-50 cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Enregistrement...' : 'Sauvegarder'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
