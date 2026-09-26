import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X,
  GitBranch,
  GitFork,
  Bookmark,
  Plus,
  Trash2,
  ExternalLink,
  Clock,
  Search,
  RefreshCw,
  FolderGit2,
} from 'lucide-react';
import {
  fetchConversationBranches,
  addConversationBookmark,
  removeConversationBookmark,
  type BranchTreeResult,
  type ConversationBranchNode,
} from '../services/api';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface SessionBranchModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentConversationId: string;
  onSelectConversation: (conversationId: string) => void;
  onForkConversation?: (stepIndex: number) => void;
}

export const SessionBranchModal: React.FC<SessionBranchModalProps> = ({
  isOpen,
  onClose,
  currentConversationId,
  onSelectConversation,
  onForkConversation,
}) => {
  const { t } = useI18n();

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<BranchTreeResult | null>(null);
  const [activeTab, setActiveTab] = useState<'tree' | 'bookmarks'>('tree');
  const [searchQuery, setSearchQuery] = useState('');

  // Add bookmark form state
  const [isAddingBm, setIsAddingBm] = useState(false);
  const [bmStepIndex, setBmStepIndex] = useState<number>(0);
  const [bmLabel, setBmLabel] = useState('');
  const [bmPreview, setBmPreview] = useState('');

  const loadData = useCallback(async () => {
    if (!currentConversationId) return;
    setLoading(true);
    try {
      const res = await fetchConversationBranches(currentConversationId);
      setData(res);
    } catch (err: any) {
      showToast(err.message || 'Impossible de charger l’arbre des branches', 'error');
    } finally {
      setLoading(false);
    }
  }, [currentConversationId]);

  useEffect(() => {
    if (!isOpen || !currentConversationId) return;
    let active = true;
    fetchConversationBranches(currentConversationId)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) showToast(err.message || 'Impossible de charger l’arbre des branches', 'error');
      });
    return () => {
      active = false;
    };
  }, [isOpen, currentConversationId]);

  // Handle ESC key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCreateBookmark = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bmLabel.trim()) {
      showToast(t('bookmark_specify_label', 'Veuillez indiquer un libellé pour le marque-page'), 'warning');
      return;
    }
    try {
      await addConversationBookmark(currentConversationId, bmStepIndex, bmLabel.trim(), bmPreview.trim());
      showToast(t('bookmark_saved_success', 'Marque-page enregistré avec succès'), 'success');
      setBmLabel('');
      setBmPreview('');
      setIsAddingBm(false);
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la création du marque-page', 'error');
    }
  };

  const handleDeleteBookmark = async (convId: string, bookmarkId: string) => {
    try {
      await removeConversationBookmark(convId, bookmarkId);
      showToast(t('bookmark_deleted', 'Marque-page supprimé'), 'info');
      await loadData();
    } catch (err: any) {
      showToast(err.message || 'Erreur lors de la suppression', 'error');
    }
  };

  // Filtered bookmarks for search
  const filteredBookmarks = useMemo(() => {
    if (!data?.all_bookmarks) return [];
    if (!searchQuery.trim()) return data.all_bookmarks;
    const q = searchQuery.toLowerCase();
    return data.all_bookmarks.filter(
      (b) =>
        b.label.toLowerCase().includes(q) ||
        (b.preview && b.preview.toLowerCase().includes(q)) ||
        (b.conversation_title && b.conversation_title.toLowerCase().includes(q))
    );
  }, [data, searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn select-none">
      <div
        className="w-full max-w-4xl max-h-[88vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden animate-scaleIn"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400">
              <FolderGit2 className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--strong)' }}>
                  {t('branch_visualiser_title', 'Arbre des Branches & Signets Mémoire')}
                </h2>
                {data && (
                  <span
                    className="text-[11px] font-mono px-2 py-0.5 rounded-full border"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border-subtle)',
                      color: 'var(--muted)',
                    }}
                  >
                    {data.total_branches} {data.total_branches > 1 ? 'branches' : 'branche'}
                  </span>
                )}
              </div>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                {t(
                  'branch_visualiser_desc',
                  'Visualisez l’historique des forks de la conversation et explorez vos marque-pages de contexte'
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadData}
              disabled={loading}
              title={t('branch_refresh_tooltip', 'Actualiser la généalogie')}
              className="p-2 rounded-lg transition-colors hover:opacity-100 opacity-70 cursor-pointer"
              style={{ color: 'var(--muted)' }}
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg transition-colors hover:bg-rose-500/10 hover:text-rose-400 cursor-pointer"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab Switcher & Action bar */}
        <div
          className="flex items-center justify-between px-5 py-2.5 border-b text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border-subtle)',
          }}
        >
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('tree')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'tree'
                  ? 'bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold'
                  : 'hover:opacity-100 opacity-70 border border-transparent'
              }`}
            >
              <GitBranch className="w-3.5 h-3.5" />
              <span>{t('tab_branch_tree', 'Généalogie des Branches')}</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('bookmarks')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
                activeTab === 'bookmarks'
                  ? 'bg-amber-500/15 text-amber-400 border border-amber-500/30 font-semibold'
                  : 'hover:opacity-100 opacity-70 border border-transparent'
              }`}
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>
                {t('tab_bookmarks', 'Signets Mémoire')} ({data?.all_bookmarks?.length || 0})
              </span>
            </button>
          </div>

          <div className="flex items-center gap-2">
            {activeTab === 'bookmarks' && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 opacity-50" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('search_bookmarks_placeholder', 'Filtrer les signets...')}
                  className="pl-8 pr-2.5 py-1 text-xs rounded-lg border focus:outline-none focus:border-[var(--accent)]"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>
            )}
            <button
              type="button"
              onClick={() => setIsAddingBm(!isAddingBm)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg font-medium text-xs transition-colors cursor-pointer border"
              style={{
                backgroundColor: isAddingBm ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                borderColor: isAddingBm ? 'var(--accent)' : 'var(--border)',
                color: isAddingBm ? 'var(--accent-text)' : 'var(--text)',
              }}
            >
              <Plus className="w-3.5 h-3.5 text-[var(--accent)]" />
              <span>{t('add_bookmark_btn', 'Nouveau Signet')}</span>
            </button>
          </div>
        </div>

        {/* Collapsible New Bookmark Form */}
        {isAddingBm && (
          <form
            onSubmit={handleCreateBookmark}
            className="p-4 border-b flex flex-col sm:flex-row items-center gap-3 shrink-0 animate-fadeIn"
            style={{
              backgroundColor: 'var(--surface-subtle)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <span className="text-xs font-semibold whitespace-nowrap opacity-75">{t('step_number_prefix', 'Étape #')}</span>
              <input
                type="number"
                min={0}
                value={bmStepIndex}
                onChange={(e) => setBmStepIndex(parseInt(e.target.value, 10) || 0)}
                className="w-16 px-2 py-1.5 text-xs rounded-lg border font-mono"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              />
            </div>
            <input
              type="text"
              required
              value={bmLabel}
              onChange={(e) => setBmLabel(e.target.value)}
              placeholder={t('branch_bookmark_label_placeholder', 'Libellé du signet (ex: Architecture validée, Refactoring auth...)')}
              className="flex-1 w-full px-3 py-1.5 text-xs rounded-lg border"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <input
              type="text"
              value={bmPreview}
              onChange={(e) => setBmPreview(e.target.value)}
              placeholder={t('branch_bookmark_note_placeholder', 'Note ou aperçu contextuel (optionnel)')}
              className="flex-1 w-full px-3 py-1.5 text-xs rounded-lg border hidden md:block"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            />
            <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => setIsAddingBm(false)}
                className="px-3 py-1.5 rounded-lg text-xs hover:opacity-100 opacity-70 cursor-pointer"
              >
                {t('cancel', 'Annuler')}
              </button>
              <button
                type="submit"
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer shadow-sm"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#ffffff',
                }}
              >
                {t('save', 'Enregistrer')}
              </button>
            </div>
          </form>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {loading && !data && (
            <div className="py-12 flex flex-col items-center justify-center text-xs opacity-60 gap-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[var(--accent)]" />
              <span>{t('branch_loading', 'Chargement de la structure des branches...')}</span>
            </div>
          )}

          {/* TAB 1: BRANCH TREE */}
          {activeTab === 'tree' && data?.tree && (
            <div className="space-y-4">
              <TreeNodeItem
                node={data.tree}
                currentId={currentConversationId}
                onSelect={(id) => {
                  onSelectConversation(id);
                  onClose();
                }}
                onFork={(stepIndex) => {
                  onForkConversation?.(stepIndex);
                  onClose();
                }}
                level={0}
              />
            </div>
          )}

          {activeTab === 'tree' && !loading && !data?.tree && (
            <div className="py-12 text-center text-xs opacity-60">
              Aucune généalogie de branche trouvée pour cette session.
            </div>
          )}

          {/* TAB 2: BOOKMARKS LIST */}
          {activeTab === 'bookmarks' && (
            <div className="space-y-3">
              {filteredBookmarks.length === 0 ? (
                <div className="py-12 text-center text-xs opacity-60">
                  {searchQuery ? 'Aucun signet ne correspond à votre recherche.' : 'Aucun signet mémoire enregistré.'}
                </div>
              ) : (
                filteredBookmarks.map((bm) => {
                  const isCurrentSession = bm.conversation_id === currentConversationId;
                  return (
                    <div
                      key={bm.id}
                      className="p-3.5 rounded-xl border flex items-start justify-between gap-3 transition-all hover:border-[var(--accent)]"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: isCurrentSession ? 'var(--accent-bg-strong)' : 'var(--border)',
                      }}
                    >
                      <div className="flex items-start gap-3 min-w-0 flex-1">
                        <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                          <Bookmark className="w-4 h-4 fill-amber-400" />
                        </div>
                        <div className="space-y-1 min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-xs text-[var(--strong)]">{bm.label}</span>
                            <span
                              className="text-[10px] font-mono px-2 py-0.5 rounded-md border"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border-subtle)',
                                color: 'var(--muted)',
                              }}
                            >
                              Tour #{bm.step_index}
                            </span>
                            {bm.conversation_title && (
                              <span className="text-[11px] font-mono text-[var(--muted)] truncate max-w-[200px]">
                                • {bm.conversation_title}
                              </span>
                            )}
                            {isCurrentSession && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Session active
                              </span>
                            )}
                          </div>
                          {bm.preview && (
                            <p className="text-xs line-clamp-2" style={{ color: 'var(--text)' }}>
                              {bm.preview}
                            </p>
                          )}
                          <div className="text-[10px] font-mono opacity-50">
                            Créé le {new Date(bm.created_at).toLocaleString()}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        {bm.conversation_id && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectConversation(bm.conversation_id!);
                              onClose();
                            }}
                            title={t('switch_to_session_tooltip', 'Basculer vers cette session')}
                            className="p-1.5 rounded-lg border hover:bg-[var(--accent-bg)] hover:text-[var(--accent-text)] transition-colors cursor-pointer text-xs flex items-center gap-1"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">{t('open', 'Ouvrir')}</span>
                          </button>
                        )}
                        {bm.conversation_id && (
                          <button
                            type="button"
                            onClick={() => handleDeleteBookmark(bm.conversation_id!, bm.id)}
                            title={t('branch_delete_bookmark', 'Supprimer ce signet')}
                            className="p-1.5 rounded-lg border hover:bg-rose-500/10 hover:text-rose-400 transition-colors cursor-pointer text-xs"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-5 py-3 border-t text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-2 text-muted">
            <Clock className="w-3.5 h-3.5" />
            <span>ID Actif : {currentConversationId.slice(0, 18)}...</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg font-medium text-xs border hover:opacity-100 opacity-80 cursor-pointer"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
};

// Tree node component rendered recursively
interface TreeNodeItemProps {
  node: ConversationBranchNode;
  currentId: string;
  onSelect: (conversationId: string) => void;
  onFork: (stepIndex: number) => void;
  level: number;
}

const TreeNodeItem: React.FC<TreeNodeItemProps> = ({
  node,
  currentId,
  onSelect,
  onFork,
  level,
}) => {
  const { t } = useI18n();
  const isCurrent = node.conversation_id === currentId;

  return (
    <div className={`relative ${level > 0 ? 'ml-6 sm:ml-8 pl-3 border-l-2' : ''}`} style={{ borderColor: 'var(--border-subtle)' }}>
      {/* Node Card */}
      <div
        className={`p-3.5 rounded-xl border transition-all ${
          isCurrent
            ? 'ring-2 ring-purple-500/50 shadow-md'
            : 'hover:border-purple-500/40 opacity-90 hover:opacity-100'
        }`}
        style={{
          backgroundColor: isCurrent ? 'var(--surface-subtle)' : 'var(--surface)',
          borderColor: isCurrent ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2.5 min-w-0 flex-1">
            <div
              className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${
                isCurrent
                  ? 'bg-purple-500 text-white'
                  : node.is_root
                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}
            >
              {node.is_root ? <FolderGit2 className="w-4 h-4" /> : <GitFork className="w-4 h-4" />}
            </div>

            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-xs tracking-tight" style={{ color: 'var(--strong)' }}>
                  {node.title}
                </span>

                {node.is_root && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    Racine
                  </span>
                )}

                {isCurrent && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 text-purple-400 border border-purple-500/30 font-semibold">
                    En cours
                  </span>
                )}

                <span
                  className="text-[10px] font-mono px-1.5 py-0.2 rounded border"
                  style={{ borderColor: 'var(--border-subtle)', color: 'var(--muted)' }}
                >
                  {node.step_count} étapes
                </span>
              </div>

              {node.preview && (
                <p className="text-xs line-clamp-1 opacity-70" style={{ color: 'var(--text)' }}>
                  {node.preview}
                </p>
              )}

              {/* Bookmarks anchored to this node */}
              {node.bookmarks && node.bookmarks.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  {node.bookmarks.map((bm) => (
                    <span
                      key={bm.id}
                      className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded font-medium border"
                      style={{
                        backgroundColor: 'rgba(234, 179, 8, 0.12)',
                        borderColor: 'rgba(234, 179, 8, 0.3)',
                        color: '#eab308',
                      }}
                      title={`Signet: ${bm.label}`}
                    >
                      <Bookmark className="w-2.5 h-2.5 fill-current" />
                      <span>{bm.label}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5 shrink-0">
            {!isCurrent && (
              <button
                type="button"
                onClick={() => onSelect(node.conversation_id)}
                className="px-2.5 py-1 rounded-md text-xs font-medium border hover:bg-[var(--accent-bg)] hover:text-[var(--accent-text)] transition-colors cursor-pointer"
                style={{ borderColor: 'var(--border)' }}
              >
                Ouvrir
              </button>
            )}

            <button
              type="button"
              onClick={() => onFork(node.step_count)}
              title={t('branch_fork_step', 'Bifurquer à partir de cette étape')}
              className="p-1 rounded-md border hover:bg-purple-500/10 hover:text-purple-400 transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)' }}
            >
              <GitBranch className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Children branches */}
      {node.children && node.children.length > 0 && (
        <div className="mt-2.5 space-y-2.5">
          {node.children.map((child) => (
            <TreeNodeItem
              key={child.conversation_id}
              node={child}
              currentId={currentId}
              onSelect={onSelect}
              onFork={onFork}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};
