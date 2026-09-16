import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  FileCode, 
  Save, 
  RefreshCw, 
  Check, 
  AlertTriangle, 
  ShieldCheck, 
  FileText, 
  Database,
  History,
  FileCheck2
} from 'lucide-react';
import type { RuleFileItem } from '../services/api';
import { 
  fetchRulesFiles, 
  fetchRuleContent, 
  saveRuleContent 
} from '../services/api';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

interface RulesEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentWorkspace?: string;
}

export const RulesEditorModal: React.FC<RulesEditorModalProps> = ({
  isOpen,
  onClose,
  currentWorkspace
}) => {
  const [fileList, setFileList] = useState<RuleFileItem[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string>('agents_global');
  const [fileContent, setFileContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [currentFileMeta, setCurrentFileMeta] = useState<any>(null);
  
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Load files list
  const loadFiles = useCallback(async () => {
    try {
      const res = await fetchRulesFiles(currentWorkspace);
      setFileList(res.files);
      setSelectedFileId((prev) => (res.files.length > 0 && !res.files.some(f => f.id === prev) ? res.files[0].id : prev));
    } catch (e) {
      console.error('Failed to load rules files list', e);
    }
  }, [currentWorkspace]);

  // Load content of selected file
  const loadContent = useCallback(async (fileId: string) => {
    setLoadingContent(true);
    setJsonError(null);
    setSaveSuccess(false);
    try {
      const data = await fetchRuleContent(fileId, currentWorkspace);
      setFileContent(data.content);
      setOriginalContent(data.content);
      setCurrentFileMeta(data);
    } catch (e: any) {
      showToast(e.message || 'Erreur lors du chargement du fichier', 'error');
    } finally {
      setLoadingContent(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchRulesFiles(currentWorkspace)
      .then((res) => {
        if (active) {
          setFileList(res.files);
          setSelectedFileId((prev) => (res.files.length > 0 && !res.files.some(f => f.id === prev) ? res.files[0].id : prev));
        }
      })
      .catch((e) => console.error('Failed to load rules files list', e));
    return () => { active = false; };
  }, [isOpen, currentWorkspace]);

  useEffect(() => {
    if (!isOpen || !selectedFileId) return;
    let active = true;
    fetchRuleContent(selectedFileId, currentWorkspace)
      .then((data) => {
        if (active) {
          setFileContent(data.content);
          setOriginalContent(data.content);
          setCurrentFileMeta(data);
          setLoadingContent(false);
          setJsonError(null);
          setSaveSuccess(false);
        }
      })
      .catch((e: any) => {
        if (active) {
          showToast(e.message || 'Erreur lors du chargement du fichier', 'error');
          setLoadingContent(false);
        }
      });
    return () => { active = false; };
  }, [isOpen, selectedFileId, currentWorkspace]);

  if (!isOpen) return null;

  const handleContentChange = (newVal: string) => {
    setFileContent(newVal);
    setSaveSuccess(false);

    // Validate JSON in real time
    if (currentFileMeta?.syntax === 'json') {
      try {
        JSON.parse(newVal);
        setJsonError(null);
      } catch (err: any) {
        setJsonError(err.message);
      }
    } else {
      setJsonError(null);
    }
  };

  const handleSave = async () => {
    if (jsonError) {
      showToast('Veuillez corriger la syntaxe JSON avant d\'enregistrer.', 'warning');
      return;
    }

    setSaving(true);
    setSaveSuccess(false);
    try {
      await saveRuleContent(selectedFileId, fileContent, currentWorkspace);
      setOriginalContent(fileContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
      await loadFiles();
    } catch (e: any) {
      showToast(e.message || 'Erreur d\'enregistrement', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasUnsavedChanges = fileContent !== originalContent;

  const getIconForFile = (id: string) => {
    if (id === 'agents_global' || id === 'workspace_agents') return FileText;
    if (id === 'settings_cli') return FileCode;
    if (id === 'hermes_arch') return Database;
    if (id === 'hermes_journal') return History;
    return FileCheck2;
  };

  // Line numbers calculation
  const linesCount = fileContent.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(linesCount, 1) }, (_, i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 safe-pt safe-pb">
      <div
        className="border rounded-2xl sm:rounded-3xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[95dvh] sm:h-[88vh] animate-fadeIn"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
      >
        {/* Header */}
        <div
          className="p-3.5 sm:p-4 border-b flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center shrink-0"
              style={{
                backgroundColor: 'var(--accent-bg)',
                borderColor: 'var(--accent)',
                color: 'var(--accent-text)'
              }}
            >
              <ShieldCheck className="w-4 h-4 sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold flex items-center gap-1.5 sm:gap-2 truncate" style={{ color: 'var(--strong)' }}>
                <span>Éditeur de Règles</span>
                <span
                  className="text-[9px] sm:text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full border hidden xs:inline"
                  style={{
                    backgroundColor: 'var(--accent-bg)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent-text)'
                  }}
                >
                  Hermes
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] truncate hidden sm:block" style={{ color: 'var(--muted)' }}>
                Gouvernance globale, permissions, règles d'agents et mémoire unifiée
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File Selector Tabs */}
        <div
          className="px-3 sm:px-4 py-2 border-b flex items-center gap-2 overflow-x-auto no-scrollbar touch-scroll shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          {fileList.map(f => {
            const IconComp = getIconForFile(f.id);
            const isSelected = f.id === selectedFileId;
            return (
              <button
                key={f.id}
                onClick={async () => {
                  if (hasUnsavedChanges) {
                    if (!(await showConfirm('Vous avez des modifications non enregistrées. Changer de fichier ?'))) return;
                  }
                  setSelectedFileId(f.id);
                }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer border"
                style={{
                  backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface)',
                  borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                  color: isSelected ? 'var(--accent-text)' : 'var(--text)'
                }}
                title={f.description}
              >
                <IconComp className="w-3.5 h-3.5" style={{ color: isSelected ? 'var(--accent)' : 'var(--muted)' }} />
                <span>{f.name}</span>
                {f.id === selectedFileId && hasUnsavedChanges && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Editor Main Section */}
        <div
          className="flex-1 flex flex-col min-h-0 relative"
          style={{ backgroundColor: 'var(--code-bg, var(--surface))' }}
        >
          {/* Editor Sub-toolbar */}
          <div
            className="px-4 py-2 border-b flex items-center justify-between text-xs shrink-0"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)',
              color: 'var(--muted)'
            }}
          >
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px]" style={{ color: 'var(--strong)' }}>
                {currentFileMeta?.path || selectedFileId}
              </span>
              <span>|</span>
              <span className="text-[10px]">
                {linesCount} lignes • {fileContent.length} caractères
              </span>
              {currentFileMeta?.syntax === 'json' && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    jsonError
                      ? 'bg-rose-500/20 text-rose-500 border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-500 border-emerald-500/40'
                  }`}
                >
                  {jsonError ? 'JSON Invalide' : 'JSON Valide'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => loadContent(selectedFileId)}
                disabled={loadingContent}
                className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] cursor-pointer transition-colors border hover:opacity-100 opacity-70"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)'
                }}
                title="Recharger le fichier depuis le disque"
              >
                <RefreshCw className={`w-3 h-3 ${loadingContent ? 'animate-spin' : ''}`} />
                <span>Recharger</span>
              </button>
            </div>
          </div>

          {/* JSON Error Banner if any */}
          {jsonError && (
            <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-500 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="font-mono text-[11px] truncate">Erreur de syntaxe : {jsonError}</span>
            </div>
          )}

          {/* Code Area with Line Numbers */}
          <div className="flex-1 flex overflow-hidden">
            {/* Gutter */}
            <div 
              ref={gutterRef}
              className="w-14 border-r py-3 px-2 select-none text-right font-mono text-[11px] overflow-hidden leading-6"
              style={{
                backgroundColor: 'var(--surface-subtle)',
                borderColor: 'var(--border)',
                color: 'var(--muted)'
              }}
            >
              {lineNumbers.map(n => (
                <div key={n} className="h-6">{n}</div>
              ))}
            </div>

            {/* Textarea */}
            <div className="flex-1 relative overflow-hidden">
              <textarea
                ref={textareaRef}
                value={fileContent}
                onChange={e => handleContentChange(e.target.value)}
                onScroll={e => {
                  if (gutterRef.current) {
                    gutterRef.current.scrollTop = e.currentTarget.scrollTop;
                  }
                }}
                disabled={loadingContent}
                spellCheck={false}
                wrap="off"
                className="w-full h-full bg-transparent font-mono text-[11px] focus:outline-none resize-none leading-6 py-3 px-4 overflow-auto whitespace-pre"
                style={{ color: 'var(--pre-text, var(--text))' }}
              />
            </div>
          </div>
        </div>

        {/* Footer / Action Bar */}
        <div
          className="p-3.5 border-t flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)'
          }}
        >
          <div className="flex items-center gap-2 text-[11px] text-slate-400">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Copie de sécurité (.bak) créée automatiquement avant enregistrement</span>
          </div>

          <div className="flex items-center gap-2.5">
            {saveSuccess && (
              <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1 animate-fadeIn">
                <Check className="w-3.5 h-3.5" />
                <span>Enregistré avec succès</span>
              </span>
            )}

            <button
              onClick={handleSave}
              disabled={saving || !hasUnsavedChanges || !!jsonError}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold shadow-lg transition-all cursor-pointer ${
                hasUnsavedChanges && !jsonError
                  ? 'bg-gradient-to-r from-sky-600 to-indigo-600 hover:from-sky-500 hover:to-indigo-500 text-white shadow-sky-600/30'
                  : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/60'
              }`}
            >
              <Save className="w-3.5 h-3.5" />
              <span>{saving ? 'Sauvegarde en cours...' : 'Enregistrer'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
