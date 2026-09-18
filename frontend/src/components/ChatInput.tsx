import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  Square, 
  Slash, 
  Zap, 
  SlidersHorizontal, 
  Cpu, 
  Layers, 
  X, 
  Mic, 
  MicOff,
  Folder,
  Paperclip,
  CheckCircle2,
  AlertCircle,
  FileText,
  History,
  Trash2,
  Clock,
  Search
} from 'lucide-react';
import type { ModelOption } from '../types';
import { ContextRing, type TokenUsageData } from './ContextRing';
import { ALL_SLASH_COMMANDS, parseSlashCommand, type SlashCommandDef } from '../services/commands';
import { applyTheme } from '../services/theme';
import { useI18n, setLanguage, SUPPORTED_LANGUAGES, getCurrentLanguage } from '../services/i18n';

interface ChatInputProps {
  onSendMessage: (
    prompt: string,
    options: {
      model?: string;
      effort?: string;
      autoApprove?: boolean;
      mode?: 'normal' | 'queue' | 'steer';
    }
  ) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  selectedEffort: 'low' | 'medium' | 'high';
  onSelectEffort: (e: 'low' | 'medium' | 'high') => void;
  initialPrompt?: string;
  pastUserPrompts?: string[];
  usage?: TokenUsageData;
  queueCount?: number;
  onClearQueue?: () => void;
  currentWorkspace?: string;
  onClearChat?: () => void;
  onNewChat?: () => void;
  onOpenTerminal?: () => void;
  onOpenGit?: () => void;
  onOpenKanban?: () => void;
  onOpenCrons?: () => void;
  onOpenRules?: () => void;
  onOpenSkills?: () => void;
  onOpenTasks?: () => void;
  onOpenLanguages?: () => void;
  onOpenFileExplorer?: () => void;
  onOpenWorkspace?: () => void;
  onOpenExport?: () => void;
  onOpenHelp?: () => void;
  onForkMessage?: () => void;
  onRenameTitle?: (newTitle: string) => void;
  onRetry?: () => void;
  onUndo?: () => void;
  onShowStatus?: () => void;
  onShowUsage?: (type?: 'usage' | 'quota' | 'credits' | 'changelog') => void;
  onOpenGoogleAccount?: () => void;
  onOpenUpdates?: () => void;
  onShowUpdateCard?: () => void;
}

export interface AttachmentItem {
  id: string;
  name: string;
  size: number;
  type: string;
  content: string;
  isImage: boolean;
  previewUrl?: string;
}

const createAttachmentId = (): string => `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const ChatInput = React.memo<ChatInputProps>(({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  models,
  selectedModel,
  onSelectModel,
  selectedEffort,
  onSelectEffort,
  initialPrompt = '',
  pastUserPrompts = [],
  usage,
  queueCount = 0,
  onClearQueue,
  currentWorkspace,
  onClearChat,
  onNewChat,
  onOpenTerminal,
  onOpenGit,
  onOpenKanban,
  onOpenCrons,
  onOpenRules,
  onOpenSkills,
  onOpenTasks,
  onOpenLanguages,
  onOpenFileExplorer,
  onOpenWorkspace,
  onOpenExport,
  onOpenHelp,
  onForkMessage,
  onRenameTitle,
  onRetry,
  onUndo,
  onShowStatus,
  onShowUsage,
  onOpenGoogleAccount,
  onOpenUpdates,
  onShowUpdateCard
}) => {
  const { lang, t } = useI18n();
  const currentLangObj = SUPPORTED_LANGUAGES.find((l) => l.code === lang) || SUPPORTED_LANGUAGES[0];
  const [prompt, setPrompt] = useState(initialPrompt);
  const [autoApprove, setAutoApprove] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  // Attachment states
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'info' | 'error' = 'info') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToastMessage({ text, type });
    toastTimerRef.current = setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const handleAddFiles = useCallback((files: File[]) => {
    if (!files || files.length === 0) return;
    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo
    const MAX_ATTACHMENTS = 10;

    setAttachments((prev) => {
      let current = [...prev];
      for (const file of files) {
        if (current.length >= MAX_ATTACHMENTS) {
          showToast(t('toast_attachment_limit', 'Maximum limit of {0} attachments reached.').replace('{0}', String(MAX_ATTACHMENTS)), 'info');
          break;
        }
        if (file.size > MAX_FILE_SIZE) {
          showToast(t('toast_file_size_limit', 'File "{0}" exceeds the allowed limit of 10 MB.').replace('{0}', file.name), 'error');
          continue;
        }
        const isImg = file.type.startsWith('image/');
        const reader = new FileReader();
        const id = createAttachmentId();
        reader.onerror = () => {
          showToast(t('toast_read_file_error', 'Unable to read file "{0}"').replace('{0}', file.name), 'error');
        };
        if (isImg) {
          reader.onload = (e) => {
            const content = e.target?.result as string;
            setAttachments((latest) => [
              ...latest,
              {
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                content,
                isImage: true,
                previewUrl: content
              }
            ]);
          };
          reader.readAsDataURL(file);
        } else {
          reader.onload = (e) => {
            const content = (e.target?.result as string) || '';
            setAttachments((latest) => [
              ...latest,
              {
                id,
                name: file.name,
                size: file.size,
                type: file.type,
                content,
                isImage: false
              }
            ]);
          };
          reader.readAsText(file);
        }
      }
      return current;
    });
  }, [showToast]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const basePromptRef = useRef<string>('');
  const finalSpeechRef = useRef<string>('');

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {}
        recognitionRef.current = null;
      }
    };
  }, []);

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }
      setIsListening(false);
      basePromptRef.current = '';
      finalSpeechRef.current = '';
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast(t('toast_speech_not_supported', 'Speech recognition is not supported by this browser.'), 'error');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = currentLangObj?.speech || 'fr-FR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
        basePromptRef.current = prompt;
        finalSpeechRef.current = '';
      };

      recognition.onresult = (event: any) => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const res = event.results[i];
          const text = res[0]?.transcript || '';
          if (res.isFinal) {
            finalSpeechRef.current += (finalSpeechRef.current ? ' ' : '') + text.trim();
          } else {
            interim += (interim ? ' ' : '') + text.trim();
          }
        }
        const spoken = (finalSpeechRef.current + (interim ? ' ' + interim : '')).trim();
        const base = basePromptRef.current;
        const separator = base && !base.endsWith(' ') && spoken ? ' ' : '';
        setPrompt(base + separator + spoken);
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition event:', e);
        setIsListening(false);
        basePromptRef.current = '';
        finalSpeechRef.current = '';
        recognitionRef.current = null;
      };

      recognition.onend = () => {
        setIsListening(false);
        basePromptRef.current = '';
        finalSpeechRef.current = '';
        recognitionRef.current = null;
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setIsListening(false);
      basePromptRef.current = '';
      finalSpeechRef.current = '';
      recognitionRef.current = null;
    }
  };

  const [prevInitialPrompt, setPrevInitialPrompt] = useState(initialPrompt);
  if (initialPrompt !== prevInitialPrompt) {
    setPrevInitialPrompt(initialPrompt);
    if (initialPrompt) {
      setPrompt(initialPrompt);
    }
  }

  useEffect(() => {
    if (initialPrompt) {
      textareaRef.current?.focus();
    }
  }, [initialPrompt]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.abort();
        } catch {
          // ignore
        }
        recognitionRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  // Prompt History States & Navigation (Terminal-like)
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const historyIndexRef = useRef<number>(-1);
  const draftRef = useRef<string>('');
  const historyMenuRef = useRef<HTMLDivElement>(null);
  const historyButtonRef = useRef<HTMLButtonElement>(null);

  // Helper to retrieve and merge persistent history + discussion prompts
  const getMergedHistory = (): string[] => {
    let saved: string[] = [];
    try {
      const raw = localStorage.getItem('antigravity_prompt_history');
      if (raw) saved = JSON.parse(raw);
      if (!Array.isArray(saved)) saved = [];
    } catch {
      saved = [];
    }
    saved = saved.filter((s) => typeof s === 'string' && s.trim());
    const discussion = (pastUserPrompts || []).filter((s) => typeof s === 'string' && s.trim());

    // Discussion prompts appear at the latest end of history
    // Filter out older saved items that already appear in discussion to avoid duplicate cycling
    const discussionSet = new Set(discussion);
    const olderSaved = saved.filter((s) => !discussionSet.has(s));

    const combined = [...olderSaved, ...discussion];
    const result: string[] = [];
    for (const item of combined) {
      const t = item.trim();
      if (result.length === 0 || result[result.length - 1] !== t) {
        result.push(t);
      }
    }
    return result;
  };

  const savePromptToHistory = (rawPrompt: string) => {
    const trimmed = rawPrompt.trim();
    if (!trimmed) return;
    try {
      const key = 'antigravity_prompt_history';
      const stored = localStorage.getItem(key);
      let list: string[] = stored ? JSON.parse(stored) : [];
      if (!Array.isArray(list)) list = [];
      if (list.length === 0 || list[list.length - 1] !== trimmed) {
        list.push(trimmed);
        if (list.length > 100) list = list.slice(-100);
        localStorage.setItem(key, JSON.stringify(list));
      }
    } catch (err) {
      console.warn('Failed to save prompt to localStorage:', err);
    }
  };

  const clearStoredHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      localStorage.removeItem('antigravity_prompt_history');
      showToast(t('clear_prompt_history', 'Prompt history cleared'), 'info');
      setShowHistoryMenu(false);
    } catch (err) {
      console.error(err);
    }
  };

  // Close history menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        showHistoryMenu &&
        historyMenuRef.current &&
        !historyMenuRef.current.contains(event.target as Node) &&
        historyButtonRef.current &&
        !historyButtonRef.current.contains(event.target as Node)
      ) {
        setShowHistoryMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showHistoryMenu]);

  // Reset navigation pointer when conversation changes
  useEffect(() => {
    historyIndexRef.current = -1;
    draftRef.current = '';
  }, [pastUserPrompts]);

  const handleSelectHistoryItem = (selectedText: string) => {
    setPrompt(selectedText);
    setShowHistoryMenu(false);
    historyIndexRef.current = -1;
    draftRef.current = '';
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        textareaRef.current.selectionStart = selectedText.length;
        textareaRef.current.selectionEnd = selectedText.length;
      }
    }, 50);
  };

  const currentModelObj = models.find((m) => m.id === selectedModel) || models[0];
  const isCurrentClaude = (currentModelObj?.id || selectedModel || '').toLowerCase().includes('claude');
  const supportedEfforts = isCurrentClaude ? [] : (currentModelObj?.supported_efforts ?? []);
  const hasEffortSupport = supportedEfforts.length > 0;

  const handleModelChange = (newModelId: string) => {
    const newModelObj = models.find((m) => m.id === newModelId);
    const isClaude = (newModelObj?.id || newModelId || '').toLowerCase().includes('claude');
    const efforts = isClaude ? [] : (newModelObj?.supported_efforts ?? []);
    if (efforts.length > 0) {
      if (!efforts.includes(selectedEffort)) {
        onSelectEffort((newModelObj?.default_effort as any) || (efforts[0] as any) || 'high');
      }
    }
    onSelectModel(newModelId);
    showToast(t('toast_model_applied', 'Model applied: {0}').replace('{0}', newModelObj?.name || newModelId), 'success');
  };

  const filteredCommands = useMemo(() => {
    return ALL_SLASH_COMMANDS.filter((c) =>
      c.cmd.toLowerCase().includes(slashFilter) || c.desc.toLowerCase().includes(slashFilter)
    );
  }, [slashFilter]);

  // Execute or dispatch Slash Command
  const executeSlashAction = (cmdText: string): boolean => {
    const parsed = parseSlashCommand(cmdText);
    if (!parsed) return false;

    const { cmd, args } = parsed;

    switch (cmd) {
      case '/help':
        if (onOpenHelp) onOpenHelp();
        else showToast(t('toast_help_hint', 'Type / to see all available slash commands.'), 'info');
        return true;

      case '/clear':
        if (onClearChat) {
          onClearChat();
          showToast(t('toast_messages_cleared', 'Messages cleared.'), 'success');
        }
        return true;

      case '/new':
        if (onNewChat) {
          onNewChat();
          showToast(t('toast_new_chat_created', 'New conversation created.'), 'success');
        }
        return true;

      case '/theme':
        if (args) {
          const res = applyTheme(args);
          showToast(t('toast_theme_updated', 'Theme / Skin updated: {0}').replace('{0}', res.value), 'success');
        } else {
          showToast(t('toast_theme_usage', 'Usage: /theme <dark|light|system|sienna|catppuccin|ares|zeus...>'), 'info');
        }
        return true;

      case '/account':
      case '/google':
        if (onOpenGoogleAccount) {
          onOpenGoogleAccount();
        } else {
          showToast(t('toast_google_hint', 'Open Settings > Google Account to manage your account.'), 'info');
        }
        return true;

      case '/lang':
      case '/language':
        if (args) {
          const targetLang = args.trim().toLowerCase();
          const match = SUPPORTED_LANGUAGES.find(
            (l) => l.code.toLowerCase() === targetLang || l.label.toLowerCase() === targetLang
          );
          if (match) {
            setLanguage(match.code);
            showToast(t('toast_lang_set', 'Language set to: {0}').replace('{0}', `${match.flag || ''} ${match.label} (${match.code})`), 'success');
          } else {
            showToast(t('toast_lang_unknown', 'Unknown language "{0}". Codes: {1}').replace('{0}', args).replace('{1}', SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')), 'error');
          }
        } else {
          if (onOpenLanguages) onOpenLanguages();
          else if (onOpenHelp) onOpenHelp();
          else showToast(t('toast_lang_current', 'Current language: {0}').replace('{0}', getCurrentLanguage()), 'info');
        }
        return true;

      case '/yolo':
        setAutoApprove((prev) => {
          const next = !prev;
          showToast(next ? t('toast_yolo_on', '⚡ YOLO Mode (Auto-Run) ACTIVATED') : t('toast_yolo_off', 'YOLO Mode deactivated (Confirmation requested)'), next ? 'success' : 'info');
          return next;
        });
        return true;

      case '/terminal':
        if (onOpenTerminal) onOpenTerminal();
        return true;

      case '/git':
        if (onOpenGit) onOpenGit();
        return true;

      case '/kanban':
        if (onOpenKanban) onOpenKanban();
        return true;

      case '/crons':
        if (onOpenCrons) onOpenCrons();
        return true;

      case '/rules':
        if (onOpenRules) onOpenRules();
        return true;

      case '/tasks':
        if (onOpenTasks) onOpenTasks();
        else showToast(t('toast_tasks_unavailable', 'Task dashboard unavailable.'), 'info');
        return true;

      case '/skills':
        if (onOpenSkills) onOpenSkills();
        else showToast(t('toast_skills_installed', 'Antigravity skills installed.'), 'info');
        return true;

      case '/use':
        if (args) {
          handleSubmit('normal', `[Directive de compétence : ${args}] Veuillez consulter et utiliser prioritairement les outils et compétences du skill "${args}".`);
          showToast(t('toast_skill_activated', 'Skill activated: {0}').replace('{0}', args), 'success');
        } else {
          if (onOpenSkills) onOpenSkills();
          else showToast(t('toast_skill_usage', 'Usage: /use <skill_name>'), 'info');
        }
        return true;

      case '/files':
      case '/attach':
        if (onOpenFileExplorer) onOpenFileExplorer();
        else showToast(t('toast_files_unavailable', 'File explorer unavailable.'), 'info');
        return true;

      case '/export':
        if (onOpenExport) onOpenExport();
        return true;

      case '/branch':
        if (onForkMessage) {
          onForkMessage();
          showToast(t('toast_branch_created', 'Branch created.'), 'success');
        }
        return true;

      case '/title':
        if (args && onRenameTitle) {
          onRenameTitle(args);
          showToast(t('toast_conv_renamed', 'Conversation renamed: {0}').replace('{0}', args), 'success');
        } else {
          showToast(t('toast_title_usage', 'Usage: /title <new title>'), 'info');
        }
        return true;

      case '/voice':
        toggleListening();
        return true;

      case '/stop':
        if (isStreaming && onStopStreaming) {
          onStopStreaming();
          showToast(t('toast_exec_stopped', 'Execution stopped.'), 'info');
        }
        return true;

      case '/retry':
        if (onRetry) {
          onRetry();
          showToast(t('toast_retry_launch', 'Relaunching last instruction...'), 'info');
        } else {
          showToast(t('toast_retry_none', 'No previous message to retry.'), 'info');
        }
        return true;

      case '/undo':
        if (onUndo) {
          onUndo();
          showToast(t('toast_step_undone', 'Last step undone.'), 'success');
        } else {
          showToast(t('toast_undo_failed', 'Unable to undo step.'), 'info');
        }
        return true;

      case '/compress':
      case '/compact':
        handleSubmit(
          'normal',
          args
            ? `[Compactage du contexte - Sujet : ${args}] Veuillez résumer et condenser l'historique de cette session de manière concise.`
            : `[Compactage du contexte] Veuillez résumer et condenser l'historique de cette conversation de manière concise pour optimiser la fenêtre de contexte.`
        );
        showToast(t('toast_compress_sent', '🗜️ Context compression request sent...'), 'info');
        return true;

      case '/usage':
      case '/quota':
        if (onShowUsage) {
          onShowUsage('usage');
        } else if (usage) {
          showToast(
            t('toast_tokens_usage', '📊 Tokens: {0} (Input: {1}, Output: {2})').replace('{0}', usage.totalTokens.toLocaleString()).replace('{1}', usage.inputTokens.toLocaleString()).replace('{2}', usage.outputTokens.toLocaleString()),
            'info'
          );
        } else {
          showToast(t('toast_tokens_unavailable', 'Token metrics unavailable.'), 'info');
        }
        return true;

      case '/credits':
        if (onShowUsage) {
          onShowUsage('credits');
        } else {
          showToast(t('toast_credits_check', 'Checking Antigravity credits...'), 'info');
        }
        return true;

      case '/changelog':
        if (onShowUsage) {
          onShowUsage('changelog');
        } else {
          showToast(t('toast_changelog_check', 'Viewing changelog...'), 'info');
        }
        return true;

      case '/status':
        if (onShowStatus) {
          onShowStatus();
        } else {
          const statText = t('toast_server_active', '🟢 Server active | Model: {0} | Workspace: {1}').replace('{0}', currentModelObj?.name || selectedModel).replace('{1}', currentWorkspace || '/root');
          showToast(statText, 'info');
        }
        return true;

      case '/update':
      case '/check-update':
        if (onShowUpdateCard) {
          onShowUpdateCard();
        } else if (onOpenUpdates) {
          onOpenUpdates();
        } else {
          showToast(t('toast_checking_updates', 'Checking for updates...'), 'info');
        }
        return true;

      case '/btw':
        if (args) {
          handleSubmit('normal', `[Aparté / Question rapide] ${args}`);
          return true;
        } else {
          showToast(t('toast_btw_usage', 'Usage: /btw <your side question>'), 'info');
          return true;
        }

      case '/background':
        if (args) {
          handleSubmit('normal', `/goal ${args}`);
          showToast(t('toast_bg_launched', 'Autonomous task launched in background.'), 'success');
          return true;
        } else {
          showToast(t('toast_bg_usage', 'Usage: /background <task instruction>'), 'info');
          return true;
        }

      case '/steer':
        if (args) {
          handleSubmit('steer', args);
          return true;
        } else {
          showToast(t('toast_steer_usage', 'Usage: /steer <new direction>'), 'info');
          return true;
        }

      case '/interrupt':
        if (args) {
          handleSubmit('steer', args);
          return true;
        } else {
          if (isStreaming && onStopStreaming) {
            onStopStreaming();
            showToast(t('toast_exec_stopped', 'Execution stopped.'), 'info');
          } else {
            showToast(t('toast_interrupt_usage', 'Usage: /interrupt <new direction>'), 'info');
          }
          return true;
        }

      case '/queue':
        if (args) {
          handleSubmit('queue', args);
          return true;
        } else {
          showToast(t('toast_queue_usage', 'Usage: /queue <pending instruction>'), 'info');
          return true;
        }

      case '/model':
        if (args) {
          const found = models.find(
            (m) => m.name.toLowerCase().includes(args.toLowerCase()) || m.id.toLowerCase().includes(args.toLowerCase())
          );
          if (found) {
            handleModelChange(found.id);
            showToast(t('toast_model_selected', 'Selected model: {0}').replace('{0}', found.name), 'success');
          } else {
            showToast(t('toast_model_unknown', 'Unknown model: {0}. Models: {1}').replace('{0}', args).replace('{1}', models.map((m) => m.name).join(', ')), 'error');
          }
        } else {
          showToast(t('toast_model_active', 'Active model: {0}').replace('{0}', currentModelObj?.name || selectedModel), 'info');
        }
        return true;

      case '/reasoning':
        if (args && ['low', 'medium', 'high'].includes(args.toLowerCase())) {
          onSelectEffort(args.toLowerCase() as any);
          showToast(t('toast_reasoning_effort_set', 'Reasoning effort set to: {0}').replace('{0}', args), 'success');
        } else {
          showToast(`Effort actuel : ${selectedEffort}. Choix: low, medium, high`, 'info');
        }
        return true;

      case '/workspace':
        if (onOpenWorkspace) {
          onOpenWorkspace();
        } else {
          showToast(`Workspace actif : ${currentWorkspace || '/root'}`, 'info');
        }
        return true;

      default:
        // Workflow commands like /plan, /goal, /boost, /browser, /grill-me, /teamwork-preview, /learn, /schedule continue to prompt send
        return false;
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu && filteredCommands.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectSlashCommand(filteredCommands[selectedIndex]);
        return;
      }
    }

    if (e.key === 'Escape') {
      if (showSlashMenu) {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
      if (showHistoryMenu) {
        e.preventDefault();
        setShowHistoryMenu(false);
        historyIndexRef.current = -1;
        return;
      }
      if (historyIndexRef.current !== -1) {
        e.preventDefault();
        setPrompt(draftRef.current);
        historyIndexRef.current = -1;
        return;
      }
    }

    // Terminal-like prompt history navigation (ArrowUp / ArrowDown)
    if (!showSlashMenu) {
      const textarea = textareaRef.current;
      const cursorStart = textarea ? textarea.selectionStart : 0;
      const cursorEnd = textarea ? textarea.selectionEnd : 0;
      const textBeforeCursor = textarea ? textarea.value.slice(0, cursorStart) : '';
      const textAfterCursor = textarea ? textarea.value.slice(cursorEnd) : '';
      const isAtFirstLine = !textBeforeCursor.includes('\n');
      const isAtLastLine = !textAfterCursor.includes('\n');
      const isSingleLine = !prompt.includes('\n');

      if (e.key === 'ArrowUp') {
        const canNavigateUp = historyIndexRef.current !== -1 || !prompt.trim() || isAtFirstLine || isSingleLine;
        if (canNavigateUp) {
          const history = getMergedHistory();
          if (history.length > 0) {
            e.preventDefault();
            if (historyIndexRef.current === -1) {
              draftRef.current = prompt;
              const newIndex = history.length - 1;
              historyIndexRef.current = newIndex;
              const target = history[newIndex];
              setPrompt(target);
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart = target.length;
                  textareaRef.current.selectionEnd = target.length;
                }
              });
            } else if (historyIndexRef.current > 0) {
              const newIndex = historyIndexRef.current - 1;
              historyIndexRef.current = newIndex;
              const target = history[newIndex];
              setPrompt(target);
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart = target.length;
                  textareaRef.current.selectionEnd = target.length;
                }
              });
            }
            return;
          }
        }
      }

      if (e.key === 'ArrowDown') {
        if (historyIndexRef.current !== -1) {
          const canNavigateDown = isSingleLine || isAtLastLine;
          if (canNavigateDown) {
            const history = getMergedHistory();
            e.preventDefault();
            if (historyIndexRef.current < history.length - 1) {
              const newIndex = historyIndexRef.current + 1;
              historyIndexRef.current = newIndex;
              const target = history[newIndex];
              setPrompt(target);
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart = target.length;
                  textareaRef.current.selectionEnd = target.length;
                }
              });
            } else if (historyIndexRef.current === history.length - 1) {
              historyIndexRef.current = -1;
              const draft = draftRef.current;
              setPrompt(draft);
              requestAnimationFrame(() => {
                if (textareaRef.current) {
                  textareaRef.current.selectionStart = draft.length;
                  textareaRef.current.selectionEnd = draft.length;
                }
              });
            }
            return;
          }
        }
      }
    }

    const sendKeyPref = typeof window !== 'undefined' ? (localStorage.getItem('antigravity_send_key') || 'enter') : 'enter';
    const shouldSend = sendKeyPref === 'ctrlEnter'
      ? (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
      : (e.key === 'Enter' && !e.shiftKey);

    if (shouldSend) {
      e.preventDefault();
      historyIndexRef.current = -1;
      // Check if command is a local action
      if (prompt.trim().startsWith('/')) {
        const handled = executeSlashAction(prompt.trim());
        if (handled) {
          savePromptToHistory(prompt.trim());
          setPrompt('');
          setShowSlashMenu(false);
          return;
        }
      }
      handleSubmit(isStreaming ? 'steer' : 'normal');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setPrompt(val);
    historyIndexRef.current = -1;

    const isCommandTyping = val.startsWith('/') && !val.includes(' ') && !val.includes('\n');
    setShowSlashMenu(isCommandTyping);
    if (isCommandTyping) {
      setSlashFilter(val.slice(1).toLowerCase());
      setSelectedIndex(0);
    }
  };

  const selectSlashCommand = (c: SlashCommandDef) => {
    if (c.isAction && !c.arg) {
      const handled = executeSlashAction(c.cmd);
      if (handled) {
        savePromptToHistory(c.cmd);
        historyIndexRef.current = -1;
        draftRef.current = '';
        setPrompt('');
        setShowSlashMenu(false);
        return;
      }
    }
    setPrompt(`${c.cmd} `);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = (mode: 'normal' | 'queue' | 'steer' = 'normal', overrideText?: string) => {
    let textToSend = overrideText !== undefined ? overrideText : prompt;
    if (!textToSend.trim() && attachments.length === 0) return;

    // Check if it's a direct local slash command (only when no attachments)
    if (attachments.length === 0 && textToSend.trim().startsWith('/')) {
      const handled = executeSlashAction(textToSend.trim());
      if (handled) {
        savePromptToHistory(textToSend.trim());
        historyIndexRef.current = -1;
        draftRef.current = '';
        setPrompt('');
        setShowSlashMenu(false);
        return;
      }
    }

    // Save clean prompt to persistent history
    savePromptToHistory(textToSend);
    historyIndexRef.current = -1;
    draftRef.current = '';
    basePromptRef.current = '';
    finalSpeechRef.current = '';
    if (isListening && recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      setIsListening(false);
    }

    let finalText = textToSend.trim();
    if (attachments.length > 0) {
      for (const att of attachments) {
        if (att.isImage) {
          finalText += `\n\n[Image attachée : ${att.name}]\n${att.content}`;
        } else {
          const content = att.content.length > 50000
            ? `${att.content.slice(0, 50000)}\n[...Tronqué à 50 000 caractères...]`
            : att.content;
          finalText += `\n\n[Fichier attaché : ${att.name} (${Math.round(att.size / 1024)} ko)]\n\`\`\`\n${content}\n\`\`\``;
        }
      }
      setAttachments([]);
    }

    // Resolve concrete model variant ID
    const targetModelObj = models.find((m) => m.id === selectedModel) || models[0];
    const isClaude = (targetModelObj?.id || selectedModel || '').toLowerCase().includes('claude');
    const targetEfforts = isClaude ? [] : (targetModelObj?.supported_efforts ?? []);
    const hasEfforts = targetEfforts.length > 0;
    const resolvedEffort = hasEfforts
      ? (targetEfforts.includes(selectedEffort) ? selectedEffort : (targetModelObj?.default_effort as any) || targetEfforts[0] || 'high')
      : undefined;

    const concreteVariant = (hasEfforts && resolvedEffort && targetModelObj?.variants?.[resolvedEffort])
      ? targetModelObj.variants[resolvedEffort]
      : targetModelObj?.variants?.['default']
        || (targetModelObj?.variants && Object.values(targetModelObj.variants)[0])
        || selectedModel;

    onSendMessage(finalText, {
      model: concreteVariant,
      effort: resolvedEffort,
      autoApprove,
      mode,
    });

    setPrompt('');
    setShowSlashMenu(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.rows = 1;
    }
  };

  return (
    <div
      className="w-full shrink-0 border-t safe-pb"
      style={{
        backgroundColor: 'var(--main-bg, var(--bg))',
        borderColor: 'var(--border-subtle, var(--border))'
      }}
    >
      <div className="relative p-2 sm:p-4 max-w-4xl mx-auto w-full">
        {/* Toast Feedback */}
        {toastMessage && (
          <div className="absolute -top-10 left-1/2 -translate-x-1/2 z-40 animate-fadeIn">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-900/95 border border-slate-700 text-xs text-white shadow-xl backdrop-blur-md">
              {toastMessage.type === 'success' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              )}
              <span>{toastMessage.text}</span>
            </div>
          </div>
        )}

        {/* Hermes Exact Slash Command Popover */}
        {showSlashMenu && (
          <div
            ref={listRef}
            className="absolute bottom-full left-4 right-4 sm:left-5 sm:right-5 mb-3 rounded-2xl shadow-2xl overflow-hidden z-30 backdrop-blur-xl animate-fadeIn border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border2)'
            }}
          >
            <div
              className="px-4 py-2.5 border-b text-[11px] font-semibold flex items-center justify-between"
              style={{
                borderColor: 'var(--border-subtle)',
                color: 'var(--muted)'
              }}
            >
              <div className="flex items-center gap-2">
                <Slash className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span className="uppercase tracking-wider">{t('antigravity_hermes_commands', 'Commandes Antigravity & Hermes')}</span>
              </div>
              <span className="text-[10px] font-mono opacity-70">{t('nav_insert_close_hint', '↑↓ naviguer · ↵ insérer · esc fermer')}</span>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
              {filteredCommands.length === 0 ? (
                <div className="p-4 text-xs text-center" style={{ color: 'var(--muted)' }}>
                  {t('no_matching_command', 'Aucune commande correspondante')}
                </div>
              ) : (
                filteredCommands.map((c, idx) => {
                  const Icon = c.icon;
                  const isSelected = idx === selectedIndex;
                  return (
                    <button
                      key={c.cmd}
                      type="button"
                      onClick={() => selectSlashCommand(c)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className="w-full text-left px-3 py-2 rounded-xl flex items-center justify-between text-xs transition-colors cursor-pointer group"
                      style={{
                        backgroundColor: isSelected ? 'var(--surface-subtle-hover)' : 'transparent',
                        color: 'var(--text)'
                      }}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="w-6 h-6 rounded-lg flex items-center justify-center shrink-0 border"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            borderColor: 'var(--border-subtle)'
                          }}
                        >
                          <Icon className={`w-3.5 h-3.5 ${c.color}`} />
                        </div>
                        <div className="flex items-baseline gap-1.5 truncate">
                          <span className="font-mono font-bold" style={{ color: isSelected ? 'var(--accent)' : 'var(--strong)' }}>
                            {c.cmd}
                          </span>
                          {c.arg && (
                            <span className="text-[10px] font-mono opacity-50">
                              {c.arg}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[11px] truncate max-w-[50%] text-right ml-2" style={{ color: 'var(--muted)' }}>
                        {t(c.descKey || '', c.desc)}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Prompt History Popover */}
        {showHistoryMenu && (
          <div
            ref={historyMenuRef}
            className="absolute bottom-full left-4 right-4 sm:left-5 sm:right-5 mb-3 rounded-2xl shadow-2xl overflow-hidden z-30 backdrop-blur-xl animate-fadeIn border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border2)'
            }}
          >
            <div
              className="px-4 py-2.5 border-b text-[11px] font-semibold flex items-center justify-between"
              style={{
                borderColor: 'var(--border-subtle)',
                color: 'var(--muted)'
              }}
            >
              <div className="flex items-center gap-2">
                <History className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                <span className="uppercase tracking-wider font-bold">Historique des prompts</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-mono bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  {getMergedHistory().length}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {getMergedHistory().length > 0 && (
                  <button
                    type="button"
                    onClick={clearStoredHistory}
                    className="p-1 rounded opacity-50 hover:opacity-100 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title={t('clear_persistent_history', 'Clear persistent history')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
                <span className="text-[10px] font-mono opacity-70">↑↓ naviguer · esc fermer</span>
              </div>
            </div>

            {/* Quick search filter if more than 4 items */}
            {getMergedHistory().length > 4 && (
              <div className="px-3 py-1.5 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                <div
                  className="flex items-center gap-2 px-2.5 py-1 rounded-lg border text-xs"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <Search className="w-3.5 h-3.5 shrink-0 opacity-50" />
                  <input
                    type="text"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    placeholder={t('filter_past_commands', 'Filtrer les commandes passées...')}
                    className="w-full bg-transparent outline-none text-xs"
                    style={{ color: 'var(--text)' }}
                  />
                  {historySearch && (
                    <button type="button" onClick={() => setHistorySearch('')} className="p-0.5 opacity-60 hover:opacity-100">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-1">
              {(() => {
                const merged = getMergedHistory();
                const discSet = new Set(pastUserPrompts || []);
                const items = merged.map((text) => ({
                  text,
                  isCurrentDiscussion: discSet.has(text)
                }));
                const reversed = [...items].reverse();
                const filtered = historySearch.trim()
                  ? reversed.filter((item) => item.text.toLowerCase().includes(historySearch.toLowerCase()))
                  : reversed;

                if (filtered.length === 0) {
                  return (
                    <div className="p-4 text-xs text-center" style={{ color: 'var(--muted)' }}>
                      {historySearch ? t('no_results_match', 'No matching results') : t('no_prompts_history', 'No prompts in history')}
                    </div>
                  );
                }

                return filtered.map((item, idx) => (
                  <button
                    key={`${idx}-${item.text.slice(0, 20)}`}
                    type="button"
                    onClick={() => handleSelectHistoryItem(item.text)}
                    className="w-full text-left px-3 py-2 rounded-xl flex items-start justify-between text-xs transition-colors cursor-pointer group hover:bg-sky-500/10"
                    style={{
                      backgroundColor: 'transparent',
                      color: 'var(--text)'
                    }}
                  >
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 opacity-40 group-hover:opacity-100 text-sky-400 transition-opacity" />
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-xs line-clamp-2 break-words" style={{ color: 'var(--text)' }}>
                          {item.text}
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0 ml-2.5 flex items-center gap-1.5">
                      {item.isCurrentDiscussion ? (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {t('discussion_tag', 'discussion')}
                        </span>
                      ) : (
                        <span className="text-[9px] px-1.5 py-0.5 rounded font-mono bg-slate-500/10 text-slate-400 border border-slate-500/20">
                          {t('recent', 'récent')}
                        </span>
                      )}
                    </div>
                  </button>
                ));
              })()}
            </div>

            <div
              className="px-4 py-2 border-t text-[10px] flex items-center justify-between"
              style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}
            >
              <span>{t('terminal_arrow_keys_tip', '💡 Utilisez les flèches ↑ et ↓ dans le champ de saisie pour naviguer comme dans un terminal.')}</span>
            </div>
          </div>
        )}

        {/* Floating Composer Box - Pure Hermes Design */}
        <div
          className={`hermes-composer-dock p-2.5 sm:p-3.5 relative transition-all ${
            isDraggingOver ? 'ring-2 ring-sky-500/80 border-sky-500' : ''
          }`}
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: isDraggingOver ? 'var(--accent)' : 'var(--border2)'
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDraggingOver(false);
            if (e.dataTransfer.files) {
              handleAddFiles(Array.from(e.dataTransfer.files));
            }
          }}
        >
          {/* Hidden File Input for Paperclip */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) {
                handleAddFiles(Array.from(e.target.files));
              }
              e.target.value = '';
            }}
          />

          {/* Attachment Tray */}
          {attachments.length > 0 && (
            <div className="flex items-center gap-1.5 overflow-x-auto pb-2 mb-1.5 scrollbar-none">
              {attachments.map((att) => (
                <div
                  key={att.id}
                  className="flex items-center gap-1.5 py-1 px-2 rounded-lg border text-xs font-mono shadow-xs shrink-0 group transition-all"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                >
                  {att.isImage && att.previewUrl ? (
                    <img src={att.previewUrl} alt={att.name} className="w-5 h-5 object-cover rounded shrink-0 border" style={{ borderColor: 'var(--border)' }} />
                  ) : (
                    <FileText className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  )}
                  <span className="truncate max-w-[130px] text-[11px] font-sans">{att.name}</span>
                  <span className="text-[10px] opacity-60 font-mono">({Math.round(att.size / 1024)}k)</span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(att.id)}
                    className="p-0.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-red-400 transition-colors cursor-pointer ml-0.5"
                    title={t("remove_attachment", "Remove attachment")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={t('composer_placeholder', 'Posez une question ou tapez / pour les commandes...')}
            rows={1}
            className="w-full bg-transparent text-[15px] sm:text-xs resize-none outline-none leading-relaxed min-h-[44px] max-h-[160px] sm:max-h-[200px]"
            style={{ color: 'var(--text)' }}
          />

          {/* Composer Footer Toolbar */}
          <div
            className="flex items-center justify-between pt-2 border-t mt-1.5 flex-wrap gap-1.5"
            style={{ borderColor: 'var(--border-subtle, var(--border))' }}
          >
          {/* Left Controls */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Attachment Button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 sm:p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center hover:opacity-100 opacity-80 shrink-0 relative"
              style={{
                backgroundColor: attachments.length > 0 ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: attachments.length > 0 ? 'var(--accent)' : 'var(--border)',
                color: attachments.length > 0 ? 'var(--accent)' : 'var(--text)'
              }}
              title={t('attach_files_tooltip', 'Attacher des fichiers (images, code, texte) ou glisser-déposer')}
            >
              <Paperclip className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
              {attachments.length > 0 && (
                <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-sky-500 text-[9px] font-bold text-white flex items-center justify-center">
                  {attachments.length}
                </span>
              )}
            </button>

            {/* Voice Dictation (Dictée vocale) */}
            <button
              type="button"
              onClick={toggleListening}
              className={`p-2 sm:p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                isListening ? 'animate-pulse shadow-md' : ''
              }`}
              style={{
                backgroundColor: isListening ? 'rgba(239, 68, 68, 0.15)' : 'var(--surface-subtle)',
                borderColor: isListening ? '#EF4444' : 'var(--border)',
                color: isListening ? '#EF4444' : 'var(--muted)'
              }}
              title={isListening ? t('stop_voice', 'Arrêter la dictée vocale') : t('voice_dictation', 'Activer la dictée vocale (Microphone)')}
            >
              {isListening ? <MicOff className="w-4 h-4 sm:w-3.5 sm:h-3.5" /> : <Mic className="w-4 h-4 sm:w-3.5 sm:h-3.5" />}
            </button>

            {/* Hermes YOLO Pill (Auto-Run) */}
            <button
              type="button"
              onClick={() => {
                const next = !autoApprove;
                setAutoApprove(next);
                showToast(next ? t('yolo_mode_enabled_toast', '⚡ Mode YOLO activé (Exécution autonome)') : t('yolo_mode_disabled_toast', 'Mode YOLO désactivé (Confirmation requise)'), next ? 'success' : 'info');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer shadow-sm shrink-0"
              style={{
                backgroundColor: autoApprove ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: autoApprove ? 'var(--accent)' : 'var(--border)',
                color: autoApprove ? 'var(--accent-text)' : 'var(--muted)'
              }}
              title={autoApprove ? t('yolo_active_tooltip', 'YOLO actif: exécution autonome sans confirmation. Cliquer pour désactiver.') : t('yolo_inactive_tooltip', 'YOLO inactif: demande de confirmation avant chaque outil.')}
            >
              <Zap className="w-3 h-3 fill-current" />
              <span>YOLO</span>
            </button>

            {/* Prompt History Button */}
            <button
              ref={historyButtonRef}
              type="button"
              onClick={() => setShowHistoryMenu((prev) => !prev)}
              className={`p-2 sm:p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center shrink-0 ${
                showHistoryMenu ? 'ring-2 ring-sky-500/50' : 'hover:opacity-100 opacity-80'
              }`}
              style={{
                backgroundColor: showHistoryMenu ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: showHistoryMenu ? 'var(--accent)' : 'var(--border)',
                color: showHistoryMenu ? 'var(--accent)' : 'var(--muted)'
              }}
              title="Historique des prompts (Touches ↑ / ↓ dans le terminal)"
            >
              <History className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
            </button>

            {/* Workspace Chip (Clickable Button) */}
            <button
              type="button"
              onClick={() => {
                if (onOpenWorkspace) onOpenWorkspace();
              }}
              className="hidden md:flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-[11px] font-mono hover:border-amber-400/50 transition-all cursor-pointer group shrink-0"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
              title={`Workspace: ${currentWorkspace || '/root'} (Cliquer pour changer)`}
            >
              <Folder className="w-3 h-3 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate max-w-[100px]" style={{ color: 'var(--text)' }}>
                {currentWorkspace ? currentWorkspace.split('/').pop() || 'root' : 'root'}
              </span>
            </button>

            {/* Base Model Selector */}
            <div
              className="flex items-center gap-1 border rounded-lg px-2 py-1 transition-colors shrink-0 max-w-[130px] sm:max-w-none"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)'
              }}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-transparent text-[11px] font-semibold font-sans outline-none cursor-pointer truncate"
                style={{ color: 'var(--text)' }}
                title={t("base_model", "Base model")}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Effort Selector - Hidden on small mobile */}
            {hasEffortSupport ? (
              <div
                className="hidden sm:flex items-center gap-1.5 border rounded-lg px-2 py-1 transition-colors shrink-0"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <SlidersHorizontal className="w-3 h-3 shrink-0" style={{ color: 'var(--blue, #4DD0E1)' }} />
                <select
                  value={selectedEffort}
                  onChange={(e) => onSelectEffort(e.target.value as any)}
                  className="bg-transparent text-[11px] font-mono outline-none cursor-pointer"
                  style={{ color: 'var(--text)' }}
                  title={t('thinking_effort_level_tooltip', 'Niveau de réflexion / Effort')}
                >
                  {supportedEfforts.includes('high') && (
                    <option value="high" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      {t('effort_high', 'Effort : Haut')}
                    </option>
                  )}
                  {supportedEfforts.includes('medium') && (
                    <option value="medium" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      {t('effort_medium', 'Effort : Moyen')}
                    </option>
                  )}
                  {supportedEfforts.includes('low') && (
                    <option value="low" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      {t('effort_low', 'Effort : Faible')}
                    </option>
                  )}
                </select>
              </div>
            ) : null}

            {/* Circular Context & Token Ring */}
            <ContextRing usage={usage} modelId={selectedModel} activePrompt={prompt} />
          </div>

          {/* Right Action Controls */}
          <div className="flex items-center gap-2">
            {/* Queue Counter Badge */}
            {queueCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-mono shadow-sm animate-fadeIn border"
                style={{
                  backgroundColor: 'var(--accent-bg)',
                  borderColor: 'var(--accent)',
                  color: 'var(--accent-text)'
                }}
              >
                <Layers className="w-3.5 h-3.5" />
                <span>{queueCount} en attente</span>
                {onClearQueue && (
                  <button
                    type="button"
                    onClick={onClearQueue}
                    className="hover:opacity-100 opacity-70 transition-opacity cursor-pointer ml-0.5 p-0.5"
                    title={t("clear_queue", "Clear queue")}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {!isStreaming && (
              <span className="hidden sm:inline text-[10px] font-mono opacity-50">
                {(typeof window !== 'undefined' && localStorage.getItem('antigravity_send_key') === 'ctrlEnter') ? t('ctrl_enter_label', 'Ctrl+↵') : t('enter_key_label', 'Entrée ↵')}
              </span>
            )}

            {isStreaming ? (
              <div className="flex items-center gap-2">
                {(prompt.trim().length > 0 || attachments.length > 0) && (
                  <>
                    {/* Steer Button */}
                    <button
                      type="button"
                      onClick={() => handleSubmit('steer')}
                      className="py-1.5 px-3 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                      style={{ backgroundColor: '#EA580C' }}
                      title={t("steer_tooltip", "Interrupt current step and steer immediately")}
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>{t('steer', 'Orienter')}</span>
                    </button>

                    {/* Queue Button */}
                    <button
                      type="button"
                      onClick={() => handleSubmit('queue')}
                      className="py-1.5 px-3 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                      title={t("queue_tooltip", "Place in queue for next turn")}
                    >
                      <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      <span>{t('queue', 'En attente')}</span>
                    </button>
                  </>
                )}

                {/* Stop Streaming Button */}
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="py-1.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                  title={t("stop_execution", "Stop execution")}
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>{t('stop', 'Arrêter')}</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit('normal')}
                disabled={!prompt.trim() && attachments.length === 0}
                className="py-1.5 px-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer font-sans"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff'
                }}
              >
                <span>{t('send', 'Envoyer')}</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  </div>
);
});
