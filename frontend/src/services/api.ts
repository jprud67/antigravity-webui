import type { 
  Conversation, 
  ArtifactItem, 
  AppSettings, 
  ModelOption, 
  WorkspaceFolder, 
  BookmarkItem, 
  GitFileVersionsResponse, 
  PromptAnalysisResponse, 
  PromptOptimizationResponse,
  WorkspaceSearchRequest,
  WorkspaceSearchResponse,
  WorkspaceReplaceRequest,
  WorkspaceReplaceResponse,
  SingleReplaceRequest,
  SingleReplaceResponse,
  GitStashItem,
  StashSaveRequest,
  StashActionRequest,
  ConflictFileInfo,
  ResolveConflictRequest,
  CherryPickRequest,
  CherryPickResponse,
  InlineSuggestRequest,
  InlineSuggestResponse,
  CopilotActionRequest,
  CopilotActionResponse,
  CopilotStatusResponse,
  GitBranchesResponse,
  BranchCheckoutRequest,
  BranchCreateRequest,
  BranchDeleteRequest,
  BranchMergeRequest,
  BranchRenameRequest,
  BranchActionResponse,
  RebaseTodoResponse,
  RebaseExecuteRequest,
  RebaseExecuteResponse,
  RebaseStatusResponse,
  WorkspaceProjectDetail,
  ProjectHealthDiagnostic,
  GitDiffRangesResponse,
  GitRemoteDetail,
  CreateRemotePayload,
  UpdateRemotePayload,
  RemoteActionPayload,
  GitTagDetail,
  CreateTagPayload,
  DeleteTagPayload,
  ReleaseNotesResponse,
  PublishReleasePayload,
  PublishReleaseResponse,
  ContinuousMemoryStatus,
  MemoryOperationPayload,
  FtsSearchResponse,
  SkillTelemetry,
  SkillCuratorSweepResult,
  SkillCuratorLedgerRecord,
  ToolRepairPreviewResponse,
  McpCatalogItem,
  McpTestResult,
  ProgressCardData,
  ProgressCardStep,
  SystemDiagnosticsReport,
  LinkExtractionResult,
  GitWorktreeItem,
  KernelExecutionResult,
  TailscaleStatus,
  WebPushSubscriptionItem,
  MessagingGatewayStatus,
  PairingCodeItem,
  ApprovedDeviceItem,
  CanvasDocumentManifest,
  CanvasDocumentCreateInput,
  CanvasDocumentKind,
  MemoryEntry,
  MemoryStoreInput,
  MemorySearchResult,
  AutoRecallConfig,
  RecallHookResult,
  MemoryCategory,
  ContainerSummary,
  DockerEngineStatus,
  WorkspaceDockerItem,
  ContainerExecResult
} from '../types';

const API_BASE = '/api';

export function getAuthToken(): string | null {
  return localStorage.getItem('antigravity_token');
}

export function setAuthToken(token: string) {
  localStorage.setItem('antigravity_token', token);
}

export function clearAuthToken() {
  localStorage.removeItem('antigravity_token');
}

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...customHeaders };
  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

if (typeof window !== 'undefined' && !(window as any).__antigravity_fetch_intercepted) {
  (window as any).__antigravity_fetch_intercepted = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await originalFetch(input, init);
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : input.toString());
    if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/auth/status')) {
      window.dispatchEvent(new CustomEvent('antigravity:unauthorized'));
    }
    return res;
  };
}

// Auth API
export async function checkAuthStatus(): Promise<{ enabled: boolean; authenticated: boolean }> {
  const res = await fetch(`${API_BASE}/auth/status`, {
    headers: getHeaders()
  });
  if (!res.ok) return { enabled: true, authenticated: false };
  return res.json();
}

export async function login(password: string): Promise<{ success: boolean; token: string }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de connexion' }));
    throw new Error(err.detail || 'Mot de passe incorrect');
  }
  const data = await res.json();
  setAuthToken(data.token);
  return data;
}

export async function updatePassword(oldPassword: string, newPassword: string): Promise<any> {
  const res = await fetch(`${API_BASE}/auth/update-password`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec mise à jour mot de passe' }));
    throw new Error(err.detail || 'Erreur lors du changement de mot de passe');
  }
  const data = await res.json();
  if (data.token) {
    setAuthToken(data.token);
  }
  return data;
}

// API Keys for External Applications
export interface ApiKeyItem {
  id: string;
  name: string;
  masked_key: string;
  key: string;
  created_at: number;
  last_used_at?: number | null;
}

export async function fetchApiKeys(): Promise<{ api_keys: ApiKeyItem[] }> {
  const res = await fetch(`${API_BASE}/auth/api-keys`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Impossible de charger les clés d'API" }));
    throw new Error(err.detail || "Impossible de charger les clés d'API");
  }
  return res.json();
}

export async function createApiKey(name: string): Promise<{ success: boolean; api_key: ApiKeyItem }> {
  const res = await fetch(`${API_BASE}/auth/api-keys`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ name })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec création clé d\'API' }));
    throw new Error(err.detail || 'Erreur lors de la création de la clé');
  }
  return res.json();
}

export async function deleteApiKey(keyId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/auth/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec suppression clé' }));
    throw new Error(err.detail || 'Erreur lors de la suppression de la clé');
  }
  return res.json();
}

export async function bulkDeleteApiKeys(keyIds: string[]): Promise<{
  success: boolean;
  deleted_count: number;
  deleted_ids: string[];
  remaining_count: number;
}> {
  const res = await fetch(`${API_BASE}/auth/api-keys/bulk-delete`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key_ids: keyIds })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression groupée des clés' }));
    throw new Error(err.detail || 'Erreur lors de la suppression groupée des clés');
  }
  return res.json();
}

export async function bulkRotateApiKeys(keyIds: string[]): Promise<{
  success: boolean;
  rotated_keys: ApiKeyItem[];
  count: number;
}> {
  const res = await fetch(`${API_BASE}/auth/api-keys/bulk-rotate`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key_ids: keyIds })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la rotation groupée des clés' }));
    throw new Error(err.detail || 'Erreur lors de la rotation groupée des clés');
  }
  return res.json();
}

// Conversations
export async function fetchConversations(limit = 100, q?: string): Promise<Conversation[]> {
  const url = q && q.trim() 
    ? `${API_BASE}/conversations?limit=${limit}&q=${encodeURIComponent(q.trim())}&_t=${Date.now()}`
    : `${API_BASE}/conversations?limit=${limit}&_t=${Date.now()}`;
  const res = await fetch(url, {
    cache: 'no-store',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load conversations: ${res.statusText}`);
  return res.json();
}

export async function searchConversations(query: string, limit = 50): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations/search?q=${encodeURIComponent(query)}&limit=${limit}&_t=${Date.now()}`, {
    cache: 'no-store',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to search conversations: ${res.statusText}`);
  return res.json();
}

export async function fetchConversationTranscript(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load transcript: ${res.statusText}`);
  return res.json();
}

export async function forkConversation(
  conversationId: string,
  upToStepIndex: number,
  newTitle?: string
): Promise<{ conversation_id: string; title: string; step_count: number; parent_conversation_id: string }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/fork`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ up_to_step_index: upToStepIndex, new_title: newTitle })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la bifurcation' }));
    throw new Error(err.detail || 'Impossible de créer la branche');
  }
  return res.json();
}

export async function handoffConversation(
  conversationId: string,
  newTitle?: string
): Promise<{ conversation_id: string; title: string; step_count: number; parent_conversation_id: string; summary: string }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/handoff`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ new_title: newTitle })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du transfert de contexte' }));
    throw new Error(err.detail || 'Impossible de transférer le contexte');
  }
  return res.json();
}

export async function updateConversationTitle(conversationId: string, title: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/title`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du renommage' }));
    throw new Error(err.detail || 'Échec du renommage');
  }
  return res.json();
}

export async function updateConversationMetadata(
  conversationId: string,
  metadata: {
    pinned?: boolean;
    tags?: string[];
    project?: string;
    projectColor?: string;
    customTitle?: string;
    archived?: boolean;
  }
): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/metadata`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(metadata)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la mise à jour des métadonnées' }));
    throw new Error(err.detail || 'Échec de la mise à jour des métadonnées');
  }
  return res.json();
}

export async function deleteConversation(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de suppression de la conversation' }));
    throw new Error(err.detail || 'Échec de suppression de la conversation');
  }
  return res.json();
}

export async function undoConversationTurn(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/undo`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'annulation" }));
    throw new Error(err.detail || "Impossible d'annuler le dernier tour");
  }
  return res.json();
}

export interface CompactResult {
  status: string;
  conversation_id: string;
  compacted_steps: number;
  chars_saved: number;
  tokens_saved: number;
  reduction_pct: number;
}

export async function compactConversation(
  conversationId: string,
  preserveLastNTurns: number = 2
): Promise<CompactResult> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/compact`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ preserve_last_n_turns: preserveLastNTurns })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du compactage' }));
    throw new Error(err.detail || 'Impossible de compacter la conversation');
  }
  return res.json();
}

export interface PruneResult {
  status: string;
  conversation_id: string;
  pruned_steps: number;
  chars_saved: number;
  tokens_saved: number;
  reduction_pct: number;
}

export async function pruneConversation(
  conversationId: string,
  stepIndices?: number[],
  preserveLastNTurns: number = 2
): Promise<PruneResult> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/prune`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ step_indices: stepIndices, preserve_last_n_turns: preserveLastNTurns })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'élagage" }));
    throw new Error(err.detail || "Impossible d'élaguer la conversation");
  }
  return res.json();
}

export interface ContextBudgetInfo {
  conversation_id: string;
  budget_tokens: number;
  estimated_input_tokens: number;
  transcript_tokens: number;
  base_system_tokens: number;
  is_over_budget: boolean;
  budget_usage_pct: number;
  user_turns_count: number;
  total_steps_count: number;
  breakdown: {
    user_chars?: number;
    user_tokens?: number;
    assistant_chars?: number;
    assistant_tokens?: number;
    tool_chars?: number;
    tool_tokens?: number;
    thinking_chars?: number;
    thinking_tokens?: number;
  };
  recommendation: string;
}

export interface ContextBudgetEnforceResult {
  status: string;
  conversation_id: string;
  action_taken: boolean;
  initial_tokens: number;
  final_tokens: number;
  tokens_saved: number;
  reduction_pct: number;
  stages_applied: string[];
  compacted_steps: number;
}

export async function getContextBudget(
  conversationId: string,
  budgetTokens?: number
): Promise<ContextBudgetInfo> {
  const query = budgetTokens ? `?budget_tokens=${encodeURIComponent(budgetTokens)}` : '';
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/context-budget${query}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de récupération du budget de contexte' }));
    throw new Error(err.detail || 'Impossible de récupérer le budget de contexte');
  }
  return res.json();
}

export async function enforceContextBudget(
  conversationId: string,
  budgetTokens?: number,
  preserveLastNTurns?: number
): Promise<ContextBudgetEnforceResult> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/context-budget/enforce`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      budget_tokens: budgetTokens,
      preserve_last_n_turns: preserveLastNTurns
    })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'application du budget de contexte" }));
    throw new Error(err.detail || "Impossible d'appliquer le budget de contexte");
  }
  return res.json();
}

export interface BulkActionPayload {
  action: 'delete' | 'pin' | 'unpin' | 'archive' | 'unarchive' | 'tag' | 'project' | 'export';
  conversation_ids: string[];
  payload?: {
    tags?: string[];
    mode?: 'add' | 'replace';
    project?: string;
    projectColor?: string;
  };
}

export async function bulkConversationAction(data: BulkActionPayload): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/bulk`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(data)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'action groupée" }));
    throw new Error(err.detail || "Impossible d'exécuter l'action groupée");
  }
  const result = await res.json();
  if (result && result.success === false) {
    throw new Error(result.detail || result.error || "Échec de l'action groupée");
  }
  return result;
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    try {
      a.click();
    } finally {
      if (a.parentNode) {
        a.parentNode.removeChild(a);
      }
    }
  } finally {
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 2000);
  }
}

export async function bulkConversationExport(conversationIds: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/bulk/export`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'export', conversation_ids: conversationIds })
  });
  if (!res.ok) throw new Error("Échec de l'export groupé");
  const blob = await res.blob();
  triggerFileDownload(blob, `antigravity_bulk_export_${Date.now()}.json`);
}

export function getExportHtmlUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/html${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getExportMarkdownUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/markdown${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getExportJsonUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/json${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

// Artifacts
export async function fetchArtifacts(conversationId?: string): Promise<ArtifactItem[]> {
  const url = conversationId 
    ? `${API_BASE}/artifacts?conversation_id=${encodeURIComponent(conversationId)}`
    : `${API_BASE}/artifacts`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load artifacts: ${res.statusText}`);
  return res.json();
}

export async function fetchArtifactContent(conversationId: string, filename: string): Promise<string> {
  const encodedPath = filename.split('/').map(encodeURIComponent).join('/');
  const res = await fetch(`${API_BASE}/artifacts/${encodeURIComponent(conversationId)}/${encodedPath}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to read artifact: ${res.statusText}`);
  const data = await res.json();
  return data.content;
}

// Settings
export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load settings: ${res.statusText}`);
  return res.json();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to save settings: ${res.statusText}`);
  return res.json();
}

export async function fetchModels(): Promise<ModelOption[]> {
  const res = await fetch(`${API_BASE}/settings/models`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load models: ${res.statusText}`);
  return res.json();
}

// Workspaces
export async function fetchWorkspaces(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/workspaces`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to load workspaces: ${res.statusText}`);
  }
  return res.json();
}

export async function addWorkspace(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to add workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function deleteWorkspace(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to delete workspace: ${res.statusText}`);
  }
  return res.json();
}

export async function exploreDirectory(path?: string): Promise<WorkspaceFolder> {
  const url = path ? `${API_BASE}/workspaces/explore?path=${encodeURIComponent(path)}` : `${API_BASE}/workspaces/explore`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to explore directory: ${res.statusText}`);
  }
  return res.json();
}

// Files & Workspace Explorer
export async function fetchFileTree(path?: string, depth = 2): Promise<{ root: string; name: string; items: any[] }> {
  const url = path 
    ? `${API_BASE}/files/tree?path=${encodeURIComponent(path)}&depth=${depth}`
    : `${API_BASE}/files/tree?depth=${depth}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to load file tree: ${res.statusText}`);
  return res.json();
}

export async function fetchFileContent(path: string, workspace?: string): Promise<{
  path: string;
  filename: string;
  extension: string;
  size: number;
  last_modified: number;
  content: string;
}> {
  const url = workspace
    ? `${API_BASE}/files/content?path=${encodeURIComponent(path)}&workspace=${encodeURIComponent(workspace)}`
    : `${API_BASE}/files/content?path=${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load file content: ${res.statusText}`);
  return res.json();
}

export async function saveFileContent(path: string, content: string, workspace?: string): Promise<{ success: boolean; path: string; size: number; last_modified: number }> {
  const res = await fetch(`${API_BASE}/files/save`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la sauvegarde' }));
    throw new Error(err.detail || 'Erreur lors de la sauvegarde du fichier');
  }
  return res.json();
}

export async function createFile(path: string, content = '', workspace?: string): Promise<{ success: boolean; path: string; filename: string; size: number; last_modified: number }> {
  const res = await fetch(`${API_BASE}/files/create`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du fichier' }));
    throw new Error(err.detail || 'Erreur lors de la création du fichier');
  }
  return res.json();
}

export async function createDirectory(path: string, workspace?: string): Promise<{ success: boolean; path: string; name?: string; already_existed?: boolean }> {
  const res = await fetch(`${API_BASE}/files/create-dir`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du dossier' }));
    throw new Error(err.detail || 'Erreur lors de la création du dossier');
  }
  return res.json();
}

export async function renameFile(oldPath: string, newPath: string, workspace?: string): Promise<{ success: boolean; old_path: string; new_path: string; name: string; is_dir: boolean }> {
  const res = await fetch(`${API_BASE}/files/rename`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ old_path: oldPath, new_path: newPath, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du renommage' }));
    throw new Error(err.detail || 'Erreur lors du renommage');
  }
  return res.json();
}

export async function deleteFile(path: string, workspace?: string): Promise<{ success: boolean; path: string; was_dir: boolean }> {
  const res = await fetch(`${API_BASE}/files/delete`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression' }));
    throw new Error(err.detail || 'Erreur lors de la suppression');
  }
  return res.json();
}

export async function searchFiles(query: string, path?: string, maxResults = 50): Promise<{ query: string; results: any[]; total: number }> {
  const params = new URLSearchParams({ q: query, max_results: String(maxResults) });
  if (path) params.append('path', path);
  const res = await fetch(`${API_BASE}/files/search?${params.toString()}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la recherche' }));
    throw new Error(err.detail || 'Erreur lors de la recherche');
  }
  return res.json();
}

export async function uploadWorkspaceFile(
  file: File,
  destinationDir: string,
  workspace?: string
): Promise<{ success: boolean; path: string; filename: string; size: number }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('destination_dir', destinationDir);
  if (workspace) {
    formData.append('workspace', workspace);
  }

  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}/files/upload`, {
    method: 'POST',
    headers,
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'importation du fichier" }));
    throw new Error(err.detail || "Erreur lors de l'importation du fichier");
  }
  return res.json();
}

export async function duplicateWorkspaceFile(
  path: string,
  workspace?: string
): Promise<{ success: boolean; new_path: string; new_name: string; size: number }> {
  const res = await fetch(`${API_BASE}/files/duplicate`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, workspace }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la duplication' }));
    throw new Error(err.detail || 'Erreur lors de la duplication du fichier');
  }
  return res.json();
}


// Tasks & Subagents Monitoring
export async function fetchTasksList(conversationId?: string): Promise<{ tasks: any[]; subagents: any[]; processes: any[] }> {
  const url = conversationId
    ? `${API_BASE}/tasks/list?conversation_id=${encodeURIComponent(conversationId)}`
    : `${API_BASE}/tasks/list`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to load tasks: ${res.statusText}`);
  }
  return res.json();
}

export async function killTask(pid?: number, taskId?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/tasks/kill`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pid, task_id: taskId })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to kill task: ${res.statusText}`);
  }
  return res.json();
}

// Skills Management
export async function fetchSkills(): Promise<any[]> {
  const res = await fetch(`${API_BASE}/skills`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to load skills: ${res.statusText}`);
  return res.json();
}

export async function fetchSkillDetail(skillId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(skillId)}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load skill details: ${res.statusText}`);
  return res.json();
}

// Git Cockpit API
export interface GitStatusResult {
  is_repo: boolean;
  workspace: string;
  branch: string;
  tracking?: string | null;
  ahead: number;
  behind: number;
  clean: boolean;
  is_clean?: boolean;
  conflicts?: string[];
  modified: string[];
  staged: string[];
  untracked: string[];
  deleted: string[];
  modified_count?: number;
  staged_count?: number;
  untracked_count?: number;
  deleted_count?: number;
  last_commit?: {
    hash: string;
    author: string;
    subject: string;
    time: string;
  } | null;
  message?: string;
}

export async function fetchGitStatus(workspace?: string): Promise<GitStatusResult> {
  const url = workspace ? `${API_BASE}/git/status?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/status`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch Git status: ${res.statusText}`);
  return res.json();
}

export async function fetchGitDiff(
  workspace?: string,
  path?: string,
  staged: boolean = false,
  commit?: string
): Promise<{ workspace: string; path?: string; commit?: string; diff: string; truncated?: boolean }> {
  const params = new URLSearchParams();
  if (workspace) params.append('workspace', workspace);
  if (path) params.append('path', path);
  if (staged) params.append('staged', 'true');
  if (commit) params.append('commit', commit);
  const res = await fetch(`${API_BASE}/git/diff?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch Git diff: ${res.statusText}`);
  return res.json();
}

export async function fetchGitFileVersions(
  workspace?: string,
  filePath?: string,
  commit?: string,
  staged?: boolean
): Promise<GitFileVersionsResponse> {
  const params = new URLSearchParams();
  if (filePath) params.set('path', filePath);
  if (workspace) params.set('workspace', workspace);
  if (commit) params.set('commit', commit);
  if (staged) params.set('staged', 'true');

  const res = await fetch(`${API_BASE}/git/file-versions?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Impossible de récupérer les versions du fichier');
  }
  return res.json();
}

export async function fetchGitDiffRanges(
  filePath: string,
  workspace?: string
): Promise<GitDiffRangesResponse> {
  const params = new URLSearchParams();
  params.set('file_path', filePath);
  if (workspace) params.set('workspace', workspace);

  const res = await fetch(`${API_BASE}/git/file-diff-ranges?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.detail || 'Impossible de récupérer les plages de modifications Git');
  }
  return res.json();
}


export async function fetchGitBranches(workspace?: string): Promise<GitBranchesResponse> {
  const url = workspace ? `${API_BASE}/git/branches?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/branches`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch branches: ${res.statusText}`);
  return res.json();
}

export async function gitCommit(message: string, workspace?: string, stageAll: boolean = true): Promise<{ success: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/git/commit`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ message, workspace, stage_all: stageAll })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du commit' }));
    throw new Error(err.detail || 'Erreur lors du commit');
  }
  return res.json();
}

export async function gitPush(workspace?: string, remote: string = 'origin', branch?: string): Promise<{ success: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/git/push`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace, remote, branch })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du push' }));
    throw new Error(err.detail || 'Erreur lors du push');
  }
  return res.json();
}

export async function gitPull(workspace?: string, remote: string = 'origin', branch?: string, rebase: boolean = false): Promise<{ success: boolean; output: string }> {
  const res = await fetch(`${API_BASE}/git/pull`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace, remote, branch, rebase })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du pull' }));
    throw new Error(err.detail || 'Erreur lors du pull');
  }
  return res.json();
}

export async function fetchGitTags(workspace?: string): Promise<GitTagDetail[]> {
  const url = workspace ? `${API_BASE}/git/tags?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/tags`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch Git tags: ${res.statusText}`);
  return res.json();
}

export async function gitCreateTag(tag: string, message?: string, push: boolean = false, workspace?: string): Promise<{ success: boolean; tag: string; output: string; push_output?: string }> {
  const res = await fetch(`${API_BASE}/git/tag`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ tag, message, push, workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du tag' }));
    throw new Error(err.detail || 'Erreur lors de la création du tag');
  }
  return res.json();
}

export interface GitCommitItem {
  hash: string;
  short_hash: string;
  author: string;
  email: string;
  timestamp: number;
  subject: string;
  body: string;
}

export interface GitLogResult {
  is_repo: boolean;
  workspace: string;
  commits: GitCommitItem[];
  total: number;
}

export async function fetchGitLog(
  workspace?: string,
  limit: number = 25,
  skip: number = 0,
  branch?: string,
  path?: string
): Promise<GitLogResult> {
  const params = new URLSearchParams();
  if (workspace) params.append('workspace', workspace);
  if (limit) params.append('limit', String(limit));
  if (skip) params.append('skip', String(skip));
  if (branch) params.append('branch', branch);
  if (path) params.append('path', path);
  const res = await fetch(`${API_BASE}/git/log?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération de l\'historique Git' }));
    throw new Error(err.detail || 'Erreur lors de la récupération de l\'historique Git');
  }
  return res.json();
}

export async function fetchGitStashes(workspace?: string): Promise<GitStashItem[]> {
  const url = workspace ? `${API_BASE}/git/stash?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/stash`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération des stashes' }));
    throw new Error(err.detail || 'Erreur lors de la récupération des stashes');
  }
  return res.json();
}

export async function saveGitStash(payload: StashSaveRequest): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/git/stash`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du stash' }));
    throw new Error(err.detail || 'Erreur lors de la création du stash');
  }
  return res.json();
}

export async function popGitStash(payload: StashActionRequest): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/git/stash/pop`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du dépilage du stash' }));
    throw new Error(err.detail || 'Erreur lors du dépilage du stash');
  }
  return res.json();
}

export async function applyGitStash(payload: StashActionRequest): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/git/stash/apply`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'application du stash" }));
    throw new Error(err.detail || "Erreur lors de l'application du stash");
  }
  return res.json();
}

export async function dropGitStash(workspace?: string, index?: number): Promise<{ status: string; message: string }> {
  const params = new URLSearchParams();
  if (workspace) params.append('workspace', workspace);
  if (index !== undefined) params.append('index', String(index));
  const res = await fetch(`${API_BASE}/git/stash?${params.toString()}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression du stash' }));
    throw new Error(err.detail || 'Erreur lors de la suppression du stash');
  }
  return res.json();
}

export async function fetchGitStashDiff(
  workspace?: string,
  index: number = 0,
  path?: string
): Promise<{ diff: string; index: number }> {
  const params = new URLSearchParams();
  if (workspace) params.append('workspace', workspace);
  params.append('index', String(index));
  if (path) params.append('path', path);
  const res = await fetch(`${API_BASE}/git/stash/diff?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération du diff de stash' }));
    throw new Error(err.detail || 'Erreur lors de la récupération du diff de stash');
  }
  return res.json();
}

export async function fetchConflictFileInfo(
  path: string,
  workspace?: string
): Promise<ConflictFileInfo> {
  const params = new URLSearchParams({ path });
  if (workspace) params.append('workspace', workspace);
  const res = await fetch(`${API_BASE}/git/conflicts/file?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération des détails de conflit' }));
    throw new Error(err.detail || 'Erreur lors de la récupération du conflit');
  }
  return res.json();
}

export async function resolveGitConflict(
  payload: ResolveConflictRequest
): Promise<{ status: string; file_path: string }> {
  const res = await fetch(`${API_BASE}/git/conflicts/resolve`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la résolution du conflit' }));
    throw new Error(err.detail || 'Erreur lors de la résolution du conflit');
  }
  return res.json();
}

export async function cherryPickCommit(
  payload: CherryPickRequest
): Promise<CherryPickResponse> {
  const res = await fetch(`${API_BASE}/git/cherry-pick`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du cherry-pick' }));
    throw new Error(err.detail || 'Erreur lors du cherry-pick');
  }
  return res.json();
}

export async function abortCherryPick(
  workspace?: string
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/git/cherry-pick/abort`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'annulation du cherry-pick" }));
    throw new Error(err.detail || "Erreur lors de l'annulation du cherry-pick");
  }
  return res.json();
}

export async function continueCherryPick(
  workspace?: string
): Promise<{ status: string; message: string }> {
  const res = await fetch(`${API_BASE}/git/cherry-pick/continue`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la poursuite du cherry-pick' }));
    throw new Error(err.detail || 'Erreur lors de la poursuite du cherry-pick');
  }
  return res.json();
}

// Branch Management API
export async function checkoutGitBranch(payload: BranchCheckoutRequest): Promise<BranchActionResponse> {
  const res = await fetch(`${API_BASE}/git/branches/checkout`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la bascule de branche' }));
    throw new Error(err.detail || 'Erreur lors de la bascule de branche');
  }
  return res.json();
}

export async function createGitBranch(payload: BranchCreateRequest): Promise<BranchActionResponse> {
  const res = await fetch(`${API_BASE}/git/branches/create`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création de la branche' }));
    throw new Error(err.detail || 'Erreur lors de la création de la branche');
  }
  return res.json();
}

export async function deleteGitBranch(payload: BranchDeleteRequest): Promise<BranchActionResponse> {
  const res = await fetch(`${API_BASE}/git/branches`, {
    method: 'DELETE',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression de la branche' }));
    throw new Error(err.detail || 'Erreur lors de la suppression de la branche');
  }
  return res.json();
}

export async function mergeGitBranch(payload: BranchMergeRequest): Promise<BranchActionResponse> {
  const res = await fetch(`${API_BASE}/git/branches/merge`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la fusion de la branche' }));
    throw new Error(err.detail || 'Erreur lors de la fusion');
  }
  return res.json();
}

export async function renameGitBranch(payload: BranchRenameRequest): Promise<BranchActionResponse> {
  const res = await fetch(`${API_BASE}/git/branches/rename`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du renommage de la branche' }));
    throw new Error(err.detail || 'Erreur lors du renommage');
  }
  return res.json();
}

// Interactive Rebase API
export async function fetchRebaseTodo(base: string, workspace?: string): Promise<RebaseTodoResponse> {
  const params = new URLSearchParams({ base });
  if (workspace) params.append('workspace', workspace);
  const res = await fetch(`${API_BASE}/git/rebase/todo?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération des commits pour le rebase' }));
    throw new Error(err.detail || 'Erreur lors du chargement des commits');
  }
  return res.json();
}

export async function executeGitRebase(payload: RebaseExecuteRequest): Promise<RebaseExecuteResponse> {
  const res = await fetch(`${API_BASE}/git/rebase/execute`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du rebase' }));
    throw new Error(err.detail || 'Erreur lors du rebase');
  }
  return res.json();
}

export async function fetchRebaseStatus(workspace?: string): Promise<RebaseStatusResponse> {
  const url = workspace ? `${API_BASE}/git/rebase/status?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/rebase/status`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération du statut du rebase' }));
    throw new Error(err.detail || 'Erreur statut rebase');
  }
  return res.json();
}

export async function continueGitRebase(workspace?: string): Promise<RebaseExecuteResponse> {
  const res = await fetch(`${API_BASE}/git/rebase/continue`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la poursuite du rebase' }));
    throw new Error(err.detail || 'Erreur lors du rebase --continue');
  }
  return res.json();
}

export async function abortGitRebase(workspace?: string): Promise<RebaseExecuteResponse> {
  const res = await fetch(`${API_BASE}/git/rebase/abort`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ workspace })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'annulation du rebase" }));
    throw new Error(err.detail || "Erreur lors de l'annulation du rebase");
  }
  return res.json();
}

// Kanban API
export interface KanbanTask {
  id: string;
  title: string;
  body?: string;
  assignee?: string;
  status: string;
  priority: number;
  created_by?: string;
  created_at: number;
  started_at?: number;
  completed_at?: number;
  workspace_kind?: string;
  workspace_path?: string;
  project_id?: string;
  result?: string;
}

export interface KanbanBoardData {
  tasks: KanbanTask[];
  columns: {
    todo: KanbanTask[];
    running: KanbanTask[];
    blocked: KanbanTask[];
    done: KanbanTask[];
  };
  count: number;
  db_path: string;
}

export async function fetchKanbanTasks(projectId?: string, status?: string): Promise<KanbanBoardData> {
  const params = new URLSearchParams();
  if (projectId) params.append('project_id', projectId);
  if (status) params.append('status', status);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/kanban/tasks${query}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch kanban tasks: ${res.statusText}`);
  return res.json();
}

export async function createKanbanTask(task: {
  title: string;
  body?: string;
  assignee?: string;
  status?: string;
  priority?: number;
  workspace_path?: string;
  project_id?: string;
}): Promise<{ success: boolean; task: KanbanTask }> {
  const res = await fetch(`${API_BASE}/kanban/tasks`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(task)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de création de la tâche' }));
    throw new Error(err.detail || 'Erreur création tâche');
  }
  return res.json();
}

export async function updateKanbanTask(
  taskId: string,
  updates: Partial<KanbanTask>
): Promise<{ success: boolean; task: KanbanTask }> {
  const res = await fetch(`${API_BASE}/kanban/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec mise à jour tâche' }));
    throw new Error(err.detail || 'Erreur mise à jour tâche');
  }
  return res.json();
}

export async function deleteKanbanTask(taskId: string): Promise<{ success: boolean; task_id: string }> {
  const res = await fetch(`${API_BASE}/kanban/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec suppression tâche' }));
    throw new Error(err.detail || 'Erreur suppression tâche');
  }
  return res.json();
}

// Cron Jobs API
export interface CronJobItem {
  id: string;
  name: string;
  prompt: string;
  schedule: {
    kind: string;
    expr?: string;
    display?: string;
  };
  schedule_display?: string;
  skills?: string[];
  model?: string | null;
  effort?: string | null;
  enabled: boolean;
  state: 'scheduled' | 'paused';
  created_at: string;
  next_run_at?: string | null;
  last_run_at?: string | null;
  last_status?: string | null;
  last_duration_seconds?: number | null;
  last_log?: string | null;
  deliver?: string;
}

export interface CronJobLogResponse {
  job_id: string;
  has_log: boolean;
  file?: string | null;
  mtime?: number | null;
  content: string;
}

export interface CronListResponse {
  jobs: CronJobItem[];
  ticker_status: 'active' | 'idle' | 'stale';
  heartbeat_age_seconds?: number | null;
  jobs_file: string;
}

export async function fetchCronJobs(): Promise<CronListResponse> {
  const res = await fetch(`${API_BASE}/crons`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch cron jobs: ${res.statusText}`);
  return res.json();
}

export async function createCronJob(job: {
  name: string;
  prompt: string;
  schedule: string;
  deliver?: string;
  skills?: string[];
  model?: string | null;
  effort?: string | null;
}): Promise<{ success: boolean; job: CronJobItem }> {
  const res = await fetch(`${API_BASE}/crons`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(job)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec création job cron' }));
    throw new Error(err.detail || 'Erreur création cron');
  }
  return res.json();
}

export async function updateCronJob(
  jobId: string,
  updates: {
    name?: string;
    prompt?: string;
    schedule?: string;
    state?: string;
    skills?: string[];
    model?: string | null;
    effort?: string | null;
  }
): Promise<{ success: boolean; job: CronJobItem }> {
  const res = await fetch(`${API_BASE}/crons/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(updates)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec mise à jour job cron' }));
    throw new Error(err.detail || 'Erreur mise à jour cron');
  }
  return res.json();
}

export async function deleteCronJob(jobId: string): Promise<{ success: boolean; job_id: string }> {
  const res = await fetch(`${API_BASE}/crons/${encodeURIComponent(jobId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec suppression job cron' }));
    throw new Error(err.detail || 'Erreur suppression cron');
  }
  return res.json();
}

export async function triggerCronJob(jobId: string): Promise<{ success: boolean; message: string; prompt: string }> {
  const res = await fetch(`${API_BASE}/crons/${encodeURIComponent(jobId)}/run`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec déclenchement job cron' }));
    throw new Error(err.detail || 'Erreur déclenchement cron');
  }
  return res.json();
}

export async function fetchCronJobLog(jobId: string): Promise<CronJobLogResponse> {
  const res = await fetch(`${API_BASE}/crons/${encodeURIComponent(jobId)}/log`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec récupération du journal' }));
    throw new Error(err.detail || 'Erreur récupération journal');
  }
  return res.json();
}

// Rules & Memory API
export interface RuleFileItem {
  id: string;
  name: string;
  description: string;
  path: string;
  syntax: 'markdown' | 'json';
  exists: boolean;
  size: number;
  last_modified: number;
  read_only?: boolean;
}

export async function fetchRulesFiles(workspacePath?: string): Promise<{ files: RuleFileItem[] }> {
  const params = workspacePath ? `?workspace_path=${encodeURIComponent(workspacePath)}` : '';
  const res = await fetch(`${API_BASE}/rules/files${params}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to fetch rules files: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchRuleContent(
  fileId: string,
  workspacePath?: string
): Promise<{ file_id: string; path: string; content: string; exists: boolean; syntax: 'markdown' | 'json'; size?: number; last_modified?: number; read_only?: boolean }> {
  const params = new URLSearchParams({ file_id: fileId });
  if (workspacePath) params.append('workspace_path', workspacePath);
  const res = await fetch(`${API_BASE}/rules/content?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail || err?.message || `Failed to fetch rule content: ${res.statusText}`);
  }
  return res.json();
}

export async function saveRuleContent(
  fileId: string,
  content: string,
  workspacePath?: string
): Promise<{ success: boolean; message: string; path: string; size: number }> {
  const res = await fetch(`${API_BASE}/rules/content`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ file_id: fileId, content, workspace_path: workspacePath })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec sauvegarde fichier' }));
    throw new Error(err.detail || 'Erreur lors de la sauvegarde');
  }
  return res.json();
}

// Google Accounts Multi-Account Management
export interface GoogleAccountInfo {
  email: string;
  email_verified?: boolean;
  sub?: string;
  expiry?: string;
  auth_method?: string;
  is_active?: boolean;
  last_modified?: number;
}

export interface GoogleAccountsResponse {
  active_account: GoogleAccountInfo | null;
  accounts: GoogleAccountInfo[];
  total: number;
}

export async function fetchGoogleAccounts(): Promise<GoogleAccountsResponse> {
  const res = await fetch(`${API_BASE}/google/accounts`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Erreur lors de la récupération des comptes Google' }));
    throw new Error(err.detail || 'Erreur lors de la récupération des comptes Google');
  }
  return res.json();
}

export async function switchGoogleAccount(email: string): Promise<any> {
  const res = await fetch(`${API_BASE}/google/accounts/switch`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ email })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du basculement' }));
    throw new Error(err.detail || 'Impossible de changer de compte Google');
  }
  return res.json();
}

export async function deleteGoogleAccount(email: string): Promise<any> {
  const res = await fetch(`${API_BASE}/google/accounts?email=${encodeURIComponent(email)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec suppression' }));
    throw new Error(err.detail || 'Impossible de supprimer le compte Google');
  }
  return res.json();
}

export async function startGoogleLogin(): Promise<{ session_id: string; auth_url: string; timeout_seconds: number }> {
  const res = await fetch(`${API_BASE}/google/accounts/login/start`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec initialisation' }));
    throw new Error(err.detail || 'Impossible de démarrer la connexion Google');
  }
  return res.json();
}

export async function submitGoogleAuthCode(sessionId: string, code: string): Promise<any> {
  const res = await fetch(`${API_BASE}/google/accounts/login/submit`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: sessionId, code })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Code invalide' }));
    throw new Error(err.detail || 'Code de validation Google incorrect ou expiré');
  }
  return res.json();
}

export async function cancelGoogleLogin(sessionId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/google/accounts/login/cancel`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: sessionId })
  });
  return res.json();
}

export async function importConversation(payload: any): Promise<{
  success: boolean;
  conversation_id: string;
  title: string;
  steps_count: number;
}> {
  const res = await fetch(`${API_BASE}/conversations/import`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'import" }));
    throw new Error(err.detail || "Impossible d'importer la conversation");
  }
  return res.json();
}

export async function exportConversationHtml(conversationId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/html`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'export HTML");
  return res.blob();
}

export async function exportConversationMarkdown(conversationId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/markdown`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'export Markdown");
  return res.blob();
}

export async function exportConversationJSON(conversationId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/export/json`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'export JSON");
  return res.blob();
}

export async function exportConversationsZip(conversationIds?: string[]): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/export/zip`, {
    method: 'POST',
    headers: { ...getHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'export_zip', conversation_ids: conversationIds || [] })
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'archive ZIP");
  return res.blob();
}

export async function fetchUsageQuota(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/usage`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Impossible de récupérer les quotas Antigravity");
  }
  return res.json();
}

export async function fetchCredits(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/credits`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Impossible de récupérer les crédits Antigravity");
  }
  return res.json();
}

export async function fetchChangelog(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/changelog`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Impossible de récupérer le changelog Antigravity");
  }
  return res.json();
}

export interface SystemVersionInfo {
  version: string;
  commit: string;
  branch: string;
  tag: string;
  commit_date: string;
  commit_message: string;
  repo_path: string;
}

export interface UpstreamCommit {
  sha: string;
  full_sha: string;
  summary: string;
  author: string;
  timestamp: number;
}

export interface UpdateCheckResult {
  install_method: string;
  current_version: string;
  current_commit: string;
  branch: string;
  tag: string;
  behind: number;
  update_available: boolean;
  can_apply: boolean;
  commits: UpstreamCommit[];
  checked_at: number;
  message: string;
}

export async function fetchSystemVersion(): Promise<SystemVersionInfo> {
  const res = await fetch(`${API_BASE}/system/version?t=${Date.now()}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Impossible de récupérer les informations de version");
  }
  return res.json();
}

export async function checkSystemUpdate(force: boolean = false): Promise<UpdateCheckResult> {
  const url = `${API_BASE}/system/update/check${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || "Impossible de vérifier les mises à jour");
  }
  return res.json();
}

export async function applySystemUpdate(): Promise<any> {
  const res = await fetch(`${API_BASE}/system/update/apply`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la mise à jour' }));
    throw new Error(err.detail || 'Erreur lors de la mise à jour');
  }
  return res.json();
}

// ==========================================
// Session Branches & Memory Bookmarks API
// ==========================================

export interface ConversationBranchNode {
  conversation_id: string;
  title: string;
  preview: string;
  step_count: number;
  last_modified_time: string;
  parent_conversation_id: string | null;
  project_id?: string;
  group_id?: string;
  is_current: boolean;
  is_root: boolean;
  bookmarks: BookmarkItem[];
  children: ConversationBranchNode[];
}

export interface BranchTreeResult {
  root_id: string;
  current_id: string;
  total_branches: number;
  tree: ConversationBranchNode | null;
  all_bookmarks: BookmarkItem[];
}

export async function fetchConversationBranches(conversationId: string): Promise<BranchTreeResult> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/branches`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du chargement des branches' }));
    throw new Error(err.detail || 'Impossible de charger les branches');
  }
  return res.json();
}

export async function addConversationBookmark(
  conversationId: string,
  stepIndex: number,
  label: string,
  preview?: string
): Promise<{ success: boolean; bookmark: BookmarkItem; bookmarks: BookmarkItem[] }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/bookmarks`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ step_index: stepIndex, label, preview })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'ajout du marque-page" }));
    throw new Error(err.detail || "Impossible d'ajouter le marque-page");
  }
  return res.json();
}

export async function removeConversationBookmark(
  conversationId: string,
  bookmarkId: string
): Promise<{ success: boolean; bookmarks: BookmarkItem[] }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/bookmarks/${encodeURIComponent(bookmarkId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de suppression du marque-page' }));
    throw new Error(err.detail || 'Impossible de supprimer le marque-page');
  }
  return res.json();
}

// ==========================================
// Multi-Shell Terminal API
// ==========================================

export interface TerminalShellInfo {
  id: string;
  name: string;
  command: string;
  available: boolean;
  icon?: string;
}

export interface TerminalShellsResponse {
  platform: string;
  default_shell: string;
  available_shells: TerminalShellInfo[];
}

export async function fetchTerminalShells(): Promise<TerminalShellsResponse> {
  const res = await fetch(`${API_BASE}/terminal/shells`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du chargement des shells' }));
    throw new Error(err.detail || 'Impossible de charger la liste des terminaux');
  }
  return res.json();
}

export async function deleteTerminalSession(sessionId: string): Promise<{ success: boolean; session_id: string }> {
  const res = await fetch(`${API_BASE}/terminal/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de fermeture de session terminal' }));
    throw new Error(err.detail || 'Impossible de clore la session terminal');
  }
  return res.json();
}

export async function analyzePrompt(prompt: string): Promise<PromptAnalysisResponse> {
  const res = await fetch(`${API_BASE}/prompt/analyze`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de l\'analyse du prompt' }));
    throw new Error(err.detail || 'Impossible d\'analyser le prompt');
  }
  return res.json();
}

export async function optimizePrompt(
  prompt: string,
  preset: string = 'general',
  model?: string
): Promise<PromptOptimizationResponse> {
  const res = await fetch(`${API_BASE}/prompt/optimize`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ prompt, preset, model })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de l\'optimisation du prompt' }));
    throw new Error(err.detail || 'Impossible d\'optimiser le prompt');
  }
  return res.json();
}

export async function searchWorkspaceFiles(
  payload: WorkspaceSearchRequest
): Promise<WorkspaceSearchResponse> {
  const res = await fetch(`${API_BASE}/files/workspace-search`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la recherche dans le workspace' }));
    throw new Error(err.detail || 'Erreur lors de la recherche dans le workspace');
  }
  return res.json();
}

export async function replaceWorkspaceFiles(
  payload: WorkspaceReplaceRequest
): Promise<WorkspaceReplaceResponse> {
  const res = await fetch(`${API_BASE}/files/workspace-replace`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du remplacement dans le workspace' }));
    throw new Error(err.detail || 'Erreur lors du remplacement dans le workspace');
  }
  return res.json();
}

export async function replaceSingleOccurrence(
  payload: SingleReplaceRequest
): Promise<SingleReplaceResponse> {
  const res = await fetch(`${API_BASE}/files/single-replace`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec du remplacement de l'occurrence" }));
    throw new Error(err.detail || "Erreur lors du remplacement de l'occurrence");
  }
  return res.json();
}

// ==========================================
// AI Inline Copilot & Ghost Text
// ==========================================

export async function fetchInlineCompletion(
  payload: InlineSuggestRequest,
  signal?: AbortSignal
): Promise<InlineSuggestResponse> {
  const res = await fetch(`${API_BASE}/copilot/inline-suggest`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suggestion inline' }));
    throw new Error(err.detail || 'Erreur lors de la suggestion inline');
  }
  return res.json();
}

export async function executeCopilotAction(
  payload: CopilotActionRequest,
  signal?: AbortSignal
): Promise<CopilotActionResponse> {
  const res = await fetch(`${API_BASE}/copilot/action`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'action Copilot" }));
    throw new Error(err.detail || "Erreur lors de l'exécution de l'action Copilot");
  }
  return res.json();
}

export async function fetchCopilotStatus(): Promise<CopilotStatusResponse> {
  const res = await fetch(`${API_BASE}/copilot/status`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Impossible de récupérer le statut Copilot');
  }
  return res.json();
}

// Workspace & Project Switcher Studio API
export async function fetchWorkspaceProjects(activePath?: string): Promise<WorkspaceProjectDetail[]> {
  const query = activePath ? `?active_path=${encodeURIComponent(activePath)}` : '';
  const res = await fetch(`${API_BASE}/workspaces/details${query}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de récupération des projets' }));
    throw new Error(err.detail || 'Erreur lors de la récupération des projets');
  }
  return res.json();
}

export async function fetchProjectHealth(path: string): Promise<ProjectHealthDiagnostic> {
  const res = await fetch(`${API_BASE}/workspaces/health?path=${encodeURIComponent(path)}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du diagnostic de santé' }));
    throw new Error(err.detail || 'Erreur lors du diagnostic de santé du projet');
  }
  return res.json();
}

export async function setDefaultWorkspace(path: string): Promise<{ status: string; default_workspace: string }> {
  const res = await fetch(`${API_BASE}/workspaces/default?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de définition du workspace par défaut' }));
    throw new Error(err.detail || 'Erreur lors de la configuration du workspace par défaut');
  }
  return res.json();
}

export async function addWorkspaceProject(path: string): Promise<{ status: string; workspaces: string[] }> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'ajout du workspace" }));
    throw new Error(err.detail || "Erreur lors de l'ajout du workspace");
  }
  return res.json();
}

export async function removeWorkspaceProject(path: string): Promise<{ status: string; workspaces: string[] }> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de suppression du workspace' }));
    throw new Error(err.detail || 'Erreur lors de la suppression du workspace');
  }
  return res.json();
}

export async function exploreWorkspaceDirectory(
  path?: string
): Promise<{ current_path: string; parent_path: string | null; entries: Array<{ name: string; path: string; is_dir: boolean; size?: number | null }> }> {
  const query = path ? `?path=${encodeURIComponent(path)}` : '';
  const res = await fetch(`${API_BASE}/workspaces/explore${query}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec d'exploration du dossier" }));
    throw new Error(err.detail || "Erreur lors de l'exploration du dossier");
  }
  return res.json();
}

// ==========================================
// Git Remotes & Tags Client API
// ==========================================

export async function fetchGitRemotes(workspace?: string): Promise<GitRemoteDetail[]> {
  const url = workspace ? `${API_BASE}/git/remotes?workspace=${encodeURIComponent(workspace)}` : `${API_BASE}/git/remotes`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la récupération des remotes' }));
    throw new Error(err.detail || 'Erreur lors de la récupération des remotes');
  }
  return res.json();
}

export async function createGitRemote(payload: CreateRemotePayload): Promise<GitRemoteDetail> {
  const res = await fetch(`${API_BASE}/git/remotes`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du remote' }));
    throw new Error(err.detail || 'Erreur lors de la création du remote');
  }
  return res.json();
}

export async function updateGitRemote(name: string, payload: UpdateRemotePayload): Promise<GitRemoteDetail> {
  const res = await fetch(`${API_BASE}/git/remotes/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la mise à jour du remote' }));
    throw new Error(err.detail || 'Erreur lors de la mise à jour du remote');
  }
  return res.json();
}

export async function deleteGitRemote(name: string, workspace?: string): Promise<{ success: boolean; message: string }> {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
  const res = await fetch(`${API_BASE}/git/remotes/${encodeURIComponent(name)}${query}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression du remote' }));
    throw new Error(err.detail || 'Erreur lors de la suppression du remote');
  }
  return res.json();
}

export async function testGitRemoteConnection(
  name: string,
  workspace?: string
): Promise<{ success: boolean; latency_ms: number; output?: string; error?: string }> {
  const query = workspace ? `?workspace=${encodeURIComponent(workspace)}` : '';
  const res = await fetch(`${API_BASE}/git/remotes/${encodeURIComponent(name)}/test${query}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du test de connexion du remote' }));
    throw new Error(err.detail || 'Erreur lors du test de connexion');
  }
  return res.json();
}

export async function fetchGitRemote(payload: RemoteActionPayload): Promise<{ success: boolean; output: string }> {
  const remotePath = payload.remote ? `/${encodeURIComponent(payload.remote)}/fetch` : '/fetch';
  const res = await fetch(`${API_BASE}/git/remotes${remotePath}`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du fetch remote' }));
    throw new Error(err.detail || 'Erreur lors du fetch');
  }
  return res.json();
}

export async function pushGitRemote(payload: RemoteActionPayload): Promise<{ success: boolean; output: string }> {
  const remotePath = payload.remote ? `/${encodeURIComponent(payload.remote)}/push` : '/push';
  const res = await fetch(`${API_BASE}/git/remotes${remotePath}`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du push remote' }));
    throw new Error(err.detail || 'Erreur lors du push');
  }
  return res.json();
}

export async function createGitTag(payload: CreateTagPayload): Promise<GitTagDetail> {
  const res = await fetch(`${API_BASE}/git/tags`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la création du tag' }));
    throw new Error(err.detail || 'Erreur lors de la création du tag');
  }
  return res.json();
}

export async function deleteGitTag(
  name: string,
  payload?: DeleteTagPayload
): Promise<{ success: boolean; message: string }> {
  const params = new URLSearchParams();
  if (payload?.delete_remote) params.append('delete_remote', 'true');
  if (payload?.remote_name) params.append('remote_name', payload.remote_name);
  if (payload?.workspace) params.append('workspace', payload.workspace);
  const query = params.toString() ? `?${params.toString()}` : '';

  const res = await fetch(`${API_BASE}/git/tags/${encodeURIComponent(name)}${query}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la suppression du tag' }));
    throw new Error(err.detail || 'Erreur lors de la suppression du tag');
  }
  return res.json();
}

export async function pushGitTag(
  name: string,
  remote: string = 'origin',
  workspace?: string
): Promise<{ success: boolean; output: string }> {
  const params = new URLSearchParams({ remote });
  if (workspace) params.append('workspace', workspace);
  const res = await fetch(`${API_BASE}/git/tags/${encodeURIComponent(name)}/push?${params.toString()}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du push du tag' }));
    throw new Error(err.detail || 'Erreur lors du push du tag');
  }
  return res.json();
}

export async function pushAllGitTags(
  remote: string = 'origin',
  workspace?: string
): Promise<{ success: boolean; output: string }> {
  const params = new URLSearchParams({ remote });
  if (workspace) params.append('workspace', workspace);
  const res = await fetch(`${API_BASE}/git/tags/push-all?${params.toString()}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec du push de tous les tags' }));
    throw new Error(err.detail || 'Erreur lors du push des tags');
  }
  return res.json();
}

export async function fetchReleaseNotes(
  tag: string,
  fromTag?: string,
  workspace?: string
): Promise<ReleaseNotesResponse> {
  const params = new URLSearchParams({ tag });
  if (fromTag) params.append('from_tag', fromTag);
  if (workspace) params.append('workspace', workspace);
  const res = await fetch(`${API_BASE}/git/releases/notes?${params.toString()}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la génération des notes de version' }));
    throw new Error(err.detail || 'Erreur lors de la génération des release notes');
  }
  return res.json();
}

export async function publishGitRelease(payload: PublishReleasePayload): Promise<PublishReleaseResponse> {
  const res = await fetch(`${API_BASE}/git/releases/publish`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la publication de la release' }));
    throw new Error(err.detail || 'Erreur lors de la publication de la release');
  }
  return res.json();
}

// ==========================================
// Continuous Memory (USER.md / MEMORY.md)
// ==========================================

export async function fetchMemoryStatus(): Promise<ContinuousMemoryStatus> {
  const res = await fetch(`${API_BASE}/memory`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de récupération de la mémoire continue' }));
    throw new Error(err.detail || 'Erreur mémoire continue');
  }
  return res.json();
}

export async function fetchMemorySnapshot(): Promise<{ snapshot: string; available: boolean }> {
  const res = await fetch(`${API_BASE}/memory/snapshot`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur snapshot mémoire');
  }
  return res.json();
}

export async function refreshMemorySnapshot(): Promise<{ success: boolean; snapshot: string; message: string }> {
  const res = await fetch(`${API_BASE}/memory/refresh-snapshot`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur rafraîchissement snapshot mémoire');
  }
  return res.json();
}

export async function executeMemoryOperation(payload: MemoryOperationPayload): Promise<any> {
  const res = await fetch(`${API_BASE}/memory`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de l\'opération mémoire' }));
    throw new Error(err.detail || 'Erreur opération mémoire');
  }
  return res.json();
}

// ==========================================
// Cross-Sessions FTS5 Search
// ==========================================

export async function searchFts(
  query: string,
  role?: string,
  sessionId?: string,
  project?: string,
  limit: number = 50
): Promise<FtsSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  if (role) params.append('role', role);
  if (sessionId) params.append('session_id', sessionId);
  if (project) params.append('project', project);

  const res = await fetch(`${API_BASE}/search/fts?${params.toString()}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la recherche plein-texte' }));
    throw new Error(err.detail || 'Erreur recherche FTS');
  }
  return res.json();
}

export async function reindexFts(): Promise<{ success: boolean; total_sessions: number; total_messages_indexed: number; took_ms: number }> {
  const res = await fetch(`${API_BASE}/search/fts/reindex`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur réindexation FTS');
  }
  return res.json();
}

export async function getFtsStats(): Promise<{ total_indexed_rows: number; indexed_sessions: number; engine: string }> {
  const res = await fetch(`${API_BASE}/search/fts/stats`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur statistiques FTS');
  }
  return res.json();
}

// ==========================================
// Tool Call Repair
// ==========================================

export async function previewToolRepair(text: string, allowedTools?: string[]): Promise<ToolRepairPreviewResponse> {
  const res = await fetch(`${API_BASE}/tools/repair`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ text, allowed_tools: allowedTools })
  });
  if (!res.ok) {
    throw new Error('Erreur réparation tool call');
  }
  return res.json();
}

export async function getToolRepairStats(): Promise<{ total_scanned: number; total_repaired: number; repair_rate: number }> {
  const res = await fetch(`${API_BASE}/tools/repair/stats`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur stats tool repair');
  }
  return res.json();
}

// ==========================================
// Skill Curator & Lifecycle
// ==========================================

export async function fetchSkillCuratorStatus(): Promise<SkillTelemetry[]> {
  const res = await fetch(`${API_BASE}/skills/curator/status`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur chargement télémétrie curateur');
  }
  return res.json();
}

export async function triggerSkillCuratorSweep(staleDays: number = 14, archiveDays: number = 30): Promise<SkillCuratorSweepResult> {
  const params = new URLSearchParams({ stale_days: String(staleDays), archive_days: String(archiveDays) });
  const res = await fetch(`${API_BASE}/skills/curator/sweep?${params.toString()}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur balayage cycle de vie des compétences');
  }
  return res.json();
}

export async function toggleSkillPin(skillId: string, pinned?: boolean): Promise<{ skill_name: string; pinned: boolean; status: string }> {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(skillId)}/pin`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pinned })
  });
  if (!res.ok) {
    throw new Error('Erreur bascule épinglage compétence');
  }
  return res.json();
}

export async function fetchSkillCuratorLedger(limit: number = 50): Promise<SkillCuratorLedgerRecord[]> {
  const res = await fetch(`${API_BASE}/skills/curator/ledger?limit=${limit}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur chargement journal curateur');
  }
  return res.json();
}

// ==========================================
// MCP Catalog Store API
// ==========================================

export async function fetchMcpCatalog(query?: string, category?: string): Promise<{ total: number; items: McpCatalogItem[] }> {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (category && category !== 'all') params.set('category', category);
  const qStr = params.toString() ? `?${params.toString()}` : '';
  const res = await fetch(`${API_BASE}/mcp/catalog${qStr}`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors du chargement du catalogue MCP');
  }
  return res.json();
}

export async function installMcpServer(slug: string, config?: { api_key?: string; env?: Record<string, string>; headers?: string[] }): Promise<any> {
  const res = await fetch(`${API_BASE}/mcp/catalog/${encodeURIComponent(slug)}/install`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(config || {})
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de l\'installation' }));
    throw new Error(err.detail || 'Erreur lors de l\'installation du serveur MCP');
  }
  return res.json();
}

export async function uninstallMcpServer(slug: string): Promise<any> {
  const res = await fetch(`${API_BASE}/mcp/catalog/${encodeURIComponent(slug)}/uninstall`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors de la désinstallation du serveur MCP');
  }
  return res.json();
}

export async function testMcpServer(slug: string): Promise<McpTestResult> {
  const res = await fetch(`${API_BASE}/mcp/catalog/${encodeURIComponent(slug)}/test`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors du test de connexion du serveur MCP');
  }
  return res.json();
}

// ==========================================
// Session Progress Card API
// ==========================================

export async function fetchProgressCard(conversationId: string): Promise<{ exists: boolean; card: ProgressCardData | null }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/progress-card`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    return { exists: false, card: null };
  }
  return res.json();
}

export async function updateProgressCard(conversationId: string, payload: { title?: string; markdown?: string; plan: ProgressCardStep[] }): Promise<{ success: boolean; card: ProgressCardData }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/progress-card`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    throw new Error('Erreur lors de la mise à jour de la carte de progression');
  }
  return res.json();
}

export async function deleteProgressCard(conversationId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/conversations/${encodeURIComponent(conversationId)}/progress-card`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors de la suppression de la carte de progression');
  }
  return res.json();
}

// ==========================================
// System Doctor & Auto-Repair API
// ==========================================

export async function fetchSystemDiagnostics(): Promise<SystemDiagnosticsReport> {
  const res = await fetch(`${API_BASE}/doctor/diagnose`, {
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors du diagnostic système');
  }
  return res.json();
}

export async function executeDoctorRepair(): Promise<{ success: boolean; actions_taken: string[]; post_repair_diagnostics: SystemDiagnosticsReport }> {
  const res = await fetch(`${API_BASE}/doctor/repair`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    throw new Error('Erreur lors de l\'exécution de l\'auto-réparation');
  }
  return res.json();
}

// ==========================================
// Link Understanding API
// ==========================================

export async function extractLinkPreview(url: string, forceRefresh: boolean = false): Promise<LinkExtractionResult> {
  const res = await fetch(`${API_BASE}/links/extract`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ url, force_refresh: forceRefresh })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de lecture du lien' }));
    throw new Error(err.detail || 'Erreur lors de l\'analyse du lien');
  }
  return res.json();
}

// ==========================================
// Git Worktree Isolation
// ==========================================

export async function fetchWorktrees(cwd?: string): Promise<{ repo_root: string | null; worktrees: GitWorktreeItem[] }> {
  const url = cwd ? `${API_BASE}/worktrees?cwd=${encodeURIComponent(cwd)}` : `${API_BASE}/worktrees`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les worktrees Git');
  return res.json();
}

export async function createWorktree(cwd?: string, subagentId?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/worktrees/create`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ cwd, subagent_id: subagentId })
  });
  if (!res.ok) throw new Error('Impossible de créer le worktree Git');
  return res.json();
}

export async function finalizeWorktree(params: { path: string; branch?: string; repo_root?: string; base_commit?: string; prune?: boolean }): Promise<any> {
  const res = await fetch(`${API_BASE}/worktrees/finalize`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params)
  });
  if (!res.ok) throw new Error('Impossible de finaliser le worktree Git');
  return res.json();
}

export async function removeWorktree(params: { path: string; branch?: string; repo_root?: string }): Promise<any> {
  const res = await fetch(`${API_BASE}/worktrees`, {
    method: 'DELETE',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(params)
  });
  if (!res.ok) throw new Error('Impossible de supprimer le worktree Git');
  return res.json();
}

// ==========================================
// Persistent Code Kernel & Tool RPC
// ==========================================

export async function executeKernelCode(code: string, sessionId?: string, cwd?: string, timeout?: number): Promise<KernelExecutionResult> {
  const res = await fetch(`${API_BASE}/kernel/execute`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code, session_id: sessionId, cwd, timeout })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec d\'exécution du code' }));
    throw new Error(err.detail || 'Erreur lors de l\'exécution du kernel');
  }
  return res.json();
}

export async function resetKernel(sessionId?: string, cwd?: string): Promise<{ success: boolean; message: string }> {
  const res = await fetch(`${API_BASE}/kernel/reset`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ session_id: sessionId, cwd })
  });
  if (!res.ok) throw new Error('Impossible de réinitialiser le kernel');
  return res.json();
}

export async function fetchKernelStatus(): Promise<{ active_kernels: any[]; total: number }> {
  const res = await fetch(`${API_BASE}/kernel/status`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le statut des kernels');
  return res.json();
}

// ==========================================
// Tailscale & Web Push PWA
// ==========================================

export async function fetchTailscaleStatus(): Promise<TailscaleStatus> {
  const res = await fetch(`${API_BASE}/tailscale/status`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le statut Tailscale');
  return res.json();
}

export async function toggleTailscaleServe(enable: boolean, port?: number): Promise<any> {
  const res = await fetch(`${API_BASE}/tailscale/serve`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ enable, port })
  });
  if (!res.ok) throw new Error('Impossible de basculer Tailscale Serve');
  return res.json();
}

export async function fetchVapidPublicKey(): Promise<{ public_key: string }> {
  const res = await fetch(`${API_BASE}/push/vapid-public-key`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de récupérer la clé VAPID');
  return res.json();
}

export async function fetchPushSubscriptions(): Promise<{ subscriptions: WebPushSubscriptionItem[]; count: number }> {
  const res = await fetch(`${API_BASE}/push/subscriptions`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les abonnements push');
  return res.json();
}

export async function subscribeWebPush(sub: { endpoint: string; keys: { p256dh: string; auth: string } }): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/push/subscribe`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(sub)
  });
  if (!res.ok) throw new Error('Échec d\'enregistrement Web Push');
  return res.json();
}

export async function unsubscribeWebPush(endpoint: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/push/unsubscribe`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ endpoint })
  });
  if (!res.ok) throw new Error('Échec de désinscription Web Push');
  return res.json();
}

export async function sendTestWebPush(title?: string, body?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/push/test`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title, body })
  });
  if (!res.ok) throw new Error('Échec d\'envoi de la notification push');
  return res.json();
}

// ==========================================
// Messaging Gateway & PIN Pairing
// ==========================================

export async function fetchGatewayStatus(): Promise<MessagingGatewayStatus> {
  const res = await fetch(`${API_BASE}/gateway/status`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger le statut de la passerelle');
  return res.json();
}

export async function fetchPendingPairings(): Promise<{ pending: PairingCodeItem[] }> {
  const res = await fetch(`${API_BASE}/gateway/pairing/pending`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les codes de couplage');
  return res.json();
}

export async function fetchApprovedDevices(): Promise<{ approved: ApprovedDeviceItem[] }> {
  const res = await fetch(`${API_BASE}/gateway/pairing/approved`, { headers: getHeaders() });
  if (!res.ok) throw new Error('Impossible de charger les appareils approuvés');
  return res.json();
}

export async function requestPairingCode(platform: string, userId: string, userName?: string): Promise<{ success: boolean; message: string; code?: string }> {
  const res = await fetch(`${API_BASE}/gateway/pairing/request`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ platform, user_id: userId, user_name: userName })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de génération du code' }));
    throw new Error(err.detail || 'Erreur couplage');
  }
  return res.json();
}

export async function approvePairingCode(code: string): Promise<{ success: boolean; message: string; device?: ApprovedDeviceItem }> {
  const res = await fetch(`${API_BASE}/gateway/pairing/approve`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ code })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Code invalide ou expiré' }));
    throw new Error(err.detail || 'Échec de validation du code');
  }
  return res.json();
}

export async function revokeDevice(platform: string, userId: string): Promise<{ success: boolean }> {
  const res = await fetch(`${API_BASE}/gateway/pairing/revoke`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ platform, user_id: userId })
  });
  if (!res.ok) throw new Error('Échec de révocation de l\'appareil');
  return res.json();
}

export async function saveBotConfig(config: { platform: string; bot_token: string; chat_id?: string; is_active?: boolean; notify_on_approval?: boolean; notify_on_complete?: boolean }): Promise<any> {
  const res = await fetch(`${API_BASE}/gateway/config`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(config)
  });
  if (!res.ok) throw new Error('Échec de sauvegarde de la configuration bot');
  return res.json();
}

// ==================== CANVAS DOCUMENTS API ====================
export const canvasApi = {
  async createDocument(payload: CanvasDocumentCreateInput): Promise<CanvasDocumentManifest> {
    const res = await fetch(`${API_BASE}/canvas/documents`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`Échec de création du Canvas: ${res.statusText}`);
    return res.json();
  },

  async listDocuments(scope?: string, kind?: CanvasDocumentKind, limit: number = 50): Promise<CanvasDocumentManifest[]> {
    const params = new URLSearchParams();
    if (scope) params.set('scope', scope);
    if (kind) params.set('kind', kind);
    params.set('limit', String(limit));
    const res = await fetch(`${API_BASE}/canvas/documents?${params.toString()}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec de récupération des Canvas: ${res.statusText}`);
    return res.json();
  },

  async getDocument(docId: string): Promise<CanvasDocumentManifest> {
    const res = await fetch(`${API_BASE}/canvas/documents/${encodeURIComponent(docId)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Canvas introuvable: ${res.statusText}`);
    return res.json();
  },

  async deleteDocument(docId: string): Promise<{ status: string; deleted: string }> {
    const res = await fetch(`${API_BASE}/canvas/documents/${encodeURIComponent(docId)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec de suppression: ${res.statusText}`);
    return res.json();
  },

  async renderPreview(html: string, title: string = 'Live Preview', wrapWithTheme: boolean = true): Promise<string> {
    const res = await fetch(`${API_BASE}/canvas/preview`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ html, title, wrap_with_theme: wrapWithTheme }),
    });
    if (!res.ok) throw new Error(`Échec de prévisualisation: ${res.statusText}`);
    return res.text();
  },

  getServeUrl(docId: string, subpath: string = 'index.html'): string {
    return `${API_BASE}/canvas/documents/${encodeURIComponent(docId)}/serve/${subpath.replace(/^\/+/, '')}`;
  },
};

// ==================== VECTOR MEMORY API ====================
export const vectorMemoryApi = {
  async storeMemory(item: MemoryStoreInput): Promise<MemoryEntry> {
    const res = await fetch(`${API_BASE}/memory/vector/store`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(item),
    });
    if (!res.ok) throw new Error(`Échec de stockage mémoire: ${res.statusText}`);
    return res.json();
  },

  async searchMemories(query: string, limit: number = 5, minSimilarity: number = 0.5, agentId: string = 'default', category?: MemoryCategory): Promise<MemorySearchResult[]> {
    const res = await fetch(`${API_BASE}/memory/vector/search`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ query, limit, minSimilarity, agentId, category }),
    });
    if (!res.ok) throw new Error(`Échec de recherche sémantique: ${res.statusText}`);
    return res.json();
  },

  async listMemories(agentId: string = 'default', category?: MemoryCategory, limit: number = 50): Promise<MemoryEntry[]> {
    const params = new URLSearchParams({ agentId, limit: String(limit) });
    if (category) params.set('category', category);
    const res = await fetch(`${API_BASE}/memory/vector/list?${params.toString()}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec de récupération des mémoires: ${res.statusText}`);
    return res.json();
  },

  async deleteMemory(memoryId: string): Promise<{ status: string; deleted: string }> {
    const res = await fetch(`${API_BASE}/memory/vector/${encodeURIComponent(memoryId)}`, {
      method: 'DELETE',
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec de suppression mémoire: ${res.statusText}`);
    return res.json();
  },

  async executeRecall(prompt: string, agentId: string = 'default'): Promise<RecallHookResult> {
    const res = await fetch(`${API_BASE}/memory/vector/recall`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ prompt, agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`Échec auto-recall: ${res.statusText}`);
    return res.json();
  },

  async getConfig(): Promise<AutoRecallConfig> {
    const res = await fetch(`${API_BASE}/memory/vector/config`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec de configuration mémoire: ${res.statusText}`);
    return res.json();
  },

  async updateConfig(config: AutoRecallConfig): Promise<AutoRecallConfig> {
    const res = await fetch(`${API_BASE}/memory/vector/config`, {
      method: 'PUT',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(config),
    });
    if (!res.ok) throw new Error(`Échec de mise à jour configuration mémoire: ${res.statusText}`);
    return res.json();
  },

  async clearMemories(agentId: string = 'default'): Promise<{ status: string; deletedCount: number }> {
    const res = await fetch(`${API_BASE}/memory/vector/clear`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ agent_id: agentId }),
    });
    if (!res.ok) throw new Error(`Échec d'effacement des mémoires: ${res.statusText}`);
    return res.json();
  },
};

// ==================== DOCKER STUDIO API ====================
export const dockerApi = {
  async getStatus(): Promise<DockerEngineStatus> {
    const res = await fetch(`${API_BASE}/docker/status`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec statut Docker: ${res.statusText}`);
    return res.json();
  },

  async scanWorkspace(workspace?: string): Promise<WorkspaceDockerItem[]> {
    const params = new URLSearchParams();
    if (workspace) params.set('workspace', workspace);
    const res = await fetch(`${API_BASE}/docker/workspace?${params.toString()}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec scan Docker: ${res.statusText}`);
    return res.json();
  },

  async listContainers(includeStopped: boolean = true): Promise<ContainerSummary[]> {
    const res = await fetch(`${API_BASE}/docker/containers?all=${includeStopped}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec conteneurs: ${res.statusText}`);
    return res.json();
  },

  async inspectContainer(containerId: string): Promise<Record<string, any>> {
    const res = await fetch(`${API_BASE}/docker/containers/${encodeURIComponent(containerId)}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec inspection conteneur: ${res.statusText}`);
    return res.json();
  },

  async executeAction(containerId: string, action: 'start' | 'stop' | 'restart' | 'remove' | 'kill' | 'pause' | 'unpause'): Promise<{ status: string; container_id: string; action: string }> {
    const res = await fetch(`${API_BASE}/docker/containers/${encodeURIComponent(containerId)}/action`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Action conteneur échouée');
    }
    return res.json();
  },

  async getLogs(containerId: string, tail: number = 200, timestamps: boolean = true): Promise<{ logs: string; container_id: string }> {
    const params = new URLSearchParams({ tail: String(tail), timestamps: String(timestamps) });
    const res = await fetch(`${API_BASE}/docker/containers/${encodeURIComponent(containerId)}/logs?${params.toString()}`, {
      headers: getHeaders(),
    });
    if (!res.ok) throw new Error(`Échec logs conteneur: ${res.statusText}`);
    return res.json();
  },

  async execCommand(containerId: string, command: string, workdir?: string): Promise<ContainerExecResult> {
    const res = await fetch(`${API_BASE}/docker/containers/${encodeURIComponent(containerId)}/exec`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ command, workdir }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Exécution commande conteneur échouée');
    }
    return res.json();
  },

  async executeComposeAction(composePath: string, action: 'up' | 'down' | 'restart' | 'ps' | 'build'): Promise<{ status: string; action: string; output: string }> {
    const res = await fetch(`${API_BASE}/docker/compose/action`, {
      method: 'POST',
      headers: getHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ compose_path: composePath, action }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      throw new Error(err.detail || 'Action compose échouée');
    }
    return res.json();
  },
};










