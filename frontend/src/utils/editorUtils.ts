export const SUPPORTED_LANGUAGES = [
  { id: 'typescript', name: 'TypeScript (.ts, .tsx)' },
  { id: 'javascript', name: 'JavaScript (.js, .jsx)' },
  { id: 'python', name: 'Python (.py)' },
  { id: 'html', name: 'HTML (.html)' },
  { id: 'css', name: 'CSS (.css)' },
  { id: 'json', name: 'JSON (.json)' },
  { id: 'markdown', name: 'Markdown (.md)' },
  { id: 'yaml', name: 'YAML (.yml, .yaml)' },
  { id: 'shell', name: 'Shell / Bash (.sh, .bash)' },
  { id: 'diff', name: 'Diff Patch (.diff, .patch)' },
  { id: 'sql', name: 'SQL (.sql)' },
  { id: 'rust', name: 'Rust (.rs)' },
  { id: 'go', name: 'Go (.go)' },
  { id: 'cpp', name: 'C++ (.cpp, .hpp)' },
  { id: 'csharp', name: 'C# (.cs)' },
  { id: 'java', name: 'Java (.java)' },
  { id: 'php', name: 'PHP (.php)' },
  { id: 'dockerfile', name: 'Dockerfile' },
  { id: 'plaintext', name: 'Texte Brut (.txt)' },
];

export function detectLanguage(filePath?: string, fallback = 'plaintext'): string {
  if (!filePath) return fallback;
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'py':
    case 'py3':
      return 'python';
    case 'html':
    case 'htm':
      return 'html';
    case 'css':
    case 'scss':
    case 'less':
      return 'css';
    case 'json':
      return 'json';
    case 'md':
    case 'markdown':
      return 'markdown';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'shell';
    case 'diff':
    case 'patch':
      return 'diff';
    case 'sql':
      return 'sql';
    case 'rs':
      return 'rust';
    case 'go':
      return 'go';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'cs':
      return 'csharp';
    case 'java':
      return 'java';
    case 'php':
      return 'php';
    case 'dockerfile':
      return 'dockerfile';
    default:
      return fallback;
  }
}

export function getInitialMonacoTheme(): 'vs-dark' | 'light' {
  if (typeof document === 'undefined') return 'vs-dark';
  const isLight =
    document.documentElement.classList.contains('theme-light') ||
    document.body.classList.contains('theme-light') ||
    document.documentElement.getAttribute('data-theme') === 'light';
  return isLight ? 'light' : 'vs-dark';
}
