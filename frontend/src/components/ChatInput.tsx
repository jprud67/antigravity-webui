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
  AlertCircle
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
  onOpenFileExplorer?: () => void;
  onOpenWorkspace?: () => void;
  onOpenExport?: () => void;
  onOpenHelp?: () => void;
  onForkMessage?: () => void;
  onRenameTitle?: (newTitle: string) => void;
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
  onOpenFileExplorer,
  onOpenWorkspace,
  onOpenExport,
  onOpenHelp,
  onForkMessage,
  onRenameTitle
}) => {
  const { t } = useI18n();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [autoApprove, setAutoApprove] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'info' | 'error' } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const recognitionRef = useRef<any>(null);
  const listRef = useRef<HTMLDivElement>(null);

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
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      showToast('La reconnaissance vocale n\'est pas supportée par ce navigateur.', 'error');
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = 'fr-FR';
      recognition.continuous = true;
      recognition.interimResults = true;

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          transcript += event.results[i][0].transcript;
        }
        if (transcript.trim()) {
          setPrompt((prev) => {
            const separator = prev && !prev.endsWith(' ') ? ' ' : '';
            return prev + separator + transcript.trim();
          });
        }
      };

      recognition.onerror = (e: any) => {
        console.warn('Speech recognition event:', e);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err) {
      console.error('Failed to start speech recognition', err);
      setIsListening(false);
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
    onSelectModel(newModelId);
    const newModelObj = models.find((m) => m.id === newModelId);
    if (newModelObj && newModelObj.supported_efforts.length > 0) {
      if (!newModelObj.supported_efforts.includes(selectedEffort)) {
        onSelectEffort((newModelObj.default_effort as any) || (newModelObj.supported_efforts[0] as any) || 'high');
      }
    }
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

      case '/skills':
        if (onOpenSkills) onOpenSkills();
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

      case '/model':
        if (args) {
          const found = models.find((m) => m.name.toLowerCase().includes(args.toLowerCase()) || m.id.toLowerCase().includes(args.toLowerCase()));
          if (found) {
            handleModelChange(found.id);
            showToast(`Modèle sélectionné : ${found.name}`, 'success');
          } else {
            showToast(`Modèle inconnu : ${args}. Modèles: ${models.map(m => m.name).join(', ')}`, 'error');
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

      case '/files':
      case '/attach':
        if (onOpenFileExplorer) {
          onOpenFileExplorer();
        } else {
          showToast('Explorateur de fichiers non disponible.', 'info');
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
            showToast(`Langue inconnue "${args}". Codes supportés: ${SUPPORTED_LANGUAGES.map((l) => l.code).join(', ')}`, 'error');
          }
        } else {
          if (onOpenHelp) {
            onOpenHelp();
          } else {
            showToast(`Langue actuelle : ${getCurrentLanguage()}`, 'info');
          }
        }
        return true;

      case '/steer':
        if (args) {
          handleSubmit('steer', args);
          return true;
        }
        break;

      case '/queue':
        if (args) {
          handleSubmit('queue', args);
          return true;
        }
        break;

      default:
        // Workflow commands like /plan, /goal, /boost, /browser, /grill-me continue to prompt send
        return false;
    }
    return false;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSlashMenu) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % Math.max(1, filteredCommands.length));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % Math.max(1, filteredCommands.length));
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          selectSlashCommand(filteredCommands[selectedIndex]);
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
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

    if (val.startsWith('/')) {
      setShowSlashMenu(true);
      setSlashFilter(val.slice(1).toLowerCase());
    } else {
      setShowSlashMenu(false);
    }
  };

  const selectSlashCommand = (c: SlashCommandDef) => {
    if (c.isAction && !c.arg) {
      executeSlashAction(c.cmd);
      setPrompt('');
      setShowSlashMenu(false);
    } else {
      setPrompt(`${c.cmd} `);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
    }
  };

  const handleSubmit = (mode: 'normal' | 'queue' | 'steer' = 'normal', overrideText?: string) => {
    const textToSend = overrideText || prompt;
    if (!textToSend.trim()) return;

    // Check if it's a direct local slash command
    if (textToSend.trim().startsWith('/')) {
      const handled = executeSlashAction(textToSend.trim());
      if (handled) {
        setPrompt('');
        setShowSlashMenu(false);
        return;
      }
    }

    // Resolve concrete model variant ID
    const concreteVariant = hasEffortSupport && currentModelObj?.variants?.[selectedEffort]
      ? currentModelObj.variants[selectedEffort]
      : currentModelObj?.variants?.['default'] || selectedModel;

    onSendMessage(textToSend.trim(), {
      model: concreteVariant,
      effort: hasEffortSupport ? selectedEffort : undefined,
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
      className="w-full shrink-0 border-t"
      style={{
        backgroundColor: 'var(--main-bg, var(--bg))',
        borderColor: 'var(--border-subtle, var(--border))'
      }}
    >
      <div className="relative p-3 sm:p-4 max-w-4xl mx-auto w-full">
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
          className="hermes-composer-dock p-3 sm:p-3.5"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border2)'
          }}
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Envoyez une instruction à Antigravity (ou tapez / pour toutes les commandes)..."
            rows={1}
            className="w-full bg-transparent text-xs resize-none outline-none leading-relaxed min-h-[42px] max-h-[200px]"
            style={{ color: 'var(--text)' }}
          />

          {/* Composer Footer Toolbar */}
          <div
            className="flex items-center justify-between pt-2.5 border-t mt-2 flex-wrap gap-2"
            style={{ borderColor: 'var(--border-subtle, var(--border))' }}
          >
          {/* Left Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Attachment / File Explorer Button */}
            {(onOpenFileExplorer || onOpenSkills) && (
              <button
                type="button"
                onClick={() => {
                  if (onOpenFileExplorer) onOpenFileExplorer();
                  else if (onOpenSkills) onOpenSkills();
                }}
                className="p-1.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center hover:opacity-100 opacity-80"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
                title={t('file_browser', 'Attacher des fichiers ou explorer le workspace (/files)')}
              >
                <Paperclip className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Voice Dictation (Dictée vocale) */}
            <button
              type="button"
              onClick={toggleListening}
              className={`p-1.5 rounded-lg border transition-all cursor-pointer flex items-center justify-center ${
                isListening ? 'animate-pulse shadow-md' : ''
              }`}
              style={{
                backgroundColor: isListening ? 'rgba(239, 68, 68, 0.15)' : 'var(--surface-subtle)',
                borderColor: isListening ? '#EF4444' : 'var(--border)',
                color: isListening ? '#EF4444' : 'var(--muted)'
              }}
              title={isListening ? t('stop_voice', 'Arrêter la dictée vocale') : t('voice_dictation', 'Activer la dictée vocale (Microphone)')}
            >
              {isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
            </button>

            {/* Hermes YOLO Pill (Auto-Run) */}
            <button
              type="button"
              onClick={() => {
                const next = !autoApprove;
                setAutoApprove(next);
                showToast(next ? '⚡ Mode YOLO activé (Exécution autonome)' : 'Mode YOLO désactivé (Confirmation requise)', next ? 'success' : 'info');
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer shadow-sm"
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
              className="hidden sm:flex items-center gap-1.5 border rounded-lg px-2.5 py-1 text-[11px] font-mono hover:border-amber-400/50 transition-all cursor-pointer group"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
              title={`Workspace: ${currentWorkspace || '/root'} (Cliquer pour changer)`}
            >
              <Folder className="w-3 h-3 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span className="truncate max-w-[120px]" style={{ color: 'var(--text)' }}>
                {currentWorkspace ? currentWorkspace.split('/').pop() || 'root' : 'root'}
              </span>
            </button>

            {/* Base Model Selector */}
            <div
              className="flex items-center gap-1.5 border rounded-lg px-2 py-1 transition-colors"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)'
              }}
            >
              <Cpu className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-transparent text-[11px] font-semibold font-sans outline-none cursor-pointer"
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

            {/* Effort Selector */}
            {hasEffortSupport ? (
              <div
                className="flex items-center gap-1.5 border rounded-lg px-2 py-1 transition-colors"
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
              <span className="hidden sm:inline text-[10px] font-mono opacity-50">Entrée ↵</span>
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
