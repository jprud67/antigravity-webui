import React, { useState } from 'react';
import { GitCommit, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';

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
  const lines = diffText.split('\n');
  const parsedLines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      parsedLines.push({ type: 'meta', text: line });
      // Match @@ -oldStart,oldCount +newStart,newCount @@
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLine = parseInt(match[1], 10);
        newLine = parseInt(match[2], 10);
      }
    } else if (line.startsWith('+') && !line.startsWith('+++')) {
      parsedLines.push({
        type: 'add',
        text: line.substring(1),
        newLineNum: newLine++,
      });
    } else if (line.startsWith('-') && !line.startsWith('---')) {
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
        oldLineNum: oldLine++,
        newLineNum: newLine++,
      });
    }
  }

  const additionsCount = parsedLines.filter((l) => l.type === 'add').length;
  const deletionsCount = parsedLines.filter((l) => l.type === 'del').length;

  const copyDiff = () => {
    navigator.clipboard.writeText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="my-3 bg-[#070b14] border border-slate-800/90 rounded-2xl overflow-hidden shadow-lg font-mono text-xs">
      {/* Header */}
      <div className="px-4 py-2.5 bg-[#0b1020] border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <GitCommit className="w-4 h-4 text-sky-400" />
          <span className="font-semibold text-slate-200 text-xs">
            {filename || title}
          </span>
          <div className="flex items-center gap-1.5 text-[10px] font-bold ml-2">
            {additionsCount > 0 && (
              <span className="text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.2 rounded">
                +{additionsCount}
              </span>
            )}
            {deletionsCount > 0 && (
              <span className="text-rose-400 bg-rose-500/10 border border-rose-500/20 px-1.5 py-0.2 rounded">
                -{deletionsCount}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={copyDiff}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded text-[10px] flex items-center gap-1 cursor-pointer transition-colors"
          >
            {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
            <span>{copied ? 'Copié' : 'Copier'}</span>
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded cursor-pointer transition-colors"
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
                let rowBg = 'hover:bg-slate-900/40';
                let textCol = 'text-slate-300';
                let sign = ' ';

                if (line.type === 'add') {
                  rowBg = 'bg-emerald-950/30 hover:bg-emerald-950/50';
                  textCol = 'text-emerald-300';
                  sign = '+';
                } else if (line.type === 'del') {
                  rowBg = 'bg-rose-950/30 hover:bg-rose-950/50';
                  textCol = 'text-rose-300 line-through decoration-rose-500/50';
                  sign = '-';
                } else if (line.type === 'meta') {
                  rowBg = 'bg-sky-950/20 text-sky-400 font-semibold';
                  textCol = 'text-sky-400';
                  sign = '@';
                }

                return (
                  <tr key={idx} className={`${rowBg} transition-colors`}>
                    <td className="w-10 text-right pr-2 py-0 text-slate-600 select-none text-[10px] border-r border-slate-800/60 font-mono">
                      {line.oldLineNum ?? ''}
                    </td>
                    <td className="w-10 text-right pr-2 py-0 text-slate-600 select-none text-[10px] border-r border-slate-800/60 font-mono">
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
