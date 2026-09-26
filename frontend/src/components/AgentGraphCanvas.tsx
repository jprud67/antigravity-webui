import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  Bot, 
  Cpu, 
  Terminal, 
  Activity, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  GitBranch, 
  ShieldCheck, 
  Code2, 
  TestTube2, 
  Compass, 
  Flame
} from 'lucide-react';
import type { AgentNode, AgentEdge, AgentNodeRole, AgentNodeStatus } from '../types';
import { useI18n } from '../services/i18n';

interface AgentGraphCanvasProps {
  nodes: AgentNode[];
  edges: AgentEdge[];
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
  orientation?: 'vertical' | 'horizontal';
}

interface LayoutNode {
  node: AgentNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

const NODE_WIDTH = 280;
const NODE_HEIGHT = 140;

const getRoleIcon = (role: AgentNodeRole) => {
  switch (role) {
    case 'architect':
      return <ShieldCheck className="w-4 h-4 text-purple-400" />;
    case 'coder':
      return <Code2 className="w-4 h-4 text-blue-400" />;
    case 'tester':
      return <TestTube2 className="w-4 h-4 text-emerald-400" />;
    case 'reviewer':
      return <Flame className="w-4 h-4 text-amber-400" />;
    case 'explorer':
      return <Compass className="w-4 h-4 text-cyan-400" />;
    case 'root':
      return <Cpu className="w-4 h-4 text-indigo-400" />;
    default:
      return <Bot className="w-4 h-4 text-zinc-400" />;
  }
};

const getStatusBadge = (status: AgentNodeStatus, t: (key: string, fb: string) => string) => {
  switch (status) {
    case 'running':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          {t('orchestrator_status_running', 'En cours')}
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20">
          <CheckCircle2 className="w-3 h-3 text-blue-400" />
          {t('orchestrator_status_completed', 'Terminé')}
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-400 border border-red-500/20">
          <AlertCircle className="w-3 h-3 text-red-400" />
          {t('orchestrator_status_failed', 'Échec')}
        </span>
      );
    case 'cancelled':
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-400 border border-amber-500/20">
          <Clock className="w-3 h-3 text-amber-400" />
          {t('orchestrator_status_cancelled', 'Annulé')}
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">
          <Clock className="w-3 h-3 text-zinc-400" />
          {t('orchestrator_status_pending', 'En attente')}
        </span>
      );
  }
};

export const AgentGraphCanvas: React.FC<AgentGraphCanvasProps> = ({
  nodes,
  edges,
  selectedNodeId,
  onSelectNode,
  orientation = 'vertical',
}) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Calculate hierarchical layout positions
  const layoutNodes = useMemo<Map<string, LayoutNode>>(() => {
    const map = new Map<string, LayoutNode>();
    if (!nodes.length) return map;

    // Group nodes by depth
    const depthGroups: Map<number, AgentNode[]> = new Map();
    nodes.forEach((n) => {
      const d = n.depth || 0;
      if (!depthGroups.has(d)) depthGroups.set(d, []);
      depthGroups.get(d)!.push(n);
    });

    const isVert = orientation === 'vertical';
    const xGap = 60;
    const yGap = 90;

    depthGroups.forEach((groupNodes, depth) => {
      const count = groupNodes.length;
      groupNodes.forEach((node, index) => {
        let x = 0;
        let y = 0;

        if (isVert) {
          const totalWidth = count * NODE_WIDTH + (count - 1) * xGap;
          const startX = -totalWidth / 2 + NODE_WIDTH / 2;
          x = startX + index * (NODE_WIDTH + xGap);
          y = depth * (NODE_HEIGHT + yGap) + 60;
        } else {
          const totalHeight = count * NODE_HEIGHT + (count - 1) * yGap;
          const startY = -totalHeight / 2 + NODE_HEIGHT / 2;
          x = depth * (NODE_WIDTH + xGap) + 60;
          y = startY + index * (NODE_HEIGHT + yGap);
        }

        map.set(node.id, {
          node,
          x,
          y,
          width: NODE_WIDTH,
          height: NODE_HEIGHT,
        });
      });
    });

    return map;
  }, [nodes, orientation]);

  // Center the view on initial load or orientation change
  const handleResetView = useCallback(() => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setZoom(0.95);
    setPan({ x: rect.width / 2, y: 80 });
  }, []);

  useEffect(() => {
    handleResetView();
  }, [handleResetView, orientation]);

  // Pointer interactions for Pan & Drag
  const handlePointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.agent-node-card')) {
      return;
    }
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
    setZoom((prev) => Math.min(2.0, Math.max(0.4, prev * zoomFactor)));
  };

  const isVert = orientation === 'vertical';

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-zinc-950 select-none cursor-grab active:cursor-grabbing border border-zinc-800/60 rounded-xl"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onWheel={handleWheel}
    >
      {/* Background Dot Grid */}
      <div 
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, #52525b 1px, transparent 0)',
          backgroundSize: '24px 24px',
          backgroundPosition: `${pan.x}px ${pan.y}px`,
        }}
      />

      {/* Floating Canvas Controls */}
      <div className="absolute top-4 left-4 z-20 flex items-center gap-1.5 p-1.5 rounded-lg bg-zinc-900/90 backdrop-blur-md border border-zinc-700/60 shadow-xl">
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(2.0, z + 0.15))}
          title={t('orchestrator_zoom_in', 'Zoom avant')}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(0.4, z - 0.15))}
          title={t('orchestrator_zoom_out', 'Zoom arrière')}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>
        <button
          type="button"
          onClick={handleResetView}
          title={t('orchestrator_reset_view', 'Recentrer la vue')}
          className="p-1.5 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <div className="h-4 w-px bg-zinc-700/50 mx-0.5" />
        <span className="px-2 text-xs font-mono text-zinc-400 font-medium">
          {Math.round(zoom * 100)}%
        </span>
      </div>

      {/* Scalable & Pannable Viewport */}
      <div
        className="absolute inset-0 origin-top-left transition-transform duration-75"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
        }}
      >
        {/* SVG Connector Layer */}
        <svg className="absolute overflow-visible pointer-events-none inset-0">
          <defs>
            <linearGradient id="edge-gradient-active" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#06b6d4" />
            </linearGradient>
            <linearGradient id="edge-gradient-default" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#52525b" />
              <stop offset="100%" stopColor="#3f3f46" />
            </linearGradient>
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {edges.map((edge) => {
            const source = layoutNodes.get(edge.source);
            const target = layoutNodes.get(edge.target);
            if (!source || !target) return null;

            let x1: number;
            let y1: number;
            let x2: number;
            let y2: number;
            let pathD: string;

            if (isVert) {
              x1 = source.x;
              y1 = source.y + source.height / 2;
              x2 = target.x;
              y2 = target.y - target.height / 2;
              const deltaY = (y2 - y1) * 0.5;
              pathD = `M ${x1} ${y1} C ${x1} ${y1 + deltaY}, ${x2} ${y2 - deltaY}, ${x2} ${y2}`;
            } else {
              x1 = source.x + source.width / 2;
              y1 = source.y;
              x2 = target.x - target.width / 2;
              y2 = target.y;
              const deltaX = (x2 - x1) * 0.5;
              pathD = `M ${x1} ${y1} C ${x1 + deltaX} ${y1}, ${x2 - deltaX} ${y2}, ${x2} ${y2}`;
            }

            const isHighlighted = selectedNodeId === edge.source || selectedNodeId === edge.target;
            const isChildRunning = target.node.status === 'running';

            return (
              <g key={`${edge.source}-${edge.target}`}>
                {/* Glow underlay if active or selected */}
                {(isHighlighted || isChildRunning) && (
                  <path
                    d={pathD}
                    fill="none"
                    stroke={isChildRunning ? '#06b6d4' : '#3b82f6'}
                    strokeWidth={4}
                    strokeOpacity={0.4}
                    filter="url(#edge-glow)"
                  />
                )}
                {/* Main Curve */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={isHighlighted || isChildRunning ? 'url(#edge-gradient-active)' : 'url(#edge-gradient-default)'}
                  strokeWidth={isHighlighted ? 2.5 : 1.75}
                  strokeDasharray={isChildRunning ? '6,4' : undefined}
                  className={isChildRunning ? 'animate-[dash_1s_linear_infinite]' : ''}
                />
              </g>
            );
          })}
        </svg>

        {/* HTML Node Cards Layer */}
        {Array.from(layoutNodes.values()).map(({ node, x, y, width, height }) => {
          const isSelected = selectedNodeId === node.id;
          const isRunning = node.status === 'running';

          return (
            <div
              key={node.id}
              onClick={(e) => {
                e.stopPropagation();
                onSelectNode(node.id);
              }}
              style={{
                width: `${width}px`,
                height: `${height}px`,
                transform: `translate(${x - width / 2}px, ${y - height / 2}px)`,
              }}
              className={`agent-node-card absolute p-3.5 rounded-xl border backdrop-blur-md cursor-pointer transition-all duration-200 select-none shadow-lg ${
                isSelected
                  ? 'bg-zinc-900/95 border-cyan-500/80 shadow-cyan-500/20 ring-2 ring-cyan-500/30'
                  : isRunning
                  ? 'bg-zinc-900/90 border-emerald-500/40 shadow-emerald-500/10 hover:border-emerald-500/60'
                  : 'bg-zinc-900/80 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/90'
              }`}
            >
              {/* Header: Role Icon, Name, and Status */}
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1 rounded bg-zinc-800/80 border border-zinc-700/60 shrink-0">
                    {getRoleIcon(node.role)}
                  </div>
                  <span className="font-semibold text-xs text-zinc-100 truncate">
                    {node.name}
                  </span>
                </div>
                {getStatusBadge(node.status, t)}
              </div>

              {/* Task Summary */}
              <p className="text-[11px] text-zinc-400 line-clamp-2 mb-2.5 h-8">
                {node.task_summary || t('orchestrator_root_agent', 'Agent Principal')}
              </p>

              {/* Footer: Activity & Tool Metrics */}
              <div className="flex items-center justify-between text-[11px] text-zinc-500 pt-2 border-t border-zinc-800/80">
                <div className="flex items-center gap-1.5 truncate max-w-[170px]">
                  {isRunning ? (
                    <>
                      <Activity className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
                      <span className="truncate text-cyan-300 font-mono text-[10px]">
                        {node.current_activity || 'Processing...'}
                      </span>
                    </>
                  ) : node.worktree_branch ? (
                    <>
                      <GitBranch className="w-3 h-3 text-zinc-400 shrink-0" />
                      <span className="truncate text-zinc-400 text-[10px]">
                        {node.worktree_branch}
                      </span>
                    </>
                  ) : (
                    <span className="text-[10px] text-zinc-500">
                      {t('orchestrator_depth_label', 'Niveau')} {node.depth}
                    </span>
                  )}
                </div>

                <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                  {node.metrics.tool_call_count > 0 ? (
                    <span className="inline-flex items-center gap-1">
                      <Terminal className="w-2.5 h-2.5 text-zinc-500" />
                      {node.metrics.tool_call_count}
                    </span>
                  ) : (
                    node.model || 'Gemini'
                  )}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
