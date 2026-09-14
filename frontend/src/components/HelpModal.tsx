import React, { useState } from 'react';
import { X, Terminal, Globe, Command, ExternalLink, Check } from 'lucide-react';
import { ALL_SLASH_COMMANDS } from '../services/commands';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';
import { AntigravityIcon } from './AntigravityLogo';

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCommand?: (cmd: string) => void;
}

export const HelpModal: React.FC<HelpModalProps> = ({ isOpen, onClose, onExecuteCommand }) => {
  const { lang, setLanguage, t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<'commands' | 'shortcuts' | 'languages'>('commands');
  const [filter, setFilter] = useState('');

  if (!isOpen) return null;

  const filteredCommands = ALL_SLASH_COMMANDS.filter(
    (c) => c.cmd.toLowerCase().includes(filter.toLowerCase()) || c.desc.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-fadeIn p-4">
      <div
        className="w-[720px] max-w-full max-h-[85vh] rounded-3xl shadow-2xl border flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface, #141425)',
          borderColor: 'var(--border2, #2A2A45)',
          color: 'var(--text, #E0E0E0)'
        }}
      >
        {/* Header */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle, #1A1A2E)',
            borderColor: 'var(--border, #2A2A45)'
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center p-1.5 border shadow-sm"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)'
              }}
            >
              <AntigravityIcon size={28} />
            </div>
            <div>
              <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--strong, #ffffff)' }}>
                Antigravity Cockpit &bull; {t('help', 'Aide & Commandes')}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--muted, #A0A0A0)' }}>
                Guide des raccourcis, commandes slash et sélecteur de langue
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-60"
            style={{ color: 'var(--text)' }}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div
          className="flex items-center gap-2 px-6 py-2.5 border-b text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <button
            type="button"
            onClick={() => setActiveCategory('commands')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 border ${
              activeCategory === 'commands' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              backgroundColor: activeCategory === 'commands' ? 'var(--accent-bg)' : 'transparent',
              borderColor: activeCategory === 'commands' ? 'var(--accent)' : 'transparent',
              color: activeCategory === 'commands' ? 'var(--accent-text)' : 'var(--text)'
            }}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span>Commandes Slash ({ALL_SLASH_COMMANDS.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('shortcuts')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 border ${
              activeCategory === 'shortcuts' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              backgroundColor: activeCategory === 'shortcuts' ? 'var(--accent-bg)' : 'transparent',
              borderColor: activeCategory === 'shortcuts' ? 'var(--accent)' : 'transparent',
              color: activeCategory === 'shortcuts' ? 'var(--accent-text)' : 'var(--text)'
            }}
          >
            <Command className="w-3.5 h-3.5" />
            <span>Raccourcis Clavier</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveCategory('languages')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1.5 border ${
              activeCategory === 'languages' ? 'shadow-sm' : 'opacity-70 hover:opacity-100'
            }`}
            style={{
              backgroundColor: activeCategory === 'languages' ? 'var(--accent-bg)' : 'transparent',
              borderColor: activeCategory === 'languages' ? 'var(--accent)' : 'transparent',
              color: activeCategory === 'languages' ? 'var(--accent-text)' : 'var(--text)'
            }}
          >
            <Globe className="w-3.5 h-3.5" />
            <span>{t('language', 'Langue')} ({SUPPORTED_LANGUAGES.length})</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {activeCategory === 'commands' && (
            <div className="space-y-4">
              <input
                type="text"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Filtrer une commande..."
                className="w-full px-3.5 py-2 text-xs rounded-xl border outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {filteredCommands.map((item) => (
                  <button
                    key={item.cmd}
                    type="button"
                    onClick={() => {
                      onClose();
                      onExecuteCommand?.(item.cmd);
                    }}
                    className="p-3 rounded-xl border text-left transition-all cursor-pointer group flex flex-col justify-between"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = 'var(--accent)';
                      e.currentTarget.style.backgroundColor = 'var(--surface-subtle-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.backgroundColor = 'var(--surface-subtle)';
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs font-bold" style={{ color: 'var(--accent)' }}>
                        {item.cmd}
                      </span>
                      <span
                        className="text-[9px] uppercase px-1.5 py-0.2 rounded font-mono border"
                        style={{
                          backgroundColor: 'var(--surface)',
                          borderColor: 'var(--border-subtle)',
                          color: 'var(--muted)'
                        }}
                      >
                        {item.category}
                      </span>
                    </div>
                    <p className="text-[11px] leading-snug" style={{ color: 'var(--muted)' }}>
                      {item.desc}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeCategory === 'shortcuts' && (
            <div className="space-y-3">
              {[
                { key: 'Entrée (Enter)', desc: 'Envoyer le message ou valider la commande' },
                { key: 'Maj + Entrée (Shift+Enter)', desc: 'Insérer un saut de ligne dans le composer' },
                { key: '/', desc: 'Ouvrir le menu contextuel des 36 commandes slash' },
                { key: 'Flèches Haut / Bas', desc: 'Naviguer dans les commandes ou rappeler les invites' },
                { key: 'Tab ou Entrée', desc: 'Compléter automatiquement la commande sélectionnée' },
                { key: 'Échap (Escape)', desc: 'Fermer les menus, fenêtres modales ou annuler la recherche' }
              ].map((s, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3.5 rounded-xl border text-xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)'
                  }}
                >
                  <span style={{ color: 'var(--text)' }}>{s.desc}</span>
                  <kbd
                    className="px-2.5 py-1 rounded-lg border font-mono text-[11px] shadow-xs shrink-0 ml-4 font-semibold"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border2)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    {s.key}
                  </kbd>
                </div>
              ))}
            </div>
          )}

          {activeCategory === 'languages' && (
            <div className="space-y-4">
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Choisissez votre langue parmi les 15 langues intégrées d'Hermes WebUI :
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                {SUPPORTED_LANGUAGES.map((item) => {
                  const isSelected = item.code === lang;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLanguage(item.code)}
                      className={`p-3 rounded-xl border text-left flex items-center justify-between transition-all cursor-pointer ${
                        isSelected ? 'shadow-md' : 'opacity-80 hover:opacity-100'
                      }`}
                      style={{
                        backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        color: isSelected ? 'var(--accent-text)' : 'var(--text)'
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-base">{item.flag}</span>
                        <div>
                          <p className="text-xs font-semibold">{item.label}</p>
                          <span className="text-[10px] font-mono opacity-60 uppercase">{item.code}</span>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4" style={{ color: 'var(--accent)' }} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-3 border-t flex items-center justify-between text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--muted)' }}>
            <span>Langue active :</span>
            <span className="font-semibold" style={{ color: 'var(--strong)' }}>
              {SUPPORTED_LANGUAGES.find((l) => l.code === lang)?.label || 'Français'}
            </span>
          </div>

          <a
            href="https://antigravity.google/docs"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[11px] font-medium transition-colors hover:underline"
            style={{ color: 'var(--accent)' }}
          >
            <span>Documentation officielle</span>
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
};
