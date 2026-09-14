export type ThemeMode = 'system' | 'dark' | 'light';

export interface SkinOption {
  id: string;
  name: string;
  desc: string;
  colors: string[];
  isDarkOnly?: boolean;
}

export const AVAILABLE_THEMES: { id: ThemeMode; name: string; desc: string }[] = [
  {
    id: 'system',
    name: 'Système',
    desc: 'Suit automatiquement le réglage clair ou sombre de votre système d\'exploitation.'
  },
  {
    id: 'dark',
    name: 'Sombre',
    desc: 'Palette sombre standard à faible éblouissement pour les sessions prolongées.'
  },
  {
    id: 'light',
    name: 'Clair',
    desc: 'Surfaces lumineuses avec texte sombre et contrasté adapté aux environnements éclairés.'
  }
];

export const AVAILABLE_SKINS: SkinOption[] = [
  {
    id: 'default',
    name: 'Défaut (Or Hermes)',
    desc: 'L\'accent or chaleureux et sobre d\'origine d\'Hermes.',
    colors: ['#FFD700', '#FFBF00', '#CD7F32']
  },
  {
    id: 'ares',
    name: 'Ares (Rouge)',
    desc: 'Rouge ardent à haute énergie et caractère affirmé.',
    colors: ['#FF4444', '#CC3333', '#992222']
  },
  {
    id: 'mono',
    name: 'Mono (Gris)',
    desc: 'Gris neutre minimaliste, sans distraction pour une concentration totale.',
    colors: ['#CCCCCC', '#999999', '#666666']
  },
  {
    id: 'graphite',
    name: 'Graphite',
    desc: 'Atelier workbench moderne avec contrastes soignés et surfaces neutres.',
    colors: ['#FFFFFF', '#D6D6D6', '#242424']
  },
  {
    id: 'github',
    name: 'GitHub',
    desc: 'Inspiré de l\'interface GitHub avec bleu d\'action et surfaces adaptatives.',
    colors: ['#0969DA', '#1F883D', '#242424']
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    desc: 'Surfaces éditeur épurées avec accents verts émeraude style OpenAI Codex.',
    colors: ['#72B39A', '#242624', '#ECEBE4']
  },
  {
    id: 'terracotta',
    name: 'Terracotta (Claude)',
    desc: 'Neutres chauds inspirés d\'Anthropic Claude avec accents terre cuite.',
    colors: ['#D97757', '#F0EEE6', '#141413']
  },
  {
    id: 'slate',
    name: 'Slate (Ardoise)',
    desc: 'Bleu-gris ardoise subtil, sobre et élégant.',
    colors: ['#334155', '#475569', '#64748B']
  },
  {
    id: 'poseidon',
    name: 'Poseidon (Océan)',
    desc: 'Bleu océan calme et apaisant pour les longues sessions de réflexion.',
    colors: ['#0EA5E9', '#0284C7', '#0369A1']
  },
  {
    id: 'sisyphus',
    name: 'Sisyphus (Pourpre)',
    desc: 'Violet vif distinctif sans être tape-à-l\'œil.',
    colors: ['#A78BFA', '#8B5CF6', '#7C3AED']
  },
  {
    id: 'charizard',
    name: 'Charizard (Orange)',
    desc: 'Orange flamme énergique, agréable et chaleureux.',
    colors: ['#FB923C', '#F97316', '#EA580C']
  },
  {
    id: 'sienna',
    name: 'Sienna (Terre & Sable)',
    desc: 'Palette terre et sable avec bulle utilisateur naturelle et tons argile.',
    colors: ['#D97757', '#C06A49', '#9A523A']
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin (Mocha/Latte)',
    desc: 'Palette renommée Latte (clair) et Mocha (sombre) avec accent Mauve.',
    colors: ['#CBA6F7', '#B4BEFE', '#8839EF']
  },
  {
    id: 'nous',
    name: 'Nous (Bleu Acier)',
    desc: 'Accent bleu acier technique avec bordures distinctes pour ingénieurs.',
    colors: ['#4682B4', '#3A6E9A', '#2C5F88']
  },
  {
    id: 'geist-contrast',
    name: 'Geist Contrast',
    desc: 'Monochrome de haute précision inspiré de Geist avec accent jaune discret.',
    colors: ['#000000', '#FFFFFF', '#FFF175']
  },
  {
    id: 'zeus',
    name: 'Zeus (OLED Noir & Or)',
    desc: 'Surfaces noir pur OLED profondes avec accents or d\'Hermes.',
    colors: ['#FFD700', '#FFBF00', '#1A1A00'],
    isDarkOnly: true
  },
  {
    id: 'neon',
    name: 'Cyber Neon',
    desc: 'Ambiance futuriste haute technologie aux reflets néons cyberpunk.',
    colors: ['#B347FF', '#C76BFF', '#00DDFF']
  }
];

export type FontSizeOption = 'small' | 'default' | 'large' | 'xlarge';

const THEME_KEY = 'antigravity_theme';
const SKIN_KEY = 'antigravity_skin';
const FONT_SIZE_KEY = 'antigravity_font_size';

let systemMediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export function getStoredTheme(): ThemeMode {
  const t = localStorage.getItem(THEME_KEY) || localStorage.getItem('hermes-theme');
  if (t === 'light' || t === 'dark' || t === 'system') {
    return t as ThemeMode;
  }
  return 'dark';
}

export function getStoredSkin(): string {
  const s = localStorage.getItem(SKIN_KEY) || localStorage.getItem('hermes-skin');
  const valid = AVAILABLE_SKINS.map((sk) => sk.id);
  if (s && valid.includes(s.toLowerCase())) {
    return s.toLowerCase();
  }
  return 'default';
}

export function getStoredFontSize(): FontSizeOption {
  const f = localStorage.getItem(FONT_SIZE_KEY) || localStorage.getItem('hermes-font-size');
  if (f === 'small' || f === 'default' || f === 'large' || f === 'xlarge') {
    return f as FontSizeOption;
  }
  return 'default';
}

export function setFontSize(size: FontSizeOption) {
  localStorage.setItem(FONT_SIZE_KEY, size);
  document.documentElement.setAttribute('data-font-size', size);
  window.dispatchEvent(new CustomEvent('antigravity-font-size-change', { detail: { fontSize: size } }));
}

export function applyAppearance(themeMode?: ThemeMode, skinName?: string, fontSize?: FontSizeOption) {
  const targetTheme = themeMode || getStoredTheme();
  const targetSkin = skinName !== undefined ? skinName : getStoredSkin();
  const targetFontSize = fontSize || getStoredFontSize();

  localStorage.setItem(THEME_KEY, targetTheme);
  localStorage.setItem(SKIN_KEY, targetSkin);
  localStorage.setItem(FONT_SIZE_KEY, targetFontSize);

  const root = document.documentElement;
  root.setAttribute('data-font-size', targetFontSize);

  // Resolve Dark vs Light
  let isDark = true;
  if (targetTheme === 'light') {
    isDark = false;
  } else if (targetTheme === 'dark') {
    isDark = true;
  } else {
    // System preference
    isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    // Attach dynamic listener for system changes
    if (!systemMediaListener) {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      systemMediaListener = (e: MediaQueryListEvent) => {
        if (getStoredTheme() === 'system') {
          root.classList.toggle('dark', e.matches);
          root.setAttribute('color-scheme', e.matches ? 'dark' : 'light');
        }
      };
      try {
        mq.addEventListener('change', systemMediaListener);
      } catch {
        mq.addListener(systemMediaListener as any);
      }
    }
  }

  // Force dark for dark-only skins like zeus
  const skinObj = AVAILABLE_SKINS.find((s) => s.id === targetSkin);
  if (skinObj?.isDarkOnly) {
    isDark = true;
  }

  if (isDark) {
    root.classList.add('dark');
    root.setAttribute('color-scheme', 'dark');
  } else {
    root.classList.remove('dark');
    root.setAttribute('color-scheme', 'light');
  }

  // Set Skin attribute
  if (targetSkin === 'default') {
    root.removeAttribute('data-skin');
  } else {
    root.setAttribute('data-skin', targetSkin);
  }

  root.setAttribute('data-theme', targetTheme);

  // Dispatch custom event for all components
  window.dispatchEvent(
    new CustomEvent('antigravity-appearance-change', {
      detail: { theme: targetTheme, skin: targetSkin, isDark }
    })
  );
}

// Universal apply function supporting both mode ('light', 'dark', 'system')
// and any skin name ('ares', 'sienna', 'catppuccin', etc.)
export function applyTheme(name: string): { type: 'theme' | 'skin'; value: string } {
  const normalized = name.trim().toLowerCase();
  const validThemes: ThemeMode[] = ['system', 'dark', 'light'];
  const validSkins = AVAILABLE_SKINS.map((s) => s.id);

  if (validThemes.includes(normalized as ThemeMode)) {
    applyAppearance(normalized as ThemeMode, undefined);
    return { type: 'theme', value: normalized };
  }

  if (validSkins.includes(normalized)) {
    applyAppearance(undefined, normalized);
    return { type: 'skin', value: normalized };
  }

  // Fallback default
  applyAppearance('dark', 'default');
  return { type: 'theme', value: 'dark' };
}

// Backward compatibility alias
export type AppTheme = string;
