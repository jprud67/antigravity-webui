import React, { useState, useEffect, useCallback } from 'react';
import { 
  GitBranch, 
  RefreshCw, 
  GitCommit, 
  UploadCloud, 
  DownloadCloud,
  FileCode, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  FileDiff,
  ShieldAlert
} from 'lucide-react';
import { fetchGitStatus, fetchGitDiff, gitCommit, gitPush, gitPull, type GitStatusResult } from '../services/api';
import { DiffViewer } from './DiffViewer';
import { useI18n } from '../services/i18n';

interface GitTabProps {
  currentWorkspace: string;
}

export const GitTab: React.FC<GitTabProps> = ({ currentWorkspace }) => {
  const { t } = useI18n();
  const [status, setStatus] = useState<GitStatusResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected file for diff
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [isDiffStaged, setIsDiffStaged] = useState<boolean>(false);
  const [activeDiff, setActiveDiff] = useState<string | null>(null);
  const [loadingDiff, setLoadingDiff] = useState(false);

  // Commit & Push states
  const [commitMessage, setCommitMessage] = useState('');
  const [stageAll, setStageAll] = useState(true);
  const [committing, setCommitting] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const diffRequestIdRef = React.useRef(0);
  const selectedFileRef = React.useRef<string | null>(null);
  useEffect(() => {
    selectedFileRef.current = selectedFile;
  }, [selectedFile]);

  const handleSelectFile = useCallback(async (filePath: string, staged: boolean = false) => {
    setSelectedFile(filePath);
    setIsDiffStaged(staged);
    setLoadingDiff(true);
    const reqId = ++diffRequestIdRef.current;
    try {
      const res = await fetchGitDiff(currentWorkspace, filePath, staged);
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
        if (data.conflicts && data.conflicts.length > 0) {
          handleSelectFile(data.conflicts[0], false);
        } else if (data.modified.length > 0) {
          handleSelectFile(data.modified[0], false);
        } else if (data.staged.length > 0) {
          handleSelectFile(data.staged[0], true);
        } else if (data.untracked.length > 0) {
          handleSelectFile(data.untracked[0], false);
        }
      }
      return data;
    } catch (err: any) {
      setError(err.message || t('git_cannot_get_status', 'Cannot get Git status'));
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
            if (data.conflicts && data.conflicts.length > 0) {
              handleSelectFile(data.conflicts[0], false);
            } else if (data.modified.length > 0) {
              handleSelectFile(data.modified[0], false);
            } else if (data.staged.length > 0) {
              handleSelectFile(data.staged[0], true);
            } else if (data.untracked.length > 0) {
              handleSelectFile(data.untracked[0], false);
            }
          }
        }
      })
      .catch((err: any) => {
        if (active) {
          setError(err.message || t('git_cannot_get_status', 'Cannot get Git status'));
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
      setActionSuccess(t('git_commit_success', 'Commit successful'));
      setCommitMessage('');
      await loadStatus();
      setActiveDiff(null);
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message || t('git_commit_error', 'Error during commit'));
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
      setActionSuccess(`${t('git_push_success', 'Changes pushed successfully to origin')}/${status?.branch || 'main'}`);
      await loadStatus();
    } catch (err: any) {
      setError(err.message || t('git_push_error', 'Error during push'));
    } finally {
      setPushing(false);
    }
  };

  const handlePull = async () => {
    setPulling(true);
    setActionSuccess(null);
    setError(null);
    try {
      const res = await gitPull(currentWorkspace);
      setActionSuccess(`${t('git_pull_success', 'Changes pulled successfully from origin')}/${status?.branch || 'main'}: ${res.output || 'Up to date'}`);
      await loadStatus();
      setActiveDiff(null);
      setSelectedFile(null);
    } catch (err: any) {
      setError(err.message || t('git_pull_error', 'Error during pull'));
    } finally {
      setPulling(false);
    }
  };

  const allChangedFiles = React.useMemo(() => {
    if (!status) return [];
    const map = new Map<string, { path: string; type: string }>();
    (status.conflicts || []).forEach((f) => map.set(f, { path: f, type: 'U' }));
    (status.staged || []).forEach((f) => {
      if (!map.has(f)) map.set(f, { path: f, type: 'S' });
    });
    (status.modified || []).forEach((f) => {
      const existing = map.get(f);
      if (existing) {
        if (existing.type === 'S') existing.type = 'S+M';
      } else {
        map.set(f, { path: f, type: 'M' });
      }
    });
    (status.deleted || []).forEach((f) => {
      if (!map.has(f)) map.set(f, { path: f, type: 'D' });
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
        {t('git_checking_repo', 'Checking Git repository...')}
      </div>
    );
  }

  if (status && !status.is_repo) {
    return (
      <div className="p-8 text-center text-slate-400 space-y-3">
        <GitBranch className="w-10 h-10 mx-auto text-slate-600" />
        <p className="text-sm font-medium text-slate-300">{t('git_no_repo', 'No Git repository detected')}</p>
        <p className="text-xs text-slate-500 max-w-xs mx-auto">
          {t('git_no_repo_desc', 'The directory {0} is not initialized under Git.').replace('{0}', '')}
          <code className="text-sky-400 bg-slate-800/80 px-1 py-0.5 rounded">{currentWorkspace}</code>
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
              <CheckCircle2 className="w-3 h-3" /> {t('git_clean', 'Clean')}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full border border-amber-500/20">
              <AlertCircle className="w-3 h-3" /> {t('git_files_changed', '{0} file(s) changed').replace('{0}', String(allChangedFiles.length))}
            </span>
          )}
          {status && status.ahead > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded-full border border-sky-500/20" title={t('git_ahead', '{0} commit(s) ahead of remote').replace('{0}', String(status.ahead))}>
              ↑ {status.ahead}
            </span>
          )}
          {status && status.behind > 0 && (
            <span className="inline-flex items-center gap-0.5 text-[10px] text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-full border border-rose-500/20" title={t('git_behind', '{0} commit(s) behind remote').replace('{0}', String(status.behind))}>
              ↓ {status.behind}
            </span>
          )}
        </div>

        <button
          onClick={() => { void loadStatus(); }}
          disabled={loading}
          title={t('refresh', 'Refresh')}
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
            title={t('close', 'Close')}
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
            title={t('close', 'Close')}
          >
            ✕
          </button>
        </div>
      )}

      {status?.conflicts && status.conflicts.length > 0 && (
        <div className="p-2 bg-rose-500/15 border-b border-rose-500/40 text-rose-600 dark:text-rose-300 text-xs flex items-center gap-2 shrink-0 font-medium">
          <ShieldAlert className="w-4 h-4 shrink-0 text-rose-500 animate-pulse" />
          <span>{t('git_conflict_warning', '{0} unresolved merge conflict(s). Resolve them before committing.').replace('{0}', String(status.conflicts.length))}</span>
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
            <span>{t('git_changed_files', 'Changed files')} ({allChangedFiles.length})</span>
            {allChangedFiles.length > 0 && (
              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{t('git_click_for_diff', 'Click to view diff')}</span>
            )}
          </div>

          {allChangedFiles.length === 0 ? (
            <div className="text-xs py-3 text-center italic" style={{ color: 'var(--muted)' }}>
              {t('git_no_changes', 'No uncommitted changes in working tree.')}
            </div>
          ) : (
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {allChangedFiles.map((file) => {
                const isSelected = selectedFile === file.path;
                return (
                  <button
                    key={file.path}
                    onClick={() => handleSelectFile(file.path, file.type === 'S')}
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
                        file.type === 'U'
                          ? 'bg-rose-500/25 text-rose-600 dark:text-rose-400 border border-rose-500/40'
                          : file.type === 'S+M'
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
              <div className="flex items-center gap-2">
                <span className="font-mono flex items-center gap-1.5">
                  <FileDiff className="w-3.5 h-3.5 text-sky-500" />
                  Diff : <strong style={{ color: 'var(--strong)' }}>{selectedFile}</strong>
                </span>
                {isDiffStaged ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold">
                    {t('git_diff_staged', 'Staged')}
                  </span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-500/20 text-slate-600 dark:text-slate-400">
                    {t('git_diff_unstaged', 'Unstaged')}
                  </span>
                )}
                {allChangedFiles.find((f) => f.path === selectedFile)?.type === 'S+M' && (
                  <div className="flex items-center gap-1 ml-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelectFile(selectedFile, false)}
                      className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer ${!isDiffStaged ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400 font-bold' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`}
                    >
                      {t('git_diff_unstaged', 'Unstaged')}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectFile(selectedFile, true)}
                      className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer ${isDiffStaged ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-bold' : 'hover:bg-black/5 dark:hover:bg-white/5 opacity-70'}`}
                    >
                      {t('git_diff_staged', 'Staged')}
                    </button>
                  </div>
                )}
              </div>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[10px] hover:underline cursor-pointer"
                style={{ color: 'var(--muted)' }}
              >
                {t('git_close_diff', 'Close diff')}
              </button>
            </div>
            <div
              className="flex-1 overflow-auto p-2"
              style={{ backgroundColor: 'var(--code-bg)' }}
            >
              {loadingDiff ? (
                <div className="p-4 text-center text-xs" style={{ color: 'var(--muted)' }}>{t('git_loading_diff', 'Loading diff...')}</div>
              ) : activeDiff ? (
                <DiffViewer diffText={activeDiff} filename={selectedFile} />
              ) : (
                <div className="p-4 text-center text-xs italic" style={{ color: 'var(--muted)' }}>
                  {t('git_no_diff', 'No textual diff available for this file.')}
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
              {t('git_last_commit', 'Last commit')} ({status.last_commit.time})
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
            placeholder={t('git_commit_placeholder', 'Commit message (e.g. Add feature X)...')}
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
              <span>{t('git_stage_all', 'Stage all files (`git add -A`)')}</span>
            </label>

            <button
              type="submit"
              disabled={committing || !commitMessage.trim() || allChangedFiles.length === 0}
              className="py-1.5 px-3 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-medium text-xs flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer shadow-md shadow-sky-500/20"
            >
              <GitCommit className="w-3.5 h-3.5" />
              <span>{committing ? t('committing', 'Committing...') : t('commit', 'Commit')}</span>
            </button>
          </div>
        </form>

        <div
          className="pt-2 border-t flex items-center justify-between"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
            {t('git_author', 'Author:')} <code style={{ color: 'var(--strong)' }}>jprud67 &lt;jprud67@gmail.com&gt;</code>
          </span>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePull}
              disabled={pulling || committing}
              className="py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title={t('git_pull_title', 'Pull commits from remote repository (git pull)')}
            >
              <DownloadCloud className={`w-3.5 h-3.5 ${pulling ? 'animate-bounce text-sky-500' : ''}`} />
              <span>{pulling ? t('pulling', 'Pulling...') : t('git_pull', 'Pull')}</span>
            </button>

            <button
              onClick={handlePush}
              disabled={pushing || committing}
              className="py-1.5 px-3 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)'
              }}
              title={t('git_push_title', 'Push commits to remote repository (git push)')}
            >
              <UploadCloud className={`w-3.5 h-3.5 ${pushing ? 'animate-bounce text-sky-500' : ''}`} />
              <span>{pushing ? t('pushing', 'Pushing...') : t('git_push', 'Push')}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
