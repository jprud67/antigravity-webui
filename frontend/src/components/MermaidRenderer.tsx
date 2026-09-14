import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
        const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          themeVariables: isDark ? {
            darkMode: true,
            background: '#090d1a',
            primaryColor: '#0284c7',
            primaryTextColor: '#f8fafc',
            primaryBorderColor: '#38bdf8',
            lineColor: '#64748b',
            secondaryColor: '#3b82f6',
            tertiaryColor: '#1e293b',
          } : {
            darkMode: false,
            background: '#ffffff',
            primaryColor: '#0284c7',
            primaryTextColor: '#0f172a',
            primaryBorderColor: '#0284c7',
            lineColor: '#94a3b8',
            secondaryColor: '#e0f2fe',
            tertiaryColor: '#f1f5f9',
          },
          securityLevel: 'strict',
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

  const copyChartCode = async () => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(chart);
      } else {
        const ta = document.createElement('textarea');
        ta.value = chart;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {}
  };

  if (error) {
    return (
      <div
        className="my-3 p-4 rounded-xl text-xs border"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold font-mono text-[11px]" style={{ color: 'var(--accent)' }}>Diagramme Mermaid (Source)</span>
          <button
            onClick={copyChartCode}
            className="text-[10px] flex items-center gap-1 cursor-pointer"
            style={{ color: 'var(--muted)' }}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>Copier la source</span>
          </button>
        </div>
        <pre
          className="font-mono p-3 rounded-lg border text-[10px] overflow-x-auto"
          style={{
            backgroundColor: 'var(--code-bg)',
            borderColor: 'var(--border-subtle)',
            color: 'var(--code-text)'
          }}
        >
          {chart}
        </pre>
      </div>
    );
  }

  const renderContent = (fullscreen: boolean) => (
    <div
      className={`rounded-2xl overflow-hidden transition-all shadow-lg border ${
        fullscreen
          ? 'fixed inset-4 z-[9999] flex flex-col backdrop-blur-xl shadow-2xl'
          : 'my-3'
      }`}
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)'
      }}
    >
      {/* Header toolbar */}
      <div
        className="px-4 py-2 border-b flex items-center justify-between text-xs shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-2">
          <Eye className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold text-[11px]" style={{ color: 'var(--strong)' }}>Diagramme Architecture / Flux</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={copyChartCode}
            className="px-2 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié' : 'Source'}</span>
          </button>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 rounded cursor-pointer transition-colors border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--muted)'
            }}
            title={fullscreen ? 'Réduire' : 'Plein écran'}
          >
            {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* SVG Canvas */}
      <div
        ref={containerRef}
        className={`p-6 flex items-center justify-center overflow-auto ${
          fullscreen ? 'flex-1' : 'max-h-[500px]'
        }`}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );

  return (
    <>
      {!isExpanded ? (
        renderContent(false)
      ) : (
        <>
          <div
            className="my-3 h-24 rounded-2xl border border-dashed flex items-center justify-center text-xs opacity-50 font-mono"
            style={{ borderColor: 'var(--border)' }}
          >
            Diagramme affiché en plein écran
          </div>
          {typeof document !== 'undefined' && createPortal(renderContent(true), document.body)}
        </>
      )}
    </>
  );
};
