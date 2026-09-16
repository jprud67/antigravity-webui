import React, { useState, useEffect, useCallback } from 'react';
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

  const diffRequestIdRef = React.useRef(0);
  const selectedFileRef = React.useRef<string | null>(null);
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const handleSelectFile = useCallback(async (filePath: string) => {
    setSelectedFile(filePath);
    setLoadingDiff(true);
    const reqId = ++diffRequestIdRef.current;
    try {
      const res = await fetchGitDiff(currentWorkspace, filePath);
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(res.diff);
      }
    } catch {
      if (reqId === diffRequestIdRef.current) {
        setActiveDiff(null);
      }
    } finally {
      if (reqId === diffRequestIdRef.current) {
        setLoadingDiff(false);
      }
    }
  }, [currentWorkspace]);

  const loadStatus = useCallback(async (autoSelect: boolean = false) => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGitStatus(currentWorkspace);
      setStatus(data);
      if (autoSelect || !selectedFileRef.current) {
        if (data.modified.length > 0) {
          handleSelectFile(data.modified[0]);
        } else if (data.untracked.length > 0) {
          handleSelectFile(data.untracked[0]);
        }
      }
      return data;
    } catch (err: any) {
      setError(err.message || 'Impossible de récupérer le statut Git');
      return null;
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, handleSelectFile]);

  useEffect(() => {
    let active = true;
    fetchGitStatus(currentWorkspace)
      .then((data) => {
        if (active) {
          setStatus(data);
          if (!selectedFileRef.current) {
            if (data.modified.length > 0) {
              handleSelectFile(data.modified[0]);
            } else if (data.untracked.length > 0) {
              handleSelectFile(data.untracked[0]);
            }
          }
        }
      })
      .catch((err: any) => {
        if (active) {
          setError(err.message || 'Impossible de récupérer le statut Git');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [currentWorkspace, handleSelectFile]);

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

  const allChangedFiles = React.useMemo(() => {
    if (!status) return [];
    const map = new Map<string, { path: string; type: string }>();
    (status.staged || []).forEach((f) => map.set(f, { path: f, type: 'S' }));
    (status.modified || []).forEach((f) => {
      const existing = map.get(f);
      if (existing) {
        existing.type = 'S+M';
      } else {
        map.set(f, { path: f, type: 'M' });
      }
    });
    (status.deleted || []).forEach((f) => {
      map.set(f, { path: f, type: 'D' });
    });
    (status.untracked || []).forEach((f) => {
      if (!map.has(f)) {
        map.set(f, { path: f, type: '?' });
      }
    });
    return Array.from(map.values());
  }, [status]);

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

  return (
    <div
      className="flex flex-col h-full"
      style={{
        backgroundColor: 'var(--bg)',
        color: 'var(--text)'
      }}
    >
      {/* Top Git Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b text-xs shrink-0"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <div className="flex items-center gap-2">
          <GitBranch className="w-3.5 h-3.5 text-sky-500" />
          <span className="font-semibold font-mono" style={{ color: 'var(--strong)' }}>{status?.branch || 'main'}</span>
          {status?.tracking && (
            <span className="text-[10px] font-mono hidden sm:inline" style={{ color: 'var(--muted)' }}>
              ({status.tracking})
            </span>
          )}
          {status?.clean ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" /> Propre
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> {allChangedFiles.length} fichier(s)
            </span>
          )}
        </div>

        <button
          onClick={() => { void loadStatus(); }}
          disabled={loading}
          title="Actualiser"
          className="p-1.5 rounded-md hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer"
          style={{ color: 'var(--muted)' }}
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Notifications */}
      {actionSuccess && (
        <div className="p-2 bg-emerald-500/10 border-b border-emerald-500/30 text-emerald-600 dark:text-emerald-300 text-xs flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" />
            <span className="truncate">{actionSuccess}</span>
          </div>
          <button
            onClick={() => setActionSuccess(null)}
            className="text-xs hover:opacity-80 p-0.5 rounded cursor-pointer shrink-0"
            title="Fermer"
          >
            ✕
          </button>
        </div>
      )}
      {error && (
        <div className="p-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500" />
            <span className="break-all">{error}</span>
          </div>
          <button
            onClick={() => setError(null)}
            className="text-xs hover:opacity-80 p-0.5 rounded cursor-pointer shrink-0"
            title="Fermer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Main Content Area: Split File List & Diff */}
      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto">
        {/* Changed Files Section */}
        <div
          className="p-3 border-b shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <div
            className="text-[11px] font-semibold uppercase tracking-wider mb-2 flex items-center justify-between"
            style={{ color: 'var(--muted)' }}
          >
            <span>Fichiers modifiés ({allChangedFiles.length})</span>
            {allChangedFiles.length > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>Cliquez pour voir le diff</span>
            )}
          </div>

          {allChangedFiles.length === 0 ? (
            <div className="text-xs py-3 text-center italic" style={{ color: 'var(--muted)' }}>
              Aucune modification non validée dans l'arbre de travail.
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {allChangedFiles.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => handleSelectFile(file.path)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-sky-500/15 border border-sky-500/30 text-sky-600 dark:text-sky-200'
                        : 'hover:bg-black/5 dark:hover:bg-white/5'
                    }`}
                    style={!isSelected ? { color: 'var(--text)' } : undefined}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className="w-3.5 h-3.5 shrink-0 opacity-70" />
                      <span className="font-mono truncate">{file.path}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        file.type === 'S+M'
                          ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400'
                          : file.type === 'S'
                          ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                          : file.type === 'M'
                          ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                          : file.type === 'D'
                          ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                          : 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
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
          <div
            className="flex-1 flex flex-col min-h-0 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <div
              className="flex items-center justify-between px-3 py-1.5 border-b text-[11px] shrink-0"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
            >
              <span className="font-mono flex items-center gap-1.5">
                <FileDiff className="w-3.5 h-3.5 text-sky-500" />
                Diff : <strong style={{ color: 'var(--strong)' }}>{selectedFile}</strong>
              </span>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[10px] hover:underline cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                Fermer diff
              </button>
            </div>
            <div
              className="flex-1 overflow-auto p-2"
              style={{ backgroundColor: 'var(--code-bg)' }}
            >
              {loadingDiff ? (
                <div className="p-4 text-center text-xs" style={{ color: 'var(--muted)' }}>Chargement du diff...</div>
              ) : activeDiff ? (
                <DiffViewer diffText={activeDiff} filename={selectedFile} />
              ) : (
                <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>
                  Aucun diff textuel disponible pour ce fichier.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Last Commit Info */}
        {status?.last_commit && (
          <div
            className="p-3 border-b text-xs shrink-0"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)'
            }}
          >
            <div
              className="text-[10px] font-semibold uppercase tracking-wider mb-1 flex items-center gap-1"
              style={{ color: 'var(--muted)' }}
            >
              <Clock className="w-3 h-3" />
              Dernier commit ({status.last_commit.time})
            </div>
            <div className="font-mono text-[11px] truncate" style={{ color: 'var(--text)' }}>
              <span className="text-sky-500 font-bold mr-2">{status.last_commit.hash}</span>
              {status.last_commit.subject}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Commit & Push Toolbar */}
      <div
        className="p-3 border-t shrink-0 space-y-2.5"
        style={{
          backgroundColor: 'var(--surface-subtle)',
          borderColor: 'var(--border)'
        }}
      >
        <form onSubmit={handleCommit} className="space-y-2">
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            placeholder="Message de commit (ex: Add feature X)..."
            disabled={committing || allChangedFiles.length === 0}
            className="w-full px-3 py-2 border rounded-xl text-xs placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          />

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-[11px] cursor-pointer select-none" style={{ color: 'var(--muted)' }}>
              <input
                type="checkbox"
                checked={stageAll}
                onChange={(e) => setStageAll(e.target.checked)}
                className="rounded border-slate-400 dark:border-slate-700 text-sky-500 focus:ring-0"
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

        <div
          className="pt-2 border-t flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
            Auteur : <code style={{ color: 'var(--strong)' }}>jprud67 &lt;jprud67@gmail.com&gt;</code>
          </span>

          <button
            onClick={handlePush}
            disabled={pushing}
            className="py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)'
            }}
          >
            <UploadCloud className={`w-3.5 h-3.5 ${pushing ? 'animate-bounce text-sky-500' : ''}`} />
            <span>{pushing ? 'Push en cours...' : 'Pousser vers Origin'}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
