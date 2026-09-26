import React, { useState, useContext, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import Prism from 'prismjs';

// Load Prism Language Grammars
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
import 'prismjs/components/prism-scss';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-php';
import 'prismjs/components/prism-docker';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-ruby';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-ini';
import 'prismjs/components/prism-regex';
import 'prismjs/components/prism-diff';

import {
  Check,
  Copy,
  Terminal,
  Code2,
  FileCode,
  FileText,
  Globe,
  Database,
  Cpu,
  Download,
  WrapText,
  AlignLeft,
  Hash,
  Maximize2,
  Minimize2,
  ChevronDown,
  ChevronUp,
  GitBranch,
  BrainCircuit,
  ExternalLink,
  Play,
  Search,
  X
} from 'lucide-react';
import { DiffViewer } from './DiffViewer';
import { PreContext, copyText, extractRawText } from '../utils/codeBlockUtils';
import { triggerFileDownload } from '../services/api';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import type { MonacoStudioConfig } from '../types';

const MermaidRenderer = React.lazy(() =>
  import('./MermaidRenderer').then((m) => ({ default: m.MermaidRenderer }))
);

export const PreBlock = ({ children }: any) => {
  return <PreContext.Provider value={true}>{children}</PreContext.Provider>;
};

// Aliases mapping for common language names
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  javascript: 'javascript',
  ts: 'typescript',
  typescript: 'typescript',
  jsx: 'jsx',
  tsx: 'tsx',
  py: 'python',
  python: 'python',
  py3: 'python',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  terminal: 'bash',
  console: 'bash',
  cmd: 'bash',
  json: 'json',
  jsonc: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  markup: 'markup',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  sql: 'sql',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  csharp: 'csharp',
  go: 'go',
  golang: 'go',
  rs: 'rust',
  rust: 'rust',
  rb: 'ruby',
  ruby: 'ruby',
  java: 'java',
  docker: 'docker',
  dockerfile: 'docker',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
  patch: 'diff',
  mermaid: 'mermaid',
};

const EXTENSION_MAP: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  tsx: 'tsx',
  python: 'py',
  bash: 'sh',
  json: 'json',
  yaml: 'yml',
  markdown: 'md',
  markup: 'html',
  css: 'css',
  scss: 'scss',
  sql: 'sql',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  go: 'go',
  rust: 'rs',
  ruby: 'rb',
  java: 'java',
  docker: 'dockerfile',
  toml: 'toml',
  ini: 'ini',
  diff: 'diff',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} Ko`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Splits HTML with syntax highlight tags into lines while ensuring all open tags
 * are cleanly closed at line endings and re-opened at next line starts.
 */
function splitHtmlIntoLines(html: string): string[] {
  const lines: string[] = [];
  const tagRegex = /(<\/?([a-zA-Z0-9-]+)(?:\s+[^>]*)?>)/g;
  const activeStack: { name: string; full: string }[] = [];
  const rawLines = html.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const prefix = activeStack.map((t) => t.full).join('');
    tagRegex.lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = tagRegex.exec(line)) !== null) {
      const full = match[1];
      const isClosing = full.startsWith('</');
      const tagName = match[2];

      if (isClosing) {
        const lastIdx = activeStack.map((t) => t.name).lastIndexOf(tagName);
        if (lastIdx !== -1) {
          activeStack.splice(lastIdx, 1);
        }
      } else if (!full.endsWith('/>')) {
        activeStack.push({ name: tagName, full });
      }
    }

    const suffix = activeStack
      .slice()
      .reverse()
      .map((t) => '</' + t.name + '>')
      .join('');
    lines.push(prefix + line + suffix);
  }

  return lines;
}

function parseCodeFenceMeta(className?: string, rawCode: string = '') {
  let rawLang = '';
  let filename = '';

  if (className) {
    const match = /language-([^\s]+)/.exec(className);
    if (match) {
      const fullMeta = match[1];
      if (fullMeta.includes(':')) {
        const parts = fullMeta.split(':');
        rawLang = parts[0];
        filename = parts.slice(1).join(':');
      } else if (fullMeta.includes('title=')) {
        const titleMatch = /title=["']?([^"'\s]+)["']?/.exec(fullMeta);
        rawLang = fullMeta.split(/[_\s-]/)[0];
        if (titleMatch) filename = titleMatch[1];
      } else if (fullMeta.includes('file=')) {
        const fileMatch = /file=["']?([^"'\s]+)["']?/.exec(fullMeta);
        rawLang = fullMeta.split(/[_\s-]/)[0];
        if (fileMatch) filename = fileMatch[1];
      } else if (fullMeta.includes('filepath=')) {
        const filepathMatch = /filepath=["']?([^"'\s]+)["']?/.exec(fullMeta);
        rawLang = fullMeta.split(/[_\s-]/)[0];
        if (filepathMatch) filename = filepathMatch[1];
      } else {
        rawLang = fullMeta;
      }
    }
  }

  // Check first line for filepath comment if filename not found yet
  let cleanedCode = rawCode;
  const lines = rawCode.split('\n');
  if (lines.length > 0) {
    const firstLine = lines[0].trim();
    const commentMatch = /^(?:\/\/|#|--|\/\*|<!--)\s*(?:filepath|filename|file):\s*([^\s*]+)/i.exec(firstLine);
    if (commentMatch) {
      if (!filename) filename = commentMatch[1];
    }
  }

  const normalizedLang = LANGUAGE_ALIASES[rawLang.toLowerCase()] || rawLang.toLowerCase() || 'text';

  return {
    language: normalizedLang,
    filename,
    cleanedCode
  };
}

function getLanguageDisplay(lang: string) {
  switch (lang) {
    case 'typescript':
    case 'tsx':
      return { label: lang === 'tsx' ? 'TSX' : 'TypeScript', icon: FileCode, color: '#3178C6' };
    case 'javascript':
    case 'jsx':
      return { label: lang === 'jsx' ? 'JSX' : 'JavaScript', icon: FileCode, color: '#EAB308' };
    case 'python':
      return { label: 'Python', icon: Code2, color: '#3776AB' };
    case 'bash':
      return { label: 'Bash', icon: Terminal, color: '#10B981' };
    case 'json':
      return { label: 'JSON', icon: FileText, color: '#F59E0B' };
    case 'yaml':
      return { label: 'YAML', icon: FileText, color: '#EC4899' };
    case 'sql':
      return { label: 'SQL', icon: Database, color: '#06B6D4' };
    case 'markdown':
      return { label: 'Markdown', icon: FileText, color: '#8B5CF6' };
    case 'markup':
      return { label: 'HTML / XML', icon: Globe, color: '#E44D26' };
    case 'css':
    case 'scss':
      return { label: lang.toUpperCase(), icon: Globe, color: '#264DE4' };
    case 'rust':
      return { label: 'Rust', icon: Cpu, color: '#DEA584' };
    case 'go':
      return { label: 'Go', icon: Cpu, color: '#00ADD8' };
    case 'c':
    case 'cpp':
      return { label: lang === 'cpp' ? 'C++' : 'C', icon: Cpu, color: '#659AD2' };
    case 'csharp':
      return { label: 'C#', icon: FileCode, color: '#239120' };
    case 'java':
      return { label: 'Java', icon: FileCode, color: '#ED8B00' };
    case 'ruby':
      return { label: 'Ruby', icon: Code2, color: '#CC342D' };
    case 'docker':
      return { label: 'Docker', icon: Terminal, color: '#2496ED' };
    case 'toml':
    case 'ini':
      return { label: lang.toUpperCase(), icon: FileText, color: '#A855F7' };
    case 'diff':
      return { label: 'Diff', icon: GitBranch, color: '#10B981' };
    case 'mermaid':
      return { label: 'Mermaid', icon: BrainCircuit, color: '#FF3366' };
    default:
      return { label: lang ? lang.toUpperCase() : 'CODE', icon: Code2, color: 'var(--accent)' };
  }
}

/**
 * Clean inline code component. Never breaks line or paragraph layout.
 */
export const InlineCode: React.FC<any> = ({ children, ...props }) => {
  const { t } = useI18n();
  return (
    <code
      className="inline font-mono text-[13px] px-1.5 py-0.5 mx-0.5 rounded-md border font-medium transition-colors break-words max-w-full select-text align-baseline"
      style={{
        backgroundColor: 'var(--code-inline-bg)',
        borderColor: 'var(--border-subtle)',
        color: 'var(--accent-text)',
      }}
      title={t('code_inline', 'Inline code')}
      {...props}
    >
      {children}
    </code>
  );
};

export interface AdaptiveCodeBlockProps {
  className?: string;
  children?: any;
  onOpenFile?: (path: string) => void;
  onOpenTerminal?: () => void;
  onOpenMonacoStudio?: (config: MonacoStudioConfig) => void;
}

/**
 * Highly responsive, feature-packed CodeBlock that adapts to ALL circumstances:
 * - Line numbers toggleable with zero selection pollution
 * - Soft-wrap toggleable (Horizontal scroll vs auto-wrap)
 * - Auto-collapsible with expansion drawer for large snippets (> 28 lines)
 * - Syntax highlighting powered by Prism with fallback to escaped plain text
 * - File path extraction and direct file opening
 * - Direct terminal integration for shell/bash commands
 * - Download snippet as a local file
 * - Mermaid and Diff viewers integration
 */
export const AdaptiveCodeBlock: React.FC<AdaptiveCodeBlockProps> = ({
  className,
  children,
  onOpenFile,
  onOpenTerminal,
  onOpenMonacoStudio,
}) => {
  const { t } = useI18n();
  const rawCode = extractRawText(children).replace(/\n$/, '');
  const { language, filename, cleanedCode } = useMemo(
    () => parseCodeFenceMeta(className, rawCode),
    [className, rawCode]
  );

  const linesCount = useMemo(() => cleanedCode.split('\n').length, [cleanedCode]);
  const langMeta = useMemo(() => getLanguageDisplay(language), [language]);

  // States adapting to user interaction
  const [copied, setCopied] = useState(false);
  const [showLineNumbers, setShowLineNumbers] = useState<boolean>(linesCount > 3);
  const [wrapLines, setWrapLines] = useState<boolean>(false);
  const [isExpanded, setIsExpanded] = useState<boolean>(linesCount <= 28);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [codeSearch, setCodeSearch] = useState<string>('');

  // Close fullscreen on Escape key
  useEffect(() => {
    if (!isFullscreen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  // Direct execution lens command for supported languages (bash, python, node)
  const runnableCommand = useMemo(() => {
    const trimmed = cleanedCode.trim();
    if (!trimmed) return null;
    if (['bash', 'sh', 'shell', 'zsh'].includes(language)) {
      return trimmed;
    }
    if (['python', 'py'].includes(language)) {
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n');
      return `python -c "${escaped}"`;
    }
    if (['javascript', 'js', 'node'].includes(language)) {
      const escaped = trimmed
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\$/g, '\\$')
        .replace(/`/g, '\\`')
        .replace(/\n/g, '\\n');
      return `node -e "${escaped}"`;
    }
    return null;
  }, [cleanedCode, language]);

  // Intra-code search matching line indexes
  const matchingLineIndices = useMemo(() => {
    if (!codeSearch.trim()) return new Set<number>();
    const query = codeSearch.toLowerCase();
    const rawLines = cleanedCode.split('\n');
    const matches = new Set<number>();
    rawLines.forEach((l, idx) => {
      if (l.toLowerCase().includes(query)) matches.add(idx);
    });
    return matches;
  }, [cleanedCode, codeSearch]);

  // Generate syntax highlighted lines safely (called unconditionally)
  const formattedLines = useMemo(() => {
    if (language === 'mermaid' || language === 'diff' || language === 'patch') {
      return [];
    }
    let highlighted = '';
    const grammar = Prism.languages[language];
    if (grammar) {
      try {
        highlighted = Prism.highlight(cleanedCode, grammar, language);
      } catch {
        highlighted = escapeHtml(cleanedCode);
      }
    } else {
      highlighted = escapeHtml(cleanedCode);
    }
    return splitHtmlIntoLines(highlighted);
  }, [cleanedCode, language]);

  // Intercept special engines
  if (language === 'mermaid') {
    return (
      <React.Suspense
        fallback={
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-xs text-slate-500 font-mono animate-pulse flex items-center justify-center">
            {t('loading_mermaid', 'Loading Mermaid diagram...')}
          </div>
        }
      >
        <MermaidRenderer chart={rawCode} />
      </React.Suspense>
    );
  }
  if (language === 'diff' || language === 'patch') {
    return <DiffViewer diffText={rawCode} filename={filename} />;
  }

  const handleCopy = async () => {
    await copyText(cleanedCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const ext = EXTENSION_MAP[language] || 'txt';
    const name = filename || `snippet.${ext}`;
    const blob = new Blob([cleanedCode], { type: 'text/plain;charset=utf-8' });
    triggerFileDownload(blob, name);
  };

  const handleExecute = () => {
    if (!runnableCommand) return;
    window.dispatchEvent(new CustomEvent('terminal-run-command', { detail: { command: runnableCommand } }));
    if (onOpenTerminal) onOpenTerminal();
    showToast(t('code_sent_to_terminal', 'Code envoyé au terminal'), 'success');
  };

  const LangIcon = langMeta.icon;
  const isBash = language === 'bash';
  const isSql = ['sql', 'sqlite', 'sqlite3', 'pgsql', 'postgres', 'mysql'].includes(language);
  const hasCollapseFeature = linesCount > 28;

  return (
    <>
      <div
        className="relative my-4 rounded-2xl border font-mono text-[12px] shadow-sm transition-all overflow-hidden group/code"
        style={{
          backgroundColor: 'var(--code-bg)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Code Header Bar */}
        <div
          className="flex flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 border-b text-xs select-none"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)',
          }}
        >
          {/* Left Side: Window dots, Language Badge, File Pill, Stats */}
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <div className="flex items-center gap-1.5 opacity-70 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>

            {/* Language badge */}
            <div className="flex items-center gap-1.5 pl-1 shrink-0">
              <LangIcon className="w-3.5 h-3.5" style={{ color: langMeta.color }} />
              <span
                className="text-[11px] font-semibold tracking-wider uppercase font-mono"
                style={{ color: langMeta.color }}
              >
                {langMeta.label}
              </span>
            </div>

            {/* Optional detected filename */}
            {filename && (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('open-workspace-file', { detail: { path: filename } }));
                  onOpenFile?.(filename);
                }}
                title={t('open_file_name', 'Open {0}').replace('{0}', filename)}
                className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono border transition-colors truncate max-w-[240px] cursor-pointer"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                <FileCode className="w-3 h-3 text-accent shrink-0" />
                <span className="truncate">{filename}</span>
                <ExternalLink className="w-2.5 h-2.5 opacity-50 shrink-0 ml-0.5" />
              </button>
            )}

            {/* Line count & size */}
            <span className="text-[10.5px] opacity-60 font-mono shrink-0 hidden sm:inline">
              ({t('lines_count', '{0} lines').replace('{0}', String(linesCount))} • {formatBytes(cleanedCode.length)})
            </span>
          </div>

          {/* Right Side: Adaptive Studio Controls */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Direct Execute Lens (Bash, Python, Node) */}
            {runnableCommand && (
              <button
                type="button"
                onClick={handleExecute}
                title={t('code_lens_run', 'Exécuter dans le terminal ({0})').replace('{0}', langMeta.label)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-all cursor-pointer border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20 shadow-xs"
              >
                <Play className="w-3 h-3 fill-current" />
                <span>{t('run', 'Exécuter')}</span>
              </button>
            )}

            {/* Terminal button for bash snippets */}
            {isBash && onOpenTerminal && (
              <button
                type="button"
                onClick={onOpenTerminal}
                title={t('open_terminal', 'Open interactive terminal')}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer border hover:text-emerald-400"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <Terminal className="w-3 h-3 text-emerald-400" />
                <span className="hidden md:inline">{t('terminal', 'Terminal')}</span>
              </button>
            )}

            {/* SQL Studio button for SQL snippets */}
            {isSql && (
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('open-database-studio', { detail: { query: cleanedCode } }));
                }}
                title={t('open_in_database_studio', 'Ouvrir dans Database Studio')}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer border hover:text-emerald-400"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <Database className="w-3 h-3 text-emerald-400" />
                <span className="hidden sm:inline">{t('sql_studio', 'SQL Studio')}</span>
              </button>
            )}

            {onOpenMonacoStudio && (
              <button
                type="button"
                onClick={() =>
                  onOpenMonacoStudio({
                    mode: 'editor',
                    language,
                    content: cleanedCode,
                    title: filename || `Extrait ${language}`
                  })
                }
                title={t('open_in_monaco_studio', 'Ouvrir dans Monaco Studio')}
                className="flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-all cursor-pointer border hover:text-emerald-400"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <Code2 className="w-3 h-3 text-emerald-400" />
                <span className="hidden sm:inline">{t('studio', 'Studio')}</span>
              </button>
            )}

            {/* Line numbers toggle */}
            <button
              type="button"
              onClick={() => setShowLineNumbers(!showLineNumbers)}
              title={showLineNumbers ? t('hide_line_numbers', 'Hide line numbers') : t('show_line_numbers', 'Show line numbers')}
              className="p-1.5 rounded-lg text-[11px] transition-all cursor-pointer border"
              style={{
                backgroundColor: showLineNumbers ? 'var(--surface-subtle-hover)' : 'var(--surface)',
                borderColor: showLineNumbers ? 'var(--accent)' : 'var(--border)',
                color: showLineNumbers ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              <Hash className="w-3 h-3" />
            </button>

            {/* Word-wrap toggle */}
            <button
              type="button"
              onClick={() => setWrapLines(!wrapLines)}
              title={wrapLines ? t('disable_line_wrap', 'Disable line wrap') : t('enable_line_wrap', 'Enable line wrap')}
              className="p-1.5 rounded-lg text-[11px] transition-all cursor-pointer border"
              style={{
                backgroundColor: wrapLines ? 'var(--surface-subtle-hover)' : 'var(--surface)',
                borderColor: wrapLines ? 'var(--accent)' : 'var(--border)',
                color: wrapLines ? 'var(--accent)' : 'var(--muted)',
              }}
            >
              {wrapLines ? <WrapText className="w-3 h-3" /> : <AlignLeft className="w-3 h-3" />}
            </button>

            {/* Expand/Collapse toggle for large files */}
            {hasCollapseFeature && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                title={isExpanded ? t('collapse_code_view', 'Collapse code view') : t('expand_code_view', 'Expand full code')}
                className="p-1.5 rounded-lg text-[11px] transition-all cursor-pointer border"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>
            )}

            {/* Immersive Fullscreen Mode */}
            <button
              type="button"
              onClick={() => setIsFullscreen(true)}
              title={t('fullscreen_code_reader', 'Mode lecture plein écran')}
              className="p-1.5 rounded-lg text-[11px] transition-all cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--muted)',
              }}
            >
              <Maximize2 className="w-3 h-3" />
            </button>

            {/* Download snippet */}
            <button
              type="button"
              onClick={handleDownload}
              title={t('download_snippet', 'Download code snippet')}
              className="p-1.5 rounded-lg text-[11px] transition-all cursor-pointer border"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--muted)',
              }}
            >
              <Download className="w-3 h-3" />
            </button>

            {/* Copy button */}
            <button
              type="button"
              onClick={handleCopy}
              title={t('copy_full_code', 'Copy full code')}
              className="flex items-center gap-1.5 py-1 px-2.5 rounded-lg text-[11px] font-medium transition-all cursor-pointer border ml-1 shadow-2xs"
              style={{
                backgroundColor: copied ? 'rgba(16, 185, 129, 0.1)' : 'var(--surface)',
                borderColor: copied ? '#10B981' : 'var(--border)',
                color: copied ? '#10B981' : 'var(--muted)',
              }}
            >
              {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
              <span className="font-sans font-medium">{copied ? t('copied', 'Copied!') : t('copy', 'Copy')}</span>
            </button>
          </div>
        </div>

        {/* Code Body Area with synchronized line numbers and responsive wrapping */}
        <div
          className={`relative overflow-x-auto scrollbar-thin transition-all ${
            !isExpanded && hasCollapseFeature ? 'max-h-[440px] overflow-y-auto' : 'max-h-none'
          }`}
        >
          <div
            className={`table w-full font-mono text-[12px] leading-relaxed py-2.5 select-text ${
              wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
            }`}
            style={{ color: 'var(--code-text)' }}
          >
            {formattedLines.map((lineHtml, idx) => (
              <div key={idx} className="table-row hover:bg-white/[0.02] group/row">
                {/* Synchronized Gutter Line Number */}
                {showLineNumbers && (
                  <div
                    className="table-cell select-none text-right pr-3.5 pl-3 py-[1px] text-[11px] font-mono border-r align-top shrink-0 w-[44px]"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--muted)',
                      opacity: 0.5,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {isBash && linesCount === 1 ? '$' : idx + 1}
                  </div>
                )}

                {/* Code Line Content */}
                <div
                  className="table-cell pl-4 pr-4 py-[1px] align-top select-text"
                  dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                />
              </div>
            ))}
          </div>

          {/* Gradient fade overlay and expansion button when capped */}
          {!isExpanded && hasCollapseFeature && (
            <div
              className="sticky bottom-0 inset-x-0 pt-10 pb-3 flex items-center justify-center pointer-events-none"
              style={{
                background: 'linear-gradient(to bottom, transparent, var(--code-bg) 80%)',
              }}
            >
              <button
                type="button"
                onClick={() => setIsExpanded(true)}
                className="pointer-events-auto flex items-center gap-2 px-4 py-1.5 rounded-full text-[11px] font-medium border shadow-md transition-all cursor-pointer hover:scale-105"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent)',
                }}
              >
                <ChevronDown className="w-3.5 h-3.5" />
                <span>{t('show_remaining_lines', 'Show {0} remaining lines').replace('{0}', String(linesCount - 28))}</span>
              </button>
            </div>
          )}
        </div>

        {/* Expanded footer collapse bar */}
        {isExpanded && hasCollapseFeature && (
          <div
            className="flex items-center justify-center py-2 border-t text-[11px] font-medium select-none"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)',
            }}
          >
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="flex items-center gap-1.5 text-muted hover:text-accent cursor-pointer transition-colors"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              <span>{t('collapse_code_view', 'Collapse code view')}</span>
            </button>
          </div>
        )}
      </div>

      {/* Fullscreen Code Reader Modal */}
      {isFullscreen &&
        createPortal(
          <div
            className="fixed inset-0 z-50 p-2 sm:p-6 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-200 select-none"
            onClick={(e) => {
              if (e.target === e.currentTarget) setIsFullscreen(false);
            }}
          >
            <div
              className="w-full max-w-6xl h-[92vh] rounded-2xl border flex flex-col overflow-hidden shadow-2xl animate-in zoom-in-95 duration-200"
              style={{
                backgroundColor: 'var(--code-bg)',
                borderColor: 'var(--border)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Fullscreen Header */}
              <div
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b text-xs shrink-0 select-none"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex items-center gap-1.5 opacity-80 shrink-0">
                    <div
                      className="w-3 h-3 rounded-full bg-rose-500/80 cursor-pointer hover:opacity-100"
                      onClick={() => setIsFullscreen(false)}
                      title={t('close', 'Fermer')}
                    />
                    <div className="w-3 h-3 rounded-full bg-amber-500/80" />
                    <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
                  </div>

                  <div className="flex items-center gap-1.5 pl-1 shrink-0">
                    <LangIcon className="w-4 h-4" style={{ color: langMeta.color }} />
                    <span className="text-[12px] font-bold tracking-wider uppercase font-mono" style={{ color: langMeta.color }}>
                      {langMeta.label}
                    </span>
                  </div>

                  {filename && (
                    <div
                      className="flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-mono border truncate max-w-[280px]"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      <FileCode className="w-3.5 h-3.5 text-accent shrink-0" />
                      <span className="truncate">{filename}</span>
                    </div>
                  )}

                  <span className="text-xs opacity-60 font-mono hidden sm:inline">
                    ({linesCount} {t('lines_plural', 'lignes')} • {formatBytes(cleanedCode.length)})
                  </span>
                </div>

                {/* Fullscreen Controls & Search Bar */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Intra-code Search Input */}
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-xl border text-xs shadow-2xs"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: codeSearch ? 'var(--accent)' : 'var(--border)',
                    }}
                  >
                    <Search className="w-3.5 h-3.5 text-muted shrink-0" />
                    <input
                      type="text"
                      value={codeSearch}
                      onChange={(e) => setCodeSearch(e.target.value)}
                      placeholder={t('search_in_code', 'Filtrer dans le code...')}
                      className="bg-transparent border-none outline-hidden text-xs font-mono text-strong placeholder:text-muted/60 w-36 sm:w-52"
                    />
                    {codeSearch && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-semibold">
                          {matchingLineIndices.size}
                        </span>
                        <button
                          type="button"
                          onClick={() => setCodeSearch('')}
                          className="text-muted hover:text-strong cursor-pointer p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {runnableCommand && (
                    <button
                      type="button"
                      onClick={handleExecute}
                      title={t('code_lens_run', 'Exécuter')}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer border bg-emerald-500/10 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{t('run', 'Exécuter')}</span>
                    </button>
                  )}

                  {/* Line Numbers Toggle */}
                  <button
                    type="button"
                    onClick={() => setShowLineNumbers(!showLineNumbers)}
                    className="p-1.5 rounded-xl text-xs border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: showLineNumbers ? 'var(--surface-subtle-hover)' : 'var(--surface)',
                      borderColor: showLineNumbers ? 'var(--accent)' : 'var(--border)',
                      color: showLineNumbers ? 'var(--accent)' : 'var(--muted)',
                    }}
                    title={showLineNumbers ? t('hide_line_numbers', 'Hide line numbers') : t('show_line_numbers', 'Show line numbers')}
                  >
                    <Hash className="w-3.5 h-3.5" />
                  </button>

                  {/* Wrap Toggle */}
                  <button
                    type="button"
                    onClick={() => setWrapLines(!wrapLines)}
                    className="p-1.5 rounded-xl text-xs border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: wrapLines ? 'var(--surface-subtle-hover)' : 'var(--surface)',
                      borderColor: wrapLines ? 'var(--accent)' : 'var(--border)',
                      color: wrapLines ? 'var(--accent)' : 'var(--muted)',
                    }}
                    title={wrapLines ? t('disable_line_wrap', 'Disable line wrap') : t('enable_line_wrap', 'Enable line wrap')}
                  >
                    {wrapLines ? <WrapText className="w-3.5 h-3.5" /> : <AlignLeft className="w-3.5 h-3.5" />}
                  </button>

                  {/* Download */}
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="p-1.5 rounded-xl text-xs border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--muted)',
                    }}
                    title={t('download_snippet', 'Download code snippet')}
                  >
                    <Download className="w-3.5 h-3.5" />
                  </button>

                  {/* Copy */}
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border cursor-pointer transition-colors"
                    style={{
                      backgroundColor: copied ? 'rgba(16, 185, 129, 0.1)' : 'var(--surface)',
                      borderColor: copied ? '#10B981' : 'var(--border)',
                      color: copied ? '#10B981' : 'var(--muted)',
                    }}
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? t('copied', 'Copied!') : t('copy', 'Copy')}</span>
                  </button>

                  {/* Close Fullscreen */}
                  <button
                    type="button"
                    onClick={() => setIsFullscreen(false)}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold border cursor-pointer transition-all bg-rose-500/10 text-rose-400 border-rose-500/30 hover:bg-rose-500/20"
                    title={t('exit_fullscreen', 'Quitter plein écran (Esc)')}
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline font-mono text-[10px] opacity-75">Esc</span>
                  </button>
                </div>
              </div>

              {/* Fullscreen Code Content */}
              <div className="flex-1 overflow-auto p-4 select-text">
                <div
                  className={`table w-full font-mono text-[13px] leading-relaxed select-text ${
                    wrapLines ? 'whitespace-pre-wrap break-all' : 'whitespace-pre'
                  }`}
                  style={{ color: 'var(--code-text)' }}
                >
                  {formattedLines.map((lineHtml, idx) => {
                    const isMatch = codeSearch.trim() && matchingLineIndices.has(idx);
                    return (
                      <div
                        key={idx}
                        className={`table-row transition-colors ${
                          isMatch ? 'bg-amber-500/15' : 'hover:bg-white/[0.02]'
                        } ${codeSearch.trim() && !isMatch ? 'opacity-40 hover:opacity-100' : ''}`}
                      >
                        {showLineNumbers && (
                          <div
                            className={`table-cell select-none text-right pr-4 pl-3 py-[2px] text-xs font-mono border-r align-top shrink-0 w-[50px] ${
                              isMatch ? 'text-amber-400 font-bold' : ''
                            }`}
                            style={{
                              borderColor: 'var(--border-subtle)',
                              color: isMatch ? '#f59e0b' : 'var(--muted)',
                              opacity: isMatch ? 1 : 0.5,
                              fontVariantNumeric: 'tabular-nums',
                            }}
                          >
                            {idx + 1}
                          </div>
                        )}
                        <div
                          className={`table-cell pl-4 pr-4 py-[2px] align-top select-text ${
                            isMatch ? 'border-l-2 border-amber-400' : ''
                          }`}
                          dangerouslySetInnerHTML={{ __html: lineHtml || '&nbsp;' }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fullscreen Footer info bar */}
              <div
                className="px-4 py-2 border-t text-[11px] font-mono flex items-center justify-between select-none"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--muted)',
                }}
              >
                <span>
                  {linesCount} {t('lines', 'lignes')} • {formatBytes(cleanedCode.length)} • {langMeta.label}
                </span>
                {codeSearch && (
                  <span className="text-amber-400 font-semibold">
                    {matchingLineIndices.size} {matchingLineIndices.size > 1 ? t('matching_lines', 'lignes correspondantes') : t('matching_line', 'ligne correspondante')}
                  </span>
                )}
                <span className="opacity-60 hidden sm:inline">
                  {t('fullscreen_hint', 'Appuyez sur Esc pour quitter le plein écran')}
                </span>
              </div>
            </div>
          </div>,
          document.body
        )}
    </>
  );
};

/**
 * Switch component that delegates to InlineCode or AdaptiveCodeBlock based on PreContext
 */
export const CodeOrInlineBlock: React.FC<any> = ({
  onOpenFile,
  onOpenTerminal,
  onOpenMonacoStudio,
  className,
  children,
  inline,
  ...props
}) => {
  const inPre = useContext(PreContext);
  const rawText = extractRawText(children);
  const isInline = inline === true || (!inPre && inline !== false && !className?.includes('language-') && !rawText.includes('\n'));

  if (isInline) {
    return <InlineCode {...props}>{children}</InlineCode>;
  }

  return (
    <AdaptiveCodeBlock
      className={className}
      onOpenFile={onOpenFile}
      onOpenTerminal={onOpenTerminal}
      onOpenMonacoStudio={onOpenMonacoStudio}
      {...props}
    >
      {children}
    </AdaptiveCodeBlock>
  );
};

