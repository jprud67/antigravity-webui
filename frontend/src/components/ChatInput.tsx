import React, { useState, useRef, useEffect } from 'react';
import { 
  Send, 
  Square, 
  Slash, 
  ShieldCheck, 
  ShieldAlert 
} from 'lucide-react';
import type { ModelOption } from '../types';

interface ChatInputProps {
  onSendMessage: (prompt: string, options: { model?: string; effort?: string; autoApprove?: boolean }) => void;
  isStreaming: boolean;
  onStopStreaming?: () => void;
  models: ModelOption[];
  selectedModel: string;
  onSelectModel: (m: string) => void;
}

const SLASH_COMMANDS = [
  { cmd: '/goal', desc: 'Tâche long cours autonome sans interruption' },
  { cmd: '/plan', desc: 'Planifier et concevoir avant d\'exécuter' },
  { cmd: '/grill-me', desc: 'Entretien interactif d\'alignement et de cadrage' },
  { cmd: '/browser', desc: 'Navigation et interaction web automatisée' },
  { cmd: '/schedule', desc: 'Planification récurrente (cron) ou minuteur' },
  { cmd: '/boost', desc: 'Raisonnement profond multi-perspectives' },
];

export const ChatInput: React.FC<ChatInputProps> = ({
  onSendMessage,
  isStreaming,
  onStopStreaming,
  models,
  selectedModel,
  onSelectModel,
}) => {
  const [prompt, setPrompt] = useState('');
  const [effort, setEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [autoApprove, setAutoApprove] = useState(true);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [prompt]);

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
    onSendMessage(prompt.trim(), {
      model: selectedModel,
      effort,
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
    <div className="relative p-4 max-w-4xl mx-auto w-full">
      {/* Slash command popover */}
      {showSlashMenu && (
        <div className="absolute bottom-full left-4 right-4 mb-2 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden z-20">
          <div className="p-2 border-b border-slate-800 text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Slash className="w-3.5 h-3.5 text-sky-400" />
            <span>Commandes Spéciales Antigravity</span>
          </div>
          <div className="max-h-48 overflow-y-auto p-1 space-y-1">
            {filteredCommands.length === 0 ? (
              <div className="p-2 text-xs text-slate-500">Aucune commande correspondante</div>
            ) : (
              filteredCommands.map((c) => (
                <button
                  key={c.cmd}
                  onClick={() => insertSlashCommand(c.cmd)}
                  className="w-full text-left p-2 rounded-lg hover:bg-slate-800 flex items-center justify-between text-xs transition-colors"
                >
                  <span className="font-mono font-semibold text-sky-400">{c.cmd}</span>
                  <span className="text-slate-400 text-[11px]">{c.desc}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Main Input Container */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3 shadow-xl backdrop-blur focus-within:border-sky-500/50 transition-all">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder="Envoyez une instruction à Antigravity (ex: Crée un composant, /plan pour structurer, etc.)..."
          rows={1}
          className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs resize-none outline-none leading-relaxed min-h-[40px] max-h-[180px]"
        />

        {/* Action Toolbar */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800/80 mt-2">
          <div className="flex items-center gap-2">
            {/* Model select */}
            <select
              value={selectedModel}
              onChange={(e) => onSelectModel(e.target.value)}
              className="bg-slate-800/80 text-slate-300 border border-slate-700/80 rounded-md px-2 py-1 text-[11px] font-mono outline-none focus:border-sky-500"
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>

            {/* Effort select */}
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value as any)}
              className="bg-slate-800/80 text-slate-300 border border-slate-700/80 rounded-md px-2 py-1 text-[11px] font-mono outline-none focus:border-sky-500"
              title="Niveau de réflexion de l'agent"
            >
              <option value="low">Effort: Low</option>
              <option value="medium">Effort: Medium</option>
              <option value="high">Effort: High</option>
            </select>

            {/* Auto-approve toggle */}
            <button
              onClick={() => setAutoApprove(!autoApprove)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                autoApprove
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title={autoApprove ? "Exécution auto des commandes sans invite" : "Mode confirmation activé"}
            >
              {autoApprove ? <ShieldCheck className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}
              <span>Auto-Run</span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <button
                onClick={onStopStreaming}
                className="py-1.5 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-medium flex items-center gap-1.5 transition-colors shadow-sm"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Arrêter</span>
              </button>
            ) : (
              <button
                onClick={handleSubmit}
                disabled={!prompt.trim()}
                className="py-1.5 px-3.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-sm active:scale-95"
              >
                <span>Exécuter</span>
                <Send className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
