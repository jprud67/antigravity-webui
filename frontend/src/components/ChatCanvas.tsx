import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { PreBlock, CodeOrInlineBlock } from './AdaptiveCodeBlock';
import { extractRawText } from '../utils/codeBlockUtils';

import { 
  ChevronDown, 
  ChevronUp, 
  BrainCircuit, 
  Check, 
  Copy, 
  Terminal, 
  Zap, 
  Compass, 
  FileCheck, 
  Cpu,
  FileText,
  FileCode,
  GitBranch,
  PanelRight,
  Download,
  Edit3,
  Clock,
  Code2,
  Search,
  BarChart3,
  Volume2,
  VolumeX,
  Info,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  ExternalLink,
  User,
  Menu,
  Plus,
  RotateCcw,
  X,
  Bookmark
} from 'lucide-react';
import type { ChatMessage, ToolCallItem, BookmarkItem, MonacoStudioConfig, ProgressCardData } from '../types';
import { InteractiveQuestion } from './InteractiveQuestion';
import { DiffViewer } from './DiffViewer';
import { ApprovalCard } from './ApprovalCard';
import { TranscriptSearchOverlay } from './TranscriptSearchOverlay';
import { ProgressCardWidget } from './ProgressCardWidget';
import { getAuthToken } from '../services/api';
import { AntigravityIcon } from './AntigravityLogo';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';
import { showToast } from '../services/toast';

interface ChatCanvasProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  conversationId?: string | null;
  conversationTitle?: string;
  activeModel?: string;
  activeEffort?: string;
  project?: string;
  projectColor?: string;
  tags?: string[];
  parentConversationId?: string | null;
  onQuickPrompt?: (prompt: string) => void;
  onAnswerQuestion?: (answer: string) => void;
  onOpenFiles?: () => void;
  onOpenTasks?: () => void;
  onOpenArtifacts?: () => void;
  onOpenTerminal?: () => void;
  onOpenGit?: () => void;
  onOpenKanban?: () => void;
  onOpenCrons?: () => void;
  onOpenRules?: () => void;
  onOpenAnalytics?: () => void;
  onOpenBranchTree?: () => void;
  bookmarks?: BookmarkItem[];
  onAddBookmark?: (stepIndex: number, label: string, preview?: string) => void;
  onRemoveBookmark?: (bookmarkId: string) => void;
  isRightPanelOpen?: boolean;
  activeRightPanelTab?: string;
  onToggleRightPanel?: () => void;
  onToggleMobileSidebar?: () => void;
  onNewConversation?: () => void;
  pendingApproval?: { toolName: string; command?: string; path?: string } | null;
  onApprovalResolved?: () => void;
  onForkMessage?: (stepIndex: number) => void;
  onEditSessionMeta?: () => void;
  onRetry?: () => void;
  loopWarning?: { errorCount: number; message: string } | null;
  onDismissLoopWarning?: () => void;
  onStopStreaming?: () => void;
  onOpenMonacoStudio?: (config: MonacoStudioConfig) => void;
  progressCard?: ProgressCardData | null;
  onDismissProgressCard?: () => void;
}

const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {
    console.warn('Clipboard writeText error', e);
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'absolute';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    console.warn('Clipboard execCommand error', e);
    return false;
  }
};


/**
 * GitHub-style Callout & Alert Banner Component ([!NOTE], [!TIP], etc.)
 */
const CalloutBlock = ({ children }: any) => {
  const { t } = useI18n();
  let calloutType: 'note' | 'tip' | 'important' | 'warning' | 'caution' | null = null;
  let otherChildren = children;

  if (Array.isArray(children) && children.length > 0) {
    const firstP = children[0];
    if (firstP?.props?.children) {
      const pChildren = Array.isArray(firstP.props.children)
        ? firstP.props.children
        : [firstP.props.children];
      const firstStr = typeof pChildren[0] === 'string' ? pChildren[0] : '';
      const match = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(.*)$/i.exec(firstStr);
      if (match) {
        calloutType = match[1].toLowerCase() as any;
        const remainingText = match[2];
        const newPChildren = remainingText ? [remainingText, ...pChildren.slice(1)] : pChildren.slice(1);
        otherChildren = [
          React.cloneElement(firstP, {}, newPChildren),
          ...children.slice(1)
        ];
      }
    }
  }

  if (calloutType) {
    const configs = {
      note: { title: t('callout_note', 'Note'), icon: Info, className: 'markdown-callout-note' },
      tip: { title: t('callout_tip', 'Tip'), icon: Lightbulb, className: 'markdown-callout-tip' },
      important: { title: t('callout_important', 'Important'), icon: AlertCircle, className: 'markdown-callout-important' },
      warning: { title: t('callout_warning', 'Warning'), icon: AlertTriangle, className: 'markdown-callout-warning' },
      caution: { title: t('callout_caution', 'Caution'), icon: ShieldAlert, className: 'markdown-callout-caution' },
    };

    const cfg = configs[calloutType];
    const IconComp = cfg.icon;

    return (
      <div className={`markdown-callout ${cfg.className}`}>
        <div className="callout-header">
          <IconComp className="w-4 h-4 shrink-0" />
          <span>{cfg.title}</span>
        </div>
        <div className="callout-content text-xs leading-relaxed">
          {otherChildren}
        </div>
      </div>
    );
  }

  return <blockquote>{children}</blockquote>;
};

/**
 * Clickable Interactive File Link or External URL
 */
const LinkBlock = ({ href, children, onOpenFile, onOpenArtifacts, ...props }: any) => {
  const { t } = useI18n();
  if (href && (href.startsWith('file://') || href.startsWith('workspace://'))) {
    let cleanHref = href;
    if (href.startsWith('workspace://')) {
      cleanHref = href.replace(/^workspace:\/\//, '');
      if (!cleanHref.startsWith('/')) cleanHref = '/' + cleanHref;
      cleanHref = 'file://' + cleanHref;
    }
    const filePath = cleanHref.replace(/^file:\/\/\/?/, '/');
    let cleanPath = filePath;
    let anchor: string | undefined;
    const hashIdx = filePath.indexOf('#');
    if (hashIdx !== -1) {
      anchor = filePath.substring(hashIdx + 1);
      cleanPath = filePath.substring(0, hashIdx);
    }
    try {
      cleanPath = decodeURIComponent(cleanPath);
    } catch {
      // Keep original if URI decoding fails
    }
    cleanPath = cleanPath.replace(/^\/+([a-zA-Z]:)/, '$1');
    const filename = cleanPath.split(/[/\\]/).pop() || cleanPath;
    const rawLabel = extractRawText(children).trim();
    const displayLabel = rawLabel && rawLabel !== href ? rawLabel : filename;
    const normalizedSlashPath = cleanPath.replace(/\\/g, '/');
    const isArtifact = normalizedSlashPath.includes('/brain/') && cleanPath.endsWith('.md');

    const token = getAuthToken();
    const downloadUrl = `/api/files/download?path=${encodeURIComponent(cleanPath)}${token ? `&token=${encodeURIComponent(token)}` : ''}`;

    const handleDownload = (e: React.MouseEvent) => {
      e.stopPropagation();
      showToast(t('download_started', 'Download of "{0}" started').replace('{0}', filename), 'info');
    };

    if (isArtifact) {
      return (
        <span
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (onOpenArtifacts) onOpenArtifacts();
            else if (onOpenFile) onOpenFile();
            else copyTextToClipboard(cleanPath);
          }}
          className="my-3 p-3.5 rounded-xl border flex items-center justify-between gap-3 cursor-pointer shadow-sm transition-all group block text-left hover:shadow-md"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--accent)';
            e.currentTarget.style.backgroundColor = 'var(--accent-bg)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border)';
            e.currentTarget.style.backgroundColor = 'var(--surface-subtle)';
          }}
          title={t('markdown_artifact_click', 'Markdown Artifact: {0} — Click to open').replace('{0}', cleanPath)}
        >
          <span className="flex items-center gap-3 min-w-0">
            <span
              className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border shadow-sm"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent-bg-strong)',
              }}
            >
              <FileText className="w-4.5 h-4.5" style={{ color: 'var(--accent)' }} />
            </span>
            <span className="min-w-0">
              <span
                className="text-[10px] uppercase font-mono font-bold tracking-wider block"
                style={{ color: 'var(--accent)' }}
              >
                {t("generated_artifact", "Generated artifact")}
              </span>
              <span
                className="text-[13px] font-semibold truncate block group-hover:opacity-90 transition-colors"
                style={{ color: 'var(--strong)' }}
              >
                {displayLabel}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-2 shrink-0">
            <a
              href={downloadUrl}
              download={filename}
              onClick={handleDownload}
              title={t("download_file", "Download \"{0}\"").replace("{0}", filename)}
              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-all cursor-pointer hover:scale-105 no-underline"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--accent-text)',
              }}
            >
              <Download className="w-3 h-3" />
              <span>{t('download', 'Download')}</span>
            </a>
            <span
              className="flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-lg border transition-colors"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent-bg-strong)',
                color: 'var(--accent-text)',
              }}
            >
              <span>{t('open', 'Open')}</span>
              <ExternalLink className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
            </span>
          </span>
        </span>
      );
    }

    const handleOpenFileInPanel = (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      window.dispatchEvent(new CustomEvent('open-workspace-file', { detail: { path: cleanPath } }));
      if (onOpenFile) onOpenFile();
    };

    return (
      <div
        role="button"
        tabIndex={0}
        onClick={handleOpenFileInPanel}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            handleOpenFileInPanel(e as any);
          }
        }}
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono text-[12.5px] cursor-pointer border transition-all my-1.5 shadow-sm hover:shadow-md group/file select-none"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)',
          color: 'var(--accent-text)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'var(--accent)';
          e.currentTarget.style.backgroundColor = 'var(--accent-bg)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--border)';
          e.currentTarget.style.backgroundColor = 'var(--surface-subtle)';
        }}
        title={t("open_side_panel", "Ouvrir dans l'éditeur : {0}").replace("{0}", filename)}
      >
        <span
          className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 border"
          style={{
            backgroundColor: 'var(--accent-bg)',
            borderColor: 'var(--accent-bg-strong)',
          }}
        >
          <FileCode className="w-3 h-3" style={{ color: 'var(--accent)' }} />
        </span>
        <span className="font-semibold underline decoration-dotted underline-offset-2 truncate max-w-[280px]">
          {displayLabel}
        </span>
        {anchor && (
          <span
            className="text-[10px] font-medium px-1.5 py-0.5 rounded-md border shrink-0"
            style={{
              backgroundColor: 'var(--accent-bg)',
              borderColor: 'var(--accent-bg-strong)',
              color: 'var(--accent-text)',
            }}
          >
            {anchor}
          </span>
        )}
        <span
          className="text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0 uppercase tracking-wide flex items-center gap-1 shadow-xs"
          style={{
            backgroundColor: 'var(--accent-bg)',
            borderColor: 'var(--accent)',
            color: 'var(--accent-text)',
          }}
        >
          <span>{t('open', 'Ouvrir')}</span>
          <ExternalLink className="w-2.5 h-2.5" />
        </span>
        <a
          href={downloadUrl}
          download={filename}
          onClick={handleDownload}
          title={t("download_file", "Télécharger \"{0}\"").replace("{0}", filename)}
          className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 transition-colors ml-0.5 opacity-50 hover:opacity-100 shrink-0 text-slate-400 hover:text-slate-100"
        >
          <Download className="w-3.5 h-3.5" />
        </a>
      </div>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sky-500 dark:text-sky-400 hover:underline font-medium break-all inline-flex items-center gap-0.5"
      {...props}
    >
      <span>{children}</span>
      <ExternalLink className="w-2.5 h-2.5 opacity-60 inline" />
    </a>
  );
};

/**
 * Shared Markdown rendering components configuration using AdaptiveCodeBlock
 */
const createMarkdownComponents = (
  onOpenFile?: () => void,
  onOpenArtifacts?: () => void,
  onOpenTerminal?: () => void,
  onOpenMonacoStudio?: (config: MonacoStudioConfig) => void
) => ({
  pre: PreBlock,
  code: (props: any) => (
    <CodeOrInlineBlock
      {...props}
      onOpenFile={onOpenFile}
      onOpenTerminal={onOpenTerminal}
      onOpenMonacoStudio={onOpenMonacoStudio}
    />
  ),
  blockquote: CalloutBlock,
  a: (props: any) => (
    <LinkBlock
      {...props}
      onOpenFile={onOpenFile}
      onOpenArtifacts={onOpenArtifacts}
    />
  ),
  table: ({ children }: any) => (
    <div className="overflow-x-auto rounded-xl border my-4" style={{ borderColor: 'var(--border)' }}>
      <table>{children}</table>
    </div>
  ),
  img: ({ src, alt, ...rest }: any) => (
    <img src={src} alt={alt || ''} loading="lazy" {...rest} />
  ),
});

// Stable plugin array — avoids re-parsing markdown on every streaming re-render
const REMARK_PLUGINS = [remarkGfm];

/**
 * Memoized markdown renderer: only re-parses markdown when its own text changes.
 * This keeps token-by-token streaming fast on long conversations (unchanged
 * messages are not re-rendered at all).
 */
const MarkdownContent = React.memo(
  function MarkdownContent({ content, components }: { content: string; components: any }) {
    return (
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </ReactMarkdown>
    );
  },
  (prev, next) => prev.content === next.content && prev.components === next.components
);

/**
 * Specialized Micro-Card for single tool execution
 */
const formatToolResult = (result: any): string => {
  if (typeof result === 'string') return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
};

const ToolItemCard: React.FC<{ tool: ToolCallItem }> = ({ tool }) => {
  const { t } = useI18n();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  const isCommand = tool.name === 'run_command';
  const isDiff = tool.name === 'replace_file_content';
  const isFile = ['view_file', 'write_to_file', 'list_dir', 'find_by_name', 'grep_search'].includes(tool.name);

  const handleCopyResult = async () => {
    const text = formatToolResult(tool.result);
    await copyTextToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isDiff && tool.args) {
    let diffArgs = tool.args;
    if (typeof diffArgs === 'string') {
      try {
        diffArgs = JSON.parse(diffArgs);
      } catch {}
    }
    if (diffArgs && typeof diffArgs === 'object') {
      const targetStr = String(diffArgs.TargetContent ?? '');
      const replacementStr = String(diffArgs.ReplacementContent ?? '');
      const diffSnippet = `--- ${diffArgs.TargetFile || 'original'}\n+++ ${diffArgs.TargetFile || 'modifié'}\n@@ -${diffArgs.StartLine || 1} +${diffArgs.StartLine || 1} @@\n${targetStr.split('\n').map((l: string) => '-' + l).join('\n')}\n${replacementStr.split('\n').map((l: string) => '+' + l).join('\n')}`;
      return (
        <DiffViewer
          filename={diffArgs.TargetFile}
          title={`Édition : ${diffArgs.Instruction || diffArgs.Description || diffArgs.TargetFile || ''}`}
          diffText={diffSnippet}
        />
      );
    }
  }

  return (
    <div
      className="p-2.5 rounded-xl border flex flex-col gap-1.5 transition-all text-xs"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between gap-2 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {isCommand ? (
            <Terminal className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          ) : isFile ? (
            <FileText className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          )}

          <div className="flex items-center gap-1.5 min-w-0 flex-1 font-mono text-[11px]">
            <span className="font-semibold text-strong">{tool.name}</span>
            {isCommand && tool.args?.CommandLine && (
              <span className="truncate opacity-85 px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-border-subtle">
                $ {tool.args.CommandLine}
              </span>
            )}
            {!isCommand && (tool.args?.TargetFile || tool.args?.AbsolutePath || tool.args?.SearchPath) && (
              <span className="truncate opacity-85">
                {tool.args.TargetFile || tool.args.AbsolutePath || tool.args.SearchPath}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span
            className={`text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border ${
              tool.status === 'running'
                ? 'bg-amber-500/10 text-amber-500 border-amber-500/20'
                : tool.status === 'error'
                ? 'bg-rose-500/10 text-rose-500 border-rose-500/20'
                : tool.status === 'cancelled'
                ? 'bg-neutral-500/10 text-neutral-400 border-neutral-500/20'
                : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            }`}
          >
            {tool.status === 'running' ? t('status_running', 'Running...') : tool.status === 'error' ? t('status_error', 'Error') : tool.status === 'cancelled' ? t('status_cancelled', 'Cancelled') : t('status_done', 'Done')}
          </span>

          {tool.result && (
            <button
              type="button"
              onClick={() => setOpenDrawer(!openDrawer)}
              className="px-2 py-0.5 rounded text-[10px] font-medium border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              {openDrawer ? t('close', 'Close') : t('output', 'Output')}
            </button>
          )}
        </div>
      </div>

      {openDrawer && tool.result && (
        <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-2.5 py-1 bg-surface-subtle border-b text-[10px] text-muted">
            <span>{t("execution_output", "Execution output")}</span>
            <button
              type="button"
              onClick={handleCopyResult}
              className="flex items-center gap-1 hover:text-strong cursor-pointer"
            >
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copied ? t('copied', 'Copied') : t('copy', 'Copy')}</span>
            </button>
          </div>
          <pre className="p-2.5 text-[10.5px] font-mono leading-relaxed overflow-x-auto max-h-56 bg-code-bg text-pre-text">
            {formatToolResult(tool.result)}
          </pre>
        </div>
      )}
    </div>
  );
};

/**
 * Grouped Activity Feed / Accordion for tools
 */
const ToolActivityFeed: React.FC<{
  toolCalls: ToolCallItem[];
  msgId: string;
  isExpanded: boolean;
  onToggle: () => void;
  onAnswerQuestion?: (answer: string) => void;
  onQuickPrompt?: (prompt: string) => void;
}> = ({ toolCalls, isExpanded, onToggle, onAnswerQuestion, onQuickPrompt }) => {
  const { t } = useI18n();
  const [showAllTools, setShowAllTools] = useState(false);
  const interactiveTools = useMemo(() => toolCalls.filter(
    (t) => t.name === 'ask_question' || t.name === 'ask_permission' || t.name === 'ask_custom_permission'
  ), [toolCalls]);

  const actionTools = useMemo(() => toolCalls.filter(
    (t) => t.name !== 'ask_question' && t.name !== 'ask_permission' && t.name !== 'ask_custom_permission'
  ), [toolCalls]);

  const { summary, hasRunning } = useMemo(() => {
    const cmdCount = actionTools.filter((t) => t.name === 'run_command').length;
    const fileReadCount = actionTools.filter((t) => ['view_file', 'read_url_content', 'list_dir', 'grep_search', 'find_by_name'].includes(t.name)).length;
    const fileWriteCount = actionTools.filter((t) => ['replace_file_content', 'write_to_file'].includes(t.name)).length;

    const parts = [];
    if (cmdCount > 0) parts.push(`${cmdCount} commande${cmdCount > 1 ? 's' : ''}`);
    if (fileWriteCount > 0) parts.push(`${fileWriteCount} modification${fileWriteCount > 1 ? 's' : ''}`);
    if (fileReadCount > 0) parts.push(`${fileReadCount} consultation${fileReadCount > 1 ? 's' : ''}`);

    const s = parts.length > 0
      ? parts.join(', ')
      : `${actionTools.length} action${actionTools.length > 1 ? 's' : ''}`;

    return {
      summary: s,
      hasRunning: actionTools.some((t) => t.status === 'running')
    };
  }, [actionTools]);

  const visibleTools = showAllTools || actionTools.length <= 8
    ? actionTools
    : actionTools.slice(actionTools.length - 8);

  return (
    <div className="w-full space-y-2 mb-3">
      {interactiveTools.map((tool, idx) => {
        if (tool.name === 'ask_question') {
          return (
            <InteractiveQuestion
              key={`iq-${idx}`}
              toolArgs={tool.args}
              onAnswer={(ans) => {
                if (onAnswerQuestion) onAnswerQuestion(ans);
                else onQuickPrompt?.(ans);
              }}
            />
          );
        }
        if (tool.name === 'ask_permission' || tool.name === 'ask_custom_permission') {
          return (
            <ApprovalCard
              key={`ap-${idx}`}
              toolName={tool.args?.tool_name || tool.args?.permission || tool.name}
              command={tool.args?.command || tool.args?.CommandLine}
              path={tool.args?.path || tool.args?.TargetFile}
            />
          );
        }
        return null;
      })}

      {actionTools.length > 0 && (
        <div
          className="rounded-xl border overflow-hidden shadow-xs transition-all"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <button
            type="button"
            onClick={onToggle}
            className="w-full px-3.5 py-2.5 flex items-center justify-between text-xs transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-5 h-5 rounded-md bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Zap className={`w-3 h-3 text-amber-500 ${hasRunning ? 'animate-bounce' : ''}`} />
              </div>
              <span className="font-semibold text-xs truncate" style={{ color: 'var(--strong)' }}>
                {t("agent_activity_summary", "Agent activity ({0})").replace("{0}", summary)}
              </span>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-medium shrink-0"
                style={{
                  backgroundColor: hasRunning ? 'rgba(245, 158, 11, 0.15)' : 'var(--accent-bg)',
                  color: hasRunning ? '#F59E0B' : 'var(--accent)',
                }}
              >
                {hasRunning ? t('status_running', 'Running...') : t('status_done', 'Done')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 text-muted text-[11px]">
              <span>{isExpanded ? t('hide', 'Hide') : t('details', 'Details')}</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {isExpanded && (
            <div className="p-3 border-t space-y-2 text-xs" style={{ borderColor: 'var(--border)' }}>
              {actionTools.length > 8 && !showAllTools && (
                <button
                  type="button"
                  onClick={() => setShowAllTools(true)}
                  className="w-full py-1.5 px-3 rounded-lg text-[11px] font-medium border text-center transition-colors cursor-pointer border-dashed"
                  style={{ borderColor: 'var(--border)', color: 'var(--accent)' }}
                >
                  {t("show_previous_actions", "Show previous {0} actions...").replace("{0}", String(actionTools.length - 8))}
                </button>
              )}

              <div className="space-y-2 max-h-96 overflow-y-auto pr-1 scrollbar-thin">
                {visibleTools.map((tool, idx) => (
                  <ToolItemCard key={idx} tool={tool} />
                ))}
              </div>

              {actionTools.length > 8 && showAllTools && (
                <button
                  type="button"
                  onClick={() => setShowAllTools(false)}
                  className="w-full py-1 px-3 text-[10px] opacity-70 hover:opacity-100 text-center cursor-pointer"
                  style={{ color: 'var(--muted)' }}
                >
                  {t("collapse_see_last", "Collapse (see last {0} only)").replace("{0}", "8")}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * Checkpoint Divider in timeline
 */
const CheckpointDivider: React.FC<{ content: string; stepIndex?: number }> = ({ content, stepIndex }) => {
  const { t } = useI18n();

  const [isOpen, setIsOpen] = useState(false);
  return (
    <div className="my-6 max-w-4xl mx-auto w-full flex flex-col items-center">
      <div className="w-full flex items-center gap-3">
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="px-3 py-1 rounded-full text-[11px] font-mono border flex items-center gap-1.5 transition-all cursor-pointer hover:border-sky-500/50"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--muted)',
          }}
        >
          <Clock className="w-3 h-3 text-amber-500" />
          <span>{t("checkpoint_context", "Checkpoint & context")} {stepIndex !== undefined ? `#${stepIndex}` : ''}</span>
          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
        <div className="flex-1 h-px" style={{ backgroundColor: 'var(--border)' }} />
      </div>

      {isOpen && (
        <div
          className="mt-2.5 p-3.5 rounded-xl border text-xs max-w-2xl w-full text-muted leading-relaxed font-mono shadow-xs animate-fadeIn"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)'
          }}
        >
          <p className="whitespace-pre-wrap">{content}</p>
        </div>
      )}
    </div>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = React.memo(({
  messages,
  isStreaming,
  conversationId,
  conversationTitle,
  activeModel,
  activeEffort,
  project,
  projectColor,
  tags,
  parentConversationId,
  onQuickPrompt,
  onAnswerQuestion,
  onOpenTerminal,
  onOpenGit: _onOpenGit,
  onOpenKanban: _onOpenKanban,
  onOpenCrons: _onOpenCrons,
  onOpenRules: _onOpenRules,
  onOpenAnalytics,
  onOpenBranchTree: _onOpenBranchTree,
  bookmarks,
  onAddBookmark,
  onRemoveBookmark,
  onOpenFiles,
  onOpenArtifacts,
  isRightPanelOpen,
  onToggleRightPanel,
  onToggleMobileSidebar,
  onNewConversation,
  pendingApproval,
  onApprovalResolved,
  onForkMessage,
  onEditSessionMeta,
  onRetry,
  loopWarning,
  onDismissLoopWarning,
  onStopStreaming,
  onOpenMonacoStudio,
  progressCard,
  onDismissProgressCard,
}) => {
  const { lang, t } = useI18n();
  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Search matching message IDs
  const matchingMessageIds = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    const matched: string[] = [];
    messages.forEach((msg, idx) => {
      const id = msg.id || String(idx);
      const toolText = msg.toolCalls?.map((tc: any) => `${tc.displayName || ''} ${tc.output || ''}`).join(' ') || '';
      const haystack = `${msg.content || ''} ${msg.thought || ''} ${toolText}`.toLowerCase();
      if (haystack.includes(q)) {
        matched.push(id);
      }
    });
    return matched;
  }, [messages, searchQuery]);

  const activeMatchedMessageId = useMemo(() => {
    if (matchingMessageIds.length === 0) return null;
    const safeIdx = Math.min(Math.max(0, currentMatchIndex), matchingMessageIds.length - 1);
    return matchingMessageIds[safeIdx];
  }, [matchingMessageIds, currentMatchIndex]);

  const scrollToMatchedMessage = (messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const handleSearchPrev = () => {
    if (matchingMessageIds.length === 0) return;
    const nextIdx = (currentMatchIndex - 1 + matchingMessageIds.length) % matchingMessageIds.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatchedMessage(matchingMessageIds[nextIdx]);
  };

  const handleSearchNext = () => {
    if (matchingMessageIds.length === 0) return;
    const nextIdx = (currentMatchIndex + 1) % matchingMessageIds.length;
    setCurrentMatchIndex(nextIdx);
    scrollToMatchedMessage(matchingMessageIds[nextIdx]);
  };

  const handleQueryChange = (q: string) => {
    setSearchQuery(q);
    setCurrentMatchIndex(0);
    if (q.trim()) {
      const lowerQ = q.toLowerCase();
      const firstMatch = messages.find((msg) => {
        const toolText = msg.toolCalls?.map((tc: any) => `${tc.displayName || ''} ${tc.output || ''}`).join(' ') || '';
        const haystack = `${msg.content || ''} ${msg.thought || ''} ${toolText}`.toLowerCase();
        return haystack.includes(lowerQ);
      });
      const firstId = firstMatch?.id || (firstMatch ? String(messages.indexOf(firstMatch)) : null);
      if (firstId) {
        scrollToMatchedMessage(firstId);
      }
    }
  };

  const handleToggleSearch = useCallback(() => {
    setIsSearchOpen((prev) => {
      const next = !prev;
      if (next && matchingMessageIds.length > 0) {
        const safeIdx = Math.min(Math.max(0, currentMatchIndex), matchingMessageIds.length - 1);
        scrollToMatchedMessage(matchingMessageIds[safeIdx]);
      }
      return next;
    });
  }, [matchingMessageIds, currentMatchIndex]);

  // Global Ctrl+F / Cmd+F and custom event to open/toggle search overlay
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
    };
    const handleCustomSearch = () => {
      handleToggleSearch();
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    window.addEventListener('antigravity:toggle-chat-search', handleCustomSearch);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      window.removeEventListener('antigravity:toggle-chat-search', handleCustomSearch);
    };
  }, [handleToggleSearch]);

  const handleCopyMessage = async (id: string, text: string) => {
    await copyTextToClipboard(text);
    setCopiedMsgId(id);
    setTimeout(() => setCopiedMsgId(null), 2000);
  };

  const markdownComponents = useMemo(
    () => createMarkdownComponents(onOpenFiles, onOpenArtifacts, onOpenTerminal, onOpenMonacoStudio),
    [onOpenFiles, onOpenArtifacts, onOpenTerminal, onOpenMonacoStudio]
  );

  // Index of the last assistant message — computed once per render instead of per message
  const lastAssistantIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return i;
    }
    return -1;
  }, [messages]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 150;
  };

  useEffect(() => {
    if (userScrolledUpRef.current) return;
    if (isStreaming && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    } else if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  // Cancel speech synthesis on conversation change, unmount, or page navigation
  useEffect(() => {
    const handleUnload = () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      activeUtteranceRef.current = null;
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      activeUtteranceRef.current = null;
      setSpeakingMsgId(null);
    };
  }, [conversationId]);

  // Cancel speech synthesis when a new streaming turn begins
  useEffect(() => {
    if (isStreaming && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      activeUtteranceRef.current = null;
    }
  }, [isStreaming]);

  const activeSpeakingMsgId = isStreaming ? null : speakingMsgId;

  const toggleThought = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTools = (id: string) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleSpeech = (msgId: string, text: string) => {
    if (!('speechSynthesis' in window)) {
      showToast(t('speech_not_supported', 'Text-to-speech is not supported by your browser.'), 'warning');
      return;
    }
    if (activeSpeakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      activeUtteranceRef.current = null;
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    activeUtteranceRef.current = null;
    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Bloc de code omis.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#*~[\]()]/g, ' ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = currentLangObj?.speech || 'fr-FR';
    utterance.rate = 1.0;
    utterance.onend = () => {
      activeUtteranceRef.current = null;
      setSpeakingMsgId(null);
    };
    utterance.onerror = () => {
      activeUtteranceRef.current = null;
      setSpeakingMsgId(null);
    };
    activeUtteranceRef.current = utterance;
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0 overflow-hidden relative"
      style={{ backgroundColor: 'var(--main-bg, var(--bg))' }}
    >
      {/* Top Bar - Responsive Workbench & Mobile First Header */}
      <div
        className="h-14 px-3 sm:px-6 flex items-center justify-between shrink-0 z-20 border-b safe-pt gap-2"
        style={{
          backgroundColor: 'var(--topbar-bg)',
          borderColor: 'var(--border)'
        }}
      >
        {/* Left Side: Mobile Menu, New Chat, Session Title */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile Hamburger Toggle Button */}
          {onToggleMobileSidebar && (
            <button
              type="button"
              onClick={onToggleMobileSidebar}
              className="p-2 -ml-1 rounded-xl border md:hidden flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-xs"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
              title={t("open_nav_menu", "Open navigation menu")}
            >
              <Menu className="w-4 h-4" />
            </button>
          )}

          {/* Mobile Fast New Chat Button */}
          {onNewConversation && (
            <button
              type="button"
              onClick={onNewConversation}
              className="p-2 rounded-xl border md:hidden flex items-center justify-center transition-all cursor-pointer shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)',
              }}
              title={t("new_session", "New session")}
            >
              <Plus className="w-4 h-4" />
            </button>
          )}

          {/* Conversation Title & Project */}
          <div className="flex items-center gap-2 min-w-0">
            {projectColor && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: projectColor }}
                title={`Projet: ${project || ''}`}
              />
            )}
            <span
              className="text-xs font-semibold truncate max-w-[140px] sm:max-w-xs block"
              style={{ color: 'var(--strong)' }}
            >
              {conversationTitle || t('new_conversation', 'New conversation')}
            </span>

            {onEditSessionMeta && conversationId && (
              <button
                type="button"
                onClick={onEditSessionMeta}
                className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer shrink-0"
                title={t("manage_meta", "Manage title and metadata")}
              >
                <Edit3 className="w-3 h-3" style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>

          {parentConversationId && (
            <div
              className="hidden sm:flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <GitBranch className="w-3 h-3" />
              <span>{t('branch', 'Branche')}</span>
            </div>
          )}

          {tags && tags.length > 0 && (
            <div className="hidden md:flex items-center gap-1 shrink-0">
              {tags.slice(0, 2).map((t) => (
                <span
                  key={t}
                  className="text-[9px] font-mono px-1.5 py-0.2 rounded-full border"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border-subtle)',
                    color: 'var(--muted)'
                  }}
                >
                  #{t}
                </span>
              ))}
            </div>
          )}

          {activeModel && (
            <div
              className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono font-medium px-2.5 py-0.5 rounded-full border shadow-sm shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <Cpu className="w-3 h-3" />
              <span>{activeModel}</span>
              {activeEffort && (
                <span
                  className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase ml-1"
                  style={{ backgroundColor: 'var(--accent-bg-strong)', color: 'var(--accent-text)' }}
                >
                  {activeEffort}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Side: Quotas, Search & Volet Latéral Toggle */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quotas Button */}
          {onOpenAnalytics && (
            <button
              type="button"
              onClick={onOpenAnalytics}
              className="py-1.5 px-2.5 rounded-xl text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title={t("analytics_dashboard", "Dashboard Quotas & Analytique (/analytics)")}
            >
              <BarChart3 className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] font-medium hidden sm:inline">{t('quotas', 'Quotas')}</span>
            </button>
          )}

          {/* Conversation Search Toggle Button */}
          <button
            type="button"
            onClick={handleToggleSearch}
            className="p-2 rounded-xl text-xs flex items-center justify-center transition-colors cursor-pointer border"
            style={{
              backgroundColor: isSearchOpen ? 'var(--accent-bg)' : 'var(--surface-subtle)',
              borderColor: isSearchOpen ? 'var(--accent)' : 'var(--border)',
              color: isSearchOpen ? 'var(--accent-text)' : 'var(--muted)',
            }}
            title={t('search_in_conversation', 'Rechercher dans la conversation (Ctrl+F)')}
          >
            <Search className="w-4 h-4" />
          </button>

          {onToggleRightPanel && (
            <button
              onClick={onToggleRightPanel}
              className="p-2 rounded-xl text-xs flex items-center justify-center transition-colors cursor-pointer border"
              style={{
                backgroundColor: isRightPanelOpen ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: isRightPanelOpen ? 'var(--accent)' : 'var(--border)',
                color: isRightPanelOpen ? 'var(--accent-text)' : 'var(--muted)'
              }}
              title={isRightPanelOpen ? t('close_side_panel', 'Fermer le volet latéral') : t('open_side_panel', 'Ouvrir le volet latéral')}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* In-Chat Transcript Search Overlay */}
      <TranscriptSearchOverlay
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        query={searchQuery}
        onQueryChange={handleQueryChange}
        matchCount={matchingMessageIds.length}
        currentMatchIndex={currentMatchIndex}
        onPrev={handleSearchPrev}
        onNext={handleSearchNext}
      />

      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-2.5 sm:px-6 py-3 sm:py-6 space-y-4 sm:space-y-6 touch-scroll"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center animate-fadeIn py-12">
            <div className="relative mb-6">
              <div
                className="w-20 h-20 rounded-3xl p-[1px] shadow-2xl flex items-center justify-center"
                style={{
                  background: 'linear-gradient(135deg, var(--accent, #FFD700), var(--blue, #4DD0E1))',
                  boxShadow: '0 8px 30px var(--focus-glow)'
                }}
              >
                <div
                  className="w-full h-full rounded-[23px] flex items-center justify-center p-3"
                  style={{ backgroundColor: 'var(--surface)' }}
                >
                  <AntigravityIcon size={46} />
                </div>
              </div>
              <div
                className="absolute -inset-2 rounded-full blur-xl -z-10 opacity-30"
                style={{ backgroundColor: 'var(--accent)' }}
              />
            </div>

            <h2 className="text-xl font-bold tracking-tight mb-2" style={{ color: 'var(--strong)' }}>
              {t('how_can_i_help', 'Que puis-je faire pour vous ?')}
            </h2>
            <p className="text-xs max-w-md leading-relaxed mb-8" style={{ color: 'var(--muted)' }}>
              {t('welcome_subtitle', 'Posez une question, lancez des commandes, explorez vos fichiers ou planifiez des tâches autonomes sans ouvrir de terminal.')}
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left">
              {[
                {
                  icon: Compass,
                  title: "/plan",
                  desc: t('plan_card_desc', "Établir un plan d'architecture par étapes"),
                  prompt: "/plan "
                },
                {
                  icon: Zap,
                  title: "/goal",
                  desc: t('goal_card_desc', "Assigner un objectif autonome approfondi"),
                  prompt: "/goal "
                },
                {
                  icon: Code2,
                  title: t('inspect_code_title', "Inspecter le Code"),
                  desc: t('inspect_code_desc', "Analyser la structure et détecter les bugs"),
                  prompt: "Analyse le projet dans le workspace actif et dresse la liste des axes d'amélioration."
                },
                {
                  icon: FileCheck,
                  title: "/status",
                  desc: t('status_card_desc', "Vérifier les services et la santé du système"),
                  prompt: "/status"
                }
              ].map((card, idx) => {
                const IconComp = card.icon;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => onQuickPrompt?.(card.prompt)}
                    className="p-4 rounded-2xl border text-left group cursor-pointer shadow-sm transition-all"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.backgroundColor = 'var(--surface-subtle-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.backgroundColor = 'var(--surface)';
                    }}
                  >
                    <div className="flex items-center gap-2.5 mb-1.5">
                      <div
                        className="w-6 h-6 rounded-lg flex items-center justify-center border"
                        style={{
                          backgroundColor: 'var(--accent-bg)',
                          borderColor: 'var(--accent)',
                          color: 'var(--accent-text)'
                        }}
                      >
                        <IconComp className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-xs transition-colors" style={{ color: 'var(--strong)' }}>
                        {card.title}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                      {card.desc}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((msg, msgIdx) => {
            const msgKey = msg.id || String(msgIdx);
            const isMatched = activeMatchedMessageId === msgKey;

            // 1. Checkpoint / System events / Task notifications
            if (msg.role === 'system') {
              if (msg.subtype === 'task') {
                return (
                  <div
                    key={msgKey}
                    id={`msg-${msgKey}`}
                    className={`my-3 max-w-4xl mx-auto w-full animate-fadeIn transition-all duration-300 ${
                      isMatched ? 'ring-2 ring-accent ring-offset-2 ring-offset-black/40 scale-[1.01]' : ''
                    }`}
                  >
                    <div
                      className="p-3 rounded-xl border text-xs flex items-center justify-between gap-3 shadow-xs"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-6 h-6 rounded-lg bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center text-emerald-500 shrink-0">
                          <Check className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0">
                          <span className="font-semibold text-xs truncate block" style={{ color: 'var(--strong)' }}>
                            {t("bg_task_completed", "Background task completed: {0}").replace("{0}", "")} <span className="font-mono text-emerald-500">{msg.taskId}</span>
                          </span>
                        </div>
                      </div>
                      <details className="text-[11px] text-muted shrink-0">
                        <summary className="cursor-pointer hover:text-strong select-none">{t("see_details", "See details")}</summary>
                        <pre
                          className="mt-2 p-2.5 rounded-lg text-[10.5px] font-mono overflow-x-auto max-h-48 border leading-relaxed"
                          style={{
                            backgroundColor: 'var(--code-bg)',
                            borderColor: 'var(--border)',
                            color: 'var(--muted)',
                          }}
                        >
                          {msg.content}
                        </pre>
                      </details>
                    </div>
                  </div>
                );
              }
              if (msg.subtype === 'context_summary') {
                return (
                  <div
                    key={msgKey}
                    id={`msg-${msgKey}`}
                    className={`my-3 max-w-4xl mx-auto w-full animate-fadeIn transition-all duration-300 ${
                      isMatched ? 'ring-2 ring-accent ring-offset-2 ring-offset-black/40 scale-[1.01]' : ''
                    }`}
                  >
                    <div
                      className="p-3.5 rounded-xl border text-xs shadow-xs"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2.5 mb-2 pb-2 border-b" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-indigo-500/15 border border-indigo-500/25 flex items-center justify-center text-indigo-400 shrink-0">
                            <BrainCircuit className="w-3.5 h-3.5" />
                          </div>
                          <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                            {t("session_continuity_summary", "Synthèse de continuité & mémoire de session")}
                          </span>
                        </div>
                        <span className="text-[10.5px] text-muted font-mono">
                          {t("context_reset", "Compteur réinitialisé • Contexte actif")}
                        </span>
                      </div>
                      <div className="text-xs text-muted leading-relaxed whitespace-pre-wrap font-sans">
                        {msg.content}
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <div
                  key={msgKey}
                  id={`msg-${msgKey}`}
                  className={`transition-all duration-300 ${
                    isMatched ? 'ring-2 ring-accent ring-offset-2 ring-offset-black/40' : ''
                  }`}
                >
                  <CheckpointDivider content={msg.content} stepIndex={msg.stepIndex} />
                </div>
              );
            }

            // 2. User Message
            if (msg.role === 'user') {
              return (
                <div
                  key={msgKey}
                  id={`msg-${msgKey}`}
                  className={`flex justify-end max-w-4xl mx-auto w-full mb-4 sm:mb-6 group animate-fadeIn transition-all duration-300 ${
                    isMatched ? 'ring-2 ring-accent ring-offset-2 ring-offset-black/40 rounded-2xl scale-[1.01]' : ''
                  }`}
                >
                  <div className="max-w-[92%] sm:max-w-[80%] hermes-user-bubble rounded-2xl rounded-tr-xs p-3 sm:p-4 shadow-sm border transition-all">
                    <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-white/10 text-xs opacity-75 select-none">
                      <div className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider">
                        <User className="w-3.5 h-3.5" />
                        <span>{t('you', 'Vous')}</span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-mono">
                        {msg.timestamp && (
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => handleCopyMessage(msg.id, msg.content)}
                          className="p-1 hover:opacity-100 opacity-60 cursor-pointer transition-opacity flex items-center gap-1"
                          title={t("copy_message", "Copy message")}
                        >
                          {copiedMsgId === msg.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                          {copiedMsgId === msg.id && <span className="text-[10px] text-emerald-400 font-sans">{t('copied', 'Copied')}</span>}
                        </button>
                      </div>
                    </div>

                    <div className="leading-relaxed markdown-content">
                      <MarkdownContent content={msg.content} components={markdownComponents} />
                    </div>
                  </div>
                </div>
              );
            }

            // 3. Assistant Message
            const isThoughtOpen = expandedThoughts[msg.id];
            const isToolsExpanded = expandedTools[msg.id] ?? (msg.isLive || false);
            const isSpeaking = activeSpeakingMsgId === msg.id;
            const msgStep = msg.stepIndex !== undefined ? msg.stepIndex : msgIdx;
            const matchingBookmark = bookmarks?.find((b) => b.step_index === msgStep);

            return (
              <div
                key={msgKey}
                id={`msg-${msgKey}`}
                className={`w-full max-w-4xl mx-auto hermes-assistant-card rounded-2xl border p-3.5 sm:p-5 shadow-xs transition-all duration-300 mb-4 sm:mb-6 group relative animate-fadeIn ${
                  isMatched ? 'ring-2 ring-accent ring-offset-2 ring-offset-black/40 scale-[1.005]' : ''
                }`}
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
              >
                {/* Assistant Role Header */}
                <div
                  className="flex items-center justify-between gap-2 mb-3 pb-2.5 border-b text-xs select-none"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-7 h-7 rounded-xl flex items-center justify-center p-1 shrink-0 border shadow-xs transition-transform group-hover:scale-105"
                      style={{
                        backgroundColor: 'var(--accent-bg)',
                        borderColor: 'var(--accent-bg-strong)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      <AntigravityIcon size={18} />
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>
                        Antigravity
                      </span>
                      {activeModel && (
                        <span
                          className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            borderColor: 'var(--border)',
                            color: 'var(--muted)',
                          }}
                        >
                          {activeModel}
                        </span>
                      )}
                      {msg.stepIndex !== undefined && (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.2 rounded border hidden sm:inline-block opacity-70"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                        >
                          #{msg.stepIndex}
                        </span>
                      )}
                      {matchingBookmark && (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border shadow-xs"
                          style={{
                            backgroundColor: 'rgba(234, 179, 8, 0.12)',
                            borderColor: 'rgba(234, 179, 8, 0.3)',
                            color: '#eab308',
                          }}
                          title={`Signet : ${matchingBookmark.label}`}
                        >
                          <Bookmark className="w-2.5 h-2.5 fill-current" />
                          <span className="max-w-[120px] truncate">{matchingBookmark.label}</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-[10.5px] font-mono text-muted">
                    {msg.timestamp && (
                      <span className="opacity-70">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    {msg.isLive && (
                      <span
                        className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border animate-pulse"
                        style={{
                          backgroundColor: 'var(--accent-bg)',
                          borderColor: 'var(--accent-bg-strong)',
                          color: 'var(--accent-text)',
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: 'var(--accent)' }} />
                        <span>{t('live', 'En direct')}</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Error Banner if turn errored */}
                {msg.error && (
                  <div className="mb-3.5 p-3.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 text-xs flex items-start gap-2.5 shadow-xs">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-500" />
                    <div className="space-y-1 flex-1 min-w-0">
                      <p className="font-bold text-xs uppercase tracking-wide">{t("api_quota_alert", "Execution Alert or API Quota")}</p>
                      <p className="font-mono text-[11.5px] whitespace-pre-wrap leading-relaxed opacity-90">{msg.error}</p>
                    </div>
                  </div>
                )}

                {/* Live Thinking Pill */}
                {msg.isLive && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div
                    className="flex items-center gap-2.5 py-2 px-3.5 rounded-xl border text-xs hermes-thinking-card animate-pulse shadow-sm my-2"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent-bg-strong)',
                      color: 'var(--accent-text)',
                    }}
                  >
                    <span className="w-2 h-2 rounded-full animate-ping shrink-0" style={{ backgroundColor: 'var(--accent)' }} />
                    <BrainCircuit className="w-3.5 h-3.5 animate-pulse" style={{ color: 'var(--accent)' }} />
                    <span className="font-medium text-[11px] tracking-wide">{t("reasoning_in_progress", "Thinking in progress...")}</span>
                  </div>
                )}

                {/* Reasoning Accordion */}
                {msg.thought && (
                  <div
                    className="w-full hermes-thinking-card overflow-hidden text-xs shadow-xs mb-3 border"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    <button
                      type="button"
                      onClick={() => toggleThought(msg.id)}
                      className="w-full flex items-center justify-between px-3.5 py-2 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="w-3.5 h-3.5 text-purple-500" />
                        <span className="font-mono text-[11.5px] font-semibold">{t("internal_reasoning", "Internal reasoning")}</span>
                        <span className="text-[10px] opacity-60 font-mono">({t("char_count", "{0} characters").replace("{0}", String(msg.thought.length))})</span>
                        {msg.isLive && !msg.content && (
                          <span className="w-1.5 h-1.5 rounded-full animate-ping ml-1" style={{ backgroundColor: 'var(--accent)' }} />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] opacity-75">
                        <span>{isThoughtOpen ? t('hide', 'Hide') : t('show', 'Show')}</span>
                        {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                    {isThoughtOpen && (
                      <div
                        className="p-3.5 border-t text-[11.5px] leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto"
                        style={{
                          backgroundColor: 'var(--code-bg)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)',
                        }}
                      >
                        {msg.thought}
                      </div>
                    )}
                  </div>
                )}

                {/* Grouped Activity Feed for Tools */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <ToolActivityFeed
                    toolCalls={msg.toolCalls}
                    msgId={msg.id}
                    isExpanded={isToolsExpanded}
                    onToggle={() => toggleTools(msg.id)}
                    onAnswerQuestion={onAnswerQuestion}
                    onQuickPrompt={onQuickPrompt}
                  />
                )}

                {/* Assistant Markdown Content */}
                {msg.content ? (
                  <div className={`hermes-assistant-body w-full markdown-content leading-relaxed${msg.isLive ? ' is-streaming' : ''}`}>
                    <MarkdownContent content={msg.content} components={markdownComponents} />
                  </div>
                ) : null}

                {/* Assistant Action Footer */}
                <div
                  className="flex items-center justify-between pt-3 mt-3 border-t text-[11px] font-mono text-muted select-none"
                  style={{ borderColor: 'var(--border-subtle)' }}
                >
                  <div className="flex items-center gap-1.5">
                    {msg.content && (
                      <button
                        type="button"
                        onClick={() => handleCopyMessage(msg.id, msg.content)}
                        className="px-2.5 py-1 rounded-md border flex items-center gap-1 hover:text-strong hover:bg-surface-subtle transition-all cursor-pointer"
                        style={{
                          borderColor: copiedMsgId === msg.id ? '#10B981' : 'var(--border)',
                          color: copiedMsgId === msg.id ? '#10B981' : undefined,
                        }}
                        title={t("copy_full_response", "Copy full response")}
                      >
                        {copiedMsgId === msg.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedMsgId === msg.id ? t('copied', 'Copied!') : t('copy', 'Copy')}</span>
                      </button>
                    )}

                    {conversationId && onForkMessage && (
                      <button
                        type="button"
                        onClick={() => onForkMessage(msg.stepIndex !== undefined ? msg.stepIndex : msgIdx)}
                        className="px-2.5 py-1 rounded-md border flex items-center gap-1 hover:text-strong hover:bg-surface-subtle transition-all cursor-pointer"
                        style={{ borderColor: 'var(--border)' }}
                        title={t("branch_from_step", "Branch from this step (create a branch)")}
                      >
                        <GitBranch className="w-3 h-3 text-fuchsia-500" />
                        <span className="hidden sm:inline">{t("fork", "Fork")}</span>
                      </button>
                    )}

                    {conversationId && onAddBookmark && (
                      <button
                        type="button"
                        onClick={() => {
                          if (matchingBookmark && onRemoveBookmark) {
                            onRemoveBookmark(matchingBookmark.id);
                          } else {
                            const label = window.prompt(t('memory_bookmark_prompt', 'Libellé du signet mémoire :'), `${t('step_hash_prefix', 'Étape #')}${msgStep}`);
                            if (label && label.trim()) {
                              onAddBookmark(msgStep, label.trim(), (msg.content || '').slice(0, 150));
                            }
                          }
                        }}
                        className={`px-2.5 py-1 rounded-md border flex items-center gap-1 hover:text-strong hover:bg-surface-subtle transition-all cursor-pointer ${
                          matchingBookmark ? 'text-amber-400 border-amber-500/30 bg-amber-500/10' : ''
                        }`}
                        style={{ borderColor: matchingBookmark ? undefined : 'var(--border)' }}
                        title={matchingBookmark ? `${t('bookmark_prefix', 'Signet :')} ${matchingBookmark.label} (${t('click_to_delete', 'cliquer pour supprimer')})` : t('add_memory_bookmark', 'Ajouter un signet mémoire')}
                      >
                        <Bookmark className={`w-3 h-3 ${matchingBookmark ? 'text-amber-400 fill-amber-400' : 'text-amber-500'}`} />
                        <span className="hidden sm:inline">{matchingBookmark ? t('marked', 'Marqué') : t('bookmark', 'Signet')}</span>
                      </button>
                    )}

                    {msg.content && (
                      <button
                        type="button"
                        onClick={() => handleToggleSpeech(msg.id, msg.content)}
                        className={`px-2.5 py-1 rounded-md border flex items-center gap-1 hover:text-strong transition-all cursor-pointer ${
                          isSpeaking ? 'text-sky-500 bg-sky-500/10 border-sky-500/30' : 'hover:bg-surface-subtle'
                        }`}
                        style={{ borderColor: isSpeaking ? undefined : 'var(--border)' }}
                        title={isSpeaking ? t('stop_tts', 'Stop text-to-speech') : t('listen_response', 'Listen to response')}
                      >
                        {isSpeaking ? <VolumeX className="w-3 h-3 text-rose-400 animate-pulse" /> : <Volume2 className="w-3 h-3" />}
                        <span className="hidden sm:inline">{isSpeaking ? t("stop", "Stop") : t("listen", "Listen")}</span>
                      </button>
                    )}

                    {onRetry && !isStreaming && (msgIdx === messages.length - 1 || msgIdx === lastAssistantIdx) && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="px-2.5 py-1 rounded-md border flex items-center gap-1 hover:text-strong hover:bg-surface-subtle transition-all cursor-pointer text-sky-500 hover:border-sky-500/40"
                        style={{ borderColor: 'var(--border)' }}
                        title={t("retry_instruction", "Relaunch last instruction (Retry)")}
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span className="hidden sm:inline">{t("retry", "Retry")}</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 opacity-70">
                    <span>~{Math.max(1, Math.round((msg.content?.length || 0) / 3.8))} tokens</span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {loopWarning && (
          <div className="max-w-4xl mx-auto my-2.5 p-3 rounded-xl border border-amber-500/40 bg-amber-950/60 backdrop-blur-md flex items-center justify-between gap-3 text-amber-200 text-xs shadow-lg animate-fadeIn">
            <div className="flex items-center gap-2.5 min-w-0">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <div>
                <div className="font-semibold text-amber-300">{t('loop_warning_banner_title', 'Boucle d\'erreurs détectée')}</div>
                <div className="text-[11px] text-amber-200/80 line-clamp-1">{loopWarning.message}</div>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {onStopStreaming && (
                <button
                  type="button"
                  onClick={() => {
                    onStopStreaming();
                    onDismissLoopWarning?.();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 font-medium text-[11px] transition-colors cursor-pointer"
                >
                  {t('btn_stop_loop', 'Stopper')}
                </button>
              )}
              {onQuickPrompt && (
                <button
                  type="button"
                  onClick={() => {
                    onQuickPrompt('/steer ');
                    onDismissLoopWarning?.();
                  }}
                  className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 border border-amber-500/40 font-medium text-[11px] transition-colors cursor-pointer"
                >
                  {t('btn_steer_loop', 'Réorienter')}
                </button>
              )}
              {onDismissLoopWarning && (
                <button
                  type="button"
                  onClick={onDismissLoopWarning}
                  className="p-1 hover:bg-white/10 rounded-lg text-amber-300/70 hover:text-amber-200 transition-colors cursor-pointer"
                  title={t('close', 'Close')}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
        {pendingApproval && (
          <div className="max-w-4xl mx-auto">
            <ApprovalCard
              toolName={pendingApproval.toolName}
              command={pendingApproval.command}
              path={pendingApproval.path}
              onResolved={onApprovalResolved}
            />
          </div>
        )}
        {progressCard && (
          <div className="max-w-4xl mx-auto">
            <ProgressCardWidget
              card={progressCard}
              onDismiss={onDismissProgressCard}
            />
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
