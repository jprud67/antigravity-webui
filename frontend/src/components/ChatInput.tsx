import React, { useState, useRef, useEffect } from 'react';
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
  FileText
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
  onOpenGoogleAccount?: () => void;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  models,
  selectedModel,
  onSelectModel,
  selectedEffort,
  onSelectEffort,
  initialPrompt = '',
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
  onOpenGoogleAccount
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
  interface AttachmentItem {
    id: string;
    name: string;
    size: number;
    type: string;
    content: string;
    isImage: boolean;
    previewUrl?: string;
  }
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddFiles = (files: File[]) => {
    if (!files || files.length === 0) return;
    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      const reader = new FileReader();
      const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      if (isImg) {
        reader.onload = (e) => {
          const content = e.target?.result as string;
          setAttachments((prev) => [
            ...prev,
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
          setAttachments((prev) => [
            ...prev,
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
  };

  const handleRemoveAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id));
  };

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const basePromptRef = useRef<string>('');
  const finalSpeechRef = useRef<string>('');

  const showToast = (text: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToastMessage({ text, type });
    setTimeout(() => setToastMessage(null), 3000);
  };

  const toggleListening = () => {
    if (isListening) {
      if (recognitionRef.current) {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      basePromptRef.current = '';
      finalSpeechRef.current = '';
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('La reconnaissance vocale n\'est pas supportée par ce navigateur.', 'error');
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
      };

      recognition.onend = () => {
        setIsListening(false);
        basePromptRef.current = '';
        finalSpeechRef.current = '';
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setIsListening(false);
      basePromptRef.current = '';
      finalSpeechRef.current = '';
    }
  };

  useEffect(() => {
    if (initialPrompt) {
      setPrompt(initialPrompt);
      textareaRef.current?.focus();
    }
  }, [initialPrompt]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [prompt]);

  const currentModelObj = models.find((m) => m.id === selectedModel) || models[0];
  const supportedEfforts = currentModelObj?.supported_efforts ?? [];
  const hasEffortSupport = supportedEfforts.length > 0;

  const handleModelChange = (newModelId: string) => {
    const newModelObj = models.find((m) => m.id === newModelId);
    if (newModelObj && newModelObj.supported_efforts && newModelObj.supported_efforts.length > 0) {
      if (!newModelObj.supported_efforts.includes(selectedEffort)) {
        onSelectEffort((newModelObj.default_effort as any) || (newModelObj.supported_efforts[0] as any) || 'high');
      }
    }
    onSelectModel(newModelId);
    showToast(`Modèle appliqué : ${newModelObj?.name || newModelId}`, 'success');
  };

  const filteredCommands = ALL_SLASH_COMMANDS.filter((c) =>
    c.cmd.toLowerCase().includes(slashFilter) || c.desc.toLowerCase().includes(slashFilter)
  );

  useEffect(() => {
    setSelectedIndex(0);
  }, [slashFilter]);

  // Execute or dispatch Slash Command
  const executeSlashAction = (cmdText: string): boolean => {
    const parsed = parseSlashCommand(cmdText);
    if (!parsed) return false;

    const { cmd, args } = parsed;

    switch (cmd) {
      case '/help':
        if (onOpenHelp) onOpenHelp();
        else showToast('Tapez / pour voir toutes les commandes slash disponibles.', 'info');
        return true;

      case '/clear':
        if (onClearChat) {
          onClearChat();
          showToast('Messages effacés.', 'success');
        }
        return true;

      case '/new':
        if (onNewChat) {
          onNewChat();
          showToast('Nouvelle conversation créée.', 'success');
        }
        return true;

      case '/theme':
        if (args) {
          const res = applyTheme(args);
          showToast(`Thème / Skin mis à jour : ${res.value}`, 'success');
        } else {
          showToast('Usage: /theme <dark|light|system|sienna|catppuccin|ares|zeus...>', 'info');
        }
        return true;

      case '/account':
      case '/google':
        if (onOpenGoogleAccount) {
          onOpenGoogleAccount();
        } else {
          showToast('Ouvrez les Paramètres > Compte Google pour gérer votre compte.', 'info');
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
            showToast(`Langue définie sur : ${match.flag || ''} ${match.label} (${match.code})`, 'success');
          } else {
            showToast(`Langue inconnue "${args}". Codes: ${SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')}`, 'error');
          }
        } else {
          if (onOpenLanguages) onOpenLanguages();
          else if (onOpenHelp) onOpenHelp();
          else showToast(`Langue actuelle : ${getCurrentLanguage()}`, 'info');
        }
        return true;

      case '/yolo':
        setAutoApprove((prev) => {
          const next = !prev;
          showToast(next ? '⚡ Mode YOLO (Auto-Run) ACTIVÉ' : 'Mode YOLO désactivé (Demande de validation)', next ? 'success' : 'info');
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
        else showToast('Tableau de bord des tâches indisponible.', 'info');
        return true;

      case '/skills':
        if (onOpenSkills) onOpenSkills();
        else showToast('Compétences Antigravity installées.', 'info');
        return true;

      case '/use':
        if (args) {
          handleSubmit('normal', `[Directive de compétence : ${args}] Veuillez consulter et utiliser prioritairement les outils et compétences du skill "${args}".`);
          showToast(`Skill activé : ${args}`, 'success');
        } else {
          if (onOpenSkills) onOpenSkills();
          else showToast('Usage: /use <nom_du_skill>', 'info');
        }
        return true;

      case '/files':
      case '/attach':
        if (onOpenFileExplorer) onOpenFileExplorer();
        else showToast('Explorateur de fichiers non disponible.', 'info');
        return true;

      case '/export':
        if (onOpenExport) onOpenExport();
        return true;

      case '/branch':
        if (onForkMessage) {
          onForkMessage();
          showToast('Branche créée.', 'success');
        }
        return true;

      case '/title':
        if (args && onRenameTitle) {
          onRenameTitle(args);
          showToast(`Conversation renommée : ${args}`, 'success');
        } else {
          showToast('Usage: /title <nouveau titre>', 'info');
        }
        return true;

      case '/voice':
        toggleListening();
        return true;

      case '/stop':
        if (isStreaming && onStopStreaming) {
          onStopStreaming();
          showToast('Exécution interrompue.', 'info');
        }
        return true;

      case '/retry':
        if (onRetry) {
          onRetry();
          showToast('Relance de la dernière instruction...', 'info');
        } else {
          showToast('Aucun message précédent à relancer.', 'info');
        }
        return true;

      case '/undo':
        if (onUndo) {
          onUndo();
          showToast('Dernière étape annulée.', 'success');
        } else {
          showToast('Impossible d\'annuler l\'étape.', 'info');
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
        showToast('🗜️ Demande de compression du contexte envoyée...', 'info');
        return true;

      case '/usage':
        if (usage) {
          showToast(
            `📊 Tokens: ${usage.totalTokens.toLocaleString()} (Entrée: ${usage.inputTokens.toLocaleString()}, Sortie: ${usage.outputTokens.toLocaleString()})`,
            'info'
          );
        } else {
          showToast('Métriques de tokens non disponibles.', 'info');
        }
        return true;

      case '/status':
        if (onShowStatus) {
          onShowStatus();
        } else {
          const statText = `🟢 Serveur actif | Modèle: ${currentModelObj?.name || selectedModel} | Workspace: ${currentWorkspace || '/root'}`;
          showToast(statText, 'info');
        }
        return true;

      case '/btw':
        if (args) {
          handleSubmit('normal', `[Aparté / Question rapide] ${args}`);
          return true;
        } else {
          showToast('Usage: /btw <votre question en aparté>', 'info');
          return true;
        }

      case '/background':
        if (args) {
          handleSubmit('normal', `/goal ${args}`);
          showToast('Tâche autonome lancée en arrière-plan.', 'success');
          return true;
        } else {
          showToast('Usage: /background <instruction de la tâche>', 'info');
          return true;
        }

      case '/steer':
        if (args) {
          handleSubmit('steer', args);
          return true;
        } else {
          showToast('Usage: /steer <nouvelle orientation>', 'info');
          return true;
        }

      case '/interrupt':
        if (args) {
          handleSubmit('steer', args);
          return true;
        } else {
          if (isStreaming && onStopStreaming) {
            onStopStreaming();
            showToast('Exécution interrompue.', 'info');
          } else {
            showToast('Usage: /interrupt <nouvelle orientation>', 'info');
          }
          return true;
        }

      case '/queue':
        if (args) {
          handleSubmit('queue', args);
          return true;
        } else {
          showToast('Usage: /queue <instruction en attente>', 'info');
          return true;
        }

      case '/model':
        if (args) {
          const found = models.find(
            (m) => m.name.toLowerCase().includes(args.toLowerCase()) || m.id.toLowerCase().includes(args.toLowerCase())
          );
          if (found) {
            handleModelChange(found.id);
            showToast(`Modèle sélectionné : ${found.name}`, 'success');
          } else {
            showToast(`Modèle inconnu : ${args}. Modèles: ${models.map((m) => m.name).join(', ')}`, 'error');
          }
        } else {
          showToast(`Modèle actif : ${currentModelObj?.name || selectedModel}`, 'info');
        }
        return true;

      case '/reasoning':
        if (args && ['low', 'medium', 'high'].includes(args.toLowerCase())) {
          onSelectEffort(args.toLowerCase() as any);
          showToast(`Effort de réflexion réglé sur : ${args}`, 'success');
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
    }

    const sendKeyPref = typeof window !== 'undefined' ? (localStorage.getItem('antigravity_send_key') || 'enter') : 'enter';
    const shouldSend = sendKeyPref === 'ctrlEnter'
      ? (e.key === 'Enter' && (e.ctrlKey || e.metaKey))
      : (e.key === 'Enter' && !e.shiftKey);

    if (shouldSend) {
      e.preventDefault();
      // Check if command is a local action
      if (prompt.trim().startsWith('/')) {
        const handled = executeSlashAction(prompt.trim());
        if (handled) {
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

    const isCommandTyping = val.startsWith('/') && !val.includes(' ') && !val.includes('\n');
    setShowSlashMenu(isCommandTyping);
    if (isCommandTyping) {
      setSlashFilter(val.slice(1).toLowerCase());
    }
  };

  const selectSlashCommand = (c: SlashCommandDef) => {
    if (c.isAction && !c.arg) {
      const handled = executeSlashAction(c.cmd);
      if (handled) {
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
        setPrompt('');
        setShowSlashMenu(false);
        return;
      }
    }

    let finalText = textToSend.trim();
    if (attachments.length > 0) {
      for (const att of attachments) {
        if (att.isImage) {
          finalText += `\n\n[Image attachée : ${att.name}]\n${att.content}`;
        } else {
          finalText += `\n\n[Fichier attaché : ${att.name} (${Math.round(att.size / 1024)} ko)]\n\`\`\`\n${att.content.slice(0, 50000)}\n\`\`\``;
        }
      }
      setAttachments([]);
    }

    // Resolve concrete model variant ID
    const targetModelObj = models.find((m) => m.id === selectedModel) || models[0];
    const targetEfforts = targetModelObj?.supported_efforts ?? [];
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
                <span className="uppercase tracking-wider">Commandes Antigravity & Hermes</span>
              </div>
              <span className="text-[10px] font-mono opacity-70">↑↓ naviguer · ↵ insérer · esc fermer</span>
            </div>

            <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
              {filteredCommands.length === 0 ? (
                <div className="p-4 text-xs text-center" style={{ color: 'var(--muted)' }}>
                  Aucune commande correspondante
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
                        {c.desc}
                      </span>
                    </button>
                  );
                })
              )}
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
                    title="Supprimer la pièce jointe"
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
            placeholder="Envoyez une instruction à Antigravity (ou tapez /)..."
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
              title="Attacher des fichiers (images, code, texte) ou glisser-déposer"
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
                showToast(next ? '⚡ Mode YOLO activé (Exécution autonome)' : 'Mode YOLO désactivé (Confirmation requise)', next ? 'success' : 'info');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer shadow-sm shrink-0"
              style={{
                backgroundColor: autoApprove ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: autoApprove ? 'var(--accent)' : 'var(--border)',
                color: autoApprove ? 'var(--accent-text)' : 'var(--muted)'
              }}
              title={autoApprove ? 'YOLO actif: exécution autonome sans confirmation. Cliquer pour désactiver.' : 'YOLO inactif: demande de confirmation avant chaque outil.'}
            >
              <Zap className="w-3 h-3 fill-current" />
              <span>YOLO</span>
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
                title="Modèle de base"
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
                  title="Niveau de réflexion / Effort"
                >
                  {supportedEfforts.includes('high') && (
                    <option value="high" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      Effort: Haut
                    </option>
                  )}
                  {supportedEfforts.includes('medium') && (
                    <option value="medium" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      Effort: Moyen
                    </option>
                  )}
                  {supportedEfforts.includes('low') && (
                    <option value="low" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)' }}>
                      Effort: Faible
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
                    title="Vider la file d'attente"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {!isStreaming && (
              <span className="hidden sm:inline text-[10px] font-mono opacity-50">
                {(typeof window !== 'undefined' && localStorage.getItem('antigravity_send_key') === 'ctrlEnter') ? 'Ctrl+↵' : 'Entrée ↵'}
              </span>
            )}

            {isStreaming ? (
              <div className="flex items-center gap-2">
                {prompt.trim().length > 0 && (
                  <>
                    {/* Steer Button */}
                    <button
                      type="button"
                      onClick={() => handleSubmit('steer')}
                      className="py-1.5 px-3 rounded-xl text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer"
                      style={{ backgroundColor: '#EA580C' }}
                      title="Interrompre l'étape en cours et réorienter immédiatement"
                    >
                      <Zap className="w-3.5 h-3.5 fill-current" />
                      <span>Orienter</span>
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
                      title="Placer dans la file d'attente pour le prochain tour"
                    >
                      <Layers className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                      <span>En attente</span>
                    </button>
                  </>
                )}

                {/* Stop Streaming Button */}
                <button
                  type="button"
                  onClick={onStopStreaming}
                  className="py-1.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                  title="Interrompre l'exécution"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Arrêter</span>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSubmit('normal')}
                disabled={!prompt.trim()}
                className="py-1.5 px-4 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md active:scale-95 cursor-pointer font-sans"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff'
                }}
              >
                <span>Envoyer</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
};
