import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  X, 
  RotateCcw, 
  Download, 
  Bot, 
  Columns, 
  Rows, 
  Loader2, 
  Network
} from 'lucide-react';
import type { OrchestratorGraphResponse, AgentNode } from '../types';
import { fetchOrchestratorGraph, steerSubagent, terminateSubagent } from '../services/api';
import { AgentGraphCanvas } from './AgentGraphCanvas';
import { AgentInspectionDrawer } from './AgentInspectionDrawer';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';

interface AgentOrchestrationModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string | null;
}

export const AgentOrchestrationModal: React.FC<AgentOrchestrationModalProps> = ({
  isOpen,
  onClose,
  conversationId,
}) => {
  const { t } = useI18n();

  const [graphData, setGraphData] = useState<OrchestratorGraphResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [orientation, setOrientation] = useState<'vertical' | 'horizontal'>('vertical');
  const [filterStatus, setFilterStatus] = useState<'all' | 'running' | 'completed' | 'failed'>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Load graph data
  const loadGraph = useCallback(async (isPolling = false) => {
    if (!conversationId) return;
    if (!isPolling) setLoading(true);
    try {
      const data = await fetchOrchestratorGraph(conversationId);
      setGraphData(data);
    } catch (e: any) {
      if (!isPolling) {
        showToast(e?.message || 'Erreur lors du chargement du graphe', 'error');
      }
    } finally {
      if (!isPolling) setLoading(false);
    }
  }, [conversationId]);

  // Initial load when modal opens
  useEffect(() => {
    if (isOpen && conversationId) {
      loadGraph();
      // Set root node selected by default if available
      const timer = setTimeout(() => {
        loadGraph(false);
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setGraphData(null);
      setSelectedNodeId(null);
    }
  }, [isOpen, conversationId, loadGraph]);

  // Auto-refresh polling every 3.5 seconds when open
  useEffect(() => {
    if (!isOpen || !conversationId) return;
    const interval = setInterval(() => {
      loadGraph(true);
    }, 3500);
    return () => clearInterval(interval);
  }, [isOpen, conversationId, loadGraph]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Filter nodes based on active filter
  const filteredNodes = useMemo<AgentNode[]>(() => {
    if (!graphData?.nodes) return [];
    if (filterStatus === 'all') return graphData.nodes;
    return graphData.nodes.filter((n) => {
      if (n.role === 'root') return true; // always show root node
      if (filterStatus === 'running') return n.status === 'running';
      if (filterStatus === 'completed') return n.status === 'completed';
      if (filterStatus === 'failed') return n.status === 'failed' || n.status === 'cancelled';
      return true;
    });
  }, [graphData, filterStatus]);

  // Selected agent node
  const selectedNode = useMemo<AgentNode | null>(() => {
    if (!selectedNodeId || !graphData?.nodes) return null;
    return graphData.nodes.find((n) => n.id === selectedNodeId) || null;
  }, [selectedNodeId, graphData]);

  // Steering handler
  const handleSteer = async (instruction: string) => {
    if (!conversationId || !selectedNodeId) return;
    await steerSubagent(conversationId, selectedNodeId, instruction);
    loadGraph(true);
  };

  // Terminate handler
  const handleTerminate = async (recursive: boolean) => {
    if (!conversationId || !selectedNodeId) return;
    await terminateSubagent(conversationId, selectedNodeId, recursive);
    loadGraph(true);
  };

  // Export to Mermaid
  const handleExportMermaid = () => {
    if (!graphData?.nodes || !graphData?.edges) return;
    let mermaid = 'graph TD\n';
    graphData.nodes.forEach((n) => {
      const cleanLabel = n.name.replace(/["\n]/g, ' ');
      mermaid += `  ${n.id}["${cleanLabel} (${n.status})"]\n`;
    });
    graphData.edges.forEach((e) => {
      mermaid += `  ${e.source} --> ${e.target}\n`;
    });

    const blob = new Blob([mermaid], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orchestration-graph-${conversationId || 'export'}.mmd`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Diagramme Mermaid exporté avec succès', 'success');
  };

  // Export to JSON
  const handleExportJson = () => {
    if (!graphData) return;
    const blob = new Blob([JSON.stringify(graphData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orchestration-graph-${conversationId || 'export'}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Données JSON exportées avec succès', 'success');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-3 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full h-[92vh] max-w-7xl bg-zinc-900 border border-zinc-800 rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        {/* Top Studio Header & Toolbar */}
        <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-4 bg-zinc-950/70 backdrop-blur-md shrink-0">
          {/* Title & Active Badge */}
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Network className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-base text-zinc-100">
                  {t('orchestrator_title', "Studio d'Orchestration Multi-Agents")}
                </h2>
                {graphData && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    {graphData.active_count} {t('orchestrator_active_badge', 'actifs')} / {graphData.total_count} {t('orchestrator_total_badge', 'total')}
                  </span>
                )}
              </div>
              <p className="text-xs text-zinc-400 hidden sm:block">
                {t('orchestrator_desc', "Visualisation en direct du graphe d'exécution et pilotage hiérarchique")}
              </p>
            </div>
          </div>

          {/* Controls: Orientation, Filters, Refresh, Export, Close */}
          <div className="flex items-center gap-2">
            {/* Orientation Toggle */}
            <div className="hidden md:flex items-center rounded-lg bg-zinc-800/80 p-0.5 border border-zinc-700/60">
              <button
                type="button"
                onClick={() => setOrientation('vertical')}
                title={t('orchestrator_layout_vertical', 'Vertical (Haut-Bas)')}
                className={`p-1.5 rounded-md transition-colors ${
                  orientation === 'vertical'
                    ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Rows className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setOrientation('horizontal')}
                title={t('orchestrator_layout_horizontal', 'Horizontal (Gauche-Droite)')}
                className={`p-1.5 rounded-md transition-colors ${
                  orientation === 'horizontal'
                    ? 'bg-zinc-700 text-zinc-100 shadow-sm'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                <Columns className="w-4 h-4" />
              </button>
            </div>

            {/* Filter Toggle */}
            <div className="hidden lg:flex items-center rounded-lg bg-zinc-800/80 p-0.5 border border-zinc-700/60 text-xs">
              <button
                type="button"
                onClick={() => setFilterStatus('all')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  filterStatus === 'all'
                    ? 'bg-zinc-700 text-zinc-100 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('orchestrator_filter_all', 'Tous')}
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('running')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  filterStatus === 'running'
                    ? 'bg-zinc-700 text-emerald-400 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('orchestrator_filter_running', 'En cours')}
              </button>
              <button
                type="button"
                onClick={() => setFilterStatus('completed')}
                className={`px-2.5 py-1 rounded-md transition-colors ${
                  filterStatus === 'completed'
                    ? 'bg-zinc-700 text-blue-400 font-medium'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t('orchestrator_filter_completed', 'Terminés')}
              </button>
            </div>

            {/* Refresh */}
            <button
              type="button"
              onClick={() => loadGraph(false)}
              disabled={loading}
              title={t('orchestrator_refresh', 'Actualiser le graphe')}
              className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
            >
              <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin text-cyan-400' : ''}`} />
            </button>

            {/* Export Menu */}
            <div className="flex items-center rounded-lg bg-zinc-800/80 border border-zinc-700/60 p-0.5">
              <button
                type="button"
                onClick={handleExportMermaid}
                title={t('orchestrator_export_mermaid', 'Exporter Mermaid')}
                className="px-2 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors flex items-center gap-1"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Mermaid</span>
              </button>
              <button
                type="button"
                onClick={handleExportJson}
                title={t('orchestrator_export_json', 'Exporter JSON')}
                className="px-2 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 rounded transition-colors"
              >
                JSON
              </button>
            </div>

            {/* Close */}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-zinc-800/80 border border-zinc-700/60 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Main Body: Graph Canvas + Inspection Drawer */}
        <div className="flex-1 relative flex overflow-hidden">
          {loading && !graphData ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
              <span className="text-sm font-medium">Chargement du graphe d'orchestration...</span>
            </div>
          ) : graphData && graphData.nodes.length > 0 ? (
            <>
              {/* Interactive Nodal Canvas */}
              <div className="flex-1 h-full relative">
                <AgentGraphCanvas
                  nodes={filteredNodes}
                  edges={graphData.edges}
                  selectedNodeId={selectedNodeId}
                  onSelectNode={(id) => setSelectedNodeId(id)}
                  orientation={orientation}
                />
              </div>

              {/* Side Inspection Drawer */}
              {selectedNode && (
                <AgentInspectionDrawer
                  agentNode={selectedNode}
                  conversationId={conversationId || ''}
                  onClose={() => setSelectedNodeId(null)}
                  onSteer={handleSteer}
                  onTerminate={handleTerminate}
                />
              )}
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-zinc-400 gap-3">
              <Bot className="w-12 h-12 text-zinc-600" />
              <p className="text-sm font-medium text-zinc-300">
                {t('orchestrator_no_agents', 'Aucun sous-agent dans cette session pour le moment')}
              </p>
              <p className="text-xs text-zinc-500 max-w-md">
                Les sous-agents créés via les compétences ou commandes parallèles apparaîtront automatiquement dans ce graphe interactif.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
