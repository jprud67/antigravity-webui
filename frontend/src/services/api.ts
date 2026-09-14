import type { Conversation, ArtifactItem, AppSettings, ModelOption, WorkspaceFolder } from '../types';

const API_BASE = '/api';

export async function fetchConversations(limit = 100): Promise<Conversation[]> {
  const res = await fetch(`${API_BASE}/conversations?limit=${limit}`);
  if (!res.ok) throw new Error(`Failed to load conversations: ${res.statusText}`);
  return res.json();
}

export async function fetchConversationTranscript(conversationId: string): Promise<any> {
  const res = await fetch(`${API_BASE}/conversations/${conversationId}`);
  if (!res.ok) throw new Error(`Failed to load transcript: ${res.statusText}`);
  return res.json();
}

export async function fetchArtifacts(conversationId?: string): Promise<ArtifactItem[]> {
  const url = conversationId 
    ? `${API_BASE}/artifacts?conversation_id=${encodeURIComponent(conversationId)}`
    : `${API_BASE}/artifacts`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load artifacts: ${res.statusText}`);
  return res.json();
}

export async function fetchArtifactContent(conversationId: string, filename: string): Promise<string> {
  const res = await fetch(`${API_BASE}/artifacts/${conversationId}/${filename}`);
  if (!res.ok) throw new Error(`Failed to read artifact: ${res.statusText}`);
  const data = await res.json();
  return data.content;
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`);
  if (!res.ok) throw new Error(`Failed to load settings: ${res.statusText}`);
  return res.json();
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error(`Failed to save settings: ${res.statusText}`);
  return res.json();
}

export async function fetchModels(): Promise<ModelOption[]> {
  const res = await fetch(`${API_BASE}/settings/models`);
  if (!res.ok) throw new Error(`Failed to load models: ${res.statusText}`);
  return res.json();
}

export async function fetchWorkspaces(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/workspaces`);
  if (!res.ok) throw new Error(`Failed to load workspaces: ${res.statusText}`);
  return res.json();
}

export async function addWorkspace(path: string): Promise<any> {
  const res = await fetch(`${API_BASE}/workspaces?path=${encodeURIComponent(path)}`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to add workspace: ${res.statusText}`);
  return res.json();
}

export async function exploreDirectory(path?: string): Promise<WorkspaceFolder> {
  const url = path ? `${API_BASE}/workspaces/explore?path=${encodeURIComponent(path)}` : `${API_BASE}/workspaces/explore`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to explore directory: ${res.statusText}`);
  return res.json();
}
