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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="w-[540px] max-w-full bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center text-slate-300">
              <SettingsIcon className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Paramètres Antigravity</h2>
              <p className="text-[11px] text-slate-400">Configuration du moteur et des permissions</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5 text-xs">
          {/* Default Model */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-sky-400" />
              <span>Modèle d'IA par défaut</span>
            </label>
            <p className="text-[11px] text-slate-400">Sélectionnez le modèle Gemini pour vos sessions CLI.</p>
            <select
              value={settings.model || ''}
              onChange={(e) => setSettings({ ...settings, model: e.target.value })}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-slate-200 font-mono text-xs focus:border-sky-500 outline-none"
            >
              {models.map((m) => (
                <option key={m.id} value={m.name}>
                  {m.name} ({m.id})
                </option>
              ))}
            </select>
          </div>

          {/* Agent Mode */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-300 flex items-center gap-2">
              <Shield className="w-3.5 h-3.5 text-emerald-400" />
              <span>Mode d'exécution de l'agent</span>
            </label>
            <p className="text-[11px] text-slate-400">Définit le comportement vis-à-vis des modifications de code.</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setSettings({ ...settings, agentMode: 'accept-edits' })}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  settings.agentMode === 'accept-edits'
                    ? 'border-sky-500/60 bg-sky-950/20 text-sky-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold mb-0.5">accept-edits</div>
                <div className="text-[10px] text-slate-400 leading-snug">Applique directement les éditions de code.</div>
              </button>

              <button
                type="button"
                onClick={() => setSettings({ ...settings, agentMode: 'plan' })}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  settings.agentMode === 'plan'
                    ? 'border-sky-500/60 bg-sky-950/20 text-sky-300'
                    : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                }`}
              >
                <div className="font-semibold mb-0.5">plan</div>
                <div className="text-[10px] text-slate-400 leading-snug">Propose un plan avant toute modification.</div>
              </button>
            </div>
          </div>

          {/* Permissions Overview */}
          <div className="space-y-1.5 pt-2 border-t border-slate-800">
            <label className="font-semibold text-slate-300">Règles de permissions actives</label>
            <div className="bg-slate-950 rounded-lg p-3 border border-slate-800 font-mono text-[11px] text-slate-400 space-y-1">
              {settings.permissions?.allow?.map((p, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-emerald-400 font-bold">✓</span>
                  <span>allow: {p}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between">
          <div className="text-xs">
            {savedSuccess && (
              <span className="text-emerald-400 flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5" /> Paramètres enregistrés !
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
            >
              Fermer
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="py-2 px-4 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs flex items-center gap-2 transition-colors disabled:opacity-50"
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
