import { useCallback, useEffect, useState } from 'react';
import {
  BookOpen, ChevronRight, Code2, ExternalLink, Layers,
  RefreshCw, Terminal, X, Zap
} from 'lucide-react';
import type { SDKExample, SDKGuide } from '../types';
import { fetchSDKExamples, fetchSDKGuide, fetchSDKGuides } from '../services/api';

interface SDKPortalModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type ActiveSection = 'guides' | 'examples' | 'manifest';

const MANIFEST_SCHEMA_EXAMPLE = `{
  "slug": "my-awesome-plugin",
  "name": "My Awesome Plugin",
  "version": "1.0.0",
  "description": "Description courte du plugin",
  "entry_point": "https://cdn.example.com/my-plugin/bundle.js",
  "scopes": [
    "register_command",
    "register_tool",
    "read_workspace"
  ],
  "author": "your-username",
  "homepage": "https://github.com/your-username/my-awesome-plugin"
}`;

export default function SDKPortalModal({ isOpen, onClose }: SDKPortalModalProps) {
  const [activeSection, setActiveSection] = useState<ActiveSection>('guides');
  const [guides, setGuides] = useState<SDKGuide[]>([]);
  const [selectedGuide, setSelectedGuide] = useState<SDKGuide | null>(null);
  const [examples, setExamples] = useState<Record<string, SDKExample>>({});
  const [selectedLang, setSelectedLang] = useState('typescript');
  const [loading, setLoading] = useState(false);

  const loadGuides = useCallback(async () => {
    setLoading(true);
    try {
      const g = await fetchSDKGuides();
      setGuides(g);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadExamples = useCallback(async () => {
    setLoading(true);
    try {
      const e = await fetchSDKExamples();
      setExamples(e);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadGuideDetail = useCallback(async (guideId: string) => {
    setLoading(true);
    try {
      const g = await fetchSDKGuide(guideId);
      setSelectedGuide(g);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    // oxlint-disable-next-line react/set-state-in-effect
    if (activeSection === 'guides') loadGuides();
    // oxlint-disable-next-line react/set-state-in-effect
    else if (activeSection === 'examples') loadExamples();
  }, [isOpen, activeSection, loadGuides, loadExamples]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl flex flex-col w-full max-w-3xl mx-4 max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <Code2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">SDK Developer Portal</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400">Guides, exemples de code et spécifications API — Antigravity Plugin SDK v0.5.0</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Sidebar */}
          <nav className="w-44 shrink-0 border-r border-gray-200 dark:border-gray-700 py-4 px-3 space-y-1">
            {([
              { key: 'guides', icon: BookOpen, label: 'Guides' },
              { key: 'examples', icon: Terminal, label: 'Exemples' },
              { key: 'manifest', icon: Layers, label: 'Manifest' },
            ] as const).map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => { setActiveSection(key); setSelectedGuide(null); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeSection === key
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                    : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}

            <div className="pt-4 border-t border-gray-200 dark:border-gray-700 mt-2">
              <p className="text-xs text-gray-400 dark:text-gray-500 px-3 mb-2 font-medium uppercase tracking-wide">API</p>
              <a
                href="/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                OpenAPI Docs
              </a>
              <a
                href="/api/sdk/spec"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Zap className="w-4 h-4" />
                OpenRPC Spec
              </a>
            </div>
          </nav>

          {/* Main content */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading && (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
              </div>
            )}

            {!loading && activeSection === 'guides' && !selectedGuide && (
              <div className="p-6 space-y-3">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">📚 Guides de développement</h3>
                {guides.map(guide => (
                  <button
                    key={guide.id}
                    onClick={() => loadGuideDetail(guide.id)}
                    className="w-full text-left flex items-center gap-4 p-4 border border-gray-200 dark:border-gray-700 rounded-xl hover:border-emerald-300 dark:hover:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-900/10 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-gray-900 dark:text-white text-sm group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
                        {guide.title}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{guide.description}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-500 transition-colors shrink-0" />
                  </button>
                ))}
              </div>
            )}

            {!loading && activeSection === 'guides' && selectedGuide && (
              <div className="p-6">
                <button
                  onClick={() => setSelectedGuide(null)}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition-colors"
                >
                  ← Retour aux guides
                </button>
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  {selectedGuide.content?.split('\n').map((line, i) => {
                    if (line.startsWith('## ')) return <h2 key={i} className="text-lg font-bold text-gray-900 dark:text-white mt-4 mb-2">{line.slice(3)}</h2>;
                    if (line.startsWith('### ')) return <h3 key={i} className="text-base font-semibold text-gray-800 dark:text-gray-200 mt-3 mb-1">{line.slice(4)}</h3>;
                    if (line.startsWith('```')) return null;
                    if (line.startsWith('|')) return <code key={i} className="block text-xs bg-gray-50 dark:bg-gray-800 p-1">{line}</code>;
                    if (line.trim() === '') return <br key={i} />;
                    return <p key={i} className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{line}</p>;
                  })}
                </div>
              </div>
            )}

            {!loading && activeSection === 'examples' && (
              <div className="p-6">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-4">💻 Exemples de code</h3>
                <div className="flex gap-2 mb-4">
                  {Object.keys(examples).map(lang => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLang(lang)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                        selectedLang === lang
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                {examples[selectedLang] && (
                  <div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{examples[selectedLang].description}</p>
                    <div className="relative">
                      <pre className="bg-gray-950 dark:bg-gray-950 text-gray-100 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre leading-relaxed">
                        {examples[selectedLang].code}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {!loading && activeSection === 'manifest' && (
              <div className="p-6">
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-2">📋 Plugin Manifest</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
                  Le manifest est le fichier de configuration principal de votre plugin.
                  Il définit son identité, ses permissions et son point d'entrée.
                </p>
                <div className="mb-4">
                  <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Exemple de manifest</h4>
                  <pre className="bg-gray-950 text-gray-100 rounded-xl p-4 text-xs font-mono overflow-x-auto whitespace-pre">
                    {MANIFEST_SCHEMA_EXAMPLE}
                  </pre>
                </div>
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-blue-700 dark:text-blue-300 mb-2">🔒 Scopes de permission</h4>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      ['register_command', 'Ajouter des commandes /slash'],
                      ['register_tool', 'Ajouter des outils agent'],
                      ['register_view', 'Ajouter des panneaux UI'],
                      ['read_workspace', 'Lire les fichiers workspace'],
                      ['write_workspace', 'Écrire les fichiers workspace'],
                      ['run_terminal', 'Exécuter dans le terminal'],
                      ['chat_access', 'Accès lecture/écriture chat'],
                    ].map(([scope, desc]) => (
                      <div key={scope} className="text-xs">
                        <code className="text-blue-700 dark:text-blue-300 font-mono">{scope}</code>
                        <span className="text-gray-600 dark:text-gray-400 ml-1">— {desc}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
