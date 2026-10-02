import React from 'react';
import { Loader2, CheckCircle2, AlertCircle, X } from 'lucide-react';

export interface UploadProgressInfo {
  totalFiles: number;
  completedFiles: number;
  currentFileIndex: number;
  currentFileName: string;
  filePercent: number; // 0 to 100
  fileLoaded: number;
  fileTotal: number;
  status: 'uploading' | 'completed' | 'error';
  errorMessage?: string;
}

interface UploadProgressCardProps {
  progress: UploadProgressInfo;
  onDismiss?: () => void;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 o';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export const UploadProgressCard: React.FC<UploadProgressCardProps> = ({
  progress,
  onDismiss,
  className = '',
}) => {
  const isMultiple = progress.totalFiles > 1;
  const overallPercent = isMultiple
    ? Math.min(100, Math.round(((progress.completedFiles + progress.filePercent / 100) / progress.totalFiles) * 100))
    : progress.filePercent;

  return (
    <div
      className={`rounded-xl border shadow-sm p-2.5 transition-all duration-200 ${
        progress.status === 'error'
          ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
          : progress.status === 'completed'
          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          : 'bg-sky-500/10 border-sky-500/30 text-slate-800 dark:text-slate-200'
      } ${className}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {progress.status === 'uploading' && (
            <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin shrink-0" />
          )}
          {progress.status === 'completed' && (
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          )}
          {progress.status === 'error' && (
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          )}

          <div className="min-w-0 flex-1">
            <p
              className="text-xs font-semibold truncate leading-tight"
              title={progress.currentFileName}
            >
              {progress.status === 'completed'
                ? isMultiple
                  ? `${progress.totalFiles} fichiers importés avec succès`
                  : `« ${progress.currentFileName} » importé`
                : progress.status === 'error'
                ? "Erreur lors de l'import"
                : isMultiple
                ? `Import (${progress.currentFileIndex}/${progress.totalFiles}) : ${progress.currentFileName}`
                : `Import : ${progress.currentFileName}`}
            </p>
            {isMultiple && progress.status === 'uploading' && (
              <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate mt-0.5 font-mono">
                Fichier {progress.currentFileIndex} sur {progress.totalFiles}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-xs font-mono font-medium">
            {progress.status === 'completed' ? '100%' : `${overallPercent}%`}
          </span>
          {onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              title="Fermer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* Progress Bar Track */}
      <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5 overflow-hidden mb-1">
        <div
          className={`h-full transition-all duration-150 ease-out rounded-full ${
            progress.status === 'error'
              ? 'bg-red-500'
              : progress.status === 'completed'
              ? 'bg-emerald-500'
              : 'bg-gradient-to-r from-sky-500 to-indigo-500'
          }`}
          style={{ width: `${progress.status === 'completed' ? 100 : overallPercent}%` }}
        />
      </div>

      {/* Real-time metrics / byte loaded */}
      <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono">
        <span>
          {progress.status === 'error'
            ? progress.errorMessage || 'Échec du transfert'
            : progress.fileTotal > 0
            ? `${formatBytes(progress.fileLoaded)} / ${formatBytes(progress.fileTotal)} (${progress.filePercent}%)`
            : `${formatBytes(progress.fileLoaded)}`}
        </span>
        {isMultiple && (
          <span>
            {progress.completedFiles}/{progress.totalFiles} terminé{progress.completedFiles > 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
};
