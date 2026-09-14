import React, { useState, useEffect } from 'react';
import { 
  GitBranch, 
  RefreshCw, 
  GitCommit, 
  UploadCloud, 
  FileCode, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileDiff,
  ShieldAlert
} from 'lucide-react';
import { fetchGitStatus, fetchGitDiff, gitCommit, gitPush, type GitStatusResult } from '../services/api';
import { DiffViewer } from './DiffViewer';

interface GitTabProps {
  currentWorkspace: string;
}

export const GitTab: React.FC<GitTabProps> = ({ currentWorkspace }) => {
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected file for diff
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Commit & Push states
  const [commitMessage, setCommitMessage] = useState('');
  const [stageAll, setStageAll] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGitStatus(currentWorkspace);
      setStatus(data);
      if (data.modified.length > 0 && !selectedFile) {
        handleSelectFile(data.modified[0]);
      } else if (data.untracked.length > 0 && !selectedFile) {
        handleSelectFile(data.untracked[0]);
      }
    } catch (err: any) {
      setError(err.message || 'Impossible de récupérer le statut Git');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStatus();
  }, [currentWorkspace]);

  const diffRequestIdRef = React.useRef(0);

  const handleSelectFile = async (filePath: string) => {
    setSelectedFile(filePath);
    setLoadingDiff(true);
    const reqId = ++diffRequestIdRef.current;
    try {
      const res = await fetchGitDiff(currentWorkspace, filePath);
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(res.diff);
      }
    } catch (err: any) {
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(null);
      }
    } finally {
      if (reqId === diffRequestIdRef.current) {
        setLoadingDiff(false);
      }
    }
  };

  const handleCommit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!commitMessage.trim()) return;

    setCommitting(true);
    setActionSuccess(null);
    setError(null);
    try {
      await gitCommit(commitMessage.trim(), currentWorkspace, stageAll);
      setActionSuccess('Commit effectué avec succès');
      setCommitMessage('');
      await loadStatus();
      setActiveDiff(null);
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message || 'Erreur lors du commit');
    } finally {
      setCommitting(false);
    }
  };

  const handlePush = async () => {
    setPushing(true);
    setActionSuccess(null);
    setError(null);
    try {
      await gitPush(currentWorkspace);
      setActionSuccess(`Modifications poussées avec succès sur origin/${status?.branch || 'main'}`);
      await loadStatus();
    } catch (err: any) {
      setError(err.message || 'Erreur lors du push');
    } finally {
      setPushing(false);
    }
  };

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400 text-xs">
        <RefreshCw className="w-5 h-5 animate-spin mr-2 text-sky-400" />
        Inspection du dépôt Git...
      </div>
    );
  }

  if (status && !status.is_repo) {
    return (
      <div className="p-8 text-center text-slate-400 space-y-3">
        <GitBranch className="w-10 h-10 mx-auto text-slate-600" />
        <p className="text-sm font-medium text-slate-300">Aucun dépôt Git détecté</p>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          Le répertoire <code className="text-sky-400 bg-slate-800/80 px-1 py-0.5 rounded">{currentWorkspace}</code> n'est pas initialisé sous Git.
        </p>
      </div>
    );
  }

  const allChangedFiles = [
    ...(status?.modified.map((f) => ({ path: f, type: 'M' })) || []),
    ...(status?.staged.map((f) => ({ path: f, type: 'S' })) || []),
    ...(status?.untracked.map((f) => ({ path: f, type: '?' })) || []),
    ...(status?.deleted.map((f) => ({ path: f, type: 'D' })) || []),
  ];

  return (
    <div className="flex flex-col h-full bg-[#060a12] text-slate-200">
      {/* Top Git Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#0a101f] border-b border-slate-800/80 text-xs shrink-0">
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-sky-400" />
          <span className="font-semibold text-slate-200 font-mono">{status?.branch || 'main'}</span>
          {status?.tracking && (
            <span className="text-[10px] text-slate-500 font-mono hidden sm:inline">
              ({status.tracking})
            </span>
          )}
          {status?.clean ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" /> Propre
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> {allChangedFiles.length} fichier(s)
            </span>
          )}
        </div>

        <button
          onClick={loadStatus}
          disabled={loading}
          title="Actualiser"
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800/80 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-300 text-xs flex items-center gap-2 shrink-0">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{actionSuccess}</span>
        </div>
      )}
      {error && (
        <div className="p-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2 shrink-0">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-400" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area: Split File List & Diff */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Changed Files Section */}
        <div className="p-3 border-b border-slate-800/80 shrink-0">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between">
            <span>Fichiers modifiés ({allChangedFiles.length})</span>
            {allChangedFiles.length > 0 && (
              <span className="text-[10px] text-slate-500">Cliquez pour voir le diff</span>
            )}
          </div>

          {allChangedFiles.length === 0 ? (
            <div className="text-xs text-slate-500 py-3 text-center italic">
              Aucune modification non validée dans l'arbre de travail.
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {allChangedFiles.map((file, idx) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={idx}
                    onClick={() => handleSelectFile(file.path)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/15 border border-sky-500/30 text-sky-200'
                        : 'hover:bg-slate-800/50 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                      <span className="font-mono truncate">{file.path}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        file.type === 'M'
                          ? 'bg-amber-500/20 text-amber-400'
                          : file.type === 'D'
                          ? 'bg-rose-500/20 text-rose-400'
                          : 'bg-sky-500/20 text-sky-400'
                      }`}
                    >
                      {file.type}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Diff Preview Section */}
        {selectedFile && (
          <div className="flex-1 flex flex-col min-h-0 border-b border-slate-800/80">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#090e1c] border-b border-slate-800 text-[11px] text-slate-400 shrink-0">
              <span className="font-mono flex items-center gap-1.5">
                <FileDiff className="w-3.5 h-3.5 text-sky-400" />
                Diff : <strong className="text-slate-200">{selectedFile}</strong>
              </span>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[10px] text-slate-500 hover:text-slate-300 cursor-pointer"
              >
                Fermer diff
              </button>
            </div>
            <div className="flex-1 overflow-auto p-2 bg-[#050810]">
              {loadingDiff ? (
                <div className="p-4 text-center text-xs text-slate-500">Chargement du diff...</div>
              ) : activeDiff ? (
                <DiffViewer diffText={activeDiff} filename={selectedFile} />
              ) : (
                <div className="p-4 text-center text-xs text-slate-500 italic">
                  Aucun diff textuel disponible pour ce fichier.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Last Commit Info */}
        {status?.last_commit && (
          <div className="p-3 bg-[#080d1a] border-b border-slate-800/80 text-xs shrink-0">
            <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <Clock className="w-3 h-3 text-slate-500" />
              Dernier commit ({status.last_commit.time})
            </div>
            <div className="font-mono text-slate-300 text-[11px] truncate">
              <span className="text-sky-400 font-bold mr-2">{status.last_commit.hash}</span>
              {status.last_commit.subject}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Commit & Push Toolbar */}
      <div className="p-3 bg-[#0a101f] border-t border-slate-800/80 shrink-0 space-y-2.5">
        <form onSubmit={handleCommit} className="space-y-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Message de commit (ex: Add feature X)..."
            disabled={committing || allChangedFiles.length === 0}
            className="w-full px-3 py-2 bg-[#060a12] border border-slate-700/80 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-sky-500 focus:border-sky-500 disabled:opacity-50"
          />

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={stageAll}
                onChange={(e) => setStageAll(e.target.checked)}
                className="rounded border-slate-700 text-sky-500 focus:ring-0"
              />
              <span>Indexer tous les fichiers (`git add -A`)</span>
            </label>

            <button
              type="submit"
              disabled={committing || !commitMessage.trim() || allChangedFiles.length === 0}
              className="py-1.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-md shadow-sky-500/20"
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span>{committing ? 'Validation...' : 'Commiter'}</span>
            </button>
          </div>
        </form>

        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            Auteur : <code className="text-slate-400">jprud67 &lt;jprud67@gmail.com&gt;</code>
          </span>

          <button
            onClick={handlePush}
            disabled={pushing}
            className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-medium text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <UploadCloud className={`w-3.5 h-3.5 ${pushing ? 'animate-bounce text-sky-400' : ''}`} />
            <span>{pushing ? 'Push en cours...' : 'Pousser vers Origin'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
