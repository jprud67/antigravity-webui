import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { 
  Bot, 
  User, 
  ChevronDown, 
  ChevronUp, 
  BrainCircuit, 
  Check, 
  Copy, 
  Terminal
} from 'lucide-react';
import type { ChatMessage } from '../types';

interface ChatCanvasProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  conversationTitle?: string;
  activeModel?: string;
}

const CodeBlock = ({ inline, className, children, ...props }: any) => {
  const [copied, setCopied] = useState(false);
  const match = /language-(\w+)/.exec(className || '');
  const language = match ? match[1] : '';
  const codeContent = String(children).replace(/\n$/, '');

  const copyToClipboard = () => {
    navigator.clipboard.writeText(codeContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div className="relative my-3 rounded-lg overflow-hidden border border-slate-700 bg-slate-950 font-mono text-xs">
        <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800 text-slate-400">
          <span className="text-[11px] font-semibold uppercase">{language}</span>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1 hover:text-slate-200 transition-colors py-0.5 px-1.5 rounded hover:bg-slate-800 text-[11px]"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </button>
        </div>
        <pre className="p-3 overflow-x-auto text-slate-200 leading-relaxed">
          <code>{children}</code>
        </pre>
      </div>
    );
  }

  return (
    <code className="bg-slate-800 text-sky-300 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
      {children}
    </code>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  messages,
  isStreaming,
  conversationTitle,
  activeModel
}) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [expandedThoughts, setExpandedThoughts] = useState<Record<string, boolean>>({});

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  const toggleThought = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#0b0f19]">
      {/* Top Header */}
      <div className="h-14 border-b border-slate-800/80 px-6 flex items-center justify-between bg-slate-900/40 backdrop-blur shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-slate-200 truncate max-w-md">
            {conversationTitle || 'Nouvelle conversation'}
          </span>
          {activeModel && (
            <span className="text-[11px] font-medium bg-slate-800 border border-slate-700/80 text-sky-400 px-2.5 py-0.5 rounded-full">
              {activeModel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isStreaming && (
            <div className="flex items-center gap-2 text-xs text-amber-400 bg-amber-950/40 border border-amber-800/40 px-3 py-1 rounded-full animate-pulse">
              <span className="w-2 h-2 rounded-full bg-amber-400"></span>
              <span>Génération en cours...</span>
            </div>
          )}
        </div>
      </div>

      {/* Messages Stream */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center mb-4">
              <Bot className="w-7 h-7 text-sky-400" />
            </div>
            <h2 className="text-lg font-semibold text-slate-200 mb-2">Poste de Contrôle Antigravity</h2>
            <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-6">
              Posez une question, lancez une commande, ou pilotez vos sous-agents en toute simplicité sans ouvrir le terminal.
            </p>
            <div className="grid grid-cols-2 gap-3 max-w-lg text-left text-xs">
              <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-300">
                <span className="text-sky-400 font-semibold block mb-1">/goal</span>
                Tâche au long cours autonome jusqu'à complétion.
              </div>
              <div className="p-3 rounded-lg border border-slate-800 bg-slate-900/60 text-slate-300">
                <span className="text-sky-400 font-semibold block mb-1">/plan</span>
                Planification stratégique par étapes avant exécution.
              </div>
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isThoughtOpen = expandedThoughts[msg.id];

            return (
              <div
                key={msg.id}
                className={`flex gap-4 max-w-4xl mx-auto ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center shrink-0 mt-1">
                    <Bot className="w-4 h-4 text-sky-400" />
                  </div>
                )}

                <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                  {/* Thought Box (if available) */}
                  {msg.thought && (
                    <div className="w-full bg-slate-900/90 border border-slate-800 rounded-lg overflow-hidden text-xs">
                      <button
                        onClick={() => toggleThought(msg.id)}
                        className="w-full flex items-center justify-between p-2.5 text-slate-400 hover:text-slate-200 transition-colors bg-slate-900"
                      >
                        <div className="flex items-center gap-2">
                          <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="font-mono text-[11px] font-medium">Processus de raisonnement</span>
                        </div>
                        {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {isThoughtOpen && (
                        <div className="p-3 bg-slate-950/60 text-slate-400 border-t border-slate-800 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                          {msg.thought}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tool Calls Cards */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="w-full space-y-2">
                      {msg.toolCalls.map((tool, idx) => (
                        <div
                          key={idx}
                          className="bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs flex flex-col gap-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Terminal className="w-3.5 h-3.5 text-amber-400" />
                              <span className="font-mono font-semibold text-slate-200">{tool.name}</span>
                            </div>
                            <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded border border-slate-700">
                              {tool.status || 'exécuté'}
                            </span>
                          </div>
                          {tool.args && (
                            <pre className="text-[10px] bg-slate-950 p-2 rounded border border-slate-800 text-slate-400 overflow-x-auto">
                              {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
                            </pre>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Main Bubble */}
                  <div
                    className={`rounded-2xl p-4 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-sky-600 text-white rounded-br-sm shadow-md'
                        : 'bg-slate-900/90 text-slate-200 border border-slate-800 rounded-bl-sm shadow-sm w-full'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <div className="prose prose-invert prose-xs max-w-none prose-p:leading-relaxed prose-pre:my-0">
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            code: CodeBlock,
                          }}
                        >
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1">
                    <User className="w-4 h-4 text-slate-300" />
                  </div>
                )}
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
};
