import React, { useState, useEffect, useCallback } from 'react';
import { 
  X, 
  Layers, 
  Sparkles, 
  Plus, 
  Trash2, 
  ExternalLink, 
  FolderOpen, 
  Save, 
  Check, 
  Search,
  Code2,
  RefreshCw,
  Eye
} from 'lucide-react';
import { canvasApi } from '../services/api';
import CanvasViewer from './CanvasViewer';
import type { CanvasDocumentManifest } from '../types';
import { useI18n } from '../services/i18n';
import { showToast } from '../services/toast';
import { showConfirm } from '../services/dialog';

interface CanvasStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDocId?: string;
}

const TEMPLATES: Record<string, { title: string; html: string }> = {
  kpi_dashboard: {
    title: 'KPI Performance Dashboard',
    html: `<div style="padding: 24px; font-family: var(--font-body, system-ui, sans-serif);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <div>
      <h2 style="margin: 0; font-size: 18px; color: var(--text-strong, var(--strong, #ffffff));">System Overview</h2>
      <p style="margin: 4px 0 0; font-size: 12px; color: var(--muted, #94a3b8);">Real-time telemetry and throughput</p>
    </div>
    <span style="font-size: 11px; padding: 4px 10px; border-radius: 9999px; background: rgba(34,197,94,0.15); color: #4ade80; border: 1px solid rgba(34,197,94,0.3); font-weight: 600;">Operational</span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">
    <div style="background: var(--surface-subtle, rgba(255,255,255,0.03)); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 16px;">
      <div style="font-size: 12px; color: var(--muted, #94a3b8);">Total Requests</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong, var(--strong, #ffffff)); font-family: var(--font-mono, monospace);">148,290</div>
      <div style="font-size: 11px; color: #4ade80; margin-top: 4px;">↑ +14.2% today</div>
    </div>
    <div style="background: var(--surface-subtle, rgba(255,255,255,0.03)); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 16px;">
      <div style="font-size: 12px; color: var(--muted, #94a3b8);">Avg Latency</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong, var(--strong, #ffffff)); font-family: var(--font-mono, monospace);">28.4 ms</div>
      <div style="font-size: 11px; color: #4ade80; margin-top: 4px;">↓ -4.1 ms faster</div>
    </div>
    <div style="background: var(--surface-subtle, rgba(255,255,255,0.03)); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 16px;">
      <div style="font-size: 12px; color: var(--muted, #94a3b8);">Success Rate</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong, var(--strong, #ffffff)); font-family: var(--font-mono, monospace);">99.94%</div>
      <div style="font-size: 11px; color: #4ade80; margin-top: 4px;">Target: 99.9%</div>
    </div>
    <div style="background: var(--surface-subtle, rgba(255,255,255,0.03)); border: 1px solid var(--border, rgba(255,255,255,0.08)); border-radius: 14px; padding: 16px;">
      <div style="font-size: 12px; color: var(--muted, #94a3b8);">Active Subagents</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong, var(--strong, #ffffff)); font-family: var(--font-mono, monospace);">4 Worktrees</div>
      <div style="font-size: 11px; color: var(--accent, #38bdf8); margin-top: 4px;">Isolated & Healthy</div>
    </div>
  </div>
</div>`
  },
  data_table: {
    title: 'Interactive Filterable Table',
    html: `<div style="padding: 20px; font-family: var(--font-body, system-ui, sans-serif);">
  <div style="margin-bottom: 14px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
    <h3 style="margin: 0; font-size: 16px; color: var(--text-strong, var(--strong, #ffffff));">Recent Deployments</h3>
    <input type="text" id="search" placeholder="Filter rows..." style="padding: 6px 12px; border-radius: 8px; border: 1px solid var(--border, rgba(255,255,255,0.1)); background: var(--surface-subtle, rgba(255,255,255,0.04)); color: var(--text, #f8fafc); font-size: 12px;" />
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 12px; text-align: left;">
    <thead>
      <tr style="border-bottom: 1px solid var(--border, rgba(255,255,255,0.1)); color: var(--muted, #94a3b8);">
        <th style="padding: 8px 12px;">Service</th>
        <th style="padding: 8px 12px;">Commit</th>
        <th style="padding: 8px 12px;">Status</th>
        <th style="padding: 8px 12px;">Time</th>
      </tr>
    </thead>
    <tbody id="rows">
      <tr style="border-bottom: 1px solid var(--border, rgba(255,255,255,0.05));">
        <td style="padding: 10px 12px; font-weight: 600; color: var(--text, #f8fafc);">webui-frontend</td>
        <td style="padding: 10px 12px; font-family: var(--font-mono, monospace); color: var(--accent, #38bdf8);">a8f23b1</td>
        <td style="padding: 10px 12px; color: #4ade80;">Active</td>
        <td style="padding: 10px 12px; color: var(--muted, #94a3b8);">2m ago</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--border, rgba(255,255,255,0.05));">
        <td style="padding: 10px 12px; font-weight: 600; color: var(--text, #f8fafc);">antigravity-kernel</td>
        <td style="padding: 10px 12px; font-family: var(--font-mono, monospace); color: var(--accent, #38bdf8);">c491e0a</td>
        <td style="padding: 10px 12px; color: #4ade80;">Active</td>
        <td style="padding: 10px 12px; color: var(--muted, #94a3b8);">14m ago</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--border, rgba(255,255,255,0.05));">
        <td style="padding: 10px 12px; font-weight: 600; color: var(--text, #f8fafc);">messaging-gateway</td>
        <td style="padding: 10px 12px; font-family: var(--font-mono, monospace); color: var(--accent, #38bdf8);">e73da94</td>
        <td style="padding: 10px 12px; color: #4ade80;">Active</td>
        <td style="padding: 10px 12px; color: var(--muted, #94a3b8);">1h ago</td>
      </tr>
    </tbody>
  </table>
  <script>
    document.getElementById('search').addEventListener('input', function(e) {
      var val = e.target.value.toLowerCase();
      var rows = document.querySelectorAll('#rows tr');
      rows.forEach(function(row) {
        row.style.display = row.innerText.toLowerCase().includes(val) ? '' : 'none';
      });
    });
  </script>
</div>`
  },
  chart_js: {
    title: 'Live Chart.js Visualizer',
    html: `<div style="padding: 24px; font-family: var(--font-body, system-ui, sans-serif);">
  <h3 style="margin: 0 0 16px; font-size: 16px; color: var(--text-strong, var(--strong, #ffffff));">Weekly Request Volume</h3>
  <div style="position: relative; height: 260px; width: 100%;">
    <canvas id="myChart"></canvas>
  </div>
</div>
<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
<script>
  window.addEventListener('load', function() {
    var ctx = document.getElementById('myChart');
    if (!ctx) return;
    new Chart(ctx, {
      type: 'line',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
          label: 'Requests (k)',
          data: [12, 19, 15, 25, 22, 30, 42],
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.1)',
          fill: true,
          tension: 0.35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#94a3b8' } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
          y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
        }
      }
    });
  });
</script>`
  }
};

export const CanvasStudioModal: React.FC<CanvasStudioModalProps> = ({
  isOpen,
  onClose,
  initialDocId,
}) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'studio' | 'gallery'>('studio');
  const [documents, setDocuments] = useState<CanvasDocumentManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('kpi_dashboard');
  const [htmlCode, setHtmlCode] = useState<string>(TEMPLATES.kpi_dashboard.html);
  const [docTitle, setDocTitle] = useState<string>(TEMPLATES.kpi_dashboard.title);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<CanvasDocumentManifest | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const docs = await canvasApi.listDocuments();
      setDocuments(docs);
      if (initialDocId) {
        const found = docs.find((d) => d.id === initialDocId);
        if (found) {
          setSelectedDoc(found);
          setActiveTab('gallery');
        }
      }
    } catch (err: any) {
      showToast(err.message || 'Error loading canvas documents', 'error');
    } finally {
      setLoading(false);
    }
  }, [initialDocId]);

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        loadDocuments();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isOpen, loadDocuments]);

  const handleTemplateChange = (tplKey: string) => {
    setSelectedTemplate(tplKey);
    if (TEMPLATES[tplKey]) {
      setHtmlCode(TEMPLATES[tplKey].html);
      setDocTitle(TEMPLATES[tplKey].title);
    }
  };

  const handleSaveDocument = async () => {
    try {
      setSaving(true);
      const manifest = await canvasApi.createDocument({
        kind: 'html_bundle',
        title: docTitle.trim() || 'Custom Canvas',
        preferredHeight: 450,
        entrypoint: {
          type: 'html',
          value: htmlCode,
        },
        wrapWithTheme: true,
      });
      setSavedSuccess(true);
      showToast(t('canvas_saved_success', 'Document Canvas enregistré !'), 'success');
      setTimeout(() => setSavedSuccess(false), 2500);
      await loadDocuments();
      setSelectedDoc(manifest);
    } catch (err: any) {
      showToast(err.message || 'Error saving canvas', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await showConfirm(t('canvas_delete_confirm', 'Supprimer définitivement ce Canvas ?'), { destructive: true });
    if (!confirmed) return;
    try {
      await canvasApi.deleteDocument(id);
      showToast(t('canvas_deleted', 'Canvas supprimé'), 'info');
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
      }
      await loadDocuments();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete canvas', 'error');
    }
  };

  if (!isOpen) return null;

  const filteredDocs = documents.filter((d) =>
    (d.title || d.id).toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 safe-pt safe-pb animate-fadeIn">
      <div 
        className="border rounded-2xl sm:rounded-3xl w-full max-w-6xl shadow-2xl overflow-hidden flex flex-col h-[94dvh] sm:h-[88vh]"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border2)',
          color: 'var(--text)'
        }}
        onClick={(e) => e.stopPropagation()}
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
              <Layers className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />
            </div>
            <div className="min-w-0">
              <h2 className="text-xs sm:text-sm font-bold flex items-center gap-2 truncate" style={{ color: 'var(--strong)' }}>
                <span>{t('canvas_studio_title', 'Canvas Vivant & Documents Interactifs')}</span>
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border"
                  style={{
                    backgroundColor: 'var(--accent-bg)',
                    borderColor: 'var(--accent)',
                    color: 'var(--accent-text)'
                  }}
                >
                  {t('canvas_badge_sandbox', 'Sandboxed')}
                </span>
              </h2>
              <p className="text-[10px] sm:text-[11px] truncate hidden sm:block" style={{ color: 'var(--muted)' }}>
                {t('canvas_studio_desc', 'Widgets React/HTML isolés dans iframe sandboxed avec bridge de thème et auto-resize')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Tab Pill Navigation */}
            <div className="flex items-center gap-1 bg-black/20 dark:bg-black/40 p-1 rounded-xl border border-white/5">
              <button
                onClick={() => setActiveTab('studio')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                  activeTab === 'studio'
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {t('canvas_tab_studio', 'Studio')}
              </button>
              <button
                onClick={() => setActiveTab('gallery')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                  activeTab === 'gallery'
                    ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                <span>{t('canvas_tab_gallery', 'Galerie ({0})').replace('{0}', String(documents.length))}</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg transition-colors cursor-pointer hover:opacity-100 opacity-70"
              style={{ color: 'var(--muted)' }}
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'studio' ? (
            <div className="h-full grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: 'var(--border)' }}>
              {/* Left Column: Code Editor & Controls */}
              <div
                className="flex flex-col h-full overflow-hidden"
                style={{ backgroundColor: 'var(--surface)' }}
              >
                {/* Editor Toolbar */}
                <div
                  className="p-3.5 border-b flex flex-wrap items-center justify-between gap-3 shrink-0"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)'
                  }}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <input
                      type="text"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder={t('canvas_doc_title_placeholder', 'Titre du widget...')}
                      className="w-full px-3 py-1.5 rounded-xl text-xs font-medium border focus:outline-hidden"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl text-xs border focus:outline-hidden cursor-pointer"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <option value="kpi_dashboard">{t('canvas_template_kpi', 'KPI Dashboard')}</option>
                      <option value="data_table">{t('canvas_template_table', 'Tableau Filtrable')}</option>
                      <option value="chart_js">{t('canvas_template_chart', 'Graphique Chart.js')}</option>
                    </select>

                    <button
                      onClick={handleSaveDocument}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer shadow-sm"
                      style={{
                        backgroundColor: 'var(--accent-bg)',
                        borderColor: 'var(--accent)',
                        color: 'var(--accent-text)'
                      }}
                    >
                      {savedSuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>{t('canvas_saved_success', 'Sauvegardé !')}</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>{saving ? t('canvas_saving', 'Enregistrement...') : t('canvas_save_btn', 'Sauvegarder')}</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* HTML Textarea */}
                <div className="flex-1 p-3 overflow-hidden flex flex-col space-y-2">
                  <div className="text-[11px] font-mono flex items-center justify-between" style={{ color: 'var(--muted)' }}>
                    <span className="flex items-center gap-1.5">
                      <Code2 className="w-3.5 h-3.5 text-indigo-400" />
                      <span>{t('canvas_code_editor', 'CODE HTML / JS EMBARQUÉ')}</span>
                    </span>
                    <span className="text-[10px] text-indigo-400">
                      {t('canvas_css_postmessage', 'Variables CSS & postMessage supportés')}
                    </span>
                  </div>
                  <textarea
                    value={htmlCode}
                    onChange={(e) => setHtmlCode(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full p-3 font-mono text-xs rounded-xl resize-none border select-text focus:outline-hidden"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                    placeholder={t('canvas_editor_placeholder', 'Entrez votre HTML, CSS, ou Javascript ici...')}
                  />
                </div>
              </div>

              {/* Right Column: Reactive Sandboxed Preview */}
              <div
                className="flex flex-col h-full p-4 overflow-hidden"
                style={{ backgroundColor: 'var(--surface-subtle)' }}
              >
                <div className="text-xs font-semibold mb-2 flex items-center justify-between" style={{ color: 'var(--muted)' }}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{t('canvas_live_preview', 'APERÇU EN DIRECT (IFRAME SANDBOXÉE)')}</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded font-mono border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--muted)' }}>
                    CSP: allow-scripts
                  </span>
                </div>
                <div className="flex-1 overflow-hidden flex flex-col rounded-2xl border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
                  <CanvasViewer
                    srcDoc={htmlCode}
                    title={docTitle}
                    initialHeight={420}
                    className="h-full flex-1"
                  />
                </div>
              </div>
            </div>
          ) : (
            /* Gallery Tab */
            <div className="h-full flex flex-col p-4 sm:p-6 overflow-hidden space-y-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs min-w-[240px]"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <Search className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <input
                    type="text"
                    placeholder={t('canvas_filter_placeholder', 'Rechercher un Canvas...')}
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="w-full bg-transparent focus:outline-hidden text-xs"
                    style={{ color: 'var(--text)' }}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={loadDocuments}
                    disabled={loading}
                    className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors cursor-pointer text-xs flex items-center gap-1.5"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                    title={t('refresh', 'Rafraîchir')}
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    <span className="hidden sm:inline">{t('refresh', 'Rafraîchir')}</span>
                  </button>
                  <button
                    onClick={() => setActiveTab('studio')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>{t('canvas_create_first', 'Nouveau Canvas')}</span>
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--muted)' }}>
                  {t('loading', 'Chargement des documents Canvas...')}
                </div>
              ) : filteredDocs.length === 0 ? (
                <div
                  className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed rounded-3xl"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-subtle)' }}
                >
                  <Layers className="w-10 h-10 mb-3 opacity-40 text-indigo-400" />
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--strong)' }}>{t('canvas_no_docs', 'Aucun Canvas trouvé')}</h3>
                  <p className="text-xs max-w-sm mt-1 mb-4" style={{ color: 'var(--muted)' }}>
                    {t('canvas_no_docs_hint', "Créez votre premier widget interactif dans le Studio ou demandez à l'agent d'en générer un.")}
                  </p>
                  <button
                    onClick={() => setActiveTab('studio')}
                    className="px-4 py-2 rounded-xl text-xs font-semibold border transition-all cursor-pointer"
                    style={{
                      backgroundColor: 'var(--accent-bg)',
                      borderColor: 'var(--accent)',
                      color: 'var(--accent-text)'
                    }}
                  >
                    {t('canvas_tab_studio', 'Créer dans le Studio')}
                  </button>
                </div>
              ) : (
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5 overflow-y-auto pr-1">
                  {filteredDocs.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDoc(item)}
                      className="group p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between hover:border-indigo-500/50"
                      style={{
                        backgroundColor: selectedDoc?.id === item.id ? 'var(--accent-bg)' : 'var(--surface-subtle)',
                        borderColor: selectedDoc?.id === item.id ? 'var(--accent)' : 'var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="text-sm font-semibold truncate" style={{ color: 'var(--strong)' }}>
                            {item.title || item.id}
                          </h4>
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-mono uppercase font-semibold border"
                            style={{
                              backgroundColor: 'var(--surface)',
                              borderColor: 'var(--border)',
                              color: 'var(--accent-text)'
                            }}
                          >
                            {item.kind.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-[11px] line-clamp-2" style={{ color: 'var(--muted)' }}>
                          ID: <code className="font-mono text-indigo-400">{item.id.slice(0, 16)}</code>
                        </p>
                      </div>

                      <div className="flex items-center justify-between pt-3 mt-3 border-t text-[11px]" style={{ borderColor: 'var(--border)' }}>
                        <span style={{ color: 'var(--muted)' }}>
                          {new Date(item.createdAt).toLocaleDateString()}
                        </span>
                        <div className="flex items-center gap-1">
                          <a
                            href={item.entryUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="p-1.5 rounded-lg border hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}
                            title={t('canvas_open_new_window', 'Ouvrir dans une nouvelle fenêtre')}
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={(e) => handleDeleteDocument(item.id, e)}
                            className="p-1.5 rounded-lg border border-rose-500/30 text-rose-400 hover:bg-rose-500/10 transition-colors"
                            title={t('delete', 'Supprimer')}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Preview modal drawer when item is selected */}
              {selectedDoc && (
                <div
                  className="p-4 rounded-2xl border flex flex-col space-y-3"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="w-4 h-4 text-indigo-400" />
                      <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                        {t('canvas_preview_prefix', 'Aperçu : {0}', selectedDoc.title || '')}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedDoc(null)}
                      className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 text-slate-400"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="h-[280px] rounded-xl overflow-hidden border border-white/5">
                    <CanvasViewer document={selectedDoc} initialHeight={280} />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="p-3 border-t flex items-center justify-between text-xs shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
            color: 'var(--muted)'
          }}
        >
          <div className="flex items-center gap-2">
            <Layers className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-[11px]">{t('canvas_footer_engine', 'Architecture Canvas Sandboxée Antigravity')}</span>
          </div>
          <span className="text-[10px] font-mono">{t('canvas_footer_widgets', 'Widgets Interactifs HTML / React')}</span>
        </div>
      </div>
    </div>
  );
};

export default CanvasStudioModal;
