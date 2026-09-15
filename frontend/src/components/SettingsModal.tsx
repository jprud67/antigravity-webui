import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  Settings as SettingsIcon, 
  Cpu, 
  Shield, 
  Save, 
  Check, 
  Plus, 
  Trash2, 
  Lock, 
  Unlock, 
  Boxes, 
  KeyRound, 
  ShieldCheck, 
  ChevronRight, 
  ChevronLeft,
  BookOpen,
  Palette,
  Globe,
  ExternalLink,
  RefreshCw,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  Terminal,
  Type,
  MessageSquare,
  Download,
  Upload,
  Pin,
  Archive,
  Tag,
  Folder,
  FileText,
  Keyboard,
  RotateCcw
} from 'lucide-react';
import type { AppSettings, ModelOption, Conversation } from '../types';
import { 
  fetchSettings, 
  saveSettings, 
  fetchSkills, 
  fetchSkillDetail, 
  updatePassword,
  fetchGoogleAccounts,
  switchGoogleAccount,
  deleteGoogleAccount,
  startGoogleLogin,
  submitGoogleAuthCode,
  cancelGoogleLogin,
  updateConversationMetadata,
  deleteConversation,
  exportConversationMarkdown,
  exportConversationJSON,
  importConversation,
  fetchSystemVersion,
  checkSystemUpdate,
  applySystemUpdate,
  type GoogleAccountInfo,
  type GoogleAccountsResponse,
  type SystemVersionInfo,
  type UpdateCheckResult
} from '../services/api';
import { 
  AVAILABLE_THEMES, 
  AVAILABLE_SKINS, 
  getStoredTheme, 
  getStoredSkin, 
  applyAppearance, 
  getStoredFontSize, 
  setFontSize, 
  type ThemeMode, 
  type FontSizeOption 
} from '../services/theme';
import { useI18n, SUPPORTED_LANGUAGES } from '../services/i18n';
import { showConfirm } from './AppDialog';
import { showToast } from './Toast';

export const GoogleIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24">
    <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z"/>
    <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.34 24 12 24z"/>
    <path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"/>
    <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.34 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"/>
  </svg>
);

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  models: ModelOption[];
  currentModel: string;
  onModelSaved: (modelId: string) => void;
  initialTab?: 'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages' | 'google' | 'conversation' | 'updates';
  onGoogleAccountChanged?: (account: GoogleAccountInfo | null) => void;
  activeConversation?: Conversation | null;
  onClearHistory?: () => void;
  onDeleteConversation?: (convId: string) => void;
  onConversationUpdated?: () => void;
}

const MODEL_DESCRIPTIONS: Record<string, { desc: string; badge: string; iconColor: string }> = {
  'gemini-3.8-flash': { desc: 'Ultra-rapide, performant et polyvalent. Idéal pour le développement quotidien.', badge: 'Recommandé', iconColor: 'text-sky-400 bg-sky-500/10 border-sky-500/30' },
  'gemini-3.7-flash': { desc: 'Génération de code rapide et robuste avec bon raisonnement.', badge: 'Rapide', iconColor: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30' },
  'gemini-3.6-flash': { desc: 'Modèle léger et très réactif pour les tâches simples.', badge: 'Léger', iconColor: 'text-teal-400 bg-teal-500/10 border-teal-500/30' },
  'gemini-3.1-pro': { desc: 'Raisonnement profond pour architectures complexes et gros refactoring.', badge: 'Expert', iconColor: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' },
  'claude-sonnet-4-6': { desc: 'Excellence en analyse de code et raisonnement Thinking natif.', badge: 'Thinking', iconColor: 'text-purple-400 bg-purple-500/10 border-purple-500/30' },
  'claude-opus-4-6-thinking': { desc: 'Capacités maximales de réflexion pour les problèmes algorithmiques pointus.', badge: 'Premium', iconColor: 'text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30' },
  'gpt-oss-120b': { desc: 'Modèle open-weights haute performance 120B.', badge: 'Open-OSS', iconColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' },
};

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  models,
  currentModel,
  onModelSaved,
  initialTab,
  onGoogleAccountChanged,
  activeConversation,
  onClearHistory,
  onDeleteConversation,
  onConversationUpdated
}) => {
  const { lang, setLanguage } = useI18n();
  const [activeTab, setActiveTab] = useState<'models' | 'permissions' | 'skills' | 'security' | 'appearance' | 'languages' | 'google' | 'conversation' | 'updates'>(initialTab || 'models');
  const [settings, setSettings] = useState<AppSettings>({});
  const [selectedModelId, setSelectedModelId] = useState(currentModel);
  const [selectedEffort, setSelectedEffort] = useState<'low' | 'medium' | 'high'>('high');
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>(getStoredTheme());
  const [currentSkin, setCurrentSkin] = useState<string>(getStoredSkin());
  const [currentFontSize, setCurrentFontSize] = useState<FontSizeOption>(getStoredFontSize());
  const [saving, setSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  // System Update state (Hermes architecture)
  const [systemVersion, setSystemVersion] = useState<SystemVersionInfo | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [applyingUpdate, setApplyingUpdate] = useState(false);
  const [updateProgressMsg, setUpdateProgressMsg] = useState<string | null>(null);

  // Conversation state
  const CONV_PALETTE = ['#0ea5e9', '#10b981', '#f59e0b', '#f43f5e', '#6366f1', '#a855f7', '#ec4899', '#06b6d4'];
  const [convTitle, setConvTitle] = useState('');
  const [convProject, setConvProject] = useState('');
  const [convProjectColor, setConvProjectColor] = useState(CONV_PALETTE[0]);
  const [convTagsStr, setConvTagsStr] = useState('');
  const [convPinned, setConvPinned] = useState(false);
  const [convArchived, setConvArchived] = useState(false);
  const [convSaving, setConvSaving] = useState(false);
  const [convExporting, setConvExporting] = useState(false);
  const convFileInputRef = useRef<HTMLInputElement>(null);

  // Send key mode
  const [sendKeyMode, setSendKeyMode] = useState<'enter' | 'ctrlEnter'>(() => {
    return (typeof window !== 'undefined' && localStorage.getItem('antigravity_send_key') === 'ctrlEnter') ? 'ctrlEnter' : 'enter';
  });

  const handleSetSendKeyMode = (mode: 'enter' | 'ctrlEnter') => {
    setSendKeyMode(mode);
    if (typeof window !== 'undefined') {
      localStorage.setItem('antigravity_send_key', mode);
    }
    showToast(`Raccourci d'envoi réglé sur : ${mode === 'ctrlEnter' ? 'Ctrl/Cmd+Entrée' : 'Entrée'}`, 'info');
  };

  useEffect(() => {
    if (activeConversation) {
      setConvTitle(activeConversation.customTitle || activeConversation.title || '');
      setConvProject(activeConversation.project || '');
      setConvProjectColor(activeConversation.projectColor || CONV_PALETTE[0]);
      setConvTagsStr((activeConversation.tags || []).join(', '));
      setConvPinned(!!activeConversation.pinned);
      setConvArchived(!!activeConversation.archived);
    } else {
      setConvTitle('');
      setConvProject('');
      setConvProjectColor(CONV_PALETTE[0]);
      setConvTagsStr('');
      setConvPinned(false);
      setConvArchived(false);
    }
  }, [activeConversation, activeTab, isOpen]);

  const handleSaveConvMeta = async () => {
    if (!activeConversation) return;
    setConvSaving(true);
    try {
      const parsedTags = convTagsStr
        .split(',')
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);

      await updateConversationMetadata(activeConversation.conversation_id, {
        customTitle: convTitle.trim(),
        project: convProject.trim(),
        projectColor: convProjectColor,
        tags: parsedTags,
        pinned: convPinned,
        archived: convArchived
      });
      if (onConversationUpdated) {
        onConversationUpdated();
      }
      showToast('Métadonnées de la session enregistrées.', 'success');
    } catch (e: any) {
      showToast(`Erreur enregistrement : ${e.message}`, 'error');
    } finally {
      setConvSaving(false);
    }
  };

  const handleExportConv = async (format: 'markdown' | 'json') => {
    if (!activeConversation) return;
    setConvExporting(true);
    try {
      if (format === 'markdown') {
        const blob = await exportConversationMarkdown(activeConversation.conversation_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${activeConversation.conversation_id.slice(0, 8)}.md`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const blob = await exportConversationJSON(activeConversation.conversation_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `session_${activeConversation.conversation_id.slice(0, 8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
      showToast(`Export ${format.toUpperCase()} téléchargé`, 'success');
    } catch (e: any) {
      showToast(`Erreur export : ${e.message}`, 'error');
    } finally {
      setConvExporting(false);
    }
  };

  const handleImportFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const res = await importConversation(payload);
      showToast(`Session "${res.title}" importée avec succès !`, 'success');
      if (onConversationUpdated) {
        onConversationUpdated();
      }
    } catch (err: any) {
      showToast(`Erreur lors de l'import : ${err.message}`, 'error');
    } finally {
      if (convFileInputRef.current) {
        convFileInputRef.current.value = '';
      }
    }
  };

  const handleClearChatHistory = async () => {
    if (!activeConversation) return;
    const ok = await showConfirm({
      title: 'Effacer l\'historique',
      message: 'Voulez-vous vraiment effacer tous les messages de la conversation active ?',
      confirmText: 'Effacer',
      destructive: true
    });
    if (ok) {
      if (onClearHistory) onClearHistory();
      showToast('Historique des messages effacé.', 'success');
      onClose();
    }
  };

  const loadUpdateInfo = async (force: boolean = false) => {
    setCheckingUpdate(true);
    try {
      const [ver, upd] = await Promise.all([
        fetchSystemVersion(),
        checkSystemUpdate(force)
      ]);
      setSystemVersion(ver);
      setUpdateCheck(upd);
      if (force) {
        if (upd.update_available) {
          showToast(`Mise à jour disponible : ${upd.behind} nouveau(x) commit(s)`, 'info');
        } else {
          showToast('Antigravity WebUI est parfaitement à jour !', 'success');
        }
      }
    } catch (err: any) {
      showToast(`Erreur lors de la vérification : ${err.message}`, 'error');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleTriggerApplyUpdate = async () => {
    const ok = await showConfirm({
      title: 'Mettre à jour Antigravity WebUI',
      message: 'Voulez-vous installer la mise à jour depuis GitHub (origin/main) ? Le serveur récupérera les modifications, recompilera le frontend et redémarrera automatiquement le service.',
      confirmText: 'Installer la mise à jour',
      destructive: false
    });
    if (!ok) return;

    setApplyingUpdate(true);
    setUpdateProgressMsg('Téléchargement des modifications depuis GitHub et compilation...');
    try {
      const res = await applySystemUpdate();
      setUpdateProgressMsg(res.message || 'Mise à jour réussie ! Redémarrage du serveur...');
      showToast('Mise à jour appliquée avec succès ! Rechargement...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 4000);
    } catch (err: any) {
      showToast(`Échec de la mise à jour : ${err.message}`, 'error');
      setUpdateProgressMsg(null);
    } finally {
      setApplyingUpdate(false);
    }
  };

  const handleDeleteActiveConv = async () => {
    if (!activeConversation) return;
    const ok = await showConfirm({
      title: 'Supprimer la session',
      message: `Supprimer définitivement la session "${convTitle || activeConversation.title || activeConversation.conversation_id.slice(0, 8)}" ? Cette action est irréversible.`,
      confirmText: 'Supprimer définitivement',
      destructive: true
    });
    if (ok) {
      try {
        await deleteConversation(activeConversation.conversation_id);
        showToast('Session supprimée.', 'success');
        if (onDeleteConversation) onDeleteConversation(activeConversation.conversation_id);
        if (onConversationUpdated) onConversationUpdated();
        onClose();
      } catch (e: any) {
        showToast(`Erreur lors de la suppression : ${e.message}`, 'error');
      }
    }
  };

  // Permission rules state
  const [allowRules, setAllowRules] = useState<string[]>([]);
  const [newRuleType, setNewRuleType] = useState<string>('command');
  const [newRuleValue, setNewRuleValue] = useState<string>('*');

  // Skills state
  const [skills, setSkills] = useState<any[]>([]);
  const [selectedSkill, setSelectedSkill] = useState<any | null>(null);
  const [skillsLoading, setSkillsLoading] = useState(false);

  // Security state
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwdLoading, setPwdLoading] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState(false);

  // Google accounts state
  const [googleData, setGoogleData] = useState<GoogleAccountsResponse | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleSwitching, setGoogleSwitching] = useState<string | null>(null);
  const [googleLoginSession, setGoogleLoginSession] = useState<{ sessionId: string; authUrl: string } | null>(null);
  const [googleAuthCode, setGoogleAuthCode] = useState('');
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [googleSuccess, setGoogleSuccess] = useState<string | null>(null);

  // Horizontal tabs scroll management
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const checkTabsScroll = () => {
    const el = tabsContainerRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 6);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 6);
  };

  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(checkTabsScroll, 120);
      window.addEventListener('resize', checkTabsScroll);
      return () => {
        clearTimeout(timer);
        window.removeEventListener('resize', checkTabsScroll);
      };
    }
  }, [isOpen, activeTab]);

  const handleScrollTabs = (direction: 'left' | 'right') => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const distance = 200;
    el.scrollBy({
      left: direction === 'left' ? -distance : distance,
      behavior: 'smooth'
    });
    setTimeout(checkTabsScroll, 250);
  };

  const handleTabClick = (tab: typeof activeTab, e: React.MouseEvent<HTMLButtonElement>) => {
    setActiveTab(tab);
    e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  const loadGoogleAccounts = async () => {
    setGoogleLoading(true);
    try {
      const data = await fetchGoogleAccounts();
      setGoogleData(data);
      if (onGoogleAccountChanged) {
        onGoogleAccountChanged(data.active_account);
      }
    } catch (e: any) {
      console.error('Failed to load Google accounts:', e);
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSwitchGoogleAccount = async (email: string) => {
    setGoogleSwitching(email);
    setGoogleError(null);
    try {
      const res = await switchGoogleAccount(email);
      setGoogleSuccess(`Compte Google basculé sur ${email}`);
      await loadGoogleAccounts();
      if (onGoogleAccountChanged) {
        onGoogleAccountChanged(res.active_account);
      }
      setTimeout(() => setGoogleSuccess(null), 3000);
    } catch (e: any) {
      setGoogleError(e.message || 'Erreur lors du changement de compte');
    } finally {
      setGoogleSwitching(null);
    }
  };

  const handleDeleteGoogleAccount = async (email: string) => {
    if (!(await showConfirm(`Supprimer le compte ${email} des comptes enregistrés ?`, { destructive: true }))) return;
    try {
      await deleteGoogleAccount(email);
      await loadGoogleAccounts();
    } catch (e: any) {
      setGoogleError(e.message || 'Erreur suppression compte');
    }
  };

  const handleStartGoogleLogin = async () => {
    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const res = await startGoogleLogin();
      setGoogleLoginSession({ sessionId: res.session_id, authUrl: res.auth_url });
    } catch (e: any) {
      setGoogleError(e.message || 'Impossible de démarrer la session de connexion');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleSubmitGoogleCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleLoginSession || !googleAuthCode.trim()) return;
    setGoogleSubmitting(true);
    setGoogleError(null);
    try {
      const res = await submitGoogleAuthCode(googleLoginSession.sessionId, googleAuthCode.trim());
      setGoogleSuccess(res.message || 'Nouveau compte Google connecté avec succès !');
      setGoogleLoginSession(null);
      setGoogleAuthCode('');
      await loadGoogleAccounts();
      if (onGoogleAccountChanged) {
        onGoogleAccountChanged(res.active_account);
      }
      setTimeout(() => setGoogleSuccess(null), 4000);
    } catch (e: any) {
      setGoogleError(e.message || 'Code invalide ou expiré');
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const handleCancelGoogleLogin = async () => {
    if (googleLoginSession) {
      await cancelGoogleLogin(googleLoginSession.sessionId).catch(() => {});
      setGoogleLoginSession(null);
      setGoogleAuthCode('');
      loadGoogleAccounts();
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialTab) {
        setActiveTab(initialTab);
      }
      setSelectedModelId(currentModel);
      fetchSettings().then((s) => {
        setSettings(s);
        if (s.model) {
          const match = models.find(
            (m) =>
              m.name === s.model ||
              m.id === s.model ||
              (s.model ? s.model.includes(m.name) || s.model.includes(m.id) : false)
          );
          if (match) {
            setSelectedModelId(match.id);
            const lowerModel = s.model.toLowerCase();
            if (lowerModel.includes('low')) setSelectedEffort('low');
            else if (lowerModel.includes('medium') || lowerModel.includes('med')) setSelectedEffort('medium');
            else setSelectedEffort((match.default_effort as any) || 'high');
          }
        }
        if (s.permissions?.allow) {
          setAllowRules(s.permissions.allow);
        }
      });

      // Load skills
      setSkillsLoading(true);
      fetchSkills()
        .then((items) => setSkills(items))
        .catch((err) => console.error('Error loading skills:', err))
        .finally(() => setSkillsLoading(false));

      // Load Google accounts
      loadGoogleAccounts();
    }
  }, [isOpen, currentModel, models]);

  const activeModelObj = models.find((m) => m.id === selectedModelId);
  const supportedEfforts = activeModelObj ? activeModelObj.supported_efforts : [];

  const handleSelectModel = (modelId: string) => {
    setSelectedModelId(modelId);
    const found = models.find((m) => m.id === modelId);
    if (found && found.default_effort) {
      setSelectedEffort(found.default_effort as any);
    }
  };

  const applyProfile = (profile: 'full' | 'standard' | 'strict') => {
    if (profile === 'full') {
      setAllowRules(['command(*)', 'write_file(/)', 'read_file(/)', 'read_url(*)']);
    } else if (profile === 'standard') {
      setAllowRules(['command(git *)', 'command(npm *)', 'write_file(/root/workspace/*)', 'read_file(/root/*)', 'read_url(*)']);
    } else if (profile === 'strict') {
      setAllowRules(['read_file(/root/*)', 'read_url(*)']);
    }
  };

  const toggleDirectRule = (ruleToToggle: string) => {
    if (allowRules.includes(ruleToToggle)) {
      setAllowRules(allowRules.filter((r) => r !== ruleToToggle));
    } else {
      setAllowRules([...allowRules, ruleToToggle]);
    }
  };

  const removeRule = (rule: string) => {
    setAllowRules(allowRules.filter((r) => r !== rule));
  };

  const addCustomRule = () => {
    if (!newRuleValue.trim()) return;
    const ruleString = `${newRuleType}(${newRuleValue.trim()})`;
    if (!allowRules.includes(ruleString)) {
      setAllowRules([...allowRules, ruleString]);
    }
    setNewRuleValue('*');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const match = models.find((m) => m.id === selectedModelId);
      const concreteModelName = match?.name || selectedModelId;

      const updatedSettings = {
        ...settings,
        model: concreteModelName,
        permissions: {
          ...settings.permissions,
          allow: allowRules
        }
      };

      const updated = await saveSettings(updatedSettings);
      setSettings(updated);
      onModelSaved(selectedModelId);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setPwdError('Les mots de passe ne correspondent pas');
      return;
    }
    if (newPassword.length < 4) {
      setPwdError('Le mot de passe doit faire au moins 4 caractères');
      return;
    }

    setPwdLoading(true);
    setPwdError(null);
    try {
      await updatePassword(oldPassword, newPassword);
      setPwdSuccess(true);
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPwdSuccess(false), 3000);
    } catch (err: any) {
      setPwdError(err.message || 'Erreur lors du changement de mot de passe');
    } finally {
      setPwdLoading(false);
    }
  };

  const viewSkillDetail = async (skill: any) => {
    try {
      const detail = await fetchSkillDetail(skill.id);
      setSelectedSkill(detail);
    } catch (e) {
      setSelectedSkill(skill);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-fadeIn p-2 sm:p-4">
      <div
        className="w-[780px] max-w-full max-h-[96dvh] sm:max-h-[90vh] rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col border"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Header */}
        <div
          className="px-4 sm:px-6 py-3.5 sm:py-4 border-b flex items-center justify-between shrink-0 safe-pt"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 shrink-0">
              <SettingsIcon className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold tracking-tight truncate" style={{ color: 'var(--strong)' }}>Configuration Antigravity</h2>
              <p className="text-[11px] truncate" style={{ color: 'var(--muted)' }}>Modèles d'intelligence, permissions, skills et sécurité</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl transition-colors cursor-pointer hover:bg-black/5 dark:hover:bg-white/5 shrink-0 ml-1"
            style={{ color: 'var(--muted)' }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs with Horizontal Scroll & Quick Navigation Controls */}
        <div
          className="relative flex items-center border-b shrink-0 select-none group/tabs"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          {/* Scroll Left Button */}
          {canScrollLeft && (
            <button
              type="button"
              onClick={() => handleScrollTabs('left')}
              className="absolute left-0 z-20 h-full px-1.5 flex items-center justify-center transition-all cursor-pointer shadow-md animate-fadeIn backdrop-blur-md"
              style={{
                background: 'linear-gradient(to right, var(--surface-subtle) 75%, transparent)',
                color: 'var(--text)'
              }}
              title="Défiler vers la gauche"
            >
              <span
                className="p-1 rounded-lg border flex items-center justify-center shadow-xs hover:scale-105 transition-transform"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border2)',
                  color: 'var(--accent-text)'
                }}
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </span>
            </button>
          )}

          <div
            ref={tabsContainerRef}
            onScroll={checkTabsScroll}
            className="flex px-3 sm:px-6 gap-2 shrink-0 overflow-x-auto tabs-horizontal-scroll scroll-smooth w-full py-0.5"
          >
            <button
              onClick={(e) => handleTabClick('conversation', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'conversation'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>Session & Export</span>
              {activeConversation && (
                <span className="text-[10px] bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/30 px-1.5 py-0.2 rounded-full font-mono max-w-[100px] truncate">
                  {activeConversation.customTitle || activeConversation.title || activeConversation.conversation_id.slice(0, 6)}
                </span>
              )}
            </button>

            <button
              onClick={(e) => handleTabClick('models', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'models'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Cpu className="w-4 h-4" />
              <span>Modèles & Raisonnement</span>
            </button>

            <button
              onClick={(e) => {
                handleTabClick('google', e);
                loadGoogleAccounts();
              }}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'google'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <GoogleIcon className="w-4 h-4" />
              <span>Compte Google</span>
              {googleData?.active_account && (
                <span className="text-[10px] bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/30 px-1.5 py-0.2 rounded-full font-mono max-w-[120px] truncate">
                  {googleData.active_account.email.split('@')[0]}
                </span>
              )}
            </button>

            <button
              onClick={(e) => handleTabClick('permissions', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'permissions'
                  ? 'border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Règles de Permissions</span>
              <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-800/60 px-1.5 py-0.2 rounded-full font-mono font-bold">
                {allowRules.length}
              </span>
            </button>

            <button
              onClick={(e) => handleTabClick('skills', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'skills'
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>Skills ({skills.length})</span>
            </button>

            <button
              onClick={(e) => handleTabClick('security', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'security'
                  ? 'border-amber-500 text-amber-600 dark:text-amber-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <KeyRound className="w-4 h-4" />
              <span>Sécurité & Accès</span>
            </button>

            <button
              onClick={(e) => handleTabClick('appearance', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'appearance'
                  ? 'border-purple-500 text-purple-600 dark:text-purple-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Palette className="w-4 h-4" />
              <span>Apparence & Thèmes</span>
            </button>

            <button
              onClick={(e) => handleTabClick('languages', e)}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'languages'
                  ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <Globe className="w-4 h-4" />
              <span>Langues ({SUPPORTED_LANGUAGES.find(l => l.code === lang)?.flag || '🌐'})</span>
            </button>

            <button
              onClick={(e) => {
                handleTabClick('updates', e);
                loadUpdateInfo(false);
              }}
              className={`py-3 px-3 text-xs font-semibold flex items-center gap-1.5 border-b-2 transition-all cursor-pointer shrink-0 ${
                activeTab === 'updates'
                  ? 'border-sky-500 text-sky-600 dark:text-sky-400 font-bold'
                  : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <RefreshCw className={`w-4 h-4 ${checkingUpdate ? 'animate-spin text-sky-500' : ''}`} />
              <span>Mises à jour</span>
              {updateCheck?.update_available ? (
                <span className="text-[10px] bg-amber-500/20 text-amber-500 border border-amber-500/30 px-1.5 py-0.2 rounded-full font-mono font-bold animate-pulse">
                  MàJ dispo
                </span>
              ) : (
                <span className="text-[10px] opacity-60 font-mono">
                  v0.1.0
                </span>
              )}
            </button>
          </div>

          {/* Scroll Right Button */}
          {canScrollRight && (
            <button
              type="button"
              onClick={() => handleScrollTabs('right')}
              className="absolute right-0 z-20 h-full px-1.5 flex items-center justify-center transition-all cursor-pointer shadow-md animate-fadeIn backdrop-blur-md"
              style={{
                background: 'linear-gradient(to left, var(--surface-subtle) 75%, transparent)',
                color: 'var(--text)'
              }}
              title="Défiler vers la droite"
            >
              <span
                className="p-1 rounded-lg border flex items-center justify-center shadow-xs hover:scale-105 transition-transform"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border2)',
                  color: 'var(--accent-text)'
                }}
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </span>
            </button>
          )}
        </div>

        {/* Tab Content (Scrollable) */}
        <div
          className="flex-1 overflow-y-auto p-6 space-y-6 text-xs transition-colors"
          style={{
            backgroundColor: 'var(--bg)',
            color: 'var(--text)',
          }}
        >
          {activeTab === 'conversation' && (
            <div className="space-y-6">
              {/* Tab Header */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <MessageSquare className="w-4 h-4 text-sky-500" />
                  <span>Session Active & Données de Conversation</span>
                </h3>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Gérez les métadonnées, exportez l'historique en Markdown ou JSON complet, ou importez des sessions externes.
                </p>
              </div>

              {!activeConversation ? (
                <div
                  className="p-8 rounded-2xl border text-center space-y-2"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <MessageSquare className="w-8 h-8 mx-auto opacity-30 text-sky-500" />
                  <p className="text-xs font-medium" style={{ color: 'var(--strong)' }}>
                    Aucune session active sélectionnée
                  </p>
                  <p className="text-[11px] max-w-sm mx-auto" style={{ color: 'var(--muted)' }}>
                    Sélectionnez une discussion dans la barre latérale ou créez-en une nouvelle pour configurer ses métadonnées et exporter ses données.
                  </p>
                </div>
              ) : (
                <>
                  {/* Session Overview Badge */}
                  <div
                    className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>
                          {convTitle || activeConversation.title || 'Discussion sans titre'}
                        </span>
                        {convPinned && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-500 border border-amber-500/30 flex items-center gap-1 font-mono">
                            <Pin className="w-2.5 h-2.5" /> Épinglée
                          </span>
                        )}
                        {convArchived && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/30 flex items-center gap-1 font-mono">
                            <Archive className="w-2.5 h-2.5" /> Archivée
                          </span>
                        )}
                        {convProject && (
                          <span
                            className="text-[10px] px-2 py-0.5 rounded-full font-mono flex items-center gap-1 border"
                            style={{
                              backgroundColor: `${convProjectColor}18`,
                              borderColor: `${convProjectColor}40`,
                              color: convProjectColor,
                            }}
                          >
                            <Folder className="w-2.5 h-2.5" />
                            {convProject}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                        ID : {activeConversation.conversation_id} · {activeConversation.step_count || 0} messages
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleSaveConvMeta}
                        disabled={convSaving}
                        className="px-3.5 py-1.5 rounded-xl text-xs font-medium text-white transition-all cursor-pointer flex items-center gap-1.5 shadow-xs hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent)' }}
                      >
                        {convSaving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                        <span>Enregistrer</span>
                      </button>
                    </div>
                  </div>

                  {/* Metadata Form */}
                  <div
                    className="p-4 sm:p-5 rounded-2xl border space-y-4 shadow-xs"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                      Propriétés de la Session
                    </h4>

                    {/* Title */}
                    <div>
                      <label className="text-[11px] font-medium block mb-1" style={{ color: 'var(--muted)' }}>
                        Titre personnalisé
                      </label>
                      <input
                        type="text"
                        value={convTitle}
                        onChange={(e) => setConvTitle(e.target.value)}
                        placeholder="ex: Développement API REST LeadForge"
                        className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors font-medium"
                        style={{
                          backgroundColor: 'var(--input-bg)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>

                    {/* Project & Color */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="text-[11px] font-medium block mb-1 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                          <Folder className="w-3 h-3 text-sky-500" />
                          <span>Projet associé</span>
                        </label>
                        <input
                          type="text"
                          value={convProject}
                          onChange={(e) => setConvProject(e.target.value)}
                          placeholder="ex: LeadForge, Client, Refactoring"
                          className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors"
                          style={{
                            backgroundColor: 'var(--input-bg)',
                            border: '1px solid var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-medium block mb-1.5 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                          <Palette className="w-3 h-3 text-amber-500" />
                          <span>Couleur du projet</span>
                        </label>
                        <div className="flex items-center gap-2 pt-0.5">
                          {CONV_PALETTE.map((color) => (
                            <button
                              key={color}
                              type="button"
                              onClick={() => setConvProjectColor(color)}
                              className={`w-6 h-6 rounded-full transition-transform cursor-pointer flex items-center justify-center shadow-xs ${
                                convProjectColor === color ? 'scale-125 ring-2 ring-offset-2 ring-sky-500' : 'hover:scale-110'
                              }`}
                              style={{ backgroundColor: color }}
                            >
                              {convProjectColor === color && <Check className="w-3 h-3 text-white" />}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Tags */}
                    <div>
                      <label className="text-[11px] font-medium block mb-1 flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                        <Tag className="w-3 h-3 text-emerald-500" />
                        <span>Tags (séparés par des virgules)</span>
                      </label>
                      <input
                        type="text"
                        value={convTagsStr}
                        onChange={(e) => setConvTagsStr(e.target.value)}
                        placeholder="backend, api, bugfix, urgent"
                        className="w-full px-3 py-2 rounded-xl text-xs focus:outline-none transition-colors font-mono"
                        style={{
                          backgroundColor: 'var(--input-bg)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)',
                        }}
                      />
                    </div>

                    {/* Toggles */}
                    <div className="pt-2 flex items-center gap-6 flex-wrap">
                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={convPinned}
                          onChange={(e) => setConvPinned(e.target.checked)}
                          className="rounded border text-sky-500 focus:ring-sky-500"
                        />
                        <span className="font-medium" style={{ color: 'var(--text)' }}>
                          📌 Épingler la session en tête de liste
                        </span>
                      </label>

                      <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={convArchived}
                          onChange={(e) => setConvArchived(e.target.checked)}
                          className="rounded border text-purple-500 focus:ring-purple-500"
                        />
                        <span className="font-medium" style={{ color: 'var(--text)' }}>
                          📦 Archiver la session
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Export / Import Section */}
                  <div
                    className="p-4 sm:p-5 rounded-2xl border space-y-3.5 shadow-xs"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                        Export & Portabilité
                      </h4>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                        Téléchargez le transcript en Markdown lisible ou en JSON complet pour archivage ou partage.
                      </p>
                    </div>

                    {/* Hidden JSON file input */}
                    <input
                      ref={convFileInputRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportFileSelected}
                      className="hidden"
                    />

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <button
                        type="button"
                        onClick={() => handleExportConv('markdown')}
                        disabled={convExporting}
                        className="p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 shadow-xs hover:border-sky-500/50"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <FileText className="w-4 h-4 text-sky-500 shrink-0" />
                        <div>
                          <span className="font-bold text-xs block" style={{ color: 'var(--strong)' }}>
                            Export Markdown (.md)
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            Transcript lisible & formaté
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleExportConv('json')}
                        disabled={convExporting}
                        className="p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 shadow-xs hover:border-emerald-500/50"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <Download className="w-4 h-4 text-emerald-500 shrink-0" />
                        <div>
                          <span className="font-bold text-xs block" style={{ color: 'var(--strong)' }}>
                            Export JSON (.json)
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            Données complètes & métas
                          </span>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => convFileInputRef.current?.click()}
                        className="p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center gap-2.5 shadow-xs hover:border-purple-500/50"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                        }}
                      >
                        <Upload className="w-4 h-4 text-purple-500 shrink-0" />
                        <div>
                          <span className="font-bold text-xs block" style={{ color: 'var(--strong)' }}>
                            Importer JSON (.json)
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                            Format Antigravity ou Hermes
                          </span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Danger Zone */}
                  <div
                    className="p-4 sm:p-5 rounded-2xl border space-y-3 shadow-xs border-rose-500/20"
                    style={{
                      backgroundColor: 'rgba(244, 63, 94, 0.03)',
                      borderColor: 'rgba(244, 63, 94, 0.25)',
                    }}
                  >
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-rose-500">
                        Zone de Danger
                      </h4>
                      <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>
                        Actions irréversibles sur la conversation sélectionnée.
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap">
                      <button
                        type="button"
                        onClick={handleClearChatHistory}
                        className="px-3.5 py-2 rounded-xl text-xs font-medium border border-rose-500/30 text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Effacer l'historique des messages</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleDeleteActiveConv}
                        className="px-3.5 py-2 rounded-xl text-xs font-medium bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/30 hover:bg-rose-500 hover:text-white transition-all cursor-pointer flex items-center gap-1.5"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Supprimer définitivement la session</span>
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {activeTab === 'models' && (
            <div className="space-y-6">
              {/* Models List */}
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                    Modèle d'Intelligence Artificielle
                  </label>
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>Sélectionnez la famille de modèle par défaut</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5">
                  {models.map((m) => {
                    const isSelected = selectedModelId === m.id;
                    const meta = MODEL_DESCRIPTIONS[m.id] || {
                      desc: 'Modèle supporté par Antigravity CLI.',
                      badge: 'Standard',
                      iconColor: 'text-sky-500 bg-sky-500/10 border-sky-500/30'
                    };

                    return (
                      <div
                        key={m.id}
                        onClick={() => handleSelectModel(m.id)}
                        className="p-3.5 rounded-2xl border transition-all flex items-start justify-between cursor-pointer shadow-xs hover:border-sky-500/40"
                        style={{
                          backgroundColor: 'var(--surface)',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-8 h-8 rounded-xl flex items-center justify-center border shrink-0 mt-0.5 ${meta.iconColor}`}>
                            <Cpu className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>{m.name}</span>
                              <span className={`text-[9px] px-1.5 py-0.2 rounded border font-mono font-bold ${meta.iconColor}`}>
                                {meta.badge}
                              </span>
                            </div>
                            <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--muted)' }}>{meta.desc}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-sky-500 flex items-center justify-center text-white">
                              <Check className="w-3 h-3 stroke-[3]" />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Effort & Mode settings */}
              {supportedEfforts.length > 0 && (
                <div
                  className="p-4 rounded-2xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-semibold" style={{ color: 'var(--strong)' }}>Niveau d'Effort de Raisonnement</span>
                      <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Profondeur de réflexion allouée au modèle sélectionné</p>
                    </div>
                    <div
                      className="flex items-center gap-1.5 p-1 rounded-xl border"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      {supportedEfforts.map((eff) => (
                        <button
                          key={eff}
                          type="button"
                          onClick={() => setSelectedEffort(eff as any)}
                          className="px-3 py-1 rounded-lg text-xs font-mono font-medium transition-all cursor-pointer"
                          style={{
                            backgroundColor: selectedEffort === eff ? 'var(--accent)' : 'transparent',
                            color: selectedEffort === eff ? '#FFFFFF' : 'var(--muted)',
                          }}
                        >
                          {eff.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'permissions' && (
            <div className="space-y-6">
              {/* 1-Click Profiles */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  Profils Rapides en 1 Clic
                </label>
                <div className="grid grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => applyProfile('full')}
                    className="p-3 rounded-2xl border text-left transition-all cursor-pointer group shadow-xs hover:border-sky-500/50"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Unlock className="w-3.5 h-3.5 text-sky-500" />
                      <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>Full Développeur</span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Accès total : commandes, écriture & lecture partout</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyProfile('standard')}
                    className="p-3 rounded-2xl border text-left transition-all cursor-pointer group shadow-xs hover:border-emerald-500/50"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Shield className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>Standard Workspace</span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Commandes courantes et écriture dans les workspaces</p>
                  </button>

                  <button
                    type="button"
                    onClick={() => applyProfile('strict')}
                    className="p-3 rounded-2xl border text-left transition-all cursor-pointer group shadow-xs hover:border-amber-500/50"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                    }}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Lock className="w-3.5 h-3.5 text-amber-500" />
                      <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>Strict (Lecture Seule)</span>
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Aucune commande terminal, analyse & lecture seule</p>
                  </button>
                </div>
              </div>

              {/* Direct Toggles */}
              <div className="space-y-2.5">
                <label className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                  Accès Directs
                </label>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Commandes Shell (command(*))', rule: 'command(*)', desc: 'Autoriser l\'agent à exécuter des scripts et commandes' },
                    { label: 'Écriture Fichiers (write_file(/))', rule: 'write_file(/)', desc: 'Autoriser la modification et création de fichiers' },
                    { label: 'Lecture Fichiers (read_file(/))', rule: 'read_file(/)', desc: 'Autoriser la lecture de code et de logs' },
                    { label: 'Requêtes Réseau (read_url(*))', rule: 'read_url(*)', desc: 'Autoriser l\'inspection web et URLs' },
                  ].map((item) => {
                    const active = allowRules.includes(item.rule);
                    return (
                      <div
                        key={item.rule}
                        onClick={() => toggleDirectRule(item.rule)}
                        className="p-3 rounded-xl border flex items-center justify-between cursor-pointer transition-all shadow-xs"
                        style={{
                          backgroundColor: active ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: active ? 'var(--accent)' : 'var(--border)',
                        }}
                      >
                        <div className="pr-2">
                          <span className="text-xs font-semibold block" style={{ color: active ? 'var(--accent)' : 'var(--strong)' }}>
                            {item.label}
                          </span>
                          <span className="text-[10px]" style={{ color: 'var(--muted)' }}>{item.desc}</span>
                        </div>
                        <div
                          className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all ${
                            active ? 'bg-emerald-500 border-emerald-400 text-white' : 'border-slate-300 dark:border-slate-700'
                          }`}
                          style={{
                            backgroundColor: active ? '#10B981' : 'var(--surface-subtle)',
                          }}
                        >
                          {active && <Check className="w-3 h-3 stroke-[3]" />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Granular Rules Manager */}
              <div
                className="p-4 rounded-2xl border space-y-3"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
              >
                <span className="font-semibold block text-xs" style={{ color: 'var(--strong)' }}>
                  Règles Autorisées Actives ({allowRules.length})
                </span>
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto p-1">
                  {allowRules.map((r) => (
                    <span
                      key={r}
                      className="font-mono text-[11px] border px-2.5 py-1 rounded-lg flex items-center gap-2 shadow-xs"
                      style={{
                        backgroundColor: 'var(--surface-subtle)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      <span>{r}</span>
                      <button
                        type="button"
                        onClick={() => removeRule(r)}
                        className="hover:text-rose-500 cursor-pointer transition-colors"
                        style={{ color: 'var(--muted)' }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>

                {/* Add rule input */}
                <div className="pt-2 flex items-center gap-2 border-t" style={{ borderColor: 'var(--border)' }}>
                  <select
                    value={newRuleType}
                    onChange={(e) => setNewRuleType(e.target.value)}
                    className="border rounded-lg px-2.5 py-1.5 text-xs font-mono outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="command">command</option>
                    <option value="write_file">write_file</option>
                    <option value="read_file">read_file</option>
                    <option value="read_url">read_url</option>
                  </select>

                  <input
                    type="text"
                    value={newRuleValue}
                    onChange={(e) => setNewRuleValue(e.target.value)}
                    placeholder="* ou chemin"
                    className="flex-1 border rounded-lg px-3 py-1.5 text-xs font-mono outline-none"
                    style={{
                      backgroundColor: 'var(--input-bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />

                  <button
                    type="button"
                    onClick={addCustomRule}
                    className="py-1.5 px-3 rounded-lg font-semibold text-xs flex items-center gap-1.5 cursor-pointer border hover:bg-black/5 dark:hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--surface-subtle)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Ajouter</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'skills' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                    Skills Installés & Écosystème
                  </h3>
                  <p className="text-[10px]" style={{ color: 'var(--muted)' }}>Capacités modulaires découvertes automatiquement par Antigravity</p>
                </div>
                <span className="text-[10px] font-mono bg-indigo-500/10 text-indigo-500 border border-indigo-500/30 px-2 py-0.5 rounded-full">
                  {skills.length} skills disponibles
                </span>
              </div>

              {selectedSkill ? (
                <div
                  className="space-y-3 p-4 rounded-2xl border"
                  style={{
                    backgroundColor: 'var(--surface)',
                    borderColor: 'var(--border)',
                  }}
                >
                  <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-indigo-500" />
                      <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>{selectedSkill.name}</span>
                      <span
                        className="text-[9px] px-1.5 py-0.2 rounded font-mono border"
                        style={{
                          backgroundColor: 'var(--surface-subtle)',
                          borderColor: 'var(--border)',
                          color: 'var(--muted)',
                        }}
                      >
                        {selectedSkill.type}
                      </span>
                    </div>
                    <button
                      onClick={() => setSelectedSkill(null)}
                      className="text-xs cursor-pointer hover:underline"
                      style={{ color: 'var(--accent)' }}
                    >
                      ← Revenir à la liste
                    </button>
                  </div>
                  <pre
                    className="p-4 rounded-xl text-[11px] font-mono max-h-[350px] overflow-y-auto whitespace-pre-wrap border"
                    style={{
                      backgroundColor: 'var(--code-bg)',
                      borderColor: 'var(--border)',
                      color: 'var(--code-text)',
                    }}
                  >
                    {selectedSkill.content}
                  </pre>
                </div>
              ) : skillsLoading ? (
                <div className="p-8 text-center text-xs" style={{ color: 'var(--muted)' }}>
                  Chargement des skills installés...
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2.5">
                  {skills.map((skill) => (
                    <div
                      key={skill.id}
                      onClick={() => viewSkillDetail(skill)}
                      className="p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start justify-between group shadow-xs hover:border-sky-500/50"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div className="w-8 h-8 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-500 shrink-0 mt-0.5">
                          <Boxes className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>{skill.name}</span>
                            <span
                              className={`text-[9px] px-1.5 py-0.2 rounded font-mono font-bold ${
                                skill.type === 'builtin'
                                  ? 'bg-sky-500/15 text-sky-500 border border-sky-500/30'
                                  : 'bg-emerald-500/15 text-emerald-500 border border-emerald-500/30'
                              }`}
                            >
                              {skill.type === 'builtin' ? 'Built-in' : 'User Config'}
                            </span>
                            {skill.has_scripts && (
                              <span className="text-[9px] bg-amber-500/15 text-amber-600 dark:text-amber-300 border border-amber-500/30 px-1 py-0.2 rounded font-mono">
                                Scripts
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] mt-1 leading-snug" style={{ color: 'var(--muted)' }}>{skill.description}</p>
                          <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--muted)' }}>{skill.path}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-[10px] group-hover:text-indigo-500 transition-colors flex items-center gap-1" style={{ color: 'var(--muted)' }}>
                          <span>Voir doc</span>
                          <ChevronRight className="w-3 h-3" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                  Sécurité & Mot de Passe d'Accès
                </h3>
                <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                  Protégez l'accès au cockpit web Antigravity pour sécuriser votre serveur
                </p>
              </div>

              <div
                className="p-4 rounded-2xl border space-y-4"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
              >
                <div className="flex items-center gap-3 text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl">
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-semibold block" style={{ color: 'var(--strong)' }}>Protection Active</span>
                    <span className="text-[11px]" style={{ color: 'var(--muted)' }}>L'authentification par mot de passe et signature HMAC est activée.</span>
                  </div>
                </div>

                <form onSubmit={handlePasswordChange} className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--muted)' }}>
                      Mot de passe actuel
                    </label>
                    <input
                      type="password"
                      value={oldPassword}
                      onChange={(e) => setOldPassword(e.target.value)}
                      placeholder="Mot de passe actuel (par défaut : antigravity2026)"
                      className="w-full px-3 py-2 border rounded-xl text-xs font-mono focus:outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--muted)' }}>
                      Nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Saisissez un nouveau mot de passe fort"
                      className="w-full px-3 py-2 border rounded-xl text-xs font-mono focus:outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium mb-1" style={{ color: 'var(--muted)' }}>
                      Confirmer le nouveau mot de passe
                    </label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirmez le nouveau mot de passe"
                      className="w-full px-3 py-2 border rounded-xl text-xs font-mono focus:outline-none"
                      style={{
                        backgroundColor: 'var(--input-bg)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  {pwdError && (
                    <div className="text-xs text-rose-500 bg-rose-500/10 border border-rose-500/30 p-2.5 rounded-xl">
                      {pwdError}
                    </div>
                  )}

                  {pwdSuccess && (
                    <div className="text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 p-2.5 rounded-xl flex items-center gap-1.5">
                      <Check className="w-3.5 h-3.5" />
                      <span>Mot de passe mis à jour avec succès ! Vos sessions ont été renouvelées.</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={pwdLoading || !oldPassword || !newPassword}
                    className="py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs flex items-center gap-2 cursor-pointer disabled:opacity-50 transition-all shadow-xs"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{pwdLoading ? 'Mise à jour...' : 'Mettre à jour le mot de passe'}</span>
                  </button>
                </form>

                {/* System Information Card */}
                <div
                  className="mt-6 p-4 rounded-2xl border space-y-3"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border2)',
                  }}
                >
                  <div className="flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-sky-500" />
                    <span className="font-semibold text-xs" style={{ color: 'var(--strong)' }}>
                      Informations Système & Environnement
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <span className="block text-[10px] uppercase font-bold" style={{ color: 'var(--muted)' }}>Application</span>
                      <span className="font-semibold" style={{ color: 'var(--strong)' }}>Antigravity WebUI v2.0</span>
                    </div>

                    <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <span className="block text-[10px] uppercase font-bold" style={{ color: 'var(--muted)' }}>Serveur & API</span>
                      <span className="font-semibold" style={{ color: 'var(--strong)' }}>FastAPI + Uvicorn (Port 8000)</span>
                    </div>

                    <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <span className="block text-[10px] uppercase font-bold" style={{ color: 'var(--muted)' }}>Moteur d'Agent</span>
                      <span className="font-semibold" style={{ color: 'var(--strong)' }}>Google Antigravity CLI (agy)</span>
                    </div>

                    <div className="p-2.5 rounded-xl border" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                      <span className="block text-[10px] uppercase font-bold" style={{ color: 'var(--muted)' }}>Temps Réel</span>
                      <span className="font-semibold text-emerald-500">WebSocket + Heartbeat 5s</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: APPEARANCE & THEMES (HERMES SYSTEM) */}
          {activeTab === 'appearance' && (
            <div className="p-6 space-y-6">
              {/* Section 1: Mode Thème */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <Palette className="w-4 h-4 text-amber-500" />
                  <span>Mode d'Affichage (Thème)</span>
                </h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                  Détermine le fond, les surfaces et le contraste général. Le mode Système s'adapte en temps réel aux réglages de votre OS.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {AVAILABLE_THEMES.map((th) => {
                    const isSelected = currentTheme === th.id;
                    return (
                      <button
                        key={th.id}
                        type="button"
                        onClick={() => {
                          setCurrentTheme(th.id);
                          applyAppearance(th.id, currentSkin);
                        }}
                        className="p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between shadow-xs"
                        style={{
                          backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>{th.name}</span>
                          {isSelected && <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />}
                        </div>
                        <p className="text-[10px] leading-snug" style={{ color: 'var(--muted)' }}>{th.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 2: Nuances & Accents (Skins Hermes) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <Boxes className="w-4 h-4 text-sky-500" />
                  <span>Nuances & Accents Visuels (Skins Hermes)</span>
                </h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                  Sélectionnez la palette d'accent et les surfaces spécifiques. Se combine avec le mode clair ou sombre sélectionné ci-dessus.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 max-h-96 overflow-y-auto pr-1">
                  {AVAILABLE_SKINS.map((sk) => {
                    const isSelected = currentSkin === sk.id;
                    return (
                      <button
                        key={sk.id}
                        type="button"
                        onClick={() => {
                          setCurrentSkin(sk.id);
                          applyAppearance(currentTheme, sk.id);
                        }}
                        className="p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between shadow-xs"
                        style={{
                          backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                        }}
                      >
                        <div>
                          {/* Color dots preview */}
                          <div className="flex items-center gap-1.5 mb-2">
                            {sk.colors.map((c, i) => (
                              <span
                                key={i}
                                className="w-2.5 h-2.5 rounded-full shadow-xs border border-black/20"
                                style={{ backgroundColor: c }}
                              />
                            ))}
                          </div>
                          <span className="font-bold text-[11px] block truncate" style={{ color: 'var(--strong)' }}>
                            {sk.name}
                          </span>
                        </div>
                        <p className="text-[9px] leading-tight mt-1 line-clamp-2" style={{ color: 'var(--muted)' }}>
                          {sk.desc}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 3: Échelle Typographique (Taille du texte S/M/L) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <Type className="w-4 h-4 text-emerald-500" />
                  <span>Échelle Typographique (Taille du texte)</span>
                </h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                  Ajuste la densité de lecture et la taille de la police dans toute l'interface.
                </p>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'small', label: 'Compact', size: '13px', desc: 'Densité maximale pour écrans denses' },
                    { id: 'default', label: 'Défaut', size: '14.5px', desc: 'Équilibre standard lecture & espace' },
                    { id: 'large', label: 'Confort', size: '16px', desc: 'Lecture plus aérée et confortable' },
                    { id: 'xlarge', label: 'Large', size: '18px', desc: 'Grand format haute lisibilité' },
                  ].map((fs) => {
                    const isSelected = currentFontSize === fs.id;
                    return (
                      <button
                        key={fs.id}
                        type="button"
                        onClick={() => {
                          setCurrentFontSize(fs.id as FontSizeOption);
                          setFontSize(fs.id as FontSizeOption);
                        }}
                        className="p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between shadow-xs"
                        style={{
                          backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface)',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                          boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                        }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>{fs.label}</span>
                          <span className="font-mono text-[10px] px-1 rounded border" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>{fs.size}</span>
                        </div>
                        <p className="text-[10px]" style={{ color: 'var(--muted)' }}>{fs.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Section 4: Raccourci Clavier d'Envoi (Composer) */}
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <Keyboard className="w-4 h-4 text-sky-500" />
                  <span>Raccourci Clavier d'Envoi (Composer)</span>
                </h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                  Configurez la combinaison de touches pour expédier votre message à l'agent depuis la boîte de saisie.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={() => handleSetSendKeyMode('enter')}
                    className="p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between shadow-xs"
                    style={{
                      backgroundColor: sendKeyMode === 'enter' ? 'var(--accent-bg)' : 'var(--surface)',
                      borderColor: sendKeyMode === 'enter' ? 'var(--accent)' : 'var(--border)',
                      boxShadow: sendKeyMode === 'enter' ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>Entrée ↵</span>
                      {sendKeyMode === 'enter' && <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />}
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      Touche ↵ Entrée pour envoyer le message, Maj+Entrée pour insérer un saut de ligne.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleSetSendKeyMode('ctrlEnter')}
                    className="p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between shadow-xs"
                    style={{
                      backgroundColor: sendKeyMode === 'ctrlEnter' ? 'var(--accent-bg)' : 'var(--surface)',
                      borderColor: sendKeyMode === 'ctrlEnter' ? 'var(--accent)' : 'var(--border)',
                      boxShadow: sendKeyMode === 'ctrlEnter' ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>Ctrl / Cmd + Entrée ↵</span>
                      {sendKeyMode === 'ctrlEnter' && <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />}
                    </div>
                    <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
                      Touche ↵ Entrée insère un saut de ligne, Ctrl+Entrée ou Cmd+Entrée pour expédier.
                    </p>
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'languages' && (
            <div className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <Globe className="w-4 h-4 text-cyan-500" />
                  <span>Langues de l'interface (15 langues Hermes WebUI)</span>
                </h3>
                <p className="text-[11px] mb-3" style={{ color: 'var(--muted)' }}>
                  Sélectionnez la langue d'affichage et de synthèse vocale. L'ensemble de la console et des messages est mis à jour instantanément.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-[420px] overflow-y-auto pr-1">
                {SUPPORTED_LANGUAGES.map((item) => {
                  const isSelected = lang === item.code;
                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => setLanguage(item.code)}
                      className="p-3 rounded-xl border text-left transition-all cursor-pointer flex items-center justify-between shadow-xs"
                      style={{
                        backgroundColor: isSelected ? 'var(--accent-bg)' : 'var(--surface)',
                        borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                      }}
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="text-xl leading-none">{item.flag || '🌐'}</span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>{item.label}</span>
                            <span
                              className="text-[9px] font-mono px-1.5 py-0.2 rounded border"
                              style={{
                                backgroundColor: 'var(--surface-subtle)',
                                borderColor: 'var(--border)',
                                color: 'var(--muted)',
                              }}
                            >
                              {item.code}
                            </span>
                          </div>
                          <span className="text-[10px] font-mono" style={{ color: 'var(--muted)' }}>
                            {item.speech}
                          </span>
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-cyan-500 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {activeTab === 'google' && (
            <div className="space-y-6">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                  <GoogleIcon className="w-4 h-4" />
                  <span>Gestion des Comptes Google (Antigravity & Gemini)</span>
                </h3>
                <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                  Visualisez le compte actif, basculez instantanément entre vos comptes enregistrés ou connectez un nouveau compte Google.
                </p>
              </div>

              {/* Status alerts */}
              {googleSuccess && (
                <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs flex items-center gap-2 animate-fadeIn">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>{googleSuccess}</span>
                </div>
              )}
              {googleError && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-center gap-2 animate-fadeIn">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{googleError}</span>
                </div>
              )}

              {/* Active Account Card */}
              <div
                className="p-4 rounded-2xl border shadow-sm"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border2)'
                }}
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: 'var(--muted)' }}>
                  Compte Google Principal Actif
                </div>

                <div className="flex items-center justify-between flex-wrap gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-800 p-2 flex items-center justify-center border shadow-xs">
                      <GoogleIcon className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm" style={{ color: 'var(--strong)' }}>
                          {googleData?.active_account?.email || 'Aucun compte connecté'}
                        </span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Connecté
                        </span>
                      </div>
                      <div className="text-[11px] flex items-center gap-3 mt-1" style={{ color: 'var(--muted)' }}>
                        <span>Auth : OAuth 2.0 PKCE</span>
                        <span>&bull;</span>
                        <span>Renouvellement automatique : Actif</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={loadGoogleAccounts}
                    disabled={googleLoading}
                    className="px-3 py-1.5 rounded-xl border text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer hover:bg-black/5 dark:hover:bg-white/5"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)'
                    }}
                    title="Actualiser les informations du compte"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${googleLoading ? 'animate-spin' : ''}`} />
                    <span>Actualiser</span>
                  </button>
                </div>
              </div>

              {/* Saved Accounts Multi-Switcher */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                    Comptes enregistrés ({googleData?.accounts.length || 0})
                  </h4>
                  <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                    Basculez en 1 clic sans avoir à vous reconnecter
                  </span>
                </div>

                <div className="space-y-2">
                  {(!googleData?.accounts || googleData.accounts.length === 0) ? (
                    <div className="p-4 rounded-xl border text-center text-xs" style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                      Aucun autre compte enregistré.
                    </div>
                  ) : (
                    googleData.accounts.map((acc) => {
                      const isActive = acc.is_active;
                      const isSwitching = googleSwitching === acc.email;
                      return (
                        <div
                          key={acc.email}
                          className="p-3 rounded-xl border flex items-center justify-between transition-all"
                          style={{
                            backgroundColor: isActive ? 'var(--surface-subtle)' : 'var(--surface)',
                            borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                            boxShadow: isActive ? '0 0 0 1px var(--accent)' : 'none'
                          }}
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-8 h-8 rounded-lg bg-white/5 border flex items-center justify-center shrink-0" style={{ borderColor: 'var(--border-subtle)' }}>
                              <GoogleIcon className="w-4 h-4" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-xs truncate" style={{ color: 'var(--strong)' }}>
                                  {acc.email}
                                </span>
                                {isActive && (
                                  <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                    ACTIF
                                  </span>
                                )}
                              </div>
                              <span className="text-[10px]" style={{ color: 'var(--muted)' }}>
                                {isActive ? 'Compte utilisé pour les requêtes Antigravity' : 'Compte sauvegardé disponible'}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {!isActive ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleSwitchGoogleAccount(acc.email)}
                                  disabled={isSwitching}
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white transition-all shadow-xs cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {isSwitching ? (
                                    <>
                                      <RefreshCw className="w-3 h-3 animate-spin" />
                                      <span>Basculement...</span>
                                    </>
                                  ) : (
                                    <>
                                      <UserCheck className="w-3.5 h-3.5" />
                                      <span>Basculer sur ce compte</span>
                                    </>
                                  )}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteGoogleAccount(acc.email)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                                  title="Supprimer ce compte de la liste"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </>
                            ) : (
                              <span className="text-[11px] font-medium text-emerald-400 flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Compte actif
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Add / Connect New Google Account */}
              <div
                className="p-4 rounded-2xl border space-y-3"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border)'
                }}
              >
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--strong)' }}>
                      Connecter un nouveau compte Google
                    </h4>
                    <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                      Associez une autre adresse Gmail ou Google Workspace pour y accéder à tout moment.
                    </p>
                  </div>

                  {!googleLoginSession && (
                    <button
                      type="button"
                      onClick={handleStartGoogleLogin}
                      disabled={googleLoading}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-all shadow-md shadow-blue-600/20 cursor-pointer flex items-center gap-2"
                    >
                      <Plus className="w-4 h-4" />
                      <span>{googleLoading ? 'Démarrage...' : 'Connecter un compte'}</span>
                    </button>
                  )}
                </div>

                {/* Interactive OAuth Wizard if login started */}
                {googleLoginSession && (
                  <div
                    className="p-4 rounded-xl border mt-3 space-y-4 animate-fadeIn"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border2)'
                    }}
                  >
                    <div className="flex items-center justify-between pb-2 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                      <span className="font-bold text-xs" style={{ color: 'var(--strong)' }}>
                        Connexion Google OAuth 2.0 en cours
                      </span>
                      <button
                        type="button"
                        onClick={handleCancelGoogleLogin}
                        className="text-[11px] text-rose-400 hover:underline cursor-pointer"
                      >
                        Annuler la connexion
                      </button>
                    </div>

                    {/* Step 1 */}
                    <div className="space-y-1.5">
                      <div className="font-semibold text-xs flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                        <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold">1</span>
                        <span>Ouvrez la page d'authentification Google :</span>
                      </div>
                      <a
                        href={googleLoginSession.authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-all shadow-md shadow-blue-600/20 cursor-pointer"
                      >
                        <GoogleIcon className="w-4 h-4" />
                        <span>Se connecter avec Google (Nouvelle fenêtre)</span>
                        <ExternalLink className="w-3.5 h-3.5 ml-1" />
                      </a>
                    </div>

                    {/* Step 2 */}
                    <div className="space-y-1.5">
                      <div className="font-semibold text-xs flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                        <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold">2</span>
                        <span>Choisissez votre compte Google et validez l'accès Antigravity.</span>
                      </div>
                      <p className="text-[11px] pl-7" style={{ color: 'var(--muted)' }}>
                        Sur la page finale, copiez le code d'autorisation affiché ou copiez l'URL complète de redirection.
                      </p>
                    </div>

                    {/* Step 3 */}
                    <form onSubmit={handleSubmitGoogleCode} className="space-y-2.5 pt-1">
                      <div className="font-semibold text-xs flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                        <span className="w-5 h-5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex items-center justify-center text-[10px] font-bold">3</span>
                        <span>Collez le code obtenu ou l'URL retournée :</span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={googleAuthCode}
                          onChange={(e) => setGoogleAuthCode(e.target.value)}
                          placeholder="ex: 4/0AbCdEf... ou https://antigravity.google/oauth-callback?code=..."
                          className="flex-1 px-3 py-2 rounded-xl border text-xs outline-none font-mono transition-colors"
                          style={{
                            backgroundColor: 'var(--surface-subtle)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)'
                          }}
                        />
                        <button
                          type="submit"
                          disabled={!googleAuthCode.trim() || googleSubmitting}
                          className="px-4 py-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs transition-all shadow-md shadow-emerald-600/20 disabled:opacity-50 cursor-pointer flex items-center gap-1.5"
                        >
                          {googleSubmitting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Vérification...</span>
                            </>
                          ) : (
                            <>
                              <Check className="w-3.5 h-3.5" />
                              <span>Valider & Activer</span>
                            </>
                          )}
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>

              {/* Terminal Tip */}
              <div
                className="p-3.5 rounded-xl border flex items-start gap-2.5 text-[11px] leading-relaxed"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--muted)'
                }}
              >
                <Terminal className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-amber-300">Astuce ligne de commande : </span>
                  Vous pouvez également gérer vos comptes Google directement depuis le terminal intégré avec la commande{' '}
                  <code className="px-1.5 py-0.5 rounded font-mono bg-black/20 text-amber-200 border border-amber-500/20">
                    antigravity-account
                  </code>
                  {' '}(ex: <code className="font-mono text-amber-200">antigravity-account switch email@gmail.com</code> ou <code className="font-mono text-amber-200">antigravity-account login</code>).
                </div>
              </div>
            </div>
          )}

          {activeTab === 'updates' && (
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider mb-1 flex items-center gap-2" style={{ color: 'var(--strong)' }}>
                    <RefreshCw className="w-4 h-4 text-sky-500" />
                    <span>Mises à jour Antigravity WebUI (Système Hermes)</span>
                  </h3>
                  <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
                    Recherche asynchrone et déploiement instantané des dernières améliorations du dépôt GitHub officiel.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => loadUpdateInfo(true)}
                  disabled={checkingUpdate || applyingUpdate}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all border shadow-xs cursor-pointer hover:border-sky-500 shrink-0 disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--surface-subtle)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)'
                  }}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${checkingUpdate ? 'animate-spin text-sky-500' : ''}`} />
                  <span>{checkingUpdate ? 'Vérification...' : 'Rechercher les mises à jour'}</span>
                </button>
              </div>

              {/* Version & Git Status Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                <div
                  className="p-3.5 rounded-xl border flex flex-col justify-between"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <span className="text-[10px] uppercase font-mono tracking-wider font-semibold opacity-60">Version Actuelle</span>
                  <div className="mt-2 flex items-baseline gap-1.5">
                    <span className="text-base font-bold font-mono text-sky-500">v{systemVersion?.version || '0.1.0'}</span>
                    <span className="text-[10px] font-mono opacity-50">{systemVersion?.tag || 'v0.1.0'}</span>
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col justify-between"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <span className="text-[10px] uppercase font-mono tracking-wider font-semibold opacity-60">Dernier Commit (HEAD)</span>
                  <div className="mt-2">
                    <span className="text-xs font-bold font-mono px-2 py-0.5 rounded bg-black/10 dark:bg-white/10 border" style={{ borderColor: 'var(--border)' }}>
                      {systemVersion?.commit || 'local'}
                    </span>
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col justify-between"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <span className="text-[10px] uppercase font-mono tracking-wider font-semibold opacity-60">Branche Active</span>
                  <div className="mt-2">
                    <span className="text-xs font-bold font-mono text-emerald-500">
                      {systemVersion?.branch || 'main'}
                    </span>
                  </div>
                </div>

                <div
                  className="p-3.5 rounded-xl border flex flex-col justify-between"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <span className="text-[10px] uppercase font-mono tracking-wider font-semibold opacity-60">Statut MàJ</span>
                  <div className="mt-2">
                    {checkingUpdate ? (
                      <span className="text-xs font-mono text-sky-400 animate-pulse">Vérification...</span>
                    ) : updateCheck?.update_available ? (
                      <span className="text-xs font-bold text-amber-500">
                        {updateCheck.behind} commit(s) dispo
                      </span>
                    ) : (
                      <span className="text-xs font-bold text-emerald-500 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> À jour
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Progress Notice if Applying */}
              {applyingUpdate && (
                <div className="p-4 rounded-xl border border-sky-500/30 bg-sky-500/10 text-sky-400 text-xs flex items-center gap-3 animate-pulse">
                  <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                  <div>
                    <div className="font-bold">Mise à jour en cours d'installation...</div>
                    <div className="text-[11px] opacity-80">{updateProgressMsg || 'Téléchargement des modifications depuis GitHub...'}</div>
                  </div>
                </div>
              )}

              {/* Update Available Banner */}
              {updateCheck?.update_available && !applyingUpdate && (
                <div
                  className="p-4 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm"
                  style={{
                    backgroundColor: 'rgba(245, 158, 11, 0.08)',
                    borderColor: 'rgba(245, 158, 11, 0.3)'
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-xl bg-amber-500/20 text-amber-500 shrink-0 mt-0.5">
                      <AlertCircle className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-amber-500">
                        Une nouvelle version est disponible sur GitHub !
                      </h4>
                      <p className="text-[11px] text-amber-600 dark:text-amber-400/90 mt-0.5">
                        Votre environnement a {updateCheck.behind} commit(s) de retard. Vous pouvez mettre à jour et redémarrer la plateforme en 1 clic.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleTriggerApplyUpdate}
                    className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-500/20 cursor-pointer shrink-0"
                  >
                    <Download className="w-4 h-4" />
                    <span>Installer la mise à jour</span>
                  </button>
                </div>
              )}

              {/* Upstream Commits / Changelog Preview */}
              {updateCheck?.commits && updateCheck.commits.length > 0 && (
                <div
                  className="p-4 rounded-2xl border"
                  style={{ backgroundColor: 'var(--surface-subtle)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: 'var(--strong)' }}>
                      <FileText className="w-3.5 h-3.5 text-sky-500" />
                      <span>Nouveautés et correctifs en attente ({updateCheck.commits.length})</span>
                    </span>
                    <span className="text-[10px] font-mono opacity-50">origin/main</span>
                  </div>
                  <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                    {updateCheck.commits.map((c) => (
                      <div
                        key={c.sha}
                        className="p-2.5 rounded-xl border flex items-start justify-between gap-3 text-xs transition-colors"
                        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-subtle)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded font-bold bg-sky-500/10 text-sky-500 border border-sky-500/20 shrink-0">
                              {c.sha}
                            </span>
                            <span className="font-medium truncate" style={{ color: 'var(--text)' }}>
                              {c.summary}
                            </span>
                          </div>
                          <div className="text-[10px] mt-1 opacity-50 flex items-center gap-2">
                            <span>Auteur : {c.author}</span>
                            {c.timestamp > 0 && (
                              <span>• {new Date(c.timestamp * 1000).toLocaleString()}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Up to date Banner */}
              {updateCheck && !updateCheck.update_available && !checkingUpdate && (
                <div
                  className="p-4 rounded-xl border flex items-center gap-3 text-xs"
                  style={{
                    backgroundColor: 'rgba(16, 185, 129, 0.08)',
                    borderColor: 'rgba(16, 185, 129, 0.25)',
                    color: 'var(--text)'
                  }}
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <div className="font-bold text-emerald-600 dark:text-emerald-400">
                      Antigravity WebUI est parfaitement à jour.
                    </div>
                    <div className="text-[11px] opacity-70 mt-0.5">
                      Tous les derniers correctifs, optimisations et fonctionnalités d'orchestration sont installés.
                    </div>
                  </div>
                </div>
              )}

              {/* Architecture info */}
              <div
                className="p-3.5 rounded-xl border flex items-start gap-2.5 text-[11px] leading-relaxed"
                style={{
                  backgroundColor: 'var(--surface-subtle)',
                  borderColor: 'var(--border-subtle)',
                  color: 'var(--muted)'
                }}
              >
                <Terminal className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold text-sky-400">Architecture de mise à jour synchronisée : </span>
                  Ce module reprend le protocole d'Hermes Agent : les vérifications s'exécutent de façon asynchrone en arrière-plan sans bloquer l'UI, avec un cache local de 1 heure pour préserver le réseau. La mise à jour effectue un pull sécurisé, recompile le frontend Vite et relance le service systemd.
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 border-t flex items-center justify-between shrink-0"
          style={{
            backgroundColor: 'var(--surface-subtle)',
            borderColor: 'var(--border)',
          }}
        >
          <div className="text-xs">
            {savedSuccess && (
              <span className="text-emerald-500 flex items-center gap-1.5 font-medium">
                <Check className="w-4 h-4" /> Paramètres enregistrés avec succès !
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              onClick={onClose}
              className="py-2 px-4 rounded-xl text-xs font-medium transition-colors cursor-pointer border hover:bg-black/5 dark:hover:bg-white/5"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              Fermer
            </button>
            {activeTab !== 'skills' && activeTab !== 'security' && activeTab !== 'updates' && (
              <button
                onClick={handleSave}
                disabled={saving}
                className="py-2 px-5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 transition-all shadow-md shadow-sky-500/20 disabled:opacity-50 cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? 'Enregistrement...' : 'Enregistrer les modifications'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
