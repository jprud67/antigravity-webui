import React, { useRef, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
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
  GitPullRequest
} from 'lucide-react';
import type { ChatMessage } from '../types';
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
      <div
        className="relative my-4 rounded-xl overflow-hidden font-mono text-[11px] shadow-sm border"
        style={{
          backgroundColor: 'var(--code-bg, #1A1A2E)',
          borderColor: 'var(--border, #2A2A45)'
        }}
      >
        <div
          className="flex items-center justify-between px-3.5 py-2 border-b text-xs"
          style={{
            backgroundColor: 'var(--surface-subtle, rgba(0,0,0,0.05))',
            borderColor: 'var(--border, #2A2A45)',
            color: 'var(--muted, #C0C0C0)'
          }}
        >
          <div className="flex items-center gap-2">
            <div className="flex gap-1.5 opacity-80">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/80" />
            </div>
            <span className="text-[10px] font-semibold tracking-wider uppercase pl-1" style={{ color: 'var(--accent, #FFD700)' }}>
              {language}
            </span>
          </div>
          <button
            onClick={copyToClipboard}
            className="flex items-center gap-1.5 py-1 px-2 rounded-md text-[10px] transition-colors cursor-pointer"
            style={{
              color: 'var(--muted)',
              backgroundColor: 'var(--surface-subtle)'
            }}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié !' : 'Copier'}</span>
          </button>
        </div>
        <pre className="p-4 overflow-x-auto leading-relaxed scrollbar-thin" style={{ color: 'var(--pre-text, var(--text))' }}>
          <code>{children}</code>
        </pre>
      </div>
    );
  }

  return (
    <code
      className="px-1.5 py-0.5 rounded text-[11px] font-mono border"
      style={{
        backgroundColor: 'var(--code-inline-bg, rgba(0,0,0,0.2))',
        borderColor: 'var(--border-subtle, rgba(0,0,0,0.1))',
        color: 'var(--code-text, var(--accent))'
      }}
      {...props}
    >
      {children}
    </code>
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
    if (isStreaming) {
      if (!userScrolledUpRef.current) {
        bottomRef.current.scrollIntoView({ behavior: 'auto' });
      }
    } else {
      userScrolledUpRef.current = false;
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isStreaming]);

  const toggleThought = (id: string) => {
    setExpandedThoughts((prev) => ({ ...prev, [id]: !prev[id] }));
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
      {/* Top Bar - Pure Hermes Workbench Style */}
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

          {/* Direct Panel Buttons */}
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
          /* Empty / Welcome Hero - Hermes Caduceus Exact Style */
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

            {/* Quick Starter Cards */}
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
            const isUser = msg.role === 'user';
            const isThoughtOpen = expandedThoughts[msg.id];

            if (isUser) {
              return (
                <div key={msg.id} className="flex flex-col items-end max-w-4xl mx-auto w-full group">
                  <div className="hermes-user-bubble rounded-2xl rounded-br-sm px-4 py-3 text-xs leading-relaxed max-w-[85%] sm:max-w-[75%] font-medium">
                    <p className="whitespace-pre-wrap select-text">{msg.content}</p>
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
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      className="p-0.5 hover:opacity-100 cursor-pointer"
                      title="Copier le message"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div key={msg.id} className="flex flex-col items-start max-w-4xl mx-auto w-full group">
                {/* Assistant Role Header - Exact Hermes Style */}
                <div className="flex items-center gap-2 mb-1.5 text-xs">
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center p-0.5 shrink-0 border shadow-xs"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent-bg-strong)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    <AntigravityIcon size={14} />
                  </div>
                  <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
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

                {/* Live Thinking Pill (pre-response / waiting) */}
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
                    <span className="font-medium text-[11px] tracking-wide">Réflexion en cours...</span>
                  </div>
                )}

                {/* Hermes Thinking Card (accordion) */}
                {msg.thought && (
                  <div className="w-full hermes-thinking-card overflow-hidden text-xs shadow-sm mb-2">
                    <button
                      onClick={() => toggleThought(msg.id)}
                      className="w-full flex items-center justify-between px-3.5 py-2 transition-colors cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        color: 'var(--accent-text)'
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <BrainCircuit className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                        <span className="font-mono text-[11px] font-semibold">Raisonnement interne</span>
                        {msg.isLive && !msg.content && (
                          <span className="w-1.5 h-1.5 rounded-full animate-ping ml-1" style={{ backgroundColor: 'var(--accent)' }} />
                        )}
                      </div>
                      {isThoughtOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {isThoughtOpen && (
                      <div
                        className="p-3.5 border-t text-[11px] leading-relaxed whitespace-pre-wrap font-mono max-h-72 overflow-y-auto"
                        style={{
                          backgroundColor: 'var(--code-bg, #101018)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)'
                        }}
                      >
                        {msg.thought}
                      </div>
                    )}
                  </div>
                )}

                {/* Hermes Tool Execution Cards */}
                {msg.toolCalls && msg.toolCalls.length > 0 && (
                  <div className="w-full space-y-2 mb-2">
                    {msg.toolCalls.map((tool, idx) => {
                      if (tool.name === 'ask_question') {
                        return (
                          <InteractiveQuestion
                            key={idx}
                            toolArgs={tool.args}
                            onAnswer={(answer) => {
                              if (onAnswerQuestion) onAnswerQuestion(answer);
                              else onQuickPrompt?.(answer);
                            }}
                          />
                        );
                      }
                      if (tool.name === 'ask_permission' || tool.name === 'ask_custom_permission') {
                        return (
                          <ApprovalCard
                            key={idx}
                            toolName={tool.args?.tool_name || tool.args?.permission || tool.name}
                            command={tool.args?.command || tool.args?.CommandLine}
                            path={tool.args?.path || tool.args?.TargetFile}
                          />
                        );
                      }
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

                      const isRunning = tool.status === 'running';

                      return (
                        <div
                          key={idx}
                          className="hermes-tool-card p-3 text-xs flex flex-col gap-2 shadow-sm"
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Terminal className={`w-3.5 h-3.5 ${isRunning ? 'animate-pulse text-amber-400' : ''}`} style={{ color: isRunning ? undefined : 'var(--accent)' }} />
                              <span className="font-mono font-semibold" style={{ color: 'var(--strong)' }}>
                                {tool.name}
                              </span>
                            </div>
                            <span
                              className={`text-[9px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1.5 ${
                                isRunning
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                                  : tool.status === 'error'
                                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                                  : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              }`}
                            >
                              {isRunning && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />}
                              {isRunning ? 'en cours...' : tool.status === 'error' ? 'erreur' : 'terminé'}
                            </span>
                          </div>
                          {tool.args && (
                            <pre
                              className="text-[10px] font-mono p-2.5 rounded-lg border overflow-x-auto max-h-48"
                              style={{
                                backgroundColor: 'var(--code-bg)',
                                borderColor: 'var(--border-subtle)',
                                color: 'var(--muted)'
                              }}
                            >
                              {typeof tool.args === 'string' ? tool.args : JSON.stringify(tool.args, null, 2)}
                            </pre>
                          )}
                          {tool.result && (
                            <pre
                              className="text-[10px] font-mono p-2 rounded border overflow-x-auto max-h-40 opacity-85"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border-subtle)',
                                color: 'var(--text)'
                              }}
                            >
                              {typeof tool.result === 'string' ? tool.result : JSON.stringify(tool.result, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Assistant Markdown Content */}
                {msg.content ? (
                  <div className="hermes-assistant-body w-full markdown-content text-xs leading-relaxed">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        code: CodeBlock,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                    {msg.isLive && <span className="hermes-streaming-cursor" />}
                  </div>
                ) : null}

                {/* Assistant Action Footer */}
                <div
                  className="flex items-center gap-2 px-1 text-[10px] font-mono mt-1 opacity-60 group-hover:opacity-100 transition-opacity"
                  style={{ color: 'var(--muted)' }}
                >
                  {msg.stepIndex !== undefined && (
                    <span className="opacity-60">Étape #{msg.stepIndex}</span>
                  )}

                  {msg.content && (
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(msg.content)}
                      className="transition-opacity opacity-75 hover:opacity-100 p-1 rounded cursor-pointer flex items-center gap-1"
                      title="Copier le message"
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
                      title={speakingMsgId === msg.id ? "Arrêter la synthèse vocale" : "Écouter la réponse (Synthèse vocale)"}
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
                      title="Créer une nouvelle branche (bifurcation) à partir de cette étape"
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
