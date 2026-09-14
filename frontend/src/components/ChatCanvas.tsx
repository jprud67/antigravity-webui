import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import Prism from 'prismjs';

// Load Prism language components
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markdown';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-docker';

import { 
  ChevronDown, 
  ChevronUp, 
  BrainCircuit, 
  Check, 
  Copy, 
  Terminal, 
  Zap, 
  Code2, 
  Compass, 
  FileCheck, 
  Cpu,
  FileText,
  GitBranch,
  PanelRight,
  Download,
  Globe,
  Edit3,
  Kanban as KanbanIcon,
  Clock,
  ShieldCheck,
  Volume2,
  VolumeX,
  GitPullRequest,
  Info,
  Lightbulb,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  FileCode,
  ExternalLink,
  User
} from 'lucide-react';
import type { ChatMessage, ToolCallItem } from '../types';
import { InteractiveQuestion } from './InteractiveQuestion';
import { MermaidRenderer } from './MermaidRenderer';
import { DiffViewer } from './DiffViewer';
import { ApprovalCard } from './ApprovalCard';
import { getExportHtmlUrl, getExportMarkdownUrl, getExportJsonUrl } from '../services/api';
import { AntigravityIcon } from './AntigravityLogo';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';

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
  isRightPanelOpen?: boolean;
  activeRightPanelTab?: string;
  onToggleRightPanel?: () => void;
  pendingApproval?: { toolName: string; command?: string; path?: string } | null;
  onApprovalResolved?: () => void;
  onForkMessage?: (stepIndex: number) => void;
  onEditSessionMeta?: () => void;
}

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
};

/**
 * Modern Syntax-highlighted CodeBlock powered by Prism.js
 */
const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1].toLowerCase() : '';
  const rawCode = String(children).replace(/\n$/, '');

  const handleCopy = async () => {
    await copyTextToClipboard(rawCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline) {
    if (language === 'mermaid') {
      return <MermaidRenderer chart={rawCode} />;
    }
    if (language === 'diff') {
      return <DiffViewer diffText={rawCode} />;
    }

    // Attempt Prism highlighting
    let highlightedHtml: string | null = null;
    const grammar = Prism.languages[language];
    if (grammar) {
      try {
        highlightedHtml = Prism.highlight(rawCode, grammar, language);
      } catch (e) {
        highlightedHtml = null;
      }
    }

    const linesCount = rawCode.split('\n').length;

    return (
      <div
        className="relative my-4 rounded-xl overflow-hidden font-mono text-[12px] shadow-sm border group"
        style={{
          backgroundColor: 'var(--code-bg)',
          borderColor: 'var(--border)'
        }}
      >
        {/* Code Block Header with Studio Controls */}
        <div
          className="flex items-center justify-between px-3.5 py-2 border-b text-xs select-none"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)'
          }}
        >
          <div className="flex items-center gap-2.5">
            <div className="flex gap-1.5 opacity-70">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span
              className="text-[10.5px] font-semibold tracking-wider uppercase pl-1"
              style={{ color: 'var(--accent)' }}
            >
              {language || 'code'}
            </span>
            <span className="text-[10px] opacity-60 font-mono">
              ({linesCount} ligne{linesCount > 1 ? 's' : ''})
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 py-1 px-2.5 rounded-md text-[11px] font-medium transition-all cursor-pointer border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: copied ? '#10B981' : 'var(--muted)'
            }}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié !' : 'Copier'}</span>
          </button>
        </div>

        {/* Code Pre Area */}
        <pre className="p-4 overflow-x-auto leading-relaxed scrollbar-thin text-[12px]">
          {highlightedHtml ? (
            <code
              className={`language-${language}`}
              dangerouslySetInnerHTML={{ __html: highlightedHtml }}
            />
          ) : (
            <code>{children}</code>
          )}
        </pre>
      </div>
    );
  }

  return (
    <code
      className="px-1.5 py-0.5 rounded text-[11.5px] font-mono border"
      style={{
        backgroundColor: 'var(--code-inline-bg)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--code-text)'
      }}
      {...props}
    >
      {children}
    </code>
  );
};

/**
 * GitHub-style Callout & Alert Banner Component ([!NOTE], [!TIP], etc.)
 */
const CalloutBlock = ({ children }: any) => {
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
      note: { title: 'Note', icon: Info, className: 'markdown-callout-note' },
      tip: { title: 'Astuce', icon: Lightbulb, className: 'markdown-callout-tip' },
      important: { title: 'Important', icon: AlertCircle, className: 'markdown-callout-important' },
      warning: { title: 'Avertissement', icon: AlertTriangle, className: 'markdown-callout-warning' },
      caution: { title: 'Attention', icon: ShieldAlert, className: 'markdown-callout-caution' },
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
const LinkBlock = ({ href, children, onOpenFile, ...props }: any) => {
  if (href && href.startsWith('file:///')) {
    const filePath = href.replace(/^file:\/\/\/?/, '/');
    const [cleanPath, anchor] = filePath.split('#');
    const filename = cleanPath.split('/').pop() || cleanPath;

    return (
      <span
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (onOpenFile) {
            onOpenFile();
          } else {
            copyTextToClipboard(cleanPath);
          }
        }}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono text-[11px] cursor-pointer border transition-all my-0.5 shadow-xs hover:border-sky-500/50"
        style={{
          backgroundColor: 'var(--accent-bg)',
          borderColor: 'var(--accent)',
          color: 'var(--accent-text)',
        }}
        title={`Fichier local : ${cleanPath}${anchor ? ' (' + anchor + ')' : ''} — Cliquer pour inspecter`}
      >
        <FileCode className="w-3 h-3 shrink-0" />
        <span className="font-semibold underline decoration-dotted">{filename}</span>
        {anchor && <span className="opacity-75 text-[9.5px]">{anchor}</span>}
      </span>
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
 * Specialized Micro-Card for single tool execution
 */
const ToolItemCard: React.FC<{ tool: ToolCallItem }> = ({ tool }) => {
  const [openDrawer, setOpenDrawer] = useState(false);
  const [copied, setCopied] = useState(false);

  const isCommand = tool.name === 'run_command';
  const isDiff = tool.name === 'replace_file_content';
  const isFile = ['view_file', 'write_to_file', 'list_dir', 'find_by_name', 'grep_search'].includes(tool.name);

  const handleCopyResult = async () => {
    const text = typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2);
    await copyTextToClipboard(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isDiff && tool.args) {
    const diffSnippet = `--- ${tool.args.TargetFile || 'original'}\n+++ ${tool.args.TargetFile || 'modifié'}\n@@ -${tool.args.StartLine || 1} +${tool.args.StartLine || 1} @@\n${(tool.args.TargetContent || '').split('\n').map((l: string) => '-' + l).join('\n')}\n${(tool.args.ReplacementContent || '').split('\n').map((l: string) => '+' + l).join('\n')}`;
    return (
      <DiffViewer
        filename={tool.args.TargetFile}
        title={`Édition : ${tool.args.Instruction || tool.args.Description || tool.args.TargetFile || ''}`}
        diffText={diffSnippet}
      />
    );
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
                : 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20'
            }`}
          >
            {tool.status === 'running' ? 'En cours...' : tool.status === 'error' ? 'Erreur' : 'Terminé'}
          </span>

          {tool.result && (
            <button
              type="button"
              onClick={() => setOpenDrawer(!openDrawer)}
              className="px-2 py-0.5 rounded text-[10px] font-medium border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              {openDrawer ? 'Fermer' : 'Sortie'}
            </button>
          )}
        </div>
      </div>

      {openDrawer && tool.result && (
        <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-2.5 py-1 bg-surface-subtle border-b text-[10px] text-muted">
            <span>Sortie d'exécution</span>
            <button
              type="button"
              onClick={handleCopyResult}
              className="flex items-center gap-1 hover:text-strong cursor-pointer"
            >
              {copied ? <Check className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copied ? 'Copié' : 'Copier'}</span>
            </button>
          </div>
          <pre className="p-2.5 text-[10.5px] font-mono leading-relaxed overflow-x-auto max-h-56 bg-code-bg text-pre-text">
            {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
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
  const interactiveTools = toolCalls.filter(
    (t) => t.name === 'ask_question' || t.name === 'ask_permission' || t.name === 'ask_custom_permission'
  );
  const actionTools = toolCalls.filter(
    (t) => t.name !== 'ask_question' && t.name !== 'ask_permission' && t.name !== 'ask_custom_permission'
  );

  const cmdCount = actionTools.filter((t) => t.name === 'run_command').length;
  const fileReadCount = actionTools.filter((t) => ['view_file', 'read_url_content', 'list_dir', 'grep_search', 'find_by_name'].includes(t.name)).length;
  const fileWriteCount = actionTools.filter((t) => ['replace_file_content', 'write_to_file'].includes(t.name)).length;

  const parts = [];
  if (cmdCount > 0) parts.push(`${cmdCount} commande${cmdCount > 1 ? 's' : ''}`);
  if (fileWriteCount > 0) parts.push(`${fileWriteCount} modification${fileWriteCount > 1 ? 's' : ''}`);
  if (fileReadCount > 0) parts.push(`${fileReadCount} consultation${fileReadCount > 1 ? 's' : ''}`);

  const summary = parts.length > 0
    ? parts.join(', ')
    : `${actionTools.length} action${actionTools.length > 1 ? 's' : ''}`;

  const hasRunning = actionTools.some((t) => t.status === 'running');

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
                Activité de l'agent ({summary})
              </span>
              <span
                className="text-[10px] font-mono px-2 py-0.5 rounded-full font-medium shrink-0"
                style={{
                  backgroundColor: hasRunning ? 'rgba(245, 158, 11, 0.15)' : 'var(--accent-bg)',
                  color: hasRunning ? '#F59E0B' : 'var(--accent)',
                }}
              >
                {hasRunning ? 'En cours...' : 'Terminé'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0 text-muted text-[11px]">
              <span>{isExpanded ? 'Masquer' : 'Détails'}</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </div>
          </button>

          {isExpanded && (
            <div className="p-3 border-t space-y-2 text-xs" style={{ borderColor: 'var(--border)' }}>
              {actionTools.map((tool, idx) => (
                <ToolItemCard key={idx} tool={tool} />
              ))}
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
          <span>Point de contrôle & contexte {stepIndex !== undefined ? `#${stepIndex}` : ''}</span>
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

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
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
  onOpenGit,
  onOpenKanban,
  onOpenCrons,
  onOpenRules,
  onOpenFiles,
  isRightPanelOpen,
  onToggleRightPanel,
  pendingApproval,
  onApprovalResolved,
  onForkMessage,
  onEditSessionMeta,
}) => {
  const { lang, t } = useI18n();
  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const userScrolledUpRef = useRef(false);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});
  const [expandedTools, setExpandedTools] = useState<Record<string, boolean>>({});
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
    userScrolledUpRef.current = distanceFromBottom > 150;
  };

  useEffect(() => {
    if (!bottomRef.current) return;
    if (!userScrolledUpRef.current) {
      bottomRef.current.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [messages, isStreaming]);

  const toggleThought = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleTools = (id: string) => {
    setExpandedTools((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleToggleSpeech = (msgId: string, text: string) => {
    if (!('speechSynthesis' in window)) {
      alert('La synthèse vocale n\'est pas supportée par votre navigateur.');
      return;
    }
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel();
    const cleanText = text
      .replace(/```[\s\S]*?```/g, 'Bloc de code omis.')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/[#*~[\]()]/g, ' ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.lang = currentLangObj?.speech || 'fr-FR';
    utterance.rate = 1.0;
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);
    setSpeakingMsgId(msgId);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div
      className="flex-1 flex flex-col min-h-0 overflow-hidden"
      style={{ backgroundColor: 'var(--main-bg, var(--bg))' }}
    >
      {/* Top Bar - Pure Workbench Style */}
      <div
        className="h-14 px-6 flex items-center justify-between shrink-0 z-10 border-b"
        style={{
          backgroundColor: 'var(--topbar-bg)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            {projectColor && (
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm"
                style={{ backgroundColor: projectColor }}
                title={`Projet: ${project || ''}`}
              />
            )}
            <span className="text-xs font-semibold truncate max-w-xs" style={{ color: 'var(--strong)' }}>
              {conversationTitle || 'Nouvelle conversation'}
            </span>

            {onEditSessionMeta && conversationId && (
              <button
                type="button"
                onClick={onEditSessionMeta}
                className="p-1 rounded opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
                title="Gérer le titre et les métadonnées"
              >
                <Edit3 className="w-3 h-3" style={{ color: 'var(--muted)' }} />
              </button>
            )}
          </div>

          {parentConversationId && (
            <div
              className="hidden sm:flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <GitBranch className="w-3 h-3" />
              <span>Branche</span>
            </div>
          )}

          {tags && tags.length > 0 && (
            <div className="hidden md:flex items-center gap-1">
              {tags.slice(0, 3).map((t) => (
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
              className="hidden lg:flex items-center gap-1.5 text-[10px] font-mono font-medium px-2.5 py-0.5 rounded-full border shadow-sm"
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

        {/* Right Action Icons */}
        <div className="flex items-center gap-1.5">
          {/* Export Dropdown */}
          {conversationId && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowExportMenu(!showExportMenu)}
                className="py-1.5 px-2.5 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
                title="Exporter la session au format HTML, Markdown ou JSON"
              >
                <Download className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span className="text-[11px] font-medium hidden sm:inline">Exporter</span>
                <ChevronDown className="w-3 h-3 opacity-60" />
              </button>

              {showExportMenu && (
                <div
                  className="absolute right-0 top-full mt-1.5 w-52 rounded-xl shadow-2xl z-40 p-1.5 space-y-1 text-xs animate-fadeIn backdrop-blur-xl border"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border2)'
                  }}
                  onMouseLeave={() => setShowExportMenu(false)}
                >
                  <a
                    href={getExportHtmlUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
                    style={{ color: 'var(--text)' }}
                  >
                    <Globe className="w-4 h-4 text-sky-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">HTML Autonome</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>Complet & stylé hors-ligne</span>
                    </div>
                  </a>

                  <a
                    href={getExportMarkdownUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
                    style={{ color: 'var(--text)' }}
                  >
                    <FileText className="w-4 h-4 text-emerald-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">Markdown (.md)</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>Format structuré GitHub</span>
                    </div>
                  </a>

                  <a
                    href={getExportJsonUrl(conversationId)}
                    target="_blank"
                    rel="noreferrer"
                    download
                    onClick={() => setShowExportMenu(false)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg transition-colors"
                    style={{ color: 'var(--text)' }}
                  >
                    <Code2 className="w-4 h-4 text-amber-400 shrink-0" />
                    <div className="flex flex-col text-left">
                      <span className="font-semibold text-[11px]">Données JSON (.json)</span>
                      <span className="text-[9px]" style={{ color: 'var(--muted)' }}>Transcript brut complet</span>
                    </div>
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Direct Action Buttons */}
          {onOpenTerminal && (
            <button
              onClick={onOpenTerminal}
              className="py-1.5 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title="Terminal Interactif (/terminal)"
            >
              <Terminal className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-medium hidden md:inline">Terminal</span>
            </button>
          )}

          {onOpenGit && (
            <button
              onClick={onOpenGit}
              className="py-1.5 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title="Gestionnaire Git (/git)"
            >
              <GitPullRequest className="w-3.5 h-3.5 text-rose-400" />
              <span className="text-[11px] font-medium hidden md:inline">Git</span>
            </button>
          )}

          {onOpenKanban && (
            <button
              onClick={onOpenKanban}
              className="py-1.5 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title="Tableau Kanban (/kanban)"
            >
              <KanbanIcon className="w-3.5 h-3.5 text-violet-400" />
              <span className="text-[11px] font-medium hidden lg:inline">Kanban</span>
            </button>
          )}

          {onOpenCrons && (
            <button
              onClick={onOpenCrons}
              className="py-1.5 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title="Planificateur de Tâches & Crons (/crons)"
            >
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-[11px] font-medium hidden lg:inline">Crons</span>
            </button>
          )}

          {onOpenRules && (
            <button
              onClick={onOpenRules}
              className="py-1.5 px-2 rounded-lg text-xs flex items-center gap-1.5 transition-colors cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title="Règles Système & Mémoire AGENTS.md (/rules)"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-medium hidden lg:inline">Règles</span>
            </button>
          )}

          {onToggleRightPanel && (
            <button
              onClick={onToggleRightPanel}
              className="p-1.5 rounded-lg text-xs flex items-center transition-colors cursor-pointer border ml-1"
              style={{
                backgroundColor: isRightPanelOpen ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: isRightPanelOpen ? 'var(--accent)' : 'var(--border)',
                color: isRightPanelOpen ? 'var(--accent-text)' : 'var(--muted)'
              }}
              title={isRightPanelOpen ? 'Fermer le volet latéral' : 'Ouvrir le volet latéral'}
            >
              <PanelRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6"
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
            // 1. Checkpoint / System event separator
            if (msg.role === 'system') {
              return <CheckpointDivider key={msg.id} content={msg.content} stepIndex={msg.stepIndex} />;
            }

            // 2. User Message
            if (msg.role === 'user') {
              return (
                <div key={msg.id} className="flex flex-col items-end max-w-4xl mx-auto w-full group">
                  <div className="flex items-start gap-2.5 max-w-[85%] sm:max-w-[75%]">
                    <div className="flex flex-col items-end w-full">
                      <div className="hermes-user-bubble rounded-2xl rounded-tr-xs px-4 py-3 text-[13.5px] leading-relaxed shadow-sm">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code: CodeBlock,
                            blockquote: CalloutBlock,
                            a: (props: any) => <LinkBlock {...props} onOpenFile={onOpenFiles} />,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      <div
                        className="flex items-center justify-end gap-2 text-[10px] font-mono mt-1 px-1 opacity-60 group-hover:opacity-100 transition-opacity"
                        style={{ color: 'var(--muted)' }}
                      >
                        {msg.timestamp && (
                          <span>{new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        )}
                        <button
                          type="button"
                          onClick={() => copyTextToClipboard(msg.content)}
                          className="p-0.5 hover:text-strong cursor-pointer"
                          title="Copier le message"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      </div>
                    </div>

                    <div
                      className="w-7 h-7 rounded-xl flex items-center justify-center p-1 shrink-0 border shadow-xs"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                      title="Utilisateur"
                    >
                      <User className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              );
            }

            // 3. Assistant Message
            const isThoughtOpen = expandedThoughts[msg.id];
            const isToolsExpanded = expandedTools[msg.id] ?? (msg.isLive || false);

            return (
              <div key={msg.id} className="flex flex-col items-start max-w-4xl mx-auto w-full group">
                {/* Assistant Role Header */}
                <div className="flex items-center gap-2 mb-2 text-xs">
                  <div
                    className="w-6 h-6 rounded-xl flex items-center justify-center p-0.5 shrink-0 border shadow-xs"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    <AntigravityIcon size={16} />
                  </div>
                  <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>
                    Antigravity
                  </span>
                  {activeModel && (
                    <span
                      className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border-subtle)',
                        color: 'var(--muted)'
                      }}
                    >
                      {activeModel}
                    </span>
                  )}
                  {msg.timestamp && (
                    <span className="text-[10px] opacity-60 ml-0.5" style={{ color: 'var(--muted)' }}>
                      {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                  {msg.isLive && (
                    <span
                      className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-full border animate-pulse"
                      style={{
                        backgroundColor: 'var(--accent-bg)',
                        borderColor: 'var(--accent-bg-strong)',
                        color: 'var(--accent-text)'
                      }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full animate-ping" style={{ backgroundColor: 'var(--accent)' }} />
                      <span>En direct</span>
                    </span>
                  )}
                </div>

                {/* Live Thinking Pill */}
                {msg.isLive && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                  <div
                    className="flex items-center gap-2.5 py-2 px-3.5 rounded-xl border text-xs hermes-thinking-card animate-pulse shadow-sm my-1"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent-bg-strong)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    <span className="w-2 h-2 rounded-full animate-ping shrink-0" style={{ backgroundColor: 'var(--accent)' }} />
                    <BrainCircuit className="w-3.5 h-3.5 animate-pulse" style={{ color: 'var(--accent)' }} />
                    <span className="font-medium text-[11px] tracking-wide">Réflexion approfondie en cours...</span>
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
                      className="w-full flex items-center justify-between px-3.5 py-2.5 transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--accent-text)'
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="w-3.5 h-3.5 text-purple-500" />
                        <span className="font-mono text-[11.5px] font-semibold">Raisonnement interne</span>
                        <span className="text-[10px] opacity-60 font-mono">({msg.thought.length} caractères)</span>
                        {msg.isLive && !msg.content && (
                          <span className="w-1.5 h-1.5 rounded-full animate-ping ml-1" style={{ backgroundColor: 'var(--accent)' }} />
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[11px] opacity-75">
                        <span>{isThoughtOpen ? 'Masquer' : 'Afficher'}</span>
                        {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </div>
                    </button>
                    {isThoughtOpen && (
                      <div
                        className="p-3.5 border-t text-[11.5px] leading-relaxed whitespace-pre-wrap font-mono max-h-80 overflow-y-auto"
                        style={{
                          backgroundColor: 'var(--code-bg)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)'
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
                  <div className="hermes-assistant-body w-full markdown-content leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: CodeBlock,
                        blockquote: CalloutBlock,
                        a: (props: any) => <LinkBlock {...props} onOpenFile={onOpenFiles} />,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {msg.isLive && <span className="hermes-streaming-cursor" />}
                  </div>
                ) : null}

                {/* Assistant Action Footer */}
                <div
                  className="flex items-center gap-2 px-1 text-[10.5px] font-mono mt-2 opacity-60 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--muted)' }}
                >
                  {msg.stepIndex !== undefined && (
                    <span className="opacity-60">Étape #{msg.stepIndex}</span>
                  )}

                  {msg.content && (
                    <button
                      type="button"
                      onClick={() => copyTextToClipboard(msg.content)}
                      className="transition-opacity opacity-75 hover:opacity-100 p-1 rounded cursor-pointer flex items-center gap-1"
                      title="Copier la réponse complète"
                    >
                      <Copy className="w-3 h-3" />
                      <span className="hidden sm:inline">Copier</span>
                    </button>
                  )}

                  {msg.content && (
                    <button
                      type="button"
                      onClick={() => handleToggleSpeech(msg.id, msg.content)}
                      className="transition-opacity opacity-75 hover:opacity-100 p-1 rounded cursor-pointer flex items-center gap-1"
                      title={speakingMsgId === msg.id ? "Arrêter la synthèse vocale" : "Écouter la réponse"}
                    >
                      {speakingMsgId === msg.id ? (
                        <VolumeX className="w-3 h-3 text-rose-400 animate-pulse" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                      <span className="hidden sm:inline">{speakingMsgId === msg.id ? 'Arrêter' : 'Écouter'}</span>
                    </button>
                  )}

                  {conversationId && onForkMessage && (
                    <button
                      type="button"
                      onClick={() => onForkMessage(msg.stepIndex !== undefined ? msg.stepIndex : msgIdx)}
                      className="transition-opacity opacity-75 hover:opacity-100 p-1 rounded cursor-pointer flex items-center gap-1"
                      style={{ color: 'var(--accent)' }}
                      title="Bifurquer la discussion à partir de cette étape"
                    >
                      <GitBranch className="w-3 h-3" />
                      <span>Bifurquer</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
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
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
