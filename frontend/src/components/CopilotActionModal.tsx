import { useI18n } from '../services/i18n';
import React, { useState } from 'react';
import {
  X,
  Zap,
  Wand2,
  FileCode,
  Check,
  Loader2,
  Layers,
  BookOpen,
  TestTube2,
  Sparkles,
  RotateCcw
} from 'lucide-react';
import { DiffEditor } from '@monaco-editor/react';
import { executeCopilotAction } from '../services/api';
import { showToast } from '../services/toast';

export interface CopilotActionModalProps {
  isOpen: boolean;
  code: string;
  language: string;
  filePath?: string;
  theme?: 'vs-dark' | 'light';
  onClose: () => void;
  onApply: (modifiedCode: string) => void;
}

type CopilotActionType = 'refactor' | 'types' | 'docstring' | 'tests';

const getActionDetails = (action: CopilotActionType, t: (key: string, def?: string) => string) => {
  const map: Record<CopilotActionType, { label: string; icon: any; desc: string }> = {
    refactor: {
      label: t('copilot_action_refactor', 'Refactoriser'),
      icon: Wand2,
      desc: t('copilot_action_refactor_desc', 'Simplifie, nettoie et modernise le code sans en altérer le comportement fonctionnel.')
    },
    types: {
      label: t('copilot_action_types', 'Générer Types'),
      icon: Layers,
      desc: t('copilot_action_types_desc', "Infère automatiquement les interfaces TypeScript, types d'union ou schémas de typage.")
    },
    docstring: {
      label: t('copilot_action_docstring', 'Documenter'),
      icon: BookOpen,
      desc: t('copilot_action_docstring_desc', 'Génère une documentation structurée (JSDoc, docstrings Google/NumPy) pour les fonctions et classes.')
    },
    tests: {
      label: t('copilot_action_tests', 'Générer Tests'),
      icon: TestTube2,
      desc: t('copilot_action_tests_desc', "Crée une suite complète de tests unitaires prête à l'emploi (Vitest / Jest / Pytest).")
    }
  };
  return map[action];
};

export const CopilotActionModal: React.FC<CopilotActionModalProps> = ({
  isOpen,
  code,
  language,
  filePath,
  theme = 'vs-dark',
  onClose,
  onApply
}) => {
  const { t } = useI18n();
  const [selectedAction, setSelectedAction] = useState<CopilotActionType>('refactor');
  const [userInstruction, setUserInstruction] = useState<string>('');
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [resultCode, setResultCode] = useState<string | null>(null);
  const [explanation, setExplanation] = useState<string>('');
  const [isSplitView, setIsSplitView] = useState<boolean>(true);

  if (!isOpen) return null;

  const handleExecute = async () => {
    if (!code || !code.trim()) {
      showToast(t('copilot_no_code', 'Aucun code sélectionné à transformer'), 'error');
      return;
    }

    setIsRunning(true);
    try {
      const res = await executeCopilotAction({
        action: selectedAction,
        code,
        language,
        file_path: filePath,
        user_instruction: userInstruction.trim() || undefined
      });

      setResultCode(res.result_code);
      setExplanation(res.explanation || '');
      showToast(`${t('action', 'Action')} "${getActionDetails(selectedAction, t).label}" ${t('executed_success', 'exécutée avec succès')}`, 'success');
    } catch (err: any) {
      showToast(err.message || "Erreur lors de l'exécution de l'action Copilot", 'error');
    } finally {
      setIsRunning(false);
    }
  };

  const handleApplyChanges = () => {
    if (resultCode !== null) {
      onApply(resultCode);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="flex flex-col w-[94vw] max-w-5xl h-[88vh] rounded-2xl bg-zinc-900 border border-zinc-700/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-zinc-800 bg-zinc-950/80 select-none shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/15 text-sky-400 flex items-center justify-center border border-sky-500/30">
              <Zap className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100">
                  AI Code Actions Studio
                </h3>
                <span className="font-mono text-[11px] px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700">
                  {language.toUpperCase()}
                </span>
                {filePath && (
                  <span className="text-[11px] font-mono text-zinc-500 truncate max-w-xs">
                    {filePath}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400">
                {t('copilot_modal_sub', 'Transformations de code intelligentes et prévisualisation sémantique')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Selection Tabs & Instruction Bar */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/40 space-y-3 shrink-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(['refactor', 'types', 'docstring', 'tests'] as CopilotActionType[]).map((actionKey) => {
              const item = getActionDetails(actionKey, t);
              const Icon = item.icon;
              const isSelected = selectedAction === actionKey;

              return (
                <button
                  key={actionKey}
                  type="button"
                  onClick={() => setSelectedAction(actionKey)}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-sky-500/15 border-sky-500/50 text-white shadow-xs'
                      : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-2 font-medium text-xs mb-1">
                    <Icon className={`w-3.5 h-3.5 ${isSelected ? 'text-sky-400' : 'text-zinc-500'}`} />
                    <span className={isSelected ? 'text-sky-300 font-semibold' : ''}>{item.label}</span>
                  </div>
                  <p className="text-[11px] text-zinc-500 line-clamp-1 leading-snug">
                    {item.desc}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Optional user prompt & run button */}
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={userInstruction}
              onChange={(e) => setUserInstruction(e.target.value)}
              placeholder={t('copilot_instruction_placeholder', "Consigne spécifique (optionnel, ex: 'utiliser async/await', 'ajouter types stricts')...")}
              className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-zinc-700 bg-zinc-900/80 text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-sky-500"
            />
            <button
              type="button"
              disabled={isRunning}
              onClick={handleExecute}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-50"
            >
              {isRunning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              <span>{isRunning ? t('generating', 'Génération...') : t('generate_transformation', 'Générer la transformation')}</span>
            </button>
          </div>
        </div>

        {/* Center Monaco Diff Viewport or Original View */}
        <div className="flex-1 relative bg-zinc-950 min-h-0 flex flex-col">
          {resultCode !== null ? (
            <>
              {/* Diff Controls Header */}
              <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/80 bg-zinc-950/60 text-xs text-zinc-400 shrink-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-emerald-400">{t('diff_preview_title', 'Prévisualisation des changements :')}</span>
                  <span className="text-[11px] text-zinc-500">{t('diff_preview_sub', 'Original (gauche) vs Code Généré (droite)')}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSplitView(!isSplitView)}
                    className="px-2 py-0.5 rounded text-[11px] border border-zinc-700 hover:bg-zinc-800 text-zinc-300 cursor-pointer"
                  >
                    {isSplitView ? t('split_view', 'Vue Côte-à-côte') : t('unified_view', 'Vue Unifiée')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setResultCode(null)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{t('reset', 'Réinitialiser')}</span>
                  </button>
                </div>
              </div>

              {/* Monaco Diff Editor */}
              <div className="flex-1 relative min-h-0">
                <DiffEditor
                  height="100%"
                  language={language}
                  theme={theme}
                  original={code}
                  modified={resultCode}
                  options={{
                    renderSideBySide: isSplitView,
                    readOnly: true,
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
                    automaticLayout: true,
                    wordWrap: 'on',
                    minimap: { enabled: false }
                  }}
                />
              </div>

              {/* Explanation Banner */}
              {explanation && (
                <div className="px-4 py-2 bg-emerald-500/10 border-t border-emerald-500/20 text-xs text-emerald-300 flex items-center gap-2 shrink-0">
                  <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span className="truncate">{explanation}</span>
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-500 space-y-2">
              <FileCode className="w-10 h-10 text-zinc-600 mb-1" />
              <p className="text-sm font-medium text-zinc-300">
                {t('copilot_ready_title', 'Prêt pour la transformation avec Gemini Flash')}
              </p>
              <p className="text-xs text-zinc-500 max-w-md">
                {t('copilot_ready_desc', 'Choisissez une action ci-dessus (Refactoriser, Générer Types, Documenter ou Tests) puis cliquez sur « Générer la transformation ».')}
              </p>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-950 select-none shrink-0">
          <div className="text-[11px] text-zinc-500">
            {resultCode !== null ? t('copilot_inspect_hint', 'Inspectez les lignes vertes/rouges avant de valider') : t('copilot_ready_hint', 'Code prêt pour analyse')}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-xl border border-zinc-700 text-xs text-zinc-300 hover:bg-zinc-800 transition-colors cursor-pointer"
            >
              {t('cancel', 'Annuler')}
            </button>
            <button
              type="button"
              disabled={resultCode === null}
              onClick={handleApplyChanges}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-all cursor-pointer shadow-sm disabled:opacity-40"
            >
              <Check className="w-3.5 h-3.5" />
              <span>{t('apply_in_editor', "Appliquer dans l'éditeur")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
