import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2, Copy, Check, Eye } from 'lucide-react';

interface MermaidRendererProps {
  chart: string;
}

export const MermaidRenderer: React.FC<MermaidRendererProps> = ({ chart }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;

    const renderChart = async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#090d1a',
            primaryColor: '#0284c7',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#38bdf8',
            lineColor: '#64748b',
            secondaryColor: '#3b82f6',
            tertiaryColor: '#1e293b',
          },
          securityLevel: 'loose',
          fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        });

        const id = `mermaid-${Math.random().toString(36).substring(2, 9)}`;
        const { svg } = await mermaid.render(id, chart.trim());
        if (isMounted) {
          setSvgContent(svg);
          setError(null);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Erreur de rendu Mermaid');
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  const copyChartCode = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="my-3 p-4 bg-[#0a0f1e] border border-amber-500/30 rounded-xl text-xs">
        <div className="flex items-center justify-between mb-2">
          <span className="text-amber-400 font-semibold font-mono text-[11px]">Diagramme Mermaid</span>
          <button
            onClick={copyChartCode}
            className="text-[10px] text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>Copier la source</span>
          </button>
        </div>
        <pre className="font-mono bg-[#050811] p-3 rounded-lg border border-slate-800 text-slate-300 text-[10px] overflow-x-auto">
          {chart}
        </pre>
      </div>
    );
  }

  return (
    <div
      className={`my-3 bg-[#070b16] border border-sky-500/20 rounded-2xl overflow-hidden transition-all shadow-lg ${
        isExpanded ? 'fixed inset-4 z-50 flex flex-col bg-[#070b16]/98 backdrop-blur-xl border-sky-500/50' : ''
      }`}
    >
      {/* Header toolbar */}
      <div className="px-4 py-2 bg-[#0c1222] border-b border-slate-800 flex items-center justify-between text-xs shrink-0">
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-slate-200 text-[11px]">Diagramme Architecture / Flux</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyChartCode}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié' : 'Source'}</span>
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer transition-colors"
            title={isExpanded ? 'Réduire' : 'Plein écran'}
          >
            {isExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        ref={containerRef}
        className={`p-6 flex items-center justify-center overflow-auto ${
          isExpanded ? 'flex-1' : 'max-h-[500px]'
        }`}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
};
