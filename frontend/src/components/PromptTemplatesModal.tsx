import React, { useState, useMemo, useEffect } from 'react';
import { 
  FileCode2, 
  X, 
  Search, 
  Plus, 
  Sparkles, 
  Copy, 
  Check, 
  Trash2, 
  Edit3, 
  Code2, 
  Layers, 
  Bug, 
  FileText, 
  Bookmark, 
  Send
} from 'lucide-react';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';

export interface PromptTemplate {
  id: string;
  title: string;
  description: string;
  category: 'code' | 'architecture' | 'debug' | 'docs' | 'custom';
  content: string;
  isCustom?: boolean;
  isFavorite?: boolean;
}

const STORAGE_KEY = 'antigravity_custom_prompt_templates';

const getBuiltinTemplates = (t: (key: string, fallback: string) => string): PromptTemplate[] => [
  {
    id: 'code-review',
    title: t('tmpl_code_review_title', 'Revue de code approfondie'),
    description: t('tmpl_code_review_desc', 'Analyse critique de la qualité, robustesse, sécurité et maintenabilité du code.'),
    category: 'code',
    content: `Effectue une revue de code rigoureuse et constructive du code suivant :

{code}

Points clés à analyser :
1. Lisibilité, nommage et structure
2. Gestion des erreurs et cas limites
3. Performance et complexité algorithmique
4. Failles potentielles de sécurité
5. Suggestions concrètes d'amélioration avec extraits de code corrigés.`
  },
  {
    id: 'code-refactor',
    title: t('tmpl_code_refactor_title', 'Refactoring Clean Code & SOLID'),
    description: t('tmpl_code_refactor_desc', 'Modernise et restructure le code pour réduire la complexité et éliminer la duplication.'),
    category: 'code',
    content: `Refactorise le code suivant en appliquant les principes Clean Code et SOLID :

Objectif de refactoring : {goal}

Code source :
\`\`\`
{code}
\`\`\`

Consignes :
- Découpe en fonctions/classes cohésives et testables
- Supprime la duplication (DRY)
- Fournis le code refactorisé complet avec explications claires des choix d'architecture.`
  },
  {
    id: 'code-tests',
    title: t('tmpl_code_tests_title', 'Génération de tests unitaires'),
    description: t('tmpl_code_tests_desc', 'Génère une suite complète de tests (cas nominaux, limites, erreurs et mocks).'),
    category: 'code',
    content: `Génère une suite exhaustive de tests unitaires avec le framework {framework} pour le code suivant :

\`\`\`
{code}
\`\`\`

Couvre impérativement :
- Les cas nominaux
- Les valeurs limites (null, undefined, listes vides, nombres négatifs)
- Les levées d'exceptions et codes d'erreur
- Les mocks/stubs des dépendances externes.`
  },
  {
    id: 'archi-plan',
    title: t('tmpl_archi_plan_title', 'Plan d\'architecture par étapes'),
    description: t('tmpl_archi_plan_desc', 'Établit une stratégie technique détaillée avant toute implémentation.'),
    category: 'architecture',
    content: `Établis un plan d'architecture technique exhaustif par étapes pour accomplir l'objectif suivant :

Objectif : {goal}
Contraintes et environnement : {constraints}

Structure attendue :
1. Analyse des besoins et périmètre
2. Choix d'architecture et diagramme des flux/composants
3. Modèles de données / Schémas d'API
4. Plan d'exécution ordonné par étapes atomiques
5. Critères d'acceptation et stratégie de validation.`
  },
  {
    id: 'archi-impact',
    title: t('tmpl_archi_impact_title', 'Analyse d\'impact & régression'),
    description: t('tmpl_archi_impact_desc', 'Évalue les effets de bord et risques d\'un changement prévu.'),
    category: 'architecture',
    content: `Réalise une analyse d'impact préalable pour la modification suivante :

Modification prévue : {change}
Système / Composants existants : {system}

Analyse :
- Composants directement et indirectement impactés
- Risques de rupture (breaking changes) ou de régression
- Stratégie de migration douce et plan de retour arrière (rollback).`
  },
  {
    id: 'archi-api',
    title: t('tmpl_archi_api_title', 'Conception d\'API RESTful'),
    description: t('tmpl_archi_api_desc', 'Définit les routes, payloads JSON, statuts HTTP et gestion d\'erreurs.'),
    category: 'architecture',
    content: `Conçois une spécification d'API RESTful pour la ressource suivante :

Ressource : {resource}
Exigences métier : {requirements}

Détaille pour chaque endpoint :
- Méthode HTTP et URI
- Paramètres (query/path/headers)
- Corps de requête (JSON schema)
- Codes de retour HTTP avec exemples de réponses
- Règles de validation.`
  },
  {
    id: 'debug-bug',
    title: t('tmpl_debug_bug_title', 'Diagnostic & résolution de bug'),
    description: t('tmpl_debug_bug_desc', 'Méthode d\'investigation systématique avec reproduction et correctif.'),
    category: 'debug',
    content: `Je rencontre le bug suivant. Aide-moi à le diagnostiquer et à le résoudre :

Comportement observé / Erreur :
{error}

Contexte et étapes pour reproduire :
{context}

Procède ainsi :
1. Émets 2 ou 3 hypothèses sur la cause racine
2. Propose des vérifications ou commandes de diagnostic précises
3. Fournis le correctif recommandé avec explication.`
  },
  {
    id: 'debug-secu',
    title: t('tmpl_debug_secu_title', 'Audit de sécurité & vulnérabilités'),
    description: t('tmpl_debug_secu_desc', 'Vérifie les injections, autorisations, fuites de données et tokens.'),
    category: 'debug',
    content: `Effectue un audit de sécurité approfondi sur le code suivant :

\`\`\`
{code}
\`\`\`

Vérifie spécifiquement :
- Injections SQL / Command / XSS
- Contrôles d'accès et élévation de privilèges
- Exposition de secrets, clés d'API ou données sensibles
- Validation et assainissement des entrées utilisateurs
- Mesures de durcissement recommandées.`
  },
  {
    id: 'debug-logs',
    title: t('tmpl_debug_logs_title', 'Analyse de logs & stacktrace'),
    description: t('tmpl_debug_logs_desc', 'Interprète une trace d\'erreur ou des logs serveur complexes.'),
    category: 'debug',
    content: `Analyse les logs d'erreur suivants et identifie précisément le problème :

\`\`\`
{logs}
\`\`\`

Indique :
1. Le composant ou la ligne responsable
2. La séquence exacte d'événements ayant provoqué l'échec
3. La démarche de résolution immédiate.`
  },
  {
    id: 'docs-readme',
    title: t('tmpl_docs_readme_title', 'Rédaction de README technique'),
    description: t('tmpl_docs_readme_desc', 'Génère un README professionnel avec badges, installation et exemples.'),
    category: 'docs',
    content: `Rédige un fichier README.md de qualité professionnelle pour le projet suivant :

Nom et rôle du projet : {project}
Fonctionnalités clés : {features}

Inclus :
- Titre percutant et badge de statut
- Description claire de la proposition de valeur
- Prérequis et instructions d'installation pas-à-pas
- Exemple d'utilisation rapide (quick start)
- Architecture du projet et contribution.`
  },
  {
    id: 'docs-changelog',
    title: t('tmpl_docs_changelog_title', 'Changelog & Notes de version'),
    description: t('tmpl_docs_changelog_desc', 'Structure une release note claire regroupée par type de changements.'),
    category: 'docs',
    content: `Rédige les notes de version (Release Notes) pour la version {version} à partir des commits suivants :

{commits}

Catégorise selon la convention Keep a Changelog :
- 🚀 Nouveautés (Added)
- 🛠️ Améliorations (Changed)
- 🐛 Corrections de bugs (Fixed)
- ⚠️ Changements cassants (Breaking Changes, le cas échéant).`
  }
];

function loadCustomTemplates(): PromptTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function persistCustomTemplates(templates: PromptTemplate[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
  } catch {}
}

function extractVariables(content: string): string[] {
  const matches = content.match(/\{([a-zA-Z0-9_-]+)\}/g);
  if (!matches) return [];
  const vars = matches.map((m) => m.slice(1, -1));
  return Array.from(new Set(vars));
}

interface PromptTemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (finalPrompt: string) => void;
}

export const PromptTemplatesModal: React.FC<PromptTemplatesModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate
}) => {
  const { t } = useI18n();

  const [customTemplates, setCustomTemplates] = useState<PromptTemplate[]>(loadCustomTemplates);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState<PromptTemplate | null>(null);
  
  // Variables form state
  const [variableValues, setVariableValues] = useState<Record<string, string>>({});
  
  // Custom template editor state
  const [isEditingCustom, setIsEditingCustom] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editCategory, setEditCategory] = useState<'code' | 'architecture' | 'debug' | 'docs' | 'custom'>('custom');
  const [editContent, setEditContent] = useState('');

  // Handle Escape key to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Combine built-in & custom
  const builtinTemplates = useMemo(() => getBuiltinTemplates(t), [t]);
  const allTemplates = useMemo(() => {
    return [...customTemplates, ...builtinTemplates];
  }, [customTemplates, builtinTemplates]);

  // Filter templates
  const filteredTemplates = useMemo(() => {
    return allTemplates.filter((tmpl) => {
      if (selectedCategory !== 'all') {
        if (selectedCategory === 'custom') {
          if (!tmpl.isCustom) return false;
        } else if (tmpl.category !== selectedCategory) {
          return false;
        }
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = tmpl.title.toLowerCase().includes(q);
        const matchesDesc = tmpl.description.toLowerCase().includes(q);
        const matchesContent = tmpl.content.toLowerCase().includes(q);
        if (!matchesTitle && !matchesDesc && !matchesContent) return false;
      }

      return true;
    });
  }, [allTemplates, selectedCategory, searchQuery]);

  // Select a template
  const handlePickTemplate = (tmpl: PromptTemplate) => {
    setSelectedTemplate(tmpl);
    const vars = extractVariables(tmpl.content);
    const initVals: Record<string, string> = {};
    vars.forEach((v) => {
      initVals[v] = '';
    });
    setVariableValues(initVals);
  };

  // Compute final prompt with variable substitutions
  const previewPrompt = useMemo(() => {
    if (!selectedTemplate) return '';
    let result = selectedTemplate.content;
    Object.entries(variableValues).forEach(([k, v]) => {
      if (v.trim()) {
        result = result.replaceAll(`{${k}}`, v);
      }
    });
    return result;
  }, [selectedTemplate, variableValues]);

  const activeVariables = useMemo(() => {
    if (!selectedTemplate) return [];
    return extractVariables(selectedTemplate.content);
  }, [selectedTemplate]);

  // Insert prompt into composer
  const handleInsert = (raw = false) => {
    if (!selectedTemplate) return;
    const finalTxt = raw ? selectedTemplate.content : previewPrompt;
    onSelectTemplate(finalTxt);
    onClose();
    showToast(t('toast_template_inserted', 'Modèle de prompt inséré dans le chat'), 'success');
  };

  // Copy prompt
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!previewPrompt) return;
    navigator.clipboard.writeText(previewPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    showToast(t('copied_to_clipboard', 'Copié dans le presse-papiers'), 'info');
  };

  // Custom template save
  const handleSaveCustom = () => {
    if (!editTitle.trim() || !editContent.trim()) {
      showToast(t('title_and_content_required', 'Le titre et le contenu sont obligatoires'), 'error');
      return;
    }

    if (editId) {
      // Edit existing
      const updated = customTemplates.map((t) =>
        t.id === editId
          ? {
              ...t,
              title: editTitle.trim(),
              description: editDescription.trim(),
              category: editCategory,
              content: editContent.trim()
            }
          : t
      );
      setCustomTemplates(updated);
      persistCustomTemplates(updated);
      showToast(t('prompt_tpl_updated_toast', 'Modèle personnalisé mis à jour'), 'success');
    } else {
      // Create new
      const newTmpl: PromptTemplate = {
        id: 'custom-' + Date.now(),
        title: editTitle.trim(),
        description: editDescription.trim(),
        category: editCategory,
        content: editContent.trim(),
        isCustom: true
      };
      const updated = [newTmpl, ...customTemplates];
      setCustomTemplates(updated);
      persistCustomTemplates(updated);
      showToast(t('prompt_tpl_saved_toast', 'Nouveau modèle personnalisé enregistré'), 'success');
    }

    setIsEditingCustom(false);
    setEditId(null);
    setEditTitle('');
    setEditDescription('');
    setEditContent('');
  };

  // Custom template delete
  const handleDeleteCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customTemplates.filter((t) => t.id !== id);
    setCustomTemplates(updated);
    persistCustomTemplates(updated);
    if (selectedTemplate?.id === id) setSelectedTemplate(null);
    showToast(t('prompt_tpl_deleted_toast', 'Modèle supprimé'), 'info');
  };

  // Custom template edit start
  const handleStartEdit = (tmpl: PromptTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditId(tmpl.id);
    setEditTitle(tmpl.title);
    setEditDescription(tmpl.description);
    setEditCategory(tmpl.category);
    setEditContent(tmpl.content);
    setIsEditingCustom(true);
  };

  if (!isOpen) return null;

  const categories = [
    { id: 'all', label: t('all', 'Tous'), icon: Sparkles },
    { id: 'code', label: t('prompt_cat_code_tests', 'Code & Tests'), icon: Code2 },
    { id: 'architecture', label: t('prompt_cat_architecture', 'Architecture'), icon: Layers },
    { id: 'debug', label: t('prompt_cat_diagnostic', 'Diagnostic'), icon: Bug },
    { id: 'docs', label: t('prompt_cat_documentation', 'Documentation'), icon: FileText },
    { id: 'custom', label: t('my_templates', 'Mes modèles'), icon: Bookmark }
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/60 backdrop-blur-xs select-none">
      <div 
        className="w-full max-w-5xl h-[88vh] max-h-[820px] rounded-3xl border shadow-2xl flex flex-col overflow-hidden animate-scaleUp text-xs"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div 
          className="px-5 py-3.5 border-b flex items-center justify-between shrink-0"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
        >
          <div className="flex items-center gap-2.5">
            <div 
              className="w-8 h-8 rounded-xl flex items-center justify-center border shadow-xs"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              }}
            >
              <FileCode2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-bold text-sm tracking-tight" style={{ color: 'var(--strong)' }}>
                  Bibliothèque de Prompts & Snippets
                </h2>
                <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20">
                  {allTemplates.length} modèles
                </span>
              </div>
              <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                Modèles structurés avec variables dynamiques pour vos workflows réguliers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setEditId(null);
                setEditTitle('');
                setEditDescription('');
                setEditCategory('custom');
                setEditContent('');
                setIsEditingCustom(true);
              }}
              className="px-3 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-xs hover:scale-102"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent)'
              }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{t('prompt_tpl_new', 'Nouveau modèle')}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl border hover:bg-black/5 dark:hover:bg-white/5 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Layout */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Categories, Search & List */}
          <div 
            className="w-80 md:w-96 border-r flex flex-col shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            {/* Search Bar */}
            <div className="p-3 border-b space-y-2 shrink-0" style={{ borderColor: 'var(--border)' }}>
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder={t('prompt_tpl_search_placeholder', 'Rechercher un modèle ou snippet...')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--input-bg)',
                    border: '1px solid var(--border)',
                    color: 'var(--text)'
                  }}
                />
              </div>

              {/* Category Chips Bar */}
              <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-none text-[10px]">
                {categories.map((c) => {
                  const active = selectedCategory === c.id;
                  const Icon = c.icon;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSelectedCategory(c.id)}
                      className="px-2 py-1 rounded-lg border font-medium flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer"
                      style={{
                        backgroundColor: active ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                        color: active ? 'var(--accent)' : 'var(--muted)',
                        fontWeight: active ? 600 : 400
                      }}
                    >
                      <Icon className="w-3 h-3" />
                      <span>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Templates List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredTemplates.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  {t('prompt_tpl_no_results', 'Aucun modèle trouvé pour cette recherche.')}
                </div>
              ) : (
                filteredTemplates.map((tmpl) => {
                  const active = selectedTemplate?.id === tmpl.id;
                  const vars = extractVariables(tmpl.content);
                  return (
                    <div
                      key={tmpl.id}
                      onClick={() => handlePickTemplate(tmpl)}
                      className="p-3 rounded-2xl border transition-all cursor-pointer group shadow-xs hover:border-amber-400/40"
                      style={{
                        backgroundColor: active ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)'
                      }}
                    >
                      <div className="flex items-center justify-between gap-1.5 mb-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-semibold text-xs truncate" style={{ color: active ? 'var(--accent)' : 'var(--strong)' }}>
                            {tmpl.isCustom ? tmpl.title : t(`prompt_tpl_${tmpl.id}_title`, tmpl.title)}
                          </span>
                          {tmpl.isCustom && (
                            <span className="text-[9px] px-1 rounded bg-amber-500/15 text-amber-500 font-mono">
                              custom
                            </span>
                          )}
                        </div>

                        {tmpl.isCustom && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => handleStartEdit(tmpl, e)}
                              className="p-1 rounded hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-200"
                              title={t('prompt_tpl_edit_tooltip', 'Modifier ce modèle')}
                            >
                              <Edit3 className="w-3 h-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteCustom(tmpl.id, e)}
                              className="p-1 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-500"
                              title={t('prompt_tpl_delete_tooltip', 'Supprimer ce modèle')}
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        )}
                      </div>

                      <p className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {tmpl.isCustom ? tmpl.description : t(`prompt_tpl_${tmpl.id}_desc`, tmpl.description)}
                      </p>

                      {vars.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-2">
                          {vars.map((v) => (
                            <span 
                              key={v}
                              className="text-[9px] px-1.5 py-0.2 rounded-md font-mono border"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                                color: 'var(--muted)'
                              }}
                            >
                              {`{${v}}`}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Template Detail & Variable Inputs */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {isEditingCustom ? (
              // Custom Template Form
              <div className="flex-1 flex flex-col p-5 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center gap-2">
                    <Edit3 className="w-4 h-4 text-amber-500" />
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--strong)' }}>
                      {editId ? t('prompt_tpl_edit_custom', 'Modifier le modèle personnalisé') : t('prompt_tpl_create_new', 'Créer un nouveau modèle')}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditingCustom(false)}
                    className="text-xs text-slate-400 hover:text-slate-200"
                  >
                    {t('cancel', 'Annuler')}
                  </button>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--muted)' }}>
                      {t('prompt_tpl_title_label', 'Titre du modèle :')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('prompt_tpl_title_placeholder', 'Ex: Analyse de sécurité OWASP, Refactoring SQL...')}
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--muted)' }}>
                      {t('prompt_tpl_desc_label', 'Description courte :')}
                    </label>
                    <input
                      type="text"
                      placeholder={t('prompt_tpl_desc_placeholder', "Ex: Examine les failles d'injection et l'authentification...")}
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold block mb-1" style={{ color: 'var(--muted)' }}>
                      {t('category_colon', 'Catégorie :')}
                    </label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl text-xs outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <option value="code">{t('prompt_cat_code_tests', 'Code & Tests')}</option>
                      <option value="architecture">{t('prompt_cat_architecture', 'Architecture')}</option>
                      <option value="debug">{t('prompt_cat_diagnostic', 'Diagnostic')}</option>
                      <option value="docs">{t('prompt_cat_documentation', 'Documentation')}</option>
                      <option value="custom">{t('prompt_cat_other', 'Autre / Perso')}</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-semibold" style={{ color: 'var(--muted)' }}>
                        {t('prompt_tpl_content_label', 'Contenu du prompt (support des balises {variable}) :')}
                      </label>
                      <span className="text-[10px] text-amber-500 font-mono">
                        {t('prompt_tpl_syntax_hint', 'Syntaxe : {code}, {file}, {goal}...')}
                      </span>
                    </div>
                    <textarea
                      rows={8}
                      placeholder={t('prompt_tpl_content_placeholder', 'Tapez le prompt avec des variables entre accolades comme {code} ou {goal}...')}
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs font-mono outline-none leading-relaxed"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                  <button
                    type="button"
                    onClick={() => setIsEditingCustom(false)}
                    className="px-3 py-1.5 rounded-xl border text-xs"
                    style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                  >
                    {t('cancel', 'Annuler')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveCustom}
                    className="px-4 py-1.5 rounded-xl text-xs font-semibold text-white cursor-pointer"
                    style={{ backgroundColor: 'var(--accent)' }}
                  >
                    {t('prompt_tpl_save_model', 'Enregistrer le modèle')}
                  </button>
                </div>
              </div>
            ) : selectedTemplate ? (
              // Selected Template View & Form
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div 
                  className="p-4 border-b flex items-center justify-between shrink-0"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
                >
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm truncate" style={{ color: 'var(--strong)' }}>
                      {selectedTemplate.isCustom ? selectedTemplate.title : t(`prompt_tpl_${selectedTemplate.id}_title`, selectedTemplate.title)}
                    </h3>
                    <p className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>
                      {selectedTemplate.isCustom ? selectedTemplate.description : t(`prompt_tpl_${selectedTemplate.id}_desc`, selectedTemplate.description)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="px-2.5 py-1.5 rounded-xl border flex items-center gap-1.5 text-xs transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                      style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
                      title={t('prompt_tpl_copy_resolved_tooltip', 'Copier le prompt résolu')}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copied ? 'Copié' : 'Copier'}</span>
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Dynamic Variables Form */}
                  {activeVariables.length > 0 && (
                    <div 
                      className="p-3.5 rounded-2xl border space-y-3"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)'
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-amber-500 flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          {t('prompt_tpl_variables_to_fill', 'Variables à renseigner')} ({activeVariables.length})
                        </span>
                        <span className="text-[10px] text-slate-400">
                          {t('prompt_tpl_optional_fill_after', '(Optionnel : vous pouvez insérer brut et remplir après)')}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 gap-2.5">
                        {activeVariables.map((v) => (
                          <div key={v}>
                            <label className="text-[11px] font-mono font-medium block mb-1" style={{ color: 'var(--text)' }}>
                              {`{${v}}`} :
                            </label>
                            {v.toLowerCase().includes('code') || v.toLowerCase().includes('logs') || v.toLowerCase().includes('commits') ? (
                              <textarea
                                rows={3}
                                placeholder={`${t('prompt_tpl_paste_content_for', 'Collez le contenu pour')} {${v}}...`}
                                value={variableValues[v] || ''}
                                onChange={(e) => setVariableValues({ ...variableValues, [v]: e.target.value })}
                                className="w-full px-3 py-1.5 rounded-xl text-xs font-mono outline-none"
                                style={{
                                  backgroundColor: 'var(--input-bg)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--text)'
                                }}
                              />
                            ) : (
                              <input
                                type="text"
                                placeholder={`${t('prompt_tpl_value_for', 'Valeur pour')} {${v}}...`}
                                value={variableValues[v] || ''}
                                onChange={(e) => setVariableValues({ ...variableValues, [v]: e.target.value })}
                                className="w-full px-3 py-1.5 rounded-xl text-xs outline-none"
                                style={{
                                  backgroundColor: 'var(--input-bg)',
                                  border: '1px solid var(--border)',
                                  color: 'var(--text)'
                                }}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Preview Area */}
                  <div>
                    <label className="text-[10px] uppercase font-bold tracking-wider block mb-1.5" style={{ color: 'var(--muted)' }}>
                      {t('prompt_tpl_preview_title', 'Aperçu du prompt généré :')}
                    </label>
                    <pre 
                      className="p-3.5 rounded-2xl border text-xs font-mono whitespace-pre-wrap leading-relaxed overflow-x-auto max-h-72"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      {previewPrompt}
                    </pre>
                  </div>
                </div>

                {/* Footer Actions */}
                <div 
                  className="p-3.5 border-t flex items-center justify-between shrink-0"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
                >
                  <button
                    type="button"
                    onClick={() => handleInsert(true)}
                    className="px-3 py-1.5 rounded-xl border text-xs transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                    title={t('prompt_tpl_insert_raw_tooltip', 'Insérer le texte tel quel avec les balises {variable}')}
                  >
                    {t('prompt_tpl_insert_raw_btn', 'Insérer avec balises brutes')}
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleInsert(false)}
                      className="px-4 py-2 rounded-xl text-xs font-semibold text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-sm hover:scale-102"
                      style={{ backgroundColor: 'var(--accent)' }}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{t('prompt_tpl_insert_in_prompt', 'Insérer dans le prompt')}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              // Empty State
              <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
                <div 
                  className="w-12 h-12 rounded-2xl flex items-center justify-center border shadow-xs"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--accent)'
                  }}
                >
                  <FileCode2 className="w-6 h-6" />
                </div>
                <h4 className="font-semibold text-sm" style={{ color: 'var(--strong)' }}>
                  {t('prompt_tpl_select_title', 'Sélectionnez un modèle de prompt')}
                </h4>
                <p className="text-xs max-w-sm leading-relaxed" style={{ color: 'var(--muted)' }}>
                  {t('prompt_tpl_select_desc', 'Choisissez un modèle prédéfini à gauche ou créez votre propre template avec des variables dynamiques réutilisables.')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
