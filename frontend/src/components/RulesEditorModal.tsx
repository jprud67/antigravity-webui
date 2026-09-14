import React, { useState, useEffect } from 'react';
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

  // Load files list
  const loadFiles = async () => {
    try {
      const res = await fetchRulesFiles(currentWorkspace);
      setFileList(res.files);
      if (res.files.length > 0 && !res.files.some(f => f.id === selectedFileId)) {
        setSelectedFileId(res.files[0].id);
      }
    } catch (e) {
      console.error('Failed to load rules files list', e);
    }
  };

  // Load content of selected file
  const loadContent = async (fileId: string) => {
    setLoadingContent(true);
    setJsonError(null);
    setSaveSuccess(false);
    try {
      const data = await fetchRuleContent(fileId, currentWorkspace);
      setFileContent(data.content);
      setOriginalContent(data.content);
      setCurrentFileMeta(data);
    } catch (e: any) {
      alert(e.message || 'Erreur lors du chargement du fichier');
    } finally {
      setLoadingContent(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadFiles();
    }
  }, [isOpen, currentWorkspace]);

  useEffect(() => {
    if (isOpen && selectedFileId) {
      loadContent(selectedFileId);
    }
  }, [isOpen, selectedFileId]);

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
      alert('Veuillez corriger la syntaxe JSON avant d\'enregistrer.');
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
      alert(e.message || 'Erreur d\'enregistrement');
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

  const gutterRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Line numbers calculation
  const linesCount = fileContent.split('\n').length;
  const lineNumbers = Array.from({ length: Math.max(linesCount, 1) }, (_, i) => i + 1);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
      <div className="bg-[#0b101f] border border-slate-700/80 rounded-2xl w-full max-w-5xl shadow-2xl overflow-hidden flex flex-col h-[88vh] animate-fadeIn">
        {/* Header */}
        <div className="p-4 bg-[#0f172a] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-500/20 to-sky-500/20 border border-indigo-500/30 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <span>Éditeur de Règles & Mémoire Système</span>
                <span className="text-[10px] font-semibold text-sky-400 bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 rounded-full">
                  Zero Token Hermes
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                Gouvernance globale, permissions, règles d'agents et mémoire unifiée
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* File Selector Tabs */}
        <div className="px-4 py-2 bg-[#0c1222] border-b border-slate-800/80 flex items-center gap-2 overflow-x-auto scrollbar-thin shrink-0">
          {fileList.map(f => {
            const IconComp = getIconForFile(f.id);
            const isSelected = f.id === selectedFileId;
            return (
              <button
                key={f.id}
                onClick={() => {
                  if (hasUnsavedChanges) {
                    if (!confirm('Vous avez des modifications non enregistrées. Changer de fichier ?')) return;
                  }
                  setSelectedFileId(f.id);
                }}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-sky-500/20 text-sky-200 border-sky-500/40 shadow-inner'
                    : 'bg-slate-800/60 hover:bg-slate-700/60 text-slate-400 hover:text-slate-200 border-slate-700/50'
                }`}
                title={f.description}
              >
                <IconComp className={`w-3.5 h-3.5 ${isSelected ? 'text-sky-400' : 'text-slate-500'}`} />
                <span>{f.name}</span>
                {f.id === selectedFileId && hasUnsavedChanges && (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Editor Main Section */}
        <div className="flex-1 flex flex-col min-h-0 bg-[#060a14] relative">
          {/* Editor Sub-toolbar */}
          <div className="px-4 py-2 bg-[#0d1424] border-b border-slate-800/80 flex items-center justify-between text-xs text-slate-400 shrink-0">
            <div className="flex items-center gap-3">
              <span className="font-mono text-[11px] text-slate-300">
                {currentFileMeta?.path || selectedFileId}
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-[10px] text-slate-500">
                {linesCount} lignes • {fileContent.length} caractères
              </span>
              {currentFileMeta?.syntax === 'json' && (
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                    jsonError
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
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
                className="flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-[11px] cursor-pointer transition-colors"
                title="Recharger le fichier depuis le disque"
              >
                <RefreshCw className={`w-3 h-3 ${loadingContent ? 'animate-spin' : ''}`} />
                <span>Recharger</span>
              </button>
            </div>
          </div>

          {/* JSON Error Banner if any */}
          {jsonError && (
            <div className="px-4 py-2 bg-rose-500/10 border-b border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span className="font-mono text-[11px] truncate">Erreur de syntaxe : {jsonError}</span>
            </div>
          )}

          {/* Code Area with Line Numbers */}
          <div className="flex-1 flex overflow-hidden">
            {/* Gutter */}
            <div 
              ref={gutterRef}
              className="w-14 bg-[#090e1c] border-r border-slate-800/80 py-3 px-2 select-none text-right font-mono text-[11px] text-slate-600 overflow-hidden leading-6"
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
                className="w-full h-full bg-transparent font-mono text-[11px] text-slate-200 placeholder-slate-600 focus:outline-none resize-none leading-6 selection:bg-sky-500/30 py-3 px-4 overflow-auto whitespace-pre"
              />
            </div>
          </div>
        </div>

        {/* Footer / Action Bar */}
        <div className="p-3.5 bg-[#0f172a] border-t border-slate-800 flex items-center justify-between shrink-0">
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
