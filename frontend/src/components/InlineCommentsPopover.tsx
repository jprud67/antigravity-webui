import React, { useState } from 'react';
import { MessageSquare, Bot, Check, Trash2, X, Send, Sparkles } from 'lucide-react';
import type { InlineComment } from '../types';
import { createInlineComment, updateInlineComment, deleteInlineComment, triggerInlineReview } from '../services/api';
import { showToast } from '../services/toast';

interface InlineCommentsPopoverProps {
  isOpen: boolean;
  onClose: () => void;
  conversationId: string;
  filePath: string;
  lineNumber: number;
  comments: InlineComment[];
  onCommentsUpdated: () => void;
}

export const InlineCommentsPopover: React.FC<InlineCommentsPopoverProps> = ({
  isOpen,
  onClose,
  conversationId,
  filePath,
  lineNumber,
  comments,
  onCommentsUpdated,
}) => {
  const [newCommentText, setNewCommentText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);

  if (!isOpen) return null;

  const lineComments = comments.filter((c) => c.line_number === lineNumber);

  const handleAddComment = async (overrideText?: string) => {
    const text = overrideText !== undefined ? overrideText : newCommentText;
    if (!text.trim()) return;

    try {
      setIsSubmitting(true);
      await createInlineComment({
        conversation_id: conversationId,
        file_path: filePath,
        line_number: lineNumber,
        author: 'User',
        content: text.trim(),
      });
      setNewCommentText('');
      onCommentsUpdated();
      showToast('Commentaire ajouté', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de l\'ajout', 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleResolve = async (comment: InlineComment) => {
    try {
      await updateInlineComment(comment.id, { resolved: !comment.resolved });
      onCommentsUpdated();
    } catch (err: any) {
      showToast(err.message || 'Erreur de mise à jour', 'error');
    }
  };

  const handleDelete = async (commentId: string) => {
    try {
      await deleteInlineComment(commentId);
      onCommentsUpdated();
      showToast('Commentaire supprimé', 'info');
    } catch (err: any) {
      showToast(err.message || 'Erreur de suppression', 'error');
    }
  };

  const handleTriggerAgentReview = async () => {
    try {
      setIsReviewing(true);
      await triggerInlineReview(conversationId, filePath, `Ligne ${lineNumber}: revue critique requise.`);
      // Add a comment indicating agent review was requested
      await handleAddComment(`@agent Peux-tu analyser et optimiser cette ligne (${lineNumber}) ?`);
      showToast('Revue autonome par l\'agent déclenchée !', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erreur de déclenchement', 'error');
    } finally {
      setIsReviewing(false);
    }
  };

  return (
    <div className="absolute right-4 bottom-14 z-50 w-96 max-w-[90vw] bg-zinc-900 border border-zinc-700/80 rounded-xl shadow-2xl overflow-hidden flex flex-col text-xs text-zinc-200">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-zinc-800/80 border-b border-zinc-700/80">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-purple-400" />
          <span className="font-semibold text-zinc-100">
            Revue & Commentaires (Ligne {lineNumber})
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-700/50 transition"
        >
          <X size={14} />
        </button>
      </div>

      {/* Comments List */}
      <div className="p-3 max-h-60 overflow-y-auto space-y-2.5">
        {lineComments.length === 0 ? (
          <div className="text-center py-4 text-zinc-500">
            Aucun commentaire sur la ligne {lineNumber}.
          </div>
        ) : (
          lineComments.map((c) => (
            <div
              key={c.id}
              className={`p-2.5 rounded-lg border transition ${
                c.resolved
                  ? 'bg-zinc-800/30 border-zinc-800 text-zinc-400'
                  : c.has_agent_mention
                  ? 'bg-purple-950/20 border-purple-800/50'
                  : 'bg-zinc-800/60 border-zinc-700/60'
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5 font-medium">
                  {c.has_agent_mention ? (
                    <Bot size={13} className="text-purple-400" />
                  ) : null}
                  <span className={c.has_agent_mention ? 'text-purple-300' : 'text-zinc-200'}>
                    {c.author}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleToggleResolve(c)}
                    className={`p-1 rounded hover:bg-zinc-700/50 transition ${
                      c.resolved ? 'text-emerald-400' : 'text-zinc-400 hover:text-emerald-300'
                    }`}
                    title={c.resolved ? 'Rouvrir' : 'Marquer comme résolu'}
                  >
                    <Check size={12} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-700/50 transition"
                    title="Supprimer"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <p className="text-zinc-300 whitespace-pre-wrap leading-relaxed">{c.content}</p>
            </div>
          ))
        )}
      </div>

      {/* Footer / Input */}
      <div className="p-3 bg-zinc-950/50 border-t border-zinc-800 space-y-2">
        <div className="flex items-center gap-1.5">
          <input
            type="text"
            value={newCommentText}
            onChange={(e) => setNewCommentText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleAddComment();
              }
            }}
            placeholder="Ajouter un commentaire (@agent pour orienter)..."
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500"
          />
          <button
            type="button"
            disabled={isSubmitting || !newCommentText.trim()}
            onClick={() => handleAddComment()}
            className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition disabled:opacity-40"
          >
            <Send size={13} />
          </button>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            disabled={isReviewing}
            onClick={handleTriggerAgentReview}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-900/30 border border-purple-700/50 text-purple-300 hover:bg-purple-800/40 rounded-lg text-[11px] font-medium transition disabled:opacity-40"
          >
            <Sparkles size={12} className="text-purple-400" />
            <span>Revue @agent auto</span>
          </button>
          <span className="text-[10px] text-zinc-500">Mentionnez @agent dans le texte</span>
        </div>
      </div>
    </div>
  );
};
