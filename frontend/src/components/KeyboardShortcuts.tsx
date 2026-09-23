import React from 'react';
import { Command, MessageSquare, CheckSquare } from 'lucide-react';
import { useI18n } from '../services/i18n';

interface ShortcutItem {
  keys: string[];
  descKey: string;
  defaultDesc: string;
}

interface ShortcutCategory {
  titleKey: string;
  defaultTitle: string;
  icon: React.ReactNode;
  items: ShortcutItem[];
}

export const KeyboardShortcuts: React.FC = () => {
  const { t } = useI18n();

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent);
  const modKey = isMac ? '⌘' : 'Ctrl';

  const categories: ShortcutCategory[] = [
    {
      titleKey: 'shortcuts_global',
      defaultTitle: 'Navigation & Général',
      icon: <Command className="w-4 h-4 text-sky-400" />,
      items: [
        {
          keys: [modKey, 'K'],
          descKey: 'shortcut_search',
          defaultDesc: 'Recherche rapide de sessions ou contenu',
        },
        {
          keys: [modKey, 'Shift', 'N'],
          descKey: 'shortcut_new_session',
          defaultDesc: 'Créer une nouvelle conversation',
        },
        {
          keys: [modKey, 'Shift', 'S'],
          descKey: 'shortcut_settings',
          defaultDesc: 'Ouvrir les paramètres',
        },
        {
          keys: [modKey, 'Shift', 'E'],
          descKey: 'shortcut_workspace',
          defaultDesc: 'Basculer le panneau Workspace (fichiers/git/kanban)',
        },
        {
          keys: ['?'],
          descKey: 'shortcut_help',
          defaultDesc: 'Afficher cette aide & raccourcis clavier',
        },
        {
          keys: ['Esc'],
          descKey: 'shortcut_esc',
          defaultDesc: 'Fermer les modales actives ou panneaux',
        },
      ],
    },
    {
      titleKey: 'shortcuts_composer',
      defaultTitle: 'Compositeur & Messages',
      icon: <MessageSquare className="w-4 h-4 text-emerald-400" />,
      items: [
        {
          keys: ['Enter'],
          descKey: 'shortcut_enter',
          defaultDesc: 'Envoyer le message ou exécuter la commande',
        },
        {
          keys: ['Shift', 'Enter'],
          descKey: 'shortcut_shift_enter',
          defaultDesc: 'Insérer un saut de ligne dans le texte',
        },
        {
          keys: ['/'],
          descKey: 'shortcut_slash',
          defaultDesc: 'Ouvrir le menu des slash commands',
        },
        {
          keys: ['↑', '↓'],
          descKey: 'shortcut_history',
          defaultDesc: 'Parcourir l\'historique des prompts ou naviguer',
        },
        {
          keys: ['Tab'],
          descKey: 'shortcut_autocomplete',
          defaultDesc: 'Compléter automatiquement la commande sélectionnée',
        },
      ],
    },
    {
      titleKey: 'shortcuts_bulk',
      defaultTitle: 'Actions Groupées (Mode Bulk)',
      icon: <CheckSquare className="w-4 h-4 text-amber-400" />,
      items: [
        {
          keys: ['Delete'],
          descKey: 'shortcut_bulk_delete',
          defaultDesc: 'Supprimer les sessions sélectionnées (avec confirmation)',
        },
        {
          keys: ['Esc'],
          descKey: 'shortcut_bulk_cancel',
          defaultDesc: 'Quitter la sélection groupée',
        },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {categories.map((cat, idx) => (
        <div key={idx} className="space-y-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-400">
            {cat.icon}
            <span>{t(cat.titleKey, cat.defaultTitle)}</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {cat.items.map((item, itemIdx) => (
              <div
                key={itemIdx}
                className="flex items-center justify-between p-3 rounded-xl border transition-colors"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)',
                }}
              >
                <span className="text-xs mr-3" style={{ color: 'var(--text)' }}>
                  {t(item.descKey, item.defaultDesc)}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  {item.keys.map((k, kIdx) => (
                    <kbd
                      key={kIdx}
                      className="px-2 py-0.5 rounded-md border font-mono text-[11px] font-bold shadow-xs transition-transform active:scale-95"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border2)',
                        color: 'var(--accent-text)',
                      }}
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
