import type { Conversation, ArtifactItem, AppSettings, ModelOption, WorkspaceFolder } from '../types';

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

// Conversations
export async function fetchConversations(limit = 100, q?: string): Promise<Conversation[]> {
  const url = q && q.trim() 
    ? `${API_BASE}/conversations?limit=${limit}&q=${encodeURIComponent(q.trim())}`
    : `${API_BASE}/conversations?limit=${limit}`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load conversations: ${res.statusText}`);
  return res.json();
}

export async function searchConversations(query: string, limit = 50): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations/search?q=${encodeURIComponent(query)}&limit=${limit}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to search conversations: ${res.statusText}`);
  return res.json();
}

export async function fetchConversationTranscript(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`, {
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
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/fork`, {
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
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/handoff`, {
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
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/title`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ title })
  });
  if (!res.ok) throw new Error('Échec du renommage');
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
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/metadata`, {
    method: 'PUT',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(metadata)
  });
  if (!res.ok) throw new Error('Échec de la mise à jour des métadonnées');
  return res.json();
}

export async function deleteConversation(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    method: 'DELETE',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error('Échec de suppression de la conversation');
  return res.json();
}

export async function undoConversationTurn(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/undo`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Échec de l'annulation" }));
    throw new Error(err.detail || "Impossible d'annuler le dernier tour");
  }
  return res.json();
}

export interface BulkActionPayload {
  action: 'delete' | 'pin' | 'unpin' | 'tag' | 'project';
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
  return res.json();
}

export async function bulkConversationExport(conversationIds: string[]): Promise<void> {
  const res = await fetch(`${API_BASE}/conversations/bulk/export`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'export', conversation_ids: conversationIds })
  });
  if (!res.ok) throw new Error("Échec de l'export groupé");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `antigravity_bulk_export_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function getExportHtmlUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${conversationId}/export/html${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getExportMarkdownUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${conversationId}/export/markdown${token ? `?token=${encodeURIComponent(token)}` : ''}`;
}

export function getExportJsonUrl(conversationId: string): string {
  const token = getAuthToken();
  return `${API_BASE}/conversations/${conversationId}/export/json${token ? `?token=${encodeURIComponent(token)}` : ''}`;
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
  const res = await fetch(`${API_BASE}/artifacts/${conversationId}/${filename}`, {
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
  if (!res.ok) throw new Error(`Failed to load workspaces: ${res.statusText}`);
  return res.json();
}

export async function addWorkspace(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to add workspace: ${res.statusText}`);
  return res.json();
}

export async function exploreDirectory(path?: string): Promise<WorkspaceFolder> {
  const url = path ? `${API_BASE}/workspaces/explore?path=${encodeURIComponent(path)}` : `${API_BASE}/workspaces/explore`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to explore directory: ${res.statusText}`);
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

export async function fetchFileContent(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}/files/content?path=${encodeURIComponent(path)}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load file content: ${res.statusText}`);
  return res.json();
}

export async function saveFileContent(path: string, content: string): Promise<{ success: boolean; path: string; size: number; last_modified: number }> {
  const res = await fetch(`${API_BASE}/files/save`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ path, content })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Échec de la sauvegarde' }));
    throw new Error(err.detail || 'Erreur lors de la sauvegarde du fichier');
  }
  return res.json();
}

// Tasks & Subagents Monitoring
export async function fetchTasksList(conversationId?: string): Promise<{ tasks: any[]; subagents: any[]; processes: any[] }> {
  const url = conversationId
    ? `${API_BASE}/tasks/list?conversation_id=${encodeURIComponent(conversationId)}`
    : `${API_BASE}/tasks/list`;
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to load tasks: ${res.statusText}`);
  return res.json();
}

export async function killTask(pid?: number, taskId?: string): Promise<any> {
  const res = await fetch(`${API_BASE}/tasks/kill`, {
    method: 'POST',
    headers: getHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ pid, task_id: taskId })
  });
  if (!res.ok) throw new Error(`Failed to kill task: ${res.statusText}`);
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
  modified: string[];
  staged: string[];
  untracked: string[];
  deleted: string[];
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

export async function fetchGitDiff(workspace?: string, path?: string, staged: boolean = false): Promise<{ workspace: string; path?: string; diff: string }> {
  const params = new URLSearchParams();
  if (workspace) params.append('workspace', workspace);
  if (path) params.append('path', path);
  if (staged) params.append('staged', 'true');
  const res = await fetch(`${API_BASE}/git/diff?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch Git diff: ${res.statusText}`);
  return res.json();
}

export async function fetchGitBranches(workspace?: string): Promise<{ current: string; branches: string[] }> {
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

export async function fetchGitTags(workspace?: string): Promise<{ tags: string[] }> {
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
}

export async function fetchRulesFiles(workspacePath?: string): Promise<{ files: RuleFileItem[] }> {
  const params = workspacePath ? `?workspace_path=${encodeURIComponent(workspacePath)}` : '';
  const res = await fetch(`${API_BASE}/rules/files${params}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch rules files: ${res.statusText}`);
  return res.json();
}

export async function fetchRuleContent(
  fileId: string,
  workspacePath?: string
): Promise<{ file_id: string; path: string; content: string; exists: boolean; syntax: 'markdown' | 'json'; size?: number; last_modified?: number }> {
  const params = new URLSearchParams({ file_id: fileId });
  if (workspacePath) params.append('workspace_path', workspacePath);
  const res = await fetch(`${API_BASE}/rules/content?${params.toString()}`, { headers: getHeaders() });
  if (!res.ok) throw new Error(`Failed to fetch rule content: ${res.statusText}`);
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
  if (!res.ok) throw new Error('Erreur lors de la récupération des comptes Google');
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

export async function exportConversationMarkdown(conversationId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/export/markdown`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'export Markdown");
  return res.blob();
}

export async function exportConversationJSON(conversationId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}/export/json`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Échec du téléchargement de l'export JSON");
  return res.blob();
}

export async function fetchUsageQuota(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/usage`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Impossible de récupérer les quotas Antigravity");
  return res.json();
}

export async function fetchCredits(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/credits`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Impossible de récupérer les crédits Antigravity");
  return res.json();
}

export async function fetchChangelog(): Promise<any> {
  const res = await fetch(`${API_BASE}/settings/changelog`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Impossible de récupérer le changelog Antigravity");
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
  const res = await fetch(`${API_BASE}/system/version`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Impossible de récupérer les informations de version");
  return res.json();
}

export async function checkSystemUpdate(force: boolean = false): Promise<UpdateCheckResult> {
  const url = `${API_BASE}/system/update/check${force ? '?force=true' : ''}`;
  const res = await fetch(url, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error("Impossible de vérifier les mises à jour");
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



