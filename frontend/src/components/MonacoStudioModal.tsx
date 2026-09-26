import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  X,
  Code2,
  GitCompare,
  Play,
  BrainCircuit,
  Save,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Split,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Columns,
  WrapText,
  MapPin,
  Sparkles,
  Search,
  Zap,
  Wand2,
  Layers,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { saveFileContent, fetchFileContent, fetchGitFileVersions, fetchGitDiffRanges } from '../services/api';
import type { MonacoStudioConfig, GitDiffRange, GitDiffSummary } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';
import { SUPPORTED_LANGUAGES, detectLanguage, getInitialMonacoTheme } from '../utils/editorUtils';
import { registerMonacoCopilot, isCopilotEnabled, setCopilotEnabled } from '../services/copilot';
import {
  getMonacoMultiCursorOptions,
  setupMultiCursor,
  applyGitDecorations,
  navigateGitDiff
} from '../services/monacoAnnotations';
import { CopilotActionModal } from './CopilotActionModal';

interface MonacoStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  config: MonacoStudioConfig | null;
  onExplainCode?: (code: string, language?: string, filePath?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  currentWorkspace?: string;
}

interface MonacoStudioInnerProps {
  config: MonacoStudioConfig;
  onClose: () => void;
  onExplainCode?: (code: string, language?: string, filePath?: string) => void;
  onExecuteCode?: (code: string, language: string) => void;
  currentWorkspace?: string;
}

const MonacoStudioInner: React.FC<MonacoStudioInnerProps> = ({
  config,
  onClose,
  onExplainCode,
  onExecuteCode,
  currentWorkspace,
}) => {
  const { t } = useI18n();
  const [mode, setMode] = useState<'editor' | 'diff'>(config.mode || 'editor');
  const [language, setLanguage] = useState<string>(() =>
    config.language || detectLanguage(config.filePath, 'typescript')
  );
  const [content, setContent] = useState<string>(() => config.content || config.initialValue || '');
  const [originalContent, setOriginalContent] = useState<string>(() => config.originalContent || '');
  const [modifiedContent, setModifiedContent] = useState<string>(() => config.modifiedContent || config.content || config.initialValue || '');
  const [isSplitView, setIsSplitView] = useState<boolean>(true);
  const [isWordWrap, setIsWordWrap] = useState<boolean>(true);
  const [isMinimap, setIsMinimap] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [copied, setCopied] = useState<boolean>(false);
  const needsFetch = Boolean(
    config.mode === 'diff' && config.filePath && !config.originalContent && !config.modifiedContent
  );
  const [isLoadingVersions, setIsLoadingVersions] = useState<boolean>(needsFetch);

  const needsFetchFile = Boolean(
    mode === 'editor' && config.filePath && !config.content && !config.initialValue
  );
  const [isLoadingFile, setIsLoadingFile] = useState<boolean>(needsFetchFile);
  const [theme, setTheme] = useState<'vs-dark' | 'light'>(getInitialMonacoTheme);

  // Copilot Inline Ghost Text & AI Code Actions state
  const [copilotActive, setCopilotActive] = useState<boolean>(isCopilotEnabled);
  const [copilotStatus, setCopilotStatus] = useState<'idle' | 'generating' | 'suggested' | 'disabled'>('idle');
  const [copilotLatency, setCopilotLatency] = useState<number | null>(null);
  const [isActionModalOpen, setIsActionModalOpen] = useState<boolean>(false);

  // Multi-Cursor & Git Diff Annotations state
  const [cursorCount, setCursorCount] = useState<number>(1);
  const [diffRanges, setDiffRanges] = useState<GitDiffRange[]>([]);
  const [diffSummary, setDiffSummary] = useState<GitDiffSummary | null>(null);
  const gitDecorationsRef = useRef<string[]>([]);
  const multiCursorControllerRef = useRef<any>(null);
  const monacoInstanceRef = useRef<any>(null);
  const diffRangesRef = useRef<GitDiffRange[]>([]);

  useEffect(() => {
    diffRangesRef.current = diffRanges;
  }, [diffRanges]);

  const editorRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (multiCursorControllerRef.current) {
        multiCursorControllerRef.current.dispose();
      }
    };
  }, []);

  const configFilePath = config.filePath;

  const loadGitDiffRanges = useCallback(async (filePath?: string) => {
    const targetPath = filePath || configFilePath;
    if (!targetPath || mode !== 'editor') return;
    try {
      const res = await fetchGitDiffRanges(targetPath, currentWorkspace);
      setDiffRanges(res.ranges || []);
      setDiffSummary(res.summary || null);
      if (editorRef.current && monacoInstanceRef.current) {
        gitDecorationsRef.current = applyGitDecorations(
          editorRef.current,
          monacoInstanceRef.current,
          res.ranges || [],
          gitDecorationsRef.current
        );
      }
    } catch {
      setDiffRanges([]);
      setDiffSummary(null);
    }
  }, [configFilePath, mode, currentWorkspace]);

  useEffect(() => {
    if (!configFilePath || mode !== 'editor') return;
    let isCancelled = false;
    fetchGitDiffRanges(configFilePath, currentWorkspace)
      .then((res) => {
        if (!isCancelled) {
          setDiffRanges(res.ranges || []);
          setDiffSummary(res.summary || null);
          if (editorRef.current && monacoInstanceRef.current) {
            gitDecorationsRef.current = applyGitDecorations(
              editorRef.current,
              monacoInstanceRef.current,
              res.ranges || [],
              gitDecorationsRef.current
            );
          }
        }
      })
      .catch(() => {
        if (!isCancelled) {
          setDiffRanges([]);
          setDiffSummary(null);
        }
      });
    return () => {
      isCancelled = true;
    };
  }, [configFilePath, mode, currentWorkspace]);


  // Sync theme with Antigravity appearance changes
  useEffect(() => {
    const handleThemeChange = () => {
      setTheme(getInitialMonacoTheme());
    };
    window.addEventListener('antigravity-appearance-change', handleThemeChange);
    return () => window.removeEventListener('antigravity-appearance-change', handleThemeChange);
  }, []);

  // Listen to Copilot status and toggle events
  useEffect(() => {
    const handleStatus = (e: any) => {
      if (e.detail?.status) setCopilotStatus(e.detail.status);
      if (typeof e.detail?.latency === 'number') setCopilotLatency(e.detail.latency);
    };
    const handleToggle = (e: any) => {
      if (typeof e.detail?.enabled === 'boolean') {
        setCopilotActive(e.detail.enabled);
      }
    };
    window.addEventListener('antigravity:copilot-status', handleStatus);
    window.addEventListener('antigravity:copilot-toggle', handleToggle);
    return () => {
      window.removeEventListener('antigravity:copilot-status', handleStatus);
      window.removeEventListener('antigravity:copilot-toggle', handleToggle);
    };
  }, []);

  // Keyboard shortcut Alt+C to toggle Copilot
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        const next = !copilotActive;
        setCopilotActive(next);
        setCopilotEnabled(next);
        showToast(next ? 'AI Copilot activé' : 'AI Copilot mis en pause', 'info');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copilotActive]);

  // Fetch file content if in editor mode without pre-supplied content
  useEffect(() => {
    if (!needsFetchFile || !config.filePath) return;
    let isCancelled = false;
    fetchFileContent(config.filePath, currentWorkspace)
      .then((res) => {
        if (isCancelled) return;
        setContent(res.content);
        setOriginalContent(res.content);
        setLanguage(detectLanguage(config.filePath));
      })
      .catch((err) => {
        showToast(t('load_error_with_msg', 'Erreur chargement: {0}', err.message), 'error');
      })
      .finally(() => {
        if (!isCancelled) setIsLoadingFile(false);
      });
    return () => { isCancelled = true; };
  }, [needsFetchFile, config.filePath, currentWorkspace, t]);

  // Fetch git file versions if in diff mode without pre-supplied content
  useEffect(() => {
    if (!needsFetch) return;
    let isCancelled = false;
    fetchGitFileVersions(currentWorkspace, config.filePath)
      .then((res) => {
        if (isCancelled) return;
        setOriginalContent(res.original || '');
        setModifiedContent(res.modified || '');
      })
      .catch(() => {
        if (!isCancelled && config.diffText) {
          setContent(config.diffText);
          setMode('editor');
          setLanguage('diff');
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingVersions(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [config, currentWorkspace, needsFetch]);

  // Handle Save (Ctrl+S / Cmd+S or button)
  const handleSave = useCallback(async () => {
    if (!config.filePath) {
      showToast(t('editor_scratchpad_no_file', 'Le scratchpad temporaire ne possède pas de chemin de fichier sur le disque.'), 'info');
      return;
    }

    setIsSaving(true);
    setSaveStatus('idle');
    try {
      const codeToSave = mode === 'diff' ? modifiedContent : content;
      await saveFileContent(config.filePath, codeToSave, currentWorkspace);
      setSaveStatus('saved');
      showToast(t('editor_file_saved', 'Fichier enregistré avec succès sur le disque.'), 'success');
      loadGitDiffRanges(config.filePath);
      setTimeout(() => setSaveStatus('idle'), 3000);
    } catch (err: any) {
      setSaveStatus('error');
      showToast(err.message || t('editor_file_save_error', "Erreur lors de l'enregistrement du fichier"), 'error');
    } finally {
      setIsSaving(false);
    }
  }, [config, mode, modifiedContent, content, currentWorkspace, loadGitDiffRanges, t]);

  // Handle Format Code (Shift+Alt+F)
  const handleFormat = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.getAction('editor.action.formatDocument')?.run();
      showToast(t('document_formatted', 'Document formaté'), 'info');
    }
  }, [t]);

  // Handle Find in File (Ctrl+F)
  const handleFind = useCallback(() => {
    if (editorRef.current) {
      editorRef.current.getAction('actions.find')?.run();
    }
  }, []);

  // Keyboard shortcut listener (Ctrl+S to save, Escape to close, Shift+Alt+F to format)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      } else if (e.shiftKey && e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        handleFormat();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave, handleFormat, onClose]);

  // Handle Copy to clipboard
  const handleCopy = useCallback(() => {
    const textToCopy = mode === 'diff' ? (modifiedContent || content) : content;
    navigator.clipboard.writeText(textToCopy).then(() => {
      setCopied(true);
      showToast(t('copied_to_clipboard', 'Code copié dans le presse-papiers'), 'info');
      setTimeout(() => setCopied(false), 2000);
    });
  }, [mode, modifiedContent, content, t]);

  // Handle AI Explanation
  const handleExplain = useCallback(() => {
    const activeCode = mode === 'diff' ? modifiedContent : content;
    if (onExplainCode) {
      onExplainCode(activeCode, language, config.filePath);
      onClose();
    } else {
      showToast(t('editor_explain_hint', 'Pour expliquer ce code, copiez-le dans le chat ou utilisez /explain.'), 'info');
    }
  }, [mode, modifiedContent, content, onExplainCode, language, config.filePath, onClose, t]);

  // Handle Code Execution
  const handleExecute = useCallback(() => {
    const activeCode = mode === 'diff' ? modifiedContent : content;
    const lang = language.toLowerCase();
    const isSupported = ['python', 'py', 'shell', 'bash', 'sh', 'zsh', 'javascript', 'js', 'node'].includes(lang);

    if (!isSupported) {
      showToast(t('editor_execute_unsupported', 'Exécution disponible pour Python, Shell et JavaScript.'), 'warning');
      return;
    }

    if (onExecuteCode) {
      onExecuteCode(activeCode, language);
      showToast(t('editor_executing', 'Exécution du code en arrière-plan...'), 'info');
      return;
    }

    const trimmed = activeCode.trim();
    if (!trimmed) {
      showToast(t('editor_execute_empty', 'Aucun code à exécuter'), 'warning');
      return;
    }

    let command: string | null = null;
    if (['shell', 'bash', 'sh', 'zsh'].includes(lang)) {
      command = trimmed;
    } else if (['python', 'py'].includes(lang)) {
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      command = `python -c "${escaped}"`;
    } else if (['javascript', 'js', 'node'].includes(lang)) {
      const escaped = trimmed.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      command = `node -e "${escaped}"`;
    }

    if (command) {
      window.dispatchEvent(new CustomEvent('terminal-run-command', { detail: { command } }));
      showToast(t('code_sent_to_terminal', 'Code envoyé au terminal'), 'success');
    }
  }, [mode, modifiedContent, content, onExecuteCode, language, t]);

  // Display title / filename
  const displayTitle = useMemo(() => {
    if (config.title) return config.title;
    if (config.filePath) {
      const parts = config.filePath.replace(/\\/g, '/').split('/');
      return parts[parts.length - 1];
    }
    return t('monaco_studio_scratchpad', 'Scratchpad Monaco');
  }, [config, t]);

  return (
    <div
      className={`bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl flex flex-col overflow-hidden transition-all duration-200 ${
        isFullscreen ? 'w-full h-full rounded-none border-none' : 'w-[96vw] max-w-6xl h-[88vh]'
      }`}
    >
      {/* Top Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-zinc-800 bg-zinc-950/80 select-none">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
            {mode === 'diff' ? <GitCompare className="w-4 h-4" /> : <Code2 className="w-4 h-4" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2
                id="monaco-studio-title"
                className="text-sm font-semibold text-zinc-100 truncate max-w-md tracking-tight"
              >
                {displayTitle}
              </h2>
              {config.filePath && (
                <span className="hidden sm:inline text-xs font-mono px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700/50 truncate max-w-xs">
                  {config.filePath}
                </span>
              )}
            </div>
            <p className="text-[11px] text-zinc-400">
              {mode === 'diff'
                ? t('monaco_diff_desc', 'Comparaison sémantique et analyse de patchs')
                : t('monaco_editor_desc', 'Éditeur de code complet avec actions Code Lens')}
            </p>
          </div>
        </div>

        {/* Center Mode & Language Selector */}
        <div className="flex items-center gap-1.5 bg-zinc-900/90 p-1 rounded-xl border border-zinc-800">
          {/* Mode switch */}
          <button
            type="button"
            onClick={() => setMode('editor')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
              mode === 'editor'
                ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" />
            <span>{t('monaco_mode_editor', 'Éditeur')}</span>
          </button>
          <button
            type="button"
            onClick={() => setMode('diff')}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
              mode === 'diff'
                ? 'bg-zinc-800 text-emerald-400 shadow-sm border border-emerald-500/30'
                : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <GitCompare className="w-3.5 h-3.5" />
            <span>{t('monaco_mode_diff', 'Diff Sémantique')}</span>
          </button>

          {/* Language dropdown */}
          <div className="h-4 w-px bg-zinc-800 mx-1" />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            aria-label={t('select_language', 'Sélectionner le langage')}
            className="bg-zinc-950 text-xs text-zinc-200 rounded-lg px-2 py-1 border border-zinc-800 focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map((lang) => (
              <option key={lang.id} value={lang.id}>
                {lang.name}
              </option>
            ))}
          </select>
        </div>

        {/* Right Action controls */}
        <div className="flex items-center gap-1.5">
          {saveStatus === 'saved' && (
            <span className="flex items-center gap-1 text-xs text-emerald-400 bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t('editor_saved', 'Enregistré')}</span>
            </span>
          )}
          {saveStatus === 'error' && (
            <span className="flex items-center gap-1 text-xs text-rose-400 bg-rose-500/10 px-2 py-1 rounded-lg border border-rose-500/20">
              <AlertCircle className="w-3.5 h-3.5" />
              <span>{t('editor_error', 'Erreur')}</span>
            </span>
          )}

          {config.filePath && (
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              title={t('save_to_disk_tooltip', 'Enregistrer sur le disque (Ctrl+S)')}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-600/20 hover:bg-emerald-600/30 active:scale-95 rounded-lg border border-emerald-500/40 transition-all disabled:opacity-50"
            >
              {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{t('editor_save_btn', 'Enregistrer')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? t('editor_restore', 'Restaurer') : t('editor_fullscreen', 'Plein écran')}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            title={t('close_esc_tooltip', 'Fermer (Échap)')}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Code Lens Quick-Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-zinc-950/40 border-b border-zinc-800/80 text-xs">
        <div className="flex items-center gap-1.5">
          {/* Play Button for executable scripts */}
          {['python', 'py', 'shell', 'bash', 'sh', 'zsh', 'javascript', 'js', 'node'].includes(language.toLowerCase()) && (
            <button
              type="button"
              onClick={handleExecute}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-amber-300 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg transition-colors"
              title={t('run_in_shell_tooltip', 'Exécuter ce code dans le shell interactif')}
            >
              <Play className="w-3 h-3 fill-amber-400" />
              <span>{t('editor_lens_run', 'Exécuter')}</span>
            </button>
          )}

          {/* Explain with AI */}
          <button
            type="button"
            onClick={handleExplain}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-purple-300 bg-purple-500/10 hover:bg-purple-500/20 border border-purple-500/30 rounded-lg transition-colors"
            title={t('ask_antigravity_tooltip', "Demander à Antigravity d'analyser, expliquer ou débugger ce code")}
          >
            <BrainCircuit className="w-3.5 h-3.5" />
            <span>{t('editor_lens_explain', 'Expliquer avec Antigravity')}</span>
          </button>

          {/* Format button */}
          {mode === 'editor' && (
            <button
              type="button"
              onClick={handleFormat}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-lg transition-colors"
              title={t('format_doc_tooltip', 'Formater le document (Shift+Alt+F)')}
            >
              <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
              <span>{t('format', 'Formater')}</span>
            </button>
          )}

          {/* Find button */}
          <button
            type="button"
            onClick={handleFind}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-lg transition-colors"
            title={t('find_in_file_tooltip', 'Rechercher dans le fichier (Ctrl+F)')}
          >
            <Search className="w-3.5 h-3.5 text-sky-400" />
            <span>{t('find', 'Rechercher')}</span>
          </button>

          {/* Copy button */}
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/60 hover:bg-zinc-800 border border-zinc-700/60 rounded-lg transition-colors"
            title={t('copy_code_tooltip', 'Copier le code dans le presse-papiers')}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? t('copied', 'Copié !') : t('copy', 'Copier')}</span>
          </button>

          {/* AI Code Actions Studio Button */}
          {mode === 'editor' && (
            <button
              type="button"
              onClick={() => setIsActionModalOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-sky-300 bg-sky-500/10 hover:bg-sky-500/20 border border-sky-500/30 rounded-lg transition-colors cursor-pointer"
              title={t('ai_code_actions_tooltip', 'Ouvrir le Studio de Code Actions IA (Refactor, Types, Docs, Tests)')}
            >
              <Wand2 className="w-3.5 h-3.5 text-sky-400" />
              <span>{t('ai_actions', 'Actions IA')}</span>
            </button>
          )}

          {/* Copilot Ghost Text Toggle Pill */}
          {mode === 'editor' && (
            <button
              type="button"
              onClick={() => {
                const next = !copilotActive;
                setCopilotActive(next);
                setCopilotEnabled(next);
                showToast(next ? 'AI Copilot activé (Tab pour insérer)' : 'AI Copilot en pause', 'info');
              }}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors border cursor-pointer ${
                copilotActive
                  ? 'bg-purple-500/15 text-purple-300 border-purple-500/30 hover:bg-purple-500/25'
                  : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/60 hover:text-zinc-300'
              }`}
              title={t('copilot_ghost_tooltip', 'Activer ou mettre en pause AI Copilot Ghost Text (Alt+C)')}
            >
              <Zap className={`w-3.5 h-3.5 ${copilotStatus === 'generating' ? 'animate-pulse text-amber-400' : copilotActive ? 'text-purple-400' : ''}`} />
              <span>Copilot {copilotActive ? 'Actif' : 'En pause'}</span>
              {copilotLatency !== null && copilotActive && (
                <span className="text-[10px] opacity-70 font-mono">({copilotLatency}ms)</span>
              )}
            </button>
          )}
        </div>

        {/* View Toggles */}
        <div className="flex items-center gap-2 text-zinc-400">
          {mode === 'diff' && (
            <button
              type="button"
              onClick={() => setIsSplitView(!isSplitView)}
              className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
                isSplitView
                  ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
                  : 'text-zinc-400 hover:text-zinc-200 border-transparent'
              }`}
              title={t('toggle_split_view_tooltip', 'Basculer entre vue côte-à-côte (split) et unifiée (inline)')}
            >
              {isSplitView ? <Columns className="w-3 h-3" /> : <Split className="w-3 h-3" />}
              <span>{isSplitView ? t('monaco_split_view', 'Côte-à-côte') : t('monaco_inline_view', 'Unifié')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => setIsWordWrap(!isWordWrap)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
              isWordWrap
                ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300 border-transparent'
            }`}
            title={t('word_wrap_toggle', 'Activer ou désactiver le retour à la ligne automatique')}
          >
            <WrapText className="w-3 h-3" />
            <span>{t('monaco_word_wrap', 'Retour à la ligne')}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsMinimap(!isMinimap)}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium border transition-colors ${
              isMinimap
                ? 'bg-zinc-800 text-zinc-200 border-zinc-700'
                : 'text-zinc-500 hover:text-zinc-300 border-transparent'
            }`}
            title={t('toggle_minimap_tooltip', 'Afficher ou masquer la minicarte de navigation')}
          >
            <MapPin className="w-3 h-3" />
            <span>{t('monaco_minimap', 'Minimap')}</span>
          </button>
        </div>
      </div>

      {/* Monaco Editor / Diff Container */}
      <div className="flex-1 w-full relative bg-zinc-950">
        {isLoadingVersions ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/80 z-20">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs text-zinc-400">{t('monaco_loading_versions', 'Récupération des versions du fichier Git...')}</p>
          </div>
        ) : null}

        {isLoadingFile ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/80 z-20">
            <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
            <p className="text-xs text-zinc-400">{t('monaco_loading_file', 'Chargement du contenu du fichier...')}</p>
          </div>
        ) : null}

        {mode === 'diff' ? (
          <DiffEditor
            height="100%"
            language={language}
            theme={theme}
            original={originalContent}
            keepCurrentOriginalModel={true}
            keepCurrentModifiedModel={true}
            options={{
              renderSideBySide: isSplitView,
              wordWrap: isWordWrap ? 'on' : 'off',
              minimap: { enabled: isMinimap },
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              readOnly: false,
              automaticLayout: true,
              diffWordWrap: isWordWrap ? 'on' : 'off',
            }}
            onMount={(editor) => {
              editorRef.current = editor;
              const modifiedEditor = editor.getModifiedEditor();
              modifiedEditor.onDidChangeModelContent(() => {
                setModifiedContent(modifiedEditor.getValue());
              });
            }}
            loading={
              <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span className="text-xs">{t('monaco_diff_studio_init', 'Initialisation du studio de diff Monaco...')}</span>
              </div>
            }
          />
        ) : (
          <Editor
            height="100%"
            language={language}
            theme={theme}
            value={content}
            onChange={(value) => setContent(value || '')}
            options={{
              ...getMonacoMultiCursorOptions(),
              wordWrap: isWordWrap ? 'on' : 'off',
              minimap: { enabled: isMinimap },
              fontSize: 13,
              fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
              smoothScrolling: true,
              cursorBlinking: 'smooth',
              lineNumbers: 'on',
              folding: true,
              bracketPairColorization: { enabled: true },
              automaticLayout: true,
              formatOnPaste: true,
              formatOnType: true,
              inlineSuggest: {
                enabled: copilotActive,
                mode: 'subwordSmart',
                showToolbar: 'always',
              },
            }}
            onMount={(editor, monaco) => {
              editorRef.current = editor;
              monacoInstanceRef.current = monaco;
              registerMonacoCopilot(monaco, {
                onStatusChange: (s) => setCopilotStatus(s)
              });

              if (multiCursorControllerRef.current) {
                multiCursorControllerRef.current.dispose();
              }
              const multiCtrl = setupMultiCursor(editor, monaco, (count) => {
                setCursorCount(count);
              });
              multiCursorControllerRef.current = multiCtrl;

              editor.addCommand(monaco.KeyCode.F7, () => {
                navigateGitDiff(editor, diffRangesRef.current, 'next');
              });
              editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F7, () => {
                navigateGitDiff(editor, diffRangesRef.current, 'prev');
              });

              if (config.filePath) {
                loadGitDiffRanges(config.filePath);
              }
            }}
            loading={
              <div className="flex items-center justify-center h-full gap-2 text-zinc-500">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500" />
                <span className="text-xs">{t('monaco_loading_engine', 'Chargement du moteur Monaco...')}</span>
              </div>
            }
          />
        )}
      </div>

      {/* Bottom Footer Info Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-950 border-t border-zinc-800 text-[11px] text-zinc-500 select-none">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400">
            <Sparkles className="w-3 h-3" />
            <span>Antigravity Monaco Studio</span>
          </span>
          {cursorCount > 1 && (
            <>
              <span>•</span>
              <button
                type="button"
                onClick={() => multiCursorControllerRef.current?.resetToSingleCursor()}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] hover:bg-amber-500/25 transition-colors cursor-pointer"
                title={t('multiple_cursors_tooltip', 'Curseurs multiples actifs. Cliquez pour réinitialiser à un seul curseur (ou Échap).')}
              >
                <Layers className="w-3 h-3" />
                <span>{cursorCount} curseurs</span>
                <X className="w-3 h-3 opacity-60 hover:opacity-100" />
              </button>
            </>
          )}
          <span>•</span>
          <span>{language.toUpperCase()}</span>
          <span>•</span>
          <span>UTF-8</span>
        </div>

        <div className="flex items-center gap-3">
          {diffSummary && diffSummary.total_changes > 0 && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-[10px]">
              <span
                onClick={() => navigateGitDiff(editorRef.current, diffRangesRef.current, 'next')}
                className="cursor-pointer hover:underline flex items-center gap-1 font-semibold"
                title={t('git_next_change_hint', 'Modifications Git. Cliquez pour aller à la modification suivante (F7).')}
              >
                <span className="text-emerald-400">+{diffSummary.added_lines}</span>
                <span className="text-sky-400">~{diffSummary.modified_lines}</span>
                <span className="text-rose-400">-{diffSummary.deleted_lines}</span>
              </span>
              <div className="flex items-center border-l border-zinc-700/60 pl-1.5 ml-1 gap-1">
                <button
                  type="button"
                  onClick={() => navigateGitDiff(editorRef.current, diffRangesRef.current, 'prev')}
                  className="p-0.5 hover:text-zinc-100 rounded cursor-pointer"
                  title={t('git_prev_change_hint', 'Modification précédente (Shift+F7)')}
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  type="button"
                  onClick={() => navigateGitDiff(editorRef.current, diffRangesRef.current, 'next')}
                  className="p-0.5 hover:text-zinc-100 rounded cursor-pointer"
                  title={t('git_next_change_f7', 'Modification suivante (F7)')}
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">Ctrl+S</kbd> {t('save', 'Enregistrer')}
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 font-mono text-[10px] border border-zinc-700">{t('key_escape', 'Échap')}</kbd> {t('close', 'Fermer')}
          </span>
        </div>
      </div>

      {/* AI Code Actions Modal */}
      <CopilotActionModal
        isOpen={isActionModalOpen}
        code={content}
        language={language}
        filePath={config.filePath}
        theme={theme}
        onClose={() => setIsActionModalOpen(false)}
        onApply={(newCode) => {
          setContent(newCode);
          if (editorRef.current && typeof editorRef.current.setValue === 'function') {
            editorRef.current.setValue(newCode);
          }
        }}
      />
    </div>
  );
};

export const MonacoStudioModal: React.FC<MonacoStudioModalProps> = ({
  isOpen,
  onClose,
  config,
  onExplainCode,
  onExecuteCode,
  currentWorkspace,
}) => {
  if (!isOpen || !config) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/75 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
      aria-labelledby="monaco-studio-title"
    >
      <MonacoStudioInner
        key={`${config.filePath || 'scratch'}-${config.mode || 'editor'}`}
        config={config}
        onClose={onClose}
        onExplainCode={onExplainCode}
        onExecuteCode={onExecuteCode}
        currentWorkspace={currentWorkspace}
      />
    </div>
  );
};
