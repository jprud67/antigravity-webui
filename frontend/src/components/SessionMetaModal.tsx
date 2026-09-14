import React, { useState, useEffect } from 'react';
import { X, Tag, Folder, Palette, Pin, Check, Trash2 } from 'lucide-react';
import type { Conversation } from '../types';
import { updateConversationMetadata, deleteConversation } from '../services/api';

interface SessionMetaModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  onUpdated: () => void;
  onDeleted?: (conversationId: string) => void;
}

const PALETTE = [
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#f43f5e', // Rose
  '#6366f1', // Indigo
  '#a855f7', // Purple
  '#ec4899', // Pink
  '#06b6d4', // Cyan
];

export const SessionMetaModal: React.FC<SessionMetaModalProps> = ({
  isOpen,
  onClose,
  conversation,
  onUpdated,
  onDeleted
}) => {
  const [title, setTitle] = useState('');
  const [project, setProject] = useState('');
  const [projectColor, setProjectColor] = useState(PALETTE[0]);
  const [tagsStr, setTagsStr] = useState('');
  const [pinned, setPinned] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (conversation) {
      setTitle(conversation.customTitle || conversation.title || '');
      setProject(conversation.project || '');
      setProjectColor(conversation.projectColor || PALETTE[0]);
      setTagsStr((conversation.tags || []).join(', '));
      setPinned(!!conversation.pinned);
      setError(null);
    }
  }, [conversation]);

  if (!isOpen || !conversation) return null;

  const handleSave = async () => {
    setLoading(true);
    setError(null);
    try {
      const parsedTags = tagsStr
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      await updateConversationMetadata(conversation.conversation_id, {
        customTitle: title.trim(),
        project: project.trim(),
        projectColor,
        tags: parsedTags,
        pinned
      });
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erreur lors de la sauvegarde');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('Voulez-vous vraiment supprimer définitivement cette conversation et son historique ?')) {
      return;
    }
    setLoading(true);
    try {
      await deleteConversation(conversation.conversation_id);
      if (onDeleted) onDeleted(conversation.conversation_id);
      onUpdated();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Erreur de suppression');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fadeIn">
      <div className="bg-[#0b101f] border border-slate-700/80 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-[#080d1a]">
          <div className="flex items-center gap-2">
            <Tag className="w-4 h-4 text-sky-400" />
            <h3 className="text-sm font-semibold text-white">Gestion de Session & Métadonnées</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-5 space-y-4 text-xs">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-slate-400 font-medium">Titre de la session</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Refonte du backend API, Bug Auth..."
              className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60 font-medium text-xs"
            />
          </div>

          {/* Project & Color */}
          <div className="space-y-1.5">
            <label className="text-slate-400 font-medium flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5 text-indigo-400" />
              <span>Projet / Catégorie</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={project}
                onChange={(e) => setProject(e.target.value)}
                placeholder="Ex: Antigravity, LeadForge, Infra..."
                className="flex-1 px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60 text-xs"
              />
            </div>
          </div>

          {/* Color Picker Palette */}
          <div className="space-y-1.5">
            <label className="text-slate-400 font-medium flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-amber-400" />
              <span>Pastille de couleur du projet</span>
            </label>
            <div className="flex items-center gap-2 pt-1">
              {PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setProjectColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-6 h-6 rounded-full border transition-all cursor-pointer flex items-center justify-center ${
                    projectColor === c ? 'border-white scale-110 shadow-md shadow-black' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                >
                  {projectColor === c && <Check className="w-3 h-3 text-white drop-shadow" />}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <label className="text-slate-400 font-medium flex items-center gap-1.5">
              <Tag className="w-3.5 h-3.5 text-emerald-400" />
              <span>Tags (séparés par des virgules)</span>
            </label>
            <input
              type="text"
              value={tagsStr}
              onChange={(e) => setTagsStr(e.target.value)}
              placeholder="Ex: backend, security, refactor, bug"
              className="w-full px-3 py-2 bg-[#060a14] border border-slate-800 rounded-xl text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500/60 font-mono text-xs"
            />
            <p className="text-[10px] text-slate-500">Ces tags vous permettront de filtrer vos sessions en un clic dans la barre latérale.</p>
          </div>

          {/* Pin toggle */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setPinned(!pinned)}
              className={`w-full p-2.5 rounded-xl border flex items-center justify-between text-xs transition-colors cursor-pointer ${
                pinned
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-[#060a14] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                <Pin className={`w-4 h-4 ${pinned ? 'fill-current text-amber-400' : 'text-slate-500'}`} />
                <span>Épingler cette session en haut de la liste</span>
              </div>
              <span className="text-[10px] uppercase font-mono">{pinned ? 'Actif' : 'Inactif'}</span>
            </button>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 flex items-center justify-between bg-[#080d1a]">
          <button
            type="button"
            onClick={handleDelete}
            disabled={loading}
            className="py-1.5 px-3 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/20 text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Supprimer la session</span>
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="py-1.5 px-3 rounded-lg text-slate-400 hover:text-white text-xs cursor-pointer"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={loading}
              className="py-1.5 px-4 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs transition-all shadow-md shadow-sky-500/20 cursor-pointer"
            >
              {loading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
