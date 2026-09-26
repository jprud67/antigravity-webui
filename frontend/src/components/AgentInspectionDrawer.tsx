import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Send, 
  Square, 
  GitFork, 
  Cpu, 
  Terminal, 
  FileCode2, 
  BrainCircuit, 
  Loader2, 
  GitBranch, 
  Sparkles 
} from 'lucide-react';
import type { AgentNode, AgentInspectionDetails } from '../types';
import { fetchAgentInspectionDetails } from '../services/api';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';

interface AgentInspectionDrawerProps {
  agentNode: AgentNode | null;
  conversationId: string;
  onClose: () => void;
  onSteer: (instruction: string) => Promise<void>;
  onTerminate: (recursive: boolean) => Promise<void>;
}

export const AgentInspectionDrawer: React.FC<AgentInspectionDrawerProps> = ({
  agentNode,
  conversationId,
  onClose,
  onSteer,
  onTerminate,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'telemetry' | 'tools' | 'diff'>('telemetry');
  const [details, setDetails] = useState<AgentInspectionDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [steeringText, setSteeringText] = useState('');
  const [sendingSteer, setSendingSteer] = useState(false);
  const [terminating, setTerminating] = useState(false);

  // Load inspection details
  const loadDetails = useCallback(async (nodeId: string) => {
    setLoading(true);
    try {
      const data = await fetchAgentInspectionDetails(nodeId, conversationId);
      setDetails(data);
    } catch {
      // Non-blocking fallback to node props
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (agentNode) {
      loadDetails(agentNode.id);
    } else {
      setDetails(null);
    }
  }, [agentNode, loadDetails]);

  if (!agentNode) return null;

  const handleSendSteering = async () => {
    if (!steeringText.trim() || sendingSteer) return;
    setSendingSteer(true);
    try {
      await onSteer(steeringText.trim());
      setSteeringText('');
      showToast(t('orchestrator_steer_success', 'Consigne de guidage transmise avec succès'), 'success');
    } catch (e: any) {
      showToast(e?.message || "Erreur lors de l'envoi de la consigne", 'error');
    } finally {
      setSendingSteer(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSendSteering();
    }
  };

  const handleTerminateAction = async (recursive: boolean) => {
    const confirmMsg = recursive
      ? t('orchestrator_terminate_cascade_confirm', 'Attention : cette action va arrêter cet agent et tous ses enfants. Continuer ?')
      : t('orchestrator_terminate_confirm', 'Voulez-vous vraiment arrêter cet agent ?');

    if (!window.confirm(confirmMsg)) return;

    setTerminating(true);
    try {
      await onTerminate(recursive);
      showToast(t('orchestrator_terminate_success', 'Agent arrêté avec succès'), 'success');
    } catch (e: any) {
      showToast(e?.message || "Erreur lors de l'arrêt de l'agent", 'error');
    } finally {
      setTerminating(false);
    }
  };

  const isRunning = agentNode.status === 'running';

  return (
    <div className="w-[420px] h-full bg-zinc-900 border-l border-zinc-800 flex flex-col shadow-2xl z-30 shrink-0">
      {/* Drawer Header */}
      <div className="p-4 border-b border-zinc-800 flex items-start justify-between gap-3 bg-zinc-900/90 backdrop-blur-md">
        <div className="min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="p-1 rounded bg-zinc-800 border border-zinc-700 text-cyan-400">
              <Cpu className="w-4 h-4" />
            </span>
            <h3 className="font-semibold text-sm text-zinc-100 truncate">
              {agentNode.name}
            </h3>
          </div>
          <p className="text-xs text-zinc-400 font-mono truncate">
            ID: {agentNode.id}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center border-b border-zinc-800 px-4 gap-4 bg-zinc-950/40 text-xs font-medium">
        <button
          type="button"
          onClick={() => setActiveTab('telemetry')}
          className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
            activeTab === 'telemetry'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <BrainCircuit className="w-3.5 h-3.5" />
          {t('orchestrator_tab_telemetry', 'Télémétrie & Pensée')}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tools')}
          className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
            activeTab === 'tools'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
          {t('orchestrator_tab_tools', 'Outils')}
          {agentNode.metrics.tool_call_count > 0 && (
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-zinc-800 text-zinc-300">
              {agentNode.metrics.tool_call_count}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('diff')}
          className={`py-2.5 border-b-2 flex items-center gap-1.5 transition-colors ${
            activeTab === 'diff'
              ? 'border-cyan-500 text-cyan-400'
              : 'border-transparent text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <FileCode2 className="w-3.5 h-3.5" />
          {t('orchestrator_tab_diff', 'Fichiers')}
        </button>
      </div>

      {/* Drawer Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-2">
            <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
            <span className="text-xs">Chargement des données...</span>
          </div>
        ) : activeTab === 'telemetry' ? (
          <div className="space-y-4 text-xs">
            {/* System Info Bento */}
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
                <span className="text-zinc-500 block mb-1">Rôle & Modèle</span>
                <span className="font-semibold text-zinc-200 capitalize">
                  {agentNode.role} ({agentNode.model || 'Gemini'})
                </span>
              </div>
              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80">
                <span className="text-zinc-500 block mb-1">Niveau Hiérarchique</span>
                <span className="font-semibold text-zinc-200">
                  {t('orchestrator_depth_label', 'Niveau')} {agentNode.depth}
                </span>
              </div>
            </div>

            {agentNode.worktree_branch && (
              <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <GitBranch className="w-4 h-4 text-emerald-400" />
                  <div>
                    <span className="text-zinc-500 block text-[10px]">Worktree Git</span>
                    <span className="font-mono text-zinc-300">{agentNode.worktree_branch}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Thought Stream */}
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-zinc-300 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                <span>{t('orchestrator_thought_stream', "Flux de réflexion de l'agent")}</span>
              </div>
              <div className="p-3 rounded-lg bg-zinc-950 border border-zinc-800/80 text-zinc-300 font-mono text-[11px] leading-relaxed max-h-56 overflow-y-auto whitespace-pre-wrap">
                {details?.thought_preview || agentNode.thought_preview || t('orchestrator_thought_empty', 'Aucun flux de pensée récent')}
              </div>
            </div>
          </div>
        ) : activeTab === 'tools' ? (
          <div className="space-y-2.5">
            {details?.tools && details.tools.length > 0 ? (
              details.tools.map((tItem, idx) => (
                <div
                  key={tItem.id || idx}
                  className="p-3 rounded-lg bg-zinc-950/70 border border-zinc-800/80 text-xs space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-cyan-400 font-mono">
                      {tItem.name}
                    </span>
                    <span className="text-[10px] text-zinc-500">Étape #{tItem.step}</span>
                  </div>
                  {tItem.args && Object.keys(tItem.args).length > 0 && (
                    <pre className="p-2 rounded bg-zinc-900 text-[10px] text-zinc-400 overflow-x-auto">
                      {JSON.stringify(tItem.args, null, 2)}
                    </pre>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500 text-center py-10">
                {t('orchestrator_tools_empty', 'Aucun outil invoqué pour le moment')}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {details?.modified_files && details.modified_files.length > 0 ? (
              details.modified_files.map((f) => (
                <div
                  key={f.path}
                  className="p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800 flex items-center justify-between text-xs"
                >
                  <span className="font-mono text-zinc-300 truncate max-w-[280px]">
                    {f.path}
                  </span>
                  <span className="text-[10px] text-emerald-400 font-mono">
                    +{f.additions || 0} -{f.deletions || 0}
                  </span>
                </div>
              ))
            ) : (
              <p className="text-xs text-zinc-500 text-center py-10">
                {t('orchestrator_diff_empty', 'Aucun fichier modifié dans le worktree')}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Steering & Action Deck (Fixed Bottom) */}
      <div className="p-4 border-t border-zinc-800 bg-zinc-950/80 space-y-3">
        {/* Priority Steering Input */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-zinc-400 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-cyan-400" />
              {t('orchestrator_steer_title', 'Guidage Prioritaire (Steering)')}
            </span>
            <span className="text-[10px] text-zinc-500">Ctrl+Entrée</span>
          </label>
          <div className="relative">
            <textarea
              value={steeringText}
              onChange={(e) => setSteeringText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={!isRunning || sendingSteer}
              placeholder={
                isRunning
                  ? t('orchestrator_steer_placeholder', 'Écrire une consigne prioritaire pour réorienter cet agent...')
                  : 'Agent inactif (guidage désactivé)'
              }
              rows={2}
              className="w-full resize-none p-2.5 text-xs rounded-lg bg-zinc-900 border border-zinc-700/80 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-cyan-500/80 disabled:opacity-50 disabled:cursor-not-allowed pr-10"
            />
            <button
              type="button"
              onClick={handleSendSteering}
              disabled={!steeringText.trim() || !isRunning || sendingSteer}
              className="absolute right-2 bottom-2.5 p-1.5 rounded-md bg-cyan-600 hover:bg-cyan-500 text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title={t('orchestrator_steer_button', 'Envoyer consigne')}
            >
              {sendingSteer ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Termination Actions */}
        {isRunning && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              type="button"
              onClick={() => handleTerminateAction(false)}
              disabled={terminating}
              className="py-2 px-3 rounded-lg border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <Square className="w-3.5 h-3.5" />
              {t('orchestrator_terminate_single', 'Arrêter cet agent')}
            </button>
            <button
              type="button"
              onClick={() => handleTerminateAction(true)}
              disabled={terminating}
              className="py-2 px-3 rounded-lg border border-red-600/40 bg-red-600/15 hover:bg-red-600/25 text-red-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
            >
              <GitFork className="w-3.5 h-3.5" />
              {t('orchestrator_terminate_cascade', 'Arrêter la branche')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
