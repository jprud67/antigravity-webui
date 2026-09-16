import React, { useState } from 'react';
import { GitCommit, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { copyText } from '../utils/codeBlockUtils';

interface DiffViewerProps {
  filename?: string;
  diffText: string;
  title?: string;
}

interface DiffLine {
  type: 'add' | 'del' | 'meta' | 'context';
  text: string;
  oldLineNum?: number;
  newLineNum?: number;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  filename,
  diffText,
  title = 'Modifications de Fichiers (Diff)'
}) => {
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Parse unified diff or snippet
  const lines = (diffText || '').replace(/\r/g, '').split('\n');
  const parsedLines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  let inHunk = false;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      inHunk = true;
      parsedLines.push({ type: 'meta', text: line });
      // Match @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
    } else if (
      line.startsWith('---') ||
      line.startsWith('+++') ||
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode') ||
      line.startsWith('deleted file mode') ||
      line.startsWith('similarity index')
    ) {
      parsedLines.push({ type: 'meta', text: line });
    } else if (line.startsWith('+')) {
      parsedLines.push({
        type: 'add',
        text: line.substring(1),
        newLineNum: newLine++,
      });
    } else if (line.startsWith('-')) {
      parsedLines.push({
        type: 'del',
        text: line.substring(1),
        oldLineNum: oldLine++,
      });
    } else {
      const cleanLine = line.startsWith(' ') ? line.substring(1) : line;
      parsedLines.push({
        type: 'context',
        text: cleanLine,
        oldLineNum: inHunk ? oldLine++ : undefined,
        newLineNum: inHunk ? newLine++ : undefined,
      });
    }
  }

  const additionsCount = parsedLines.filter((l) => l.type === 'add').length;
  const deletionsCount = parsedLines.filter((l) => l.type === 'del').length;

  const copyDiff = async () => {
    await copyText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="my-3 rounded-2xl overflow-hidden shadow-lg font-mono text-xs border"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)'
      }}
    >
      {/* Header */}
      <div
        className="px-4 py-2.5 border-b flex items-center justify-between"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-2.5">
          <GitCommit className="w-4 h-4 text-sky-500" />
          <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
            {filename || title}
          </span>
          <div className="flex items-center gap-1.5 text-[10px] font-bold ml-2">
            {additionsCount > 0 && (
              <span className="text-emerald-500 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded">
                +{additionsCount}
              </span>
            )}
            {deletionsCount > 0 && (
              <span className="text-rose-500 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded">
                -{deletionsCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyDiff}
            className="px-2 py-1 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded cursor-pointer transition-colors border"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--muted)'
            }}
          >
            {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* Diff content */}
      {!collapsed && (
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full border-collapse font-mono text-[11px] leading-5 select-text">
            <tbody>
              {parsedLines.map((line, idx) => {
                let rowBg = 'hover:bg-black/5 dark:hover:bg-white/5';
                let textCol = 'text-slate-700 dark:text-slate-300';
                let sign = ' ';

                if (line.type === 'add') {
                  rowBg = 'bg-emerald-500/10 hover:bg-emerald-500/15';
                  textCol = 'text-emerald-600 dark:text-emerald-400';
                  sign = '+';
                } else if (line.type === 'del') {
                  rowBg = 'bg-rose-500/10 hover:bg-rose-500/15';
                  textCol = 'text-rose-600 dark:text-rose-400 line-through decoration-rose-500/50';
                  sign = '-';
                } else if (line.type === 'meta') {
                  rowBg = 'bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold';
                  textCol = 'text-sky-600 dark:text-sky-400';
                  sign = line.text.startsWith('@@') ? '@' : ' ';
                }

                return (
                  <tr key={idx} className={`${rowBg} transition-colors`}>
                    <td
                      className="w-10 text-right pr-2 py-0 select-none text-[10px] border-r font-mono"
                      style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
                    >
                      {line.oldLineNum ?? ''}
                    </td>
                    <td
                      className="w-10 text-right pr-2 py-0 select-none text-[10px] border-r font-mono"
                      style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}
                    >
                      {line.newLineNum ?? ''}
                    </td>
                    <td className="w-6 text-center select-none font-bold opacity-60">
                      {sign}
                    </td>
                    <td className={`pl-2 pr-4 py-0 whitespace-pre ${textCol}`}>
                      {line.text}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
