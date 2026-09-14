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
  Terminal, 
  Sparkles, 
  Zap, 
  Code2, 
  Compass, 
  FileCheck, 
  Cpu,
  HardDrive,
  Activity,
  FileText
} from 'lucide-react';
import type { ChatMessage } from '../types';
import { InteractiveQuestion } from './InteractiveQuestion';
import { MermaidRenderer } from './MermaidRenderer';
import { DiffViewer } from './DiffViewer';

interface ChatCanvasProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  conversationTitle?: string;
  activeModel?: string;
  activeEffort?: string;
  onQuickPrompt?: (prompt: string) => void;
  onAnswerQuestion?: (answer: string) => void;
  onOpenFiles?: () => void;
  onOpenTasks?: () => void;
  onOpenArtifacts?: () => void;
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
    if (language === 'mermaid') {
      return <MermaidRenderer chart={codeContent} />;
    }
    if (language === 'diff') {
      return <DiffViewer diffText={codeContent} />;
    }

    return (
      <div className="relative my-4 rounded-xl overflow-hidden border border-slate-700/80 bg-[#050811] font-mono text-[11px] shadow-lg shadow-black/40">
        <div className="flex items-center justify-between px-3.5 py-2 bg-[#0d1322] border-b border-slate-800/80 text-slate-400">
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-[10px] font-semibold tracking-wider text-sky-400/90 uppercase pl-1">{language}</span>
          </div>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 text-slate-400 hover:text-slate-200 transition-colors py-1 px-2 rounded-md hover:bg-slate-800/80 text-[10px] cursor-pointer"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié !' : 'Copier'}</span>
          </button>
        </div>
        <pre className="p-4 overflow-x-auto text-slate-200 leading-relaxed scrollbar-thin">
          <code>{children}</code>
        </pre>
      </div>
    );
  }

  return (
    <code className="bg-slate-800/90 text-sky-300 px-1.5 py-0.5 rounded text-[11px] font-mono border border-slate-700/60" {...props}>
      {children}
    </code>
  );
};

export const ChatCanvas: React.FC<ChatCanvasProps> = ({
  messages,
  isStreaming,
  conversationTitle,
  activeModel,
  activeEffort,
  onQuickPrompt,
  onAnswerQuestion,
  onOpenFiles,
  onOpenTasks,
  onOpenArtifacts,
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
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#080c16]">
      {/* Top Studio Bar */}
      <div className="h-14 border-b border-slate-800/60 px-6 flex items-center justify-between bg-[#0a0f1e]/80 backdrop-blur-md shrink-0 z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-100 truncate max-w-sm">
              {conversationTitle || 'Nouvelle conversation'}
            </span>
          </div>

          {activeModel && (
            <div className="flex items-center gap-1.5 text-[10px] font-mono font-medium bg-sky-500/10 border border-sky-500/20 text-sky-400 px-2.5 py-0.5 rounded-full shadow-inner">
              <Cpu className="w-3 h-3 text-sky-400" />
              <span>{activeModel}</span>
              {activeEffort && (
                <span className="text-[9px] bg-sky-400/20 text-sky-300 px-1.5 py-0.2 rounded font-bold uppercase ml-1">
                  {activeEffort}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Right Tools & Status */}
        <div className="flex items-center gap-2">
          {/* Quick Action Badges */}
          {onOpenFiles && (
            <button
              onClick={onOpenFiles}
              className="py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700/60"
              title="Explorateur de fichiers du Workspace"
            >
              <HardDrive className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] font-medium hidden sm:inline">Workspace</span>
            </button>
          )}

          {onOpenTasks && (
            <button
              onClick={onOpenTasks}
              className="py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700/60"
              title="Supervision des Tâches et Sous-Agents"
            >
              <Activity className="w-3.5 h-3.5 text-indigo-400" />
              <span className="text-[11px] font-medium hidden sm:inline">Tâches</span>
            </button>
          )}

          {onOpenArtifacts && (
            <button
              onClick={onOpenArtifacts}
              className="py-1.5 px-2.5 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-700/60"
              title="Artifacts et Documents"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span className="text-[11px] font-medium hidden sm:inline">Artifacts</span>
            </button>
          )}

          {isStreaming && (
            <div className="flex items-center gap-2 text-[11px] text-amber-400 bg-amber-950/30 border border-amber-800/40 px-3 py-1 rounded-full animate-pulse shadow-sm ml-2">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
              <span className="font-medium">Antigravity réfléchit...</span>
            </div>
          )}
        </div>
      </div>

      {/* Messages Scroll Area */}
      <div className="flex-1 overflow-y-auto px-6 py-8 space-y-6">
        {messages.length === 0 ? (
          /* Empty / Welcome Hero */
          <div className="h-full flex flex-col items-center justify-center max-w-2xl mx-auto text-center animate-fadeIn py-12">
            <div className="relative mb-6">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-tr from-sky-500 via-indigo-600 to-purple-600 p-[1px] shadow-2xl shadow-sky-500/25">
                <div className="w-full h-full bg-[#090e1c] rounded-[23px] flex items-center justify-center">
                  <Sparkles className="w-10 h-10 text-sky-400 animate-pulse" />
                </div>
              </div>
              <div className="absolute -inset-2 rounded-full bg-sky-500/10 blur-xl -z-10" />
            </div>

            <h2 className="text-xl font-bold tracking-tight text-white mb-2">
              Poste de Contrôle Antigravity
            </h2>
            <p className="text-xs text-slate-400 max-w-md leading-relaxed mb-8">
              Pilotez l'agent autonome, inspectez votre code, exécutez des commandes système et créez des solutions sans jamais ouvrir un terminal.
            </p>

            {/* Quick Starter Cards */}
            <div className="grid grid-cols-2 gap-3 w-full text-left">
              {[
                {
                  icon: Compass,
                  title: "/plan",
                  desc: "Établir un plan d'architecture par étapes",
                  color: "text-sky-400 bg-sky-500/10 border-sky-500/20",
                  prompt: "/plan "
                },
                {
                  icon: Zap,
                  title: "/goal",
                  desc: "Assigner un objectif autonome approfondi",
                  color: "text-amber-400 bg-amber-500/10 border-amber-500/20",
                  prompt: "/goal "
                },
                {
                  icon: Code2,
                  title: "Inspecter le Code",
                  desc: "Analyser la structure et détecter les bugs",
                  color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
                  prompt: "Analyse le projet dans le workspace actif et dresse la liste des axes d'amélioration."
                },
                {
                  icon: FileCheck,
                  title: "Vérifier le Statut",
                  desc: "Vérifier les services et tests en cours",
                  color: "text-purple-400 bg-purple-500/10 border-purple-500/20",
                  prompt: "Vérifie l'état des services et l'intégrité du code."
                }
              ].map((card, idx) => {
                const IconComp = card.icon;
                return (
                  <button
                    key={idx}
                    onClick={() => onQuickPrompt?.(card.prompt)}
                    className="p-4 rounded-2xl bg-[#0d1324]/60 hover:bg-[#111930] border border-slate-800/80 hover:border-slate-700 transition-all text-left group cursor-pointer shadow-sm"
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className={`w-6 h-6 rounded-lg flex items-center justify-center border ${card.color}`}>
                        <IconComp className="w-3.5 h-3.5" />
                      </div>
                      <span className="font-semibold text-xs text-slate-200 group-hover:text-white transition-colors">{card.title}</span>
                    </div>
                    <p className="text-[11px] text-slate-400 leading-snug">{card.desc}</p>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          messages.map((msg) => {
            const isUser = msg.role === 'user';
            const isThoughtOpen = expandedThoughts[msg.id];

            return (
              <div
                key={msg.id}
                className={`flex gap-3.5 max-w-4xl mx-auto ${
                  isUser ? 'justify-end' : 'justify-start'
                }`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center shrink-0 mt-1 shadow-sm">
                    <Bot className="w-4 h-4 text-sky-400" />
                  </div>
                )}

                <div className={`flex flex-col gap-2 max-w-[85%] ${isUser ? 'items-end' : 'items-start'}`}>
                  {/* Thought Accordion */}
                  {msg.thought && (
                    <div className="w-full bg-[#0b101f] border border-indigo-950/60 rounded-xl overflow-hidden text-xs shadow-inner">
                      <button
                        onClick={() => toggleThought(msg.id)}
                        className="w-full flex items-center justify-between px-3.5 py-2 text-indigo-300 hover:text-indigo-200 transition-colors bg-[#0f162c]/60 cursor-pointer"
                      >
                        <div className="flex items-center gap-2">
                          <BrainCircuit className="w-3.5 h-3.5 text-indigo-400" />
                          <span className="font-mono text-[11px] font-semibold">Raisonnement interne</span>
                        </div>
                        {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>
                      {isThoughtOpen && (
                        <div className="p-3.5 bg-[#070b16] text-slate-400 border-t border-indigo-950/50 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                          {msg.thought}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Tool Execution Cards & Interactive Handlers */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="w-full space-y-2">
                      {msg.toolCalls.map((tool, idx) => {
                        // Interactive ask_question
                        if (tool.name === 'ask_question') {
                          return (
                            <InteractiveQuestion
                              key={idx}
                              toolArgs={tool.args}
                              onAnswer={(answer) => {
                                if (onAnswerQuestion) {
                                  onAnswerQuestion(answer);
                                } else {
                                  onQuickPrompt?.(answer);
                                }
                              }}
                            />
                          );
                        }

                        // Diff Viewer for replace_file_content
                        if (tool.name === 'replace_file_content' && tool.args) {
                          const diffSnippet = `--- ${tool.args.TargetFile || 'original'}\n+++ ${tool.args.TargetFile || 'modifié'}\n@@ -${tool.args.StartLine || 1} +${tool.args.StartLine || 1} @@\n${(tool.args.TargetContent || '').split('\n').map((l: string) => '-' + l).join('\n')}\n${(tool.args.ReplacementContent || '').split('\n').map((l: string) => '+' + l).join('\n')}`;
                          return (
                            <DiffViewer
                              key={idx}
                              filename={tool.args.TargetFile}
                              title={`replace_file_content: ${tool.args.Instruction || tool.args.Description || ''}`}
                              diffText={diffSnippet}
                            />
                          );
                        }

                        return (
                          <div
                            key={idx}
                            className="bg-[#0b1120] border border-slate-800 rounded-xl p-3 text-xs flex flex-col gap-2 shadow-sm"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Terminal className="w-3.5 h-3.5 text-amber-400" />
                                <span className="font-mono font-semibold text-slate-200">{tool.name}</span>
                              </div>
                              <span className="text-[9px] uppercase tracking-wider font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 px-2 py-0.5 rounded-full">
                                {tool.status || 'succès'}
                              </span>
                            </div>
                            {tool.args && (
                              <pre className="text-[10px] font-mono bg-[#050811] p-2.5 rounded-lg border border-slate-800/80 text-slate-400 overflow-x-auto">
                                {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Message Bubble */}
                  <div
                    className={`rounded-2xl px-4 py-3.5 text-xs leading-relaxed ${
                      isUser
                        ? 'bg-gradient-to-r from-sky-500 to-indigo-600 text-white rounded-br-sm shadow-md shadow-sky-600/10 font-medium'
                        : 'bg-[#0d1322]/90 text-slate-200 border border-slate-800/80 rounded-bl-sm shadow-sm w-full markdown-content'
                    }`}
                  >
                    {isUser ? (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          code: CodeBlock,
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                </div>

                {isUser && (
                  <div className="w-8 h-8 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center shrink-0 mt-1 shadow-sm">
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
