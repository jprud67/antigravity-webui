import {
  HelpCircle,
  Trash2,
  PlusCircle,
  Cpu,
  Palette,
  Folder,
  Terminal,
  Sparkles,
  Wrench,
  Square,
  Layers,
  Compass,
  RotateCcw,
  Undo2,
  MessageSquareText,
  Activity,
  Mic,
  SlidersHorizontal,
  Zap,
  GitBranch,
  Minimize2,
  Download,
  Edit3,
  PieChart,
  Clock,
  GitPullRequest,
  Kanban as KanbanIcon,
  Shield,
  Globe,
  MessageSquareCode,
  CalendarClock,
  Flame,
  Users,
  GraduationCap,
  Paperclip,
  Languages,
  ListTodo,
  KeyRound,
  UserCheck,
  Coins,
  History,
  RefreshCw
} from 'lucide-react';

export interface SlashCommandDef {
  cmd: string;
  desc: string;
  descKey?: string;
  arg?: string;
  category: 'workflow' | 'action' | 'system' | 'panel';
  icon: any;
  color: string;
  isAction?: boolean; // true = executes local action immediately, false = prompt workflow
}

export const ALL_SLASH_COMMANDS: SlashCommandDef[] = [
  // Antigravity & Agentic Workflows
  {
    cmd: '/plan',
    descKey: 'cmd_desc_plan',
    desc: 'Planifier et concevoir une architecture avant d\'exécuter',
    arg: '<texte>',
    category: 'workflow',
    icon: Compass,
    color: 'text-sky-400'
  },
  {
    cmd: '/goal',
    descKey: 'cmd_desc_goal',
    desc: 'Tâche long cours autonome approfondie sans interruption',
    arg: '<objectif>',
    category: 'workflow',
    icon: Zap,
    color: 'text-amber-400'
  },
  {
    cmd: '/browser',
    descKey: 'cmd_desc_browser',
    desc: 'Navigation web, recherche d\'information et scraping',
    arg: '<url ou tâche>',
    category: 'workflow',
    icon: Globe,
    color: 'text-emerald-400'
  },
  {
    cmd: '/grill-me',
    descKey: 'cmd_desc_grillme',
    desc: 'Entretien interactif d\'alignement et cadrage préalable',
    arg: '<sujet>',
    category: 'workflow',
    icon: MessageSquareCode,
    color: 'text-purple-400'
  },
  {
    cmd: '/boost',
    descKey: 'cmd_desc_boost',
    desc: 'Raisonnement profond multi-perspectives et vérification',
    arg: '<problème>',
    category: 'workflow',
    icon: Flame,
    color: 'text-rose-400'
  },
  {
    cmd: '/teamwork-preview',
    descKey: 'cmd_desc_teamworkpreview',
    desc: 'Orchestration d\'une équipe de sous-agents autonomes',
    arg: '<mission>',
    category: 'workflow',
    icon: Users,
    color: 'text-indigo-400'
  },
  {
    cmd: '/learn',
    descKey: 'cmd_desc_learn',
    desc: 'Mémoriser une habitude ou règle permanente dans AGENTS.md',
    arg: '<règle>',
    category: 'workflow',
    icon: GraduationCap,
    color: 'text-teal-400'
  },
  {
    cmd: '/schedule',
    descKey: 'cmd_desc_schedule',
    desc: 'Planification récurrente (cron) ou minuteur différé',
    arg: '<instruction>',
    category: 'workflow',
    icon: CalendarClock,
    color: 'text-orange-400'
  },

  // Execution & Steering (Hermes Parity)
  {
    cmd: '/steer',
    descKey: 'cmd_desc_steer',
    desc: 'Interrompre l\'étape en cours et réorienter l\'agent',
    arg: '<instruction>',
    category: 'action',
    icon: Compass,
    color: 'text-amber-400',
    isAction: true
  },
  {
    cmd: '/interrupt',
    descKey: 'cmd_desc_interrupt',
    desc: 'Interrompre immédiatement l\'étape et réorienter l\'agent',
    arg: '<instruction>',
    category: 'action',
    icon: Square,
    color: 'text-rose-400',
    isAction: true
  },
  {
    cmd: '/queue',
    descKey: 'cmd_desc_queue',
    desc: 'Placer une instruction en attente pour le tour suivant',
    arg: '<instruction>',
    category: 'action',
    icon: Layers,
    color: 'text-sky-400',
    isAction: true
  },
  {
    cmd: '/stop',
    descKey: 'cmd_desc_stop',
    desc: 'Interrompre immédiatement la génération ou l\'exécution',
    category: 'action',
    icon: Square,
    color: 'text-rose-500',
    isAction: true
  },
  {
    cmd: '/yolo',
    descKey: 'cmd_desc_yolo',
    desc: 'Basculer le mode Auto-Run (exécution autonome sans confirmation)',
    category: 'action',
    icon: Zap,
    color: 'text-yellow-400',
    isAction: true
  },
  {
    cmd: '/retry',
    descKey: 'cmd_desc_retry',
    desc: 'Relancer la dernière instruction de l\'utilisateur',
    category: 'action',
    icon: RotateCcw,
    color: 'text-blue-400',
    isAction: true
  },
  {
    cmd: '/undo',
    descKey: 'cmd_desc_undo',
    desc: 'Annuler le dernier tour d\'échange de la conversation',
    category: 'action',
    icon: Undo2,
    color: 'text-slate-400',
    isAction: true
  },
  {
    cmd: '/btw',
    descKey: 'cmd_desc_btw',
    desc: 'Poser une question rapide en aparté sans altérer le contexte',
    arg: '<question>',
    category: 'workflow',
    icon: MessageSquareText,
    color: 'text-violet-400'
  },
  {
    cmd: '/background',
    descKey: 'cmd_desc_background',
    desc: 'Lancer une tâche autonome en arrière-plan',
    arg: '<prompt>',
    category: 'workflow',
    icon: Zap,
    color: 'text-emerald-400'
  },

  // Appearance & Languages
  {
    cmd: '/theme',
    descKey: 'cmd_desc_theme',
    desc: 'Changer de thème (dark, light, system) ou de skin (ares, sienna, catppuccin...)',
    arg: '<nom>',
    category: 'system',
    icon: Palette,
    color: 'text-fuchsia-400',
    isAction: true
  },
  {
    cmd: '/lang',
    descKey: 'cmd_desc_lang',
    desc: 'Changer la langue de l\'interface (fr, en, es, zh, ja, de, it...)',
    arg: '<code>',
    category: 'system',
    icon: Languages,
    color: 'text-cyan-400',
    isAction: true
  },
  {
    cmd: '/language',
    descKey: 'cmd_desc_language',
    desc: 'Alias de /lang pour changer la langue de l\'interface',
    arg: '<code>',
    category: 'system',
    icon: Languages,
    color: 'text-cyan-400',
    isAction: true
  },

  // Configuration & Models
  {
    cmd: '/account',
    descKey: 'cmd_desc_account',
    desc: 'Afficher et changer le compte Google actif Antigravity',
    category: 'system',
    icon: UserCheck,
    color: 'text-blue-400',
    isAction: true
  },
  {
    cmd: '/google',
    descKey: 'cmd_desc_google',
    desc: 'Alias de /account pour gérer et basculer de compte Google',
    category: 'system',
    icon: KeyRound,
    color: 'text-blue-400',
    isAction: true
  },
  {
    cmd: '/model',
    descKey: 'cmd_desc_model',
    desc: 'Changer de modèle d\'intelligence artificielle actif',
    arg: '<nom_modèle>',
    category: 'system',
    icon: Cpu,
    color: 'text-sky-400',
    isAction: true
  },
  {
    cmd: '/reasoning',
    descKey: 'cmd_desc_reasoning',
    desc: 'Régler le niveau d\'effort de réflexion (low, medium, high)',
    arg: 'low|medium|high',
    category: 'system',
    icon: SlidersHorizontal,
    color: 'text-indigo-400',
    isAction: true
  },
  {
    cmd: '/voice',
    descKey: 'cmd_desc_voice',
    desc: 'Activer ou désactiver la dictée vocale au microphone',
    category: 'action',
    icon: Mic,
    color: 'text-pink-400',
    isAction: true
  },
  {
    cmd: '/workspace',
    descKey: 'cmd_desc_workspace',
    desc: 'Afficher ou basculer le répertoire de travail courant',
    arg: '<chemin>',
    category: 'system',
    icon: Folder,
    color: 'text-amber-400',
    isAction: true
  },

  // Conversation Management
  {
    cmd: '/clear',
    descKey: 'cmd_desc_clear',
    desc: 'Effacer l\'affichage des messages du chat actif',
    category: 'action',
    icon: Trash2,
    color: 'text-red-400',
    isAction: true
  },
  {
    cmd: '/new',
    descKey: 'cmd_desc_new',
    desc: 'Démarrer une nouvelle conversation vierge',
    category: 'action',
    icon: PlusCircle,
    color: 'text-emerald-400',
    isAction: true
  },
  {
    cmd: '/branch',
    descKey: 'cmd_desc_branch',
    desc: 'Créer une nouvelle branche (bifurcation) de cette session',
    category: 'action',
    icon: GitBranch,
    color: 'text-purple-400',
    isAction: true
  },
  {
    cmd: '/compress',
    descKey: 'cmd_desc_compress',
    desc: 'Compacter et résumer la fenêtre de contexte',
    arg: '[sujet]',
    category: 'action',
    icon: Minimize2,
    color: 'text-cyan-400',
    isAction: true
  },
  {
    cmd: '/compact',
    descKey: 'cmd_desc_compact',
    desc: 'Alias de /compress pour compacter le contexte',
    arg: '[sujet]',
    category: 'action',
    icon: Minimize2,
    color: 'text-cyan-400',
    isAction: true
  },
  {
    cmd: '/export',
    descKey: 'cmd_desc_export',
    desc: 'Exporter la session (HTML, Markdown, JSON)',
    category: 'action',
    icon: Download,
    color: 'text-blue-400',
    isAction: true
  },
  {
    cmd: '/title',
    descKey: 'cmd_desc_title',
    desc: 'Renommer le titre de la conversation en cours',
    arg: '<nouveau_titre>',
    category: 'action',
    icon: Edit3,
    color: 'text-emerald-400',
    isAction: true
  },
  {
    cmd: '/usage',
    descKey: 'cmd_desc_usage',
    desc: 'Afficher les quotas Antigravity et les métriques de tokens',
    category: 'system',
    icon: PieChart,
    color: 'text-yellow-400',
    isAction: true
  },
  {
    cmd: '/quota',
    descKey: 'cmd_desc_quota',
    desc: 'Alias de /usage pour afficher les quotas et limites de tokens',
    category: 'system',
    icon: PieChart,
    color: 'text-yellow-400',
    isAction: true
  },
  {
    cmd: '/credits',
    descKey: 'cmd_desc_credits',
    desc: 'Afficher les crédits Antigravity G1 et le lien de recharge',
    category: 'system',
    icon: Coins,
    color: 'text-amber-400',
    isAction: true
  },
  {
    cmd: '/changelog',
    descKey: 'cmd_desc_changelog',
    desc: 'Afficher les notes de version et nouveautés d\'Antigravity CLI',
    category: 'system',
    icon: History,
    color: 'text-sky-400',
    isAction: true
  },
  {
    cmd: '/status',
    descKey: 'cmd_desc_status',
    desc: 'Afficher l\'état de santé du serveur et de la session',
    category: 'system',
    icon: Activity,
    color: 'text-emerald-400',
    isAction: true
  },
  {
    cmd: '/update',
    descKey: 'cmd_desc_update',
    desc: 'Vérifier et installer les mises à jour Antigravity WebUI (Système Hermes)',
    category: 'system',
    icon: RefreshCw,
    color: 'text-sky-400',
    isAction: true
  },
  {
    cmd: '/check-update',
    descKey: 'cmd_desc_checkupdate',
    desc: 'Vérifier la disponibilité d\'une nouvelle version sur GitHub origin/main',
    category: 'system',
    icon: RefreshCw,
    color: 'text-cyan-400',
    isAction: true
  },

  // Interactive Panels & Tools
  {
    cmd: '/terminal',
    descKey: 'cmd_desc_terminal',
    desc: 'Ouvrir le terminal interactif système',
    category: 'panel',
    icon: Terminal,
    color: 'text-amber-400',
    isAction: true
  },
  {
    cmd: '/skills',
    descKey: 'cmd_desc_skills',
    desc: 'Consulter la liste des compétences et outils installés',
    category: 'panel',
    icon: Sparkles,
    color: 'text-indigo-400',
    isAction: true
  },
  {
    cmd: '/use',
    descKey: 'cmd_desc_use',
    desc: 'Forcer l\'agent à consulter et utiliser une compétence spécifique',
    arg: '<nom_du_skill>',
    category: 'action',
    icon: Wrench,
    color: 'text-sky-400',
    isAction: true
  },
  {
    cmd: '/tasks',
    descKey: 'cmd_desc_tasks',
    desc: 'Ouvrir le tableau de bord des tâches et sous-agents',
    category: 'panel',
    icon: ListTodo,
    color: 'text-emerald-400',
    isAction: true
  },
  {
    cmd: '/files',
    descKey: 'cmd_desc_files',
    desc: 'Ouvrir l\'explorateur de fichiers du workspace',
    category: 'panel',
    icon: Paperclip,
    color: 'text-teal-400',
    isAction: true
  },
  {
    cmd: '/attach',
    descKey: 'cmd_desc_attach',
    desc: 'Alias de /files pour explorer et attacher des fichiers',
    category: 'panel',
    icon: Paperclip,
    color: 'text-teal-400',
    isAction: true
  },
  {
    cmd: '/git',
    descKey: 'cmd_desc_git',
    desc: 'Ouvrir le volet de gestion de version Git',
    category: 'panel',
    icon: GitPullRequest,
    color: 'text-rose-400',
    isAction: true
  },
  {
    cmd: '/kanban',
    descKey: 'cmd_desc_kanban',
    desc: 'Ouvrir le tableau de bord Kanban de suivi de projet',
    category: 'panel',
    icon: KanbanIcon,
    color: 'text-violet-400',
    isAction: true
  },
  {
    cmd: '/crons',
    descKey: 'cmd_desc_crons',
    desc: 'Ouvrir le planificateur de tâches récurrentes',
    category: 'panel',
    icon: Clock,
    color: 'text-amber-400',
    isAction: true
  },
  {
    cmd: '/rules',
    descKey: 'cmd_desc_rules',
    desc: 'Ouvrir l\'éditeur de règles système (AGENTS.md)',
    category: 'panel',
    icon: Shield,
    color: 'text-emerald-400',
    isAction: true
  },
  {
    cmd: '/help',
    descKey: 'cmd_desc_help',
    desc: 'Afficher l\'aide complète des commandes et raccourcis',
    category: 'system',
    icon: HelpCircle,
    color: 'text-sky-400',
    isAction: true
  }
];

export function parseSlashCommand(input: string): { cmd: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;
  const spaceIdx = trimmed.search(/\s/);
  if (spaceIdx === -1) {
    return { cmd: trimmed.toLowerCase(), args: '' };
  }
  return {
    cmd: trimmed.slice(0, spaceIdx).toLowerCase(),
    args: trimmed.slice(spaceIdx).trim()
  };
}
