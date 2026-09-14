export type AppTheme = 'dark' | 'oled' | 'slate' | 'cyberpunk' | 'light';

export interface ThemeOption {
  id: AppTheme;
  name: string;
  desc: string;
  previewBg: string;
  previewBorder: string;
  previewAccent: string;
  badge: string;
}

export const AVAILABLE_THEMES: ThemeOption[] = [
  {
    id: 'dark',
    name: 'Sombre Cockpit',
    desc: 'Palette bleu nuit et ardoise professionnelle optimisée pour le travail prolongé.',
    previewBg: '#080c16',
    previewBorder: '#1e293b',
    previewAccent: '#38bdf8',
    badge: 'Défaut'
  },
  {
    id: 'oled',
    name: 'OLED Noir Absolu',
    desc: 'Noir pur #000000 pour un contraste maximal et économie d\'énergie sur écrans OLED.',
    previewBg: '#000000',
    previewBorder: '#262626',
    previewAccent: '#0ea5e9',
    badge: 'OLED'
  },
  {
    id: 'slate',
    name: 'Slate Graphique',
    desc: 'Tons gris graphite neutres et minimalistes inspirés des environnements UNIX.',
    previewBg: '#0f172a',
    previewBorder: '#334155',
    previewAccent: '#94a3b8',
    badge: 'Minimal'
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Néon',
    desc: 'Ambiance high-tech futuriste avec accents cyan électrique et touches magenta.',
    previewBg: '#050814',
    previewBorder: '#1e1b4b',
    previewAccent: '#00f0ff',
    badge: 'Néon'
  },
  {
    id: 'light',
    name: 'Studio Clair',
    desc: 'Interface claire, lumineuse et structurée idéale pour les environnements ensoleillés.',
    previewBg: '#f8fafc',
    previewBorder: '#e2e8f0',
    previewAccent: '#0284c7',
    badge: 'Jour'
  }
];

const THEME_STORAGE_KEY = 'antigravity_theme';

export function getStoredTheme(): AppTheme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored && ['dark', 'oled', 'slate', 'cyberpunk', 'light'].includes(stored)) {
    return stored as AppTheme;
  }
  return 'dark';
}

export function applyTheme(theme: AppTheme) {
  localStorage.setItem(THEME_STORAGE_KEY, theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  
  if (theme === 'light') {
    root.classList.remove('dark');
    root.classList.add('light');
  } else {
    root.classList.remove('light');
    root.classList.add('dark');
  }

  // Dispatch event for components listening to theme changes
  window.dispatchEvent(new CustomEvent('antigravity-theme-change', { detail: { theme } }));
}
