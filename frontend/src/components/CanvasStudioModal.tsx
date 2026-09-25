import React, { useState, useEffect } from 'react';
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
  Search
} from 'lucide-react';
import { canvasApi } from '../services/api';
import CanvasViewer from './CanvasViewer';
import type { CanvasDocumentManifest } from '../types';

interface CanvasStudioModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialDocId?: string;
}

const TEMPLATES: Record<string, { title: string; html: string }> = {
  kpi_dashboard: {
    title: 'KPI Performance Dashboard',
    html: `<div style="padding: 24px; font-family: var(--font-body);">
  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
    <div>
      <h2 style="margin: 0; font-size: 18px; color: var(--text-strong);">System Overview</h2>
      <p style="margin: 4px 0 0; font-size: 12px; color: var(--muted);">Real-time telemetry and throughput</p>
    </div>
    <span style="font-size: 11px; padding: 4px 8px; border-radius: 9999px; background: var(--ok-subtle, rgba(34,197,94,0.15)); color: var(--ok);">Operational</span>
  </div>

  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px;">
    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
      <div style="font-size: 12px; color: var(--muted);">Total Requests</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong);">148,290</div>
      <div style="font-size: 11px; color: var(--ok); margin-top: 4px;">↑ +14.2% today</div>
    </div>
    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
      <div style="font-size: 12px; color: var(--muted);">Avg Latency</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong);">28.4 ms</div>
      <div style="font-size: 11px; color: var(--ok); margin-top: 4px;">↓ -4.1 ms faster</div>
    </div>
    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
      <div style="font-size: 12px; color: var(--muted);">Success Rate</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong);">99.94%</div>
      <div style="font-size: 11px; color: var(--ok); margin-top: 4px;">Target: 99.9%</div>
    </div>
    <div style="background: var(--card); border: 1px solid var(--border); border-radius: var(--radius); padding: 16px;">
      <div style="font-size: 12px; color: var(--muted);">Active Worktrees</div>
      <div style="font-size: 24px; font-weight: 700; margin-top: 4px; color: var(--text-strong);">4 Subagents</div>
      <div style="font-size: 11px; color: var(--accent); margin-top: 4px;">Isolated & Healthy</div>
    </div>
  </div>
</div>`
  },
  data_table: {
    title: 'Interactive Filterable Table',
    html: `<div style="padding: 20px; font-family: var(--font-body);">
  <div style="margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center;">
    <h3 style="margin: 0; font-size: 16px; color: var(--text-strong);">Recent Deployments</h3>
    <input type="text" id="search" placeholder="Filter rows..." style="padding: 6px 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--card); color: var(--text); font-size: 12px;" />
  </div>
  <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: left;">
    <thead>
      <tr style="border-bottom: 2px solid var(--border); color: var(--muted);">
        <th style="padding: 8px 12px;">Service</th>
        <th style="padding: 8px 12px;">Commit</th>
        <th style="padding: 8px 12px;">Status</th>
        <th style="padding: 8px 12px;">Time</th>
      </tr>
    </thead>
    <tbody id="rows">
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: 600;">webui-frontend</td>
        <td style="padding: 8px 12px; font-family: var(--font-mono); color: var(--accent);">a8f23b1</td>
        <td style="padding: 8px 12px; color: var(--ok);">Active</td>
        <td style="padding: 8px 12px; color: var(--muted);">2m ago</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: 600;">antigravity-kernel</td>
        <td style="padding: 8px 12px; font-family: var(--font-mono); color: var(--accent);">c491e0a</td>
        <td style="padding: 8px 12px; color: var(--ok);">Active</td>
        <td style="padding: 8px 12px; color: var(--muted);">14m ago</td>
      </tr>
      <tr style="border-bottom: 1px solid var(--border);">
        <td style="padding: 8px 12px; font-weight: 600;">messaging-gateway</td>
        <td style="padding: 8px 12px; font-family: var(--font-mono); color: var(--accent);">e73da94</td>
        <td style="padding: 8px 12px; color: var(--ok);">Active</td>
        <td style="padding: 8px 12px; color: var(--muted);">1h ago</td>
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
    html: `<div style="padding: 24px; font-family: var(--font-body);">
  <h3 style="margin: 0 0 16px; font-size: 16px; color: var(--text-strong);">Weekly Request Volume</h3>
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
      type: 'bar',
      data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        datasets: [{
          label: 'Requests (k)',
          data: [65, 82, 104, 115, 98, 74, 53],
          backgroundColor: 'rgba(99, 102, 241, 0.75)',
          borderColor: '#6366f1',
          borderWidth: 1,
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
          x: { grid: { display: false } }
        }
      }
    });
  });
</script>`
  },
};

export const CanvasStudioModal: React.FC<CanvasStudioModalProps> = ({
  isOpen,
  onClose,
  initialDocId,
}) => {
  const [activeTab, setActiveTab] = useState<'studio' | 'gallery'>('studio');
  const [htmlCode, setHtmlCode] = useState<string>(TEMPLATES.kpi_dashboard.html);
  const [docTitle, setDocTitle] = useState<string>(TEMPLATES.kpi_dashboard.title);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('kpi_dashboard');
  const [documents, setDocuments] = useState<CanvasDocumentManifest[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<CanvasDocumentManifest | null>(null);

  // Load documents list
  const loadDocuments = async () => {
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
    } catch (err) {
      console.error('Failed to load canvas documents:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDocuments();
    }
  }, [isOpen]);

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
      setTimeout(() => setSavedSuccess(false), 2500);
      await loadDocuments();
      setSelectedDoc(manifest);
    } catch (err) {
      console.error('Failed to save canvas document:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteDocument = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Supprimer définitivement ce Canvas ?')) return;
    try {
      await canvasApi.deleteDocument(id);
      if (selectedDoc?.id === id) {
        setSelectedDoc(null);
      }
      await loadDocuments();
    } catch (err) {
      console.error('Failed to delete canvas document:', err);
    }
  };

  if (!isOpen) return null;

  const filteredDocs = documents.filter((d) =>
    (d.title || d.id).toLowerCase().includes(filterQuery.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-6xl h-[88vh] bg-card border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-scale-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border/80 bg-muted/20">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-accent/15 text-accent">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
                Canvas Vivant & Documents Interactifs
                <span className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent font-normal">
                  v0.3.0
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Widgets React/HTML isolés dans iframe sandboxed avec bridge de thème et auto-resize
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex bg-muted/60 p-1 rounded-xl text-xs font-medium">
              <button
                onClick={() => setActiveTab('studio')}
                className={`px-3 py-1.5 rounded-lg transition-all ${
                  activeTab === 'studio'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Studio Interactif
              </button>
              <button
                onClick={() => setActiveTab('gallery')}
                className={`px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
                  activeTab === 'gallery'
                    ? 'bg-card text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Galerie ({documents.length})
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-muted text-muted-foreground hover:text-foreground transition-colors ml-2"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'studio' ? (
            <div className="h-full grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border">
              {/* Left Column: Code Editor & Controls */}
              <div className="flex flex-col h-full overflow-hidden bg-card">
                {/* Editor Toolbar */}
                <div className="p-4 border-b border-border/70 flex flex-wrap items-center justify-between gap-3 bg-muted/10">
                  <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                    <input
                      type="text"
                      value={docTitle}
                      onChange={(e) => setDocTitle(e.target.value)}
                      placeholder="Titre du widget..."
                      className="w-full px-3 py-1.5 bg-background border border-border rounded-lg text-xs font-medium text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <select
                      value={selectedTemplate}
                      onChange={(e) => handleTemplateChange(e.target.value)}
                      className="px-2.5 py-1.5 bg-background border border-border rounded-lg text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      <option value="kpi_dashboard">KPI Dashboard</option>
                      <option value="data_table">Tableau Filtrable</option>
                      <option value="chart_js">Chart.js Graphique</option>
                    </select>

                    <button
                      onClick={handleSaveDocument}
                      disabled={saving}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
                    >
                      {savedSuccess ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          Sauvegardé !
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          {saving ? 'Enregistrement...' : 'Sauvegarder'}
                        </>
                      )}
                    </button>
                  </div>
                </div>

                {/* HTML Textarea */}
                <div className="flex-1 p-3 overflow-hidden flex flex-col">
                  <div className="text-[11px] text-muted-foreground font-mono mb-2 flex items-center justify-between">
                    <span>CODE HTML / JS EMBARQUÉ</span>
                    <span className="text-[10px] text-accent/80">Supporte styles CSS variables & postMessage</span>
                  </div>
                  <textarea
                    value={htmlCode}
                    onChange={(e) => setHtmlCode(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full p-3 font-mono text-xs bg-muted/20 border border-border rounded-xl resize-none text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                    placeholder="Entrez votre HTML, CSS, ou Javascript ici..."
                  />
                </div>
              </div>

              {/* Right Column: Reactive Sandboxed Preview */}
              <div className="flex flex-col h-full p-4 overflow-hidden bg-muted/10">
                <div className="text-xs font-semibold text-muted-foreground mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-accent" />
                    <span>APERÇU EN DIRECT (IFRAME SANDBOXÉE)</span>
                  </div>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-mono">
                    CSP: allow-scripts
                  </span>
                </div>
                <div className="flex-1 overflow-hidden flex flex-col">
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
            <div className="h-full flex flex-col p-6 overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <div className="relative w-72">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Rechercher un Canvas..."
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 bg-background border border-border rounded-xl text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                  />
                </div>

                <button
                  onClick={() => setActiveTab('studio')}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Nouveau Canvas
                </button>
              </div>

              {loading ? (
                <div className="flex-1 flex items-center justify-center text-xs text-muted-foreground">
                  Chargement des documents Canvas...
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border border-dashed border-border rounded-2xl">
                  <Layers className="w-10 h-10 text-muted-foreground/40 mb-3" />
                  <h3 className="text-sm font-semibold text-foreground">Aucun Canvas trouvé</h3>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-4">
                    Créez votre premier widget interactif dans le Studio ou demandez à l'agent d'en générer un.
                  </p>
                  <button
                    onClick={() => setActiveTab('studio')}
                    className="px-4 py-2 rounded-xl bg-accent text-accent-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    Créer dans le Studio
                  </button>
                </div>
              ) : (
                <div className="flex-1 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pr-1">
                  {filteredDocs.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => setSelectedDoc(item)}
                      className={`group p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                        selectedDoc?.id === item.id
                          ? 'border-accent bg-accent/5 ring-1 ring-accent/40 shadow-sm'
                          : 'border-border bg-card hover:border-accent/40 hover:bg-muted/10'
                      }`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <h4 className="text-sm font-semibold text-foreground truncate">
                            {item.title || item.id}
                          </h4>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-mono uppercase">
                            {item.kind.replace('_', ' ')}
                          </span>
                        </div>
                        <p className="text-xs font-mono text-muted-foreground truncate mb-3">
                          ID: {item.id}
                        </p>
                      </div>

                      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-3 border-t border-border/60">
                        <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                        <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                          <button
                            onClick={(e) => handleDeleteDocument(item.id, e)}
                            title="Supprimer"
                            className="p-1 rounded hover:bg-destructive/15 hover:text-destructive transition-colors text-muted-foreground"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <a
                            href={canvasApi.getServeUrl(item.id, item.localEntrypoint || 'index.html')}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            title="Ouvrir dans un nouvel onglet"
                            className="p-1 rounded hover:bg-muted hover:text-foreground transition-colors text-muted-foreground"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Selected Canvas Preview Drawer / Modal */}
              {selectedDoc && (
                <div className="mt-4 pt-4 border-t border-border flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-foreground">
                      Aperçu sélectionné : <span className="font-semibold">{selectedDoc.title || selectedDoc.id}</span>
                    </span>
                    <button
                      onClick={() => setSelectedDoc(null)}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      Fermer l'aperçu
                    </button>
                  </div>
                  <CanvasViewer
                    document={selectedDoc}
                    initialHeight={300}
                    className="w-full"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CanvasStudioModal;
