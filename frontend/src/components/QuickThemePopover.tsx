import React, { useState, useEffect, useRef } from 'react';
import { 
  Sun, 
  Moon, 
  Monitor, 
  X, 
  Palette, 
  Check, 
  Sparkles, 
  RotateCcw,
  Type
} from 'lucide-react';
import { 
  AVAILABLE_THEMES, 
  ACCENT_PRESETS,
  getStoredTheme, 
  getStoredOledMode, 
  getStoredCustomAccent,
  getStoredFontSize,
  applyAppearance, 
  setFontSize,
  type ThemeMode,
  type FontSizeOption
} from '../services/theme';
import { useI18n } from '../services/i18n';

interface QuickThemePopoverProps {
  isOpen: boolean;
  onClose: () => void;
}

export const QuickThemePopover: React.FC<QuickThemePopoverProps> = ({ isOpen, onClose }) => {
  const { t } = useI18n();
  const popoverRef = useRef<HTMLDivElement>(null);
  
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(getStoredTheme);
  const [isOled, setIsOled] = useState<boolean>(getStoredOledMode);
  const [currentAccent, setCurrentAccent] = useState<string | null>(getStoredCustomAccent);
  const [currentFontSize, setCurrentFontSize] = useState<FontSizeOption>(getStoredFontSize);
  const [customHexInput, setCustomHexInput] = useState<string>(getStoredCustomAccent() || '#38BDF8');

  // Synchronize on external appearance change
  useEffect(() => {
    const handleAppearanceChange = (e: any) => {
      const detail = e.detail;
      if (detail) {
        if (detail.theme) setCurrentTheme(detail.theme);
        if (typeof detail.oled === 'boolean') setIsOled(detail.oled);
        if (detail.customAccent !== undefined) {
          setCurrentAccent(detail.customAccent);
          if (detail.customAccent) setCustomHexInput(detail.customAccent);
        }
      }
    };

    window.addEventListener('antigravity-appearance-change', handleAppearanceChange);
    return () => window.removeEventListener('antigravity-appearance-change', handleAppearanceChange);
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };

    window.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSelectTheme = (mode: ThemeMode) => {
    setCurrentTheme(mode);
    applyAppearance(mode, undefined, undefined, currentAccent, isOled);
  };

  const handleToggleOled = () => {
    const nextOled = !isOled;
    setIsOled(nextOled);
    // If switching to OLED, make sure theme is dark
    const targetTheme = nextOled && currentTheme === 'light' ? 'dark' : currentTheme;
    setCurrentTheme(targetTheme);
    applyAppearance(targetTheme, undefined, undefined, currentAccent, nextOled);
  };

  const handleSelectAccent = (hex: string | null) => {
    setCurrentAccent(hex);
    if (hex) setCustomHexInput(hex);
    applyAppearance(currentTheme, undefined, undefined, hex, isOled);
  };

  const handleSelectFontSize = (size: FontSizeOption) => {
    setCurrentFontSize(size);
    setFontSize(size);
  };

  return (
    <div 
      ref={popoverRef}
      className="fixed z-50 bottom-16 left-4 sm:left-6 w-80 max-w-[calc(100vw-2rem)] rounded-2xl shadow-2xl border p-4 animate-scaleUp select-none backdrop-blur-md"
      style={{
        backgroundColor: 'var(--surface, #111827)',
        borderColor: 'var(--border, #1E293B)',
        color: 'var(--text, #F8FAFC)',
      }}
      role="dialog"
      aria-label={t('quick_theme_settings', 'Personnalisation du thème')}
    >
      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          <div 
            className="w-6 h-6 rounded-lg flex items-center justify-center border"
            style={{
              backgroundColor: 'var(--accent-bg)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            <Palette className="w-3.5 h-3.5" />
          </div>
          <span className="text-xs font-bold" style={{ color: 'var(--strong)' }}>
            {t('theme_and_appearance', 'Thème & Apparence')}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors cursor-pointer"
          aria-label={t('close', 'Fermer')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-4 pt-3">
        {/* Theme Mode Selector */}
        <div>
          <label className="text-[10px] uppercase font-semibold tracking-wider block mb-1.5" style={{ color: 'var(--muted)' }}>
            {t('mode', 'Mode d\'affichage')}
          </label>
          <div className="grid grid-cols-3 gap-1.5 text-xs">
            {AVAILABLE_THEMES.map((th) => {
              const active = currentTheme === th.id && !isOled;
              const Icon = th.id === 'light' ? Sun : th.id === 'dark' ? Moon : Monitor;
              return (
                <button
                  key={th.id}
                  type="button"
                  onClick={() => {
                    if (isOled) setIsOled(false);
                    handleSelectTheme(th.id);
                  }}
                  className="py-1.5 px-2 rounded-xl border flex items-center justify-center gap-1.5 transition-all cursor-pointer font-medium"
                  style={{
                    backgroundColor: active ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    color: active ? 'var(--accent)' : 'var(--text)',
                  }}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[11px] capitalize">{th.id}</span>
                </button>
              );
            })}
          </div>

          {/* Pure OLED Toggle */}
          <button
            type="button"
            onClick={handleToggleOled}
            className={`w-full mt-2 py-1.5 px-2.5 rounded-xl border flex items-center justify-between transition-all cursor-pointer ${
              isOled ? 'ring-1 ring-amber-400/50' : ''
            }`}
            style={{
              backgroundColor: isOled ? '#000000' : 'var(--surface-subtle)',
              borderColor: isOled ? '#FACC15' : 'var(--border)',
              color: isOled ? '#FACC15' : 'var(--text)',
            }}
          >
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <div className="text-left">
                <span className="text-[11px] font-semibold block leading-tight">OLED Noir Pur</span>
                <span className="text-[9px] opacity-70 block">Fond #000000 absolu</span>
              </div>
            </div>
            <div 
              className={`w-4 h-4 rounded-md border flex items-center justify-center ${
                isOled ? 'bg-amber-400 border-amber-400 text-black' : 'border-slate-500'
              }`}
            >
              {isOled && <Check className="w-3 h-3 stroke-[3]" />}
            </div>
          </button>
        </div>

        {/* Custom Accent Color Palette */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-[10px] uppercase font-semibold tracking-wider block" style={{ color: 'var(--muted)' }}>
              {t('accent_color', 'Couleur d\'accent')}
            </label>
            {currentAccent && (
              <button
                type="button"
                onClick={() => handleSelectAccent(null)}
                className="text-[10px] text-rose-400 hover:underline flex items-center gap-0.5 cursor-pointer"
                title={t('reset_accent', 'Réinitialiser la couleur')}
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset</span>
              </button>
            )}
          </div>

          {/* Preset Swatches */}
          <div className="flex flex-wrap items-center gap-1.5">
            {ACCENT_PRESETS.map((preset) => {
              const active = currentAccent?.toLowerCase() === preset.hex.toLowerCase();
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleSelectAccent(preset.hex)}
                  className={`w-6 h-6 rounded-full transition-transform cursor-pointer flex items-center justify-center shadow-xs ${
                    active ? 'scale-125 ring-2 ring-offset-2 ring-white/60' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: preset.hex }}
                  title={preset.name}
                >
                  {active && <Check className="w-3.5 h-3.5 text-white stroke-[3] drop-shadow-xs" />}
                </button>
              );
            })}

            {/* Custom Hex Color Picker */}
            <label 
              className="w-6 h-6 rounded-full border border-dashed border-slate-400 hover:border-white transition-colors cursor-pointer flex items-center justify-center relative overflow-hidden"
              title="Choisir une couleur personnalisée (Hex)"
              style={{
                backgroundColor: currentAccent && !ACCENT_PRESETS.some(p => p.hex.toLowerCase() === currentAccent.toLowerCase()) 
                  ? currentAccent 
                  : 'transparent'
              }}
            >
              <input
                type="color"
                value={customHexInput}
                onChange={(e) => {
                  setCustomHexInput(e.target.value);
                  handleSelectAccent(e.target.value);
                }}
                className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
              />
              <span className="text-[10px] font-bold text-slate-300 pointer-events-none">+</span>
            </label>
          </div>
        </div>

        {/* Font Size Selector */}
        <div>
          <label className="text-[10px] uppercase font-semibold tracking-wider block mb-1.5 flex items-center gap-1" style={{ color: 'var(--muted)' }}>
            <Type className="w-3 h-3" />
            {t('font_size', 'Taille de texte')}
          </label>
          <div className="grid grid-cols-4 gap-1 text-[10px]">
            {(['small', 'default', 'large', 'xlarge'] as const).map((fs) => {
              const active = currentFontSize === fs;
              const labels: Record<string, string> = {
                small: 'Petite',
                default: 'Normale',
                large: 'Grande',
                xlarge: 'XL',
              };
              return (
                <button
                  key={fs}
                  type="button"
                  onClick={() => handleSelectFontSize(fs)}
                  className="py-1 rounded-md border font-medium text-center transition-colors cursor-pointer"
                  style={{
                    backgroundColor: active ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                    borderColor: active ? 'var(--accent)' : 'var(--border)',
                    color: active ? 'var(--accent)' : 'var(--muted)',
                    fontWeight: active ? 600 : 400,
                  }}
                >
                  {labels[fs]}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
