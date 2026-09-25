import React, { useState, useEffect, useCallback } from 'react';
import { 
  Stethoscope, 
  X, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  Cpu, 
  Database, 
  GitBranch, 
  Globe, 
  Loader2,
  Wrench
} from 'lucide-react';
import { fetchSystemDiagnostics, executeDoctorRepair } from '../services/api';
import type { SystemDiagnosticsReport } from '../types';
import { showToast } from '../services/toast';
import { useI18n } from '../services/i18n';

interface SystemDoctorModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SystemDoctorModal: React.FC<SystemDoctorModalProps> = ({
  isOpen,
  onClose
}) => {
  const { t } = useI18n();
  const [report, setReport] = useState<SystemDiagnosticsReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<{ actions: string[] } | null>(null);

  const loadReport = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchSystemDiagnostics();
      setReport(data);
    } catch (e: any) {
      showToast(e.message || t('doctor_load_failed', 'Erreur lors du diagnostic'), 'error');
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (isOpen) {
      loadReport();
      setRepairResult(null);
    }
  }, [isOpen, loadReport]);

  const handleRunRepair = async () => {
    try {
      setRepairing(true);
      const res = await executeDoctorRepair();
      setRepairResult({ actions: res.actions_taken });
      setReport(res.post_repair_diagnostics);
      showToast(t('doctor_repair_success', 'Auto-Doctor : réparations appliquées avec succès !'), 'success');
    } catch (e: any) {
      showToast(e.message || t('doctor_repair_failed', 'Erreur lors de la réparation'), 'error');
    } finally {
      setRepairing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/75 backdrop-blur-md animate-in fade-in duration-200">
      <div 
        className="w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-emerald-500 to-teal-400 flex items-center justify-center text-white shadow-md">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {t('doctor_title', 'Diagnostics Système & Auto-Doctor')}
                </h2>
                {report && (
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                    report.health_status === 'healthy'
                      ? 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                      : report.health_status === 'warning'
                      ? 'bg-amber-500/15 text-amber-500 border border-amber-500/30'
                      : 'bg-rose-500/15 text-rose-500 border border-rose-500/30'
                  }`}>
                    {report.health_status}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {t('doctor_desc', 'Monitoring matériel, intégrité SQLite, statut Git et connectivité temps réel des API LLM')}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleRunRepair}
              disabled={repairing || loading}
              className="py-1.5 px-3 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {repairing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wrench className="w-3.5 h-3.5" />}
              <span>{repairing ? t('doctor_repairing', 'Réparation...') : t('doctor_run_repair_btn', 'Auto-Doctor')}</span>
            </button>
            <button
              type="button"
              onClick={loadReport}
              disabled={loading}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {loading && !report ? (
            <div className="flex flex-col items-center justify-center p-12 text-slate-400 space-y-2">
              <Loader2 className="w-6 h-6 animate-spin text-emerald-500" />
              <p className="text-xs">{t('doctor_audit_running', "Exécution de l'audit système complet...")}</p>
            </div>
          ) : report ? (
            <>
              {/* Repair Result Banner */}
              {repairResult && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center gap-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{t('doctor_actions_executed', 'Actions de réparation exécutées :')}</span>
                  </div>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                    {repairResult.actions.map((act, idx) => (
                      <li key={idx}>{act}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Anomalies alert if any */}
              {report.anomalies.length > 0 && (
                <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="w-4 h-4" />
                    <span>{t('doctor_points_attention', "Points d'attention détectés ({0})", report.anomalies.length)}</span>
                  </div>
                  <div className="space-y-1">
                    {report.anomalies.map((anom, idx) => (
                      <p key={idx} className="text-xs text-slate-700 dark:text-slate-300">
                        • {anom.message}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Grid 1: System Hardware Metrics */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5" /> {t('doctor_hardware_telemetry', 'Métriques Matérielles & Système')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* RAM */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Mémoire RAM</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{report.system.ram.percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          report.system.ram.percent > 90 ? 'bg-rose-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${report.system.ram.percent}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {report.system.ram.used_gb} Go utilisés / {report.system.ram.total_gb} Go ({report.system.ram.available_gb} Go libres)
                    </p>
                  </div>

                  {/* Disk */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Espace Disque</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{report.system.disk.used_percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${
                          report.system.disk.free_gb < 10 ? 'bg-rose-500' : 'bg-indigo-500'
                        }`}
                        style={{ width: `${report.system.disk.used_percent}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {report.system.disk.free_gb} Go disponibles sur {report.system.disk.total_gb} Go
                    </p>
                  </div>

                  {/* CPU */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>Processeur</span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{report.system.cpu_percent}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                      <div 
                        className="h-full rounded-full bg-cyan-500"
                        style={{ width: `${Math.max(5, report.system.cpu_percent)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {report.system.cpu_cores} cœurs logiques • {report.system.platform}
                    </p>
                  </div>
                </div>
              </div>

              {/* Grid 2: LLM Live Endpoints Latencies */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5" /> {t('doctor_llm_connectivity', 'Connectivité API LLM en Direct')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {report.llm_connectivity.map((llm) => {
                    const isOnline = llm.status === 'online';

                    return (
                      <div 
                        key={llm.name}
                        className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-xs text-slate-900 dark:text-slate-100">{llm.name}</span>
                          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-emerald-500' : 'bg-rose-500 animate-ping'}`} />
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-slate-500">{t('latency', 'Latence')}</span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {llm.latency_ms} ms
                          </span>
                        </div>
                        <p className="text-[10px] text-slate-400 truncate font-mono">
                          {llm.url}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Grid 3: Database & Runtimes */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <Database className="w-3.5 h-3.5" /> {t('doctor_data_integrity', 'Intégrité Données & Environnements')}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* SQLite */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <Database className="w-4 h-4 text-indigo-500" /> {t('doctor_sqlite_db', 'Base de Données SQLite')}
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold ${
                        report.database.integrity === 'ok' 
                          ? 'bg-emerald-500/15 text-emerald-500' 
                          : 'bg-rose-500/15 text-rose-500'
                      }`}>
                        {report.database.integrity === 'ok' ? t('status_ok', 'Intègre') : t('status_error', 'Erreur')}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Taille disque : {report.database.size_mb} Mo • Index FTS5 : {report.database.fts5.total_indexed_rows} messages ({report.database.fts5.indexed_sessions} sessions)
                    </p>
                  </div>

                  {/* Git & Python */}
                  <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                        <GitBranch className="w-4 h-4 text-purple-500" /> {t('doctor_git_python', 'Git & Environnement Python')}
                      </span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-500 font-bold">
                        {report.runtimes.git.branch || 'main'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Python {report.runtimes.python.version} ({report.runtimes.python.is_venv ? 'venv actif' : 'système'}) • Fichiers modifiés Git : {report.runtimes.git.dirty_files}
                    </p>
                  </div>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
};
