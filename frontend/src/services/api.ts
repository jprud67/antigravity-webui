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
export async function fetchConversations(limit = 100): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations?limit=${limit}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load conversations: ${res.statusText}`);
  return res.json();
}

export async function fetchConversationTranscript(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`, {
    headers: getHeaders()
  });
  if (!res.ok) throw new Error(`Failed to load transcript: ${res.statusText}`);
  return res.json();
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
