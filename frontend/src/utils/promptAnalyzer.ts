/**
 * Instant Client-Side Prompt Clarity & Heuristic Analyzer
 * Zero external dependencies, ultra-fast regex evaluation for 60fps typing responsiveness.
 */

const FILE_RE = /(?:`([a-zA-Z0-9_./-]+\.[a-zA-Z0-9_]+)`|\b([a-zA-Z0-9_./-]+\.(?:py|tsx?|jsx?|json|html|css|scss|md|yaml|yml|sh|rs|go|cpp|c|h|java|sql|toml))\b)/gi;
const ERROR_LOG_RE = /\b(?:error|exception|traceback|fail|failed|failure|erreur|crash|status of (?:500|400|404|403)|stack trace|typeerror|syntaxerror|referenceerror|attributeerror)\b/i;
const CONSTRAINTS_RE = /\b(?:sans|ne pas|n'ajoute pas|n'oublie pas|do not|without|conserver|preserve|strictement|strict|doit|must|only|uniquement|sans casser|non-breaking)\b/i;
const ACTION_VERBS_RE = /\b(?:corrige|corriger|créer|creer|implémente|implementer|ajoute|ajouter|optimise|optimiser|refactorise|refactorer|revoir|analyse|analyser|fix|create|implement|add|optimize|refactor|review|build|setup|inspect)\b/i;
const FORMAT_RE = /\b(?:diff|patch|markdown|json|étapes|etapes|steps|liste|code complet|unifié|unifie|syntaxe)\b/i;

export interface PromptClarityBreakdown {
  context: number;      // 0 - 25
  objective: number;    // 0 - 25
  constraints: number;  // 0 - 25
  outputFormat: number; // 0 - 25
}

export interface PromptClarityAssessment {
  score: number;        // 0 - 100
  level: 'empty' | 'low' | 'medium' | 'high';
  color: string;
  badgeBg: string;
  breakdown: PromptClarityBreakdown;
  wordCount: number;
  charCount: number;
  estimatedTokens: number;
  detectedFiles: string[];
  hasErrorLogs: boolean;
  hasCodeBlock: boolean;
  hasConstraints: boolean;
  hasAction: boolean;
  hasFormat: boolean;
  topSuggestion?: string;
}

export function calculatePromptClarity(rawPrompt: string): PromptClarityAssessment {
  const prompt = (rawPrompt || '').trim();
  const words = prompt.length > 0 ? prompt.split(/\s+/) : [];
  const wordCount = words.length;
  const charCount = prompt.length;
  const estimatedTokens = Math.max(wordCount, Math.ceil(charCount / 3.8));

  if (!prompt || wordCount === 0) {
    return {
      score: 0,
      level: 'empty',
      color: 'var(--muted)',
      badgeBg: 'transparent',
      breakdown: { context: 0, objective: 0, constraints: 0, outputFormat: 0 },
      wordCount: 0,
      charCount: 0,
      estimatedTokens: 0,
      detectedFiles: [],
      hasErrorLogs: false,
      hasCodeBlock: false,
      hasConstraints: false,
      hasAction: false,
      hasFormat: false,
      topSuggestion: 'Saisissez une description de votre tâche pour évaluer sa clarté.',
    };
  }

  // Extract detected files
  const detectedFiles: string[] = [];
  let fileMatch: RegExpExecArray | null;
  const reClone = new RegExp(FILE_RE.source, 'gi');
  while ((fileMatch = reClone.exec(prompt)) !== null) {
    const f = fileMatch[1] || fileMatch[2];
    if (f && !f.startsWith('http://') && !f.startsWith('https://')) {
      const clean = f.replace(/`/g, '');
      if (!detectedFiles.includes(clean)) {
        detectedFiles.push(clean);
      }
    }
  }

  const hasErrorLogs = ERROR_LOG_RE.test(prompt);
  const hasCodeBlock = prompt.includes('```') || (prompt.includes('`') && detectedFiles.length === 0);
  const hasConstraints = CONSTRAINTS_RE.test(prompt);
  const hasAction = ACTION_VERBS_RE.test(prompt);
  const hasFormat = FORMAT_RE.test(prompt);

  // Breakdown scores (each 0 - 25)
  // 1. Context (0 - 25)
  let contextScore = 0;
  if (detectedFiles.length > 0) contextScore += 15;
  if (hasErrorLogs || hasCodeBlock) contextScore += 5;
  if (wordCount >= 15) contextScore += 5;
  contextScore = Math.min(25, contextScore);

  // 2. Objective (0 - 25)
  let objectiveScore = 0;
  if (hasAction) objectiveScore += 15;
  if (wordCount >= 5) objectiveScore += 5;
  if (/pour|afin de|dans le but|to|in order to/i.test(prompt)) objectiveScore += 5;
  objectiveScore = Math.min(25, Math.max(wordCount > 0 ? 5 : 0, objectiveScore));

  // 3. Constraints (0 - 25)
  let constraintsScore = 0;
  if (hasConstraints) constraintsScore += 20;
  if (/sans|strict/i.test(prompt)) constraintsScore += 5;
  constraintsScore = Math.min(25, constraintsScore);

  // 4. Output format (0 - 25)
  let formatScore = 0;
  if (hasFormat) formatScore += 20;
  if (prompt.includes('?') || prompt.includes(':')) formatScore += 5;
  formatScore = Math.min(25, formatScore);

  const score = Math.min(100, contextScore + objectiveScore + constraintsScore + formatScore);

  let level: 'empty' | 'low' | 'medium' | 'high' = 'low';
  let color = '#ef4444'; // Red
  let badgeBg = 'rgba(239, 68, 68, 0.15)';

  if (score >= 75) {
    level = 'high';
    color = '#10b981'; // Emerald
    badgeBg = 'rgba(16, 185, 129, 0.15)';
  } else if (score >= 45) {
    level = 'medium';
    color = '#f59e0b'; // Amber
    badgeBg = 'rgba(245, 158, 11, 0.15)';
  } else {
    level = 'low';
    color = '#ec4899'; // Rose
    badgeBg = 'rgba(236, 72, 153, 0.15)';
  }

  // Determine top suggestion
  let topSuggestion: string | undefined;
  if (contextScore < 15) {
    topSuggestion = 'Mentionnez les fichiers cibles ou le code concerné.';
  } else if (objectiveScore < 15) {
    topSuggestion = 'Ajoutez un verbe d\'action précis (corriger, ajouter, analyser).';
  } else if (constraintsScore < 10) {
    topSuggestion = 'Précisez une contrainte (ex: sans casser les tests existants).';
  } else if (formatScore < 10) {
    topSuggestion = 'Spécifiez le format attendu (diff, étapes numérotées).';
  } else {
    topSuggestion = 'Prompt optimal et structuré.';
  }

  return {
    score,
    level,
    color,
    badgeBg,
    breakdown: {
      context: contextScore,
      objective: objectiveScore,
      constraints: constraintsScore,
      outputFormat: formatScore,
    },
    wordCount,
    charCount,
    estimatedTokens,
    detectedFiles,
    hasErrorLogs,
    hasCodeBlock,
    hasConstraints,
    hasAction,
    hasFormat,
    topSuggestion,
  };
}
