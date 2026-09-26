import { useI18n } from '../services/i18n';
import React, { useEffect, useRef, useState } from 'react';
import { 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  ExternalLink, 
  Copy, 
  Check, 
  Code, 
  Eye, 
  Layers
} from 'lucide-react';
import { canvasApi } from '../services/api';
import type { CanvasDocumentManifest } from '../types';

interface CanvasViewerProps {
  document?: CanvasDocumentManifest;
  docId?: string;
  srcDoc?: string;
  title?: string;
  initialHeight?: number;
  allowFullscreen?: boolean;
  className?: string;
}

export const CanvasViewer: React.FC<CanvasViewerProps> = ({
  document: propDoc,
  docId,
  srcDoc,
  title,
  initialHeight = 450,
  allowFullscreen = true,
  className = '',
}) => {
  const { t } = useI18n();
  const [doc, setDoc] = useState<CanvasDocumentManifest | undefined>(propDoc);
  const [height, setHeight] = useState<number>(propDoc?.preferredHeight || initialHeight);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [viewSource, setViewSource] = useState(false);
  const [sourceCode, setSourceCode] = useState<string>('');
  const [refreshKey, setRefreshKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const activeDoc = propDoc || doc;
  const effectiveId = activeDoc?.id || docId;
  const effectiveTitle = title || activeDoc?.title || 'Canvas Widget';

  // Load document metadata if docId provided without full manifest
  useEffect(() => {
    if (docId && !propDoc) {
      canvasApi.getDocument(docId).then(setDoc).catch((err) => {
        console.error('Failed to load canvas document:', err);
      });
    }
  }, [docId, propDoc]);

  // Determine iframe source URL
  const iframeSrc = effectiveId 
    ? canvasApi.getServeUrl(effectiveId, activeDoc?.localEntrypoint || 'index.html') 
    : undefined;

  // Listen to height and theme message events from sandboxed iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'canvas:resize' && typeof event.data.height === 'number') {
        const measured = Math.max(180, Math.min(event.data.height, 1200));
        setHeight(measured);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Synchronize theme tokens to iframe via theme bridge
  useEffect(() => {
    const isDark = document.documentElement.classList.contains('dark') || 
                   window.matchMedia('(prefers-color-scheme: dark)').matches;

    const postTheme = () => {
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage({
          type: 'canvas:theme',
          theme: isDark ? 'dark' : 'light',
          tokens: isDark ? {
            '--surface': '#0e1015',
            '--card': '#161920',
            '--elevated': '#191c24',
            '--text': '#d4d4d8',
            '--accent': '#818cf8',
          } : {
            '--surface': '#faf9f7',
            '--card': '#ffffff',
            '--elevated': '#ffffff',
            '--text': '#403c35',
            '--accent': '#6366f1',
          }
        }, '*');
      }
    };

    const timer = setTimeout(postTheme, 150);
    return () => clearTimeout(timer);
  }, [refreshKey, isFullscreen]);

  const handleCopyLink = () => {
    if (iframeSrc) {
      const fullUrl = `${window.location.origin}${iframeSrc}`;
      navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleOpenNewTab = () => {
    if (iframeSrc) {
      window.open(iframeSrc, '_blank', 'noopener,noreferrer');
    }
  };

  const handleToggleSource = async () => {
    if (!viewSource && !sourceCode) {
      if (srcDoc) {
        setSourceCode(srcDoc);
      } else if (iframeSrc) {
        try {
          const res = await fetch(iframeSrc);
          const txt = await res.text();
          setSourceCode(txt);
        } catch {
          setSourceCode('Unable to load source code.');
        }
      }
    }
    setViewSource(!viewSource);
  };

  return (
    <div
      className={`border border-border/80 rounded-xl overflow-hidden bg-card/90 shadow-sm transition-all duration-200 ${
        isFullscreen
          ? 'fixed inset-4 z-50 flex flex-col shadow-2xl bg-card border-accent/40'
          : className
      }`}
    >
      {/* Canvas Header / Controls */}
      <div className="flex items-center justify-between px-3.5 py-2.5 bg-muted/40 border-b border-border/60 text-xs text-muted-foreground select-none">
        <div className="flex items-center gap-2 font-medium text-foreground">
          <Layers className="w-3.5 h-3.5 text-accent" />
          <span className="truncate max-w-[200px] sm:max-w-xs">{effectiveTitle}</span>
          {activeDoc?.kind && (
            <span className="px-1.5 py-0.5 rounded text-[10px] bg-accent/10 text-accent font-mono uppercase tracking-wider">
              {activeDoc.kind.replace('_', ' ')}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setRefreshKey((k) => k + 1)}
            title={t('refresh', 'Rafraîchir')}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleToggleSource}
            title={viewSource ? 'Voir le rendu' : 'Voir le code HTML'}
            className={`p-1 rounded transition-colors ${
              viewSource ? 'bg-accent/20 text-accent font-semibold' : 'hover:bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            {viewSource ? <Eye className="w-3.5 h-3.5" /> : <Code className="w-3.5 h-3.5" />}
          </button>

          {iframeSrc && (
            <>
              <button
                onClick={handleCopyLink}
                title={t('copy_link', 'Copier le lien')}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={handleOpenNewTab}
                title={t('open_in_new_tab', 'Ouvrir dans un nouvel onglet')}
                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </>
          )}

          {allowFullscreen && (
            <button
              onClick={() => setIsFullscreen(!isFullscreen)}
              title={isFullscreen ? 'Réduire' : 'Plein écran'}
              className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            >
              {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {/* Main Content: Iframe or Source View */}
      <div 
        className="relative w-full overflow-hidden bg-background/50"
        style={{ height: isFullscreen ? 'calc(100% - 37px)' : `${height}px` }}
      >
        {viewSource ? (
          <pre className="h-full w-full overflow-auto p-4 text-xs font-mono bg-neutral-950 text-neutral-200 select-text">
            <code>{sourceCode || 'Chargement du code source...'}</code>
          </pre>
        ) : (
          <iframe
            key={refreshKey}
            ref={iframeRef}
            src={srcDoc ? undefined : iframeSrc}
            srcDoc={srcDoc}
            title={effectiveTitle}
            className="w-full h-full border-0 bg-transparent block"
            sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
            loading="lazy"
          />
        )}
      </div>
    </div>
  );
};

export default CanvasViewer;
