import React, { useState } from 'react';
import { 
  X, 
  GitFork, 
  Loader2, 
  Cpu, 
  Check, 
  FolderGit2
} from 'lucide-react';
import type { AgentNode, ForkAgentRequest } from '../types';
import { forkAgentBranch } from '../services/api';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';

interface ForkAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  agentNode: AgentNode | null;
  conversationId: string;
  onForkCreated: (forkedAgentId: string) => void;
}

const AVAILABLE_MODELS = [
  { id: 'Gemini 3.8 Flash (Low)', label: 'Gemini 3.8 Flash (Low)', tier: 'Économe' },
  { id: 'Gemini 3.8 Flash (Medium)', label: 'Gemini 3.8 Flash (Medium)', tier: 'Équilibré' },
  { id: 'Gemini 3.8 Flash (High)', label: 'Gemini 3.8 Flash (High)', tier: 'Raisonnement' },
  { id: 'Claude 3.7 Sonnet', label: 'Claude 3.7 Sonnet', tier: 'Avancé' },
  { id: 'GPT-4o', label: 'GPT-4o', tier: 'Polyvalent' },
];

export const ForkAgentModal: React.FC<ForkAgentModalProps> = ({
  isOpen,
  onClose,
  agentNode,
  conversationId,
  onForkCreated,
}) => {
  const { t } = useI18n();

  const [directives, setDirectives] = useState('');
  const [selectedModel, setSelectedModel] = useState('Gemini 3.8 Flash (Low)');
  const [branchName, setBranchName] = useState('');
  const [createWorktree, setCreateWorktree] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  if (!isOpen || !agentNode) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);
    try {
      const payload: ForkAgentRequest = {
        conversation_id: conversationId,
        parent_agent_id: agentNode.id,
        branch_name: branchName.trim() || undefined,
        model: selectedModel,
        directives: directives.trim() || undefined,
        create_worktree: createWorktree,
      };

      const res = await forkAgentBranch(payload);
      showToast(t('fork_agent_success', "Bifurcation d'exécution instanciée avec succès !"), 'success');
      onForkCreated(res.forked_agent_id);
      onClose();
    } catch (err: any) {
      showToast(err?.message || "Erreur lors de la bifurcation de l'agent", 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyPreset = (presetText: string) => {
    setDirectives((prev) => (prev ? `${prev}\n${presetText}` : presetText));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
              <GitFork className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-zinc-100">
                {t('fork_agent_modal_title', "Bifurquer l'arbre d'exécution")}
              </h3>
              <p className="text-xs text-zinc-400">
                {t('fork_agent_modal_subtitle', 'Créer une branche autonome avec modèle ou directives alternatifs')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto max-h-[75vh]">
          {/* Parent Node Info Card */}
          <div className="p-3 rounded-xl bg-zinc-950/60 border border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-2 min-w-0">
              <Cpu className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="truncate">
                <span className="text-xs text-zinc-400 block">{t('fork_parent_node_label', 'Agent Parent')}</span>
                <span className="text-sm font-semibold text-zinc-100 truncate block">
                  {agentNode.name} <span className="text-xs font-normal text-zinc-500 font-mono">({agentNode.id})</span>
                </span>
              </div>
            </div>
            <span className="px-2 py-0.5 rounded-full text-[11px] bg-zinc-800 text-zinc-300 capitalize">
              {agentNode.role}
            </span>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              {t('fork_model_select_label', 'Modèle alternatif pour cette branche')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {AVAILABLE_MODELS.map((m) => {
                const isSelected = selectedModel === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setSelectedModel(m.id)}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-center justify-between ${
                      isSelected
                        ? 'bg-amber-500/10 border-amber-500/60 text-amber-300 ring-1 ring-amber-500/40'
                        : 'bg-zinc-950/40 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    <div className="min-w-0">
                      <span className="text-xs font-medium block truncate">{m.label}</span>
                      <span className="text-[10px] text-zinc-500 block">{m.tier}</span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-amber-400 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Directives / Prompt */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-zinc-300">
                {t('fork_directives_label', 'Directives spécifiques pour la branche')}
              </label>
              <span className="text-[11px] text-zinc-500">{t('optional_badge', 'Optionnel')}</span>
            </div>
            <textarea
              value={directives}
              onChange={(e) => setDirectives(e.target.value)}
              placeholder={t('fork_directives_placeholder', 'Ex: Essayer une approche fonctionnelle sans modifier la base SQL existante...')}
              rows={3}
              className="w-full px-3 py-2 text-xs rounded-xl bg-zinc-950/70 border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
            />
            {/* Quick Presets */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              <button
                type="button"
                onClick={() => handleApplyPreset('Prioriser la vitesse et réduire les tests superflus.')}
                className="px-2 py-0.5 text-[10px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                ⚡ {t('fork_preset_speed', 'Priorité Vitesse')}
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('Approche TDD stricte : écrire et valider les tests unitaires avant le code.')}
                className="px-2 py-0.5 text-[10px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                🧪 {t('fork_preset_tdd', 'Approche TDD')}
              </button>
              <button
                type="button"
                onClick={() => handleApplyPreset('Minimiser les dépendances externes et simplifier les flux de données.')}
                className="px-2 py-0.5 text-[10px] rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
              >
                🛡️ {t('fork_preset_minimal', 'Zéro Dépendance')}
              </button>
            </div>
          </div>

          {/* Dedicated Worktree & Branch Settings */}
          <div className="p-3.5 rounded-xl bg-zinc-950/60 border border-zinc-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderGit2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <div>
                  <span className="text-xs font-medium text-zinc-200 block">
                    {t('fork_worktree_toggle_title', 'Isolation par Git Worktree')}
                  </span>
                  <span className="text-[11px] text-zinc-500 block">
                    {t('fork_worktree_toggle_desc', 'Isole les fichiers modifiés dans un répertoire clone dédié')}
                  </span>
                </div>
              </div>
              <input
                type="checkbox"
                checked={createWorktree}
                onChange={(e) => setCreateWorktree(e.target.checked)}
                className="w-4 h-4 accent-amber-500 cursor-pointer"
              />
            </div>

            {createWorktree && (
              <div>
                <label className="block text-[11px] text-zinc-400 mb-1 font-mono">
                  {t('fork_branch_name_label', 'Nom de la branche Git')}
                </label>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="antigravity-subagent/subagent-fork-..."
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500"
                />
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs rounded-xl text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
            >
              {t('common_cancel', 'Annuler')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-5 py-2 text-xs font-semibold rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-zinc-950 flex items-center gap-1.5 shadow-lg shadow-amber-500/20 disabled:opacity-50 transition-all"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t('fork_submitting', 'Bifurcation en cours...')}
                </>
              ) : (
                <>
                  <GitFork className="w-3.5 h-3.5" />
                  {t('fork_confirm_action', "Bifurquer l'arbre")}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
