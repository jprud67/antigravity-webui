export type ThemeMode = 'system' | 'dark' | 'light';

export interface SkinOption {
  id: string;
  name: string;
  nameKey?: string;
  desc: string;
  descKey?: string;
  colors: string[];
  isDarkOnly?: boolean;
}

export const AVAILABLE_THEMES: { id: ThemeMode; name: string; nameKey?: string; desc: string; descKey?: string }[] = [
  {
    id: 'system',
    name: 'System',
    nameKey: 'theme_system',
    desc: 'Automatically follows your operating system light or dark setting.',
    descKey: 'theme_system_desc'
  },
  {
    id: 'dark',
    name: 'Dark',
    nameKey: 'theme_dark',
    desc: 'Standard low-glare dark palette for prolonged sessions.',
    descKey: 'theme_dark_desc'
  },
  {
    id: 'light',
    name: 'Light',
    nameKey: 'theme_light',
    desc: 'Bright surfaces with dark contrasted text for illuminated environments.',
    descKey: 'theme_light_desc'
  }
];

export const AVAILABLE_SKINS: SkinOption[] = [
  {
    id: 'default',
    name: 'Default (Hermes Gold)',
    nameKey: 'skin_default',
    desc: 'Hermes original warm and understated gold accent.',
    descKey: 'skin_default_desc',
    colors: ['#FFD700', '#FFBF00', '#CD7F32']
  },
  {
    id: 'ares',
    name: 'Ares (Red)',
    nameKey: 'skin_ares',
    desc: 'Fiery high-energy red with assertive character.',
    descKey: 'skin_ares_desc',
    colors: ['#FF4444', '#CC3333', '#992222']
  },
  {
    id: 'mono',
    name: 'Mono (Gray)',
    nameKey: 'skin_mono',
    desc: 'Minimalist neutral gray without distraction for complete focus.',
    descKey: 'skin_mono_desc',
    colors: ['#CCCCCC', '#999999', '#666666']
  },
  {
    id: 'graphite',
    name: 'Graphite',
    nameKey: 'skin_graphite',
    desc: 'Modern workbench studio with crisp contrasts and neutral surfaces.',
    descKey: 'skin_graphite_desc',
    colors: ['#FFFFFF', '#D6D6D6', '#242424']
  },
  {
    id: 'github',
    name: 'GitHub',
    nameKey: 'skin_github',
    desc: 'Inspired by GitHub interface with action blue and adaptive surfaces.',
    descKey: 'skin_github_desc',
    colors: ['#0969DA', '#1F883D', '#242424']
  },
  {
    id: 'codex',
    name: 'Codex (OpenAI)',
    nameKey: 'skin_codex',
    desc: 'Clean editor surfaces with emerald green accents OpenAI Codex style.',
    descKey: 'skin_codex_desc',
    colors: ['#72B39A', '#242624', '#ECEBE4']
  },
  {
    id: 'terracotta',
    name: 'Terracotta (Claude)',
    nameKey: 'skin_terracotta',
    desc: 'Warm neutrals inspired by Anthropic Claude with terracotta accents.',
    descKey: 'skin_terracotta_desc',
    colors: ['#D97757', '#F0EEE6', '#141413']
  },
  {
    id: 'slate',
    name: 'Slate',
    nameKey: 'skin_slate',
    desc: 'Subtle, understated and elegant slate blue-gray.',
    descKey: 'skin_slate_desc',
    colors: ['#334155', '#475569', '#64748B']
  },
  {
    id: 'poseidon',
    name: 'Poseidon (Ocean)',
    nameKey: 'skin_poseidon',
    desc: 'Calm and soothing ocean blue for long thinking sessions.',
    descKey: 'skin_poseidon_desc',
    colors: ['#0EA5E9', '#0284C7', '#0369A1']
  },
  {
    id: 'sisyphus',
    name: 'Sisyphus (Purple)',
    nameKey: 'skin_sisyphus',
    desc: 'Distinctive bright purple without being flashy.',
    descKey: 'skin_sisyphus_desc',
    colors: ['#A78BFA', '#8B5CF6', '#7C3AED']
  },
  {
    id: 'charizard',
    name: 'Charizard (Orange)',
    nameKey: 'skin_charizard',
    desc: 'Energetic, warm and pleasant flame orange.',
    descKey: 'skin_charizard_desc',
    colors: ['#FB923C', '#F97316', '#EA580C']
  },
  {
    id: 'sienna',
    name: 'Sienna (Earth & Sand)',
    nameKey: 'skin_sienna',
    desc: 'Earth and sand palette with natural user bubbles and clay tones.',
    descKey: 'skin_sienna_desc',
    colors: ['#D97757', '#C06A49', '#9A523A']
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin (Mocha/Latte)',
    nameKey: 'skin_catppuccin',
    desc: 'Renowned Latte (light) and Mocha (dark) palette with Mauve accent.',
    descKey: 'skin_catppuccin_desc',
    colors: ['#CBA6F7', '#B4BEFE', '#8839EF']
  },
  {
    id: 'nous',
    name: 'Nous (Steel Blue)',
    nameKey: 'skin_nous',
    desc: 'Technical steel blue accent with distinct borders for engineers.',
    descKey: 'skin_nous_desc',
    colors: ['#4682B4', '#3A6E9A', '#2C5F88']
  },
  {
    id: 'geist-contrast',
    name: 'Geist Contrast',
    nameKey: 'skin_geist',
    desc: 'High-precision monochrome inspired by Geist with subtle yellow accent.',
    descKey: 'skin_geist_desc',
    colors: ['#000000', '#FFFFFF', '#FFF175']
  },
  {
    id: 'zeus',
    name: 'Zeus (OLED Black & Gold)',
    nameKey: 'skin_zeus',
    desc: 'Deep OLED pure black surfaces with Hermes gold accents.',
    descKey: 'skin_zeus_desc',
    colors: ['#FFD700', '#FFBF00', '#1A1A00'],
    isDarkOnly: true
  },
  {
    id: 'neon',
    name: 'Cyber Neon',
    nameKey: 'skin_neon',
    desc: 'Futuristic high-tech atmosphere with cyberpunk neon glows.',
    descKey: 'skin_neon_desc',
    colors: ['#B347FF', '#C76BFF', '#00DDFF']
  }
];

export interface AccentPreset {
  id: string;
  name: string;
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: 'sky', name: 'Bleu Ciel', hex: '#38BDF8' },
  { id: 'cyan', name: 'Néon Cyan', hex: '#06B6D4' },
  { id: 'purple', name: 'Cyber Violet', hex: '#A855F7' },
  { id: 'emerald', name: 'Émeraude', hex: '#10B981' },
  { id: 'gold', name: 'Or Solaire', hex: '#FACC15' },
  { id: 'orange', name: 'Ambre Cuivré', hex: '#F97316' },
  { id: 'rose', name: 'Sunset Rose', hex: '#EC4899' },
  { id: 'crimson', name: 'Rouge Crimson', hex: '#EF4444' },
  { id: 'indigo', name: 'Indigo Profond', hex: '#6366F1' },
];

export type FontSizeOption = 'small' | 'default' | 'large' | 'xlarge';

const THEME_KEY = 'antigravity_theme';
const SKIN_KEY = 'antigravity_skin';
const FONT_SIZE_KEY = 'antigravity_font_size';
const CUSTOM_ACCENT_KEY = 'antigravity_custom_accent';
const OLED_MODE_KEY = 'antigravity_oled_mode';

let systemMediaListener: ((e: MediaQueryListEvent) => void) | null = null;

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace('#', '').trim();
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return { r, g, b };
  }
  return null;
}

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

export function getStoredCustomAccent(): string | null {
  return localStorage.getItem(CUSTOM_ACCENT_KEY) || null;
}

export function setCustomAccent(hex: string | null) {
  if (hex) {
    localStorage.setItem(CUSTOM_ACCENT_KEY, hex);
  } else {
    localStorage.removeItem(CUSTOM_ACCENT_KEY);
  }
  applyAppearance();
}

export function getStoredOledMode(): boolean {
  return localStorage.getItem(OLED_MODE_KEY) === 'true';
}

export function setOledMode(enabled: boolean) {
  localStorage.setItem(OLED_MODE_KEY, enabled ? 'true' : 'false');
  applyAppearance();
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

export function applyAppearance(
  themeMode?: ThemeMode, 
  skinName?: string, 
  fontSize?: FontSizeOption,
  customAccentHex?: string | null,
  oledMode?: boolean
) {
  const targetTheme = themeMode || getStoredTheme();
  const targetSkin = skinName !== undefined ? skinName : getStoredSkin();
  const targetFontSize = fontSize || getStoredFontSize();
  const targetCustomAccent = customAccentHex !== undefined ? customAccentHex : getStoredCustomAccent();
  const targetOled = oledMode !== undefined ? oledMode : getStoredOledMode();

  localStorage.setItem(THEME_KEY, targetTheme);
  localStorage.setItem(SKIN_KEY, targetSkin);
  localStorage.setItem(FONT_SIZE_KEY, targetFontSize);
  if (targetCustomAccent) {
    localStorage.setItem(CUSTOM_ACCENT_KEY, targetCustomAccent);
  } else {
    localStorage.removeItem(CUSTOM_ACCENT_KEY);
  }
  localStorage.setItem(OLED_MODE_KEY, targetOled ? 'true' : 'false');

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
    if (targetOled) {
      root.setAttribute('data-oled', 'true');
    } else {
      root.removeAttribute('data-oled');
    }
  } else {
    root.classList.remove('dark');
    root.setAttribute('color-scheme', 'light');
    root.removeAttribute('data-oled');
  }

  // Set Skin attribute
  if (targetSkin === 'default') {
    root.removeAttribute('data-skin');
  } else {
    root.setAttribute('data-skin', targetSkin);
  }

  // Apply custom accent if set, otherwise clean inline overrides
  if (targetCustomAccent) {
    const rgb = hexToRgb(targetCustomAccent);
    if (rgb) {
      root.style.setProperty('--accent', targetCustomAccent);
      root.style.setProperty('--accent-hover', targetCustomAccent);
      root.style.setProperty('--accent-text', targetCustomAccent);
      root.style.setProperty('--accent-bg', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
      root.style.setProperty('--accent-bg-strong', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.22)`);
      root.style.setProperty('--focus-ring', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.35)`);
      root.style.setProperty('--focus-glow', `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.12)`);
    }
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-hover');
    root.style.removeProperty('--accent-text');
    root.style.removeProperty('--accent-bg');
    root.style.removeProperty('--accent-bg-strong');
    root.style.removeProperty('--focus-ring');
    root.style.removeProperty('--focus-glow');
  }

  root.setAttribute('data-theme', targetTheme);

  // Dispatch custom event for all components
  window.dispatchEvent(
    new CustomEvent('antigravity-appearance-change', {
      detail: { 
        theme: targetTheme, 
        skin: targetSkin, 
        isDark,
        oled: targetOled && isDark,
        customAccent: targetCustomAccent
      }
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
