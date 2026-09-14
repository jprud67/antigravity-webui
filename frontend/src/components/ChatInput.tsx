import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Square, 
  Slash, 
  ShieldCheck, 
  ShieldAlert,
  Compass,
  Zap,
  Clock,
  Sparkles,
  Globe,
  MessageSquareCode,
  SlidersHorizontal,
  Cpu
} from 'lucide-react';
import type { ModelOption } from '../types';

interface ChatInputProps {
  onSendMessage: (prompt: string, options: { model?: string; effort?: string; autoApprove?: boolean }) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
  selectedEffort: 'low' | 'medium' | 'high';
  onSelectEffort: (e: 'low' | 'medium' | 'high') => void;
  initialPrompt?: string;
}

const SLASH_COMMANDS = [
  { cmd: '/plan', desc: 'Planifier et concevoir avant d\'exécuter', icon: Compass, color: 'text-sky-400' },
  { cmd: '/goal', desc: 'Tâche long cours autonome sans interruption', icon: Zap, color: 'text-amber-400' },
  { cmd: '/browser', desc: 'Navigation et interaction web automatisée', icon: Globe, color: 'text-emerald-400' },
  { cmd: '/grill-me', desc: 'Entretien d\'alignement et de cadrage', icon: MessageSquareCode, color: 'text-purple-400' },
  { cmd: '/schedule', desc: 'Planification récurrente (cron) ou minuteur', icon: Clock, color: 'text-rose-400' },
  { cmd: '/boost', desc: 'Raisonnement profond multi-perspectives', icon: Sparkles, color: 'text-cyan-400' },
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  models,
  selectedModel,
  onSelectModel,
  selectedEffort,
  onSelectEffort,
  initialPrompt = ''
}) => {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [autoApprove, setAutoApprove] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Handle Model change
  const handleModelChange = (newModelId: string) => {
    onSelectModel(newModelId);
    const newModelObj = models.find((m) => m.id === newModelId);
    if (newModelObj && newModelObj.supported_efforts.length > 0) {
      // If current effort is not supported by new model, fallback to default or first supported
      if (!newModelObj.supported_efforts.includes(selectedEffort)) {
        onSelectEffort((newModelObj.default_effort as any) || (newModelObj.supported_efforts[0] as any) || 'high');
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      setShowSlashMenu(false);
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

  const insertSlashCommand = (cmd: string) => {
    setPrompt(`${cmd} `);
    setShowSlashMenu(false);
    textareaRef.current?.focus();
  };

  const handleSubmit = () => {
    if (!prompt.trim() || isStreaming) return;
    
    // Resolve concrete model variant ID
    const concreteVariant = hasEffortSupport && currentModelObj?.variants?.[selectedEffort]
      ? currentModelObj.variants[selectedEffort]
      : currentModelObj?.variants?.['default'] || selectedModel;

    onSendMessage(prompt.trim(), {
      model: concreteVariant,
      effort: hasEffortSupport ? selectedEffort : undefined,
      autoApprove,
    });
    setPrompt('');
    setShowSlashMenu(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const filteredCommands = SLASH_COMMANDS.filter((c) =>
    c.cmd.toLowerCase().includes(slashFilter) || c.desc.toLowerCase().includes(slashFilter)
  );

  return (
    <div className="relative p-5 max-w-4xl mx-auto w-full">
      {/* Slash command popover */}
      {showSlashMenu && (
        <div className="absolute bottom-full left-5 right-5 mb-3 bg-[#0d1424] border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden z-30 backdrop-blur-xl animate-fadeIn">
          <div className="px-4 py-2.5 border-b border-slate-800 text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
            <Slash className="w-3.5 h-3.5 text-sky-400" />
            <span>Commandes Antigravity disponibles</span>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-1">
            {filteredCommands.length === 0 ? (
              <div className="p-3 text-xs text-slate-500 text-center">Aucune commande correspondante</div>
            ) : (
              filteredCommands.map((c) => {
                const Icon = c.icon;
                return (
                  <button
                    key={c.cmd}
                    onClick={() => insertSlashCommand(c.cmd)}
                    className="w-full text-left px-3 py-2 rounded-xl hover:bg-slate-800/80 flex items-center justify-between text-xs transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-6 h-6 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                        <Icon className={`w-3.5 h-3.5 ${c.color}`} />
                      </div>
                      <span className="font-mono font-semibold text-slate-200 group-hover:text-sky-300 transition-colors">{c.cmd}</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">{c.desc}</span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Floating Glass Dock */}
      <div className="bg-[#0b101f]/95 border border-slate-700/70 rounded-2xl p-3.5 shadow-2xl backdrop-blur-xl focus-within:border-sky-500/60 focus-within:shadow-sky-500/10 transition-all duration-200">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Envoyez une instruction à Antigravity (ex: Crée une route, analyse le bug, tapez / pour les commandes)..."
          rows={1}
          className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs resize-none outline-none leading-relaxed min-h-[42px] max-h-[200px]"
        />

        {/* Toolbar */}
        <div className="flex items-center justify-between pt-2.5 border-t border-slate-800/80 mt-2">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Base Model Selector (clean unique names) */}
            <div className="flex items-center gap-1.5 bg-[#080c16] border border-slate-700/70 hover:border-slate-600 rounded-lg px-2.5 py-1 transition-colors">
              <Cpu className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <select
                value={selectedModel}
                onChange={(e) => handleModelChange(e.target.value)}
                className="bg-transparent text-slate-200 text-[11px] font-semibold font-sans outline-none focus:text-white transition-colors cursor-pointer"
                title="Modèle de base"
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id} className="bg-slate-900 text-slate-200">
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Effort Selector */}
            {hasEffortSupport ? (
              <div className="flex items-center gap-1.5 bg-[#080c16] border border-slate-700/70 hover:border-slate-600 rounded-lg px-2 py-1 transition-colors">
                <SlidersHorizontal className="w-3 h-3 text-indigo-400 shrink-0" />
                <select
                  value={selectedEffort}
                  onChange={(e) => onSelectEffort(e.target.value as any)}
                  className="bg-transparent text-slate-300 text-[11px] font-mono outline-none cursor-pointer"
                  title="Niveau de réflexion / Effort"
                >
                  {supportedEfforts.includes('high') && (
                    <option value="high" className="bg-slate-900 text-slate-200">
                      Effort: Haut (High)
                    </option>
                  )}
                  {supportedEfforts.includes('medium') && (
                    <option value="medium" className="bg-slate-900 text-slate-200">
                      Effort: Moyen (Med)
                    </option>
                  )}
                  {supportedEfforts.includes('low') && (
                    <option value="low" className="bg-slate-900 text-slate-200">
                      Effort: Faible (Low)
                    </option>
                  )}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-1 bg-slate-900/60 border border-slate-800 rounded-lg px-2 py-1 text-slate-500 text-[10px] font-mono cursor-not-allowed" title="Ce modèle utilise un raisonnement Thinking natif non configurable">
                <span>Effort: Fixe</span>
              </div>
            )}

            {/* Auto-Run Toggle */}
            <button
              onClick={() => setAutoApprove(!autoApprove)}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-all cursor-pointer ${
                autoApprove
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:bg-slate-800'
              }`}
              title={autoApprove ? "Exécution autonome sans confirmation" : "Demander confirmation"}
            >
              {autoApprove ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              <span>Auto-Run</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="hidden sm:inline text-[10px] text-slate-500 font-mono">Entrée ↵</span>

            {isStreaming ? (
              <button
                onClick={onStopStreaming}
                className="py-1.5 px-3.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all shadow-md shadow-rose-600/20 cursor-pointer"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Arrêter</span>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-md shadow-sky-500/20 active:scale-95 cursor-pointer"
              >
                <span>Envoyer</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
